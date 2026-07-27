/**
 * Shared stage-based progress UI (Milestone 7.4.1).
 * Percentage is derived from completed stages only — never from elapsed time.
 */

import { getRuntimeWorkflow, getState } from "../state.js";
import {
  cancelCurrentPipeline,
  retryCurrentPipeline,
} from "../workflow/pipeline.js";
import { LONGER_THAN_USUAL_MESSAGE } from "../workflow/pipeline-status.js";
import { isBusyWorkflowStatus, normalizeWorkflowStatus } from "../workflow/workflow-fsm.js";

/**
 * @param {number} completedStages
 * @param {number} totalStages
 * @returns {number}
 */
export function deriveProgressPercent(completedStages, totalStages) {
  if (!totalStages || totalStages < 1) return 0;
  const completed = Math.max(0, Math.min(completedStages, totalStages));
  return Math.round((completed / totalStages) * 100);
}

/**
 * Active settings panel root for the current step.
 * @param {ParentNode | Document} [root]
 * @returns {Element | null}
 */
function activePanel(root = document) {
  const step = getState().ui.activeStep;
  return root.querySelector(`.control-section[data-panel="${step}"]`);
}

/**
 * Sync the compact processing card + footer chip from runtime workflow.
 * @param {ParentNode | Document} [root]
 */
export function syncProgressUi(root = document) {
  const wf = getRuntimeWorkflow();
  const status = normalizeWorkflowStatus(wf.pipelineStatus);
  const busy = isBusyWorkflowStatus(status);
  const panel = activePanel(root) || root;
  const card = panel.querySelector(".workflow-progress-card");
  const footerChip = panel.querySelector(".workflow-footer-status")
    || root.querySelector(".control-section.is-active .workflow-footer-status");
  const stageList = card?.querySelector(".workflow-progress-stages");
  const percentEl = card?.querySelector(".workflow-progress-percent");
  const noticeEl = card?.querySelector(".workflow-longer-notice");
  const actionsEl = card?.querySelector(".workflow-progress-actions");
  const cancelBtn = /** @type {HTMLButtonElement|null} */ (
    card?.querySelector(".btn-pipeline-cancel")
  );
  const retryBtn = /** @type {HTMLButtonElement|null} */ (
    card?.querySelector(".btn-pipeline-retry")
  );

  const label = wf.progressStageLabel || wf.progressMessage || "";
  const total = wf.progressStageTotal || 0;
  const idx = wf.progressStageIndex || 0;
  const completed = status === "waiting-for-review" || status === "model-ready"
    ? total
    : (busy ? idx : (total > 0 && !busy ? total : 0));
  const percent = total > 0
    ? deriveProgressPercent(Math.min(completed, total), total)
    : (wf.progressPercent || 0);

  root.querySelectorAll(".workflow-progress-card").forEach((el) => {
    el.hidden = true;
  });

  if (card) {
    const show = busy || status === "error" || Boolean(wf.longerThanUsual);
    card.hidden = !show;
    card.classList.toggle("is-error", status === "error");
    card.classList.toggle("is-busy", busy);
  }

  if (percentEl) {
    percentEl.textContent = total > 0 ? `${percent}%` : "";
    percentEl.hidden = total < 1;
  }

  if (stageList && total > 0) {
    const items = stageList.querySelectorAll("[data-stage-index]");
    items.forEach((item) => {
      const i = Number(item.getAttribute("data-stage-index"));
      item.classList.toggle("is-active", busy && i === idx);
      item.classList.toggle(
        "is-complete",
        (!busy && total > 0 && i < total) || (busy && i < idx),
      );
    });
  }

  if (noticeEl) {
    noticeEl.hidden = !wf.longerThanUsual;
    noticeEl.textContent = LONGER_THAN_USUAL_MESSAGE;
  }

  if (actionsEl) {
    const showActions = Boolean(wf.longerThanUsual) || status === "error";
    actionsEl.hidden = !showActions;
  }
  if (cancelBtn) {
    cancelBtn.hidden = !busy || !wf.canCancel;
    cancelBtn.disabled = !busy || !wf.canCancel;
  }
  if (retryBtn) {
    retryBtn.hidden = status !== "error";
    retryBtn.disabled = status !== "error";
  }

  root.querySelectorAll(".workflow-footer-status").forEach((chip) => {
    /** @type {HTMLElement} */ (chip).hidden = true;
    chip.textContent = "";
  });
  if (footerChip) {
    if (busy && label) {
      /** @type {HTMLElement} */ (footerChip).hidden = false;
      footerChip.textContent = label;
    } else if (status === "error" && wf.error) {
      /** @type {HTMLElement} */ (footerChip).hidden = false;
      footerChip.textContent = wf.error.message || "Error";
    }
  }
}

/**
 * Bind Cancel / Retry once per button (idempotent via data-bound).
 * @param {ParentNode | Document} [root]
 */
export function bindProgressControls(root = document) {
  root.querySelectorAll(".btn-pipeline-cancel").forEach((cancelBtn) => {
    if (/** @type {HTMLElement} */ (cancelBtn).dataset.bound) return;
    /** @type {HTMLElement} */ (cancelBtn).dataset.bound = "1";
    cancelBtn.addEventListener("click", () => {
      cancelCurrentPipeline();
      syncProgressUi(root);
    });
  });
  root.querySelectorAll(".btn-pipeline-retry").forEach((retryBtn) => {
    if (/** @type {HTMLElement} */ (retryBtn).dataset.bound) return;
    /** @type {HTMLElement} */ (retryBtn).dataset.bound = "1";
    retryBtn.addEventListener("click", () => {
      void retryCurrentPipeline().then(() => syncProgressUi(root));
    });
  });
}

/**
 * Build a progress card element tree (for mounting into panels).
 * @param {typeof import("./dom.js").el} el
 * @param {readonly string[]} [stageLabels]
 * @param {string} [idSuffix]
 */
export function buildProgressCard(el, stageLabels = [], idSuffix = "") {
  const suffix = idSuffix ? `-${idSuffix}` : "";
  const stages = stageLabels.map((label, i) =>
    el("li", {
      class: "workflow-progress-stage",
      "data-stage-index": String(i),
    }, [
      el("span", { class: "workflow-progress-mark", "aria-hidden": "true" }, ["•"]),
      el("span", { class: "workflow-progress-label" }, [label]),
    ]),
  );

  return el("div", {
    id: `workflow-progress-card${suffix}`,
    class: "workflow-progress-card",
    role: "status",
    "aria-live": "polite",
    hidden: "true",
  }, [
    el("div", { class: "workflow-progress-head" }, [
      el("span", {
        class: "workflow-progress-spinner",
        "aria-hidden": "true",
      }),
      el("span", { class: "workflow-progress-percent" }),
    ]),
    el("ol", {
      class: "workflow-progress-stages",
    }, stages),
    el("p", {
      class: "workflow-longer-notice help-text",
      hidden: "true",
    }, [LONGER_THAN_USUAL_MESSAGE]),
    el("div", {
      class: "button-row workflow-progress-actions",
      hidden: "true",
    }, [
      el("button", {
        type: "button",
        class: "button button-secondary btn-pipeline-cancel",
      }, ["Cancel"]),
      el("button", {
        type: "button",
        class: "button button-primary btn-pipeline-retry",
        hidden: "true",
      }, ["Retry"]),
    ]),
  ]);
}
