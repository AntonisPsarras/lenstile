/**
 * Orchestrate crop rasterization + worker quantization + preview updates.
 */

import {
  getState,
  getRuntimeBitmap,
  getRuntimeQuantization,
  beginQuantizeRequest,
  acceptQuantizeResult,
  acceptQuantizeError,
  setQuantizePreviewRgba,
  patchQuantization,
  isQuantizationStale,
  getResolutionPxPerMm,
} from "../state.js";
import { QUANTIZE_ALGORITHM_VERSION } from "../config.js";
import { computeQuantizationSize, validateQuantizationResolution } from "../image/resolution.js";
import { rasterizeCropToRgba } from "../image/crop-rasterize.js";
import { indicesToRgba } from "../image/indexed-preview.js";
import {
  buildPaletteEntries,
  effectivePalette,
  replacePaletteColor,
  resetPaletteOverrides,
  parseHexColor,
  formatHexColor,
} from "../image/palette.js";
import { QuantizeErrorCode, createQuantizeError } from "../image/quantize-errors.js";
import {
  nextQuantizeRequestId,
  requestQuantize,
} from "../workers/image-worker-client.js";
import { WorkerMessageType } from "../workers/image-worker-protocol.js";
import { showError, showNotice, clearMessages } from "../ui/notifications.js";

/**
 * Whether the Quantize button should be enabled.
 * @returns {{ enabled: boolean, reason: string | null }}
 */
export function getQuantizeButtonState() {
  const s = getState();
  const rq = getRuntimeQuantization();
  if (!getRuntimeBitmap()) {
    return { enabled: false, reason: "Choose an image first." };
  }
  if (rq.status === "processing" || s.ui.isProcessing) {
    return { enabled: false, reason: "Color preview is already running." };
  }
  if (s.quantization.colorCount < 1 || s.quantization.colorCount > 8) {
    return { enabled: false, reason: "Image detail colors must be between 1 and 8." };
  }
  const res = validateQuantizationResolution(getResolutionPxPerMm(s));
  if (!res.ok) {
    return { enabled: false, reason: res.error.message };
  }
  return { enabled: true, reason: null };
}

/**
 * @param {{ width: number, height: number }} viewCropSize
 * @param {{ quiet?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, superseded?: boolean }>}
 */
