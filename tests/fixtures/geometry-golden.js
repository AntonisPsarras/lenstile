/**
 * Golden geometry fixtures.
 *
 * Changing intentional Tile V1 geometry (segment count, winding, recess
 * construction, etc.) requires reviewing and updating these values.
 */

/** FNV-1a of binary STL for createBoxMesh(0,0,0,10,20,30). */
export const GOLDEN_BOX_STL_FNV1A = "46ce980d";
export const GOLDEN_BOX_TRIANGLE_COUNT = 12;
export const GOLDEN_BOX_STL_BYTES = 684;

/**
 * Combined Tile V1 solid (MAGNET_CIRCLE_SEGMENTS = 64).
 * Update only with deliberate geometry review.
 * Milestone 9: STL ASCII header renamed Open Tile Generator → LensTile
 * (triangle payload unchanged). Previous stlFnv1a: e7568185.
 */
export const GOLDEN_COMBINED_TILE = Object.freeze({
  vertexCount: 1168,
  triangleCount: 2332,
  stlByteLength: 116684,
  stlFnv1a: "a1f5c9ce",
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
  edgeSummary: Object.freeze({
    edgeCount: 3498,
    boundaryEdges: 0,
    manifoldEdges: 3498,
    nonManifoldEdges: 0,
  }),
  /** Approximate analytical volume; polygon circle is slightly larger than πr². */
  volumeMin: 31000,
  volumeMax: 31200,
});

/**
 * Tiny 4×3 mask and expected maximal rectangles (discovery order).
 */
export const GOLDEN_TINY_MASK = Object.freeze({
  width: 4,
  height: 3,
  /** row-major */
  indices: Object.freeze([0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 2, 2]),
  rectangles: Object.freeze([
    Object.freeze({
      paletteIndex: 0,
      x0Pixel: 0,
      y0Pixel: 0,
      widthPixels: 2,
      heightPixels: 2,
    }),
    Object.freeze({
      paletteIndex: 1,
      x0Pixel: 2,
      y0Pixel: 0,
      widthPixels: 2,
      heightPixels: 2,
    }),
    Object.freeze({
      paletteIndex: 2,
      x0Pixel: 0,
      y0Pixel: 2,
      widthPixels: 4,
      heightPixels: 1,
    }),
  ]),
});
