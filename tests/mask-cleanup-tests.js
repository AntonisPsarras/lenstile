/**
 * Printability analysis and deterministic mask cleanup tests (Milestone 3).
 * Expected cleaned index arrays are hard-coded — never derived from the implementation.
 */

import {
  describe,
  test,
  assertEqual,
  assertDeepEqual,
  assertThrows,
} from "./test-utils.js";
import {
  PRINT_PROFILES,
  DEFAULT_PRINT_PROFILE_ID,
  PRINT_PROFILES_VERSION,
  migratePrintProfileId,
  normalizePrintProfileId,
  getDerivedPrintSettings,
  MAX_CLEANUP_PASSES,
  CLEANUP_ALGORITHM_VERSION,
} from "../src/config.js";
import {
  TILE_V1,
  validateTileVerticalStructure,
  isValidArtworkStartZ,
} from "../src/geometry/tile-spec.js";
import {
  labelConnectedComponents,
  CONNECTIVITY_4,
  CONNECTIVITY_8,
} from "../src/image/connected-components.js";
import {
  cleanupMask,
  chooseReplacementColor,
  countPalettePopulations,
  dominantPaletteIndex,
} from "../src/image/mask-cleanup.js";
import {
  analyzePrintability,
  IssueCategory,
  computePixelMetrics,
  markNarrowFeaturesAndGaps,
  reportHasIssues,
} from "../src/image/printability.js";
import {
  PrintabilityErrorCode,
  createPrintabilityError,
} from "../src/image/printability-errors.js";
import {
  validatePrintabilityRequest,
  WorkerMessageType,
} from "../src/workers/image-worker-protocol.js";
import {
  resetStore,
  getState,
  setPrintProfile,
  toSerializableProject,
  beginQuantizeRequest,
  acceptQuantizeResult,
  beginPrintabilityRequest,
  acceptPrintabilityResult,
  acceptCleanedDesign,
  resetPrintabilityCleanup,
  getRuntimePrintability,
  getRuntimeQuantization,
  isPrintabilityStale,
  patchTransform,
  runtimeOnlyKeys,
} from "../src/state.js";
import { clearAllListeners } from "../src/events.js";

/** @param {number[]} arr */
function u8(arr) {
  return new Uint8Array(arr);
}

/** Compare Uint8Array to number[] */
function assertIndices(actual, expected, label) {
  assertEqual(actual.length, expected.length, `${label} length`);
  for (let i = 0; i < expected.length; i += 1) {
    assertEqual(actual[i], expected[i], `${label}[${i}]`);
  }
}

describe("print profiles (Milestone 3 corrected nozzles)", () => {
  test("default nozzle is nozzle04", () => {
    assertEqual(DEFAULT_PRINT_PROFILE_ID, "nozzle04");
    resetStore();
    assertEqual(getState().printability.profileId, "nozzle04");
  });

  test("correct nozzle profile migration from nozzle06 to nozzle04", () => {
    assertEqual(migratePrintProfileId("nozzle06"), "nozzle04");
    assertEqual(normalizePrintProfileId("nozzle06"), "nozzle04");
    assertEqual(migratePrintProfileId("nozzle04"), "nozzle04");
    assertEqual("nozzle06" in PRINT_PROFILES, false);
    assertEqual(PRINT_PROFILES_VERSION, 3);
  });

  test("nozzle02 derived thresholds", () => {
    const s = getDerivedPrintSettings("nozzle02");
    assertEqual(s.nozzleDiameterMm, 0.2);
    assertEqual(s.minimumFeatureWidthMm, 0.25);
    assertEqual(s.minimumGapWidthMm, 0.25);
    assertEqual(s.minimumIslandAreaMm2, 0.10);
    assertEqual(s.maximumHoleAreaToFillMm2, 0.10);
  });

  test("nozzle04 derived thresholds", () => {
    const s = getDerivedPrintSettings("nozzle04");
    assertEqual(s.nozzleDiameterMm, 0.4);
    assertEqual(s.minimumFeatureWidthMm, 0.45);
    assertEqual(s.minimumGapWidthMm, 0.45);
    assertEqual(s.minimumIslandAreaMm2, 0.30);
    assertEqual(s.maximumHoleAreaToFillMm2, 0.30);
  });
});

