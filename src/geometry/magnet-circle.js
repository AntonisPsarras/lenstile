/**
 * Magnet recess circle helpers (deterministic, no CSG).
 */

import { TILE_V1, MAGNET_CIRCLE_SEGMENTS } from "./tile-spec.js";

/**
 * Unit-circle sample points in XY, CCW from +X, length = segments.
 * Coordinates are exact expressions of cos/sin — deterministic for a given segment count.
 *
 * @param {number} [segments]
 * @returns {Array<{ x: number, y: number }>}
 */
export function unitCirclePoints(segments = MAGNET_CIRCLE_SEGMENTS) {
  if (!Number.isInteger(segments) || segments < 24) {
    throw new Error("magnet circle segments must be an integer ≥ 24");
  }
  /** @type {Array<{ x: number, y: number }>} */
  const pts = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    pts.push({ x: Math.cos(angle), y: Math.sin(angle) });
  }
  return pts;
}

/**
 * Circle points centered at (cx, cy) with radius r.
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} [segments]
 */
export function circlePoints(cx, cy, radius, segments = MAGNET_CIRCLE_SEGMENTS) {
  return unitCirclePoints(segments).map((p) => ({
    x: cx + p.x * radius,
    y: cy + p.y * radius,
  }));
}

/**
 * Ray from center through (ux, uy) on unit circle → intersection with axis-aligned square
 * of half-extent `half` centered at origin (local coords).
 * @param {number} ux
 * @param {number} uy
 * @param {number} half
 */
export function raySquareIntersection(ux, uy, half) {
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  if (ax >= ay) {
    const scale = half / ax;
    return { x: ux * scale, y: uy * scale };
  }
  const scale = half / ay;
  return { x: ux * scale, y: uy * scale };
}

/**
 * Default magnet radius from Tile V1.
 * @param {typeof TILE_V1} [tile]
 */
export function magnetRadiusMm(tile = TILE_V1) {
  return tile.magnetRadiusMm ?? tile.magnetDiameterMm / 2;
}

/**
 * Max radial distance of polygonal approximation from true circle (chord error).
 * @param {number} radius
 * @param {number} segments
 */
export function circleChordError(radius, segments) {
  const half = Math.PI / segments;
  return radius * (1 - Math.cos(half));
}
