/**
 * Structural bridge mesh — full-width slab Z 2.5…3.0 over the entire tile.
 *
 * Milestone 9.1 replaces local circular magnet-backing disks with one continuous
 * 148 × 53 × 0.5 mm base-colored rectangle. No artwork, color boundaries, or
 * Relief steps exist in this layer.
 */

import { TILE_V1 } from "./tile-spec.js";
import { createBoxMesh } from "./primitives.js";
import {
  STRUCTURAL_BRIDGE,
  createStructuralBridgeMask,
} from "./magnet-backing.js";

/** Stable 3MF / diagnostics object name (not localized). */
export const STRUCTURAL_BRIDGE_OBJECT_NAME = "Structural Bridge";

/** @deprecated Use STRUCTURAL_BRIDGE_OBJECT_NAME (Milestone 9.1). */
export const MAGNET_BACKING_OBJECT_NAME = STRUCTURAL_BRIDGE_OBJECT_NAME;

/**
 * Build a closed manifold box covering the full tile footprint at Z zMin…zMax.
 * Always returns a mesh for a valid Tile V1 envelope (full-width bridge).
 *
 * @param {number} width
 * @param {number} height
 * @param {{
 *   backingMask?: Uint8Array,
 *   bridgeMask?: Uint8Array,
 *   tile?: typeof TILE_V1,
 *   backing?: typeof STRUCTURAL_BRIDGE,
 *   bridge?: typeof STRUCTURAL_BRIDGE,
 * }} [opts]
 * @returns {import("./mesh.js").PackedMesh}
 */
export function generateStructuralBridgeMesh(width, height, opts = {}) {
  const tile = opts.tile || TILE_V1;
  const bridge = opts.bridge || opts.backing || STRUCTURAL_BRIDGE;
  if (!(width > 0 && height > 0)) {
    throw new Error("generateStructuralBridgeMesh: width and height must be positive");
  }
  const mask = opts.bridgeMask || opts.backingMask
    || createStructuralBridgeMask(width, height, { tile, bridge });
  if (mask.length !== width * height) {
    throw new Error("generateStructuralBridgeMesh: mask length must equal width × height");
  }
  let any = false;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) {
      any = true;
      break;
    }
  }
  if (!any) {
    throw new Error("generateStructuralBridgeMesh: structural bridge mask is empty");
  }

  return createBoxMesh(
    tile.boundsMm.minX,
    tile.boundsMm.minY,
    bridge.zMinMm,
    tile.boundsMm.maxX,
    tile.boundsMm.maxY,
    bridge.zMaxMm,
  );
}

/** @deprecated Use generateStructuralBridgeMesh (Milestone 9.1). */
export function generateStructuralBackingMesh(width, height, opts = {}) {
  return generateStructuralBridgeMesh(width, height, opts);
}

/**
 * Convenience: derive full-coverage mask and build the bridge mesh.
 *
 * @param {number} width
 * @param {number} height
 * @param {{ tile?: typeof TILE_V1, backing?: typeof STRUCTURAL_BRIDGE, bridge?: typeof STRUCTURAL_BRIDGE }} [opts]
 * @returns {{
 *   mesh: import("./mesh.js").PackedMesh,
 *   backingMask: Uint8Array,
 *   bridgeMask: Uint8Array,
 * }}
 */
export function buildStructuralBridgeFromGrid(width, height, opts = {}) {
  const bridgeMask = createStructuralBridgeMask(width, height, opts);
  const mesh = generateStructuralBridgeMesh(width, height, {
    bridgeMask,
    tile: opts.tile,
    bridge: opts.bridge || opts.backing,
  });
  return { mesh, backingMask: bridgeMask, bridgeMask };
}

/** @deprecated Use buildStructuralBridgeFromGrid (Milestone 9.1). */
export function buildMagnetBackingFromGrid(width, height, opts = {}) {
  return buildStructuralBridgeFromGrid(width, height, opts);
}
