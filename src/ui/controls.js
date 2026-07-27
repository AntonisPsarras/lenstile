/**
 * Wire UI controls to state and image loading.
 */

import {
  generateModelAction,
  downloadStlAction,
  downloadAllColorStlsAction,
  downloadGeometryDebugCaseAction,
  downloadThreeMfAction,
  downloadThreeMfDiagnosticsAction,
  setBaseColorAction,
  getExportReadiness,
  getEffectiveExportColors,
  getGeometryStatusLabel,
  getThreeMfStatusLabel,
  getThreeMfTechnicalDetailsText,
  isThreeMfDevDiagnosticsEnabled,
} from "./export-controller.js";
import {
  FEATURES,
  STEPS,
  STEP_LABELS,
  WHEEL_ZOOM_FACTOR,
  DETAIL_PROFILES,
  DEFAULT_BASE_COLOR,
} from "../config.js";
import {
  getState,
  getRuntimeBitmap,
  setActiveStep,
  setTransform,
  setLiveTransform,
  commitLiveTransform,
  getEffectiveTransform,
  patchTransform,
  patchQuantization,
  setDetailProfile,
  setPrintProfile,
  getResolutionPxPerMm,
  getPrintSettings,
  isQuantizationStale,
  isPrintabilityStale,
  getRuntimeQuantization,
  getRuntimePrintability,
  setPrintabilityComparisonMode,
  getRuntimeGeometry,
  getRuntimeThreeMf,
  getRuntimeWorkflow,
  isGeometryDownloadReady,
  isPrintabilityExportReady,
  normalizeBaseColor,
} from "../state.js";
import {
  configurePipeline,
  runDependentProcessingPipeline,
  runUpdateDesignPipeline,
  ensureModelAfterApproval,
  getPipelineStatusLabel,
  isColorPrintableBusy,
  normalizeWorkflowStatus,
} from "../workflow/pipeline.js";
import { isBusyWorkflowStatus } from "../workflow/workflow-fsm.js";
import { bindProgressControls, syncProgressUi } from "./progress.js";
import { rgbToFilenameHex } from "../export/stl-filenames.js";
import {
  applyFill,
  applyFit,
  clampTransformToCrop,
  computeCropRect,
  createResetTransform,
  flipHorizontal,
  flipVertical,
  panBy,
  rotateBy,
  setScale,
} from "../image/crop-transform.js";
import { validateColorCount } from "../validation.js";
import { showError, showNotice, renderAppStatus, inferStatusKind } from "./notifications.js";
import {
  runQuantization,
  getQuantizeButtonState,
  applyPaletteOverride,
  restoreGeneratedPaletteColor,
  resetAllPaletteOverrides,
  getPaletteEntriesForUi,
  parseHexColor,
  formatHexColor,
  validateQuantizationResolution,
} from "./quantize-controller.js";
import {
  analyzePrintabilityAction,
  cleanPrintabilityAction,
  acceptCleanupAction,
  resetCleanupAction,
  getAnalyzeButtonState,
  getCleanButtonState,
  getAcceptCleanupButtonState,
  getResetCleanupButtonState,
  getPrintabilityStatusLabel,
  getPlainIssueSummary,
} from "./printability-controller.js";
import { bindSurfaceControls, renderSurfaceControls, setReliefEditorOpen, renderReliefEditorHeavy } from "./surface-controls.js";
import { drawTransformedImage } from "../image/crop-renderer.js";
import { scaleTransformToOutput } from "../image/crop-rasterize.js";
import { resolveBackgroundColor } from "../image/transparency.js";
import { formatGeometryTechnicalDetails } from "../geometry/mesh-validation.js";
import { computeQuantizationSize } from "../image/resolution.js";
import {
  bindImageImport,
  syncImageImportUi,
} from "./image-import-controller.js";
import { indicesToRgba } from "../image/indexed-preview.js";
import { buildPaletteEntries, effectivePalette } from "../image/palette.js";
import { IssueCategory } from "../image/printability.js";

/**
 * @param {object} ctx
 * @param {HTMLCanvasElement} ctx.canvas
 * @param {HTMLElement} ctx.canvasShell
 * @param {HTMLInputElement} ctx.imageInput
 * @param {() => void} ctx.scheduleRedraw
 * @param {() => { width: number, height: number }} ctx.getCropSize
 */
export function bindControls(ctx) {
  const { canvas, canvasShell, imageInput, scheduleRedraw, getCropSize } = ctx;

  configurePipeline(getCropSize);

  document.querySelectorAll(".step-button").forEach((button) => {
    button.addEventListener("click", () => {
      const step = button.getAttribute("data-step");
      if (!step || !STEPS.includes(step)) return;
      setActiveStep(step);
      if (step === "export" && isPrintabilityExportReady()) {
        void ensureModelAfterApproval().then(() => syncControlsFromState());
      }
    });
  });

  bindImageImport({
    imageInput,
    canvasShell,
    getCropSize,
  });

  document.getElementById("btn-fit")?.addEventListener("click", () => {
    withImage((image, transform, crop) => {
      setTransform(clampTransformToCrop(applyFit(transform, image, crop), image, crop));
    });
  });
  document.getElementById("btn-fill")?.addEventListener("click", () => {
    withImage((image, transform, crop) => {
      setTransform(clampTransformToCrop(applyFill(transform, image, crop), image, crop));
    });
  });
  document.getElementById("btn-reset")?.addEventListener("click", () => {
    withImage((image, _transform, crop) => {
      setTransform(createResetTransform(image, crop));
    });
  });
  document.getElementById("btn-rotate")?.addEventListener("click", () => {
    withImage((image, transform, crop) => {
      const rotated = rotateBy(transform, 90, { snap90: true });
      const next = clampTransformToCrop(rotated, image, crop);
      setTransform(next);
    });
  });
  document.getElementById("btn-flip-h")?.addEventListener("click", () => {
    patchTransform(flipHorizontal(getState().transform));
  });
  document.getElementById("btn-flip-v")?.addEventListener("click", () => {
    patchTransform(flipVertical(getState().transform));
  });

  const zoom = /** @type {HTMLInputElement} */ (document.getElementById("zoom"));
  const zoomOut = /** @type {HTMLOutputElement} */ (document.getElementById("zoom-value"));
  zoom.addEventListener("input", () => {
    const scale = Number(zoom.value);
    zoomOut.value = scale.toFixed(2);
    withImage((image, transform, crop) => {
      // Live preview while dragging the slider.
      setLiveTransform(clampTransformToCrop(setScale(transform, scale), image, crop));
      scheduleRedraw();
    });
  });
  zoom.addEventListener("change", () => {
    commitLiveTransform();
  });

  document.getElementById("btn-update-design")?.addEventListener("click", () => {
    void runUpdateDesignPipeline().then(() => syncControlsFromState());
  });

  bindNumber("color-count", (raw) => {
    const result = validateColorCount(raw);
    if (!result.ok) {
      showError(result.reason);
      return getState().quantization.colorCount;
    }
    patchQuantization({ colorCount: result.value });
    if (getRuntimeBitmap() && getRuntimeQuantization().indices) {
      void runDependentProcessingPipeline("color-count").then(() => syncControlsFromState());
    }
    return result.value;
  });

  const detailSelect = /** @type {HTMLSelectElement|null} */ (
    document.getElementById("detail-profile")
  );
  detailSelect?.addEventListener("change", () => {
    setDetailProfile(detailSelect.value);
    syncColorsUi();
  });

  const printSelect = /** @type {HTMLSelectElement|null} */ (
    document.getElementById("print-profile")
  );
  printSelect?.addEventListener("change", () => {
    const changed = setPrintProfile(printSelect.value);
    if (changed) {
      void runDependentProcessingPipeline("nozzle-change", { stayOnStage: true })
        .then(() => syncControlsFromState());
    }
    syncColorsUi();
    syncPrintabilityUi();
    syncContinueButtons();
  });

  bindPrintabilityControls();
  bindColorsControls(getCropSize);
  bindExportControls();
  bindContinueControls();
  bindProgressControls();
  bindReliefEditorControls();

  bindPointerPan(canvas, getCropSize, scheduleRedraw);
  bindWheelZoom(canvas, getCropSize, scheduleRedraw);

  syncControlsFromState();
}

