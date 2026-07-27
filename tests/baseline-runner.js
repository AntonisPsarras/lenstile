import {
  createTestDownloadAdapter,
  setDownloadAdapter,
} from "../src/export/download.js";
import {
  configureBaselineMetrics,
  resetBaselineMetrics,
  recordBaselineStage,
  recordBaselineWorkflow,
  createExactByteRecord,
  createLogicalEstimateRecord,
  createSummaryRecord,
  getBaselineDiagnostics,
} from "../src/diagnostics/baseline-metrics.js";
import {
  createProceduralBaselineCanvas,
  createProceduralBaselineRgba,
} from "./fixtures/procedural-baseline-fixture.js";
import { rasterizeCropToRgba } from "../src/image/crop-rasterize.js";
import { computeQuantizationSize } from "../src/image/resolution.js";
import { indicesToRgba } from "../src/image/indexed-preview.js";
import { getDerivedPrintSettings } from "../src/config/print-profiles.js";
import {
  QUANTIZE_ALGORITHM_VERSION,
  CLEANUP_ALGORITHM_VERSION,
  MAX_CLEANUP_PASSES,
  DEFAULT_BASE_COLOR,
} from "../src/config.js";
import { TILE_V1 } from "../src/geometry/tile-spec.js";
import {
  nextQuantizeRequestId,
  nextPrintabilityRequestId,
  requestQuantize,
  requestPrintability,
} from "../src/workers/image-worker-client.js";
import {
  nextMeshRequestId,
  requestMeshGenerate,
} from "../src/workers/mesh-worker-client.js";
import { deserializePackedMesh } from "../src/workers/mesh-worker-protocol.js";
import { writeBinaryStl, binaryStlToBlob } from "../src/export/binary-stl.js";
import { packageMulticolorThreeMf } from "../src/export/three-mf-packaging.js";

const adapter = createTestDownloadAdapter();
setDownloadAdapter(adapter);

const runButton = document.getElementById("run-baseline");
const status = document.getElementById("status");
const resultsBody = document.getElementById("results");
const reportElement = document.getElementById("report");

const round = (value) => Math.round(value * 1000) / 1000;
const sumMeshBytes = (meshes) => meshes.reduce(
  (sum, mesh) => sum + mesh.positions.byteLength + mesh.triangles.byteLength,
  0,
);
const sumVertices = (meshes) => meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
const sumTriangles = (meshes) => meshes.reduce((sum, mesh) => sum + mesh.triangles.length / 3, 0);

function addStage(caseId, stageId, durationMs, workerDurationMs = 0, roundTripDurationMs = 0) {
  recordBaselineStage({
    caseId,
    stageId,
    durationMs: round(durationMs),
    workerDurationMs: round(workerDurationMs),
    roundTripDurationMs: round(roundTripDurationMs),
    queueTransferDelayEstimateMs: round(Math.max(0, roundTripDurationMs - workerDurationMs)),
  });
}

function unpackGeometry(result) {
  return {
    combined: deserializePackedMesh(result.combined),
    base: deserializePackedMesh(result.base),
    backing: deserializePackedMesh(result.backing || result.roof),
    colors: result.colors.map((entry) => ({
      paletteIndex: entry.paletteIndex,
      mesh: deserializePackedMesh(entry.mesh),
    })),
  };
}

