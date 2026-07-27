/**
 * Convert indexed pixels + effective RGB palette into an RGBA buffer.
 * Pure: does not touch the DOM or workers.
 */

import { QuantizeErrorCode, createQuantizeError, toError } from "./quantize-errors.js";

/**
 * @param {Uint8Array} indices
 * @param {Array<{ r: number, g: number, b: number }>} palette
 * @param {number} width
 * @param {number} height
 * @returns {Uint8ClampedArray}
 */
export function indicesToRgba(indices, palette, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw toError(
      createQuantizeError(
        QuantizeErrorCode.INVALID_DIMENSIONS,
        "Preview width and height must be positive integers.",
        { width, height },
      ),
    );
  }
  const expected = width * height;
  if (!indices || indices.length !== expected) {
    throw toError(
      createQuantizeError(
        QuantizeErrorCode.INVALID_RGBA_LENGTH,
        `Index buffer length ${indices ? indices.length : 0} does not match ${expected}.`,
        { length: indices ? indices.length : 0, expected },
      ),
    );
  }
  if (!palette || palette.length < 1) {
    throw toError(
      createQuantizeError(
        QuantizeErrorCode.INVALID_REQUEST,
        "Palette must contain at least one color.",
      ),
    );
  }

  const rgba = new Uint8ClampedArray(expected * 4);
  for (let i = 0; i < expected; i += 1) {
    let idx = indices[i];
    if (idx < 0 || idx >= palette.length) idx = 0;
    const c = palette[idx];
    const o = i * 4;
    rgba[o] = c.r;
    rgba[o + 1] = c.g;
    rgba[o + 2] = c.b;
    rgba[o + 3] = 255;
  }
  return rgba;
}
