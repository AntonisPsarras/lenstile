/**
 * Deterministic RGB color quantization (k-means style clustering).
 *
 * Algorithm version is `QUANTIZE_ALGORITHM_VERSION` in config.js.
 *
 * Determinism rules:
 * - No Math.random, timestamps, or environment seeds.
 * - Pixels scanned in stable row-major RGBA order.
 * - Unique colors keyed by packed RGB (R<<16|G<<8|B).
 * - Centroid init: first = highest population, tie → lowest packed RGB;
 *   later = greatest squared RGB distance to nearest existing centroid;
 *   ties → higher population, then lower packed RGB.
 * - Assignment ties → lower centroid index.
 * - Centroid channels: Float64 population-weighted means, then roundChannel().
 * - Empty clusters removed (never fabricated).
 * - Final palette sort: desc population, asc Rec.709 luminance, asc packed RGB;
 *   indices remapped after sort.
 * - One-color mode: population-weighted RGB mean of all pixels (after compositing).
 */

import { QUANTIZE_ALGORITHM_VERSION, QUANTIZE_MAX_ITERATIONS } from "../config.js";
import {
  packRgb,
  unpackRgb,
  rgbLuminance,
  rgbDistanceSquared,
  roundChannel,
} from "./color-space.js";
import { QuantizeErrorCode, createQuantizeError, toError } from "./quantize-errors.js";

/**
 * @typedef {{ r: number, g: number, b: number, population: number }} PaletteColor
 * @typedef {{
 *   width: number,
 *   height: number,
 *   requestedColorCount: number,
 *   actualColorCount: number,
 *   generatedPalette: PaletteColor[],
 *   indices: Uint8Array,
 *   sourceRevision: number | null,
 *   algorithmVersion: number,
 *   diagnostics: { uniqueColorCount: number, iterations: number, durationMs: number }
 * }} QuantizeResult
 */

/**
 * Quantize an opaque RGBA buffer into an indexed palette.
 *
 * @param {Uint8ClampedArray | Uint8Array} rgba
 * @param {object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} options.colorCount
 * @param {number} [options.sourceRevision]
 * @param {number} [options.algorithmVersion]
 * @param {number} [options.maxIterations]
 * @param {() => number} [options.now] diagnostics clock only — must not affect output
 * @returns {QuantizeResult}
 */
