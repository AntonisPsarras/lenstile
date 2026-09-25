/**
 * Export-step controller: readiness, mesh generation, STL / 3MF downloads.
 */

import {
  FEATURES,
  GEOMETRY_ALGORITHM_VERSION,
  DEFAULT_BASE_COLOR,
} from "../config.js";
import {
  getState,
  getRuntimeQuantization,
  getRuntimePrintability,
  getRuntimeGeometry,
  getRuntimeThreeMf,
  getRuntimeWorkflow,
  isPrintabilityExportReady,
  isGeometryDownloadReady,
  isGeometryStale,
  getExportReadinessGaps,
  beginGeometryRequest,
  acceptGeometryResult,
  acceptGeometryError,
  beginThreeMfPackage,
  acceptThreeMfPackage,
  acceptThreeMfError,
  clearRuntimeThreeMf,
  patchExport,
  normalizeBaseColor,
} from "../state.js";
import {
  nextMeshRequestId,
  requestMeshGenerate,
} from "../workers/mesh-worker-client.js";
import {
  MeshWorkerMessageType,
  deserializePackedMesh,
} from "../workers/mesh-worker-protocol.js";
import { writeBinaryStl, binaryStlToBlob } from "../export/binary-stl.js";
import { downloadBlob } from "../export/download.js";
import {
  combinedStlFilename,
  baseStlFilename,
  colorStlFilename,
  rgbToFilenameHex,
  sanitizeFilenameBase,
} from "../export/stl-filenames.js";
import {
  packageMulticolorThreeMf,
  createPackagingError,
  normalizePackagingError,
  formatThreeMfTechnicalDetails,
  buildThreeMfDiagnosticsJson,
  THREE_MF_USER_ERROR,
  ThreeMfPackagingStage,
  ThreeMfPackagingErrorCode,
  expectedThreeMfObjectCount,
  staleExpectedObjectCountWithoutParent,
} from "../export/three-mf-packaging.js";
import { describeUsedColors } from "../geometry/generate-geometry.js";
import { GeometryErrorCode, createGeometryError } from "../geometry/geometry-errors.js";
import {
  buildGeometryDebugFixture,
  stringifyGeometryDebugFixture,
} from "../geometry/geometry-debug-fixture.js";
import {
  plainGeometryFailureMessage,
} from "../geometry/mesh-validation.js";
import { showError, showNotice } from "./notifications.js";
import { buildPaletteEntries } from "../image/palette.js";

/** @type {Promise<void> | null} */
let threeMfPackagingInFlight = null;

/** Last packaging diagnostics (success or failure); never includes image/indices. */
let lastThreeMfDiagnostics = null;

/**
 * True on localhost; enables local packaging diagnostics UI.
 * @returns {boolean}
 */
