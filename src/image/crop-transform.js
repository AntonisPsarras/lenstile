/**
 * Pure crop / view transform math for the tile image editor.
 *
 * Coordinate conventions:
 * - Crop frame is axis-aligned in view space with size (cropWidth × cropHeight) CSS pixels.
 * - Image is drawn centered on the crop, then translated by offset (view pixels),
 *   scaled, rotated, and flipped about the crop center.
 * - `scale` is the uniform scale applied to the image relative to its natural pixel size
 *   mapped into view pixels (1 = 1 image pixel → 1 CSS pixel before other fits).
 */

import { ZOOM_MAX, ZOOM_MIN } from "../config.js";
import { tileAspectRatio } from "../geometry/tile-spec.js";

/**
 * @typedef {{ offsetX: number, offsetY: number, scale: number, rotationDeg: number, flipX: boolean, flipY: boolean }} Transform
 * @typedef {{ width: number, height: number }} Size
 */

/**
 * Clamp zoom into allowed range.
 * @param {number} scale
 * @returns {number}
 */
export function clampScale(scale) {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

/**
 * Normalize rotation to {0, 90, 180, 270} for quarter turns.
 * Free rotation architecture: values outside multiples of 90 are preserved when allowed.
 * @param {number} deg
 * @param {{ snap90?: boolean }} [opts]
 */
export function normalizeRotationDeg(deg, opts = {}) {
  const snap90 = opts.snap90 !== false;
  if (!Number.isFinite(deg)) return 0;
  let r = ((deg % 360) + 360) % 360;
  if (snap90) {
    r = Math.round(r / 90) * 90;
    if (r === 360) r = 0;
  }
  return r;
}

/**
 * Axis-aligned size of the image after rotation by 0/90/180/270.
 * @param {Size} image
 * @param {number} rotationDeg
 * @returns {Size}
 */
export function rotatedImageSize(image, rotationDeg) {
  const r = normalizeRotationDeg(rotationDeg);
  if (r === 90 || r === 270) {
    return { width: image.height, height: image.width };
  }
  return { width: image.width, height: image.height };
}

/**
 * Compute crop rectangle size inside a viewport, preserving tile aspect ratio.
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 * @param {number} [padding]
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function computeCropRect(viewportWidth, viewportHeight, padding = 24) {
  const availW = Math.max(1, viewportWidth - padding * 2);
  const availH = Math.max(1, viewportHeight - padding * 2);
  const aspect = tileAspectRatio();

  let width = availW;
  let height = width / aspect;
  if (height > availH) {
    height = availH;
    width = height * aspect;
  }

  const x = (viewportWidth - width) / 2;
  const y = (viewportHeight - height) / 2;
  return { x, y, width, height };
}

/**
 * Scale so the entire rotated image fits inside the crop (letterbox).
 * @param {Size} image
 * @param {Size} crop
 * @param {number} rotationDeg
 * @returns {number}
 */
export function fitScale(image, crop, rotationDeg) {
  const size = rotatedImageSize(image, rotationDeg);
  if (size.width <= 0 || size.height <= 0) return 1;
  return clampScale(Math.min(crop.width / size.width, crop.height / size.height));
}

/**
 * Scale so the rotated image covers the crop (may crop image content).
 * @param {Size} image
 * @param {Size} crop
 * @param {number} rotationDeg
 * @returns {number}
 */
export function fillScale(image, crop, rotationDeg) {
  const size = rotatedImageSize(image, rotationDeg);
  if (size.width <= 0 || size.height <= 0) return 1;
  return clampScale(Math.max(crop.width / size.width, crop.height / size.height));
}

/**
 * Default transform when a new image loads: fit + centered.
 * @param {Size} image
 * @param {Size} crop
 * @returns {Transform}
 */
export function createResetTransform(image, crop) {
  return {
    offsetX: 0,
    offsetY: 0,
    scale: fitScale(image, crop, 0),
    rotationDeg: 0,
    flipX: false,
    flipY: false,
  };
}

/**
 * @param {Transform} transform
 * @param {Size} image
 * @param {Size} crop
 * @returns {Transform}
 */
export function applyFit(transform, image, crop) {
  return {
    ...transform,
    offsetX: 0,
    offsetY: 0,
    scale: fitScale(image, crop, transform.rotationDeg),
  };
}

/**
 * @param {Transform} transform
 * @param {Size} image
 * @param {Size} crop
 * @returns {Transform}
 */
export function applyFill(transform, image, crop) {
  return {
    ...transform,
    offsetX: 0,
    offsetY: 0,
    scale: fillScale(image, crop, transform.rotationDeg),
  };
}

/**
 * @param {Transform} transform
 * @param {number} deltaDeg
 * @param {{ snap90?: boolean }} [opts]
 * @returns {Transform}
 */
export function rotateBy(transform, deltaDeg, opts = {}) {
  return {
    ...transform,
    rotationDeg: normalizeRotationDeg(transform.rotationDeg + deltaDeg, opts),
  };
}

/**
 * @param {Transform} transform
 * @returns {Transform}
 */
export function flipHorizontal(transform) {
  return { ...transform, flipX: !transform.flipX };
}

/**
 * @param {Transform} transform
 * @returns {Transform}
 */
export function flipVertical(transform) {
  return { ...transform, flipY: !transform.flipY };
}

/**
 * @param {Transform} transform
 * @param {number} nextScale
 * @returns {Transform}
 */
export function setScale(transform, nextScale) {
  return { ...transform, scale: clampScale(nextScale) };
}

/**
 * Pan by view-space delta.
 * @param {Transform} transform
 * @param {number} dx
 * @param {number} dy
 * @returns {Transform}
 */
export function panBy(transform, dx, dy) {
  return {
    ...transform,
    offsetX: transform.offsetX + dx,
    offsetY: transform.offsetY + dy,
  };
}

/**
 * Keep the image from disappearing completely: ensure AABB of transformed image
 * still intersects the crop rect with a minimum overlap margin.
 * @param {Transform} transform
 * @param {Size} image
 * @param {Size} crop
 * @param {number} [minOverlapPx]
 * @returns {Transform}
 */
export function clampTransformToCrop(transform, image, crop, minOverlapPx = 32) {
  const size = rotatedImageSize(image, transform.rotationDeg);
  const w = size.width * transform.scale;
  const h = size.height * transform.scale;
  if (w <= 0 || h <= 0) return transform;

  // Image center starts at crop center + offset.
  // Image AABB in crop-local coords (origin at crop center):
  const halfW = w / 2;
  const halfH = h / 2;
  const cropHalfW = crop.width / 2;
  const cropHalfH = crop.height / 2;
  const margin = Math.min(minOverlapPx, cropHalfW, cropHalfH);

  const minOffsetX = -cropHalfW - halfW + margin;
  const maxOffsetX = cropHalfW + halfW - margin;
  const minOffsetY = -cropHalfH - halfH + margin;
  const maxOffsetY = cropHalfH + halfH - margin;

  return {
    ...transform,
    offsetX: Math.min(maxOffsetX, Math.max(minOffsetX, transform.offsetX)),
    offsetY: Math.min(maxOffsetY, Math.max(minOffsetY, transform.offsetY)),
  };
}

/**
 * Map millimetres to pixels given a crop width in CSS px and tile width in mm.
 * @param {number} cropWidthPx
 * @param {number} tileWidthMm
 */
export function pxPerMmForCrop(cropWidthPx, tileWidthMm) {
  if (tileWidthMm <= 0) return 0;
  return cropWidthPx / tileWidthMm;
}
