/**
 * Hard-coded golden regression fixture for Milestone 2 quantization.
 * Expected values are authored explicitly — not derived from the implementation
 * under test at runtime.
 */

/** 2×3 opaque image: RR BB GG in row-major order. */
export const GOLDEN_RGBA = new Uint8ClampedArray([
  255, 0, 0, 255,
  255, 0, 0, 255,
  0, 0, 255, 255,
  0, 0, 255, 255,
  0, 255, 0, 255,
  0, 255, 0, 255,
]);

export const GOLDEN_SETTINGS = Object.freeze({
  width: 2,
  height: 3,
  colorCount: 3,
});

/**
 * Equal populations (2). Rec. 709 luminance order:
 * blue (≈18.4) < red (≈54.2) < green (≈182.4).
 */
export const GOLDEN_PALETTE = Object.freeze([
  Object.freeze({ r: 0, g: 0, b: 255, population: 2 }),
  Object.freeze({ r: 255, g: 0, b: 0, population: 2 }),
  Object.freeze({ r: 0, g: 255, b: 0, population: 2 }),
]);

export const GOLDEN_ACTUAL_COLOR_COUNT = 3;

/** Indices for RR BB GG after palette sort → blue=0, red=1, green=2. */
export const GOLDEN_INDICES = Object.freeze([1, 1, 0, 0, 2, 2]);

/** FNV-1a 32-bit of GOLDEN_INDICES bytes — computed offline, not from code under test. */
export const GOLDEN_INDICES_FNV1A = 0x7bc3df6f;
