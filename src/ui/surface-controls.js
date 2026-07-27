/**
 * Download-step surface style controls (Flat / Relief).
 */

import {
  getState,
  getRuntimeQuantization,
  getRuntimePrintability,
  patchSurface,
  isPrintabilityExportReady,
} from "../state.js";
import {
  RELIEF,
  resolveColorTopHeights,
  levelLabelsForCount,
  normalizeReliefStrengthId,
} from "../geometry/relief.js";
import { buildPaletteEntries } from "../image/palette.js";
import { usedPaletteIndices } from "../geometry/mask-to-rectangles.js";
import { ensureModelAfterApproval } from "../workflow/pipeline.js";

/** Max canvas edge for the relief height preview (keeps UI responsive on large masks). */
const RELIEF_PREVIEW_MAX_EDGE_PX = 160;

/** Relief editor subview is open (Edit relief was clicked). */
let reliefEditorOpen = false;
let heightPreviewRenderScheduled = false;
/** @type {number} */
let heightPreviewRenderToken = 0;

/**
 * @returns {boolean}
 */
export function isReliefEditorOpen() {
  return reliefEditorOpen;
}

/**
 * @param {boolean} open
 */
export function setReliefEditorOpen(open) {
  reliefEditorOpen = Boolean(open);
  if (!reliefEditorOpen) {
    heightPreviewRenderToken += 1;
    heightPreviewRenderScheduled = false;
  }
}

/**
 * Render relief-editor controls that can be expensive on large masks.
 * Call when opening the editor or after surface settings change while open.
 * @param {HTMLElement} root
 */
export function renderReliefEditorHeavy(root) {
  const s = getState();
  if (s.surface.style !== "relief" || !reliefEditorOpen) return;
  const resolved = getResolvedSurfaceHeights();
  renderColorHeightList(root, resolved);
  renderHeightPreview(root, resolved);
  renderTechnicalHeights(root, resolved);
}

/**
 * Schedule a coalesced height-preview repaint (avoids blocking clicks during model build).
 * @param {HTMLElement} root
 * @param {ReturnType<typeof resolveColorTopHeights> | null} resolved
 */
function scheduleHeightPreviewRender(root, resolved) {
  if (!reliefEditorOpen) return;
  const token = ++heightPreviewRenderToken;
  if (heightPreviewRenderScheduled) return;
  heightPreviewRenderScheduled = true;
  requestAnimationFrame(() => {
    heightPreviewRenderScheduled = false;
    if (token !== heightPreviewRenderToken || !reliefEditorOpen) return;
    if (getState().surface.style !== "relief") return;
    renderHeightPreview(root, resolved ?? getResolvedSurfaceHeights());
  });
}

function maybeRebuildModelAfterSurfaceChange() {
  if (!isPrintabilityExportReady()) return;
  void ensureModelAfterApproval();
}

/**
 * @returns {{ r: number, g: number, b: number }[]}
 */
function effectivePaletteColors() {
  const s = getState();
  const rq = getRuntimeQuantization();
  const entries = buildPaletteEntries(rq.generatedPalette, s.quantization.paletteOverrides);
  return entries.map((e) => e.override || e.generated);
}

/**
 * @returns {ReturnType<typeof resolveColorTopHeights> | null}
 */
export function getResolvedSurfaceHeights() {
  const s = getState();
  const rp = getRuntimePrintability();
  if (!rp.cleanedIndices || !rp.width || !rp.height) return null;
  return resolveColorTopHeights({
    style: s.surface.style,
    reliefStrengthId: s.surface.reliefStrengthId,
    heightOrder: s.surface.heightOrder,
    colorHeightLevels: s.surface.colorHeightLevels,
    indices: rp.cleanedIndices,
    effectivePalette: effectivePaletteColors(),
  });
}

/**
 * Ensure custom levels exist for all used colors when switching to custom order.
 */
export function ensureCustomLevelsFromAutomatic() {
  const s = getState();
  const resolved = getResolvedSurfaceHeights();
  if (!resolved || !resolved.ok) return;
  /** @type {Array<{ paletteIndex: number, levelIndex: number }>} */
  const levels = [];
  for (const idx of resolved.usedIndices) {
    levels.push({
      paletteIndex: idx,
      levelIndex: resolved.levelIndexByPaletteIndex.get(idx) ?? 0,
    });
  }
  patchSurface({
    heightOrder: "custom",
    colorHeightLevels: levels,
  });
}

