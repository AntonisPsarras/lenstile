/**
 * Binary STL writer tests.
 */

import {
  describe,
  test,
  assertEqual,
  assertApproxEqual,
  assertThrows,
} from "./test-utils.js";
import { createBoxMesh } from "../src/geometry/primitives.js";
import { createMesh, addVertex, addTriangle, packMesh } from "../src/geometry/mesh.js";
import {
  writeBinaryStl,
  encodeStlHeader,
  expectedStlByteLength,
  binaryStlToBlob,
} from "../src/export/binary-stl.js";
import {
  sanitizeFilenameBase,
  combinedStlFilename,
  baseStlFilename,
  colorStlFilename,
  rgbToFilenameHex,
} from "../src/export/stl-filenames.js";
import {
  GOLDEN_BOX_STL_FNV1A,
  GOLDEN_BOX_STL_BYTES,
  GOLDEN_BOX_TRIANGLE_COUNT,
  GOLDEN_COMBINED_TILE,
} from "./fixtures/geometry-golden.js";
import { buildCombinedTileMesh } from "../src/geometry/tile-base.js";

/**
 * @param {ArrayBuffer} buffer
 */
function fnv1aHex(buffer) {
  let h = 0x811c9dc5;
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

describe("binary STL", () => {
  test("empty mesh rejection", () => {
    assertThrows(() => writeBinaryStl(packMesh(createMesh())), "empty");
  });

  test("one-triangle byte length = 134", () => {
    const mesh = createMesh();
    const a = addVertex(mesh, 0, 0, 0);
    const b = addVertex(mesh, 1, 0, 0);
    const c = addVertex(mesh, 0, 1, 0);
    addTriangle(mesh, a, b, c);
    const buf = writeBinaryStl(packMesh(mesh));
    assertEqual(buf.byteLength, 134);
  });

  test("general byte length = 84 + 50n", () => {
    const box = createBoxMesh(0, 0, 0, 1, 1, 1);
    const buf = writeBinaryStl(box);
    assertEqual(buf.byteLength, expectedStlByteLength(12));
    assertEqual(buf.byteLength, 84 + 50 * 12);
  });

  test("little-endian triangle count", () => {
    const box = createBoxMesh(0, 0, 0, 1, 1, 1);
    const buf = writeBinaryStl(box);
    const view = new DataView(buf);
    assertEqual(view.getUint32(80, true), 12);
  });

  test("correct float32 coordinates", () => {
    const mesh = createMesh();
    const a = addVertex(mesh, 1.5, 2.5, 3.5);
    const b = addVertex(mesh, 4.5, 2.5, 3.5);
    const c = addVertex(mesh, 1.5, 6.5, 3.5);
    addTriangle(mesh, a, b, c);
    const view = new DataView(writeBinaryStl(packMesh(mesh)));
    assertApproxEqual(view.getFloat32(84 + 12, true), 1.5, 1e-6);
    assertApproxEqual(view.getFloat32(84 + 16, true), 2.5, 1e-6);
    assertApproxEqual(view.getFloat32(84 + 20, true), 3.5, 1e-6);
  });

  test("attribute bytes are zero", () => {
    const box = createBoxMesh(0, 0, 0, 1, 1, 1);
    const view = new DataView(writeBinaryStl(box));
    for (let i = 0; i < 12; i += 1) {
      assertEqual(view.getUint16(84 + i * 50 + 48, true), 0);
    }
  });

  test("header is exactly 80 bytes", () => {
    const header = encodeStlHeader("LensTile");
    assertEqual(header.length, 80);
  });

  test("deterministic byte-identical output", () => {
    const box = createBoxMesh(0, 0, 0, 10, 20, 30);
    const a = new Uint8Array(writeBinaryStl(box));
    const b = new Uint8Array(writeBinaryStl(box));
    assertEqual(a.length, b.length);
    for (let i = 0; i < a.length; i += 1) {
      assertEqual(a[i], b[i]);
    }
  });

  test("golden box STL hash", () => {
    const box = createBoxMesh(0, 0, 0, 10, 20, 30);
    const buf = writeBinaryStl(box);
    assertEqual(buf.byteLength, GOLDEN_BOX_STL_BYTES);
    assertEqual(fnv1aHex(buf), GOLDEN_BOX_STL_FNV1A);
    assertEqual(expectedStlByteLength(GOLDEN_BOX_TRIANGLE_COUNT), GOLDEN_BOX_STL_BYTES);
  });

  test("golden combined tile STL metrics", () => {
    const mesh = buildCombinedTileMesh();
    const buf = writeBinaryStl(mesh);
    assertEqual(buf.byteLength, GOLDEN_COMBINED_TILE.stlByteLength);
    assertEqual(fnv1aHex(buf), GOLDEN_COMBINED_TILE.stlFnv1a);
  });

  test("safe filename sanitization", () => {
    assertEqual(sanitizeFilenameBase("Untitled Tile"), "untitled-tile");
    assertEqual(sanitizeFilenameBase("My Tile!!!"), "my-tile");
    assertEqual(sanitizeFilenameBase(""), "lenstile");
    assertEqual(sanitizeFilenameBase("evil\u0000name"), "evil-name");
    assertEqual(sanitizeFilenameBase("../traversal"), "traversal");
    assertEqual(combinedStlFilename("lenstile"), "lenstile-smooth.stl");
    assertEqual(combinedStlFilename("lenstile", { relief: true }), "lenstile-relief.stl");
    assertEqual(baseStlFilename("lenstile"), "lenstile-base.stl");
    assertEqual(rgbToFilenameHex(26, 43, 60), "1A2B3C");
    assertEqual(
      colorStlFilename("lenstile", 1, { r: 26, g: 43, b: 60 }),
      "lenstile-color-01-1A2B3C.stl",
    );
  });

  test("invalid mesh cannot be serialized", () => {
    const mesh = createMesh();
    const a = addVertex(mesh, 0, 0, 0);
    const b = addVertex(mesh, 1, 0, 0);
    const c = addVertex(mesh, 2, 0, 0);
    addTriangle(mesh, a, b, c);
    assertThrows(() => writeBinaryStl(packMesh(mesh)), "degenerate");
  });

  test("binaryStlToBlob returns a Blob", () => {
    const box = createBoxMesh(0, 0, 0, 1, 1, 1);
    const blob = binaryStlToBlob(writeBinaryStl(box));
    assertEqual(blob instanceof Blob, true);
    assertEqual(blob.size, expectedStlByteLength(12));
  });
});
