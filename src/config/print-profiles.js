/**
 * Printer nozzle profiles for printability analysis and automatic detail grids
 * (Milestone 3 / 7.3.2).
 *
 * Values are nozzle diameters, derived feature thresholds, and automatic
 * high-detail processing resolutions — not layer heights and not slicer
 * hardware profile selection. The website prepares geometry at these grids;
 * the user must select the matching nozzle in their slicer before printing.
 *
 * Thresholds are conservative product defaults for 0.2 mm and 0.4 mm nozzles;
 * verify on your printer and filament.
 * Do not invent alternate thresholds in UI or state — resolve from here.
 */

/** Schema version for serialized printability.profileId interpretation. */
export const PRINT_PROFILES_VERSION = 3;

/** Default profile when unset or invalid. */
export const DEFAULT_PRINT_PROFILE_ID = "nozzle04";

/**
 * Legacy profile ids removed in PRINT_PROFILES_VERSION 2.
 * nozzle06 (0.6 mm) is migrated to nozzle04 — not preserved as a hidden profile.
 */
export const LEGACY_PRINT_PROFILE_MIGRATIONS = Object.freeze({
  nozzle06: "nozzle04",
});

/**
 * Automatic high-detail processing grids keyed by nozzle profile id.
 * Validated against derived tile dimensions and MAX_QUANTIZATION_PIXELS.
 *
 * @type {Readonly<Record<string, Readonly<{ pixelsPerMm: number, pixelSizeMm: number }>>>}
 */
export const PROCESSING_PROFILES = Object.freeze({
  nozzle02: Object.freeze({
    pixelsPerMm: 10,
    pixelSizeMm: 0.1,
  }),
  nozzle04: Object.freeze({
    pixelsPerMm: 8,
    pixelSizeMm: 0.125,
  }),
});

/**
 * @typedef {object} PrintProfile
 * @property {string} id
 * @property {string} label
 * @property {number} nozzleDiameterMm
 * @property {number} minimumFeatureWidthMm
 * @property {number} minimumGapWidthMm
 * @property {number} minimumIslandAreaMm2
 * @property {number} maximumHoleAreaToFillMm2
 * @property {number} pixelsPerMm
 * @property {number} pixelSizeMm
 */

/**
 * Deep-freeze an object graph (profiles must not be mutated at runtime).
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze(/** @type {Record<string, unknown>} */ (value)[key]);
    }
  }
  return value;
}

/**
 * Immutable printer profiles (nozzle diameter choices + automatic detail grid).
 * @type {Readonly<Record<string, Readonly<PrintProfile>>>}
 */
export const PRINT_PROFILES = deepFreeze({
  nozzle02: {
    id: "nozzle02",
    label: "0.2 mm — Fine detail",
    nozzleDiameterMm: 0.2,
    minimumFeatureWidthMm: 0.25,
    minimumGapWidthMm: 0.25,
    minimumIslandAreaMm2: 0.10,
    maximumHoleAreaToFillMm2: 0.10,
    pixelsPerMm: PROCESSING_PROFILES.nozzle02.pixelsPerMm,
    pixelSizeMm: PROCESSING_PROFILES.nozzle02.pixelSizeMm,
  },
  nozzle04: {
    id: "nozzle04",
    label: "0.4 mm — Standard",
    nozzleDiameterMm: 0.4,
    minimumFeatureWidthMm: 0.45,
    minimumGapWidthMm: 0.45,
    minimumIslandAreaMm2: 0.30,
    maximumHoleAreaToFillMm2: 0.30,
    pixelsPerMm: PROCESSING_PROFILES.nozzle04.pixelsPerMm,
    pixelSizeMm: PROCESSING_PROFILES.nozzle04.pixelSizeMm,
  },
});

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function isValidPrintProfileId(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(PRINT_PROFILES, id);
}

/**
 * Migrate legacy print profile ids, then normalize.
 * @param {unknown} id
 * @returns {string}
 */
export function migratePrintProfileId(id) {
  if (typeof id === "string" && Object.prototype.hasOwnProperty.call(LEGACY_PRINT_PROFILE_MIGRATIONS, id)) {
    return LEGACY_PRINT_PROFILE_MIGRATIONS[/** @type {keyof typeof LEGACY_PRINT_PROFILE_MIGRATIONS} */ (id)];
  }
  return normalizePrintProfileId(id);
}