async function runProcessing(profileId, colorCount, fixtureCanvas, counters) {
  const processingStarted = performance.now();
  const settings = getDerivedPrintSettings(profileId);
  const size = computeQuantizationSize(settings.pixelsPerMm);
  const processingId = `${profileId}-${colorCount}c`;
  let started = performance.now();
  const raster = rasterizeCropToRgba({
    bitmap: fixtureCanvas,
    transform: {
      offsetX: 0,
      offsetY: 0,
      scale: size.widthPx / fixtureCanvas.width,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
    },
    viewCropSize: { width: size.widthPx, height: size.heightPx },
    widthPx: size.widthPx,
    heightPx: size.heightPx,
    transparencyMode: "white",
  });
  addStage(processingId, "crop-rasterization", performance.now() - started);

  const quantStart = performance.now();
  counters.workerRequests += 1;
  const quantized = await requestQuantize({
    requestId: nextQuantizeRequestId(),
    sourceRevision: counters.workerRequests,
    width: size.widthPx,
    height: size.heightPx,
    rgbaBuffer: raster.rgba.buffer.slice(0),
    colorCount,
    algorithmVersion: QUANTIZE_ALGORITHM_VERSION,
  });
  counters.workerCompletions += 1;
  if (!quantized.result) throw new Error("Baseline quantization failed.");
  const quantRoundTrip = performance.now() - quantStart;
  const quantWorker = quantized.result.diagnostics?.durationMs || 0;
  addStage(processingId, "color-processing", quantRoundTrip, quantWorker, quantRoundTrip);
  const indices = new Uint8Array(quantized.result.indicesBuffer);

  const printOpts = {
    sourceRevision: counters.workerRequests,
    width: size.widthPx,
    height: size.heightPx,
    minimumFeatureWidthMm: settings.minimumFeatureWidthMm,
    minimumGapWidthMm: settings.minimumGapWidthMm,
    minimumIslandAreaMm2: settings.minimumIslandAreaMm2,
    maximumHoleAreaToFillMm2: settings.maximumHoleAreaToFillMm2,
    tileWidthMm: TILE_V1.widthMm,
    tileHeightMm: TILE_V1.heightMm,
    maxPasses: MAX_CLEANUP_PASSES,
    algorithmVersion: CLEANUP_ALGORITHM_VERSION,
  };

  started = performance.now();
  counters.workerRequests += 1;
  const analysis = await requestPrintability({
    ...printOpts,
    requestId: nextPrintabilityRequestId(),
    printabilityRevision: counters.workerRequests,
    indicesBuffer: indices.buffer.slice(0),
    runCleanup: false,
  });
  counters.workerCompletions += 1;
  if (!analysis.result) throw new Error("Baseline printability analysis failed.");
  const analysisRoundTrip = performance.now() - started;
  addStage(
    processingId,
    "printability-analysis",
    analysisRoundTrip,
    analysis.result.diagnostics?.durationMs || 0,
    analysisRoundTrip,
  );

  started = performance.now();
  counters.workerRequests += 1;
  const fixed = await requestPrintability({
    ...printOpts,
    requestId: nextPrintabilityRequestId(),
    printabilityRevision: counters.workerRequests,
    indicesBuffer: indices.buffer.slice(0),
    runCleanup: true,
  });
  counters.workerCompletions += 1;
  if (!fixed.result || !fixed.result.cleanedIndicesBuffer) {
    throw new Error("Baseline automatic cleanup failed.");
  }
  const fixRoundTrip = performance.now() - started;
  addStage(
    processingId,
    "automatic-cleanup",
    fixRoundTrip,
    fixed.result.diagnostics?.durationMs || 0,
    fixRoundTrip,
  );

  const cleaned = new Uint8Array(fixed.result.cleanedIndicesBuffer);
  const preview = indicesToRgba(
    indices,
    quantized.result.generatedPalette,
    size.widthPx,
    size.heightPx,
  );
  return {
    processingId,
    width: size.widthPx,
    height: size.heightPx,
    raster,
    indices,
    preview,
    issueMask: new Uint8Array(analysis.result.issueMaskBuffer),
    cleaned,
    palette: quantized.result.generatedPalette,
    processingDurationMs: performance.now() - processingStarted,
  };
}

