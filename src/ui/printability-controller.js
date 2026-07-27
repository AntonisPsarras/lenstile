/**
 * Orchestrate printability analysis and cleanup via the shared image worker.
 */

import {
  getState,
  getRuntimeQuantization,
  getRuntimePrintability,
  getRuntimeWorkflow,
  getPrintSettings,
  beginPrintabilityRequest,
  acceptPrintabilityResult,
  acceptPrintabilityError,
  acceptCleanedDesign,
  resetPrintabilityCleanup,
  isQuantizationStale,
  isPrintabilityStale,
  setPrintabilityComparisonMode,
} from "../state.js";
import {
  FEATURES,
  CLEANUP_ALGORITHM_VERSION,
  MAX_CLEANUP_PASSES,
} from "../config.js";
import { TILE_V1 } from "../geometry/tile-spec.js";
import {
  PrintabilityStatus,
  reportHasIssues,
} from "../image/printability.js";
import {
  PrintabilityErrorCode,
  createPrintabilityError,
} from "../image/printability-errors.js";
import {
  nextPrintabilityRequestId,
  requestPrintability,
} from "../workers/image-worker-client.js";
import { WorkerMessageType } from "../workers/image-worker-protocol.js";
import { showError, showNotice, clearMessages } from "../ui/notifications.js";

/**
 * @returns {{ enabled: boolean, reason: string | null }}
 */
export function getAnalyzeButtonState() {
  if (!FEATURES.printabilityCleanup) {
    return { enabled: false, reason: "Print check is disabled." };
  }
  const rq = getRuntimeQuantization();
  const rp = getRuntimePrintability();
  if (!rq.indices || rq.status !== "ready") {
    return { enabled: false, reason: "Create a color preview first." };
  }
  if (isQuantizationStale()) {
    return {
      enabled: false,
      reason: "Nozzle or image settings changed. Update the color preview, then check again.",
    };
  }
  if (rp.status === PrintabilityStatus.ANALYZING) {
    if (rp.activeOperation === "clean") {
      return { enabled: false, reason: "Wait for the fix to finish." };
    }
    return { enabled: false, reason: "Check is already running." };
  }
  return { enabled: true, reason: null };
}

/**
 * @returns {{ enabled: boolean, reason: string | null }}
 */
export function getCleanButtonState() {
  if (!FEATURES.printabilityCleanup) {
    return { enabled: false, reason: "Print check is disabled." };
  }
  const rq = getRuntimeQuantization();
  const rp = getRuntimePrintability();
  if (!rq.indices || rq.status !== "ready") {
    return { enabled: false, reason: "Create a color preview first." };
  }
  if (isQuantizationStale()) {
    return {
      enabled: false,
      reason: "Nozzle or image settings changed. Update the color preview, then check again.",
    };
  }
  if (rp.status === PrintabilityStatus.ANALYZING) {
    if (rp.activeOperation === "clean") {
      return { enabled: false, reason: "Fix is already running." };
    }
    return { enabled: false, reason: "Wait for the check to finish." };
  }
  return { enabled: true, reason: null };
}

/**
 * @returns {"analyze" | "clean" | null}
 */
export function getPrintabilityLoadingOperation() {
  const rp = getRuntimePrintability();
  if (rp.status !== PrintabilityStatus.ANALYZING) return null;
  return rp.activeOperation === "clean" ? "clean" : "analyze";
}

/**
 * @returns {{ enabled: boolean, reason: string | null }}
 */
export function getAcceptCleanupButtonState() {
  const rp = getRuntimePrintability();
  const wf = getRuntimeWorkflow();
  const busy = wf.pipelineStatus === "updating-colors"
    || wf.pipelineStatus === "analyzing-printability"
    || wf.pipelineStatus === "preparing-fix"
    || wf.pipelineStatus === "preparing-printable"
    || wf.pipelineStatus === "building-model"
    || wf.pipelineStatus === "validating-model";
  if (busy) {
    return { enabled: false, reason: "Wait for the design update to finish." };
  }
  if (isPrintabilityStale()) {
    return { enabled: false, reason: "Your printable design needs to be checked again." };
  }
  if (!rp.cleanedIndices) {
    return {
      enabled: false,
      reason: "A printable preview is not ready yet.",
    };
  }
  if (rp.accepted) {
    return { enabled: false, reason: "Printable design already approved." };
  }
  // Non-stale cleaned preview + not busy is enough to review and approve.
  return { enabled: true, reason: null };
}

