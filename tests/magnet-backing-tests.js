/**
 * Milestone 9.1 — full-width structural bridge + download adapter tests.
 */

import {
  describe,
  test,
  assertEqual,
} from "./test-utils.js";
import { TILE_V1, validateTileVerticalStructure } from "../src/geometry/tile-spec.js";
import {
  STRUCTURAL_BRIDGE,
  MAGNET_BACKING,
  validateStructuralBridge,
  validateMagnetBacking,
  createStructuralBridgeMask,
  createMagnetBackingMask,
  deriveStructuralBridgeGeometryAssignment,
  deriveMagnetBackingGeometryAssignment,
  cellCenterMm,
  cellCenterInMagnetCavity,
  usedArtworkPaletteIndices,
  pointInMagnetCavity,
  pointInMagnetBacking,
  resolveArtworkBottomZ,
  buildArtworkBottomHeights,
} from "../src/geometry/magnet-backing.js";
import {
  generateStructuralBridgeMesh,
  generateStructuralBackingMesh,
  STRUCTURAL_BRIDGE_OBJECT_NAME,
  MAGNET_BACKING_OBJECT_NAME,
} from "../src/geometry/magnet-backing-mesh.js";
import { createRasterMapping } from "../src/geometry/raster-coords.js";
import { generateTileGeometry } from "../src/geometry/generate-geometry.js";
import { validateMesh } from "../src/geometry/mesh-validation.js";
import { buildBaseTileMesh } from "../src/geometry/tile-base.js";
import {
  createTestDownloadAdapter,
  setDownloadAdapter,
  resetDownloadAdapter,
  downloadBlob,
  productionDownloadBlob,
  getDownloadAdapter,
} from "../src/export/download.js";
import {
  createThreeMfBytes,
  BACKING_OBJECT_ID,
  BACKING_OBJECT_NAME,
  BASE_OBJECT_ID,
} from "../src/export/three-mf.js";
import { packageMulticolorThreeMf } from "../src/export/three-mf-packaging.js";
import { createBoxMesh } from "../src/geometry/primitives.js";
import { DEFAULT_BASE_COLOR } from "../src/config.js";

describe("Milestone 9.1 — STRUCTURAL_BRIDGE constants", () => {
  test("magnet radius remains 4.25 mm", () => {
    assertEqual(TILE_V1.magnetRadiusMm, 4.25);
    assertEqual(TILE_V1.magnetDiameterMm / 2, 4.25);
  });

  test("bridge spans full tile at Z 2.5–3.0 (0.5 mm)", () => {
    assertEqual(STRUCTURAL_BRIDGE.zMinMm, 2.5);
    assertEqual(STRUCTURAL_BRIDGE.zMaxMm, 3.0);
    assertEqual(STRUCTURAL_BRIDGE.thicknessMm, 0.5);
    assertEqual(STRUCTURAL_BRIDGE.fullWidth, true);
    assertEqual(Math.abs(STRUCTURAL_BRIDGE.zMaxMm - STRUCTURAL_BRIDGE.zMinMm - 0.5) < 1e-9, true);
  });

  test("MAGNET_BACKING alias matches STRUCTURAL_BRIDGE", () => {
    assertEqual(MAGNET_BACKING, STRUCTURAL_BRIDGE);
  });

  test("local 0.2 mm disk policy is retired", () => {
    assertEqual(STRUCTURAL_BRIDGE.thicknessMm === 0.2, false);
    assertEqual(STRUCTURAL_BRIDGE.zMaxMm === 2.7, false);
  });

  test("artwork begins globally at Z = 3.0", () => {
    assertEqual(TILE_V1.artworkStartZMm, 3.0);
    assertEqual(TILE_V1.artworkStartZMm, STRUCTURAL_BRIDGE.zMaxMm);
    assertEqual(TILE_V1.artworkThicknessMm, 1.0);
  });

  test("vertical structure: base + bridge + artwork = 4.0", () => {
    assertEqual(
      TILE_V1.baseThicknessMm
        + TILE_V1.structuralBridgeThicknessMm
        + TILE_V1.artworkThicknessMm,
      4,
    );
    const v = validateTileVerticalStructure();
    assertEqual(v.ok, true, (v.reasons || []).join("; "));
  });

  test("bridge stays below visible artwork top / Relief min", () => {
    assertEqual(STRUCTURAL_BRIDGE.zMaxMm < TILE_V1.artworkEndZMm, true);
    assertEqual(STRUCTURAL_BRIDGE.zMaxMm < 3.4, true);
  });

  test("bridge uses structural base color", () => {
    assertEqual(STRUCTURAL_BRIDGE.useBaseColor, true);
  });

  test("validateStructuralBridge accepts frozen policy", () => {
    const v = validateStructuralBridge();
    assertEqual(v.ok, true, (v.reasons || []).join("; "));
    assertEqual(validateMagnetBacking().ok, true);
  });

  test("both magnet centers remain unchanged", () => {
    assertEqual(TILE_V1.magnetCentersMm.length, 2);
    assertEqual(TILE_V1.magnetCentersMm[0].x, -25);
    assertEqual(TILE_V1.magnetCentersMm[0].y, 0);
    assertEqual(TILE_V1.magnetCentersMm[1].x, 25);
    assertEqual(TILE_V1.magnetCentersMm[1].y, 0);
    for (const c of TILE_V1.magnetCentersMm) {
      assertEqual(pointInMagnetCavity(c.x, c.y), true);
    }
  });

  test("previous 1.5 mm visible roof band is not used", () => {
    assertEqual(Math.abs(STRUCTURAL_BRIDGE.zMaxMm - STRUCTURAL_BRIDGE.zMinMm - 1.5) < 1e-9, false);
    assertEqual(STRUCTURAL_BRIDGE.zMaxMm === 4.0, false);
  });
});

