/**
 * Centralized application state (immutable-style updates).
 * Runtime-only data (bitmaps, index buffers, worker handles) lives outside
 * serializable project snapshots.
 */

import { createTileStateSlice } from "./geometry/tile-spec.js";
import { AppEvents, emit } from "./events.js";
import {
  QUANTIZE_ALGORITHM_VERSION,
  CLEANUP_ALGORITHM_VERSION,
  GEOMETRY_ALGORITHM_VERSION,
  STEPS,
  DEFAULT_DETAIL_PROFILE_ID,
  DEFAULT_PRINT_PROFILE_ID,
  DETAIL_PROFILES_VERSION,
  PRINT_PROFILES_VERSION,
  normalizeDetailProfileId,
  normalizePrintProfileId,
  getProcessingPixelsPerMm,
  getProcessingPixelSizeMm,
  getDerivedPrintSettings,
  resolvePrintProfile,
  createSurfaceStateSlice,
  migrateSurfaceSettings,
  normalizeSurfaceStyleId,
  normalizeHeightOrderId,
  normalizeReliefStrengthId,
  DEFAULT_BASE_COLOR,
} from "./config.js";
import { PrintabilityStatus, createEmptyReport } from "./image/printability.js";

/**
 * @typedef {object} AppState
 * @property {{ name: string, version: number }} project
 * @property {ReturnType<typeof createTileStateSlice>} tile
 * @property {{ fileName: string | null, mimeType: string | null, widthPx: number, heightPx: number }} sourceImage
 * @property {{ offsetX: number, offsetY: number, scale: number, rotationDeg: number, flipX: boolean, flipY: boolean }} transform
 * @property {{
 *   colorCount: number,
 *   detailProfileId: string,
 *   transparencyMode: "white" | "black" | "custom",
 *   customBackground: { r: number, g: number, b: number },
 *   paletteOverrides: Array<{ r: number, g: number, b: number } | null>,
 *   algorithmVersion: number,
 *   smoothing: number
 * }} quantization
 * @property {{
 *   profileId: string,
 *   accepted: boolean,
 *   cleanupAlgorithmVersion: number | null,
 *   comparisonMode: "quantized" | "issues" | "cleaned" | "side-by-side",
 * }} printability
 * @property {number} printabilityRevision
 * @property {{
 *   mode: string,
 *   artworkHeightMm: number,
 *   algorithmVersion: number | null,
 *   generated: boolean,
 *   baseColor: { r: number, g: number, b: number },
 * }} export
 * @property {{
 *   style: "flat" | "relief",
 *   reliefStrengthId: "subtle" | "standard" | "bold",
 *   heightOrder: "darkest-highest" | "lightest-highest" | "custom",
 *   colorHeightLevels: Array<{ paletteIndex: number, levelIndex: number }>
 * }} surface
 * @property {number} geometryRevision
 * @property {{ activeStep: string, isProcessing: boolean, error: string | null, notice: string | null }} ui
 * @property {number} sourceRevision
 */

/**
 * Runtime-only multicolor 3MF package cache (never serialized).
 * @typedef {object} RuntimeThreeMf
 * @property {"idle" | "processing" | "ready" | "error"} status
 * @property {Uint8Array | null} bytes
 * @property {string | null} filename
 * @property {object | null} manifest
 * @property {number | null} resultGeometryRevision
 * @property {string | null} packageKey
 * @property {{ code: string, message: string, details?: unknown } | null} error
 * @property {object | null} [diagnostics]
 */

/**
 * @typedef {object} RuntimeQuantization
 * @property {"idle" | "processing" | "ready" | "error"} status
 * @property {string | null} activeRequestId
 * @property {number} width
 * @property {number} height
 * @property {Array<{ r: number, g: number, b: number, population: number }>} generatedPalette
 * @property {Uint8Array | null} indices
 * @property {Uint8ClampedArray | null} previewRgba
 * @property {number | null} resultSourceRevision
 * @property {number | null} algorithmVersion
 * @property {{ uniqueColorCount: number, iterations: number, durationMs: number } | null} diagnostics
 * @property {{ code: string, message: string, details?: unknown } | null} error
 */

/**
 * @typedef {object} RuntimePrintability
 * @property {string} status
 * @property {string | null} activeRequestId
 * @property {"analyze" | "clean" | null} activeOperation
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array | null} cleanedIndices
 * @property {Uint8Array | null} issueMask
 * @property {import("./image/mask-cleanup.js").PrintabilityReport | null} report
 * @property {boolean} accepted
 * @property {number | null} resultSourceRevision
 * @property {number | null} resultPrintabilityRevision
 * @property {number | null} algorithmVersion
 * @property {{ code: string, message: string, details?: unknown } | null} error
 */

/**
 * @typedef {object} RuntimeGeometry
 * @property {"idle" | "processing" | "ready" | "error" | "stale"} status
 * @property {string | null} activeRequestId
 * @property {number | null} resultGeometryRevision
 * @property {number | null} resultSourceRevision
 * @property {number | null} resultPrintabilityRevision
 * @property {number | null} algorithmVersion
 * @property {import("./geometry/mesh.js").PackedMesh | null} combined
 * @property {import("./geometry/mesh.js").PackedMesh | null} base
 * @property {import("./geometry/mesh.js").PackedMesh | null} backing
 * @property {import("./geometry/mesh.js").PackedMesh | null} roof
 * @property {number} backingCellCount
 * @property {number} keepoutCellCount
 * @property {Array<{
 *   paletteIndex: number,
 *   population: number,
 *   mesh: import("./geometry/mesh.js").PackedMesh
 * }>} colors
 * @property {object | null} validation
 * @property {string[]} reasons
 * @property {{ code: string, message: string, details?: unknown } | null} error
 */

/** Keys in quantization that affect clustering output (bump sourceRevision). */
const QUANTIZATION_SOURCE_KEYS = new Set([
  "colorCount",
  "detailProfileId",
  "transparencyMode",
  "customBackground",
  "algorithmVersion",
  "smoothing",
]);

/** @type {ImageBitmap | HTMLImageElement | null} */
let runtimeBitmap = null;

/** @type {RuntimeQuantization} */
let runtimeQuantization = createEmptyRuntimeQuantization();

/** @type {RuntimePrintability} */
let runtimePrintability = createEmptyRuntimePrintability();

/** @type {RuntimeGeometry} */
let runtimeGeometry = createEmptyRuntimeGeometry();

/** @type {RuntimeThreeMf} */
let runtimeThreeMf = createEmptyRuntimeThreeMf();

/**
 * Runtime-only workflow orchestration (Milestone 7.4.1). Never serialized.
 * @typedef {object} RuntimeWorkflow
 * @property {string} activeStage
 * @property {import("./workflow/workflow-fsm.js").WorkflowState} pipelineStatus
 * @property {string | null} pipelineStep
 * @property {number} requestedOperationId
 * @property {number} completedOperationId
 * @property {string | null} reason
 * @property {string | null} progressMessage
 * @property {number} progressStageIndex
 * @property {number} progressStageTotal
 * @property {string | null} progressStageLabel
 * @property {number} progressPercent
 * @property {boolean} longerThanUsual
 * @property {boolean} canCancel
 * @property {{ code?: string, message: string, stage?: string } | null} error
 * @property {boolean} needsReview
 * @property {boolean} cropNeedsUpdate
 * @property {number | null} approvedSourceRevision
 * @property {number | null} approvedPrintabilityRevision
 */

