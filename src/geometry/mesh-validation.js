/**
 * Structural mesh validation (Milestone 4+ / 6.2.1).
 */

import { computeBounds, signedVolume, triangleArea, ZERO_AREA_EPSILON } from "./mesh-math.js";
import { triangleCount, vertexCount } from "./mesh.js";
import { TILE_V1 } from "./tile-spec.js";

/**
 * @typedef {object} MeshValidationOptions
 * @property {{ minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number }} [bounds]
 * @property {number} [boundsEpsilon]
 * @property {boolean} [requireClosed]
 * @property {boolean} [requirePositiveVolume]
 * @property {number} [minAbsVolume]
 * @property {string} [objectName]
 * @property {{ col: number, row: number }} [rasterCell]
 * @property {boolean} [rejectDuplicateTriangles]
 * @property {boolean} [checkWindingConsistency]
 */

/**
 * Count undirected edge incidences.
 * @param {{ triangles: ArrayLike<number> }} mesh
 * @returns {Map<string, number>}
 */
export function countUndirectedEdges(mesh) {
  /** @type {Map<string, number>} */
  const edges = new Map();
  const tris = mesh.triangles;
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i];
    const b = tris[i + 1];
    const c = tris[i + 2];
    bumpEdge(edges, a, b);
    bumpEdge(edges, b, c);
    bumpEdge(edges, c, a);
  }
  return edges;
}

/**
 * @param {Map<string, number>} edges
 * @param {number} i
 * @param {number} j
 */
function bumpEdge(edges, i, j) {
  const key = i < j ? `${i}|${j}` : `${j}|${i}`;
  edges.set(key, (edges.get(key) || 0) + 1);
}

/**
 * Classify undirected edges by incidence count.
 * Closed manifold surfaces: every edge appears exactly twice.
 * @param {{ triangles: ArrayLike<number> }} mesh
 * @returns {{
 *   edgeCount: number,
 *   boundaryEdges: number,
 *   manifoldEdges: number,
 *   nonManifoldEdges: number,
 *   incidenceHistogram: Record<string, number>
 * }}
 */
export function classifyBoundaryEdges(mesh) {
  const edges = countUndirectedEdges(mesh);
  let boundaryEdges = 0;
  let manifoldEdges = 0;
  let nonManifoldEdges = 0;
  /** @type {Record<string, number>} */
  const incidenceHistogram = {};
  for (const count of edges.values()) {
    const key = String(count);
    incidenceHistogram[key] = (incidenceHistogram[key] || 0) + 1;
    if (count === 1) boundaryEdges += 1;
    else if (count === 2) manifoldEdges += 1;
    else nonManifoldEdges += 1;
  }
  return {
    edgeCount: edges.size,
    boundaryEdges,
    manifoldEdges,
    nonManifoldEdges,
    incidenceHistogram,
  };
}

/**
 * Detailed report for offending edges (incidence ≠ 2).
 * @param {{ positions: ArrayLike<number>, triangles: ArrayLike<number> }} mesh
 * @param {number} [limit]
 * @returns {Array<{
 *   key: string,
 *   incidence: number,
 *   vertexIds: [number, number],
 *   coordinates: [{x:number,y:number,z:number},{x:number,y:number,z:number}],
 *   triangleIds: number[]
 * }>}
 */