export function quantizeImage(rgba, options) {
  const started = typeof options.now === "function" ? options.now() : 0;
  const width = options.width;
  const height = options.height;
  const colorCount = options.colorCount;
  const algorithmVersion = options.algorithmVersion ?? QUANTIZE_ALGORITHM_VERSION;
  const maxIterations = options.maxIterations ?? QUANTIZE_MAX_ITERATIONS;
  const sourceRevision = options.sourceRevision ?? null;

  validateInput(rgba, width, height, colorCount);

  const pixelCount = width * height;
  /** @type {Map<number, number>} */
  const freq = new Map();
  for (let i = 0; i < pixelCount; i += 1) {
    const o = i * 4;
    const packed = packRgb(rgba[o], rgba[o + 1], rgba[o + 2]);
    freq.set(packed, (freq.get(packed) || 0) + 1);
  }

  const unique = [...freq.entries()].map(([packed, population]) => {
    const { r, g, b } = unpackRgb(packed);
    return { packed, r, g, b, population };
  });
  // Stable unique ordering for init scans: ascending packed RGB
  unique.sort((a, b) => a.packed - b.packed);

  const uniqueColorCount = unique.length;
  const indices = new Uint8Array(pixelCount);

  if (colorCount === 1) {
    const mean = weightedMean(unique);
    const palette = [
      {
        r: mean.r,
        g: mean.g,
        b: mean.b,
        population: pixelCount,
      },
    ];
    // all indices already 0
    return finish(
      width,
      height,
      colorCount,
      palette,
      indices,
      sourceRevision,
      algorithmVersion,
      uniqueColorCount,
      0,
      started,
      options.now,
    );
  }

  if (uniqueColorCount <= colorCount) {
    const palette = sortPalette(
      unique.map((u) => ({ r: u.r, g: u.g, b: u.b, population: u.population })),
    );
    const indexByPacked = new Map();
    for (let i = 0; i < palette.length; i += 1) {
      indexByPacked.set(packRgb(palette[i].r, palette[i].g, palette[i].b), i);
    }
    for (let i = 0; i < pixelCount; i += 1) {
      const o = i * 4;
      indices[i] = /** @type {number} */ (
        indexByPacked.get(packRgb(rgba[o], rgba[o + 1], rgba[o + 2]))
      );
    }
    return finish(
      width,
      height,
      colorCount,
      palette,
      indices,
      sourceRevision,
      algorithmVersion,
      uniqueColorCount,
      0,
      started,
      options.now,
    );
  }

  let centroids = initializeCentroids(unique, colorCount);
  let assignments = new Int32Array(uniqueColorCount);
  let iterations = 0;

  for (let iter = 0; iter < maxIterations; iter += 1) {
    iterations = iter + 1;
    let changed = false;

    for (let i = 0; i < uniqueColorCount; i += 1) {
      const u = unique[i];
      const next = nearestCentroidIndex(u.r, u.g, u.b, centroids);
      if (assignments[i] !== next) {
        assignments[i] = next;
        changed = true;
      }
    }

    const recomputed = recomputeCentroids(unique, assignments, centroids.length);

    if (recomputed.centroids.length !== centroids.length) {
      changed = true;
      // Remap surviving clusters; re-assign uniques that pointed at removed empties.
      for (let i = 0; i < assignments.length; i += 1) {
        const mapped = recomputed.remap[assignments[i]];
        if (mapped >= 0) {
          assignments[i] = mapped;
        } else {
          assignments[i] = nearestCentroidIndex(
            unique[i].r,
            unique[i].g,
            unique[i].b,
            recomputed.centroids,
          );
        }
      }
    } else {
      for (let c = 0; c < centroids.length; c += 1) {
        if (
          centroids[c].r !== recomputed.centroids[c].r
          || centroids[c].g !== recomputed.centroids[c].g
          || centroids[c].b !== recomputed.centroids[c].b
        ) {
          changed = true;
          break;
        }
      }
    }

    centroids = recomputed.centroids;

    if (!changed) break;
  }

  // Build palette with populations from unique assignments
  const populations = new Float64Array(centroids.length);
  for (let i = 0; i < uniqueColorCount; i += 1) {
    populations[assignments[i]] += unique[i].population;
  }

  let palette = centroids.map((c, i) => ({
    r: c.r,
    g: c.g,
    b: c.b,
    population: populations[i],
  }));

  // Drop any remaining empties (should be rare after recompute)
  const keep = [];
  const compactRemap = new Int32Array(palette.length);
  for (let i = 0; i < palette.length; i += 1) {
    if (palette[i].population > 0) {
      compactRemap[i] = keep.length;
      keep.push(palette[i]);
    }
  }
  if (keep.length !== palette.length) {
    for (let i = 0; i < assignments.length; i += 1) {
      assignments[i] = compactRemap[assignments[i]];
    }
    palette = keep;
  }

  const sorted = sortPalette(palette);
  const orderRemap = remapAfterSort(palette, sorted);
  for (let i = 0; i < assignments.length; i += 1) {
    assignments[i] = orderRemap[assignments[i]];
  }

  const packedToUniqueIndex = new Map();
  for (let i = 0; i < uniqueColorCount; i += 1) {
    packedToUniqueIndex.set(unique[i].packed, i);
  }
  for (let i = 0; i < pixelCount; i += 1) {
    const o = i * 4;
    const packed = packRgb(rgba[o], rgba[o + 1], rgba[o + 2]);
    const ui = /** @type {number} */ (packedToUniqueIndex.get(packed));
    indices[i] = assignments[ui];
  }

  return finish(
    width,
    height,
    colorCount,
    sorted,
    indices,
    sourceRevision,
    algorithmVersion,
    uniqueColorCount,
    iterations,
    started,
    options.now,
  );
}