describe("Milestone 9.1 — magnet cavity helpers (not bridge footprint)", () => {
  const cx = -25;
  const cy = 0;

  test("exact cavity radius 4.25 mm classification remains", () => {
    assertEqual(pointInMagnetCavity(cx + 4.0, cy), true);
    assertEqual(pointInMagnetCavity(cx + 4.25, cy), true);
    assertEqual(pointInMagnetCavity(cx + 4.26, cy), false);
    assertEqual(pointInMagnetBacking(cx + 4.25, cy), true);
  });

  test("no 4.45 mm keepout disk remains", () => {
    assertEqual(pointInMagnetCavity(cx + 4.35, cy), false);
    assertEqual(pointInMagnetCavity(cx + 4.45, cy), false);
  });

  test("cell-center cavity classification on automatic grid", () => {
    const width = 1184;
    const height = 424;
    const mapping = createRasterMapping(width, height);

    /** @type {{ label: string, r: number, expectCavity: boolean }[]} */
    const probes = [
      { label: "inside-magnet", r: 4.0, expectCavity: true },
      { label: "exact-edge", r: 4.25, expectCavity: true },
      { label: "just-outside", r: 4.26, expectCavity: false },
    ];

    for (const probe of probes) {
      const x = cx + probe.r;
      const y = cy;
      const col = Math.max(0, Math.min(width - 1, Math.floor((x - mapping.minX) / mapping.cellWidthMm)));
      const row = Math.max(0, Math.min(height - 1, Math.floor((mapping.maxY - y) / mapping.cellHeightMm)));
      const center = cellCenterMm(mapping, col, row);
      const centerCavity = pointInMagnetCavity(center.x, center.y);
      assertEqual(
        cellCenterInMagnetCavity(col, row, mapping),
        centerCavity,
        `${probe.label}: cellCenter helper`,
      );
      assertEqual(
        pointInMagnetCavity(x, y),
        probe.expectCavity,
        `${probe.label}: point at r=${probe.r}`,
      );
    }
  });
});

