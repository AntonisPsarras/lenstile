/**
 * Deterministic printability issue categories and physical metrics helpers.
 */

import { MAX_CLEANUP_PASSES, CLEANUP_ALGORITHM_VERSION } from "../config.js";
import { labelConnectedComponents, CONNECTIVITY_4 } from "./connected-components.js";
import { cleanupMask } from "./mask-cleanup.js";
import { computePixelMetrics } from "./pixel-metrics.js";

export { computePixelMetrics } from "./pixel-metrics.js";

/**
 * Issue-mask category values (diagnostic overlay only — never written into palette indices).
 * @enum {number}
 */
export const IssueCategory = Object.freeze({
  NONE: 0,
  SMALL_ISLAND: 1,
  SMALL_HOLE: 2,
  NARROW_FEATURE: 3,
  NARROW_GAP: 4,
});

/**
 * Printability workflow status values.
 * @enum {string}
 */
export const PrintabilityStatus = Object.freeze({
  NOT_ANALYZED: "not_analyzed",
  ANALYZING: "analyzing",
  ISSUES_FOUND: "issues_found",
  NO_ISSUES: "no_issues",
  CLEANED_PREVIEW: "cleaned_preview",
  ACCEPTED: "accepted",
  STALE: "stale",
  ERROR: "error",
});

/**
 * Empty report structure.
 * @returns {import("./mask-cleanup.js").PrintabilityReport}
 */
export function createEmptyReport() {
  return {
    componentCount: 0,
    smallIslandCount: 0,
    smallIslandPixels: 0,
    smallHoleCount: 0,
    smallHolePixels: 0,
    narrowFeaturePixelCount: 0,
    narrowGapPixelCount: 0,
    cleanupPasses: 0,
    changedPixelCount: 0,
    expandedPixelCount: 0,
    warnings: [],
  };
}

/**
 * Precompute horizontal and vertical same-color run lengths (pixels) for each cell.
 * @param {Uint8Array | Uint8ClampedArray} indices
 * @param {number} width
 * @param {number} height
 * @returns {{ hRun: Uint16Array, vRun: Uint16Array }}
 */
export function computeRunLengths(indices, width, height) {
  const n = width * height;
  const hRun = new Uint16Array(n);
  const vRun = new Uint16Array(n);

  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      const start = x;
      const color = indices[y * width + x];
      x += 1;
      while (x < width && indices[y * width + x] === color) x += 1;
      const len = x - start;
      for (let i = start; i < x; i += 1) {
        hRun[y * width + i] = len;
      }
    }
  }

  for (let x = 0; x < width; x += 1) {
    let y = 0;
    while (y < height) {
      const start = y;
      const color = indices[y * width + x];
      y += 1;
      while (y < height && indices[y * width + x] === color) y += 1;
      const len = y - start;
      for (let i = start; i < y; i += 1) {
        vRun[i * width + x] = len;
      }
    }
  }

  return { hRun, vRun };
}

/**
 * Mark narrow features and gaps into issueMask (does not modify indices).
 * Features: min(hRunMm, vRunMm) < minimumFeatureWidthMm
 * Gaps: axis-aligned interior runs flanked by the same foreign color, length < minimumGapWidthMm
 * Gap takes precedence over feature on the same pixel for the diagnostic overlay.
 *
 * @param {Uint8Array | Uint8ClampedArray} indices
 * @param {number} width
 * @param {number} height
 * @param {import("./pixel-metrics.js").PixelMetrics} metrics
 * @param {number} minimumFeatureWidthMm
 * @param {number} minimumGapWidthMm
 * @param {Uint8Array} issueMask
 * @returns {{ narrowFeaturePixelCount: number, narrowGapPixelCount: number }}
 */
