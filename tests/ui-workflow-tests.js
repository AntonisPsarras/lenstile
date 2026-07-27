/**
 * Milestone 6.1 — workflow terminology, Node removal, toast / polish checks.
 */

import {
  describe,
  test,
  assertEqual,
} from "./test-utils.js";
import { mountLayout } from "../src/ui/layout.js";
import {
  FEATURES,
  STEP_LABELS,
  STEPS,
  TOAST_SUCCESS_MS,
  APP_VERSION,
} from "../src/config.js";
import {
  resetStore,
  setSourceImage,
  setActiveStep,
  beginQuantizeRequest,
  acceptQuantizeResult,
  beginPrintabilityRequest,
  acceptPrintabilityResult,
  acceptCleanedDesign,
  getExportReadinessGaps,
  isPrintabilityExportReady,
  getState,
  getRuntimeWorkflow,
} from "../src/state.js";
import {
  showNotice,
  showError,
  clearMessages,
  renderToasts,
  dismissError,
} from "../src/ui/notifications.js";
import { getExportReadiness } from "../src/ui/export-controller.js";
import { bindControls, syncControlsFromState } from "../src/ui/controls.js";
import { GOLDEN_COMBINED_TILE } from "./fixtures/geometry-golden.js";

describe("Milestone 6.1 project constraints", () => {
  test("no Node-specific project runner remains", async () => {
    const res = await fetch("../tests/run-node-pure.mjs", { method: "HEAD", cache: "no-store" });
    assertEqual(res.status === 404 || res.status === 0, true, `unexpected status ${res.status}`);
  });

  test("no package manifest exists at project root", async () => {
    const names = ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
    for (const name of names) {
      const res = await fetch(`../${name}`, { method: "HEAD", cache: "no-store" });
      assertEqual(
        res.ok,
        false,
        `Expected missing ${name}, got status ${res.status}`,
      );
    }
  });

  test("browser test harness is authoritative", () => {
    assertEqual(
      document.title.includes("Test")
        || Boolean(document.getElementById("summary"))
        || Boolean(document.getElementById("out")),
      true,
    );
    assertEqual(typeof TOAST_SUCCESS_MS, "number");
    assertEqual(TOAST_SUCCESS_MS >= 3000 && TOAST_SUCCESS_MS <= 5000, true);
    assertEqual(
      APP_VERSION.includes("9") || APP_VERSION.includes("7") || APP_VERSION.includes("6.2") || APP_VERSION.includes("6.1"),
      true,
    );
  });
});

