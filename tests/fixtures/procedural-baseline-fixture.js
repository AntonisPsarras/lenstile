/**
 * Project-authored deterministic baseline fixture.
 *
 * Provenance: created procedurally for LensTile and distributed
 * under the repository MIT license. It contains no third-party image content.
 */

export const BASELINE_FIXTURE_WIDTH = 1480;
export const BASELINE_FIXTURE_HEIGHT = 530;
export const BASELINE_FIXTURE_PROVENANCE = "project-authored-mit-procedural-v1";

const COLORS = Object.freeze([
  [25, 35, 48],
  [55, 91, 120],
  [82, 132, 116],
  [154, 91, 69],
  [190, 146, 76],
  [204, 188, 151],
  [118, 82, 137],
  [226, 224, 211],
]);

export function createProceduralBaselineRgba(
  width = BASELINE_FIXTURE_WIDTH,
  height = BASELINE_FIXTURE_HEIGHT,
) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Procedural baseline dimensions must be positive integers.");
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const band = Math.min(7, Math.floor((x * 8) / width));
      const checker = ((Math.floor(x / 23) + Math.floor(y / 17)) & 1);
      const ring = ((x - width / 2) ** 2 + (y - height / 2) ** 2) < (height / 3) ** 2;
      const index = (band + checker + (ring ? 2 : 0)) & 7;
      const color = COLORS[index];
      const o = (y * width + x) * 4;
      rgba[o] = color[0];
      rgba[o + 1] = color[1];
      rgba[o + 2] = color[2];
      rgba[o + 3] = ((x + y) % 97) < 5 ? 128 : 255;
    }
  }
  return rgba;
}

export function createProceduralBaselineCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = BASELINE_FIXTURE_WIDTH;
  canvas.height = BASELINE_FIXTURE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Baseline fixture requires a 2D canvas.");
  ctx.putImageData(
    new ImageData(
      createProceduralBaselineRgba(),
      BASELINE_FIXTURE_WIDTH,
      BASELINE_FIXTURE_HEIGHT,
    ),
    0,
    0,
  );
  return canvas;
}

