/**
 * Single image-import entry path: one hidden file input, one openImagePicker(),
 * one load pipeline for choose / replace / drag-and-drop.
 */

import {
  getState,
  getRuntimeBitmap,
  setSourceImage,
  clearSourceImage,
  setActiveStep,
} from "../state.js";
import { loadImageFile } from "../image/image-loader.js";
import { createResetTransform } from "../image/crop-transform.js";
import { showError, showNotice, clearMessages } from "./notifications.js";

/** @type {HTMLInputElement | null} */
let fileInput = null;

/** @type {(() => { width: number, height: number }) | null} */
let getCropSize = null;

/** Guard against re-entrant picker activation from the same event (bubbling). */
let pickerOpening = false;

/**
 * Test / diagnostics: how many times openImagePicker invoked input.click().
 * @type {number}
 */
export let pickerActivationCount = 0;

/**
 * @param {object} ctx
 * @param {HTMLInputElement} ctx.imageInput
 * @param {HTMLElement} ctx.canvasShell
 * @param {() => { width: number, height: number }} ctx.getCropSize
 */
export function bindImageImport(ctx) {
  fileInput = ctx.imageInput;
  getCropSize = ctx.getCropSize;
  pickerActivationCount = 0;
  pickerOpening = false;

  fileInput.addEventListener("change", async () => {
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) return;
    await importImageFile(file);
    if (fileInput) fileInput.value = "";
  });

  bindDropZone(ctx.canvasShell);
  bindImportButtons();
  syncImageImportUi();
}

/**
 * Sole function allowed to invoke the system file chooser.
 * Intended controls must call this; unrelated UI must not.
 */
export function openImagePicker() {
  if (!fileInput) {
    showError("Image picker is not ready.");
    return;
  }
  if (pickerOpening) {
    return;
  }
  pickerOpening = true;
  pickerActivationCount += 1;
  try {
    fileInput.click();
  } finally {
    pickerOpening = false;
  }
}

/**
 * Shared loading pipeline for choose, replace, and drag-and-drop.
 * @param {File} file
 */
export async function importImageFile(file) {
  if (!getCropSize) {
    showError("Image import is not ready.");
    return;
  }
  clearMessages();
  clearDropZoneError();
  try {
    const loaded = await loadImageFile(file);
    const crop = getCropSize();
    const image = { width: loaded.widthPx, height: loaded.heightPx };
    const transform = createResetTransform(image, crop);
    setSourceImage(
      {
        fileName: loaded.fileName,
        mimeType: loaded.mimeType,
        widthPx: loaded.widthPx,
        heightPx: loaded.heightPx,
      },
      loaded.bitmap,
      transform,
    );
    setActiveStep("image");
    if (loaded.warning) {
      showNotice(loaded.warning);
    } else {
      showNotice("Image added");
    }
    syncImageImportUi();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showError(message);
    setDropZoneError(message);
  }
}

/**
 * Remove the loaded image after confirmation when one is present.
 * @param {{ confirmFn?: (message: string) => boolean }} [opts]
 */
export function removeImage(opts = {}) {
  if (!getRuntimeBitmap()) {
    syncImageImportUi();
    return;
  }
  const confirmFn = opts.confirmFn || ((message) => window.confirm(message));
  const ok = confirmFn("Remove the current image? Crop and color preview will be cleared.");
  if (!ok) return;
  clearSourceImage();
  clearMessages();
  showNotice("Image removed.");
  syncImageImportUi();
}

/**
 * Reflect empty vs loaded image import UI.
 */
