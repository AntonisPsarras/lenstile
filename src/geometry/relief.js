/**
 * Optional surface relief — height levels, ordering, and validation.
 *
 * User-facing terms: Surface style (Flat / Relief), Relief strength, Height order.
 * Do not expose “Z mapping”, “topology”, or similar engineering jargon in UI copy.
 *
 * Physical limits (Tile V1):
 * - Artwork begins at Z = 3.0 mm (above the full-width structural bridge)
 * - Relief tops lie in [minTopZMm, maxTopZMm] = [3.4, 4.0]
 * - Minimum material above magnet recess ceiling: 0.9 mm (Z 2.5 → ≥ 3.4)
 * - At most four distinct height levels
 *
 * Rounding for evenly spaced levels:
 *   height[i] = roundMm(minTop + i * (maxTop - minTop) / (n - 1))
 * where roundMm rounds to the nearest 0.05 mm (half away from zero via Math.round),
 * which yields the documented Bold ladders 3.4 / 3.6 / 3.7 / 3.8 / 4.0 exactly
 * for n ∈ {2,3,4}.
 */

import { TILE_V1 } from "./tile-spec.js";
import { rgbLuminance } from "../image/color-space.js";
import { usedPaletteIndices } from "./mask-to-rectangles.js";

/**
 * @typedef {"subtle" | "standard" | "bold"} ReliefStrengthId
 * @typedef {"darkest-highest" | "lightest-highest" | "custom"} HeightOrderId
 * @typedef {"flat" | "relief"} SurfaceStyleId
 */

export const RELIEF = Object.freeze({
  minTopZMm: 3.4,
  maxTopZMm: 4.0,
  strengths: Object.freeze({
    subtle: Object.freeze({
      id: /** @type {ReliefStrengthId} */ ("subtle"),
      label: "Subtle",
      rangeMm: 0.2,
    }),
    standard: Object.freeze({
      id: /** @type {ReliefStrengthId} */ ("standard"),
      label: "Standard",
      rangeMm: 0.4,
    }),
    bold: Object.freeze({
      id: /** @type {ReliefStrengthId} */ ("bold"),
      label: "Bold",
      rangeMm: 0.6,
    }),
  }),
  maximumDistinctLevels: 4,
});

export const DEFAULT_SURFACE = Object.freeze({
  style: /** @type {SurfaceStyleId} */ ("flat"),
  reliefStrengthId: /** @type {ReliefStrengthId} */ ("standard"),
  heightOrder: /** @type {HeightOrderId} */ ("darkest-highest"),
  colorHeightLevels: Object.freeze([]),
});

/** Minimum roof above magnet recess ceiling (mm). */
export const RELIEF_MIN_ROOF_MM = RELIEF.minTopZMm - TILE_V1.baseThicknessMm;

/**
 * Round to 0.05 mm so documented ladders stay exact.
 * @param {number} value
 */
export function roundReliefMm(value) {
  return Math.round(value * 20) / 20;
}

/**
 * Validate RELIEF constants against Tile V1.
 * @param {typeof RELIEF} [relief]
 * @param {typeof TILE_V1} [tile]
 */
