/**
 * Shared image-worker message protocol (main thread + worker).
 * Supports quantization (M2) and printability analysis/cleanup (M3).
 */

import { QUANTIZE_ALGORITHM_VERSION, CLEANUP_ALGORITHM_VERSION, MAX_CLEANUP_PASSES } from "../config.js";
import { QuantizeErrorCode, createQuantizeError } from "../image/quantize-errors.js";
import {
  PrintabilityErrorCode,
  createPrintabilityError,
} from "../image/printability-errors.js";

export const WorkerMessageType = Object.freeze({
  QUANTIZE: "quantize",
  QUANTIZE_SUCCESS: "quantize-success",
  QUANTIZE_ERROR: "quantize-error",
  PRINTABILITY: "printability",
  PRINTABILITY_SUCCESS: "printability-success",
  PRINTABILITY_ERROR: "printability-error",
});

/**
 * @param {unknown} message
 * @returns {{ ok: true, value: object } | { ok: false, error: import("../image/quantize-errors.js").QuantizeError }}
 */
export function validateQuantizeRequest(message) {
  if (!message || typeof message !== "object") {
    return {
      ok: false,
      error: createQuantizeError(QuantizeErrorCode.INVALID_REQUEST, "Request must be an object."),
    };
  }
  const msg = /** @type {Record<string, unknown>} */ (message);
  if (msg.type !== WorkerMessageType.QUANTIZE) {
    return {
      ok: false,
      error: createQuantizeError(
        QuantizeErrorCode.INVALID_REQUEST,
        `Unsupported message type "${String(msg.type)}".`,
      ),
    };
  }
  if (typeof msg.requestId !== "string" || !msg.requestId) {
    return {
      ok: false,
      error: createQuantizeError(QuantizeErrorCode.INVALID_REQUEST, "requestId must be a non-empty string."),
    };
  }
  if (!Number.isInteger(msg.sourceRevision)) {
    return {
      ok: false,
      error: createQuantizeError(QuantizeErrorCode.INVALID_REQUEST, "sourceRevision must be an integer."),
    };
  }
  const payload = msg.payload;
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      error: createQuantizeError(QuantizeErrorCode.INVALID_REQUEST, "payload is required."),
    };
  }
  const p = /** @type {Record<string, unknown>} */ (payload);
  const width = p.width;
  const height = p.height;
  const colorCount = p.colorCount;
  const algorithmVersion = p.algorithmVersion ?? QUANTIZE_ALGORITHM_VERSION;

  if (!Number.isInteger(width) || !Number.isInteger(height) || /** @type {number} */ (width) < 1 || /** @type {number} */ (height) < 1) {
    return {
      ok: false,
      error: createQuantizeError(
        QuantizeErrorCode.INVALID_DIMENSIONS,
        "payload.width and payload.height must be positive integers.",
        { width, height },
      ),
    };
  }
  if (!Number.isInteger(colorCount) || /** @type {number} */ (colorCount) < 1 || /** @type {number} */ (colorCount) > 8) {
    return {
      ok: false,
      error: createQuantizeError(
        QuantizeErrorCode.INVALID_COLOR_COUNT,
        "payload.colorCount must be an integer from 1 to 8.",
        { colorCount },
      ),
    };
  }
  if (!Number.isInteger(algorithmVersion)) {
    return {
      ok: false,
      error: createQuantizeError(
        QuantizeErrorCode.INVALID_REQUEST,
        "payload.algorithmVersion must be an integer.",
      ),
    };
  }

  const buffer = p.rgbaBuffer;
  if (!(buffer instanceof ArrayBuffer) && !(ArrayBuffer.isView(buffer) && buffer.buffer)) {
    return {
      ok: false,
      error: createQuantizeError(QuantizeErrorCode.EMPTY_RGBA, "payload.rgbaBuffer must be an ArrayBuffer."),
    };
  }

  const rgbaBuffer = buffer instanceof ArrayBuffer
    ? buffer
    : /** @type {ArrayBuffer} */ (
      /** @type {ArrayBufferView} */ (buffer).buffer.slice(
        /** @type {ArrayBufferView} */ (buffer).byteOffset,
        /** @type {ArrayBufferView} */ (buffer).byteOffset + /** @type {ArrayBufferView} */ (buffer).byteLength,
      )
    );

  const expected = /** @type {number} */ (width) * /** @type {number} */ (height) * 4;
  if (rgbaBuffer.byteLength === 0) {
    return {
      ok: false,
      error: createQuantizeError(QuantizeErrorCode.EMPTY_RGBA, "RGBA buffer is empty."),
    };
  }
  if (rgbaBuffer.byteLength !== expected) {
    return {
      ok: false,
      error: createQuantizeError(
        QuantizeErrorCode.INVALID_RGBA_LENGTH,
        `RGBA byteLength ${rgbaBuffer.byteLength} does not match ${expected}.`,
        { byteLength: rgbaBuffer.byteLength, expected },
      ),
    };
  }

  return {
    ok: true,
    value: {
      type: WorkerMessageType.QUANTIZE,
      requestId: msg.requestId,
      sourceRevision: msg.sourceRevision,
      payload: {
        width,
        height,
        colorCount,
        algorithmVersion,
        rgbaBuffer,
      },
    },
  };
}

