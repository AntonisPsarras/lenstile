/**
 * Milestone 7.4.1 — dependency-aware processing pipeline coordinator.
 * Formal FSM transitions; every async op ends success / error / superseded.
 * Calls existing controllers/workers; does not reimplement algorithms.
 */

import {
  getState,
  getRuntimeWorkflow,
  getRuntimeGeometry,
  getRuntimeBitmap,
  getRuntimePrintability,
  patchRuntimeWorkflow,
  setCropNeedsUpdate,
  isPrintabilityExportReady,
  isGeometryDownloadReady,
  isQuantizationStale,
} from "../state.js";
import { resolvePrintProfile } from "../config.js";
import {
  determineAffectedStages,
  shouldAutoRunColorPrintablePipeline,
  changeRequiresReapproval,
} from "./dependency-graph.js";
import {
  PIPELINE_STATUS_LABELS,
  PIPELINE_ERROR_MESSAGES,
  nozzleProgressMessages,
  NOZZLE_PIPELINE_STAGES,
  MODEL_BUILD_STAGES,
  LONGER_THAN_USUAL_MESSAGE,
  WATCHDOG_SOFT_MS,
  labelForPipelineStatus,
} from "./pipeline-status.js";
import {
  assertTransition,
  isColorPrintableBusy,
  isExportBusy,
  normalizeWorkflowStatus,
  successResult,
  errorResult,
  supersededResult,
} from "./workflow-fsm.js";
import {
  recordPipelineRequest,
  recordPipelineWin,
} from "./instrumentation.js";
import { runQuantization } from "../ui/quantize-controller.js";
import { runPrintabilityAnalysis } from "../ui/printability-controller.js";
import { generateModelAction } from "../ui/export-controller.js";
import { announce } from "../ui/accessibility.js";
import { showNotice, showError } from "../ui/notifications.js";
import { AppEvents, emit } from "../events.js";

/**
 * @typedef {import("./dependency-graph.js").ChangeType} ChangeType
 * @typedef {import("./dependency-graph.js").PipelineStage} PipelineStage
 * @typedef {import("./workflow-fsm.js").WorkflowState} WorkflowState
 * @typedef {import("./workflow-fsm.js").OperationResult} OperationResult
 */

/** @type {null | (() => { width: number, height: number })} */
let getCropSizeFn = null;

/** @type {ReturnType<typeof setTimeout> | null} */
let watchdogTimer = null;

/** Optional hard timeout for tests (ms); null = disabled. */
let hardTimeoutMs = null;

/** @type {ReturnType<typeof setTimeout> | null} */
let hardTimeoutTimer = null;

/** Guard against recursive auto-build on every sync. */
let modelBuildInFlight = false;

/**
 * Inject crop size getter from the app shell (required before auto pipelines).
 * @param {() => { width: number, height: number }} fn
 */
export function configurePipeline(fn) {
  getCropSizeFn = fn;
}

/**
 * @param {number | null} ms null disables
 */
export function setPipelineHardTimeoutMs(ms) {
  hardTimeoutMs = ms == null ? null : Number(ms);
}

/**
 * @returns {{ width: number, height: number }}
 */
function resolveCropSize() {
  if (typeof getCropSizeFn === "function") {
    return getCropSizeFn();
  }
  return { width: 592, height: 212 };
}

function clearWatchdog() {
  if (watchdogTimer != null) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
  if (hardTimeoutTimer != null) {
    clearTimeout(hardTimeoutTimer);
    hardTimeoutTimer = null;
  }
}

/**
 * Soft 15s notice + optional hard test timeout.
 * @param {number} operationId
 */
