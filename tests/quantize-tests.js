import {
  describe,
  test,
  assertEqual,
  assertDeepEqual,
  assertThrows,
} from "./test-utils.js";
import { quantizeImage } from "../src/image/quantize.js";
import { computeQuantizationSize, validateQuantizationResolution } from "../src/image/resolution.js";
import {
  compositeSourceOver,
  compositeRgbaOverBackground,
  resolveBackgroundColor,
} from "../src/image/transparency.js";
import {
  buildPaletteEntries,
  effectivePalette,
  replacePaletteColor,
  resetPaletteOverrides,
  parseHexColor,
  formatHexColor,
} from "../src/image/palette.js";
import { indicesToRgba } from "../src/image/indexed-preview.js";
import { rgbLuminance, roundChannel } from "../src/image/color-space.js";
import { QuantizeErrorCode } from "../src/image/quantize-errors.js";
import { MAX_QUANTIZATION_PIXELS, QUANTIZE_ALGORITHM_VERSION } from "../src/config.js";
import {
  validateQuantizeRequest,
  WorkerMessageType,
} from "../src/workers/image-worker-protocol.js";
import {
  createInitialState,
  resetStore,
  getState,
  patchTransform,
  setTransform,
  setSourceImage,
  patchQuantization,
  setActiveStep,
  setProjectName,
  toSerializableProject,
  runtimeOnlyKeys,
  beginQuantizeRequest,
  acceptQuantizeResult,
  acceptQuantizeError,
  getRuntimeQuantization,
  isQuantizationStale,
} from "../src/state.js";
import { clearAllListeners } from "../src/events.js";
import {
  GOLDEN_RGBA,
  GOLDEN_SETTINGS,
  GOLDEN_PALETTE,
  GOLDEN_ACTUAL_COLOR_COUNT,
  GOLDEN_INDICES,
  GOLDEN_INDICES_FNV1A,
} from "./fixtures/quantize-golden.js";

/** @param {Uint8Array | number[]} bytes */
function fnv1a32(bytes) {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** @param {number} r @param {number} g @param {number} b @param {number} [a] */
function solidRgba(r, g, b, a = 255, count = 1) {
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  }
  return out;
}

describe("resolution", () => {
  test("exact Tile V1 dimensions at 1, 2, and 4 px/mm", () => {
    assertDeepEqual(computeQuantizationSize(1), {
      widthPx: 148,
      heightPx: 53,
      totalPixels: 148 * 53,
    });
    assertDeepEqual(computeQuantizationSize(2), {
      widthPx: 296,
      heightPx: 106,
      totalPixels: 296 * 106,
    });
    assertDeepEqual(computeQuantizationSize(4), {
      widthPx: 592,
      heightPx: 212,
      totalPixels: 592 * 212,
    });
  });

  test("rejects non-positive or non-finite pixelsPerMm", () => {
    assertThrows(() => computeQuantizationSize(0), "positive");
    assertThrows(() => computeQuantizationSize(-1), "positive");
    assertThrows(() => computeQuantizationSize(Number.NaN), "positive");
  });

  test("rejects resolutions above MAX_QUANTIZATION_PIXELS", () => {
    // 20 px/mm → 2960×1060 = 3_137_600 > 1_500_000
    assertThrows(() => computeQuantizationSize(20), "exceeds");
    const validated = validateQuantizationResolution(20);
    assertEqual(validated.ok, false);
    if (!validated.ok) {
      assertEqual(validated.error.code, QuantizeErrorCode.PIXEL_LIMIT_EXCEEDED);
    }
  });

  test("MAX_QUANTIZATION_PIXELS is documented prototype bound", () => {
    assertEqual(MAX_QUANTIZATION_PIXELS, 1_500_000);
  });
});

