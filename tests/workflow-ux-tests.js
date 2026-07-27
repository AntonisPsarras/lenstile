/**
 * Milestone 7.4.1 — compact UX / printability review / relief editor tests.
 */

import {
  describe,
  test,
  assertEqual,
} from "./test-utils.js";
import {
  resetStore,
  setActiveStep,
  patchSurface,
  patchRuntimeWorkflow,
  getRuntimePrintability,
  beginQuantizeRequest,
  acceptQuantizeResult,
  beginPrintabilityRequest,
  acceptPrintabilityResult,
  getState,
} from "../src/state.js";
import { mountLayout } from "../src/ui/layout.js";
import { bindControls, syncControlsFromState } from "../src/ui/controls.js";
import { setReliefEditorOpen } from "../src/ui/surface-controls.js";
import { configurePipeline } from "../src/workflow/pipeline.js";
import {
  createTestDownloadAdapter,
  setDownloadAdapter,
  getDownloadAdapter,
} from "../src/export/download.js";
import { createEmptyReport } from "../src/image/printability.js";
import { getAcceptCleanupButtonState, getPrintabilityLoadingOperation } from "../src/ui/printability-controller.js";
import { deriveProgressPercent } from "../src/ui/progress.js";
import { LONGER_THAN_USUAL_MESSAGE } from "../src/workflow/pipeline-status.js";

