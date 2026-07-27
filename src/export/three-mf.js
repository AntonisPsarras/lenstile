/**
 * Standards-oriented 3MF package writer (Milestone 7.1 / 7.2).
 *
 * Packages already-validated Tile V1 meshes. Does not regenerate, repair,
 * merge, remesh, or mutate geometry buffers.
 *
 * Package layout (Store ZIP, forward slashes):
 *   [Content_Types].xml
 *   _rels/.rels
 *   3D/3dmodel.model
 *
 * Resource structure:
 *   1 — Materials-extension <m:colorgroup> (authoritative color intent)
 *   2 — Tile Base child mesh object
 *   3 — Tile Magnet Roof child mesh object (same base-color property)
 *   4+ — Artwork Color child mesh objects (used-palette order)
 *   last — parent multipart assembly (components only; one build item)
 *
 * Color model: official Materials and Properties extension color groups.
 * Core basematerials/displaycolor is not used for printable color intent.
 *
 * Property strategy (Option A): each uniformly colored child mesh object has
 *   pid={colorGroupId} pindex={dense color-group index}
 * Parent component objects must not carry pid/pindex.
 * Dense pindex values are not assumed equal to original palette indices.
 *
 * Extension declaration: recommendedextensions="m" (not required). Geometry
 * remains printable if a consumer ignores Materials; requiring the extension
 * would force unsupported consumers to reject the whole package.
 */

import { createZipStore } from "./zip-store.js";
import { escapeXml } from "./xml-escape.js";
import { multicolorThreeMfFilename, rgbToFilenameHex } from "./stl-filenames.js";
import { triangleCount, vertexCount } from "../geometry/mesh.js";

/** Maximum decimal places for 3MF coordinates (preserves grid/relief alignment). */
export const THREE_MF_COORD_DECIMALS = 6;

/** Content type for OPC relationships. */
export const CONTENT_TYPE_RELS =
  "application/vnd.openxmlformats-package.relationships+xml";

/** Content type for Core 3MF model documents. */
export const CONTENT_TYPE_MODEL =
  "application/vnd.ms-package.3dmanufacturing-3dmodel+xml";

/** Relationship type for the 3MF model part. */
export const REL_TYPE_MODEL =
  "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";

/** Core 3MF model namespace. */
export const NS_MODEL_CORE =
  "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";

/**
 * Materials and Properties extension namespace (conventional prefix "m").
 * @see https://3mf.io/spec/materials-v1-2-1/
 */
export const NS_MATERIALS =
  "http://schemas.microsoft.com/3dmanufacturing/material/2015/02";

/** Conventional Materials-extension prefix used in XML and recommendedextensions. */
export const MATERIALS_PREFIX = "m";

/** OPC content types namespace. */
export const NS_CONTENT_TYPES =
  "http://schemas.openxmlformats.org/package/2006/content-types";

/** OPC relationships namespace. */
export const NS_RELATIONSHIPS =
  "http://schemas.openxmlformats.org/package/2006/relationships";

/**
 * Stable color-group resource id (authoritative color intent).
 * Replaces the Milestone 7 basematerials id slot.
 */
export const COLOR_GROUP_ID = 1;

/**
 * @deprecated Use COLOR_GROUP_ID. Kept as an alias so older test imports resolve
 * during the Milestone 7.1 transition; it is not a Core basematerials resource.
 */
export const BASEMATERIALS_ID = COLOR_GROUP_ID;

/** Stable base object id. */
export const BASE_OBJECT_ID = 2;

/** Stable magnet-backing object id (same base-color property as Tile Base). */
export const BACKING_OBJECT_ID = 3;

/** @deprecated Use BACKING_OBJECT_ID (Milestone 7.3.2). */
export const ROOF_OBJECT_ID = BACKING_OBJECT_ID;

/** First artwork object id (used palette order). */
export const FIRST_ARTWORK_OBJECT_ID = 4;

/** Stable structural-bridge object name (deterministic; not localized). */
export const BACKING_OBJECT_NAME = "Structural Bridge";