function bindReliefEditorControls() {
  const editBtn = document.getElementById("btn-edit-relief");

  /** @param {boolean} open */
  function setReliefEditorVisible(open) {
    const s = getState();
    const shouldOpen = open && s.surface.style === "relief";
    const editor = document.getElementById("export-relief-editor");
    if (editor) editor.hidden = !shouldOpen;
    setReliefEditorOpen(shouldOpen);
    if (editBtn) {
      editBtn.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
      editBtn.classList.toggle("is-active", shouldOpen);
    }
    const exportPanel = document.querySelector('[data-panel="export"]');
    if (shouldOpen && exportPanel instanceof HTMLElement) {
      renderReliefEditorHeavy(exportPanel);
    }
  }

  if (editBtn && !editBtn.dataset.bound) {
    editBtn.dataset.bound = "1";
    editBtn.addEventListener("click", () => {
      const s = getState();
      if (s.surface.style !== "relief") {
        return;
      }
      const editor = document.getElementById("export-relief-editor");
      setReliefEditorVisible(Boolean(editor?.hidden));
    });
  }
}

function bindContinueControls() {
  document.getElementById("btn-continue-colors")?.addEventListener("click", () => {
    if (!getRuntimeBitmap()) return;
    setActiveStep("colors");
    document.getElementById("btn-quantize")?.focus();
  });
  document.getElementById("btn-continue-print")?.addEventListener("click", () => {
    const readiness = getExportReadiness();
    if (!readiness.quantizationCurrent) return;
    setActiveStep("printability");
    document.getElementById("btn-accept-cleanup")?.focus();
  });
  document.getElementById("btn-continue-download")?.addEventListener("click", () => {
    if (!isPrintabilityExportReady()) return;
    setActiveStep("export");
    void ensureModelAfterApproval().then(() => {
      syncControlsFromState();
      document.getElementById("btn-download-combined-stl")?.focus();
    });
  });
}

function bindPrintabilityControls() {
  document.getElementById("btn-analyze-print")?.addEventListener("click", () => {
    void analyzePrintabilityAction().then(() => syncControlsFromState());
  });
  document.getElementById("btn-clean-print")?.addEventListener("click", () => {
    void cleanPrintabilityAction().then(() => syncControlsFromState());
  });
  document.getElementById("btn-accept-cleanup")?.addEventListener("click", () => {
    acceptCleanupAction();
    syncPrintabilityUi();
    syncContinueButtons();
  });
  document.getElementById("btn-reset-cleanup")?.addEventListener("click", () => {
    resetCleanupAction();
    const cleanBtn = /** @type {HTMLButtonElement|null} */ (
      document.getElementById("btn-clean-print")
    );
    if (cleanBtn) cleanBtn.hidden = false;
    syncPrintabilityUi();
  });

  document.querySelectorAll('input[name="print-comparison"]').forEach((input) => {
    input.addEventListener("change", () => {
      const elInput = /** @type {HTMLInputElement} */ (input);
      if (!elInput.checked) return;
      const mode = /** @type {"quantized"|"issues"|"cleaned"|"side-by-side"} */ (elInput.value);
      setPrintabilityComparisonMode(mode);
      syncPrintabilityUi();
    });
  });
}

/**
 * @param {() => { width: number, height: number }} getCropSize
 */
function bindColorsControls(getCropSize) {
  document.getElementById("btn-quantize")?.addEventListener("click", () => {
    void runQuantization(getCropSize());
  });

  document.getElementById("btn-reset-palette")?.addEventListener("click", () => {
    resetAllPaletteOverrides();
    syncColorsUi();
  });

  document.querySelectorAll('input[name="transparency-mode"]').forEach((input) => {
    input.addEventListener("change", () => {
      const elInput = /** @type {HTMLInputElement} */ (input);
      if (!elInput.checked) return;
      const mode = /** @type {"white"|"black"|"custom"} */ (elInput.value);
      patchQuantization({ transparencyMode: mode });
      syncColorsUi();
      if (getRuntimeBitmap() && getRuntimeQuantization().indices) {
        void runDependentProcessingPipeline("transparency").then(() => syncControlsFromState());
      }
    });
  });

  const customBg = /** @type {HTMLInputElement|null} */ (document.getElementById("custom-bg-color"));
  customBg?.addEventListener("input", () => {
    const parsed = parseHexColor(customBg.value);
    if (!parsed.ok) return;
    patchQuantization({
      transparencyMode: "custom",
      customBackground: parsed.value,
    });
    const customRadio = /** @type {HTMLInputElement|null} */ (
      document.getElementById("transparency-custom")
    );
    if (customRadio) customRadio.checked = true;
    syncColorsUi();
  });

  document.getElementById("compare-mode")?.addEventListener("change", () => {
    syncCompareMode();
  });

  document.querySelectorAll('input[name="compare-mode-seg"]').forEach((input) => {
    input.addEventListener("change", () => {
      const elInput = /** @type {HTMLInputElement} */ (input);
      if (!elInput.checked) return;
      const select = /** @type {HTMLSelectElement|null} */ (
        document.getElementById("compare-mode")
      );
      if (select) {
        select.value = elInput.value;
        syncCompareMode();
      }
    });
  });
}

/**
 * Reflect state into control widgets and step visibility.
 */
