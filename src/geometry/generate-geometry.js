/**
 * High-level Tile V1 geometry assembly for export.
 */

import { TILE_V1, GEOMETRY_ALGORITHM_VERSION } from "./tile-spec.js";
import { buildCombinedTileMesh, buildBaseTileMesh } from "./tile-base.js";
import { generateVariableBottomArtworkMesh } from "./artwork-mesh.js";
import { buildAllReliefArtworkMeshes, generateCombinedReliefTileMesh } from "./relief-mesh.js";
import {
  RELIEF,
  normalizeSurfaceStyleId,
  resolveColorTopHeights,
  validateReliefConfig,
} from "./relief.js";
import { palettePopulations } from "./mask-to-rectangles.js";
import { validateMesh, plainGeometryFailureMessage } from "./mesh-validation.js";
import { packMesh } from "./mesh.js";
import {
  STRUCTURAL_BRIDGE,
  validateStructuralBridge,
  deriveStructuralBridgeGeometryAssignment,
  usedArtworkPaletteIndices,
} from "./magnet-backing.js";
import { generateStructuralBridgeMesh } from "./magnet-backing-mesh.js";

export { GEOMETRY_ALGORITHM_VERSION };

/**
 * @typedef {object} GeneratedGeometry
 * @property {number} geometryRevision
 * @property {number} algorithmVersion
 * @property {number} width
 * @property {number} height
 * @property {"flat" | "relief"} surfaceStyle
 * @property {import("./mesh.js").PackedMesh} combined
 * @property {import("./mesh.js").PackedMesh} base
 * @property {import("./mesh.js").PackedMesh | null} backing
 * @property {Uint8Array} backingMask
 * @property {Uint8Array} geometryIndices
 * @property {Float64Array} artworkBottomZ
 * @property {number} backingCellCount
 * @property {Array<{
 *   paletteIndex: number,
 *   population: number,
 *   mesh: import("./mesh.js").PackedMesh,
 *   topZMm?: number
 * }>} colors
 * @property {{
 *   combined: ReturnType<typeof validateMesh>,
 *   base: ReturnType<typeof validateMesh>,
 *   backing: ReturnType<typeof validateMesh> | null,
 *   colors: Array<ReturnType<typeof validateMesh>>
 * }} validation
 * @property {boolean} ok
 * @property {string[]} reasons
 * @property {string | null} userMessage
 * @property {ReturnType<typeof resolveColorTopHeights> | null} relief
 *
 * Legacy aliases (Milestone 7.3 → 7.3.2): `roof` / `keepoutMask` / `keepoutCellCount`
 * remain readable on the result for one transition while callers migrate.
 */

/**
 * Generate all export meshes from an accepted cleaned index buffer.
 *
 * Flat mode keeps the historical combined solid (byte-identical golden path)
 * — Flat combined is the constructive tile solid and is independent of the
 * artwork mask / hidden backing.
 *
 * Relief mode builds a variable-height combined solid from accepted image
 * indices (Relief tops unchanged above magnets).
 *
 * Accepted cleaned indices are never mutated. A full-width base-colored
 * structural bridge occupies Z 2.5…3.0 across the entire tile; all artwork
 * bottoms begin globally at Z = 3.0 mm.
 *
 * @param {object} opts
 * @param {Uint8Array | ArrayLike<number>} opts.cleanedIndices
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {number} [opts.geometryRevision]
 * @param {number} [opts.segments]
 * @param {typeof TILE_V1} [opts.tile]
 * @param {"flat" | "relief" | string} [opts.surfaceStyle]
 * @param {string} [opts.reliefStrengthId]
 * @param {string} [opts.heightOrder]
 * @param {Array<{ paletteIndex: number, levelIndex: number }>} [opts.colorHeightLevels]
 * @param {Array<{ r: number, g: number, b: number }>} [opts.effectivePalette]
 * @returns {GeneratedGeometry}
 */
