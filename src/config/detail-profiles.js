/**
 * Quantization detail (pixels-per-millimetre) profiles.
 *
 * Numeric ppm is derived from the selected profile id — the standard UI
 * never exposes a free-form ppm control.
 */

/** Schema version for serialized quantization.detailProfileId interpretation. */
export const DETAIL_PROFILES_VERSION = 1;

/** Default detail profile when unset or invalid. */
export const DEFAULT_DETAIL_PROFILE_ID = "standard";

/** Canonical ppm values used for nearest-profile legacy migration. */
const LEGACY_PPM_CANDIDATES = Object.freeze([
  { id: "low", pixelsPerMm: 1 },
  { id: "standard", pixelsPerMm: 2 },
  { id: "high", pixelsPerMm: 4 },
]);

/**
 * @typedef {object} DetailProfile
 * @property {string} id
 * @property {string} label
 * @property {number} pixelsPerMm
 */

/**
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
 * Immutable detail profiles.
 * @type {Readonly<Record<string, Readonly<DetailProfile>>>}
 */
export const DETAIL_PROFILES = deepFreeze({
  low: {
    id: "low",
    label: "Low",
    pixelsPerMm: 1,
  },
  standard: {
    id: "standard",
    label: "Standard",
    pixelsPerMm: 2,
  },
  high: {
    id: "high",
    label: "High",
    pixelsPerMm: 4,
  },
});

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function isValidDetailProfileId(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(DETAIL_PROFILES, id);
}

/**
 * Normalize an unknown detail profile id (invalid → standard).
 * @param {unknown} id
 * @returns {string}
 */
export function normalizeDetailProfileId(id) {
  return isValidDetailProfileId(id) ? /** @type {string} */ (id) : DEFAULT_DETAIL_PROFILE_ID;
}

/**
 * @param {unknown} id
 * @returns {Readonly<DetailProfile>}
 */
export function resolveDetailProfile(id) {
  return DETAIL_PROFILES[normalizeDetailProfileId(id)];
}

/**
 * Derived pixels-per-millimetre for quantization.
 * @param {unknown} id
 * @returns {number}
 */
export function getDetailPixelsPerMm(id) {
  return resolveDetailProfile(id).pixelsPerMm;
}

/**
 * Migrate a legacy numeric pixelsPerMm to a detail profile id.
 *
 * Exact matches: 1 → low, 2 → standard, 4 → high.
 * Other finite values → nearest of {1, 2, 4}.
 * Equidistant ties: prefer standard when it is one of the nearest;
 * otherwise prefer the lower ppm (low before high).
 * Non-finite / missing → standard.
 *
 * @param {unknown} pixelsPerMm
 * @returns {string}
 */
export function migrateLegacyPixelsPerMm(pixelsPerMm) {
  const n = Number(pixelsPerMm);
  if (!Number.isFinite(n)) {
    return DEFAULT_DETAIL_PROFILE_ID;
  }

  for (const candidate of LEGACY_PPM_CANDIDATES) {
    if (n === candidate.pixelsPerMm) {
      return candidate.id;
    }
  }

  let best = LEGACY_PPM_CANDIDATES[0];
  let bestDist = Math.abs(n - best.pixelsPerMm);

  for (let i = 1; i < LEGACY_PPM_CANDIDATES.length; i += 1) {
    const candidate = LEGACY_PPM_CANDIDATES[i];
    const dist = Math.abs(n - candidate.pixelsPerMm);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
      continue;
    }
    if (dist === bestDist) {
      // Prefer standard among equidistant; else lower ppm.
      if (candidate.id === "standard" || best.id === "standard") {
        best = DETAIL_PROFILES.standard;
      } else if (candidate.pixelsPerMm < best.pixelsPerMm) {
        best = candidate;
      }
    }
  }

  return best.id;
}

/**
 * Resolve detail profile from either a profile id or legacy ppm field.
 * Prefer explicit detailProfileId when valid.
 *
 * @param {{ detailProfileId?: unknown, resolutionPxPerMm?: unknown } | null | undefined} quant
 * @returns {string}
 */
export function resolveDetailProfileIdFromSerialized(quant) {
  if (!quant || typeof quant !== "object") {
    return DEFAULT_DETAIL_PROFILE_ID;
  }
  if (isValidDetailProfileId(quant.detailProfileId)) {
    return /** @type {string} */ (quant.detailProfileId);
  }
  if (quant.resolutionPxPerMm != null) {
    return migrateLegacyPixelsPerMm(quant.resolutionPxPerMm);
  }
  return DEFAULT_DETAIL_PROFILE_ID;
}