export function syncControlsFromState() {
  const s = getState();
  const wf = getRuntimeWorkflow();
  const readiness = getExportReadiness();
  document.querySelectorAll(".step-button").forEach((button) => {
    const step = button.getAttribute("data-step");
    const active = step === s.ui.activeStep;
    button.classList.toggle("is-active", active);
    if (active) {
      button.setAttribute("aria-current", "step");
    } else {
      button.removeAttribute("aria-current");
    }
    // Stage presentation states for Milestone 7.4 navigation.
    button.classList.remove("is-complete", "is-updating", "is-needs-review", "is-unavailable");
    if (step === "image" && readiness.imageLoaded) button.classList.add("is-complete");
    if (step === "colors" && readiness.quantizationCurrent) button.classList.add("is-complete");
    if (step === "printability" && readiness.cleanupCurrent) button.classList.add("is-complete");
    if (step === "export" && readiness.geometryValid && readiness.canDownload) {
      button.classList.add("is-complete");
    }
    const st = normalizeWorkflowStatus(wf.pipelineStatus);
    if (
      (step === "colors" || step === "printability")
      && isColorPrintableBusy(st)
    ) {
      button.classList.add("is-updating");
    }
    if (step === "printability" && (wf.needsReview || st === "waiting-for-review")) {
      button.classList.add("is-needs-review");
    }
    if (step === "export" && (
      !readiness.imageLoaded
      || wf.needsReview
      || wf.cropNeedsUpdate
      || st === "waiting-for-review"
      || isColorPrintableBusy(st)
    )) {
      button.classList.add("is-unavailable");
    }
    if (step === "export" && (st === "building-model" || st === "validating-model")) {
      button.classList.add("is-updating");
    }
  });

  document.querySelectorAll(".control-section").forEach((section) => {
    const panel = section.getAttribute("data-panel");
    const active = panel === s.ui.activeStep;
    section.hidden = !active;
    section.classList.toggle("is-active", active);
  });

  const zoom = /** @type {HTMLInputElement|null} */ (document.getElementById("zoom"));
  const zoomOut = /** @type {HTMLOutputElement|null} */ (document.getElementById("zoom-value"));
  if (zoom && document.activeElement !== zoom) {
    zoom.value = String(s.transform.scale);
  }
  if (zoomOut) zoomOut.value = s.transform.scale.toFixed(2);

  setInputValue("color-count", s.quantization.colorCount);

  const detailSelect = /** @type {HTMLSelectElement|null} */ (
    document.getElementById("detail-profile")
  );
  if (detailSelect && document.activeElement !== detailSelect) {
    detailSelect.value = s.quantization.detailProfileId;
  }

  const printSelect = /** @type {HTMLSelectElement|null} */ (
    document.getElementById("print-profile")
  );
  if (printSelect && document.activeElement !== printSelect) {
    printSelect.value = s.printability.profileId;
  }

  const updateDesignBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("btn-update-design")
  );
  if (updateDesignBtn) {
    const show = Boolean(wf.cropNeedsUpdate && getRuntimeBitmap());
    updateDesignBtn.hidden = !show;
    updateDesignBtn.disabled = !show || isColorPrintableBusy(wf.pipelineStatus);
  }

  const pipelineStatusEl = document.getElementById("pipeline-status");
  if (pipelineStatusEl) {
    // Prefer in-panel progress cards; keep header status as a compact fallback.
    pipelineStatusEl.hidden = true;
  }

  syncProgressUi();
  syncPreviewUpdatingOverlay();

  const err = document.getElementById("status-error");
  const notice = document.getElementById("status-notice");
  if (err) {
    if (s.ui.error || wf.error) {
      err.hidden = false;
      err.textContent = (wf.error && wf.error.message) || s.ui.error || "";
    } else {
      err.hidden = true;
      err.textContent = "";
    }
  }
  if (notice) {
    if (s.ui.notice) {
      notice.hidden = false;
      notice.textContent = s.ui.notice;
    } else {
      notice.hidden = true;
      notice.textContent = "";
    }
  }

  syncImageImportUi();
  syncColorsUi();
  syncPrintabilityUi();
  syncExportUi();
  syncContinueButtons();
  renderAppStatus(resolveActivePanelStatus());
}

/**
 * @returns {{ label: string, message: string, kind: import("./notifications.js").StatusKind } | null}
 */
function resolveActivePanelStatus() {
  const s = getState();
  const wf = getRuntimeWorkflow();
  const st = normalizeWorkflowStatus(wf.pipelineStatus);
  const stepLabel = STEP_LABELS[s.ui.activeStep] || "Status";

  if (isBusyWorkflowStatus(st) || isColorPrintableBusy(st)) {
    const message = wf.progressMessage || wf.progressStageLabel || "Working…";
    return { label: stepLabel, message, kind: "busy" };
  }

  if (st === "error" && wf.error?.message) {
    return { label: stepLabel, message: wf.error.message, kind: "error" };
  }

  if (s.ui.activeStep === "colors") {
    const message = document.getElementById("quantize-status")?.textContent?.trim() || "";
    if (!message || message.startsWith("Press Create color preview")) return null;
    return { label: stepLabel, message, kind: inferStatusKind(message) };
  }

  if (s.ui.activeStep === "printability") {
    const message = document.getElementById("print-status")?.textContent?.trim() || "";
    if (!message || message.startsWith("Waiting for automatic check")) return null;
    return { label: stepLabel, message, kind: inferStatusKind(message) };
  }

  if (s.ui.activeStep === "export") {
    const geometry = document.getElementById("geometry-status")?.textContent?.trim() || "";
    const threeMf = document.getElementById("export-3mf-status")?.textContent?.trim() || "";
    const message = threeMf && threeMf !== geometry ? threeMf : geometry;
    if (!message || message === "Model not built yet.") return null;
    return { label: stepLabel, message, kind: inferStatusKind(message) };
  }

  return null;
}

function bindExportControls() {
  const exportPanel = document.querySelector('[data-panel="export"]');
  if (exportPanel instanceof HTMLElement) {
    bindSurfaceControls(exportPanel);
  }
  document.getElementById("btn-generate-model")?.addEventListener("click", () => {
    generateModelAction().then(() => syncExportUi());
  });
  document.getElementById("btn-download-combined-stl")?.addEventListener("click", () => {
    downloadStlAction("combined");
  });
  document.getElementById("btn-download-base-stl")?.addEventListener("click", () => {
    downloadStlAction("base");
  });
  document.getElementById("btn-download-all-colors-stl")?.addEventListener("click", () => {
    downloadAllColorStlsAction();
  });
  document.getElementById("btn-download-geometry-debug")?.addEventListener("click", () => {
    downloadGeometryDebugCaseAction();
  });
  document.getElementById("btn-export-3mf")?.addEventListener("click", () => {
    downloadThreeMfAction().then(() => syncExportUi());
  });
  document.getElementById("btn-download-3mf-diagnostics")?.addEventListener("click", () => {
    downloadThreeMfDiagnosticsAction();
  });
  const baseColorInput = /** @type {HTMLInputElement|null} */ (
    document.getElementById("export-base-color")
  );
  baseColorInput?.addEventListener("input", () => {
    if (!baseColorInput) return;
    setBaseColorAction(baseColorInput.value);
    syncExportUi();
  });
}

