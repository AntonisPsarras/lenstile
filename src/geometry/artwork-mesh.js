/**
 * Artwork mask → closed per-color meshes via boundary-face extrusion.
 *
 * Preferred approach (no internal coplanar faces between same-color cells):
 * - Top face per cell of the target palette index
 * - Bottom face per cell
 * - Vertical side faces only where the adjacent cell is outside the tile
 *   or belongs to a different palette index / component
 *
 * Disconnected 4-connected islands use separate vertex namespaces so
 * diagonally touching islands do not share indices.
 *
 * Within one 4-connected component, grid vertices are sector-scoped: cells that
 * only meet at a corner (diagonal contact) keep distinct vertex identities at
 * that XY so opposite wall fans do not create incidence-4 edges. Edge-adjacent
 * cells that share a grid vertex are unioned into one sector and share indices.
 *
 * Z range: artworkStartZMm … artworkEndZMm (3.0 … 4.0).
 */

import { TILE_V1 } from "./tile-spec.js";
import { createMesh, addTriangle, packMesh, mergeMeshes } from "./mesh.js";
import { createRasterMapping, pixelLeftX, pixelTopY } from "./raster-coords.js";
import { usedArtworkPaletteIndices } from "./magnet-backing.js";

const BOTTOM_Z_EPS = 1e-9;

/**
 * @typedef {object} ArtworkMeshResult
 * @property {number} paletteIndex
 * @property {import("./mesh.js").PackedMesh} mesh
 * @property {number} population
 */

/**
 * @param {Uint8Array | ArrayLike<number>} indices
 * @param {number} width
 * @param {number} height
 * @param {number} paletteIndex
 * @returns {Array<Array<{ col: number, row: number }>>}
 */
/**
 * @param {Uint8Array | ArrayLike<number>} indices
 * @param {number} width
 * @param {number} height
 * @param {number} paletteIndex
 * @param {Float64Array | null} bottomHeights
 * @returns {Array<Array<{ col: number, row: number }>>}
 */
function findColorComponents(indices, width, height, paletteIndex, bottomHeights = null) {
  const seen = new Uint8Array(width * height);
  /** @type {Array<Array<{ col: number, row: number }>>} */
  const components = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const start = row * width + col;
      if (indices[start] !== paletteIndex || seen[start]) continue;
      /** @type {Array<{ col: number, row: number }>} */
      const cells = [];
      /** @type {Array<{ col: number, row: number }>} */
      const stack = [{ col, row }];
      seen[start] = 1;
      const startBottom = bottomHeights ? bottomHeights[start] : null;
      while (stack.length) {
        const cell = stack.pop();
        cells.push(cell);
        for (const [dx, dy] of dirs) {
          const nc = cell.col + dx;
          const nr = cell.row + dy;
          if (nc < 0 || nr < 0 || nc >= width || nr >= height) continue;
          const ni = nr * width + nc;
          if (seen[ni] || indices[ni] !== paletteIndex) continue;
          // Split by artwork bottom Z so each component keeps a uniform zMin
          // (legacy variable-bottom path; Milestone 9.1 bottoms are uniform).
          if (bottomHeights && Math.abs(bottomHeights[ni] - /** @type {number} */ (startBottom)) > BOTTOM_Z_EPS) {
            continue;
          }
          seen[ni] = 1;
          stack.push({ col: nc, row: nr });
        }
      }
      components.push(cells);
    }
  }
  return components;
}

/**
 * Partition cells touching grid vertex (ix, iy) into manifold sectors.
 * Edge-adjacent occupants share a sector; diagonal-only occupants do not.
 *
 * @param {number} ix
 * @param {number} iy
 * @param {Set<string>} cellSet
 * @returns {Map<string, number>} cellKey → sector id
 */