function armWatchdog(operationId) {
  clearWatchdog();
  watchdogTimer = setTimeout(() => {
    const wf = getRuntimeWorkflow();
    if (wf.requestedOperationId !== operationId) return;
    if (!isExportBusy(wf.pipelineStatus) && !isColorPrintableBusy(wf.pipelineStatus)) {
      return;
    }
    patchRuntimeWorkflow({
      longerThanUsual: true,
      progressMessage: LONGER_THAN_USUAL_MESSAGE,
    });
    announce(LONGER_THAN_USUAL_MESSAGE, "polite");
    emit(AppEvents.WORKFLOW_CHANGED, getRuntimeWorkflow());
  }, WATCHDOG_SOFT_MS);

  if (hardTimeoutMs != null && Number.isFinite(hardTimeoutMs) && hardTimeoutMs > 0) {
    hardTimeoutTimer = setTimeout(() => {
      const wf = getRuntimeWorkflow();
      if (wf.requestedOperationId !== operationId) return;
      if (!isExportBusy(wf.pipelineStatus) && !isColorPrintableBusy(wf.pipelineStatus)) {
        return;
      }
      const diag = [
        `Pipeline hard timeout after ${hardTimeoutMs}ms`,
        `operationId=${operationId}`,
        `status=${wf.pipelineStatus}`,
        `stageIndex=${wf.progressStageIndex}`,
      ].join("; ");
      patchRuntimeWorkflow({
        error: { message: diag, stage: "generic", code: "pipeline-hard-timeout" },
        pipelineStatus: "error",
        progressMessage: PIPELINE_ERROR_MESSAGES.generic,
        longerThanUsual: true,
      });
      emit(AppEvents.WORKFLOW_CHANGED, getRuntimeWorkflow());
    }, hardTimeoutMs);
  }
}

/**
 * Cancel in-flight pipeline work by bumping the requested operation id.
 * Older accepts still rely on requestId/revision checks in state helpers.
 * @returns {number} new requestedOperationId
 */
export function cancelSupersededPipeline() {
  clearWatchdog();
  const wf = getRuntimeWorkflow();
  const nextId = wf.requestedOperationId + 1;
  patchRuntimeWorkflow({
    requestedOperationId: nextId,
    longerThanUsual: false,
    canCancel: false,
  });
  return nextId;
}

/**
 * User cancel: supersede current op and return to a waiting/idle state.
 * @returns {OperationResult}
 */
export function cancelCurrentPipeline() {
  const wf = getRuntimeWorkflow();
  const opId = wf.requestedOperationId;
  cancelSupersededPipeline();
  const next = wf.needsReview || getRuntimePrintability().cleanedIndices
    ? "waiting-for-review"
    : "idle";
  transitionTo(next, {
    progressMessage: "Update cancelled.",
    error: null,
    longerThanUsual: false,
    canCancel: false,
    progressStageIndex: 0,
    progressStageTotal: 0,
    progressStageLabel: null,
  });
  recordPipelineWin("superseded", opId);
  return supersededResult(opId);
}

/**
 * @param {WorkflowState} to
 * @param {Partial<import("../state.js").RuntimeWorkflow>} [extra]
 * @param {{ announce?: boolean, force?: boolean }} [opts]
 */
export function transitionTo(to, extra = {}, opts = {}) {
  const wf = getRuntimeWorkflow();
  const from = normalizeWorkflowStatus(wf.pipelineStatus);
  if (!opts.force) {
    assertTransition(from, to);
  }
  patchRuntimeWorkflow({
    pipelineStatus: to,
    pipelineStep: to,
    ...extra,
  });
  emit(AppEvents.WORKFLOW_CHANGED, getRuntimeWorkflow());
}

/**
 * @param {string | null} message
 * @param {WorkflowState | string} status
 * @param {{ announce?: boolean, force?: boolean }} [opts]
 */
export function reportPipelineProgress(message, status, opts = {}) {
  const normalized = normalizeWorkflowStatus(status);
  // Low-level status writer: force unless assert:true (used by FSM tests).
  if (opts.assert) {
    const from = normalizeWorkflowStatus(getRuntimeWorkflow().pipelineStatus);
    assertTransition(from, normalized);
  }
  /** @type {Partial<import("../state.js").RuntimeWorkflow>} */
  const patch = {
    pipelineStatus: normalized,
    progressMessage: message,
    pipelineStep: normalized,
  };
  if (normalized !== "error") {
    patch.error = null;
  }
  patchRuntimeWorkflow(patch);
  if (opts.announce !== false && message) {
    announce(message, normalized === "error" ? "assertive" : "polite");
  }
  emit(AppEvents.WORKFLOW_CHANGED, getRuntimeWorkflow());
}

