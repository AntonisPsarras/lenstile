import { describe, test, assertEqual } from "./test-utils.js";
import {
  validateImageFileMeta,
  validateColorCount,
  validateProjectName,
  detectMissingApis,
  checkImageSizeWarning,
} from "../src/validation.js";
import { mountLayout } from "../src/ui/layout.js";
import { FEATURES, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from "../src/config.js";
import { loadImageFile } from "../src/image/image-loader.js";

describe("image file validation", () => {
  test("accepts png jpeg webp", () => {
    assertEqual(validateImageFileMeta("image/png", "a.png").ok, true);
    assertEqual(validateImageFileMeta("image/jpeg", "a.jpg").ok, true);
    assertEqual(validateImageFileMeta("image/webp", "a.webp").ok, true);
  });

  test("rejects gif and svg for now", () => {
    assertEqual(validateImageFileMeta("image/gif", "a.gif").ok, false);
    assertEqual(validateImageFileMeta("image/svg+xml", "a.svg").ok, false);
  });

  test("extension fallback when mime empty", () => {
    assertEqual(validateImageFileMeta("", "photo.PNG").ok, true);
  });

  test("empty selection rejected", () => {
    assertEqual(validateImageFileMeta(null, null).ok, false);
  });

  test("large image warning threshold", () => {
    const small = checkImageSizeWarning(100, 100);
    assertEqual(small.warn, false);
    const large = checkImageSizeWarning(10000, 5000);
    assertEqual(large.warn, true);
    assertEqual(typeof large.message, "string");
  });
});

describe("image loader errors", () => {
  test("loadImageFile rejects empty selection", async () => {
    await assertThrowsAsync(() => loadImageFile(/** @type {any} */ (null)), "Empty file");
  });

  test("loadImageFile rejects unsupported mime", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "x.gif", { type: "image/gif" });
    await assertThrowsAsync(() => loadImageFile(file), "Unsupported");
  }, { expectedErrors: ["unsupported-gif"] });
});

describe("settings validation", () => {
  test("color count bounds", () => {
    assertEqual(validateColorCount(1).ok, true);
    assertEqual(validateColorCount(8).ok, true);
    assertEqual(validateColorCount(0).ok, false);
    assertEqual(validateColorCount(9).ok, false);
  });

  test("project name", () => {
    assertEqual(validateProjectName("  Tile  ").value, "Tile");
    assertEqual(validateProjectName("").ok, false);
  });
});

describe("browser API detection", () => {
  test("detectMissingApis finds nothing in a capable browser", () => {
    const missing = detectMissingApis(window);
    assertEqual(Array.isArray(missing), true);
    assertEqual(missing.length, 0);
  });
});

describe("UI initialization", () => {
  test("mountLayout creates canvas and steps", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const layout = mountLayout(root);
    assertEqual(Boolean(layout.canvas), true);
    assertEqual(Boolean(layout.imageInput), true);
    assertEqual(root.querySelectorAll(".step-button").length, 4);
    assertEqual(document.getElementById("btn-download-combined-stl")?.disabled, true);
    assertEqual(FEATURES.stlExport, true);
    assertEqual(FEATURES.threeMfExport, true);
    assertEqual(Boolean(document.getElementById("live-region")), true);
    assertEqual(Boolean(document.getElementById("toast-host")), true);
    assertEqual(Boolean(document.getElementById("image-drop-zone")), true);
    assertEqual(Boolean(document.getElementById("detail-profile")), true);
    assertEqual(Boolean(document.getElementById("print-profile")), true);
    assertEqual(document.getElementById("ppm"), null);
    assertEqual(document.getElementById("nozzle"), null);
    assertEqual(document.getElementById("min-feature"), null);
    root.remove();
  });

  test("zoom control range matches config ZOOM_*", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLayout(root);
    const zoom = /** @type {HTMLInputElement} */ (document.getElementById("zoom"));
    assertEqual(zoom.min, String(ZOOM_MIN));
    assertEqual(zoom.max, String(ZOOM_MAX));
    assertEqual(zoom.step, String(ZOOM_STEP));
    root.remove();
  });

  test("canvas fallback is a child of the canvas element", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const layout = mountLayout(root);
    const fallback = document.getElementById("canvas-fallback");
    assertEqual(Boolean(fallback), true);
    assertEqual(layout.canvas.contains(/** @type {Node} */ (fallback)), true);
    root.remove();
  });
});

/**
 * @param {() => Promise<unknown>} fn
 * @param {string} [messageIncludes]
 */
async function assertThrowsAsync(fn, messageIncludes) {
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
    if (messageIncludes) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes(messageIncludes)) {
        throw new Error(`Expected error to include "${messageIncludes}", got: ${msg}`);
      }
    }
  }
  if (!threw) {
    throw new Error("Expected async function to throw");
  }
}
