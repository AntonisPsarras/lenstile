import {
  describe,
  test,
  assertEqual,
  assertDeepEqual,
} from "./test-utils.js";
import {
  configureBaselineMetrics,
  resetBaselineMetrics,
  recordBaselineStage,
  recordBaselineWorkflow,
  createExactByteRecord,
  createLogicalEstimateRecord,
  createSummaryRecord,
  exactByteLength,
  getBaselineDiagnostics,
} from "../src/diagnostics/baseline-metrics.js";
import {
  MAX_STAGE_RECORDS,
  MAX_WORKFLOW_RECORDS,
} from "../src/diagnostics/diagnostics-schema.js";
import {
  BASELINE_FIXTURE_PROVENANCE,
  createProceduralBaselineRgba,
} from "./fixtures/procedural-baseline-fixture.js";
import { quantizeImage } from "../src/image/quantize.js";

describe("privacy-safe baseline diagnostics", () => {
  test("collector retention is bounded", () => {
    resetBaselineMetrics();
    configureBaselineMetrics({ enabled: true, now: () => 1 });
    for (let i = 0; i < MAX_WORKFLOW_RECORDS + 9; i += 1) {
      recordBaselineWorkflow({ caseId: `case-${i}`, colorCount: i });
    }
    for (let i = 0; i < MAX_STAGE_RECORDS + 11; i += 1) {
      recordBaselineStage({ caseId: `case-${i}`, stageId: "stage", durationMs: i });
    }
    const report = getBaselineDiagnostics();
    assertEqual(report.workflows.length, MAX_WORKFLOW_RECORDS);
    assertEqual(report.stages.length, MAX_STAGE_RECORDS);
    configureBaselineMetrics({ enabled: false });
  });

  test("unknown and prohibited fields are dropped", () => {
    resetBaselineMetrics();
    configureBaselineMetrics({ enabled: true });
    recordBaselineWorkflow({
      caseId: "nozzle04-4c-flat-stl",
      profileId: "nozzle04",
      colorCount: 4,
      filename: "private.png",
      designName: "private",
      palette: [{ r: 1, g: 2, b: 3 }],
      sourcePixels: [1, 2, 3],
      coordinates: [4, 5, 6],
      userAgent: "complete user agent",
      metadata: { arbitrary: true },
    });
    const text = JSON.stringify(getBaselineDiagnostics());
    for (const prohibited of [
      "filename", "designName", "palette", "sourcePixels",
      "coordinates", "userAgent", "metadata", "private",
    ]) {
      assertEqual(text.includes(prohibited), false);
    }
    configureBaselineMetrics({ enabled: false });
  });

  test("exact bytes accept only known exact byte keys", () => {
    const bytes = new Uint8Array(17);
    const blob = new Blob([new Uint8Array(23)]);
    assertEqual(exactByteLength(bytes), 17);
    assertEqual(exactByteLength(blob), 23);
    assertDeepEqual(
      createExactByteRecord({ rasterRgba: bytes.byteLength, finalFile: blob.size, heapPeak: 999 }),
      { rasterRgba: 17, finalFile: 23 },
    );
  });

  test("logical estimates remain separate and labeled", () => {
    assertDeepEqual(
      createLogicalEstimateRecord({ xmlUtf16LogicalPayload: 42, measuredPeak: 99 }),
      { xmlUtf16LogicalPayload: 42 },
    );
  });

  test("summary rejects arbitrary metadata", () => {
    assertDeepEqual(
      createSummaryRecord({ caseCount: 16, longTaskObservationSupported: true, note: "private" }),
      { caseCount: 16, longTaskObservationSupported: true },
    );
  });

  test("procedural fixture is deterministic and has redistribution provenance", () => {
    const a = createProceduralBaselineRgba(64, 24);
    const b = createProceduralBaselineRgba(64, 24);
    assertEqual(BASELINE_FIXTURE_PROVENANCE, "project-authored-mit-procedural-v1");
    assertDeepEqual(Array.from(a), Array.from(b));
  });

  test("injected timing cannot change quantization output", () => {
    const rgba = createProceduralBaselineRgba(32, 16);
    let tick = 0;
    const a = quantizeImage(rgba, {
      width: 32, height: 16, colorCount: 4, now: () => ++tick,
    });
    const b = quantizeImage(rgba, {
      width: 32, height: 16, colorCount: 4, now: () => 1000000 - tick++,
    });
    assertDeepEqual(a.generatedPalette, b.generatedPalette);
    assertDeepEqual(Array.from(a.indices), Array.from(b.indices));
  });

  test("disabled collector retains no records", () => {
    resetBaselineMetrics();
    configureBaselineMetrics({ enabled: false });
    assertEqual(recordBaselineWorkflow({ caseId: "case-1" }), false);
    assertEqual(recordBaselineStage({ caseId: "case-1", stageId: "stage" }), false);
    const report = getBaselineDiagnostics();
    assertEqual(report.workflows.length, 0);
    assertEqual(report.stages.length, 0);
  });

  test("baseline page is explicit and installs the in-memory adapter", async () => {
    const [html, js] = await Promise.all([
      fetch("./baseline-runner.html").then((response) => response.text()),
      fetch("./baseline-runner.js").then((response) => response.text()),
    ]);
    assertEqual(html.includes('id="run-baseline"'), true);
    assertEqual(js.includes("createTestDownloadAdapter"), true);
    assertEqual(js.includes("setDownloadAdapter(adapter)"), true);
    assertEqual(js.includes('addEventListener("click"'), true);
    assertEqual(js.includes(".click()"), false);
    assertEqual(js.includes("showSaveFilePicker"), false);
  });

  test("new baseline sources contain no absolute personal paths", async () => {
    const paths = [
      "./baseline-runner.html",
      "./baseline-runner.js",
      "./baseline-runner.css",
      "./diagnostics-tests.js",
      "./fixtures/procedural-baseline-fixture.js",
      "../src/diagnostics/baseline-metrics.js",
      "../src/diagnostics/diagnostics-schema.js",
      "../docs/BASELINE_DIAGNOSTICS.md",
    ];
    const texts = await Promise.all(paths.map((path) => fetch(path).then((response) => response.text())));
    assertEqual(texts.some((text) => /[A-Za-z]:[\\/](?:Users|Documents|Desktop)[\\/]/.test(text)), false);
  });
});