describe("transparency compositing", () => {
  test("resolveBackgroundColor white black custom", () => {
    assertDeepEqual(resolveBackgroundColor("white"), { r: 255, g: 255, b: 255 });
    assertDeepEqual(resolveBackgroundColor("black"), { r: 0, g: 0, b: 0 });
    assertDeepEqual(resolveBackgroundColor("custom", { r: 10, g: 20, b: 30 }), {
      r: 10,
      g: 20,
      b: 30,
    });
  });

  test("partial alpha over white", () => {
    // a=128/255 → background weight 127/255; 255*(127/255)=127 exactly.
    const c = compositeSourceOver(255, 0, 0, 128, { r: 255, g: 255, b: 255 });
    assertDeepEqual(c, { r: 255, g: 127, b: 127, a: 255 });
  });

  test("partial alpha over black", () => {
    // 255*(128/255)=128 exactly.
    const c = compositeSourceOver(255, 0, 0, 128, { r: 0, g: 0, b: 0 });
    assertDeepEqual(c, { r: 128, g: 0, b: 0, a: 255 });
  });

  test("buffer compositing forces opaque", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 128, 0, 0, 255, 64]);
    compositeRgbaOverBackground(rgba, { r: 255, g: 255, b: 255 });
    assertEqual(rgba[3], 255);
    assertEqual(rgba[7], 255);
    assertEqual(rgba[0], 255);
    assertEqual(rgba[1], 127);
    assertEqual(rgba[2], 127);
  });

  test("custom background parsing via hex", () => {
    const ok = parseHexColor("#1a2B3c");
    assertEqual(ok.ok, true);
    if (ok.ok) assertDeepEqual(ok.value, { r: 26, g: 43, b: 60 });
    assertEqual(parseHexColor("#fff").ok, false);
    assertEqual(parseHexColor("12345").ok, false);
    assertEqual(formatHexColor({ r: 26, g: 43, b: 60 }), "#1A2B3C");
  });
});