/** @type {RuntimeWorkflow} */
let runtimeWorkflow = createEmptyRuntimeWorkflow();

/**
 * Live crop transform during pointer drag (preview only — no revision bump).
 * @type {AppState["transform"] | null}
 */
let runtimeLiveTransform = null;

/** @type {AppState} */
let state = createInitialState();

/** @returns {RuntimeWorkflow} */
function createEmptyRuntimeWorkflow() {
  return {
    activeStage: "image",
    pipelineStatus: "idle",
    pipelineStep: null,
    requestedOperationId: 0,
    completedOperationId: 0,
    reason: null,
    progressMessage: null,
    progressStageIndex: 0,
    progressStageTotal: 0,
    progressStageLabel: null,
    progressPercent: 0,
    longerThanUsual: false,
    canCancel: false,
    error: null,
    needsReview: false,
    cropNeedsUpdate: false,
    approvedSourceRevision: null,
    approvedPrintabilityRevision: null,
  };
}

/** @returns {AppState} */
export function createInitialState() {
  return {
    project: {
      name: "lenstile",
      version: 1,
    },
    tile: createTileStateSlice(),
    sourceImage: {
      fileName: null,
      mimeType: null,
      widthPx: 0,
      heightPx: 0,
    },
    transform: {
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
    },
    quantization: {
      colorCount: 4,
      detailProfileId: DEFAULT_DETAIL_PROFILE_ID,
      transparencyMode: "white",
      customBackground: { r: 255, g: 255, b: 255 },
      paletteOverrides: [],
      algorithmVersion: QUANTIZE_ALGORITHM_VERSION,
      smoothing: 0,
    },
    printability: {
      profileId: DEFAULT_PRINT_PROFILE_ID,
      accepted: false,
      cleanupAlgorithmVersion: null,
      comparisonMode: "quantized",
    },
    printabilityRevision: 0,
    export: {
      mode: "single-stl",
      artworkHeightMm: 1.5,
      algorithmVersion: null,
      generated: false,
      baseColor: { ...DEFAULT_BASE_COLOR },
    },
    surface: createSurfaceStateSlice(null),
    geometryRevision: 0,
    ui: {
      activeStep: "image",
      isProcessing: false,
      error: null,
      notice: null,
    },
    sourceRevision: 0,
  };
}

/** @returns {RuntimeQuantization} */
function createEmptyRuntimeQuantization() {
  return {
    status: "idle",
    activeRequestId: null,
    width: 0,
    height: 0,
    generatedPalette: [],
    indices: null,
    previewRgba: null,
    resultSourceRevision: null,
    algorithmVersion: null,
    diagnostics: null,
    error: null,
  };
}

/** @returns {RuntimePrintability} */
function createEmptyRuntimePrintability() {
  return {
    status: PrintabilityStatus.NOT_ANALYZED,
    activeRequestId: null,
    activeOperation: null,
    width: 0,
    height: 0,
    cleanedIndices: null,
    issueMask: null,
    report: null,
    accepted: false,
    resultSourceRevision: null,
    resultPrintabilityRevision: null,
    algorithmVersion: null,
    error: null,
  };
}

/** @returns {RuntimeGeometry} */
function createEmptyRuntimeGeometry() {
  return {
    status: "idle",
    activeRequestId: null,
    resultGeometryRevision: null,
    resultSourceRevision: null,
    resultPrintabilityRevision: null,
    algorithmVersion: null,
    combined: null,
    base: null,
    backing: null,
    roof: null,
    backingCellCount: 0,
    keepoutCellCount: 0,
    colors: [],
    validation: null,
    reasons: [],
    error: null,
  };
}

/** @returns {RuntimeThreeMf} */
function createEmptyRuntimeThreeMf() {
  return {
    status: "idle",
    bytes: null,
    filename: null,
    manifest: null,
    resultGeometryRevision: null,
    packageKey: null,
    error: null,
    diagnostics: null,
  };
}

/** @returns {Readonly<AppState>} */
export function getState() {
  return state;
}

/** @returns {ImageBitmap | HTMLImageElement | null} */
export function getRuntimeBitmap() {
  return runtimeBitmap;
}

/** @returns {Readonly<RuntimeQuantization>} */
export function getRuntimeQuantization() {
  return runtimeQuantization;
}

/** @returns {Readonly<RuntimePrintability>} */
export function getRuntimePrintability() {
  return runtimePrintability;
}

/** @returns {RuntimeGeometry} */
export function getRuntimeGeometry() {
  return runtimeGeometry;
}

/**
 * @returns {RuntimeThreeMf}
 */
export function getRuntimeThreeMf() {
  return runtimeThreeMf;
}

/** @returns {Readonly<RuntimeWorkflow>} */
export function getRuntimeWorkflow() {
  return runtimeWorkflow;
}

/**
 * Effective transform for preview rendering (live drag or committed).
 * @returns {AppState["transform"]}
 */
export function getEffectiveTransform() {
  return runtimeLiveTransform ? { ...runtimeLiveTransform } : { ...state.transform };
}

/** @returns {AppState["transform"] | null} */
export function getLiveTransform() {
  return runtimeLiveTransform ? { ...runtimeLiveTransform } : null;
}

/**
 * Preview-only transform update during drag. Does not bump sourceRevision.
 * @param {AppState["transform"]} transform
 */
export function setLiveTransform(transform) {
  runtimeLiveTransform = { ...transform };
  emit(AppEvents.REDRAW);
}

/** Clear live preview transform without committing. */
export function clearLiveTransform() {
  if (!runtimeLiveTransform) return;
  runtimeLiveTransform = null;
  emit(AppEvents.REDRAW);
}

/**
 * Patch runtime workflow fields and notify UI.
 * @param {Partial<RuntimeWorkflow>} patch
 */
export function patchRuntimeWorkflow(patch) {
  runtimeWorkflow = { ...runtimeWorkflow, ...patch };
  if (patch.activeStage != null) {
    // Keep presentation stage aligned when coordinator sets it.
  }
  emit(AppEvents.WORKFLOW_CHANGED, runtimeWorkflow);
  emit(AppEvents.STATE_CHANGED, state);
}

/**
 * Mark that the crop changed after a prior color preview and needs Update design.
 * @param {boolean} value
 */
export function setCropNeedsUpdate(value) {
  if (runtimeWorkflow.cropNeedsUpdate === value) return;
  runtimeWorkflow = { ...runtimeWorkflow, cropNeedsUpdate: Boolean(value) };
  emit(AppEvents.WORKFLOW_CHANGED, runtimeWorkflow);
  emit(AppEvents.STATE_CHANGED, state);
}

/**
 * Derived pixels-per-millimetre from the active nozzle processing profile.
 * Detail-profile Low/Standard/High is no longer the primary resolution driver
 * (Milestone 7.3.2); nozzle-aware automatic grids are authoritative.
 * @param {AppState} [s]
 * @returns {number}
 */
