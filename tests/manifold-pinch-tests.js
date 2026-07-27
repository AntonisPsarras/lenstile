/**
 * Milestone 6.2.2 — per-color manifold pinch regression and topology policy.
 */

import { describe, test, assertEqual, assertDeepEqual } from "./test-utils.js";
import {
  GOLDEN_DIAGONAL_PINCH,
  GOLDEN_THREE_PINCH,
} from "./fixtures/manifold-pinch-golden.js";
import {
  buildArtworkColorMesh,
  buildAllArtworkMeshes,
  vertexSectorsAt,
  countCoincidentVertexGroups,
} from "../src/geometry/artwork-mesh.js";
import { generateTileGeometry } from "../src/geometry/generate-geometry.js";
import {
  validateMesh,
  classifyBoundaryEdges,
  findAllBadEdges,
  countDuplicateTriangles,
  plainGeometryFailureMessage,
  formatGeometryTechnicalDetails,
} from "../src/geometry/mesh-validation.js";
import {
  buildGeometryDebugFixture,
  parseGeometryDebugFixture,
  stringifyGeometryDebugFixture,
  encodeBase64Uint8,
  decodeBase64Uint8,
} from "../src/geometry/geometry-debug-fixture.js";
import { writeBinaryStl } from "../src/export/binary-stl.js";
import { GOLDEN_COMBINED_TILE } from "./fixtures/geometry-golden.js";
import { GOLDEN_RELIEF_TINY } from "./fixtures/relief-golden.js";
import { GOLDEN_RELIEF_SADDLE } from "./fixtures/relief-saddle-golden.js";
import { GEOMETRY_ALGORITHM_VERSION } from "../src/geometry/tile-spec.js";
import { generateCombinedReliefTileMesh } from "../src/geometry/relief-mesh.js";

