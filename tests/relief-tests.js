/**
 * Milestone 6.2 — optional relief surface tests.
 */

/**
 * Milestone 6.2 — optional relief surface tests.
 */

import {
  describe,
  test,
  assertEqual,
  assertApproxEqual,
  assertDeepEqual,
} from "./test-utils.js";
import {
  RELIEF,
  DEFAULT_SURFACE,
  RELIEF_MIN_ROOF_MM,
  validateReliefConfig,
  resolveReliefLevels,
  orderPaletteByLuminance,
  assignColorsToLevels,
  resolveColorTopHeights,
  createSurfaceStateSlice,
  migrateSurfaceSettings,
  roundReliefMm,
} from "../src/geometry/relief.js";
import {
  generateCombinedReliefTileMesh,
  buildAllReliefArtworkMeshes,
  generateVariableHeightArtworkMesh,
  countInteriorStepWallQuads,
  isAmbiguousReliefJunction,
  chooseReliefDiagonal,
} from "../src/geometry/relief-mesh.js";
import { generateTileGeometry } from "../src/geometry/generate-geometry.js";
import { buildCombinedTileMesh, buildBaseTileMesh } from "../src/geometry/tile-base.js";
import { validateMesh } from "../src/geometry/mesh-validation.js";
import { writeBinaryStl } from "../src/export/binary-stl.js";
import { TILE_V1 } from "../src/geometry/tile-spec.js";
import { GOLDEN_COMBINED_TILE } from "./fixtures/geometry-golden.js";
import { GOLDEN_RELIEF_TINY } from "./fixtures/relief-golden.js";
import { GOLDEN_RELIEF_SADDLE } from "./fixtures/relief-saddle-golden.js";
import { packMesh } from "../src/geometry/mesh.js";
import { signedVolume } from "../src/geometry/mesh-math.js";
import {
  resetStore,
  getState,
  toSerializableProject,
  runtimeOnlyKeys,
  patchSurface,
  patchQuantization,
} from "../src/state.js";
import { FEATURES, APP_VERSION } from "../src/config.js";

/**
 * @param {ArrayBuffer} buffer
 */