/**
 * Update stage-based progress fields (percentage from completed stages).
 * @param {readonly string[]} stages
 * @param {number} activeIndex 0-based index of current active stage
 * @param {{ completed?: boolean, announce?: boolean }} [opts]
 */
export function setStageProgress(stages, activeIndex, opts = {}) {
  const total = stages.length;
  const idx = Math.max(0, Math.min(activeIndex, total - 1));
  const completed = opts.completed
    ? total
    : Math.max(0, idx);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const label = stages[idx] || null;
  const prev = getRuntimeWorkflow().progressStageLabel;
  patchRuntimeWorkflow({
    progressStageIndex: idx,
    progressStageTotal: total,
    progressStageLabel: label,
    progressPercent: percent,
    progressMessage: label ? `${label}…` : getRuntimeWorkflow().progressMessage,
  });
  if (opts.announce !== false && label && label !== prev) {
    announce(label, "polite");
  }
  emit(AppEvents.WORKFLOW_CHANGED, getRuntimeWorkflow());
}

/**
 * Invalidate from a pipeline stage using existing state semantics.
 * @param {PipelineStage} stageId
 * @param {string} reason
 */
export function invalidateFromStage(stageId, reason) {
  const stages = determineAffectedStages(reason);
  if (stageId === "colors" || stages.includes("printable")) {
    patchRuntimeWorkflow({
      reason,
      needsReview: changeRequiresReapproval(reason),
    });
  }
  if (reason === "crop-commit") {
    setCropNeedsUpdate(true);
  }
}

/**
 * @param {number} operationId
 * @returns {boolean}
 */
function isCurrentOperation(operationId) {
  return getRuntimeWorkflow().requestedOperationId === operationId;
}

/**
 * Release in-flight bookkeeping for an operation if it still owns the workflow.
 * @param {number} operationId
 * @param {WorkflowState} terminalOrWaiting
 * @param {Partial<import("../state.js").RuntimeWorkflow>} [extra]
 */
function finalizeOperation(operationId, terminalOrWaiting, extra = {}) {
  clearWatchdog();
  if (!isCurrentOperation(operationId)) {
    return;
  }
  const wf = getRuntimeWorkflow();
  const from = normalizeWorkflowStatus(wf.pipelineStatus);
  if (from !== terminalOrWaiting) {
    try {
      assertTransition(from, terminalOrWaiting);
    } catch {
      // Force terminal cleanup so no op stays permanently processing.
      transitionTo(terminalOrWaiting, {
        longerThanUsual: false,
        canCancel: false,
        ...extra,
      }, { force: true });
      return;
    }
  }
  transitionTo(terminalOrWaiting, {
    longerThanUsual: false,
    canCancel: false,
    ...extra,
  }, { force: from === terminalOrWaiting });
}

/**
 * @param {{ width: number, height: number }} [viewCropSize]
 * @returns {Promise<{ ok: boolean, superseded?: boolean, status?: string }>}
 */
export async function regenerateColorPreview(viewCropSize) {
  const size = viewCropSize || resolveCropSize();
  recordPipelineRequest("quantize");
  return runQuantization(size, { quiet: true });
}

/**
 * @param {{ runCleanup?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, superseded?: boolean, status?: string }>}
 */
export async function regeneratePrintableDesign(opts = {}) {
  const runCleanup = opts.runCleanup !== false;
  recordPipelineRequest("printability");
  return runPrintabilityAnalysis(runCleanup, { quiet: true });
}

/**
 * Build geometry only when printable design is approved and current.
 * @returns {Promise<OperationResult>}
 */
