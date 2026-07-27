/**
 * Variable-height relief mesh generation (Milestone 6.2 / 6.2.1).
 *
 * Combined relief: one closed solid = magnet base shell + variable top.
 * Per-color relief: reuse artwork boundary extrusion with per-color zMax.
 *
 * Saddle junctions (Milestone 6.2.1): ambiguous 2×2 height crossings are resolved
 * with a deterministic diagonal so no undirected edge has incidence > 2.
 *
 * Touching-volume note (multicolor): adjacent colors share XY boundaries and may
 * have coplanar opposing side faces up to the shorter top; the taller object
 * exposes an additional vertical step. Slicers typically treat this as aligned
 * multi-body geometry for separate STLs / future 3MF.
 */

import { TILE_V1 } from "./tile-spec.js";
import { RELIEF, buildCellTopHeights } from "./relief.js";
import { createMesh, addTriangle, packMesh } from "./mesh.js";
import { createRasterMapping, pixelLeftX, pixelTopY } from "./raster-coords.js";
import { buildCombinedTileOpenShell } from "./tile-base.js";
import { buildArtworkColorMesh, buildAllArtworkMeshes } from "./artwork-mesh.js";
import { addQuad } from "./primitives.js";

/**
 * @param {number} value
 */
function snapMm(value) {
  return Math.round(value * 1e10) / 1e10;
}

const HEIGHT_EPS = 1e-12;

/**
 * Quantize a height for equality / set membership at junctions.
 * @param {number} z
 */
export function reliefHeightKey(z) {
  return Math.round(z * 1e6) / 1e6;
}

/**
 * @param {number} zSW
 * @param {number} zSE
 * @param {number} zNW
 * @param {number} zNE
 */
export function countDistinctReliefHeights(zSW, zSE, zNW, zNE) {
  return new Set([
    reliefHeightKey(zSW),
    reliefHeightKey(zSE),
    reliefHeightKey(zNW),
    reliefHeightKey(zNE),
  ]).size;
}

/**
 * True when all four cardinal neighbor pairs differ in height — a crossing /
 * saddle junction that would otherwise share one vertical center edge.
 *
 * Cell layout (SW, SE / NW, NE) matches uniqY ascending (−Y → +Y).
 *
 * @param {number} zSW
 * @param {number} zSE
 * @param {number} zNW
 * @param {number} zNE
 */
export function isAmbiguousReliefJunction(zSW, zSE, zNW, zNE) {
  // Equal-diagonal binary saddle (the known incidence-4 case).
  const equalDiag = Math.abs(zNW - zSE) <= HEIGHT_EPS
    && Math.abs(zNE - zSW) <= HEIGHT_EPS
    && Math.abs(zNW - zNE) > HEIGHT_EPS;
  if (equalDiag) return true;

  // Bilinear contour cross (excludes single-corner raises and monotone ramps).
  const c1 = (zNW - zNE) * (zSW - zSE);
  const c2 = (zNW - zSW) * (zNE - zSE);
  if (c1 < -HEIGHT_EPS && c2 < -HEIGHT_EPS) return true;

  // One diagonal strictly above the other.
  const minNWSE = Math.min(zNW, zSE);
  const maxNESW = Math.max(zNE, zSW);
  const minNESW = Math.min(zNE, zSW);
  const maxNWSE = Math.max(zNW, zSE);
  if (minNWSE > maxNESW + HEIGHT_EPS || minNESW > maxNWSE + HEIGHT_EPS) return true;

  // Four distinct heights with all four cardinal steps (incomplete center pairing).
  const top = Math.abs(zNW - zNE) > HEIGHT_EPS;
  const bot = Math.abs(zSW - zSE) > HEIGHT_EPS;
  const left = Math.abs(zNW - zSW) > HEIGHT_EPS;
  const right = Math.abs(zNE - zSE) > HEIGHT_EPS;
  if (!(top && bot && left && right)) return false;
  return countDistinctReliefHeights(zSW, zSE, zNW, zNE) === 4;
}

/**
 * Junctions that need sector tags and/or an offset-apex fan.
 *
 * Covers classical saddles plus multi-height T-junctions (3+ distinct tops)
 * where step walls leave unpaired vertical edges at the shared grid point.
 *
 * @param {number} zSW
 * @param {number} zSE
 * @param {number} zNW
 * @param {number} zNE
 */
export function needsReliefJunctionCap(zSW, zSE, zNW, zNE) {
  if (isAmbiguousReliefJunction(zSW, zSE, zNW, zNE)) return true;
  return countDistinctReliefHeights(zSW, zSE, zNW, zNE) >= 3;
}

/**
 * Merge adjacent equal-height roles into cyclic groups (CCW: SE → NE → NW → SW).
 * Equal-height neighbors share one vertex identity so top faces stay welded.
 *
 * @param {number} zSW
 * @param {number} zSE
 * @param {number} zNW
 * @param {number} zNE
 * @returns {Array<{ roles: Array<"nw"|"ne"|"sw"|"se">, z: number, tag: string }>}
 */
