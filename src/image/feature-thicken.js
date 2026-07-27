/**
 * Deterministic narrow-feature thickening (Milestone 7.3.2).
 *
 * Purpose: retain recognizable strokes/edges at the printable minimum width
 * by locally expanding connected narrow branches. Does not invent image
 * content beyond short perpendicular expansions into small/foreign neighborhoods.
 *
 * Conflict rules (no randomness):
 * 1. Prefer shortest expansion distance
 * 2. Prefer highest boundary contact with the expanding color
 * 3. Lower palette index of the replaced color
 * 4. Lower linear pixel index
 * Never overwrite a large neighboring feature merely to preserve a tiny detail.
 */

import { labelConnectedComponents, CONNECTIVITY_4 } from "./connected-components.js";

/**
 * @typedef {object} ThickenReport
 * @property {number} expandedPixelCount
 * @property {number} reassignedPixelCount
 * @property {number} skippedLargeNeighborCount
 * @property {number} narrowPixelCountBefore
 * @property {number} narrowPixelCountAfter
 */

/**
 * @param {Uint8Array | Uint8ClampedArray} indices
 * @param {number} width
 * @param {number} height
 */
function computeRunLengthsLocal(indices, width, height) {
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
      for (let i = start; i < x; i += 1) hRun[y * width + i] = len;
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
      for (let i = start; i < y; i += 1) vRun[i * width + x] = len;
    }
  }

  return { hRun, vRun };
}

/**
 * Local printable width (mm) from axis-aligned run lengths.
 * @param {number} hRun
 * @param {number} vRun
 * @param {number} pxWidthMm
 * @param {number} pxHeightMm
 */
function localWidthMm(hRun, vRun, pxWidthMm, pxHeightMm) {
  const hMm = hRun * pxWidthMm;
  const vMm = vRun * pxHeightMm;
  return hMm < vMm ? hMm : vMm;
}

/**
 * Count 4-neighbor contacts of `color` around a pixel.
 * @param {Uint8Array} indices
 * @param {number} width
 * @param {number} height
 * @param {number} x
 * @param {number} y
 * @param {number} color
 */
function contactCount(indices, width, height, x, y, color) {
  let n = 0;
  if (x > 0 && indices[y * width + (x - 1)] === color) n += 1;
  if (x + 1 < width && indices[y * width + (x + 1)] === color) n += 1;
  if (y > 0 && indices[(y - 1) * width + x] === color) n += 1;
  if (y + 1 < height && indices[(y + 1) * width + x] === color) n += 1;
  return n;
}

/**
 * Thicken connected narrow branches toward the target minimum feature width.
 * Mutates a copy — never mutates the input buffer.
 *
 * @param {Uint8Array | Uint8ClampedArray} indices
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {import("./pixel-metrics.js").PixelMetrics} opts.metrics
 * @param {number} opts.minimumFeatureWidthMm
 * @param {number} opts.minimumIslandAreaMm2
 * @param {number} [opts.maxPasses]
 * @returns {{
 *   indices: Uint8Array,
 *   report: ThickenReport,
 * }}
 */