export function isThreeMfDevDiagnosticsEnabled() {
  if (typeof location === "undefined") return false;
  const host = location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * @returns {{
 *   imageLoaded: boolean,
 *   quantizationCurrent: boolean,
 *   cleanupAccepted: boolean,
 *   cleanupCurrent: boolean,
 *   geometryValid: boolean,
 *   gaps: string[],
 *   canGenerate: boolean,
 *   canDownload: boolean,
 *   usedArtworkColorCount: number,
 *   canDownloadThreeMf: boolean,
 *   threeMfHint: string | null,
 * }}
 */
export function getExportReadiness() {
  const s = getState();
  const rq = getRuntimeQuantization();
  const rp = getRuntimePrintability();
  const rg = getRuntimeGeometry();
  const wf = getRuntimeWorkflow();
  const gaps = getExportReadinessGaps(s, rq, rp);
  const cleanupAccepted = Boolean(rp.accepted || s.printability.accepted);
  const cleanupCurrent = cleanupAccepted && isPrintabilityExportReady(s, rp);
  const status = wf.pipelineStatus;
  // Color/printability busy always blocks downloads. Model build blocks downloads
  // but must NOT block canGenerate for the in-flight build (7.4.1 deadlock fix).
  const colorPrintableBusy = status === "updating-colors"
    || status === "analyzing-printability"
    || status === "preparing-fix"
    || status === "preparing-printable";
  const modelBusy = status === "building-model"
    || status === "validating-model"
    || status === "creating-3mf";
  const workflowBusy = colorPrintableBusy || modelBusy;
  const workflowBlocksExport = workflowBusy
    || wf.needsReview
    || wf.cropNeedsUpdate;
  const canDownload = isGeometryDownloadReady(s, rg)
    && FEATURES.stlExport
    && !workflowBlocksExport;
  const usedArtworkColorCount = rg.colors ? rg.colors.length : 0;
  let threeMfHint = null;
  let canDownloadThreeMf = false;
  if (!FEATURES.threeMfExport) {
    threeMfHint = "Multicolor 3MF is not enabled.";
  } else if (workflowBlocksExport) {
    threeMfHint = wf.needsReview
      ? "Review and approve the updated design before downloading."
      : "Wait for the design update to finish before downloading.";
  } else if (!canDownload) {
    threeMfHint = "Build a valid printable model before downloading a multicolor file.";
  } else if (usedArtworkColorCount < 2) {
    threeMfHint = "With one artwork color, use the one-color STL. A multicolor file is unnecessary.";
  } else if (rg.validation && rg.validation.ok === false) {
    threeMfHint = "Fix model validation issues before downloading a multicolor file.";
  } else if (!(rg.backing || rg.roof)) {
    threeMfHint = "Magnet-backing geometry is required for multicolor export. Rebuild the model.";
  } else {
    canDownloadThreeMf = true;
  }
  return {
    imageLoaded: Boolean(s.sourceImage.fileName),
    quantizationCurrent: Boolean(rq.indices) && rq.status === "ready" && rq.resultSourceRevision === s.sourceRevision,
    cleanupAccepted,
    cleanupCurrent,
    geometryValid: isGeometryDownloadReady(s, rg),
    gaps,
    // Generation is gated by approval + revisions, not by building-model status
    // (regenerateModel sets building-model before calling generateModelAction).
    canGenerate: isPrintabilityExportReady(s, rp)
      && FEATURES.stlExport
      && !wf.needsReview
      && !wf.cropNeedsUpdate
      && !colorPrintableBusy,
    canDownload,
    usedArtworkColorCount,
    canDownloadThreeMf,
    threeMfHint,
    workflowBlocksExport,
    needsReview: Boolean(wf.needsReview),
  };
}

/**
 * Stable key for 3MF packaging inputs that do not rebuild geometry.
 * @returns {string}
 */
export function getThreeMfPackageKey() {
  const s = getState();
  const colors = getEffectiveExportColors();
  const base = normalizeBaseColor(s.export.baseColor || DEFAULT_BASE_COLOR);
  const colorKey = colors.map((c) => `${c.paletteIndex}:${rgbToFilenameHex(c.r, c.g, c.b)}`).join(",");
  return [
    s.geometryRevision,
    s.surface.style,
    `${base.r},${base.g},${base.b}`,
    colorKey,
    s.project.name || "",
  ].join("|");
}

/**
 * Effective palette colors for filename / UI (overrides applied).
 */
export function getEffectiveExportColors() {
  const s = getState();
  const rq = getRuntimeQuantization();
  const rp = getRuntimePrintability();
  if (!rp.cleanedIndices || !rq.generatedPalette.length) return [];
  const entries = buildPaletteEntries(rq.generatedPalette, s.quantization.paletteOverrides);
  const effective = entries.map((e) => e.override || e.generated);
  return describeUsedColors(rp.cleanedIndices, effective);
}

/**
 * Run mesh generation for the accepted cleaned design.
 * @param {{ quiet?: boolean, allowWhileBuilding?: boolean, operationId?: number }} [opts]
 * @returns {Promise<{ ok: boolean, superseded?: boolean, status?: "success"|"error"|"superseded" }>}
 */
export async function generateModelAction(opts = {}) {
  const quiet = Boolean(opts.quiet);
  if (!FEATURES.stlExport) {
    if (!quiet) showError("STL export is not enabled.");
    return { ok: false, status: "error" };
  }
  const readiness = getExportReadiness();
  if (!readiness.canGenerate) {
    const gaps = readiness.gaps.length
      ? readiness.gaps.join(" ")
      : "Check and approve the printable design first.";
    if (!quiet) showError(gaps);
    return { ok: false, status: "error" };
  }

  const s = getState();
  const rp = getRuntimePrintability();
  const requestId = nextMeshRequestId();
  const sourceRevision = s.sourceRevision;
  const printabilityRevision = s.printabilityRevision;
  const geometryRevision = s.geometryRevision;

  beginGeometryRequest(requestId);

  try {
    const indicesCopy = new Uint8Array(rp.cleanedIndices);
    const rq = getRuntimeQuantization();
    const entries = buildPaletteEntries(rq.generatedPalette, s.quantization.paletteOverrides);
    /** @type {Array<{ r: number, g: number, b: number }>} */
    const effectivePalette = [];
    for (const e of entries) {
      const c = e.override || e.generated;
      effectivePalette.push({ r: c.r, g: c.g, b: c.b });
    }
    const response = await requestMeshGenerate({
      requestId,
      sourceRevision,
      printabilityRevision,
      geometryRevision,
      width: rp.width,
      height: rp.height,
      cleanedIndicesBuffer: indicesCopy.buffer,
      surfaceStyle: s.surface.style,
      reliefStrengthId: s.surface.reliefStrengthId,
      heightOrder: s.surface.heightOrder,
      colorHeightLevels: s.surface.colorHeightLevels,
      effectivePalette,
    });

    if (response.type === MeshWorkerMessageType.GENERATE_ERROR) {
      const accepted = acceptGeometryError({
        requestId,
        sourceRevision,
        printabilityRevision,
        geometryRevision,
        error: response.error || createGeometryError(
          GeometryErrorCode.INTERNAL,
          "Mesh generation failed.",
        ),
      });
      if (accepted && !quiet) {
        showError(response.error?.message || "The model could not be built.");
      }
      return { ok: false, status: "error" };
    }

    const resultPayload = response.result;
    const combined = deserializePackedMesh(resultPayload.combined);
    const base = deserializePackedMesh(resultPayload.base);
    const backing = resultPayload.backing
      ? deserializePackedMesh(resultPayload.backing)
      : (resultPayload.roof ? deserializePackedMesh(resultPayload.roof) : null);
    const backingCellCount = resultPayload.backingCellCount
      ?? resultPayload.keepoutCellCount
      ?? 0;
    const colors = (resultPayload.colors || []).map((c) => ({
      paletteIndex: c.paletteIndex,
      population: c.population,
      mesh: deserializePackedMesh(c.mesh),
    }));

    const accepted = acceptGeometryResult({
      requestId,
      sourceRevision,
      printabilityRevision,
      geometryRevision,
      result: {
        ok: resultPayload.ok,
        reasons: resultPayload.reasons || [],
        userMessage: resultPayload.userMessage || null,
        algorithmVersion: resultPayload.algorithmVersion ?? GEOMETRY_ALGORITHM_VERSION,
        validation: resultPayload.validation,
        combined,
        base,
        backing,
        roof: backing,
        backingCellCount,
        keepoutCellCount: backingCellCount,
        colors,
      },
    });

    if (!accepted) {
      if (!quiet) showNotice("Result ignored because your design changed.");
      return { ok: false, superseded: true, status: "superseded" };
    }

    if (!resultPayload.ok) {
      const userMessage = resultPayload.userMessage
        || plainGeometryFailureMessage(resultPayload.reasons || []);
      if (!quiet) showError(userMessage);
      return { ok: false, status: "error" };
    }

    if (!quiet) showNotice("Model ready");
    return { ok: true, status: "success" };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    acceptGeometryError({
      requestId,
      sourceRevision,
      printabilityRevision,
      geometryRevision,
      error: createGeometryError(GeometryErrorCode.INTERNAL, message),
    });
    if (!quiet) showError("The model could not be built.");
    return { ok: false, status: "error" };
  }
}

/**
 * @param {"combined" | "base" | number} target  number = paletteIndex
 */
export function downloadStlAction(target) {
  const s = getState();
  const rg = getRuntimeGeometry();
  if (!isGeometryDownloadReady(s, rg) || isGeometryStale(s, rg)) {
    showError("Build the printable model before downloading.");
    return;
  }

  const name = s.project.name;
  try {
    if (target === "combined") {
      const relief = s.surface.style === "relief";
      const buffer = writeBinaryStl(rg.combined, {
        header: relief
          ? "LensTile relief Tile V1"
          : "LensTile combined Tile V1",
      });
      downloadBlob(binaryStlToBlob(buffer), combinedStlFilename(name, { relief }));
      showNotice("STL downloaded");
      return;
    }
    if (target === "base") {
      const buffer = writeBinaryStl(rg.base, {
        header: "LensTile Tile V1 base",
      });
      downloadBlob(binaryStlToBlob(buffer), baseStlFilename(name));
      showNotice("STL downloaded");
      return;
    }
    if (typeof target === "number") {
      const entry = rg.colors.find((c) => c.paletteIndex === target);
      if (!entry) {
        showError(`No mesh for color ${target}.`);
        return;
      }
      const colors = getEffectiveExportColors();
      const meta = colors.find((c) => c.paletteIndex === target);
      const ordinal = colors.findIndex((c) => c.paletteIndex === target) + 1;
      const buffer = writeBinaryStl(entry.mesh, {
        header: `LensTile color ${ordinal}`,
      });
      downloadBlob(
        binaryStlToBlob(buffer),
        colorStlFilename(name, ordinal, meta || { r: 0, g: 0, b: 0 }),
      );
      showNotice("STL downloaded");
      return;
    }
    showError("Unknown download target.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showError(message);
  }
}

/**
 * Download every artwork color STL (individual files; no ZIP of STLs).
 */
export function downloadAllColorStlsAction() {
  const rg = getRuntimeGeometry();
  if (!isGeometryDownloadReady()) {
    showError("Build the printable model before downloading.");
    return;
  }
  for (const c of rg.colors) {
    downloadStlAction(c.paletteIndex);
  }
}

/**
 * @returns {object | null}
 */
export function getLastThreeMfDiagnostics() {
  return lastThreeMfDiagnostics;
}

/**
 * Technical details text for the last 3MF packaging error (if any).
 * @returns {string}
 */
export function getThreeMfTechnicalDetailsText() {
  const r3 = getRuntimeThreeMf();
  if (r3.status !== "error" || !r3.error) return "";
  const normalized = normalizePackagingError({
    code: r3.error.code,
    stage: (r3.error.details && r3.error.details.stage) || ThreeMfPackagingStage.VALIDATE_MODEL_XML,
    message: (r3.error.details && r3.error.details.underlyingMessage) || r3.error.message,
    details: r3.error.details,
    causeName: r3.error.details && r3.error.details.causeName,
    causeMessage: r3.error.details && r3.error.details.causeMessage,
  });
  // Prefer structured fields stored on acceptThreeMfError.
  if (r3.error.details && r3.error.details.stage) {
    return formatThreeMfTechnicalDetails({
      code: r3.error.code,
      stage: r3.error.details.stage,
      message: r3.error.details.underlyingMessage || r3.error.message,
      details: r3.error.details,
      causeName: r3.error.details.causeName || null,
      causeMessage: r3.error.details.causeMessage || null,
    });
  }
  return formatThreeMfTechnicalDetails(normalized);
}

/**
 * Download packaging diagnostics JSON (Technical details).
 */
export function downloadThreeMfDiagnosticsAction() {
  const payload = lastThreeMfDiagnostics || buildThreeMfDiagnosticsJson({
    error: {
      code: ThreeMfPackagingErrorCode.PACKAGE_FAILED,
      stage: ThreeMfPackagingStage.PREPARE_INPUTS,
      message: "No packaging diagnostics are available yet.",
      details: null,
      causeName: null,
      causeMessage: null,
    },
  });
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  const blob = new Blob([text], { type: "application/json" });
  const s = getState();
  const safeName = sanitizeFilenameBase(s.project.name);
  downloadBlob(blob, `${safeName}-3mf-diagnostics.json`);
  showNotice("3MF diagnostics downloaded");
}

/**
 * Build colorMeshes for packaging from current runtime geometry (shared by Download).
 * @returns {Array<{ paletteIndex: number, mesh: import("../geometry/mesh.js").Mesh, color: { r: number, g: number, b: number } }>}
 */
export function buildExportColorMeshes() {
  const rg = getRuntimeGeometry();
  const effectiveColors = getEffectiveExportColors();
  /** @type {Map<number, { r: number, g: number, b: number }>} */
  const colorByIndex = new Map(
    effectiveColors.map((c) => [c.paletteIndex, { r: c.r, g: c.g, b: c.b }]),
  );
  return rg.colors.map((entry) => {
    const color = colorByIndex.get(entry.paletteIndex);
    if (!color) {
      throw createPackagingErrorFromMessage(
        `Missing effective color for palette index ${entry.paletteIndex}.`,
        ThreeMfPackagingStage.PREPARE_INPUTS,
      );
    }
    if (!entry.mesh || entry.mesh.triangles.length < 3) {
      throw createPackagingErrorFromMessage(
        `Empty artwork mesh for palette index ${entry.paletteIndex}.`,
        ThreeMfPackagingStage.VALIDATE_MESHES,
      );
    }
    return {
      paletteIndex: entry.paletteIndex,
      mesh: entry.mesh,
      color,
    };
  });
}

/**
 * @param {string} message
 * @param {string} stage
 */
function createPackagingErrorFromMessage(message, stage) {
  const err = new Error(message);
  /** @type {any} */
  const wrapped = err;
  wrapped.code = ThreeMfPackagingErrorCode.INVALID_INPUT;
  wrapped.stage = stage;
  wrapped.details = null;
  wrapped.causeName = "Error";
  wrapped.causeMessage = message;
  wrapped.name = "ThreeMfPackagingError";
  return wrapped;
}

/**
 * Lazily build and download a multicolor 3MF from current validated meshes.
 * Uses the staged packaging path (Milestone 7.2). Concurrent clicks share one operation.
 * @returns {Promise<void>}
 */
export function downloadThreeMfAction() {
  if (threeMfPackagingInFlight) {
    return threeMfPackagingInFlight;
  }

  threeMfPackagingInFlight = (async () => {
    try {
      const readiness = getExportReadiness();
      if (!readiness.canDownloadThreeMf) {
        showError(readiness.threeMfHint || "Multicolor download is not available.");
        return;
      }

      const s = getState();
      const packageKey = getThreeMfPackageKey();
      const cached = getRuntimeThreeMf();
      if (
        cached.status === "ready"
        && cached.bytes
        && cached.packageKey === packageKey
        && cached.resultGeometryRevision === s.geometryRevision
      ) {
        downloadBlob(
          new Blob([cached.bytes], { type: "model/3mf" }),
          cached.filename || "tile-multicolor.3mf",
        );
        showNotice("Multicolor file downloaded");
        return;
      }

      await runThreeMfPackaging({
        packageKey,
        geometryRevision: s.geometryRevision,
      });
    } finally {
      threeMfPackagingInFlight = null;
    }
  })();

  return threeMfPackagingInFlight;
}


/**
 * @param {{ packageKey: string, geometryRevision: number, useStaleObjectCount?: boolean }} opts
 */
async function runThreeMfPackaging(opts) {
  const s = getState();
  const rg = getRuntimeGeometry();

  // Clear stale package bytes; keep geometry/STL intact.
  beginThreeMfPackage();

  try {
    const colorMeshes = buildExportColorMeshes();
    const backingMesh = rg.backing || rg.roof;
    if (!backingMesh) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.INVALID_INPUT,
        stage: ThreeMfPackagingStage.PREPARE_INPUTS,
        message: "Magnet-backing mesh is missing from the built model.",
      });
    }
    const packaged = packageMulticolorThreeMf({
      projectName: s.project.name,
      baseMesh: rg.base,
      backingMesh,
      colorMeshes,
      baseColor: normalizeBaseColor(s.export.baseColor || DEFAULT_BASE_COLOR),
      effectivePalette: getEffectiveExportColors(),
      surfaceStyle: s.surface.style,
      geometryVersion: rg.algorithmVersion,
    }, {
      useStaleObjectCount: Boolean(opts.useStaleObjectCount),
    });

    lastThreeMfDiagnostics = buildThreeMfDiagnosticsJson({
      ...packaged.diagnostics,
      filename: packaged.filename,
      surfaceStyle: s.surface.style,
      packageKey: opts.packageKey,
      stagesCompleted: [
        ...packaged.stagesCompleted,
        ThreeMfPackagingStage.INITIATE_DOWNLOAD,
      ],
    });

    acceptThreeMfPackage({
      bytes: packaged.bytes,
      filename: packaged.filename,
      manifest: packaged.manifest,
      packageKey: opts.packageKey,
      geometryRevision: opts.geometryRevision,
      diagnostics: lastThreeMfDiagnostics,
    });

    downloadBlob(packaged.blob, packaged.filename);
    showNotice("Multicolor file downloaded");
  } catch (err) {
    const normalized = normalizePackagingError(err);
    if (isThreeMfDevDiagnosticsEnabled() && typeof console !== "undefined") {
      console.error("[3MF packaging]", normalized, err instanceof Error ? err.stack : err);
    }
    lastThreeMfDiagnostics = buildThreeMfDiagnosticsJson({
      stagesCompleted: (err && err.details && err.details.stagesCompleted) || [],
      error: normalized,
      xmlByteLength: normalized.details && normalized.details.xmlByteLength,
      zipByteLength: normalized.details && normalized.details.zipByteLength,
      totalVertices: normalized.details && normalized.details.totalVertices,
      totalTriangles: normalized.details && normalized.details.totalTriangles,
      objectCount: normalized.details && normalized.details.objectCount,
      packageKey: opts.packageKey,
      surfaceStyle: s.surface.style,
    });
    acceptThreeMfError({
      code: normalized.code,
      message: THREE_MF_USER_ERROR,
      details: {
        stage: normalized.stage,
        underlyingMessage: normalized.message,
        causeName: normalized.causeName,
        causeMessage: normalized.causeMessage,
        ...((normalized.details && typeof normalized.details === "object")
          ? normalized.details
          : {}),
      },
    });
    // Keep STL downloads available — do not clear geometry.
    showError(THREE_MF_USER_ERROR);
  }
}

