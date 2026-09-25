/**
 * Project JSON helpers: serialize current project state.
 * Download/load I/O is not in the current product.
 */

import { toSerializableProject, runtimeOnlyKeys } from "../state.js";

/**
 * @returns {object}
 */
export function exportProjectObject() {
  return toSerializableProject();
}

/**
 * @returns {string}
 */
export function exportProjectJsonString() {
  return `${JSON.stringify(exportProjectObject(), null, 2)}\n`;
}

/**
 * Ensure a candidate object does not embed runtime-only keys at the top levels we care about.
 * @param {unknown} obj
 * @returns {string[]} offending paths
 */
export function findRuntimeOnlyKeys(obj) {
  const banned = new Set(runtimeOnlyKeys());
  /** @type {string[]} */
  const found = [];

  /**
   * @param {unknown} value
   * @param {string} path
   */
  function walk(value, path) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    for (const [k, v] of Object.entries(value)) {
      const next = path ? `${path}.${k}` : k;
      if (banned.has(k)) found.push(next);
      walk(v, next);
    }
  }

  walk(obj, "");
  return found;
}

/**
 * Download helper is not in the current product.
 * @throws {Error}
 */
export function downloadProjectJson() {
  throw new Error("downloadProjectJson is not implemented yet (Milestone 8).");
}
