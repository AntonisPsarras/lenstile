/**
 * Transparency background policy and source-over compositing.
 *
 * out = source × alpha + background × (1 − alpha)
 * After compositing, every pixel passed to clustering is fully opaque (a = 255).
 */

import { QuantizeErrorCode, createQuantizeError, toError } from "./quantize-errors.js";

/** @typedef {"white" | "black" | "custom"} TransparencyMode */
/** @typedef {{ r: number, g: number, b: number }} Rgb */

export const TRANSPARENCY_MODES = Object.freeze(["white", "black", "custom"]);

/**
 * @param {TransparencyMode} mode
 * @param {Rgb} [custom]
 * @returns {Rgb}
 */
export function resolveBackgroundColor(mode, custom = { r: 255, g: 255, b: 255 }) {
  if (mode === "white") return { r: 255, g: 255, b: 255 };
  if (mode === "black") return { r: 0, g: 0, b: 0 };
  if (mode === "custom") {
    return {
      r: clampByte(custom.r),
      g: clampByte(custom.g),
      b: clampByte(custom.b),
    };
  }
  throw toError(
    createQuantizeError(
      QuantizeErrorCode.INVALID_BACKGROUND,
      `Unknown transparency mode "${mode}".`,
      { mode },
    ),
  );
}

/**
 * Composite one source-over pixel onto an opaque background.
 * Channels are integers 0..255; alpha is 0..255.
 * Uses floating intermediate then Math.round for exact partial-alpha tests.
 *
 * @param {number} sr
 * @param {number} sg
 * @param {number} sb
 * @param {number} sa
 * @param {Rgb} background
 * @returns {{ r: number, g: number, b: number, a: number }}
 */
export function compositeSourceOver(sr, sg, sb, sa, background) {
  const a = clampByte(sa) / 255;
  const inv = 1 - a;
  return {
    r: Math.round(sr * a + background.r * inv),
    g: Math.round(sg * a + background.g * inv),
    b: Math.round(sb * a + background.b * inv),
    a: 255,
  };
}

/**
 * In-place composite of an RGBA buffer over a solid background.
 * Length must be width*height*4. Output alpha is always 255.
 *
 * @param {Uint8ClampedArray | Uint8Array} rgba
 * @param {Rgb} background
 * @returns {Uint8ClampedArray}
 */
export function compositeRgbaOverBackground(rgba, background) {
  if (!(rgba instanceof Uint8ClampedArray) && !(rgba instanceof Uint8Array)) {
    throw toError(
      createQuantizeError(QuantizeErrorCode.EMPTY_RGBA, "RGBA buffer is required."),
    );
  }
  if (rgba.length === 0) {
    throw toError(
      createQuantizeError(QuantizeErrorCode.EMPTY_RGBA, "RGBA buffer is empty."),
    );
  }
  if (rgba.length % 4 !== 0) {
    throw toError(
      createQuantizeError(
        QuantizeErrorCode.INVALID_RGBA_LENGTH,
        "RGBA buffer length must be a multiple of 4.",
        { length: rgba.length },
      ),
    );
  }

  const out = rgba instanceof Uint8ClampedArray
    ? rgba
    : new Uint8ClampedArray(rgba);

  for (let i = 0; i < out.length; i += 4) {
    const composited = compositeSourceOver(out[i], out[i + 1], out[i + 2], out[i + 3], background);
    out[i] = composited.r;
    out[i + 1] = composited.g;
    out[i + 2] = composited.b;
    out[i + 3] = 255;
  }
  return out;
}

/** @param {number} n */
function clampByte(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(255, Math.max(0, Math.round(n)));
}