function syncExportUi() {
  const readiness = getExportReadiness();
  const rg = getRuntimeGeometry();
  const s = getState();
  const canDownload = readiness.canDownload && FEATURES.stlExport;

  const exportPanel = document.querySelector('[data-panel="export"]');
  if (exportPanel instanceof HTMLElement) {
    renderSurfaceControls(exportPanel);
  }

  const readinessEl = document.getElementById("export-readiness");
  if (readinessEl) {
    readinessEl.innerHTML = "";
    const checks = [
      ["Image added", readiness.imageLoaded],
      ["Color preview created", readiness.quantizationCurrent],
      ["Printable design approved", readiness.cleanupAccepted && readiness.cleanupCurrent],
      ["Model ready", readiness.geometryValid],
    ];
    for (const [label, ok] of checks) {
      const row = document.createElement("div");
      row.className = `export-check ${ok ? "is-ok" : "is-missing"}`;
      if (ok) {
        row.classList.add("is-complete");
      }
      row.textContent = `${ok ? "✓" : "○"} ${label}`;
      readinessEl.appendChild(row);
    }
  }

  const gapsEl = document.getElementById("export-gaps");
  if (gapsEl) {
    if (readiness.gaps.length) {
      gapsEl.hidden = false;
      gapsEl.textContent = readiness.gaps.join(" ");
    } else {
      gapsEl.hidden = true;
      gapsEl.textContent = "";
    }
  }

  const statusEl = document.getElementById("geometry-status");
  if (statusEl) statusEl.textContent = getGeometryStatusLabel();

  const validationEl = document.getElementById("geometry-validation");
  const validationDetails = document.getElementById("geometry-validation-details");
  const debugBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("btn-download-geometry-debug")
  );
  const canExportDebug = Boolean(
    getRuntimePrintability().cleanedIndices
    && isPrintabilityExportReady(s, getRuntimePrintability()),
  );
  if (debugBtn) debugBtn.disabled = !canExportDebug;
  if (validationEl) {
    if (rg.reasons && rg.reasons.length) {
      if (validationDetails) validationDetails.hidden = false;
      validationEl.textContent = formatGeometryTechnicalDetails({
        reasons: rg.reasons,
        validation: rg.validation,
      });
    } else if (rg.status === "ready" && isGeometryDownloadReady()) {
      if (validationDetails) validationDetails.hidden = false;
      const c = rg.validation && rg.validation.combined;
      const tris = c && c.triangleCount != null ? c.triangleCount : (rg.combined ? rg.combined.triangles.length / 3 : 0);
      validationEl.textContent = `Validation passed — combined ${tris} triangles.`;
    } else if (canExportDebug) {
      if (validationDetails) validationDetails.hidden = false;
      validationEl.textContent = "Build the model to see validation details. You can still download a geometry debug case.";
    } else {
      if (validationDetails) validationDetails.hidden = true;
      validationEl.textContent = "";
    }
  }

  const genBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("btn-generate-model"));
  if (genBtn) {
    genBtn.disabled = !readiness.canGenerate || rg.status === "processing";
    genBtn.classList.toggle("is-loading", rg.status === "processing");
    genBtn.title = readiness.canGenerate
      ? "Build Tile V1 meshes from the approved printable design"
      : (readiness.gaps[0] || "Finish earlier steps first");
    genBtn.textContent = rg.status === "processing" ? "Building…" : "Rebuild model";
  }

  const combinedBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("btn-download-combined-stl")
  );
  if (combinedBtn) {
    combinedBtn.disabled = !canDownload;
    combinedBtn.textContent = s.surface.style === "relief"
      ? "Download Relief STL"
      : "Download one-filament STL";
  }

  const setDl = (id, enabled) => {
    const btn = /** @type {HTMLButtonElement|null} */ (document.getElementById(id));
    if (btn) btn.disabled = !enabled;
  };
  setDl("btn-download-base-stl", canDownload && FEATURES.alignedStlExport);
  setDl("btn-download-all-colors-stl", canDownload && FEATURES.alignedStlExport && rg.colors.length > 0);

  const threeMfBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("btn-export-3mf")
  );
  const r3 = getRuntimeThreeMf();
  if (threeMfBtn) {
    const busy = r3.status === "processing";
    threeMfBtn.disabled = !readiness.canDownloadThreeMf || busy;
    threeMfBtn.classList.toggle("is-loading", busy);
    const relief = s.surface.style === "relief";
    threeMfBtn.textContent = busy
      ? "Creating multicolor file…"
      : (relief ? "Download Relief multicolor 3MF" : "Download multicolor 3MF");
    threeMfBtn.title = readiness.canDownloadThreeMf
      ? (relief
        ? "Download base + relief color parts as one multicolor file"
        : "Download base + artwork colors as one multicolor file")
      : (readiness.threeMfHint || "Multicolor download is not available");
  }

  const threeMfStatus = document.getElementById("export-3mf-status");
  if (threeMfStatus) {
    threeMfStatus.textContent = getThreeMfStatusLabel();
  }
  const threeMfTechDetails = document.getElementById("export-3mf-tech-details");
  const threeMfTech = document.getElementById("export-3mf-tech");
  const threeMfDiagBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("btn-download-3mf-diagnostics")
  );
  if (threeMfTechDetails && threeMfTech) {
    if (r3.status === "error" && r3.error) {
      threeMfTechDetails.hidden = false;
      threeMfTech.textContent = getThreeMfTechnicalDetailsText();
    } else if (r3.status === "ready" && r3.manifest) {
      threeMfTechDetails.hidden = false;
      threeMfTech.textContent = [
        `Objects: ${r3.manifest.objectCount} (children ${r3.manifest.childObjectCount} + parent)`,
        `Build items: ${r3.manifest.buildItemCount}`,
        `ZIP bytes: ${r3.manifest.byteLength}`,
        `Vertices: ${r3.manifest.vertexCount}`,
        `Triangles: ${r3.manifest.triangleCount}`,
      ].join("\n");
    } else {
      threeMfTechDetails.hidden = true;
      threeMfTech.textContent = "";
    }
  }
  if (threeMfDiagBtn) {
    const showDiag = isThreeMfDevDiagnosticsEnabled()
      && (r3.status === "error" || r3.status === "ready");
    threeMfDiagBtn.hidden = !showDiag;
    threeMfDiagBtn.disabled = !showDiag;
  }

  const base = normalizeBaseColor(s.export.baseColor || DEFAULT_BASE_COLOR);
  const baseHex = rgbToFilenameHex(base.r, base.g, base.b);
  const baseColorInput = /** @type {HTMLInputElement|null} */ (
    document.getElementById("export-base-color")
  );
  const baseColorHex = document.getElementById("export-base-color-hex");
  if (baseColorInput) {
    const nextValue = `#${baseHex.toLowerCase()}`;
    if (baseColorInput.value.toLowerCase() !== nextValue) {
      baseColorInput.value = nextValue;
    }
  }
  if (baseColorHex) baseColorHex.textContent = `#${baseHex}`;

  const swatchHost = document.getElementById("export-3mf-swatches");
  if (swatchHost) {
    swatchHost.innerHTML = "";
    if (readiness.canDownloadThreeMf || readiness.usedArtworkColorCount > 0) {
      const colors = getEffectiveExportColors();
      for (const color of colors) {
        const swatch = document.createElement("span");
        swatch.className = "export-3mf-swatch";
        swatch.style.background = `rgb(${color.r}, ${color.g}, ${color.b})`;
        swatch.title = `#${rgbToFilenameHex(color.r, color.g, color.b)}`;
        swatchHost.appendChild(swatch);
      }
    }
  }

  const colorHost = document.getElementById("export-color-downloads");
  if (colorHost) {
    colorHost.innerHTML = "";
    const colors = getEffectiveExportColors();
    if (colors.length) {
      const heading = document.createElement("p");
      heading.className = "field-label";
      heading.textContent = "Download each color STL";
      colorHost.appendChild(heading);
    }
    colors.forEach((color, i) => {
      const row = document.createElement("div");
      row.className = "export-color-row";
      const swatch = document.createElement("span");
      swatch.className = "export-color-swatch";
      swatch.style.background = `rgb(${color.r}, ${color.g}, ${color.b})`;
      const label = document.createElement("span");
      label.className = "export-color-label";
      label.textContent = `Color ${String(i + 1).padStart(2, "0")} · ${color.population} px · #${
        [color.r, color.g, color.b].map((n) => n.toString(16).toUpperCase().padStart(2, "0")).join("")
      }`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "button button-secondary";
      btn.textContent = "Download STL";
      btn.disabled = !canDownload;
      btn.addEventListener("click", () => downloadStlAction(color.paletteIndex));
      row.append(swatch, label, btn);
      colorHost.appendChild(row);
    });
  }
}