/** @deprecated Use BACKING_OBJECT_NAME (Milestone 9.1). */
export const ROOF_OBJECT_NAME = BACKING_OBJECT_NAME;

/** Parent assembly object name (deterministic; not localized). */
export const ASSEMBLY_OBJECT_NAME = "Tile";

/** Identity transform string (3MF 3×4 row-major). Prefer omitting instead. */
export const IDENTITY_TRANSFORM = "1 0 0 0 0 1 0 0 0 0 1 0";

/**
 * Format a finite number for 3MF XML.
 * - Fixed maximum decimal places (THREE_MF_COORD_DECIMALS)
 * - Trailing zeros trimmed
 * - Negative zero normalized to "0"
 * - No scientific notation for normal Tile V1 values
 *
 * @param {number} value
 * @returns {string}
 */
export function format3mfNumber(value) {
  if (!Number.isFinite(value)) {
    throw new Error("format3mfNumber requires a finite number.");
  }
  const normalized = value === 0 ? 0 : value;
  let s = normalized.toFixed(THREE_MF_COORD_DECIMALS);
  if (s.includes(".")) {
    s = s.replace(/\.?0+$/, "");
  }
  if (s === "-0") return "0";
  if (/e/i.test(s)) {
    throw new Error(`format3mfNumber produced scientific notation: ${s}`);
  }
  return s;
}

/**
 * Opaque Materials-extension color value (#RRGGBB).
 * @param {{ r: number, g: number, b: number }} color
 * @returns {string}
 */
export function rgbToMaterialColor(color) {
  return `#${rgbToFilenameHex(color.r, color.g, color.b)}`;
}

/**
 * Legacy Core displaycolor form (#RRGGBBFF). Retained for tests that assert
 * opacity encoding; not written as printable-color intent in packages.
 * @param {{ r: number, g: number, b: number }} color
 * @returns {string} #RRGGBBFF
 */
export function rgbToDisplayColor(color) {
  return `${rgbToMaterialColor(color)}FF`;
}

/**
 * @param {number} ordinal 1-based
 * @param {{ r: number, g: number, b: number }} color
 */
export function artworkObjectName(ordinal, color) {
  const ord = String(ordinal).padStart(2, "0");
  const hex = rgbToFilenameHex(color.r, color.g, color.b);
  return `Artwork Color ${ord} — ${hex}`;
}

/**
 * Parent assembly object id for a given used-artwork count.
 * Objects: base(2) + backing(3) + artwork(4…) + parent.
 * @param {number} usedArtworkColorCount
 * @returns {number}
 */
export function assemblyObjectId(usedArtworkColorCount) {
  if (!Number.isInteger(usedArtworkColorCount) || usedArtworkColorCount < 1) {
    throw new Error("assemblyObjectId requires a positive integer used-color count.");
  }
  return FIRST_ARTWORK_OBJECT_ID + usedArtworkColorCount;
}

/**
 * Child mesh object ids: base + backing + artwork in used order.
 * @param {number} usedArtworkColorCount
 * @returns {number[]}
 */
export function childObjectIds(usedArtworkColorCount) {
  /** @type {number[]} */
  const ids = [BASE_OBJECT_ID, BACKING_OBJECT_ID];
  for (let i = 0; i < usedArtworkColorCount; i += 1) {
    ids.push(FIRST_ARTWORK_OBJECT_ID + i);
  }
  return ids;
}

/**
 * Build [Content_Types].xml
 * @returns {string}
 */
export function buildContentTypesXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Types xmlns="${NS_CONTENT_TYPES}">`,
    `  <Default Extension="rels" ContentType="${CONTENT_TYPE_RELS}"/>`,
    `  <Default Extension="model" ContentType="${CONTENT_TYPE_MODEL}"/>`,
    "</Types>",
    "",
  ].join("\n");
}

/**
 * Build _rels/.rels
 * @returns {string}
 */
export function buildRootRelsXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Relationships xmlns="${NS_RELATIONSHIPS}">`,
    `  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="${REL_TYPE_MODEL}"/>`,
    "</Relationships>",
    "",
  ].join("\n");
}