describe("quantizeImage", () => {
  test("solid red image", () => {
    const rgba = solidRgba(220, 20, 20, 255, 16);
    const result = quantizeImage(rgba, { width: 4, height: 4, colorCount: 4 });
    assertEqual(result.actualColorCount, 1);
    assertDeepEqual(result.generatedPalette[0], {
      r: 220,
      g: 20,
      b: 20,
      population: 16,
    });
    assertEqual([...result.indices].every((i) => i === 0), true);
  });

  test("two-color image", () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 0, 255, 255,
      255, 0, 0, 255,
      0, 0, 255, 255,
    ]);
    const result = quantizeImage(rgba, { width: 2, height: 2, colorCount: 2 });
    assertEqual(result.actualColorCount, 2);
    assertEqual(result.generatedPalette[0].population, 2);
    assertEqual(result.generatedPalette[1].population, 2);
  });

  test("three-color image", () => {
    const result = quantizeImage(GOLDEN_RGBA, {
      width: GOLDEN_SETTINGS.width,
      height: GOLDEN_SETTINGS.height,
      colorCount: 3,
    });
    assertEqual(result.actualColorCount, 3);
  });

  test("requested colors greater than unique colors", () => {
    const rgba = new Uint8ClampedArray([
      10, 10, 10, 255,
      200, 200, 200, 255,
    ]);
    const result = quantizeImage(rgba, { width: 2, height: 1, colorCount: 8 });
    assertEqual(result.actualColorCount, 2);
    assertEqual(result.diagnostics.uniqueColorCount, 2);
  });

  test("one-color arithmetic mean", () => {
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255,
      100, 50, 0, 255,
      200, 100, 0, 255,
    ]);
    // mean = (0+100+200)/3, (0+50+100)/3, 0 → round 100, 50, 0
    const result = quantizeImage(rgba, { width: 3, height: 1, colorCount: 1 });
    assertEqual(result.actualColorCount, 1);
    assertDeepEqual(result.generatedPalette[0], {
      r: 100,
      g: 50,
      b: 0,
      population: 3,
    });
    assertEqual([...result.indices].every((v) => v === 0), true);
  });

  test("stable repeated output", () => {
    const a = quantizeImage(GOLDEN_RGBA, { ...GOLDEN_SETTINGS });
    const b = quantizeImage(GOLDEN_RGBA.slice(), { ...GOLDEN_SETTINGS });
    assertDeepEqual(a.generatedPalette, b.generatedPalette);
    assertEqual([...a.indices].join(","), [...b.indices].join(","));
  });

  test("stable centroid initialization and assignment ties", () => {
    // Three greys; request 2. First centroid = most frequent (128), second = farthest.
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255,
      128, 128, 128, 255,
      128, 128, 128, 255,
      255, 255, 255, 255,
    ]);
    const result = quantizeImage(rgba, { width: 2, height: 2, colorCount: 2 });
    assertEqual(result.actualColorCount, 2);
    const again = quantizeImage(rgba, { width: 2, height: 2, colorCount: 2 });
    assertDeepEqual(result.generatedPalette, again.generatedPalette);
    assertEqual([...result.indices].join(","), [...again.indices].join(","));
  });

  test("stable palette ordering by population then luminance then packed RGB", () => {
    const result = quantizeImage(GOLDEN_RGBA, { ...GOLDEN_SETTINGS });
    assertDeepEqual(result.generatedPalette, [...GOLDEN_PALETTE]);
    const lum = result.generatedPalette.map((c) => rgbLuminance(c.r, c.g, c.b));
    assertEqual(lum[0] < lum[1] && lum[1] < lum[2], true);
  });

  test("palette remapping after sorting", () => {
    const result = quantizeImage(GOLDEN_RGBA, { ...GOLDEN_SETTINGS });
    assertEqual([...result.indices].join(","), GOLDEN_INDICES.join(","));
  });

  test("empty-cluster handling leaves no zero-population colors", () => {
    // Many greyscale steps, request 8 — must not fabricate empty slots.
    const rgba = new Uint8ClampedArray(64 * 4);
    for (let i = 0; i < 64; i += 1) {
      const v = (i % 16) * 17;
      rgba[i * 4] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
    const result = quantizeImage(rgba, { width: 8, height: 8, colorCount: 8 });
    assertEqual(result.generatedPalette.every((c) => c.population > 0), true);
    assertEqual(result.actualColorCount <= 8, true);
  });

  test("empty RGBA rejection", () => {
    assertThrows(
      () => quantizeImage(new Uint8ClampedArray(0), { width: 1, height: 1, colorCount: 2 }),
      "empty",
    );
  });

  test("invalid RGBA length", () => {
    assertThrows(
      () => quantizeImage(new Uint8ClampedArray(6), { width: 2, height: 2, colorCount: 2 }),
      "does not match",
    );
  });

  test("invalid color count below 1", () => {
    assertThrows(
      () => quantizeImage(solidRgba(1, 2, 3, 255, 1), { width: 1, height: 1, colorCount: 0 }),
      "1 to 8",
    );
  });

  test("invalid color count above 8", () => {
    assertThrows(
      () => quantizeImage(solidRgba(1, 2, 3, 255, 1), { width: 1, height: 1, colorCount: 9 }),
      "1 to 8",
    );
  });

  test("channel rounding rule", () => {
    assertEqual(roundChannel(1.4), 1);
    assertEqual(roundChannel(1.5), 2);
    assertEqual(roundChannel(-1), 0);
    assertEqual(roundChannel(300), 255);
  });

  test("golden regression fixture", () => {
    const result = quantizeImage(GOLDEN_RGBA, {
      width: GOLDEN_SETTINGS.width,
      height: GOLDEN_SETTINGS.height,
      colorCount: GOLDEN_SETTINGS.colorCount,
      algorithmVersion: QUANTIZE_ALGORITHM_VERSION,
    });
    assertEqual(result.actualColorCount, GOLDEN_ACTUAL_COLOR_COUNT);
    assertDeepEqual(result.generatedPalette, [...GOLDEN_PALETTE]);
    assertEqual([...result.indices].join(","), GOLDEN_INDICES.join(","));
    assertEqual(fnv1a32(result.indices), GOLDEN_INDICES_FNV1A);
  });
});

