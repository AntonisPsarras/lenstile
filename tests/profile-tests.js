/**
 * Printer nozzle and detail profile tests (Milestone 2.1 / 3).
 */

import {
  describe,
  test,
  assertEqual,
  assertDeepEqual,
  assertThrows,
} from "./test-utils.js";
import {
  PRINT_PROFILES,
  PRINT_PROFILES_VERSION,
  DEFAULT_PRINT_PROFILE_ID,
  resolvePrintProfile,
  normalizePrintProfileId,
  migratePrintProfileId,
  getDerivedPrintSettings,
  DETAIL_PROFILES,
  DETAIL_PROFILES_VERSION,
  DEFAULT_DETAIL_PROFILE_ID,
  resolveDetailProfile,
  normalizeDetailProfileId,
  getDetailPixelsPerMm,
  migrateLegacyPixelsPerMm,
  resolveDetailProfileIdFromSerialized,
} from "../src/config.js";
import {
  resetStore,
  getState,
  setDetailProfile,
  setPrintProfile,
  toSerializableProject,
  getResolutionPxPerMm,
  getPrintSettings,
  beginQuantizeRequest,
  acceptQuantizeResult,
  isQuantizationStale,
} from "../src/state.js";
import { clearAllListeners } from "../src/events.js";
import { computeQuantizationSize } from "../src/image/resolution.js";
import { mountLayout } from "../src/ui/layout.js";
import { bindControls, syncControlsFromState } from "../src/ui/controls.js";

