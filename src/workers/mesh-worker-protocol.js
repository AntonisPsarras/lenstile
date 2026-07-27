/**
 * Mesh worker message protocol (main thread + worker).
 */

import { GEOMETRY_ALGORITHM_VERSION } from "../geometry/tile-spec.js";
import { GeometryErrorCode, createGeometryError } from "../geometry/geometry-errors.js";

export const MeshWorkerMessageType = Object.freeze({
  GENERATE: "mesh-generate",
  GENERATE_SUCCESS: "mesh-generate-success",
  GENERATE_ERROR: "mesh-generate-error",
});

/**
 * @param {unknown} message
 * @returns {{ ok: true, value: object } | { ok: false, error: ReturnType<typeof createGeometryError> }}
 */
export function validateMeshGenerateRequest(message) {
  if (!message || typeof message !== "object") {
    return {
      ok: false,
      error: createGeometryError(GeometryErrorCode.INVALID_REQUEST, "Request must be an object."),
    };
  }
  const msg = /** @type {Record<string, unknown>} */ (message);
  if (msg.type !== MeshWorkerMessageType.GENERATE) {
    return {
      ok: false,
      error: createGeometryError(
        GeometryErrorCode.INVALID_REQUEST,
        `Unsupported message type "${String(msg.type)}".`,
      ),
    };
  }
  if (typeof msg.requestId !== "string" || !msg.requestId) {
    return {
      ok: false,
      error: createGeometryError(GeometryErrorCode.INVALID_REQUEST, "requestId must be a non-empty string."),
    };
  }
  if (!Number.isInteger(msg.sourceRevision)) {
    return {
      ok: false,
      error: createGeometryError(GeometryErrorCode.INVALID_REQUEST, "sourceRevision must be an integer."),
    };
  }
  if (!Number.isInteger(msg.printabilityRevision)) {
    return {
      ok: false,
      error: createGeometryError(GeometryErrorCode.INVALID_REQUEST, "printabilityRevision must be an integer."),
    };
  }
  if (!Number.isInteger(msg.geometryRevision)) {
    return {
      ok: false,
      error: createGeometryError(GeometryErrorCode.INVALID_REQUEST, "geometryRevision must be an integer."),
    };
  }
  const payload = msg.payload;
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      error: createGeometryError(GeometryErrorCode.INVALID_REQUEST, "payload is required."),
    };
  }
  const p = /** @type {Record<string, unknown>} */ (payload);
  const width = p.width;
  const height = p.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || /** @type {number} */ (width) < 1 || /** @type {number} */ (height) < 1) {
    return {
      ok: false,
      error: createGeometryError(
        GeometryErrorCode.INVALID_REQUEST,
        "payload.width and payload.height must be positive integers.",
        { width, height },
      ),
    };
  }
  if (!(p.cleanedIndicesBuffer instanceof ArrayBuffer)) {
    return {
      ok: false,
      error: createGeometryError(
        GeometryErrorCode.INVALID_REQUEST,
        "payload.cleanedIndicesBuffer must be an ArrayBuffer.",
      ),
    };
  }
  const expected = /** @type {number} */ (width) * /** @type {number} */ (height);
  if (p.cleanedIndicesBuffer.byteLength < expected) {
    return {
      ok: false,
      error: createGeometryError(
        GeometryErrorCode.INVALID_REQUEST,
        "cleanedIndicesBuffer is shorter than width × height.",
      ),
    };
  }

  /** @type {Array<{ r: number, g: number, b: number }>} */
  let effectivePalette = [];
  if (Array.isArray(p.effectivePalette)) {
    effectivePalette = p.effectivePalette.map((c) => {
      const row = c && typeof c === "object" ? /** @type {Record<string, unknown>} */ (c) : {};
      return {
        r: Number(row.r) || 0,
        g: Number(row.g) || 0,
        b: Number(row.b) || 0,
      };
    });
  }

  /** @type {Array<{ paletteIndex: number, levelIndex: number }>} */
  let colorHeightLevels = [];
  if (Array.isArray(p.colorHeightLevels)) {
    for (const entry of p.colorHeightLevels) {
      if (!entry || typeof entry !== "object") continue;
      const row = /** @type {Record<string, unknown>} */ (entry);
      const paletteIndex = Number(row.paletteIndex);
      const levelIndex = Number(row.levelIndex);
      if (!Number.isInteger(paletteIndex) || !Number.isInteger(levelIndex)) continue;
      colorHeightLevels.push({ paletteIndex, levelIndex });
    }
  }

  return {
    ok: true,
    value: {
      type: msg.type,
      requestId: msg.requestId,
      sourceRevision: msg.sourceRevision,
      printabilityRevision: msg.printabilityRevision,
      geometryRevision: msg.geometryRevision,
      payload: {
        width,
        height,
        cleanedIndicesBuffer: p.cleanedIndicesBuffer,
        algorithmVersion: p.algorithmVersion ?? GEOMETRY_ALGORITHM_VERSION,
        segments: p.segments,
        surfaceStyle: typeof p.surfaceStyle === "string" ? p.surfaceStyle : "flat",
        reliefStrengthId: typeof p.reliefStrengthId === "string" ? p.reliefStrengthId : "standard",
        heightOrder: typeof p.heightOrder === "string" ? p.heightOrder : "darkest-highest",
        colorHeightLevels,
        effectivePalette,
      },
    },
  };
}