export async function regenerateModel() {
  if (!isPrintabilityExportReady()) {
    return errorResult(getRuntimeWorkflow().requestedOperationId);
  }

  const operationId = cancelSupersededPipeline();
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  modelBuildInFlight = true;
  armWatchdog(operationId);

  try {
    transitionTo("building-model", {
      progressMessage: "Building printable model…",
      error: null,
      canCancel: true,
      longerThanUsual: false,
      reason: "model-build",
    }, { force: true });
    setStageProgress(MODEL_BUILD_STAGES, 0);

    if (!isCurrentOperation(operationId)) {
      recordPipelineWin("superseded", operationId);
      return supersededResult(operationId);
    }

    setStageProgress(MODEL_BUILD_STAGES, 1);
    recordPipelineRequest("geometry");
    // canGenerate must allow this call while status is building-model.
    const gen = await generateModelAction({
      quiet: true,
      allowWhileBuilding: true,
      operationId,
    });

    if (!isCurrentOperation(operationId)) {
      recordPipelineWin("superseded", operationId);
      return supersededResult(operationId);
    }

    if (gen && gen.superseded) {
      recordPipelineWin("superseded", operationId);
      return supersededResult(operationId);
    }

    setStageProgress(MODEL_BUILD_STAGES, 2);
    transitionTo("validating-model", {
      progressMessage: "Checking the model…",
    });

    const ready = isGeometryDownloadReady();
    if (!ready || (gen && gen.ok === false)) {
      const msg = PIPELINE_ERROR_MESSAGES.model;
      finalizeOperation(operationId, "error", {
        error: { message: msg, stage: "model", code: "pipeline-model" },
        progressMessage: msg,
        completedOperationId: operationId,
      });
      announce(msg, "assertive");
      showError(msg);
      return errorResult(operationId);
    }

    setStageProgress(MODEL_BUILD_STAGES, 3, { completed: true });
    const duration = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
    recordPipelineWin("geometry", operationId, duration);
    finalizeOperation(operationId, "model-ready", {
      progressMessage: null,
      error: null,
      completedOperationId: operationId,
      needsReview: false,
    });
    return successResult(operationId);
  } catch (err) {
    if (!isCurrentOperation(operationId)) {
      recordPipelineWin("superseded", operationId);
      return supersededResult(operationId);
    }
    const msg = PIPELINE_ERROR_MESSAGES.model;
    finalizeOperation(operationId, "error", {
      error: {
        message: msg,
        stage: "model",
        code: err instanceof Error ? err.message : String(err),
      },
      progressMessage: msg,
      completedOperationId: operationId,
    });
    announce(msg, "assertive");
    showError(msg);
    return errorResult(operationId);
  } finally {
    modelBuildInFlight = false;
    if (isCurrentOperation(operationId)) {
      const st = normalizeWorkflowStatus(getRuntimeWorkflow().pipelineStatus);
      if (st === "building-model" || st === "validating-model") {
        // Ensure we never leave building/validating stuck after the await settles.
        finalizeOperation(operationId, "error", {
          error: {
            message: PIPELINE_ERROR_MESSAGES.model,
            stage: "model",
            code: "pipeline-incomplete",
          },
          progressMessage: PIPELINE_ERROR_MESSAGES.model,
        });
      }
    }
    clearWatchdog();
  }
}

/**
 * Run dependent processing for a change type (colors → analyze → fix → review).
 * @param {ChangeType | string} changeType
 * @param {{ stayOnStage?: boolean, runCleanup?: boolean }} [opts]
 * @returns {Promise<OperationResult>}
 */
