/**
 * Real-world class regression: diagonal self-touch inside one 4-connected
 * component (Milestone 6.2.2).
 *
 * Reduced from exhaustive 3×3 binary search (bits=17). Before the sector-scoped
 * vertex fix, color[0] failed closed-manifold validation with a single
 * incidence-4 vertical edge at the diagonal pinch (boundary=0, nonManifold=1).
 * Designs with three such pinches produce nonManifold=3 — the failure mode seen
 * in the browser UI.
 *
 * Mask (row-major), palette 1 is the diagonal blocker:
 *   1 0 0
 *   0 1 0
 *   0 0 0
 */

export const GOLDEN_DIAGONAL_PINCH = Object.freeze({
  id: "diagonal-pinch-3x3-bits17",
  width: 3,
  height: 3,
  indices: Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 0]),
  expectedFailingObject: "color[0]",
  /** Pre-fix topology (do not recompute from current mesher). */
  previousFailure: Object.freeze({
    boundaryEdges: 0,
    nonManifoldEdges: 1,
    incidence: 4,
  }),
  surfaceStyle: "flat",
  reliefStrengthId: "standard",
  heightOrder: "darkest-highest",
  colorHeightLevels: Object.freeze([]),
  generatedPalette: Object.freeze([
    Object.freeze({ r: 20, g: 20, b: 20 }),
    Object.freeze({ r: 220, g: 220, b: 220 }),
  ]),
  effectivePalette: Object.freeze([
    Object.freeze({ r: 20, g: 20, b: 20 }),
    Object.freeze({ r: 220, g: 220, b: 220 }),
  ]),
  tileVersion: "1",
});

/**
 * Three diagonal pinches in one color → three non-manifold vertical edges
 * under the pre-fix vertex welder (boundary=0, nonManifold=3).
 *
 * Three copies of the bits=17 motif side-by-side (9×3):
 *   1 0 0 1 0 0 1 0 0
 *   0 1 0 0 1 0 0 1 0
 *   0 0 0 0 0 0 0 0 0
 */
export const GOLDEN_THREE_PINCH = Object.freeze({
  id: "three-diagonal-pinch-9x3",
  width: 9,
  height: 3,
  indices: Object.freeze([
    1, 0, 0, 1, 0, 0, 1, 0, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]),
  expectedFailingObject: "color[0]",
  previousFailure: Object.freeze({
    boundaryEdges: 0,
    nonManifoldEdges: 3,
  }),
  surfaceStyle: "flat",
  generatedPalette: Object.freeze([
    Object.freeze({ r: 10, g: 10, b: 10 }),
    Object.freeze({ r: 200, g: 200, b: 200 }),
  ]),
  effectivePalette: Object.freeze([
    Object.freeze({ r: 10, g: 10, b: 10 }),
    Object.freeze({ r: 200, g: 200, b: 200 }),
  ]),
});