function fnv1aHex(buffer) {
  let h = 0x811c9dc5;
  const b = new Uint8Array(buffer);
  for (let i = 0; i < b.length; i += 1) {
    h ^= b[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function palette() {
  return [
    { r: 20, g: 20, b: 20 },
    { r: 220, g: 220, b: 220 },
    { r: 80, g: 120, b: 200 },
    { r: 200, g: 80, b: 80 },
  ];
}

describe("Milestone 6.2.2 — diagonal pinch regression", () => {
  test("legacy grid weld reproduces single-pinch non-manifold color[0]", () => {
    const indices = Uint8Array.from(GOLDEN_DIAGONAL_PINCH.indices);
    const legacy = buildArtworkColorMesh(indices, 3, 3, 0, { vertexScope: "grid" });
    const summary = classifyBoundaryEdges(legacy);
    assertEqual(summary.boundaryEdges, GOLDEN_DIAGONAL_PINCH.previousFailure.boundaryEdges);
    assertEqual(summary.nonManifoldEdges, GOLDEN_DIAGONAL_PINCH.previousFailure.nonManifoldEdges);
    const bad = findAllBadEdges(legacy);
    assertEqual(bad.length >= 1, true);
    assertEqual(bad[0].incidence, GOLDEN_DIAGONAL_PINCH.previousFailure.incidence);
  });

  test("legacy grid weld reproduces three-pinch nonManifold=3", () => {
    const indices = Uint8Array.from(GOLDEN_THREE_PINCH.indices);
    const legacy = buildArtworkColorMesh(
      indices,
      GOLDEN_THREE_PINCH.width,
      GOLDEN_THREE_PINCH.height,
      0,
      { vertexScope: "grid" },
    );
    const summary = classifyBoundaryEdges(legacy);
    assertEqual(summary.boundaryEdges, GOLDEN_THREE_PINCH.previousFailure.boundaryEdges);
    assertEqual(summary.nonManifoldEdges, GOLDEN_THREE_PINCH.previousFailure.nonManifoldEdges);
  });

  test("corrected diagonal pinch color[0] is closed two-manifold", () => {
    const indices = Uint8Array.from(GOLDEN_DIAGONAL_PINCH.indices);
    const mesh = buildArtworkColorMesh(indices, 3, 3, 0);
    const val = validateMesh(mesh, {
      requireClosed: true,
      requirePositiveVolume: true,
      objectName: "color[0]",
    });
    assertEqual(val.ok, true);
    assertEqual(val.edgeSummary.boundaryEdges, 0);
    assertEqual(val.edgeSummary.nonManifoldEdges, 0);
    assertEqual(countDuplicateTriangles(mesh), 0);
    assertEqual(val.signedVolume > 0, true);
  });

  test("corrected three-pinch color[0] is closed", () => {
    const indices = Uint8Array.from(GOLDEN_THREE_PINCH.indices);
    const mesh = buildArtworkColorMesh(
      indices,
      GOLDEN_THREE_PINCH.width,
      GOLDEN_THREE_PINCH.height,
      0,
    );
    const val = validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true });
    assertEqual(val.ok, true);
    assertEqual(val.edgeSummary.nonManifoldEdges, 0);
    assertEqual(val.edgeSummary.boundaryEdges, 0);
  });

  test("generateTileGeometry flat fixture validates all objects", () => {
    const indices = Uint8Array.from(GOLDEN_DIAGONAL_PINCH.indices);
    const geo = generateTileGeometry({
      cleanedIndices: indices,
      width: 3,
      height: 3,
      surfaceStyle: "flat",
      effectivePalette: palette(),
    });
    assertEqual(geo.ok, true);
    assertEqual(geo.validation.combined.ok, true);
    for (const v of geo.validation.colors) assertEqual(v.ok, true);
  });

  test("generateTileGeometry relief fixture validates where relevant", () => {
    const indices = Uint8Array.from(GOLDEN_DIAGONAL_PINCH.indices);
    const geo = generateTileGeometry({
      cleanedIndices: indices,
      width: 3,
      height: 3,
      surfaceStyle: "relief",
      reliefStrengthId: "bold",
      heightOrder: "darkest-highest",
      effectivePalette: palette(),
    });
    assertEqual(geo.ok, true);
    for (const v of geo.validation.colors) assertEqual(v.ok, true);
  });

  test("automatic and custom height ordering remain valid on pinch fixture", () => {
    const indices = Uint8Array.from(GOLDEN_DIAGONAL_PINCH.indices);
    const auto = generateTileGeometry({
      cleanedIndices: indices,
      width: 3,
      height: 3,
      surfaceStyle: "relief",
      reliefStrengthId: "standard",
      heightOrder: "lightest-highest",
      effectivePalette: palette(),
    });
    assertEqual(auto.ok, true);
    const custom = generateTileGeometry({
      cleanedIndices: indices,
      width: 3,
      height: 3,
      surfaceStyle: "relief",
      reliefStrengthId: "standard",
      heightOrder: "custom",
      colorHeightLevels: [
        { paletteIndex: 0, levelIndex: 0 },
        { paletteIndex: 1, levelIndex: 1 },
      ],
      effectivePalette: palette(),
    });
    assertEqual(custom.ok, true);
  });

  test("repeated generation is byte-identical", () => {
    const indices = Uint8Array.from(GOLDEN_DIAGONAL_PINCH.indices);
    const a = buildArtworkColorMesh(indices, 3, 3, 0);
    const b = buildArtworkColorMesh(indices, 3, 3, 0);
    assertDeepEqual(Array.from(a.positions), Array.from(b.positions));
    assertDeepEqual(Array.from(a.triangles), Array.from(b.triangles));
  });
});

describe("Milestone 6.2.2 — topology policy cases", () => {
  test("disconnected same-color components do not share vertex identities", () => {
    // Checkerboard: two color-0 cells touch only at the center XY point.
    const indices = new Uint8Array([0, 1, 1, 0]);
    const mesh = buildArtworkColorMesh(indices, 2, 2, 0);
    assertEqual(countCoincidentVertexGroups(mesh) > 0, true);
    assertEqual(validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true }).ok, true);
  });

  test("corner-touching same-color components remain separate closed solids", () => {
    const indices = new Uint8Array([0, 1, 1, 0]);
    const mesh = buildArtworkColorMesh(indices, 2, 2, 0);
    const val = validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true });
    assertEqual(val.ok, true);
    assertEqual(countCoincidentVertexGroups(mesh) > 0, true);
  });

  test("edge-touching same-color regions merge correctly", () => {
    const indices = new Uint8Array([0, 0, 1, 1]);
    const mesh = buildArtworkColorMesh(indices, 2, 2, 0);
    const val = validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true });
    assertEqual(val.ok, true);
    // Shared edge vertices should weld (no duplicate XYZ for the shared edge alone is hard to assert;
    // instead assert manifold + single component population).
    assertEqual(val.edgeSummary.nonManifoldEdges, 0);
  });

  test("T-shaped boundary", () => {
    const indices = new Uint8Array([0, 0, 0, 1, 0, 1, 1, 0, 1]);
    const mesh = buildArtworkColorMesh(indices, 3, 3, 0);
    assertEqual(validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true }).ok, true);
  });

  test("one-cell corridor", () => {
    const indices = new Uint8Array([0, 1, 0, 0, 1, 0, 0, 0, 0]);
    const meshes = buildAllArtworkMeshes(indices, 3, 3);
    for (const m of meshes) {
      assertEqual(validateMesh(m.mesh, { requireClosed: true, requirePositiveVolume: true }).ok, true);
    }
  });

  test("one-cell enclosed region", () => {
    const indices = new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    const mesh = buildArtworkColorMesh(indices, 3, 3, 0);
    assertEqual(validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true }).ok, true);
  });

  test("multiple components meeting at one coordinate", () => {
    // Four corner components of color 0 meet pairwise at grid vertices around center.
    const indices = new Uint8Array([0, 1, 0, 1, 1, 1, 0, 1, 0]);
    const mesh = buildArtworkColorMesh(indices, 3, 3, 0);
    assertEqual(validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true }).ok, true);
    // With separate component namespaces, corner meetings keep distinct ids when
    // coordinates coincide — checkerboard subset also covered above.
    const pinch = buildArtworkColorMesh(new Uint8Array([0, 1, 1, 0]), 2, 2, 0);
    assertEqual(countCoincidentVertexGroups(pinch) >= 2, true);
  });

  test("three-color junction", () => {
    const indices = new Uint8Array([0, 1, 2, 0]);
    const geo = generateTileGeometry({
      cleanedIndices: indices,
      width: 2,
      height: 2,
      surfaceStyle: "flat",
      effectivePalette: palette(),
    });
    assertEqual(geo.ok, true);
  });

  test("four-color junction", () => {
    const indices = new Uint8Array([0, 1, 2, 3]);
    const geo = generateTileGeometry({
      cleanedIndices: indices,
      width: 2,
      height: 2,
      surfaceStyle: "flat",
      effectivePalette: palette(),
    });
    assertEqual(geo.ok, true);
  });

  test("mixed saddle and T-junction relief", () => {
    const indices = new Uint8Array([0, 1, 1, 0, 0, 1, 1, 0, 0]);
    const geo = generateTileGeometry({
      cleanedIndices: indices,
      width: 3,
      height: 3,
      surfaceStyle: "relief",
      reliefStrengthId: "bold",
      heightOrder: "darkest-highest",
      effectivePalette: palette(),
    });
    assertEqual(geo.ok, true);
  });

  test("vertexSectorsAt separates diagonal occupants", () => {
    const cellSet = new Set(["1,0", "0,1"]);
    const sectors = vertexSectorsAt(1, 1, cellSet);
    assertEqual(sectors.get("1,0") !== sectors.get("0,1"), true);
  });

  test("vertexSectorsAt merges edge-adjacent occupants", () => {
    const cellSet = new Set(["0,0", "1,0"]);
    const sectors = vertexSectorsAt(1, 0, cellSet);
    assertEqual(sectors.get("0,0"), sectors.get("1,0"));
  });
});