describe("Milestone 9.1 — full-width bridge assignment", () => {
  test("bridge mask covers every cell", () => {
    for (const [w, h] of [[4, 2], [74, 26], [148, 53], [296, 106]]) {
      const mask = createStructuralBridgeMask(w, h);
      assertEqual(mask.length, w * h);
      for (let i = 0; i < mask.length; i += 1) {
        assertEqual(mask[i], 1, `${w}x${h} cell ${i}`);
      }
      assertEqual(createMagnetBackingMask(w, h).length, mask.length);
    }
  });

  test("accepted indices are unchanged by derivation", () => {
    const width = 20;
    const height = 10;
    const accepted = new Uint8Array(width * height);
    for (let i = 0; i < accepted.length; i += 1) accepted[i] = i % 3;
    const snapshot = Uint8Array.from(accepted);
    const derived = deriveStructuralBridgeGeometryAssignment(accepted, width, height);
    for (let i = 0; i < accepted.length; i += 1) {
      assertEqual(accepted[i], snapshot[i]);
      assertEqual(derived.acceptedIndices[i], snapshot[i]);
    }
  });

  test("geometry assignment preserves palette over entire tile including magnets", () => {
    const width = 148;
    const height = 53;
    const accepted = new Uint8Array(width * height);
    accepted.fill(1);
    const derived = deriveStructuralBridgeGeometryAssignment(accepted, width, height);
    assertEqual(derived.bridgeCellCount, width * height);
    assertEqual(derived.backingCellCount, width * height);
    for (let i = 0; i < derived.geometryIndices.length; i += 1) {
      assertEqual(derived.geometryIndices[i], 1);
    }
    const used = usedArtworkPaletteIndices(derived.geometryIndices);
    assertEqual(used.join(","), "1");
  });

  test("artwork palette is preserved inside magnet footprint", () => {
    const width = 296;
    const height = 106;
    const accepted = new Uint8Array(width * height);
    accepted.fill(2);
    const derived = deriveStructuralBridgeGeometryAssignment(accepted, width, height);
    const mapping = createRasterMapping(width, height);
    let foundInsideMagnet = false;
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const { x, y } = cellCenterMm(mapping, col, row);
        const dx = x - (-25);
        const dy = y - 0;
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r <= 4.25) {
          const i = row * width + col;
          assertEqual(derived.bridgeMask[i], 1);
          assertEqual(derived.geometryIndices[i], 2);
          foundInsideMagnet = true;
        }
      }
    }
    assertEqual(foundInsideMagnet, true);
  });

  test("every artwork bottom Z is 3.0 mm", () => {
    const width = 74;
    const height = 26;
    const derived = deriveStructuralBridgeGeometryAssignment(new Uint8Array(width * height), width, height);
    for (let i = 0; i < derived.artworkBottomZ.length; i += 1) {
      assertEqual(Math.abs(derived.artworkBottomZ[i] - 3.0) < 1e-9, true);
    }
  });

  test("resolveArtworkBottomZ and buildArtworkBottomHeights agree", () => {
    const width = 10;
    const height = 5;
    const mask = createStructuralBridgeMask(width, height);
    const bottoms = buildArtworkBottomHeights(width, height, mask);
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const i = row * width + col;
        assertEqual(
          bottoms[i],
          resolveArtworkBottomZ(col, row, width, mask),
        );
        assertEqual(Math.abs(bottoms[i] - 3.0) < 1e-9, true);
      }
    }
  });

  test("deterministic bridge mask across runs", () => {
    const a = createStructuralBridgeMask(74, 26);
    const b = createStructuralBridgeMask(74, 26);
    assertEqual(a.length, b.length);
    for (let i = 0; i < a.length; i += 1) assertEqual(a[i], b[i]);
  });

  test("legacy deriveMagnetBackingGeometryAssignment alias still works", () => {
    const derived = deriveMagnetBackingGeometryAssignment(new Uint8Array(8), 4, 2);
    assertEqual(derived.backingCellCount, 8);
    assertEqual(Math.abs(derived.artworkBottomZ[0] - 3.0) < 1e-9, true);
  });
});

