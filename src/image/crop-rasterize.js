/**
 * Rasterize the current crop into an opaque RGBA buffer at quantization size.
 * Clustering stays in the worker; this runs on the main thread.
 *
 * Transform convention matches the visible editor: offset/scale are in view pixels
 * relative to the crop frame. When rasterizing at a different pixel size, the
 * transform is scaled by outputWidth / viewCropWidth (tile aspect is preserved).
 */

import { drawTransformedImage } from "./crop-renderer.js";
import { compositeRgbaOverBackground, resolveBackgroundColor } from "./transparency.js";
import { QuantizeErrorCode, createQuantizeError, toError } from "./quantize-errors.js";

/**
 * @typedef {import("./crop-transform.js").Transform} Transform
 * @typedef {import("./transparency.js").TransparencyMode} TransparencyMode
 * @typedef {import("./transparency.js").Rgb} Rgb
 */

/**
 * Scale an editor transform from the preview crop size to the output size.
 * @param {Transform} transform
 * @param {{ width: number, height: number }} viewCrop
 * @param {{ width: number, height: number }} output
 * @returns {Transform}
 */
export function scaleTransformToOutput(transform, viewCrop, output) {
  if (viewCrop.width <= 0 || viewCrop.height <= 0) {
    throw toError(
      createQuantizeError(
        QuantizeErrorCode.RASTERIZE_FAILURE,
        "View crop size must be positive to rasterize.",
        { viewCrop },
      ),
    );
  }
  const sx = output.width / viewCrop.width;
  return {
    offsetX: transform.offsetX * sx,
    offsetY: transform.offsetY * sx,
    scale: transform.scale * sx,
    rotationDeg: transform.rotationDeg,
    flipX: transform.flipX,
    flipY: transform.flipY,
  };
}

/**
 * Render the crop into RGBA bytes at exact output dimensions, then composite transparency.
 *
 * @param {object} opts
 * @param {ImageBitmap | HTMLImageElement | HTMLCanvasElement} opts.bitmap
 * @param {Transform} opts.transform
 * @param {{ width: number, height: number }} opts.viewCropSize
 * @param {number} opts.widthPx
 * @param {number} opts.heightPx
 * @param {TransparencyMode} opts.transparencyMode
 * @param {Rgb} [opts.customBackground]
 * @returns {{ rgba: Uint8ClampedArray, width: number, height: number }}
 */
export function rasterizeCropToRgba(opts) {
  const {
    bitmap,
    transform,
    viewCropSize,
    widthPx,
    heightPx,
    transparencyMode,
    customBackground,
  } = opts;

  if (!bitmap) {
    throw toError(
      createQuantizeError(QuantizeErrorCode.NO_SOURCE_IMAGE, "No source image to rasterize."),
    );
  }
  if (!Number.isInteger(widthPx) || !Number.isInteger(heightPx) || widthPx < 1 || heightPx < 1) {
    throw toError(
      createQuantizeError(
        QuantizeErrorCode.INVALID_DIMENSIONS,
        "Rasterize width and height must be positive integers.",
        { widthPx, heightPx },
      ),
    );
  }

  const background = resolveBackgroundColor(transparencyMode, customBackground);
  const scaled = scaleTransformToOutput(
    transform,
    viewCropSize,
    { width: widthPx, height: heightPx },
  );

  const canvas = createRasterCanvas(widthPx, heightPx);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw toError(
      createQuantizeError(QuantizeErrorCode.RASTERIZE_FAILURE, "2D canvas context unavailable."),
    );
  }

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = `rgb(${background.r}, ${background.g}, ${background.b})`;
  ctx.fillRect(0, 0, widthPx, heightPx);

  const crop = { x: 0, y: 0, width: widthPx, height: heightPx };
  drawTransformedImage(ctx, bitmap, scaled, crop);

  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, widthPx, heightPx);
  } catch (err) {
    throw toError(
      createQuantizeError(
        QuantizeErrorCode.RASTERIZE_FAILURE,
        err instanceof Error ? err.message : "Failed to read rasterized pixels.",
      ),
    );
  }

  // Canvas may leave partial alpha from the source image; force opaque via compositing.
  const rgba = compositeRgbaOverBackground(imageData.data, background);

  return { rgba, width: widthPx, height: heightPx };
}

/**
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement | OffscreenCanvas}
 */
function createRasterCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw toError(
    createQuantizeError(
      QuantizeErrorCode.RASTERIZE_FAILURE,
      "No canvas implementation available for crop rasterization.",
    ),
  );
}
