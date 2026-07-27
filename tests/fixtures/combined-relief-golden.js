/**
 * Previous failure metrics for the real combined-relief browser case
 * (Milestone 6.2.3). Captured with junctionCapMode: "ambiguous-only".
 */

export const COMBINED_RELIEF_PREVIOUS_FAILURE = {
  fixtureFile: "combined-relief-geometry-debug.json",
  expectedFailingObject: "combined",
  userMessage: "The model could not be built. The tile surface is invalid.",
  boundaryEdges: 129,
  nonManifoldEdges: 0,
  duplicateTriangles: 0,
  /** Sample offending edge from the first bad edge report. */
  sampleEdge: {
    coordinates: [
      { x: -33, y: 17.5, z: 3.6 },
      { x: -33, y: 17.5, z: 3.75 },
    ],
    incidence: 1,
    triangleIds: [24822],
    localCells: [
      { col: 81, row: 17, paletteIndex: 0, topZ: 3.6 },
      { col: 82, row: 17, paletteIndex: 1, topZ: 4 },
      { col: 81, row: 18, paletteIndex: 0, topZ: 3.6 },
      { col: 82, row: 18, paletteIndex: 3, topZ: 3.75 },
    ],
  },
  topHeights: {
    0: 3.6,
    1: 4,
    2: 3.85,
    3: 3.75,
  },
};

/**
 * Minimal 2×2 three-height T-junction (same local class as the real failure).
 * Heights: NW=SW=3.6, NE=4.0, SE=3.75 — not a classical saddle, uniqueHeights=3.
 */
export const GOLDEN_THREE_HEIGHT_T_JUNCTION = {
  width: 2,
  height: 2,
  indices: [0, 1, 0, 3],
  topHeightByPaletteIndex: new Map([
    [0, 3.6],
    [1, 4],
    [3, 3.75],
  ]),
  previousFailure: {
    boundaryEdgesMin: 1,
    nonManifoldEdges: 0,
  },
};