describe("Milestone 9.1 — bridge geometry", () => {
  function twoColorMask(width, height) {
    const indices = new Uint8Array(width * height);
    for (let i = 0; i < indices.length; i += 1) {
      indices[i] = i % 2;
    }
    return indices;
  }

  test("Flat output contains full-width bridge and unchanged magnet cavity base", () => {
    const width = 74;
    const height = 26;
    const indices = twoColorMask(width, height);
    const geo = generateTileGeometry({
      cleanedIndices: indices,
      width,
      height,
      surfaceStyle: "flat",
      effectivePalette: [{ r: 10, g: 10, b: 10 }, { r: 200, g: 200, b: 200 }],
    });
    assertEqual(geo.ok, true, geo.reasons.join("; "));
    assertEqual(geo.backingCellCount, width * height);
    assertEqual(Boolean(geo.backing), true);
    assertEqual(geo.validation.backing.ok, true, (geo.validation.backing.reasons || []).join("; "));
    assertEqual(geo.validation.base.ok, true);
    assertEqual(Math.abs(geo.validation.base.bounds.maxZ - 2.5) < 1e-6, true);
    assertEqual(Math.abs(geo.validation.backing.bounds.minZ - 2.5) < 1e-6, true);
    assertEqual(Math.abs(geo.validation.backing.bounds.maxZ - 3.0) < 1e-6, true);
    assertEqual(Math.abs(geo.validation.backing.bounds.sizeX - 148) < 1e-6, true);
    assertEqual(Math.abs(geo.validation.backing.bounds.sizeY - 53) < 1e-6, true);
    assertEqual(Math.abs(geo.validation.backing.bounds.sizeZ - 0.5) < 1e-6, true);
  });

  test("artwork color meshes begin at Z = 3.0 everywhere", () => {
    const width = 74;
    const height = 26;
    const indices = twoColorMask(width, height);
    const geo = generateTileGeometry({
      cleanedIndices: indices,
      width,
      height,
      surfaceStyle: "flat",
      effectivePalette: [{ r: 10, g: 10, b: 10 }, { r: 200, g: 200, b: 200 }],
    });
    assertEqual(geo.ok, true, geo.reasons.join("; "));
    for (const c of geo.colors) {
      const v = geo.validation.colors[geo.colors.indexOf(c)];
      assertEqual(Math.abs(v.bounds.minZ - 3.0) < 1e-6, true, `color[${c.paletteIndex}] minZ`);
    }
    for (let i = 0; i < geo.artworkBottomZ.length; i += 1) {
      assertEqual(Math.abs(geo.artworkBottomZ[i] - 3.0) < 1e-9, true);
    }
  });

  test("Relief preserves palette indices; tops unchanged above magnets", () => {
    const width = 74;
    const height = 26;
    const indices = twoColorMask(width, height);
    const geo = generateTileGeometry({
      cleanedIndices: indices,
      width,
      height,
      surfaceStyle: "relief",
      reliefStrengthId: "bold",
      heightOrder: "darkest-highest",
      effectivePalette: [{ r: 10, g: 10, b: 10 }, { r: 240, g: 240, b: 240 }],
    });
    assertEqual(geo.ok, true, geo.reasons.join("; "));
    assertEqual(Boolean(geo.backing), true);
    for (let i = 0; i < geo.geometryIndices.length; i += 1) {
      assertEqual(geo.geometryIndices[i], indices[i]);
    }
    assertEqual(geo.validation.combined.ok, true, (geo.validation.combined.reasons || []).join("; "));
    for (const c of geo.colors) {
      assertEqual(c.topZMm >= 3.4 - 1e-9, true);
      assertEqual(c.topZMm <= 4.0 + 1e-9, true);
    }
  });

  test("artwork meshes cover every raster cell; bridge is additive", () => {
    const width = 74;
    const height = 26;
    const indices = twoColorMask(width, height);
    const geo = generateTileGeometry({
      cleanedIndices: indices,
      width,
      height,
      surfaceStyle: "flat",
      effectivePalette: [{ r: 10, g: 10, b: 10 }, { r: 200, g: 200, b: 200 }],
    });
    assertEqual(geo.ok, true, geo.reasons.join("; "));
    let artPop = 0;
    for (const c of geo.colors) artPop += c.population;
    assertEqual(artPop, width * height);
    for (const c of geo.colors) {
      assertEqual(c.population > 0, true);
    }
  });

  test("structural bridge mesh is closed and manifold", () => {
    const width = 74;
    const height = 26;
    const indices = twoColorMask(width, height);
    const geo = generateTileGeometry({
      cleanedIndices: indices,
      width,
      height,
      surfaceStyle: "flat",
      effectivePalette: [{ r: 10, g: 10, b: 10 }, { r: 200, g: 200, b: 200 }],
    });
    const v = validateMesh(geo.backing, { requireClosed: true, requirePositiveVolume: true });
    assertEqual(v.ok, true, v.reasons.join("; "));
    assertEqual(v.edgeSummary.boundaryEdges, 0);
    assertEqual(v.edgeSummary.nonManifoldEdges, 0);
  });

  test("structural bridge mesh uses stable object name", () => {
    assertEqual(STRUCTURAL_BRIDGE_OBJECT_NAME, "Structural Bridge");
    assertEqual(MAGNET_BACKING_OBJECT_NAME, "Structural Bridge");
    assertEqual(BACKING_OBJECT_NAME, "Structural Bridge");
    const mesh = generateStructuralBridgeMesh(74, 26);
    assertEqual(Boolean(mesh), true);
    assertEqual(Boolean(generateStructuralBackingMesh(4, 2)), true);
  });

  test("Flat combined one-filament mesh remains valid (envelope unchanged)", () => {
    const width = 4;
    const height = 2;
    const indices = twoColorMask(width, height);
    const geo = generateTileGeometry({
      cleanedIndices: indices,
      width,
      height,
      surfaceStyle: "flat",
      effectivePalette: [{ r: 10, g: 10, b: 10 }, { r: 200, g: 200, b: 200 }],
    });
    assertEqual(geo.ok, true, geo.reasons.join("; "));
    assertEqual(geo.validation.combined.ok, true);
    assertEqual(geo.validation.combined.bounds.sizeX, 148);
    assertEqual(geo.validation.combined.bounds.sizeY, 53);
    assertEqual(geo.validation.combined.bounds.sizeZ, 4);
  });

  test("magnet cavity geometry remains unchanged", () => {
    const a = buildBaseTileMesh();
    const geo = generateTileGeometry({
      cleanedIndices: twoColorMask(20, 10),
      width: 20,
      height: 10,
      surfaceStyle: "flat",
      effectivePalette: [{ r: 1, g: 1, b: 1 }, { r: 2, g: 2, b: 2 }],
    });
    assertEqual(geo.base.positions.length, a.positions.length);
    assertEqual(geo.base.triangles.length, a.triangles.length);
    for (let i = 0; i < a.positions.length; i += 1) {
      assertEqual(Math.abs(geo.base.positions[i] - a.positions[i]) < 1e-12, true);
    }
    assertEqual(TILE_V1.magnetDiameterMm, 8.5);
    assertEqual(TILE_V1.magnetDepthMm, 2.5);
  });

  test("legacy roof / keepout aliases still resolve to bridge", () => {
    const geo = generateTileGeometry({
      cleanedIndices: twoColorMask(20, 10),
      width: 20,
      height: 10,
      surfaceStyle: "flat",
      effectivePalette: [{ r: 1, g: 1, b: 1 }, { r: 2, g: 2, b: 2 }],
    });
    assertEqual(geo.roof, geo.backing);
    assertEqual(geo.keepoutMask, geo.backingMask);
    assertEqual(geo.keepoutCellCount, geo.backingCellCount);
  });

  test("no local circular magnet disk remains on the bridge mesh", () => {
    const mesh = generateStructuralBridgeMesh(74, 26);
    const v = validateMesh(mesh, { requireClosed: true });
    assertEqual(Math.abs(v.bounds.sizeX - 148) < 1e-9, true);
    assertEqual(Math.abs(v.bounds.sizeY - 53) < 1e-9, true);
    // Full-tile box has 8 vertices / 12 triangles — not a circular extrusion.
    assertEqual(mesh.positions.length / 3, 8);
    assertEqual(mesh.triangles.length / 3, 12);
  });
});