describe("print profiles", () => {
  test("default profile is nozzle04", () => {
    resetStore();
    assertEqual(getState().printability.profileId, DEFAULT_PRINT_PROFILE_ID);
    assertEqual(DEFAULT_PRINT_PROFILE_ID, "nozzle04");
  });

  test("nozzle04 resolves to expected derived settings", () => {
    const settings = getDerivedPrintSettings("nozzle04");
    assertEqual(settings.nozzleDiameterMm, 0.4);
    assertEqual(settings.minimumFeatureWidthMm, 0.45);
    assertEqual(settings.minimumGapWidthMm, 0.45);
    assertEqual(settings.minimumIslandAreaMm2, 0.30);
    assertEqual(settings.maximumHoleAreaToFillMm2, 0.30);
    assertEqual(settings.pixelsPerMm, 8);
    assertEqual(settings.pixelSizeMm, 0.125);
    assertDeepEqual(resolvePrintProfile("nozzle04"), PRINT_PROFILES.nozzle04);
  });

  test("nozzle02 resolves to expected derived settings", () => {
    const settings = getDerivedPrintSettings("nozzle02");
    assertEqual(settings.nozzleDiameterMm, 0.2);
    assertEqual(settings.minimumFeatureWidthMm, 0.25);
    assertEqual(settings.minimumGapWidthMm, 0.25);
    assertEqual(settings.minimumIslandAreaMm2, 0.10);
    assertEqual(settings.maximumHoleAreaToFillMm2, 0.10);
    assertEqual(settings.pixelsPerMm, 10);
    assertEqual(settings.pixelSizeMm, 0.1);
  });

  test("legacy nozzle06 migrates to nozzle04", () => {
    assertEqual(migratePrintProfileId("nozzle06"), "nozzle04");
    assertEqual(normalizePrintProfileId("nozzle06"), "nozzle04");
    assertEqual("nozzle06" in PRINT_PROFILES, false);
    assertEqual(Object.keys(PRINT_PROFILES).sort().join(","), "nozzle02,nozzle04");
  });

  test("invalid profile IDs are safely normalized", () => {
    assertEqual(normalizePrintProfileId("nope"), "nozzle04");
    assertEqual(normalizePrintProfileId(null), "nozzle04");
    assertEqual(resolvePrintProfile("bogus").id, "nozzle04");
    resetStore();
    setPrintProfile("not-a-profile");
    assertEqual(getState().printability.profileId, "nozzle04");
  });

  test("changing profile updates derived display", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const layout = mountLayout(root);
    bindControls({
      canvas: layout.canvas,
      canvasShell: layout.canvasShell,
      imageInput: layout.imageInput,
      scheduleRedraw: () => {},
      getCropSize: () => ({ width: 296, height: 106 }),
    });
    resetStore();
    clearAllListeners();

    setPrintProfile("nozzle02");
    syncControlsFromState();
    assertEqual(document.getElementById("print-derived-nozzle")?.textContent, "0.2 mm");
    assertEqual(document.getElementById("print-derived-feature")?.textContent, "0.25 mm");
    assertEqual(document.getElementById("print-derived-gap")?.textContent, "0.25 mm");
    assertEqual(/** @type {HTMLSelectElement} */ (document.getElementById("print-profile")).value, "nozzle02");

    root.remove();
  });

  test("changing profile increments printabilityRevision", () => {
    resetStore();
    clearAllListeners();
    assertEqual(getState().printabilityRevision, 0);
    setPrintProfile("nozzle02");
    assertEqual(getState().printabilityRevision, 1);
    setPrintProfile("nozzle02");
    assertEqual(getState().printabilityRevision, 1);
    setPrintProfile("nozzle04");
    assertEqual(getState().printabilityRevision, 2);
  });

  test("profile values cannot be mutated at runtime", () => {
    assertEqual(Object.isFrozen(PRINT_PROFILES), true);
    assertEqual(Object.isFrozen(PRINT_PROFILES.nozzle04), true);
    assertThrows(() => {
      /** @type {any} */ (PRINT_PROFILES).nozzle04 = {};
    });
    assertThrows(() => {
      /** @type {any} */ (PRINT_PROFILES.nozzle04).nozzleDiameterMm = 9;
    });
    assertEqual(PRINT_PROFILES.nozzle04.nozzleDiameterMm, 0.4);
    assertEqual(Object.isFrozen(DETAIL_PROFILES), true);
    assertEqual(Object.isFrozen(DETAIL_PROFILES.standard), true);
  });

  test("serializable project stores profile ID not duplicated arbitrary values", () => {
    resetStore();
    setPrintProfile("nozzle02");
    const json = toSerializableProject();
    assertEqual(json.printability.profileId, "nozzle02");
    assertEqual(json.printability.printProfilesVersion, PRINT_PROFILES_VERSION);
    assertEqual("nozzleDiameterMm" in json.printability, false);
    assertEqual("minimumFeatureWidthMm" in json.printability, false);
    assertEqual("minimumGapWidthMm" in json.printability, false);
    assertEqual(getPrintSettings().nozzleDiameterMm, 0.2);
  });

  test("no free-form nozzle input remains in the normal UI", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLayout(root);
    assertEqual(document.getElementById("nozzle"), null);
    assertEqual(Boolean(document.getElementById("print-profile")), true);
    const label = document.querySelector('label[for="print-profile"]');
    assertEqual(label?.textContent?.includes("Nozzle size"), true);
    root.remove();
  });

  test("no free-form minimum-feature input remains in the normal UI", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLayout(root);
    assertEqual(document.getElementById("min-feature"), null);
    assertEqual(Boolean(document.getElementById("print-derived-feature")), true);
    root.remove();
  });

  test("UI explains nozzle prepares detail, not slicer hardware", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLayout(root);
    const help = document.getElementById("print-profile-help")?.textContent || "";
    assertEqual(help.toLowerCase().includes("automatic"), true);
    assertEqual(help.includes("Select the matching nozzle in your slicer"), true);
    root.remove();
  });
});

