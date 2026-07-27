/**
 * Main-thread client for the mesh generation worker.
 */

import { MeshWorkerMessageType } from "./mesh-worker-protocol.js";
import { GeometryErrorCode, createGeometryError } from "../geometry/geometry-errors.js";

/** @type {Worker | null} */
let worker = null;

/** @type {number} */
let requestSeq = 0;

/**
 * @returns {Worker}
 */
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./mesh-worker.js", import.meta.url), {
    type: "module",
  });
  return worker;
}

/**
 * @returns {string}
 */
export function nextMeshRequestId() {
  requestSeq += 1;
  return `m-${requestSeq}`;
}

/**
 * @param {object} opts
 * @param {string} opts.requestId
 * @param {number} opts.sourceRevision
 * @param {number} opts.printabilityRevision
 * @param {number} opts.geometryRevision
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {ArrayBuffer} opts.cleanedIndicesBuffer
 * @param {number} [opts.segments]
 * @param {string} [opts.surfaceStyle]
 * @param {string} [opts.reliefStrengthId]
 * @param {string} [opts.heightOrder]
 * @param {Array<{ paletteIndex: number, levelIndex: number }>} [opts.colorHeightLevels]
 * @param {Array<{ r: number, g: number, b: number }>} [opts.effectivePalette]
 * @returns {Promise<object>}
 */
export function requestMeshGenerate(opts) {
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
        data.type === MeshWorkerMessageType.GENERATE_SUCCESS
        || data.type === MeshWorkerMessageType.GENERATE_ERROR
      ) {
        resolve(data);
        return;
      }
      reject(createGeometryError(
        GeometryErrorCode.INTERNAL,
        `Unexpected mesh worker message type "${String(data.type)}".`,
      ));
    };

    /** @param {ErrorEvent} event */
    const onError = (event) => {
      cleanup();
      reject(createGeometryError(
        GeometryErrorCode.INTERNAL,
        event.message || "Mesh worker failed.",
      ));
    };

    function cleanup() {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    }

    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);

    w.postMessage(
      {
        type: MeshWorkerMessageType.GENERATE,
        requestId: opts.requestId,
        sourceRevision: opts.sourceRevision,
        printabilityRevision: opts.printabilityRevision,
        geometryRevision: opts.geometryRevision,
        payload: {
          width: opts.width,
          height: opts.height,
          cleanedIndicesBuffer: opts.cleanedIndicesBuffer,
          segments: opts.segments,
          surfaceStyle: opts.surfaceStyle ?? "flat",
          reliefStrengthId: opts.reliefStrengthId ?? "standard",
          heightOrder: opts.heightOrder ?? "darkest-highest",
          colorHeightLevels: opts.colorHeightLevels ?? [],
          effectivePalette: opts.effectivePalette ?? [],
        },
      },
      [opts.cleanedIndicesBuffer],
    );
  });
}

/** Test helper: terminate the shared worker. */
export function resetMeshWorkerForTests() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  requestSeq = 0;
}