export function findAllBadEdges(mesh, limit = 8) {
  const edges = countUndirectedEdges(mesh);
  const pos = mesh.positions;
  const tris = mesh.triangles;
  /** @type {Array<{
   *   key: string,
   *   incidence: number,
   *   vertexIds: [number, number],
   *   coordinates: [{x:number,y:number,z:number},{x:number,y:number,z:number}],
   *   triangleIds: number[]
   * }>} */
  const bad = [];
  for (const [key, count] of edges) {
    if (count === 2) continue;
    const [ia, ib] = key.split("|").map(Number);
    /** @type {number[]} */
    const triangleIds = [];
    for (let t = 0; t < tris.length; t += 3) {
      const ids = [tris[t], tris[t + 1], tris[t + 2]];
      if (ids.includes(ia) && ids.includes(ib)) triangleIds.push(t / 3);
    }
    bad.push({
      key,
      incidence: count,
      vertexIds: /** @type {[number, number]} */ ([ia, ib]),
      coordinates: [
        { x: pos[ia * 3], y: pos[ia * 3 + 1], z: pos[ia * 3 + 2] },
        { x: pos[ib * 3], y: pos[ib * 3 + 1], z: pos[ib * 3 + 2] },
      ],
      triangleIds,
    });
    if (bad.length >= limit) break;
  }
  return bad;
}

/**
 * Detailed report for the first offending edge (incidence ≠ 2).
 * @param {{ positions: ArrayLike<number>, triangles: ArrayLike<number> }} mesh
 */
export function findFirstBadEdge(mesh) {
  const all = findAllBadEdges(mesh, 1);
  return all.length ? all[0] : null;
}

/**
 * Count duplicate triangles (same three vertex indices, any winding).
 * @param {{ triangles: ArrayLike<number> }} mesh
 */
export function countDuplicateTriangles(mesh) {
  const tris = mesh.triangles;
  /** @type {Set<string>} */
  const seen = new Set();
  let dupes = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const key = [tris[i], tris[i + 1], tris[i + 2]].slice().sort((a, b) => a - b).join("|");
    if (seen.has(key)) dupes += 1;
    else seen.add(key);
  }
  return dupes;
}

/**
 * User-facing primary validation message (plain language).
 * @param {string[]} reasons
 */
export function plainGeometryFailureMessage(reasons) {
  const text = (reasons || []).join(" ");
  if (/color\[\d+\]/.test(text) && /closed manifold|nonManifold|boundary|duplicate triangle|winding/i.test(text)) {
    return "The model could not be built. One color contains an invalid surface.";
  }
  if (/combined|base/.test(text) && /closed manifold|nonManifold|boundary/i.test(text)) {
    return "The model could not be built. The tile surface is invalid.";
  }
  return "The model could not be built.";
}

/**
 * Technical disclosure text for geometry validation failures.
 * @param {object} opts
 * @param {string[]} opts.reasons
 * @param {{
 *   combined?: object,
 *   base?: object,
 *   colors?: object[]
 * }} [opts.validation]
 */
export function formatGeometryTechnicalDetails(opts) {
  /** @type {string[]} */
  const lines = [];
  const reasons = opts.reasons || [];
  if (reasons.length) {
    lines.push("Reasons:");
    for (const r of reasons) lines.push(`- ${r}`);
  }
  const validation = opts.validation || {};
  /** @type {Array<object>} */
  const objects = [];
  if (validation.combined) objects.push({ ...validation.combined, _name: "combined" });
  if (validation.base) objects.push({ ...validation.base, _name: "base" });
  if (Array.isArray(validation.colors)) {
    validation.colors.forEach((v, i) => {
      if (v) {
        const name = (v.objectName) || `color[${i}]`;
        objects.push({ ...v, _name: name });
      }
    });
  }
  for (const v of objects) {
    if (!v || v.ok) continue;
    const name = v._name || "object";
    const edge = v.edgeSummary || { boundaryEdges: 0, nonManifoldEdges: 0 };
    const dupes = v.duplicateTriangles != null ? v.duplicateTriangles : 0;
    lines.push("");
    lines.push(`Object: ${name}`);
    lines.push(`Boundary-edge count: ${edge.boundaryEdges}`);
    lines.push(`Non-manifold-edge count: ${edge.nonManifoldEdges}`);
    lines.push(`Duplicate-triangle count: ${dupes}`);
    const badEdges = v.badEdges || (v.badEdge ? [v.badEdge] : []);
    if (badEdges.length) {
      lines.push("Offending edges:");
      for (const e of badEdges.slice(0, 6)) {
        if (!e) continue;
        const [c0, c1] = e.coordinates;
        lines.push(
          `  verts=${e.vertexIds.join("|")} incidence=${e.incidence}`
          + ` (${c0.x},${c0.y},${c0.z})-(${c1.x},${c1.y},${c1.z})`
          + ` tris=[${e.triangleIds.join(",")}]`,
        );
      }
    }
  }
  return lines.join("\n");
}