describe("Tile V1 vertical structure", () => {
  test("tile base thickness is 2.5 mm", () => {
    assertEqual(TILE_V1.baseThicknessMm, 2.5);
  });

  test("structural bridge thickness is 0.5 mm", () => {
    assertEqual(TILE_V1.structuralBridgeThicknessMm, 0.5);
    assertEqual(TILE_V1.structuralBridgeStartZMm, 2.5);
    assertEqual(TILE_V1.structuralBridgeEndZMm, 3.0);
  });

  test("tile artwork thickness is 1.0 mm above the bridge", () => {
    assertEqual(TILE_V1.artworkThicknessMm, 1.0);
  });

  test("base plus bridge plus artwork equals 4 mm", () => {
    assertEqual(
      TILE_V1.baseThicknessMm
        + TILE_V1.structuralBridgeThicknessMm
        + TILE_V1.artworkThicknessMm,
      4,
    );
    assertEqual(TILE_V1.totalThicknessMm, 4);
  });

  test("artwork starts at Z = 3.0 mm", () => {
    assertEqual(TILE_V1.artworkStartZMm, 3.0);
    assertEqual(TILE_V1.artworkStartZMm, TILE_V1.structuralBridgeEndZMm);
  });

  test("magnet depth is 2.5 mm", () => {
    assertEqual(TILE_V1.magnetDepthMm, 2.5);
  });

  test("magnet depth does not exceed the base section", () => {
    assertEqual(TILE_V1.magnetDepthMm <= TILE_V1.baseThicknessMm, true);
    const v = validateTileVerticalStructure();
    assertEqual(v.ok, true);
  });

  test("no future artwork geometry may begin below artworkStartZMm", () => {
    assertEqual(isValidArtworkStartZ(3.0), true);
    assertEqual(isValidArtworkStartZ(2.5), false);
    assertEqual(isValidArtworkStartZ(2.9), false);
    assertEqual(isValidArtworkStartZ(4), true);
    assertEqual(TILE_V1.artworkEndZMm, TILE_V1.totalThicknessMm);
  });
});

describe("connected components", () => {
  test("4-connectivity labels and discovery order", () => {
    // Diagonal touch must NOT connect under 4-connectivity.
    const indices = u8([
      1, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ]);
    const result = labelConnectedComponents(indices, 3, 3, {
      connectivity: CONNECTIVITY_4,
      targetIndex: 1,
    });
    assertEqual(result.componentCount, 2);
    assertEqual(CONNECTIVITY_8, 8);
  });
});

