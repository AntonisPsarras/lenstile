/**
 * Mesh primitives (Milestone 4).
 */

import { createMesh, addTriangle, createVertexDeduper, packMesh } from "./mesh.js";

/**
 * Axis-aligned box mesh (closed).
 * Winding is outward (CCW when viewed from outside).
 *
 * @param {number} minX
 * @param {number} minY
 * @param {number} minZ
 * @param {number} maxX
 * @param {number} maxY
 * @param {number} maxZ
 * @returns {import("./mesh.js").PackedMesh}
 */
export function createBoxMesh(minX, minY, minZ, maxX, maxY, maxZ) {
  if (!(maxX > minX && maxY > minY && maxZ > minZ)) {
    throw new Error("createBoxMesh requires positive extents");
  }
  const mesh = createMesh();
  const v = createVertexDeduper(mesh);

  const p000 = v.get(minX, minY, minZ);
  const p100 = v.get(maxX, minY, minZ);
  const p110 = v.get(maxX, maxY, minZ);
  const p010 = v.get(minX, maxY, minZ);
  const p001 = v.get(minX, minY, maxZ);
  const p101 = v.get(maxX, minY, maxZ);
  const p111 = v.get(maxX, maxY, maxZ);
  const p011 = v.get(minX, maxY, maxZ);

  // Bottom (-Z): CW when viewed from +Z so normal points -Z
  addTriangle(mesh, p000, p010, p110);
  addTriangle(mesh, p000, p110, p100);
  // Top (+Z)
  addTriangle(mesh, p001, p101, p111);
  addTriangle(mesh, p001, p111, p011);
  // -Y
  addTriangle(mesh, p000, p100, p101);
  addTriangle(mesh, p000, p101, p001);
  // +Y
  addTriangle(mesh, p010, p011, p111);
  addTriangle(mesh, p010, p111, p110);
  // -X
  addTriangle(mesh, p000, p001, p011);
  addTriangle(mesh, p000, p011, p010);
  // +X
  addTriangle(mesh, p100, p110, p111);
  addTriangle(mesh, p100, p111, p101);

  return packMesh(mesh);
}

/**
 * Add an axis-aligned quad as two triangles.
 * Vertices a-b-c-d in CCW order when viewed along the outward normal.
 * @param {import("./mesh.js").GrowableMesh} mesh
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @param {number} d
 */
export function addQuad(mesh, a, b, c, d) {
  addTriangle(mesh, a, b, c);
  addTriangle(mesh, a, c, d);
}
