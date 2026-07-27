/**
 * Milestone 6.2.3 — combined relief multi-height T-junction manifold fix.
 */

import { describe, test, assertEqual, assertApproxEqual } from "./test-utils.js";
import {
  COMBINED_RELIEF_PREVIOUS_FAILURE,
  GOLDEN_THREE_HEIGHT_T_JUNCTION,
} from "./fixtures/combined-relief-golden.js";
import {
  parseGeometryDebugFixture,
} from "../src/geometry/geometry-debug-fixture.js";
import {
  generateCombinedReliefTileMesh,
  needsReliefJunctionCap,
  isAmbiguousReliefJunction,
  mergeEqualHeightRoles,
  countDistinctReliefHeights,
  chooseReliefDiagonal,
} from "../src/geometry/relief-mesh.js";
import { generateTileGeometry } from "../src/geometry/generate-geometry.js";
import { buildCombinedTileMesh } from "../src/geometry/tile-base.js";
import {
  validateMesh,
  classifyBoundaryEdges,
  findAllBadEdges,
  countDuplicateTriangles,
  plainGeometryFailureMessage,
  formatGeometryTechnicalDetails,
} from "../src/geometry/mesh-validation.js";
import { writeBinaryStl } from "../src/export/binary-stl.js";
import { GOLDEN_COMBINED_TILE } from "./fixtures/geometry-golden.js";
import { GOLDEN_RELIEF_TINY } from "./fixtures/relief-golden.js";
import { GOLDEN_RELIEF_SADDLE } from "./fixtures/relief-saddle-golden.js";
import { TILE_V1, GEOMETRY_ALGORITHM_VERSION } from "../src/geometry/tile-spec.js";
import {
  resetStore,
  getState,
  getRuntimeGeometry,
  beginGeometryRequest,
  acceptGeometryResult,
  acceptGeometryError,
  isGeometryDownloadReady,
  patchSurface,
} from "../src/state.js";

