/**
 * Deterministic connected-component labelling for indexed masks.
 *
 * Connectivity: 4-connected (N/E/S/W) by default.
 * Why 4-connectivity: diagonal-only touches do not share an edge and often
 * print as disconnected or weakly joined features under FDM extrusion.
 * Counting them as connected would under-report islands and over-merge gaps.
 * An 8-connectivity mode exists for callers that need it; product labeling uses 4-connectivity.
 *
 * Scan order: stable row-major (y outer, x inner).
 * Component IDs: dense integers starting at 1 in discovery order.
 */

/** Active product connectivity. */
export const CONNECTIVITY_4 = 4;

/** Available constant; product UI uses CONNECTIVITY_4. */
export const CONNECTIVITY_8 = 8;

/** @typedef {{ id: number, paletteIndex: number, pixelCount: number, minX: number, minY: number, maxX: number, maxY: number, touchesBoundary: boolean }} ComponentInfo */

/**
 * Neighbour offsets for the requested connectivity.
 * @param {number} connectivity
 * @returns {ReadonlyArray<[number, number]>}
 */
export function neighbourOffsets(connectivity = CONNECTIVITY_4) {
  if (connectivity === CONNECTIVITY_8) {
    return Object.freeze([
      [0, -1],
      [1, -1],
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
    ]);
  }
  return Object.freeze([
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]);
}

/**
 * Label all connected components for every palette index present, or a single target.
 *
 * @param {Uint8Array | Uint8ClampedArray} indices
 * @param {number} width
 * @param {number} height
 * @param {object} [opts]
 * @param {number | null} [opts.targetIndex] If set, only label this palette index.
 * @param {number} [opts.connectivity] CONNECTIVITY_4 (default) or CONNECTIVITY_8.
 * @returns {{
 *   labels: Int32Array,
 *   components: ComponentInfo[],
 *   componentCount: number,
 * }}
 */
export function labelConnectedComponents(indices, width, height, opts = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("labelConnectedComponents: width and height must be positive integers.");
  }
  const expected = width * height;
  if (!indices || indices.length !== expected) {
    throw new Error(`labelConnectedComponents: index length ${indices ? indices.length : 0} !== ${expected}.`);
  }

  const connectivity = opts.connectivity ?? CONNECTIVITY_4;
  if (connectivity !== CONNECTIVITY_4 && connectivity !== CONNECTIVITY_8) {
    throw new Error("labelConnectedComponents: unsupported connectivity.");
  }
  const offsets = neighbourOffsets(connectivity);
  const targetIndex = opts.targetIndex == null ? null : opts.targetIndex;

  const labels = new Int32Array(expected);
  /** @type {ComponentInfo[]} */
  const components = [];
  let nextId = 1;

  /** @type {number[]} */
  const queue = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (labels[i] !== 0) continue;
      const paletteIndex = indices[i];
      if (targetIndex != null && paletteIndex !== targetIndex) continue;

      const id = nextId;
      nextId += 1;
      let pixelCount = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let touchesBoundary = x === 0 || y === 0 || x === width - 1 || y === height - 1;

      labels[i] = id;
      queue.length = 0;
      queue.push(i);
      let qh = 0;

      while (qh < queue.length) {
        const ci = queue[qh++];
        const cx = ci % width;
        const cy = (ci - cx) / width;
        pixelCount += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        if (cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1) {
          touchesBoundary = true;
        }

        for (let o = 0; o < offsets.length; o += 1) {
          const nx = cx + offsets[o][0];
          const ny = cy + offsets[o][1];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (labels[ni] !== 0) continue;
          if (indices[ni] !== paletteIndex) continue;
          labels[ni] = id;
          queue.push(ni);
        }
      }

      components.push({
        id,
        paletteIndex,
        pixelCount,
        minX,
        minY,
        maxX,
        maxY,
        touchesBoundary,
      });
    }
  }

  return {
    labels,
    components,
    componentCount: components.length,
  };
}
