/**
 * Palette entry helpers: overrides, hex parsing, effective colors.
 */

import { QuantizeErrorCode, createQuantizeError, toError } from "./quantize-errors.js";

/**
 * @typedef {{ r: number, g: number, b: number }} Rgb
 * @typedef {{ generated: Rgb, override: Rgb | null, population: number }} PaletteEntry
 */

/**
 * Build UI palette entries from a generated palette and optional overrides.
 * @param {Array<{ r: number, g: number, b: number, population: number }>} generatedPalette
 * @param {Array<Rgb | null | undefined>} [overrides]
 * @returns {PaletteEntry[]}
 */
export function buildPaletteEntries(generatedPalette, overrides = []) {
  return generatedPalette.map((color, index) => {
    const raw = overrides[index];
    const override = raw && typeof raw === "object"
      ? { r: clampByte(raw.r), g: clampByte(raw.g), b: clampByte(raw.b) }
      : null;
    return {
      generated: { r: color.r, g: color.g, b: color.b },
      override,
      population: color.population,
    };
  });
}

/**
 * Effective display/print color: override ?? generated.
 * @param {PaletteEntry} entry
 * @returns {Rgb}
 */
export function effectiveColor(entry) {
  return entry.override ? { ...entry.override } : { ...entry.generated };
}

/**
 * @param {PaletteEntry[]} entries
 * @returns {Rgb[]}
 */
export function effectivePalette(entries) {
  return entries.map(effectiveColor);
}

/**
 * Replace one palette override (or clear with null).
 * Does not mutate the generated colors.
 * @param {Array<Rgb | null>} overrides
 * @param {number} index
 * @param {Rgb | null} color
 * @param {number} paletteLength
 * @returns {Array<Rgb | null>}
 */
export function replacePaletteColor(overrides, index, color, paletteLength) {
  if (!Number.isInteger(index) || index < 0 || index >= paletteLength) {
    throw toError(
      createQuantizeError(
        QuantizeErrorCode.INVALID_REQUEST,
        `Palette index ${index} is out of range.`,
        { index, paletteLength },
      ),
    );
  }
  const next = normalizeOverrides(overrides, paletteLength);
  next[index] = color
    ? { r: clampByte(color.r), g: clampByte(color.g), b: clampByte(color.b) }
    : null;
  return next;
}

/**
 * Clear all overrides.
 * @param {number} paletteLength
 * @returns {Array<null>}
 */
export function resetPaletteOverrides(paletteLength) {
  return Array.from({ length: Math.max(0, paletteLength) }, () => null);
}

/**
 * @param {Array<Rgb | null | undefined>} overrides
 * @param {number} length
 * @returns {Array<Rgb | null>}
 */
export function normalizeOverrides(overrides, length) {
  /** @type {Array<Rgb | null>} */
  const next = [];
  for (let i = 0; i < length; i += 1) {
    const raw = overrides[i];
    next.push(
      raw && typeof raw === "object"
        ? { r: clampByte(raw.r), g: clampByte(raw.g), b: clampByte(raw.b) }
        : null,
    );
  }
  return next;
}

/**
 * Strict #RRGGBB (optional leading #). Rejects shorthand and alpha.
 * @param {string} text
 * @returns {{ ok: true, value: Rgb } | { ok: false, reason: string }}
 */
export function parseHexColor(text) {
  const raw = String(text ?? "").trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(raw);
  if (!m) {
    return { ok: false, reason: "Color must be a 6-digit hexadecimal value (e.g. #A1B2C3)." };
  }
  const hex = m[1];
  return {
    ok: true,
    value: {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    },
  };
}

/**
 * @param {Rgb} color
 * @returns {string} uppercase #RRGGBB
 */
export function formatHexColor(color) {
  return `#${byteHex(color.r)}${byteHex(color.g)}${byteHex(color.b)}`;
}

/** @param {number} n */
function byteHex(n) {
  return clampByte(n).toString(16).padStart(2, "0").toUpperCase();
}

/** @param {number} n */
function clampByte(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(255, Math.max(0, Math.round(n)));
}
