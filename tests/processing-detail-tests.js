/**
 * Milestone 7.3.2 — automatic processing grids, thresholds, and visual-detail cleanup.
 */

import {
  describe,
  test,
  assertEqual,
} from "./test-utils.js";
import {
  PRINT_PROFILES,
  PRINT_PROFILES_VERSION,
  PROCESSING_PROFILES,
  DEFAULT_PRINT_PROFILE_ID,
  getDerivedPrintSettings,
  getProcessingPixelsPerMm,
  getProcessingPixelSizeMm,
  validateProcessingProfiles,
  CLEANUP_ALGORITHM_VERSION,
} from "../src/config.js";
import { computeQuantizationSize } from "../src/image/resolution.js";
import { cleanupMask } from "../src/image/mask-cleanup.js";
import { thickenNarrowFeatures } from "../src/image/feature-thicken.js";
import { computePixelMetrics } from "../src/image/pixel-metrics.js";
import {
  resetStore,
  setPrintProfile,
  setDetailProfile,
  getResolutionPxPerMm,
  getProcessingPixelSizeMmForState,
  getState,
  beginQuantizeRequest,
  acceptQuantizeResult,
  isQuantizationStale,
  getRuntimeQuantization,
} from "../src/state.js";
import { mountLayout } from "../src/ui/layout.js";
import { bindControls, syncControlsFromState } from "../src/ui/controls.js";
import { clearAllListeners } from "../src/events.js";
import {
  createTestDownloadAdapter,
  setDownloadAdapter,
  resetDownloadAdapter,
} from "../src/export/download.js";
import {
  VISUAL_DETAIL_RAW,
  VISUAL_DETAIL_WIDTH,
  VISUAL_DETAIL_HEIGHT,
  EXPECTED_NOZZLE02,
  EXPECTED_NOZZLE04,
} from "./fixtures/visual-detail-fixture.js";

/** @param {Uint8Array} actual @param {Uint8Array} expected @param {string} label */
function assertIndices(actual, expected, label) {
  assertEqual(actual.length, expected.length, `${label} length`);
  for (let i = 0; i < expected.length; i += 1) {
    assertEqual(actual[i], expected[i], `${label}[${i}]`);
  }
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function diffCount(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) d += 1;
  }
  return d;
}

describe("Milestone 7.3.2 — PROCESSING_PROFILES", () => {
  test("nozzle02 automatic grid is 10 px/mm / 0.1 mm", () => {
    assertEqual(PROCESSING_PROFILES.nozzle02.pixelsPerMm, 10);
    assertEqual(PROCESSING_PROFILES.nozzle02.pixelSizeMm, 0.1);
  });

  test("nozzle04 automatic grid is 8 px/mm / 0.125 mm", () => {
    assertEqual(PROCESSING_PROFILES.nozzle04.pixelsPerMm, 8);
    assertEqual(PROCESSING_PROFILES.nozzle04.pixelSizeMm, 0.125);
  });

  test("PRINT_PROFILES embed matching processing grids", () => {
    assertEqual(PRINT_PROFILES.nozzle02.pixelsPerMm, 10);
    assertEqual(PRINT_PROFILES.nozzle04.pixelsPerMm, 8);
    assertEqual(validateProcessingProfiles().ok, true);
  });

  test("automatic tile sizes stay within pixel limit", () => {
    const fine = computeQuantizationSize(10);
    assertEqual(fine.widthPx, 1480);
    assertEqual(fine.heightPx, 530);
    const standard = computeQuantizationSize(8);
    assertEqual(standard.widthPx, 1184);
    assertEqual(standard.heightPx, 424);
  });

  test("getProcessingPixelsPerMm resolves from profile id", () => {
    assertEqual(getProcessingPixelsPerMm("nozzle02"), 10);
    assertEqual(getProcessingPixelsPerMm("nozzle04"), 8);
    assertEqual(getProcessingPixelSizeMm("nozzle02"), 0.1);
    assertEqual(getProcessingPixelSizeMm("nozzle04"), 0.125);
  });

  test("PRINT_PROFILES_VERSION bumped for threshold/grid changes", () => {
    assertEqual(PRINT_PROFILES_VERSION, 3);
  });
});

