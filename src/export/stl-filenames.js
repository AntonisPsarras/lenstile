/**
 * Safe STL / 3MF filename generation.
 */

import { DEFAULT_EXPORT_BASENAME } from "../config.js";

/**
 * Sanitize a name for use in download filenames.
 * Strips control characters and path/spoofing punctuation; empty → default basename.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilenameBase(name) {
  const raw = typeof name === "string" ? name.trim() : "";
  const withoutControls = raw.replace(/[\u0000-\u001f\u007f-\u009f]+/g, "-");
  const lowered = withoutControls.toLowerCase();
  const replaced = lowered
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return replaced || DEFAULT_EXPORT_BASENAME;
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string} hex without '#'
 */
export function rgbToFilenameHex(r, g, b) {
  const toHex = (n) => {
    const v = Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
    return v.toString(16).toUpperCase().padStart(2, "0");
  };
  return `${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Single-color combined STL filename.
 * @param {string} projectName
 * @param {{ relief?: boolean }} [opts]
 */
export function combinedStlFilename(projectName, opts = {}) {
  const base = sanitizeFilenameBase(projectName);
  return opts.relief ? `${base}-relief.stl` : `${base}-smooth.stl`;
}

/**
 * Base object STL filename.
 * @param {string} projectName
 */
export function baseStlFilename(projectName) {
  return `${sanitizeFilenameBase(projectName)}-base.stl`;
}

/**
 * Artwork color STL filename.
 * Object order follows effective palette order; index is 1-based display order among used colors.
 *
 * @param {string} projectName
 * @param {number} displayOrdinal 1-based
 * @param {{ r: number, g: number, b: number }} color
 */
export function colorStlFilename(projectName, displayOrdinal, color) {
  const ord = String(displayOrdinal).padStart(2, "0");
  const hex = rgbToFilenameHex(color.r, color.g, color.b);
  return `${sanitizeFilenameBase(projectName)}-color-${ord}-${hex}.stl`;
}

/**
 * Multicolor 3MF filename.
 * @param {string} projectName
 * @param {{ relief?: boolean }} [opts]
 */
export function multicolorThreeMfFilename(projectName, opts = {}) {
  const base = sanitizeFilenameBase(projectName);
  return opts.relief
    ? `${base}-relief-multicolor.3mf`
    : `${base}-multicolor.3mf`;
}
