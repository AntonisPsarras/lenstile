/**
 * Canvas crop preview renderer. Separated from state updates; call scheduleRedraw().
 */

import { computeCropRect } from "./crop-transform.js";
import { TILE_V1 } from "../geometry/tile-spec.js";

/**
 * @typedef {import("../state.js").AppState} AppState
 * @typedef {import("./crop-transform.js").Transform} Transform
 */

/**
 * Whether magnet guides should draw for the active workflow step.
 * Image: visible. Colors / Make printable / Download: hidden by default.
 * @param {string | null | undefined} activeStep
 * @param {{ forceShow?: boolean }} [opts]
 * @returns {boolean}
 */
export function shouldShowMagnetGuides(activeStep, opts = {}) {
  if (opts.forceShow) return true;
  return activeStep === "image";
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {AppState} opts.state
 * @param {ImageBitmap | HTMLImageElement | null} opts.bitmap
 * @param {number} opts.cssWidth
 * @param {number} opts.cssHeight
 * @param {boolean} [opts.showMagnetGuides]
 */
export function renderCropPreview(canvas, opts) {
  const { state, bitmap, cssWidth, cssHeight } = opts;
  const showGuides = opts.showMagnetGuides != null
    ? Boolean(opts.showMagnetGuides)
    : shouldShowMagnetGuides(state.ui?.activeStep);
  if (!canvas || cssWidth < 1 || cssHeight < 1) {
    throw new Error("Canvas render failed: invalid canvas size.");
  }

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const pixelW = Math.max(1, Math.round(cssWidth * dpr));
  const pixelH = Math.max(1, Math.round(cssHeight * dpr));

  if (canvas.width !== pixelW) canvas.width = pixelW;
  if (canvas.height !== pixelH) canvas.height = pixelH;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas render failed: 2D context unavailable.");
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  // Workspace background
  ctx.fillStyle = getCssVar("--color-surface-recessed", "#0c0c0b");
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const crop = computeCropRect(cssWidth, cssHeight);
  const radius = cornerRadiusPx(crop, state.tile.cornerRadiusMm);

  if (!bitmap) {
    drawEmptyState(ctx, crop, radius, cssWidth, cssHeight);
    drawCropFrame(ctx, crop, radius);
    drawDimensionLabel(ctx, crop);
    return crop;
  }

  // Draw image clipped to rounded crop
  ctx.save();
  roundedRectPath(ctx, crop.x, crop.y, crop.width, crop.height, radius);
  ctx.clip();
  drawTransformedImage(ctx, bitmap, state.transform, crop);
  ctx.restore();

  // Dim outside crop
  ctx.save();
  ctx.fillStyle = getCssVar("--color-overlay-dim", "rgba(12, 12, 11, 0.62)");
  ctx.beginPath();
  ctx.rect(0, 0, cssWidth, cssHeight);
  roundedRectPath(ctx, crop.x, crop.y, crop.width, crop.height, radius);
  ctx.fill("evenodd");
  ctx.restore();

  drawCropFrame(ctx, crop, radius);
  if (showGuides) {
    drawMagnetGuides(ctx, crop, state);
  }
  drawDimensionLabel(ctx, crop);

  return crop;
}

/**
 * Apply the editor image transform and draw into a crop frame.
 * Shared by the live preview and crop rasterization for quantization.
 *
 * @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} ctx
 * @param {ImageBitmap | HTMLImageElement | HTMLCanvasElement} bitmap
 * @param {Transform} transform
 * @param {{ x: number, y: number, width: number, height: number }} crop
 */
export function drawTransformedImage(ctx, bitmap, transform, crop) {
  const cx = crop.x + crop.width / 2;
  const cy = crop.y + crop.height / 2;

  ctx.save();
  ctx.translate(cx + transform.offsetX, cy + transform.offsetY);
  ctx.rotate((transform.rotationDeg * Math.PI) / 180);
  ctx.scale(transform.flipX ? -transform.scale : transform.scale, transform.flipY ? -transform.scale : transform.scale);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number, width: number, height: number }} crop
 * @param {number} radius
 * @param {number} cssWidth
 * @param {number} cssHeight
 */
function drawEmptyState(ctx, crop, radius, _cssWidth, _cssHeight) {
  // Empty-state copy lives in the accessible DOM drop zone (#image-drop-zone).
  ctx.save();
  roundedRectPath(ctx, crop.x, crop.y, crop.width, crop.height, radius);
  ctx.fillStyle = getCssVar("--color-surface-elevated", "#201d18");
  ctx.fill();
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number, width: number, height: number }} crop
 * @param {number} radius
 */
function drawCropFrame(ctx, crop, radius) {
  ctx.save();
  roundedRectPath(ctx, crop.x, crop.y, crop.width, crop.height, radius);
  ctx.strokeStyle = getCssVar("--color-crop-frame", "#eee8dc");
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number, width: number, height: number }} crop
 * @param {AppState} state
 */
function drawMagnetGuides(ctx, crop, state) {
  const ppm = crop.width / state.tile.widthMm;
  const cx = crop.x + crop.width / 2;
  const cy = crop.y + crop.height / 2;
  const r = (state.tile.magnetDiameterMm / 2) * ppm;

  ctx.save();
  ctx.strokeStyle = getCssVar("--color-magnet-guide", "rgba(216, 154, 61, 0.45)");
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const m of state.tile.magnetCentersMm) {
    ctx.beginPath();
    ctx.arc(cx + m.x * ppm, cy - m.y * ppm, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number, width: number, height: number }} crop
 */
function drawDimensionLabel(ctx, crop) {
  const label = `${TILE_V1.widthMm} × ${TILE_V1.heightMm} × ${TILE_V1.totalThicknessMm} mm`;
  ctx.save();
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const x = crop.x + crop.width / 2;
  const y = crop.y + crop.height + 10;
  ctx.fillStyle = getCssVar("--color-text-muted", "#91887a");
  ctx.fillText(label, x, y);
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (radius <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * @param {{ width: number, height: number }} crop
 * @param {number} cornerRadiusMm
 */
function cornerRadiusPx(crop, cornerRadiusMm) {
  // Tile V1 has sharp corners (radius 0). Do not invent visual fillets.
  if (!cornerRadiusMm || cornerRadiusMm <= 0) {
    return 0;
  }
  return (cornerRadiusMm / TILE_V1.widthMm) * crop.width;
}

/** @param {string} name @param {string} fallback */
function getCssVar(name, fallback) {
  if (typeof getComputedStyle === "undefined" || typeof document === "undefined") {
    return fallback;
  }
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Create a redraw scheduler using requestAnimationFrame.
 * @param {() => void} draw
 */
export function createRedrawScheduler(draw) {
  let frame = 0;
  return function scheduleRedraw() {
    if (frame) return;
    const raf = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16);
    frame = raf(() => {
      frame = 0;
      draw();
    });
  };
}
