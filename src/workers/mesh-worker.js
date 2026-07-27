/**
 * Mesh generation worker (Milestone 4–6).
 */

import { generateTileGeometry } from "../geometry/generate-geometry.js";
import { GeometryErrorCode, createGeometryError } from "../geometry/geometry-errors.js";
import {
  MeshWorkerMessageType,
  validateMeshGenerateRequest,
  createMeshGenerateSuccessMessage,
  createMeshGenerateErrorMessage,
  serializeGeometryResult,
} from "./mesh-worker-protocol.js";

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== MeshWorkerMessageType.GENERATE) {
    self.postMessage({
      type: MeshWorkerMessageType.GENERATE_ERROR,
      ok: false,
      error: createGeometryError(
        GeometryErrorCode.INVALID_REQUEST,
        "mesh-worker only handles mesh-generate messages.",
      ),
      requestId: data && data.requestId,
    });
    return;
  }

  const validated = validateMeshGenerateRequest(data);
  if (!validated.ok) {
    self.postMessage(
      createMeshGenerateErrorMessage({
        requestId: data.requestId,
        sourceRevision: data.sourceRevision,
        printabilityRevision: data.printabilityRevision,
        geometryRevision: data.geometryRevision,
        error: validated.error,
      }),
    );
    return;
  }

  const { requestId, sourceRevision, printabilityRevision, geometryRevision, payload } = validated.value;

  try {
    const workerStarted = performance.now();
    const cleanedIndices = new Uint8Array(
      payload.cleanedIndicesBuffer,
      0,
      payload.width * payload.height,
    );
    // Copy so generation never depends on a detached caller buffer unexpectedly
    const indicesCopy = new Uint8Array(cleanedIndices);

    const geometry = generateTileGeometry({
      cleanedIndices: indicesCopy,
      width: payload.width,
      height: payload.height,
      geometryRevision,
      segments: payload.segments,
      surfaceStyle: payload.surfaceStyle,
      reliefStrengthId: payload.reliefStrengthId,
      heightOrder: payload.heightOrder,
      colorHeightLevels: payload.colorHeightLevels,
      effectivePalette: payload.effectivePalette,
      collectDiagnostics: true,
      now: () => performance.now(),
    });
    geometry.diagnostics = {
      ...(geometry.diagnostics || {}),
      workerDurationMs: performance.now() - workerStarted,
    };

    const { result, transfer } = serializeGeometryResult(geometry);
    self.postMessage(
      createMeshGenerateSuccessMessage({
        requestId,
        sourceRevision,
        printabilityRevision,
        geometryRevision,
        result,
      }),
      transfer,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage(
      createMeshGenerateErrorMessage({
        requestId,
        sourceRevision,
        printabilityRevision,
        geometryRevision,
        error: createGeometryError(GeometryErrorCode.INTERNAL, message),
      }),
    );
  }
});
