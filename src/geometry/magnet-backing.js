/**
 * Tile V1 full-width structural bridge (Milestone 9.1).
 *
 * From Z = 2.5 mm through Z = 3.0 mm the entire 148 × 53 mm tile is one
 * continuous base-colored slab. Magnet cavities end at Z = 2.5 mm; all
 * image-color artwork / Relief begin globally at Z = 3.0 mm.
 *
 * This replaces the local circular magnet-backing disks (Milestone 7.3.2)
 * that only covered cavity footprints at Z 2.5…2.7 — those still allowed
 * artwork boundaries to fragment the first layers above the cavities.
 *
 * Accepted cleaned image indices are never mutated. Radial magnet helpers
 * remain for cavity classification tests; they do not drive artwork bottoms.
 */

import { TILE_V1 } from "./tile-spec.js";
import { createRasterMapping, pixelLeftX, pixelTopY } from "./raster-coords.js";

/**
 * Frozen full-width structural bridge policy.
 * Covers the complete tile rectangle; not a local circular magnet disk.
 */
export const STRUCTURAL_BRIDGE = Object.freeze({
  zMinMm: TILE_V1.structuralBridgeStartZMm,
  zMaxMm: TILE_V1.structuralBridgeEndZMm,
  thicknessMm: TILE_V1.structuralBridgeThicknessMm,
  fullWidth: true,
  useBaseColor: true,
  /**
   * Magnet cavity radius (for cavity helpers only — not the bridge footprint).
   * @deprecated Bridge coverage is full-tile; do not use radius for artwork bottoms.
   */
  radiusMm: TILE_V1.magnetDiameterMm / 2,
});

/** @deprecated Use STRUCTURAL_BRIDGE (Milestone 9.1). */
export const MAGNET_BACKING = STRUCTURAL_BRIDGE;

/**
 * Validate STRUCTURAL_BRIDGE against Tile V1 vertical structure.
 * @param {typeof STRUCTURAL_BRIDGE} [bridge]
 * @param {typeof TILE_V1} [tile]
 * @returns {{ ok: true } | { ok: false, reasons: string[] }}
 */