export function validateReliefConfig(relief = RELIEF, tile = TILE_V1) {
  /** @type {string[]} */
  const reasons = [];
  if (Math.abs(relief.maxTopZMm - tile.totalThicknessMm) > 1e-9) {
    reasons.push("maxTopZMm must equal TILE_V1 total thickness");
  }
  if (relief.minTopZMm < 3.4 - 1e-9) {
    reasons.push("minTopZMm must be at or above 3.4 mm");
  }
  if (!(relief.minTopZMm > tile.artworkStartZMm + 1e-9)) {
    reasons.push("minTopZMm must be above artworkStartZMm");
  }
  const roof = relief.minTopZMm - tile.baseThicknessMm;
  if (roof < 0.9 - 1e-9) {
    reasons.push("minimum roof thickness above magnet recess must be at least 0.9 mm");
  }
  if (relief.maximumDistinctLevels !== 4) {
    reasons.push("maximumDistinctLevels must be 4");
  }
  for (const key of /** @type {ReliefStrengthId[]} */ (["subtle", "standard", "bold"])) {
    const s = relief.strengths[key];
    const low = roundReliefMm(relief.maxTopZMm - s.rangeMm);
    if (low < relief.minTopZMm - 1e-9) {
      reasons.push(`${key} lowest top falls below minTopZMm`);
    }
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

/**
 * @param {unknown} id
 * @returns {ReliefStrengthId}
 */
export function normalizeReliefStrengthId(id) {
  if (id === "subtle" || id === "standard" || id === "bold") return id;
  return "standard";
}

/**
 * @param {unknown} id
 * @returns {HeightOrderId}
 */
export function normalizeHeightOrderId(id) {
  if (id === "darkest-highest" || id === "lightest-highest" || id === "custom") return id;
  return "darkest-highest";
}

/**
 * @param {unknown} id
 * @returns {SurfaceStyleId}
 */
export function normalizeSurfaceStyleId(id) {
  return id === "relief" ? "relief" : "flat";
}

/**
 * @param {Partial<typeof DEFAULT_SURFACE> | null | undefined} raw
 */
export function createSurfaceStateSlice(raw) {
  const style = normalizeSurfaceStyleId(raw && raw.style);
  const reliefStrengthId = normalizeReliefStrengthId(raw && raw.reliefStrengthId);
  const heightOrder = normalizeHeightOrderId(raw && raw.heightOrder);
  /** @type {Array<{ paletteIndex: number, levelIndex: number }>} */
  const colorHeightLevels = [];
  if (raw && Array.isArray(raw.colorHeightLevels)) {
    for (const entry of raw.colorHeightLevels) {
      if (!entry || typeof entry !== "object") continue;
      const paletteIndex = Number(/** @type {{ paletteIndex?: unknown }} */ (entry).paletteIndex);
      const levelIndex = Number(/** @type {{ levelIndex?: unknown }} */ (entry).levelIndex);
      if (!Number.isInteger(paletteIndex) || paletteIndex < 0) continue;
      if (!Number.isInteger(levelIndex) || levelIndex < 0) continue;
      colorHeightLevels.push({ paletteIndex, levelIndex });
    }
  }
  return {
    style,
    reliefStrengthId,
    heightOrder,
    colorHeightLevels,
  };
}

/**
 * Migrate missing/legacy surface fields to flat defaults.
 * @param {unknown} projectLike
 */
export function migrateSurfaceSettings(projectLike) {
  const raw = projectLike && typeof projectLike === "object"
    ? /** @type {{ surface?: unknown }} */ (projectLike).surface
    : null;
  return createSurfaceStateSlice(/** @type {object} */ (raw || null));
}

/**
 * Evenly spaced top heights for `levelCount` distinct levels.
 * Index 0 = lowest physical height; last = maxTopZMm (4.0).
 *
 * @param {ReliefStrengthId | string} strengthId
 * @param {number} levelCount
 * @param {typeof RELIEF} [relief]
 * @returns {number[]}
 */
export function resolveReliefLevels(strengthId, levelCount, relief = RELIEF) {
  const n = Math.max(0, Math.min(relief.maximumDistinctLevels, Math.floor(levelCount)));
  if (n < 1) return [];
  const strength = relief.strengths[normalizeReliefStrengthId(strengthId)];
  const maxTop = relief.maxTopZMm;
  const minTop = roundReliefMm(maxTop - strength.rangeMm);
  if (n === 1) return [maxTop];
  /** @type {number[]} */
  const heights = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    heights.push(roundReliefMm(minTop + t * (maxTop - minTop)));
  }
  heights[n - 1] = maxTop;
  heights[0] = minTop;
  return heights;
}

/**
 * Sort used palette indices by Rec. 709 luminance.
 * Direction "asc" → darkest first; "desc" → lightest first.
 * Tie-break: ascending palette index.
 *
 * @param {number[]} usedIndices
 * @param {Array<{ r: number, g: number, b: number }>} effectivePalette
 * @param {"asc" | "desc"} direction
 * @returns {number[]}
 */
export function orderPaletteByLuminance(usedIndices, effectivePalette, direction) {
  const scored = usedIndices.map((paletteIndex) => {
    const c = effectivePalette[paletteIndex] || { r: 0, g: 0, b: 0 };
    return {
      paletteIndex,
      luma: rgbLuminance(c.r, c.g, c.b),
    };
  });
  scored.sort((a, b) => {
    if (a.luma !== b.luma) {
      return direction === "asc" ? a.luma - b.luma : b.luma - a.luma;
    }
    return a.paletteIndex - b.paletteIndex;
  });
  return scored.map((s) => s.paletteIndex);
}

/**
 * Map ordered colors onto `levelCount` levels.
 * ordered[0] is the first in “highest” ordering (receives the highest physical level).
 *
 * Deterministic formula:
 *   levelIndexFromLow = floor(i * levelCount / colorCount)
 * then physicalLevelFromLow = levelCount - 1 - levelIndexFromLow for the high-first list…
 * Actually: ordered[0] → highest → levelIndex (from low) = levelCount - 1.
 *
 * Distribution for 8 colors / 4 levels (ordered high-first indices 0..7):
 *   0–1 → level 3 (high), 2–3 → level 2, 4–5 → level 1, 6–7 → level 0
 * Equivalent: lowIndex = floor(i * levelCount / n), physicalFromLow = levelCount - 1 - lowIndex
 * wait: i=0 → floor(0)=0 → physical=3; i=1 → 0 → 3; i=2 → 1 → 2; … i=6 → 3 → 0. ✓
 *
 * @param {number[]} orderedHighestFirst
 * @param {number} levelCount
 * @returns {Map<number, number>} paletteIndex → levelIndexFromLow (0 = lowest)
 */
export function assignColorsToLevels(orderedHighestFirst, levelCount) {
  /** @type {Map<number, number>} */
  const map = new Map();
  const n = orderedHighestFirst.length;
  const levels = Math.max(0, Math.min(RELIEF.maximumDistinctLevels, Math.floor(levelCount)));
  if (n === 0 || levels < 1) return map;
  for (let i = 0; i < n; i += 1) {
    const bandFromHigh = Math.floor((i * levels) / n);
    const levelFromLow = levels - 1 - bandFromHigh;
    map.set(orderedHighestFirst[i], levelFromLow);
  }
  return map;
}

/**
 * Plain-language labels for available level counts.
 * @param {number} levelCount
 * @returns {string[]}
 */
export function levelLabelsForCount(levelCount) {
  if (levelCount <= 1) return ["High"];
  if (levelCount === 2) return ["Low", "High"];
  if (levelCount === 3) return ["Low", "Medium", "High"];
  return ["Low", "Medium-low", "Medium-high", "High"];
}

/**
 * @param {object} opts
 * @param {SurfaceStyleId | string} opts.style
 * @param {ReliefStrengthId | string} [opts.reliefStrengthId]
 * @param {HeightOrderId | string} [opts.heightOrder]
 * @param {Array<{ paletteIndex: number, levelIndex: number }>} [opts.colorHeightLevels]
 * @param {Uint8Array | ArrayLike<number>} opts.indices
 * @param {Array<{ r: number, g: number, b: number }>} opts.effectivePalette
 * @param {typeof RELIEF} [opts.relief]
 * @returns {{
 *   style: SurfaceStyleId,
 *   usedIndices: number[],
 *   levelCount: number,
 *   heightsFromLow: number[],
 *   topHeightByPaletteIndex: Map<number, number>,
 *   levelIndexByPaletteIndex: Map<number, number>,
 *   orderedHighestFirst: number[],
 *   colorsShareLevels: boolean,
 *   reasons: string[],
 *   ok: boolean
 * }}
 */
export function resolveColorTopHeights(opts) {
  const relief = opts.relief || RELIEF;
  const style = normalizeSurfaceStyleId(opts.style);
  const usedIndices = usedPaletteIndices(opts.indices);
  /** @type {string[]} */
  const reasons = [];

  /** @type {Map<number, number>} */
  const topHeightByPaletteIndex = new Map();
  /** @type {Map<number, number>} */
  const levelIndexByPaletteIndex = new Map();

  if (style === "flat") {
    for (const idx of usedIndices) {
      topHeightByPaletteIndex.set(idx, relief.maxTopZMm);
      levelIndexByPaletteIndex.set(idx, 0);
    }
    return {
      style,
      usedIndices,
      levelCount: usedIndices.length ? 1 : 0,
      heightsFromLow: usedIndices.length ? [relief.maxTopZMm] : [],
      topHeightByPaletteIndex,
      levelIndexByPaletteIndex,
      orderedHighestFirst: usedIndices.slice(),
      colorsShareLevels: false,
      reasons,
      ok: true,
    };
  }

  const levelCount = Math.min(relief.maximumDistinctLevels, Math.max(usedIndices.length, 0));
  const heightsFromLow = resolveReliefLevels(
    normalizeReliefStrengthId(opts.reliefStrengthId),
    levelCount,
    relief,
  );
  const order = normalizeHeightOrderId(opts.heightOrder);
  /** @type {number[]} */
  let orderedHighestFirst;

  if (order === "custom") {
    const custom = Array.isArray(opts.colorHeightLevels) ? opts.colorHeightLevels : [];
    const usedSet = new Set(usedIndices);
    /** @type {Map<number, number>} */
    const customLevels = new Map();
    for (const entry of custom) {
      if (!usedSet.has(entry.paletteIndex)) continue;
      if (!Number.isInteger(entry.levelIndex) || entry.levelIndex < 0 || entry.levelIndex >= levelCount) {
        reasons.push(`Invalid custom level for palette index ${entry.paletteIndex}`);
        continue;
      }
      customLevels.set(entry.paletteIndex, entry.levelIndex);
    }
    for (const idx of usedIndices) {
      if (!customLevels.has(idx)) {
        reasons.push(`Missing custom level for palette index ${idx}`);
      }
    }
    orderedHighestFirst = usedIndices.slice().sort((a, b) => {
      const la = customLevels.get(a) ?? 0;
      const lb = customLevels.get(b) ?? 0;
      if (la !== lb) return lb - la;
      return a - b;
    });
    for (const idx of usedIndices) {
      const levelFromLow = customLevels.has(idx)
        ? /** @type {number} */ (customLevels.get(idx))
        : 0;
      levelIndexByPaletteIndex.set(idx, levelFromLow);
      topHeightByPaletteIndex.set(idx, heightsFromLow[levelFromLow] ?? relief.maxTopZMm);
    }
  } else {
    const direction = order === "darkest-highest" ? "asc" : "desc";
    orderedHighestFirst = orderPaletteByLuminance(usedIndices, opts.effectivePalette, direction);
    const assigned = assignColorsToLevels(orderedHighestFirst, levelCount);
    for (const idx of usedIndices) {
      const levelFromLow = assigned.get(idx) ?? 0;
      levelIndexByPaletteIndex.set(idx, levelFromLow);
      topHeightByPaletteIndex.set(idx, heightsFromLow[levelFromLow] ?? relief.maxTopZMm);
    }
  }

  for (const [, z] of topHeightByPaletteIndex) {
    if (!Number.isFinite(z)) reasons.push("non-finite top height");
    if (z < relief.minTopZMm - 1e-9 || z > relief.maxTopZMm + 1e-9) {
      reasons.push("top height outside permitted range");
    }
  }

  return {
    style,
    usedIndices,
    levelCount,
    heightsFromLow,
    topHeightByPaletteIndex,
    levelIndexByPaletteIndex,
    orderedHighestFirst,
    colorsShareLevels: usedIndices.length > levelCount && levelCount > 0,
    reasons,
    ok: reasons.length === 0,
  };
}

/**
 * Build a per-cell top-height map (mm) from palette assignments.
 * @param {Uint8Array | ArrayLike<number>} indices
 * @param {number} width
 * @param {number} height
 * @param {Map<number, number>} topHeightByPaletteIndex
 * @returns {Float64Array}
 */
export function buildCellTopHeights(indices, width, height, topHeightByPaletteIndex) {
  const out = new Float64Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    const z = topHeightByPaletteIndex.get(indices[i]);
    out[i] = z == null ? RELIEF.maxTopZMm : z;
  }
  return out;
}
