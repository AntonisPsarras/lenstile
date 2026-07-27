/**
 * Minimal ZIP writer using the Store method only (no compression).
 *
 * Deterministic:
 * - Fixed DOS date/time (not Date.now())
 * - Stable caller-provided entry order
 * - UTF-8 filename flag
 * - No comments, no extra fields, no OS-specific metadata
 *
 * ZIP64 is out of scope.
 */

import { crc32 } from "./crc32.js";

/** Local file header signature. */
const SIG_LOCAL = 0x04034b50;
/** Central directory file header signature. */
const SIG_CENTRAL = 0x02014b50;
/** End of central directory signature. */
const SIG_EOCD = 0x06054b50;

/**
 * Fixed DOS timestamp for deterministic archives.
 * 2024-01-01 00:00:00 local (DOS encoding).
 * Date: ((year-1980)<<9) | (month<<5) | day
 * Time: (hour<<11) | (minute<<5) | (second/2)
 */
export const ZIP_DOS_TIME = 0x0000;
export const ZIP_DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;

/** Compression method: Store. */
export const ZIP_METHOD_STORE = 0;

/** General-purpose bit 11: UTF-8 filenames. */
export const ZIP_FLAG_UTF8 = 0x0800;

/** Maximum supported uncompressed / compressed size and offsets (32-bit ZIP). */
const MAX_U32 = 0xffffffff;

/**
 * @typedef {{ path: string, data: Uint8Array }} ZipEntryInput
 */

/**
 * Validate a ZIP entry path (forward slashes, no traversal).
 * @param {string} path
 */
export function assertSafeZipPath(path) {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("ZIP entry path must be a non-empty string.");
  }
  if (path.includes("\\")) {
    throw new Error(`ZIP entry path must use forward slashes: ${path}`);
  }
  if (path.includes("..")) {
    throw new Error(`ZIP entry path must not contain '..': ${path}`);
  }
  if (path.startsWith("/")) {
    throw new Error(`ZIP entry path must be relative (no leading slash): ${path}`);
  }
}

/**
 * Encode a string as UTF-8 bytes.
 * @param {string} text
 * @returns {Uint8Array}
 */
function encodeUtf8(text) {
  return new TextEncoder().encode(text);
}

/**
 * Write a little-endian unsigned 16-bit value.
 * @param {DataView} view
 * @param {number} offset
 * @param {number} value
 */
function writeU16(view, offset, value) {
  view.setUint16(offset, value >>> 0, true);
}

/**
 * Write a little-endian unsigned 32-bit value.
 * @param {DataView} view
 * @param {number} offset
 * @param {number} value
 */
function writeU32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

/**
 * Create a Store-method ZIP archive from ordered entries.
 *
 * @param {ZipEntryInput[]} entries
 * @returns {Uint8Array}
 */