describe("Milestone 6.2.2 — exhaustive 3×3 binary per-color manifold", () => {
  test("all 512 binary 3×3 masks produce closed per-color meshes", () => {
    let checked = 0;
    for (let bits = 0; bits < 512; bits += 1) {
      const indices = new Uint8Array(9);
      for (let i = 0; i < 9; i += 1) indices[i] = (bits >> i) & 1;
      for (const pi of [0, 1]) {
        const mesh = buildArtworkColorMesh(indices, 3, 3, pi);
        if (!mesh) continue;
        checked += 1;
        const summary = classifyBoundaryEdges(mesh);
        assertEqual(summary.boundaryEdges, 0, `bits=${bits} color=${pi} boundary`);
        assertEqual(summary.nonManifoldEdges, 0, `bits=${bits} color=${pi} nonManifold`);
        assertEqual(countDuplicateTriangles(mesh), 0, `bits=${bits} color=${pi} dup`);
      }
    }
    assertEqual(checked > 500, true);
  });
});

describe("Milestone 6.2.2 — goldens and download gating", () => {
  test("flat combined golden remains a1f5c9ce", async () => {
    const { buildCombinedTileMesh } = await import("../src/geometry/tile-base.js");
    const { TILE_V1 } = await import("../src/geometry/tile-spec.js");
    const mesh = buildCombinedTileMesh({ tile: TILE_V1 });
    assertEqual(fnv1aHex(writeBinaryStl(mesh)), GOLDEN_COMBINED_TILE.stlFnv1a);
    assertEqual(GOLDEN_COMBINED_TILE.stlFnv1a, "a1f5c9ce");
  });

  test("relief golden 5ffdbc1e unchanged when unaffected", () => {
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
    assertEqual(g.stlFnv1a, "5ffdbc1e");
  });

  test("saddle golden f517f424 unchanged when unaffected", () => {
    const g = GOLDEN_RELIEF_SADDLE;
    const mesh = generateCombinedReliefTileMesh({
      indices: Uint8Array.from(g.indices),
      width: g.width,
      height: g.height,
      topHeightByPaletteIndex: new Map(
        Object.entries(g.topHeightByPaletteIndex).map(([k, v]) => [Number(k), v]),
      ),
    });
    assertEqual(fnv1aHex(writeBinaryStl(mesh)), g.stlFnv1a);
    assertEqual(g.stlFnv1a, "f517f424");
  });

  test("invalid object blocks download readiness semantics", () => {
    const indices = Uint8Array.from(GOLDEN_DIAGONAL_PINCH.indices);
    const legacy = buildArtworkColorMesh(indices, 3, 3, 0, { vertexScope: "grid" });
    const val = validateMesh(legacy, { requireClosed: true, requirePositiveVolume: true });
    assertEqual(val.ok, false);
  });

  test("valid regenerated fixture enables ok geometry", () => {
    const indices = Uint8Array.from(GOLDEN_DIAGONAL_PINCH.indices);
    const geo = generateTileGeometry({
      cleanedIndices: indices,
      width: 3,
      height: 3,
      surfaceStyle: "flat",
      effectivePalette: palette(),
    });
    assertEqual(geo.ok, true);
    assertEqual(geo.userMessage, null);
  });
});

