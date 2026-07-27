/**
 * Staged multicolor 3MF packaging (Milestone 7.2).
 *
 * Wraps byte generation + validation with explicit stages and structured errors.
 * Does not remesh or mutate geometry buffers.
 */

import {
  createThreeMfBytes,
  createThreeMfPackage,
  assemblyObjectId,
  childObjectIds,
  COLOR_GROUP_ID,
  BASE_OBJECT_ID,
  BACKING_OBJECT_ID,
  ROOF_OBJECT_ID,
  FIRST_ARTWORK_OBJECT_ID,
} from "./three-mf.js";
import { validateThreeMfPackage } from "./three-mf-validate.js";
import { triangleCount, vertexCount } from "../geometry/mesh.js";

/** Explicit packaging stages (Download multicolor 3MF path). */
export const ThreeMfPackagingStage = Object.freeze({
  PREPARE_INPUTS: "prepare-inputs",
  VALIDATE_MESHES: "validate-meshes",
  ALLOCATE_RESOURCE_IDS: "allocate-resource-ids",
  CREATE_MODEL_XML: "create-model-xml",
  VALIDATE_MODEL_XML: "validate-model-xml",
  CREATE_CONTENT_TYPES: "create-content-types",
  CREATE_RELATIONSHIPS: "create-relationships",
  CREATE_ZIP: "create-zip",
  VALIDATE_ZIP: "validate-zip",
  CREATE_BLOB: "create-blob",
  INITIATE_DOWNLOAD: "initiate-download",
});

/** Structured packaging error codes. */
export const ThreeMfPackagingErrorCode = Object.freeze({
  INVALID_INPUT: "THREE_MF_INVALID_INPUT",
  MESH_INVALID: "THREE_MF_MESH_INVALID",
  RESOURCE_ID: "THREE_MF_RESOURCE_ID",
  XML_GENERATE: "THREE_MF_XML_GENERATE",
  XML_VALIDATE: "THREE_MF_XML_VALIDATE",
  ZIP_GENERATE: "THREE_MF_ZIP_GENERATE",
  ZIP_VALIDATE: "THREE_MF_ZIP_VALIDATE",
  BLOB_CREATE: "THREE_MF_BLOB_CREATE",
  DOWNLOAD: "THREE_MF_DOWNLOAD",
  PACKAGE_FAILED: "THREE_MF_PACKAGE_FAILED",
  /** Legacy export-controller count that excluded the parent assembly. */
  STALE_OBJECT_COUNT: "THREE_MF_STALE_OBJECT_COUNT",
});

/**
 * Total 3MF model objects for used artwork colors:
 * base + magnet backing + artwork children + parent assembly.
 * @param {number} usedArtworkColorCount
 * @returns {number}
 */
export function expectedThreeMfObjectCount(usedArtworkColorCount) {
  if (!Number.isInteger(usedArtworkColorCount) || usedArtworkColorCount < 1) {
    throw new Error("expectedThreeMfObjectCount requires a positive integer used-color count.");
  }
  return usedArtworkColorCount + 3;
}

/**
 * Milestone 7 (pre-assembly) formula — retained only to reproduce the M7.2 failure.
 * @param {number} usedArtworkColorCount
 * @returns {number}
 */
export function staleExpectedObjectCountWithoutParent(usedArtworkColorCount) {
  return usedArtworkColorCount + 1;
}

/**
 * Explicit palette → color-group / child-object mappings.
 * pindex values are dense 0-based indices into the color group; they are never
 * assumed equal to original palette indices. Magnet backing shares base pindex 0
 * and is not counted as an image color.
 *
 * @param {Array<{ paletteIndex: number }>} colorMeshes used-order artwork entries
 * @returns {{
 *   colorGroupId: number,
 *   baseObjectId: number,
 *   backingObjectId: number,
 *   roofObjectId: number,
 *   parentObjectId: number,
 *   childObjectIds: number[],
 *   paletteIndexToColorGroupIndex: Map<number, number>,
 *   paletteIndexToChildObjectId: Map<number, number>,
 *   colorGroupEntries: Array<{ colorGroupIndex: number, role: string, paletteIndex: number | null }>,
 * }}
 */