export function getResolutionPxPerMm(s = state) {
  return getProcessingPixelsPerMm(s.printability.profileId);
}

/**
 * Derived physical pixel size (mm) for the automatic detail grid.
 * @param {AppState} [s]
 * @returns {number}
 */
export function getProcessingPixelSizeMmForState(s = state) {
  return getProcessingPixelSizeMm(s.printability.profileId);
}

/**
 * Derived print settings from the active nozzle profile.
 * @param {AppState} [s]
 */
export function getPrintSettings(s = state) {
  return getDerivedPrintSettings(s.printability.profileId);
}

/**
 * True when a result exists but its revision no longer matches current inputs.
 * @param {AppState} [s]
 * @param {RuntimeQuantization} [rq]
 */
export function isQuantizationStale(s = state, rq = runtimeQuantization) {
  if (!rq.indices || rq.resultSourceRevision == null) return false;
  return rq.resultSourceRevision !== s.sourceRevision;
}

/**
 * Printability becomes stale when source image / crop / quantization inputs /
 * nozzle profile change, or when the frozen quantization buffer no longer matches.
 *
 * Palette display overrides that change RGB values but not indices do NOT
 * require topology cleanup again — region identity is index-based.
 *
 * A stale cleanup must never be treated as export-ready.
 *
 * @param {AppState} [s]
 * @param {RuntimePrintability} [rp]
 * @param {RuntimeQuantization} [rq]
 */
export function isPrintabilityStale(
  s = state,
  rp = runtimePrintability,
  rq = runtimeQuantization,
) {
  if (!rp.issueMask && !rp.cleanedIndices && rp.status === PrintabilityStatus.NOT_ANALYZED) {
    return false;
  }
  if (rp.status === PrintabilityStatus.NOT_ANALYZED && !rp.report) {
    return false;
  }
  if (rp.resultSourceRevision == null || rp.resultPrintabilityRevision == null) {
    return rp.status !== PrintabilityStatus.NOT_ANALYZED;
  }
  if (rp.resultSourceRevision !== s.sourceRevision) return true;
  if (rp.resultPrintabilityRevision !== s.printabilityRevision) return true;
  if (isQuantizationStale(s, rq)) return true;
  if (!rq.indices) return true;
  if (rq.resultSourceRevision !== rp.resultSourceRevision) return true;
  return false;
}

/**
 * Export may only use cleanup when accepted, not stale, and cleanedIndices exist.
 * Never falls back to quantized indices or unaccepted / stale cleaned data.
 * @param {AppState} [s]
 * @param {RuntimePrintability} [rp]
 */
export function isPrintabilityExportReady(s = state, rp = runtimePrintability) {
  if (!rp.accepted && !s.printability.accepted) return false;
  if (isPrintabilityStale(s, rp)) return false;
  if (!rp.cleanedIndices) return false;
  return true;
}

/**
 * Human-readable blockers for the Export screen.
 * @param {AppState} [s]
 * @param {RuntimeQuantization} [rq]
 * @param {RuntimePrintability} [rp]
 * @returns {string[]}
 */
export function getExportReadinessGaps(
  s = state,
  rq = runtimeQuantization,
  rp = runtimePrintability,
) {
  /** @type {string[]} */
  const gaps = [];
  if (!runtimeBitmap && !s.sourceImage.fileName) {
    gaps.push("Add an image first.");
  } else if (!runtimeBitmap) {
    gaps.push("Add an image first.");
  }
  if (!rq.indices || rq.status !== "ready") {
    gaps.push("Create a color preview first.");
  } else if (isQuantizationStale(s, rq)) {
    gaps.push("Your image changed. Update the color preview.");
  }
  if (!rp.cleanedIndices) {
    gaps.push("Check and approve the printable design first.");
  } else if (!rp.accepted && !s.printability.accepted) {
    gaps.push("Check and approve the printable design first.");
  } else if (isPrintabilityStale(s, rp)) {
    gaps.push("Your printable design needs to be checked again.");
  }
  return gaps;
}

/**
 * True when generated geometry no longer matches current topology / surface inputs.
 *
 * Palette RGB overrides:
 * - Flat mode: do not stale geometry (topology unchanged).
 * - Relief + automatic height order: stale geometry (luminance order may change).
 * - Relief + custom order: do not stale when only RGB changes (custom levels unchanged).
 *
 * Surface style / strength / order / custom levels always bump geometryRevision via patchSurface.
 *
 * @param {AppState} [s]
 * @param {RuntimeGeometry} [rg]
 * @param {RuntimePrintability} [rp]
 */
export function isGeometryStale(
  s = state,
  rg = runtimeGeometry,
  rp = runtimePrintability,
) {
  if (!rg.combined && rg.status === "idle") return false;
  if (rg.resultGeometryRevision == null) {
    return rg.status === "ready" || rg.status === "error";
  }
  if (rg.resultGeometryRevision !== s.geometryRevision) return true;
  if (rg.resultSourceRevision !== s.sourceRevision) return true;
  if (rg.resultPrintabilityRevision !== s.printabilityRevision) return true;
  if (!isPrintabilityExportReady(s, rp)) return true;
  return false;
}

/**
 * Downloads require validated, current geometry.
 * @param {AppState} [s]
 * @param {RuntimeGeometry} [rg]
 */
export function isGeometryDownloadReady(s = state, rg = runtimeGeometry) {
  if (rg.status !== "ready") return false;
  if (!rg.combined || !rg.base) return false;
  if (isGeometryStale(s, rg)) return false;
  if (rg.validation && rg.validation.ok === false) return false;
  if (rg.reasons && rg.reasons.length) return false;
  return true;
}

/**
 * Bump geometryRevision and clear generated meshes (topology-affecting change).
 * @param {AppState} prev
 * @returns {AppState}
 */
function invalidateGeometry(prev) {
  runtimeGeometry = createEmptyRuntimeGeometry();
  clearRuntimeThreeMf();
  return {
    ...prev,
    geometryRevision: prev.geometryRevision + 1,
    export: {
      ...prev.export,
      generated: false,
      algorithmVersion: null,
    },
  };
}

function emitGeometryChanged() {
  emit(AppEvents.GEOMETRY_CHANGED, runtimeGeometry);
}

/**
 * Clear cached 3MF bytes without affecting geometry meshes.
 */
export function clearRuntimeThreeMf() {
  runtimeThreeMf = createEmptyRuntimeThreeMf();
}

/**
 * Clamp channel to 0…255 integer.
 * @param {unknown} n
 * @returns {number}
 */
function clampColorChannel(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(255, v));
}

/**
 * Normalize a base-color RGB object.
 * @param {{ r?: unknown, g?: unknown, b?: unknown } | null | undefined} color
 * @returns {{ r: number, g: number, b: number }}
 */
export function normalizeBaseColor(color) {
  if (!color || typeof color !== "object") {
    return { ...DEFAULT_BASE_COLOR };
  }
  return {
    r: clampColorChannel(color.r),
    g: clampColorChannel(color.g),
    b: clampColorChannel(color.b),
  };
}

/**
 * Patch export settings. Base-color changes invalidate 3MF packaging only.
 * @param {Partial<AppState["export"]>} patch
 */
