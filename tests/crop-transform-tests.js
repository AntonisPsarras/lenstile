import {
  describe,
  test,
  assertEqual,
  assertApproxEqual,
  assertDeepEqual,
} from "./test-utils.js";
import {
  clampScale,
  normalizeRotationDeg,
  rotatedImageSize,
  fitScale,
  fillScale,
  applyFit,
  applyFill,
  rotateBy,
  flipHorizontal,
  flipVertical,
  createResetTransform,
  clampTransformToCrop,
  computeCropRect,
  panBy,
} from "../src/image/crop-transform.js";
import { TILE_V1, tileAspectRatio } from "../src/geometry/tile-spec.js";
import { ZOOM_MAX } from "../src/config.js";

describe("tile specification", () => {
  test("physical dimensions", () => {
    assertEqual(TILE_V1.widthMm, 148);
    assertEqual(TILE_V1.heightMm, 53);
    assertEqual(TILE_V1.thicknessMm, 4);
    assertEqual(TILE_V1.magnetDiameterMm, 8.5);
    assertEqual(TILE_V1.magnetDepthMm, 2.5);
    assertEqual(TILE_V1.cornerRadiusMm, 0);
  });

  test("magnet centers", () => {
    assertDeepEqual(TILE_V1.magnetCentersMm, [
      { x: -25, y: 0 },
      { x: 25, y: 0 },
    ]);
  });

  test("bounds are center-origin", () => {
    assertEqual(TILE_V1.boundsMm.minX, -74);
    assertEqual(TILE_V1.boundsMm.maxX, 74);
    assertEqual(TILE_V1.boundsMm.minY, -26.5);
    assertEqual(TILE_V1.boundsMm.maxY, 26.5);
  });

  test("aspect ratio", () => {
    assertApproxEqual(tileAspectRatio(), 148 / 53);
  });
});

describe("crop transform", () => {
  const image = { width: 200, height: 100 };
  const crop = { width: 296, height: 106 }; // 148:53 * 2

  test("clampScale bounds", () => {
    assertEqual(clampScale(0.01), 0.05);
    assertEqual(clampScale(100), ZOOM_MAX);
    assertEqual(clampScale(1.5), 1.5);
  });

  test("normalizeRotationDeg snaps to 90", () => {
    assertEqual(normalizeRotationDeg(90), 90);
    assertEqual(normalizeRotationDeg(180), 180);
    assertEqual(normalizeRotationDeg(-90), 270);
    assertEqual(normalizeRotationDeg(45), 90);
  });

  test("rotatedImageSize swaps on 90/270", () => {
    assertDeepEqual(rotatedImageSize(image, 0), { width: 200, height: 100 });
    assertDeepEqual(rotatedImageSize(image, 90), { width: 100, height: 200 });
  });

  test("fitScale fits inside crop", () => {
    const s = fitScale(image, crop, 0);
    assertApproxEqual(s * image.width, 212, 1e-6); // limited by height: 106/100 * 200? wait
    // min(296/200, 106/100) = min(1.48, 1.06) = 1.06
    assertApproxEqual(s, 1.06);
  });

  test("fillScale covers crop", () => {
    const s = fillScale(image, crop, 0);
    // max(296/200, 106/100) = max(1.48, 1.06) = 1.48
    assertApproxEqual(s, 1.48);
  });

  test("applyFit and applyFill reset offsets", () => {
    const t = { offsetX: 10, offsetY: 20, scale: 3, rotationDeg: 0, flipX: false, flipY: false };
    assertEqual(applyFit(t, image, crop).offsetX, 0);
    assertEqual(applyFill(t, image, crop).offsetY, 0);
  });

  test("rotateBy 90", () => {
    const t = createResetTransform(image, crop);
    assertEqual(rotateBy(t, 90).rotationDeg, 90);
  });

  test("flip toggles", () => {
    const t = createResetTransform(image, crop);
    assertEqual(flipHorizontal(t).flipX, true);
    assertEqual(flipVertical(t).flipY, true);
  });

  test("clampTransformToCrop clamps to exact overlap bounds", () => {
    const t = {
      offsetX: 10000,
      offsetY: 10000,
      scale: 1,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
    };
    const clamped = clampTransformToCrop(t, image, crop, 32);
    // halfW=100, halfH=50, cropHalfW=148, cropHalfH=53, margin=32
    assertEqual(clamped.offsetX, 148 + 100 - 32);
    assertEqual(clamped.offsetY, 53 + 50 - 32);
  });

  test("fitScale and fillScale respect 90° rotation", () => {
    // Rotated 90: image becomes 100×200 inside 296×106 crop
    // fit = min(296/100, 106/200) = min(2.96, 0.53) = 0.53
    assertApproxEqual(fitScale(image, crop, 90), 0.53);
    // fill = max(296/100, 106/200) = max(2.96, 0.53) = 2.96
    assertApproxEqual(fillScale(image, crop, 90), 2.96);
  });

  test("panBy accumulates offsets", () => {
    const t = createResetTransform(image, crop);
    const panned = panBy(t, 12, -4);
    assertEqual(panned.offsetX, 12);
    assertEqual(panned.offsetY, -4);
  });

  test("computeCropRect preserves tile aspect", () => {
    const rect = computeCropRect(800, 600, 24);
    assertApproxEqual(rect.width / rect.height, 148 / 53, 1e-6);
  });
});
