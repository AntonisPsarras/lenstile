/**
 * Deterministic indexed-mask cleanup for printability (Milestone 3 / 7.3.2).
 *
 * Replacement rules (islands / holes):
 * 1. Inspect 4-connected boundary neighbours belonging to other palette indices.
 * 2. Count contacts by palette index.
 * 3. Choose the index with the most boundary contacts.
 * 4. Resolve ties by lower palette index.
 * 5. If there are no neighbouring colours, use the globally most populated palette index.
 * 6. Never use randomness.
 *
 * Passes repeat until no qualifying islands/holes remain or MAX_CLEANUP_PASSES is hit.
 *
 * After island/hole cleanup, an optional deterministic feature-thickening pass
 * expands connected narrow branches toward the printable minimum width without
 * overwriting large neighboring features.
 */

import { MAX_CLEANUP_PASSES } from "../config.js";
import {
  labelConnectedComponents,
  CONNECTIVITY_4,
  neighbourOffsets,
} from "./connected-components.js";
import { computePixelMetrics } from "./pixel-metrics.js";
import { thickenNarrowFeatures } from "./feature-thicken.js";

/**
 * @typedef {object} PrintabilityReport
 * @property {number} componentCount
 * @property {number} smallIslandCount
 * @property {number} smallIslandPixels
 * @property {number} smallHoleCount
 * @property {number} smallHolePixels
 * @property {number} narrowFeaturePixelCount
 * @property {number} narrowGapPixelCount
 * @property {number} cleanupPasses
 * @property {number} changedPixelCount
 * @property {number} [expandedPixelCount]
 * @property {number} [reassignedPixelCount]
 * @property {string[]} warnings
 */

/**
 * Population histogram by palette index (0..255 present).
 * @param {Uint8Array | Uint8ClampedArray} indices
 * @returns {Int32Array} length 256
 */
export function countPalettePopulations(indices) {
  const counts = new Int32Array(256);
  for (let i = 0; i < indices.length; i += 1) {
    counts[indices[i]] += 1;
  }
  return counts;
}

/**
 * Globally most populated palette index; ties → lower index.
 * @param {Int32Array} populations
 * @returns {number}
 */
export function dominantPaletteIndex(populations) {
  let bestIndex = 0;
  let bestCount = -1;
  for (let i = 0; i < populations.length; i += 1) {
    if (populations[i] > bestCount) {
      bestCount = populations[i];
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Choose replacement colour from 4-neighbour boundary contacts.
 * @param {Uint8Array | Uint8ClampedArray} indices
 * @param {Int32Array} labels
 * @param {number} componentId
 * @param {number} width
 * @param {number} height
 * @param {number} selfColor
 * @param {Int32Array} populations
 * @returns {number}
 */
export function chooseReplacementColor(
  indices,
  labels,
  componentId,
  width,
  height,
  selfColor,
  populations,
) {
  const offsets = neighbourOffsets(CONNECTIVITY_4);
  /** @type {Map<number, number>} */
  const contacts = new Map();

  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] !== componentId) continue;
    const x = i % width;
    const y = (i - x) / width;
    for (let o = 0; o < offsets.length; o += 1) {
      const nx = x + offsets[o][0];
      const ny = y + offsets[o][1];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (labels[ni] === componentId) continue;
      const other = indices[ni];
      if (other === selfColor) continue;
      contacts.set(other, (contacts.get(other) || 0) + 1);
    }
  }

  if (contacts.size === 0) {
    return dominantPaletteIndex(populations);
  }

  let bestColor = 255;
  let bestCount = -1;
  for (const [color, count] of contacts) {
    if (count > bestCount || (count === bestCount && color < bestColor)) {
      bestCount = count;
      bestColor = color;
    }
  }
  return bestColor;
}

/**
 * One cleanup pass: remove small islands, then fill small enclosed holes.
 * @param {Uint8Array} indices mutable working buffer
 * @param {number} width
 * @param {number} height
 * @param {import("./printability.js").PixelMetrics} metrics
 * @param {number} minimumIslandAreaMm2
 * @param {number} maximumHoleAreaToFillMm2
 * @returns {number} pixels changed this pass
 */
function cleanupPass(
  indices,
  width,
  height,
  metrics,
  minimumIslandAreaMm2,
  maximumHoleAreaToFillMm2,
) {
  let changed = 0;
  changed += replaceQualifyingComponents(indices, width, height, metrics, minimumIslandAreaMm2, {
    requireEnclosed: false,
    mode: "island",
  });
  changed += replaceQualifyingComponents(indices, width, height, metrics, maximumHoleAreaToFillMm2, {
    requireEnclosed: true,
    mode: "hole",
  });
  return changed;
}

/**
 * Replace components below an area threshold.
 * @param {Uint8Array} indices
 * @param {number} width
 * @param {number} height
 * @param {import("./printability.js").PixelMetrics} metrics
 * @param {number} areaThresholdMm2
 * @param {{ requireEnclosed: boolean, mode: "island" | "hole" }} rule
 */