export async function runDependentProcessingPipeline(changeType, opts = {}) {
  if (!shouldAutoRunColorPrintablePipeline(changeType)) {
    invalidateFromStage("colors", /** @type {string} */ (changeType));
    return successResult(getRuntimeWorkflow().requestedOperationId);
  }

  if (!getRuntimeBitmap()) {
    return errorResult(getRuntimeWorkflow().requestedOperationId);
  }

  const operationId = cancelSupersededPipeline();
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const s0 = getState();
  const profile = resolvePrintProfile(s0.printability.profileId);
  const messages = nozzleProgressMessages(profile.nozzleDiameterMm);
  const runCleanup = opts.runCleanup !== false;

  patchRuntimeWorkflow({
    reason: String(changeType),
    error: null,
    needsReview: false,
    cropNeedsUpdate: false,
    canCancel: true,
    longerThanUsual: false,
  });
  armWatchdog(operationId);

  try {
    transitionTo("updating-colors", {
      progressMessage: changeType === "nozzle-change"
        ? messages.updatingColors
        : "Updating image colors…",
    }, { force: true });
    setStageProgress(NOZZLE_PIPELINE_STAGES, 0);

    const colorResult = await regenerateColorPreview();
    if (!isCurrentOperation(operationId)) {
      recordPipelineWin("superseded", operationId);
      return supersededResult(operationId);
    }
    if (!colorResult.ok) {
      if (colorResult.superseded) {
        recordPipelineWin("superseded", operationId);
        return supersededResult(operationId);
      }
      const msg = PIPELINE_ERROR_MESSAGES.colors;
      finalizeOperation(operationId, "error", {
        error: { message: msg, stage: "colors", code: "pipeline-colors" },
        progressMessage: msg,
        needsReview: false,
      });
      announce(msg, "assertive");
      showError(msg);
      return errorResult(operationId);
    }
    recordPipelineWin("color", operationId);

    transitionTo("analyzing-printability", {
      progressMessage: changeType === "nozzle-change"
        ? messages.analyzing
        : "Checking small printable details…",
    });
    setStageProgress(NOZZLE_PIPELINE_STAGES, 1);

    // Analyze first (no cleanup) so progress stages are truthful.
    const analyzeResult = await regeneratePrintableDesign({ runCleanup: false });
    if (!isCurrentOperation(operationId)) {
      recordPipelineWin("superseded", operationId);
      return supersededResult(operationId);
    }
    if (!analyzeResult.ok) {
      if (analyzeResult.superseded) {
        recordPipelineWin("superseded", operationId);
        return supersededResult(operationId);
      }
      const msg = PIPELINE_ERROR_MESSAGES.printable;
      finalizeOperation(operationId, "error", {
        error: { message: msg, stage: "printable", code: "pipeline-printable" },
        progressMessage: msg,
      });
      announce(msg, "assertive");
      showError(msg);
      return errorResult(operationId);
    }
    recordPipelineWin("printability", operationId);

    if (runCleanup) {
      transitionTo("preparing-fix", {
        progressMessage: changeType === "nozzle-change"
          ? messages.preparingFix
          : "Preparing printable version…",
      });
      setStageProgress(NOZZLE_PIPELINE_STAGES, 2);

      const fixResult = await regeneratePrintableDesign({ runCleanup: true });
      if (!isCurrentOperation(operationId)) {
        recordPipelineWin("superseded", operationId);
        return supersededResult(operationId);
      }
      if (!fixResult.ok) {
        if (fixResult.superseded) {
          recordPipelineWin("superseded", operationId);
          return supersededResult(operationId);
        }
        const msg = PIPELINE_ERROR_MESSAGES.printable;
        finalizeOperation(operationId, "error", {
          error: { message: msg, stage: "printable", code: "pipeline-fix" },
          progressMessage: msg,
        });
        announce(msg, "assertive");
        showError(msg);
        return errorResult(operationId);
      }
      recordPipelineWin("fix", operationId);
    }

    setStageProgress(NOZZLE_PIPELINE_STAGES, 3, { completed: true });
    const duration = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;

    finalizeOperation(operationId, "waiting-for-review", {
      completedOperationId: operationId,
      needsReview: true,
      progressMessage: changeType === "nozzle-change"
        ? messages.review
        : "Review the updated design before downloading",
      error: null,
      reason: String(changeType),
    });

    const doneMsg = changeType === "nozzle-change"
      ? messages.updated
      : "Printable version updated";
    announce(`${doneMsg}. ${getRuntimeWorkflow().progressMessage}`, "polite");
    showNotice(doneMsg);
    recordPipelineWin("printability", operationId, duration);
    void changeRequiresReapproval(changeType);
    return successResult(operationId);
  } catch (err) {
    if (!isCurrentOperation(operationId)) {
      recordPipelineWin("superseded", operationId);
      return supersededResult(operationId);
    }
    const msg = PIPELINE_ERROR_MESSAGES.generic;
    finalizeOperation(operationId, "error", {
      error: {
        message: msg,
        stage: "generic",
        code: err instanceof Error ? err.message : String(err),
      },
      progressMessage: msg,
    });
    announce(msg, "assertive");
    showError(msg);
    return errorResult(operationId);
  } finally {
    if (isCurrentOperation(operationId)) {
      const st = normalizeWorkflowStatus(getRuntimeWorkflow().pipelineStatus);
      if (isColorPrintableBusy(st)) {
        finalizeOperation(operationId, "error", {
          error: {
            message: PIPELINE_ERROR_MESSAGES.generic,
            stage: "generic",
            code: "pipeline-incomplete",
          },
          progressMessage: PIPELINE_ERROR_MESSAGES.generic,
        });
      }
    }
    clearWatchdog();
  }
}