async function buildSurface(processed, surfaceStyle, counters) {
  const started = performance.now();
  counters.workerRequests += 1;
  counters.geometryBuilds += 1;
  const response = await requestMeshGenerate({
    requestId: nextMeshRequestId(),
    sourceRevision: counters.workerRequests,
    printabilityRevision: counters.workerRequests,
    geometryRevision: counters.geometryBuilds,
    width: processed.width,
    height: processed.height,
    cleanedIndicesBuffer: processed.cleaned.buffer.slice(0),
    surfaceStyle,
    effectivePalette: processed.palette,
  });
  counters.workerCompletions += 1;
  if (!response.result || !response.result.ok) throw new Error("Baseline geometry failed.");
  const roundTrip = performance.now() - started;
  const workerDuration = response.result.diagnostics?.workerDurationMs || 0;
  const casePrefix = `${processed.processingId}-${surfaceStyle}`;
  addStage(casePrefix, "geometry-construction", response.result.diagnostics?.geometryConstructionMs || workerDuration, workerDuration, roundTrip);
  addStage(casePrefix, "mesh-validation", response.result.diagnostics?.meshValidationMs || 0);
  return unpackGeometry(response.result);
}

function appendRow(record, writeMs) {
  const row = document.createElement("tr");
  const values = [
    record.caseId,
    record.totalDurationMs.toFixed(1),
    record.geometryDurationMs.toFixed(1),
    writeMs.toFixed(1),
    String(record.vertexCount),
    String(record.triangleCount),
    String(record.finalBytes),
  ];
  for (const value of values) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.appendChild(cell);
  }
  resultsBody.appendChild(row);
}

async function runSupersedeProbe(fixtureCanvas, counters) {
  const size = computeQuantizationSize(8);
  const raster = rasterizeCropToRgba({
    bitmap: fixtureCanvas,
    transform: { offsetX: 0, offsetY: 0, scale: size.widthPx / fixtureCanvas.width, rotationDeg: 0, flipX: false, flipY: false },
    viewCropSize: { width: size.widthPx, height: size.heightPx },
    widthPx: size.widthPx,
    heightPx: size.heightPx,
    transparencyMode: "white",
  });
  const firstStart = performance.now();
  counters.workerRequests += 2;
  const first = requestQuantize({
    requestId: nextQuantizeRequestId(), sourceRevision: 9001,
    width: size.widthPx, height: size.heightPx,
    rgbaBuffer: raster.rgba.buffer.slice(0), colorCount: 4,
    algorithmVersion: QUANTIZE_ALGORITHM_VERSION,
  });
  const secondStart = performance.now();
  const second = requestQuantize({
    requestId: nextQuantizeRequestId(), sourceRevision: 9002,
    width: size.widthPx, height: size.heightPx,
    rgbaBuffer: raster.rgba.buffer.slice(0), colorCount: 4,
    algorithmVersion: QUANTIZE_ALGORITHM_VERSION,
  });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  counters.workerCompletions += 2;
  counters.supersededRequests += 1;
  const firstRoundTrip = performance.now() - firstStart;
  const secondRoundTrip = performance.now() - secondStart;
  addStage("rapid-supersede-probe", "superseded-request", firstRoundTrip, firstResult.result?.diagnostics?.durationMs || 0, firstRoundTrip);
  addStage("rapid-supersede-probe", "latest-request", secondRoundTrip, secondResult.result?.diagnostics?.durationMs || 0, secondRoundTrip);
}

