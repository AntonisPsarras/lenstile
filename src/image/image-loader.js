/**
 * Local image loading via File APIs and createImageBitmap.
 */

import {
  validateImageFileMeta,
  checkImageSizeWarning,
} from "../validation.js";

/**
 * @typedef {object} LoadedImage
 * @property {string} fileName
 * @property {string | null} mimeType
 * @property {number} widthPx
 * @property {number} heightPx
 * @property {ImageBitmap | HTMLImageElement} bitmap
 * @property {string | null} warning
 */

/**
 * @param {File} file
 * @returns {Promise<LoadedImage>}
 */
export async function loadImageFile(file) {
  if (!file) {
    throw new Error("Empty file selection.");
  }

  const meta = validateImageFileMeta(file.type, file.name);
  if (!meta.ok) {
    throw new Error(meta.reason);
  }

  const bitmap = await decodeImageFile(file);
  const widthPx = bitmap.width;
  const heightPx = bitmap.height;

  if (!widthPx || !heightPx) {
    throw new Error("Decoded image has invalid dimensions.");
  }

  const sizeCheck = checkImageSizeWarning(widthPx, heightPx);

  return {
    fileName: file.name,
    mimeType: file.type || null,
    widthPx,
    heightPx,
    bitmap,
    warning: sizeCheck.message,
  };
}

/**
 * @param {File} file
 * @returns {Promise<ImageBitmap | HTMLImageElement>}
 */
async function decodeImageFile(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch (err) {
      console.error("createImageBitmap failed; falling back to HTMLImageElement", err);
    }
  }
  return decodeViaHtmlImage(file);
}

/**
 * @param {File} file
 * @returns {Promise<HTMLImageElement>}
 */
function decodeViaHtmlImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to decode image "${file.name}".`));
    };
    img.src = url;
  });
}