export function createZipStore(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("createZipStore requires an array of entries.");
  }
  if (entries.length > 0xffff) {
    throw new Error("ZIP entry count exceeds 16-bit limit.");
  }

  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Array<{
   *   path: string,
   *   pathBytes: Uint8Array,
   *   data: Uint8Array,
   *   crc: number,
   *   localHeaderOffset: number,
   * }>} */
  const prepared = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      throw new Error("ZIP entry must be an object with path and data.");
    }
    const path = entry.path;
    assertSafeZipPath(path);
    if (seen.has(path)) {
      throw new Error(`Duplicate ZIP entry path: ${path}`);
    }
    seen.add(path);
    const data = entry.data instanceof Uint8Array
      ? entry.data
      : new Uint8Array(entry.data);
    if (data.byteLength > MAX_U32) {
      throw new Error(`ZIP entry exceeds 32-bit size limit: ${path}`);
    }
    const pathBytes = encodeUtf8(path);
    if (pathBytes.byteLength > 0xffff) {
      throw new Error(`ZIP entry path too long: ${path}`);
    }
    prepared.push({
      path,
      pathBytes,
      data,
      crc: crc32(data),
      localHeaderOffset: 0,
    });
  }

  let localSize = 0;
  for (const item of prepared) {
    localSize += 30 + item.pathBytes.byteLength + item.data.byteLength;
  }
  let centralSize = 0;
  for (const item of prepared) {
    centralSize += 46 + item.pathBytes.byteLength;
  }
  const eocdSize = 22;
  const totalSize = localSize + centralSize + eocdSize;
  if (totalSize > MAX_U32) {
    throw new Error("ZIP archive exceeds 32-bit size limit.");
  }

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let offset = 0;

  for (const item of prepared) {
    if (offset > MAX_U32) {
      throw new Error("ZIP local header offset exceeds 32-bit limit.");
    }
    item.localHeaderOffset = offset;
    writeU32(view, offset, SIG_LOCAL);
    writeU16(view, offset + 4, 20); // version needed
    writeU16(view, offset + 6, ZIP_FLAG_UTF8);
    writeU16(view, offset + 8, ZIP_METHOD_STORE);
    writeU16(view, offset + 10, ZIP_DOS_TIME);
    writeU16(view, offset + 12, ZIP_DOS_DATE);
    writeU32(view, offset + 14, item.crc);
    writeU32(view, offset + 18, item.data.byteLength);
    writeU32(view, offset + 22, item.data.byteLength);
    writeU16(view, offset + 26, item.pathBytes.byteLength);
    writeU16(view, offset + 28, 0); // extra length
    out.set(item.pathBytes, offset + 30);
    offset += 30 + item.pathBytes.byteLength;
    out.set(item.data, offset);
    offset += item.data.byteLength;
  }

  const centralDirectoryOffset = offset;
  for (const item of prepared) {
    writeU32(view, offset, SIG_CENTRAL);
    writeU16(view, offset + 4, 20); // version made by
    writeU16(view, offset + 6, 20); // version needed
    writeU16(view, offset + 8, ZIP_FLAG_UTF8);
    writeU16(view, offset + 10, ZIP_METHOD_STORE);
    writeU16(view, offset + 12, ZIP_DOS_TIME);
    writeU16(view, offset + 14, ZIP_DOS_DATE);
    writeU32(view, offset + 16, item.crc);
    writeU32(view, offset + 20, item.data.byteLength);
    writeU32(view, offset + 24, item.data.byteLength);
    writeU16(view, offset + 28, item.pathBytes.byteLength);
    writeU16(view, offset + 30, 0); // extra
    writeU16(view, offset + 32, 0); // comment
    writeU16(view, offset + 34, 0); // disk start
    writeU16(view, offset + 36, 0); // internal attrs
    writeU32(view, offset + 38, 0); // external attrs
    writeU32(view, offset + 42, item.localHeaderOffset);
    out.set(item.pathBytes, offset + 46);
    offset += 46 + item.pathBytes.byteLength;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  writeU32(view, offset, SIG_EOCD);
  writeU16(view, offset + 4, 0); // disk number
  writeU16(view, offset + 6, 0); // disk with CD
  writeU16(view, offset + 8, prepared.length);
  writeU16(view, offset + 10, prepared.length);
  writeU32(view, offset + 12, centralDirectorySize);
  writeU32(view, offset + 16, centralDirectoryOffset);
  writeU16(view, offset + 20, 0); // comment length

  return out;
}

/**
 * @typedef {{
 *   path: string,
 *   data: Uint8Array,
 *   crc: number,
 *   method: number,
 *   flags: number,
 *   dosTime: number,
 *   dosDate: number,
 *   localHeaderOffset: number,
 * }} ZipParsedEntry
 */

/**
 * Parse a Store-method ZIP produced by createZipStore (and simple Store archives).
 * Used for validation tests — not a general-purpose unzipper.
 *
 * @param {Uint8Array} bytes
 * @returns {{ entries: ZipParsedEntry[], centralDirectoryOffset: number }}
 */
export function readZipStore(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("readZipStore requires a Uint8Array.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 22) {
    throw new Error("ZIP archive too small.");
  }

  // Locate EOCD by scanning backward for signature (comment length is 0 in our writer).
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
    // Bound scan for safety
    if (bytes.byteLength - i > 0xffff + 22) break;
  }
  if (eocd < 0) {
    throw new Error("ZIP end-of-central-directory not found.");
  }

  const entryCount = view.getUint16(eocd + 8, true);
  const totalEntries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entryCount !== totalEntries) {
    throw new Error("ZIP multi-disk archives are not supported.");
  }
  if (cdOffset + cdSize > bytes.byteLength) {
    throw new Error("ZIP central directory extends past end of archive.");
  }

  /** @type {ZipParsedEntry[]} */
  const entries = [];
  /** @type {Set<string>} */
  const seen = new Set();
  let offset = cdOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(offset, true) !== SIG_CENTRAL) {
      throw new Error("Invalid ZIP central directory signature.");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const dosTime = view.getUint16(offset + 12, true);
    const dosDate = view.getUint16(offset + 14, true);
    const crc = view.getUint32(offset + 16, true);
    const compSize = view.getUint32(offset + 20, true);
    const uncompSize = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLen);
    const path = new TextDecoder("utf-8").decode(nameBytes);
    if (seen.has(path)) {
      throw new Error(`Duplicate ZIP entry path: ${path}`);
    }
    seen.add(path);

    if (view.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new Error(`Invalid local header for ${path}`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(dataStart, dataStart + compSize);
    if (data.byteLength !== compSize) {
      throw new Error(`Truncated ZIP entry data: ${path}`);
    }
    if (crc32(data) !== crc) {
      throw new Error(`CRC mismatch for ZIP entry: ${path}`);
    }
    if (compSize !== uncompSize && method === ZIP_METHOD_STORE) {
      throw new Error(`Store entry size mismatch: ${path}`);
    }

    entries.push({
      path,
      data: new Uint8Array(data),
      crc,
      method,
      flags,
      dosTime,
      dosDate,
      localHeaderOffset: localOffset,
    });

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return { entries, centralDirectoryOffset: cdOffset };
}