export function patchExport(patch) {
  let clearedThreeMf = false;
  updateState((prev) => {
    const nextExport = { ...prev.export, ...patch };
    if (patch.baseColor) {
      nextExport.baseColor = normalizeBaseColor(patch.baseColor);
      if (
        nextExport.baseColor.r !== prev.export.baseColor.r
        || nextExport.baseColor.g !== prev.export.baseColor.g
        || nextExport.baseColor.b !== prev.export.baseColor.b
      ) {
        clearRuntimeThreeMf();
        clearedThreeMf = true;
      }
    }
    return { ...prev, export: nextExport };
  });
  return clearedThreeMf;
}

/**
 * Replace state and notify subscribers.
 * @param {AppState} next
 * @param {{ silent?: boolean }} [opts]
 */
function commit(next, opts = {}) {
  state = next;
  if (!opts.silent) {
    emit(AppEvents.STATE_CHANGED, state);
    emit(AppEvents.REDRAW);
  }
}

/**
 * @param {(prev: AppState) => AppState} updater
 */
export function updateState(updater) {
  const next = updater(state);
  if (!next || typeof next !== "object") {
    throw new Error("updateState updater must return a state object");
  }
  commit(next);
}

/**
 * @param {Partial<AppState["ui"]>} patch
 */
export function patchUi(patch) {
  updateState((prev) => ({
    ...prev,
    ui: { ...prev.ui, ...patch },
  }));
}

/**
 * @param {string} step
 */
export function setActiveStep(step) {
  if (!STEPS.includes(step)) {
    throw new Error(`Unknown step: ${step}`);
  }
  patchUi({ activeStep: step });
  runtimeWorkflow = { ...runtimeWorkflow, activeStage: step };
  emit(AppEvents.WORKFLOW_CHANGED, runtimeWorkflow);
}

/**
 * @param {string} name
 */
export function setProjectName(name) {
  clearRuntimeThreeMf();
  updateState((prev) => ({
    ...prev,
    project: { ...prev.project, name },
  }));
}

/**
 * Commit a transform patch (bumps sourceRevision). Clears live preview.
 * @param {Partial<AppState["transform"]>} patch
 */
export function patchTransform(patch) {
  runtimeLiveTransform = null;
  const hadPreview = Boolean(runtimeQuantization.indices);
  updateState((prev) => invalidateGeometry({
    ...prev,
    transform: { ...prev.transform, ...patch },
    sourceRevision: prev.sourceRevision + 1,
  }));
  if (hadPreview) {
    runtimeWorkflow = { ...runtimeWorkflow, cropNeedsUpdate: true, needsReview: false };
    emit(AppEvents.WORKFLOW_CHANGED, runtimeWorkflow);
  }
  emitGeometryChanged();
}

/**
 * Commit a full transform (bumps sourceRevision). Clears live preview.
 * Use setLiveTransform during pointer drag instead.
 * @param {AppState["transform"]} transform
 */
export function setTransform(transform) {
  runtimeLiveTransform = null;
  const hadPreview = Boolean(runtimeQuantization.indices);
  updateState((prev) => invalidateGeometry({
    ...prev,
    transform: { ...transform },
    sourceRevision: prev.sourceRevision + 1,
  }));
  if (hadPreview) {
    runtimeWorkflow = { ...runtimeWorkflow, cropNeedsUpdate: true, needsReview: false };
    emit(AppEvents.WORKFLOW_CHANGED, runtimeWorkflow);
  }
  emitGeometryChanged();
}

/**
 * Commit the current live transform if present; otherwise no-op.
 * @returns {boolean} true when a commit occurred
 */
export function commitLiveTransform() {
  if (!runtimeLiveTransform) return false;
  const next = { ...runtimeLiveTransform };
  runtimeLiveTransform = null;
  const prev = state.transform;
  const unchanged = prev.offsetX === next.offsetX
    && prev.offsetY === next.offsetY
    && prev.scale === next.scale
    && prev.rotationDeg === next.rotationDeg
    && prev.flipX === next.flipX
    && prev.flipY === next.flipY;
  if (unchanged) {
    emit(AppEvents.REDRAW);
    return false;
  }
  setTransform(next);
  return true;
}

/**
 * @param {object} meta
 * @param {string} meta.fileName
 * @param {string | null} meta.mimeType
 * @param {number} meta.widthPx
 * @param {number} meta.heightPx
 * @param {ImageBitmap | HTMLImageElement} bitmap
 * @param {AppState["transform"]} transform
 */
export function setSourceImage(meta, bitmap, transform) {
  releaseRuntimeBitmap();
  runtimeBitmap = bitmap;
  clearRuntimeQuantizationResult();
  clearRuntimePrintabilityResult();
  updateState((prev) => invalidateGeometry({
    ...prev,
    sourceImage: {
      fileName: meta.fileName,
      mimeType: meta.mimeType,
      widthPx: meta.widthPx,
      heightPx: meta.heightPx,
    },
    transform: { ...transform },
    quantization: {
      ...prev.quantization,
      paletteOverrides: [],
    },
    printability: {
      ...prev.printability,
      accepted: false,
      cleanupAlgorithmVersion: null,
    },
    ui: { ...prev.ui, error: null },
    sourceRevision: prev.sourceRevision + 1,
  }));
  emitGeometryChanged();
  emit(AppEvents.IMAGE_LOADED, meta);
}

export function clearSourceImage() {
  releaseRuntimeBitmap();
  clearRuntimeQuantizationResult();
  clearRuntimePrintabilityResult();
  updateState((prev) => invalidateGeometry({
    ...prev,
    sourceImage: {
      fileName: null,
      mimeType: null,
      widthPx: 0,
      heightPx: 0,
    },
    transform: {
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
    },
    quantization: {
      ...prev.quantization,
      paletteOverrides: [],
    },
    printability: {
      ...prev.printability,
      accepted: false,
      cleanupAlgorithmVersion: null,
    },
    sourceRevision: prev.sourceRevision + 1,
  }));
  emitGeometryChanged();
}

function releaseRuntimeBitmap() {
  if (runtimeBitmap && typeof runtimeBitmap.close === "function") {
    try {
      runtimeBitmap.close();
    } catch {
      // already closed
    }
  }
  runtimeBitmap = null;
}

/**
 * Serializable project snapshot — excludes bitmaps and UI ephemera by design.
 * Stores profile IDs (not duplicated editable nozzle/ppm values).
 * @param {AppState} [s]
 */