export function mergeEqualHeightRoles(zSW, zSE, zNW, zNE) {
  /** @type {Array<{ role: "nw"|"ne"|"sw"|"se", z: number }>} */
  const ring = [
    { role: "se", z: zSE },
    { role: "ne", z: zNE },
    { role: "nw", z: zNW },
    { role: "sw", z: zSW },
  ];
  /** @type {Array<{ roles: Array<"nw"|"ne"|"sw"|"se">, z: number }>} */
  const groups = [];
  for (const item of ring) {
    const last = groups[groups.length - 1];
    if (last && reliefHeightKey(last.z) === reliefHeightKey(item.z)) {
      last.roles.push(item.role);
    } else {
      groups.push({ roles: [item.role], z: item.z });
    }
  }
  if (
    groups.length > 1
    && reliefHeightKey(groups[0].z) === reliefHeightKey(groups[groups.length - 1].z)
  ) {
    const first = groups[0];
    const last = /** @type {{ roles: Array<"nw"|"ne"|"sw"|"se">, z: number }} */ (
      groups.pop()
    );
    first.roles = last.roles.concat(first.roles);
  }
  return groups.map((g, i) => ({
    roles: g.roles,
    z: g.z,
    tag: `G${i}`,
  }));
}

/**
 * Deterministic diagonal for an ambiguous 2×2 junction.
 * Returns `nwse` (SW↔NE is the other diagonal) or `nesw`.
 *
 * Priority:
 * 1. Greater combined top height
 * 2. Lower minimum palette index on that diagonal
 * 3. Northwest–southeast (`nwse`)
 *
 * @param {number} zSW
 * @param {number} zSE
 * @param {number} zNW
 * @param {number} zNE
 * @param {number} iSW
 * @param {number} iSE
 * @param {number} iNW
 * @param {number} iNE
 * @returns {"nwse" | "nesw"}
 */
export function chooseReliefDiagonal(zSW, zSE, zNW, zNE, iSW, iSE, iNW, iNE) {
  const sumNWSE = zNW + zSE;
  const sumNESW = zNE + zSW;
  if (sumNWSE > sumNESW + HEIGHT_EPS) return "nwse";
  if (sumNESW > sumNWSE + HEIGHT_EPS) return "nesw";
  const minNWSE = Math.min(iNW, iSE);
  const minNESW = Math.min(iNE, iSW);
  if (minNWSE < minNESW) return "nwse";
  if (minNESW < minNWSE) return "nesw";
  return "nwse";
}

/**
 * @param {"nw" | "ne" | "sw" | "se"} role
 * @param {"nwse" | "nesw"} diag
 * @param {boolean} binaryLike When true, preferred-diagonal corners share tag `P`
 *   so opposite step walls form one manifold edge. Non-binary junctions keep
 *   distinct role tags and close via emitNonBinaryJunction.
 */
function junctionSectorTag(role, diag, binaryLike) {
  if (!binaryLike) return role;
  if (diag === "nwse") {
    if (role === "nw" || role === "se") return "P";
    return role;
  }
  if (role === "ne" || role === "sw") return "P";
  return role;
}

/**
 * Closed mesh for one palette index at a uniform top height.
 * @param {Uint8Array | ArrayLike<number>} indices
 * @param {number} width
 * @param {number} height
 * @param {number} paletteIndex
 * @param {number} zMax
 * @param {typeof TILE_V1} [tile]
 * @param {{ bottomHeights?: Float64Array | null }} [options]
 */
export function buildReliefArtworkColorMesh(
  indices,
  width,
  height,
  paletteIndex,
  zMax,
  tile = TILE_V1,
  options = {},
) {
  return buildArtworkColorMesh(indices, width, height, paletteIndex, {
    tile,
    zMin: tile.artworkStartZMm,
    zMax,
    bottomHeights: options.bottomHeights || null,
  });
}

/**
 * One mesh per used palette index with per-color top heights.
 * @param {Uint8Array | ArrayLike<number>} indices
 * @param {number} width
 * @param {number} height
 * @param {Map<number, number>} topHeightByPaletteIndex
 * @param {typeof TILE_V1} [tile]
 * @param {{ bottomHeights?: Float64Array | null }} [options]
 */
export function buildAllReliefArtworkMeshes(
  indices,
  width,
  height,
  topHeightByPaletteIndex,
  tile = TILE_V1,
  options = {},
) {
  const bottomHeights = options.bottomHeights || null;
  const flat = buildAllArtworkMeshes(indices, width, height, { tile, bottomHeights });
  /** @type {Array<{ paletteIndex: number, mesh: import("./mesh.js").PackedMesh, population: number, topZMm?: number }>} */
  const results = [];
  for (const entry of flat) {
    const zMax = topHeightByPaletteIndex.get(entry.paletteIndex) ?? tile.artworkEndZMm;
    const mesh = buildReliefArtworkColorMesh(
      indices,
      width,
      height,
      entry.paletteIndex,
      zMax,
      tile,
      { bottomHeights },
    );
    if (!mesh) continue;
    results.push({
      paletteIndex: entry.paletteIndex,
      population: entry.population,
      mesh,
      topZMm: zMax,
    });
  }
  return results;
}