function syncContinueButtons() {
  const hasImage = Boolean(getRuntimeBitmap());
  const readiness = getExportReadiness();
  const wf = getRuntimeWorkflow();

  const toColors = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("btn-continue-colors")
  );
  if (toColors) toColors.disabled = !hasImage;

  const toPrint = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("btn-continue-print")
  );
  if (toPrint) toPrint.disabled = !readiness.quantizationCurrent;

  const toDownload = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("btn-continue-download")
  );
  if (toDownload) {
    const ready = readiness.cleanupAccepted && readiness.cleanupCurrent;
    toDownload.disabled = !ready;
    toDownload.hidden = !ready;
  }
  const acceptBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("btn-accept-cleanup")
  );
  if (acceptBtn) {
    acceptBtn.hidden = Boolean(readiness.cleanupAccepted && readiness.cleanupCurrent);
  }

  syncImageFooterHint(hasImage, wf.cropNeedsUpdate);
  // Re-sync after accept visibility is finalized (approved → Continue to download).
  syncPrintFooterHint(getAcceptCleanupButtonState(), acceptBtn);
}

/**
 * Prefer the active stage panel so sync stays correct if duplicate mounts exist.
 * @param {string} id
 * @returns {HTMLElement | null}
 */
function activePanelElementById(id) {
  const step = getState().ui.activeStep;
  const panel = document.querySelector(`.control-section[data-panel="${step}"]`);
  const scoped = panel?.querySelector(`#${id}`);
  if (scoped) return /** @type {HTMLElement} */ (scoped);
  return /** @type {HTMLElement|null} */ (document.getElementById(id));
}

/**
 * Visible Image-stage footer prerequisite copy.
 * @param {boolean} hasImage
 * @param {boolean} cropNeedsUpdate
 */
function syncImageFooterHint(hasImage, cropNeedsUpdate) {
  const hint = activePanelElementById("image-footer-hint");
  if (!hint) return;
  let message = "";
  if (!hasImage) {
    message = "Choose an image to continue.";
  } else if (cropNeedsUpdate) {
    message = "Update design to apply your crop changes, then continue.";
  }
  hint.hidden = !message;
  hint.textContent = message;
}

/**
 * Visible Make printable footer prerequisite when Use this design is blocked.
 * Busy/error copy stays on .workflow-footer-status via syncProgressUi.
 * @param {{ enabled: boolean, reason: string | null }} acceptState
 * @param {HTMLButtonElement | null} acceptBtn
 */
function syncPrintFooterHint(acceptState, acceptBtn) {
  const hint = activePanelElementById("print-footer-hint");
  if (!hint) return;
  const wf = getRuntimeWorkflow();
  const st = normalizeWorkflowStatus(wf.pipelineStatus);
  const busy = isColorPrintableBusy(st) || isBusyWorkflowStatus(st);
  const acceptInPanel = /** @type {HTMLButtonElement|null} */ (
    activePanelElementById("btn-accept-cleanup") || acceptBtn
  );
  const acceptVisible = Boolean(acceptInPanel) && !acceptInPanel.hidden;
  const showReason = acceptVisible && !acceptState.enabled && !busy && Boolean(acceptState.reason);
  hint.hidden = !showReason;
  hint.textContent = showReason ? (acceptState.reason || "") : "";
}

function syncPreviewUpdatingOverlay() {
  const shell = document.getElementById("canvas-shell");
  if (!shell) return;
  const wf = getRuntimeWorkflow();
  const busy = isBusyWorkflowStatus(normalizeWorkflowStatus(wf.pipelineStatus));
  shell.classList.toggle("is-updating", busy);
  let overlay = shell.querySelector(".preview-updating-overlay");
  if (busy) {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "preview-updating-overlay";
      overlay.setAttribute("aria-hidden", "true");
      overlay.textContent = "Updating…";
      shell.appendChild(overlay);
    }
  } else if (overlay) {
    overlay.remove();
  }
}

