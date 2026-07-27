/**
 * Unified application status rail (preview pane) + toast helpers.
 * Success notices auto-dismiss; errors remain until cleared or corrected.
 */

import { announce } from "./accessibility.js";
import { patchUi, getState } from "../state.js";
import { TOAST_SUCCESS_MS } from "../config.js";

/** @type {ReturnType<typeof setTimeout> | null} */
let successTimer = null;

/** @type {number} */
let toastSeq = 0;

/** @typedef {"error" | "success" | "info" | "busy" | "warning"} StatusKind */

/**
 * @param {string} message
 * @param {{ assertive?: boolean }} [opts]
 */
export function showError(message, opts = {}) {
  clearSuccessTimer();
  console.error("[LensTile]", message);
  patchUi({ error: message, notice: null });
  announce(message, opts.assertive === false ? "polite" : "assertive");
  renderAppStatus();
}

/**
 * Transient success / info toast (auto-dismisses).
 * @param {string} message
 */
export function showNotice(message) {
  clearSuccessTimer();
  console.info("[LensTile]", message);
  toastSeq += 1;
  const seq = toastSeq;
  patchUi({ notice: message, error: null });
  announce(message, "polite");
  renderAppStatus();
  successTimer = setTimeout(() => {
    if (toastSeq !== seq) return;
    const s = getState();
    if (s.ui.notice === message) {
      patchUi({ notice: null });
      renderAppStatus(lastPanelStatus);
    }
  }, TOAST_SUCCESS_MS);
}

export function clearMessages() {
  clearSuccessTimer();
  patchUi({ error: null, notice: null });
  renderAppStatus(lastPanelStatus);
}

/**
 * Dismiss the persistent error toast (user action).
 */
export function dismissError() {
  patchUi({ error: null });
  renderAppStatus(lastPanelStatus);
}

/** @deprecated Use renderAppStatus */
export function renderToasts() {
  renderAppStatus(lastPanelStatus);
}

/** @type {{ label: string, message: string, kind: StatusKind } | null} */
let lastPanelStatus = null;

function clearSuccessTimer() {
  if (successTimer != null) {
    clearTimeout(successTimer);
    successTimer = null;
  }
}

/**
 * Sync the preview-pane status rail from UI state.
 * @param {{ label: string, message: string, kind: StatusKind } | null} [panelStatus]
 */
export function renderAppStatus(panelStatus = lastPanelStatus) {
  if (panelStatus !== undefined) {
    lastPanelStatus = panelStatus;
  }
  const host = document.getElementById("toast-host");
  if (!host) return;
  host.replaceChildren();

  const s = getState();
  if (s.ui.error) {
    host.appendChild(buildStatusCard({
      kind: "error",
      label: "Error",
      message: s.ui.error,
      dismissible: true,
      onDismiss: dismissError,
    }));
    return;
  }

  if (s.ui.notice) {
    const noticeKind = inferStatusKind(s.ui.notice);
    host.appendChild(buildStatusCard({
      kind: noticeKind === "warning" ? "warning" : "success",
      label: "Update",
      message: s.ui.notice,
      dismissible: false,
    }));
    return;
  }

  if (lastPanelStatus?.message) {
    host.appendChild(buildStatusCard({
      kind: lastPanelStatus.kind,
      label: lastPanelStatus.label,
      message: lastPanelStatus.message,
      dismissible: false,
    }));
  }
}

/**
 * @param {string} message
 * @returns {StatusKind}
 */
export function inferStatusKind(message) {
  const lower = message.toLowerCase();
  if (lower.includes("error") || lower.includes("could not") || lower.includes("failed")) {
    return "error";
  }
  if (lower.includes("needs updating") || lower.includes("problems found") || lower.includes("narrow")) {
    return "warning";
  }
  if (
    lower.includes("ready")
    || lower.includes("approved")
    || lower.includes("no problems")
    || lower.includes("downloaded")
  ) {
    return "success";
  }
  if (
    lower.includes("creating")
    || lower.includes("checking")
    || lower.includes("building")
    || lower.includes("preparing")
    || lower.includes("working")
  ) {
    return "busy";
  }
  return "info";
}

/**
 * @param {{
 *   kind: StatusKind,
 *   label: string,
 *   message: string,
 *   dismissible: boolean,
 *   onDismiss?: () => void,
 * }} opts
 */
function buildStatusCard(opts) {
  const card = document.createElement("div");
  const toastKind = opts.kind === "busy" ? "info" : opts.kind;
  card.className = `app-status-card app-status-${opts.kind} toast toast-${toastKind}`;
  card.setAttribute("role", opts.kind === "error" ? "alert" : "status");
  card.setAttribute("aria-live", opts.kind === "error" ? "assertive" : "polite");

  const head = document.createElement("div");
  head.className = "app-status-head";

  const badge = document.createElement("span");
  badge.className = "app-status-badge";
  badge.textContent = opts.label;
  head.appendChild(badge);

  const kindLabel = document.createElement("span");
  kindLabel.className = "app-status-kind";
  kindLabel.textContent = statusKindLabel(opts.kind);
  head.appendChild(kindLabel);

  card.appendChild(head);

  const body = document.createElement("div");
  body.className = "app-status-body toast-body";

  const text = document.createElement("p");
  text.className = "app-status-message toast-message";
  text.textContent = opts.message;
  body.appendChild(text);
  card.appendChild(body);

  if (opts.dismissible && opts.onDismiss) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "app-status-dismiss toast-dismiss";
    btn.setAttribute("aria-label", "Dismiss error");
    btn.textContent = "×";
    btn.addEventListener("click", opts.onDismiss);
    card.appendChild(btn);
  }

  return card;
}

/**
 * @param {StatusKind} kind
 * @returns {string}
 */
function statusKindLabel(kind) {
  switch (kind) {
    case "error": return "Error";
    case "success": return "Ready";
    case "warning": return "Attention";
    case "busy": return "Working";
    default: return "Status";
  }
}
