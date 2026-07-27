/**
 * Triangle normal helpers (Milestone 4).
 */

import { computeTriangleNormal } from "./mesh-math.js";

export {
  computeTriangleNormal,
  MESH_EPSILON,
  ZERO_AREA_EPSILON,
} from "./mesh-math.js";

/**
 * Compute unit normals for every triangle (derived from winding).
 * @param {{ positions: ArrayLike<number>, triangles: ArrayLike<number> }} mesh
 * @returns {Float64Array} flat nx,ny,nz per triangle
 */
export function computeNormals(mesh) {
  const tris = mesh.triangles;
  const pos = mesh.positions;
  const out = new Float64Array((tris.length / 3) * 3);
  let o = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * 3;
    const b = tris[i + 1] * 3;
    const c = tris[i + 2] * 3;
    const n = computeTriangleNormal(
      pos[a],
      pos[a + 1],
      pos[a + 2],
      pos[b],
      pos[b + 1],
      pos[b + 2],
      pos[c],
      pos[c + 1],
      pos[c + 2],
    );
    out[o] = n.x;
    out[o + 1] = n.y;
    out[o + 2] = n.z;
    o += 3;
  }
  return out;
}
