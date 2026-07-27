/**
 * Deterministic geometry debug fixtures (Milestone 6.2.2).
 *
 * Browser-only local JSON export for reproducing mesh generation. Never uploads
 * or fetches. Source images are omitted by default.
 *
 * Format version 1
 * ----------------
 * {
 *   format: "open-tile-geometry-debug",
 *   formatVersion: 1,
 *   exportedAt: ISO-8601 string (metadata only; not used by algorithms),
 *   expectedFailingObject: string | null,
 *   tileVersion: string,
 *   geometryAlgorithmVersion: number,
 *   width: number,
 *   height: number,
 *   surfaceStyle: "flat" | "relief",
 *   reliefStrengthId: string,
 *   heightOrder: string,
 *   colorHeightLevels: Array<{ paletteIndex, levelIndex }>,
 *   usedPaletteIndices: number[],
 *   generatedPalette: Array<{ r, g, b }>,
 *   effectivePalette: Array<{ r, g, b }>,
 *   sourceRevision: number,
 *   printabilityRevision: number,
 *   geometryRevision: number,
 *   indicesEncoding: "raw" | "base64-uint8",
 *   cleanedIndices: number[] | string
 * }
 *
 * Large index buffers use `base64-uint8`: standard base64 of the raw Uint8
 * bytes (one palette index per byte, row-major). Small buffers may use `raw`
 * (JSON array of numbers) for readability.
 */

import { TILE_V1, GEOMETRY_ALGORITHM_VERSION } from "./tile-spec.js";
import { usedPaletteIndices } from "./mask-to-rectangles.js";
import {
  normalizeSurfaceStyleId,
  normalizeReliefStrengthId,
  normalizeHeightOrderId,
} from "./relief.js";

export const GEOMETRY_DEBUG_FORMAT = "open-tile-geometry-debug";
export const GEOMETRY_DEBUG_FORMAT_VERSION = 1;

/** Prefer base64 when the index buffer is at least this many cells. */
const BASE64_THRESHOLD = 256;

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Encode bytes to base64 without Buffer / btoa dependencies that fail on binary.
 * @param {Uint8Array} bytes
 */
export function encodeBase64Uint8(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64_ALPHABET[(triple >> 18) & 63];
    out += BASE64_ALPHABET[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 63] : "=";
  }
  return out;
}

/**
 * @param {string} text
 * @returns {Uint8Array}
 */
export function decodeBase64Uint8(text) {
  const clean = String(text).replace(/\s+/g, "");
  if (clean.length % 4 !== 0) {
    throw new Error("geometry debug fixture: invalid base64 length");
  }
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = table[clean.charCodeAt(i)];
    const c1 = table[clean.charCodeAt(i + 1)];
    const c2 = clean[i + 2] === "=" ? 0 : table[clean.charCodeAt(i + 2)];
    const c3 = clean[i + 3] === "=" ? 0 : table[clean.charCodeAt(i + 3)];
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) {
      throw new Error("geometry debug fixture: invalid base64 character");
    }
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (o < out.length) out[o++] = (triple >> 16) & 255;
    if (o < out.length) out[o++] = (triple >> 8) & 255;
    if (o < out.length) out[o++] = triple & 255;
  }
  return out;
}

/**
 * @param {Uint8Array | ArrayLike<number>} indices
 * @param {number} width
 * @param {number} height
 */
function encodeIndices(indices, width, height) {
  const expected = width * height;
  if (!indices || indices.length !== expected) {
    throw new Error("geometry debug fixture: cleanedIndices length must equal width × height");
  }
  const bytes = indices instanceof Uint8Array
    ? indices
    : Uint8Array.from(indices);
  if (bytes.length >= BASE64_THRESHOLD) {
    return {
      indicesEncoding: /** @type {"base64-uint8"} */ ("base64-uint8"),
      cleanedIndices: encodeBase64Uint8(bytes),
    };
  }
  return {
    indicesEncoding: /** @type {"raw"} */ ("raw"),
    cleanedIndices: Array.from(bytes),
  };
}

/**
 * @param {unknown} encoded
 * @param {"raw" | "base64-uint8"} encoding
 * @param {number} width
 * @param {number} height
 */
export function decodeCleanedIndices(encoded, encoding, width, height) {
  const expected = width * height;
  let bytes;
  if (encoding === "base64-uint8") {
    if (typeof encoded !== "string") {
      throw new Error("geometry debug fixture: base64-uint8 requires a string");
    }
    bytes = decodeBase64Uint8(encoded);
  } else if (encoding === "raw") {
    if (!Array.isArray(encoded)) {
      throw new Error("geometry debug fixture: raw encoding requires a number array");
    }
    bytes = Uint8Array.from(encoded);
  } else {
    throw new Error(`geometry debug fixture: unknown indicesEncoding ${encoding}`);
  }
  if (bytes.length !== expected) {
    throw new Error(
      `geometry debug fixture: decoded indices length ${bytes.length} !== ${expected}`,
    );
  }
  return bytes;
}

/**
 * Build a serializable debug fixture from accepted design inputs.
 *
 * @param {object} opts
 * @param {Uint8Array | ArrayLike<number>} opts.cleanedIndices
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {"flat" | "relief" | string} [opts.surfaceStyle]
 * @param {string} [opts.reliefStrengthId]
 * @param {string} [opts.heightOrder]
 * @param {Array<{ paletteIndex: number, levelIndex: number }>} [opts.colorHeightLevels]
 * @param {Array<{ r: number, g: number, b: number }>} [opts.generatedPalette]
 * @param {Array<{ r: number, g: number, b: number }>} [opts.effectivePalette]
 * @param {number} [opts.sourceRevision]
 * @param {number} [opts.printabilityRevision]
 * @param {number} [opts.geometryRevision]
 * @param {string | null} [opts.expectedFailingObject]
 * @param {string} [opts.tileVersion]
 * @param {number} [opts.geometryAlgorithmVersion]
 * @returns {object}
 */