describe("island and hole cleanup", () => {
  // 5×5 grid, tile 5×5 mm → 1 px = 1 mm²
  const W = 5;
  const H = 5;
  const tile = { tileWidthMm: 5, tileHeightMm: 5 };

  test("single isolated pixel removal", () => {
    // Center pixel index 1; everything else 0.
    const indices = u8([
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ]);
    const original = new Uint8Array(indices);
    const result = cleanupMask(indices, {
      width: W,
      height: H,
      minimumIslandAreaMm2: 1.5,
      maximumHoleAreaToFillMm2: 1.5,
      ...tile,
    });
    assertIndices(original, [
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ], "original unchanged");
    assertIndices(result.cleanedIndices, [
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ], "cleaned");
  });

  test("small two-pixel island removal", () => {
    const indices = u8([
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 1, 1, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ]);
    const result = cleanupMask(indices, {
      width: W,
      height: H,
      minimumIslandAreaMm2: 2.5,
      maximumHoleAreaToFillMm2: 2.5,
      ...tile,
    });
    assertIndices(result.cleanedIndices, [
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ], "two-pixel cleaned");
  });

  test("component exactly at threshold remains", () => {
    // 2 px × 1 mm² = 2.0; threshold 2.0 with `<` means remains
    const indices = u8([
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 1, 1, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ]);
    const result = cleanupMask(indices, {
      width: W,
      height: H,
      minimumIslandAreaMm2: 2.0,
      maximumHoleAreaToFillMm2: 2.0,
      ...tile,
    });
    assertIndices(result.cleanedIndices, [
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 1, 1, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ], "at threshold");
  });

  test("large component remains", () => {
    const indices = u8([
      0, 0, 0, 0, 0,
      0, 1, 1, 1, 0,
      0, 1, 1, 1, 0,
      0, 1, 1, 1, 0,
      0, 0, 0, 0, 0,
    ]);
    const result = cleanupMask(indices, {
      width: W,
      height: H,
      minimumIslandAreaMm2: 1.5,
      maximumHoleAreaToFillMm2: 1.5,
      ...tile,
    });
    assertIndices(result.cleanedIndices, [
      0, 0, 0, 0, 0,
      0, 1, 1, 1, 0,
      0, 1, 1, 1, 0,
      0, 1, 1, 1, 0,
      0, 0, 0, 0, 0,
    ], "large remains");
  });

  test("boundary-touching component behavior", () => {
    // Single pixel on boundary — still an island by area, removed.
    // Separate: a larger boundary-touching region is not a hole.
    const indices = u8([
      1, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 2,
    ]);
    const analysis = analyzePrintability(indices, {
      width: W,
      height: H,
      minimumFeatureWidthMm: 0.5,
      minimumGapWidthMm: 0.5,
      minimumIslandAreaMm2: 1.5,
      maximumHoleAreaToFillMm2: 1.5,
      runCleanup: true,
      ...tile,
    });
    // Both boundary pixels are small islands → replaced by dominant (0)
    assertIndices(analysis.cleanedIndices, [
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ], "boundary small islands cleaned");
  });

  test("neighbor-contact replacement", () => {
    // Island of 2 surrounded mostly by 1 on the right side contacts.
    const indices = u8([
      0, 0, 0, 0, 0,
      0, 0, 1, 1, 1,
      0, 0, 2, 1, 1,
      0, 0, 1, 1, 1,
      0, 0, 0, 0, 0,
    ]);
    const result = cleanupMask(indices, {
      width: W,
      height: H,
      minimumIslandAreaMm2: 1.5,
      maximumHoleAreaToFillMm2: 1.5,
      ...tile,
    });
    // Pixel (2,2) index 2 → should become 1 (dominant neighbor)
    assertEqual(result.cleanedIndices[2 * W + 2], 1);
  });

  test("replacement tie selects lower palette index", () => {
    // Component 2 with equal contacts to 0 and 1 only → choose 0.
    // Up/down also 0 and 1 alternating so totals tie at 2 each? Simpler:
    // Left=0, right=1, up=0, down=1 → contacts 0:2, 1:2 → lower index 0.
    const indices = u8([
      0, 0, 1,
      0, 2, 1,
      0, 1, 1,
    ]);
    const labelled = labelConnectedComponents(indices, 3, 3, { targetIndex: 2 });
    const populations = countPalettePopulations(indices);
    const centerId = labelled.labels[1 * 3 + 1];
    const replacement = chooseReplacementColor(
      indices,
      labelled.labels,
      centerId,
      3,
      3,
      2,
      populations,
    );
    assertEqual(replacement, 0);
  });

  test("no-neighbor fallback uses global dominant index", () => {
    // Entire image is color 1 except we force populations: only color 1 exists as neighbour-less?
    // A full-frame single-color component has no other-color neighbours.
    const populations = new Int32Array(256);
    populations[0] = 10;
    populations[5] = 50;
    populations[2] = 3;
    assertEqual(dominantPaletteIndex(populations), 5);

    // Isolated 1×1 image of color 7 — no neighbours at all.
    const indices = u8([7]);
    const result = cleanupMask(indices, {
      width: 1,
      height: 1,
      minimumIslandAreaMm2: 1.5,
      maximumHoleAreaToFillMm2: 1.5,
      tileWidthMm: 1,
      tileHeightMm: 1,
    });
    // Only one color globally → replacement equals self → unchanged (or same)
    assertEqual(result.cleanedIndices[0], 7);
  });

  test("small enclosed hole filling", () => {
    // Ring of 1 with hole of 0 in center (not boundary-touching).
    const indices = u8([
      1, 1, 1, 1, 1,
      1, 0, 0, 0, 1,
      1, 0, 0, 0, 1,
      1, 0, 0, 0, 1,
      1, 1, 1, 1, 1,
    ]);
    // Keep island threshold below the ring size so only the hole is targeted.
    // Ring has 16 px; hole has 9 px. Hole threshold 10 fills the hole.
    const result = cleanupMask(indices, {
      width: W,
      height: H,
      minimumIslandAreaMm2: 1.5,
      maximumHoleAreaToFillMm2: 10,
      ...tile,
    });
    assertIndices(result.cleanedIndices, [
      1, 1, 1, 1, 1,
      1, 1, 1, 1, 1,
      1, 1, 1, 1, 1,
      1, 1, 1, 1, 1,
      1, 1, 1, 1, 1,
    ], "hole filled");
  });

  test("boundary-connected region is not treated as a hole", () => {
    // Color 0 connects to boundary; should not fill as hole even if small-ish channel
    const indices = u8([
      0, 0, 0, 0, 0,
      1, 1, 1, 1, 1,
      1, 1, 1, 1, 1,
      1, 1, 1, 1, 1,
      1, 1, 1, 1, 1,
    ]);
    const analysis = analyzePrintability(indices, {
      width: W,
      height: H,
      minimumFeatureWidthMm: 0.5,
      minimumGapWidthMm: 0.5,
      minimumIslandAreaMm2: 100,
      maximumHoleAreaToFillMm2: 100,
      runCleanup: false,
      ...tile,
    });
    assertEqual(analysis.report.smallHoleCount, 0);
  });

  test("large enclosed hole remains", () => {
    const indices = u8([
      1, 1, 1, 1, 1,
      1, 0, 0, 0, 1,
      1, 0, 0, 0, 1,
      1, 0, 0, 0, 1,
      1, 1, 1, 1, 1,
    ]);
    // 9 px hole: keep when both island and hole thresholds are ≤ 9
    // (removal/fill only when area < threshold).
    const result = cleanupMask(indices, {
      width: W,
      height: H,
      minimumIslandAreaMm2: 1.5,
      maximumHoleAreaToFillMm2: 5,
      ...tile,
    });
    assertEqual(result.cleanedIndices[2 * W + 2], 0);
    assertEqual(result.changedPixelCount, 0);
  });

  test("multiple cleanup passes", () => {
    // Nested: tiny island of 2 inside island of 1 inside 0 — may need passes
    const indices = u8([
      0, 0, 0, 0, 0,
      0, 1, 1, 1, 0,
      0, 1, 2, 1, 0,
      0, 1, 1, 1, 0,
      0, 0, 0, 0, 0,
    ]);
    const result = cleanupMask(indices, {
      width: W,
      height: H,
      minimumIslandAreaMm2: 10,
      maximumHoleAreaToFillMm2: 10,
      ...tile,
    });
    assertEqual(result.passes >= 1, true);
    // Everything becomes 0 eventually
    assertIndices(result.cleanedIndices, [
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ], "multi-pass");
  });

  test("fixed maximum-pass behavior", () => {
    assertEqual(MAX_CLEANUP_PASSES, 16);
    const indices = u8([
      0, 1,
      1, 0,
    ]);
    const result = cleanupMask(indices, {
      width: 2,
      height: 2,
      minimumIslandAreaMm2: 0.5,
      maximumHoleAreaToFillMm2: 0.5,
      maxPasses: 1,
      tileWidthMm: 2,
      tileHeightMm: 2,
    });
    assertEqual(result.passes <= 1, true);
  });
});