export async function runQuantization(viewCropSize, opts = {}) {
  const quiet = Boolean(opts.quiet);
  const button = getQuantizeButtonState();
  if (!button.enabled) {
    if (!quiet) showError(button.reason || "Cannot create color preview.");
    return { ok: false };
  }

  const s = getState();
  const bitmap = getRuntimeBitmap();
  if (!bitmap) {
    if (!quiet) showError("Choose an image first.");
    return { ok: false };
  }

  if (!quiet) clearMessages();
  const requestId = nextQuantizeRequestId();
  const sourceRevision = s.sourceRevision;
  beginQuantizeRequest(requestId);

  try {
    const size = computeQuantizationSize(getResolutionPxPerMm(s));
    const raster = rasterizeCropToRgba({
      bitmap,
      transform: s.transform,
      viewCropSize,
      widthPx: size.widthPx,
      heightPx: size.heightPx,
      transparencyMode: s.quantization.transparencyMode,
      customBackground: s.quantization.customBackground,
    });

    // Copy into a transferable ArrayBuffer without touching the ImageData view lifetime oddly.
    const rgbaCopy = raster.rgba.slice().buffer;

    const response = await requestQuantize({
      requestId,
      sourceRevision,
      width: raster.width,
      height: raster.height,
      rgbaBuffer: rgbaCopy,
      colorCount: s.quantization.colorCount,
      algorithmVersion: s.quantization.algorithmVersion || QUANTIZE_ALGORITHM_VERSION,
    });

    if (response.type === WorkerMessageType.QUANTIZE_ERROR) {
      const accepted = acceptQuantizeError({
        requestId,
        sourceRevision,
        error: response.error || createQuantizeError(
          QuantizeErrorCode.WORKER_FAILURE,
          "Color preview failed.",
        ),
      });
      if (accepted && !quiet) {
        showError(response.error?.message || "Color preview failed.");
      }
      return { ok: false };
    }

    if (response.type !== WorkerMessageType.QUANTIZE_SUCCESS || !response.result) {
      acceptQuantizeError({
        requestId,
        sourceRevision,
        error: createQuantizeError(QuantizeErrorCode.WORKER_FAILURE, "Unexpected worker response."),
      });
      if (!quiet) showError("Unexpected worker response.");
      return { ok: false };
    }

    const result = response.result;
    const indices = new Uint8Array(result.indicesBuffer);
    const entries = buildPaletteEntries(result.generatedPalette, []);
    const previewRgba = indicesToRgba(
      indices,
      effectivePalette(entries),
      result.width,
      result.height,
    );

    const accepted = acceptQuantizeResult({
      requestId,
      sourceRevision,
      result: {
        width: result.width,
        height: result.height,
        requestedColorCount: result.requestedColorCount,
        actualColorCount: result.actualColorCount,
        generatedPalette: result.generatedPalette,
        indices,
        sourceRevision,
        algorithmVersion: result.algorithmVersion,
        diagnostics: result.diagnostics,
      },
      previewRgba,
    });

    if (!accepted) {
      // Stale — a newer request or revision won. Processing cleared by accept helpers.
      return { ok: false, superseded: true };
    }

    if (!quiet) showNotice("Color preview created");
    return { ok: true };
  } catch (err) {
    const error = err && typeof err === "object" && "code" in err && "message" in err
      ? /** @type {import("../image/quantize-errors.js").QuantizeError} */ (err)
      : err && typeof err === "object" && "quantize" in err
        ? /** @type {{ quantize: import("../image/quantize-errors.js").QuantizeError }} */ (err).quantize
        : createQuantizeError(
          QuantizeErrorCode.WORKER_FAILURE,
          err instanceof Error ? err.message : String(err),
        );
    acceptQuantizeError({ requestId, sourceRevision, error });
    if (!quiet) showError(error.message);
    return { ok: false };
  }
}

/**
 * Apply a palette override and refresh preview without messaging the worker.
 * @param {number} index
 * @param {{ r: number, g: number, b: number } | null} color
 */
export function applyPaletteOverride(index, color) {
  const s = getState();
  const rq = getRuntimeQuantization();
  if (!rq.indices || !rq.generatedPalette.length) {
    showError("Create a color preview before editing your colors.");
    return;
  }
  const overrides = replacePaletteColor(
    s.quantization.paletteOverrides,
    index,
    color,
    rq.generatedPalette.length,
  );
  patchQuantization({ paletteOverrides: overrides });
  refreshPreviewFromOverrides();
}

/**
 * Restore one generated color.
 * @param {number} index
 */
export function restoreGeneratedPaletteColor(index) {
  applyPaletteOverride(index, null);
}

/** Clear all palette overrides and rebuild preview. */
export function resetAllPaletteOverrides() {
  const rq = getRuntimeQuantization();
  if (!rq.generatedPalette.length) return;
  patchQuantization({
    paletteOverrides: resetPaletteOverrides(rq.generatedPalette.length),
  });
  refreshPreviewFromOverrides();
}

export function refreshPreviewFromOverrides() {
  const s = getState();
  const rq = getRuntimeQuantization();
  if (!rq.indices || !rq.generatedPalette.length) return;
  const entries = buildPaletteEntries(rq.generatedPalette, s.quantization.paletteOverrides);
  const previewRgba = indicesToRgba(
    rq.indices,
    effectivePalette(entries),
    rq.width,
    rq.height,
  );
  setQuantizePreviewRgba(previewRgba);
}

/**
 * @returns {import("../image/palette.js").PaletteEntry[]}
 */
export function getPaletteEntriesForUi() {
  const s = getState();
  const rq = getRuntimeQuantization();
  return buildPaletteEntries(rq.generatedPalette, s.quantization.paletteOverrides);
}

export {
  parseHexColor,
  formatHexColor,
  isQuantizationStale,
  getRuntimeQuantization,
  validateQuantizationResolution,
};