/**
 * Test-only: run packaging with the pre-7.2 stale object-count expectation.
 * @param {{ packageKey?: string, geometryRevision?: number }} [opts]
 */
export async function downloadThreeMfActionWithStaleObjectCount(opts = {}) {
  const s = getState();
  return runThreeMfPackaging({
    packageKey: opts.packageKey || getThreeMfPackageKey(),
    geometryRevision: opts.geometryRevision ?? s.geometryRevision,
    useStaleObjectCount: true,
  });
}

export {
  expectedThreeMfObjectCount,
  staleExpectedObjectCountWithoutParent,
  ThreeMfPackagingStage,
  ThreeMfPackagingErrorCode,
  THREE_MF_USER_ERROR,
  formatThreeMfTechnicalDetails,
  packageMulticolorThreeMf,
};


/**
 * Update structural base color for 3MF metadata (does not rebuild geometry).
 * @param {{ r: number, g: number, b: number } | string} color
 */
export function setBaseColorAction(color) {
  let rgb;
  if (typeof color === "string") {
    const hex = color.replace("#", "").trim();
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
      showError("Base color must be a six-digit hex value.");
      return;
    }
    rgb = {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  } else {
    rgb = color;
  }
  patchExport({ baseColor: rgb });
  clearRuntimeThreeMf();
}