export function buildColorResourceMapping(colorMeshes) {
  if (!Array.isArray(colorMeshes) || colorMeshes.length < 1) {
    throw createPackagingError({
      code: ThreeMfPackagingErrorCode.INVALID_INPUT,
      stage: ThreeMfPackagingStage.ALLOCATE_RESOURCE_IDS,
      message: "Color resource mapping requires at least one artwork mesh.",
    });
  }
  const used = colorMeshes.length;
  /** @type {Map<number, number>} */
  const paletteIndexToColorGroupIndex = new Map();
  /** @type {Map<number, number>} */
  const paletteIndexToChildObjectId = new Map();
  /** @type {Array<{ colorGroupIndex: number, role: string, paletteIndex: number | null }>} */
  const colorGroupEntries = [
    { colorGroupIndex: 0, role: "base", paletteIndex: null },
  ];

  for (let i = 0; i < used; i += 1) {
    const paletteIndex = colorMeshes[i].paletteIndex;
    if (!Number.isInteger(paletteIndex) || paletteIndex < 0) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.RESOURCE_ID,
        stage: ThreeMfPackagingStage.ALLOCATE_RESOURCE_IDS,
        message: `Invalid palette index at artwork slot ${i}.`,
        details: { slot: i, paletteIndex },
      });
    }
    if (paletteIndexToColorGroupIndex.has(paletteIndex)) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.RESOURCE_ID,
        stage: ThreeMfPackagingStage.ALLOCATE_RESOURCE_IDS,
        message: `Duplicate palette index in color meshes: ${paletteIndex}.`,
        details: { paletteIndex },
      });
    }
    const colorGroupIndex = i + 1; // dense; base occupies 0
    const childObjectId = FIRST_ARTWORK_OBJECT_ID + i;
    paletteIndexToColorGroupIndex.set(paletteIndex, colorGroupIndex);
    paletteIndexToChildObjectId.set(paletteIndex, childObjectId);
    colorGroupEntries.push({
      colorGroupIndex,
      role: "artwork",
      paletteIndex,
    });
  }

  return {
    colorGroupId: COLOR_GROUP_ID,
    baseObjectId: BASE_OBJECT_ID,
    backingObjectId: BACKING_OBJECT_ID,
    roofObjectId: ROOF_OBJECT_ID,
    parentObjectId: assemblyObjectId(used),
    childObjectIds: childObjectIds(used),
    paletteIndexToColorGroupIndex,
    paletteIndexToChildObjectId,
    colorGroupEntries,
  };
}

/**
 * @param {{
 *   code: string,
 *   stage: string,
 *   message: string,
 *   details?: object | null,
 *   cause?: unknown,
 * }} opts
 * @returns {Error & {
 *   code: string,
 *   stage: string,
 *   details: object | null,
 *   causeName: string | null,
 *   causeMessage: string | null,
 *   toJSON: () => object,
 * }}
 */
export function createPackagingError(opts) {
  const cause = opts.cause;
  const causeName = cause instanceof Error ? cause.name : (cause != null ? "Error" : null);
  const causeMessage = cause instanceof Error
    ? cause.message
    : (cause != null ? String(cause) : null);
  const err = /** @type {Error & Record<string, unknown>} */ (new Error(opts.message));
  err.name = "ThreeMfPackagingError";
  err.code = opts.code;
  err.stage = opts.stage;
  err.details = opts.details || null;
  err.causeName = causeName;
  err.causeMessage = causeMessage;
  if (cause instanceof Error && cause.stack) {
    err.stack = `${err.stack}\nCaused by: ${cause.stack}`;
  }
  err.toJSON = () => ({
    code: err.code,
    stage: err.stage,
    message: err.message,
    details: err.details,
    causeName: err.causeName,
    causeMessage: err.causeMessage,
  });
  return /** @type {any} */ (err);
}

/**
 * @param {unknown} err
 * @param {string} [fallbackStage]
 * @returns {{
 *   code: string,
 *   stage: string,
 *   message: string,
 *   details: object | null,
 *   causeName: string | null,
 *   causeMessage: string | null,
 * }}
 */