/**
 * @param {object} opts
 * @param {string} opts.requestId
 * @param {number} opts.sourceRevision
 * @param {object} opts.result
 */
export function createQuantizeSuccessMessage(opts) {
  return {
    type: WorkerMessageType.QUANTIZE_SUCCESS,
    requestId: opts.requestId,
    sourceRevision: opts.sourceRevision,
    result: opts.result,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.requestId
 * @param {number} opts.sourceRevision
 * @param {import("../image/quantize-errors.js").QuantizeError} opts.error
 */
export function createQuantizeErrorMessage(opts) {
  return {
    type: WorkerMessageType.QUANTIZE_ERROR,
    requestId: opts.requestId,
    sourceRevision: opts.sourceRevision,
    error: opts.error,
  };
}

/**
 * @param {unknown} message
 * @returns {{ ok: true, value: object } | { ok: false, error: import("../image/printability-errors.js").PrintabilityError }}
 */
export function validatePrintabilityRequest(message) {
  if (!message || typeof message !== "object") {
    return {
      ok: false,
      error: createPrintabilityError(PrintabilityErrorCode.INVALID_REQUEST, "Request must be an object."),
    };
  }
  const msg = /** @type {Record<string, unknown>} */ (message);
  if (msg.type !== WorkerMessageType.PRINTABILITY) {
    return {
      ok: false,
      error: createPrintabilityError(
        PrintabilityErrorCode.INVALID_REQUEST,
        `Unsupported message type "${String(msg.type)}".`,
      ),
    };
  }
  if (typeof msg.requestId !== "string" || !msg.requestId) {
    return {
      ok: false,
      error: createPrintabilityError(PrintabilityErrorCode.INVALID_REQUEST, "requestId must be a non-empty string."),
    };
  }
  if (!Number.isInteger(msg.sourceRevision)) {
    return {
      ok: false,
      error: createPrintabilityError(PrintabilityErrorCode.INVALID_REQUEST, "sourceRevision must be an integer."),
    };
  }
  if (!Number.isInteger(msg.printabilityRevision)) {
    return {
      ok: false,
      error: createPrintabilityError(
        PrintabilityErrorCode.INVALID_REQUEST,
        "printabilityRevision must be an integer.",
      ),
    };
  }

  const payload = msg.payload;
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      error: createPrintabilityError(PrintabilityErrorCode.INVALID_REQUEST, "payload is required."),
    };
  }
  const p = /** @type {Record<string, unknown>} */ (payload);
  const width = p.width;
  const height = p.height;

  if (!Number.isInteger(width) || !Number.isInteger(height) || /** @type {number} */ (width) < 1 || /** @type {number} */ (height) < 1) {
    return {
      ok: false,
      error: createPrintabilityError(
        PrintabilityErrorCode.INVALID_DIMENSIONS,
        "payload.width and payload.height must be positive integers.",
        { width, height },
      ),
    };
  }

  const requiredNumbers = [
    "minimumFeatureWidthMm",
    "minimumGapWidthMm",
    "minimumIslandAreaMm2",
    "maximumHoleAreaToFillMm2",
    "tileWidthMm",
    "tileHeightMm",
  ];
  for (const key of requiredNumbers) {
    if (!Number.isFinite(p[key])) {
      return {
        ok: false,
        error: createPrintabilityError(
          PrintabilityErrorCode.INVALID_REQUEST,
          `payload.${key} must be a finite number.`,
        ),
      };
    }
  }

  const buffer = p.indicesBuffer;
  if (!(buffer instanceof ArrayBuffer) && !(ArrayBuffer.isView(buffer) && buffer.buffer)) {
    return {
      ok: false,
      error: createPrintabilityError(
        PrintabilityErrorCode.INVALID_INDICES_LENGTH,
        "payload.indicesBuffer must be an ArrayBuffer.",
      ),
    };
  }

  const indicesBuffer = buffer instanceof ArrayBuffer
    ? buffer
    : /** @type {ArrayBuffer} */ (
      /** @type {ArrayBufferView} */ (buffer).buffer.slice(
        /** @type {ArrayBufferView} */ (buffer).byteOffset,
        /** @type {ArrayBufferView} */ (buffer).byteOffset + /** @type {ArrayBufferView} */ (buffer).byteLength,
      )
    );

  const expected = /** @type {number} */ (width) * /** @type {number} */ (height);
  if (indicesBuffer.byteLength !== expected) {
    return {
      ok: false,
      error: createPrintabilityError(
        PrintabilityErrorCode.INVALID_INDICES_LENGTH,
        `indices byteLength ${indicesBuffer.byteLength} does not match ${expected}.`,
        { byteLength: indicesBuffer.byteLength, expected },
      ),
    };
  }

  return {
    ok: true,
    value: {
      type: WorkerMessageType.PRINTABILITY,
      requestId: msg.requestId,
      sourceRevision: msg.sourceRevision,
      printabilityRevision: msg.printabilityRevision,
      payload: {
        width,
        height,
        indicesBuffer,
        runCleanup: Boolean(p.runCleanup),
        minimumFeatureWidthMm: p.minimumFeatureWidthMm,
        minimumGapWidthMm: p.minimumGapWidthMm,
        minimumIslandAreaMm2: p.minimumIslandAreaMm2,
        maximumHoleAreaToFillMm2: p.maximumHoleAreaToFillMm2,
        tileWidthMm: p.tileWidthMm,
        tileHeightMm: p.tileHeightMm,
        maxPasses: Number.isInteger(p.maxPasses) ? p.maxPasses : MAX_CLEANUP_PASSES,
        algorithmVersion: Number.isInteger(p.algorithmVersion)
          ? p.algorithmVersion
          : CLEANUP_ALGORITHM_VERSION,
      },
    },
  };
}

/**
 * @param {object} opts
 */
export function createPrintabilitySuccessMessage(opts) {
  return {
    type: WorkerMessageType.PRINTABILITY_SUCCESS,
    requestId: opts.requestId,
    sourceRevision: opts.sourceRevision,
    printabilityRevision: opts.printabilityRevision,
    result: opts.result,
  };
}

/**
 * @param {object} opts
 */
export function createPrintabilityErrorMessage(opts) {
  return {
    type: WorkerMessageType.PRINTABILITY_ERROR,
    requestId: opts.requestId,
    sourceRevision: opts.sourceRevision,
    printabilityRevision: opts.printabilityRevision,
    error: opts.error,
  };
}
