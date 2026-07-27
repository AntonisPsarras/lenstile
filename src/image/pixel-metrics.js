/**
 * Physical pixel metrics for printability analysis.
 * Separated to avoid circular imports between analysis and cleanup modules.
 */

import { TILE_V1 } from "../geometry/tile-spec.js";

/**
 * @typedef {object} PixelMetrics
 * @property {number} width
 * @property {number} height
 * @property {number} tileWidthMm
 * @property {number} tileHeightMm
 * @property {number} pxWidthMm
 * @property {number} pxHeightMm
 * @property {number} pixelAreaMm2
 */

/**
 * Convert indexed dimensions + tile size into physical pixel metrics.
 * All area / width comparisons must use these — never raw pixel counts alone.
 *
 * @param {number} width
 * @param {number} height
 * @param {object} [opts]
 * @param {number} [opts.tileWidthMm]
 * @param {number} [opts.tileHeightMm]
 * @returns {PixelMetrics}
 */
export function computePixelMetrics(width, height, opts = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("computePixelMetrics: width and height must be positive integers.");
  }
  const tileWidthMm = opts.tileWidthMm ?? TILE_V1.widthMm;
  const tileHeightMm = opts.tileHeightMm ?? TILE_V1.heightMm;
  const pxWidthMm = tileWidthMm / width;
  const pxHeightMm = tileHeightMm / height;
  return {
    width,
    height,
    tileWidthMm,
    tileHeightMm,
    pxWidthMm,
    pxHeightMm,
    pixelAreaMm2: pxWidthMm * pxHeightMm,
  };
}
