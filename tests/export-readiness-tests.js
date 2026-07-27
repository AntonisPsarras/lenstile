/**
 * Export readiness, geometry stale behaviour, and serialization exclusions.
 */

import {
  describe,
  test,
  assertEqual,
  assertDeepEqual,
} from "./test-utils.js";
import {
  resetStore,
  getState,
  patchTransform,
  patchQuantization,
  isPrintabilityExportReady,
  isGeometryDownloadReady,
  getExportReadinessGaps,
  beginGeometryRequest,
  acceptGeometryResult,
  toSerializableProject,
  runtimeOnlyKeys,
  getRuntimeGeometry,
} from "../src/state.js";
import { FEATURES } from "../src/config.js";
import { createBoxMesh } from "../src/geometry/primitives.js";
import {
  combinedStlFilename,
  colorStlFilename,
} from "../src/export/stl-filenames.js";

describe("export readiness and state", () => {
  test("FEATURES enable STL and 3MF export", () => {
    assertEqual(FEATURES.stlExport, true);
    assertEqual(FEATURES.alignedStlExport, true);
    assertEqual(FEATURES.threeMfExport, true);
  });

  test("no accepted cleanup blocks generation", () => {
    resetStore();
    assertEqual(isPrintabilityExportReady(), false);
    const gaps = getExportReadinessGaps();
    assertEqual(gaps.includes("Add an image first.") || gaps.includes("Create a color preview first."), true);
  });

  test("runtimeOnlyKeys exclude mesh buffers", () => {
    const keys = runtimeOnlyKeys();
    assertEqual(keys.includes("combined"), true);
    assertEqual(keys.includes("cleanedIndices"), true);
    assertEqual(keys.includes("positions"), true);
  });

  test("project serialization excludes mesh buffers and marks generated false", () => {
    resetStore();
    const snap = toSerializableProject();
    assertEqual(Object.prototype.hasOwnProperty.call(snap, "combined"), false);
    assertEqual(snap.export.generated, false);
    assertEqual(typeof snap.geometryRevision, "number");
  });

  test("palette RGB override updates filenames without geometry topology change", () => {
    assertEqual(
      colorStlFilename("lenstile", 1, { r: 26, g: 43, b: 60 }),
      "lenstile-color-01-1A2B3C.stl",
    );
    assertEqual(
      colorStlFilename("lenstile", 1, { r: 255, g: 0, b: 0 }),
      "lenstile-color-01-FF0000.stl",
    );
    assertEqual(combinedStlFilename("lenstile"), "lenstile-smooth.stl");
    assertEqual(combinedStlFilename("lenstile", { relief: true }), "lenstile-relief.stl");
  });

  test("geometry download requires validated ready mesh", () => {
    resetStore();
    assertEqual(isGeometryDownloadReady(), false);
  });

  test("acceptGeometryResult stores runtime-only meshes", () => {
    resetStore();
    beginGeometryRequest("m-1");
    const box = createBoxMesh(0, 0, 0, 1, 1, 1);
    const s = getState();
    const ok = acceptGeometryResult({
      requestId: "m-1",
      sourceRevision: s.sourceRevision,
      printabilityRevision: s.printabilityRevision,
      geometryRevision: s.geometryRevision,
      result: {
        ok: true,
        reasons: [],
        algorithmVersion: 1,
        validation: { ok: true },
        combined: box,
        base: box,
        colors: [{ paletteIndex: 0, population: 1, mesh: box }],
      },
    });
    assertEqual(ok, true);
    assertEqual(getRuntimeGeometry().status, "ready");
    assertEqual(getRuntimeGeometry().combined != null, true);
    assertEqual(getState().export.generated, true);
    const snap = toSerializableProject();
    // Meshes are runtime-only; snapshots never claim downloadable geometry is persisted.
    assertEqual(snap.export.generated, false);
    assertEqual("combined" in snap, false);
  });

  test("geometry becomes stale after crop change", () => {
    resetStore();
    beginGeometryRequest("m-2");
    const box = createBoxMesh(0, 0, 0, 1, 1, 1);
    const s0 = getState();
    acceptGeometryResult({
      requestId: "m-2",
      sourceRevision: s0.sourceRevision,
      printabilityRevision: s0.printabilityRevision,
      geometryRevision: s0.geometryRevision,
      result: {
        ok: true,
        reasons: [],
        algorithmVersion: 1,
        validation: { ok: true },
        combined: box,
        base: box,
        colors: [],
      },
    });
    assertEqual(getRuntimeGeometry().status, "ready");
    patchTransform({ offsetX: 12 });
    assertEqual(getRuntimeGeometry().combined, null);
    assertEqual(isGeometryDownloadReady(), false);
  });

  test("palette override does not bump geometry revision", () => {
    resetStore();
    const before = getState().geometryRevision;
    patchQuantization({
      paletteOverrides: [{ r: 1, g: 2, b: 3 }],
    });
    assertEqual(getState().geometryRevision, before);
  });

  test("stale worker result ignored when revisions mismatch", () => {
    resetStore();
    beginGeometryRequest("m-3");
    const box = createBoxMesh(0, 0, 0, 1, 1, 1);
    const accepted = acceptGeometryResult({
      requestId: "m-3",
      sourceRevision: getState().sourceRevision + 1,
      printabilityRevision: getState().printabilityRevision,
      geometryRevision: getState().geometryRevision,
      result: {
        ok: true,
        reasons: [],
        algorithmVersion: 1,
        validation: { ok: true },
        combined: box,
        base: box,
        colors: [],
      },
    });
    assertEqual(accepted, false);
  });
});