describe("Milestone 9.1 — multicolor bridge property", () => {
  test("3MF bridge uses same property as base; does not increase image-color count", () => {
    const baseMesh = createBoxMesh(-1, -1, 0, 1, 1, 2.5);
    const bridgeMesh = createBoxMesh(-74, -26.5, 2.5, 74, 26.5, 3.0);
    const colorMeshes = [
      { paletteIndex: 0, color: { r: 255, g: 0, b: 0 }, mesh: createBoxMesh(-1, -1, 3.0, 0, 1, 4) },
      { paletteIndex: 1, color: { r: 0, g: 0, b: 255 }, mesh: createBoxMesh(0, -1, 3.0, 1, 1, 4) },
    ];
    const result = createThreeMfBytes({
      projectName: "Bridge Prop",
      baseMesh,
      roofMesh: bridgeMesh,
      colorMeshes,
      baseColor: { ...DEFAULT_BASE_COLOR },
      surfaceStyle: "flat",
    });
    assertEqual(result.manifest.usedColors, 2);
    assertEqual(result.manifest.colorCount, 3);
    assertEqual(result.manifest.keepoutObjectCount, 1);
    assertEqual(result.manifest.childObjectCount, 4);
    const model = result.xml.model;
    assertEqual(model.includes(`object id="${BACKING_OBJECT_ID}"`), true);
    assertEqual(model.includes(`name="${BACKING_OBJECT_NAME}"`), true);
    assertEqual(model.includes('name="Structural Bridge"'), true);
    assertEqual(model.includes('name="Magnet Backing"'), false);
    assertEqual(model.includes(`object id="${BASE_OBJECT_ID}"`), true);
    assertEqual(/object id="2"[^>]*pindex="0"/.test(model), true);
    assertEqual(/object id="3"[^>]*pindex="0"/.test(model), true);
    const colorMatches = model.match(/<m:color /g) || [];
    assertEqual(colorMatches.length, 3);
  });

  test("Flat and Relief packaging include structural bridge and validate", () => {
    const width = 74;
    const height = 26;
    const indices = new Uint8Array(width * height);
    for (let i = 0; i < indices.length; i += 1) indices[i] = i % 2;
    const palette = [{ r: 20, g: 20, b: 20 }, { r: 200, g: 180, b: 40 }];
    for (const style of ["flat", "relief"]) {
      const geo = generateTileGeometry({
        cleanedIndices: indices,
        width,
        height,
        surfaceStyle: style,
        reliefStrengthId: "standard",
        heightOrder: "darkest-highest",
        effectivePalette: palette,
      });
      assertEqual(geo.ok, true, `${style}: ${geo.reasons.join("; ")}`);
      assertEqual(Boolean(geo.backing), true);
      assertEqual(geo.validation.combined.ok, true, `${style} combined`);
      const packaged = packageMulticolorThreeMf({
        projectName: `bridge-${style}`,
        baseMesh: geo.base,
        roofMesh: geo.backing,
        colorMeshes: geo.colors.map((c) => ({
          paletteIndex: c.paletteIndex,
          mesh: c.mesh,
          color: palette[c.paletteIndex],
        })),
        baseColor: { ...DEFAULT_BASE_COLOR },
        surfaceStyle: style,
      });
      assertEqual(packaged.validation.ok, true, packaged.validation.reasons.join("; "));
      assertEqual(packaged.manifest.keepoutObjectCount, 1);
      assertEqual(packaged.manifest.usedColors, geo.colors.length);
    }
  });
});

