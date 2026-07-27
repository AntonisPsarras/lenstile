/**
 * Main-thread client for a single reusable image worker.
 */

import {
  WorkerMessageType,
} from "./image-worker-protocol.js";
import { QuantizeErrorCode, createQuantizeError } from "../image/quantize-errors.js";
import {
  PrintabilityErrorCode,
  createPrintabilityError,
} from "../image/printability-errors.js";

/** @type {Worker | null} */
let worker = null;

/** @type {number} */
let requestSeq = 0;

/**
 * @returns {Worker}
 */
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./image-worker.js", import.meta.url), {
    type: "module",
  });
  return worker;
}

/**
 * Generate a unique request id for stale-result tracking.
 * @returns {string}
 */
export function nextQuantizeRequestId() {
  requestSeq += 1;
  return `q-${requestSeq}`;
}

/**
 * @returns {string}
 */
export function nextPrintabilityRequestId() {
  requestSeq += 1;
  return `p-${requestSeq}`;
}

/**
 * Run quantization in the shared worker.
 *
 * @param {object} opts
 * @param {string} opts.requestId
 * @param {number} opts.sourceRevision
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {ArrayBuffer} opts.rgbaBuffer
 * @param {number} opts.colorCount
 * @param {number} opts.algorithmVersion
 * @returns {Promise<{
 *   type: string,
 *   requestId: string,
 *   sourceRevision: number,
 *   result?: object,
 *   error?: import("../image/quantize-errors.js").QuantizeError
 * }>}
 */
export function requestQuantize(opts) {
  const w = getWorker();

  return new Promise((resolve, reject) => {
    /** @param {MessageEvent} event */
    const onMessage = (event) => {
      const data = event.data;
      if (!data || data.requestId !== opts.requestId) {
        return;
      }
      cleanup();
      if (
        data.type === WorkerMessageType.QUANTIZE_SUCCESS
        || data.type === WorkerMessageType.QUANTIZE_ERROR
      ) {
        resolve(data);
        return;
      }
      resolve({
        type: WorkerMessageType.QUANTIZE_ERROR,
        requestId: opts.requestId,
        sourceRevision: opts.sourceRevision,
        error: createQuantizeError(
          QuantizeErrorCode.WORKER_FAILURE,
          `Unexpected worker message type "${String(data.type)}".`,
        ),
      });
    };

    /** @param {ErrorEvent} event */
    const onError = (event) => {
      cleanup();
      reject(
        createQuantizeError(
          QuantizeErrorCode.WORKER_FAILURE,
          event.message || "Image worker failed.",
        ),
      );
    };

    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };

    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);

    const message = {
      type: WorkerMessageType.QUANTIZE,
      requestId: opts.requestId,
      sourceRevision: opts.sourceRevision,
      payload: {
        width: opts.width,
        height: opts.height,
        rgbaBuffer: opts.rgbaBuffer,
        colorCount: opts.colorCount,
        algorithmVersion: opts.algorithmVersion,
      },
    };

    try {
      w.postMessage(message, [opts.rgbaBuffer]);
    } catch (err) {
      cleanup();
      reject(
        createQuantizeError(
          QuantizeErrorCode.WORKER_FAILURE,
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  });
}

/**
 * Run printability analysis / cleanup in the shared worker.
 *
 * @param {object} opts
 * @returns {Promise<object>}
 */
export function requestPrintability(opts) {
  const w = getWorker();

  return new Promise((resolve, reject) => {
    /** @param {MessageEvent} event */
    const onMessage = (event) => {
      const data = event.data;
      if (!data || data.requestId !== opts.requestId) {
        return;
      }
      cleanup();
      if (
        data.type === WorkerMessageType.PRINTABILITY_SUCCESS
        || data.type === WorkerMessageType.PRINTABILITY_ERROR
      ) {
        resolve(data);
        return;
      }
      resolve({
        type: WorkerMessageType.PRINTABILITY_ERROR,
        requestId: opts.requestId,
        sourceRevision: opts.sourceRevision,
        printabilityRevision: opts.printabilityRevision,
        error: createPrintabilityError(
          PrintabilityErrorCode.WORKER_FAILURE,
          `Unexpected worker message type "${String(data.type)}".`,
        ),
      });
    };

    /** @param {ErrorEvent} event */
    const onError = (event) => {
      cleanup();
      reject(
        createPrintabilityError(
          PrintabilityErrorCode.WORKER_FAILURE,
          event.message || "Image worker failed during printability.",
        ),
      );
    };

    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };

    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);

    const message = {
      type: WorkerMessageType.PRINTABILITY,
      requestId: opts.requestId,
      sourceRevision: opts.sourceRevision,
      printabilityRevision: opts.printabilityRevision,
      payload: {
        width: opts.width,
        height: opts.height,
        indicesBuffer: opts.indicesBuffer,
        runCleanup: opts.runCleanup,
        minimumFeatureWidthMm: opts.minimumFeatureWidthMm,
        minimumGapWidthMm: opts.minimumGapWidthMm,
        minimumIslandAreaMm2: opts.minimumIslandAreaMm2,
        maximumHoleAreaToFillMm2: opts.maximumHoleAreaToFillMm2,
        tileWidthMm: opts.tileWidthMm,
        tileHeightMm: opts.tileHeightMm,
        maxPasses: opts.maxPasses,
        algorithmVersion: opts.algorithmVersion,
      },
    };

    try {
      w.postMessage(message, [opts.indicesBuffer]);
    } catch (err) {
      cleanup();
      reject(
        createPrintabilityError(
          PrintabilityErrorCode.WORKER_FAILURE,
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  });
}

/** Test helper: terminate the shared worker. */
export function resetImageWorkerForTests() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  requestSeq = 0;
}