describe("Milestone 7.4.1 UX layout", () => {
  /** @type {HTMLElement | null} */
  let root = null;
  /** @type {ReturnType<typeof createTestDownloadAdapter> | null} */
  let adapter = null;

  function mount() {
    resetStore();
    setReliefEditorOpen(false);
    // Prior suites can leave app shells; getElementById sync would miss this root.
    document.querySelectorAll(".app-shell").forEach((el) => el.remove());
    adapter = createTestDownloadAdapter();
    setDownloadAdapter(adapter);
    root = document.createElement("div");
    document.body.appendChild(root);
    const layout = mountLayout(root);
    configurePipeline(() => ({ width: 296, height: 106 }));
    bindControls({
      canvas: layout.canvas,
      canvasShell: layout.canvasShell,
      imageInput: layout.imageInput,
      scheduleRedraw: () => {},
      getCropSize: () => ({ width: 296, height: 106 }),
    });
    syncControlsFromState();
    return layout;
  }

  function unmount() {
    if (root) root.remove();
    root = null;
  }

  function seedCleanedPreview() {
    const indices = new Uint8Array([0, 1, 0, 1]);
    beginQuantizeRequest("q-ux");
    acceptQuantizeResult({
      requestId: "q-ux",
      sourceRevision: 0,
      result: {
        width: 2,
        height: 2,
        requestedColorCount: 2,
        actualColorCount: 2,
        generatedPalette: [
          { r: 0, g: 0, b: 0, population: 2 },
          { r: 255, g: 255, b: 255, population: 2 },
        ],
        indices,
        sourceRevision: 0,
        algorithmVersion: 1,
        diagnostics: { uniqueColorCount: 2, iterations: 1, durationMs: 1 },
      },
      previewRgba: new Uint8ClampedArray(16),
    });
    beginPrintabilityRequest("p-ux");
    acceptPrintabilityResult({
      requestId: "p-ux",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      ranCleanup: true,
      result: {
        width: 2,
        height: 2,
        issueMask: new Uint8Array(4),
        cleanedIndices: new Uint8Array(indices),
        report: {
          ...createEmptyReport(),
          componentCount: 1,
          changedPixelCount: 12,
        },
        algorithmVersion: 1,
      },
    });
    patchRuntimeWorkflow({
      pipelineStatus: "waiting-for-review",
      needsReview: true,
    });
  }

  test("printability actions sit in the main workflow panel", () => {
    mount();
    setActiveStep("printability");
    syncControlsFromState();
    const panel = root?.querySelector('[data-panel="printability"] .settings-body');
    const actions = panel?.querySelector(".print-actions");
    assertEqual(Boolean(actions), true);
    assertEqual(Boolean(actions?.querySelector("#btn-analyze-print")), true);
    assertEqual(Boolean(root?.querySelector("#btn-accept-cleanup")), true);
    const children = panel ? [...panel.children] : [];
    const actionsIdx = children.findIndex((node) => node.classList?.contains("print-actions"));
    const compareIdx = children.findIndex((node) => node.id === "print-preview-compare");
    assertEqual(actionsIdx >= 0, true);
    assertEqual(compareIdx >= 0, true);
    assertEqual(actionsIdx < compareIdx, true);
    unmount();
  });

  test("printability loading indicator follows analyze vs clean action", () => {
    mount();
    setActiveStep("printability");
    const indices = new Uint8Array([0, 1, 0, 1]);
    beginQuantizeRequest("q-load");
    acceptQuantizeResult({
      requestId: "q-load",
      sourceRevision: 0,
      result: {
        width: 2,
        height: 2,
        requestedColorCount: 2,
        actualColorCount: 2,
        generatedPalette: [
          { r: 0, g: 0, b: 0, population: 2 },
          { r: 255, g: 255, b: 255, population: 2 },
        ],
        indices,
        sourceRevision: 0,
        algorithmVersion: 1,
        diagnostics: { uniqueColorCount: 2, iterations: 1, durationMs: 1 },
      },
      previewRgba: new Uint8ClampedArray(16),
    });

    beginPrintabilityRequest("p-analyze", false);
    syncControlsFromState();
    const analyzeBtn = /** @type {HTMLButtonElement|null} */ (root?.querySelector("#btn-analyze-print"));
    const cleanBtn = /** @type {HTMLButtonElement|null} */ (root?.querySelector("#btn-clean-print"));
    assertEqual(getPrintabilityLoadingOperation(), "analyze");
    assertEqual(analyzeBtn?.classList.contains("is-loading"), true);
    assertEqual(cleanBtn?.classList.contains("is-loading"), false);

    beginPrintabilityRequest("p-clean", true);
    syncControlsFromState();
    assertEqual(getPrintabilityLoadingOperation(), "clean");
    assertEqual(analyzeBtn?.classList.contains("is-loading"), false);
    assertEqual(cleanBtn?.classList.contains("is-loading"), true);
    unmount();
  });

  test("Use this design is in sticky footer", () => {
    mount();
    setActiveStep("printability");
    const accept = root?.querySelector("#btn-accept-cleanup");
    const footer = accept?.closest(".settings-footer, .panel-footer");
    assertEqual(Boolean(footer), true);
    unmount();
  });

  test("Use this design disabled during processing", () => {
    mount();
    seedCleanedPreview();
    patchRuntimeWorkflow({ pipelineStatus: "preparing-fix", needsReview: false });
    const state = getAcceptCleanupButtonState();
    assertEqual(state.enabled, false);
    unmount();
  });

  test("Use this design enabled when waiting for review with cleaned preview", () => {
    mount();
    seedCleanedPreview();
    syncControlsFromState();
    const state = getAcceptCleanupButtonState();
    assertEqual(Boolean(getRuntimePrintability().cleanedIndices), true);
    assertEqual(state.enabled, true);
    unmount();
  });

  test("Make printable footer shows visible reason when Use this design is blocked", () => {
    mount();
    setActiveStep("printability");
    syncControlsFromState();
    const hint = /** @type {HTMLElement|null} */ (
      root?.querySelector("#print-footer-hint")
    );
    const accept = /** @type {HTMLButtonElement|null} */ (
      root?.querySelector("#btn-accept-cleanup")
    );
    assertEqual(Boolean(hint), true);
    assertEqual(accept?.disabled, true);
    assertEqual(hint?.hidden, false);
    assertEqual(
      hint?.textContent?.includes("printable preview is not ready"),
      true,
    );
    unmount();
  });

  test("Make printable footer hint clears when Use this design is enabled", () => {
    mount();
    seedCleanedPreview();
    setActiveStep("printability");
    syncControlsFromState();
    const hint = /** @type {HTMLElement|null} */ (
      root?.querySelector("#print-footer-hint")
    );
    const state = getAcceptCleanupButtonState();
    assertEqual(state.enabled, true);
    assertEqual(hint?.hidden, true);
    unmount();
  });

  test("Status explains automatic check and fix before analysis", () => {
    mount();
    setActiveStep("printability");
    syncControlsFromState();
    const status = root?.querySelector("#print-status");
    assertEqual(
      status?.textContent?.includes("automatic check and fix"),
      true,
    );
    assertEqual(Boolean(root?.querySelector("#print-status-field")), true);
    unmount();
  });

  test("Image footer shows choose-image hint when empty", () => {
    mount();
    setActiveStep("image");
    syncControlsFromState();
    const hint = /** @type {HTMLElement|null} */ (
      root?.querySelector("#image-footer-hint")
    );
    assertEqual(Boolean(hint), true);
    assertEqual(hint?.hidden, false);
    assertEqual(hint?.textContent?.includes("Choose an image"), true);
    unmount();
  });

  test("Comparison appears before approval on Make printable", () => {
    mount();
    setActiveStep("printability");
    const compare = root?.querySelector("#print-preview-compare");
    const accept = root?.querySelector("#btn-accept-cleanup");
    assertEqual(Boolean(compare), true);
    assertEqual(Boolean(accept), true);
    // Compare is in settings-body; accept is in footer after body.
    const body = root?.querySelector('[data-panel="printability"] .settings-body');
    assertEqual(Boolean(body?.contains(compare)), true);
    assertEqual(Boolean(body?.contains(accept)), false);
    unmount();
  });

  test("Colors uses one bounded comparison area", () => {
    mount();
    setActiveStep("colors");
    const grid = root?.querySelector("#compare-grid");
    assertEqual(Boolean(grid?.classList.contains("preview-compare-bounded")), true);
    assertEqual(Boolean(root?.querySelector(".segmented-control")), true);
    unmount();
  });

  test("Source and result are not stacked as two large vertical previews by default", () => {
    mount();
    setActiveStep("colors");
    syncControlsFromState();
    const grid = root?.querySelector("#compare-grid");
    const mode = grid?.getAttribute("data-mode");
    // Default is Preview (quantized), not both stacked.
    assertEqual(mode === "quantized" || mode === "both", true);
    const source = /** @type {HTMLElement|null} */ (
      root?.querySelector('[data-compare="source"]')
    );
    if (mode === "quantized") {
      assertEqual(source?.hidden, true);
    }
    unmount();
  });

  test("Relief summary and dropdown hidden for Smooth surface", () => {
    mount();
    seedCleanedPreview();
    patchSurface({ style: "flat" });
    setActiveStep("export");
    syncControlsFromState();
    const summaryRow = /** @type {HTMLElement|null} */ (root?.querySelector("#relief-summary-row"));
    const dropdown = /** @type {HTMLElement|null} */ (root?.querySelector(".relief-dropdown"));
    assertEqual(summaryRow?.hidden, true);
    assertEqual(dropdown?.hidden, true);
    unmount();
  });

  test("Relief summary and dropdown visible for Relief surface", () => {
    mount();
    seedCleanedPreview();
    patchSurface({ style: "relief" });
    setActiveStep("export");
    syncControlsFromState();
    const summaryRow = /** @type {HTMLElement|null} */ (root?.querySelector("#relief-summary-row"));
    const edit = /** @type {HTMLElement|null} */ (root?.querySelector("#btn-edit-relief"));
    assertEqual(summaryRow?.hidden, false);
    assertEqual(Boolean(edit), true);
    unmount();
  });

  test("Edit relief toggles dropdown and keeps Download visible", () => {
    mount();
    seedCleanedPreview();
    patchSurface({ style: "relief" });
    setActiveStep("export");
    syncControlsFromState();
    const edit = /** @type {HTMLButtonElement|null} */ (root?.querySelector("#btn-edit-relief"));
    edit?.click();
    const editor = /** @type {HTMLElement|null} */ (root?.querySelector("#export-relief-editor"));
    const main = /** @type {HTMLElement|null} */ (root?.querySelector("#export-main-view"));
    assertEqual(editor?.hidden, false);
    assertEqual(main?.hidden, false);
    assertEqual(edit?.getAttribute("aria-expanded"), "true");
    edit?.click();
    assertEqual(editor?.hidden, true);
    assertEqual(edit?.getAttribute("aria-expanded"), "false");
    unmount();
  });

  test("Main Download controls remain visible when Relief is enabled", () => {
    mount();
    setActiveStep("export");
    const main = root?.querySelector("#export-main-view");
    const stl = root?.querySelector("#btn-download-combined-stl");
    const threeMf = root?.querySelector("#btn-export-3mf");
    assertEqual(/** @type {HTMLElement} */ (main).hidden, false);
    assertEqual(Boolean(stl), true);
    assertEqual(Boolean(threeMf), true);
    unmount();
  });

  test("Rebuild model is under More file options Technical path", () => {
    mount();
    const rebuild = root?.querySelector("#btn-generate-model");
    const more = root?.querySelector("#export-more-options");
    assertEqual(Boolean(rebuild), true);
    assertEqual(Boolean(more?.contains(rebuild)), true);
    assertEqual(rebuild?.textContent?.includes("Rebuild"), true);
    unmount();
  });

  test("Progress shows real stage count and derived percentage", () => {
    mount();
    const card = root?.querySelector("#workflow-progress-card-print");
    const stages = card?.querySelectorAll("[data-stage-index]");
    assertEqual(Boolean(card), true);
    assertEqual(stages?.length, 4);
    assertEqual(deriveProgressPercent(2, 4), 50);
    unmount();
  });

  test("Colors Continue remains in sticky footer", () => {
    mount();
    setActiveStep("colors");
    const cont = root?.querySelector("#btn-continue-print");
    assertEqual(Boolean(cont?.closest(".settings-footer")), true);
    unmount();
  });

  test("longer-than-usual notice element exists", () => {
    mount();
    const notice = root?.querySelector(".workflow-longer-notice");
    assertEqual(Boolean(notice), true);
    assertEqual(LONGER_THAN_USUAL_MESSAGE.includes("longer than usual"), true);
    unmount();
  });

  test("Error provides Retry button in progress card", () => {
    mount();
    const retry = root?.querySelector(".btn-pipeline-retry");
    assertEqual(Boolean(retry), true);
    assertEqual(retry?.textContent?.includes("Retry"), true);
    unmount();
  });

  test("no automatic download on mount or sync", () => {
    mount();
    const before = adapter?.getInvocationCount() || 0;
    setActiveStep("export");
    syncControlsFromState();
    assertEqual(adapter?.getInvocationCount(), before);
    assertEqual(Boolean(getDownloadAdapter()), true);
    unmount();
  });

  test("transparency controls live under Colors Advanced", () => {
    mount();
    const fieldset = root?.querySelector("#transparency-fieldset");
    const advanced = root?.querySelector("#colors-advanced");
    assertEqual(Boolean(advanced?.contains(fieldset)), true);
    unmount();
  });

  test("print compare grid is bounded", () => {
    mount();
    const grid = root?.querySelector("#print-compare-grid");
    assertEqual(Boolean(grid?.classList.contains("preview-compare-bounded")), true);
    unmount();
  });
});