function syncPrintabilityUi() {
  const settings = getPrintSettings();
  const nozzle = document.getElementById("print-derived-nozzle");
  const feature = document.getElementById("print-derived-feature");
  const gap = document.getElementById("print-derived-gap");
  const island = document.getElementById("print-derived-island");
  const hole = document.getElementById("print-derived-hole");
  if (nozzle) nozzle.textContent = `${settings.nozzleDiameterMm} mm`;
  if (feature) feature.textContent = `${settings.minimumFeatureWidthMm} mm`;
  if (gap) gap.textContent = `${settings.minimumGapWidthMm} mm`;
  if (island) island.textContent = `${settings.minimumIslandAreaMm2} mm²`;
  if (hole) hole.textContent = `${settings.maximumHoleAreaToFillMm2} mm²`;

  const statusEl = document.getElementById("print-status");
  const wf = getRuntimeWorkflow();
  if (statusEl) {
    const st = normalizeWorkflowStatus(wf.pipelineStatus);
    if (isColorPrintableBusy(st)) {
      statusEl.textContent = wf.progressMessage || getPipelineStatusLabel();
    } else if (wf.needsReview || st === "waiting-for-review") {
      statusEl.textContent = wf.progressMessage || "Review the updated design before downloading";
    } else if (st === "error" && wf.error) {
      statusEl.textContent = wf.error.message;
    } else {
      statusEl.textContent = getPrintabilityStatusLabel();
    }
  }

  const printProfileHelp = document.getElementById("print-profile-help");
  if (printProfileHelp && !printProfileHelp.dataset.m74) {
    printProfileHelp.textContent = "Nozzle size prepares image detail automatically. Select the matching nozzle in your slicer before printing.";
    printProfileHelp.dataset.m74 = "1";
  }

  const analyzeBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("btn-analyze-print"));
  const cleanBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("btn-clean-print"));
  const acceptBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("btn-accept-cleanup"));
  const resetBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("btn-reset-cleanup"));

  const analyzeState = getAnalyzeButtonState();
  const cleanState = getCleanButtonState();
  const acceptState = getAcceptCleanupButtonState();
  const resetState = getResetCleanupButtonState();
  const rpLoading = getRuntimePrintability();
  const loadingOperation = rpLoading.status === "analyzing"
    ? (rpLoading.activeOperation === "clean" ? "clean" : "analyze")
    : null;

  if (analyzeBtn) {
    analyzeBtn.disabled = !analyzeState.enabled;
    analyzeBtn.title = analyzeState.reason || "Check the design for printing problems";
    analyzeBtn.classList.toggle("is-loading", loadingOperation === "analyze");
  }
  if (cleanBtn) {
    cleanBtn.disabled = !cleanState.enabled;
    cleanBtn.title = cleanState.reason || "Fix tiny areas that may not print";
    cleanBtn.classList.toggle("is-loading", loadingOperation === "clean");
    // Secondary retry only after undo or when no cleaned preview exists.
    const showFix = !getRuntimePrintability().cleanedIndices || cleanBtn.hidden === false;
    if (!getRuntimePrintability().cleanedIndices) {
      cleanBtn.hidden = false;
    } else if (getRuntimePrintability().accepted) {
      cleanBtn.hidden = true;
    }
    void showFix;
  }
  if (acceptBtn) {
    acceptBtn.disabled = !acceptState.enabled;
    acceptBtn.title = acceptState.reason || "Approve this printable design";
    const approved = Boolean(getRuntimePrintability().accepted)
      && !isPrintabilityStale();
    acceptBtn.hidden = approved;
  }
  syncPrintFooterHint(acceptState, acceptBtn);
  if (resetBtn) {
    resetBtn.disabled = !resetState.enabled;
    resetBtn.title = resetState.reason || "Undo automatic fixes";
  }

  const s = getState();
  const mode = s.printability.comparisonMode || "quantized";
  const radio = /** @type {HTMLInputElement|null} */ (
    document.querySelector(`input[name="print-comparison"][value="${mode}"]`)
  );
  if (radio) radio.checked = true;

  const rp = getRuntimePrintability();
  const summaryEl = document.getElementById("print-issue-summary");
  if (summaryEl) {
    const summary = getPlainIssueSummary(rp.report, {
      ranCleanup: Boolean(rp.cleanedIndices),
    });
    if (summary && rp.report && !isPrintabilityStale()) {
      summaryEl.hidden = false;
      summaryEl.textContent = summary;
    } else {
      summaryEl.hidden = true;
      summaryEl.textContent = "";
    }
  }

  const reportRoot = document.getElementById("print-report");
  const stats = document.getElementById("print-report-stats");
  const warnings = document.getElementById("print-report-warnings");
  if (reportRoot && stats && warnings) {
    if (rp.report) {
      reportRoot.hidden = false;
      stats.replaceChildren();
      const rows = [
        ["Components", String(rp.report.componentCount)],
        ["Small islands", `${rp.report.smallIslandCount} (${rp.report.smallIslandPixels} px)`],
        ["Small holes", `${rp.report.smallHoleCount} (${rp.report.smallHolePixels} px)`],
        ["Narrow feature px", String(rp.report.narrowFeaturePixelCount)],
        ["Narrow gap px", String(rp.report.narrowGapPixelCount)],
        ["Cleanup passes", String(rp.report.cleanupPasses)],
        ["Changed pixels", String(rp.report.changedPixelCount)],
      ];
      for (const [dt, dd] of rows) {
        const row = document.createElement("div");
        row.className = "derived-row";
        const dtEl = document.createElement("dt");
        dtEl.textContent = dt;
        const ddEl = document.createElement("dd");
        ddEl.textContent = dd;
        row.append(dtEl, ddEl);
        stats.appendChild(row);
      }
      warnings.replaceChildren();
      for (const w of rp.report.warnings || []) {
        const li = document.createElement("li");
        li.textContent = w;
        warnings.appendChild(li);
      }
    } else {
      reportRoot.hidden = true;
    }
  }

  // paint comparison canvases
  paintPrintabilityPreviews();
}

/**
 * Paint quantized / issues / cleaned comparison canvases.
 */
function paintPrintabilityPreviews() {
  const s = getState();
  const rq = getRuntimeQuantization();
  const rp = getRuntimePrintability();
  const mode = s.printability.comparisonMode || "quantized";
  const grid = document.getElementById("print-compare-grid");
  if (grid) {
    grid.setAttribute("data-mode", mode);
    grid.querySelectorAll(".preview-figure").forEach((figure) => {
      const kind = figure.getAttribute("data-print-view");
      let show = false;
      if (mode === "side-by-side") {
        show = kind === "quantized" || kind === "cleaned";
      } else {
        show = kind === mode;
      }
      /** @type {HTMLElement} */ (figure).hidden = !show;
    });
  }

  if (!rq.indices || rq.width < 1 || rq.height < 1) {
    return;
  }

  const palette = effectivePalette(
    buildPaletteEntries(rq.generatedPalette, s.quantization.paletteOverrides),
  );

  const quantizedCanvas = /** @type {HTMLCanvasElement|null} */ (
    document.getElementById("print-quantized-canvas")
  );
  const issuesCanvas = /** @type {HTMLCanvasElement|null} */ (
    document.getElementById("print-issues-canvas")
  );
  const cleanedCanvas = /** @type {HTMLCanvasElement|null} */ (
    document.getElementById("print-cleaned-canvas")
  );

  const baseRgba = indicesToRgba(rq.indices, palette, rq.width, rq.height);
  paintRgbaToCanvas(quantizedCanvas, baseRgba, rq.width, rq.height);

  if (rp.issueMask && rp.issueMask.length === rq.width * rq.height) {
    const overlay = new Uint8ClampedArray(baseRgba);
    const colors = {
      [IssueCategory.SMALL_ISLAND]: [220, 60, 60, 200],
      [IssueCategory.SMALL_HOLE]: [40, 120, 220, 200],
      [IssueCategory.NARROW_FEATURE]: [230, 160, 20, 200],
      [IssueCategory.NARROW_GAP]: [140, 60, 200, 200],
    };
    for (let i = 0; i < rp.issueMask.length; i += 1) {
      const cat = rp.issueMask[i];
      if (cat === IssueCategory.NONE) continue;
      const c = colors[cat];
      if (!c) continue;
      const o = i * 4;
      // Blend diagnostic colour over the quantized preview (UI only).
      const a = c[3] / 255;
      overlay[o] = Math.round(overlay[o] * (1 - a) + c[0] * a);
      overlay[o + 1] = Math.round(overlay[o + 1] * (1 - a) + c[1] * a);
      overlay[o + 2] = Math.round(overlay[o + 2] * (1 - a) + c[2] * a);
      overlay[o + 3] = 255;
    }
    paintRgbaToCanvas(issuesCanvas, overlay, rq.width, rq.height);
  } else {
    paintRgbaToCanvas(issuesCanvas, baseRgba, rq.width, rq.height);
  }

  if (rp.cleanedIndices && rp.cleanedIndices.length === rq.width * rq.height) {
    const cleanedRgba = indicesToRgba(rp.cleanedIndices, palette, rq.width, rq.height);
    paintRgbaToCanvas(cleanedCanvas, cleanedRgba, rq.width, rq.height);
  } else {
    paintRgbaToCanvas(cleanedCanvas, baseRgba, rq.width, rq.height);
  }
}