describe("indexed preview and palette overrides", () => {
  test("indexed preview generation", () => {
    const rgba = indicesToRgba(
      new Uint8Array([0, 1, 0, 1]),
      [
        { r: 10, g: 20, b: 30 },
        { r: 40, g: 50, b: 60 },
      ],
      2,
      2,
    );
    assertEqual(rgba[0], 10);
    assertEqual(rgba[4], 40);
    assertEqual(rgba[3], 255);
  });

  test("palette override changes preview only", () => {
    const indices = new Uint8Array([0, 0, 1, 1]);
    const generated = [
      { r: 255, g: 0, b: 0, population: 2 },
      { r: 0, g: 0, b: 255, population: 2 },
    ];
    const entries = buildPaletteEntries(generated, [null, null]);
    const base = indicesToRgba(indices, effectivePalette(entries), 2, 2);
    const overridden = replacePaletteColor([null, null], 0, { r: 0, g: 255, b: 0 }, 2);
    const entries2 = buildPaletteEntries(generated, overridden);
    const next = indicesToRgba(indices, effectivePalette(entries2), 2, 2);
    assertEqual(base[0], 255);
    assertEqual(next[0], 0);
    assertEqual(next[1], 255);
    // indices unchanged
    assertEqual([...indices].join(","), "0,0,1,1");
  });

  test("restore generated palette color", () => {
    const overrides = replacePaletteColor([null], 0, { r: 1, g: 2, b: 3 }, 1);
    assertDeepEqual(overrides[0], { r: 1, g: 2, b: 3 });
    const restored = replacePaletteColor(overrides, 0, null, 1);
    assertEqual(restored[0], null);
    assertDeepEqual(resetPaletteOverrides(2), [null, null]);
  });
});