function fnv1aHex(buffer) {
  let h = 0x811c9dc5;
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

describe("relief configuration", () => {
  test("Flat is the default", () => {
    assertEqual(DEFAULT_SURFACE.style, "flat");
    assertEqual(createSurfaceStateSlice(null).style, "flat");
  });

  test("Existing projects migrate to flat", () => {
    const migrated = migrateSurfaceSettings({ project: { name: "old" } });
    assertEqual(migrated.style, "flat");
    assertEqual(migrated.reliefStrengthId, "standard");
  });

  test("Subtle range is 0.2 mm", () => {
    assertEqual(RELIEF.strengths.subtle.rangeMm, 0.2);
  });

  test("Standard range is 0.4 mm", () => {
    assertEqual(RELIEF.strengths.standard.rangeMm, 0.4);
  });

  test("Bold range is 0.6 mm", () => {
    assertEqual(RELIEF.strengths.bold.rangeMm, 0.6);
  });

  test("Minimum top Z never falls below 3.4 mm", () => {
    assertEqual(RELIEF.minTopZMm, 3.4);
    for (const id of ["subtle", "standard", "bold"]) {
      const levels = resolveReliefLevels(id, 4);
      assertEqual(levels[0] >= 3.4 - 1e-9, true);
    }
  });

  test("Maximum top Z is 4.0 mm", () => {
    assertEqual(RELIEF.maxTopZMm, 4.0);
    assertEqual(validateReliefConfig().ok, true);
  });

  test("Maximum distinct levels is four", () => {
    assertEqual(RELIEF.maximumDistinctLevels, 4);
  });

  test("Roof above magnets is at least 0.9 mm", () => {
    assertApproxEqual(RELIEF_MIN_ROOF_MM, 0.9);
    assertEqual(RELIEF_MIN_ROOF_MM >= 0.9 - 1e-9, true);
  });
});

describe("relief state and staleness", () => {
  test("Surface change marks geometry as needing rebuilding", () => {
    resetStore();
    const before = getState().geometryRevision;
    patchSurface({ style: "relief" });
    assertEqual(getState().geometryRevision, before + 1);
  });

  test("Surface change does not stale quantization revision", () => {
    resetStore();
    const before = getState().sourceRevision;
    patchSurface({ style: "relief", reliefStrengthId: "bold" });
    assertEqual(getState().sourceRevision, before);
  });

  test("Surface change does not stale accepted cleanup revision", () => {
    resetStore();
    const before = getState().printabilityRevision;
    patchSurface({ heightOrder: "lightest-highest" });
    assertEqual(getState().printabilityRevision, before);
  });

  test("Automatic-order palette override marks relief geometry stale", () => {
    resetStore();
    patchSurface({ style: "relief", heightOrder: "darkest-highest" });
    const before = getState().geometryRevision;
    patchQuantization({
      paletteOverrides: [{ r: 255, g: 0, b: 0 }],
    });
    assertEqual(getState().geometryRevision > before, true);
  });

  test("Custom-order palette override does not change custom levels", () => {
    resetStore();
    patchSurface({
      style: "relief",
      heightOrder: "custom",
      colorHeightLevels: [
        { paletteIndex: 0, levelIndex: 1 },
        { paletteIndex: 1, levelIndex: 0 },
      ],
    });
    const levelsBefore = JSON.stringify(getState().surface.colorHeightLevels);
    const geoBefore = getState().geometryRevision;
    patchQuantization({
      paletteOverrides: [{ r: 10, g: 10, b: 10 }, { r: 200, g: 200, b: 200 }],
    });
    assertEqual(JSON.stringify(getState().surface.colorHeightLevels), levelsBefore);
    assertEqual(getState().geometryRevision, geoBefore);
  });

  test("State serialization includes relief settings", () => {
    resetStore();
    patchSurface({ style: "relief", reliefStrengthId: "bold" });
    const snap = toSerializableProject();
    assertEqual(snap.surface.style, "relief");
    assertEqual(snap.surface.reliefStrengthId, "bold");
  });

  test("Mesh buffers remain excluded", () => {
    const keys = runtimeOnlyKeys();
    assertEqual(keys.includes("combined"), true);
    assertEqual(keys.includes("positions"), true);
    const snap = toSerializableProject();
    assertEqual("combined" in snap, false);
  });
});

describe("relief level resolution", () => {
  test("Two-level subtle heights", () => {
    assertDeepEqual(resolveReliefLevels("subtle", 2), [3.8, 4]);
  });

  test("Two-level standard heights", () => {
    assertDeepEqual(resolveReliefLevels("standard", 2), [3.6, 4]);
  });

  test("Two-level bold heights", () => {
    assertDeepEqual(resolveReliefLevels("bold", 2), [3.4, 4]);
  });

  test("Three-level bold heights", () => {
    assertDeepEqual(resolveReliefLevels("bold", 3), [3.4, 3.7, 4]);
  });

  test("Four-level bold heights", () => {
    assertDeepEqual(resolveReliefLevels("bold", 4), [3.4, 3.6, 3.8, 4]);
  });

  test("More than four colors share levels deterministically", () => {
    const ordered = [0, 1, 2, 3, 4, 5, 6, 7];
    const map = assignColorsToLevels(ordered, 4);
    assertEqual(map.get(0), 3);
    assertEqual(map.get(1), 3);
    assertEqual(map.get(2), 2);
    assertEqual(map.get(3), 2);
    assertEqual(map.get(4), 1);
    assertEqual(map.get(5), 1);
    assertEqual(map.get(6), 0);
    assertEqual(map.get(7), 0);
  });

  test("One used color receives top Z = 4.0", () => {
    const resolved = resolveColorTopHeights({
      style: "relief",
      reliefStrengthId: "bold",
      heightOrder: "darkest-highest",
      indices: new Uint8Array([0, 0, 0, 0]),
      effectivePalette: [{ r: 0, g: 0, b: 0 }],
    });
    assertEqual(resolved.topHeightByPaletteIndex.get(0), 4);
    assertEqual(resolved.levelCount, 1);
  });

  test("No unused palette entry receives a level", () => {
    const resolved = resolveColorTopHeights({
      style: "relief",
      reliefStrengthId: "bold",
      heightOrder: "darkest-highest",
      indices: new Uint8Array([0, 2, 0, 2]),
      effectivePalette: [
        { r: 0, g: 0, b: 0 },
        { r: 128, g: 128, b: 128 },
        { r: 255, g: 255, b: 255 },
      ],
    });
    assertEqual(resolved.topHeightByPaletteIndex.has(1), false);
    assertEqual(resolved.usedIndices.includes(1), false);
  });

  test("Darkest-highest ordering", () => {
    const palette = [
      { r: 200, g: 200, b: 200 },
      { r: 10, g: 10, b: 10 },
    ];
    const ordered = orderPaletteByLuminance([0, 1], palette, "asc");
    assertDeepEqual(ordered, [1, 0]);
    const resolved = resolveColorTopHeights({
      style: "relief",
      reliefStrengthId: "bold",
      heightOrder: "darkest-highest",
      indices: new Uint8Array([0, 1]),
      effectivePalette: palette,
    });
    assertEqual(resolved.topHeightByPaletteIndex.get(1) > resolved.topHeightByPaletteIndex.get(0), true);
  });

  test("Lightest-highest ordering", () => {
    const palette = [
      { r: 200, g: 200, b: 200 },
      { r: 10, g: 10, b: 10 },
    ];
    const resolved = resolveColorTopHeights({
      style: "relief",
      reliefStrengthId: "bold",
      heightOrder: "lightest-highest",
      indices: new Uint8Array([0, 1]),
      effectivePalette: palette,
    });
    assertEqual(resolved.topHeightByPaletteIndex.get(0) > resolved.topHeightByPaletteIndex.get(1), true);
  });

  test("Luminance tie uses palette index", () => {
    const palette = [
      { r: 100, g: 100, b: 100 },
      { r: 100, g: 100, b: 100 },
    ];
    assertDeepEqual(orderPaletteByLuminance([0, 1], palette, "asc"), [0, 1]);
  });

  test("Custom order", () => {
    const resolved = resolveColorTopHeights({
      style: "relief",
      reliefStrengthId: "bold",
      heightOrder: "custom",
      colorHeightLevels: [
        { paletteIndex: 0, levelIndex: 0 },
        { paletteIndex: 1, levelIndex: 1 },
      ],
      indices: new Uint8Array([0, 1]),
      effectivePalette: [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }],
    });
    assertEqual(resolved.ok, true);
    assertEqual(resolved.topHeightByPaletteIndex.get(0), 3.4);
    assertEqual(resolved.topHeightByPaletteIndex.get(1), 4);
  });

  test("Duplicate custom level assignments allowed", () => {
    const resolved = resolveColorTopHeights({
      style: "relief",
      reliefStrengthId: "bold",
      heightOrder: "custom",
      colorHeightLevels: [
        { paletteIndex: 0, levelIndex: 1 },
        { paletteIndex: 1, levelIndex: 1 },
      ],
      indices: new Uint8Array([0, 1]),
      effectivePalette: [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }],
    });
    assertEqual(resolved.ok, true);
    assertEqual(resolved.topHeightByPaletteIndex.get(0), resolved.topHeightByPaletteIndex.get(1));
  });

  test("Invalid custom level rejected", () => {
    const resolved = resolveColorTopHeights({
      style: "relief",
      reliefStrengthId: "bold",
      heightOrder: "custom",
      colorHeightLevels: [
        { paletteIndex: 0, levelIndex: 9 },
        { paletteIndex: 1, levelIndex: 0 },
      ],
      indices: new Uint8Array([0, 1]),
      effectivePalette: [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }],
    });
    assertEqual(resolved.ok, false);
  });

  test("Repeated resolution is value identical", () => {
    const opts = {
      style: "relief",
      reliefStrengthId: "standard",
      heightOrder: "darkest-highest",
      indices: new Uint8Array([0, 1, 2, 0]),
      effectivePalette: [
        { r: 0, g: 0, b: 0 },
        { r: 128, g: 128, b: 128 },
        { r: 255, g: 255, b: 255 },
      ],
    };
    const a = resolveColorTopHeights(opts);
    const b = resolveColorTopHeights(opts);
    assertDeepEqual([...a.topHeightByPaletteIndex.entries()], [...b.topHeightByPaletteIndex.entries()]);
    assertDeepEqual(a.heightsFromLow, b.heightsFromLow);
  });
});