export function generateTileGeometry(opts) {
  const collectDiagnostics = opts.collectDiagnostics === true;
  const now = typeof opts.now === "function"
    ? opts.now
    : () => (typeof performance !== "undefined" ? performance.now() : 0);
  const geometryStarted = collectDiagnostics ? now() : 0;
  const tile = opts.tile || TILE_V1;
  const width = opts.width;
  const height = opts.height;
  const indices = opts.cleanedIndices;
  const surfaceStyle = normalizeSurfaceStyleId(opts.surfaceStyle);

  if (!indices || indices.length !== width * height) {
    throw new Error("generateTileGeometry: cleanedIndices length must equal width × height");
  }

  /** @type {string[]} */
  const reasons = [];
  const reliefConfig = validateReliefConfig(RELIEF, tile);
  if (!reliefConfig.ok) reasons.push(...reliefConfig.reasons);
  const bridgeConfig = validateStructuralBridge(STRUCTURAL_BRIDGE, tile);
  if (!bridgeConfig.ok) reasons.push(...bridgeConfig.reasons);

  const effectivePalette = Array.isArray(opts.effectivePalette) ? opts.effectivePalette : [];
  const reliefResolved = resolveColorTopHeights({
    style: surfaceStyle,
    reliefStrengthId: opts.reliefStrengthId,
    heightOrder: opts.heightOrder,
    colorHeightLevels: opts.colorHeightLevels,
    indices,
    effectivePalette,
  });
  if (!reliefResolved.ok) reasons.push(...reliefResolved.reasons);

  const assignment = deriveStructuralBridgeGeometryAssignment(indices, width, height, { tile });
  const {
    geometryIndices,
    backingMask,
    backingCellCount,
    artworkBottomZ,
  } = assignment;

  for (let i = 0; i < indices.length; i += 1) {
    if (assignment.acceptedIndices[i] !== indices[i]) {
      reasons.push("structural-bridge derivation mutated accepted indices");
      break;
    }
    if (geometryIndices[i] !== indices[i]) {
      reasons.push("geometry indices must preserve accepted palette assignment");
      break;
    }
  }

  const base = buildBaseTileMesh({ tile, segments: opts.segments });
  const backing = generateStructuralBridgeMesh(width, height, { backingMask, tile });
  if (!backing) {
    reasons.push("structural bridge mesh is empty");
  }
  if (backingCellCount !== width * height) {
    reasons.push("structural bridge must cover every raster cell");
  }

  /** @type {import("./mesh.js").PackedMesh} */
  let combined;
  /** @type {Array<{ paletteIndex: number, population: number, mesh: import("./mesh.js").PackedMesh, topZMm?: number }>} */
  let colorMeshes;

  if (surfaceStyle === "relief") {
    combined = generateCombinedReliefTileMesh({
      indices: geometryIndices,
      width,
      height,
      topHeightByPaletteIndex: reliefResolved.topHeightByPaletteIndex,
      segments: opts.segments,
      tile,
    });
    colorMeshes = buildAllReliefArtworkMeshes(
      geometryIndices,
      width,
      height,
      reliefResolved.topHeightByPaletteIndex,
      tile,
      { bottomHeights: artworkBottomZ },
    ).map((c) => ({
      ...c,
      topZMm: reliefResolved.topHeightByPaletteIndex.get(c.paletteIndex),
    }));
  } else {
    combined = buildCombinedTileMesh({ tile, segments: opts.segments });
    colorMeshes = generateVariableBottomArtworkMesh(
      geometryIndices,
      width,
      height,
      artworkBottomZ,
      { tile },
    ).map((c) => ({
      ...c,
      topZMm: tile.artworkEndZMm,
    }));
  }

  const geometryFinished = collectDiagnostics ? now() : 0;
  const validationStarted = geometryFinished;
  const combinedVal = validateMesh(combined, {
    bounds: tile.boundsMm,
    requireClosed: true,
    requirePositiveVolume: true,
    objectName: "combined",
  });
  const baseVal = validateMesh(base, {
    bounds: {
      minX: tile.boundsMm.minX,
      maxX: tile.boundsMm.maxX,
      minY: tile.boundsMm.minY,
      maxY: tile.boundsMm.maxY,
      minZ: 0,
      maxZ: tile.baseThicknessMm,
    },
    requireClosed: true,
    requirePositiveVolume: true,
    objectName: "base",
  });

  /** @type {ReturnType<typeof validateMesh> | null} */
  let backingVal = null;
  if (backing) {
    backingVal = validateMesh(backing, {
      bounds: {
        minX: tile.boundsMm.minX,
        maxX: tile.boundsMm.maxX,
        minY: tile.boundsMm.minY,
        maxY: tile.boundsMm.maxY,
        minZ: STRUCTURAL_BRIDGE.zMinMm,
        maxZ: STRUCTURAL_BRIDGE.zMaxMm,
      },
      requireClosed: true,
      requirePositiveVolume: true,
      objectName: "structural-bridge",
    });
  }

  const colorVals = colorMeshes.map((c) => {
    const zMax = c.topZMm ?? tile.artworkEndZMm;
    return validateMesh(c.mesh, {
      bounds: {
        minX: tile.boundsMm.minX,
        maxX: tile.boundsMm.maxX,
        minY: tile.boundsMm.minY,
        maxY: tile.boundsMm.maxY,
        minZ: tile.artworkStartZMm,
        maxZ: zMax,
      },
      requireClosed: true,
      requirePositiveVolume: true,
      objectName: `color[${c.paletteIndex}]`,
    });
  });
  const validationFinished = collectDiagnostics ? now() : 0;

  if (!combinedVal.ok) reasons.push(...combinedVal.reasons.map((r) => `combined: ${r}`));
  if (!baseVal.ok) reasons.push(...baseVal.reasons.map((r) => `base: ${r}`));
  if (backingVal && !backingVal.ok) {
    reasons.push(...backingVal.reasons.map((r) => `structural-bridge: ${r}`));
  }
  colorVals.forEach((v, i) => {
    if (!v.ok) {
      reasons.push(...v.reasons.map((r) => `color[${colorMeshes[i].paletteIndex}]: ${r}`));
    }
  });

  // No gap / no overlap: every artwork bottom sits on the bridge top (Z = 3.0).
  for (let i = 0; i < artworkBottomZ.length; i += 1) {
    if (Math.abs(artworkBottomZ[i] - STRUCTURAL_BRIDGE.zMaxMm) > 1e-9
      || Math.abs(artworkBottomZ[i] - tile.artworkStartZMm) > 1e-9) {
      reasons.push("artwork bottoms must equal structural bridge zMaxMm / artworkStartZMm (3.0)");
      break;
    }
  }

  // Bridge AABB must be the full tile footprint (no local magnet disks).
  if (backingVal && backingVal.ok) {
    const b = backingVal.bounds;
    if (Math.abs(b.sizeX - tile.widthMm) > 1e-6 || Math.abs(b.sizeY - tile.heightMm) > 1e-6) {
      reasons.push("structural bridge must span the full 148 × 53 mm tile");
    }
    if (Math.abs(b.sizeZ - STRUCTURAL_BRIDGE.thicknessMm) > 1e-6) {
      reasons.push("structural bridge thickness must be 0.5 mm");
    }
  }

  if (surfaceStyle === "relief") {
    const pos = combined.positions;
    for (let i = 0; i < pos.length; i += 3) {
      const z = pos[i + 2];
      if (z > tile.totalThicknessMm + 1e-6) {
        reasons.push("combined vertex exceeds 4.0 mm");
        break;
      }
      if (z < -1e-6) {
        reasons.push("combined vertex below Z = 0");
        break;
      }
    }
    for (const c of colorMeshes) {
      const cp = c.mesh.positions;
      for (let i = 0; i < cp.length; i += 3) {
        const z = cp[i + 2];
        if (z < tile.artworkStartZMm - 1e-6) {
          reasons.push(`color[${c.paletteIndex}] vertex below artwork start`);
          break;
        }
        if (c.topZMm != null && c.topZMm < RELIEF.minTopZMm - 1e-9) {
          reasons.push(`color[${c.paletteIndex}] top below minTopZMm`);
          break;
        }
      }
    }
    if (combinedVal.bounds.maxZ < RELIEF.maxTopZMm - 1e-6) {
      reasons.push("combined bounds must reach 4.0 mm");
    }
    const minTop = Math.min(...[...reliefResolved.topHeightByPaletteIndex.values()]);
    if (reliefResolved.usedIndices.length && minTop < RELIEF.minTopZMm - 1e-9) {
      reasons.push("relief minimum surface below 3.4 mm");
    }
  }

  const used = usedArtworkPaletteIndices(geometryIndices);
  if (used.length !== colorMeshes.length) {
    reasons.push("used palette / mesh count mismatch");
  }

  // Every raster cell belongs to exactly one artwork color; backing is additive.
  if (colorMeshes.reduce((n, c) => n + c.population, 0) !== width * height) {
    reasons.push("artwork populations must cover every raster cell");
  }

  const result = {
    geometryRevision: opts.geometryRevision ?? 0,
    algorithmVersion: GEOMETRY_ALGORITHM_VERSION,
    width,
    height,
    surfaceStyle,
    combined,
    base,
    backing,
    backingMask,
    geometryIndices,
    artworkBottomZ,
    backingCellCount,
    colors: colorMeshes,
    validation: {
      combined: combinedVal,
      base: baseVal,
      backing: backingVal,
      colors: colorVals,
    },
    ok: reasons.length === 0,
    reasons,
    userMessage: reasons.length ? plainGeometryFailureMessage(reasons) : null,
    relief: reliefResolved,
    diagnostics: collectDiagnostics
      ? {
        geometryConstructionMs: geometryFinished - geometryStarted,
        meshValidationMs: validationFinished - validationStarted,
      }
      : null,
  };

  // Transition aliases for callers still reading 7.3 field names.
  Object.defineProperty(result, "roof", {
    enumerable: true,
    get() { return this.backing; },
  });
  Object.defineProperty(result, "keepoutMask", {
    enumerable: true,
    get() { return this.backingMask; },
  });
  Object.defineProperty(result, "keepoutCellCount", {
    enumerable: true,
    get() { return this.backingCellCount; },
  });

  return result;
}

/**
 * @param {Uint8Array | ArrayLike<number>} indices
 * @param {Array<{ r: number, g: number, b: number }>} effectivePalette
 */
export function describeUsedColors(indices, effectivePalette) {
  const pops = palettePopulations(indices);
  const used = usedArtworkPaletteIndices(indices);
  return used.map((paletteIndex) => {
    const color = effectivePalette[paletteIndex] || { r: 0, g: 0, b: 0 };
    return {
      paletteIndex,
      population: pops.get(paletteIndex) || 0,
      r: color.r,
      g: color.g,
      b: color.b,
    };
  });
}

/**
 * Clone mesh into transferable-friendly packed form.
 * @param {import("./mesh.js").PackedMesh} mesh
 */
export function clonePackedMesh(mesh) {
  return packMesh(mesh);
}
