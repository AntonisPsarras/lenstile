/**
 * Mesh primitives, math, validation, Tile V1 solids, raster geometry tests.
 */

import {
  describe,
  test,
  assertEqual,
  assertApproxEqual,
  assertDeepEqual,
  assertThrows,
} from "./test-utils.js";
import {
  createMesh,
  addVertex,
  addTriangle,
  mergeMeshes,
  packMesh,
  vertexCount,
  triangleCount,
} from "../src/geometry/mesh.js";
import {
  computeTriangleNormal,
  triangleArea,
  computeBounds,
  signedVolume,
  ZERO_AREA_EPSILON,
} from "../src/geometry/mesh-math.js";
import { computeNormals } from "../src/geometry/normals.js";
import { createBoxMesh } from "../src/geometry/primitives.js";
import {
  validateMesh,
  classifyBoundaryEdges,
  countUndirectedEdges,
} from "../src/geometry/mesh-validation.js";
import {
  TILE_V1,
  MAGNET_CIRCLE_SEGMENTS,
  GEOMETRY_ALGORITHM_VERSION,
  validateTileVerticalStructure,
} from "../src/geometry/tile-spec.js";
import { buildCombinedTileMesh, buildBaseTileMesh } from "../src/geometry/tile-base.js";
import { circlePoints, circleChordError, magnetRadiusMm } from "../src/geometry/magnet-circle.js";
import {
  createRasterMapping,
  pixelLeftX,
  pixelTopY,
  pixelBottomY,
} from "../src/geometry/raster-coords.js";
import {
  maskToRectangles,
  usedPaletteIndices,
  assertRectangleCoverage,
} from "../src/geometry/mask-to-rectangles.js";
import {
  buildArtworkColorMesh,
  buildAllArtworkMeshes,
} from "../src/geometry/artwork-mesh.js";
import {
  GOLDEN_COMBINED_TILE,
  GOLDEN_TINY_MASK,
} from "./fixtures/geometry-golden.js";

describe("mesh primitives and mathematics", () => {
  test("triangle normal for XY triangle", () => {
    const n = computeTriangleNormal(0, 0, 0, 1, 0, 0, 0, 1, 0);
    assertApproxEqual(n.x, 0);
    assertApproxEqual(n.y, 0);
    assertApproxEqual(n.z, 1);
  });

  test("reversed winding reverses normal", () => {
    const n = computeTriangleNormal(0, 0, 0, 0, 1, 0, 1, 0, 0);
    assertApproxEqual(n.z, -1);
  });

  test("triangle area", () => {
    assertApproxEqual(triangleArea(0, 0, 0, 2, 0, 0, 0, 2, 0), 2);
  });

  test("degenerate triangle rejection in validateMesh", () => {
    const mesh = createMesh();
    const a = addVertex(mesh, 0, 0, 0);
    const b = addVertex(mesh, 1, 0, 0);
    const c = addVertex(mesh, 2, 0, 0);
    addTriangle(mesh, a, b, c);
    const result = validateMesh(packMesh(mesh));
    assertEqual(result.ok, false);
    assertEqual(result.reasons.some((r) => r.includes("zero-area")), true);
  });

  test("bounds calculation", () => {
    const box = createBoxMesh(-1, -2, -3, 4, 5, 6);
    const b = computeBounds(box);
    assertApproxEqual(b.minX, -1);
    assertApproxEqual(b.maxZ, 6);
    assertApproxEqual(b.sizeX, 5);
  });

  test("signed volume of known box", () => {
    const box = createBoxMesh(0, 0, 0, 10, 20, 30);
    assertApproxEqual(signedVolume(box), 6000);
  });

  test("merge meshes adjusts indices correctly", () => {
    const a = createBoxMesh(0, 0, 0, 1, 1, 1);
    const b = createBoxMesh(2, 0, 0, 3, 1, 1);
    const merged = packMesh(mergeMeshes([a, b]));
    assertEqual(vertexCount(merged), 16);
    assertEqual(triangleCount(merged), 24);
    assertEqual(validateMesh(merged).ok, true);
  });

  test("non-finite coordinate rejection", () => {
    assertThrows(() => addVertex(createMesh(), NaN, 0, 0), "finite");
  });

  test("out-of-range index rejection", () => {
    const mesh = createMesh();
    addVertex(mesh, 0, 0, 0);
    assertThrows(() => addTriangle(mesh, 0, 1, 2), "out of range");
  });

  test("repeated triangle-index rejection", () => {
    const mesh = createMesh();
    const a = addVertex(mesh, 0, 0, 0);
    const b = addVertex(mesh, 1, 0, 0);
    assertThrows(() => addTriangle(mesh, a, b, a), "repeated");
  });

  test("computeNormals length matches triangle count", () => {
    const box = createBoxMesh(0, 0, 0, 1, 1, 1);
    const normals = computeNormals(box);
    assertEqual(normals.length, triangleCount(box) * 3);
  });
});