export function validateStructuralBridge(bridge = STRUCTURAL_BRIDGE, tile = TILE_V1) {
  /** @type {string[]} */
  const reasons = [];
  if (bridge.fullWidth !== true) {
    reasons.push("structural bridge must cover the full tile width/height");
  }
  if (Math.abs(bridge.zMinMm - tile.baseThicknessMm) > 1e-9) {
    reasons.push("bridge zMinMm must equal baseThicknessMm (2.5)");
  }
  if (Math.abs(bridge.thicknessMm - tile.structuralBridgeThicknessMm) > 1e-9) {
    reasons.push("bridge thicknessMm must equal structuralBridgeThicknessMm (0.5)");
  }
  if (Math.abs(bridge.zMaxMm - (bridge.zMinMm + bridge.thicknessMm)) > 1e-9) {
    reasons.push("bridge zMaxMm must equal zMinMm + thicknessMm (3.0)");
  }
  if (Math.abs(bridge.zMaxMm - tile.artworkStartZMm) > 1e-9) {
    reasons.push("bridge zMaxMm must equal artworkStartZMm (3.0)");
  }
  if (Math.abs(bridge.zMaxMm - tile.structuralBridgeEndZMm) > 1e-9) {
    reasons.push("bridge zMaxMm must equal structuralBridgeEndZMm (3.0)");
  }
  // Bridge must stay below the minimum supported Relief top (3.4).
  if (!(bridge.zMaxMm < 3.4 - 1e-9)) {
    reasons.push("bridge zMaxMm must remain below the minimum supported top surface");
  }
  if (bridge.zMaxMm >= tile.artworkEndZMm - 1e-9) {
    reasons.push("bridge zMaxMm must be below artworkEndZMm (no visible top slab)");
  }
  if (bridge.useBaseColor !== true) {
    reasons.push("bridge must use structural base color");
  }
  // Local 0.2 mm disk policy must not return.
  if (Math.abs(bridge.thicknessMm - 0.2) < 1e-9) {
    reasons.push("local 0.2 mm magnet-disk backing is retired; bridge must be 0.5 mm");
  }
  if (tile.magnetCentersMm.length !== 2) {
    reasons.push("Tile V1 must retain exactly two magnet centers");
  } else {
    const [a, b] = tile.magnetCentersMm;
    if (Math.abs(a.x + 25) > 1e-9 || Math.abs(a.y) > 1e-9
      || Math.abs(b.x - 25) > 1e-9 || Math.abs(b.y) > 1e-9) {
      reasons.push("magnet centers must remain (-25,0) and (25,0)");
    }
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

/** @deprecated Use validateStructuralBridge (Milestone 9.1). */
export function validateMagnetBacking(backing = STRUCTURAL_BRIDGE, tile = TILE_V1) {
  return validateStructuralBridge(backing, tile);
}

/**
 * Physical center of raster cell (col, row) in Tile V1 millimetres.
 * @param {import("./raster-coords.js").RasterMapping} mapping
 * @param {number} col
 * @param {number} row
 * @returns {{ x: number, y: number }}
 */
export function cellCenterMm(mapping, col, row) {
  return {
    x: pixelLeftX(mapping, col) + mapping.cellWidthMm * 0.5,
    y: pixelTopY(mapping, row) - mapping.cellHeightMm * 0.5,
  };
}

/**
 * True when point (x, y) lies inside either exact magnet cavity circle (inclusive edge).
 * Used for cavity geometry checks — not for bridge / artwork-bottom assignment.
 * @param {number} x
 * @param {number} y
 * @param {typeof STRUCTURAL_BRIDGE} [bridge]
 * @param {typeof TILE_V1} [tile]
 */
export function pointInMagnetCavity(x, y, bridge = STRUCTURAL_BRIDGE, tile = TILE_V1) {
  const r2 = bridge.radiusMm * bridge.radiusMm;
  for (const c of tile.magnetCentersMm) {
    const dx = x - c.x;
    const dy = y - c.y;
    if (dx * dx + dy * dy <= r2 + 1e-12) return true;
  }
  return false;
}

/** @deprecated Use pointInMagnetCavity — bridge coverage is full-tile. */
export function pointInMagnetBacking(x, y, backing = STRUCTURAL_BRIDGE, tile = TILE_V1) {
  return pointInMagnetCavity(x, y, backing, tile);
}

/**
 * True when the cell's physical center is inside a magnet cavity circle.
 * @param {number} col
 * @param {number} row
 * @param {import("./raster-coords.js").RasterMapping} mapping
 * @param {typeof STRUCTURAL_BRIDGE} [bridge]
 * @param {typeof TILE_V1} [tile]
 */
export function cellCenterInMagnetCavity(col, row, mapping, bridge = STRUCTURAL_BRIDGE, tile = TILE_V1) {
  const { x, y } = cellCenterMm(mapping, col, row);
  return pointInMagnetCavity(x, y, bridge, tile);
}

/** @deprecated Use cellCenterInMagnetCavity. */
export function cellCenterInMagnetBacking(col, row, mapping, backing = STRUCTURAL_BRIDGE, tile = TILE_V1) {
  return cellCenterInMagnetCavity(col, row, mapping, backing, tile);
}

/**
 * Build a Uint8 bridge mask (1 = covered by structural bridge).
 * Milestone 9.1: every cell is covered (full-width slab).
 *
 * @param {number} width
 * @param {number} height
 * @param {{ tile?: typeof TILE_V1, backing?: typeof STRUCTURAL_BRIDGE, bridge?: typeof STRUCTURAL_BRIDGE }} [opts]
 * @returns {Uint8Array}
 */
export function createStructuralBridgeMask(width, height, opts = {}) {
  void opts;
  if (!(width > 0 && height > 0)) {
    throw new Error("createStructuralBridgeMask: width and height must be positive");
  }
  const mask = new Uint8Array(width * height);
  mask.fill(1);
  return mask;
}

/** @deprecated Use createStructuralBridgeMask (Milestone 9.1). */
export function createMagnetBackingMask(width, height, opts = {}) {
  return createStructuralBridgeMask(width, height, opts);
}

/**
 * Artwork bottom Z for every cell: structural bridge top (3.0 mm).
 * @param {number} col
 * @param {number} row
 * @param {number} width
 * @param {Uint8Array | ArrayLike<number>} bridgeMask
 * @param {typeof STRUCTURAL_BRIDGE} [bridge]
 * @param {typeof TILE_V1} [tile]
 * @returns {number}
 */
export function resolveArtworkBottomZ(
  col,
  row,
  width,
  bridgeMask,
  bridge = STRUCTURAL_BRIDGE,
  tile = TILE_V1,
) {
  void col;
  void row;
  void width;
  void bridgeMask;
  void tile;
  return bridge.zMaxMm;
}

/**
 * Build a Float64Array of per-cell artwork bottom Z values (all = bridge top).
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array | ArrayLike<number>} bridgeMask
 * @param {typeof STRUCTURAL_BRIDGE} [bridge]
 * @param {typeof TILE_V1} [tile]
 * @returns {Float64Array}
 */
export function buildArtworkBottomHeights(
  width,
  height,
  bridgeMask,
  bridge = STRUCTURAL_BRIDGE,
  tile = TILE_V1,
) {
  if (bridgeMask.length !== width * height) {
    throw new Error("buildArtworkBottomHeights: bridgeMask length must equal width × height");
  }
  void tile;
  const bottoms = new Float64Array(width * height);
  bottoms.fill(bridge.zMaxMm);
  return bottoms;
}

/**
 * Derive geometry helpers from accepted cleaned indices + structural bridge.
 * Does not mutate `acceptedIndices`. Palette assignment is preserved everywhere.
 * Bridge is a separate structural layer covering the full tile.
 *
 * @param {Uint8Array | ArrayLike<number>} acceptedIndices
 * @param {number} width
 * @param {number} height
 * @param {{
 *   tile?: typeof TILE_V1,
 *   backing?: typeof STRUCTURAL_BRIDGE,
 *   bridge?: typeof STRUCTURAL_BRIDGE,
 *   backingMask?: Uint8Array,
 *   bridgeMask?: Uint8Array,
 * }} [opts]
 * @returns {{
 *   acceptedIndices: Uint8Array,
 *   geometryIndices: Uint8Array,
 *   backingMask: Uint8Array,
 *   bridgeMask: Uint8Array,
 *   backingCellCount: number,
 *   bridgeCellCount: number,
 *   artworkBottomZ: Float64Array,
 * }}
 */
export function deriveStructuralBridgeGeometryAssignment(acceptedIndices, width, height, opts = {}) {
  if (!acceptedIndices || acceptedIndices.length !== width * height) {
    throw new Error("deriveStructuralBridgeGeometryAssignment: length must equal width × height");
  }
  const accepted = acceptedIndices instanceof Uint8Array
    ? new Uint8Array(acceptedIndices)
    : Uint8Array.from(acceptedIndices);
  const bridge = opts.bridge || opts.backing || STRUCTURAL_BRIDGE;
  const tile = opts.tile || TILE_V1;
  const providedMask = opts.bridgeMask || opts.backingMask;
  const bridgeMask = providedMask
    ? new Uint8Array(providedMask)
    : createStructuralBridgeMask(width, height, { tile, bridge });
  if (bridgeMask.length !== width * height) {
    throw new Error("bridgeMask length must equal width × height");
  }

  let bridgeCellCount = 0;
  for (let i = 0; i < bridgeMask.length; i += 1) {
    if (bridgeMask[i]) bridgeCellCount += 1;
  }

  const geometryIndices = new Uint8Array(accepted);
  const artworkBottomZ = buildArtworkBottomHeights(width, height, bridgeMask, bridge, tile);

  return {
    acceptedIndices: accepted,
    geometryIndices,
    backingMask: bridgeMask,
    bridgeMask,
    backingCellCount: bridgeCellCount,
    bridgeCellCount,
    artworkBottomZ,
  };
}

/** @deprecated Use deriveStructuralBridgeGeometryAssignment (Milestone 9.1). */
export function deriveMagnetBackingGeometryAssignment(acceptedIndices, width, height, opts = {}) {
  return deriveStructuralBridgeGeometryAssignment(acceptedIndices, width, height, opts);
}

/**
 * Used palette indices for artwork (all palette values present).
 * @param {Uint8Array | ArrayLike<number>} indices
 * @returns {number[]}
 */
export function usedArtworkPaletteIndices(indices) {
  /** @type {Set<number>} */
  const set = new Set();
  for (let i = 0; i < indices.length; i += 1) {
    set.add(indices[i]);
  }
  return [...set].sort((a, b) => a - b);
}
