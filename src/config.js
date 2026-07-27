/**
 * Application configuration and feature flags.
 * All values are local constants — no remote config.
 */

export {
  PRINT_PROFILES,
  PRINT_PROFILES_VERSION,
  DEFAULT_PRINT_PROFILE_ID,
  LEGACY_PRINT_PROFILE_MIGRATIONS,
  PROCESSING_PROFILES,
  isValidPrintProfileId,
  migratePrintProfileId,
  normalizePrintProfileId,
  resolvePrintProfile,
  resolveProcessingProfile,
  getProcessingPixelsPerMm,
  getProcessingPixelSizeMm,
  validateProcessingProfiles,
  getDerivedPrintSettings,
} from "./config/print-profiles.js";

export {
  DETAIL_PROFILES,
  DETAIL_PROFILES_VERSION,
  DEFAULT_DETAIL_PROFILE_ID,
  isValidDetailProfileId,
  normalizeDetailProfileId,
  resolveDetailProfile,
  getDetailPixelsPerMm,
  migrateLegacyPixelsPerMm,
  resolveDetailProfileIdFromSerialized,
} from "./config/detail-profiles.js";

/** @type {readonly string[]} */
export const SUPPORTED_IMAGE_MIME_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/** @type {readonly string[]} */
export const SUPPORTED_IMAGE_EXTENSIONS = Object.freeze([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

/** Soft warning threshold for very large source images (pixels). */
export const LARGE_IMAGE_PIXEL_WARNING = 40_000_000;

/**
 * Hard cap on quantization output pixels (widthPx × heightPx).
 * Chosen for a browser prototype: ~1.5M pixels keeps RGBA (~6 MiB) and
 * clustering workable on typical laptops without silently downsampling.
 */
export const MAX_QUANTIZATION_PIXELS = 1_500_000;

/** Deterministic RGB clustering algorithm version (bump when output rules change). */
export const QUANTIZE_ALGORITHM_VERSION = 1;

/** Fixed k-means iteration cap. Diagnostics may report fewer when converged early. */
export const QUANTIZE_MAX_ITERATIONS = 32;

/** Minimum / maximum zoom scale for the crop editor. */
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 20;
export const ZOOM_STEP = 0.05;

/** Wheel zoom sensitivity (multiplicative per notch). */
export const WHEEL_ZOOM_FACTOR = 1.08;

/**
 * Feature readiness. Disabled UI must match these flags.
 * @type {Readonly<Record<string, boolean>>}
 */
export const FEATURES = Object.freeze({
  quantization: true,
  printabilityCleanup: true,
  stlExport: true,
  alignedStlExport: true,
  threeMfExport: true,
  projectJsonExport: false,
  svgImport: false,
  undoRedo: false,
  serviceWorker: false,
  indexedDbPersistence: false,
  freeRotation: false,
});

/**
 * Default structural base color for multicolor 3MF metadata.
 * Neutral dark gray — does not affect STL (no reliable color semantics).
 * @type {Readonly<{ r: number, g: number, b: number }>}
 */
export const DEFAULT_BASE_COLOR = Object.freeze({ r: 42, g: 42, b: 42 });

/** Deterministic printability cleanup algorithm version (bump when cleanup rules change). */
export const CLEANUP_ALGORITHM_VERSION = 2;

export {
  GEOMETRY_ALGORITHM_VERSION,
  MAGNET_CIRCLE_SEGMENTS,
} from "./geometry/tile-spec.js";

export {
  MAGNET_BACKING,
  validateMagnetBacking,
} from "./geometry/magnet-backing.js";

export {
  RELIEF,
  DEFAULT_SURFACE,
  RELIEF_MIN_ROOF_MM,
  validateReliefConfig,
  normalizeReliefStrengthId,
  normalizeHeightOrderId,
  normalizeSurfaceStyleId,
  createSurfaceStateSlice,
  migrateSurfaceSettings,
} from "./geometry/relief.js";

/**
 * Maximum island/hole cleanup passes per analysis.
 * Prevents infinite oscillation; remaining issues are reported.
 */
export const MAX_CLEANUP_PASSES = 16;

/** UI step identifiers in workflow order. */
export const STEPS = Object.freeze(["image", "colors", "printability", "export"]);

/**
 * User-facing numbered step labels (Milestone 6.1).
 * Internal step ids remain image / colors / printability / export.
 */
export const STEP_LABELS = Object.freeze({
  image: "1. Image",
  colors: "2. Colors",
  printability: "3. Make printable",
  export: "4. Download",
});

/** Toast auto-dismiss duration for success notices (ms). */
export const TOAST_SUCCESS_MS = 4000;

export const APP_NAME = "LensTile";
export const APP_TAGLINE = "Open-source magnetic image tiles for modular glasses cases.";
export const APP_DESCRIPTION =
  "LensTile converts an image into a printable rectangular tile with magnetic mounting recesses for compatible modular glasses cases.";
/** Default sanitized basename for export downloads (no editable design name). */
export const DEFAULT_EXPORT_BASENAME = "lenstile";
export const APP_VERSION = "0.9.0-m9";