export function markNarrowFeaturesAndGaps(
  indices,
  width,
  height,
  metrics,
  minimumFeatureWidthMm,
  minimumGapWidthMm,
  issueMask,
) {
  const { hRun, vRun } = computeRunLengths(indices, width, height);
  const { pxWidthMm, pxHeightMm } = metrics;
  const featureScratch = new Uint8Array(width * height);
  const gapScratch = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const color = indices[i];
      const hMm = hRun[i] * pxWidthMm;
      const vMm = vRun[i] * pxHeightMm;
      const localWidth = hMm < vMm ? hMm : vMm;

      if (localWidth < minimumFeatureWidthMm) {
        featureScratch[i] = 1;
      }

      const hLen = hRun[i];
      let hStart = x;
      while (hStart > 0 && indices[y * width + (hStart - 1)] === color) hStart -= 1;
      const hEnd = hStart + hLen - 1;
      if (hStart > 0 && hEnd < width - 1 && hMm < minimumGapWidthMm) {
        const left = indices[y * width + (hStart - 1)];
        const right = indices[y * width + (hEnd + 1)];
        if (left === right && left !== color) {
          gapScratch[i] = 1;
        }
      }

      const vLen = vRun[i];
      let vStart = y;
      while (vStart > 0 && indices[(vStart - 1) * width + x] === color) vStart -= 1;
      const vEnd = vStart + vLen - 1;
      if (vStart > 0 && vEnd < height - 1 && vMm < minimumGapWidthMm) {
        const up = indices[(vStart - 1) * width + x];
        const down = indices[(vEnd + 1) * width + x];
        if (up === down && up !== color) {
          gapScratch[i] = 1;
        }
      }
    }
  }

  let narrowFeaturePixelCount = 0;
  let narrowGapPixelCount = 0;
  for (let i = 0; i < issueMask.length; i += 1) {
    if (issueMask[i] !== IssueCategory.NONE) continue;
    if (gapScratch[i]) {
      issueMask[i] = IssueCategory.NARROW_GAP;
      narrowGapPixelCount += 1;
    } else if (featureScratch[i]) {
      issueMask[i] = IssueCategory.NARROW_FEATURE;
      narrowFeaturePixelCount += 1;
    }
  }

  return { narrowFeaturePixelCount, narrowGapPixelCount };
}

/**
 * Mark small islands and enclosed holes on the issue mask (analysis only).
 *
 * @param {Uint8Array | Uint8ClampedArray} indices
 * @param {number} width
 * @param {number} height
 * @param {import("./pixel-metrics.js").PixelMetrics} metrics
 * @param {number} minimumIslandAreaMm2
 * @param {number} maximumHoleAreaToFillMm2
 * @param {Uint8Array} issueMask
 * @returns {{
 *   componentCount: number,
 *   smallIslandCount: number,
 *   smallIslandPixels: number,
 *   smallHoleCount: number,
 *   smallHolePixels: number,
 * }}
 */
export function markIslandsAndHoles(
  indices,
  width,
  height,
  metrics,
  minimumIslandAreaMm2,
  maximumHoleAreaToFillMm2,
  issueMask,
) {
  const labelled = labelConnectedComponents(indices, width, height, {
    connectivity: CONNECTIVITY_4,
  });
  let smallIslandCount = 0;
  let smallIslandPixels = 0;
  let smallHoleCount = 0;
  let smallHolePixels = 0;

  for (const comp of labelled.components) {
    const areaMm2 = comp.pixelCount * metrics.pixelAreaMm2;
    const isSmallIsland = areaMm2 < minimumIslandAreaMm2;
    // Holes: enclosed (not boundary-touching) and below hole-fill threshold.
    // When also below the island threshold, classify as island (precedence).
    const isSmallHole = !comp.touchesBoundary
      && areaMm2 < maximumHoleAreaToFillMm2
      && !isSmallIsland;

    if (isSmallIsland) {
      smallIslandCount += 1;
      smallIslandPixels += comp.pixelCount;
      for (let i = 0; i < labelled.labels.length; i += 1) {
        if (labelled.labels[i] === comp.id) {
          issueMask[i] = IssueCategory.SMALL_ISLAND;
        }
      }
    } else if (isSmallHole) {
      smallHoleCount += 1;
      smallHolePixels += comp.pixelCount;
      for (let i = 0; i < labelled.labels.length; i += 1) {
        if (labelled.labels[i] === comp.id && issueMask[i] === IssueCategory.NONE) {
          issueMask[i] = IssueCategory.SMALL_HOLE;
        }
      }
    }
  }

  return {
    componentCount: labelled.componentCount,
    smallIslandCount,
    smallIslandPixels,
    smallHoleCount,
    smallHolePixels,
  };
}

/**
 * Analyze printability of an indexed-color buffer. Does not mutate indices.
 *
 * @param {Uint8Array | Uint8ClampedArray} indices
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {number} opts.minimumFeatureWidthMm
 * @param {number} opts.minimumGapWidthMm
 * @param {number} opts.minimumIslandAreaMm2
 * @param {number} opts.maximumHoleAreaToFillMm2
 * @param {number} [opts.tileWidthMm]
 * @param {number} [opts.tileHeightMm]
 * @param {boolean} [opts.runCleanup] When true, also produce cleanedIndices
 * @param {number} [opts.maxPasses]
 * @returns {{
 *   width: number,
 *   height: number,
 *   originalIndices: Uint8Array,
 *   cleanedIndices: Uint8Array | null,
 *   issueMask: Uint8Array,
 *   report: import("./mask-cleanup.js").PrintabilityReport,
 *   algorithmVersion: number,
 * }}
 */
