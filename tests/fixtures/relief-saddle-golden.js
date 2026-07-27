/**
 * Hard-coded golden saddle relief fixture (Milestone 6.2.1).
 *
 * Previously failing 2×2 height saddle:
 *   High Low
 *   Low  High
 * with tops 4.0 / 3.4 mm. Before the diagonal fix this produced one undirected
 * center edge with incidence 4. Expected metrics recorded from a reviewed build.
 */

export const GOLDEN_RELIEF_SADDLE = Object.freeze({
  width: 2,
  height: 2,
  /** row-major: H L / L H */
  indices: Object.freeze([0, 1, 1, 0]),
  topHeightByPaletteIndex: Object.freeze({
    0: 4.0,
    1: 3.4,
  }),
  /** Documented previously failing topology (pre-fix). */
  previousFailure: Object.freeze({
    boundaryEdges: 0,
    nonManifoldEdges: 1,
    incidence: 4,
    note: "True 2×2 checkerboard saddle shared one vertical cross-edge among four step faces",
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
  vertexCount: 1245,
  triangleCount: 2486,
  edgeSummary: Object.freeze({
    edgeCount: 3729,
    boundaryEdges: 0,
    manifoldEdges: 3729,
    nonManifoldEdges: 0,
  }),
  stlFnv1a: "f517f424",
  stlByteLength: 124384,
  volumeMin: 28600,
  volumeMax: 28900,
});
