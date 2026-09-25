/**
 * Privacy-safe baseline diagnostics schema (numbers, booleans, and fixed identifiers).
 */

export const DIAGNOSTICS_SCHEMA_VERSION = 1;
export const MAX_WORKFLOW_RECORDS = 64;
export const MAX_STAGE_RECORDS = 128;

export const WORKFLOW_KEYS = Object.freeze([
  "caseId",
  "profileId",
  "colorCount",
  "surfaceStyle",
  "exportFormat",
  "totalDurationMs",
  "workerRequests",
  "workerCompletions",
  "supersededRequests",
  "geometryBuilds",
  "duplicateBuilds",
  "longTaskCount",
  "longTaskDurationMs",
  "vertexCount",
  "triangleCount",
  "combinedVertexCount",
  "combinedTriangleCount",
  "baseVertexCount",
  "baseTriangleCount",
  "backingVertexCount",
  "backingTriangleCount",
  "artworkVertexCount",
  "artworkTriangleCount",
  "stlBytes",
  "xmlBytes",
  "zipBytes",
  "finalFileBytes",
]);

export const STAGE_KEYS = Object.freeze([
  "caseId",
  "stageId",
  "durationMs",
  "workerDurationMs",
  "roundTripDurationMs",
  "queueTransferDelayEstimateMs",
]);

export const EXACT_BYTE_KEYS = Object.freeze([
  "sourceFixtureRgba",
  "rasterRgba",
  "quantizedIndices",
  "previewRgba",
  "issueMask",
  "cleanedIndices",
  "meshPositions",
  "meshTriangles",
  "stl",
  "xmlUtf8",
  "zip",
  "finalFile",
]);

export const ESTIMATE_KEYS = Object.freeze([
  "xmlUtf16LogicalPayload",
  "knownLiveBufferLowerBound",
]);

export const SUMMARY_KEYS = Object.freeze([
  "caseCount",
  "elapsedMs",
  "workerRequests",
  "workerCompletions",
  "supersededRequests",
  "geometryBuilds",
  "duplicateBuilds",
  "longTaskObservationSupported",
  "longTaskCount",
  "longTaskDurationMs",
  "inMemoryAdapterInvocations",
]);

const FIXED_STRING_PATTERNS = Object.freeze({
  caseId: /^[a-z0-9-]{1,64}$/,
  profileId: /^nozzle0[24]$/,
  surfaceStyle: /^(flat|relief)$/,
  exportFormat: /^(stl|3mf)$/,
  stageId: /^[a-z0-9-]{1,48}$/,
});

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Copy only explicitly allowed scalar fields.
 * Unknown or user-derived values are dropped rather than serialized.
 */
export function sanitizeDiagnosticRecord(input, allowedKeys) {
  const source = input && typeof input === "object" ? input : {};
  const out = {};
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    const pattern = FIXED_STRING_PATTERNS[key];
    if (pattern) {
      if (typeof value === "string" && pattern.test(value)) out[key] = value;
      continue;
    }
    if (typeof value === "boolean" || finiteNonNegative(value)) {
      out[key] = value;
    }
  }
  return out;
}

export function sanitizeByteRecord(input, allowedKeys) {
  const source = input && typeof input === "object" ? input : {};
  const out = {};
  for (const key of allowedKeys) {
    const value = source[key];
    if (Number.isSafeInteger(value) && value >= 0) out[key] = value;
  }
  return out;
}