export function normalizePackagingError(err, fallbackStage = ThreeMfPackagingStage.VALIDATE_ZIP) {
  if (err && typeof err === "object" && "code" in err && "stage" in err) {
    const e = /** @type {any} */ (err);
    return {
      code: String(e.code || ThreeMfPackagingErrorCode.PACKAGE_FAILED),
      stage: String(e.stage || fallbackStage),
      message: String(e.message || "The multicolor file could not be created."),
      details: e.details || null,
      causeName: e.causeName || (e.name != null ? String(e.name) : null),
      causeMessage: e.causeMessage || null,
    };
  }
  if (err instanceof Error) {
    return {
      code: ThreeMfPackagingErrorCode.PACKAGE_FAILED,
      stage: fallbackStage,
      message: err.message || "The multicolor file could not be created.",
      details: null,
      causeName: err.name,
      causeMessage: err.message,
    };
  }
  return {
    code: ThreeMfPackagingErrorCode.PACKAGE_FAILED,
    stage: fallbackStage,
    message: String(err || "The multicolor file could not be created."),
    details: null,
    causeName: null,
    causeMessage: null,
  };
}

/**
 * Plain-language UI message (never includes source image / full indices).
 */
export const THREE_MF_USER_ERROR = "The multicolor file could not be created.";

/**
 * Format technical details for the Download panel (no image / indices dump).
 * @param {ReturnType<typeof normalizePackagingError>} error
 * @returns {string}
 */
export function formatThreeMfTechnicalDetails(error) {
  const lines = [
    `Failure stage: ${error.stage}`,
    `Error code: ${error.code}`,
    `Message: ${error.message}`,
  ];
  if (error.causeMessage && error.causeMessage !== error.message) {
    lines.push(`Underlying: ${error.causeName || "Error"}: ${error.causeMessage}`);
  }
  const d = error.details || {};
  if (d.objectId != null) lines.push(`Object ID: ${d.objectId}`);
  if (d.zipPath != null) lines.push(`ZIP path: ${d.zipPath}`);
  if (d.expected != null && d.actual != null) {
    lines.push(`Expected: ${d.expected}`);
    lines.push(`Actual: ${d.actual}`);
  }
  if (d.expectedObjectCount != null && d.actualObjectCount != null) {
    lines.push(`Expected object count: ${d.expectedObjectCount}`);
    lines.push(`Actual object count: ${d.actualObjectCount}`);
  }
  if (Array.isArray(d.reasons) && d.reasons.length) {
    lines.push("Validator reasons:");
    for (const reason of d.reasons.slice(0, 12)) {
      lines.push(`  - ${reason}`);
    }
  }
  if (d.xmlByteLength != null) lines.push(`Model XML bytes: ${d.xmlByteLength}`);
  if (d.zipByteLength != null) lines.push(`ZIP bytes: ${d.zipByteLength}`);
  if (d.totalVertices != null) lines.push(`Total vertices: ${d.totalVertices}`);
  if (d.totalTriangles != null) lines.push(`Total triangles: ${d.totalTriangles}`);
  if (d.objectCount != null) lines.push(`Object count: ${d.objectCount}`);
  return lines.join("\n");
}

/**
 * @param {import("./three-mf.js").createThreeMfBytes extends Function ? any : never} opts
 * @param {{
 *   skipValidation?: boolean,
 *   useStaleObjectCount?: boolean,
 * }} [control]
 * @returns {{
 *   bytes: Uint8Array,
 *   blob: Blob,
 *   filename: string,
 *   manifest: object,
 *   xml: { contentTypes: string, rels: string, model: string },
 *   mapping: ReturnType<typeof buildColorResourceMapping>,
 *   diagnostics: object,
 *   stagesCompleted: string[],
 *   validation: import("./three-mf-validate.js").validateThreeMfPackage extends Function ? any : never,
 * }}
 */
