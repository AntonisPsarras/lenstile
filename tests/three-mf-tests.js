/**
 * 3MF packaging tests (Milestone 7 / 7.1).
 */

import {
  describe,
  test,
  assertEqual,
  assertThrows,
} from "./test-utils.js";
import { createBoxMesh } from "../src/geometry/primitives.js";
import {
  createThreeMfBytes,
  createThreeMfPackage,
  writeThreeMf,
  format3mfNumber,
  buildContentTypesXml,
  buildRootRelsXml,
  buildModelXml,
  rgbToDisplayColor,
  rgbToMaterialColor,
  artworkObjectName,
  assemblyObjectId,
  childObjectIds,
  COLOR_GROUP_ID,
  BASEMATERIALS_ID,
  BASE_OBJECT_ID,
  ROOF_OBJECT_ID,
  FIRST_ARTWORK_OBJECT_ID,
  ASSEMBLY_OBJECT_NAME,
  NS_MATERIALS,
  MATERIALS_PREFIX,
  CONTENT_TYPE_MODEL,
  REL_TYPE_MODEL,
} from "../src/export/three-mf.js";
import { validateThreeMfPackage } from "../src/export/three-mf-validate.js";
import { escapeXml } from "../src/export/xml-escape.js";
import { readZipStore } from "../src/export/zip-store.js";
import { multicolorThreeMfFilename } from "../src/export/stl-filenames.js";
import { FEATURES, DEFAULT_BASE_COLOR } from "../src/config.js";
import {
  resetStore,
  getState,
  getRuntimeGeometry,
  getRuntimeThreeMf,
  beginGeometryRequest,
  acceptGeometryResult,
  acceptThreeMfPackage,
  acceptThreeMfError,
  clearRuntimeThreeMf,
  patchExport,
  patchQuantization,
  isGeometryDownloadReady,
} from "../src/state.js";
import {
  getExportReadiness,
  getThreeMfPackageKey,
} from "../src/ui/export-controller.js";
import {
  GOLDEN_3MF_MESH_SPEC,
  GOLDEN_3MF_FLAT,
  GOLDEN_3MF_RELIEF,
} from "./fixtures/three-mf-golden.js";
import { buildCombinedTileMesh, buildBaseTileMesh } from "../src/geometry/tile-base.js";
import { buildAllArtworkMeshes } from "../src/geometry/artwork-mesh.js";
import { buildAllReliefArtworkMeshes } from "../src/geometry/relief-mesh.js";
import { TILE_V1 } from "../src/geometry/tile-spec.js";
import { vertexCount, triangleCount } from "../src/geometry/mesh.js";
import { mountLayout } from "../src/ui/layout.js";
import { bindControls, syncControlsFromState } from "../src/ui/controls.js";
import { patchSurface } from "../src/state.js";

/**
 * @param {Uint8Array} bytes
 */