export function toSerializableProject(s = state) {
  const print = resolvePrintProfile(s.printability.profileId);
  return {
    project: { ...s.project },
    tile: {
      ...s.tile,
      magnetCentersMm: s.tile.magnetCentersMm.map((p) => ({ ...p })),
    },
    sourceImage: {
      fileName: s.sourceImage.fileName,
      mimeType: s.sourceImage.mimeType,
      widthPx: s.sourceImage.widthPx,
      heightPx: s.sourceImage.heightPx,
      // bitmap intentionally omitted
    },
    transform: { ...s.transform },
    quantization: {
      colorCount: s.quantization.colorCount,
      detailProfileId: normalizeDetailProfileId(s.quantization.detailProfileId),
      detailProfilesVersion: DETAIL_PROFILES_VERSION,
      transparencyMode: s.quantization.transparencyMode,
      customBackground: { ...s.quantization.customBackground },
      paletteOverrides: s.quantization.paletteOverrides.map((c) => (c ? { ...c } : null)),
      algorithmVersion: s.quantization.algorithmVersion,
      smoothing: s.quantization.smoothing,
    },
    printability: {
      profileId: print.id,
      printProfilesVersion: PRINT_PROFILES_VERSION,
      accepted: Boolean(s.printability.accepted),
      cleanupAlgorithmVersion: s.printability.cleanupAlgorithmVersion,
      // comparisonMode is UI-only and omitted from project JSON
    },
    printabilityRevision: s.printabilityRevision,
    geometryRevision: s.geometryRevision,
    surface: {
      style: s.surface.style,
      reliefStrengthId: s.surface.reliefStrengthId,
      heightOrder: s.surface.heightOrder,
      colorHeightLevels: s.surface.colorHeightLevels.map((e) => ({ ...e })),
    },
    export: {
      mode: s.export.mode,
      artworkHeightMm: s.export.artworkHeightMm,
      algorithmVersion: s.export.algorithmVersion,
      generated: false,
      baseColor: { ...s.export.baseColor },
    },
    sourceRevision: s.sourceRevision,
  };
}

/**
 * Keys that must never appear in serializable project JSON.
 * @returns {string[]}
 */
export function runtimeOnlyKeys() {
  return [
    "bitmap",
    "imageBitmap",
    "canvas",
    "imageData",
    "worker",
    "indices",
    "rgbaBuffer",
    "previewRgba",
    "generatedPalette",
    "cleanedIndices",
    "issueMask",
    "originalIndices",
    "combined",
    "base",
    "colors",
    "mesh",
    "positions",
    "triangles",
    "validation",
    "bytes",
    "threeMf",
    "workflow",
    "pipeline",
    "requestedOperationId",
    "completedOperationId",
    "progressMessage",
    "liveTransform",
    "promise",
    "promises",
    "buffers",
  ];
}

/**
 * Reset to initial state (tests / hard reset).
 */
export function resetStore() {
  releaseRuntimeBitmap();
  runtimeQuantization = createEmptyRuntimeQuantization();
  runtimePrintability = createEmptyRuntimePrintability();
  runtimeGeometry = createEmptyRuntimeGeometry();
  runtimeThreeMf = createEmptyRuntimeThreeMf();
  runtimeWorkflow = createEmptyRuntimeWorkflow();
  runtimeLiveTransform = null;
  commit(createInitialState(), { silent: true });
}

/**
 * Patch quantization settings. Source-affecting keys bump sourceRevision.
 * Palette override-only patches do not bump revision or clear the index buffer.
 * @param {Partial<AppState["quantization"]>} patch
 */
export function patchQuantization(patch) {
  let didInvalidate = false;
  let clearedThreeMfOnly = false;
  updateState((prev) => {
    const nextPatch = { ...patch };
    if (nextPatch.detailProfileId != null) {
      nextPatch.detailProfileId = normalizeDetailProfileId(nextPatch.detailProfileId);
    }
    const bumpsSource = Object.keys(nextPatch).some((key) => QUANTIZATION_SOURCE_KEYS.has(key));
    const paletteOnly = Object.keys(nextPatch).length > 0
      && Object.keys(nextPatch).every((key) => key === "paletteOverrides");
    const nextQuant = { ...prev.quantization, ...nextPatch };
    if (nextPatch.customBackground) {
      nextQuant.customBackground = { ...nextPatch.customBackground };
    }
    if (nextPatch.paletteOverrides) {
      nextQuant.paletteOverrides = nextPatch.paletteOverrides.map((c) => (c ? { ...c } : null));
    }
    let next = {
      ...prev,
      quantization: nextQuant,
      sourceRevision: bumpsSource ? prev.sourceRevision + 1 : prev.sourceRevision,
    };
    if (bumpsSource) {
      next = invalidateGeometry(next);
      didInvalidate = true;
    } else if (
      paletteOnly
      && prev.surface.style === "relief"
      && prev.surface.heightOrder !== "custom"
    ) {
      // Automatic relief ordering depends on effective palette RGB.
      next = invalidateGeometry(next);
      didInvalidate = true;
    } else if (paletteOnly) {
      // Flat (or custom relief order): geometry topology unchanged; 3MF colors must refresh.
      clearRuntimeThreeMf();
      clearedThreeMfOnly = true;
    }
    return next;
  });
  if (didInvalidate) emitGeometryChanged();
  return { didInvalidate, clearedThreeMfOnly };
}

/**
 * Update surface style / relief settings. Marks geometry for rebuild only —
 * does not stale quantization or accepted cleanup (indexed topology unchanged).
 * @param {Partial<AppState["surface"]>} patch
 */
export function patchSurface(patch) {
  let didInvalidate = false;
  updateState((prev) => {
    const nextSurface = {
      ...prev.surface,
      ...patch,
      style: patch.style != null ? normalizeSurfaceStyleId(patch.style) : prev.surface.style,
      reliefStrengthId: patch.reliefStrengthId != null
        ? normalizeReliefStrengthId(patch.reliefStrengthId)
        : prev.surface.reliefStrengthId,
      heightOrder: patch.heightOrder != null
        ? normalizeHeightOrderId(patch.heightOrder)
        : prev.surface.heightOrder,
      colorHeightLevels: patch.colorHeightLevels != null
        ? patch.colorHeightLevels.map((e) => ({
          paletteIndex: e.paletteIndex,
          levelIndex: e.levelIndex,
        }))
        : prev.surface.colorHeightLevels.map((e) => ({ ...e })),
    };
    const changed = nextSurface.style !== prev.surface.style
      || nextSurface.reliefStrengthId !== prev.surface.reliefStrengthId
      || nextSurface.heightOrder !== prev.surface.heightOrder
      || JSON.stringify(nextSurface.colorHeightLevels) !== JSON.stringify(prev.surface.colorHeightLevels);
    let next = { ...prev, surface: nextSurface };
    if (changed) {
      next = invalidateGeometry(next);
      didInvalidate = true;
    }
    return next;
  });
  if (didInvalidate) emitGeometryChanged();
}

/**
 * Apply migrated surface settings from a saved project snapshot.
 * @param {unknown} projectLike
 */
export function applyMigratedSurface(projectLike) {
  const surface = migrateSurfaceSettings(projectLike);
  updateState((prev) => ({
    ...prev,
    surface,
  }));
}

/**
 * Set the detail profile (bumps sourceRevision via patchQuantization).
 * @param {unknown} profileId
 */
export function setDetailProfile(profileId) {
  patchQuantization({ detailProfileId: normalizeDetailProfileId(profileId) });
}

/**
 * Set the print nozzle profile. Invalid ids normalize to default.
 * Increments printabilityRevision when the effective id changes.
 * Also bumps sourceRevision because nozzle now drives the automatic
 * quantization / cleanup grid (Milestone 7.3.2).
 *
 * Does not wipe the color-preview buffers — marks them stale so the user can
 * update the preview. Clearing indices would strand Check design as disabled
 * with no path forward from the Make printable step.
 *
 * @param {unknown} profileId
 * @returns {boolean} true when the effective profile id changed
 */
