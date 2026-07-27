/**
 * Pure mesh mathematics (normals, area, volume, bounds).
 */

/** Validation / degeneracy epsilon (mm / mm² as documented per use). */
export const MESH_EPSILON = 1e-9;
export const ZERO_AREA_EPSILON = 1e-12;

/**
 * @param {number} ax
 * @param {number} ay
 * @param {number} az
 * @param {number} bx
 * @param {number} by
 * @param {number} bz
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @returns {{ x: number, y: number, z: number }}
 */
export function computeTriangleNormal(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz);
  if (len <= MESH_EPSILON) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: nx / len, y: ny / len, z: nz / len };
}

/**
 * Triangle area (mm²).
 * @param {number} ax
 * @param {number} ay
 * @param {number} az
 * @param {number} bx
 * @param {number} by
 * @param {number} bz
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 */
export function triangleArea(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  return 0.5 * Math.hypot(nx, ny, nz);
}

/**
 * Axis-aligned bounds of a mesh.
 * @param {{ positions: ArrayLike<number> }} mesh
 * @returns {{
 *   minX: number, minY: number, minZ: number,
 *   maxX: number, maxY: number, maxZ: number,
 *   sizeX: number, sizeY: number, sizeZ: number
 * }}
 */
export function computeBounds(mesh) {
  const pos = mesh.positions;
  if (pos.length < 3) {
    return {
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
      sizeX: 0,
      sizeY: 0,
      sizeZ: 0,
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i];
    const y = pos[i + 1];
    const z = pos[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    sizeX: maxX - minX,
    sizeY: maxY - minY,
    sizeZ: maxZ - minZ,
  };
}

/**
 * Signed volume via divergence theorem (1/6 Σ det).
 * Positive for CCW outward winding on a closed solid.
 * @param {{ positions: ArrayLike<number>, triangles: ArrayLike<number> }} mesh
 */
export function signedVolume(mesh) {
  const pos = mesh.positions;
  const tris = mesh.triangles;
  let sum = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const i0 = tris[i] * 3;
    const i1 = tris[i + 1] * 3;
    const i2 = tris[i + 2] * 3;
    const ax = pos[i0];
    const ay = pos[i0 + 1];
    const az = pos[i0 + 2];
    const bx = pos[i1];
    const by = pos[i1 + 1];
    const bz = pos[i1 + 2];
    const cx = pos[i2];
    const cy = pos[i2 + 1];
    const cz = pos[i2 + 2];
    sum += ax * (by * cz - bz * cy)
      - ay * (bx * cz - bz * cx)
      + az * (bx * cy - by * cx);
  }
  return sum / 6;
}

/**
 * Absolute volume.
 * @param {{ positions: ArrayLike<number>, triangles: ArrayLike<number> }} mesh
 */
export function meshVolume(mesh) {
  return Math.abs(signedVolume(mesh));
}
