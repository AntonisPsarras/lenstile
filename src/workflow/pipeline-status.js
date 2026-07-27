/**
 * User-facing processing status model (Milestone 7.4.1).
 * Keep detailed internal statuses separate in controllers/runtime stores.
 */

import {
  normalizeWorkflowStatus,
} from "./workflow-fsm.js";

/** @typedef {import("./workflow-fsm.js").WorkflowState} PipelineStatus */

/**
 * @type {Readonly<Record<PipelineStatus, string>>}
 */
export const PIPELINE_STATUS_LABELS = Object.freeze({
  idle: "Ready",
  "updating-colors": "Updating image colors",
  "analyzing-printability": "Checking small printable details",
  "preparing-fix": "Preparing printable version",
  "waiting-for-review": "Waiting for review",
  approved: "Design approved",
  "building-model": "Building model",
  "validating-model": "Checking the model",
  "model-ready": "Model ready",
  "creating-3mf": "Creating multicolor file",
  error: "Error",
});

/**
 * Ordered stages for nozzle / color→printable pipeline progress.
 * @type {readonly string[]}
 */
export const NOZZLE_PIPELINE_STAGES = Object.freeze([
  "Updating image detail",
  "Checking small details",
  "Preparing printable version",
  "Ready for review",
]);

/**
 * Ordered stages for model build progress.
 * @type {readonly string[]}
 */
export const MODEL_BUILD_STAGES = Object.freeze([
  "Preparing regions",
  "Creating tile surfaces",
  "Checking the model",
  "Ready",
]);

/**
 * Plain-language progress for a nozzle-driven update.
 * @param {number} nozzleDiameterMm
 * @returns {{ updatingColors: string, analyzing: string, preparingFix: string, updated: string, review: string }}
 */
export function nozzleProgressMessages(nozzleDiameterMm) {
  const nozzle = Number.isFinite(nozzleDiameterMm)
    ? `${nozzleDiameterMm} mm`
    : "selected";
  return {
    updatingColors: `Updating image detail for the ${nozzle} nozzle…`,
    analyzing: "Checking small printable details…",
    preparingFix: "Preparing printable version…",
    updated: "Printable version updated",
    review: "Review the updated design before downloading",
  };
}

/**
 * Primary plain-language errors (Technical details may add codes).
 * @type {Readonly<Record<string, string>>}
 */
export const PIPELINE_ERROR_MESSAGES = Object.freeze({
  colors: "The image could not be updated.",
  printable: "The printable version could not be prepared.",
  model: "The model could not be built.",
  packaging: "The multicolor file could not be created.",
  generic: "Something went wrong while updating the design.",
});

/**
 * Longer-than-usual notice (watchdog soft threshold).
 */
export const LONGER_THAN_USUAL_MESSAGE = "This is taking longer than usual.";

/** Soft watchdog delay before showing Cancel/Retry affordances (ms). */
export const WATCHDOG_SOFT_MS = 15_000;

/**
 * Map status to label, normalizing legacy aliases.
 * @param {string | null | undefined} status
 * @returns {string}
 */
export function labelForPipelineStatus(status) {
  const normalized = normalizeWorkflowStatus(status);
  return PIPELINE_STATUS_LABELS[normalized] || PIPELINE_STATUS_LABELS.idle;
}

export { normalizeWorkflowStatus };