/**
 * Normalize an unknown profile id to a known one (invalid → default).
 * @param {unknown} id
 * @returns {string}
 */
export function normalizePrintProfileId(id) {
  if (typeof id === "string" && Object.prototype.hasOwnProperty.call(LEGACY_PRINT_PROFILE_MIGRATIONS, id)) {
    return LEGACY_PRINT_PROFILE_MIGRATIONS[/** @type {keyof typeof LEGACY_PRINT_PROFILE_MIGRATIONS} */ (id)];
  }
  return isValidPrintProfileId(id) ? /** @type {string} */ (id) : DEFAULT_PRINT_PROFILE_ID;
}

/**
 * Resolve a print profile by id (invalid / legacy ids → migrated / default).
 * @param {unknown} id
 * @returns {Readonly<PrintProfile>}
 */
export function resolvePrintProfile(id) {
  const normalized = normalizePrintProfileId(id);
  return PRINT_PROFILES[normalized];
}

/**
 * Resolve the automatic processing grid for a nozzle profile.
 * @param {unknown} id
 * @returns {Readonly<{ pixelsPerMm: number, pixelSizeMm: number }>}
 */
export function resolveProcessingProfile(id) {
  const normalized = normalizePrintProfileId(id);
  return PROCESSING_PROFILES[normalized];
}

/**
 * Derived pixels-per-millimetre for quantization / cleanup / geometry.
 * @param {unknown} id
 * @returns {number}
 */
export function getProcessingPixelsPerMm(id) {
  return resolveProcessingProfile(id).pixelsPerMm;
}

/**
 * Derived physical pixel size (mm) for the automatic detail grid.
 * @param {unknown} id
 * @returns {number}
 */
export function getProcessingPixelSizeMm(id) {
  return resolveProcessingProfile(id).pixelSizeMm;
}

/**
 * Validate PROCESSING_PROFILES against PRINT_PROFILES and derived sizes.
 * @param {typeof PRINT_PROFILES} [profiles]
 * @param {typeof PROCESSING_PROFILES} [processing]
 * @returns {{ ok: true } | { ok: false, reasons: string[] }}
 */
export function validateProcessingProfiles(profiles = PRINT_PROFILES, processing = PROCESSING_PROFILES) {
  /** @type {string[]} */
  const reasons = [];
  for (const id of Object.keys(profiles)) {
    const proc = processing[id];
    const profile = profiles[id];
    if (!proc) {
      reasons.push(`missing PROCESSING_PROFILES entry for ${id}`);
      continue;
    }
    if (Math.abs(proc.pixelSizeMm - 1 / proc.pixelsPerMm) > 1e-12) {
      reasons.push(`${id}: pixelSizeMm must equal 1 / pixelsPerMm`);
    }
    if (Math.abs(profile.pixelsPerMm - proc.pixelsPerMm) > 1e-12) {
      reasons.push(`${id}: PRINT_PROFILES.pixelsPerMm must match PROCESSING_PROFILES`);
    }
    if (Math.abs(profile.pixelSizeMm - proc.pixelSizeMm) > 1e-12) {
      reasons.push(`${id}: PRINT_PROFILES.pixelSizeMm must match PROCESSING_PROFILES`);
    }
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

/**
 * Derived printability settings from a profile id (never editable duplicates).
 * @param {unknown} id
 * @returns {{
 *   profileId: string,
 *   nozzleDiameterMm: number,
 *   minimumFeatureWidthMm: number,
 *   minimumGapWidthMm: number,
 *   minimumIslandAreaMm2: number,
 *   maximumHoleAreaToFillMm2: number,
 *   pixelsPerMm: number,
 *   pixelSizeMm: number,
 * }}
 */
export function getDerivedPrintSettings(id) {
  const profile = resolvePrintProfile(id);
  return {
    profileId: profile.id,
    nozzleDiameterMm: profile.nozzleDiameterMm,
    minimumFeatureWidthMm: profile.minimumFeatureWidthMm,
    minimumGapWidthMm: profile.minimumGapWidthMm,
    minimumIslandAreaMm2: profile.minimumIslandAreaMm2,
    maximumHoleAreaToFillMm2: profile.maximumHoleAreaToFillMm2,
    pixelsPerMm: profile.pixelsPerMm,
    pixelSizeMm: profile.pixelSizeMm,
  };
}
