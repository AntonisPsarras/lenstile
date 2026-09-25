/**
 * In-memory instrumentation for duplicate-pipeline detection and tests.
 * No network; counters stay in-memory only.
 */

/**
 * @typedef {object} PipelineCounters
 * @property {number} quantizationRequests
 * @property {number} printabilityRequests
 * @property {number} geometryBuilds
 * @property {number} winningColorOps
 * @property {number} winningPrintabilityOps
 * @property {number} winningFixOps
 * @property {number} winningGeometryOps
 * @property {number} supersededOps
 * @property {number[]} recentDurationsMs
 * @property {number | null} lastOperationId
 */

/** @type {PipelineCounters} */
const counters = {
  quantizationRequests: 0,
  printabilityRequests: 0,
  geometryBuilds: 0,
  winningColorOps: 0,
  winningPrintabilityOps: 0,
  winningFixOps: 0,
  winningGeometryOps: 0,
  supersededOps: 0,
  recentDurationsMs: [],
  lastOperationId: null,
};

const MAX_RECENT = 32;

export function resetPipelineInstrumentation() {
  counters.quantizationRequests = 0;
  counters.printabilityRequests = 0;
  counters.geometryBuilds = 0;
  counters.winningColorOps = 0;
  counters.winningPrintabilityOps = 0;
  counters.winningFixOps = 0;
  counters.winningGeometryOps = 0;
  counters.supersededOps = 0;
  counters.recentDurationsMs = [];
  counters.lastOperationId = null;
}

/** @returns {Readonly<PipelineCounters>} */
export function getPipelineInstrumentation() {
  return {
    ...counters,
    recentDurationsMs: counters.recentDurationsMs.slice(),
  };
}

/** @param {"quantize" | "printability" | "geometry"} kind */
export function recordPipelineRequest(kind) {
  if (kind === "quantize") counters.quantizationRequests += 1;
  else if (kind === "printability") counters.printabilityRequests += 1;
  else if (kind === "geometry") counters.geometryBuilds += 1;
}

/**
 * @param {"color" | "printability" | "fix" | "geometry" | "superseded"} kind
 * @param {number} [operationId]
 * @param {number} [durationMs]
 */
export function recordPipelineWin(kind, operationId, durationMs) {
  if (kind === "color") counters.winningColorOps += 1;
  else if (kind === "printability") counters.winningPrintabilityOps += 1;
  else if (kind === "fix") counters.winningFixOps += 1;
  else if (kind === "geometry") counters.winningGeometryOps += 1;
  else if (kind === "superseded") counters.supersededOps += 1;
  if (operationId != null) counters.lastOperationId = operationId;
  if (Number.isFinite(durationMs)) {
    counters.recentDurationsMs.push(/** @type {number} */ (durationMs));
    if (counters.recentDurationsMs.length > MAX_RECENT) {
      counters.recentDurationsMs.shift();
    }
  }
}