/**
 * @param {HTMLCanvasElement | null} canvas
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 */
function paintRgbaToCanvas(canvas, rgba, width, height) {
  if (!canvas) return;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
}

function syncColorsUi() {
  if (!FEATURES.quantization) return;

  const s = getState();
  const rq = getRuntimeQuantization();
  const buttonState = getQuantizeButtonState();
  const quantizeBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("btn-quantize"));
  if (quantizeBtn) {
    quantizeBtn.disabled = !buttonState.enabled;
    quantizeBtn.title = buttonState.reason || "Create a deterministic 1–8 color preview";
    quantizeBtn.classList.toggle("is-loading", rq.status === "processing");
    quantizeBtn.textContent = rq.status === "processing" ? "Creating preview…" : "Create color preview";
  }

  const ppm = getResolutionPxPerMm(s);
  const pixelSizeMm = 1 / ppm;
  const resHint = document.getElementById("resolution-hint");
  const autoDetail = document.getElementById("automatic-detail-value");
  const res = validateQuantizationResolution(ppm);
  if (autoDetail) {
    const prepared = pixelSizeMm.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    autoDetail.textContent = `Prepared at ${prepared} mm detail`;
  }
  if (resHint) {
    if (res.ok) {
      resHint.textContent = `Output ${res.value.widthPx}×${res.value.heightPx} px `
        + `(${res.value.totalPixels.toLocaleString()} pixels).`;
      resHint.classList.remove("help-pending");
    } else {
      resHint.textContent = res.error.message;
      resHint.classList.add("help-pending");
    }
  }

  const detailWarning = document.getElementById("detail-warning");
  if (detailWarning) {
    detailWarning.hidden = false;
  }

  const mode = s.quantization.transparencyMode;
  const radio = /** @type {HTMLInputElement|null} */ (
    document.querySelector(`input[name="transparency-mode"][value="${mode}"]`)
  );
  if (radio) radio.checked = true;

  const customField = document.getElementById("custom-bg-field");
  if (customField) customField.hidden = mode !== "custom";
  const customBg = /** @type {HTMLInputElement|null} */ (document.getElementById("custom-bg-color"));
  if (customBg && document.activeElement !== customBg) {
    customBg.value = formatHexColor(s.quantization.customBackground).toLowerCase();
  }

  const status = document.getElementById("quantize-status");
  if (status) {
    if (rq.status === "processing") {
      status.textContent = "Creating color preview…";
    } else if (rq.status === "error" && rq.error) {
      status.textContent = rq.error.message;
    } else if (rq.status === "ready") {
      status.textContent = `Color preview ready — ${rq.generatedPalette.length} colors at ${rq.width}×${rq.height}.`;
    } else {
      status.textContent = "Press Create color preview to build a 1–8 color preview.";
    }
  }

  const stale = document.getElementById("stale-notice");
  if (stale) {
    const showStale = isQuantizationStale() && Boolean(rq.indices);
    stale.hidden = !showStale;
  }

  const diag = document.getElementById("quantize-diagnostics");
  const diagDetails = document.getElementById("quantize-diagnostics-details");
  if (diag) {
    if (rq.diagnostics && rq.indices) {
      if (diagDetails) diagDetails.hidden = false;
      diag.textContent = `Unique colors: ${rq.diagnostics.uniqueColorCount} · `
        + `Iterations: ${rq.diagnostics.iterations} · `
        + `Worker time: ${rq.diagnostics.durationMs.toFixed(1)} ms`
        + (isQuantizationStale() ? " · needs update" : "");
    } else {
      if (diagDetails) diagDetails.hidden = true;
      diag.textContent = "";
    }
  }

  renderPaletteEditor();
  syncCompareMode();
  paintColorsPreviews();
}

function renderPaletteEditor() {
  const list = document.getElementById("palette-list");
  const empty = document.getElementById("palette-empty");
  const resetBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("btn-reset-palette"));
  if (!list) return;

  const entries = getPaletteEntriesForUi();
  const totalPop = entries.reduce((sum, e) => sum + e.population, 0) || 1;
  list.innerHTML = "";

  if (!entries.length) {
    if (empty) empty.hidden = false;
    if (resetBtn) resetBtn.disabled = true;
    return;
  }
  if (empty) empty.hidden = true;
  if (resetBtn) resetBtn.disabled = false;

  entries.forEach((entry, index) => {
    const effective = entry.override || entry.generated;
    const hex = formatHexColor(effective);
    const pct = ((entry.population / totalPop) * 100).toFixed(1);
    const li = document.createElement("li");
    li.className = "palette-item";
    li.innerHTML = "";

    const swatch = document.createElement("span");
    swatch.className = "palette-swatch";
    swatch.style.background = hex;
    swatch.title = hex;

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "input input-color";
    colorInput.value = hex.toLowerCase();
    colorInput.setAttribute("aria-label", `Palette color ${index + 1}`);
    colorInput.addEventListener("input", () => {
      const parsed = parseHexColor(colorInput.value);
      if (!parsed.ok) return;
      applyPaletteOverride(index, parsed.value);
      hexInput.value = formatHexColor(parsed.value);
      swatch.style.background = formatHexColor(parsed.value);
      paintColorsPreviews();
    });

    const hexInput = document.createElement("input");
    hexInput.type = "text";
    hexInput.className = "input input-hex";
    hexInput.value = hex;
    hexInput.maxLength = 7;
    hexInput.setAttribute("aria-label", `Hex for palette color ${index + 1}`);
    hexInput.addEventListener("change", () => {
      const parsed = parseHexColor(hexInput.value);
      if (!parsed.ok) {
        showError(parsed.reason);
        hexInput.value = formatHexColor(effective);
        return;
      }
      applyPaletteOverride(index, parsed.value);
      colorInput.value = formatHexColor(parsed.value).toLowerCase();
      swatch.style.background = formatHexColor(parsed.value);
      paintColorsPreviews();
    });

    const meta = document.createElement("span");
    meta.className = "palette-meta";
    meta.textContent = `${pct}% (${entry.population})`;

    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "button button-secondary";
    restore.textContent = "Restore";
    restore.disabled = !entry.override;
    restore.title = "Restore generated color";
    restore.addEventListener("click", () => {
      restoreGeneratedPaletteColor(index);
      syncColorsUi();
    });

    li.append(swatch, colorInput, hexInput, meta, restore);
    list.appendChild(li);
  });
}