describe("detail profiles", () => {
  test("default profile is standard", () => {
    resetStore();
    assertEqual(getState().quantization.detailProfileId, DEFAULT_DETAIL_PROFILE_ID);
    assertEqual(DEFAULT_DETAIL_PROFILE_ID, "standard");
    assertEqual(getResolutionPxPerMm(), 8);
  });

  test("low resolves to 148 × 53", () => {
    const size = computeQuantizationSize(getDetailPixelsPerMm("low"));
    assertEqual(size.widthPx, 148);
    assertEqual(size.heightPx, 53);
  });

  test("standard resolves to 296 × 106", () => {
    const size = computeQuantizationSize(getDetailPixelsPerMm("standard"));
    assertEqual(size.widthPx, 296);
    assertEqual(size.heightPx, 106);
  });

  test("high resolves to 592 × 212", () => {
    const size = computeQuantizationSize(getDetailPixelsPerMm("high"));
    assertEqual(size.widthPx, 592);
    assertEqual(size.heightPx, 212);
  });

  test("profile changes increment source revision", () => {
    resetStore();
    clearAllListeners();
    const before = getState().sourceRevision;
    setDetailProfile("high");
    assertEqual(getState().sourceRevision, before + 1);
    assertEqual(getState().quantization.detailProfileId, "high");
    assertEqual(getResolutionPxPerMm(), 8);
  });

  test("nozzle profile drives automatic processing resolution", () => {
    resetStore();
    clearAllListeners();
    assertEqual(getResolutionPxPerMm(), 8);
    setPrintProfile("nozzle02");
    assertEqual(getResolutionPxPerMm(), 10);
    setPrintProfile("nozzle04");
    assertEqual(getResolutionPxPerMm(), 8);
  });

  test("profile changes mark quantization stale", () => {
    resetStore();
    clearAllListeners();
    beginQuantizeRequest("req-detail");
    acceptQuantizeResult({
      requestId: "req-detail",
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
    assertEqual(isQuantizationStale(), false);
    setDetailProfile("low");
    assertEqual(isQuantizationStale(), true);
  });

  test("legacy numeric values migrate deterministically", () => {
    assertEqual(migrateLegacyPixelsPerMm(1), "low");
    assertEqual(migrateLegacyPixelsPerMm(2), "standard");
    assertEqual(migrateLegacyPixelsPerMm(4), "high");
    assertEqual(migrateLegacyPixelsPerMm(1.4), "low");
    assertEqual(migrateLegacyPixelsPerMm(1.6), "standard");
    assertEqual(migrateLegacyPixelsPerMm(3), "standard");
    assertEqual(migrateLegacyPixelsPerMm(3.5), "high");
    assertEqual(migrateLegacyPixelsPerMm(0.5), "low");
    assertEqual(migrateLegacyPixelsPerMm(NaN), "standard");
    assertEqual(
      resolveDetailProfileIdFromSerialized({ resolutionPxPerMm: 4 }),
      "high",
    );
    assertEqual(
      resolveDetailProfileIdFromSerialized({ detailProfileId: "low", resolutionPxPerMm: 4 }),
      "low",
    );
  });

  test("quantization receives nozzle-derived pixelsPerMm", () => {
    resetStore();
    setPrintProfile("nozzle02");
    assertEqual(getResolutionPxPerMm(), 10);
    setDetailProfile("low");
    assertEqual(getResolutionPxPerMm(), 10);
    setPrintProfile("nozzle04");
    assertEqual(getResolutionPxPerMm(), 8);
    assertEqual(resolveDetailProfile("standard").pixelsPerMm, 2);
  });

  test("invalid profile values are handled safely", () => {
    assertEqual(normalizeDetailProfileId("nope"), "standard");
    assertEqual(resolveDetailProfile(undefined).id, "standard");
    resetStore();
    setDetailProfile("invalid");
    assertEqual(getState().quantization.detailProfileId, "standard");
  });

  test("no raw ppm input remains in the normal UI", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountLayout(root);
    assertEqual(document.getElementById("ppm"), null);
    assertEqual(Boolean(document.getElementById("detail-profile")), true);
    assertEqual(DETAIL_PROFILES_VERSION, 1);
    root.remove();
  });
});