/**
 * @returns {{ enabled: boolean, reason: string | null }}
 */
export function getResetCleanupButtonState() {
  const rp = getRuntimePrintability();
  if (!rp.cleanedIndices && !rp.accepted) {
    return { enabled: false, reason: "Nothing to undo." };
  }
  return { enabled: true, reason: null };
}

/**
 * Plain-language issue summary for the Make printable panel.
 * @param {import("../image/printability.js").PrintabilityReport | null | undefined} report
 * @param {{ ranCleanup?: boolean }} [opts]
 * @returns {string}
 */
export function getPlainIssueSummary(report, opts = {}) {
  if (!report) return "";
  if (opts.ranCleanup && typeof report.changedPixelCount === "number") {
    if (report.changedPixelCount === 0) {
      return "The automatic fix did not need to change any pixels.";
    }
    return `The automatic fix changed ${report.changedPixelCount} pixels.`;
  }
  const tinyAreas = (report.smallIslandCount || 0) + (report.smallHoleCount || 0);
  const narrow = (report.narrowFeaturePixelCount || 0) > 0
    ? report.narrowFeaturePixelCount
    : 0;
  const narrowGaps = (report.narrowGapPixelCount || 0) > 0
    ? report.narrowGapPixelCount
    : 0;
  if (!reportHasIssues(report)) {
    return "No printing problems found.";
  }
  /** @type {string[]} */
  const parts = [];
  if (tinyAreas > 0) {
    parts.push(
      `${tinyAreas} tiny area${tinyAreas === 1 ? "" : "s"} may not print cleanly.`,
    );
  }
  if (narrow > 0) {
    parts.push("Narrow details may be lost.");
  }
  if (narrowGaps > 0) {
    parts.push("Narrow gaps may close when printed.");
  }
  if (!parts.length) {
    return "Some printing problems were found.";
  }
  return parts.join(" ");
}

/**
 * @param {boolean} runCleanup
 * @param {{ quiet?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, superseded?: boolean }>}
 */
