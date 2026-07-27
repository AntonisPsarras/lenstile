/**
 * Download adapter — production vs test injection.
 *
 * Production may trigger a browser download only from a direct user action
 * (one click → one download). Tests must inject the recording adapter and
 * never open a Save As dialog or click a download anchor.
 */

/**
 * @typedef {{
 *   filename: string,
 *   mimeType: string,
 *   byteLength: number,
 *   blob: Blob,
 * }} DownloadRecord
 */

/**
 * @typedef {{
 *   downloadBlob: (blob: Blob, filename: string) => void,
 *   getInvocationCount?: () => number,
 *   getRecords?: () => DownloadRecord[],
 *   reset?: () => void,
 * }} DownloadAdapter
 */

/**
 * Production adapter: createObjectURL + temporary anchor click + revoke.
 * Must only be invoked from a real user gesture handler.
 *
 * @param {Blob} blob
 * @param {string} filename
 */
export function productionDownloadBlob(blob, filename) {
  if (!(blob instanceof Blob)) {
    throw new Error("productionDownloadBlob requires a Blob.");
  }
  if (typeof filename !== "string" || !filename) {
    throw new Error("productionDownloadBlob requires a non-empty filename.");
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has a chance to start the download
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/**
 * Create an in-memory test adapter that never triggers browser download UI.
 * @returns {DownloadAdapter & {
 *   getInvocationCount: () => number,
 *   getRecords: () => DownloadRecord[],
 *   reset: () => void,
 * }}
 */
export function createTestDownloadAdapter() {
  /** @type {DownloadRecord[]} */
  const records = [];

  return {
    downloadBlob(blob, filename) {
      if (!(blob instanceof Blob)) {
        throw new Error("test downloadBlob requires a Blob.");
      }
      if (typeof filename !== "string" || !filename) {
        throw new Error("test downloadBlob requires a non-empty filename.");
      }
      records.push({
        filename,
        mimeType: blob.type || "",
        byteLength: blob.size,
        blob,
      });
    },
    getInvocationCount() {
      return records.length;
    },
    getRecords() {
      return records.slice();
    },
    reset() {
      records.length = 0;
    },
  };
}

/** @type {DownloadAdapter} */
let activeAdapter = {
  downloadBlob: productionDownloadBlob,
};

/**
 * Replace the active download adapter (tests inject the recording adapter).
 * @param {DownloadAdapter} adapter
 */
export function setDownloadAdapter(adapter) {
  if (!adapter || typeof adapter.downloadBlob !== "function") {
    throw new Error("setDownloadAdapter requires an adapter with downloadBlob().");
  }
  activeAdapter = adapter;
}

/**
 * Restore the production download adapter.
 */
export function resetDownloadAdapter() {
  activeAdapter = {
    downloadBlob: productionDownloadBlob,
  };
}

/**
 * @returns {DownloadAdapter}
 */
export function getDownloadAdapter() {
  return activeAdapter;
}

/**
 * Trigger a file download through the active adapter.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  activeAdapter.downloadBlob(blob, filename);
}