describe("tile geometry", () => {
  test("tile vertical structure still valid", () => {
    assertEqual(validateTileVerticalStructure().ok, true);
    assertEqual(GEOMETRY_ALGORITHM_VERSION >= 1, true);
    assertEqual(MAGNET_CIRCLE_SEGMENTS >= 24, true);
  });

  test("combined STL bounds equal 148 × 53 × 4", () => {
    const mesh = buildCombinedTileMesh();
    const b = computeBounds(mesh);
    assertApproxEqual(b.sizeX, 148);
    assertApproxEqual(b.sizeY, 53);
    assertApproxEqual(b.sizeZ, 4);
    assertApproxEqual(b.minX, -74);
    assertApproxEqual(b.maxX, 74);
  });

  test("base bounds equal 148 × 53 × 2.5", () => {
    const mesh = buildBaseTileMesh();
    const b = computeBounds(mesh);
    assertApproxEqual(b.sizeX, 148);
    assertApproxEqual(b.sizeY, 53);
    assertApproxEqual(b.sizeZ, 2.5);
    assertApproxEqual(b.maxZ, 2.5);
  });

  test("magnet centers are ±25 mm", () => {
    assertEqual(TILE_V1.magnetCentersMm[0].x, -25);
    assertEqual(TILE_V1.magnetCentersMm[1].x, 25);
    assertEqual(TILE_V1.magnetCentersMm[0].y, 0);
  });

  test("magnet radius is 4.25 mm", () => {
    assertApproxEqual(magnetRadiusMm(), 4.25);
    assertApproxEqual(TILE_V1.magnetDiameterMm / 2, 4.25);
  });

  test("recess depth is 2.5 mm", () => {
    assertEqual(TILE_V1.magnetDepthMm, 2.5);
    assertEqual(TILE_V1.baseThicknessMm, 2.5);
  });

  test("combined tile has nonzero positive volume", () => {
    const mesh = buildCombinedTileMesh();
    const vol = signedVolume(mesh);
    assertEqual(vol > GOLDEN_COMBINED_TILE.volumeMin, true);
    assertEqual(vol < GOLDEN_COMBINED_TILE.volumeMax, true);
  });

  test("combined tile is closed", () => {
    const mesh = buildCombinedTileMesh();
    const result = validateMesh(mesh, {
      bounds: TILE_V1.boundsMm,
      requireClosed: true,
      requirePositiveVolume: true,
    });
    assertEqual(result.ok, true, result.reasons.join("; "));
  });

  test("base is closed", () => {
    const mesh = buildBaseTileMesh();
    const result = validateMesh(mesh, {
      bounds: {
        minX: -74,
        maxX: 74,
        minY: -26.5,
        maxY: 26.5,
        minZ: 0,
        maxZ: 2.5,
      },
      requireClosed: true,
      requirePositiveVolume: true,
    });
    assertEqual(result.ok, true, result.reasons.join("; "));
  });

  test("magnet openings exist on bottom and ceilings at Z=2.5", () => {
    const mesh = buildCombinedTileMesh();
    const pos = mesh.positions;
    let bottomCircle = 0;
    let ceiling = 0;
    const r = 4.25;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i];
      const y = pos[i + 1];
      const z = pos[i + 2];
      for (const c of TILE_V1.magnetCentersMm) {
        const d = Math.hypot(x - c.x, y - c.y);
        if (Math.abs(d - r) < 1e-6) {
          if (Math.abs(z) < 1e-9) bottomCircle += 1;
          if (Math.abs(z - 2.5) < 1e-9) ceiling += 1;
        }
      }
    }
    assertEqual(bottomCircle >= MAGNET_CIRCLE_SEGMENTS * 2, true);
    assertEqual(ceiling >= MAGNET_CIRCLE_SEGMENTS * 2, true);
  });

  test("no magnet cavity geometry above Z=2.5", () => {
    const mesh = buildCombinedTileMesh();
    const pos = mesh.positions;
    const r = 4.25;
    // Recess walls only span z=0…2.5; no wall/ceiling rim vertex may exceed 2.5.
    // (Solid top material may still occupy XY above the magnets at z=4.)
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i];
      const y = pos[i + 1];
      const z = pos[i + 2];
      for (const c of TILE_V1.magnetCentersMm) {
        const d = Math.hypot(x - c.x, y - c.y);
        if (Math.abs(d - r) < 1e-6 && z > 1e-9 && z < 4 - 1e-9) {
          assertEqual(Math.abs(z - 2.5) < 1e-9, true);
        }
      }
    }
  });

  test("circle segment count is stable", () => {
    assertEqual(MAGNET_CIRCLE_SEGMENTS, 64);
    assertEqual(circlePoints(0, 0, 1).length, 64);
  });

  test("circle vertices remain within chord tolerance", () => {
    const err = circleChordError(4.25, MAGNET_CIRCLE_SEGMENTS);
    assertEqual(err < 0.02, true);
  });

  test("tile has no zero-area triangles", () => {
    const mesh = buildCombinedTileMesh();
    const result = validateMesh(mesh);
    assertEqual(result.reasons.includes("zero-area triangle"), false);
  });

  test("golden combined tile structural metrics", () => {
    const mesh = buildCombinedTileMesh();
    const result = validateMesh(mesh, {
      bounds: TILE_V1.boundsMm,
      requireClosed: true,
      requirePositiveVolume: true,
    });
    assertEqual(result.vertexCount, GOLDEN_COMBINED_TILE.vertexCount);
    assertEqual(result.triangleCount, GOLDEN_COMBINED_TILE.triangleCount);
    assertEqual(result.edgeSummary.boundaryEdges, 0);
    assertEqual(result.edgeSummary.manifoldEdges, GOLDEN_COMBINED_TILE.edgeSummary.manifoldEdges);
    assertApproxEqual(result.bounds.sizeX, 148);
    assertApproxEqual(result.bounds.sizeY, 53);
    assertApproxEqual(result.bounds.sizeZ, 4);
  });
});