export async function runPrintabilityAnalysis(runCleanup, opts = {}) {
  const quiet = Boolean(opts.quiet);
  const button = runCleanup ? getCleanButtonState() : getAnalyzeButtonState();
  if (!button.enabled) {
    if (!quiet) showError(button.reason || "Cannot check the design.");
    return { ok: false };
  }

  const s = getState();
  const rq = getRuntimeQuantization();
  if (!rq.indices) {
    if (!quiet) showError("Create a color preview first.");
    return { ok: false };
  }

  if (!quiet) clearMessages();
  const requestId = nextPrintabilityRequestId();
  const sourceRevision = s.sourceRevision;
  const printabilityRevision = s.printabilityRevision;
  beginPrintabilityRequest(requestId, runCleanup);

  const settings = getPrintSettings(s);
  // Copy indices so the worker transfer does not detach the frozen quantization buffer.
  const indicesCopy = new Uint8Array(rq.indices);
  const indicesBuffer = indicesCopy.buffer;

  try {
    const response = await requestPrintability({
      requestId,
      sourceRevision,
      printabilityRevision,
      width: rq.width,
      height: rq.height,
      indicesBuffer,
      runCleanup,
      minimumFeatureWidthMm: settings.minimumFeatureWidthMm,
      minimumGapWidthMm: settings.minimumGapWidthMm,
      minimumIslandAreaMm2: settings.minimumIslandAreaMm2,
      maximumHoleAreaToFillMm2: settings.maximumHoleAreaToFillMm2,
      tileWidthMm: TILE_V1.widthMm,
      tileHeightMm: TILE_V1.heightMm,
      maxPasses: MAX_CLEANUP_PASSES,
      algorithmVersion: CLEANUP_ALGORITHM_VERSION,
    });

    if (response.type === WorkerMessageType.PRINTABILITY_ERROR) {
      acceptPrintabilityError({
        requestId,
        sourceRevision,
        printabilityRevision,
        error: response.error,
      });
      if (!quiet) showError(response.error?.message || "The design could not be checked.");
      return { ok: false };
    }

    const resultPayload = response.result;
    const issueMask = new Uint8Array(resultPayload.issueMaskBuffer);
    const cleanedIndices = resultPayload.cleanedIndicesBuffer
      ? new Uint8Array(resultPayload.cleanedIndicesBuffer)
      : null;

    const accepted = acceptPrintabilityResult({
      requestId,
      sourceRevision,
      printabilityRevision,
      ranCleanup: Boolean(runCleanup),
      result: {
        width: resultPayload.width,
        height: resultPayload.height,
        issueMask,
        cleanedIndices,
        report: resultPayload.report,
        algorithmVersion: resultPayload.algorithmVersion,
      },
    });

    if (!accepted) {
      if (!quiet) showNotice("Result ignored because your image or settings changed.");
      return { ok: false, superseded: true };
    }

    const rp = getRuntimePrintability();
    if (!quiet) {
      if (runCleanup) {
        setPrintabilityComparisonMode("side-by-side");
        showNotice(getPlainIssueSummary(rp.report, { ranCleanup: true }));
      } else if (rp.report && reportHasIssues(rp.report)) {
        setPrintabilityComparisonMode("issues");
        showNotice(getPlainIssueSummary(rp.report));
      } else {
        showNotice("No printing problems found.");
      }
    } else if (runCleanup) {
      setPrintabilityComparisonMode("side-by-side");
    }
    return { ok: true };
  } catch (err) {
    const error = err && typeof err === "object" && "code" in err
      ? /** @type {import("../image/printability-errors.js").PrintabilityError} */ (err)
      : createPrintabilityError(
        PrintabilityErrorCode.WORKER_FAILURE,
        err instanceof Error ? err.message : String(err),
      );
    acceptPrintabilityError({
      requestId,
      sourceRevision,
      printabilityRevision,
      error,
    });
    if (!quiet) showError(error.message);
    return { ok: false };
  }
}

export async function analyzePrintabilityAction() {
  await runPrintabilityAnalysis(false);
}

export async function cleanPrintabilityAction() {
  await runPrintabilityAnalysis(true);
}

export function acceptCleanupAction() {
  const state = getAcceptCleanupButtonState();
  if (!state.enabled) {
    showError(state.reason || "Cannot approve this design.");
    return;
  }
  if (acceptCleanedDesign()) {
    showNotice("Printable design approved");
  } else {
    showError("Could not approve the printable design. Check it again.");
  }
}

export function resetCleanupAction() {
  const state = getResetCleanupButtonState();
  if (!state.enabled) {
    showError(state.reason || "Nothing to undo.");
    return;
  }
  resetPrintabilityCleanup();
  showNotice("Fixes undone.");
}

/**
 * Human-readable status label for the Make printable panel.
 * @returns {string}
 */
export function getPrintabilityStatusLabel() {
  const rp = getRuntimePrintability();
  if (isPrintabilityStale() && rp.status !== PrintabilityStatus.NOT_ANALYZED) {
    return "Needs updating — image or colors changed";
  }
  switch (rp.status) {
    case PrintabilityStatus.NOT_ANALYZED:
      return "Waiting for automatic check and fix";
    case PrintabilityStatus.ANALYZING:
      return rp.activeOperation === "clean" ? "Fixing…" : "Checking…";
    case PrintabilityStatus.ISSUES_FOUND:
      return "Problems found";
    case PrintabilityStatus.NO_ISSUES:
      return "No problems found";
    case PrintabilityStatus.CLEANED_PREVIEW:
      return "Fixed preview ready — review, then use this design";
    case PrintabilityStatus.ACCEPTED:
      return "Printable design approved";
    case PrintabilityStatus.STALE:
      return "Needs updating — image or colors changed";
    case PrintabilityStatus.ERROR:
      return "Error";
    default:
      return String(rp.status);
  }
}