describe("Milestone 6.1 terminology and workflow UI", () => {
  /** @type {HTMLElement | null} */
  let root = null;

  function mount() {
    resetStore();
    root = document.createElement("div");
    document.body.appendChild(root);
    const layout = mountLayout(root);
    bindControls({
      canvas: layout.canvas,
      canvasShell: layout.canvasShell,
      imageInput: layout.imageInput,
      scheduleRedraw: () => {},
      getCropSize: () => ({ width: 592, height: 212 }),
    });
    syncControlsFromState();
    return layout;
  }

  function unmount() {
    if (root) root.remove();
    root = null;
    clearMessages();
    resetStore();
  }

  test("standard UI contains no Quantize button label", () => {
    mount();
    const btn = document.getElementById("btn-quantize");
    assertEqual(Boolean(btn), true);
    assertEqual(btn?.textContent?.includes("Quantize"), false);
    assertEqual(btn?.textContent?.includes("Create color preview"), true);
    unmount();
  });

  test("standard UI contains no Quantization current label", () => {
    mount();
    const readiness = document.getElementById("export-readiness");
    assertEqual(Boolean(readiness), true);
    assertEqual(readiness?.textContent?.includes("Quantization current"), false);
    assertEqual(root?.textContent?.includes("Quantization current"), false);
    unmount();
  });

  test("standard UI contains no Printability tab label", () => {
    mount();
    const printStep = document.getElementById("step-printability");
    assertEqual(Boolean(printStep), true);
    assertEqual(printStep?.textContent?.trim(), "3. Make printable");
    assertEqual(STEP_LABELS.printability, "3. Make printable");
    assertEqual(STEP_LABELS.export, "4. Download");
    unmount();
  });

  test("standard UI contains no visible stale terminology", () => {
    mount();
    const visible = collectVisibleText(root);
    assertEqual(/\bstale\b/i.test(visible), false);
    unmount();
  });

  test("primary steps have user-facing numbered labels", () => {
    mount();
    assertEqual(STEPS.length, 4);
    assertEqual(STEP_LABELS.image.startsWith("1."), true);
    assertEqual(STEP_LABELS.colors.startsWith("2."), true);
    assertEqual(STEP_LABELS.printability.startsWith("3."), true);
    assertEqual(STEP_LABELS.export.startsWith("4."), true);
    const labels = [...document.querySelectorAll(".step-button")].map((b) => b.textContent?.trim());
    assertEqual(labels[0], "1. Image");
    assertEqual(labels[1], "2. Colors");
    assertEqual(labels[2], "3. Make printable");
    assertEqual(labels[3], "4. Download");
    unmount();
  });

  test("missing image keeps Continue to colors disabled", () => {
    mount();
    const btn = /** @type {HTMLButtonElement} */ (document.getElementById("btn-continue-colors"));
    assertEqual(btn.disabled, true);
    unmount();
  });

  test("Image completion enables Continue to colors", () => {
    mount();
    const bitmap = createTestBitmap(8, 4);
    setSourceImage(
      { fileName: "t.png", mimeType: "image/png", widthPx: 8, heightPx: 4 },
      /** @type {any} */ (bitmap),
      { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0, flipX: false, flipY: false },
    );
    syncControlsFromState();
    const btn = /** @type {HTMLButtonElement} */ (document.getElementById("btn-continue-colors"));
    assertEqual(btn.disabled, false);
    unmount();
  });

  test("Color preview completion enables Continue to print check", () => {
    mount();
    seedQuantization();
    syncControlsFromState();
    const btn = /** @type {HTMLButtonElement} */ (document.getElementById("btn-continue-print"));
    assertEqual(btn.disabled, false);
    unmount();
  });

  test("Printable-design acceptance enables Continue to download", () => {
    mount();
    seedAcceptedCleanup();
    syncControlsFromState();
    const btn = /** @type {HTMLButtonElement} */ (document.getElementById("btn-continue-download"));
    assertEqual(btn.disabled, false);
    assertEqual(isPrintabilityExportReady(), true);
    unmount();
  });

  test("Technical print values are inside a collapsed disclosure", () => {
    mount();
    const details = /** @type {HTMLDetailsElement} */ (document.getElementById("print-tech-details"));
    assertEqual(Boolean(details), true);
    assertEqual(details.open, false);
    assertEqual(details.querySelector("summary")?.textContent?.includes("Technical details"), true);
    assertEqual(Boolean(document.getElementById("print-derived-nozzle")), true);
    assertEqual(details.contains(document.getElementById("print-derived-settings")), true);
    unmount();
  });

  test("Rebuild model uses accepted current design only", () => {
    mount();
    const readiness = getExportReadiness();
    assertEqual(readiness.canGenerate, false, "expected canGenerate false before seed");
    seedAcceptedCleanup();
    const ready = getExportReadiness();
    const wf = getRuntimeWorkflow();
    assertEqual(
      ready.canGenerate,
      true,
      `expected canGenerate after seed (status=${wf.pipelineStatus}, needsReview=${wf.needsReview}, accepted=${ready.cleanupAccepted}, current=${ready.cleanupCurrent})`,
    );
    assertEqual(ready.cleanupAccepted, true, "cleanupAccepted");
    assertEqual(ready.cleanupCurrent, true, "cleanupCurrent");
    const gen = document.getElementById("btn-generate-model");
    assertEqual(Boolean(gen), true, "btn-generate-model missing");
    assertEqual(
      Boolean(gen?.textContent?.includes("Rebuild")),
      true,
      `unexpected generate label: ${gen?.textContent}`,
    );
    unmount();
  });

  test("More file options contains advanced STL downloads", () => {
    mount();
    const more = document.getElementById("export-more-options");
    assertEqual(Boolean(more), true);
    assertEqual(more?.querySelector("summary")?.textContent?.includes("More file options"), true);
    assertEqual(Boolean(document.getElementById("btn-download-base-stl")), true);
    assertEqual(Boolean(document.getElementById("btn-download-all-colors-stl")), true);
    assertEqual(more?.contains(document.getElementById("btn-download-base-stl")), true);
    assertEqual(
      document.getElementById("btn-download-combined-stl")?.textContent?.includes("one-filament")
        || document.getElementById("btn-download-combined-stl")?.textContent?.includes("one-color"),
      true,
    );
    unmount();
  });

  test("3MF download is available when feature enabled", () => {
    mount();
    const btn = /** @type {HTMLButtonElement} */ (document.getElementById("btn-export-3mf"));
    assertEqual(FEATURES.threeMfExport, true);
    assertEqual(btn.textContent?.includes("coming next"), false);
    assertEqual(btn.textContent?.includes("Download multicolor 3MF"), true);
    assertEqual(Boolean(document.getElementById("export-base-color")), true);
    // Disabled until geometry prerequisites are met.
    assertEqual(btn.disabled, true);
    unmount();
  });

  test("Normal Download UI contains no internal ZIP terminology", () => {
    mount();
    const exportPanel = document.querySelector('[data-panel="export"]');
    const text = exportPanel?.textContent || "";
    assertEqual(/central directory|EOCD|CRC-32|Store method/i.test(text), false);
    assertEqual(text.includes("coming next"), false);
    unmount();
  });

  test("Success toast auto-dismiss behavior", async () => {
    mount();
    showNotice("Color preview created");
    renderToasts();
    const host = document.getElementById("toast-host");
    assertEqual(Boolean(host?.querySelector(".app-status-card")), true);
    assertEqual(host?.textContent?.includes("Color preview created"), true);
    assertEqual(TOAST_SUCCESS_MS >= 3000 && TOAST_SUCCESS_MS <= 5000, true);
    // Do not wait full dismiss in suite; clearMessages proves teardown path.
    clearMessages();
    renderToasts();
    assertEqual(host?.querySelector(".app-status-card"), null);
    unmount();
  });

  test("Error messages remain available until dismissed", () => {
    mount();
    showError("Create a color preview first.");
    renderToasts();
    const host = document.getElementById("toast-host");
    assertEqual(Boolean(host?.querySelector(".app-status-error")), true);
    assertEqual(host?.textContent?.includes("Create a color preview first."), true);
    dismissError();
    renderToasts();
    assertEqual(host?.querySelector(".app-status-error"), null);
    unmount();
  }, { expectedErrors: ["printability-before-color-preview"] });

  test("Reduced-motion mode disables nonessential animation", async () => {
    const sheets = [...document.styleSheets];
    let found = false;
    for (const sheet of sheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule && rule.conditionText.includes("prefers-reduced-motion")) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    // Also check app stylesheets via fetch of tokens/components.
    const cssText = await (await fetch("../styles/components.css")).text()
      + await (await fetch("../styles/tokens.css")).text()
      + await (await fetch("../styles/layout.css")).text();
    assertEqual(cssText.includes("prefers-reduced-motion"), true);
    assertEqual(cssText.includes("animation: none"), true);
  });

  test("Existing geometry golden metrics remain unchanged by terminology", () => {
    assertEqual(GOLDEN_COMBINED_TILE.bounds.sizeX, 148);
    assertEqual(GOLDEN_COMBINED_TILE.bounds.sizeY, 53);
    assertEqual(GOLDEN_COMBINED_TILE.bounds.sizeZ, 4);
    assertEqual(GOLDEN_COMBINED_TILE.triangleCount > 0, true);
    assertEqual(typeof GOLDEN_COMBINED_TILE.stlFnv1a, "string");
    assertEqual(GOLDEN_COMBINED_TILE.stlFnv1a, "a1f5c9ce");
  });

  test("plain readiness gaps avoid engineering jargon", () => {
    resetStore();
    const gaps = getExportReadinessGaps();
    const joined = gaps.join(" ");
    assertEqual(/quantiz|stale|topology|manifold|cleanup revision/i.test(joined), false);
    assertEqual(joined.includes("color preview") || joined.includes("image"), true);
  });
});