/**
 * @param {object} opts
 */
export function createMeshGenerateSuccessMessage(opts) {
  return {
    type: MeshWorkerMessageType.GENERATE_SUCCESS,
    requestId: opts.requestId,
    sourceRevision: opts.sourceRevision,
    printabilityRevision: opts.printabilityRevision,
    geometryRevision: opts.geometryRevision,
    result: opts.result,
  };
}

/**
 * @param {object} opts
 */
export function createMeshGenerateErrorMessage(opts) {
  return {
    type: MeshWorkerMessageType.GENERATE_ERROR,
    requestId: opts.requestId,
    sourceRevision: opts.sourceRevision,
    printabilityRevision: opts.printabilityRevision,
    geometryRevision: opts.geometryRevision,
    error: opts.error,
  };
}

/**
 * Pack GeneratedGeometry into transferable message payload.
 * @param {import("../geometry/generate-geometry.js").GeneratedGeometry} geometry
 */
export function serializeGeometryResult(geometry) {
  /** @type {Transferable[]} */
  const transfer = [];

  /**
   * @param {import("../geometry/mesh.js").PackedMesh} mesh
   */
  function pack(mesh) {
    const positions = mesh.positions.buffer.slice(
      mesh.positions.byteOffset,
      mesh.positions.byteOffset + mesh.positions.byteLength,
    );
    const triangles = mesh.triangles.buffer.slice(
      mesh.triangles.byteOffset,
      mesh.triangles.byteOffset + mesh.triangles.byteLength,
    );
    transfer.push(positions, triangles);
    return {
      positionsBuffer: positions,
      positionsLength: mesh.positions.length,
      trianglesBuffer: triangles,
      trianglesLength: mesh.triangles.length,
    };
  }

  const result = {
    geometryRevision: geometry.geometryRevision,
    algorithmVersion: geometry.algorithmVersion,
    width: geometry.width,
    height: geometry.height,
    ok: geometry.ok,
    reasons: geometry.reasons.slice(),
    userMessage: geometry.userMessage || null,
    diagnostics: geometry.diagnostics || null,
    validation: serializeValidation(geometry.validation),
    combined: pack(geometry.combined),
    base: pack(geometry.base),
    backing: geometry.backing ? pack(geometry.backing) : null,
    backingCellCount: geometry.backingCellCount || geometry.keepoutCellCount || 0,
    roof: geometry.backing
      ? pack(geometry.backing)
      : (geometry.roof ? pack(geometry.roof) : null),
    keepoutCellCount: geometry.backingCellCount || geometry.keepoutCellCount || 0,
    colors: geometry.colors.map((c) => ({
      paletteIndex: c.paletteIndex,
      population: c.population,
      mesh: pack(c.mesh),
    })),
  };

  return { result, transfer };
}

/**
 * Keep validation diagnostics without non-cloneable fields.
 * @param {object} validation
 */
function serializeValidation(validation) {
  /**
   * @param {object} [v]
   */
  function slim(v) {
    if (!v) return v;
    return {
      ok: v.ok,
      reasons: v.reasons,
      vertexCount: v.vertexCount,
      triangleCount: v.triangleCount,
      bounds: v.bounds,
      signedVolume: v.signedVolume,
      edgeSummary: v.edgeSummary,
      badEdge: v.badEdge,
      badEdges: v.badEdges,
      duplicateTriangles: v.duplicateTriangles,
      objectName: v.objectName,
    };
  }
  return {
    combined: slim(validation.combined),
    base: slim(validation.base),
    backing: slim(validation.backing),
    roof: slim(validation.backing || validation.roof),
    colors: (validation.colors || []).map(slim),
  };
}

/**
 * @param {object} packed
 * @returns {import("../geometry/mesh.js").PackedMesh}
 */
export function deserializePackedMesh(packed) {
  return {
    positions: new Float64Array(packed.positionsBuffer, 0, packed.positionsLength),
    triangles: new Uint32Array(packed.trianglesBuffer, 0, packed.trianglesLength),
  };
}