/**
 * Variable-height artwork shell (tops, optional bottoms, step walls, outer sides).
 *
 * Step walls are emitted once from the taller cell only so equal-height neighbors
 * create no interior wall.
 *
 * @param {object} opts
 * @param {Float64Array | ArrayLike<number>} opts.cellTopHeights
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {number} [opts.zMin]
 * @param {boolean} [opts.includeBottoms]
 * @param {typeof TILE_V1} [opts.tile]
 * @returns {import("./mesh.js").GrowableMesh}
 */
export function generateVariableHeightArtworkMesh(opts) {
  const tile = opts.tile || TILE_V1;
  const width = opts.width;
  const height = opts.height;
  const zMin = opts.zMin ?? tile.artworkStartZMm;
  const includeBottoms = opts.includeBottoms !== false;
  const tops = opts.cellTopHeights;
  if (tops.length !== width * height) {
    throw new Error("generateVariableHeightArtworkMesh: height map size mismatch");
  }

  const mapping = createRasterMapping(width, height, tile);
  const mesh = createMesh();
  /** @type {Map<string, number>} */
  const vertexMap = new Map();

  /**
   * @param {number} ix
   * @param {number} iy
   * @param {number} z
   */
  function vert(ix, iy, z) {
    const zs = snapMm(z);
    const key = `${ix},${iy},${zs}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const x = snapMm(pixelLeftX(mapping, ix));
    const y = snapMm(pixelTopY(mapping, iy));
    const index = mesh.positions.length / 3;
    mesh.positions.push(x, y, zs);
    vertexMap.set(key, index);
    return index;
  }

  /**
   * @param {number} a
   * @param {number} b
   * @param {number} c
   * @param {number} d
   */
  function quad(a, b, c, d) {
    addTriangle(mesh, a, b, c);
    addTriangle(mesh, a, c, d);
  }

  /**
   * @param {number} col
   * @param {number} row
   */
  function topAt(col, row) {
    if (col < 0 || row < 0 || col >= width || row >= height) return null;
    return tops[row * width + col];
  }

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const zTop = tops[row * width + col];
      if (!(zTop > zMin)) {
        throw new Error("relief cell top must exceed artwork start Z");
      }

      {
        const a = vert(col, row, zTop);
        const b = vert(col + 1, row, zTop);
        const c = vert(col + 1, row + 1, zTop);
        const d = vert(col, row + 1, zTop);
        quad(a, d, c, b);
      }

      if (includeBottoms) {
        const a = vert(col, row, zMin);
        const b = vert(col + 1, row, zMin);
        const c = vert(col + 1, row + 1, zMin);
        const d = vert(col, row + 1, zMin);
        quad(a, b, c, d);
      }

      {
        const n = topAt(col, row - 1);
        if (n == null) {
          const a = vert(col, row, zMin);
          const b = vert(col + 1, row, zMin);
          const c = vert(col + 1, row, zTop);
          const d = vert(col, row, zTop);
          quad(a, d, c, b);
        } else if (zTop > n + 1e-12) {
          const a = vert(col, row, n);
          const b = vert(col + 1, row, n);
          const c = vert(col + 1, row, zTop);
          const d = vert(col, row, zTop);
          quad(a, d, c, b);
        }
      }

      {
        const n = topAt(col, row + 1);
        if (n == null) {
          const a = vert(col, row + 1, zMin);
          const b = vert(col + 1, row + 1, zMin);
          const c = vert(col + 1, row + 1, zTop);
          const d = vert(col, row + 1, zTop);
          quad(a, b, c, d);
        } else if (zTop > n + 1e-12) {
          const a = vert(col, row + 1, n);
          const b = vert(col + 1, row + 1, n);
          const c = vert(col + 1, row + 1, zTop);
          const d = vert(col, row + 1, zTop);
          quad(a, b, c, d);
        }
      }

      {
        const n = topAt(col - 1, row);
        if (n == null) {
          const a = vert(col, row, zMin);
          const b = vert(col, row + 1, zMin);
          const c = vert(col, row + 1, zTop);
          const d = vert(col, row, zTop);
          quad(a, b, c, d);
        } else if (zTop > n + 1e-12) {
          const a = vert(col, row, n);
          const b = vert(col, row + 1, n);
          const c = vert(col, row + 1, zTop);
          const d = vert(col, row, zTop);
          quad(a, b, c, d);
        }
      }

      {
        const n = topAt(col + 1, row);
        if (n == null) {
          const a = vert(col + 1, row, zMin);
          const b = vert(col + 1, row + 1, zMin);
          const c = vert(col + 1, row + 1, zTop);
          const d = vert(col + 1, row, zTop);
          quad(a, d, c, b);
        } else if (zTop > n + 1e-12) {
          const a = vert(col + 1, row, n);
          const b = vert(col + 1, row + 1, n);
          const c = vert(col + 1, row + 1, zTop);
          const d = vert(col + 1, row, zTop);
          quad(a, d, c, b);
        }
      }
    }
  }

  return mesh;
}

/**
 * @param {{
 *   south: Array<{x:number,y:number}>,
 *   north: Array<{x:number,y:number}>,
 *   west: Array<{x:number,y:number}>,
 *   east: Array<{x:number,y:number}>
 * }} bottomOuter
 * @param {ReturnType<typeof createRasterMapping>} mapping
 */
function augmentPerimeterWithRaster(bottomOuter, mapping) {
  /** @type {number[]} */
  const rasterXs = [];
  for (let c = 0; c <= mapping.width; c += 1) {
    rasterXs.push(snapMm(pixelLeftX(mapping, c)));
  }
  /** @type {number[]} */
  const rasterYs = [];
  for (let r = 0; r <= mapping.height; r += 1) {
    rasterYs.push(snapMm(pixelTopY(mapping, r)));
  }

  /**
   * @param {Array<{x:number,y:number}>} pts
   * @param {"x" | "y"} vary
   * @param {number[]} extras
   * @param {number} fixed
   */
  function mergeSide(pts, vary, extras, fixed) {
    /** @type {Map<number, {x:number,y:number}>} */
    const map = new Map();
    for (const p of pts) {
      const key = vary === "x" ? p.x : p.y;
      map.set(key, { x: p.x, y: p.y });
    }
    for (const e of extras) {
      if (vary === "x") map.set(e, { x: e, y: fixed });
      else map.set(e, { x: fixed, y: e });
    }
    const keys = [...map.keys()].sort((a, b) => a - b);
    return keys.map((k) => /** @type {{x:number,y:number}} */ (map.get(k)));
  }

  const minX = snapMm(mapping.minX);
  const maxX = snapMm(mapping.maxX);
  const minY = snapMm(mapping.minY);
  const maxY = snapMm(mapping.maxY);

  return {
    south: mergeSide(bottomOuter.south, "x", rasterXs, minY),
    north: mergeSide(bottomOuter.north, "x", rasterXs, maxY),
    west: mergeSide(bottomOuter.west, "y", rasterYs, minX),
    east: mergeSide(bottomOuter.east, "y", rasterYs, maxX),
  };
}

/**
 * @param {ReturnType<typeof createRasterMapping>} mapping
 * @param {number} x
 * @param {number} y
 * @param {Float64Array | ArrayLike<number>} tops
 */
function sampleTopAtXy(mapping, x, y, tops) {
  const col = Math.min(
    mapping.width - 1,
    Math.max(0, Math.floor((x - mapping.minX) / mapping.cellWidthMm + 1e-12)),
  );
  const row = Math.min(
    mapping.height - 1,
    Math.max(0, Math.floor((mapping.maxY - y) / mapping.cellHeightMm + 1e-12)),
  );
  return tops[row * mapping.width + col];
}

/**
 * @param {ReturnType<typeof createRasterMapping>} mapping
 * @param {number} x
 * @param {number} y
 * @param {Uint8Array | ArrayLike<number>} indices
 */
function sampleIndexAtXy(mapping, x, y, indices) {
  const col = Math.min(
    mapping.width - 1,
    Math.max(0, Math.floor((x - mapping.minX) / mapping.cellWidthMm + 1e-12)),
  );
  const row = Math.min(
    mapping.height - 1,
    Math.max(0, Math.floor((mapping.maxY - y) / mapping.cellHeightMm + 1e-12)),
  );
  return indices[row * mapping.width + col];
}

/**
 * @param {import("./mesh.js").GrowableMesh} mesh
 * @param {ReturnType<import("./mesh.js").createVertexDeduper>} v
 * @param {ReturnType<typeof augmentPerimeterWithRaster>} peri
 * @param {number} zBottom
 * @param {ReturnType<typeof createRasterMapping>} mapping
 * @param {Float64Array | ArrayLike<number>} tops
 */
function addVariableOuterWalls(mesh, v, peri, zBottom, mapping, tops) {
  /**
   * @param {number} a
   * @param {number} b
   * @param {number} c
   * @param {number} d
   * @param {boolean} flip
   */
  function wallQuad(a, b, c, d, flip) {
    if (flip) addQuad(mesh, a, b, c, d);
    else addQuad(mesh, a, d, c, b);
  }

  /**
   * Emit a south/north/west/east wall segment from zBottom to zTop.
   * When an endpoint neighbors a lower wall, include that height on the shared
   * vertical only (triangulated) so the step edge is manifold without a ledge.
   *
   * @param {Array<{x:number,y:number}>} poly
   * @param {boolean} flip
   * @param {"south" | "north" | "west" | "east"} side
   */
  function wallStrip(poly, flip, side) {
    /** @type {number[]} */
    const segTops = [];
    for (let i = 0; i < poly.length - 1; i += 1) {
      const p0 = poly[i];
      const p1 = poly[i + 1];
      if (p0.x === p1.x && p0.y === p1.y) {
        segTops.push(segTops.length ? segTops[segTops.length - 1] : RELIEF.maxTopZMm);
        continue;
      }
      const mx = (p0.x + p1.x) / 2;
      const my = (p0.y + p1.y) / 2;
      let sx = mx;
      let sy = my;
      const inset = Math.min(mapping.cellWidthMm, mapping.cellHeightMm) * 0.25;
      if (side === "south") sy += inset;
      else if (side === "north") sy -= inset;
      else if (side === "west") sx += inset;
      else sx -= inset;
      segTops.push(snapMm(sampleTopAtXy(mapping, sx, sy, tops)));
    }

    for (let i = 0; i < poly.length - 1; i += 1) {
      const p0 = poly[i];
      const p1 = poly[i + 1];
      if (p0.x === p1.x && p0.y === p1.y) continue;
      const zTop = segTops[i];
      const zPrev = i > 0 ? segTops[i - 1] : zTop;
      const zNext = i + 1 < segTops.length ? segTops[i + 1] : zTop;
      const z0 = snapMm(zBottom);
      const z1 = snapMm(zTop);
      const b0 = v.get(p0.x, p0.y, z0);
      const b1 = v.get(p1.x, p1.y, z0);
      const t0 = v.get(p0.x, p0.y, z1);
      const t1 = v.get(p1.x, p1.y, z1);

      const lowAt0 = zPrev < z1 - 1e-12 ? snapMm(zPrev) : null;
      const lowAt1 = zNext < z1 - 1e-12 ? snapMm(zNext) : null;

      if (lowAt0 == null && lowAt1 == null) {
        wallQuad(b0, b1, t1, t0, flip);
        continue;
      }

      // Triangulate so intermediate heights exist only on the shared endpoint.
      if (lowAt0 != null && lowAt1 == null) {
        const m0 = v.get(p0.x, p0.y, lowAt0);
        if (flip) {
          addTriangle(mesh, b0, b1, m0);
          addTriangle(mesh, m0, b1, t1);
          addTriangle(mesh, m0, t1, t0);
        } else {
          addTriangle(mesh, b0, m0, b1);
          addTriangle(mesh, m0, t1, b1);
          addTriangle(mesh, m0, t0, t1);
        }
      } else if (lowAt1 != null && lowAt0 == null) {
        const m1 = v.get(p1.x, p1.y, lowAt1);
        if (flip) {
          addTriangle(mesh, b0, b1, m1);
          addTriangle(mesh, b0, m1, t0);
          addTriangle(mesh, t0, m1, t1);
        } else {
          addTriangle(mesh, b0, m1, b1);
          addTriangle(mesh, b0, t0, m1);
          addTriangle(mesh, t0, t1, m1);
        }
      } else {
        const m0 = v.get(p0.x, p0.y, /** @type {number} */ (lowAt0));
        const m1 = v.get(p1.x, p1.y, /** @type {number} */ (lowAt1));
        if (flip) {
          addTriangle(mesh, b0, b1, m1);
          addTriangle(mesh, b0, m1, m0);
          addTriangle(mesh, m0, m1, t1);
          addTriangle(mesh, m0, t1, t0);
        } else {
          addTriangle(mesh, b0, m1, b1);
          addTriangle(mesh, b0, m0, m1);
          addTriangle(mesh, m0, t1, m1);
          addTriangle(mesh, m0, t0, t1);
        }
      }
    }
  }

  wallStrip(peri.south, true, "south");
  wallStrip(peri.north, false, "north");
  wallStrip(peri.west, false, "west");
  wallStrip(peri.east, true, "east");
}

/**
 * Variable top + step walls with deterministic saddle resolution.
 *
 * Ambiguous 2×2 saddles use preferred-diagonal sector tags so opposite step
 * walls do not share one undirected center edge. Multi-height T-junctions
 * (3+ distinct tops) and other non-binary caps merge equal-height adjacent
 * roles and close hanging vertical edges with an offset-apex fan.
 *
 * @param {import("./mesh.js").GrowableMesh} mesh
 * @param {ReturnType<import("./mesh.js").createVertexDeduper>} v
 * @param {ReturnType<typeof createRasterMapping>} mapping
 * @param {Float64Array | ArrayLike<number>} tops
 * @param {Uint8Array | ArrayLike<number>} indices
 * @param {ReturnType<typeof augmentPerimeterWithRaster>} peri
 * @param {"full" | "ambiguous-only"} [junctionCapMode]
 */
function addReliefTopSurface(mesh, v, mapping, tops, indices, peri, junctionCapMode = "full") {
  /** @type {number[]} */
  const xs = [];
  /** @type {number[]} */
  const ys = [];
  for (let c = 0; c <= mapping.width; c += 1) xs.push(snapMm(pixelLeftX(mapping, c)));
  for (let r = 0; r <= mapping.height; r += 1) ys.push(snapMm(pixelTopY(mapping, r)));
  for (const p of peri.south) xs.push(p.x);
  for (const p of peri.north) xs.push(p.x);
  for (const p of peri.west) ys.push(p.y);
  for (const p of peri.east) ys.push(p.y);
  const uniqX = [...new Set(xs)].sort((a, b) => a - b);
  const uniqY = [...new Set(ys)].sort((a, b) => a - b);

  /**
   * @param {number} x0
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   */
  function cellTop(x0, y0, x1, y1) {
    return snapMm(sampleTopAtXy(mapping, (x0 + x1) / 2, (y0 + y1) / 2, tops));
  }

  /**
   * @param {number} x0
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   */
  function cellIndex(x0, y0, x1, y1) {
    return sampleIndexAtXy(mapping, (x0 + x1) / 2, (y0 + y1) / 2, indices);
  }

  /** @type {number[][]} */
  const zGrid = [];
  /** @type {number[][]} */
  const iGrid = [];
  for (let ix = 0; ix < uniqX.length - 1; ix += 1) {
    /** @type {number[]} */
    const zCol = [];
    /** @type {number[]} */
    const iCol = [];
    for (let iy = 0; iy < uniqY.length - 1; iy += 1) {
      zCol.push(cellTop(uniqX[ix], uniqY[iy], uniqX[ix + 1], uniqY[iy + 1]));
      iCol.push(cellIndex(uniqX[ix], uniqY[iy], uniqX[ix + 1], uniqY[iy + 1]));
    }
    zGrid.push(zCol);
    iGrid.push(iCol);
  }

  /**
   * @param {number} gx
   * @param {number} gy
   */
  function junctionAt(gx, gy) {
    if (gx <= 0 || gy <= 0 || gx >= uniqX.length - 1 || gy >= uniqY.length - 1) {
      return null;
    }
    const zSW = zGrid[gx - 1][gy - 1];
    const zSE = zGrid[gx][gy - 1];
    const zNW = zGrid[gx - 1][gy];
    const zNE = zGrid[gx][gy];
    const needsCap = junctionCapMode === "ambiguous-only"
      ? isAmbiguousReliefJunction(zSW, zSE, zNW, zNE)
      : needsReliefJunctionCap(zSW, zSE, zNW, zNE);
    if (!needsCap) return null;
    const diag = chooseReliefDiagonal(
      zSW,
      zSE,
      zNW,
      zNE,
      iGrid[gx - 1][gy - 1],
      iGrid[gx][gy - 1],
      iGrid[gx - 1][gy],
      iGrid[gx][gy],
    );
    return { gx, gy, diag, zSW, zSE, zNW, zNE };
  }

  /**
   * @param {NonNullable<ReturnType<typeof junctionAt>>} junc
   */
  function isBinaryLikeJunction(junc) {
    const { diag, zSW, zSE, zNW, zNE } = junc;
    const zPrefA = diag === "nwse" ? zNW : zNE;
    const zPrefB = diag === "nwse" ? zSE : zSW;
    const zOtherA = diag === "nwse" ? zNE : zNW;
    const zOtherB = diag === "nwse" ? zSW : zSE;
    return Math.abs(zPrefA - zPrefB) <= HEIGHT_EPS
      && Math.abs(zOtherA - zOtherB) <= HEIGHT_EPS;
  }

  /**
   * @param {NonNullable<ReturnType<typeof junctionAt>>} junc
   * @param {"nw" | "ne" | "sw" | "se"} role
   */
  function sectorTagForRole(junc, role) {
    if (isBinaryLikeJunction(junc)) {
      return junctionSectorTag(role, junc.diag, true);
    }
    const groups = mergeEqualHeightRoles(junc.zSW, junc.zSE, junc.zNW, junc.zNE);
    for (const g of groups) {
      if (g.roles.includes(role)) return g.tag;
    }
    return role;
  }

  function cellCornerVert(ix, iy, cx, cy, z) {
    const zs = snapMm(z);
    const junc = junctionAt(cx, cy);
    if (!junc) return v.get(uniqX[cx], uniqY[cy], zs);
    /** @type {"nw" | "ne" | "sw" | "se" | null} */
    let role = null;
    if (ix === cx - 1 && iy === cy - 1) role = "sw";
    else if (ix === cx && iy === cy - 1) role = "se";
    else if (ix === cx - 1 && iy === cy) role = "nw";
    else if (ix === cx && iy === cy) role = "ne";
    if (!role) return v.get(uniqX[cx], uniqY[cy], zs);
    // Binary-like: opposite walls share the preferred-diagonal tag.
    // Multi-height: equal-height adjacent roles share a group tag; fan closes gaps.
    const tag = `J${cx},${cy}:${sectorTagForRole(junc, role)}`;
    return v.get(uniqX[cx], uniqY[cy], zs, tag);
  }

  function emitNonBinaryJunction(junc) {
    const { gx, gy, diag, zSW, zSE, zNW, zNE } = junc;
    const Jx = uniqX[gx];
    const Jy = uniqY[gy];
    const cellW = Math.min(uniqX[gx] - uniqX[gx - 1], uniqX[gx + 1] - uniqX[gx]);
    const cellH = Math.min(uniqY[gy] - uniqY[gy - 1], uniqY[gy + 1] - uniqY[gy]);
    const eps = Math.min(cellW, cellH) * 0.12;
    if (eps < 1e-9) return;
    const tag = `BR${gx},${gy}`;
    const ox = diag === "nwse" ? -eps : eps;
    const oy = eps;
    const ax = snapMm(Jx + ox);
    const ay = snapMm(Jy + oy);

    const groups = mergeEqualHeightRoles(zSW, zSE, zNW, zNE);
    if (groups.length < 2) return;

    /**
     * @param {string} groupTag
     * @param {number} z
     */
    function gv(groupTag, z) {
      return v.get(Jx, Jy, snapMm(z), `J${gx},${gy}:${groupTag}`);
    }
    /**
     * @param {number} z
     */
    function ap(z) {
      return v.get(ax, ay, snapMm(z), tag);
    }

    const zMid = snapMm(
      (Math.min(zSW, zSE, zNW, zNE) + Math.max(zSW, zSE, zNW, zNE)) / 2,
    );
    const apex = ap(zMid);
    for (let i = 0; i < groups.length; i += 1) {
      const a = groups[i];
      const b = groups[(i + 1) % groups.length];
      if (reliefHeightKey(a.z) === reliefHeightKey(b.z)) continue;
      const va = gv(a.tag, a.z);
      const vb = gv(b.tag, b.z);
      if (va === vb || va === apex || vb === apex) continue;
      // Fan triangle; consecutive groups share apex→group edges with opposite winding.
      addTriangle(mesh, apex, va, vb);
    }
  }

  /** @type {Array<NonNullable<ReturnType<typeof junctionAt>>>} */
  const ambiguous = [];
  for (let gx = 1; gx < uniqX.length - 1; gx += 1) {
    for (let gy = 1; gy < uniqY.length - 1; gy += 1) {
      const j = junctionAt(gx, gy);
      if (j) ambiguous.push(j);
    }
  }

  for (let ix = 0; ix < uniqX.length - 1; ix += 1) {
    for (let iy = 0; iy < uniqY.length - 1; iy += 1) {
      const z = zGrid[ix][iy];
      const a = cellCornerVert(ix, iy, ix, iy, z);
      const b = cellCornerVert(ix, iy, ix + 1, iy, z);
      const c = cellCornerVert(ix, iy, ix + 1, iy + 1, z);
      const d = cellCornerVert(ix, iy, ix, iy + 1, z);
      addQuad(mesh, a, b, c, d);

      if (ix + 1 < uniqX.length - 1) {
        const zR = zGrid[ix + 1][iy];
        if (z > zR + HEIGHT_EPS) {
          const a0 = cellCornerVert(ix + 1, iy, ix + 1, iy, zR);
          const b0 = cellCornerVert(ix + 1, iy, ix + 1, iy + 1, zR);
          const c0 = cellCornerVert(ix, iy, ix + 1, iy + 1, z);
          const d0 = cellCornerVert(ix, iy, ix + 1, iy, z);
          addQuad(mesh, a0, b0, c0, d0);
        } else if (zR > z + HEIGHT_EPS) {
          const a0 = cellCornerVert(ix, iy, ix + 1, iy, z);
          const b0 = cellCornerVert(ix, iy, ix + 1, iy + 1, z);
          const c0 = cellCornerVert(ix + 1, iy, ix + 1, iy + 1, zR);
          const d0 = cellCornerVert(ix + 1, iy, ix + 1, iy, zR);
          addQuad(mesh, a0, d0, c0, b0);
        }
      }
      if (iy + 1 < uniqY.length - 1) {
        const zU = zGrid[ix][iy + 1];
        if (z > zU + HEIGHT_EPS) {
          const a0 = cellCornerVert(ix, iy + 1, ix, iy + 1, zU);
          const b0 = cellCornerVert(ix, iy + 1, ix + 1, iy + 1, zU);
          const c0 = cellCornerVert(ix, iy, ix + 1, iy + 1, z);
          const d0 = cellCornerVert(ix, iy, ix, iy + 1, z);
          addQuad(mesh, a0, d0, c0, b0);
        } else if (zU > z + HEIGHT_EPS) {
          const a0 = cellCornerVert(ix, iy, ix, iy + 1, z);
          const b0 = cellCornerVert(ix, iy, ix + 1, iy + 1, z);
          const c0 = cellCornerVert(ix, iy + 1, ix + 1, iy + 1, zU);
          const d0 = cellCornerVert(ix, iy + 1, ix, iy + 1, zU);
          addQuad(mesh, a0, b0, c0, d0);
        }
      }
    }
  }

  for (const junc of ambiguous) {
    if (!isBinaryLikeJunction(junc)) emitNonBinaryJunction(junc);
  }
}

/**
 * Split bottom-face edges so every augmented perimeter point exists on the
 * outer boundary (prevents T-junctions with variable outer walls).
 *
 * @param {import("./mesh.js").GrowableMesh} mesh
 * @param {ReturnType<import("./mesh.js").createVertexDeduper>} v
 * @param {ReturnType<typeof augmentPerimeterWithRaster>} peri
 * @param {number} zBottom
 */
function stitchBottomPerimeterPoints(mesh, v, peri, zBottom) {
  const z = zBottom;
  /** @type {Array<{ x: number, y: number }>} */
  const points = [];
  for (const side of [peri.south, peri.north, peri.west, peri.east]) {
    for (const p of side) points.push(p);
  }

  /**
   * @param {number} ax
   * @param {number} ay
   * @param {number} bx
   * @param {number} by
   * @param {number} px
   * @param {number} py
   */
  function liesInterior(ax, ay, bx, by, px, py) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const cross = abx * apy - aby * apx;
    if (Math.abs(cross) > 1e-8) return false;
    const dot = apx * abx + apy * aby;
    if (dot <= 1e-12) return false;
    const ab2 = abx * abx + aby * aby;
    if (dot >= ab2 - 1e-12) return false;
    return true;
  }

  for (const p of points) {
    const pIdx = v.get(p.x, p.y, z);
    let guard = 0;
    let split = true;
    while (split && guard < 8) {
      guard += 1;
      split = false;
      const tris = mesh.triangles;
      for (let t = 0; t < tris.length; t += 3) {
        const ids = [tris[t], tris[t + 1], tris[t + 2]];
        for (let e = 0; e < 3; e += 1) {
          const ia = ids[e];
          const ib = ids[(e + 1) % 3];
          const ic = ids[(e + 2) % 3];
          if (ia === pIdx || ib === pIdx) continue;
          const ax = mesh.positions[ia * 3];
          const ay = mesh.positions[ia * 3 + 1];
          const az = mesh.positions[ia * 3 + 2];
          const bx = mesh.positions[ib * 3];
          const by = mesh.positions[ib * 3 + 1];
          const bz = mesh.positions[ib * 3 + 2];
          if (Math.abs(az - z) > 1e-12 || Math.abs(bz - z) > 1e-12) continue;
          if (!liesInterior(ax, ay, bx, by, p.x, p.y)) continue;
          // Replace triangle (ia,ib,ic) with (ia,p,ic) and (p,ib,ic)
          tris[t] = ia;
          tris[t + 1] = pIdx;
          tris[t + 2] = ic;
          mesh.triangles.push(pIdx, ib, ic);
          split = true;
          break;
        }
        if (split) break;
      }
    }
  }
}

/**
 * Combined one-color relief solid: base + magnets + variable top.
 *
 * @param {object} opts
 * @param {Uint8Array | ArrayLike<number>} opts.indices
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {Map<number, number>} opts.topHeightByPaletteIndex
 * @param {number} [opts.segments]
 * @param {typeof TILE_V1} [opts.tile]
 * @param {"full" | "ambiguous-only"} [opts.junctionCapMode]
 *   Use `ambiguous-only` only to reproduce pre-6.2.3 multi-height T-junction failures.
 * @returns {import("./mesh.js").PackedMesh}
 */
export function generateCombinedReliefTileMesh(opts) {
  const tile = opts.tile || TILE_V1;
  const width = opts.width;
  const height = opts.height;
  const junctionCapMode = opts.junctionCapMode === "ambiguous-only"
    ? "ambiguous-only"
    : "full";
  const tops = buildCellTopHeights(
    opts.indices,
    width,
    height,
    opts.topHeightByPaletteIndex,
  );

  let maxSeen = -Infinity;
  for (let i = 0; i < tops.length; i += 1) {
    if (tops[i] > maxSeen) maxSeen = tops[i];
  }
  if (maxSeen < RELIEF.maxTopZMm - 1e-9) {
    throw new Error("relief combined mesh requires a cell at maxTopZMm");
  }

  const shell = buildCombinedTileOpenShell({
    tile,
    segments: opts.segments,
  });
  const { mesh, vertexDeduper: v, bottomOuter, zBottom } = shell;
  const mapping = createRasterMapping(width, height, tile);
  const peri = augmentPerimeterWithRaster(bottomOuter, mapping);

  stitchBottomPerimeterPoints(mesh, v, peri, zBottom);
  addVariableOuterWalls(mesh, v, peri, zBottom, mapping, tops);
  addReliefTopSurface(mesh, v, mapping, tops, opts.indices, peri, junctionCapMode);

  return packMesh(mesh);
}

/**
 * @param {Float64Array | ArrayLike<number>} tops
 * @param {number} width
 * @param {number} height
 */
export function countInteriorStepWallQuads(tops, width, height) {
  let quads = 0;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const z = tops[row * width + col];
      if (col + 1 < width) {
        const zR = tops[row * width + col + 1];
        if (Math.abs(z - zR) > 1e-12) quads += 1;
      }
      if (row + 1 < height) {
        const zD = tops[(row + 1) * width + col];
        if (Math.abs(z - zD) > 1e-12) quads += 1;
      }
    }
  }
  return quads;
}
