/**
 * Milestone 7.4.1 — formal workflow FSM, lifecycle, and stuck-build fixes.
 */

import {
  describe,
  test,
  assertEqual,
} from "./test-utils.js";
import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  isTransitionAllowed,
  normalizeWorkflowStatus,
  successResult,
  errorResult,
  supersededResult,
  isBusyWorkflowStatus,
} from "../src/workflow/workflow-fsm.js";
import {
  deriveProgressPercent,
} from "../src/ui/progress.js";
import {
  cancelSupersededPipeline,
  reportPipelineProgress,
  regenerateModel,
  canStartModelBuild,
  isExportBlockedByWorkflow,
  transitionTo,
} from "../src/workflow/pipeline.js";
import {
  resetPipelineInstrumentation,
  getPipelineInstrumentation,
  recordPipelineRequest,
  recordPipelineWin,
} from "../src/workflow/instrumentation.js";
import {
  resetStore,
  getState,
  getRuntimeWorkflow,
  patchRuntimeWorkflow,
  beginQuantizeRequest,
  acceptQuantizeResult,
  beginPrintabilityRequest,
  acceptPrintabilityResult,
  acceptCleanedDesign,
  isPrintabilityExportReady,
} from "../src/state.js";
import { getExportReadiness } from "../src/ui/export-controller.js";
import { createEmptyReport } from "../src/image/printability.js";
import { shouldShowMagnetGuides } from "../src/image/crop-renderer.js";
import { MODEL_BUILD_STAGES, NOZZLE_PIPELINE_STAGES } from "../src/workflow/pipeline-status.js";

function seedApprovedDesign() {
  resetStore();
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
  acceptCleanedDesign();
}

describe("Milestone 7.4.1 workflow FSM", () => {
  test("transition table rejects impossible transitions", () => {
    assertEqual(isTransitionAllowed("idle", "model-ready"), false);
    assertEqual(isTransitionAllowed("waiting-for-review", "building-model"), false);
    assertEqual(isTransitionAllowed("approved", "building-model"), true);
    assertEqual(isTransitionAllowed("building-model", "model-ready"), true);
    let threw = false;
    try {
      assertTransition("idle", "creating-3mf");
    } catch {
      threw = true;
    }
    assertEqual(threw, true);
  });

  test("normalize maps legacy status aliases", () => {
    assertEqual(normalizeWorkflowStatus("ready"), "idle");
    assertEqual(normalizeWorkflowStatus("waiting-review"), "waiting-for-review");
    assertEqual(normalizeWorkflowStatus("preparing-printable"), "preparing-fix");
  });

  test("allowed edges cover recommended nozzle path", () => {
    const path = [
      ["idle", "updating-colors"],
      ["updating-colors", "analyzing-printability"],
      ["analyzing-printability", "preparing-fix"],
      ["preparing-fix", "waiting-for-review"],
      ["waiting-for-review", "approved"],
      ["approved", "building-model"],
      ["building-model", "validating-model"],
      ["validating-model", "model-ready"],
    ];
    for (const [from, to] of path) {
      assertEqual(isTransitionAllowed(from, to), true);
    }
    assertEqual(Object.keys(ALLOWED_TRANSITIONS).includes("error"), true);
  });

  test("operation result helpers", () => {
    assertEqual(successResult(3).status, "success");
    assertEqual(errorResult(3).status, "error");
    assertEqual(supersededResult(3).status, "superseded");
  });
});

describe("Milestone 7.4.1 model-build deadlock fix", () => {
  test("canGenerate is not blocked by building-model status", () => {
    seedApprovedDesign();
    assertEqual(isPrintabilityExportReady(), true);
    patchRuntimeWorkflow({
      pipelineStatus: "building-model",
      needsReview: false,
      progressMessage: "Building printable model…",
    });
    const readiness = getExportReadiness();
    assertEqual(readiness.canGenerate, true);
    assertEqual(readiness.canDownload, false);
    assertEqual(readiness.workflowBlocksExport, true);
  });

  test("approval clears needsReview and sets approved status", () => {
    seedApprovedDesign();
    const wf = getRuntimeWorkflow();
    assertEqual(wf.needsReview, false);
    assertEqual(wf.pipelineStatus, "approved");
  });

  test("downloads blocked while waiting for review", () => {
    seedApprovedDesign();
    patchRuntimeWorkflow({
      needsReview: true,
      pipelineStatus: "waiting-for-review",
    });
    assertEqual(isExportBlockedByWorkflow(), true);
    assertEqual(getExportReadiness().canDownload, false);
  });

  test("canStartModelBuild requires approval boundary", () => {
    seedApprovedDesign();
    assertEqual(canStartModelBuild(), true);
    patchRuntimeWorkflow({
      pipelineStatus: "updating-colors",
      needsReview: false,
    });
    assertEqual(canStartModelBuild(), false);
  });
});

