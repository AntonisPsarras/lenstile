/**
 * Dependency-free binary STL writer.
 *
 * Layout:
 * - 80-byte ASCII header
 * - uint32 LE triangle count
 * - 50 bytes per triangle: normal(3×f32) + v1 + v2 + v3 + uint16 attribute(0)
 *
 * Byte length = 84 + triangleCount × 50
 */

import { computeTriangleNormal, ZERO_AREA_EPSILON, triangleArea } from "../geometry/mesh-math.js";
import { triangleCount } from "../geometry/mesh.js";

/** STL MIME type commonly accepted by slicers. */
export const STL_MIME_TYPE = "model/stl";

/**
 * @param {string} text
 * @returns {Uint8Array}
 */
export function encodeStlHeader(text) {
  const bytes = new Uint8Array(80);
  const src = typeof text === "string" ? text : "";
  for (let i = 0; i < 80; i += 1) {
    bytes[i] = i < src.length ? src.charCodeAt(i) & 0x7f : 0x20;
  }
  // Avoid the ASCII "solid" keyword confusion in some tools by not starting with it
  // when the descriptive text would; spaces are fine. Keep content as provided.
  return bytes;
}

/**
 * Serialize a mesh to a binary STL ArrayBuffer.
 * Deterministic for identical mesh input.
 *
 * @param {{ positions: ArrayLike<number>, triangles: ArrayLike<number> }} mesh
 * @param {{ header?: string }} [options]
 * @returns {ArrayBuffer}
 */
export function writeBinaryStl(mesh, options = {}) {
  if (!mesh || !mesh.positions || !mesh.triangles) {
    throw new Error("writeBinaryStl requires a mesh with positions and triangles");
  }
  const tCount = triangleCount(mesh);
  if (tCount < 1) {
    throw new Error("writeBinaryStl rejects empty meshes");
  }
  if (tCount > 0xffffffff) {
    throw new Error("triangle count exceeds uint32");
  }

  const pos = mesh.positions;
  const tris = mesh.triangles;
  const byteLength = 84 + tCount * 50;
  const buffer = new ArrayBuffer(byteLength);
  const bytes = new Uint8Array(buffer);
  const headerText = options.header
    || "LensTile binary STL";
  bytes.set(encodeStlHeader(headerText), 0);

  const view = new DataView(buffer);
  view.setUint32(80, tCount, true);

  let offset = 84;
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

    if (
      !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az)
      || !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz)
      || !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)
    ) {
      throw new Error("writeBinaryStl: non-finite vertex");
    }

    const area = triangleArea(ax, ay, az, bx, by, bz, cx, cy, cz);
    if (area <= ZERO_AREA_EPSILON) {
      throw new Error("writeBinaryStl: degenerate triangle");
    }

    const n = computeTriangleNormal(ax, ay, az, bx, by, bz, cx, cy, cz);
    view.setFloat32(offset, n.x, true);
    view.setFloat32(offset + 4, n.y, true);
    view.setFloat32(offset + 8, n.z, true);
    view.setFloat32(offset + 12, ax, true);
    view.setFloat32(offset + 16, ay, true);
    view.setFloat32(offset + 20, az, true);
    view.setFloat32(offset + 24, bx, true);
    view.setFloat32(offset + 28, by, true);
    view.setFloat32(offset + 32, bz, true);
    view.setFloat32(offset + 36, cx, true);
    view.setFloat32(offset + 40, cy, true);
    view.setFloat32(offset + 44, cz, true);
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return buffer;
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} [mimeType]
 * @returns {Blob}
 */
export function binaryStlToBlob(buffer, mimeType = STL_MIME_TYPE) {
  return new Blob([buffer], { type: mimeType });
}

/**
 * Expected binary STL byte length for n triangles.
 * @param {number} triangleCountValue
 */
export function expectedStlByteLength(triangleCountValue) {
  return 84 + triangleCountValue * 50;
}
