/**
 * Dependency-free indexed mesh representation.
 *
 * {
 *   positions: number[] | Float64Array, // flat xyz
 *   triangles: number[] | Uint32Array   // flat index triples
 * }
 *
 * Prefer growable number[] during construction, then packMesh().
 * No global mutable mesh state.
 */

/**
 * @typedef {{ positions: number[], triangles: number[] }} GrowableMesh
 * @typedef {{ positions: Float64Array, triangles: Uint32Array }} PackedMesh
 * @typedef {GrowableMesh | PackedMesh} Mesh
 */

/**
 * @returns {GrowableMesh}
 */
export function createMesh() {
  return {
    positions: [],
    triangles: [],
  };
}

/**
 * Append a vertex and return its index.
 * @param {GrowableMesh} mesh
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number}
 */
export function addVertex(mesh, x, y, z) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error("addVertex requires finite coordinates");
  }
  const index = mesh.positions.length / 3;
  mesh.positions.push(x, y, z);
  return index;
}

/**
 * Append a triangle by vertex indices (CCW = outward for solids).
 * @param {GrowableMesh} mesh
 * @param {number} i0
 * @param {number} i1
 * @param {number} i2
 */
export function addTriangle(mesh, i0, i1, i2) {
  const vertexCount = mesh.positions.length / 3;
  if (
    !Number.isInteger(i0)
    || !Number.isInteger(i1)
    || !Number.isInteger(i2)
    || i0 < 0
    || i1 < 0
    || i2 < 0
    || i0 >= vertexCount
    || i1 >= vertexCount
    || i2 >= vertexCount
  ) {
    throw new Error("addTriangle: vertex index out of range");
  }
  if (i0 === i1 || i1 === i2 || i0 === i2) {
    throw new Error("addTriangle: repeated vertex index within triangle");
  }
  mesh.triangles.push(i0, i1, i2);
}

/**
 * Merge meshes into a new growable mesh (indices remapped).
 * @param {Mesh[]} meshes
 * @returns {GrowableMesh}
 */
export function mergeMeshes(meshes) {
  const out = createMesh();
  for (const mesh of meshes) {
    const base = out.positions.length / 3;
    const pos = mesh.positions;
    for (let i = 0; i < pos.length; i += 1) {
      out.positions.push(pos[i]);
    }
    const tris = mesh.triangles;
    for (let i = 0; i < tris.length; i += 1) {
      out.triangles.push(tris[i] + base);
    }
  }
  return out;
}

/**
 * Pack growable arrays into typed arrays (copy).
 * @param {Mesh} mesh
 * @returns {PackedMesh}
 */
export function packMesh(mesh) {
  return {
    positions: mesh.positions instanceof Float64Array
      ? new Float64Array(mesh.positions)
      : Float64Array.from(mesh.positions),
    triangles: mesh.triangles instanceof Uint32Array
      ? new Uint32Array(mesh.triangles)
      : Uint32Array.from(mesh.triangles),
  };
}

/**
 * Vertex count.
 * @param {Mesh} mesh
 */
export function vertexCount(mesh) {
  return mesh.positions.length / 3;
}

/**
 * Triangle count.
 * @param {Mesh} mesh
 */
export function triangleCount(mesh) {
  return mesh.triangles.length / 3;
}

/**
 * Read vertex coordinates.
 * @param {Mesh} mesh
 * @param {number} index
 * @returns {{ x: number, y: number, z: number }}
 */
export function getVertex(mesh, index) {
  const o = index * 3;
  return {
    x: mesh.positions[o],
    y: mesh.positions[o + 1],
    z: mesh.positions[o + 2],
  };
}

/**
 * Deduplicating vertex store keyed by exact string coordinates.
 * Safe for deterministic grid / circle constructions when keys are exact.
 */
export function createVertexDeduper(mesh) {
  /** @type {Map<string, number>} */
  const map = new Map();
  return {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {string} [tag] Optional namespace so coincident saddle sectors stay distinct.
     * @returns {number}
     */
    get(x, y, z, tag = "") {
      const key = tag ? `${x},${y},${z}#${tag}` : `${x},${y},${z}`;
      const existing = map.get(key);
      if (existing !== undefined) return existing;
      const idx = addVertex(mesh, x, y, z);
      map.set(key, idx);
      return idx;
    },
  };
}