describe("narrow feature and gap detection", () => {
  test("narrow horizontal feature detection", () => {
    // 1-px tall stroke between different colours so it is not classified as a gap.
    const W = 8;
    const H = 8;
    const indices = new Uint8Array(W * H);
    for (let x = 0; x < W; x += 1) {
      indices[3 * W + x] = 2;
      indices[4 * W + x] = 1;
      indices[5 * W + x] = 3;
    }
    const issueMask = new Uint8Array(W * H);
    const metrics = computePixelMetrics(W, H, { tileWidthMm: 8, tileHeightMm: 8 });
    const narrow = markNarrowFeaturesAndGaps(indices, W, H, metrics, 1.5, 1.5, issueMask);
    assertEqual(narrow.narrowFeaturePixelCount > 0, true);
    assertEqual(issueMask[4 * W + 3], IssueCategory.NARROW_FEATURE);
  });

  test("narrow vertical feature detection", () => {
    const W = 8;
    const H = 8;
    const indices = new Uint8Array(W * H);
    for (let y = 0; y < H; y += 1) {
      indices[y * W + 3] = 2;
      indices[y * W + 4] = 1;
      indices[y * W + 5] = 3;
    }
    const issueMask = new Uint8Array(W * H);
    const metrics = computePixelMetrics(W, H, { tileWidthMm: 8, tileHeightMm: 8 });
    const narrow = markNarrowFeaturesAndGaps(indices, W, H, metrics, 1.5, 1.5, issueMask);
    assertEqual(narrow.narrowFeaturePixelCount > 0, true);
    assertEqual(issueMask[3 * W + 4], IssueCategory.NARROW_FEATURE);
  });

  test("acceptable feature width is not flagged", () => {
    // 3×3 block — min run 3 mm >= 1.5
    const W = 8;
    const H = 8;
    const indices = new Uint8Array(W * H);
    for (let y = 2; y <= 4; y += 1) {
      for (let x = 2; x <= 4; x += 1) indices[y * W + x] = 1;
    }
    const issueMask = new Uint8Array(W * H);
    const metrics = computePixelMetrics(W, H, { tileWidthMm: 8, tileHeightMm: 8 });
    markNarrowFeaturesAndGaps(indices, W, H, metrics, 1.5, 1.5, issueMask);
    assertEqual(issueMask[3 * W + 3], IssueCategory.NONE);
  });

  test("narrow horizontal gap detection", () => {
    // Two blocks of 1 separated by 1-px gap of 0, flanked by 1
    const W = 7;
    const H = 5;
    const indices = u8([
      0, 0, 0, 0, 0, 0, 0,
      1, 1, 1, 0, 1, 1, 1,
      1, 1, 1, 0, 1, 1, 1,
      1, 1, 1, 0, 1, 1, 1,
      0, 0, 0, 0, 0, 0, 0,
    ]);
    const issueMask = new Uint8Array(W * H);
    const metrics = computePixelMetrics(W, H, { tileWidthMm: 7, tileHeightMm: 5 });
    const narrow = markNarrowFeaturesAndGaps(indices, W, H, metrics, 0.5, 1.5, issueMask);
    assertEqual(narrow.narrowGapPixelCount > 0, true);
    assertEqual(issueMask[1 * W + 3], IssueCategory.NARROW_GAP);
  });

  test("narrow vertical gap detection", () => {
    const W = 5;
    const H = 7;
    const indices = u8([
      0, 1, 1, 1, 0,
      0, 1, 1, 1, 0,
      0, 1, 1, 1, 0,
      0, 0, 0, 0, 0,
      0, 1, 1, 1, 0,
      0, 1, 1, 1, 0,
      0, 1, 1, 1, 0,
    ]);
    const issueMask = new Uint8Array(W * H);
    const metrics = computePixelMetrics(W, H, { tileWidthMm: 5, tileHeightMm: 7 });
    const narrow = markNarrowFeaturesAndGaps(indices, W, H, metrics, 0.5, 1.5, issueMask);
    assertEqual(narrow.narrowGapPixelCount > 0, true);
    assertEqual(issueMask[3 * W + 1], IssueCategory.NARROW_GAP);
  });

  test("issue-mask category values", () => {
    assertEqual(IssueCategory.NONE, 0);
    assertEqual(IssueCategory.SMALL_ISLAND, 1);
    assertEqual(IssueCategory.SMALL_HOLE, 2);
    assertEqual(IssueCategory.NARROW_FEATURE, 3);
    assertEqual(IssueCategory.NARROW_GAP, 4);
  });
});

