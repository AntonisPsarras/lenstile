import {
  DIAGNOSTICS_SCHEMA_VERSION,
  MAX_STAGE_RECORDS,
  MAX_WORKFLOW_RECORDS,
  WORKFLOW_KEYS,
  STAGE_KEYS,
  EXACT_BYTE_KEYS,
  ESTIMATE_KEYS,
  SUMMARY_KEYS,
  sanitizeDiagnosticRecord,
  sanitizeByteRecord,
} from "./diagnostics-schema.js";

let enabled = false;
let clock = () => performance.now();
let workflows = [];
let stages = [];

export function configureBaselineMetrics(opts = {}) {
  enabled = Boolean(opts.enabled);
  clock = typeof opts.now === "function" ? opts.now : () => performance.now();
}

export function resetBaselineMetrics() {
  workflows = [];
  stages = [];
}

export function baselineMetricsEnabled() {
  return enabled;
}

export function baselineNow() {
  return enabled ? clock() : 0;
}

function appendBounded(list, value, max) {
  list.push(value);
  if (list.length > max) list.splice(0, list.length - max);
}

export function recordBaselineWorkflow(record) {
  if (!enabled) return false;
  appendBounded(
    workflows,
    sanitizeDiagnosticRecord(record, WORKFLOW_KEYS),
    MAX_WORKFLOW_RECORDS,
  );
  return true;
}

export function recordBaselineStage(record) {
  if (!enabled) return false;
  appendBounded(stages, sanitizeDiagnosticRecord(record, STAGE_KEYS), MAX_STAGE_RECORDS);
  return true;
}

export function exactByteLength(value) {
  if (value == null) return 0;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return 0;
}

export function createExactByteRecord(input) {
  return sanitizeByteRecord(input, EXACT_BYTE_KEYS);
}

export function createLogicalEstimateRecord(input) {
  return sanitizeByteRecord(input, ESTIMATE_KEYS);
}

export function createSummaryRecord(input) {
  return sanitizeDiagnosticRecord(input, SUMMARY_KEYS);
}

export function getBaselineDiagnostics(extra = {}) {
  return {
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    kind: "open-tile-release-baseline",
    workflows: workflows.map((item) => ({ ...item })),
    stages: stages.map((item) => ({ ...item })),
    exactKnownBytes: createExactByteRecord(extra.exactKnownBytes),
    logicalEstimates: createLogicalEstimateRecord(extra.logicalEstimates),
  };
}