function replaceQualifyingComponents(indices, width, height, metrics, areaThresholdMm2, rule) {
  const labelled = labelConnectedComponents(indices, width, height, {
    connectivity: CONNECTIVITY_4,
  });
  const populations = countPalettePopulations(indices);
  let changed = 0;

  // Process in discovery order for determinism; recompute populations after each replace
  // would be more accurate but order-dependent mid-pass. Snapshot labels first, then
  // apply all replacements for this sub-pass from the frozen labelling.
  /** @type {Array<{ id: number, color: number, replacement: number }>} */
  const plan = [];

  for (const comp of labelled.components) {
    const areaMm2 = comp.pixelCount * metrics.pixelAreaMm2;
    if (areaMm2 >= areaThresholdMm2) continue;
    if (rule.requireEnclosed && comp.touchesBoundary) continue;

    const replacement = chooseReplacementColor(
      indices,
      labelled.labels,
      comp.id,
      width,
      height,
      comp.paletteIndex,
      populations,
    );
    if (replacement === comp.paletteIndex) continue;
    plan.push({ id: comp.id, color: comp.paletteIndex, replacement });
  }

  for (const item of plan) {
    for (let i = 0; i < labelled.labels.length; i += 1) {
      if (labelled.labels[i] === item.id && indices[i] === item.color) {
        indices[i] = item.replacement;
        changed += 1;
      }
    }
  }

  return changed;
}

/**
 * Clean small islands and enclosed holes in an indexed mask, then optionally
 * thicken connected narrow branches.
 *
 * @param {Uint8Array | Uint8ClampedArray} indices
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {number} opts.minimumIslandAreaMm2
 * @param {number} opts.maximumHoleAreaToFillMm2
 * @param {number} [opts.minimumFeatureWidthMm]
 * @param {boolean} [opts.thickenNarrowFeatures]
 * @param {number} [opts.maxPasses]
 * @param {import("./printability.js").PixelMetrics} [opts.metrics]
 * @param {number} [opts.tileWidthMm]
 * @param {number} [opts.tileHeightMm]
 * @returns {{
 *   cleanedIndices: Uint8Array,
 *   passes: number,
 *   changedPixelCount: number,
 *   hitMaxPasses: boolean,
 *   expandedPixelCount: number,
 *   reassignedPixelCount: number,
 * }}
 */
export function cleanupMask(indices, opts) {
  const width = opts.width;
  const height = opts.height;
  const expected = width * height;
  if (!indices || indices.length !== expected) {
    throw new Error(`cleanupMask: index length mismatch (${indices ? indices.length : 0} vs ${expected}).`);
  }

  const metrics = opts.metrics ?? computePixelMetrics(width, height, {
    tileWidthMm: opts.tileWidthMm,
    tileHeightMm: opts.tileHeightMm,
  });

  const maxPasses = opts.maxPasses ?? MAX_CLEANUP_PASSES;
  const cleanedIndices = indices instanceof Uint8Array
    ? new Uint8Array(indices)
    : Uint8Array.from(indices);

  let passes = 0;
  let changedPixelCount = 0;
  let hitMaxPasses = false;

  while (passes < maxPasses) {
    passes += 1;
    const changed = cleanupPass(
      cleanedIndices,
      width,
      height,
      metrics,
      opts.minimumIslandAreaMm2,
      opts.maximumHoleAreaToFillMm2,
    );
    changedPixelCount += changed;
    if (changed === 0) {
      break;
    }
    if (passes >= maxPasses) {
      hitMaxPasses = true;
    }
  }

  if (changedPixelCount > 0 && passes >= maxPasses) {
    const probe = new Uint8Array(cleanedIndices);
    const more = cleanupPass(
      probe,
      width,
      height,
      metrics,
      opts.minimumIslandAreaMm2,
      opts.maximumHoleAreaToFillMm2,
    );
    hitMaxPasses = more > 0;
  }

  let expandedPixelCount = 0;
  let reassignedPixelCount = 0;
  const doThicken = opts.thickenNarrowFeatures !== false
    && Number.isFinite(opts.minimumFeatureWidthMm)
    && opts.minimumFeatureWidthMm > 0;

  if (doThicken) {
    const thickened = thickenNarrowFeatures(cleanedIndices, {
      width,
      height,
      metrics,
      minimumFeatureWidthMm: /** @type {number} */ (opts.minimumFeatureWidthMm),
      minimumIslandAreaMm2: opts.minimumIslandAreaMm2,
    });
    cleanedIndices.set(thickened.indices);
    expandedPixelCount = thickened.report.expandedPixelCount;
    reassignedPixelCount = thickened.report.reassignedPixelCount;
    changedPixelCount += reassignedPixelCount;
  }

  return {
    cleanedIndices,
    passes,
    changedPixelCount,
    hitMaxPasses,
    expandedPixelCount,
    reassignedPixelCount,
  };
}
