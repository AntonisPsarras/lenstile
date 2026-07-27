/**
 * Input and settings validation (pure).
 */

import {
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_IMAGE_MIME_TYPES,
  LARGE_IMAGE_PIXEL_WARNING,
  isValidDetailProfileId,
  isValidPrintProfileId,
  normalizeDetailProfileId,
  normalizePrintProfileId,
  migratePrintProfileId,
  DEFAULT_DETAIL_PROFILE_ID,
  DEFAULT_PRINT_PROFILE_ID,
} from "./config.js";

/**
 * @param {string | null | undefined} mimeType
 * @param {string | null | undefined} fileName
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateImageFileMeta(mimeType, fileName) {
  const mime = (mimeType || "").toLowerCase();
  const name = (fileName || "").toLowerCase();

  if (!mime && !name) {
    return { ok: false, reason: "No file selected." };
  }

  const mimeOk = mime && SUPPORTED_IMAGE_MIME_TYPES.includes(mime);
  const extOk = SUPPORTED_IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));

  // Some browsers give empty MIME; allow extension fallback.
  if (mimeOk || (!mime && extOk) || (extOk && mime.startsWith("image/"))) {
    if (mime && mime.startsWith("image/") && !mimeOk && !extOk) {
      return {
        ok: false,
        reason: `Unsupported image type "${mimeType || name}". Use PNG, JPEG, or WebP.`,
      };
    }
    if (mimeOk || extOk) {
      return { ok: true };
    }
  }

  return {
    ok: false,
    reason: `Unsupported image type "${mimeType || name}". Use PNG, JPEG, or WebP.`,
  };
}

/**
 * @param {number} widthPx
 * @param {number} heightPx
 * @returns {{ warn: boolean, message: string | null }}
 */
export function checkImageSizeWarning(widthPx, heightPx) {
  const pixels = widthPx * heightPx;
  if (pixels >= LARGE_IMAGE_PIXEL_WARNING) {
    return {
      warn: true,
      message: `Large image (${widthPx}×${heightPx} px). Editing may be slow on this device.`,
    };
  }
  return { warn: false, message: null };
}

/**
 * @param {number} colorCount
 * @returns {{ ok: true, value: number } | { ok: false, reason: string }}
 */
export function validateColorCount(colorCount) {
  const n = Number(colorCount);
  if (!Number.isInteger(n) || n < 1 || n > 8) {
    return { ok: false, reason: "Image detail colors must be an integer from 1 to 8." };
  }
  return { ok: true, value: n };
}

/**
 * Legacy ppm bounds (migration / tests only — not exposed in standard UI).
 * @param {number} ppm
 * @returns {{ ok: true, value: number } | { ok: false, reason: string }}
 */
export function validatePixelsPerMm(ppm) {
  const n = Number(ppm);
  if (!Number.isFinite(n) || n < 0.5 || n > 20) {
    return { ok: false, reason: "Pixels per millimetre must be between 0.5 and 20." };
  }
  return { ok: true, value: n };
}

/**
 * @param {unknown} profileId
 * @returns {{ ok: true, value: string } | { ok: false, reason: string, value: string }}
 */
export function validateDetailProfileId(profileId) {
  if (isValidDetailProfileId(profileId)) {
    return { ok: true, value: /** @type {string} */ (profileId) };
  }
  return {
    ok: false,
    reason: `Unknown detail profile "${String(profileId)}". Using ${DEFAULT_DETAIL_PROFILE_ID}.`,
    value: normalizeDetailProfileId(profileId),
  };
}

/**
 * @param {unknown} profileId
 * @returns {{ ok: true, value: string } | { ok: false, reason: string, value: string }}
 */
export function validatePrintProfileId(profileId) {
  if (isValidPrintProfileId(profileId)) {
    return { ok: true, value: /** @type {string} */ (profileId) };
  }
  if (typeof profileId === "string" && profileId === "nozzle06") {
    return { ok: true, value: migratePrintProfileId(profileId) };
  }
  return {
    ok: false,
    reason: `Unknown print profile "${String(profileId)}". Using ${DEFAULT_PRINT_PROFILE_ID}.`,
    value: normalizePrintProfileId(profileId),
  };
}

/**
 * Legacy free-form nozzle validation (not used by standard UI).
 * @param {number} nozzleMm
 * @returns {{ ok: true, value: number } | { ok: false, reason: string }}
 */
export function validateNozzleDiameter(nozzleMm) {
  const n = Number(nozzleMm);
  if (!Number.isFinite(n) || n < 0.1 || n > 1.2) {
    return { ok: false, reason: "Nozzle diameter must be between 0.1 and 1.2 mm." };
  }
  return { ok: true, value: n };
}

/**
 * Legacy free-form min-feature validation (not used by standard UI).
 * @param {number} widthMm
 * @returns {{ ok: true, value: number } | { ok: false, reason: string }}
 */
export function validateMinFeatureWidth(widthMm) {
  const n = Number(widthMm);
  if (!Number.isFinite(n) || n < 0.2 || n > 5) {
    return { ok: false, reason: "Minimum feature width must be between 0.2 and 5 mm." };
  }
  return { ok: true, value: n };
}

/**
 * @param {string} name
 * @returns {{ ok: true, value: string } | { ok: false, reason: string }}
 */
export function validateProjectName(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "Project name cannot be empty." };
  }
  if (trimmed.length > 120) {
    return { ok: false, reason: "Project name must be at most 120 characters." };
  }
  return { ok: true, value: trimmed };
}

/**
 * Detect missing browser APIs required by the foundation.
 * @param {Window & typeof globalThis} [win]
 * @returns {string[]}
 */
export function detectMissingApis(win = globalThis) {
  /** @type {string[]} */
  const missing = [];
  if (typeof win.document === "undefined") missing.push("document");
  if (typeof win.HTMLCanvasElement === "undefined") missing.push("canvas");
  if (typeof win.FileReader === "undefined" && typeof win.createImageBitmap === "undefined") {
    missing.push("image decoding (FileReader or createImageBitmap)");
  }
  if (typeof win.PointerEvent === "undefined" && typeof win.MouseEvent === "undefined") {
    missing.push("pointer/mouse events");
  }
  return missing;
}