export function syncImageImportUi() {
  const hasImage = Boolean(getRuntimeBitmap());
  const s = getState();
  const dropZone = document.getElementById("image-drop-zone");
  const canvas = document.getElementById("crop-canvas");
  const shell = document.getElementById("canvas-shell");
  const emptyActions = document.getElementById("image-empty-actions");
  const loadedActions = document.getElementById("image-loaded-actions");
  const meta = document.getElementById("image-meta");
  const metaName = document.getElementById("image-meta-name");
  const metaDims = document.getElementById("image-meta-dims");

  if (dropZone) {
    dropZone.hidden = hasImage;
    dropZone.classList.toggle("is-disabled", Boolean(s.ui.isProcessing));
    dropZone.setAttribute("aria-hidden", hasImage ? "true" : "false");
    if (hasImage) {
      dropZone.tabIndex = -1;
    } else {
      dropZone.tabIndex = 0;
    }
  }

  if (canvas) {
    canvas.classList.toggle("is-interactive", hasImage);
    canvas.setAttribute(
      "aria-label",
      hasImage ? "Tile crop preview — drag to pan, wheel to zoom" : "Tile crop preview",
    );
  }

  if (shell) {
    shell.classList.toggle("has-image", hasImage);
    shell.classList.remove("is-drop-target", "is-replace-target");
  }

  if (emptyActions) emptyActions.hidden = hasImage;
  if (loadedActions) loadedActions.hidden = !hasImage;

  if (meta) meta.hidden = !hasImage;
  if (metaName) {
    metaName.textContent = hasImage ? (s.sourceImage.fileName || "Untitled image") : "";
  }
  if (metaDims) {
    metaDims.textContent = hasImage
      ? `${s.sourceImage.widthPx} × ${s.sourceImage.heightPx} px`
      : "";
  }

  ["btn-fit", "btn-fill", "btn-reset", "btn-rotate", "btn-flip-h", "btn-flip-v"].forEach((id) => {
    const button = /** @type {HTMLButtonElement|null} */ (document.getElementById(id));
    if (button) button.disabled = !hasImage;
  });
  const zoom = /** @type {HTMLInputElement|null} */ (document.getElementById("zoom"));
  if (zoom) zoom.disabled = !hasImage;
}

/**
 * @param {HTMLElement} canvasShell
 */
function bindDropZone(canvasShell) {
  const dropZone = document.getElementById("image-drop-zone");

  ;["dragenter", "dragover"].forEach((type) => {
    canvasShell.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      const hasImage = Boolean(getRuntimeBitmap());
      canvasShell.classList.add(hasImage ? "is-replace-target" : "is-drop-target");
      dropZone?.classList.add("is-drag-active");
    });
  });

  ;["dragleave", "drop"].forEach((type) => {
    canvasShell.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      canvasShell.classList.remove("is-drop-target", "is-replace-target");
      dropZone?.classList.remove("is-drag-active");
    });
  });

  canvasShell.addEventListener("drop", async (event) => {
    const dt = /** @type {DragEvent} */ (event).dataTransfer;
    const file = dt && dt.files && dt.files[0];
    if (!file) return;
    await importImageFile(file);
    syncImageImportUi();
  });

  if (dropZone) {
    dropZone.addEventListener("click", (event) => {
      if (getRuntimeBitmap()) return;
      if (getState().ui.isProcessing) return;
      // Choose image button handles its own click; avoid double open.
      const target = /** @type {HTMLElement} */ (event.target);
      if (target.closest("#btn-choose-image")) return;
      event.preventDefault();
      event.stopPropagation();
      openImagePicker();
    });

    dropZone.addEventListener("keydown", (event) => {
      if (getRuntimeBitmap()) return;
      if (getState().ui.isProcessing) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = /** @type {HTMLElement} */ (event.target);
      if (target.closest("#btn-choose-image")) return;
      event.preventDefault();
      event.stopPropagation();
      openImagePicker();
    });
  }
}

function bindImportButtons() {
  const choose = document.getElementById("btn-choose-image");
  choose?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openImagePicker();
  });

  const replace = document.getElementById("btn-replace-image");
  replace?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openImagePicker();
  });

  const remove = document.getElementById("btn-remove-image");
  remove?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeImage();
  });
}

/** @param {string} message */
function setDropZoneError(message) {
  const dropZone = document.getElementById("image-drop-zone");
  const err = document.getElementById("drop-zone-error");
  dropZone?.classList.add("is-error");
  if (err) {
    err.hidden = false;
    err.textContent = message;
  }
}

function clearDropZoneError() {
  const dropZone = document.getElementById("image-drop-zone");
  const err = document.getElementById("drop-zone-error");
  dropZone?.classList.remove("is-error");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
}
