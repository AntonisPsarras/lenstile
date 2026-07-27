/**
 * Lightweight pub/sub for UI updates.
 */

/** @typedef {(payload?: unknown) => void} Listener */

/** @type {Map<string, Set<Listener>>} */
const listeners = new Map();

/**
 * @param {string} event
 * @param {Listener} fn
 * @returns {() => void} unsubscribe
 */
export function on(event, fn) {
  if (typeof fn !== "function") {
    throw new TypeError("listener must be a function");
  }
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) {
      listeners.delete(event);
    }
  };
}

/**
 * @param {string} event
 * @param {unknown} [payload]
 */
export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    fn(payload);
  }
}

/** Test helper: clear all listeners. */
export function clearAllListeners() {
  listeners.clear();
}

export const AppEvents = Object.freeze({
  STATE_CHANGED: "state:changed",
  ERROR: "app:error",
  NOTICE: "app:notice",
  IMAGE_LOADED: "image:loaded",
  REDRAW: "view:redraw",
  QUANTIZE_CHANGED: "quantize:changed",
  PRINTABILITY_CHANGED: "printability:changed",
  GEOMETRY_CHANGED: "geometry:changed",
  WORKFLOW_CHANGED: "workflow:changed",
});