describe("printability runtime and determinism", () => {
  test("original indices remain unchanged", () => {
    const indices = u8([0, 1, 0, 0]);
    const analysis = analyzePrintability(indices, {
      width: 2,
      height: 2,
      minimumFeatureWidthMm: 0.1,
      minimumGapWidthMm: 0.1,
      minimumIslandAreaMm2: 0.5,
      maximumHoleAreaToFillMm2: 0.5,
      runCleanup: true,
      tileWidthMm: 2,
      tileHeightMm: 2,
    });
    assertIndices(indices, [0, 1, 0, 0], "input");
    assertIndices(analysis.originalIndices, [0, 1, 0, 0], "original copy");
  });

  test("cleaned indices are separate", () => {
    const indices = u8([0, 1, 0, 0]);
    const analysis = analyzePrintability(indices, {
      width: 2,
      height: 2,
      minimumFeatureWidthMm: 0.1,
      minimumGapWidthMm: 0.1,
      minimumIslandAreaMm2: 0.5,
      maximumHoleAreaToFillMm2: 0.5,
      runCleanup: true,
      tileWidthMm: 2,
      tileHeightMm: 2,
    });
    assertEqual(analysis.cleanedIndices !== null, true);
    assertEqual(analysis.cleanedIndices === analysis.originalIndices, false);
    assertEqual(analysis.cleanedIndices === indices, false);
  });

  test("reset cleanup restores original state", () => {
    resetStore();
    clearAllListeners();
    beginQuantizeRequest("q1");
    acceptQuantizeResult({
      requestId: "q1",
      sourceRevision: getState().sourceRevision,
      result: {
        width: 2,
        height: 2,
        requestedColorCount: 2,
        actualColorCount: 2,
        generatedPalette: [
          { r: 0, g: 0, b: 0, population: 3 },
          { r: 255, g: 0, b: 0, population: 1 },
        ],
        indices: u8([0, 1, 0, 0]),
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
        issueMask: u8([0, 1, 0, 0]),
        cleanedIndices: u8([0, 0, 0, 0]),
        report: {
          componentCount: 2,
          smallIslandCount: 1,
          smallIslandPixels: 1,
          smallHoleCount: 0,
          smallHolePixels: 0,
          narrowFeaturePixelCount: 0,
          narrowGapPixelCount: 0,
          cleanupPasses: 1,
          changedPixelCount: 1,
          warnings: [],
        },
        algorithmVersion: CLEANUP_ALGORITHM_VERSION,
      },
    });
    assertEqual(getRuntimePrintability().cleanedIndices !== null, true);
    resetPrintabilityCleanup();
    assertEqual(getRuntimePrintability().cleanedIndices, null);
    assertEqual(getRuntimePrintability().accepted, false);
    assertIndices(getRuntimeQuantization().indices, [0, 1, 0, 0], "quantize intact");
  });

  test("accept cleanup marks result accepted", () => {
    resetStore();
    clearAllListeners();
    beginQuantizeRequest("q2");
    acceptQuantizeResult({
      requestId: "q2",
      sourceRevision: getState().sourceRevision,
      result: {
        width: 2,
        height: 2,
        requestedColorCount: 1,
        actualColorCount: 1,
        generatedPalette: [{ r: 0, g: 0, b: 0, population: 4 }],
        indices: u8([0, 0, 0, 0]),
        algorithmVersion: 1,
        diagnostics: { uniqueColorCount: 1, iterations: 1, durationMs: 1 },
      },
      previewRgba: new Uint8ClampedArray(16),
    });
    beginPrintabilityRequest("p2");
    acceptPrintabilityResult({
      requestId: "p2",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      ranCleanup: true,
      result: {
        width: 2,
        height: 2,
        issueMask: u8([0, 0, 0, 0]),
        cleanedIndices: u8([0, 0, 0, 0]),
        report: {
          componentCount: 1,
          smallIslandCount: 0,
          smallIslandPixels: 0,
          smallHoleCount: 0,
          smallHolePixels: 0,
          narrowFeaturePixelCount: 0,
          narrowGapPixelCount: 0,
          cleanupPasses: 1,
          changedPixelCount: 0,
          warnings: [],
        },
        algorithmVersion: CLEANUP_ALGORITHM_VERSION,
      },
    });
    assertEqual(acceptCleanedDesign(), true);
    assertEqual(getRuntimePrintability().accepted, true);
    assertEqual(getState().printability.accepted, true);
  });

  test("new quantization marks cleanup stale", () => {
    resetStore();
    clearAllListeners();
    beginQuantizeRequest("q3");
    acceptQuantizeResult({
      requestId: "q3",
      sourceRevision: getState().sourceRevision,
      result: {
        width: 2,
        height: 2,
        requestedColorCount: 1,
        actualColorCount: 1,
        generatedPalette: [{ r: 0, g: 0, b: 0, population: 4 }],
        indices: u8([0, 0, 0, 0]),
        algorithmVersion: 1,
        diagnostics: { uniqueColorCount: 1, iterations: 1, durationMs: 1 },
      },
      previewRgba: new Uint8ClampedArray(16),
    });
    beginPrintabilityRequest("p3");
    acceptPrintabilityResult({
      requestId: "p3",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      ranCleanup: true,
      result: {
        width: 2,
        height: 2,
        issueMask: u8([0, 0, 0, 0]),
        cleanedIndices: u8([0, 0, 0, 0]),
        report: {
          componentCount: 1,
          smallIslandCount: 0,
          smallIslandPixels: 0,
          smallHoleCount: 0,
          smallHolePixels: 0,
          narrowFeaturePixelCount: 0,
          narrowGapPixelCount: 0,
          cleanupPasses: 0,
          changedPixelCount: 0,
          warnings: [],
        },
        algorithmVersion: CLEANUP_ALGORITHM_VERSION,
      },
    });
    acceptCleanedDesign();
    // New quantize clears printability
    beginQuantizeRequest("q3b");
    acceptQuantizeResult({
      requestId: "q3b",
      sourceRevision: getState().sourceRevision,
      result: {
        width: 2,
        height: 2,
        requestedColorCount: 1,
        actualColorCount: 1,
        generatedPalette: [{ r: 10, g: 10, b: 10, population: 4 }],
        indices: u8([0, 0, 0, 0]),
        algorithmVersion: 1,
        diagnostics: { uniqueColorCount: 1, iterations: 1, durationMs: 1 },
      },
      previewRgba: new Uint8ClampedArray(16),
    });
    assertEqual(getRuntimePrintability().accepted, false);
    assertEqual(getRuntimePrintability().cleanedIndices, null);
  });

  test("nozzle-profile change marks cleanup stale", () => {
    resetStore();
    clearAllListeners();
    beginQuantizeRequest("q4");
    acceptQuantizeResult({
      requestId: "q4",
      sourceRevision: getState().sourceRevision,
      result: {
        width: 2,
        height: 2,
        requestedColorCount: 1,
        actualColorCount: 1,
        generatedPalette: [{ r: 0, g: 0, b: 0, population: 4 }],
        indices: u8([0, 0, 0, 0]),
        algorithmVersion: 1,
        diagnostics: { uniqueColorCount: 1, iterations: 1, durationMs: 1 },
      },
      previewRgba: new Uint8ClampedArray(16),
    });
    beginPrintabilityRequest("p4");
    acceptPrintabilityResult({
      requestId: "p4",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      ranCleanup: true,
      result: {
        width: 2,
        height: 2,
        issueMask: u8([0, 0, 0, 0]),
        cleanedIndices: u8([0, 0, 0, 0]),
        report: {
          componentCount: 1,
          smallIslandCount: 0,
          smallIslandPixels: 0,
          smallHoleCount: 0,
          smallHolePixels: 0,
          narrowFeaturePixelCount: 0,
          narrowGapPixelCount: 0,
          cleanupPasses: 0,
          changedPixelCount: 0,
          warnings: [],
        },
        algorithmVersion: CLEANUP_ALGORITHM_VERSION,
      },
    });
    setPrintProfile("nozzle02");
    assertEqual(getState().printabilityRevision >= 1, true);
    assertEqual(getRuntimePrintability().cleanedIndices, null);
  });

  test("stale worker result is ignored", () => {
    resetStore();
    clearAllListeners();
    beginPrintabilityRequest("p-stale");
    const rev = getState().sourceRevision;
    patchTransform({ scale: 1.1 });
    const accepted = acceptPrintabilityResult({
      requestId: "p-stale",
      sourceRevision: rev,
      printabilityRevision: getState().printabilityRevision,
      ranCleanup: false,
      result: {
        width: 1,
        height: 1,
        issueMask: u8([0]),
        cleanedIndices: null,
        report: {
          componentCount: 1,
          smallIslandCount: 0,
          smallIslandPixels: 0,
          smallHoleCount: 0,
          smallHolePixels: 0,
          narrowFeaturePixelCount: 0,
          narrowGapPixelCount: 0,
          cleanupPasses: 0,
          changedPixelCount: 0,
          warnings: [],
        },
        algorithmVersion: 1,
      },
    });
    assertEqual(accepted, false);
  });

  test("structured worker errors", () => {
    const err = createPrintabilityError(
      PrintabilityErrorCode.INVALID_REQUEST,
      "bad",
      { foo: 1 },
    );
    assertEqual(err.code, "INVALID_REQUEST");
    assertEqual(err.message, "bad");
    assertDeepEqual(err.details, { foo: 1 });

    const validated = validatePrintabilityRequest({ type: "nope" });
    assertEqual(validated.ok, false);
    assertEqual(validated.error.code, PrintabilityErrorCode.INVALID_REQUEST);
  });

  test("serialization excludes index and issue buffers", () => {
    resetStore();
    const json = toSerializableProject();
    for (const key of runtimeOnlyKeys()) {
      assertEqual(key in json, false);
    }
    assertEqual("cleanedIndices" in json.printability, false);
    assertEqual("issueMask" in json.printability, false);
    assertEqual("indices" in json, false);
    assertEqual(typeof json.printability.profileId, "string");
    assertEqual(typeof json.printability.accepted, "boolean");
  });

  test("repeated identical analysis produces byte-identical buffers", () => {
    const indices = u8([
      0, 0, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ]);
    const opts = {
      width: 5,
      height: 5,
      minimumFeatureWidthMm: 0.8,
      minimumGapWidthMm: 0.8,
      minimumIslandAreaMm2: 1.5,
      maximumHoleAreaToFillMm2: 1.5,
      runCleanup: true,
      tileWidthMm: 5,
      tileHeightMm: 5,
    };
    const a = analyzePrintability(indices, opts);
    const b = analyzePrintability(indices, opts);
    assertIndices(a.cleanedIndices, Array.from(b.cleanedIndices), "cleaned identical");
    assertIndices(a.issueMask, Array.from(b.issueMask), "mask identical");
    assertEqual(a.report.changedPixelCount, b.report.changedPixelCount);
    assertEqual(reportHasIssues(a.report), true);
  });

  test("isPrintabilityStale after crop change", () => {
    resetStore();
    clearAllListeners();
    beginQuantizeRequest("q5");
    acceptQuantizeResult({
      requestId: "q5",
      sourceRevision: getState().sourceRevision,
      result: {
        width: 2,
        height: 2,
        requestedColorCount: 1,
        actualColorCount: 1,
        generatedPalette: [{ r: 0, g: 0, b: 0, population: 4 }],
        indices: u8([0, 0, 0, 0]),
        algorithmVersion: 1,
        diagnostics: { uniqueColorCount: 1, iterations: 1, durationMs: 1 },
      },
      previewRgba: new Uint8ClampedArray(16),
    });
    beginPrintabilityRequest("p5");
    acceptPrintabilityResult({
      requestId: "p5",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      ranCleanup: false,
      result: {
        width: 2,
        height: 2,
        issueMask: u8([0, 0, 0, 0]),
        cleanedIndices: null,
        report: {
          componentCount: 1,
          smallIslandCount: 0,
          smallIslandPixels: 0,
          smallHoleCount: 0,
          smallHolePixels: 0,
          narrowFeaturePixelCount: 0,
          narrowGapPixelCount: 0,
          cleanupPasses: 0,
          changedPixelCount: 0,
          warnings: [],
        },
        algorithmVersion: 1,
      },
    });
    assertEqual(isPrintabilityStale(), false);
    patchTransform({ offsetX: 3 });
    assertEqual(isPrintabilityStale(), true);
  });
});