export function analyzePrintability(indices, opts) {
  const width = opts.width;
  const height = opts.height;
  const expected = width * height;
  if (!indices || indices.length !== expected) {
    throw new Error(`analyzePrintability: index length mismatch (${indices ? indices.length : 0} vs ${expected}).`);
  }

  const metrics = computePixelMetrics(width, height, {
    tileWidthMm: opts.tileWidthMm,
    tileHeightMm: opts.tileHeightMm,
  });

  const originalIndices = indices instanceof Uint8Array
    ? new Uint8Array(indices)
    : Uint8Array.from(indices);

  const issueMask = new Uint8Array(expected);
  const islandHole = markIslandsAndHoles(
    originalIndices,
    width,
    height,
    metrics,
    opts.minimumIslandAreaMm2,
    opts.maximumHoleAreaToFillMm2,
    issueMask,
  );

  const narrow = markNarrowFeaturesAndGaps(
    originalIndices,
    width,
    height,
    metrics,
    opts.minimumFeatureWidthMm,
    opts.minimumGapWidthMm,
    issueMask,
  );

  /** @type {string[]} */
  const warnings = [];
  if (narrow.narrowFeaturePixelCount > 0) {
    warnings.push(
      "Narrow features detected. Automatic cleanup does not erode large components; review the overlay.",
    );
  }
  if (narrow.narrowGapPixelCount > 0) {
    warnings.push(
      "Narrow gaps detected. Automatic cleanup fills only small enclosed holes, not intentional openings.",
    );
  }

  let cleanedIndices = null;
  let cleanupPasses = 0;
  let changedPixelCount = 0;
  let expandedPixelCount = 0;

  if (opts.runCleanup) {
    const cleaned = cleanupMask(originalIndices, {
      width,
      height,
      minimumIslandAreaMm2: opts.minimumIslandAreaMm2,
      maximumHoleAreaToFillMm2: opts.maximumHoleAreaToFillMm2,
      minimumFeatureWidthMm: opts.minimumFeatureWidthMm,
      thickenNarrowFeatures: opts.thickenNarrowFeatures,
      maxPasses: opts.maxPasses ?? MAX_CLEANUP_PASSES,
      metrics,
    });
    cleanedIndices = cleaned.cleanedIndices;
    cleanupPasses = cleaned.passes;
    changedPixelCount = cleaned.changedPixelCount;
    expandedPixelCount = cleaned.expandedPixelCount || 0;
    if (expandedPixelCount > 0) {
      warnings.push(
        `Expanded ${expandedPixelCount} pixel(s) to preserve narrow printable details.`,
      );
    }
    if (cleaned.hitMaxPasses) {
      warnings.push(
        `Cleanup stopped after ${MAX_CLEANUP_PASSES} passes; some small regions may remain.`,
      );
    }
  }

  return {
    width,
    height,
    originalIndices,
    cleanedIndices,
    issueMask,
    report: {
      componentCount: islandHole.componentCount,
      smallIslandCount: islandHole.smallIslandCount,
      smallIslandPixels: islandHole.smallIslandPixels,
      smallHoleCount: islandHole.smallHoleCount,
      smallHolePixels: islandHole.smallHolePixels,
      narrowFeaturePixelCount: narrow.narrowFeaturePixelCount,
      narrowGapPixelCount: narrow.narrowGapPixelCount,
      cleanupPasses,
      changedPixelCount,
      expandedPixelCount,
      warnings,
    },
    algorithmVersion: CLEANUP_ALGORITHM_VERSION,
  };
}

/**
 * Total issue pixels in a mask.
 * @param {Uint8Array} issueMask
 */
export function countIssuePixels(issueMask) {
  let n = 0;
  for (let i = 0; i < issueMask.length; i += 1) {
    if (issueMask[i] !== IssueCategory.NONE) n += 1;
  }
  return n;
}

/**
 * True when the report has any actionable printability findings.
 * @param {import("./mask-cleanup.js").PrintabilityReport} report
 */
export function reportHasIssues(report) {
  return (
    report.smallIslandCount > 0
    || report.smallHoleCount > 0
    || report.narrowFeaturePixelCount > 0
    || report.narrowGapPixelCount > 0
  );
}
