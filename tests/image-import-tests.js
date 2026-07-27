/**
 * Image import UX tests — single picker path, drop zone, remove (Milestone 2.1).
 */

import {
  describe,
  test,
  assertEqual,
} from "./test-utils.js";
import { mountLayout } from "../src/ui/layout.js";
import { bindControls, syncControlsFromState } from "../src/ui/controls.js";
import {
  openImagePicker,
  importImageFile,
  removeImage,
  syncImageImportUi,
  pickerActivationCount,
} from "../src/ui/image-import-controller.js";
import {
  resetStore,
  getState,
  getRuntimeBitmap,
  getRuntimeQuantization,
  setSourceImage,
  beginQuantizeRequest,
  acceptQuantizeResult,
} from "../src/state.js";
import { clearAllListeners } from "../src/events.js";

/**
 * @param {string} name
 * @returns {Promise<File>}
 */
async function makePngFile(name = "sample.png") {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

/**
 * Mount app UI and bind controls for import tests.
 * @returns {{
 *   root: HTMLElement,
 *   layout: ReturnType<typeof mountLayout>,
 *   clickCounts: Record<string, number>,
 *   restoreClick: () => void,
 * }}
 */
function setupImportUi() {
  resetStore();
  clearAllListeners();

  const root = document.createElement("div");
  document.body.appendChild(root);
  const layout = mountLayout(root);
  // These are UI-routing tests, not native decoder tests. Some automated
  // browser hosts expose createImageBitmap but never settle its promise for
  // synthetic canvas/File inputs, so use a deterministic in-memory decoder.
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => {
    const decoded = document.createElement("canvas");
    decoded.width = 4;
    decoded.height = 4;
    return decoded;
  };

  /** @type {Record<string, number>} */
  const clickCounts = { imageInput: 0 };
  const originalClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function patchedClick() {
    if (this.id === "image-input") {
      clickCounts.imageInput += 1;
      return;
    }
    return originalClick.call(this);
  };

  bindControls({
    canvas: layout.canvas,
    canvasShell: layout.canvasShell,
    imageInput: layout.imageInput,
    scheduleRedraw: () => {},
    getCropSize: () => ({ width: 296, height: 106 }),
  });

  return {
    root,
    layout,
    clickCounts,
    restoreClick: () => {
      HTMLInputElement.prototype.click = originalClick;
      globalThis.createImageBitmap = originalCreateImageBitmap;
      root.remove();
      resetStore();
      clearAllListeners();
    },
  };
}

/**
 * @param {ReturnType<typeof setupImportUi>} ctx
 */
async function loadSampleImage(ctx) {
  const canvas = document.createElement("canvas");
  canvas.width = 10;
  canvas.height = 8;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2d context unavailable");
  g.fillStyle = "#224466";
  g.fillRect(0, 0, 10, 8);

  setSourceImage(
    {
      fileName: "sample.png",
      mimeType: "image/png",
      widthPx: 10,
      heightPx: 8,
    },
    /** @type {ImageBitmap} */ (canvas),
    {
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
    },
  );
  syncImageImportUi();
  syncControlsFromState();
  assertEqual(Boolean(getRuntimeBitmap()), true);
  void ctx;
}

describe("image import UX", () => {
  test("empty drop zone activates image selection", () => {
    const ctx = setupImportUi();
    try {
      const before = ctx.clickCounts.imageInput;
      document.getElementById("image-drop-zone")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      assertEqual(ctx.clickCounts.imageInput, before + 1);
    } finally {
      ctx.restoreClick();
    }
  });

  test("Choose image activates image selection", () => {
    const ctx = setupImportUi();
    try {
      const before = ctx.clickCounts.imageInput;
      document.getElementById("btn-choose-image")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      assertEqual(ctx.clickCounts.imageInput, before + 1);
    } finally {
      ctx.restoreClick();
    }
  });

  test("Replace image activates image selection", async () => {
    const ctx = setupImportUi();
    try {
      await loadSampleImage(ctx);
      const before = ctx.clickCounts.imageInput;
      document.getElementById("btn-replace-image")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      assertEqual(ctx.clickCounts.imageInput, before + 1);
    } finally {
      ctx.restoreClick();
    }
  });

  test("canvas click does not activate image selection after load", async () => {
    const ctx = setupImportUi();
    try {
      await loadSampleImage(ctx);
      const before = ctx.clickCounts.imageInput;
      ctx.layout.canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      assertEqual(ctx.clickCounts.imageInput, before);
    } finally {
      ctx.restoreClick();
    }
  });

  test("Fit does not activate image selection", async () => {
    const ctx = setupImportUi();
    try {
      await loadSampleImage(ctx);
      const before = ctx.clickCounts.imageInput;
      document.getElementById("btn-fit")?.click();
      assertEqual(ctx.clickCounts.imageInput, before);
    } finally {
      ctx.restoreClick();
    }
  });

  test("Fill does not activate image selection", async () => {
    const ctx = setupImportUi();
    try {
      await loadSampleImage(ctx);
      const before = ctx.clickCounts.imageInput;
      document.getElementById("btn-fill")?.click();
      assertEqual(ctx.clickCounts.imageInput, before);
    } finally {
      ctx.restoreClick();
    }
  });

  test("Reset does not activate image selection", async () => {
    const ctx = setupImportUi();
    try {
      await loadSampleImage(ctx);
      const before = ctx.clickCounts.imageInput;
      document.getElementById("btn-reset")?.click();
      assertEqual(ctx.clickCounts.imageInput, before);
    } finally {
      ctx.restoreClick();
    }
  });

  test("Rotate does not activate image selection", async () => {
    const ctx = setupImportUi();
    try {
      await loadSampleImage(ctx);
      const before = ctx.clickCounts.imageInput;
      document.getElementById("btn-rotate")?.click();
      assertEqual(ctx.clickCounts.imageInput, before);
    } finally {
      ctx.restoreClick();
    }
  });

  test("Flip controls do not activate image selection", async () => {
    const ctx = setupImportUi();
    try {
      await loadSampleImage(ctx);
      const before = ctx.clickCounts.imageInput;
      document.getElementById("btn-flip-h")?.click();
      document.getElementById("btn-flip-v")?.click();
      assertEqual(ctx.clickCounts.imageInput, before);
    } finally {
      ctx.restoreClick();
    }
  });

  test("Step navigation does not activate image selection", () => {
    const ctx = setupImportUi();
    try {
      const before = ctx.clickCounts.imageInput;
      document.getElementById("step-colors")?.click();
      document.getElementById("step-printability")?.click();
      document.getElementById("step-image")?.click();
      assertEqual(ctx.clickCounts.imageInput, before);
    } finally {
      ctx.restoreClick();
    }
  });

  test("dropping a supported image uses the standard loading pipeline", async () => {
    const ctx = setupImportUi();
    try {
      const file = await makePngFile("drop.png");
      await importImageFile(file);
      assertEqual(Boolean(getRuntimeBitmap()), true);
      assertEqual(getState().sourceImage.fileName, "drop.png");
      assertEqual(getState().sourceImage.widthPx > 0, true);
    } finally {
      ctx.restoreClick();
    }
  });

  test("unsupported dropped files show the normal validation error", async () => {
    const ctx = setupImportUi();
    try {
      const bad = new File([new Uint8Array([1, 2, 3])], "x.gif", { type: "image/gif" });
      await importImageFile(bad);
      syncControlsFromState();
      const err = document.getElementById("status-error");
      const dropErr = document.getElementById("drop-zone-error");
      assertEqual(String(err?.textContent || "").includes("Unsupported")
        || String(dropErr?.textContent || "").includes("Unsupported"), true);
      assertEqual(getRuntimeBitmap(), null);
    } finally {
      ctx.restoreClick();
    }
  }, { expectedErrors: ["unsupported-gif"] });

  test("Remove image clears runtime image and quantization data", async () => {
    const ctx = setupImportUi();
    try {
      await loadSampleImage(ctx);
      beginQuantizeRequest("req-rm");
      acceptQuantizeResult({
        requestId: "req-rm",
        sourceRevision: getState().sourceRevision,
        result: {
          width: 2,
          height: 2,
          requestedColorCount: 1,
          actualColorCount: 1,
          generatedPalette: [{ r: 0, g: 0, b: 0, population: 4 }],
          indices: new Uint8Array([0, 0, 0, 0]),
          algorithmVersion: 1,
          diagnostics: { uniqueColorCount: 1, iterations: 1, durationMs: 1 },
        },
        previewRgba: new Uint8ClampedArray(16),
      });
      assertEqual(Boolean(getRuntimeQuantization().indices), true);

      removeImage({ confirmFn: () => true });
      assertEqual(getRuntimeBitmap(), null);
      assertEqual(getState().sourceImage.fileName, null);
      assertEqual(getRuntimeQuantization().indices, null);
      assertEqual(getRuntimeQuantization().status, "idle");
      assertEqual(document.getElementById("image-drop-zone")?.hidden, false);
    } finally {
      ctx.restoreClick();
    }
  });

  test("keyboard Enter and Space activate the empty drop zone", () => {
    const ctx = setupImportUi();
    try {
      const zone = document.getElementById("image-drop-zone");
      const before = ctx.clickCounts.imageInput;
      zone?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      zone?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
      assertEqual(ctx.clickCounts.imageInput, before + 2);
    } finally {
      ctx.restoreClick();
    }
  });

  test("drop zone drag-active uses warm amber surface hover token", () => {
    const ctx = setupImportUi();
    try {
      const token = getComputedStyle(document.documentElement)
        .getPropertyValue("--accent-surface-hover")
        .trim();
      assertEqual(token, "rgba(213, 138, 37, 0.08)");
      const zone = document.getElementById("image-drop-zone");
      assertEqual(Boolean(zone), true);
      zone?.classList.add("is-drag-active");
      const bg = getComputedStyle(/** @type {HTMLElement} */ (zone)).backgroundColor;
      // Computed rgba for amber @ 8% opacity (channel rounding may vary slightly).
      assertEqual(bg.startsWith("rgba(213, 138, 37,"), true);
      zone?.classList.remove("is-drag-active");
    } finally {
      ctx.restoreClick();
    }
  });

  test("no duplicate picker opening occurs from one action", () => {
    const ctx = setupImportUi();
    try {
      const before = ctx.clickCounts.imageInput;
      // Choose image is inside the drop zone; stopPropagation must prevent a second open.
      document.getElementById("btn-choose-image")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      assertEqual(ctx.clickCounts.imageInput, before + 1);

      // Re-entrant open during an in-flight click must be ignored.
      const mid = ctx.clickCounts.imageInput;
      const originalClick = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function reentrantClick() {
        if (this.id === "image-input") {
          ctx.clickCounts.imageInput += 1;
          openImagePicker();
          return;
        }
        return originalClick.call(this);
      };
      try {
        openImagePicker();
      } finally {
        HTMLInputElement.prototype.click = function patchedClick() {
          if (this.id === "image-input") {
            ctx.clickCounts.imageInput += 1;
            return;
          }
          return originalClick.call(this);
        };
      }
      assertEqual(ctx.clickCounts.imageInput, mid + 1);
      void pickerActivationCount;
    } finally {
      ctx.restoreClick();
    }
  });
});