export function vertexSectorsAt(ix, iy, cellSet) {
  /** @type {Array<{ col: number, row: number }>} */
  const cells = [];
  const candidates = [
    [ix - 1, iy - 1],
    [ix, iy - 1],
    [ix - 1, iy],
    [ix, iy],
  ];
  for (const [col, row] of candidates) {
    if (cellSet.has(`${col},${row}`)) cells.push({ col, row });
  }
  const parent = cells.map((_, i) => i);
  /**
   * @param {number} i
   */
  function find(i) {
    let x = i;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  /**
   * @param {number} i
   * @param {number} j
   */
  function union(i, j) {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  }
  for (let i = 0; i < cells.length; i += 1) {
    for (let j = i + 1; j < cells.length; j += 1) {
      const ac = cells[i];
      const bc = cells[j];
      if (Math.abs(ac.col - bc.col) + Math.abs(ac.row - bc.row) === 1) {
        union(i, j);
      }
    }
  }
  /** @type {Map<string, number>} */
  const map = new Map();
  for (let i = 0; i < cells.length; i += 1) {
    map.set(`${cells[i].col},${cells[i].row}`, find(i));
  }
  return map;
}

/**
 * @param {number} col
 * @param {number} row
 * @param {number} width
 * @param {number} uniformZMin
 * @param {Float64Array | null} bottomHeights
 */
function cellBottomZ(col, row, width, uniformZMin, bottomHeights) {
  if (!bottomHeights) return uniformZMin;
  return bottomHeights[row * width + col];
}

/**
 * @param {Uint8Array | ArrayLike<number>} indices
 * @param {number} width
 * @param {number} height
 * @param {number} paletteIndex
 * @param {Array<{ col: number, row: number }>} cells
 * @param {ReturnType<typeof createRasterMapping>} mapping
 * @param {number} zMin
 * @param {number} zMax
 * @param {"sector" | "grid"} vertexScope
 * @param {Float64Array | null} bottomHeights
 */
function meshComponent(
  indices,
  width,
  height,
  paletteIndex,
  cells,
  mapping,
  zMin,
  zMax,
  vertexScope,
  bottomHeights,
) {
  const mesh = createMesh();
  /** @type {Map<string, number>} */
  const vertexMap = new Map();
  /** @type {Set<string>} */
  const cellSet = new Set(cells.map((c) => `${c.col},${c.row}`));
  /** @type {Map<string, Map<string, number>>} */
  const sectorCache = new Map();
  const variableBottoms = Boolean(bottomHeights);

  /**
   * @param {number} ix
   * @param {number} iy
   */
  function sectorsFor(ix, iy) {
    const key = `${ix},${iy}`;
    let cached = sectorCache.get(key);
    if (!cached) {
      cached = vertexSectorsAt(ix, iy, cellSet);
      sectorCache.set(key, cached);
    }
    return cached;
  }

  /**
   * @param {number} ix
   * @param {number} iy
   * @param {number} z
   * @param {number} ownerCol
   * @param {number} ownerRow
   * @param {boolean} isBottom
   */
  function vertAtZ(ix, iy, z, ownerCol, ownerRow, isBottom) {
    let key;
    const zKey = Math.round(z * 1e6) / 1e6;
    if (vertexScope === "grid") {
      key = variableBottoms && isBottom
        ? `${ix},${iy},z${zKey}`
        : `${ix},${iy},${isBottom ? 0 : 1}`;
    } else {
      const sectors = sectorsFor(ix, iy);
      const sector = sectors.get(`${ownerCol},${ownerRow}`);
      if (sector === undefined) {
        throw new Error(`artwork vertex sector missing at (${ix},${iy}) for cell (${ownerCol},${ownerRow})`);
      }
      key = variableBottoms && isBottom
        ? `${ix},${iy},z${zKey},s${sector}`
        : `${ix},${iy},${isBottom ? 0 : 1},s${sector}`;
    }
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const x = pixelLeftX(mapping, ix);
    const y = pixelTopY(mapping, iy);
    const index = mesh.positions.length / 3;
    mesh.positions.push(x, y, z);
    vertexMap.set(key, index);
    return index;
  }

  /**
   * @param {number} ix
   * @param {number} iy
   * @param {0|1} iz
   * @param {number} ownerCol
   * @param {number} ownerRow
   */
  function vert(ix, iy, iz, ownerCol, ownerRow) {
    const z = iz === 0
      ? cellBottomZ(ownerCol, ownerRow, width, zMin, bottomHeights)
      : zMax;
    return vertAtZ(ix, iy, z, ownerCol, ownerRow, iz === 0);
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
  function sameComponent(col, row) {
    return cellSet.has(`${col},${row}`);
  }

  /**
   * Vertical step on a shared edge when the neighbor has a higher artwork bottom.
   * Emitted once from the lower cell so the solid stays closed without duplicates.
   *
   * @param {number} col
   * @param {number} row
   * @param {number} nc
   * @param {number} nr
   * @param {"n"|"s"|"w"|"e"} dir
   */
  function maybeBottomStep(col, row, nc, nr, dir) {
    if (!variableBottoms || !sameComponent(nc, nr)) return;
    const zSelf = cellBottomZ(col, row, width, zMin, bottomHeights);
    const zN = cellBottomZ(nc, nr, width, zMin, bottomHeights);
    if (!(zN > zSelf + BOTTOM_Z_EPS)) return;

    if (dir === "n") {
      const a = vertAtZ(col, row, zSelf, col, row, true);
      const b = vertAtZ(col + 1, row, zSelf, col, row, true);
      const c = vertAtZ(col + 1, row, zN, col, row, true);
      const d = vertAtZ(col, row, zN, col, row, true);
      quad(a, d, c, b);
    } else if (dir === "s") {
      const a = vertAtZ(col, row + 1, zSelf, col, row, true);
      const b = vertAtZ(col + 1, row + 1, zSelf, col, row, true);
      const c = vertAtZ(col + 1, row + 1, zN, col, row, true);
      const d = vertAtZ(col, row + 1, zN, col, row, true);
      quad(a, b, c, d);
    } else if (dir === "w") {
      const a = vertAtZ(col, row, zSelf, col, row, true);
      const b = vertAtZ(col, row + 1, zSelf, col, row, true);
      const c = vertAtZ(col, row + 1, zN, col, row, true);
      const d = vertAtZ(col, row, zN, col, row, true);
      quad(a, b, c, d);
    } else {
      const a = vertAtZ(col + 1, row, zSelf, col, row, true);
      const b = vertAtZ(col + 1, row + 1, zSelf, col, row, true);
      const c = vertAtZ(col + 1, row + 1, zN, col, row, true);
      const d = vertAtZ(col + 1, row, zN, col, row, true);
      quad(a, d, c, b);
    }
  }

  for (const { col, row } of cells) {
    {
      const a = vert(col, row, 1, col, row);
      const b = vert(col + 1, row, 1, col, row);
      const c = vert(col + 1, row + 1, 1, col, row);
      const d = vert(col, row + 1, 1, col, row);
      quad(a, d, c, b);
    }
    {
      const a = vert(col, row, 0, col, row);
      const b = vert(col + 1, row, 0, col, row);
      const c = vert(col + 1, row + 1, 0, col, row);
      const d = vert(col, row + 1, 0, col, row);
      quad(a, b, c, d);
    }

    if (!sameComponent(col, row - 1)) {
      const a = vert(col, row, 0, col, row);
      const b = vert(col + 1, row, 0, col, row);
      const c = vert(col + 1, row, 1, col, row);
      const d = vert(col, row, 1, col, row);
      quad(a, d, c, b);
    } else {
      maybeBottomStep(col, row, col, row - 1, "n");
    }
    if (!sameComponent(col, row + 1)) {
      const a = vert(col, row + 1, 0, col, row);
      const b = vert(col + 1, row + 1, 0, col, row);
      const c = vert(col + 1, row + 1, 1, col, row);
      const d = vert(col, row + 1, 1, col, row);
      quad(a, b, c, d);
    } else {
      maybeBottomStep(col, row, col, row + 1, "s");
    }
    if (!sameComponent(col - 1, row)) {
      const a = vert(col, row, 0, col, row);
      const b = vert(col, row + 1, 0, col, row);
      const c = vert(col, row + 1, 1, col, row);
      const d = vert(col, row, 1, col, row);
      quad(a, b, c, d);
    } else {
      maybeBottomStep(col, row, col - 1, row, "w");
    }
    if (!sameComponent(col + 1, row)) {
      const a = vert(col + 1, row, 0, col, row);
      const b = vert(col + 1, row + 1, 0, col, row);
      const c = vert(col + 1, row + 1, 1, col, row);
      const d = vert(col + 1, row, 1, col, row);
      quad(a, d, c, b);
    } else {
      maybeBottomStep(col, row, col + 1, row, "e");
    }
  }

  return mesh;
}

/**
 * Build a closed mesh for one palette index from a labeled raster.
 *
 * @param {Uint8Array | ArrayLike<number>} indices
 * @param {number} width
 * @param {number} height
 * @param {number} paletteIndex
 * @param {{
 *   zMin?: number,
 *   zMax?: number,
 *   tile?: typeof TILE_V1,
 *   vertexScope?: "sector" | "grid",
 *   bottomHeights?: Float64Array | null,
 * }} [options]
 * @returns {import("./mesh.js").PackedMesh | null} null when the index is unused
 */
export function buildArtworkColorMesh(indices, width, height, paletteIndex, options = {}) {
  const tile = options.tile || TILE_V1;
  const zMin = options.zMin ?? tile.artworkStartZMm;
  const zMax = options.zMax ?? tile.artworkEndZMm;
  const vertexScope = options.vertexScope === "grid" ? "grid" : "sector";
  const bottomHeights = options.bottomHeights || null;
  if (bottomHeights && bottomHeights.length !== width * height) {
    throw new Error("bottomHeights length must equal width × height");
  }
  if (!(zMax > zMin)) {
    throw new Error("artwork zMax must exceed zMin");
  }
  if (bottomHeights) {
    for (let i = 0; i < bottomHeights.length; i += 1) {
      if (!(zMax > bottomHeights[i] + BOTTOM_Z_EPS)) {
        throw new Error("artwork zMax must exceed every cell bottom Z");
      }
    }
  }

  const components = findColorComponents(indices, width, height, paletteIndex, bottomHeights);
  if (!components.length) return null;

  const mapping = createRasterMapping(width, height, tile);
  const parts = components.map((cells) => {
    const cellZMin = bottomHeights
      ? bottomHeights[cells[0].row * width + cells[0].col]
      : zMin;
    return meshComponent(
      indices,
      width,
      height,
      paletteIndex,
      cells,
      mapping,
      cellZMin,
      zMax,
      vertexScope,
      null, // uniform bottom within each bottom-Z component
    );
  });
  return packMesh(mergeMeshes(parts));
}

/**
 * Build one mesh per used palette index (ascending index order).
 * Unused indices produce no entry.
 *
 * @param {Uint8Array | ArrayLike<number>} indices
 * @param {number} width
 * @param {number} height
 * @param {{
 *   zMin?: number,
 *   zMax?: number,
 *   tile?: typeof TILE_V1,
 *   bottomHeights?: Float64Array | null,
 * }} [options]
 * @returns {ArtworkMeshResult[]}
 */
export function buildAllArtworkMeshes(indices, width, height, options = {}) {
  const used = usedArtworkPaletteIndices(indices);
  /** @type {ArtworkMeshResult[]} */
  const results = [];
  for (const paletteIndex of used) {
    const mesh = buildArtworkColorMesh(indices, width, height, paletteIndex, options);
    if (!mesh) continue;
    let population = 0;
    for (let i = 0; i < indices.length; i += 1) {
      if (indices[i] === paletteIndex) population += 1;
    }
    results.push({ paletteIndex, mesh, population });
  }
  return results;
}

/**
 * Artwork meshes with per-cell bottom Z (structural bridge support).
 * Milestone 9.1: every cell begins at the bridge top (Z = 3.0 mm).
 *
 * @param {Uint8Array | ArrayLike<number>} indices
 * @param {number} width
 * @param {number} height
 * @param {Float64Array} bottomHeights
 * @param {{ zMax?: number, tile?: typeof TILE_V1 }} [options]
 * @returns {ArtworkMeshResult[]}
 */
export function generateVariableBottomArtworkMesh(indices, width, height, bottomHeights, options = {}) {
  const tile = options.tile || TILE_V1;
  return buildAllArtworkMeshes(indices, width, height, {
    tile,
    zMin: tile.artworkStartZMm,
    zMax: options.zMax ?? tile.artworkEndZMm,
    bottomHeights,
  });
}

/**
 * True when the packed mesh stores more than one vertex id at any identical
 * XYZ coordinate (expected for corner-only contacts after sector scoping).
 * @param {import("./mesh.js").Mesh} mesh
 */
export function countCoincidentVertexGroups(mesh) {
  const pos = mesh.positions;
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (let i = 0; i < pos.length; i += 3) {
    const key = `${pos[i]},${pos[i + 1]},${pos[i + 2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let groups = 0;
  for (const n of counts.values()) {
    if (n > 1) groups += 1;
  }
  return groups;
}