/**
 * Append mesh vertices/triangles XML without mutating the mesh.
 * @param {string[]} lines
 * @param {import("../geometry/mesh.js").Mesh} mesh
 * @param {string} indent
 */
function appendMeshXml(lines, mesh, indent) {
  const positions = mesh.positions;
  const triangles = mesh.triangles;
  const vCount = vertexCount(mesh);
  const tCount = triangleCount(mesh);
  if (vCount < 3 || tCount < 1) {
    throw new Error("3MF object mesh must have vertices and triangles.");
  }

  lines.push(`${indent}<mesh>`);
  lines.push(`${indent}  <vertices>`);
  for (let i = 0; i < vCount; i += 1) {
    const o = i * 3;
    const x = format3mfNumber(positions[o]);
    const y = format3mfNumber(positions[o + 1]);
    const z = format3mfNumber(positions[o + 2]);
    lines.push(`${indent}    <vertex x="${x}" y="${y}" z="${z}"/>`);
  }
  lines.push(`${indent}  </vertices>`);
  lines.push(`${indent}  <triangles>`);
  for (let i = 0; i < tCount; i += 1) {
    const o = i * 3;
    const a = triangles[o];
    const b = triangles[o + 1];
    const c = triangles[o + 2];
    if (
      !Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)
      || a < 0 || b < 0 || c < 0
      || a >= vCount || b >= vCount || c >= vCount
    ) {
      throw new Error("3MF triangle index out of range.");
    }
    lines.push(`${indent}    <triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }
  lines.push(`${indent}  </triangles>`);
  lines.push(`${indent}</mesh>`);
}

/**
 * Build 3D/3dmodel.model XML from validated meshes.
 *
 * Multipart assembly: child mesh objects + one parent component object.
 * Build contains exactly one item referencing the parent.
 *
 * Structural children: Tile Base + Structural Bridge (both pindex 0 / base color).
 * Artwork children follow; bridge is never an extra image color in the group.
 *
 * @param {{
 *   baseMesh: import("../geometry/mesh.js").Mesh,
 *   backingMesh?: import("../geometry/mesh.js").Mesh,
 *   roofMesh?: import("../geometry/mesh.js").Mesh,
 *   colorMeshes: Array<{
 *     paletteIndex: number,
 *     mesh: import("../geometry/mesh.js").Mesh,
 *     color: { r: number, g: number, b: number },
 *   }>,
 *   baseColor: { r: number, g: number, b: number },
 * }} opts
 * @returns {string}
 */
export function buildModelXml(opts) {
  const backingMesh = opts.backingMesh || opts.roofMesh;
  const { baseMesh, colorMeshes, baseColor } = opts;
  if (!baseMesh) throw new Error("3MF requires a base mesh.");
  if (!backingMesh) throw new Error("3MF requires a magnet-backing mesh.");
  if (!Array.isArray(colorMeshes) || colorMeshes.length < 1) {
    throw new Error("3MF requires at least one used artwork color mesh.");
  }
  if (!baseColor) throw new Error("3MF requires a base color.");

  const usedColors = colorMeshes.length;
  const parentId = assemblyObjectId(usedColors);
  const children = childObjectIds(usedColors);

  /** @type {string[]} */
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<model unit="millimeter" xml:lang="en-US" xmlns="${NS_MODEL_CORE}" xmlns:${MATERIALS_PREFIX}="${NS_MATERIALS}" recommendedextensions="${MATERIALS_PREFIX}">`,
  );
  lines.push("  <resources>");

  // Authoritative color intent: Materials-extension color group (not Core basematerials).
  // Backing reuses base color (pindex 0) — it is not an extra image color entry.
  lines.push(`    <m:colorgroup id="${COLOR_GROUP_ID}">`);
  lines.push(`      <m:color color="${rgbToMaterialColor(baseColor)}"/>`);
  for (let i = 0; i < colorMeshes.length; i += 1) {
    lines.push(
      `      <m:color color="${rgbToMaterialColor(colorMeshes[i].color)}"/>`,
    );
  }
  lines.push("    </m:colorgroup>");

  // Child: Tile Base
  lines.push(
    `    <object id="${BASE_OBJECT_ID}" type="model" pid="${COLOR_GROUP_ID}" pindex="0" name="Tile Base">`,
  );
  appendMeshXml(lines, baseMesh, "      ");
  lines.push("    </object>");

  // Child: Structural Bridge (same property as base)
  lines.push(
    `    <object id="${BACKING_OBJECT_ID}" type="model" pid="${COLOR_GROUP_ID}" pindex="0" name="${BACKING_OBJECT_NAME}">`,
  );
  appendMeshXml(lines, backingMesh, "      ");
  lines.push("    </object>");

  // Children: Artwork Color 01…
  for (let i = 0; i < colorMeshes.length; i += 1) {
    const entry = colorMeshes[i];
    const objectId = FIRST_ARTWORK_OBJECT_ID + i;
    const pindex = i + 1;
    const name = escapeXml(artworkObjectName(i + 1, entry.color));
    lines.push(
      `    <object id="${objectId}" type="model" pid="${COLOR_GROUP_ID}" pindex="${pindex}" name="${name}">`,
    );
    appendMeshXml(lines, entry.mesh, "      ");
    lines.push("    </object>");
  }

  // Parent assembly: components only — no mesh, no pid/pindex, no color properties.
  lines.push(
    `    <object id="${parentId}" type="model" name="${ASSEMBLY_OBJECT_NAME}">`,
  );
  lines.push("      <components>");
  for (const childId of children) {
    lines.push(`        <component objectid="${childId}"/>`);
  }
  lines.push("      </components>");
  lines.push("    </object>");

  lines.push("  </resources>");
  lines.push("  <build>");
  lines.push(`    <item objectid="${parentId}"/>`);
  lines.push("  </build>");
  lines.push("</model>");
  lines.push("");
  return lines.join("\n");
}