/**
 * User-triggered Update design after crop commit.
 * @returns {Promise<OperationResult>}
 */
export async function runUpdateDesignPipeline() {
  return runDependentProcessingPipeline("update-design", { stayOnStage: true });
}

/**
 * After approval, build the model when geometry is missing/stale.
 * Exactly one in-flight build; safe to call from Download entry.
 * @returns {Promise<OperationResult>}
 */
export async function ensureModelAfterApproval() {
  if (!isPrintabilityExportReady()) {
    return errorResult(getRuntimeWorkflow().requestedOperationId);
  }
  const st = normalizeWorkflowStatus(getRuntimeWorkflow().pipelineStatus);
  if (isColorPrintableBusy(st)) {
    return errorResult(getRuntimeWorkflow().requestedOperationId);
  }
  if (modelBuildInFlight || st === "building-model" || st === "validating-model") {
    return successResult(getRuntimeWorkflow().requestedOperationId);
  }
  if (isGeometryDownloadReady() && !isQuantizationStale()) {
    const rg = getRuntimeGeometry();
    if (rg.status === "ready") {
      if (st !== "model-ready") {
        transitionTo("model-ready", {
          progressMessage: null,
          needsReview: false,
        }, { force: true });
      }
      return successResult(getRuntimeWorkflow().requestedOperationId);
    }
  }
  // Ensure approved status before build when coming from waiting/idle.
  if (st === "waiting-for-review" || st === "idle" || st === "error") {
    if (isPrintabilityExportReady()) {
      transitionTo("approved", {
        needsReview: false,
        progressMessage: null,
      }, { force: true });
    }
  }
  return regenerateModel();
}

/**
 * Retry last failed pipeline based on reason.
 * @returns {Promise<OperationResult>}
 */
export async function retryCurrentPipeline() {
  const wf = getRuntimeWorkflow();
  const reason = wf.reason || "nozzle-change";
  if (reason === "model-build" || reason === "relief") {
    return ensureModelAfterApproval();
  }
  return runDependentProcessingPipeline(reason, { stayOnStage: true });
}

/**
 * Snapshot helpers for tests / UI.
 */
export function getPipelineStatusLabel() {
  return labelForPipelineStatus(getRuntimeWorkflow().pipelineStatus);
}

/**
 * Whether export should be blocked for current settings.
 * @returns {boolean}
 */
export function isExportBlockedByWorkflow() {
  const wf = getRuntimeWorkflow();
  const st = normalizeWorkflowStatus(wf.pipelineStatus);
  if (isExportBusy(st)) return true;
  if (wf.needsReview) return true;
  if (wf.cropNeedsUpdate) return true;
  if (isQuantizationStale()) return true;
  if (!isPrintabilityExportReady()) return true;
  return false;
}

/**
 * Whether model generation may start (approval boundary).
 * @returns {boolean}
 */
export function canStartModelBuild() {
  const st = normalizeWorkflowStatus(getRuntimeWorkflow().pipelineStatus);
  if (isColorPrintableBusy(st)) return false;
  if (!isPrintabilityExportReady()) return false;
  if (getRuntimeWorkflow().needsReview) return false;
  return st === "approved" || st === "model-ready" || st === "idle" || st === "error"
    || st === "building-model" || st === "validating-model";
}

export {
  determineAffectedStages,
  shouldAutoRunColorPrintablePipeline,
  changeRequiresReapproval,
  PIPELINE_STATUS_LABELS,
  NOZZLE_PIPELINE_STAGES,
  MODEL_BUILD_STAGES,
  isColorPrintableBusy,
  isExportBusy,
  normalizeWorkflowStatus,
};