/**
 * Download a local JSON fixture that reproduces mesh generation for the
 * currently accepted cleaned design. Technical details only.
 * Does not include the source image and never uploads.
 */
export function downloadGeometryDebugCaseAction() {
  const s = getState();
  const rq = getRuntimeQuantization();
  const rp = getRuntimePrintability();
  const rg = getRuntimeGeometry();
  if (!rp.cleanedIndices || !rp.width || !rp.height) {
    showError("Approve a printable design before downloading a geometry debug case.");
    return;
  }
  if (!isPrintabilityExportReady(s, rp)) {
    showError("The printable design needs updating before a debug case can be saved.");
    return;
  }

  const entries = buildPaletteEntries(rq.generatedPalette, s.quantization.paletteOverrides);
  /** @type {Array<{ r: number, g: number, b: number }>} */
  const generatedPalette = rq.generatedPalette.map((c) => ({ r: c.r, g: c.g, b: c.b }));
  /** @type {Array<{ r: number, g: number, b: number }>} */
  const effectivePalette = entries.map((e) => {
    const c = e.override || e.generated;
    return { r: c.r, g: c.g, b: c.b };
  });

  let expectedFailingObject = null;
  if (rg.reasons && rg.reasons.length) {
    const match = String(rg.reasons[0]).match(/color\[\d+\]|combined|base/);
    if (match) expectedFailingObject = match[0];
  }

  try {
    const fixture = buildGeometryDebugFixture({
      cleanedIndices: rp.cleanedIndices,
      width: rp.width,
      height: rp.height,
      surfaceStyle: s.surface.style,
      reliefStrengthId: s.surface.reliefStrengthId,
      heightOrder: s.surface.heightOrder,
      colorHeightLevels: s.surface.colorHeightLevels,
      generatedPalette,
      effectivePalette,
      sourceRevision: s.sourceRevision,
      printabilityRevision: s.printabilityRevision,
      geometryRevision: s.geometryRevision,
      expectedFailingObject,
      geometryAlgorithmVersion: GEOMETRY_ALGORITHM_VERSION,
    });
    const text = stringifyGeometryDebugFixture(fixture);
    const blob = new Blob([text], { type: "application/json" });
    const safeName = sanitizeFilenameBase(s.project.name);
    downloadBlob(blob, `${safeName}-geometry-debug.json`);
    showNotice("Geometry debug case downloaded");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showError(message);
  }
}