/**
 * @param {number} paletteIndex
 * @param {"up" | "down"} direction
 */
export function moveCustomColorOrder(paletteIndex, direction) {
  const s = getState();
  const resolved = getResolvedSurfaceHeights();
  if (!resolved) return;
  const levels = s.surface.colorHeightLevels.map((e) => ({ ...e }));
  const usedSet = new Set(resolved.usedIndices);
  for (const idx of resolved.usedIndices) {
    if (!levels.some((e) => e.paletteIndex === idx)) {
      levels.push({
        paletteIndex: idx,
        levelIndex: resolved.levelIndexByPaletteIndex.get(idx) ?? 0,
      });
    }
  }
  const filtered = levels.filter((e) => usedSet.has(e.paletteIndex));
  filtered.sort((a, b) => {
    if (a.levelIndex !== b.levelIndex) return b.levelIndex - a.levelIndex;
    return a.paletteIndex - b.paletteIndex;
  });
  const i = filtered.findIndex((e) => e.paletteIndex === paletteIndex);
  if (i < 0) return;
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= filtered.length) return;
  const tmp = filtered[i].levelIndex;
  filtered[i].levelIndex = filtered[j].levelIndex;
  filtered[j].levelIndex = tmp;
  // If same level, swap ordering by bumping one level when possible
  if (filtered[i].levelIndex === filtered[j].levelIndex) {
    if (direction === "up" && filtered[i].levelIndex < resolved.levelCount - 1) {
      filtered[i].levelIndex += 1;
    } else if (direction === "down" && filtered[i].levelIndex > 0) {
      filtered[i].levelIndex -= 1;
    }
  }
  patchSurface({ heightOrder: "custom", colorHeightLevels: filtered });
}

/**
 * @param {number} paletteIndex
 * @param {number} levelIndex
 */
export function setCustomColorLevel(paletteIndex, levelIndex) {
  const s = getState();
  const resolved = getResolvedSurfaceHeights();
  if (!resolved) return;
  const max = Math.max(0, resolved.levelCount - 1);
  const nextLevel = Math.max(0, Math.min(max, levelIndex));
  const map = new Map(s.surface.colorHeightLevels.map((e) => [e.paletteIndex, e.levelIndex]));
  for (const idx of resolved.usedIndices) {
    if (!map.has(idx)) map.set(idx, resolved.levelIndexByPaletteIndex.get(idx) ?? 0);
  }
  map.set(paletteIndex, nextLevel);
  patchSurface({
    heightOrder: "custom",
    colorHeightLevels: [...map.entries()].map(([paletteIndex, levelIndex]) => ({
      paletteIndex,
      levelIndex,
    })),
  });
}

export function resetAutomaticHeightOrder() {
  patchSurface({
    heightOrder: "darkest-highest",
    colorHeightLevels: [],
  });
}

/**
 * @param {HTMLElement} root
 */