export function setPrintProfile(profileId) {
  const nextId = normalizePrintProfileId(profileId);
  const prevId = normalizePrintProfileId(state.printability.profileId);
  if (prevId === nextId) {
    updateState((prev) => ({
      ...prev,
      printability: { ...prev.printability, profileId: nextId },
    }));
    return false;
  }
  clearRuntimePrintabilityResult({ silent: true });
  updateState((prev) => invalidateGeometry({
    ...prev,
    printability: {
      ...prev.printability,
      profileId: nextId,
      accepted: false,
      cleanupAlgorithmVersion: null,
    },
    printabilityRevision: prev.printabilityRevision + 1,
    sourceRevision: prev.sourceRevision + 1,
  }));
  emitGeometryChanged();
  emit(AppEvents.PRINTABILITY_CHANGED, runtimePrintability);
  // Quantization buffers remain so the UI can show "update preview" instead of
  // wiping the Colors step; isQuantizationStale() becomes true via sourceRevision.
  emit(AppEvents.QUANTIZE_CHANGED, runtimeQuantization);
  return true;
}

/**
 * @deprecated Prefer setPrintProfile. Kept for narrow patches in tests.
 * @param {Partial<AppState["printability"]>} patch
 */
export function patchPrintability(patch) {
  if (patch && patch.profileId != null) {
    setPrintProfile(patch.profileId);
    return;
  }
  updateState((prev) => ({
    ...prev,
    printability: { ...prev.printability, ...patch },
  }));
}

/**
 * @param {"quantized" | "issues" | "cleaned" | "side-by-side"} mode
 */
export function setPrintabilityComparisonMode(mode) {
  updateState((prev) => ({
    ...prev,
    printability: { ...prev.printability, comparisonMode: mode },
  }));
  emit(AppEvents.REDRAW);
}

/**
 * @param {Partial<RuntimeQuantization>} patch
 */
export function patchRuntimeQuantization(patch) {
  runtimeQuantization = { ...runtimeQuantization, ...patch };
  emit(AppEvents.QUANTIZE_CHANGED, runtimeQuantization);
  emit(AppEvents.STATE_CHANGED, state);
}

/**
 * Accept a successful quantization result when request + revision still match.
 * @param {object} opts
 * @param {string} opts.requestId
 * @param {number} opts.sourceRevision
 * @param {import("./image/quantize.js").QuantizeResult} opts.result
 * @param {Uint8ClampedArray} opts.previewRgba
 * @returns {boolean} whether the result was accepted
 */
export function acceptQuantizeResult(opts) {
  const { requestId, sourceRevision, result, previewRgba } = opts;
  if (runtimeQuantization.activeRequestId !== requestId) {
    return false;
  }
  if (state.sourceRevision !== sourceRevision) {
    // Inputs moved on while this request was in flight — drop it cleanly.
    runtimeQuantization = {
      ...runtimeQuantization,
      status: runtimeQuantization.indices ? "ready" : "idle",
      activeRequestId: null,
      error: null,
    };
    patchUi({ isProcessing: false });
    emit(AppEvents.QUANTIZE_CHANGED, runtimeQuantization);
    return false;
  }

  runtimeQuantization = {
    status: "ready",
    activeRequestId: null,
    width: result.width,
    height: result.height,
    generatedPalette: result.generatedPalette.map((c) => ({ ...c })),
    indices: result.indices,
    previewRgba,
    resultSourceRevision: sourceRevision,
    algorithmVersion: result.algorithmVersion,
    diagnostics: { ...result.diagnostics },
    error: null,
  };

  // New quantization invalidates any prior cleanup (topology may change).
  clearRuntimePrintabilityResult({ silent: true });

  updateState((prev) => invalidateGeometry({
    ...prev,
    quantization: {
      ...prev.quantization,
      paletteOverrides: result.generatedPalette.map(() => null),
    },
    printability: {
      ...prev.printability,
      accepted: false,
      cleanupAlgorithmVersion: null,
    },
    ui: { ...prev.ui, isProcessing: false, error: null },
  }));
  runtimeWorkflow = {
    ...runtimeWorkflow,
    cropNeedsUpdate: false,
  };
  emit(AppEvents.WORKFLOW_CHANGED, runtimeWorkflow);
  emitGeometryChanged();
  emit(AppEvents.QUANTIZE_CHANGED, runtimeQuantization);
  emit(AppEvents.PRINTABILITY_CHANGED, runtimePrintability);
  return true;
}

/**
 * @param {object} opts
 * @param {string} opts.requestId
 * @param {number} opts.sourceRevision
 * @param {{ code: string, message: string, details?: unknown }} opts.error
 * @returns {boolean}
 */
export function acceptQuantizeError(opts) {
  const { requestId, sourceRevision, error } = opts;
  if (runtimeQuantization.activeRequestId !== requestId) {
    return false;
  }
  if (state.sourceRevision !== sourceRevision) {
    // Still clear processing if this was our active request but inputs moved on.
    runtimeQuantization = {
      ...runtimeQuantization,
      status: runtimeQuantization.indices ? "ready" : "idle",
      activeRequestId: null,
      error: null,
    };
    patchUi({ isProcessing: false });
    emit(AppEvents.QUANTIZE_CHANGED, runtimeQuantization);
    return false;
  }

  runtimeQuantization = {
    ...runtimeQuantization,
    status: "error",
    activeRequestId: null,
    error: { ...error },
  };
  updateState((prev) => ({
    ...prev,
    ui: { ...prev.ui, isProcessing: false, error: error.message },
  }));
  emit(AppEvents.QUANTIZE_CHANGED, runtimeQuantization);
  return true;
}

/**
 * Mark processing start for a new request.
 * @param {string} requestId
 */
export function beginQuantizeRequest(requestId) {
  runtimeQuantization = {
    ...runtimeQuantization,
    status: "processing",
    activeRequestId: requestId,
    error: null,
  };
  patchUi({ isProcessing: true, error: null });
  emit(AppEvents.QUANTIZE_CHANGED, runtimeQuantization);
}

function clearRuntimeQuantizationResult() {
  runtimeQuantization = createEmptyRuntimeQuantization();
  emit(AppEvents.QUANTIZE_CHANGED, runtimeQuantization);
}

/**
 * @param {{ silent?: boolean }} [opts]
 */
function clearRuntimePrintabilityResult(opts = {}) {
  runtimePrintability = createEmptyRuntimePrintability();
  if (!opts.silent) {
    emit(AppEvents.PRINTABILITY_CHANGED, runtimePrintability);
  }
}

/**
 * Mark printability processing start.
 * @param {string} requestId
 * @param {boolean} [runCleanup=false]
 */
export function beginPrintabilityRequest(requestId, runCleanup = false) {
  runtimePrintability = {
    ...runtimePrintability,
    status: PrintabilityStatus.ANALYZING,
    activeRequestId: requestId,
    activeOperation: runCleanup ? "clean" : "analyze",
    error: null,
    accepted: false,
  };
  updateState((prev) => ({
    ...prev,
    printability: { ...prev.printability, accepted: false },
    ui: { ...prev.ui, isProcessing: true, error: null },
  }));
  emit(AppEvents.PRINTABILITY_CHANGED, runtimePrintability);
}