function fnv1aHex(buffer) {
  let h = 0x811c9dc5;
  const b = new Uint8Array(buffer);
  for (let i = 0; i < b.length; i += 1) {
    h ^= b[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function countInconsistentWindingEdges(mesh) {
  const tris = mesh.triangles;
  /** @type {Map<string, number>} */
  const oriented = new Map();
  for (let i = 0; i < tris.length; i += 3) {
    const ids = [tris[i], tris[i + 1], tris[i + 2]];
    for (let e = 0; e < 3; e += 1) {
      const a = ids[e];
      const b = ids[(e + 1) % 3];
      const key = `${a}>${b}`;
      oriented.set(key, (oriented.get(key) || 0) + 1);
    }
  }
  let bad = 0;
  /** @type {Set<string>} */
  const seen = new Set();
  for (const [key, count] of oriented) {
    const [a, b] = key.split(">").map(Number);
    const undirected = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(undirected)) continue;
    seen.add(undirected);
    const rev = oriented.get(`${b}>${a}`) || 0;
    if (count + rev !== 2 || count > 1 || rev > 1) bad += 1;
  }
  return bad;
}

/** @type {ReturnType<typeof parseGeometryDebugFixture> | null} */
let cachedFixture = null;

async function loadRealFixture() {
  if (cachedFixture) return cachedFixture;
  const res = await fetch("./fixtures/combined-relief-geometry-debug.json");
  const raw = await res.json();
  cachedFixture = parseGeometryDebugFixture(raw);
  return cachedFixture;
}

function topMapFromObject(obj) {
  return new Map(Object.entries(obj).map(([k, v]) => [Number(k), v]));
}

function closedCombined(indices, width, height, topMap, junctionCapMode = "full") {
  const mesh = generateCombinedReliefTileMesh({
    indices,
    width,
    height,
    topHeightByPaletteIndex: topMap,
    junctionCapMode,
  });
  const val = validateMesh(mesh, {
    bounds: TILE_V1.boundsMm,
    requireClosed: true,
    requirePositiveVolume: true,
    objectName: "combined",
  });
  return { mesh, val };
}

function tinyMesh() {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    triangles: new Uint32Array([0, 1, 2]),
  };
}

describe("Milestone 6.2.3 — combined relief T-junction regression", () => {
  test("needsReliefJunctionCap covers three-height T-junctions saddles miss", () => {
    assertEqual(isAmbiguousReliefJunction(3.6, 3.75, 3.6, 4), false);
    assertEqual(needsReliefJunctionCap(3.6, 3.75, 3.6, 4), true);
    assertEqual(countDistinctReliefHeights(3.6, 3.75, 3.6, 4), 3);
  });

  test("mergeEqualHeightRoles welds equal adjacent corners", () => {
    const groups = mergeEqualHeightRoles(3.6, 3.75, 3.6, 4);
    assertEqual(groups.length, 3);
    const west = groups.find((g) => g.roles.includes("nw") && g.roles.includes("sw"));
    assertEqual(Boolean(west), true);
    assertEqual(west && west.z, 3.6);
  });

  test("legacy ambiguous-only mode reproduces three-height T-junction boundaries", () => {
    const g = GOLDEN_THREE_HEIGHT_T_JUNCTION;
    const { mesh, val } = closedCombined(
      Uint8Array.from(g.indices),
      g.width,
      g.height,
      g.topHeightByPaletteIndex,
      "ambiguous-only",
    );
    const summary = classifyBoundaryEdges(mesh);
    assertEqual(val.ok, false);
    assertEqual(summary.boundaryEdges >= g.previousFailure.boundaryEdgesMin, true);
    assertEqual(summary.nonManifoldEdges, g.previousFailure.nonManifoldEdges);
  });

  test("corrected three-height T-junction is closed two-manifold", () => {
    const g = GOLDEN_THREE_HEIGHT_T_JUNCTION;
    const { mesh, val } = closedCombined(
      Uint8Array.from(g.indices),
      g.width,
      g.height,
      g.topHeightByPaletteIndex,
    );
    assertEqual(val.ok, true);
    assertEqual(val.edgeSummary.boundaryEdges, 0);
    assertEqual(val.edgeSummary.nonManifoldEdges, 0);
    assertEqual(countDuplicateTriangles(mesh), 0);
    assertEqual(countInconsistentWindingEdges(mesh), 0);
    assertEqual(val.signedVolume > 0, true);
  });

  test("real debug fixture expectedFailingObject is combined", async () => {
    const fixture = await loadRealFixture();
    assertEqual(fixture.format, "open-tile-geometry-debug");
    assertEqual(fixture.expectedFailingObject, "combined");
    assertEqual(fixture.surfaceStyle, "relief");
    assertEqual(fixture.width, 296);
    assertEqual(fixture.height, 106);
    assertEqual(fixture.usedPaletteIndices.length, 4);
  });

  test("legacy mode on real fixture reproduces combined boundary failure", async () => {
    const fixture = await loadRealFixture();
    const geo = generateTileGeometry({
      cleanedIndices: fixture.cleanedIndices,
      width: fixture.width,
      height: fixture.height,
      surfaceStyle: "relief",
      reliefStrengthId: fixture.reliefStrengthId,
      heightOrder: fixture.heightOrder,
      colorHeightLevels: fixture.colorHeightLevels,
      effectivePalette: fixture.effectivePalette,
    });
    const legacy = generateCombinedReliefTileMesh({
      indices: fixture.cleanedIndices,
      width: fixture.width,
      height: fixture.height,
      topHeightByPaletteIndex: geo.relief.topHeightByPaletteIndex,
      junctionCapMode: "ambiguous-only",
    });
    const summary = classifyBoundaryEdges(legacy);
    assertEqual(summary.boundaryEdges, COMBINED_RELIEF_PREVIOUS_FAILURE.boundaryEdges);
    assertEqual(summary.nonManifoldEdges, COMBINED_RELIEF_PREVIOUS_FAILURE.nonManifoldEdges);
    assertEqual(countDuplicateTriangles(legacy), COMBINED_RELIEF_PREVIOUS_FAILURE.duplicateTriangles);
    const bad = findAllBadEdges(legacy, 1);
    assertEqual(bad.length >= 1, true);
    assertEqual(bad[0].incidence, 1);
    const msg = plainGeometryFailureMessage([
      `combined: mesh is not a closed manifold (boundary=${summary.boundaryEdges}, nonManifold=${summary.nonManifoldEdges})`,
    ]);
    assertEqual(msg, COMBINED_RELIEF_PREVIOUS_FAILURE.userMessage);
  });

  test("corrected real fixture combined relief is closed two-manifold", async () => {
    const fixture = await loadRealFixture();
    const geo = generateTileGeometry({
      cleanedIndices: fixture.cleanedIndices,
      width: fixture.width,
      height: fixture.height,
      surfaceStyle: fixture.surfaceStyle,
      reliefStrengthId: fixture.reliefStrengthId,
      heightOrder: fixture.heightOrder,
      colorHeightLevels: fixture.colorHeightLevels,
      effectivePalette: fixture.effectivePalette,
    });
    assertEqual(geo.ok, true);
    assertEqual(geo.validation.combined.ok, true);
    assertEqual(geo.validation.combined.edgeSummary.boundaryEdges, 0);
    assertEqual(geo.validation.combined.edgeSummary.nonManifoldEdges, 0);
    assertEqual(countDuplicateTriangles(geo.combined), 0);
    assertEqual(countInconsistentWindingEdges(geo.combined), 0);
    assertEqual(geo.validation.combined.signedVolume > 0, true);
    assertApproxEqual(geo.validation.combined.bounds.sizeX, 148, 1e-6);
    assertApproxEqual(geo.validation.combined.bounds.sizeY, 53, 1e-6);
    assertApproxEqual(geo.validation.combined.bounds.sizeZ, 4, 1e-6);
    assertEqual(geo.validation.base.ok, true);
    for (const c of geo.validation.colors) {
      assertEqual(c.ok, true);
      assertEqual(c.edgeSummary.boundaryEdges, 0);
      assertEqual(c.edgeSummary.nonManifoldEdges, 0);
    }
  });

  test("failure object class is combined — colors and base remain valid", async () => {
    const fixture = await loadRealFixture();
    const geo = generateTileGeometry({
      cleanedIndices: fixture.cleanedIndices,
      width: fixture.width,
      height: fixture.height,
      surfaceStyle: "relief",
      reliefStrengthId: fixture.reliefStrengthId,
      heightOrder: fixture.heightOrder,
      effectivePalette: fixture.effectivePalette,
    });
    assertEqual(geo.validation.base.ok, true);
    for (const c of geo.validation.colors) assertEqual(c.ok, true);
  });

  test("technical diagnostics include exact edge information", () => {
    const g = GOLDEN_THREE_HEIGHT_T_JUNCTION;
    const { mesh } = closedCombined(
      Uint8Array.from(g.indices),
      g.width,
      g.height,
      g.topHeightByPaletteIndex,
      "ambiguous-only",
    );
    const val = validateMesh(mesh, {
      requireClosed: true,
      objectName: "combined",
    });
    const text = formatGeometryTechnicalDetails({
      reasons: val.reasons,
      validation: { combined: val },
    });
    assertEqual(/Boundary-edge count/i.test(text), true);
    assertEqual(/incidence/i.test(text) || /edge verts/i.test(text), true);
  });

  test("chooseReliefDiagonal remains deterministic", () => {
    // Equal diagonal sums → palette-index tie-break → nwse default.
    assertEqual(chooseReliefDiagonal(4, 3.4, 3.4, 4, 0, 1, 1, 0), "nesw");
    assertEqual(chooseReliefDiagonal(3.4, 4, 4, 3.4, 1, 0, 0, 1), "nwse");
  });
});

describe("Milestone 6.2.3 — multi-height junction coverage", () => {
  test("Relief with two heights remains closed", () => {
    const indices = new Uint8Array([0, 0, 1, 1, 0, 1, 1, 0, 0]);
    const { val } = closedCombined(indices, 3, 3, new Map([[0, 4], [1, 3.4]]));
    assertEqual(val.ok, true);
  });

  test("Relief with three heights remains closed", () => {
    const indices = new Uint8Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const { val } = closedCombined(
      indices,
      3,
      3,
      new Map([[0, 4], [1, 3.7], [2, 3.4]]),
    );
    assertEqual(val.ok, true);
  });

  test("Relief with four heights remains closed", () => {
    const indices = new Uint8Array([0, 1, 2, 3, 0, 1, 2, 3, 0]);
    const { val } = closedCombined(
      indices,
      3,
      3,
      new Map([[0, 4], [1, 3.8], [2, 3.6], [3, 3.4]]),
    );
    assertEqual(val.ok, true);
  });

  test("Adjacent saddles are closed", () => {
    const indices = new Uint8Array([0, 1, 0, 1, 0, 1]);
    const { val } = closedCombined(indices, 3, 2, new Map([[0, 4], [1, 3.4]]));
    assertEqual(val.ok, true);
  });

  test("Saddle beside T-junction is closed", () => {
    const indices = new Uint8Array([0, 1, 2, 1, 0, 2]);
    const { val } = closedCombined(
      indices,
      3,
      2,
      new Map([[0, 4], [1, 3.4], [2, 3.7]]),
    );
    assertEqual(val.ok, true);
  });

  test("Narrow one-cell branch beside a height junction is closed", () => {
    const indices = new Uint8Array([0, 0, 0, 0, 1, 2, 0, 0, 0]);
    const { val } = closedCombined(
      indices,
      3,
      3,
      new Map([[0, 4], [1, 3.6], [2, 3.4]]),
    );
    assertEqual(val.ok, true);
  });

  test("Three distinct heights meeting at one vertex is closed", () => {
    const indices = new Uint8Array([0, 1, 0, 2]);
    const { val } = closedCombined(
      indices,
      2,
      2,
      new Map([[0, 4], [1, 3.7], [2, 3.4]]),
    );
    assertEqual(val.ok, true);
  });

  test("Four distinct heights meeting at one vertex is closed", () => {
    const indices = new Uint8Array([0, 1, 2, 3]);
    const { val } = closedCombined(
      indices,
      2,
      2,
      new Map([[0, 4], [1, 3.8], [2, 3.6], [3, 3.4]]),
    );
    assertEqual(val.ok, true);
  });

  test("Repeated generation is byte-identical", () => {
    const indices = new Uint8Array([0, 1, 2, 3, 0, 1, 2, 3, 0]);
    const tops = new Map([[0, 4], [1, 3.8], [2, 3.6], [3, 3.4]]);
    const a = writeBinaryStl(generateCombinedReliefTileMesh({
      indices,
      width: 3,
      height: 3,
      topHeightByPaletteIndex: tops,
    }));
    const b = writeBinaryStl(generateCombinedReliefTileMesh({
      indices,
      width: 3,
      height: 3,
      topHeightByPaletteIndex: tops,
    }));
    assertEqual(fnv1aHex(a), fnv1aHex(b));
  });

  test("Exhaustive binary 3×3 height masks are closed", () => {
    let checked = 0;
    for (let mask = 0; mask < 512; mask += 1) {
      const cells = [];
      for (let i = 0; i < 9; i += 1) {
        cells.push((mask >> i) & 1);
      }
      if (!cells.includes(0)) continue;
      const indices = new Uint8Array(cells);
      const { val } = closedCombined(indices, 3, 3, new Map([[0, 4], [1, 3.4]]));
      assertEqual(val.ok, true);
      checked += 1;
    }
    assertEqual(checked, 511);
  });

  test("Bounded ternary 3×3 junction classes are closed", () => {
    /** @type {number[][]} */
    const masks = [
      [0, 1, 1, 0, 2, 1, 2, 2, 2],
      [0, 1, 1, 2, 3, 1, 2, 2, 3],
      [0, 0, 1, 0, 2, 1, 2, 2, 1],
      [0, 1, 2, 1, 0, 2, 2, 2, 2],
      [0, 1, 0, 2, 1, 2, 0, 2, 0],
      [0, 1, 2, 0, 1, 2, 0, 1, 2],
      [1, 1, 1, 1, 0, 2, 1, 1, 1],
      [0, 1, 0, 1, 2, 1, 0, 1, 0],
    ];
    for (const m of masks) {
      const indices = new Uint8Array(m);
      const { val } = closedCombined(
        indices,
        3,
        3,
        new Map([[0, 4], [1, 3.7], [2, 3.4], [3, 3.55]]),
      );
      assertEqual(val.ok, true);
    }
  });
});

describe("Milestone 6.2.3 — goldens and download-state safety", () => {
  test("Flat combined STL golden hash unchanged", () => {
    const mesh = buildCombinedTileMesh({ tile: TILE_V1 });
    assertEqual(fnv1aHex(writeBinaryStl(mesh)), GOLDEN_COMBINED_TILE.stlFnv1a);
  });

  test("Relief two-level golden hash unchanged", () => {
    const g = GOLDEN_RELIEF_TINY;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: topMapFromObject(g.topHeightByPaletteIndex),
    });
    assertEqual(fnv1aHex(writeBinaryStl(mesh)), g.stlFnv1a);
  });

  test("Relief saddle golden hash unchanged", () => {
    const g = GOLDEN_RELIEF_SADDLE;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: topMapFromObject(g.topHeightByPaletteIndex),
    });
    assertEqual(fnv1aHex(writeBinaryStl(mesh)), g.stlFnv1a);
  });

  test("GEOMETRY_ALGORITHM_VERSION is 7", () => {
    assertEqual(GEOMETRY_ALGORITHM_VERSION, 7);
  });

  test("Starting build clears previous downloadable geometry", () => {
    resetStore();
    beginGeometryRequest("req-prev");
    acceptGeometryResult({
      requestId: "req-prev",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      geometryRevision: getState().geometryRevision,
      result: {
        ok: true,
        reasons: [],
        userMessage: null,
        algorithmVersion: GEOMETRY_ALGORITHM_VERSION,
        validation: { ok: true },
        combined: tinyMesh(),
        base: tinyMesh(),
        colors: [],
      },
    });
    assertEqual(getRuntimeGeometry().status, "ready");
    assertEqual(Boolean(getRuntimeGeometry().combined), true);
    beginGeometryRequest("req-next");
    const rg = getRuntimeGeometry();
    assertEqual(rg.status, "processing");
    assertEqual(rg.combined, null);
    assertEqual(rg.base, null);
    assertEqual(isGeometryDownloadReady(), false);
  });

  test("Failed validation clears meshes and disables downloads", () => {
    resetStore();
    beginGeometryRequest("req-fail");
    acceptGeometryResult({
      requestId: "req-fail",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      geometryRevision: getState().geometryRevision,
      result: {
        ok: false,
        reasons: ["combined: mesh is not a closed manifold (boundary=1, nonManifold=0)"],
        userMessage: "The model could not be built. The tile surface is invalid.",
        algorithmVersion: GEOMETRY_ALGORITHM_VERSION,
        validation: { ok: false, combined: { ok: false } },
        combined: tinyMesh(),
        base: tinyMesh(),
        colors: [{ paletteIndex: 0, population: 1, mesh: tinyMesh() }],
      },
    });
    const rg = getRuntimeGeometry();
    assertEqual(rg.status, "error");
    assertEqual(rg.combined, null);
    assertEqual(rg.base, null);
    assertEqual(rg.colors.length, 0);
    assertEqual(isGeometryDownloadReady(), false);
    assertEqual(
      plainGeometryFailureMessage(rg.reasons),
      "The model could not be built. The tile surface is invalid.",
    );
  });

  test("Successful rebuild re-enables download readiness flag", () => {
    resetStore();
    beginGeometryRequest("req-ok");
    const accepted = acceptGeometryResult({
      requestId: "req-ok",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      geometryRevision: getState().geometryRevision,
      result: {
        ok: true,
        reasons: [],
        userMessage: null,
        algorithmVersion: GEOMETRY_ALGORITHM_VERSION,
        validation: { ok: true },
        combined: tinyMesh(),
        base: tinyMesh(),
        colors: [],
      },
    });
    assertEqual(accepted, true);
    // Download still needs printability export-ready; status/meshes are ready.
    const rg = getRuntimeGeometry();
    assertEqual(rg.status, "ready");
    assertEqual(Boolean(rg.combined && rg.base), true);
  });

  test("Changing relief settings invalidates geometry before rebuild", () => {
    resetStore();
    beginGeometryRequest("req-surf");
    acceptGeometryResult({
      requestId: "req-surf",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      geometryRevision: getState().geometryRevision,
      result: {
        ok: true,
        reasons: [],
        userMessage: null,
        algorithmVersion: GEOMETRY_ALGORITHM_VERSION,
        validation: { ok: true },
        combined: tinyMesh(),
        base: tinyMesh(),
        colors: [],
      },
    });
    const before = getState().geometryRevision;
    patchSurface({ style: "relief", reliefStrengthId: "bold" });
    assertEqual(getState().geometryRevision > before, true);
    assertEqual(getRuntimeGeometry().combined, null);
    assertEqual(isGeometryDownloadReady(), false);
  });

  test("acceptGeometryError leaves downloads disabled", () => {
    resetStore();
    beginGeometryRequest("req-err");
    acceptGeometryError({
      requestId: "req-err",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      geometryRevision: getState().geometryRevision,
      error: { code: "INTERNAL", message: "boom" },
    });
    assertEqual(getRuntimeGeometry().status, "error");
    assertEqual(isGeometryDownloadReady(), false);
  });
});