/**
 * @param {string} [objectName]
 * @param {{ col: number, row: number }} [rasterCell]
 */
function contextPrefix(objectName, rasterCell) {
  /** @type {string[]} */
  const parts = [];
  if (objectName) parts.push(`object=${objectName}`);
  if (rasterCell) parts.push(`cell=(${rasterCell.col},${rasterCell.row})`);
  return parts.length ? `${parts.join(" ")}: ` : "";
}

/**
 * Validate a mesh structurally.
 * @param {{ positions: ArrayLike<number>, triangles: ArrayLike<number> }} mesh
 * @param {MeshValidationOptions} [options]
 * @returns {{
 *   ok: boolean,
 *   reasons: string[],
 *   vertexCount: number,
 *   triangleCount: number,
 *   bounds: ReturnType<typeof computeBounds>,
 *   signedVolume: number,
 *   edgeSummary: ReturnType<typeof classifyBoundaryEdges>,
 *   badEdge: ReturnType<typeof findFirstBadEdge>,
 *   badEdges: ReturnType<typeof findAllBadEdges>,
 *   duplicateTriangles: number,
 *   objectName: string | null
 * }}
 */
export function validateMesh(mesh, options = {}) {
  /** @type {string[]} */
  const reasons = [];
  const prefix = contextPrefix(options.objectName, options.rasterCell);
  const vCount = vertexCount(mesh);
  const tCount = triangleCount(mesh);
  const pos = mesh.positions;
  const tris = mesh.triangles;

  if (pos.length % 3 !== 0) {
    reasons.push(`${prefix}positions length must be a multiple of 3`);
  }
  if (tris.length % 3 !== 0) {
    reasons.push(`${prefix}triangles length must be a multiple of 3`);
  }
  if (tCount < 1) {
    reasons.push(`${prefix}mesh has no triangles`);
  }

  for (let i = 0; i < pos.length; i += 1) {
    if (!Number.isFinite(pos[i])) {
      reasons.push(`${prefix}non-finite coordinate`);
      break;
    }
  }

  /** @type {Set<string>} */
  const triKeys = new Set();
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i];
    const b = tris[i + 1];
    const c = tris[i + 2];
    if (
      !Number.isInteger(a)
      || !Number.isInteger(b)
      || !Number.isInteger(c)
      || a < 0
      || b < 0
      || c < 0
      || a >= vCount
      || b >= vCount
      || c >= vCount
    ) {
      reasons.push(`${prefix}triangle index out of range (tri=${i / 3})`);
      break;
    }
    if (a === b || b === c || a === c) {
      reasons.push(`${prefix}repeated vertex index within triangle (tri=${i / 3})`);
      break;
    }
    const a3 = a * 3;
    const b3 = b * 3;
    const c3 = c * 3;
    const area = triangleArea(
      pos[a3],
      pos[a3 + 1],
      pos[a3 + 2],
      pos[b3],
      pos[b3 + 1],
      pos[b3 + 2],
      pos[c3],
      pos[c3 + 1],
      pos[c3 + 2],
    );
    if (area <= ZERO_AREA_EPSILON) {
      reasons.push(`${prefix}zero-area triangle (tri=${i / 3}, verts=${a},${b},${c})`);
      break;
    }
    if (options.rejectDuplicateTriangles !== false) {
      const sorted = [a, b, c].sort((x, y) => x - y);
      const key = sorted.join("|");
      if (triKeys.has(key)) {
        reasons.push(`${prefix}duplicate triangle (tri=${i / 3}, verts=${sorted.join(",")})`);
        break;
      }
      triKeys.add(key);
    }
  }

  const bounds = computeBounds(mesh);
  const vol = signedVolume(mesh);
  const edgeSummary = classifyBoundaryEdges(mesh);
  const badEdges = findAllBadEdges(mesh);
  const badEdge = badEdges.length ? badEdges[0] : null;
  const duplicateTriangles = countDuplicateTriangles(mesh);

  const boundsEpsilon = options.boundsEpsilon ?? 1e-6;
  if (options.bounds) {
    const b = options.bounds;
    if (bounds.minX < b.minX - boundsEpsilon
      || bounds.maxX > b.maxX + boundsEpsilon
      || bounds.minY < b.minY - boundsEpsilon
      || bounds.maxY > b.maxY + boundsEpsilon
      || bounds.minZ < b.minZ - boundsEpsilon
      || bounds.maxZ > b.maxZ + boundsEpsilon) {
      reasons.push(`${prefix}mesh bounds outside expected envelope`);
    }
  }

  if (options.requireClosed) {
    if (edgeSummary.boundaryEdges !== 0 || edgeSummary.nonManifoldEdges !== 0) {
      let detail = `${prefix}mesh is not a closed manifold (boundary=${edgeSummary.boundaryEdges}, nonManifold=${edgeSummary.nonManifoldEdges})`;
      if (badEdge) {
        const [c0, c1] = badEdge.coordinates;
        detail += `; edge verts=${badEdge.vertexIds.join("|")} incidence=${badEdge.incidence}`
          + ` at (${c0.x},${c0.y},${c0.z})-(${c1.x},${c1.y},${c1.z})`
          + ` tris=[${badEdge.triangleIds.join(",")}]`;
      }
      reasons.push(detail);
    }
  }

  if (options.requirePositiveVolume) {
    const minAbs = options.minAbsVolume ?? ZERO_AREA_EPSILON;
    if (!(vol > minAbs)) {
      reasons.push(`${prefix}signed volume must be positive (got ${vol})`);
    }
  }

  if (options.checkWindingConsistency !== false && edgeSummary.boundaryEdges === 0 && edgeSummary.nonManifoldEdges === 0) {
    /** @type {Map<string, number>} */
    const oriented = new Map();
    for (let i = 0; i < tris.length; i += 3) {
      const ids = [tris[i], tris[i + 1], tris[i + 2]];
      for (let e = 0; e < 3; e += 1) {
        const a = ids[e];
        const b = ids[(e + 1) % 3];
        const key = `${a}>${b}`;
        oriented.set(key, (oriented.get(key) || 0) + 1);
      }
    }
    for (const [key, count] of oriented) {
      if (count !== 1) {
        const [a, b] = key.split(">").map(Number);
        const rev = oriented.get(`${b}>${a}`) || 0;
        if (count + rev !== 2 || count > 1) {
          reasons.push(
            `${prefix}inconsistent triangle winding on edge ${a}>${b} (fwd=${count}, rev=${rev})`,
          );
          break;
        }
      }
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    vertexCount: vCount,
    triangleCount: tCount,
    bounds,
    signedVolume: vol,
    edgeSummary,
    badEdge,
    badEdges,
    duplicateTriangles,
    objectName: options.objectName || null,
  };
}

/**
 * Validate against full Tile V1 envelope.
 * @param {{ positions: ArrayLike<number>, triangles: ArrayLike<number> }} mesh
 * @param {MeshValidationOptions} [options]
 */
export function validateTileEnvelopeMesh(mesh, options = {}) {
  return validateMesh(mesh, {
    bounds: TILE_V1.boundsMm,
    requireClosed: true,
    requirePositiveVolume: true,
    ...options,
  });
}
