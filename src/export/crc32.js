/**
 * Dependency-free CRC-32 (ISO 3309 / ITU-T V.42 / ZIP / PNG polynomial).
 *
 * Polynomial: 0xEDB88320 (reflected form of 0x04C11DB7)
 * Init: 0xFFFFFFFF
 * XorOut: 0xFFFFFFFF
 * Output: unsigned 32-bit integer
 */

/** @type {Uint32Array | null} */
let tableCache = null;

/**
 * @returns {Uint32Array}
 */
function getTable() {
  if (tableCache) return tableCache;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  tableCache = table;
  return table;
}

/**
 * Compute CRC-32 over a byte sequence.
 * @param {Uint8Array | ArrayBuffer} input
 * @returns {number} unsigned 32-bit CRC
 */
export function crc32(input) {
  const bytes = input instanceof Uint8Array
    ? input
    : new Uint8Array(input);
  const table = getTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