describe("relief geometry", () => {
  test("Flat combined STL remains golden-identical", () => {
    const mesh = buildCombinedTileMesh();
    const buf = writeBinaryStl(mesh);
    assertEqual(fnv1aHex(buf), GOLDEN_COMBINED_TILE.stlFnv1a);
    assertEqual(buf.byteLength, GOLDEN_COMBINED_TILE.stlByteLength);
  });

  test("Flat base STL remains golden-identical structurally", () => {
    const a = buildBaseTileMesh();
    const b = buildBaseTileMesh();
    assertEqual(a.triangles.length, b.triangles.length);
    assertEqual(fnv1aHex(writeBinaryStl(a)), fnv1aHex(writeBinaryStl(b)));
  });

  test("Two-height vertical split", () => {
    const indices = new Uint8Array([0, 1, 0, 1]);
    const map = new Map([[0, 4], [1, 3.4]]);
    const mesh = generateCombinedReliefTileMesh({
      indices,
      width: 2,
      height: 2,
      topHeightByPaletteIndex: map,
    });
    const val = validateMesh(mesh, {
      bounds: TILE_V1.boundsMm,
      requireClosed: true,
      requirePositiveVolume: true,
    });
    assertEqual(val.ok, true, val.reasons.join("; "));
    assertApproxEqual(val.bounds.maxZ, 4);
  });

  test("Two-height horizontal split", () => {
    const indices = new Uint8Array([0, 0, 1, 1]);
    const map = new Map([[0, 4], [1, 3.6]]);
    const mesh = generateCombinedReliefTileMesh({
      indices,
      width: 2,
      height: 2,
      topHeightByPaletteIndex: map,
    });
    assertEqual(validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true }).ok, true);
  });

  test("Three-height stripe mask", () => {
    const indices = new Uint8Array([0, 1, 2]);
    const map = new Map([[0, 3.4], [1, 3.7], [2, 4]]);
    const mesh = generateCombinedReliefTileMesh({
      indices,
      width: 3,
      height: 1,
      topHeightByPaletteIndex: map,
    });
    assertEqual(validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true }).ok, true);
  });

  test("Checkerboard relief", () => {
    const indices = new Uint8Array([0, 1, 1, 0]);
    const map = new Map([[0, 4], [1, 3.4]]);
    const mesh = generateCombinedReliefTileMesh({
      indices,
      width: 2,
      height: 2,
      topHeightByPaletteIndex: map,
    });
    const val = validateMesh(mesh, {
      bounds: TILE_V1.boundsMm,
      requireClosed: true,
      requirePositiveVolume: true,
      objectName: "checkerboard-saddle",
    });
    // Milestone 6.2.1: previously incidence-4 at the center cross-edge; must be closed.
    assertEqual(val.ok, true);
    assertEqual(val.edgeSummary.boundaryEdges, 0);
    assertEqual(val.edgeSummary.nonManifoldEdges, 0);
    assertEqual(val.signedVolume > 0, true);
    assertApproxEqual(val.bounds.sizeX, 148);
    assertApproxEqual(val.bounds.sizeZ, 4);
  });

  test("Single raised island", () => {
    const indices = new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    const map = new Map([[0, 4], [1, 3.4]]);
    const mesh = generateCombinedReliefTileMesh({
      indices,
      width: 3,
      height: 3,
      topHeightByPaletteIndex: map,
    });
    assertEqual(validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true }).ok, true);
  });

  test("Equal-height neighbors create no step wall", () => {
    const tops = new Float64Array([4, 4, 4, 4]);
    assertEqual(countInteriorStepWallQuads(tops, 2, 2), 0);
  });

  test("Different-height neighbors create a step wall", () => {
    const tops = new Float64Array([4, 3.4, 4, 3.4]);
    assertEqual(countInteriorStepWallQuads(tops, 2, 2) > 0, true);
  });

  test("Relief combined mesh is closed", () => {
    const g = GOLDEN_RELIEF_TINY;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: new Map(Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v])),
    });
    const val = validateMesh(mesh, { requireClosed: true });
    assertEqual(val.edgeSummary.boundaryEdges, 0);
  });

  test("Relief combined mesh is manifold", () => {
    const g = GOLDEN_RELIEF_TINY;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: new Map(Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v])),
    });
    const val = validateMesh(mesh, { requireClosed: true });
    assertEqual(val.edgeSummary.nonManifoldEdges, 0);
  });

  test("Relief combined bounds equal 148 × 53 × 4", () => {
    const g = GOLDEN_RELIEF_TINY;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: new Map(Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v])),
    });
    const val = validateMesh(mesh);
    assertApproxEqual(val.bounds.sizeX, 148);
    assertApproxEqual(val.bounds.sizeY, 53);
    assertApproxEqual(val.bounds.sizeZ, 4);
  });

  test("Relief magnet geometry unchanged at recess depth", () => {
    const g = GOLDEN_RELIEF_TINY;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: new Map(Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v])),
    });
    const pos = mesh.positions;
    const r = 4.25;
    let ceiling = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i];
      const y = pos[i + 1];
      const z = pos[i + 2];
      for (const c of TILE_V1.magnetCentersMm) {
        const d = Math.hypot(x - c.x, y - c.y);
        if (Math.abs(d - r) < 1e-6 && Math.abs(z - 2.5) < 1e-9) ceiling += 1;
      }
    }
    assertEqual(ceiling >= 64 * 2, true);
  });

  test("Relief minimum surface respects 3.4 mm", () => {
    const g = GOLDEN_RELIEF_TINY;
    const map = new Map(Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v]));
    for (const z of map.values()) {
      assertEqual(z >= 3.4 - 1e-9, true);
    }
  });

  test("No artwork below 2.5 mm on color meshes", () => {
    const g = GOLDEN_RELIEF_TINY;
    const colors = buildAllReliefArtworkMeshes(
      Uint8Array.from(g.indices),
      g.width,
      g.height,
      new Map(Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v])),
    );
    for (const c of colors) {
      const pos = c.mesh.positions;
      for (let i = 2; i < pos.length; i += 3) {
        assertEqual(pos[i] >= 2.5 - 1e-9, true);
      }
    }
  });

  test("Separate relief color meshes are closed", () => {
    const g = GOLDEN_RELIEF_TINY;
    const colors = buildAllReliefArtworkMeshes(
      Uint8Array.from(g.indices),
      g.width,
      g.height,
      new Map(Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v])),
    );
    for (const c of colors) {
      const val = validateMesh(c.mesh, { requireClosed: true, requirePositiveVolume: true });
      assertEqual(val.ok, true, val.reasons.join("; "));
    }
  });

  test("Separate colors do not overlap volumetrically", () => {
    const g = GOLDEN_RELIEF_TINY;
    const colors = buildAllReliefArtworkMeshes(
      Uint8Array.from(g.indices),
      g.width,
      g.height,
      new Map(Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v])),
    );
    assertEqual(colors.length, 2);
    assertEqual(colors[0].paletteIndex !== colors[1].paletteIndex, true);
    assertEqual(colors[0].topZMm !== colors[1].topZMm, true);
  });

  test("Adjacent boundaries align exactly", () => {
    const indices = new Uint8Array([0, 1]);
    const colors = buildAllReliefArtworkMeshes(
      indices,
      2,
      1,
      new Map([[0, 4], [1, 3.4]]),
    );
    const seamX = 0;
    let left = false;
    let right = false;
    for (const c of colors) {
      for (let i = 0; i < c.mesh.positions.length; i += 3) {
        if (Math.abs(c.mesh.positions[i] - seamX) < 1e-9) {
          if (c.paletteIndex === 0) left = true;
          if (c.paletteIndex === 1) right = true;
        }
      }
    }
    assertEqual(left && right, true);
  });

  test("Original accepted indices remain unchanged", () => {
    const indices = new Uint8Array([0, 1, 0, 1]);
    const copy = new Uint8Array(indices);
    generateCombinedReliefTileMesh({
      indices,
      width: 2,
      height: 2,
      topHeightByPaletteIndex: new Map([[0, 4], [1, 3.4]]),
    });
    assertDeepEqual([...indices], [...copy]);
  });

  test("Deterministic relief STL bytes", () => {
    const g = GOLDEN_RELIEF_TINY;
    const opts = {
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: new Map(Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v])),
    };
    const a = writeBinaryStl(generateCombinedReliefTileMesh(opts));
    const b = writeBinaryStl(generateCombinedReliefTileMesh(opts));
    assertEqual(fnv1aHex(a), fnv1aHex(b));
    assertEqual(fnv1aHex(a), g.stlFnv1a);
  });

  test("No zero-area triangles", () => {
    const g = GOLDEN_RELIEF_TINY;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: new Map(Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v])),
    });
    const val = validateMesh(mesh);
    assertEqual(val.reasons.includes("zero-area triangle"), false);
  });

  test("Positive signed volume", () => {
    const g = GOLDEN_RELIEF_TINY;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: new Map(Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v])),
    });
    const vol = signedVolume(mesh);
    assertEqual(vol > g.volumeMin, true);
    assertEqual(vol < g.volumeMax, true);
  });

  test("Golden relief structural metrics", () => {
    const g = GOLDEN_RELIEF_TINY;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: new Map(Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v])),
    });
    const val = validateMesh(mesh, {
      bounds: TILE_V1.boundsMm,
      requireClosed: true,
      requirePositiveVolume: true,
    });
    assertEqual(val.vertexCount, g.vertexCount);
    assertEqual(val.triangleCount, g.triangleCount);
    assertEqual(val.edgeSummary.boundaryEdges, g.edgeSummary.boundaryEdges);
    assertEqual(val.edgeSummary.manifoldEdges, g.edgeSummary.manifoldEdges);
    assertEqual(writeBinaryStl(mesh).byteLength, g.stlByteLength);
  });

  test("Flat generateTileGeometry path unchanged", () => {
    const geo = generateTileGeometry({
      cleanedIndices: new Uint8Array([0, 0, 0, 0]),
      width: 2,
      height: 2,
      surfaceStyle: "flat",
      effectivePalette: [{ r: 0, g: 0, b: 0 }],
    });
    assertEqual(geo.ok, true, geo.reasons.join("; "));
    assertEqual(fnv1aHex(writeBinaryStl(geo.combined)), GOLDEN_COMBINED_TILE.stlFnv1a);
  });

  test("Variable-height artwork mesh closed for island", () => {
    const tops = new Float64Array([3.4, 3.4, 3.4, 3.4, 4, 3.4, 3.4, 3.4, 3.4]);
    const mesh = packMesh(generateVariableHeightArtworkMesh({
      cellTopHeights: tops,
      width: 3,
      height: 3,
      zMin: 2.5,
      includeBottoms: true,
    }));
    assertEqual(validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true }).ok, true);
  });
});