describe("Milestone 7.3.2 — revised print thresholds", () => {
  test("nozzle02 derived thresholds", () => {
    const s = getDerivedPrintSettings("nozzle02");
    assertEqual(s.nozzleDiameterMm, 0.2);
    assertEqual(s.minimumFeatureWidthMm, 0.25);
    assertEqual(s.minimumGapWidthMm, 0.25);
    assertEqual(s.minimumIslandAreaMm2, 0.10);
    assertEqual(s.maximumHoleAreaToFillMm2, 0.10);
    assertEqual(s.pixelsPerMm, 10);
  });

  test("nozzle04 derived thresholds", () => {
    const s = getDerivedPrintSettings("nozzle04");
    assertEqual(s.nozzleDiameterMm, 0.4);
    assertEqual(s.minimumFeatureWidthMm, 0.45);
    assertEqual(s.minimumGapWidthMm, 0.45);
    assertEqual(s.minimumIslandAreaMm2, 0.30);
    assertEqual(s.maximumHoleAreaToFillMm2, 0.30);
    assertEqual(s.pixelsPerMm, 8);
  });

  test("default profile remains nozzle04", () => {
    resetStore();
    assertEqual(DEFAULT_PRINT_PROFILE_ID, "nozzle04");
    assertEqual(getResolutionPxPerMm(), 8);
    assertEqual(getProcessingPixelSizeMmForState(), 0.125);
  });

  test("nozzle profile drives quantization ppm (not legacy detail profile)", () => {
    resetStore();
    clearAllListeners();
    setDetailProfile("high");
    assertEqual(getResolutionPxPerMm(), 8);
    setPrintProfile("nozzle02");
    assertEqual(getResolutionPxPerMm(), 10);
    setDetailProfile("low");
    assertEqual(getResolutionPxPerMm(), 10);
  });

  test("nozzle change marks preview stale but does not wipe indices", () => {
    resetStore();
    clearAllListeners();
    beginQuantizeRequest("req-noz");
    acceptQuantizeResult({
      requestId: "req-noz",
      sourceRevision: getState().sourceRevision,
      result: {
        width: 2,
        height: 2,
        requestedColorCount: 1,
        actualColorCount: 1,
        generatedPalette: [{ r: 0, g: 0, b: 0, population: 4 }],
        indices: new Uint8Array([0, 0, 0, 0]),
        algorithmVersion: 1,
        diagnostics: { uniqueColorCount: 1, iterations: 1, durationMs: 1 },
      },
      previewRgba: new Uint8ClampedArray(16),
    });
    assertEqual(isQuantizationStale(), false);
    assertEqual(getRuntimeQuantization().indices?.length, 4);
    setPrintProfile("nozzle02");
    assertEqual(isQuantizationStale(), true);
    assertEqual(getRuntimeQuantization().indices?.length, 4);
    assertEqual(getRuntimeQuantization().status, "ready");
  });
});

describe("Milestone 7.3.2 — automatic detail UI", () => {
  test("automatic detail label reflects active nozzle grid", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const layout = mountLayout(root);
    bindControls({
      canvas: layout.canvas,
      canvasShell: layout.canvasShell,
      imageInput: layout.imageInput,
      scheduleRedraw: () => {},
      getCropSize: () => ({ width: 1184, height: 424 }),
    });
    resetStore();
    clearAllListeners();
    syncControlsFromState();
    assertEqual(document.getElementById("automatic-detail-label")?.textContent, "Automatic detail");
    assertEqual(
      document.getElementById("automatic-detail-value")?.textContent?.includes("0.125 mm detail")
        || document.getElementById("automatic-detail-value")?.textContent?.includes("0.125 mm pixels"),
      true,
    );
    setPrintProfile("nozzle02");
    syncControlsFromState();
    assertEqual(
      document.getElementById("automatic-detail-value")?.textContent?.includes("0.1 mm detail")
        || document.getElementById("automatic-detail-value")?.textContent?.includes("0.1 mm pixels"),
      true,
    );
    const help = document.getElementById("print-profile-help")?.textContent || "";
    assertEqual(help.includes("slicer"), true);
    root.remove();
  });
});