describe("source revision", () => {
  test("pan zoom rotate flip image colorCount detailProfile transparency bump revision", () => {
    resetStore();
    clearAllListeners();
    const start = getState().sourceRevision;

    patchTransform({ offsetX: 5 });
    assertEqual(getState().sourceRevision, start + 1);

    setTransform({ ...getState().transform, scale: 1.2 });
    assertEqual(getState().sourceRevision, start + 2);

    setTransform({ ...getState().transform, rotationDeg: 90 });
    assertEqual(getState().sourceRevision, start + 3);

    patchTransform({ flipX: true });
    assertEqual(getState().sourceRevision, start + 4);

    setSourceImage(
      { fileName: "a.png", mimeType: "image/png", widthPx: 4, heightPx: 4 },
      /** @type {ImageBitmap} */ ({ width: 4, height: 4, close() {} }),
      getState().transform,
    );
    assertEqual(getState().sourceRevision, start + 5);

    const afterImage = getState().sourceRevision;
    patchQuantization({ colorCount: 3 });
    assertEqual(getState().sourceRevision, afterImage + 1);

    patchQuantization({ detailProfileId: "low" });
    assertEqual(getState().sourceRevision, afterImage + 2);

    patchQuantization({ transparencyMode: "black" });
    assertEqual(getState().sourceRevision, afterImage + 3);

    patchQuantization({ customBackground: { r: 1, g: 2, b: 3 } });
    assertEqual(getState().sourceRevision, afterImage + 4);
  });

  test("palette override does not change source revision", () => {
    resetStore();
    clearAllListeners();
    const before = getState().sourceRevision;
    patchQuantization({ paletteOverrides: [{ r: 1, g: 2, b: 3 }] });
    assertEqual(getState().sourceRevision, before);
  });

  test("UI-only updates do not bump source revision", () => {
    resetStore();
    clearAllListeners();
    const before = getState().sourceRevision;
    setActiveStep("colors");
    setProjectName("Only UI");
    assertEqual(getState().sourceRevision, before);
  });

  test("stale worker response rejection and current acceptance", () => {
    resetStore();
    clearAllListeners();
    beginQuantizeRequest("req-1");
    const stale = acceptQuantizeResult({
      requestId: "req-old",
      sourceRevision: getState().sourceRevision,
      result: {
        width: 1,
        height: 1,
        requestedColorCount: 1,
        actualColorCount: 1,
        generatedPalette: [{ r: 0, g: 0, b: 0, population: 1 }],
        indices: new Uint8Array([0]),
        sourceRevision: getState().sourceRevision,
        algorithmVersion: 1,
        diagnostics: { uniqueColorCount: 1, iterations: 0, durationMs: 0 },
      },
      previewRgba: new Uint8ClampedArray([0, 0, 0, 255]),
    });
    assertEqual(stale, false);

    const ok = acceptQuantizeResult({
      requestId: "req-1",
      sourceRevision: getState().sourceRevision,
      result: {
        width: 1,
        height: 1,
        requestedColorCount: 1,
        actualColorCount: 1,
        generatedPalette: [{ r: 9, g: 9, b: 9, population: 1 }],
        indices: new Uint8Array([0]),
        sourceRevision: getState().sourceRevision,
        algorithmVersion: 1,
        diagnostics: { uniqueColorCount: 1, iterations: 0, durationMs: 1 },
      },
      previewRgba: new Uint8ClampedArray([9, 9, 9, 255]),
    });
    assertEqual(ok, true);
    assertEqual(getRuntimeQuantization().generatedPalette[0].r, 9);

    // Bump revision → result becomes stale
    patchTransform({ offsetX: 1 });
    assertEqual(isQuantizationStale(), true);
  });

  test("mismatched source revision clears processing without applying result", () => {
    resetStore();
    clearAllListeners();
    beginQuantizeRequest("req-stale-rev");
    assertEqual(getState().ui.isProcessing, true);
    const startedAt = getState().sourceRevision;
    patchTransform({ offsetX: 3 });
    assertEqual(getState().sourceRevision, startedAt + 1);
    const accepted = acceptQuantizeResult({
      requestId: "req-stale-rev",
      sourceRevision: startedAt,
      result: {
        width: 1,
        height: 1,
        requestedColorCount: 1,
        actualColorCount: 1,
        generatedPalette: [{ r: 1, g: 1, b: 1, population: 1 }],
        indices: new Uint8Array([0]),
        sourceRevision: startedAt,
        algorithmVersion: 1,
        diagnostics: { uniqueColorCount: 1, iterations: 0, durationMs: 0 },
      },
      previewRgba: new Uint8ClampedArray([1, 1, 1, 255]),
    });
    assertEqual(accepted, false);
    assertEqual(getState().ui.isProcessing, false);
    assertEqual(getRuntimeQuantization().activeRequestId, null);
    assertEqual(getRuntimeQuantization().generatedPalette.length, 0);
  });

  test("structured worker error acceptance", () => {
    resetStore();
    clearAllListeners();
    beginQuantizeRequest("err-1");
    const accepted = acceptQuantizeError({
      requestId: "err-1",
      sourceRevision: getState().sourceRevision,
      error: { code: QuantizeErrorCode.WORKER_FAILURE, message: "boom", details: { x: 1 } },
    });
    assertEqual(accepted, true);
    assertEqual(getRuntimeQuantization().status, "error");
    assertEqual(getState().ui.error, "boom");
  });
});

