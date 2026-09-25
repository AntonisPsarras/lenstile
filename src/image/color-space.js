/**
 * Color helpers for deterministic RGB quantization.
 *
 * Luminance (palette ordering only): Rec. 709 luma
 *   Y = 0.2126 * R + 0.7152 * G + 0.0722 * B
 * with R,G,B in 0..255. Not used for clustering distance.
 */

/**
 * Pack 8-bit RGB into a 24-bit integer (R in high bits).
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number}
 */
export function packRgb(r, g, b) {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

/**
 * @param {number} packed
 * @returns {{ r: number, g: number, b: number }}
 */
export function unpackRgb(packed) {
  return {
    r: (packed >>> 16) & 255,
    g: (packed >>> 8) & 255,
    b: packed & 255,
  };
}

/**
 * Rec. 709 luma for stable palette ordering (not perceptual Lab).
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number}
 */
export function rgbLuminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Squared Euclidean distance in RGB.
 * @param {number} r1
 * @param {number} g1
 * @param {number} b1
 * @param {number} r2
 * @param {number} g2
 * @param {number} b2
 * @returns {number}
 */
export function rgbDistanceSquared(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

/**
 * Round a channel mean to an 8-bit integer.
 * Rule: Math.round (half away from zero for positive values), then clamp to [0, 255].
 * @param {number} value
 * @returns {number}
 */
export function roundChannel(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * Lab conversion is unused; RGB clustering does not require it.
 * @throws {Error}
 */
export function rgbToLab() {
  throw new Error("rgbToLab is not used by Milestone 2 RGB clustering.");
}