describe("Milestone 9.1 — download adapter", () => {
  test("test adapter never invokes a browser download", () => {
    const adapter = createTestDownloadAdapter();
    setDownloadAdapter(adapter);
    const blob = new Blob(["hello"], { type: "text/plain" });
    downloadBlob(blob, "hello.txt");
    assertEqual(adapter.getInvocationCount(), 1);
    const rec = adapter.getRecords()[0];
    assertEqual(rec.filename, "hello.txt");
    assertEqual(rec.mimeType, "text/plain");
    assertEqual(rec.byteLength, 5);
    assertEqual(rec.blob instanceof Blob, true);
    assertEqual(document.querySelectorAll("a[download]").length, 0);
    resetDownloadAdapter();
  });

  test("production download requires calling productionDownloadBlob explicitly", () => {
    resetDownloadAdapter();
    const adapter = getDownloadAdapter();
    assertEqual(typeof adapter.downloadBlob, "function");
    assertEqual(typeof productionDownloadBlob, "function");
  });

  test("automated test creates no Save As dialog and no showSaveFilePicker in source", async () => {
    const src = await (await fetch("../src/export/download.js")).text();
    assertEqual(src.includes("showSaveFilePicker"), false);
    const app = await (await fetch("../src/ui/export-controller.js")).text();
    assertEqual(app.includes("showSaveFilePicker"), false);
  });

  test("no Math.random in magnet-backing module", async () => {
    const src = await (await fetch("../src/geometry/magnet-backing.js")).text();
    assertEqual(src.includes("Math.random"), false);
  });
});
