/**
 * Image worker — deterministic quantization + printability cleanup off the main thread.
 * Reusable single instance; imports pure modules (no DOM).
 */

import { quantizeImage } from "../image/quantize.js";
import { QuantizeErrorCode, createQuantizeError } from "../image/quantize-errors.js";
import { analyzePrintability } from "../image/printability.js";
import {
  PrintabilityErrorCode,
  createPrintabilityError,
} from "../image/printability-errors.js";
import {
  WorkerMessageType,
  validateQuantizeRequest,
  createQuantizeSuccessMessage,
  createQuantizeErrorMessage,
  validatePrintabilityRequest,
  createPrintabilitySuccessMessage,
  createPrintabilityErrorMessage,
} from "./image-worker-protocol.js";

self.addEventListener("message", (event) => {
  const data = event.data;
  const requestId = data && data.requestId != null ? String(data.requestId) : "";
  const sourceRevision = data && Number.isInteger(data.sourceRevision) ? data.sourceRevision : -1;
  const printabilityRevision = data && Number.isInteger(data.printabilityRevision)
    ? data.printabilityRevision
    : -1;

  if (data && data.type === WorkerMessageType.PRINTABILITY) {
    handlePrintability(data, requestId, sourceRevision, printabilityRevision);
    return;
  }

  try {
    const validated = validateQuantizeRequest(data);
    if (!validated.ok) {
      self.postMessage(
        createQuantizeErrorMessage({
          requestId: requestId || "unknown",
          sourceRevision,
          error: validated.error,
        }),
      );
      return;
    }

    const { payload } = validated.value;
    const rgba = new Uint8ClampedArray(payload.rgbaBuffer);
    const started = performance.now();
    const result = quantizeImage(rgba, {
      width: payload.width,
      height: payload.height,
      colorCount: payload.colorCount,
      algorithmVersion: payload.algorithmVersion,
      sourceRevision: validated.value.sourceRevision,
      now: () => performance.now(),
    });
    result.diagnostics.durationMs = performance.now() - started;

    const indicesBuffer = result.indices.buffer.slice(
      result.indices.byteOffset,
      result.indices.byteOffset + result.indices.byteLength,
    );

    const message = createQuantizeSuccessMessage({
      requestId: validated.value.requestId,
      sourceRevision: validated.value.sourceRevision,
      result: {
        width: result.width,
        height: result.height,
        requestedColorCount: result.requestedColorCount,
        actualColorCount: result.actualColorCount,
        generatedPalette: result.generatedPalette,
        indicesBuffer,
        algorithmVersion: result.algorithmVersion,
        diagnostics: result.diagnostics,
      },
    });

    self.postMessage(message, [indicesBuffer]);
  } catch (err) {
    const quantize = err && typeof err === "object" && "quantize" in err
      ? /** @type {{ quantize: import("../image/quantize-errors.js").QuantizeError }} */ (err).quantize
      : createQuantizeError(
        QuantizeErrorCode.WORKER_FAILURE,
        err instanceof Error ? err.message : String(err),
      );
    self.postMessage(
      createQuantizeErrorMessage({
        requestId: requestId || "unknown",
        sourceRevision,
        error: quantize,
      }),
    );
  }
});

/**
 * @param {object} data
 * @param {string} requestId
 * @param {number} sourceRevision
 * @param {number} printabilityRevision
 */
function handlePrintability(data, requestId, sourceRevision, printabilityRevision) {
  try {
    const validated = validatePrintabilityRequest(data);
    if (!validated.ok) {
      self.postMessage(
        createPrintabilityErrorMessage({
          requestId: requestId || "unknown",
          sourceRevision,
          printabilityRevision,
          error: validated.error,
        }),
      );
      return;
    }

    const { payload } = validated.value;
    const started = performance.now();
    const indices = new Uint8Array(payload.indicesBuffer);
    const analysis = analyzePrintability(indices, {
      width: payload.width,
      height: payload.height,
      minimumFeatureWidthMm: payload.minimumFeatureWidthMm,
      minimumGapWidthMm: payload.minimumGapWidthMm,
      minimumIslandAreaMm2: payload.minimumIslandAreaMm2,
      maximumHoleAreaToFillMm2: payload.maximumHoleAreaToFillMm2,
      tileWidthMm: payload.tileWidthMm,
      tileHeightMm: payload.tileHeightMm,
      runCleanup: payload.runCleanup,
      maxPasses: payload.maxPasses,
    });
    const durationMs = performance.now() - started;

    const issueMaskBuffer = analysis.issueMask.buffer.slice(
      analysis.issueMask.byteOffset,
      analysis.issueMask.byteOffset + analysis.issueMask.byteLength,
    );
    /** @type {Transferable[]} */
    const transfer = [issueMaskBuffer];
    let cleanedBuffer = null;
    if (analysis.cleanedIndices) {
      cleanedBuffer = analysis.cleanedIndices.buffer.slice(
        analysis.cleanedIndices.byteOffset,
        analysis.cleanedIndices.byteOffset + analysis.cleanedIndices.byteLength,
      );
      transfer.push(cleanedBuffer);
    }

    const message = createPrintabilitySuccessMessage({
      requestId: validated.value.requestId,
      sourceRevision: validated.value.sourceRevision,
      printabilityRevision: validated.value.printabilityRevision,
      result: {
        width: analysis.width,
        height: analysis.height,
        issueMaskBuffer,
        cleanedIndicesBuffer: cleanedBuffer,
        report: analysis.report,
        algorithmVersion: analysis.algorithmVersion,
        ranCleanup: Boolean(payload.runCleanup),
        diagnostics: {
          durationMs,
          mode: payload.runCleanup ? "automatic-fix" : "printability-analysis",
        },
      },
    });

    self.postMessage(message, transfer);
  } catch (err) {
    const printability = err && typeof err === "object" && "printability" in err
      ? /** @type {{ printability: import("../image/printability-errors.js").PrintabilityError }} */ (err).printability
      : createPrintabilityError(
        PrintabilityErrorCode.WORKER_FAILURE,
        err instanceof Error ? err.message : String(err),
      );
    self.postMessage(
      createPrintabilityErrorMessage({
        requestId: requestId || "unknown",
        sourceRevision,
        printabilityRevision,
        error: printability,
      }),
    );
  }
}

export const IMAGE_WORKER_READY = true;