/**
 * Accept a successful printability analysis / cleanup result.
 * @param {object} opts
 * @param {string} opts.requestId
 * @param {number} opts.sourceRevision
 * @param {number} opts.printabilityRevision
 * @param {object} opts.result
 * @param {boolean} opts.ranCleanup
 * @returns {boolean}
 */
export function acceptPrintabilityResult(opts) {
  const { requestId, sourceRevision, printabilityRevision, result, ranCleanup } = opts;
  if (runtimePrintability.activeRequestId !== requestId) {
    return false;
  }
  if (state.sourceRevision !== sourceRevision || state.printabilityRevision !== printabilityRevision) {
    runtimePrintability = {
      ...runtimePrintability,
      status: runtimePrintability.issueMask
        ? (isPrintabilityStale() ? PrintabilityStatus.STALE : runtimePrintability.status)
        : PrintabilityStatus.NOT_ANALYZED,
      activeRequestId: null,
      activeOperation: null,
    };
    patchUi({ isProcessing: false });
    emit(AppEvents.PRINTABILITY_CHANGED, runtimePrintability);
    return false;
  }

  const hasIssues = Boolean(
    result.report
    && (
      result.report.smallIslandCount > 0
      || result.report.smallHoleCount > 0
      || result.report.narrowFeaturePixelCount > 0
      || result.report.narrowGapPixelCount > 0
    ),
  );

  let status = PrintabilityStatus.NO_ISSUES;
  if (ranCleanup && result.cleanedIndices) {
    status = PrintabilityStatus.CLEANED_PREVIEW;
  } else if (hasIssues) {
    status = PrintabilityStatus.ISSUES_FOUND;
  }

  runtimePrintability = {
    status,
    activeRequestId: null,
    activeOperation: null,
    width: result.width,
    height: result.height,
    cleanedIndices: result.cleanedIndices ? new Uint8Array(result.cleanedIndices) : null,
    issueMask: result.issueMask ? new Uint8Array(result.issueMask) : null,
    report: result.report ? { ...result.report, warnings: [...(result.report.warnings || [])] } : createEmptyReport(),
    accepted: false,
    resultSourceRevision: sourceRevision,
    resultPrintabilityRevision: printabilityRevision,
    algorithmVersion: result.algorithmVersion ?? CLEANUP_ALGORITHM_VERSION,
    error: null,
  };

  updateState((prev) => invalidateGeometry({
    ...prev,
    printability: {
      ...prev.printability,
      accepted: false,
      cleanupAlgorithmVersion: runtimePrintability.algorithmVersion,
    },
    ui: { ...prev.ui, isProcessing: false, error: null },
  }));
  emitGeometryChanged();
  emit(AppEvents.PRINTABILITY_CHANGED, runtimePrintability);
  emit(AppEvents.REDRAW);
  return true;
}

/**
 * @param {object} opts
 * @param {string} opts.requestId
 * @param {number} opts.sourceRevision
 * @param {number} opts.printabilityRevision
 * @param {{ code: string, message: string, details?: unknown }} opts.error
 * @returns {boolean}
 */
export function acceptPrintabilityError(opts) {
  const { requestId, sourceRevision, printabilityRevision, error } = opts;
  if (runtimePrintability.activeRequestId !== requestId) {
    return false;
  }
  if (state.sourceRevision !== sourceRevision || state.printabilityRevision !== printabilityRevision) {
    runtimePrintability = {
      ...runtimePrintability,
      activeRequestId: null,
      activeOperation: null,
    };
    patchUi({ isProcessing: false });
    emit(AppEvents.PRINTABILITY_CHANGED, runtimePrintability);
    return false;
  }

  runtimePrintability = {
    ...runtimePrintability,
    status: PrintabilityStatus.ERROR,
    activeRequestId: null,
    activeOperation: null,
    error: { ...error },
  };
  updateState((prev) => ({
    ...prev,
    ui: { ...prev.ui, isProcessing: false, error: error.message },
  }));
  emit(AppEvents.PRINTABILITY_CHANGED, runtimePrintability);
  return true;
}

/**
 * Explicitly accept the cleaned preview for later export. Does nothing if stale.
 * @returns {boolean}
 */
export function acceptCleanedDesign() {
  if (isPrintabilityStale()) {
    runtimePrintability = { ...runtimePrintability, status: PrintabilityStatus.STALE };
    emit(AppEvents.PRINTABILITY_CHANGED, runtimePrintability);
    return false;
  }
  if (!runtimePrintability.cleanedIndices) {
    return false;
  }
  runtimePrintability = {
    ...runtimePrintability,
    status: PrintabilityStatus.ACCEPTED,
    accepted: true,
  };
  updateState((prev) => ({
    ...prev,
    printability: {
      ...prev.printability,
      accepted: true,
      cleanupAlgorithmVersion: runtimePrintability.algorithmVersion,
    },
  }));
  runtimeWorkflow = {
    ...runtimeWorkflow,
    needsReview: false,
    pipelineStatus: "approved",
    progressMessage: null,
    error: null,
    longerThanUsual: false,
    canCancel: false,
    approvedSourceRevision: state.sourceRevision,
    approvedPrintabilityRevision: state.printabilityRevision,
  };
  emit(AppEvents.WORKFLOW_CHANGED, runtimeWorkflow);
  emit(AppEvents.PRINTABILITY_CHANGED, runtimePrintability);
  return true;
}

/**
 * Discard cleaned preview and restore analysis-only / not-analyzed state.
 * Original quantization indices are never modified.
 */
export function resetPrintabilityCleanup() {
  const hadAnalysis = Boolean(runtimePrintability.issueMask);
  const report = runtimePrintability.report;
  const issueMask = runtimePrintability.issueMask
    ? new Uint8Array(runtimePrintability.issueMask)
    : null;
  const width = runtimePrintability.width;
  const height = runtimePrintability.height;
  const resultSourceRevision = runtimePrintability.resultSourceRevision;
  const resultPrintabilityRevision = runtimePrintability.resultPrintabilityRevision;
  const algorithmVersion = runtimePrintability.algorithmVersion;

  runtimePrintability = {
    status: hadAnalysis
      ? (report && (
        report.smallIslandCount > 0
        || report.smallHoleCount > 0
        || report.narrowFeaturePixelCount > 0
        || report.narrowGapPixelCount > 0
      )
        ? PrintabilityStatus.ISSUES_FOUND
        : PrintabilityStatus.NO_ISSUES)
      : PrintabilityStatus.NOT_ANALYZED,
    activeRequestId: null,
    width,
    height,
    cleanedIndices: null,
    issueMask,
    report: report ? { ...report, cleanupPasses: 0, changedPixelCount: 0 } : null,
    accepted: false,
    resultSourceRevision,
    resultPrintabilityRevision,
    algorithmVersion,
    error: null,
  };

  updateState((prev) => invalidateGeometry({
    ...prev,
    printability: {
      ...prev.printability,
      accepted: false,
      cleanupAlgorithmVersion: hadAnalysis ? algorithmVersion : null,
      comparisonMode: "quantized",
    },
  }));
  emitGeometryChanged();
  emit(AppEvents.PRINTABILITY_CHANGED, runtimePrintability);
  emit(AppEvents.REDRAW);
}