/**
 * Geometry status label for the Download panel.
 */
export function getGeometryStatusLabel() {
  const rg = getRuntimeGeometry();
  if (rg.status === "processing") return "Building model…";
  if (rg.status === "ready" && isGeometryDownloadReady()) {
    const tris = rg.combined ? rg.combined.triangles.length / 3 : 0;
    const n = rg.colors.length;
    const partLabel = n === 1 ? "1 color part" : `${n} color parts`;
    return `Model ready — ${tris} triangles, ${partLabel}.`;
  }
  if (rg.status === "ready" && isGeometryStale()) {
    return "Needs updating — rebuild the model.";
  }
  if (rg.status === "error") {
    return rg.error?.message || "The model could not be built.";
  }
  if (rg.status === "stale") {
    return "Needs updating — rebuild the model.";
  }
  return "Model not built yet.";
}

/**
 * Summary text for the multicolor 3MF download area.
 */
export function getThreeMfStatusLabel() {
  const readiness = getExportReadiness();
  const s = getState();
  const r3 = getRuntimeThreeMf();
  const base = normalizeBaseColor(s.export.baseColor || DEFAULT_BASE_COLOR);
  const baseHex = rgbToFilenameHex(base.r, base.g, base.b);
  if (r3.status === "processing") return "Creating multicolor file…";
  if (r3.status === "error") {
    return r3.error?.message || "The multicolor file could not be created.";
  }
  if (!readiness.canDownloadThreeMf) {
    return readiness.threeMfHint || "Multicolor download is not available.";
  }
  const styleLabel = s.surface.style === "relief" ? "Relief" : "Flat";
  const n = readiness.usedArtworkColorCount;
  const colorParts = n === 1 ? "1 color part" : `${n} color parts`;
  let sizePart = "";
  if (r3.status === "ready" && r3.manifest && r3.manifest.byteLength) {
    const kb = Math.max(1, Math.round(r3.manifest.byteLength / 1024));
    sizePart = ` · about ${kb} KB`;
  }
  return `One tile assembly (base + ${colorParts}) · ${styleLabel} · base #${baseHex}${sizePart}`;
}