export function packageMulticolorThreeMf(opts, control = {}) {
  const now = typeof control.now === "function"
    ? control.now
    : () => (typeof performance !== "undefined" ? performance.now() : 0);
  const performanceMetrics = control.metrics && typeof control.metrics === "object"
    ? control.metrics
    : null;
  /** @type {string[]} */
  const stagesCompleted = [];
  /** @type {object} */
  const diagnostics = {
    stagesCompleted,
    resourceIds: null,
    mapping: null,
    xmlByteLength: null,
    zipByteLength: null,
    totalVertices: null,
    totalTriangles: null,
    objectCount: null,
    zipEntryNames: null,
    validatorResult: null,
    error: null,
  };

  const mark = (stage) => {
    stagesCompleted.push(stage);
  };

  try {
    mark(ThreeMfPackagingStage.PREPARE_INPUTS);
    if (!opts || !opts.baseMesh) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.INVALID_INPUT,
        stage: ThreeMfPackagingStage.PREPARE_INPUTS,
        message: "3MF requires a base mesh.",
      });
    }
    const backingMesh = opts.backingMesh || opts.roofMesh;
    if (!backingMesh) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.INVALID_INPUT,
        stage: ThreeMfPackagingStage.PREPARE_INPUTS,
        message: "3MF requires a magnet-backing mesh.",
      });
    }
    if (!Array.isArray(opts.colorMeshes) || opts.colorMeshes.length < 2) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.INVALID_INPUT,
        stage: ThreeMfPackagingStage.PREPARE_INPUTS,
        message: "Multicolor 3MF requires at least two used artwork colors.",
        details: { usedColors: opts.colorMeshes ? opts.colorMeshes.length : 0 },
      });
    }
    if (!opts.baseColor) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.INVALID_INPUT,
        stage: ThreeMfPackagingStage.PREPARE_INPUTS,
        message: "3MF requires a base color.",
      });
    }

    mark(ThreeMfPackagingStage.VALIDATE_MESHES);
    if (vertexCount(opts.baseMesh) < 3 || triangleCount(opts.baseMesh) < 1) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.MESH_INVALID,
        stage: ThreeMfPackagingStage.VALIDATE_MESHES,
        message: "Base mesh is empty.",
        details: { objectId: BASE_OBJECT_ID },
      });
    }
    if (vertexCount(backingMesh) < 3 || triangleCount(backingMesh) < 1) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.MESH_INVALID,
        stage: ThreeMfPackagingStage.VALIDATE_MESHES,
        message: "Magnet-backing mesh is empty.",
        details: { objectId: BACKING_OBJECT_ID },
      });
    }
    for (let i = 0; i < opts.colorMeshes.length; i += 1) {
      const entry = opts.colorMeshes[i];
      if (!entry || !entry.mesh || triangleCount(entry.mesh) < 1) {
        throw createPackagingError({
          code: ThreeMfPackagingErrorCode.MESH_INVALID,
          stage: ThreeMfPackagingStage.VALIDATE_MESHES,
          message: `Empty artwork mesh for palette index ${entry && entry.paletteIndex}.`,
          details: {
            objectId: FIRST_ARTWORK_OBJECT_ID + i,
            paletteIndex: entry && entry.paletteIndex,
          },
        });
      }
    }

    // Snapshot buffer identities to detect accidental detach/mutation.
    const basePos = opts.baseMesh.positions;
    const baseTris = opts.baseMesh.triangles;
    const backingPos = backingMesh.positions;
    const backingTris = backingMesh.triangles;
    const colorBuffers = opts.colorMeshes.map((c) => ({
      positions: c.mesh.positions,
      triangles: c.mesh.triangles,
      pos0: c.mesh.positions[0],
      tri0: c.mesh.triangles[0],
    }));

    mark(ThreeMfPackagingStage.ALLOCATE_RESOURCE_IDS);
    const mapping = buildColorResourceMapping(opts.colorMeshes);
    diagnostics.mapping = {
      colorGroupId: mapping.colorGroupId,
      baseObjectId: mapping.baseObjectId,
      backingObjectId: mapping.backingObjectId,
      roofObjectId: mapping.roofObjectId,
      parentObjectId: mapping.parentObjectId,
      childObjectIds: mapping.childObjectIds.slice(),
      colorGroupEntries: mapping.colorGroupEntries.map((e) => ({ ...e })),
      paletteIndexToColorGroupIndex: [...mapping.paletteIndexToColorGroupIndex.entries()],
      paletteIndexToChildObjectId: [...mapping.paletteIndexToChildObjectId.entries()],
    };
    diagnostics.resourceIds = {
      colorGroupId: mapping.colorGroupId,
      baseObjectId: mapping.baseObjectId,
      backingObjectId: mapping.backingObjectId,
      roofObjectId: mapping.roofObjectId,
      artworkObjectIds: mapping.childObjectIds.slice(2),
      parentObjectId: mapping.parentObjectId,
    };

    // Content types / relationships / model XML / ZIP are produced inside createThreeMfBytes.
    mark(ThreeMfPackagingStage.CREATE_CONTENT_TYPES);
    mark(ThreeMfPackagingStage.CREATE_RELATIONSHIPS);
    mark(ThreeMfPackagingStage.CREATE_MODEL_XML);

    let bytesResult;
    try {
      bytesResult = createThreeMfBytes(opts, {
        metrics: performanceMetrics,
        now,
      });
    } catch (cause) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.XML_GENERATE,
        stage: ThreeMfPackagingStage.CREATE_MODEL_XML,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
    }
    mark(ThreeMfPackagingStage.CREATE_ZIP);

    diagnostics.xmlByteLength = new TextEncoder().encode(bytesResult.xml.model).byteLength;
    diagnostics.zipByteLength = bytesResult.bytes.byteLength;
    diagnostics.totalVertices = bytesResult.manifest.vertexCount;
    diagnostics.totalTriangles = bytesResult.manifest.triangleCount;
    diagnostics.objectCount = bytesResult.manifest.objectCount;
    diagnostics.zipEntryNames = ["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"];

    // Buffers must remain attached and unchanged.
    if (opts.baseMesh.positions !== basePos || opts.baseMesh.triangles !== baseTris) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.MESH_INVALID,
        stage: ThreeMfPackagingStage.CREATE_ZIP,
        message: "Packaging detached or replaced the base mesh buffer.",
        details: { objectId: BASE_OBJECT_ID },
      });
    }
    if (backingMesh.positions !== backingPos || backingMesh.triangles !== backingTris) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.MESH_INVALID,
        stage: ThreeMfPackagingStage.CREATE_ZIP,
        message: "Packaging detached or replaced the magnet-backing mesh buffer.",
        details: { objectId: BACKING_OBJECT_ID },
      });
    }
    for (let i = 0; i < colorBuffers.length; i += 1) {
      const c = opts.colorMeshes[i].mesh;
      const snap = colorBuffers[i];
      if (c.positions !== snap.positions || c.triangles !== snap.triangles) {
        throw createPackagingError({
          code: ThreeMfPackagingErrorCode.MESH_INVALID,
          stage: ThreeMfPackagingStage.CREATE_ZIP,
          message: "Packaging detached or replaced an artwork mesh buffer.",
          details: { objectId: FIRST_ARTWORK_OBJECT_ID + i },
        });
      }
      if (c.positions[0] !== snap.pos0 || c.triangles[0] !== snap.tri0) {
        throw createPackagingError({
          code: ThreeMfPackagingErrorCode.MESH_INVALID,
          stage: ThreeMfPackagingStage.CREATE_ZIP,
          message: "Packaging mutated an artwork mesh buffer.",
          details: { objectId: FIRST_ARTWORK_OBJECT_ID + i },
        });
      }
    }

    const used = opts.colorMeshes.length;
    const correctObjectCount = expectedThreeMfObjectCount(used);
    const expectedObjectCount = control.useStaleObjectCount
      ? staleExpectedObjectCountWithoutParent(used)
      : correctObjectCount;

    mark(ThreeMfPackagingStage.VALIDATE_MODEL_XML);
    mark(ThreeMfPackagingStage.VALIDATE_ZIP);

    let validation;
    try {
      const validationStarted = performanceMetrics ? now() : 0;
      validation = validateThreeMfPackage(bytesResult.bytes, {
        expectedObjectCount,
        expectedUsedColors: used,
        expectedChildObjectCount: used + 2,
        baseMesh: opts.baseMesh,
        colorMeshes: opts.colorMeshes,
        baseColor: opts.baseColor,
      });
      if (performanceMetrics) {
        performanceMetrics.packageValidationMs = now() - validationStarted;
      }
    } catch (cause) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.ZIP_VALIDATE,
        stage: ThreeMfPackagingStage.VALIDATE_ZIP,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: {
          xmlByteLength: diagnostics.xmlByteLength,
          zipByteLength: diagnostics.zipByteLength,
        },
      });
    }
    diagnostics.validatorResult = {
      ok: validation.ok,
      reasons: validation.reasons.slice(),
      objectCount: validation.objectCount,
      childObjectCount: validation.childObjectCount,
      buildItemCount: validation.buildItemCount,
      assemblyObjectId: validation.assemblyObjectId,
    };

    if (!validation.ok) {
      const staleMismatch = control.useStaleObjectCount
        && validation.reasons.some((r) => /Expected \d+ objects, found \d+/.test(r));
      throw createPackagingError({
        code: staleMismatch
          ? ThreeMfPackagingErrorCode.STALE_OBJECT_COUNT
          : ThreeMfPackagingErrorCode.XML_VALIDATE,
        stage: ThreeMfPackagingStage.VALIDATE_MODEL_XML,
        message: validation.reasons.join(" ") || "3MF validation failed.",
        details: {
          expectedObjectCount,
          actualObjectCount: validation.objectCount,
          expected: expectedObjectCount,
          actual: validation.objectCount,
          reasons: validation.reasons.slice(),
          xmlByteLength: diagnostics.xmlByteLength,
          zipByteLength: diagnostics.zipByteLength,
          totalVertices: diagnostics.totalVertices,
          totalTriangles: diagnostics.totalTriangles,
          objectCount: validation.objectCount,
        },
      });
    }

    mark(ThreeMfPackagingStage.CREATE_BLOB);
    let blob;
    try {
      const blobStarted = performanceMetrics ? now() : 0;
      blob = new Blob([bytesResult.bytes], { type: "model/3mf" });
      if (performanceMetrics) {
        performanceMetrics.blobConstructionMs = now() - blobStarted;
      }
    } catch (cause) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.BLOB_CREATE,
        stage: ThreeMfPackagingStage.CREATE_BLOB,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
    }
    if (!(blob instanceof Blob) || blob.size < 1) {
      throw createPackagingError({
        code: ThreeMfPackagingErrorCode.BLOB_CREATE,
        stage: ThreeMfPackagingStage.CREATE_BLOB,
        message: "3MF Blob is empty.",
        details: { zipByteLength: bytesResult.bytes.byteLength },
      });
    }

    return {
      bytes: bytesResult.bytes,
      blob,
      filename: bytesResult.filename,
      manifest: bytesResult.manifest,
      xml: bytesResult.xml,
      mapping,
      diagnostics,
      stagesCompleted,
      validation,
    };
  } catch (err) {
    const normalized = normalizePackagingError(err);
    diagnostics.error = normalized;
    if (err && typeof err === "object" && "code" in err && "stage" in err) {
      throw err;
    }
    throw createPackagingError({
      code: normalized.code,
      stage: normalized.stage,
      message: normalized.message,
      details: normalized.details,
      cause: err,
    });
  }
}

/**
 * Build a diagnostics JSON object suitable for download (no mesh / image dumps).
 * @param {object} opts
 */
export function buildThreeMfDiagnosticsJson(opts) {
  return {
    format: "open-tile-3mf-diagnostics",
    formatVersion: 1,
    stagesCompleted: opts.stagesCompleted || [],
    resourceIds: opts.resourceIds || null,
    mapping: opts.mapping || null,
    vertexCount: opts.totalVertices ?? null,
    triangleCount: opts.totalTriangles ?? null,
    xmlByteLength: opts.xmlByteLength ?? null,
    zipByteLength: opts.zipByteLength ?? null,
    objectCount: opts.objectCount ?? null,
    zipEntryNames: opts.zipEntryNames || null,
    validatorResult: opts.validatorResult || null,
    error: opts.error || null,
    filename: opts.filename || null,
    surfaceStyle: opts.surfaceStyle || null,
    packageKey: opts.packageKey || null,
  };
}

// Re-export createThreeMfPackage for callers that only need Blob wrapping.
export { createThreeMfPackage };