/**
 * Pure byte generation for a multicolor 3MF package.
 *
 * @param {{
 *   projectName: string,
 *   baseMesh: import("../geometry/mesh.js").Mesh,
 *   roofMesh: import("../geometry/mesh.js").Mesh,
 *   colorMeshes: Array<{
 *     paletteIndex: number,
 *     mesh: import("../geometry/mesh.js").Mesh,
 *     color: { r: number, g: number, b: number },
 *   }>,
 *   baseColor: { r: number, g: number, b: number },
 *   effectivePalette?: Array<{ r: number, g: number, b: number }>,
 *   surfaceStyle?: "flat" | "relief",
 *   geometryVersion?: number | null,
 * }} opts
 * @returns {{
 *   bytes: Uint8Array,
 *   filename: string,
 *   manifest: {
 *     objectCount: number,
 *     childObjectCount: number,
 *     componentCount: number,
 *     buildItemCount: number,
 *     assemblyObjectId: number,
 *     materialCount: number,
 *     colorCount: number,
 *     triangleCount: number,
 *     vertexCount: number,
 *     usedColors: number,
 *     keepoutObjectCount: number,
 *     surfaceStyle: string,
 *     byteLength: number,
 *     geometryVersion: number | null,
 *   },
 *   xml: {
 *     contentTypes: string,
 *     rels: string,
 *     model: string,
 *   },
 * }}
 */