/**
 * @param {Uint8ClampedArray | Uint8Array} rgba
 * @param {number} width
 * @param {number} height
 * @param {number} colorCount
 */
function validateInput(rgba, width, height, colorCount) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw toError(
      createQuantizeError(
        QuantizeErrorCode.INVALID_DIMENSIONS,
        "Width and height must be positive integers.",
        { width, height },
      ),
    );
  }
  if (!Number.isInteger(colorCount) || colorCount < 1 || colorCount > 8) {
    throw toError(
      createQuantizeError(
        QuantizeErrorCode.INVALID_COLOR_COUNT,
        "Color count must be an integer from 1 to 8.",
        { colorCount },
      ),
    );
  }
  if (!rgba || rgba.length === 0) {
    throw toError(
      createQuantizeError(QuantizeErrorCode.EMPTY_RGBA, "RGBA buffer is empty."),
    );
  }
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw toError(
      createQuantizeError(
        QuantizeErrorCode.INVALID_RGBA_LENGTH,
        `RGBA length ${rgba.length} does not match width×height×4 (${expected}).`,
        { length: rgba.length, expected, width, height },
      ),
    );
  }
}

/**
 * @param {Array<{ r: number, g: number, b: number, population: number, packed: number }>} unique
 * @param {number} k
 */
function initializeCentroids(unique, k) {
  /** @type {Array<{ r: number, g: number, b: number }>} */
  const centroids = [];

  // First: highest population, tie → lowest packed RGB
  let best = unique[0];
  for (let i = 1; i < unique.length; i += 1) {
    const u = unique[i];
    if (
      u.population > best.population
      || (u.population === best.population && u.packed < best.packed)
    ) {
      best = u;
    }
  }
  centroids.push({ r: best.r, g: best.g, b: best.b });

  while (centroids.length < k) {
    let pick = null;
    let bestDist = -1;
    for (const u of unique) {
      let minD = Infinity;
      for (const c of centroids) {
        const d = rgbDistanceSquared(u.r, u.g, u.b, c.r, c.g, c.b);
        if (d < minD) minD = d;
      }
      // Primary: greatest squared distance to nearest centroid.
      // Ties: higher population, then lower packed RGB.
      if (
        !pick
        || minD > bestDist
        || (minD === bestDist && u.population > pick.population)
        || (minD === bestDist && u.population === pick.population && u.packed < pick.packed)
      ) {
        bestDist = minD;
        pick = u;
      }
    }
    centroids.push({ r: pick.r, g: pick.g, b: pick.b });
  }

  return centroids;
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {Array<{ r: number, g: number, b: number }>} centroids
 */
function nearestCentroidIndex(r, g, b, centroids) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < centroids.length; i += 1) {
    const c = centroids[i];
    const d = rgbDistanceSquared(r, g, b, c.r, c.g, c.b);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
    // tie → keep lower index (do not replace on equal)
  }
  return best;
}

/**
 * @param {Array<{ r: number, g: number, b: number, population: number }>} unique
 * @param {Int32Array} assignments
 * @param {number} centroidCount
 */
function recomputeCentroids(unique, assignments, centroidCount) {
  const sumR = new Float64Array(centroidCount);
  const sumG = new Float64Array(centroidCount);
  const sumB = new Float64Array(centroidCount);
  const weight = new Float64Array(centroidCount);

  for (let i = 0; i < unique.length; i += 1) {
    const a = assignments[i];
    const u = unique[i];
    const w = u.population;
    sumR[a] += u.r * w;
    sumG[a] += u.g * w;
    sumB[a] += u.b * w;
    weight[a] += w;
  }

  /** @type {Array<{ r: number, g: number, b: number }>} */
  const kept = [];
  const remap = new Int32Array(centroidCount);

  for (let c = 0; c < centroidCount; c += 1) {
    if (weight[c] <= 0) {
      remap[c] = -1;
      continue;
    }
    remap[c] = kept.length;
    kept.push({
      r: roundChannel(sumR[c] / weight[c]),
      g: roundChannel(sumG[c] / weight[c]),
      b: roundChannel(sumB[c] / weight[c]),
    });
  }

  return { centroids: kept, remap };
}