export function renderSurfaceControls(root) {
  const s = getState();
  const relief = s.surface.style === "relief";
  const resolved = getResolvedSurfaceHeights();

  const styleFlat = /** @type {HTMLInputElement|null} */ (root.querySelector("#surface-style-flat"));
  const styleRelief = /** @type {HTMLInputElement|null} */ (root.querySelector("#surface-style-relief"));
  if (styleFlat) styleFlat.checked = s.surface.style === "flat";
  if (styleRelief) styleRelief.checked = relief;

  const strength = normalizeReliefStrengthId(s.surface.reliefStrengthId);

  // Relief controls only exist while Relief surface is selected.
  const reliefEditor = root.querySelector("#export-relief-editor");
  const reliefDropdown = root.querySelector(".relief-dropdown");
  const summaryRow = root.querySelector("#relief-summary-row");
  if (!relief && reliefEditorOpen) {
    setReliefEditorOpen(false);
  }
  if (summaryRow instanceof HTMLElement) {
    summaryRow.hidden = !relief;
  }
  if (reliefDropdown instanceof HTMLElement) {
    reliefDropdown.hidden = !relief;
  }
  if (reliefEditor instanceof HTMLElement) {
    reliefEditor.hidden = !relief || !reliefEditorOpen;
  }
  const editReliefBtn = root.querySelector("#btn-edit-relief");
  if (editReliefBtn instanceof HTMLElement) {
    editReliefBtn.setAttribute("aria-expanded", relief && reliefEditorOpen ? "true" : "false");
    editReliefBtn.classList.toggle("is-active", relief && reliefEditorOpen);
  }
  const reliefPanel = root.querySelector("#surface-relief-controls");
  if (reliefPanel instanceof HTMLElement) {
    reliefPanel.hidden = !relief;
  }
  // Main Download view uses the summary row instead of inline controls.
  const summaryText = root.querySelector("#relief-summary-text");
  if (summaryText instanceof HTMLElement && relief) {
    const strengthLabel = strength === "subtle"
      ? "Subtle"
      : (strength === "bold" ? "Bold" : "Standard");
    const orderLabel = s.surface.heightOrder === "lightest-highest"
      ? "Lightest areas highest"
      : (s.surface.heightOrder === "custom"
        ? "Custom order"
        : "Darkest areas highest");
    const levels = resolved && resolved.ok ? resolved.levelCount : 0;
    const levelPart = levels > 0 ? ` · ${levels} height level${levels === 1 ? "" : "s"}` : "";
    summaryText.textContent = `Relief: ${strengthLabel} · ${orderLabel}${levelPart}`;
  } else if (summaryText instanceof HTMLElement) {
    summaryText.textContent = "";
  }
  for (const id of ["subtle", "standard", "bold"]) {
    const input = /** @type {HTMLInputElement|null} */ (
      root.querySelector(`#relief-strength-${id}`)
    );
    if (input) input.checked = strength === id;
  }

  for (const id of ["darkest-highest", "lightest-highest", "custom"]) {
    const input = /** @type {HTMLInputElement|null} */ (
      root.querySelector(`#height-order-${id}`)
    );
    if (input) input.checked = s.surface.heightOrder === id;
  }

  const notice = root.querySelector("#surface-share-notice");
  if (notice instanceof HTMLElement) {
    const show = Boolean(relief && resolved && resolved.colorsShareLevels);
    notice.hidden = !show;
    if (show) {
      notice.textContent = "Some colors share the same height because this design uses more than four colors.";
    }
  }

  const summary = root.querySelector("#surface-height-summary");
  if (summary instanceof HTMLElement) {
    if (!relief || !resolved || !resolved.ok || !resolved.levelCount) {
      summary.textContent = "";
    } else {
      const lo = resolved.heightsFromLow[0];
      const hi = resolved.heightsFromLow[resolved.heightsFromLow.length - 1];
      const parts = [
        `${resolved.levelCount} height level${resolved.levelCount === 1 ? "" : "s"} from ${lo} to ${hi} mm.`,
      ];
      if (s.surface.heightOrder === "darkest-highest") {
        parts.push("Colors are ordered with darker colors raised higher.");
      } else if (s.surface.heightOrder === "lightest-highest") {
        parts.push("Colors are ordered with lighter colors raised higher.");
      } else {
        parts.push("Colors use your custom height order.");
      }
      if (resolved.colorsShareLevels) {
        parts.push("Two or more colors share the same height.");
      }
      summary.textContent = parts.join(" ");
    }
  }

  const guidance = root.querySelector("#surface-relief-guidance");
  if (guidance instanceof HTMLElement) {
    guidance.hidden = !relief;
  }

  // Heavy editor UI (color list, height preview, technical heights) only while the
  // contained relief editor is open. Rendering on every workflow tick blocked clicks.
  if (reliefEditorOpen && relief) {
    renderColorHeightList(root, resolved);
    scheduleHeightPreviewRender(root, resolved);
    renderTechnicalHeights(root, resolved);
  }
}

/**
 * @param {HTMLElement} root
 * @param {ReturnType<typeof resolveColorTopHeights> | null} resolved
 */