describe("Milestone 7.4.1 progress math", () => {
  test("percentage derives from completed stages only", () => {
    assertEqual(deriveProgressPercent(0, 4), 0);
    assertEqual(deriveProgressPercent(1, 4), 25);
    assertEqual(deriveProgressPercent(2, 4), 50);
    assertEqual(deriveProgressPercent(4, 4), 100);
    assertEqual(MODEL_BUILD_STAGES.length, 4);
    assertEqual(NOZZLE_PIPELINE_STAGES.length, 4);
  });

  test("busy statuses are recognized", () => {
    assertEqual(isBusyWorkflowStatus("building-model"), true);
    assertEqual(isBusyWorkflowStatus("waiting-for-review"), false);
    assertEqual(isBusyWorkflowStatus("model-ready"), false);
  });
});

describe("Milestone 7.4.1 magnet guides by stage", () => {
  test("visible on Image, hidden on Make printable and Download", () => {
    assertEqual(shouldShowMagnetGuides("image"), true);
    assertEqual(shouldShowMagnetGuides("colors"), false);
    assertEqual(shouldShowMagnetGuides("printability"), false);
    assertEqual(shouldShowMagnetGuides("export"), false);
    assertEqual(shouldShowMagnetGuides("export", { forceShow: true }), true);
  });
});

describe("Milestone 7.4.1 superseded ops and instrumentation", () => {
  test("cancelSupersededPipeline increments id without clearing newer status wrongly", () => {
    resetStore();
    patchRuntimeWorkflow({ pipelineStatus: "updating-colors", progressMessage: "A" });
    const a = cancelSupersededPipeline();
    patchRuntimeWorkflow({ pipelineStatus: "analyzing-printability", progressMessage: "B" });
    const b = cancelSupersededPipeline();
    assertEqual(b > a, true);
    assertEqual(getRuntimeWorkflow().requestedOperationId, b);
  });

  test("superseded color operation result shape", () => {
    const r = supersededResult(9);
    assertEqual(r.ok, false);
    assertEqual(r.status, "superseded");
    assertEqual(r.operationId, 9);
  });

  test("instrumentation records winning ops", () => {
    resetPipelineInstrumentation();
    recordPipelineRequest("quantize");
    recordPipelineRequest("printability");
    recordPipelineRequest("geometry");
    recordPipelineWin("color", 1, 10);
    recordPipelineWin("geometry", 2, 20);
    const snap = getPipelineInstrumentation();
    assertEqual(snap.quantizationRequests, 1);
    assertEqual(snap.printabilityRequests, 1);
    assertEqual(snap.geometryBuilds, 1);
    assertEqual(snap.winningColorOps, 1);
    assertEqual(snap.winningGeometryOps, 1);
  });

  test("reportPipelineProgress normalizes preparing-printable", () => {
    resetStore();
    reportPipelineProgress("Checking…", "preparing-printable", { announce: false });
    assertEqual(getRuntimeWorkflow().pipelineStatus, "preparing-fix");
  });

  test("transitionTo moves idle to updating-colors", () => {
    resetStore();
    transitionTo("updating-colors", { progressMessage: "Updating…" });
    assertEqual(getRuntimeWorkflow().pipelineStatus, "updating-colors");
  });
});

describe("Milestone 7.4.1 regenerateModel terminal guarantee", () => {
  test("regenerateModel without approval returns error and does not stick busy", async () => {
    resetStore();
    const result = await regenerateModel();
    assertEqual(result.status === "error" || result.ok === false, true);
    const st = normalizeWorkflowStatus(getRuntimeWorkflow().pipelineStatus);
    assertEqual(isBusyWorkflowStatus(st), false);
  });
});