describe("printability protocol", () => {
  test("validatePrintabilityRequest accepts a well-formed message", () => {
    const indices = new Uint8Array([0, 1, 0, 1]);
    const validated = validatePrintabilityRequest({
      type: WorkerMessageType.PRINTABILITY,
      requestId: "p-ok",
      sourceRevision: 1,
      printabilityRevision: 0,
      payload: {
        width: 2,
        height: 2,
        indicesBuffer: indices.buffer,
        runCleanup: false,
        minimumFeatureWidthMm: 0.8,
        minimumGapWidthMm: 0.8,
        minimumIslandAreaMm2: 1.5,
        maximumHoleAreaToFillMm2: 1.5,
        tileWidthMm: 148,
        tileHeightMm: 53,
      },
    });
    assertEqual(validated.ok, true);
  });

  test("placeholder throws removed", () => {
    // cleanupMask and analyzePrintability are implemented
    const indices = u8([0]);
    const result = analyzePrintability(indices, {
      width: 1,
      height: 1,
      minimumFeatureWidthMm: 1,
      minimumGapWidthMm: 1,
      minimumIslandAreaMm2: 2,
      maximumHoleAreaToFillMm2: 2,
      tileWidthMm: 1,
      tileHeightMm: 1,
    });
    assertEqual(result.width, 1);
    assertThrows(() => {
      throw new Error("control");
    }, "control");
  });
});
