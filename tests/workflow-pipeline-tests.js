/**
 * Milestone 7.4 — workflow pipeline orchestration tests.
 */

import {
  describe,
  test,
  assertEqual,
} from "./test-utils.js";
import {
  determineAffectedStages,
  shouldAutoRunColorPrintablePipeline,
  changeRequiresReapproval,
  DEPENDENCY_GRAPH,
} from "../src/workflow/dependency-graph.js";
import {
  cancelSupersededPipeline,
  configurePipeline,
  isExportBlockedByWorkflow,
  reportPipelineProgress,
} from "../src/workflow/pipeline.js";
import {
  resetStore,
  getState,
  getRuntimeWorkflow,
  setPrintProfile,
  setProjectName,
  patchExport,
  setLiveTransform,
  commitLiveTransform,
  getEffectiveTransform,
  toSerializableProject,
  runtimeOnlyKeys,
  patchRuntimeWorkflow,
  setActiveStep,
  beginQuantizeRequest,
  acceptQuantizeResult,
  beginPrintabilityRequest,
  acceptPrintabilityResult,
  acceptCleanedDesign,
  isPrintabilityExportReady,
} from "../src/state.js";
import { mountLayout } from "../src/ui/layout.js";
import { bindControls, syncControlsFromState } from "../src/ui/controls.js";
import {
  createTestDownloadAdapter,
  getDownloadAdapter,
  setDownloadAdapter,
} from "../src/export/download.js";
import { createEmptyReport } from "../src/image/printability.js";

describe("Milestone 7.4 dependency graph", () => {
  test("nozzle-change affects colors and printable with reapproval", () => {
    const stages = determineAffectedStages("nozzle-change");
    assertEqual(stages.includes("colors"), true);
    assertEqual(stages.includes("printable"), true);
    assertEqual(stages.includes("model"), true);
    assertEqual(shouldAutoRunColorPrintablePipeline("nozzle-change"), true);
    assertEqual(changeRequiresReapproval("nozzle-change"), true);
  });

  test("relief skips colors and printable", () => {
    const stages = determineAffectedStages("relief");
    assertEqual(stages.includes("colors"), false);
    assertEqual(stages.includes("printable"), false);
    assertEqual(stages.includes("model"), true);
    assertEqual(shouldAutoRunColorPrintablePipeline("relief"), false);
  });

  test("base-color only invalidates packaging", () => {
    const stages = determineAffectedStages("base-color");
    assertEqual(stages.length, 1);
    assertEqual(stages[0], "packaging");
  });

  test("design-name is filename-only", () => {
    assertEqual(DEPENDENCY_GRAPH["design-name"].packaging.action, "filename");
    assertEqual(shouldAutoRunColorPrintablePipeline("design-name"), false);
  });

  test("crop-commit does not auto-run pipeline", () => {
    assertEqual(shouldAutoRunColorPrintablePipeline("crop-commit"), false);
  });
});

describe("Milestone 7.4 live transform commit", () => {
  test("live transform does not bump sourceRevision until commit", () => {
    resetStore();
    const before = getState().sourceRevision;
    setLiveTransform({
      ...getState().transform,
      offsetX: 12,
      scale: 1.4,
    });
    assertEqual(getState().sourceRevision, before);
    assertEqual(getEffectiveTransform().offsetX, 12);
    commitLiveTransform();
    assertEqual(getState().sourceRevision, before + 1);
    assertEqual(getState().transform.offsetX, 12);
  });

  test("unchanged live commit is a no-op", () => {
    resetStore();
    const t = { ...getState().transform };
    setLiveTransform(t);
    const before = getState().sourceRevision;
    const committed = commitLiveTransform();
    assertEqual(committed, false);
    assertEqual(getState().sourceRevision, before);
  });
});

describe("Milestone 7.4 workflow runtime serialization", () => {
  test("toSerializableProject excludes workflow runtime fields", () => {
    resetStore();
    patchRuntimeWorkflow({
      pipelineStatus: "updating-colors",
      progressMessage: "Updating…",
      requestedOperationId: 9,
      needsReview: true,
    });
    const json = toSerializableProject();
    assertEqual("workflow" in json, false);
    assertEqual("pipelineStatus" in json, false);
    assertEqual("progressMessage" in json, false);
    assertEqual("requestedOperationId" in json, false);
    const keys = runtimeOnlyKeys();
    assertEqual(keys.includes("workflow"), true);
    assertEqual(keys.includes("promise"), true);
  });

  test("design-name change does not bump sourceRevision", () => {
    resetStore();
    const before = getState().sourceRevision;
    setProjectName("Castle");
    assertEqual(getState().sourceRevision, before);
    assertEqual(getState().project.name, "Castle");
  });

  test("base-color change does not remesh geometry revision alone", () => {
    resetStore();
    const geomBefore = getState().geometryRevision;
    const srcBefore = getState().sourceRevision;
    patchExport({ baseColor: { r: 10, g: 20, b: 30 } });
    assertEqual(getState().sourceRevision, srcBefore);
    // patchExport clears 3MF; geometry revision only bumps via invalidateGeometry paths.
    assertEqual(getState().geometryRevision, geomBefore);
    assertEqual(getState().export.baseColor.r, 10);
  });
});