/**
 * @param {Array<{ r: number, g: number, b: number, population: number }>} palette
 */
function sortPalette(palette) {
  return [...palette].sort((a, b) => {
    if (b.population !== a.population) return b.population - a.population;
    const la = rgbLuminance(a.r, a.g, a.b);
    const lb = rgbLuminance(b.r, b.g, b.b);
    if (la !== lb) return la - lb;
    return packRgb(a.r, a.g, a.b) - packRgb(b.r, b.g, b.b);
  });
}

/**
 * @param {Array<{ r: number, g: number, b: number, population: number }>} before
 * @param {Array<{ r: number, g: number, b: number, population: number }>} after
 */
function remapAfterSort(before, after) {
  const remap = new Int32Array(before.length);
  for (let oldIndex = 0; oldIndex < before.length; oldIndex += 1) {
    const color = before[oldIndex];
    const packed = packRgb(color.r, color.g, color.b);
    // Match by identity of palette entry (population + rgb) for duplicate RGB safety
    let found = -1;
    for (let n = 0; n < after.length; n += 1) {
      if (
        after[n].r === color.r
        && after[n].g === color.g
        && after[n].b === color.b
        && after[n].population === color.population
        && !isRemapTargetUsed(remap, n, oldIndex)
      ) {
        found = n;
        break;
      }
    }
    if (found < 0) {
      // Fallback: first matching RGB
      for (let n = 0; n < after.length; n += 1) {
        if (packRgb(after[n].r, after[n].g, after[n].b) === packed) {
          found = n;
          break;
        }
      }
    }
    remap[oldIndex] = found < 0 ? 0 : found;
  }
  return remap;
}

/**
 * @param {Int32Array} remap
 * @param {number} target
 * @param {number} upTo
 */
function isRemapTargetUsed(remap, target, upTo) {
  for (let i = 0; i < upTo; i += 1) {
    if (remap[i] === target) return true;
  }
  return false;
}

/**
 * @param {Array<{ r: number, g: number, b: number, population: number }>} unique
 */
function weightedMean(unique) {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let w = 0;
  for (const u of unique) {
    sumR += u.r * u.population;
    sumG += u.g * u.population;
    sumB += u.b * u.population;
    w += u.population;
  }
  if (w <= 0) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: roundChannel(sumR / w),
    g: roundChannel(sumG / w),
    b: roundChannel(sumB / w),
  };
}

/**
 * @param {number} width
 * @param {number} height
 * @param {number} requestedColorCount
 * @param {PaletteColor[]} generatedPalette
 * @param {Uint8Array} indices
 * @param {number | null} sourceRevision
 * @param {number} algorithmVersion
 * @param {number} uniqueColorCount
 * @param {number} iterations
 * @param {number} started
 * @param {(() => number) | undefined} now
 * @returns {QuantizeResult}
 */
function finish(
  width,
  height,
  requestedColorCount,
  generatedPalette,
  indices,
  sourceRevision,
  algorithmVersion,
  uniqueColorCount,
  iterations,
  started,
  now,
) {
  const ended = typeof now === "function" ? now() : started;
  return {
    width,
    height,
    requestedColorCount,
    actualColorCount: generatedPalette.length,
    generatedPalette: generatedPalette.map((c) => ({
      r: c.r,
      g: c.g,
      b: c.b,
      population: c.population,
    })),
    indices,
    sourceRevision,
    algorithmVersion,
    diagnostics: {
      uniqueColorCount,
      iterations,
      durationMs: ended - started,
    },
  };
}
