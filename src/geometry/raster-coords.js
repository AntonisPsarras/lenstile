/**
 * Raster ↔ physical millimetre coordinate mapping for Tile V1 artwork.
 *
 * Convention (documented and used everywhere):
 * - Column 0 begins at X = bounds.minX (−74 mm)
 * - Row 0 begins at Y = bounds.maxY (+26.5 mm)
 * - Raster rows proceed downward toward negative Y
 *
 * cellWidthMm  = tileWidth / width
 * cellHeightMm = tileHeight / height
 */

import { TILE_V1 } from "./tile-spec.js";

/**
 * @typedef {object} RasterMapping
 * @property {number} width
 * @property {number} height
 * @property {number} cellWidthMm
 * @property {number} cellHeightMm
 * @property {number} minX
 * @property {number} maxX
 * @property {number} minY
 * @property {number} maxY
 */

/**
 * @param {number} width
 * @param {number} height
 * @param {typeof TILE_V1} [tile]
 * @returns {RasterMapping}
 */
export function createRasterMapping(width, height, tile = TILE_V1) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("createRasterMapping requires positive integer width/height");
  }
  return {
    width,
    height,
    cellWidthMm: tile.widthMm / width,
    cellHeightMm: tile.heightMm / height,
    minX: tile.boundsMm.minX,
    maxX: tile.boundsMm.maxX,
    minY: tile.boundsMm.minY,
    maxY: tile.boundsMm.maxY,
  };
}

/**
 * Left X of a pixel column (grid line ix = col).
 * @param {RasterMapping} mapping
 * @param {number} col
 */
export function pixelLeftX(mapping, col) {
  return mapping.minX + col * mapping.cellWidthMm;
}

/**
 * Right X of a pixel column.
 * @param {RasterMapping} mapping
 * @param {number} col
 */
export function pixelRightX(mapping, col) {
  return mapping.minX + (col + 1) * mapping.cellWidthMm;
}

/**
 * Top Y of a pixel row (row 0 at +Y). Grid line iy = row.
 * @param {RasterMapping} mapping
 * @param {number} row
 */
export function pixelTopY(mapping, row) {
  return mapping.maxY - row * mapping.cellHeightMm;
}

/**
 * Bottom Y of a pixel row (toward −Y).
 * @param {RasterMapping} mapping
 * @param {number} row
 */
export function pixelBottomY(mapping, row) {
  return mapping.maxY - (row + 1) * mapping.cellHeightMm;
}

/**
 * Physical cuboid for a pixel-aligned rectangle.
 * @param {RasterMapping} mapping
 * @param {number} x0Pixel
 * @param {number} y0Pixel
 * @param {number} widthPixels
 * @param {number} heightPixels
 * @param {number} zMin
 * @param {number} zMax
 */
export function rectangleToCuboidMm(
  mapping,
  x0Pixel,
  y0Pixel,
  widthPixels,
  heightPixels,
  zMin,
  zMax,
) {
  const minX = pixelLeftX(mapping, x0Pixel);
  const maxX = pixelLeftX(mapping, x0Pixel + widthPixels);
  const maxY = pixelTopY(mapping, y0Pixel);
  const minY = pixelTopY(mapping, y0Pixel + heightPixels);
  return { minX, maxX, minY, maxY, minZ: zMin, maxZ: zMax };
}