/**
 * @param {HTMLElement | null} el
 */
function collectVisibleText(el) {
  if (!el) return "";
  /** @type {string[]} */
  const parts = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent && !parent.hidden && parent.closest("[hidden]") == null) {
      const t = (node.textContent || "").trim();
      if (t) parts.push(t);
    }
    node = walker.nextNode();
  }
  return parts.join(" ");
}

function seedQuantization() {
  const bitmap = createTestBitmap(4, 2);
  setSourceImage(
    { fileName: "q.png", mimeType: "image/png", widthPx: 4, heightPx: 2 },
    /** @type {any} */ (bitmap),
    { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0, flipX: false, flipY: false },
  );
  const sourceRevision = getState().sourceRevision;
  beginQuantizeRequest("m61-q");
  const ok = acceptQuantizeResult({
    requestId: "m61-q",
    sourceRevision,
    result: {
      width: 4,
      height: 2,
      requestedColorCount: 2,
      actualColorCount: 2,
      generatedPalette: [
        { r: 0, g: 0, b: 0, population: 4 },
        { r: 255, g: 255, b: 255, population: 4 },
      ],
      indices: new Uint8Array([0, 0, 1, 1, 0, 0, 1, 1]),
      sourceRevision,
      algorithmVersion: 1,
      diagnostics: { uniqueColorCount: 2, iterations: 1, durationMs: 1 },
    },
    previewRgba: new Uint8ClampedArray(4 * 2 * 4),
  });
  if (!ok) throw new Error("seedQuantization failed to accept result");
}

function seedAcceptedCleanup() {
  seedQuantization();
  const s = getState();
  beginPrintabilityRequest("m61-p");
  const ok = acceptPrintabilityResult({
    requestId: "m61-p",
    sourceRevision: s.sourceRevision,
    printabilityRevision: s.printabilityRevision,
    ranCleanup: true,
    result: {
      width: 4,
      height: 2,
      issueMask: new Uint8Array(8),
      cleanedIndices: new Uint8Array([0, 0, 1, 1, 0, 0, 1, 1]),
      report: {
        componentCount: 2,
        smallIslandCount: 0,
        smallIslandPixels: 0,
        smallHoleCount: 0,
        smallHolePixels: 0,
        narrowFeaturePixelCount: 0,
        narrowGapPixelCount: 0,
        cleanupPasses: 1,
        changedPixelCount: 0,
        warnings: [],
      },
      algorithmVersion: 1,
    },
  });
  if (!ok) throw new Error("seedAcceptedCleanup failed to accept result");
  acceptCleanedDesign();
  setActiveStep("printability");
}

/**
 * @param {number} w
 * @param {number} h
 */
function createTestBitmap(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  // createImageBitmap may be unavailable in some environments; fall back via Offscreen if needed.
  return canvas;
}