export function createThreeMfBytes(opts, control = {}) {
  const now = typeof control.now === "function"
    ? control.now
    : () => (typeof performance !== "undefined" ? performance.now() : 0);
  const performanceMetrics = control.metrics && typeof control.metrics === "object"
    ? control.metrics
    : null;
  const surfaceStyle = opts.surfaceStyle === "relief" ? "relief" : "flat";
  const colorMeshes = opts.colorMeshes;
  if (!colorMeshes || colorMeshes.length < 2) {
    throw new Error(
      "Multicolor 3MF requires at least two used artwork colors.",
    );
  }
  const backingMesh = opts.backingMesh || opts.roofMesh;
  if (!backingMesh) {
    throw new Error("Multicolor 3MF requires a magnet-backing mesh.");
  }

  // Snapshot counts before packaging to detect accidental mutation.
  const baseV = vertexCount(opts.baseMesh);
  const baseT = triangleCount(opts.baseMesh);
  const roofV = vertexCount(backingMesh);
  const roofT = triangleCount(backingMesh);
  const colorCounts = colorMeshes.map((c) => ({
    v: vertexCount(c.mesh),
    t: triangleCount(c.mesh),
  }));

  const contentTypes = buildContentTypesXml();
  const rels = buildRootRelsXml();
  const xmlStarted = performanceMetrics ? now() : 0;
  const model = buildModelXml({
    baseMesh: opts.baseMesh,
    backingMesh,
    colorMeshes,
    baseColor: opts.baseColor,
  });
  if (performanceMetrics) {
    performanceMetrics.xmlConstructionMs = now() - xmlStarted;
  }

  const zipStarted = performanceMetrics ? now() : 0;
  const encoder = new TextEncoder();
  const bytes = createZipStore([
    { path: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { path: "_rels/.rels", data: encoder.encode(rels) },
    { path: "3D/3dmodel.model", data: encoder.encode(model) },
  ]);
  if (performanceMetrics) {
    performanceMetrics.zipPackagingMs = now() - zipStarted;
  }

  // Geometry must be unchanged by packaging.
  if (vertexCount(opts.baseMesh) !== baseV || triangleCount(opts.baseMesh) !== baseT) {
    throw new Error("3MF packaging mutated the base mesh.");
  }
  if (vertexCount(backingMesh) !== roofV || triangleCount(backingMesh) !== roofT) {
    throw new Error("3MF packaging mutated the magnet-backing mesh.");
  }
  for (let i = 0; i < colorMeshes.length; i += 1) {
    if (
      vertexCount(colorMeshes[i].mesh) !== colorCounts[i].v
      || triangleCount(colorMeshes[i].mesh) !== colorCounts[i].t
    ) {
      throw new Error("3MF packaging mutated an artwork mesh.");
    }
  }

  let totalVertices = baseV + roofV;
  let totalTriangles = baseT + roofT;
  for (const c of colorCounts) {
    totalVertices += c.v;
    totalTriangles += c.t;
  }

  const usedColors = colorMeshes.length;
  const keepoutObjectCount = 1;
  const childObjectCount = 2 + usedColors; // base + backing + artwork
  const objectCount = childObjectCount + 1;
  // Color group entries: base + artwork only (backing shares base; not an image color).
  const colorCount = 1 + usedColors;
  const parentId = assemblyObjectId(usedColors);
  const filename = multicolorThreeMfFilename(opts.projectName || "lenstile", {
    relief: surfaceStyle === "relief",
  });

  return {
    bytes,
    filename,
    manifest: {
      objectCount,
      childObjectCount,
      componentCount: childObjectCount,
      buildItemCount: 1,
      assemblyObjectId: parentId,
      materialCount: colorCount,
      colorCount,
      triangleCount: totalTriangles,
      vertexCount: totalVertices,
      usedColors,
      keepoutObjectCount,
      surfaceStyle,
      byteLength: bytes.byteLength,
      geometryVersion: opts.geometryVersion ?? null,
    },
    xml: { contentTypes, rels, model },
  };
}

/**
 * Create a downloadable 3MF package (bytes + Blob).
 * Blob creation is separated from pure byte generation for testability.
 *
 * @param {Parameters<typeof createThreeMfBytes>[0]} opts
 * @returns {{
 *   bytes: Uint8Array,
 *   blob: Blob,
 *   filename: string,
 *   manifest: ReturnType<typeof createThreeMfBytes>["manifest"],
 * }}
 */
export function createThreeMfPackage(opts) {
  const result = createThreeMfBytes(opts);
  return {
    bytes: result.bytes,
    blob: new Blob([result.bytes], {
      type: "model/3mf",
    }),
    filename: result.filename,
    manifest: result.manifest,
  };
}

/**
 * Legacy placeholder name — prefer createThreeMfPackage / createThreeMfBytes.
 * @param {Parameters<typeof createThreeMfPackage>[0]} [opts]
 */
export function writeThreeMf(opts) {
  if (!opts) {
    throw new Error("writeThreeMf requires package options.");
  }
  return createThreeMfPackage(opts);
}