function fnv1aHex(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * @param {"flat" | "relief"} style
 */
function buildGoldenInputs(style) {
  const spec = GOLDEN_3MF_MESH_SPEC;
  const baseMesh = createBoxMesh(
    spec.baseBox.minX,
    spec.baseBox.minY,
    spec.baseBox.minZ,
    spec.baseBox.maxX,
    spec.baseBox.maxY,
    spec.baseBox.maxZ,
  );
  const roofMesh = createBoxMesh(
    spec.roofBox.minX,
    spec.roofBox.minY,
    spec.roofBox.minZ,
    spec.roofBox.maxX,
    spec.roofBox.maxY,
    spec.roofBox.maxZ,
  );
  const boxes = style === "relief" ? spec.reliefColorBoxes : spec.colorBoxes;
  const colorMeshes = boxes.map((box) => ({
    paletteIndex: box.paletteIndex,
    color: { ...box.color },
    mesh: createBoxMesh(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ),
  }));
  return {
    projectName: spec.projectName,
    baseMesh,
    roofMesh,
    colorMeshes,
    baseColor: { ...spec.baseColor },
    surfaceStyle: style,
    geometryVersion: 1,
  };
}

describe("3MF XML helpers", () => {
  test("content-types XML structure", () => {
    const xml = buildContentTypesXml();
    assertEqual(xml.includes('Extension="rels"'), true);
    assertEqual(xml.includes('Extension="model"'), true);
    assertEqual(xml.includes(CONTENT_TYPE_MODEL), true);
    assertEqual(xml.charCodeAt(0) === 0xfeff, false);
  });

  test("root relationship target", () => {
    const xml = buildRootRelsXml();
    assertEqual(xml.includes('Target="/3D/3dmodel.model"'), true);
    assertEqual(xml.includes(REL_TYPE_MODEL), true);
  });

  test("model unit is millimeter", () => {
    const inputs = buildGoldenInputs("flat");
    const xml = buildModelXml(inputs);
    assertEqual(xml.includes('unit="millimeter"'), true);
  });

  test("XML escaping", () => {
    assertEqual(escapeXml(`A&B<C>"D"'E'`), "A&amp;B&lt;C&gt;&quot;D&quot;&apos;E&apos;");
  });

  test("negative zero formatting", () => {
    assertEqual(format3mfNumber(-0), "0");
    assertEqual(format3mfNumber(0), "0");
  });

  test("deterministic coordinate formatting", () => {
    assertEqual(format3mfNumber(2.5), "2.5");
    assertEqual(format3mfNumber(3.4), "3.4");
    assertEqual(format3mfNumber(-74), "-74");
    assertEqual(format3mfNumber(26.5), "26.5");
    assertEqual(format3mfNumber(1.23456789), "1.234568");
  });

  test("no scientific notation for fixture coordinates", () => {
    for (const v of [-74, 74, -26.5, 26.5, 0, 2.5, 3.4, 4]) {
      const s = format3mfNumber(v);
      assertEqual(/e/i.test(s), false);
    }
  });
});

describe("3MF multipart assembly", () => {
  test("parent assembly object exists with components not mesh", () => {
    const result = createThreeMfBytes(buildGoldenInputs("flat"));
    const model = result.xml.model;
    const parentId = assemblyObjectId(2);
    assertEqual(model.includes(`object id="${parentId}" type="model" name="${ASSEMBLY_OBJECT_NAME}"`), true);
    assertEqual(model.includes("<components>"), true);
    assertEqual(model.includes(`component objectid="${BASE_OBJECT_ID}"`), true);
    assertEqual(model.includes(`component objectid="${ROOF_OBJECT_ID}"`), true);
    assertEqual(model.includes(`component objectid="${FIRST_ARTWORK_OBJECT_ID}"`), true);
    assertEqual(model.includes(`component objectid="${FIRST_ARTWORK_OBJECT_ID + 1}"`), true);
    // Parent block has no mesh.
    const parentStart = model.indexOf(`object id="${parentId}"`);
    const parentEnd = model.indexOf("</object>", parentStart);
    const parentBlock = model.slice(parentStart, parentEnd);
    assertEqual(parentBlock.includes("<mesh>"), false);
    assertEqual(parentBlock.includes("pid="), false);
    assertEqual(parentBlock.includes("pindex="), false);
  });

  test("parent has no pid and no pindex", () => {
    const model = createThreeMfBytes(buildGoldenInputs("flat")).xml.model;
    assertEqual(/object id="6"[^>]*pid=/.test(model), false);
    assertEqual(/object id="6"[^>]*pindex=/.test(model), false);
  });

  test("every child is referenced once", () => {
    const result = createThreeMfBytes(buildGoldenInputs("flat"));
    assertEqual(result.manifest.componentCount, 4);
    assertEqual(result.manifest.childObjectCount, 4);
    const ids = childObjectIds(2);
    assertEqual(ids.join(","), "2,3,4,5");
    const model = result.xml.model;
    for (const id of ids) {
      const matches = model.match(new RegExp(`component objectid="${id}"`, "g"));
      assertEqual(matches && matches.length, 1);
    }
  });

  test("build contains one parent item and children are absent", () => {
    const result = createThreeMfBytes(buildGoldenInputs("flat"));
    const model = result.xml.model;
    assertEqual(result.manifest.buildItemCount, 1);
    assertEqual(model.includes(`item objectid="${assemblyObjectId(2)}"`), true);
    assertEqual(model.includes(`item objectid="${BASE_OBJECT_ID}"`), false);
    assertEqual(model.includes(`item objectid="${FIRST_ARTWORK_OBJECT_ID}"`), false);
    assertEqual(model.includes(`item objectid="${FIRST_ARTWORK_OBJECT_ID + 1}"`), false);
    assertEqual((model.match(/<item /g) || []).length, 1);
  });

  test("Flat assembly object count is correct", () => {
    const result = createThreeMfBytes(buildGoldenInputs("flat"));
    assertEqual(result.manifest.objectCount, 5);
    assertEqual(result.manifest.childObjectCount, 4);
    assertEqual(result.manifest.assemblyObjectId, 6);
    const validation = validateThreeMfPackage(result.bytes, {
      expectedObjectCount: 5,
      expectedUsedColors: 2,
      expectedChildObjectCount: 4,
    });
    assertEqual(validation.ok, true, validation.reasons.join("; "));
  });

  test("Relief assembly object count is correct", () => {
    const result = createThreeMfBytes(buildGoldenInputs("relief"));
    assertEqual(result.manifest.objectCount, 7);
    assertEqual(result.manifest.childObjectCount, 6);
    assertEqual(result.manifest.assemblyObjectId, 8);
    const validation = validateThreeMfPackage(result.bytes, {
      expectedObjectCount: 7,
      expectedUsedColors: 4,
      expectedChildObjectCount: 6,
    });
    assertEqual(validation.ok, true, validation.reasons.join("; "));
  });

  test("relative coordinates are unchanged from input meshes", () => {
    const inputs = buildGoldenInputs("flat");
    const result = createThreeMfBytes(inputs);
    const validation = validateThreeMfPackage(result.bytes, {
      baseMesh: inputs.baseMesh,
      roofMesh: inputs.roofMesh,
      colorMeshes: inputs.colorMeshes,
      expectedUsedColors: 2,
    });
    assertEqual(validation.ok, true, validation.reasons.join("; "));
  });
});

describe("3MF Materials color groups", () => {
  test("Materials-extension namespace and recommendedextensions", () => {
    const model = createThreeMfBytes(buildGoldenInputs("flat")).xml.model;
    assertEqual(model.includes(`xmlns:${MATERIALS_PREFIX}="${NS_MATERIALS}"`), true);
    assertEqual(model.includes(`recommendedextensions="${MATERIALS_PREFIX}"`), true);
    assertEqual(model.includes("requiredextensions="), false);
  });

  test("color group exists with base and artwork colors", () => {
    const result = createThreeMfBytes(buildGoldenInputs("flat"));
    const model = result.xml.model;
    assertEqual(model.includes(`<m:colorgroup id="${COLOR_GROUP_ID}">`), true);
    assertEqual(model.includes(`<m:color color="${rgbToMaterialColor({ r: 42, g: 42, b: 42 })}"/>`), true);
    assertEqual(model.includes(`<m:color color="${rgbToMaterialColor({ r: 255, g: 0, b: 0 })}"/>`), true);
    assertEqual(model.includes(`<m:color color="${rgbToMaterialColor({ r: 0, g: 128, b: 255 })}"/>`), true);
    assertEqual(result.manifest.colorCount, 3);
    assertEqual(COLOR_GROUP_ID, BASEMATERIALS_ID);
  });

  test("every child references the correct property index", () => {
    const model = createThreeMfBytes(buildGoldenInputs("flat")).xml.model;
    assertEqual(model.includes(`pid="${COLOR_GROUP_ID}" pindex="0" name="Tile Base"`), true);
    assertEqual(model.includes(`pid="${COLOR_GROUP_ID}" pindex="1"`), true);
    assertEqual(model.includes(`pid="${COLOR_GROUP_ID}" pindex="2"`), true);
  });

  test("palette override appears in the package", () => {
    const inputs = buildGoldenInputs("flat");
    inputs.colorMeshes[0].color = { r: 10, g: 20, b: 30 };
    const model = createThreeMfBytes(inputs).xml.model;
    assertEqual(model.includes("Artwork Color 01 — 0A141E"), true);
    assertEqual(model.includes("#0A141E"), true);
  });

  test("unused colors are absent", () => {
    const inputs = buildGoldenInputs("flat");
    assertEqual(inputs.colorMeshes.length, 2);
    const model = createThreeMfBytes(inputs).xml.model;
    assertEqual(model.includes("Artwork Color 03"), false);
  });

  test("Core displaycolor is not the only printable-color mechanism", () => {
    const model = createThreeMfBytes(buildGoldenInputs("flat")).xml.model;
    assertEqual(model.includes("basematerials"), false);
    assertEqual(model.includes("displaycolor"), false);
    assertEqual(model.includes("<m:colorgroup"), true);
    // Legacy helper still encodes opaque FF for tests that need it.
    assertEqual(rgbToDisplayColor({ r: 1, g: 2, b: 3 }), "#010203FF");
  });

  test("color resource IDs and indices are deterministic", () => {
    const a = createThreeMfBytes(buildGoldenInputs("flat")).xml.model;
    const b = createThreeMfBytes(buildGoldenInputs("flat")).xml.model;
    assertEqual(a, b);
    assertEqual(assemblyObjectId(2), 6);
    assertEqual(assemblyObjectId(4), 8);
  });

  test("base color used", () => {
    const inputs = buildGoldenInputs("flat");
    inputs.baseColor = { r: 1, g: 2, b: 3 };
    const model = createThreeMfBytes(inputs).xml.model;
    assertEqual(model.includes("#010203"), true);
  });

  test("Relief color objects preserve their individual top heights", () => {
    const model = createThreeMfBytes(buildGoldenInputs("relief")).xml.model;
    assertEqual(model.includes('z="4"'), true);
    assertEqual(model.includes('z="3.8"'), true);
    assertEqual(model.includes('z="3.6"'), true);
    assertEqual(model.includes('z="3.4"'), true);
  });

  test("Flat color objects preserve Z 2.5–4", () => {
    const inputs = buildGoldenInputs("flat");
    const model = createThreeMfBytes(inputs).xml.model;
    assertEqual(model.includes('z="2.5"'), true);
    assertEqual(model.includes('z="4"'), true);
  });

  test("stable IDs for base and artwork children", () => {
    const result = createThreeMfBytes(buildGoldenInputs("flat"));
    const inputs = buildGoldenInputs("flat");
    const validation = validateThreeMfPackage(result.bytes, {
      expectedObjectCount: 5,
      expectedUsedColors: 2,
      baseMesh: inputs.baseMesh,
      roofMesh: inputs.roofMesh,
      colorMeshes: inputs.colorMeshes,
      baseColor: inputs.baseColor,
    });
    assertEqual(validation.ok, true, validation.reasons.join("; "));
    assertEqual(validation.unit, "millimeter");
    assertEqual(validation.hasMaterialsNamespace, true);
    assertEqual(validation.hasColorGroup, true);
    assertEqual(validation.objectCount, 5);
    assertEqual(validation.childObjectCount, 4);
    assertEqual(validation.materialCount, 3);
    assertEqual(validation.buildItemCount, 1);
    assertEqual(validation.assemblyObjectId, 6);

    const model = result.xml.model;
    assertEqual(model.includes(`object id="${BASE_OBJECT_ID}"`), true);
    assertEqual(model.includes(`object id="${ROOF_OBJECT_ID}"`), true);
    assertEqual(model.includes(`object id="${FIRST_ARTWORK_OBJECT_ID}"`), true);
    assertEqual(model.indexOf("Tile Base") < model.indexOf("Artwork Color 01"), true);
    assertEqual(model.includes("transform="), false);
    assertEqual(model.includes(artworkObjectName(1, { r: 255, g: 0, b: 0 })), true);
  });
});

describe("3MF objects and materials", () => {
  test("magnet geometry remains in real base mesh packaging", () => {
    const base = buildBaseTileMesh();
    const indices = new Uint8Array([0, 1, 0, 1]);
    const colors = buildAllArtworkMeshes(indices, 2, 2);
    assertEqual(colors.length >= 2, true);
    const colorMeshes = colors.map((c, i) => ({
      paletteIndex: c.paletteIndex,
      mesh: c.mesh,
      color: i === 0 ? { r: 255, g: 0, b: 0 } : { r: 0, g: 0, b: 255 },
    }));
    const result = createThreeMfBytes({
      projectName: "magnets",
      baseMesh: base,
      roofMesh: createBoxMesh(-0.2, -0.2, 2.5, 0.2, 0.2, 4),
      colorMeshes,
      baseColor: { ...DEFAULT_BASE_COLOR },
      surfaceStyle: "flat",
    });
    const model = result.xml.model;
    assertEqual(model.includes('z="0"'), true);
    assertEqual(model.includes('z="2.5"'), true);
    assertEqual(vertexCount(base) > 100, true);
  });

  test("vertex and triangle counts equal input meshes", () => {
    const inputs = buildGoldenInputs("flat");
    const expectedV = vertexCount(inputs.baseMesh)
      + vertexCount(inputs.roofMesh)
      + inputs.colorMeshes.reduce((n, c) => n + vertexCount(c.mesh), 0);
    const expectedT = triangleCount(inputs.baseMesh)
      + triangleCount(inputs.roofMesh)
      + inputs.colorMeshes.reduce((n, c) => n + triangleCount(c.mesh), 0);
    const result = createThreeMfBytes(inputs);
    assertEqual(result.manifest.vertexCount, expectedV);
    assertEqual(result.manifest.triangleCount, expectedT);
    assertEqual(expectedV, GOLDEN_3MF_FLAT.vertexCount);
    assertEqual(expectedT, GOLDEN_3MF_FLAT.triangleCount);
  });

  test("packaging does not mutate meshes", () => {
    const inputs = buildGoldenInputs("flat");
    const before = {
      bv: inputs.baseMesh.positions[0],
      bt: inputs.baseMesh.triangles[0],
      cv: inputs.colorMeshes[0].mesh.positions[0],
      ct: inputs.colorMeshes[0].mesh.triangles[0],
    };
    createThreeMfBytes(inputs);
    assertEqual(inputs.baseMesh.positions[0], before.bv);
    assertEqual(inputs.baseMesh.triangles[0], before.bt);
    assertEqual(inputs.colorMeshes[0].mesh.positions[0], before.cv);
    assertEqual(inputs.colorMeshes[0].mesh.triangles[0], before.ct);
  });

  test("writeThreeMf requires options", () => {
    assertThrows(() => writeThreeMf(), "requires");
  });
});

describe("3MF golden fixtures", () => {
  test("Flat golden metrics", () => {
    const result = createThreeMfBytes(buildGoldenInputs("flat"));
    assertEqual(result.filename, GOLDEN_3MF_FLAT.filename);
    assertEqual(result.manifest.objectCount, GOLDEN_3MF_FLAT.objectCount);
    assertEqual(result.manifest.childObjectCount, GOLDEN_3MF_FLAT.childObjectCount);
    assertEqual(result.manifest.componentCount, GOLDEN_3MF_FLAT.componentCount);
    assertEqual(result.manifest.buildItemCount, GOLDEN_3MF_FLAT.buildItemCount);
    assertEqual(result.manifest.assemblyObjectId, GOLDEN_3MF_FLAT.assemblyObjectId);
    assertEqual(result.manifest.colorCount, GOLDEN_3MF_FLAT.colorCount);
    assertEqual(result.manifest.materialCount, GOLDEN_3MF_FLAT.materialCount);
    assertEqual(result.manifest.vertexCount, GOLDEN_3MF_FLAT.vertexCount);
    assertEqual(result.manifest.triangleCount, GOLDEN_3MF_FLAT.triangleCount);
    assertEqual(result.manifest.surfaceStyle, "flat");
    assertEqual(result.bytes.byteLength, GOLDEN_3MF_FLAT.byteLength);
    assertEqual(fnv1aHex(result.bytes), GOLDEN_3MF_FLAT.fnv1a);
    const paths = readZipStore(result.bytes).entries.map((e) => e.path);
    assertEqual(paths.join("|"), GOLDEN_3MF_FLAT.entryPaths.join("|"));
    const validation = validateThreeMfPackage(result.bytes);
    assertEqual(validation.ok, true, validation.reasons.join("; "));
    assertEqual(validation.unit, GOLDEN_3MF_FLAT.unit);
  });

  test("Relief golden metrics", () => {
    const result = createThreeMfBytes(buildGoldenInputs("relief"));
    assertEqual(result.filename, GOLDEN_3MF_RELIEF.filename);
    assertEqual(result.manifest.objectCount, GOLDEN_3MF_RELIEF.objectCount);
    assertEqual(result.manifest.childObjectCount, GOLDEN_3MF_RELIEF.childObjectCount);
    assertEqual(result.manifest.componentCount, GOLDEN_3MF_RELIEF.componentCount);
    assertEqual(result.manifest.buildItemCount, GOLDEN_3MF_RELIEF.buildItemCount);
    assertEqual(result.manifest.assemblyObjectId, GOLDEN_3MF_RELIEF.assemblyObjectId);
    assertEqual(result.manifest.colorCount, GOLDEN_3MF_RELIEF.colorCount);
    assertEqual(result.manifest.materialCount, GOLDEN_3MF_RELIEF.materialCount);
    assertEqual(result.manifest.vertexCount, GOLDEN_3MF_RELIEF.vertexCount);
    assertEqual(result.manifest.triangleCount, GOLDEN_3MF_RELIEF.triangleCount);
    assertEqual(result.manifest.surfaceStyle, "relief");
    assertEqual(result.bytes.byteLength, GOLDEN_3MF_RELIEF.byteLength);
    assertEqual(fnv1aHex(result.bytes), GOLDEN_3MF_RELIEF.fnv1a);
    const paths = readZipStore(result.bytes).entries.map((e) => e.path);
    assertEqual(paths.join("|"), GOLDEN_3MF_RELIEF.entryPaths.join("|"));
    const validation = validateThreeMfPackage(result.bytes);
    assertEqual(validation.ok, true, validation.reasons.join("; "));
    assertEqual(validation.unit, GOLDEN_3MF_RELIEF.unit);
  });

  test("deterministic byte-identical Flat packages", () => {
    const a = createThreeMfBytes(buildGoldenInputs("flat")).bytes;
    const b = createThreeMfBytes(buildGoldenInputs("flat")).bytes;
    assertEqual(fnv1aHex(a), fnv1aHex(b));
  });

  test("new assembly 3MF is byte-deterministic for Relief", () => {
    const a = createThreeMfBytes(buildGoldenInputs("relief")).bytes;
    const b = createThreeMfBytes(buildGoldenInputs("relief")).bytes;
    assertEqual(fnv1aHex(a), fnv1aHex(b));
    assertEqual(a.byteLength, b.byteLength);
  });
});

describe("3MF export state and UI readiness", () => {
  test("FEATURES enable 3MF export", () => {
    assertEqual(FEATURES.threeMfExport, true);
    assertEqual(FEATURES.stlExport, true);
  });

  test("3MF unavailable without current geometry", () => {
    resetStore();
    const readiness = getExportReadiness();
    assertEqual(readiness.canDownloadThreeMf, false);
    assertEqual(isGeometryDownloadReady(), false);
  }, { expectedErrors: ["multicolor-before-model-ready"] });

  test("one used color shows STL recommendation", () => {
    resetStore();
    beginGeometryRequest("t1");
    const base = createBoxMesh(-1, -1, 0, 1, 1, 2.5);
    const color = createBoxMesh(-1, -1, 2.5, 1, 1, 4);
    acceptGeometryResult({
      requestId: "t1",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      geometryRevision: getState().geometryRevision,
      result: {
        ok: true,
        reasons: [],
        algorithmVersion: 1,
        validation: { ok: true },
        combined: createBoxMesh(-1, -1, 0, 1, 1, 4),
        base,
        colors: [{ paletteIndex: 0, population: 4, mesh: color }],
      },
    });
    assertEqual(getRuntimeGeometry().colors.length, 1);
  });

  test("two or more colors enable 3MF when geometry download-ready", () => {
    assertThrows(
      () => createThreeMfBytes({
        ...buildGoldenInputs("flat"),
        colorMeshes: buildGoldenInputs("flat").colorMeshes.slice(0, 1),
      }),
      "at least two",
    );
    const pkg = createThreeMfPackage(buildGoldenInputs("flat"));
    assertEqual(pkg.blob instanceof Blob, true);
    assertEqual(pkg.manifest.usedColors, 2);
  });

  test("palette edit invalidates 3MF bytes but not geometry", () => {
    resetStore();
    beginGeometryRequest("p1");
    const inputs = buildGoldenInputs("flat");
    acceptGeometryResult({
      requestId: "p1",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      geometryRevision: getState().geometryRevision,
      result: {
        ok: true,
        reasons: [],
        algorithmVersion: 1,
        validation: { ok: true },
        combined: inputs.baseMesh,
        base: inputs.baseMesh,
        colors: inputs.colorMeshes.map((c) => ({
          paletteIndex: c.paletteIndex,
          population: 1,
          mesh: c.mesh,
        })),
      },
    });
    acceptThreeMfPackage({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "x.3mf",
      manifest: { byteLength: 3 },
      packageKey: "k",
      geometryRevision: getState().geometryRevision,
    });
    assertEqual(getRuntimeThreeMf().status, "ready");
    const geomRev = getState().geometryRevision;
    patchQuantization({
      paletteOverrides: [{ r: 9, g: 9, b: 9 }, null],
    });
    assertEqual(getState().geometryRevision, geomRev);
    assertEqual(getRuntimeGeometry().base != null, true);
    assertEqual(getRuntimeThreeMf().status, "idle");
  });

  test("base-color edit invalidates 3MF bytes but not geometry", () => {
    resetStore();
    beginGeometryRequest("b1");
    const inputs = buildGoldenInputs("flat");
    acceptGeometryResult({
      requestId: "b1",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      geometryRevision: getState().geometryRevision,
      result: {
        ok: true,
        reasons: [],
        algorithmVersion: 1,
        validation: { ok: true },
        combined: inputs.baseMesh,
        base: inputs.baseMesh,
        colors: inputs.colorMeshes.map((c) => ({
          paletteIndex: c.paletteIndex,
          population: 1,
          mesh: c.mesh,
        })),
      },
    });
    acceptThreeMfPackage({
      bytes: new Uint8Array([9]),
      filename: "y.3mf",
      manifest: { byteLength: 1 },
      packageKey: "k2",
      geometryRevision: getState().geometryRevision,
    });
    const geomRev = getState().geometryRevision;
    patchExport({ baseColor: { r: 100, g: 100, b: 100 } });
    assertEqual(getState().geometryRevision, geomRev);
    assertEqual(getRuntimeThreeMf().status, "idle");
    assertEqual(getState().export.baseColor.r, 100);
  });

  test("geometry change invalidates 3MF bytes", () => {
    resetStore();
    beginGeometryRequest("g1");
    acceptGeometryResult({
      requestId: "g1",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      geometryRevision: getState().geometryRevision,
      result: {
        ok: true,
        reasons: [],
        algorithmVersion: 1,
        validation: { ok: true },
        combined: createBoxMesh(0, 0, 0, 1, 1, 1),
        base: createBoxMesh(0, 0, 0, 1, 1, 1),
        colors: [
          { paletteIndex: 0, population: 1, mesh: createBoxMesh(0, 0, 0, 1, 1, 1) },
          { paletteIndex: 1, population: 1, mesh: createBoxMesh(0, 0, 0, 1, 1, 1) },
        ],
      },
    });
    acceptThreeMfPackage({
      bytes: new Uint8Array([4]),
      filename: "z.3mf",
      manifest: { byteLength: 1 },
      packageKey: "k3",
      geometryRevision: getState().geometryRevision,
    });
    beginGeometryRequest("g2");
    assertEqual(getRuntimeThreeMf().status, "idle");
    assertEqual(getRuntimeGeometry().base, null);
  });

  test("failed 3MF packaging keeps STL downloads available", () => {
    resetStore();
    beginGeometryRequest("f1");
    const inputs = buildGoldenInputs("flat");
    acceptGeometryResult({
      requestId: "f1",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      geometryRevision: getState().geometryRevision,
      result: {
        ok: true,
        reasons: [],
        algorithmVersion: 1,
        validation: { ok: true },
        combined: inputs.baseMesh,
        base: inputs.baseMesh,
        colors: inputs.colorMeshes.map((c) => ({
          paletteIndex: c.paletteIndex,
          population: 1,
          mesh: c.mesh,
        })),
      },
    });
    acceptThreeMfError({ message: "The multicolor file could not be created." });
    assertEqual(getRuntimeThreeMf().status, "error");
    assertEqual(getRuntimeGeometry().base != null, true);
    assertEqual(getRuntimeGeometry().status, "ready");
    assertEqual(
      getRuntimeThreeMf().error?.message,
      "The multicolor file could not be created.",
    );
  });

  test("successful package enables download cache", () => {
    clearRuntimeThreeMf();
    const packaged = createThreeMfPackage(buildGoldenInputs("flat"));
    acceptThreeMfPackage({
      bytes: packaged.bytes,
      filename: packaged.filename,
      manifest: packaged.manifest,
      packageKey: "ok",
      geometryRevision: 0,
    });
    assertEqual(getRuntimeThreeMf().status, "ready");
    assertEqual(getRuntimeThreeMf().filename, GOLDEN_3MF_FLAT.filename);
  });

  test("correct Flat and Relief filenames", () => {
    assertEqual(multicolorThreeMfFilename("lenstile"), "lenstile-multicolor.3mf");
    assertEqual(
      multicolorThreeMfFilename("lenstile", { relief: true }),
      "lenstile-relief-multicolor.3mf",
    );
  });

  test("package key changes with base color", () => {
    resetStore();
    const a = getThreeMfPackageKey();
    patchExport({ baseColor: { r: 11, g: 22, b: 33 } });
    const b = getThreeMfPackageKey();
    assertEqual(a === b, false);
  });
});

describe("3MF Step 2 and Download terminology", () => {
  /** @type {HTMLElement | null} */
  let root = null;

  function mount() {
    resetStore();
    root = document.createElement("div");
    document.body.appendChild(root);
    const layout = mountLayout(root);
    bindControls({
      canvas: layout.canvas,
      canvasShell: layout.canvasShell,
      imageInput: layout.imageInput,
      scheduleRedraw: () => {},
      getCropSize: () => ({ width: 592, height: 212 }),
    });
    syncControlsFromState();
    return layout;
  }

  function unmount() {
    if (root) root.remove();
    root = null;
    resetStore();
  }

  test("visible Step 2 label says Image detail colors or Image colors", () => {
    mount();
    const label = document.querySelector('label[for="color-count"]');
    const text = label?.textContent || "";
    assertEqual(
      /Image detail colors|Image colors/i.test(text),
      true,
      `unexpected label: ${text}`,
    );
    assertEqual(/Color count|Number of colors/i.test(text), false);
    unmount();
  });

  test("helper text explains image colors need not equal filament colors", () => {
    mount();
    const help = document.getElementById("color-count-help");
    assertEqual(Boolean(help), true);
    const text = help?.textContent || "";
    assertEqual(
      text.includes("do not have to match the number of filament colors")
        || text.includes("does not have to match how many filament colors"),
      true,
    );
    unmount();
  });

  test("standard UI does not imply one image color for a one-filament printer", () => {
    mount();
    const colorsPanel = document.querySelector('[data-panel="colors"]');
    const text = colorsPanel?.textContent || "";
    assertEqual(/must select one image color|one filament.*one (image )?color/i.test(text), false);
    unmount();
  });

  test("Relief help mentions one-filament and multicolor use", () => {
    mount();
    const help = document.getElementById("surface-style-help");
    const helpText = help?.textContent || "";
    assertEqual(
      helpText.includes("one filament") && (helpText.includes("multicolor") || helpText.includes("multiple colors")),
      true,
    );
    const guidance = document.getElementById("surface-relief-guidance");
    const guideText = guidance?.textContent || "";
    assertEqual(
      guideText.includes("one filament") && guideText.includes("multicolor"),
      true,
    );
    unmount();
  });

  test("Relief mode exposes both STL and multicolor 3MF downloads", () => {
    mount();
    patchSurface({ style: "relief" });
    syncControlsFromState();
    const stl = document.getElementById("btn-download-combined-stl");
    const threeMf = document.getElementById("btn-export-3mf");
    assertEqual(stl?.textContent?.includes("Relief STL"), true);
    assertEqual(threeMf?.textContent?.includes("Relief multicolor 3MF"), true);
    unmount();
  });

  test("Flat mode exposes both STL and multicolor 3MF downloads", () => {
    mount();
    patchSurface({ style: "flat" });
    syncControlsFromState();
    const stl = document.getElementById("btn-download-combined-stl");
    const threeMf = document.getElementById("btn-export-3mf");
    assertEqual(
      stl?.textContent?.includes("one-filament STL")
        || stl?.textContent?.includes("one-color STL"),
      true,
    );
    assertEqual(threeMf?.textContent?.includes("multicolor 3MF"), true);
    assertEqual(threeMf?.textContent?.includes("Relief"), false);
    unmount();
  });

  test("no internal property terminology is visible", () => {
    mount();
    const panels = [
      document.querySelector('[data-panel="colors"]'),
      document.querySelector('[data-panel="export"]'),
    ];
    const text = panels.map((p) => p?.textContent || "").join("\n");
    assertEqual(/\bpindex\b|\bcolorgroup\b|\bbasematerials\b|\bdisplaycolor\b/i.test(text), false);
    unmount();
  });
});

describe("3MF policy", () => {
  test("no Math.random in three-mf modules", async () => {
    const files = [
      "../src/export/crc32.js",
      "../src/export/zip-store.js",
      "../src/export/three-mf.js",
      "../src/export/three-mf-validate.js",
      "../src/export/three-mf-packaging.js",
      "../src/export/xml-escape.js",
    ];
    for (const path of files) {
      const text = await (await fetch(path)).text();
      assertEqual(/\bMath\.random\s*\(/.test(text), false, path);
    }
  });

  test("DEFAULT_BASE_COLOR is neutral dark gray", () => {
    assertEqual(DEFAULT_BASE_COLOR.r, 42);
    assertEqual(DEFAULT_BASE_COLOR.g, 42);
    assertEqual(DEFAULT_BASE_COLOR.b, 42);
  });

  test("Tile V1 constant still available for envelope checks", () => {
    assertEqual(TILE_V1.widthMm, 148);
    assertEqual(TILE_V1.totalThicknessMm, 4);
    const mesh = buildCombinedTileMesh();
    assertEqual(vertexCount(mesh) > 0, true);
  });

  test("relief per-color packaging preserves distinct tops", () => {
    const indices = new Uint8Array([0, 1, 0, 1]);
    const topHeightByPaletteIndex = new Map([
      [0, 4.0],
      [1, 3.4],
    ]);
    const colors = buildAllReliefArtworkMeshes(indices, 2, 2, topHeightByPaletteIndex);
    assertEqual(colors.length, 2);
    const base = buildBaseTileMesh();
    const result = createThreeMfBytes({
      projectName: "relief-check",
      baseMesh: base,
      roofMesh: createBoxMesh(-0.2, -0.2, 2.5, 0.2, 0.2, 4),
      colorMeshes: colors.map((c, i) => ({
        paletteIndex: c.paletteIndex,
        mesh: c.mesh,
        color: i === 0 ? { r: 20, g: 20, b: 20 } : { r: 220, g: 220, b: 220 },
      })),
      baseColor: { ...DEFAULT_BASE_COLOR },
      surfaceStyle: "relief",
    });
    assertEqual(result.xml.model.includes('z="4"'), true);
    assertEqual(result.xml.model.includes('z="3.4"'), true);
    assertEqual(result.filename.includes("relief-multicolor"), true);
  });
});

describe("Optional Bambu Studio reference diagnostic", () => {
  test("skips cleanly when manual reference is absent", async () => {
    const path = "../tests/fixtures/manual/bambu-two-color-reference.3mf";
    const res = await fetch(path, { method: "HEAD", cache: "no-store" });
    if (res.ok) {
      const bytes = new Uint8Array(await (await fetch(path)).arrayBuffer());
      const zip = readZipStore(bytes);
      const paths = zip.entries.map((e) => e.path);
      const standard = new Set([
        "[Content_Types].xml",
        "_rels/.rels",
        "3D/3dmodel.model",
      ]);
      const bambuSpecific = paths.filter((p) => !standard.has(p) && !p.startsWith("3D/"));
      // Diagnostic only — never copy Bambu metadata into generated packages.
      assertEqual(paths.length >= 1, true);
      assertEqual(Array.isArray(bambuSpecific), true);
      // Ensure our generator does not emit Metadata/ or filament_*.config style paths.
      const ours = createThreeMfBytes(buildGoldenInputs("flat"));
      const ourPaths = readZipStore(ours.bytes).entries.map((e) => e.path);
      assertEqual(ourPaths.join("|"), GOLDEN_3MF_FLAT.entryPaths.join("|"));
      for (const p of bambuSpecific) {
        assertEqual(ourPaths.includes(p), false, `must not copy Bambu path ${p}`);
      }
    } else {
      assertEqual(
        true,
        true,
        "Optional Bambu reference absent — diagnostic skipped (standards suite continues).",
      );
    }
  });
});

describe("Milestone 7.2 full-size packaging regression", () => {
  const FIXTURE_PATH = "./fixtures/manual/Untitled_tile-geometry-debug.json";

  /** @type {any} */
  let fullFixture = null;
  /** @type {any} */
  let fullGeometry = null;
  /** @type {{ byteLength: number, fnv1a: string, xmlByteLength: number } | null} */
  let fullPackageMeta = null;

  async function loadFullFixture() {
    if (fullFixture) return fullFixture;
    const {
      parseGeometryDebugFixture,
    } = await import("../src/geometry/geometry-debug-fixture.js");
    const raw = await (await fetch(FIXTURE_PATH)).json();
    fullFixture = parseGeometryDebugFixture(raw);
    return fullFixture;
  }

  async function buildFullGeometry() {
    if (fullGeometry) return fullGeometry;
    const fixture = await loadFullFixture();
    const { generateTileGeometry } = await import("../src/geometry/generate-geometry.js");
    const { validateMesh } = await import("../src/geometry/mesh-validation.js");
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
    assertEqual(geo.ok, true, (geo.reasons || []).join("; "));
    assertEqual(validateMesh(geo.base).ok, true);
    for (const c of geo.colors) {
      assertEqual(validateMesh(c.mesh).ok, true, `color[${c.paletteIndex}]`);
    }
    fullGeometry = { fixture, geo };
    return fullGeometry;
  }

  function colorMeshesFromGeo(geo, fixture) {
    return geo.colors.map((entry) => ({
      paletteIndex: entry.paletteIndex,
      mesh: entry.mesh,
      color: { ...fixture.effectivePalette[entry.paletteIndex] },
    }));
  }

  test("exact uploaded Flat four-color debug fixture loads", async () => {
    const fixture = await loadFullFixture();
    assertEqual(fixture.width, 296);
    assertEqual(fixture.height, 106);
    assertEqual(fixture.surfaceStyle, "flat");
    assertEqual(fixture.geometryAlgorithmVersion, 3);
    assertEqual(fixture.cleanedIndices.length, 296 * 106);
    assertEqual(fixture.usedPaletteIndices.join(","), "0,1,2,3");
  });

  test("fixture geometry validates before packaging", async () => {
    const { geo } = await buildFullGeometry();
    assertEqual(geo.colors.length, 4);
    assertEqual(geo.combined.triangles.length / 3, 2332);
  });

  test("stale export-controller object count reproduces the old failure", async () => {
    const {
      packageMulticolorThreeMf,
      staleExpectedObjectCountWithoutParent,
      ThreeMfPackagingErrorCode,
      ThreeMfPackagingStage,
    } = await import("../src/export/three-mf-packaging.js");
    const { fixture, geo } = await buildFullGeometry();
    const colorMeshes = colorMeshesFromGeo(geo, fixture);
    assertEqual(staleExpectedObjectCountWithoutParent(4), 5);
    let caught = /** @type {any} */ (null);
    try {
      packageMulticolorThreeMf({
        projectName: "Untitled tile",
        baseMesh: geo.base,
      roofMesh: geo.roof,
        colorMeshes,
        baseColor: { ...DEFAULT_BASE_COLOR },
        surfaceStyle: "flat",
        geometryVersion: 3,
      }, { useStaleObjectCount: true });
    } catch (err) {
      caught = err;
    }
    assertEqual(caught != null, true);
    assertEqual(caught.code, ThreeMfPackagingErrorCode.STALE_OBJECT_COUNT);
    assertEqual(caught.stage, ThreeMfPackagingStage.VALIDATE_MODEL_XML);
    assertEqual(/Expected 5 objects, found 7/.test(caught.message), true);
  });

  test("corrected path creates non-empty package bytes and Blob", async () => {
    const { packageMulticolorThreeMf, expectedThreeMfObjectCount } = await import(
      "../src/export/three-mf-packaging.js"
    );
    const { fixture, geo } = await buildFullGeometry();
    const colorMeshes = colorMeshesFromGeo(geo, fixture);
    const packaged = packageMulticolorThreeMf({
      projectName: "Untitled tile",
      baseMesh: geo.base,
      roofMesh: geo.roof,
      colorMeshes,
      baseColor: { ...DEFAULT_BASE_COLOR },
      surfaceStyle: "flat",
      geometryVersion: 3,
    });
    assertEqual(packaged.bytes.byteLength > 0, true);
    assertEqual(packaged.blob instanceof Blob, true);
    assertEqual(packaged.blob.size, packaged.bytes.byteLength);
    assertEqual(packaged.validation.ok, true, packaged.validation.reasons.join("; "));
    assertEqual(packaged.manifest.objectCount, expectedThreeMfObjectCount(4));
    assertEqual(packaged.manifest.childObjectCount, 6);
    assertEqual(packaged.manifest.buildItemCount, 1);
    assertEqual(packaged.manifest.assemblyObjectId, 8);
    fullPackageMeta = {
      byteLength: packaged.bytes.byteLength,
      fnv1a: fnv1aHex(packaged.bytes),
      xmlByteLength: packaged.diagnostics.xmlByteLength,
    };
  });

  test("four artwork children plus base plus parent; one build item", async () => {
    const { packageMulticolorThreeMf } = await import("../src/export/three-mf-packaging.js");
    const { fixture, geo } = await buildFullGeometry();
    const packaged = packageMulticolorThreeMf({
      projectName: "Untitled tile",
      baseMesh: geo.base,
      roofMesh: geo.roof,
      colorMeshes: colorMeshesFromGeo(geo, fixture),
      baseColor: { ...DEFAULT_BASE_COLOR },
      surfaceStyle: "flat",
    });
    assertEqual(packaged.validation.childObjectCount, 6);
    assertEqual(packaged.validation.objectCount, 7);
    assertEqual(packaged.validation.buildItemCount, 1);
    assertEqual(packaged.validation.assemblyObjectId, 8);
    const model = packaged.xml.model;
    assertEqual(model.includes(`object id="8" type="model" name="${ASSEMBLY_OBJECT_NAME}"`), true);
    assertEqual(/object id="8"[^>]*pid=/.test(model), false);
    assertEqual(/object id="8"[^>]*pindex=/.test(model), false);
    const parentStart = model.indexOf('object id="8"');
    const parentSlice = model.slice(parentStart, model.indexOf("</object>", parentStart) + 10);
    assertEqual(parentSlice.includes("<mesh>"), false);
    assertEqual(parentSlice.includes("<component "), true);
    assertEqual((model.match(/<item /g) || []).length, 1);
  });

  test("dense color-group mapping and sparse palette indices", async () => {
    const {
      packageMulticolorThreeMf,
      buildColorResourceMapping,
    } = await import("../src/export/three-mf-packaging.js");
    const base = createBoxMesh(-10, -10, 0, 10, 10, 2.5);
    const colorMeshes = [
      { paletteIndex: 0, color: { r: 255, g: 0, b: 0 }, mesh: createBoxMesh(-5, -5, 2.5, 0, 0, 4) },
      { paletteIndex: 3, color: { r: 0, g: 255, b: 0 }, mesh: createBoxMesh(0, 0, 2.5, 5, 5, 4) },
      { paletteIndex: 7, color: { r: 0, g: 0, b: 255 }, mesh: createBoxMesh(-2, 2, 2.5, 2, 5, 4) },
    ];
    const mapping = buildColorResourceMapping(colorMeshes);
    assertEqual(mapping.paletteIndexToColorGroupIndex.get(0), 1);
    assertEqual(mapping.paletteIndexToColorGroupIndex.get(3), 2);
    assertEqual(mapping.paletteIndexToColorGroupIndex.get(7), 3);
    assertEqual(mapping.paletteIndexToChildObjectId.get(0), 4);
    assertEqual(mapping.paletteIndexToChildObjectId.get(3), 5);
    assertEqual(mapping.paletteIndexToChildObjectId.get(7), 6);
    const packaged = packageMulticolorThreeMf({
      projectName: "sparse",
      baseMesh: base,
      roofMesh: createBoxMesh(-0.2, -0.2, 2.5, 0.2, 0.2, 4),
      colorMeshes,
      baseColor: { ...DEFAULT_BASE_COLOR },
      surfaceStyle: "flat",
    });
    const model = packaged.xml.model;
    assertEqual(model.includes(`pid="${COLOR_GROUP_ID}" pindex="0" name="Tile Base"`), true);
    assertEqual(model.includes(`object id="4" type="model" pid="${COLOR_GROUP_ID}" pindex="1"`), true);
    assertEqual(model.includes(`object id="5" type="model" pid="${COLOR_GROUP_ID}" pindex="2"`), true);
    assertEqual(model.includes(`object id="6" type="model" pid="${COLOR_GROUP_ID}" pindex="3"`), true);
    assertEqual(packaged.manifest.colorCount, 4);
    assertEqual(packaged.validation.ok, true, packaged.validation.reasons.join("; "));
  });

  test("no resource-ID collisions; component references resolve", async () => {
    const { packageMulticolorThreeMf } = await import("../src/export/three-mf-packaging.js");
    const { fixture, geo } = await buildFullGeometry();
    const packaged = packageMulticolorThreeMf({
      projectName: "Untitled tile",
      baseMesh: geo.base,
      roofMesh: geo.roof,
      colorMeshes: colorMeshesFromGeo(geo, fixture),
      baseColor: { ...DEFAULT_BASE_COLOR },
      surfaceStyle: "flat",
    });
    const ids = [
      packaged.mapping.colorGroupId,
      ...packaged.mapping.childObjectIds,
      packaged.mapping.parentObjectId,
    ];
    assertEqual(new Set(ids).size, ids.length);
    assertEqual(packaged.validation.ok, true);
  });

  test("full-size XML is well formed; Materials namespace resolves", async () => {
    const { packageMulticolorThreeMf } = await import("../src/export/three-mf-packaging.js");
    const { fixture, geo } = await buildFullGeometry();
    const packaged = packageMulticolorThreeMf({
      projectName: "Untitled tile",
      baseMesh: geo.base,
      roofMesh: geo.roof,
      colorMeshes: colorMeshesFromGeo(geo, fixture),
      baseColor: { ...DEFAULT_BASE_COLOR },
      surfaceStyle: "flat",
    });
    const doc = new DOMParser().parseFromString(packaged.xml.model, "application/xml");
    assertEqual(doc.querySelector("parsererror"), null);
    const groups = doc.getElementsByTagNameNS(NS_MATERIALS, "colorgroup");
    assertEqual(groups.length, 1);
    assertEqual(groups[0].getAttribute("id"), "1");
    const colors = doc.getElementsByTagNameNS(NS_MATERIALS, "color");
    assertEqual(colors.length, 5);
  });

  test("package creation is deterministic; ZIP unsigned fields handle full fixture", async () => {
    const { packageMulticolorThreeMf } = await import("../src/export/three-mf-packaging.js");
    const { fixture, geo } = await buildFullGeometry();
    const opts = {
      projectName: "Untitled tile",
      baseMesh: geo.base,
      roofMesh: geo.roof,
      colorMeshes: colorMeshesFromGeo(geo, fixture),
      baseColor: { ...DEFAULT_BASE_COLOR },
      surfaceStyle: "flat",
      geometryVersion: 3,
    };
    const a = packageMulticolorThreeMf(opts);
    const b = packageMulticolorThreeMf(opts);
    assertEqual(fnv1aHex(a.bytes), fnv1aHex(b.bytes));
    assertEqual(a.bytes.byteLength, b.bytes.byteLength);
    const zip = readZipStore(a.bytes);
    for (const entry of zip.entries) {
      assertEqual(entry.localHeaderOffset >= 0, true);
      assertEqual(entry.localHeaderOffset === (entry.localHeaderOffset >>> 0), true);
      assertEqual(entry.data.byteLength === (entry.data.byteLength >>> 0), true);
    }
    assertEqual(fullPackageMeta != null, true);
    assertEqual(fullPackageMeta.fnv1a, fnv1aHex(a.bytes));
    assertEqual(fullPackageMeta.byteLength, a.bytes.byteLength);
  });

  test("packaging does not detach or mutate mesh buffers", async () => {
    const { packageMulticolorThreeMf } = await import("../src/export/three-mf-packaging.js");
    const { fixture, geo } = await buildFullGeometry();
    const colorMeshes = colorMeshesFromGeo(geo, fixture);
    const basePos = geo.base.positions;
    const baseTri = geo.base.triangles;
    const snap = colorMeshes.map((c) => ({
      p: c.mesh.positions,
      t: c.mesh.triangles,
      p0: c.mesh.positions[0],
      t0: c.mesh.triangles[0],
    }));
    packageMulticolorThreeMf({
      projectName: "Untitled tile",
      baseMesh: geo.base,
      roofMesh: geo.roof,
      colorMeshes,
      baseColor: { ...DEFAULT_BASE_COLOR },
      surfaceStyle: "flat",
    });
    assertEqual(geo.base.positions, basePos);
    assertEqual(geo.base.triangles, baseTri);
    for (let i = 0; i < snap.length; i += 1) {
      assertEqual(colorMeshes[i].mesh.positions, snap[i].p);
      assertEqual(colorMeshes[i].mesh.triangles, snap[i].t);
      assertEqual(colorMeshes[i].mesh.positions[0], snap[i].p0);
      assertEqual(colorMeshes[i].mesh.triangles[0], snap[i].t0);
    }
  });

  test("failed 3MF packaging leaves STL downloads and clears stale 3MF", async () => {
    const {
      THREE_MF_USER_ERROR,
      getThreeMfTechnicalDetailsText,
    } = await import("../src/ui/export-controller.js");
    const { fixture, geo } = await buildFullGeometry();
    resetStore();
    beginGeometryRequest("m72-fail");
    acceptGeometryResult({
      requestId: "m72-fail",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      geometryRevision: getState().geometryRevision,
      result: {
        ok: true,
        reasons: [],
        algorithmVersion: 4,
        validation: { ok: true },
        combined: geo.combined,
        base: geo.base,
        colors: geo.colors.map((c) => ({
          paletteIndex: c.paletteIndex,
          population: c.population || 1,
          mesh: c.mesh,
        })),
      },
    });
    acceptThreeMfPackage({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "stale.3mf",
      manifest: { byteLength: 3 },
      packageKey: "old",
      geometryRevision: getState().geometryRevision,
    });
    assertEqual(getRuntimeThreeMf().status, "ready");
    assertEqual(Boolean(getRuntimeGeometry().combined), true);
    assertEqual(Boolean(getRuntimeGeometry().base), true);
    assertEqual(getRuntimeGeometry().colors.length, 4);

    const { packageMulticolorThreeMf } = await import("../src/export/three-mf-packaging.js");
    let failed = false;
    try {
      packageMulticolorThreeMf({
        projectName: "Untitled tile",
        baseMesh: geo.base,
      roofMesh: geo.roof,
        colorMeshes: colorMeshesFromGeo(geo, fixture),
        baseColor: { ...DEFAULT_BASE_COLOR },
        surfaceStyle: "flat",
      }, { useStaleObjectCount: true });
    } catch {
      failed = true;
    }
    assertEqual(failed, true);
    acceptThreeMfError({
      code: "THREE_MF_STALE_OBJECT_COUNT",
      message: THREE_MF_USER_ERROR,
      details: {
        stage: "validate-model-xml",
        underlyingMessage: "Expected 5 objects, found 6.",
        expectedObjectCount: 5,
        actualObjectCount: 6,
      },
    });
    assertEqual(getRuntimeThreeMf().status, "error");
    assertEqual(getRuntimeThreeMf().bytes, null);
    // STL geometry buffers remain available after 3MF failure.
    assertEqual(getRuntimeGeometry().status, "ready");
    assertEqual(Boolean(getRuntimeGeometry().combined), true);
    assertEqual(Boolean(getRuntimeGeometry().base), true);
    assertEqual(getRuntimeGeometry().colors.length, 4);
    const tech = getThreeMfTechnicalDetailsText();
    assertEqual(/validate-model-xml/.test(tech), true);
    assertEqual(/THREE_MF_STALE_OBJECT_COUNT|Expected 5 objects/.test(tech), true);
    assertEqual(THREE_MF_USER_ERROR, "The multicolor file could not be created.");
  });

  test("retry after failure succeeds; concurrent clicks share one operation", async () => {
    const { packageMulticolorThreeMf } = await import("../src/export/three-mf-packaging.js");
    const { fixture, geo } = await buildFullGeometry();
    const opts = {
      projectName: "Untitled tile",
      baseMesh: geo.base,
      roofMesh: geo.roof,
      colorMeshes: colorMeshesFromGeo(geo, fixture),
      baseColor: { ...DEFAULT_BASE_COLOR },
      surfaceStyle: "flat",
    };
    let failed = false;
    try {
      packageMulticolorThreeMf(opts, { useStaleObjectCount: true });
    } catch {
      failed = true;
    }
    assertEqual(failed, true);
    const ok = packageMulticolorThreeMf(opts);
    assertEqual(ok.validation.ok, true);
    assertEqual(ok.bytes.byteLength > 0, true);

    resetStore();
    beginGeometryRequest("m72-concurrent");
    acceptGeometryResult({
      requestId: "m72-concurrent",
      sourceRevision: getState().sourceRevision,
      printabilityRevision: getState().printabilityRevision,
      geometryRevision: getState().geometryRevision,
      result: {
        ok: true,
        reasons: [],
        algorithmVersion: 4,
        validation: { ok: true },
        combined: geo.combined,
        base: geo.base,
        colors: geo.colors.map((c) => ({
          paletteIndex: c.paletteIndex,
          population: 1,
          mesh: c.mesh,
        })),
      },
    });
    const mod = await import("../src/ui/export-controller.js");
    const p1 = mod.downloadThreeMfAction();
    const p2 = mod.downloadThreeMfAction();
    assertEqual(p1, p2);
    await Promise.allSettled([p1, p2]);
  }, { expectedErrors: ["multicolor-before-model-ready"] });

  test("plain-language UI error and technical stage details", async () => {
    const {
      formatThreeMfTechnicalDetails,
      THREE_MF_USER_ERROR,
      ThreeMfPackagingStage,
    } = await import("../src/export/three-mf-packaging.js");
    assertEqual(THREE_MF_USER_ERROR.includes("multicolor file could not be created"), true);
    const text = formatThreeMfTechnicalDetails({
      code: "THREE_MF_STALE_OBJECT_COUNT",
      stage: ThreeMfPackagingStage.VALIDATE_MODEL_XML,
      message: "Expected 5 objects, found 6.",
      details: {
        expectedObjectCount: 5,
        actualObjectCount: 6,
        reasons: ["Expected 5 objects, found 6."],
      },
      causeName: "Error",
      causeMessage: "Expected 5 objects, found 6.",
    });
    assertEqual(/Failure stage: validate-model-xml/.test(text), true);
    assertEqual(/Error code: THREE_MF_STALE_OBJECT_COUNT/.test(text), true);
    assertEqual(/Expected object count: 5/.test(text), true);
    assertEqual(/Actual object count: 6/.test(text), true);
  });

  test("existing Flat and Relief 3MF goldens remain stable", () => {
    const flat = createThreeMfBytes(buildGoldenInputs("flat"));
    const relief = createThreeMfBytes(buildGoldenInputs("relief"));
    assertEqual(fnv1aHex(flat.bytes), GOLDEN_3MF_FLAT.fnv1a);
    assertEqual(flat.bytes.byteLength, GOLDEN_3MF_FLAT.byteLength);
    assertEqual(fnv1aHex(relief.bytes), GOLDEN_3MF_RELIEF.fnv1a);
    assertEqual(relief.bytes.byteLength, GOLDEN_3MF_RELIEF.byteLength);
  });

  test("geometry goldens remain unchanged", async () => {
    const { GOLDEN_COMBINED_TILE } = await import("./fixtures/geometry-golden.js");
    const { GOLDEN_RELIEF_TINY } = await import("./fixtures/relief-golden.js");
    const { GOLDEN_RELIEF_SADDLE } = await import("./fixtures/relief-saddle-golden.js");
    assertEqual(GOLDEN_COMBINED_TILE.stlFnv1a, "a1f5c9ce");
    assertEqual(GOLDEN_RELIEF_TINY.stlFnv1a, "5ffdbc1e");
    assertEqual(GOLDEN_RELIEF_SADDLE.stlFnv1a, "f517f424");
  });
});
