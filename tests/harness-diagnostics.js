import { getRuntimeWorkflow, resetStore } from "../src/state.js";
import { resetImageWorkerForTests } from "../src/workers/image-worker-client.js";
import { resetMeshWorkerForTests } from "../src/workers/mesh-worker-client.js";

const EXPECTED_ERROR_PATTERNS = Object.freeze({
  "unsupported-gif": /Unsupported image type "image\/gif"\. Use PNG, JPEG, or WebP\./,
  "multicolor-before-model-ready": /Build (?:a valid|or rebuild) printable model|Multicolor download is not available/,
  "printability-before-color-preview": /Create a color preview first\./,
});

function errorText(value) {
  if (value instanceof Error) return value.stack || value.message;
  return String(value);
}

function snapshotWorkflow() {
  try {
    const workflow = getRuntimeWorkflow();
    return {
      operationId: workflow.requestedOperationId,
      completedOperationId: workflow.completedOperationId,
      status: workflow.pipelineStatus,
      progressMessage: workflow.progressMessage,
      progressStageIndex: workflow.progressStageIndex,
      progressStageTotal: workflow.progressStageTotal,
    };
  } catch (error) {
    return { error: errorText(error) };
  }
}

export function createHarnessDiagnostics() {
  const original = {
    Worker: globalThis.Worker,
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    addEventListener: EventTarget.prototype.addEventListener,
    removeEventListener: EventTarget.prototype.removeEventListener,
    consoleError: console.error,
  };
  const pendingWorkers = new Map();
  const timers = new Map();
  const listeners = [];
  const unexpected = [];
  let currentTest = null;

  const recordUnexpected = (kind, detail) => {
    unexpected.push({
      kind,
      detail: errorText(detail),
      test: currentTest?.fullName || null,
      atMs: performance.now(),
    });
  };

  class TrackingWorker extends original.Worker {
    constructor(...args) {
      super(...args);
      const workerUrl = String(args[0]);
      original.addEventListener.call(this, "message", (event) => {
        const requestId = event.data?.requestId;
        if (requestId) pendingWorkers.delete(requestId);
      });
      original.addEventListener.call(this, "error", (event) => {
        recordUnexpected("worker-error", event.message || `Worker failed: ${workerUrl}`);
        for (const [requestId, entry] of pendingWorkers) {
          if (entry.worker === this) pendingWorkers.delete(requestId);
        }
      });
    }

    postMessage(message, ...rest) {
      if (message?.requestId) {
        pendingWorkers.set(message.requestId, {
          worker: this,
          type: String(message.type || "unknown"),
          startedAtMs: performance.now(),
          test: currentTest?.fullName || null,
        });
      }
      return super.postMessage(message, ...rest);
    }
  }

  const trackTimer = (kind, callback, delay, args) => {
    const createdBy = currentTest?.fullName || null;
    let id;
    const wrapped = (...callbackArgs) => {
      if (kind === "timeout") timers.delete(id);
      return callback(...callbackArgs);
    };
    id = kind === "timeout"
      ? original.setTimeout(wrapped, delay, ...args)
      : original.setInterval(wrapped, delay, ...args);
    timers.set(id, {
      kind,
      delay: Number(delay) || 0,
      createdAtMs: performance.now(),
      test: createdBy,
    });
    return id;
  };

  const onWindowError = (event) => recordUnexpected(
    "window-error",
    event.error || event.message || "Unknown window error",
  );
  const onUnhandledRejection = (event) => recordUnexpected(
    "unhandled-rejection",
    event.reason || "Unknown unhandled rejection",
  );

  globalThis.Worker = TrackingWorker;
  globalThis.setTimeout = (callback, delay, ...args) => (
    trackTimer("timeout", callback, delay, args)
  );
  globalThis.clearTimeout = (id) => {
    timers.delete(id);
    return original.clearTimeout(id);
  };
  globalThis.setInterval = (callback, delay, ...args) => (
    trackTimer("interval", callback, delay, args)
  );
  globalThis.clearInterval = (id) => {
    timers.delete(id);
    return original.clearInterval(id);
  };
  EventTarget.prototype.addEventListener = function addTrackedListener(type, listener, options) {
    if (currentTest) {
      listeners.push({ target: this, type, listener, options, test: currentTest.fullName });
    }
    return original.addEventListener.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function removeTrackedListener(type, listener, options) {
    const index = listeners.findIndex(
      (entry) => entry.target === this && entry.type === type && entry.listener === listener,
    );
    if (index >= 0) listeners.splice(index, 1);
    return original.removeEventListener.call(this, type, listener, options);
  };
  console.error = (...args) => {
    recordUnexpected("console-error", args.map(errorText).join(" "));
    original.consoleError(...args);
  };
  original.addEventListener.call(window, "error", onWindowError);
  original.addEventListener.call(window, "unhandledrejection", onUnhandledRejection);

  return {
    original,
    unexpected,
    classifyErrors(entries, expectedCategories) {
      const expected = [];
      const remaining = [];
      for (const entry of entries) {
        const category = expectedCategories.find(
          (name) => EXPECTED_ERROR_PATTERNS[name]?.test(entry.detail),
        );
        if (category) {
          entry.expectedCategory = category;
          expected.push({ ...entry, category });
        } else {
          remaining.push(entry);
        }
      }
      return { expected, unexpected: remaining };
    },
    setCurrentTest(testInfo) {
      currentTest = testInfo;
    },
    snapshot() {
      const now = performance.now();
      return {
        currentTest: currentTest ? {
          name: currentTest.fullName,
          elapsedMs: now - currentTest.startedAtMs,
          promiseState: "pending",
        } : null,
        pendingImageWorkerRequests: [...pendingWorkers.entries()]
          .filter(([, entry]) => (
            entry.type.startsWith("quantize") || entry.type.startsWith("printability")
          ))
          .map(([requestId, entry]) => ({
            requestId,
            type: entry.type,
            elapsedMs: now - entry.startedAtMs,
          })),
        pendingMeshWorkerRequests: [...pendingWorkers.entries()]
          .filter(([, entry]) => entry.type.startsWith("mesh"))
          .map(([requestId, entry]) => ({
            requestId,
            type: entry.type,
            elapsedMs: now - entry.startedAtMs,
          })),
        timers: [...timers.entries()].map(([id, entry]) => ({
          id: Number(id),
          kind: entry.kind,
          delayMs: entry.delay,
          elapsedMs: now - entry.createdAtMs,
          test: entry.test,
        })),
        workflow: snapshotWorkflow(),
        expectedErrors: unexpected.filter((entry) => entry.expectedCategory),
        unexpected: unexpected.filter((entry) => !entry.expectedCategory),
      };
    },
    cleanupTest(fullName) {
      for (const [id, entry] of timers) {
        if (entry.test !== fullName) continue;
        if (entry.kind === "timeout") original.clearTimeout(id);
        else original.clearInterval(id);
        timers.delete(id);
      }
      for (let i = listeners.length - 1; i >= 0; i -= 1) {
        const entry = listeners[i];
        if (entry.test !== fullName) continue;
        original.removeEventListener.call(
          entry.target,
          entry.type,
          entry.listener,
          entry.options,
        );
        listeners.splice(i, 1);
      }
      resetImageWorkerForTests();
      resetMeshWorkerForTests();
      pendingWorkers.clear();
      resetStore();
      currentTest = null;
    },
    restore() {
      original.removeEventListener.call(window, "error", onWindowError);
      original.removeEventListener.call(window, "unhandledrejection", onUnhandledRejection);
      globalThis.Worker = original.Worker;
      globalThis.setTimeout = original.setTimeout;
      globalThis.clearTimeout = original.clearTimeout;
      globalThis.setInterval = original.setInterval;
      globalThis.clearInterval = original.clearInterval;
      EventTarget.prototype.addEventListener = original.addEventListener;
      EventTarget.prototype.removeEventListener = original.removeEventListener;
      console.error = original.consoleError;
    },
  };
}
