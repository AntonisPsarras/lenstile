/**
 * Structured printability / cleanup worker error helpers.
 */

/**
 * @typedef {{ code: string, message: string, details?: unknown }} PrintabilityError
 */

export const PrintabilityErrorCode = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_DIMENSIONS: "INVALID_DIMENSIONS",
  INVALID_INDICES_LENGTH: "INVALID_INDICES_LENGTH",
  NO_QUANTIZATION: "NO_QUANTIZATION",
  STALE_RESULT: "STALE_RESULT",
  WORKER_FAILURE: "WORKER_FAILURE",
});

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [details]
 * @returns {PrintabilityError}
 */
export function createPrintabilityError(code, message, details) {
  /** @type {PrintabilityError} */
  const err = { code, message };
  if (details !== undefined) err.details = details;
  return err;
}

/**
 * @param {PrintabilityError} error
 * @returns {Error & { printability: PrintabilityError }}
 */
export function toPrintabilityError(error) {
  const e = /** @type {Error & { printability: PrintabilityError }} */ (new Error(error.message));
  e.printability = error;
  return e;
}