describe("Milestone 6.2.2 — debug fixture and diagnostics", () => {
  test("debug fixture round-trip encodes indices", () => {
    const indices = Uint8Array.from(GOLDEN_DIAGONAL_PINCH.indices);
    const fixture = buildGeometryDebugFixture({
      cleanedIndices: indices,
      width: 3,
      height: 3,
      surfaceStyle: "flat",
      generatedPalette: GOLDEN_DIAGONAL_PINCH.generatedPalette,
      effectivePalette: GOLDEN_DIAGONAL_PINCH.effectivePalette,
      expectedFailingObject: "color[0]",
    });
    assertEqual(fixture.format, "open-tile-geometry-debug");
    assertEqual(fixture.geometryAlgorithmVersion >= 2, true);
    const text = stringifyGeometryDebugFixture(fixture);
    const parsed = parseGeometryDebugFixture(JSON.parse(text));
    assertDeepEqual(Array.from(parsed.cleanedIndices), Array.from(indices));
    assertEqual(parsed.expectedFailingObject, "color[0]");
  });

  test("base64 uint8 codec", () => {
    const bytes = Uint8Array.from([0, 1, 2, 255, 128, 64]);
    const encoded = encodeBase64Uint8(bytes);
    assertDeepEqual(Array.from(decodeBase64Uint8(encoded)), Array.from(bytes));
  });

  test("plain-language primary error for color manifold failure", () => {
    const msg = plainGeometryFailureMessage([
      "color[0]: object=color[0]: mesh is not a closed manifold (boundary=0, nonManifold=3)",
    ]);
    assertEqual(msg, "The model could not be built. One color contains an invalid surface.");
  });

  test("technical detail disclosure contains diagnostics", () => {
    const indices = Uint8Array.from(GOLDEN_DIAGONAL_PINCH.indices);
    const legacy = buildArtworkColorMesh(indices, 3, 3, 0, { vertexScope: "grid" });
    const val = validateMesh(legacy, {
      requireClosed: true,
      requirePositiveVolume: true,
      objectName: "color[0]",
    });
    const text = formatGeometryTechnicalDetails({
      reasons: val.reasons,
      validation: { colors: [val] },
    });
    assertEqual(/Object: color\[0\]/.test(text), true);
    assertEqual(/Boundary-edge count:/.test(text), true);
    assertEqual(/Non-manifold-edge count:/.test(text), true);
    assertEqual(/Duplicate-triangle count:/.test(text), true);
    assertEqual(/Offending edges:/.test(text), true);
  });

  test("algorithm version bumped for structural bridge", () => {
    assertEqual(GEOMETRY_ALGORITHM_VERSION, 7);
  });
});