describe("worker request validation", () => {
  test("validateQuantizeRequest accepts a well-formed message", () => {
    const rgbaBuffer = new ArrayBuffer(16);
    const result = validateQuantizeRequest({
      type: WorkerMessageType.QUANTIZE,
      requestId: "abc",
      sourceRevision: 3,
      payload: {
        width: 2,
        height: 2,
        colorCount: 4,
        algorithmVersion: 1,
        rgbaBuffer,
      },
    });
    assertEqual(result.ok, true);
  });

  test("validateQuantizeRequest rejects bad color count and length", () => {
    const badCount = validateQuantizeRequest({
      type: WorkerMessageType.QUANTIZE,
      requestId: "abc",
      sourceRevision: 0,
      payload: {
        width: 1,
        height: 1,
        colorCount: 99,
        algorithmVersion: 1,
        rgbaBuffer: new ArrayBuffer(4),
      },
    });
    assertEqual(badCount.ok, false);

    const badLen = validateQuantizeRequest({
      type: WorkerMessageType.QUANTIZE,
      requestId: "abc",
      sourceRevision: 0,
      payload: {
        width: 2,
        height: 2,
        colorCount: 2,
        algorithmVersion: 1,
        rgbaBuffer: new ArrayBuffer(4),
      },
    });
    assertEqual(badLen.ok, false);
    if (!badLen.ok) {
      assertEqual(badLen.error.code, QuantizeErrorCode.INVALID_RGBA_LENGTH);
    }
  });
});

describe("serialization and policy", () => {
  test("serialization excludes RGBA indices ImageData bitmap and worker objects", () => {
    resetStore();
    clearAllListeners();
    beginQuantizeRequest("ser-1");
    acceptQuantizeResult({
      requestId: "ser-1",
      sourceRevision: getState().sourceRevision,
      result: {
        width: 2,
        height: 1,
        requestedColorCount: 1,
        actualColorCount: 1,
        generatedPalette: [{ r: 1, g: 2, b: 3, population: 2 }],
        indices: new Uint8Array([0, 0]),
        sourceRevision: getState().sourceRevision,
        algorithmVersion: 1,
        diagnostics: { uniqueColorCount: 1, iterations: 0, durationMs: 0 },
      },
      previewRgba: new Uint8ClampedArray([1, 2, 3, 255, 1, 2, 3, 255]),
    });
    const json = toSerializableProject();
    const encoded = JSON.stringify(json);
    for (const key of runtimeOnlyKeys()) {
      assertEqual(key in json, false);
    }
    assertEqual(encoded.includes("Uint8Array"), false);
    assertEqual(encoded.includes("ImageData"), false);
    assertEqual(encoded.includes("ImageBitmap"), false);
    assertEqual("indices" in json, false);
    assertEqual("previewRgba" in json, false);
    assertEqual(Array.isArray(json.quantization.paletteOverrides), true);
  });

  test("createInitialState includes sourceRevision and transparency defaults", () => {
    const s = createInitialState();
    assertEqual(s.sourceRevision, 0);
    assertEqual(s.quantization.transparencyMode, "white");
    assertEqual(s.quantization.algorithmVersion, QUANTIZE_ALGORITHM_VERSION);
  });
});

describe("application source policy (quantize era)", () => {
  test("no Math.random in application source", async () => {
    const files = [
      "../src/image/quantize.js",
      "../src/image/palette.js",
      "../src/image/color-space.js",
      "../src/image/transparency.js",
      "../src/image/resolution.js",
      "../src/image/crop-rasterize.js",
      "../src/image/indexed-preview.js",
      "../src/image/mask-cleanup.js",
      "../src/image/connected-components.js",
      "../src/image/printability.js",
      "../src/image/pixel-metrics.js",
      "../src/workers/image-worker.js",
      "../src/workers/image-worker-client.js",
      "../src/workers/image-worker-protocol.js",
      "../src/ui/quantize-controller.js",
      "../src/ui/printability-controller.js",
      "../src/state.js",
      "../src/app.js",
    ];
    /** @type {string[]} */
    const hits = [];
    for (const path of files) {
      const response = await fetch(path);
      assertEqual(response.ok, true, `missing ${path}`);
      const text = await response.text();
      if (/\bMath\.random\s*\(/.test(text)) {
        hits.push(path);
      }
    }
    assertEqual(hits.length, 0, hits.join(", "));
  });
});