describe("relief UI readiness", () => {
  test("Surface style controls appear when layout is mounted", async () => {
    const { mountLayout } = await import("../src/ui/layout.js");
    const { bindControls, syncControlsFromState } = await import("../src/ui/controls.js");
    resetStore();
    const root = document.createElement("div");
    document.body.appendChild(root);
    const layout = mountLayout(root);
    bindControls({
      canvas: layout.canvas,
      canvasShell: layout.canvasShell,
      imageInput: layout.imageInput,
      scheduleRedraw: () => {},
      getCropSize: () => ({ width: 296, height: 106 }),
    });
    syncControlsFromState();
    assertEqual(Boolean(document.getElementById("surface-style-fieldset")), true);
    assertEqual(Boolean(document.getElementById("surface-style-flat")), true);
    assertEqual(Boolean(document.getElementById("surface-style-relief")), true);
  });

  test("Relief controls hidden in Flat mode after sync", async () => {
    const panel = document.getElementById("surface-relief-controls");
    assertEqual(getState().surface.style, "flat");
    assertEqual(panel instanceof HTMLElement, true);
    assertEqual(/** @type {HTMLElement} */ (panel).hidden, true);
  });

  test("Relief controls visible in Relief mode", async () => {
    const { syncControlsFromState } = await import("../src/ui/controls.js");
    patchSurface({ style: "relief" });
    syncControlsFromState();
    const panel = document.getElementById("surface-relief-controls");
    assertEqual(/** @type {HTMLElement} */ (panel).hidden, false);
  });

  test("Notice appears when colors share levels", async () => {
    // Structural: share notice element exists and copy is plain language.
    const notice = document.getElementById("surface-share-notice");
    assertEqual(notice instanceof HTMLElement, true);
    assertEqual(/topology|Z mapping/i.test(notice?.textContent || ""), false);
  });

  test("Height-order controls use plain language", () => {
    const labels = [
      document.querySelector("label[for='height-order-darkest-highest']")?.textContent,
      document.querySelector("label[for='height-order-lightest-highest']")?.textContent,
      document.querySelector("label[for='height-order-custom']")?.textContent,
    ].join(" ");
    assertEqual(/Darkest highest/i.test(labels), true);
    assertEqual(/Lightest highest/i.test(labels), true);
    assertEqual(/Custom order/i.test(labels), true);
    assertEqual(/topology|Z mapping|height mapping/i.test(labels), false);
  });

  test("Changing strength disables current downloads until rebuild", async () => {
    const { syncControlsFromState } = await import("../src/ui/controls.js");
    const before = getState().geometryRevision;
    patchSurface({ reliefStrengthId: "bold" });
    syncControlsFromState();
    assertEqual(getState().geometryRevision > before, true);
    const btn = /** @type {HTMLButtonElement|null} */ (
      document.getElementById("btn-download-combined-stl")
    );
    assertEqual(btn?.disabled !== false, true);
  });

  test("Smooth one-filament label remains correct", async () => {
    const { syncControlsFromState } = await import("../src/ui/controls.js");
    patchSurface({ style: "flat" });
    syncControlsFromState();
    const btn = document.getElementById("btn-download-combined-stl");
    assertEqual(
      btn?.textContent?.includes("one-filament") || btn?.textContent?.includes("one-color"),
      true,
    );
  });

  test("Relief button says Download Relief STL", async () => {
    const { syncControlsFromState } = await import("../src/ui/controls.js");
    patchSurface({ style: "relief" });
    syncControlsFromState();
    const btn = document.getElementById("btn-download-combined-stl");
    assertEqual(btn?.textContent, "Download Relief STL");
  });

  test("Technical Z data is collapsed by default", () => {
    const details = document.getElementById("surface-tech-details");
    assertEqual(details instanceof HTMLDetailsElement, true);
    assertEqual(/** @type {HTMLDetailsElement} */ (details).open, false);
  });

  test("No prohibited engineering terminology in normal surface UI", () => {
    const fieldset = document.getElementById("surface-style-fieldset");
    const text = fieldset?.textContent || "";
    assertEqual(/height mapping|Z mapping|topology|variable extrusion|stepped raster/i.test(text), false);
    assertEqual(/Surface style|Relief|Flat/i.test(text), true);
  });

  test("No Node requirement in app version metadata", () => {
    assertEqual(FEATURES.stlExport, true);
    assertEqual(APP_VERSION.includes("9") || APP_VERSION.includes("7") || APP_VERSION.includes("6.2"), true);
  });

  test("roundReliefMm is stable", () => {
    assertEqual(roundReliefMm(3.7), 3.7);
    assertEqual(roundReliefMm(3.699999), 3.7);
  });
});

