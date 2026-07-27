/**
 * Application entry — LensTile.
 */

import { APP_NAME } from "./config.js";
import { AppEvents, on } from "./events.js";
import { getState, getRuntimeBitmap, getEffectiveTransform } from "./state.js";
import { detectMissingApis } from "./validation.js";
import { mountLayout } from "./ui/layout.js";
import { bindControls, syncControlsFromState } from "./ui/controls.js";
import { showError } from "./ui/notifications.js";
import { renderCropPreview, createRedrawScheduler } from "./image/crop-renderer.js";
import { computeCropRect } from "./image/crop-transform.js";

/**
 * Boot the application into #app.
 */
export function startApp() {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("Missing #app root element.");
  }

  const missing = detectMissingApis(window);
  if (missing.length) {
    root.textContent = `${APP_NAME} cannot start. Missing browser APIs: ${missing.join(", ")}.`;
    return;
  }

  if (typeof Worker === "undefined") {
    root.textContent = `${APP_NAME} cannot start. Web Workers are required for color quantization.`;
    return;
  }

  const layout = mountLayout(root);
  const { canvas, canvasShell, imageInput } = layout;

  const draw = () => {
    try {
      const cssWidth = Math.max(1, canvasShell.clientWidth);
      const cssHeight = Math.max(1, canvasShell.clientHeight);
      const state = getState();
      renderCropPreview(canvas, {
        state: {
          ...state,
          transform: getEffectiveTransform(),
        },
        bitmap: getRuntimeBitmap(),
        cssWidth,
        cssHeight,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showError(message);
    }
  };

  const scheduleRedraw = createRedrawScheduler(draw);

  const getCropSize = () => {
    const rect = computeCropRect(
      Math.max(1, canvasShell.clientWidth),
      Math.max(1, canvasShell.clientHeight),
    );
    return { width: rect.width, height: rect.height };
  };

  bindControls({
    canvas,
    canvasShell,
    imageInput,
    scheduleRedraw,
    getCropSize,
  });

  on(AppEvents.STATE_CHANGED, () => {
    syncControlsFromState();
  });
  on(AppEvents.QUANTIZE_CHANGED, () => {
    syncControlsFromState();
  });
  on(AppEvents.PRINTABILITY_CHANGED, () => {
    syncControlsFromState();
  });
  on(AppEvents.GEOMETRY_CHANGED, () => {
    syncControlsFromState();
  });
  on(AppEvents.WORKFLOW_CHANGED, () => {
    syncControlsFromState();
  });
  on(AppEvents.REDRAW, () => {
    scheduleRedraw();
  });

  window.addEventListener("resize", () => {
    scheduleRedraw();
    syncControlsFromState();
  });

  syncControlsFromState();
  scheduleRedraw();
}

function bootApp() {
  try {
    startApp();
  } catch (err) {
    const root = document.getElementById("app");
    const message = err instanceof Error ? err.message : String(err);
    console.error("[LensTile] boot failed:", err);
    if (root) {
      root.textContent = `${APP_NAME} could not start: ${message}`;
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootApp, { once: true });
} else {
  bootApp();
}
