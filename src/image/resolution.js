/**
 * Quantization output resolution for Tile V1.
 */

import { TILE_V1 } from "../geometry/tile-spec.js";
import { MAX_QUANTIZATION_PIXELS } from "../config.js";
import { QuantizeErrorCode, createQuantizeError, toError } from "./quantize-errors.js";

/**
 * @typedef {{ widthPx: number, heightPx: number, totalPixels: number }} QuantizationSize
 */

/**
 * Compute output pixel dimensions from pixels-per-millimetre.
 * widthPx = round(148 × ppm), heightPx = round(53 × ppm).
 *
 * @param {number} pixelsPerMm
 * @param {{ widthMm?: number, heightMm?: number, maxPixels?: number }} [opts]
 * @returns {QuantizationSize}
 */
export function computeQuantizationSize(pixelsPerMm, opts = {}) {
  const widthMm = opts.widthMm ?? TILE_V1.widthMm;
  const heightMm = opts.heightMm ?? TILE_V1.heightMm;
  const maxPixels = opts.maxPixels ?? MAX_QUANTIZATION_PIXELS;

  if (!Number.isFinite(pixelsPerMm) || pixelsPerMm <= 0) {
    throw toError(
      createQuantizeError(
        QuantizeErrorCode.INVALID_PIXELS_PER_MM,
        "Pixels per millimetre must be a finite positive number.",
        { pixelsPerMm },
      ),
    );
  }

  const widthPx = Math.round(widthMm * pixelsPerMm);
  const heightPx = Math.round(heightMm * pixelsPerMm);

  if (!Number.isInteger(widthPx) || !Number.isInteger(heightPx) || widthPx < 1 || heightPx < 1) {
    throw toError(
      createQuantizeError(
        QuantizeErrorCode.INVALID_DIMENSIONS,
        "Quantization width and height must be positive integers.",
        { widthPx, heightPx, pixelsPerMm },
      ),
    );
  }

  const totalPixels = widthPx * heightPx;
  if (totalPixels > maxPixels) {
    throw toError(
      createQuantizeError(
        QuantizeErrorCode.PIXEL_LIMIT_EXCEEDED,
        `Requested resolution ${widthPx}×${heightPx} (${totalPixels} pixels) exceeds the limit of ${maxPixels} pixels. Lower pixels per millimetre.`,
        { widthPx, heightPx, totalPixels, maxPixels },
      ),
    );
  }

  return { widthPx, heightPx, totalPixels };
}

/**
 * Non-throwing validation helper for UI enable/disable.
 * @param {number} pixelsPerMm
 * @param {{ maxPixels?: number }} [opts]
 * @returns {{ ok: true, value: QuantizationSize } | { ok: false, error: import("./quantize-errors.js").QuantizeError }}
 */
export function validateQuantizationResolution(pixelsPerMm, opts = {}) {
  try {
    return { ok: true, value: computeQuantizationSize(pixelsPerMm, opts) };
  } catch (err) {
    const q = err && typeof err === "object" && "quantize" in err
      ? /** @type {{ quantize: import("./quantize-errors.js").QuantizeError }} */ (err).quantize
      : createQuantizeError(
        QuantizeErrorCode.INVALID_PIXELS_PER_MM,
        err instanceof Error ? err.message : String(err),
      );
    return { ok: false, error: q };
  }
}