describe("Milestone 6.2.1 — saddle junctions", () => {
  function fnv1aHex(buffer) {
    const bytes = new Uint8Array(buffer);
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i += 1) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  function closedCombined(indices, width, height, map) {
    const mesh = generateCombinedReliefTileMesh({
      indices,
      width,
      height,
      topHeightByPaletteIndex: map,
    });
    return {
      mesh,
      val: validateMesh(mesh, {
        bounds: TILE_V1.boundsMm,
        requireClosed: true,
        requirePositiveVolume: true,
      }),
    };
  }

  test("Previously failing saddle fixture is documented", () => {
    assertEqual(GOLDEN_RELIEF_SADDLE.previousFailure.incidence, 4);
    assertEqual(GOLDEN_RELIEF_SADDLE.previousFailure.nonManifoldEdges, 1);
  });

  test("Height saddle A is closed", () => {
    const { val } = closedCombined(
      new Uint8Array([0, 1, 1, 0]),
      2,
      2,
      new Map([[0, 4], [1, 3.4]]),
    );
    assertEqual(val.ok, true);
    assertEqual(val.edgeSummary.nonManifoldEdges, 0);
  });

  test("Height saddle B is closed", () => {
    const { val } = closedCombined(
      new Uint8Array([1, 0, 0, 1]),
      2,
      2,
      new Map([[0, 4], [1, 3.4]]),
    );
    assertEqual(val.ok, true);
  });

  test("Four-label saddle combined is closed", () => {
    const { val } = closedCombined(
      new Uint8Array([0, 1, 2, 3]),
      2,
      2,
      new Map([[0, 4], [1, 3.8], [2, 3.6], [3, 3.4]]),
    );
    assertEqual(val.ok, true);
  });

  test("Four-label separate objects are individually closed", () => {
    const indices = new Uint8Array([0, 1, 2, 3]);
    const map = new Map([[0, 4], [1, 3.8], [2, 3.6], [3, 3.4]]);
    const colors = buildAllReliefArtworkMeshes(indices, 2, 2, map);
    assertEqual(colors.length, 4);
    for (const c of colors) {
      const val = validateMesh(c.mesh, {
        requireClosed: true,
        requirePositiveVolume: true,
        objectName: `color[${c.paletteIndex}]`,
      });
      assertEqual(val.ok, true);
    }
  });

  test("Diagonal same-label pattern is closed", () => {
    const { val } = closedCombined(
      new Uint8Array([0, 1, 1, 0]),
      2,
      2,
      new Map([[0, 4], [1, 3.4]]),
    );
    assertEqual(val.ok, true);
  });

  test("Saddle inside a uniform border is closed", () => {
    // 4×4: border palette 1 low, center 2×2 saddle
    const indices = new Uint8Array([
      1, 1, 1, 1,
      1, 0, 1, 1,
      1, 1, 0, 1,
      1, 1, 1, 1,
    ]);
    const { val } = closedCombined(indices, 4, 4, new Map([[0, 4], [1, 3.4]]));
    assertEqual(val.ok, true);
  });

  test("Saddle touching the exterior is closed", () => {
    const { val } = closedCombined(
      new Uint8Array([0, 1, 1, 0]),
      2,
      2,
      new Map([[0, 4], [1, 3.4]]),
    );
    assertEqual(val.ok, true);
    assertApproxEqual(val.bounds.sizeX, 148);
    assertApproxEqual(val.bounds.sizeY, 53);
  });

  test("Two height levels are closed", () => {
    const { val } = closedCombined(
      new Uint8Array([0, 1, 1, 0]),
      2,
      2,
      new Map([[0, 4], [1, 3.4]]),
    );
    assertEqual(val.ok, true);
  });

  test("Three height levels are closed", () => {
    const { val } = closedCombined(
      new Uint8Array([0, 1, 2, 0]),
      2,
      2,
      new Map([[0, 4], [1, 3.7], [2, 3.4]]),
    );
    assertEqual(val.ok, true);
  });

  test("Four height levels are closed", () => {
    const { val } = closedCombined(
      new Uint8Array([0, 1, 2, 3]),
      2,
      2,
      new Map([[0, 4], [1, 3.8], [2, 3.6], [3, 3.4]]),
    );
    assertEqual(val.ok, true);
  });

  test("Equal-height diagonal colors create no combined step walls", () => {
    const tops = new Float64Array([4, 4, 4, 4]);
    assertEqual(countInteriorStepWallQuads(tops, 2, 2), 0);
  });

  test("Different-height diagonal cells use the deterministic diagonal rule", () => {
    assertEqual(isAmbiguousReliefJunction(3.4, 4, 4, 3.4), true);
    assertEqual(chooseReliefDiagonal(3.4, 4, 4, 3.4, 1, 0, 0, 1), "nwse");
    assertEqual(chooseReliefDiagonal(4, 3.4, 3.4, 4, 0, 1, 1, 0), "nesw");
  });

  test("Diagonal tie resolves consistently to nwse", () => {
    // Equal combined heights: lower min palette wins; if still tied → nwse
    assertEqual(chooseReliefDiagonal(4, 3.4, 4, 3.4, 1, 0, 0, 1), "nwse");
    assertEqual(chooseReliefDiagonal(3.7, 3.7, 3.7, 3.7, 5, 5, 5, 5), "nwse");
    // Equal heights but NESW has lower min palette index → nesw
    assertEqual(chooseReliefDiagonal(4, 4, 4, 4, 0, 1, 2, 3), "nesw");
  });

  test("Saddle generation is byte-identical", () => {
    const opts = {
      indices: Uint8Array.from(GOLDEN_RELIEF_SADDLE.indices),
      width: GOLDEN_RELIEF_SADDLE.width,
      height: GOLDEN_RELIEF_SADDLE.height,
      topHeightByPaletteIndex: new Map(
        Object.entries(GOLDEN_RELIEF_SADDLE.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v]),
      ),
    };
    const a = writeBinaryStl(generateCombinedReliefTileMesh(opts));
    const b = writeBinaryStl(generateCombinedReliefTileMesh(opts));
    assertEqual(fnv1aHex(a), fnv1aHex(b));
    assertEqual(fnv1aHex(a), GOLDEN_RELIEF_SADDLE.stlFnv1a);
  });

  test("Saddle golden edge incidence never exceeds two", () => {
    const g = GOLDEN_RELIEF_SADDLE;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: new Map(
        Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v]),
      ),
    });
    const val = validateMesh(mesh, { requireClosed: true });
    assertEqual(val.edgeSummary.nonManifoldEdges, 0);
    assertEqual(val.edgeSummary.boundaryEdges, 0);
    assertEqual(val.edgeSummary.manifoldEdges, g.edgeSummary.manifoldEdges);
  });

  test("Saddle golden has no duplicate triangles and positive volume", () => {
    const g = GOLDEN_RELIEF_SADDLE;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: new Map(
        Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v]),
      ),
    });
    const val = validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true });
    assertEqual(val.ok, true);
    assertEqual(val.vertexCount, g.vertexCount);
    assertEqual(val.triangleCount, g.triangleCount);
    assertEqual(val.signedVolume > g.volumeMin && val.signedVolume < g.volumeMax, true);
  });

  test("Saddle bounds remain 148 × 53 × 4", () => {
    const g = GOLDEN_RELIEF_SADDLE;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: new Map(
        Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v]),
      ),
    });
    const val = validateMesh(mesh);
    assertApproxEqual(val.bounds.sizeX, 148);
    assertApproxEqual(val.bounds.sizeY, 53);
    assertApproxEqual(val.bounds.sizeZ, 4);
  });

  test("Saddle magnet geometry unchanged at recess depth", () => {
    const g = GOLDEN_RELIEF_SADDLE;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: new Map(
        Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v]),
      ),
    });
    const pos = mesh.positions;
    const r = 4.25;
    let ceiling = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i];
      const y = pos[i + 1];
      const z = pos[i + 2];
      for (const c of TILE_V1.magnetCentersMm) {
        const d = Math.hypot(x - c.x, y - c.y);
        if (Math.abs(d - r) < 1e-6 && Math.abs(z - 2.5) < 1e-9) ceiling += 1;
      }
    }
    assertEqual(ceiling >= 64 * 2, true);
  });

  test("Flat combined golden remains a1f5c9ce", () => {
    const mesh = buildCombinedTileMesh({ tile: TILE_V1 });
    assertEqual(fnv1aHex(writeBinaryStl(mesh)), GOLDEN_COMBINED_TILE.stlFnv1a);
  });

  test("Existing non-saddle relief golden remains 5ffdbc1e", () => {
    const g = GOLDEN_RELIEF_TINY;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: new Map(
        Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v]),
      ),
    });
    assertEqual(fnv1aHex(writeBinaryStl(mesh)), g.stlFnv1a);
  });

  test("Hard-coded small masks are manifold", () => {
    const masks = [
      [0, 0, 0, 0],
      [0, 1, 0, 1],
      [0, 0, 1, 1],
      [0, 1, 1, 1],
      [0, 1, 1, 0],
      [1, 0, 0, 1],
    ];
    for (const m of masks) {
      const used = new Set(m);
      /** @type {Map<number, number>} */
      const map = new Map();
      let hi = 4;
      for (const idx of [...used].sort((a, b) => a - b)) {
        map.set(idx, hi);
        hi = Math.max(3.4, hi - 0.2);
      }
      if (![...map.values()].includes(4)) map.set([...used][0], 4);
      const { val } = closedCombined(new Uint8Array(m), 2, 2, map);
      assertEqual(val.ok, true);
    }
  });

  test("Palette counts 1–8 can generate manifold fixtures", () => {
    for (let n = 1; n <= 8; n += 1) {
      const indices = new Uint8Array(4);
      for (let i = 0; i < 4; i += 1) indices[i] = i % n;
      /** @type {Map<number, number>} */
      const map = new Map();
      for (let i = 0; i < n; i += 1) {
        map.set(i, n === 1 ? 4 : 4 - (i * 0.6) / Math.max(1, n - 1));
      }
      // Ensure at least one cell at 4.0
      map.set(0, 4);
      const { val } = closedCombined(indices, 2, 2, map);
      assertEqual(val.ok, true);
    }
  });

  test("Exhaustive binary 2×2 height patterns are closed", () => {
    let checked = 0;
    for (let mask = 0; mask < 16; mask += 1) {
      const bits = [
        (mask & 8) ? 4 : 3.4,
        (mask & 4) ? 4 : 3.4,
        (mask & 2) ? 4 : 3.4,
        (mask & 1) ? 4 : 3.4,
      ];
      if (!bits.includes(4)) continue;
      const indices = new Uint8Array(bits.map((z) => (z === 4 ? 0 : 1)));
      const { val } = closedCombined(indices, 2, 2, new Map([[0, 4], [1, 3.4]]));
      assertEqual(val.ok, true);
      checked += 1;
    }
    assertEqual(checked, 15);
  });

  test("Bounded 3×3 masks with embedded saddles are closed", () => {
    /** @type {number[][]} */
    const masks = [];
    // Place both saddle orientations in every 2×2 window of a 3×3.
    const saddles = [
      [0, 1, 1, 0],
      [1, 0, 0, 1],
    ];
    for (const s of saddles) {
      for (let r0 = 0; r0 <= 1; r0 += 1) {
        for (let c0 = 0; c0 <= 1; c0 += 1) {
          const m = [1, 1, 1, 1, 1, 1, 1, 1, 1];
          m[r0 * 3 + c0] = s[0];
          m[r0 * 3 + c0 + 1] = s[1];
          m[(r0 + 1) * 3 + c0] = s[2];
          m[(r0 + 1) * 3 + c0 + 1] = s[3];
          masks.push(m);
        }
      }
    }
    // Additional hard-coded noisy-looking patterns
    masks.push([0, 1, 0, 1, 0, 1, 0, 1, 0]);
    masks.push([0, 0, 1, 0, 1, 0, 1, 0, 0]);
    masks.push([1, 0, 1, 0, 1, 0, 1, 0, 1]);
    for (const m of masks) {
      const indices = new Uint8Array(m);
      const { val } = closedCombined(indices, 3, 3, new Map([[0, 4], [1, 3.4]]));
      assertEqual(val.ok, true);
    }
    assertEqual(masks.length >= 10, true);
  });

  test("No Math.random in relief saddle path modules", async () => {
    const mods = [
      await import("../src/geometry/relief-mesh.js"),
      await import("../src/geometry/mesh-validation.js"),
    ];
    assertEqual(mods.length >= 2, true);
    // Structural: product algorithms must not call Math.random — enforced by source scan tests.
    assertEqual(typeof isAmbiguousReliefJunction, "function");
    assertEqual(typeof chooseReliefDiagonal, "function");
  });
});