describe("Milestone 7.4 pipeline supersede and export block", () => {
  test("cancelSupersededPipeline increments operation id", () => {
    resetStore();
    const a = cancelSupersededPipeline();
    const b = cancelSupersededPipeline();
    assertEqual(b > a, true);
    assertEqual(getRuntimeWorkflow().requestedOperationId, b);
  });

  test("needsReview blocks export via workflow helper", () => {
    resetStore();
    patchRuntimeWorkflow({ needsReview: true, pipelineStatus: "waiting-for-review" });
    assertEqual(isExportBlockedByWorkflow(), true);
  });

  test("reportPipelineProgress updates runtime status", () => {
    resetStore();
    reportPipelineProgress("Checking small printable details…", "analyzing-printability", {
      announce: false,
    });
    const wf = getRuntimeWorkflow();
    assertEqual(wf.pipelineStatus, "analyzing-printability");
    assertEqual(wf.progressMessage.includes("Checking"), true);
  });
});

describe("Milestone 7.4 nozzle UI stays on Make printable", () => {
  /** @type {HTMLElement | null} */
  let root = null;
  /** @type {ReturnType<typeof createTestDownloadAdapter> | null} */
  let adapter = null;

  function mount() {
    resetStore();
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
    setActiveStep("printability");
    syncControlsFromState();
    return layout;
  }

  function unmount() {
    if (root) root.remove();
    root = null;
  }

  test("Design name control is removed from the header", () => {
    mount();
    const label = root?.querySelector("label[for='project-name']");
    const input = root?.querySelector("#project-name");
    assertEqual(Boolean(label), false);
    assertEqual(Boolean(input), false);
    const brand = root?.querySelector(".brand-name");
    assertEqual(brand?.textContent, "LensTile");
    assertEqual((root?.textContent || "").includes("Export design JSON (later)"), false);
    unmount();
  });

  test("Smooth surface and Relief wording present", () => {
    mount();
    const html = root?.textContent || "";
    assertEqual(html.includes("Smooth surface"), true);
    assertEqual(html.includes("one filament"), true);
    assertEqual(html.includes("multiple colors") || html.includes("multicolor"), true);
    unmount();
  });

  test("nozzle help explains automatic preparation", () => {
    mount();
    const help = root?.querySelector("#print-profile-help");
    assertEqual(Boolean(help), true);
    assertEqual(help.textContent?.toLowerCase().includes("automatic"), true);
    unmount();
  });

  test("changing nozzle keeps active step on printability", () => {
    mount();
    setActiveStep("printability");
    assertEqual(getState().ui.activeStep, "printability");
    setPrintProfile("nozzle02");
    assertEqual(getState().ui.activeStep, "printability");
    setPrintProfile("nozzle04");
    assertEqual(getState().ui.activeStep, "printability");
    unmount();
  });

  test("test download adapter remains active and unused by nozzle change", () => {
    mount();
    const before = getDownloadAdapter();
    assertEqual(Boolean(before && typeof before.downloadBlob === "function"), true);
    const countBefore = adapter ? adapter.getInvocationCount() : 0;
    setPrintProfile("nozzle02");
    const countAfter = adapter ? adapter.getInvocationCount() : 0;
    assertEqual(countAfter, countBefore);
    unmount();
  });

  test("print tech details start collapsed", () => {
    mount();
    const tech = /** @type {HTMLDetailsElement|null} */ (root?.querySelector("#print-tech-details"));
    assertEqual(Boolean(tech), true);
    assertEqual(tech.open, false);
    unmount();
  });

  test("app shell uses full-width viewport class", () => {
    mount();
    assertEqual(root?.classList.contains("app-shell"), true);
    const settings = root?.querySelector(".settings-scroll");
    assertEqual(Boolean(settings), true);
    unmount();
  });
});

describe("Milestone 7.4 approval semantics helpers", () => {
  test("accepted design clears needsReview flag", () => {
    resetStore();
    // Minimal synthetic accept path: mark printability accepted via store helpers.
    const indices = new Uint8Array([0, 1, 0, 1]);
    beginQuantizeRequest("q1");
    acceptQuantizeResult({
      requestId: "q1",
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
    beginPrintabilityRequest("p1");
    acceptPrintabilityResult({
      requestId: "p1",
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
          changedPixelCount: 0,
        },
        algorithmVersion: 1,
      },
    });
    patchRuntimeWorkflow({ needsReview: true });
    const ok = acceptCleanedDesign();
    assertEqual(ok, true);
    assertEqual(isPrintabilityExportReady(), true);
    assertEqual(getRuntimeWorkflow().needsReview, false);
  });
});