/**
 * Update preview RGBA after a palette override without touching indices.
 * @param {Uint8ClampedArray} previewRgba
 */
export function setQuantizePreviewRgba(previewRgba) {
  runtimeQuantization = {
    ...runtimeQuantization,
    previewRgba,
  };
  emit(AppEvents.QUANTIZE_CHANGED, runtimeQuantization);
}

/**
 * Mark mesh generation start.
 * @param {string} requestId
 */
export function beginGeometryRequest(requestId) {
  runtimeGeometry = {
    ...createEmptyRuntimeGeometry(),
    status: "processing",
    activeRequestId: requestId,
  };
  clearRuntimeThreeMf();
  updateState((prev) => ({
    ...prev,
    ui: { ...prev.ui, isProcessing: true, error: null },
    export: { ...prev.export, generated: false },
  }));
  emit(AppEvents.GEOMETRY_CHANGED, runtimeGeometry);
}

/**
 * Accept a successful mesh generation result when revisions still match.
 * @param {object} opts
 * @param {string} opts.requestId
 * @param {number} opts.sourceRevision
 * @param {number} opts.printabilityRevision
 * @param {number} opts.geometryRevision
 * @param {object} opts.result  deserialized geometry payload
 * @returns {boolean}
 */
export function acceptGeometryResult(opts) {
  const {
    requestId,
    sourceRevision,
    printabilityRevision,
    geometryRevision,
    result,
  } = opts;
  if (runtimeGeometry.activeRequestId !== requestId) {
    return false;
  }
  if (
    state.sourceRevision !== sourceRevision
    || state.printabilityRevision !== printabilityRevision
    || state.geometryRevision !== geometryRevision
  ) {
    runtimeGeometry = {
      ...runtimeGeometry,
      status: "stale",
      activeRequestId: null,
    };
    patchUi({ isProcessing: false });
    emit(AppEvents.GEOMETRY_CHANGED, runtimeGeometry);
    return false;
  }

  // Validation failure must not leave downloadable meshes around.
  clearRuntimeThreeMf();
  const backing = result.ok ? (result.backing || result.roof || null) : null;
  const backingCellCount = result.ok
    ? (result.backingCellCount ?? result.keepoutCellCount ?? 0)
    : 0;
  runtimeGeometry = {
    status: result.ok ? "ready" : "error",
    activeRequestId: null,
    resultGeometryRevision: geometryRevision,
    resultSourceRevision: sourceRevision,
    resultPrintabilityRevision: printabilityRevision,
    algorithmVersion: result.algorithmVersion ?? GEOMETRY_ALGORITHM_VERSION,
    combined: result.ok ? result.combined : null,
    base: result.ok ? result.base : null,
    backing,
    roof: backing,
    backingCellCount,
    keepoutCellCount: backingCellCount,
    colors: result.ok ? (result.colors || []) : [],
    validation: {
      ok: result.ok,
      combined: result.validation && result.validation.combined,
      base: result.validation && result.validation.base,
      backing: result.validation && (result.validation.backing || result.validation.roof),
      roof: result.validation && (result.validation.backing || result.validation.roof),
      colors: result.validation && result.validation.colors,
    },
    reasons: result.reasons ? result.reasons.slice() : [],
    error: result.ok
      ? null
      : {
        code: "GEOMETRY_VALIDATION_FAILED",
        message: result.userMessage || "The model could not be built.",
        details: result.reasons,
      },
  };

  updateState((prev) => ({
    ...prev,
    export: {
      ...prev.export,
      generated: Boolean(result.ok),
      algorithmVersion: runtimeGeometry.algorithmVersion,
    },
    ui: {
      ...prev.ui,
      isProcessing: false,
      error: result.ok ? null : runtimeGeometry.error.message,
    },
  }));
  emit(AppEvents.GEOMETRY_CHANGED, runtimeGeometry);
  return true;
}

/**
 * @param {object} opts
 * @param {string} opts.requestId
 * @param {number} opts.sourceRevision
 * @param {number} opts.printabilityRevision
 * @param {number} opts.geometryRevision
 * @param {{ code: string, message: string, details?: unknown }} opts.error
 * @returns {boolean}
 */
export function acceptGeometryError(opts) {
  const {
    requestId,
    sourceRevision,
    printabilityRevision,
    geometryRevision,
    error,
  } = opts;
  if (runtimeGeometry.activeRequestId !== requestId) {
    return false;
  }
  if (
    state.sourceRevision !== sourceRevision
    || state.printabilityRevision !== printabilityRevision
    || state.geometryRevision !== geometryRevision
  ) {
    runtimeGeometry = {
      ...runtimeGeometry,
      activeRequestId: null,
    };
    patchUi({ isProcessing: false });
    emit(AppEvents.GEOMETRY_CHANGED, runtimeGeometry);
    return false;
  }

  runtimeGeometry = {
    ...createEmptyRuntimeGeometry(),
    status: "error",
    activeRequestId: null,
    resultGeometryRevision: geometryRevision,
    resultSourceRevision: sourceRevision,
    resultPrintabilityRevision: printabilityRevision,
    error: { ...error },
    reasons: [error.message],
  };
  clearRuntimeThreeMf();
  updateState((prev) => ({
    ...prev,
    export: { ...prev.export, generated: false },
    ui: { ...prev.ui, isProcessing: false, error: error.message },
  }));
  emit(AppEvents.GEOMETRY_CHANGED, runtimeGeometry);
  return true;
}

/**
 * Store a successfully packaged 3MF archive in runtime (not serialized).
 * @param {{
 *   bytes: Uint8Array,
 *   filename: string,
 *   manifest: object,
 *   packageKey: string,
 *   geometryRevision: number,
 *   diagnostics?: object | null,
 * }} packageResult
 */
export function acceptThreeMfPackage(packageResult) {
  runtimeThreeMf = {
    status: "ready",
    bytes: packageResult.bytes,
    filename: packageResult.filename,
    manifest: packageResult.manifest,
    resultGeometryRevision: packageResult.geometryRevision,
    packageKey: packageResult.packageKey,
    error: null,
    diagnostics: packageResult.diagnostics || null,
  };
}

/**
 * Mark 3MF packaging as in progress.
 * Clears any prior package bytes so a failed run cannot leave a stale download.
 */
export function beginThreeMfPackage() {
  runtimeThreeMf = {
    ...createEmptyRuntimeThreeMf(),
    status: "processing",
  };
}

/**
 * Record a 3MF packaging failure without clearing STL geometry.
 * @param {{ code?: string, message: string, details?: unknown }} error
 */
export function acceptThreeMfError(error) {
  runtimeThreeMf = {
    ...createEmptyRuntimeThreeMf(),
    status: "error",
    error: {
      code: error.code || "THREE_MF_PACKAGE_FAILED",
      message: error.message,
      details: error.details,
    },
  };
}
