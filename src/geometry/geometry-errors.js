/**
 * Structured geometry / mesh generation errors.
 */

export const GeometryErrorCode = Object.freeze({
  INVALID_REQUEST: "GEOMETRY_INVALID_REQUEST",
  NOT_READY: "GEOMETRY_NOT_READY",
  STALE_INPUT: "GEOMETRY_STALE_INPUT",
  MISSING_CLEANUP: "GEOMETRY_MISSING_CLEANUP",
  VALIDATION_FAILED: "GEOMETRY_VALIDATION_FAILED",
  EMPTY_MESH: "GEOMETRY_EMPTY_MESH",
  DEGENERATE_TRIANGLE: "GEOMETRY_DEGENERATE_TRIANGLE",
  OUT_OF_BOUNDS: "GEOMETRY_OUT_OF_BOUNDS",
  SERIALIZE_FAILED: "GEOMETRY_SERIALIZE_FAILED",
  INTERNAL: "GEOMETRY_INTERNAL",
});

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [details]
 * @returns {{ code: string, message: string, details?: unknown }}
 */
export function createGeometryError(code, message, details) {
  /** @type {{ code: string, message: string, details?: unknown }} */
  const err = { code, message };
  if (details !== undefined) err.details = details;
  return err;
}