async function runBaseline() {
  runButton.disabled = true;
  adapter.reset();
  resultsBody.textContent = "";
  resetBaselineMetrics();
  configureBaselineMetrics({ enabled: true, now: () => performance.now() });
  const counters = {
    workerRequests: 0,
    workerCompletions: 0,
    supersededRequests: 0,
    geometryBuilds: 0,
    duplicateBuilds: 0,
  };
  const fixture = {
    canvas: createProceduralBaselineCanvas(),
    rgba: createProceduralBaselineRgba(),
  };
  const exactTotals = {};
  const estimateTotals = {};
  const exported = [];
  const longTasks = [];
  let observer = null;
  if (typeof PerformanceObserver !== "undefined"
      && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries()));
    observer.observe({ type: "longtask", buffered: true });
    status.textContent = "Running. Long-task observation is supported.";
  } else {
    status.textContent = "Running. Long-task observation is unsupported in this browser.";
  }

  const totalStarted = performance.now();
  try {
    for (const profileId of ["nozzle04", "nozzle02"]) {
      for (const colorCount of [4, 8]) {
        status.textContent = `Processing ${profileId}, ${colorCount} colors…`;
        const processed = await runProcessing(profileId, colorCount, fixture.canvas, counters);
        for (const surfaceStyle of ["flat", "relief"]) {
          const surfaceStart = performance.now();
          status.textContent = `Building ${profileId}, ${colorCount} colors, ${surfaceStyle}…`;
          const geometry = await buildSurface(processed, surfaceStyle, counters);
          const retainedMeshes = [
            geometry.combined,
            geometry.base,
            geometry.backing,
            ...geometry.colors.map((entry) => entry.mesh),
          ];
          const vertexCount = sumVertices(retainedMeshes);
          const triangleCount = sumTriangles(retainedMeshes);
          const artworkMeshes = geometry.colors.map((entry) => entry.mesh);
          const meshCounts = {
            combinedVertexCount: geometry.combined.positions.length / 3,
            combinedTriangleCount: geometry.combined.triangles.length / 3,
            baseVertexCount: geometry.base.positions.length / 3,
            baseTriangleCount: geometry.base.triangles.length / 3,
            backingVertexCount: geometry.backing.positions.length / 3,
            backingTriangleCount: geometry.backing.triangles.length / 3,
            artworkVertexCount: sumVertices(artworkMeshes),
            artworkTriangleCount: sumTriangles(artworkMeshes),
          };
          const casePrefix = `${profileId}-${colorCount}c-${surfaceStyle}`;

          let started = performance.now();
          const stlBuffer = writeBinaryStl(geometry.combined);
          const stlWriteMs = performance.now() - started;
          addStage(`${casePrefix}-stl`, "stl-writing", stlWriteMs);
          started = performance.now();
          const stlBlob = binaryStlToBlob(stlBuffer);
          const stlBlobMs = performance.now() - started;
          addStage(`${casePrefix}-stl`, "final-file-construction", stlBlobMs);
          adapter.downloadBlob(stlBlob, `${casePrefix}.stl`);
          const stlCase = {
            caseId: `${casePrefix}-stl`,
            profileId,
            colorCount,
            surfaceStyle,
            exportFormat: "stl",
            totalDurationMs: round(processed.processingDurationMs + performance.now() - surfaceStart),
            geometryDurationMs: 0,
            workerRequests: counters.workerRequests,
            workerCompletions: counters.workerCompletions,
            supersededRequests: counters.supersededRequests,
            geometryBuilds: counters.geometryBuilds,
            duplicateBuilds: counters.duplicateBuilds,
            longTaskCount: 0,
            longTaskDurationMs: 0,
            vertexCount,
            triangleCount,
            ...meshCounts,
            stlBytes: stlBuffer.byteLength,
            xmlBytes: 0,
            zipBytes: 0,
            finalFileBytes: stlBlob.size,
            finalBytes: stlBlob.size,
          };
          recordBaselineWorkflow(stlCase);
          appendRow(stlCase, stlWriteMs + stlBlobMs);
          exported.push(stlCase);

          const packageMetrics = {};
          const packaged = packageMulticolorThreeMf({
            projectName: "procedural-baseline",
            baseMesh: geometry.base,
            backingMesh: geometry.backing,
            colorMeshes: geometry.colors.map((entry) => ({
              paletteIndex: entry.paletteIndex,
              mesh: entry.mesh,
              color: processed.palette[entry.paletteIndex],
            })),
            baseColor: DEFAULT_BASE_COLOR,
            effectivePalette: processed.palette,
            surfaceStyle,
          }, { metrics: packageMetrics, now: () => performance.now() });
          adapter.downloadBlob(packaged.blob, `${casePrefix}.3mf`);
          addStage(`${casePrefix}-3mf`, "3mf-xml-construction", packageMetrics.xmlConstructionMs || 0);
          addStage(`${casePrefix}-3mf`, "store-zip-packaging", packageMetrics.zipPackagingMs || 0);
          addStage(`${casePrefix}-3mf`, "3mf-zip-xml-validation", packageMetrics.packageValidationMs || 0);
          addStage(`${casePrefix}-3mf`, "final-file-construction", packageMetrics.blobConstructionMs || 0);
          const packageMs = (packageMetrics.xmlConstructionMs || 0)
            + (packageMetrics.zipPackagingMs || 0)
            + (packageMetrics.packageValidationMs || 0)
            + (packageMetrics.blobConstructionMs || 0);
          const mfCase = {
            ...stlCase,
            caseId: `${casePrefix}-3mf`,
            exportFormat: "3mf",
            totalDurationMs: round(processed.processingDurationMs + performance.now() - surfaceStart),
            stlBytes: 0,
            xmlBytes: packaged.diagnostics.xmlByteLength,
            zipBytes: packaged.bytes.byteLength,
            finalFileBytes: packaged.blob.size,
            finalBytes: packaged.blob.size,
          };
          recordBaselineWorkflow(mfCase);
          appendRow(mfCase, packageMs);
          exported.push(mfCase);

          const xmlBytes = new TextEncoder().encode(packaged.xml.model).byteLength;
          const meshBytes = sumMeshBytes(retainedMeshes);
          for (const [key, value] of Object.entries({
            sourceFixtureRgba: fixture.rgba.byteLength,
            rasterRgba: processed.raster.rgba.byteLength,
            quantizedIndices: processed.indices.byteLength,
            previewRgba: processed.preview.byteLength,
            issueMask: processed.issueMask.byteLength,
            cleanedIndices: processed.cleaned.byteLength,
            meshPositions: retainedMeshes.reduce((sum, mesh) => sum + mesh.positions.byteLength, 0),
            meshTriangles: retainedMeshes.reduce((sum, mesh) => sum + mesh.triangles.byteLength, 0),
            stl: stlBuffer.byteLength,
            xmlUtf8: xmlBytes,
            zip: packaged.bytes.byteLength,
            finalFile: stlBlob.size + packaged.blob.size,
          })) exactTotals[key] = (exactTotals[key] || 0) + value;
          estimateTotals.xmlUtf16LogicalPayload = (estimateTotals.xmlUtf16LogicalPayload || 0)
            + packaged.xml.model.length * 2;
          estimateTotals.knownLiveBufferLowerBound = (estimateTotals.knownLiveBufferLowerBound || 0)
            + fixture.rgba.byteLength + processed.raster.rgba.byteLength
            + processed.indices.byteLength + processed.preview.byteLength
            + processed.issueMask.byteLength + processed.cleaned.byteLength + meshBytes;
        }
      }
    }

    await runSupersedeProbe(fixture.canvas, counters);
    observer?.disconnect();
    const longTaskDuration = longTasks.reduce((sum, entry) => sum + entry.duration, 0);
    const report = getBaselineDiagnostics({
      exactKnownBytes: createExactByteRecord(exactTotals),
      logicalEstimates: createLogicalEstimateRecord(estimateTotals),
    });
    report.summary = createSummaryRecord({
      caseCount: exported.length,
      elapsedMs: round(performance.now() - totalStarted),
      workerRequests: counters.workerRequests,
      workerCompletions: counters.workerCompletions,
      supersededRequests: counters.supersededRequests,
      geometryBuilds: counters.geometryBuilds,
      duplicateBuilds: counters.duplicateBuilds,
      longTaskObservationSupported: Boolean(observer),
      longTaskCount: longTasks.length,
      longTaskDurationMs: round(longTaskDuration),
      inMemoryAdapterInvocations: adapter.getInvocationCount(),
    });
    reportElement.textContent = JSON.stringify(report, null, 2);
    window.__BASELINE_REPORT__ = report;
    status.textContent = `Complete: ${exported.length} cases, ${adapter.getInvocationCount()} in-memory exports.`;
  } finally {
    observer?.disconnect();
    configureBaselineMetrics({ enabled: false });
    runButton.disabled = false;
  }
}

runButton.addEventListener("click", () => {
  runBaseline().catch((error) => {
    status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
    runButton.disabled = false;
  });
});