describe("Milestone 7.3.2 — visual-detail cleanup fixture", () => {
  const metrics10 = computePixelMetrics(VISUAL_DETAIL_WIDTH, VISUAL_DETAIL_HEIGHT, {
    tileWidthMm: VISUAL_DETAIL_WIDTH * 0.1,
    tileHeightMm: VISUAL_DETAIL_HEIGHT * 0.1,
  });
  const metrics8 = computePixelMetrics(VISUAL_DETAIL_WIDTH, VISUAL_DETAIL_HEIGHT, {
    tileWidthMm: VISUAL_DETAIL_WIDTH * 0.125,
    tileHeightMm: VISUAL_DETAIL_HEIGHT * 0.125,
  });

  function cleanWithProfile(profileId, metrics) {
    const s = getDerivedPrintSettings(profileId);
    return cleanupMask(VISUAL_DETAIL_RAW, {
      width: VISUAL_DETAIL_WIDTH,
      height: VISUAL_DETAIL_HEIGHT,
      metrics,
      minimumIslandAreaMm2: s.minimumIslandAreaMm2,
      maximumHoleAreaToFillMm2: s.maximumHoleAreaToFillMm2,
      minimumFeatureWidthMm: s.minimumFeatureWidthMm,
      thickenNarrowFeatures: true,
    });
  }

  test("nozzle02 cleaned mask matches hard-coded expectation", () => {
    const result = cleanWithProfile("nozzle02", metrics10);
    assertIndices(result.cleanedIndices, EXPECTED_NOZZLE02, "nozzle02");
  });

  test("nozzle04 cleaned mask matches hard-coded expectation", () => {
    const result = cleanWithProfile("nozzle04", metrics8);
    assertIndices(result.cleanedIndices, EXPECTED_NOZZLE04, "nozzle04");
  });

  test("nozzle02 preserves more detail than nozzle04", () => {
    const o2 = cleanWithProfile("nozzle02", metrics10).cleanedIndices;
    const o4 = cleanWithProfile("nozzle04", metrics8).cleanedIndices;
    const o2Changes = diffCount(VISUAL_DETAIL_RAW, o2);
    const o4Changes = diffCount(VISUAL_DETAIL_RAW, o4);
    assertEqual(o2Changes < o4Changes, true, `o2=${o2Changes} o4=${o4Changes}`);
    assertEqual(diffCount(o2, o4) > 0, true);
  });

  test("nozzle04 retains more detail than legacy 0.8 mm thresholds", () => {
    const o4 = cleanWithProfile("nozzle04", metrics8).cleanedIndices;
    const old = cleanupMask(VISUAL_DETAIL_RAW, {
      width: VISUAL_DETAIL_WIDTH,
      height: VISUAL_DETAIL_HEIGHT,
      metrics: metrics8,
      minimumIslandAreaMm2: 1.5,
      maximumHoleAreaToFillMm2: 1.5,
      minimumFeatureWidthMm: 0.8,
      thickenNarrowFeatures: true,
    }).cleanedIndices;
    const o4Changes = diffCount(VISUAL_DETAIL_RAW, o4);
    const oldChanges = diffCount(VISUAL_DETAIL_RAW, old);
    assertEqual(o4Changes < oldChanges, true, `o4=${o4Changes} old=${oldChanges}`);
  });

  test("cleanup algorithm version documents thickening pass", () => {
    assertEqual(CLEANUP_ALGORITHM_VERSION, 2);
  });
});

describe("Milestone 7.3.2 — feature thickening determinism", () => {
  test("thickenNarrowFeatures expands into small neighbours deterministically", () => {
    const width = 6;
    const height = 4;
    const indices = new Uint8Array(width * height);
    indices.fill(0);
    for (let x = 1; x < 5; x += 1) indices[2 * width + x] = 1;
    for (let x = 1; x < 5; x += 1) indices[1 * width + x] = 2;
    const metrics = computePixelMetrics(width, height, {
      tileWidthMm: width * 0.1,
      tileHeightMm: height * 0.1,
    });
    const a = thickenNarrowFeatures(indices, {
      width,
      height,
      metrics,
      minimumFeatureWidthMm: 0.25,
      minimumIslandAreaMm2: 0.1,
    });
    const b = thickenNarrowFeatures(indices, {
      width,
      height,
      metrics,
      minimumFeatureWidthMm: 0.25,
      minimumIslandAreaMm2: 0.1,
    });
    assertEqual(a.report.expandedPixelCount > 0, true);
    assertEqual([...a.indices].join(","), [...b.indices].join(","));
  });
});

describe("Milestone 7.3.2 — policy guards", () => {
  test("test download adapter is active in harness", () => {
    const adapter = createTestDownloadAdapter();
    setDownloadAdapter(adapter);
    assertEqual(adapter.getInvocationCount(), 0);
    resetDownloadAdapter();
  });

  test("no Math.random in feature-thicken module", async () => {
    const src = await (await fetch("../src/image/feature-thicken.js")).text();
    assertEqual(src.includes("Math.random"), false);
  });

  test("no Math.random in print-profiles module", async () => {
    const src = await (await fetch("../src/config/print-profiles.js")).text();
    assertEqual(src.includes("Math.random"), false);
  });
});