export function thickenNarrowFeatures(indices, opts) {
  const width = opts.width;
  const height = opts.height;
  const metrics = opts.metrics;
  const minFeature = opts.minimumFeatureWidthMm;
  const minIsland = opts.minimumIslandAreaMm2;
  const maxPasses = opts.maxPasses ?? 4;
  const largeNeighborAreaMm2 = Math.max(minIsland * 4, minFeature * minFeature * 4);

  const out = indices instanceof Uint8Array
    ? new Uint8Array(indices)
    : Uint8Array.from(indices);

  let expandedPixelCount = 0;
  let reassignedPixelCount = 0;
  let skippedLargeNeighborCount = 0;

  const { hRun: h0, vRun: v0 } = computeRunLengthsLocal(out, width, height);
  let narrowBefore = 0;
  for (let i = 0; i < out.length; i += 1) {
    if (localWidthMm(h0[i], v0[i], metrics.pxWidthMm, metrics.pxHeightMm) < minFeature) {
      narrowBefore += 1;
    }
  }

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const { hRun, vRun } = computeRunLengthsLocal(out, width, height);
    const labelled = labelConnectedComponents(out, width, height, {
      connectivity: CONNECTIVITY_4,
    });
    /** @type {Map<number, number>} component id → area mm² */
    const areaById = new Map();
    for (const c of labelled.components) {
      areaById.set(c.id, c.pixelCount * metrics.pixelAreaMm2);
    }

    /** @type {Array<{ i: number, color: number, scoreDist: number, scoreContact: number, foreign: number }>} */
    const candidates = [];

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        const color = out[i];
        const widthMm = localWidthMm(hRun[i], vRun[i], metrics.pxWidthMm, metrics.pxHeightMm);
        if (!(widthMm < minFeature)) continue;

        const hMm = hRun[i] * metrics.pxWidthMm;
        const vMm = vRun[i] * metrics.pxHeightMm;
        // Expand along the thinner axis.
        /** @type {Array<[number, number]>} */
        const dirs = hMm <= vMm
          ? [[0, -1], [0, 1]]
          : [[-1, 0], [1, 0]];

        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          const foreign = out[ni];
          if (foreign === color) continue;

          const foreignComp = labelled.labels[ni];
          const foreignArea = areaById.get(foreignComp) ?? 0;
          if (foreignArea >= largeNeighborAreaMm2) {
            skippedLargeNeighborCount += 1;
            continue;
          }

          const contact = contactCount(out, width, height, nx, ny, color);
          candidates.push({
            i: ni,
            color,
            scoreDist: 1,
            scoreContact: contact,
            foreign,
          });
        }
      }
    }

    if (!candidates.length) break;

    // Deterministic conflict resolution: one planned write per target pixel.
    candidates.sort((a, b) => {
      if (a.i !== b.i) return a.i - b.i;
      if (a.scoreDist !== b.scoreDist) return a.scoreDist - b.scoreDist;
      if (a.scoreContact !== b.scoreContact) return b.scoreContact - a.scoreContact;
      if (a.color !== b.color) return a.color - b.color;
      return a.foreign - b.foreign;
    });

    /** @type {Map<number, { color: number, scoreDist: number, scoreContact: number, foreign: number }>} */
    const winners = new Map();
    for (const c of candidates) {
      const prev = winners.get(c.i);
      if (!prev) {
        winners.set(c.i, c);
        continue;
      }
      if (c.scoreDist < prev.scoreDist
        || (c.scoreDist === prev.scoreDist && c.scoreContact > prev.scoreContact)
        || (c.scoreDist === prev.scoreDist && c.scoreContact === prev.scoreContact && c.color < prev.color)
        || (c.scoreDist === prev.scoreDist && c.scoreContact === prev.scoreContact && c.color === prev.color && c.foreign < prev.foreign)) {
        winners.set(c.i, c);
      }
    }

    let changed = 0;
    for (const [i, win] of winners) {
      if (out[i] === win.color) continue;
      out[i] = win.color;
      changed += 1;
      expandedPixelCount += 1;
      reassignedPixelCount += 1;
    }
    if (changed === 0) break;
  }

  const { hRun: h1, vRun: v1 } = computeRunLengthsLocal(out, width, height);
  let narrowAfter = 0;
  for (let i = 0; i < out.length; i += 1) {
    if (localWidthMm(h1[i], v1[i], metrics.pxWidthMm, metrics.pxHeightMm) < minFeature) {
      narrowAfter += 1;
    }
  }

  return {
    indices: out,
    report: {
      expandedPixelCount,
      reassignedPixelCount,
      skippedLargeNeighborCount,
      narrowPixelCountBefore: narrowBefore,
      narrowPixelCountAfter: narrowAfter,
    },
  };
}
