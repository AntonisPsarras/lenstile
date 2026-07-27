/**
 * CRC-32 unit tests (Milestone 7).
 */

import { describe, test, assertEqual } from "./test-utils.js";
import { crc32 } from "../src/export/crc32.js";

describe("CRC-32", () => {
  test("empty byte array", () => {
    assertEqual(crc32(new Uint8Array(0)), 0);
  });

  test("ASCII 123456789 known result", () => {
    const bytes = new TextEncoder().encode("123456789");
    assertEqual(crc32(bytes), 0xcbf43926);
  });

  test("binary data including 0 and 255", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128, 0, 255]);
    const once = crc32(bytes);
    assertEqual(once >>> 0, once);
    assertEqual(crc32(bytes), once);
    // Distinct from empty / known ASCII
    assertEqual(once === 0, false);
    assertEqual(once === 0xcbf43926, false);
  });

  test("repeated result is identical", () => {
    const bytes = new TextEncoder().encode("LensTile");
    assertEqual(crc32(bytes), crc32(bytes));
    assertEqual(crc32(bytes), crc32(new Uint8Array(bytes)));
  });
});