function renderColorHeightList(root, resolved) {
  const list = root.querySelector("#surface-color-height-list");
  if (!(list instanceof HTMLElement)) return;
  list.innerHTML = "";
  const s = getState();
  if (s.surface.style !== "relief" || !resolved || !resolved.ok) return;

  const palette = effectivePaletteColors();
  const labels = levelLabelsForCount(resolved.levelCount);
  const custom = s.surface.heightOrder === "custom";

  const ordered = resolved.orderedHighestFirst.slice();
  for (const paletteIndex of ordered) {
    const color = palette[paletteIndex] || { r: 0, g: 0, b: 0 };
    const level = resolved.levelIndexByPaletteIndex.get(paletteIndex) ?? 0;
    const z = resolved.topHeightByPaletteIndex.get(paletteIndex);
    const hex = rgbHex(color.r, color.g, color.b);

    const row = document.createElement("div");
    row.className = "surface-color-row";

    const swatch = document.createElement("span");
    swatch.className = "surface-swatch";
    swatch.style.background = hex;
    swatch.title = hex;

    const meta = document.createElement("div");
    meta.className = "surface-color-meta";
    const hexEl = document.createElement("code");
    hexEl.textContent = hex;
    const levelEl = document.createElement("span");
    levelEl.textContent = labels[level] || `Level ${level + 1}`;
    meta.append(hexEl, document.createTextNode(" · "), levelEl);

    row.append(swatch, meta);

    if (custom) {
      const actions = document.createElement("div");
      actions.className = "surface-color-actions";
      const up = document.createElement("button");
      up.type = "button";
      up.className = "button button-secondary";
      up.textContent = "Move up";
      up.addEventListener("click", () => moveCustomColorOrder(paletteIndex, "up"));
      const down = document.createElement("button");
      down.type = "button";
      down.className = "button button-secondary";
      down.textContent = "Move down";
      down.addEventListener("click", () => moveCustomColorOrder(paletteIndex, "down"));
      const select = document.createElement("select");
      select.setAttribute("aria-label", `Height level for ${hex}`);
      for (let i = 0; i < resolved.levelCount; i += 1) {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = labels[i] || String(i);
        if (i === level) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener("change", () => {
        setCustomColorLevel(paletteIndex, Number(select.value));
      });
      actions.append(up, down, select);
      row.appendChild(actions);
    } else if (z != null) {
      const zHint = document.createElement("span");
      zHint.className = "mono-meta";
      zHint.hidden = true;
      zHint.dataset.techZ = String(z);
      row.appendChild(zHint);
    }

    list.appendChild(row);
  }
}

/**
 * @param {HTMLElement} root
 * @param {ReturnType<typeof resolveColorTopHeights> | null} resolved
 */
function renderHeightPreview(root, resolved) {
  const canvas = /** @type {HTMLCanvasElement|null} */ (
    root.querySelector("#surface-height-preview")
  );
  const legend = root.querySelector("#surface-height-legend");
  const wrap = root.querySelector("#surface-height-preview-wrap");
  if (wrap instanceof HTMLElement) {
    wrap.hidden = getState().surface.style !== "relief";
  }
  if (!canvas || !(legend instanceof HTMLElement)) return;
  legend.innerHTML = "";
  const s = getState();
  const rp = getRuntimePrintability();
  if (s.surface.style !== "relief" || !resolved || !resolved.ok || !rp.cleanedIndices) {
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const width = rp.width;
  const height = rp.height;
  const aspect = width / height;
  let canvasW;
  let canvasH;
  if (width >= height) {
    canvasW = RELIEF_PREVIEW_MAX_EDGE_PX;
    canvasH = Math.max(1, Math.round(RELIEF_PREVIEW_MAX_EDGE_PX / aspect));
  } else {
    canvasH = RELIEF_PREVIEW_MAX_EDGE_PX;
    canvasW = Math.max(1, Math.round(RELIEF_PREVIEW_MAX_EDGE_PX * aspect));
  }
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const minZ = resolved.heightsFromLow[0] ?? RELIEF.minTopZMm;
  const maxZ = resolved.heightsFromLow[resolved.heightsFromLow.length - 1] ?? RELIEF.maxTopZMm;
  const span = Math.max(1e-9, maxZ - minZ);
  const indices = rp.cleanedIndices;

  for (let py = 0; py < canvasH; py += 1) {
    const row = Math.min(height - 1, Math.floor((py * height) / canvasH));
    for (let px = 0; px < canvasW; px += 1) {
      const col = Math.min(width - 1, Math.floor((px * width) / canvasW));
      const idx = indices[row * width + col];
      const z = resolved.topHeightByPaletteIndex.get(idx) ?? maxZ;
      const t = (z - minZ) / span;
      const g = Math.round(40 + t * 200);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(px, py, 1, 1);
    }
  }

  const palette = effectivePaletteColors();
  const labels = levelLabelsForCount(resolved.levelCount);
  const table = document.createElement("table");
  table.className = "surface-legend-table";
  const head = document.createElement("tr");
  for (const label of ["Color", "Height level", "Top height"]) {
    const th = document.createElement("th");
    th.textContent = label;
    head.appendChild(th);
  }
  table.appendChild(head);
  for (const paletteIndex of resolved.orderedHighestFirst) {
    const color = palette[paletteIndex] || { r: 0, g: 0, b: 0 };
    const level = resolved.levelIndexByPaletteIndex.get(paletteIndex) ?? 0;
    const z = resolved.topHeightByPaletteIndex.get(paletteIndex);
    const tr = document.createElement("tr");
    const tdC = document.createElement("td");
    const sw = document.createElement("span");
    sw.className = "surface-swatch surface-swatch-sm";
    sw.style.background = rgbHex(color.r, color.g, color.b);
    tdC.appendChild(sw);
    const tdL = document.createElement("td");
    tdL.textContent = labels[level] || String(level);
    const tdZ = document.createElement("td");
    tdZ.textContent = z != null ? `${z} mm` : "—";
    tr.append(tdC, tdL, tdZ);
    table.appendChild(tr);
  }
  legend.appendChild(table);
}

/**
 * @param {HTMLElement} root
 * @param {ReturnType<typeof resolveColorTopHeights> | null} resolved
 */
function renderTechnicalHeights(root, resolved) {
  const el = root.querySelector("#surface-tech-heights");
  if (!(el instanceof HTMLElement)) return;
  if (!resolved || getState().surface.style !== "relief") {
    el.textContent = "";
    return;
  }
  const lines = resolved.orderedHighestFirst.map((idx) => {
    const z = resolved.topHeightByPaletteIndex.get(idx);
    const level = resolved.levelIndexByPaletteIndex.get(idx);
    return `color ${idx}: level ${level}, top Z ${z} mm`;
  });
  el.textContent = lines.join("\n");
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 */
function rgbHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * @param {ParentNode} root
 */
export function bindSurfaceControls(root) {
  root.querySelectorAll('input[name="surface-style"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!(input instanceof HTMLInputElement) || !input.checked) return;
      if (input.value !== "relief") {
        setReliefEditorOpen(false);
      }
      patchSurface({ style: input.value === "relief" ? "relief" : "flat" });
      renderSurfaceControls(root);
      maybeRebuildModelAfterSurfaceChange();
    });
  });
  root.querySelectorAll('input[name="relief-strength"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!(input instanceof HTMLInputElement) || !input.checked) return;
      patchSurface({ reliefStrengthId: normalizeReliefStrengthId(input.value) });
      maybeRebuildModelAfterSurfaceChange();
    });
  });
  root.querySelectorAll('input[name="height-order"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!(input instanceof HTMLInputElement) || !input.checked) return;
      if (input.value === "custom") {
        ensureCustomLevelsFromAutomatic();
      } else {
        patchSurface({
          heightOrder: /** @type {"darkest-highest"|"lightest-highest"} */ (input.value),
          colorHeightLevels: [],
        });
      }
      maybeRebuildModelAfterSurfaceChange();
    });
  });
  root.querySelector("#btn-reset-height-order")?.addEventListener("click", () => {
    resetAutomaticHeightOrder();
    maybeRebuildModelAfterSurfaceChange();
  });
}

export function describeUsedPaletteForSurface() {
  const rp = getRuntimePrintability();
  if (!rp.cleanedIndices) return [];
  return usedPaletteIndices(rp.cleanedIndices);
}
