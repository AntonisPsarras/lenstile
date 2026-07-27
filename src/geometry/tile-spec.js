/**
 * Tile V1 hardware constants (application center-origin frame).
 * Source of truth documentation: hardware/TILE_V1_SPEC.md
 *
 * Vertical structure (Milestone 9.1):
 * - Base section: Z = 0 … 2.5 mm (single-color; magnet cavities open underside)
 * - Structural bridge: Z = 2.5 … 3.0 mm (full 148×53 mm base-color slab)
 * - Artwork section: Z = 3.0 … 4.0 mm (decorative palette colors / Relief)
 * - No decorative geometry may begin below artworkStartZMm (3.0)
 */

/** @typedef {{ x: number, y: number }} Point2 */

/**
 * Circle segment count for magnet recess approximation.
 * Centralized, deterministic, ≥ 24. Changing this alters triangle counts
 * and requires golden-fixture review.
 */
export const MAGNET_CIRCLE_SEGMENTS = 64;

/** Geometry / extrusion algorithm version (bump when mesh rules change). */
export const GEOMETRY_ALGORITHM_VERSION = 7;

/** Full-width structural bridge thickness above magnet cavities (mm). */
export const STRUCTURAL_BRIDGE_THICKNESS_MM = 0.5;

export const TILE_V1 = Object.freeze({
  version: "1",
  widthMm: 148,
  heightMm: 53,
  /** @deprecated Prefer totalThicknessMm — kept as alias for existing callers. */
  thicknessMm: 4,
  totalThicknessMm: 4,
  baseThicknessMm: 2.5,
  /** Continuous base-color bridge spanning the full tile footprint. */
  structuralBridgeThicknessMm: STRUCTURAL_BRIDGE_THICKNESS_MM,
  structuralBridgeStartZMm: 2.5,
  structuralBridgeEndZMm: 3.0,
  /** Decorative artwork / Relief thickness above the bridge (Z 3.0…4.0). */
  artworkThicknessMm: 1.0,
  artworkStartZMm: 3.0,
  artworkEndZMm: 4,
  cornerRadiusMm: 0,
  magnetDiameterMm: 8.5,
  magnetRadiusMm: 4.25,
  /** Inspected from Body122.stl (Z 1.0 → 3.5 CAD). High confidence; not a separate datasheet value. */
  magnetDepthMm: 2.5,
  /** Opening is on the bottom face in the reference mesh. */
  magnetOpening: /** @type {"bottom"} */ ("bottom"),
  /** @see MAGNET_CIRCLE_SEGMENTS */
  magnetCircleSegments: MAGNET_CIRCLE_SEGMENTS,
  /**
   * Magnet centers in application coordinates (mm).
   * @type {readonly Point2[]}
   */
  magnetCentersMm: Object.freeze([
    Object.freeze({ x: -25, y: 0 }),
    Object.freeze({ x: 25, y: 0 }),
  ]),
  boundsMm: Object.freeze({
    minX: -74,
    maxX: 74,
    minY: -26.5,
    maxY: 26.5,
    minZ: 0,
    maxZ: 4,
  }),
});

/**
 * Validate frozen vertical-structure invariants.
 * @param {typeof TILE_V1} [tile]
 * @returns {{ ok: true } | { ok: false, reasons: string[] }}
 */
export function validateTileVerticalStructure(tile = TILE_V1) {
  /** @type {string[]} */
  const reasons = [];
  const sum = tile.baseThicknessMm
    + tile.structuralBridgeThicknessMm
    + tile.artworkThicknessMm;
  if (Math.abs(sum - tile.totalThicknessMm) > 1e-9) {
    reasons.push(
      "baseThicknessMm + structuralBridgeThicknessMm + artworkThicknessMm must equal totalThicknessMm",
    );
  }
  if (Math.abs(tile.structuralBridgeStartZMm - tile.baseThicknessMm) > 1e-9) {
    reasons.push("structuralBridgeStartZMm must equal baseThicknessMm");
  }
  if (Math.abs(
    tile.structuralBridgeEndZMm
      - (tile.structuralBridgeStartZMm + tile.structuralBridgeThicknessMm),
  ) > 1e-9) {
    reasons.push("structuralBridgeEndZMm must equal start + thickness (3.0)");
  }
  if (Math.abs(tile.artworkStartZMm - tile.structuralBridgeEndZMm) > 1e-9) {
    reasons.push("artworkStartZMm must equal structuralBridgeEndZMm (3.0)");
  }
  if (Math.abs(tile.artworkEndZMm - tile.totalThicknessMm) > 1e-9) {
    reasons.push("artworkEndZMm must equal totalThicknessMm");
  }
  if (tile.magnetDepthMm > tile.baseThicknessMm + 1e-9) {
    reasons.push("magnetDepthMm must not exceed baseThicknessMm");
  }
  if (tile.artworkStartZMm < tile.structuralBridgeEndZMm - 1e-9) {
    reasons.push("artwork geometry must not begin below the structural bridge");
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

/**
 * True when a prospective artwork Z start is valid (must not undercut the bridge).
 * @param {number} artworkStartZMm
 * @param {typeof TILE_V1} [tile]
 */
export function isValidArtworkStartZ(artworkStartZMm, tile = TILE_V1) {
  return Number.isFinite(artworkStartZMm) && artworkStartZMm >= tile.artworkStartZMm - 1e-9;
}

/** Aspect ratio width/height for crop framing. */
export function tileAspectRatio() {
  return TILE_V1.widthMm / TILE_V1.heightMm;
}

/**
 * @returns {{
 *   widthMm: number,
 *   heightMm: number,
 *   thicknessMm: number,
 *   totalThicknessMm: number,
 *   baseThicknessMm: number,
 *   structuralBridgeThicknessMm: number,
 *   structuralBridgeStartZMm: number,
 *   structuralBridgeEndZMm: number,
 *   artworkThicknessMm: number,
 *   artworkStartZMm: number,
 *   artworkEndZMm: number,
 *   cornerRadiusMm: number,
 *   magnetDiameterMm: number,
 *   magnetDepthMm: number,
 *   magnetCentersMm: Array<{x: number, y: number}>
 * }}
 */
export function createTileStateSlice() {
  return {
    widthMm: TILE_V1.widthMm,
    heightMm: TILE_V1.heightMm,
    thicknessMm: TILE_V1.totalThicknessMm,
    totalThicknessMm: TILE_V1.totalThicknessMm,
    baseThicknessMm: TILE_V1.baseThicknessMm,
    structuralBridgeThicknessMm: TILE_V1.structuralBridgeThicknessMm,
    structuralBridgeStartZMm: TILE_V1.structuralBridgeStartZMm,
    structuralBridgeEndZMm: TILE_V1.structuralBridgeEndZMm,
    artworkThicknessMm: TILE_V1.artworkThicknessMm,
    artworkStartZMm: TILE_V1.artworkStartZMm,
    artworkEndZMm: TILE_V1.artworkEndZMm,
    cornerRadiusMm: TILE_V1.cornerRadiusMm,
    magnetDiameterMm: TILE_V1.magnetDiameterMm,
    magnetRadiusMm: TILE_V1.magnetRadiusMm,
    magnetDepthMm: TILE_V1.magnetDepthMm,
    magnetCircleSegments: TILE_V1.magnetCircleSegments,
    magnetCentersMm: TILE_V1.magnetCentersMm.map((p) => ({ x: p.x, y: p.y })),
  };
}
