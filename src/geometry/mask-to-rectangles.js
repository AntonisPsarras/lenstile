/**
 * Deterministic maximal rectangle merging from an indexed mask.
 *
 * Algorithm:
 * 1. Scan each row in stable order (y = 0 … height-1).
 * 2. Find horizontal runs of equal palette index.
 * 3. Merge vertically adjacent runs only when X interval and palette index match.
 * 4. Produce non-overlapping rectangles preserving complete raster coverage.
 *
 * Output order: discovery order (top-to-bottom, left-to-right starts).
 */

/**
 * @typedef {{
 *   paletteIndex: number,
 *   x0Pixel: number,
 *   y0Pixel: number,
 *   widthPixels: number,
 *   heightPixels: number
 * }} MaskRectangle
 */

/**
 * @param {Uint8Array | ArrayLike<number>} indices
 * @param {number} width
 * @param {number} height
 * @returns {MaskRectangle[]}
 */
export function maskToRectangles(indices, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("maskToRectangles requires positive integer dimensions");
  }
  if (indices.length !== width * height) {
    throw new Error("maskToRectangles: indices length must equal width × height");
  }

  /** @type {MaskRectangle[]} */
  const rectangles = [];

  /**
   * Active runs from previous row, eligible for vertical merge.
   * @type {Array<{ paletteIndex: number, x0: number, x1: number, y0: number, height: number, rectIndex: number }>}
   */
  let active = [];

  for (let y = 0; y < height; y += 1) {
    /** @type {Array<{ paletteIndex: number, x0: number, x1: number }>} */
    const runs = [];
    let x = 0;
    const rowOffset = y * width;
    while (x < width) {
      const idx = indices[rowOffset + x];
      let x1 = x + 1;
      while (x1 < width && indices[rowOffset + x1] === idx) {
        x1 += 1;
      }
      runs.push({ paletteIndex: idx, x0: x, x1 });
      x = x1;
    }

    /** @type {typeof active} */
    const nextActive = [];
    /** @type {Set<number>} */
    const consumedActive = new Set();

    for (const run of runs) {
      let merged = false;
      for (let ai = 0; ai < active.length; ai += 1) {
        if (consumedActive.has(ai)) continue;
        const prev = active[ai];
        if (
          prev.paletteIndex === run.paletteIndex
          && prev.x0 === run.x0
          && prev.x1 === run.x1
        ) {
          const rect = rectangles[prev.rectIndex];
          rect.heightPixels += 1;
          nextActive.push({
            paletteIndex: prev.paletteIndex,
            x0: prev.x0,
            x1: prev.x1,
            y0: prev.y0,
            height: prev.height + 1,
            rectIndex: prev.rectIndex,
          });
          consumedActive.add(ai);
          merged = true;
          break;
        }
      }
      if (!merged) {
        const rectIndex = rectangles.length;
        rectangles.push({
          paletteIndex: run.paletteIndex,
          x0Pixel: run.x0,
          y0Pixel: y,
          widthPixels: run.x1 - run.x0,
          heightPixels: 1,
        });
        nextActive.push({
          paletteIndex: run.paletteIndex,
          x0: run.x0,
          x1: run.x1,
          y0: y,
          height: 1,
          rectIndex,
        });
      }
    }

    active = nextActive;
  }

  return rectangles;
}

/**
 * List palette indices that appear at least once, in ascending index order.
 * @param {Uint8Array | ArrayLike<number>} indices
 * @returns {number[]}
 */
export function usedPaletteIndices(indices) {
  /** @type {Set<number>} */
  const set = new Set();
  for (let i = 0; i < indices.length; i += 1) {
    set.add(indices[i]);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Population counts per palette index (sparse object keyed by index).
 * @param {Uint8Array | ArrayLike<number>} indices
 * @returns {Map<number, number>}
 */
export function palettePopulations(indices) {
  /** @type {Map<number, number>} */
  const map = new Map();
  for (let i = 0; i < indices.length; i += 1) {
    const idx = indices[i];
    map.set(idx, (map.get(idx) || 0) + 1);
  }
  return map;
}

/**
 * Verify rectangles cover every cell exactly once.
 * @param {MaskRectangle[]} rectangles
 * @param {Uint8Array | ArrayLike<number>} indices
 * @param {number} width
 * @param {number} height
 */
export function assertRectangleCoverage(rectangles, indices, width, height) {
  const cover = new Int32Array(width * height);
  cover.fill(-1);
  for (let r = 0; r < rectangles.length; r += 1) {
    const rect = rectangles[r];
    for (let dy = 0; dy < rect.heightPixels; dy += 1) {
      for (let dx = 0; dx < rect.widthPixels; dx += 1) {
        const x = rect.x0Pixel + dx;
        const y = rect.y0Pixel + dy;
        const i = y * width + x;
        if (cover[i] !== -1) {
          throw new Error(`overlapping rectangle coverage at ${x},${y}`);
        }
        if (indices[i] !== rect.paletteIndex) {
          throw new Error(`rectangle palette mismatch at ${x},${y}`);
        }
        cover[i] = r;
      }
    }
  }
  for (let i = 0; i < cover.length; i += 1) {
    if (cover[i] === -1) {
      throw new Error(`uncovered cell at index ${i}`);
    }
  }
}