describe("raster-to-geometry", () => {
  test("row zero maps to positive Y", () => {
    const mapping = createRasterMapping(2, 2);
    assertApproxEqual(pixelTopY(mapping, 0), 26.5);
    assertApproxEqual(pixelBottomY(mapping, 0), 0);
    assertApproxEqual(pixelLeftX(mapping, 0), -74);
  });

  test("pixel-to-mm X and Y mapping", () => {
    const mapping = createRasterMapping(148, 53);
    assertApproxEqual(pixelLeftX(mapping, 0), -74);
    assertApproxEqual(pixelLeftX(mapping, 148), 74);
    assertApproxEqual(pixelTopY(mapping, 0), 26.5);
    assertApproxEqual(pixelTopY(mapping, 53), -26.5);
  });

  test("golden tiny mask rectangle decomposition", () => {
    const { width, height, indices, rectangles } = GOLDEN_TINY_MASK;
    const idx = Uint8Array.from(indices);
    const rects = maskToRectangles(idx, width, height);
    assertDeepEqual(rects, rectangles);
    assertRectangleCoverage(rects, idx, width, height);
  });

  test("rectangle merging preserves all cells and deterministic order", () => {
    const indices = new Uint8Array([1, 1, 1, 2, 2, 2]);
    const a = maskToRectangles(indices, 3, 2);
    const b = maskToRectangles(indices, 3, 2);
    assertDeepEqual(a, b);
    assertRectangleCoverage(a, indices, 3, 2);
  });

  test("one-pixel one-color mask", () => {
    const indices = new Uint8Array([0]);
    const mesh = buildArtworkColorMesh(indices, 1, 1, 0);
    const result = validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true });
    assertEqual(result.ok, true);
    assertApproxEqual(result.bounds.minZ, 3.0);
    assertApproxEqual(result.bounds.maxZ, 4);
  });

  test("solid one-color mask", () => {
    const indices = new Uint8Array(6).fill(0);
    const mesh = buildArtworkColorMesh(indices, 3, 2, 0);
    assertEqual(validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true }).ok, true);
  });

  test("two vertical colors", () => {
    const indices = new Uint8Array([0, 1, 0, 1]);
    const meshes = buildAllArtworkMeshes(indices, 2, 2);
    assertEqual(meshes.length, 2);
    for (const m of meshes) {
      assertEqual(validateMesh(m.mesh, { requireClosed: true, requirePositiveVolume: true }).ok, true);
    }
  });

  test("two horizontal colors", () => {
    const indices = new Uint8Array([0, 0, 1, 1]);
    const meshes = buildAllArtworkMeshes(indices, 2, 2);
    assertEqual(meshes.length, 2);
  });

  test("checkerboard", () => {
    const indices = new Uint8Array([0, 1, 1, 0]);
    const meshes = buildAllArtworkMeshes(indices, 2, 2);
    assertEqual(meshes.length, 2);
    for (const m of meshes) {
      assertEqual(validateMesh(m.mesh, { requireClosed: true, requirePositiveVolume: true }).ok, true);
    }
  });

  test("L-shaped region", () => {
    const indices = new Uint8Array([0, 0, 0, 1, 0, 1]);
    const mesh = buildArtworkColorMesh(indices, 3, 2, 0);
    assertEqual(validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true }).ok, true);
  });

  test("disconnected same-color islands", () => {
    const indices = new Uint8Array([0, 1, 0, 1, 1, 1]);
    const mesh = buildArtworkColorMesh(indices, 3, 2, 0);
    assertEqual(validateMesh(mesh, { requireClosed: true, requirePositiveVolume: true }).ok, true);
  });

  test("used-palette detection and unused skip", () => {
    const indices = new Uint8Array([0, 0, 2, 2]);
    assertDeepEqual(usedPaletteIndices(indices), [0, 2]);
    const meshes = buildAllArtworkMeshes(indices, 2, 2);
    assertEqual(meshes.length, 2);
    assertEqual(buildArtworkColorMesh(indices, 2, 2, 1), null);
  });

  test("artwork bounds use Z 3.0…4", () => {
    const indices = new Uint8Array([0, 1]);
    const meshes = buildAllArtworkMeshes(indices, 2, 1);
    for (const m of meshes) {
      const b = computeBounds(m.mesh);
      assertApproxEqual(b.minZ, 3.0);
      assertApproxEqual(b.maxZ, 4);
    }
  });

  test("artwork union covers full raster area", () => {
    const indices = new Uint8Array([0, 1, 1, 0]);
    const meshes = buildAllArtworkMeshes(indices, 2, 2);
    const mapping = createRasterMapping(2, 2);
    let area = 0;
    for (const m of meshes) {
      area += Math.abs(signedVolume(m.mesh)) / TILE_V1.artworkThicknessMm;
    }
    assertApproxEqual(area, TILE_V1.widthMm * TILE_V1.heightMm, 1e-6);
  });

  test("original accepted indices remain unchanged", () => {
    const indices = new Uint8Array([0, 1, 2, 0]);
    const copy = new Uint8Array(indices);
    buildAllArtworkMeshes(indices, 2, 2);
    assertDeepEqual([...indices], [...copy]);
  });

  test("adjacent color boundaries align exactly", () => {
    const indices = new Uint8Array([0, 1]);
    const meshes = buildAllArtworkMeshes(indices, 2, 1);
    const mapping = createRasterMapping(2, 1);
    const seamX = pixelLeftX(mapping, 1);
    const left = meshes.find((m) => m.paletteIndex === 0).mesh;
    const right = meshes.find((m) => m.paletteIndex === 1).mesh;
    let leftHas = false;
    let rightHas = false;
    for (let i = 0; i < left.positions.length; i += 3) {
      if (Math.abs(left.positions[i] - seamX) < 1e-12) leftHas = true;
    }
    for (let i = 0; i < right.positions.length; i += 3) {
      if (Math.abs(right.positions[i] - seamX) < 1e-12) rightHas = true;
    }
    assertEqual(leftHas && rightHas, true);
  });
});