function syncCompareMode() {
  const select = /** @type {HTMLSelectElement|null} */ (document.getElementById("compare-mode"));
  const grid = document.getElementById("compare-grid");
  if (!select || !grid) return;
  const mode = select.value;
  grid.setAttribute("data-mode", mode);
  grid.querySelectorAll(".preview-figure").forEach((figure) => {
    const kind = figure.getAttribute("data-compare");
    const show = mode === "both" || mode === kind;
    /** @type {HTMLElement} */ (figure).hidden = !show;
  });
  document.querySelectorAll('input[name="compare-mode-seg"]').forEach((input) => {
    const elInput = /** @type {HTMLInputElement} */ (input);
    elInput.checked = elInput.value === mode;
  });
}

function paintColorsPreviews() {
  const s = getState();
  const rq = getRuntimeQuantization();
  const bitmap = getRuntimeBitmap();
  const sourceCanvas = /** @type {HTMLCanvasElement|null} */ (
    document.getElementById("source-preview-canvas")
  );
  const quantizedCanvas = /** @type {HTMLCanvasElement|null} */ (
    document.getElementById("quantized-preview-canvas")
  );

  let widthPx = 296;
  let heightPx = 106;
  try {
    const size = computeQuantizationSize(getResolutionPxPerMm(s));
    widthPx = size.widthPx;
    heightPx = size.heightPx;
  } catch {
    // keep defaults for invalid resolution while editing
  }

  if (sourceCanvas) {
    sourceCanvas.width = widthPx;
    sourceCanvas.height = heightPx;
    const ctx = sourceCanvas.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      const bg = resolveBackgroundColor(
        s.quantization.transparencyMode,
        s.quantization.customBackground,
      );
      ctx.fillStyle = `rgb(${bg.r},${bg.g},${bg.b})`;
      ctx.fillRect(0, 0, widthPx, heightPx);
      if (bitmap) {
        const shell = document.getElementById("canvas-shell");
        const cropRect = computeCropRect(shell?.clientWidth || 640, shell?.clientHeight || 360);
        const viewCrop = { width: cropRect.width, height: cropRect.height };
        const scaled = scaleTransformToOutput(s.transform, viewCrop, {
          width: widthPx,
          height: heightPx,
        });
        drawTransformedImage(ctx, bitmap, scaled, {
          x: 0,
          y: 0,
          width: widthPx,
          height: heightPx,
        });
      }
    }
  }

  if (quantizedCanvas) {
    quantizedCanvas.width = widthPx;
    quantizedCanvas.height = heightPx;
    const ctx = quantizedCanvas.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, widthPx, heightPx);
      if (rq.previewRgba && rq.width > 0 && rq.height > 0) {
        quantizedCanvas.width = rq.width;
        quantizedCanvas.height = rq.height;
        ctx.imageSmoothingEnabled = false;
        const imageData = new ImageData(rq.previewRgba, rq.width, rq.height);
        ctx.putImageData(imageData, 0, 0);
      } else {
        ctx.fillStyle = getComputedStyle(document.documentElement)
          .getPropertyValue("--color-surface-elevated")
          .trim() || "#fff";
        ctx.fillRect(0, 0, widthPx, heightPx);
      }
    }
  }
}

/**
 * @param {(image: {width:number,height:number}, transform: import("../image/crop-transform.js").Transform, crop: {width:number,height:number}) => void} fn
 */
function withImage(fn) {
  const bitmap = getRuntimeBitmap();
  if (!bitmap) {
    showError("Choose an image first.");
    return;
  }
  const s = getState();
  const shell = document.getElementById("canvas-shell");
  const cropRect = computeCropRect(shell?.clientWidth || 640, shell?.clientHeight || 360);
  const crop = { width: cropRect.width, height: cropRect.height };
  const image = { width: s.sourceImage.widthPx, height: s.sourceImage.heightPx };
  fn(image, s.transform, crop);
}

/**
 * @param {string} id
 * @param {(raw: number) => number} onValid
 */
function bindNumber(id, onValid) {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
  if (!input) return;
  input.addEventListener("change", () => {
    const next = onValid(Number(input.value));
    input.value = String(next);
  });
}

/** @param {string} id @param {number} value */
function setInputValue(id, value) {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
  if (input && document.activeElement !== input) {
    input.value = String(value);
  }
}

function bindPointerPan(canvas, getCropSize, scheduleRedraw) {
  /** @type {{ pointerId: number, lastX: number, lastY: number } | null} */
  let drag = null;

  canvas.style.touchAction = "none";

  canvas.addEventListener("pointerdown", (event) => {
    if (!getRuntimeBitmap()) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    drag = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    const bitmap = getRuntimeBitmap();
    if (!bitmap) return;
    const s = getState();
    const crop = getCropSize();
    const image = { width: s.sourceImage.widthPx, height: s.sourceImage.heightPx };
    const next = clampTransformToCrop(panBy(getEffectiveTransform(), dx, dy), image, crop);
    setLiveTransform(next);
    scheduleRedraw();
  });

  const endDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    commitLiveTransform();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {() => { width: number, height: number }} getCropSize
 * @param {() => void} scheduleRedraw
 */
function bindWheelZoom(canvas, getCropSize, scheduleRedraw) {
  let wheelCommitTimer = 0;
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!getRuntimeBitmap()) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
      const crop = getCropSize();
      const s = getState();
      const image = { width: s.sourceImage.widthPx, height: s.sourceImage.heightPx };
      const base = getEffectiveTransform();
      const next = clampTransformToCrop(
        setScale(base, base.scale * factor),
        image,
        crop,
      );
      setLiveTransform(next);
      scheduleRedraw();
      window.clearTimeout(wheelCommitTimer);
      wheelCommitTimer = window.setTimeout(() => {
        commitLiveTransform();
      }, 180);
    },
    { passive: false },
  );
}
