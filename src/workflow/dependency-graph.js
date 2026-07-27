/**
 * Explicit dependency graph for Milestone 7.4 workflow orchestration.
 * Stages: colors → printable → model → packaging
 *
 * Algorithm modules stay elsewhere; this only describes what to invalidate/rerun.
 */

/** @typedef {"colors" | "printable" | "model" | "packaging"} PipelineStage */

/**
 * Change types that drive the dependency graph.
 * @typedef {
 *   | "crop-commit"
 *   | "update-design"
 *   | "color-count"
 *   | "transparency"
 *   | "nozzle-change"
 *   | "palette-rgb"
 *   | "relief"
 *   | "base-color"
 *   | "design-name"
 * } ChangeType
 */

/**
 * Ordered stages from earliest to latest.
 * @type {readonly PipelineStage[]}
 */
export const PIPELINE_STAGES = Object.freeze([
  "colors",
  "printable",
  "model",
  "packaging",
]);

/**
 * @typedef {object} StageEffect
 * @property {"rerun" | "invalidate" | "skip" | "preview" | "filename"} action
 * @property {boolean} [requiresReapproval]
 * @property {string} [note]
 */

/**
 * Dependency matrix keyed by change type.
 * @type {Readonly<Record<ChangeType, Readonly<Record<PipelineStage, StageEffect>>>>}
 */
export const DEPENDENCY_GRAPH = Object.freeze({
  "crop-commit": Object.freeze({
    colors: Object.freeze({ action: "invalidate", note: "Show Update design; no auto pipeline" }),
    printable: Object.freeze({ action: "invalidate", requiresReapproval: true }),
    model: Object.freeze({ action: "invalidate" }),
    packaging: Object.freeze({ action: "invalidate" }),
  }),
  "update-design": Object.freeze({
    colors: Object.freeze({ action: "rerun" }),
    printable: Object.freeze({ action: "rerun", requiresReapproval: true }),
    model: Object.freeze({ action: "invalidate" }),
    packaging: Object.freeze({ action: "invalidate" }),
  }),
  "color-count": Object.freeze({
    colors: Object.freeze({ action: "rerun" }),
    printable: Object.freeze({ action: "rerun", requiresReapproval: true }),
    model: Object.freeze({ action: "invalidate" }),
    packaging: Object.freeze({ action: "invalidate" }),
  }),
  transparency: Object.freeze({
    colors: Object.freeze({ action: "rerun" }),
    printable: Object.freeze({ action: "rerun", requiresReapproval: true }),
    model: Object.freeze({ action: "invalidate" }),
    packaging: Object.freeze({ action: "invalidate" }),
  }),
  "nozzle-change": Object.freeze({
    colors: Object.freeze({ action: "rerun" }),
    printable: Object.freeze({ action: "rerun", requiresReapproval: true }),
    model: Object.freeze({ action: "invalidate", note: "No remesh until reapproval" }),
    packaging: Object.freeze({ action: "invalidate" }),
  }),
  "palette-rgb": Object.freeze({
    colors: Object.freeze({ action: "preview", note: "No re-cluster" }),
    printable: Object.freeze({ action: "skip" }),
    model: Object.freeze({
      action: "rerun",
      note: "Only when automatic height order changes assignments",
    }),
    packaging: Object.freeze({ action: "invalidate" }),
  }),
  relief: Object.freeze({
    colors: Object.freeze({ action: "skip" }),
    printable: Object.freeze({ action: "skip" }),
    model: Object.freeze({ action: "rerun" }),
    packaging: Object.freeze({ action: "invalidate" }),
  }),
  "base-color": Object.freeze({
    colors: Object.freeze({ action: "skip" }),
    printable: Object.freeze({ action: "skip" }),
    model: Object.freeze({ action: "skip" }),
    packaging: Object.freeze({ action: "invalidate" }),
  }),
  "design-name": Object.freeze({
    colors: Object.freeze({ action: "skip" }),
    printable: Object.freeze({ action: "skip" }),
    model: Object.freeze({ action: "skip" }),
    packaging: Object.freeze({ action: "filename" }),
  }),
});

/**
 * Return ordered affected stages for a change (stages whose action is not skip).
 * @param {ChangeType | string} changeType
 * @returns {PipelineStage[]}
 */
export function determineAffectedStages(changeType) {
  const row = DEPENDENCY_GRAPH[/** @type {ChangeType} */ (changeType)];
  if (!row) return [];
  /** @type {PipelineStage[]} */
  const out = [];
  for (const stage of PIPELINE_STAGES) {
    const effect = row[stage];
    if (!effect || effect.action === "skip") continue;
    out.push(stage);
  }
  return out;
}

/**
 * @param {ChangeType | string} changeType
 * @param {PipelineStage} stage
 * @returns {StageEffect | null}
 */
export function getStageEffect(changeType, stage) {
  const row = DEPENDENCY_GRAPH[/** @type {ChangeType} */ (changeType)];
  if (!row) return null;
  return row[stage] || null;
}

/**
 * Whether this change requires printable reapproval after regeneration.
 * @param {ChangeType | string} changeType
 * @returns {boolean}
 */
export function changeRequiresReapproval(changeType) {
  const effect = getStageEffect(changeType, "printable");
  return Boolean(effect && effect.requiresReapproval);
}

/**
 * Whether the change should auto-run the color→printable pipeline.
 * @param {ChangeType | string} changeType
 * @returns {boolean}
 */
export function shouldAutoRunColorPrintablePipeline(changeType) {
  return (
    changeType === "nozzle-change"
    || changeType === "color-count"
    || changeType === "transparency"
    || changeType === "update-design"
  );
}
