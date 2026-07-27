import {
  describe,
  test,
  assertEqual,
  assertDeepEqual,
  assertThrows,
} from "./test-utils.js";
import {
  createInitialState,
  resetStore,
  getState,
  getRuntimeBitmap,
  setProjectName,
  updateState,
  toSerializableProject,
  runtimeOnlyKeys,
  setActiveStep,
  patchTransform,
  setSourceImage,
} from "../src/state.js";
import { clearAllListeners } from "../src/events.js";

describe("state", () => {
  test("createInitialState has expected defaults", () => {
    const s = createInitialState();
    assertEqual(s.project.name, "lenstile");
    assertEqual(s.project.version, 1);
    assertEqual(s.ui.activeStep, "image");
    assertEqual(s.quantization.colorCount, 4);
    assertEqual(s.quantization.detailProfileId, "standard");
    assertEqual(s.printability.profileId, "nozzle04");
    assertEqual(s.printabilityRevision, 0);
    assertEqual(s.tile.widthMm, 148);
    assertEqual(s.transform.scale, 1);
  });

  test("setProjectName updates state", () => {
    resetStore();
    clearAllListeners();
    setProjectName("Demo tile");
    assertEqual(getState().project.name, "Demo tile");
  });

  test("setActiveStep rejects unknown steps", () => {
    resetStore();
    assertThrows(() => setActiveStep("nope"), "Unknown step");
  });

  test("patchTransform merges fields", () => {
    resetStore();
    patchTransform({ scale: 2, flipX: true });
    assertEqual(getState().transform.scale, 2);
    assertEqual(getState().transform.flipX, true);
    assertEqual(getState().transform.flipY, false);
  });

  test("toSerializableProject excludes runtime bitmap key", () => {
    resetStore();
    const json = toSerializableProject();
    assertEqual("bitmap" in json.sourceImage, false);
    for (const key of runtimeOnlyKeys()) {
      assertEqual(key in json, false);
    }
    assertEqual(json.quantization.detailProfileId, "standard");
    assertEqual("resolutionPxPerMm" in json.quantization, false);
    assertEqual(json.printability.profileId, "nozzle04");
    assertEqual("nozzleDiameterMm" in json.printability, false);
    // Ensure structure is JSON-serializable
    const roundTrip = JSON.parse(JSON.stringify(json));
    assertDeepEqual(roundTrip.tile.magnetCentersMm, [
      { x: -25, y: 0 },
      { x: 25, y: 0 },
    ]);
  });

  test("setSourceImage keeps bitmap out of serializable project", () => {
    resetStore();
    clearAllListeners();
    const fakeBitmap = {
      width: 10,
      height: 8,
      close() {},
    };
    setSourceImage(
      {
        fileName: "sample.png",
        mimeType: "image/png",
        widthPx: 10,
        heightPx: 8,
      },
      /** @type {ImageBitmap} */ (fakeBitmap),
      {
        offsetX: 1,
        offsetY: 2,
        scale: 1.5,
        rotationDeg: 90,
        flipX: true,
        flipY: false,
      },
    );
    assertEqual(getRuntimeBitmap(), fakeBitmap);
    const json = toSerializableProject();
    assertEqual(json.sourceImage.fileName, "sample.png");
    assertEqual("bitmap" in json.sourceImage, false);
    assertEqual("imageBitmap" in json, false);
    const encoded = JSON.stringify(json);
    assertEqual(encoded.includes("ImageBitmap"), false);
    assertEqual(getState().transform.rotationDeg, 90);
  });

  test("updateState requires object return", () => {
    resetStore();
    assertThrows(() => updateState(() => null), "must return");
  });
});
