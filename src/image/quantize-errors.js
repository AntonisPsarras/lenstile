/**
 * Structured quantization / worker error helpers.
 */

/**
 * @typedef {{ code: string, message: string, details?: unknown }} QuantizeError
 */

export const QuantizeErrorCode = Object.freeze({
  EMPTY_RGBA: "EMPTY_RGBA",
  INVALID_RGBA_LENGTH: "INVALID_RGBA_LENGTH",
  INVALID_COLOR_COUNT: "INVALID_COLOR_COUNT",
  INVALID_DIMENSIONS: "INVALID_DIMENSIONS",
  INVALID_PIXELS_PER_MM: "INVALID_PIXELS_PER_MM",
  PIXEL_LIMIT_EXCEEDED: "PIXEL_LIMIT_EXCEEDED",
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_BACKGROUND: "INVALID_BACKGROUND",
  NO_SOURCE_IMAGE: "NO_SOURCE_IMAGE",
  WORKER_FAILURE: "WORKER_FAILURE",
  RASTERIZE_FAILURE: "RASTERIZE_FAILURE",
});

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [details]
 * @returns {QuantizeError}
 */
export function createQuantizeError(code, message, details) {
  /** @type {QuantizeError} */
  const err = { code, message };
  if (details !== undefined) err.details = details;
  return err;
}

/**
 * @param {QuantizeError} error
 * @returns {Error & { quantize: QuantizeError }}
 */
export function toError(error) {
  const e = /** @type {Error & { quantize: QuantizeError }} */ (new Error(error.message));
  e.quantize = error;
  return e;
}
