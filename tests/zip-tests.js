/**
 * ZIP Store writer tests (Milestone 7).
 */

import {
  describe,
  test,
  assertEqual,
  assertThrows,
} from "./test-utils.js";
import {
  createZipStore,
  readZipStore,
  ZIP_METHOD_STORE,
  ZIP_FLAG_UTF8,
  ZIP_DOS_DATE,
  ZIP_DOS_TIME,
} from "../src/export/zip-store.js";
import { crc32 } from "../src/export/crc32.js";

/**
 * @param {Uint8Array} bytes
 */
function fnv1aHex(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

describe("ZIP store", () => {
  test("one-file archive", () => {
    const data = new TextEncoder().encode("hello");
    const zip = createZipStore([{ path: "a.txt", data }]);
    const parsed = readZipStore(zip);
    assertEqual(parsed.entries.length, 1);
    assertEqual(parsed.entries[0].path, "a.txt");
    assertEqual(new TextDecoder().decode(parsed.entries[0].data), "hello");
  });

  test("three-file archive with required paths", () => {
    const enc = new TextEncoder();
    const zip = createZipStore([
      { path: "[Content_Types].xml", data: enc.encode("<Types/>") },
      { path: "_rels/.rels", data: enc.encode("<Relationships/>") },
      { path: "3D/3dmodel.model", data: enc.encode("<model/>") },
    ]);
    const parsed = readZipStore(zip);
    assertEqual(parsed.entries.map((e) => e.path).join("|"), [
      "[Content_Types].xml",
      "_rels/.rels",
      "3D/3dmodel.model",
    ].join("|"));
  });

  test("stable entry order", () => {
    const enc = new TextEncoder();
    const a = createZipStore([
      { path: "b.bin", data: enc.encode("b") },
      { path: "a.bin", data: enc.encode("a") },
    ]);
    const b = createZipStore([
      { path: "b.bin", data: enc.encode("b") },
      { path: "a.bin", data: enc.encode("a") },
    ]);
    assertEqual(fnv1aHex(a), fnv1aHex(b));
    assertEqual(readZipStore(a).entries[0].path, "b.bin");
    assertEqual(readZipStore(a).entries[1].path, "a.bin");
  });

  test("Store method and UTF-8 flag", () => {
    const zip = createZipStore([
      { path: "café.txt", data: new TextEncoder().encode("x") },
    ]);
    const entry = readZipStore(zip).entries[0];
    assertEqual(entry.method, ZIP_METHOD_STORE);
    assertEqual((entry.flags & ZIP_FLAG_UTF8) === ZIP_FLAG_UTF8, true);
    assertEqual(entry.path, "café.txt");
  });

  test("CRC fields match payload", () => {
    const data = new Uint8Array([1, 2, 3, 4, 255]);
    const zip = createZipStore([{ path: "x.bin", data }]);
    const entry = readZipStore(zip).entries[0];
    assertEqual(entry.crc, crc32(data));
  });

  test("central directory offsets and EOCD entry count", () => {
    const enc = new TextEncoder();
    const zip = createZipStore([
      { path: "one.txt", data: enc.encode("one") },
      { path: "two.txt", data: enc.encode("two") },
    ]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const eocd = zip.byteLength - 22;
    assertEqual(view.getUint32(eocd, true), 0x06054b50);
    assertEqual(view.getUint16(eocd + 8, true), 2);
    assertEqual(view.getUint16(eocd + 10, true), 2);
    const cdOffset = view.getUint32(eocd + 16, true);
    assertEqual(cdOffset > 0, true);
    assertEqual(view.getUint32(cdOffset, true), 0x02014b50);
    const parsed = readZipStore(zip);
    assertEqual(parsed.centralDirectoryOffset, cdOffset);
  });

  test("fixed timestamp", () => {
    const zip = createZipStore([
      { path: "t.txt", data: new TextEncoder().encode("t") },
    ]);
    const entry = readZipStore(zip).entries[0];
    assertEqual(entry.dosDate, ZIP_DOS_DATE);
    assertEqual(entry.dosTime, ZIP_DOS_TIME);
  });

  test("deterministic byte-identical archive", () => {
    const enc = new TextEncoder();
    const entries = [
      { path: "a.xml", data: enc.encode("<a/>") },
      { path: "b/c.txt", data: enc.encode("hi") },
    ];
    const a = createZipStore(entries);
    const b = createZipStore(entries);
    assertEqual(a.byteLength, b.byteLength);
    assertEqual(fnv1aHex(a), fnv1aHex(b));
  });

  test("duplicate path rejection", () => {
    const data = new Uint8Array([1]);
    assertThrows(
      () => createZipStore([
        { path: "same.txt", data },
        { path: "same.txt", data },
      ]),
      "Duplicate",
    );
  });

  test("unsafe path rejection", () => {
    const data = new Uint8Array([1]);
    assertThrows(() => createZipStore([{ path: "../x", data }]), "..");
    assertThrows(() => createZipStore([{ path: "a\\b", data }]), "forward");
    assertThrows(() => createZipStore([{ path: "", data }]), "non-empty");
    assertThrows(() => createZipStore([{ path: "/abs", data }]), "relative");
  });

  test("oversize rejection where practical", () => {
    // Simulate oversize by temporarily using a fake byteLength via proxy is hard;
    // instead reject entry counts beyond 16-bit by constructing a huge array length claim.
    // Practical check: path longer than 65535 UTF-8 bytes.
    const longPath = "a".repeat(70000);
    assertThrows(
      () => createZipStore([{ path: longPath, data: new Uint8Array([1]) }]),
      "too long",
    );
  });
});
