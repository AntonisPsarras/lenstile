/**
 * Formal workflow finite-state machine (Milestone 7.4.1).
 * Invalid transitions throw in development/tests; production callers must
 * only request allowed edges.
 */

/** @typedef {
 *   | "idle"
 *   | "updating-colors"
 *   | "analyzing-printability"
 *   | "preparing-fix"
 *   | "waiting-for-review"
 *   | "approved"
 *   | "building-model"
 *   | "validating-model"
 *   | "model-ready"
 *   | "creating-3mf"
 *   | "error"
 * } WorkflowState
 */

/**
 * Allowed directed transitions.
 * @type {Readonly<Record<WorkflowState, readonly WorkflowState[]>>}
 */
export const ALLOWED_TRANSITIONS = Object.freeze({
  idle: Object.freeze([
    "updating-colors",
    "analyzing-printability",
    "building-model",
    "error",
  ]),
  "updating-colors": Object.freeze([
    "analyzing-printability",
    "waiting-for-review",
    "idle",
    "error",
  ]),
  "analyzing-printability": Object.freeze([
    "preparing-fix",
    "waiting-for-review",
    "idle",
    "error",
  ]),
  "preparing-fix": Object.freeze([
    "waiting-for-review",
    "idle",
    "error",
  ]),
  "waiting-for-review": Object.freeze([
    "approved",
    "updating-colors",
    "analyzing-printability",
    "preparing-fix",
    "idle",
    "error",
  ]),
  approved: Object.freeze([
    "building-model",
    "updating-colors",
    "analyzing-printability",
    "waiting-for-review",
    "idle",
    "model-ready",
    "error",
  ]),
  "building-model": Object.freeze([
    "validating-model",
    "model-ready",
    "approved",
    "idle",
    "error",
  ]),
  "validating-model": Object.freeze([
    "model-ready",
    "approved",
    "idle",
    "error",
  ]),
  "model-ready": Object.freeze([
    "creating-3mf",
    "building-model",
    "updating-colors",
    "waiting-for-review",
    "approved",
    "idle",
    "error",
  ]),
  "creating-3mf": Object.freeze([
    "model-ready",
    "idle",
    "error",
  ]),
  error: Object.freeze([
    "idle",
    "updating-colors",
    "analyzing-printability",
    "preparing-fix",
    "building-model",
    "approved",
    "waiting-for-review",
  ]),
});

/**
 * Processing / non-terminal states (busy for navigation).
 * @type {ReadonlySet<WorkflowState>}
 */
export const BUSY_WORKFLOW_STATES = Object.freeze(new Set([
  "updating-colors",
  "analyzing-printability",
  "preparing-fix",
  "building-model",
  "validating-model",
  "creating-3mf",
]));

/**
 * Terminal or waiting states that return control to the user.
 * @type {ReadonlySet<WorkflowState>}
 */
export const TERMINAL_OR_WAITING_STATES = Object.freeze(new Set([
  "idle",
  "waiting-for-review",
  "approved",
  "model-ready",
  "error",
]));

/**
 * @param {WorkflowState | string} from
 * @param {WorkflowState | string} to
 * @returns {boolean}
 */
export function isTransitionAllowed(from, to) {
  if (from === to) return true;
  const list = ALLOWED_TRANSITIONS[/** @type {WorkflowState} */ (from)];
  if (!list) return false;
  return list.includes(/** @type {WorkflowState} */ (to));
}

/**
 * Assert and return the target state. Throws on illegal transition.
 * @param {WorkflowState | string} from
 * @param {WorkflowState | string} to
 * @param {{ soft?: boolean }} [opts] soft=true returns null instead of throw
 * @returns {WorkflowState | null}
 */
export function assertTransition(from, to, opts = {}) {
  if (isTransitionAllowed(from, to)) {
    return /** @type {WorkflowState} */ (to);
  }
  const msg = `Invalid workflow transition: ${from} → ${to}`;
  if (opts.soft) return null;
  throw new Error(msg);
}

/**
 * @param {WorkflowState | string | null | undefined} status
 * @returns {boolean}
 */
export function isBusyWorkflowStatus(status) {
  return BUSY_WORKFLOW_STATES.has(/** @type {WorkflowState} */ (status));
}

/**
 * Busy for color/printability pipelines (not model build).
 * @param {WorkflowState | string | null | undefined} status
 * @returns {boolean}
 */
export function isColorPrintableBusy(status) {
  return status === "updating-colors"
    || status === "analyzing-printability"
    || status === "preparing-fix";
}

/**
 * Busy for download blocking (includes model build).
 * @param {WorkflowState | string | null | undefined} status
 * @returns {boolean}
 */
export function isExportBusy(status) {
  return isBusyWorkflowStatus(status);
}

/**
 * Normalize legacy 7.4 status strings to 7.4.1 FSM states.
 * @param {string | null | undefined} status
 * @returns {WorkflowState}
 */
export function normalizeWorkflowStatus(status) {
  if (!status || status === "ready" || status === "complete") return "idle";
  if (status === "waiting-review") return "waiting-for-review";
  if (status === "preparing-printable") return "preparing-fix";
  if (ALLOWED_TRANSITIONS[/** @type {WorkflowState} */ (status)]) {
    return /** @type {WorkflowState} */ (status);
  }
  return "idle";
}

/**
 * @typedef {{ status: "success" | "error" | "superseded", operationId: number, ok?: boolean }} OperationResult
 */

/**
 * @param {number} operationId
 * @returns {OperationResult}
 */
export function successResult(operationId) {
  return { status: "success", operationId, ok: true };
}

/**
 * @param {number} operationId
 * @returns {OperationResult}
 */
export function errorResult(operationId) {
  return { status: "error", operationId, ok: false };
}

/**
 * @param {number} operationId
 * @returns {OperationResult}
 */
export function supersededResult(operationId) {
  return { status: "superseded", operationId, ok: false };
}