export function buildGeometryDebugFixture(opts) {
  const width = opts.width;
  const height = opts.height;
  const encoded = encodeIndices(opts.cleanedIndices, width, height);
  const generatedPalette = Array.isArray(opts.generatedPalette)
    ? opts.generatedPalette.map((c) => ({ r: c.r, g: c.g, b: c.b }))
    : [];
  const effectivePalette = Array.isArray(opts.effectivePalette)
    ? opts.effectivePalette.map((c) => ({ r: c.r, g: c.g, b: c.b }))
    : generatedPalette.map((c) => ({ ...c }));
  const indices = opts.cleanedIndices instanceof Uint8Array
    ? opts.cleanedIndices
    : Uint8Array.from(opts.cleanedIndices);

  return {
    format: GEOMETRY_DEBUG_FORMAT,
    formatVersion: GEOMETRY_DEBUG_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    expectedFailingObject: opts.expectedFailingObject ?? null,
    tileVersion: opts.tileVersion || TILE_V1.version,
    geometryAlgorithmVersion: opts.geometryAlgorithmVersion ?? GEOMETRY_ALGORITHM_VERSION,
    width,
    height,
    surfaceStyle: normalizeSurfaceStyleId(opts.surfaceStyle),
    reliefStrengthId: normalizeReliefStrengthId(opts.reliefStrengthId),
    heightOrder: normalizeHeightOrderId(opts.heightOrder),
    colorHeightLevels: Array.isArray(opts.colorHeightLevels)
      ? opts.colorHeightLevels.map((e) => ({
        paletteIndex: e.paletteIndex,
        levelIndex: e.levelIndex,
      }))
      : [],
    usedPaletteIndices: usedPaletteIndices(indices),
    generatedPalette,
    effectivePalette,
    sourceRevision: opts.sourceRevision ?? 0,
    printabilityRevision: opts.printabilityRevision ?? 0,
    geometryRevision: opts.geometryRevision ?? 0,
    indicesEncoding: encoded.indicesEncoding,
    cleanedIndices: encoded.cleanedIndices,
  };
}

/**
 * Parse and validate a debug fixture object.
 * @param {unknown} raw
 */
export function parseGeometryDebugFixture(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("geometry debug fixture: expected an object");
  }
  /** @type {Record<string, unknown>} */
  const obj = /** @type {Record<string, unknown>} */ (raw);
  if (obj.format !== GEOMETRY_DEBUG_FORMAT) {
    throw new Error("geometry debug fixture: unexpected format id");
  }
  if (obj.formatVersion !== GEOMETRY_DEBUG_FORMAT_VERSION) {
    throw new Error(`geometry debug fixture: unsupported formatVersion ${obj.formatVersion}`);
  }
  const width = Number(obj.width);
  const height = Number(obj.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("geometry debug fixture: invalid width/height");
  }
  const encoding = obj.indicesEncoding === "base64-uint8" ? "base64-uint8" : "raw";
  const cleanedIndices = decodeCleanedIndices(obj.cleanedIndices, encoding, width, height);
  return {
    format: GEOMETRY_DEBUG_FORMAT,
    formatVersion: GEOMETRY_DEBUG_FORMAT_VERSION,
    exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : null,
    expectedFailingObject: typeof obj.expectedFailingObject === "string"
      ? obj.expectedFailingObject
      : null,
    tileVersion: typeof obj.tileVersion === "string" ? obj.tileVersion : TILE_V1.version,
    geometryAlgorithmVersion: Number(obj.geometryAlgorithmVersion) || GEOMETRY_ALGORITHM_VERSION,
    width,
    height,
    surfaceStyle: normalizeSurfaceStyleId(obj.surfaceStyle),
    reliefStrengthId: normalizeReliefStrengthId(obj.reliefStrengthId),
    heightOrder: normalizeHeightOrderId(obj.heightOrder),
    colorHeightLevels: Array.isArray(obj.colorHeightLevels)
      ? obj.colorHeightLevels.map((e) => ({
        paletteIndex: Number(/** @type {{ paletteIndex: number }} */ (e).paletteIndex),
        levelIndex: Number(/** @type {{ levelIndex: number }} */ (e).levelIndex),
      }))
      : [],
    usedPaletteIndices: Array.isArray(obj.usedPaletteIndices)
      ? obj.usedPaletteIndices.map(Number)
      : usedPaletteIndices(cleanedIndices),
    generatedPalette: Array.isArray(obj.generatedPalette)
      ? obj.generatedPalette.map((c) => ({
        r: Number(/** @type {{ r: number }} */ (c).r),
        g: Number(/** @type {{ g: number }} */ (c).g),
        b: Number(/** @type {{ b: number }} */ (c).b),
      }))
      : [],
    effectivePalette: Array.isArray(obj.effectivePalette)
      ? obj.effectivePalette.map((c) => ({
        r: Number(/** @type {{ r: number }} */ (c).r),
        g: Number(/** @type {{ g: number }} */ (c).g),
        b: Number(/** @type {{ b: number }} */ (c).b),
      }))
      : [],
    sourceRevision: Number(obj.sourceRevision) || 0,
    printabilityRevision: Number(obj.printabilityRevision) || 0,
    geometryRevision: Number(obj.geometryRevision) || 0,
    indicesEncoding: encoding,
    cleanedIndices,
  };
}

/**
 * Pretty-print fixture JSON for download.
 * @param {object} fixture
 */
export function stringifyGeometryDebugFixture(fixture) {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}
