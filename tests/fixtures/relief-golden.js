/**
 * Hard-coded golden relief fixture (Milestone 6.2).
 *
 * Tiny 2×2 vertical two-color mask with explicit tops (Bold range).
 * Expected mesh metrics were recorded from a reviewed build — do not
 * recompute from the implementation under test when updating.
 */

export const GOLDEN_RELIEF_TINY = Object.freeze({
  width: 2,
  height: 2,
  /** row-major: left column palette 0 (high), right column palette 1 (low) */
  indices: Object.freeze([0, 1, 0, 1]),
  topHeightByPaletteIndex: Object.freeze({
    0: 4.0,
    1: 3.4,
  }),
  effectivePalette: Object.freeze([
    Object.freeze({ r: 20, g: 20, b: 20 }),
    Object.freeze({ r: 220, g: 220, b: 220 }),
  ]),
  colorHeights: Object.freeze({
    0: 4.0,
    1: 3.4,
  }),
  bounds: Object.freeze({
    minX: -74,
    maxX: 74,
    minY: -26.5,
    maxY: 26.5,
    minZ: 0,
    maxZ: 4,
    sizeX: 148,
    sizeY: 53,
    sizeZ: 4,
  }),
  vertexCount: 1208,
  triangleCount: 2412,
  edgeSummary: Object.freeze({
    edgeCount: 3618,
    boundaryEdges: 0,
    manifoldEdges: 3618,
    nonManifoldEdges: 0,
  }),
  stlFnv1a: "5ffdbc1e",
  stlByteLength: 120684,
  volumeMin: 28600,
  volumeMax: 28900,
});
