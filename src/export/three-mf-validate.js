/**
 * Validate a multicolor 3MF package produced by createThreeMfBytes.
 *
 * Checks ZIP structure, CRC integrity, multipart assembly invariants, and
 * Materials-extension color-group references.
 * Does not claim complete formal XSD schema validation.
 */

import { readZipStore, ZIP_METHOD_STORE, ZIP_FLAG_UTF8, ZIP_DOS_DATE, ZIP_DOS_TIME } from "./zip-store.js";
import {
  COLOR_GROUP_ID,
  BASE_OBJECT_ID,
  BACKING_OBJECT_ID,
  BACKING_OBJECT_NAME,
  ROOF_OBJECT_ID,
  ROOF_OBJECT_NAME,
  FIRST_ARTWORK_OBJECT_ID,
  ASSEMBLY_OBJECT_NAME,
  IDENTITY_TRANSFORM,
  CONTENT_TYPE_MODEL,
  CONTENT_TYPE_RELS,
  REL_TYPE_MODEL,
  NS_MODEL_CORE,
  NS_MATERIALS,
  MATERIALS_PREFIX,
  assemblyObjectId,
  rgbToMaterialColor,
} from "./three-mf.js";
import { triangleCount, vertexCount } from "../geometry/mesh.js";

/** Required package entry paths in deterministic order. */
export const REQUIRED_3MF_PATHS = Object.freeze([
  "[Content_Types].xml",
  "_rels/.rels",
  "3D/3dmodel.model",
]);

/**
 * @typedef {{
 *   ok: boolean,
 *   reasons: string[],
 *   entryPaths: string[],
 *   objectCount: number,
 *   childObjectCount: number,
 *   materialCount: number,
 *   colorCount: number,
 *   buildItemCount: number,
 *   assemblyObjectId: number | null,
 *   unit: string | null,
 *   hasMaterialsNamespace: boolean,
 *   hasColorGroup: boolean,
 * }} ThreeMfValidation
 */

/**
 * @param {Document} doc
 * @param {string} localName
 * @returns {Element[]}
 */
function elementsByLocalName(doc, localName) {
  const all = doc.getElementsByTagName("*");
  /** @type {Element[]} */
  const out = [];
  for (let i = 0; i < all.length; i += 1) {
    const el = all[i];
    if (el.localName === localName) out.push(el);
  }
  return out;
}

/**
 * @param {Element} parent
 * @param {string} localName
 * @returns {Element[]}
 */
function childElementsByLocalName(parent, localName) {
  /** @type {Element[]} */
  const out = [];
  for (let i = 0; i < parent.children.length; i += 1) {
    const el = parent.children[i];
    if (el.localName === localName) out.push(el);
  }
  return out;
}

/**
 * @param {Element} obj
 * @returns {{ vertices: Element[], triangles: Element[], components: Element[], hasMesh: boolean }}
 */
function inspectObject(obj) {
  /** @type {Element[]} */
  const vertices = [];
  /** @type {Element[]} */
  const triangles = [];
  /** @type {Element[]} */
  const components = [];
  let hasMesh = false;
  const walk = obj.getElementsByTagName("*");
  for (let j = 0; j < walk.length; j += 1) {
    const el = walk[j];
    if (el.localName === "vertex") vertices.push(el);
    if (el.localName === "triangle") triangles.push(el);
    if (el.localName === "component") components.push(el);
    if (el.localName === "mesh") hasMesh = true;
  }
  return { vertices, triangles, components, hasMesh };
}

/**
 * @param {string} xml
 * @returns {Document}
 */
function parseXml(xml) {
  if (typeof DOMParser === "undefined") {
    throw new Error("DOMParser is required to validate 3MF XML.");
  }
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) {
    throw new Error(`XML parse error: ${err.textContent || "unknown"}`);
  }
  return doc;
}

/**
 * @param {string | null} transform
 * @returns {boolean}
 */
function isIdentityOrOmitted(transform) {
  if (transform == null || transform.trim() === "") return true;
  const normalized = transform.trim().replace(/\s+/g, " ");
  return normalized === IDENTITY_TRANSFORM;
}

/**
 * Validate ZIP + Core 3MF model structure with Milestone 7.1 assembly rules.
 *
 * @param {Uint8Array} bytes
 * @param {{
 *   expectedObjectCount?: number,
 *   expectedUsedColors?: number,
 *   expectedChildObjectCount?: number,
 *   baseMesh?: import("../geometry/mesh.js").Mesh,
 *   colorMeshes?: Array<{
 *     mesh: import("../geometry/mesh.js").Mesh,
 *     color?: { r: number, g: number, b: number },
 *   }>,
 *   baseColor?: { r: number, g: number, b: number },
 * }} [opts]
 * @returns {ThreeMfValidation}
 */
export function validateThreeMfPackage(bytes, opts = {}) {
  /** @type {string[]} */
  const reasons = [];
  /** @type {string[]} */
  let entryPaths = [];
  let objectCount = 0;
  let childObjectCount = 0;
  let materialCount = 0;
  let colorCount = 0;
  let buildItemCount = 0;
  /** @type {number | null} */
  let parentAssemblyId = null;
  /** @type {string | null} */
  let unit = null;
  let hasMaterialsNamespace = false;
  let hasColorGroup = false;

  try {
    const zip = readZipStore(bytes);
    entryPaths = zip.entries.map((e) => e.path);

    if (entryPaths.length !== REQUIRED_3MF_PATHS.length) {
      reasons.push(
        `Expected ${REQUIRED_3MF_PATHS.length} ZIP entries, found ${entryPaths.length}.`,
      );
    }
    for (let i = 0; i < REQUIRED_3MF_PATHS.length; i += 1) {
      if (entryPaths[i] !== REQUIRED_3MF_PATHS[i]) {
        reasons.push(
          `ZIP entry order mismatch at ${i}: expected ${REQUIRED_3MF_PATHS[i]}, got ${entryPaths[i] || "(missing)"}.`,
        );
      }
    }

    for (const entry of zip.entries) {
      if (entry.method !== ZIP_METHOD_STORE) {
        reasons.push(`Entry ${entry.path} is not Store method.`);
      }
      if ((entry.flags & ZIP_FLAG_UTF8) !== ZIP_FLAG_UTF8) {
        reasons.push(`Entry ${entry.path} missing UTF-8 filename flag.`);
      }
      if (entry.dosDate !== ZIP_DOS_DATE || entry.dosTime !== ZIP_DOS_TIME) {
        reasons.push(`Entry ${entry.path} has non-deterministic timestamp.`);
      }
    }

    const byPath = new Map(zip.entries.map((e) => [e.path, e]));
    const contentTypes = byPath.get("[Content_Types].xml");
    const rels = byPath.get("_rels/.rels");
    const modelEntry = byPath.get("3D/3dmodel.model");
    if (!contentTypes || !rels || !modelEntry) {
      reasons.push("Missing required 3MF package parts.");
      return {
        ok: false,
        reasons,
        entryPaths,
        objectCount,
        childObjectCount,
        materialCount,
        colorCount,
        buildItemCount,
        assemblyObjectId: parentAssemblyId,
        unit,
        hasMaterialsNamespace,
        hasColorGroup,
      };
    }

    const decoder = new TextDecoder("utf-8");
    const ctXml = decoder.decode(contentTypes.data);
    const relsXml = decoder.decode(rels.data);
    const modelXml = decoder.decode(modelEntry.data);

    if (ctXml.charCodeAt(0) === 0xfeff || relsXml.charCodeAt(0) === 0xfeff || modelXml.charCodeAt(0) === 0xfeff) {
      reasons.push("3MF XML must not include a BOM.");
    }

    const ctDoc = parseXml(ctXml);
    const defaults = elementsByLocalName(ctDoc, "Default");
    const relTypeOk = defaults.some(
      (el) => el.getAttribute("Extension") === "rels"
        && el.getAttribute("ContentType") === CONTENT_TYPE_RELS,
    );
    const modelTypeOk = defaults.some(
      (el) => el.getAttribute("Extension") === "model"
        && el.getAttribute("ContentType") === CONTENT_TYPE_MODEL,
    );
    if (!relTypeOk) reasons.push("Content types missing relationships Default.");
    if (!modelTypeOk) reasons.push("Content types missing 3MF model Default.");

    const relsDoc = parseXml(relsXml);
    const relationships = elementsByLocalName(relsDoc, "Relationship");
    const modelRel = relationships.find(
      (el) => el.getAttribute("Type") === REL_TYPE_MODEL,
    );
    if (!modelRel) {
      reasons.push("Root relationships missing 3MF model relationship.");
    } else if (modelRel.getAttribute("Target") !== "/3D/3dmodel.model") {
      reasons.push(`Unexpected model relationship target: ${modelRel.getAttribute("Target")}`);
    }

    const modelDoc = parseXml(modelXml);
    const modelEl = elementsByLocalName(modelDoc, "model")[0];
    if (!modelEl) {
      reasons.push("Model document missing <model> root.");
    } else {
      unit = modelEl.getAttribute("unit");
      if (unit !== "millimeter") {
        reasons.push(`Model unit must be millimeter, got ${unit}.`);
      }
      if (modelEl.namespaceURI && modelEl.namespaceURI !== NS_MODEL_CORE) {
        reasons.push(`Unexpected model namespace: ${modelEl.namespaceURI}`);
      }

      const materialsNs = modelEl.getAttribute(`xmlns:${MATERIALS_PREFIX}`);
      hasMaterialsNamespace = materialsNs === NS_MATERIALS;
      if (!hasMaterialsNamespace) {
        reasons.push("Materials-extension namespace xmlns:m is missing or incorrect.");
      }

      const recommended = (modelEl.getAttribute("recommendedextensions") || "").trim();
      const required = (modelEl.getAttribute("requiredextensions") || "").trim();
      if (!recommended.split(/\s+/).includes(MATERIALS_PREFIX)) {
        reasons.push('Materials extension must be listed in recommendedextensions="m".');
      }
      if (required.split(/\s+/).filter(Boolean).includes(MATERIALS_PREFIX)) {
        reasons.push(
          "Materials extension must not be in requiredextensions (use recommended for compatibility).",
        );
      }
    }

    // Prefer Materials color groups; Core basematerials must not be the sole color mechanism.
    const colorGroups = elementsByLocalName(modelDoc, "colorgroup");
    hasColorGroup = colorGroups.length >= 1;
    if (colorGroups.length !== 1) {
      reasons.push("Expected exactly one m:colorgroup resource.");
    } else {
      const group = colorGroups[0];
      if (group.getAttribute("id") !== String(COLOR_GROUP_ID)) {
        reasons.push(`colorgroup id must be ${COLOR_GROUP_ID}.`);
      }
      if (group.namespaceURI && group.namespaceURI !== NS_MATERIALS) {
        reasons.push("colorgroup must use the Materials-extension namespace.");
      }
      const colors = childElementsByLocalName(group, "color");
      colorCount = colors.length;
      materialCount = colorCount;
      if (colorCount < 2) {
        reasons.push("Color group must contain base + at least one artwork color.");
      }
      for (const colorEl of colors) {
        const value = colorEl.getAttribute("color") || "";
        if (!/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(value)) {
          reasons.push(`Invalid color value: ${value}`);
        }
      }
    }

    const basematerials = elementsByLocalName(modelDoc, "basematerials");
    if (basematerials.length > 0 && colorGroups.length === 0) {
      reasons.push("Core basematerials/displaycolor must not be the only printable-color mechanism.");
    }

    const objects = elementsByLocalName(modelDoc, "object");
    objectCount = objects.length;
    /** @type {Map<string, Element>} */
    const objectById = new Map();
    /** @type {Element[]} */
    const meshObjects = [];
    /** @type {Element[]} */
    const assemblyObjects = [];

    for (let i = 0; i < objects.length; i += 1) {
      const obj = objects[i];
      const id = obj.getAttribute("id");
      if (!id || objectById.has(id)) {
        reasons.push(`Object id missing or duplicate: ${id}`);
      } else {
        objectById.set(id, obj);
      }
      if (obj.getAttribute("type") !== "model") {
        reasons.push(`Object ${id} type must be model.`);
      }

      const info = inspectObject(obj);
      if (info.components.length > 0) {
        assemblyObjects.push(obj);
        if (info.hasMesh || info.vertices.length > 0 || info.triangles.length > 0) {
          reasons.push(`Assembly object ${id} must not contain a mesh.`);
        }
        if (obj.hasAttribute("pid") || obj.hasAttribute("pindex")) {
          reasons.push(`Assembly object ${id} must not have pid or pindex.`);
        }
      } else {
        meshObjects.push(obj);
        const pid = obj.getAttribute("pid");
        const pindex = obj.getAttribute("pindex");
        if (pid !== String(COLOR_GROUP_ID)) {
          reasons.push(`Child object ${id} pid must reference color group ${COLOR_GROUP_ID}.`);
        }
        const pindexNum = Number(pindex);
        if (!Number.isInteger(pindexNum) || pindexNum < 0 || pindexNum >= colorCount) {
          reasons.push(`Child object ${id} pindex out of range: ${pindex}`);
        }
        if (info.vertices.length < 1 || info.triangles.length < 1) {
          reasons.push(`Child object ${id} must have vertices and triangles.`);
        }
        const vCount = info.vertices.length;
        for (const tri of info.triangles) {
          for (const attr of ["v1", "v2", "v3"]) {
            const idx = Number(tri.getAttribute(attr));
            if (!Number.isInteger(idx) || idx < 0 || idx >= vCount) {
              reasons.push(`Object ${id} triangle ${attr}=${idx} out of range.`);
              break;
            }
          }
        }
      }
    }

    childObjectCount = meshObjects.length;

    if (assemblyObjects.length !== 1) {
      reasons.push(`Expected exactly one parent assembly object, found ${assemblyObjects.length}.`);
    } else {
      const parent = assemblyObjects[0];
      parentAssemblyId = Number(parent.getAttribute("id"));
      if (parent.getAttribute("name") !== ASSEMBLY_OBJECT_NAME) {
        reasons.push(`Parent assembly name must be ${ASSEMBLY_OBJECT_NAME}.`);
      }
      const info = inspectObject(parent);
      if (opts.expectedUsedColors != null) {
        const expectedParentId = assemblyObjectId(opts.expectedUsedColors);
        if (parentAssemblyId !== expectedParentId) {
          reasons.push(
            `Parent assembly id must be ${expectedParentId}, got ${parentAssemblyId}.`,
          );
        }
      }
      if (info.components.length !== childObjectCount) {
        reasons.push(
          `Parent must reference every child once (components=${info.components.length}, children=${childObjectCount}).`,
        );
      }
      /** @type {Set<string>} */
      const referenced = new Set();
      for (const comp of info.components) {
        const oid = comp.getAttribute("objectid");
        if (!oid || !objectById.has(oid)) {
          reasons.push(`Component references missing object ${oid}.`);
        } else if (referenced.has(oid)) {
          reasons.push(`Child object ${oid} referenced more than once by parent.`);
        } else {
          referenced.add(oid);
        }
        if (!isIdentityOrOmitted(comp.getAttribute("transform"))) {
          reasons.push(`Component ${oid} must use identity transform (or omit transform).`);
        }
      }
      for (const child of meshObjects) {
        const cid = child.getAttribute("id");
        if (cid && !referenced.has(cid)) {
          reasons.push(`Child object ${cid} is not referenced by the parent assembly.`);
        }
      }
    }

    if (meshObjects.length >= 2) {
      if (meshObjects[0].getAttribute("id") !== String(BASE_OBJECT_ID)) {
        reasons.push(`First child object id must be ${BASE_OBJECT_ID} (Tile Base).`);
      }
      if (meshObjects[0].getAttribute("name") !== "Tile Base") {
        reasons.push("First child object name must be Tile Base.");
      }
      if (meshObjects[0].getAttribute("pindex") !== "0") {
        reasons.push("Tile Base pindex must be 0.");
      }
      if (meshObjects[1].getAttribute("id") !== String(BACKING_OBJECT_ID)) {
        reasons.push(`Second child object id must be ${BACKING_OBJECT_ID} (magnet backing).`);
      }
      if (meshObjects[1].getAttribute("name") !== BACKING_OBJECT_NAME) {
        reasons.push(`Second child object name must be ${BACKING_OBJECT_NAME}.`);
      }
      if (meshObjects[1].getAttribute("pindex") !== "0") {
        reasons.push("Structural Bridge pindex must be 0 (same as base).");
      }
      for (let i = 2; i < meshObjects.length; i += 1) {
        const artworkOrdinal = i - 2;
        const expectedId = String(FIRST_ARTWORK_OBJECT_ID + artworkOrdinal);
        if (meshObjects[i].getAttribute("id") !== expectedId) {
          reasons.push(`Artwork object ${artworkOrdinal} id must be ${expectedId}.`);
        }
        if (meshObjects[i].getAttribute("pindex") !== String(artworkOrdinal + 1)) {
          reasons.push(`Artwork object ${expectedId} pindex must be ${artworkOrdinal + 1}.`);
        }
      }
    }

    // Children = base + magnet backing + artwork colors.
    if (opts.expectedUsedColors != null && childObjectCount !== opts.expectedUsedColors + 2) {
      reasons.push(
        `Expected ${opts.expectedUsedColors + 2} child objects for ${opts.expectedUsedColors} colors (base + magnet backing + artwork).`,
      );
    }
    if (opts.expectedChildObjectCount != null && childObjectCount !== opts.expectedChildObjectCount) {
      reasons.push(
        `Expected ${opts.expectedChildObjectCount} child objects, found ${childObjectCount}.`,
      );
    }
    // Total objects = children + parent assembly.
    if (opts.expectedObjectCount != null && objectCount !== opts.expectedObjectCount) {
      reasons.push(
        `Expected ${opts.expectedObjectCount} objects, found ${objectCount}.`,
      );
    }
    if (opts.expectedUsedColors != null && colorCount !== opts.expectedUsedColors + 1) {
      reasons.push(
        `Expected ${opts.expectedUsedColors + 1} colors in color group, found ${colorCount}.`,
      );
    }

    const items = elementsByLocalName(modelDoc, "item");
    buildItemCount = items.length;
    if (items.length !== 1) {
      reasons.push(`Build must contain exactly one parent item, found ${items.length}.`);
    } else {
      const item = items[0];
      const oid = item.getAttribute("objectid");
      if (parentAssemblyId != null && oid !== String(parentAssemblyId)) {
        reasons.push(`Build item must reference parent assembly ${parentAssemblyId}, got ${oid}.`);
      }
      if (!isIdentityOrOmitted(item.getAttribute("transform"))) {
        reasons.push("Build item must use identity transform (or omit transform).");
      }
      // No child object may also appear directly in build.
      for (const child of meshObjects) {
        const cid = child.getAttribute("id");
        if (cid && oid === cid) {
          reasons.push(`Child object ${cid} must not appear directly in build.`);
        }
      }
    }

    // Expected colors exactly once when provided.
    if (opts.baseColor && colorGroups[0]) {
      const colors = childElementsByLocalName(colorGroups[0], "color");
      const expectedBase = rgbToMaterialColor(opts.baseColor).toUpperCase();
      const actualBase = (colors[0]?.getAttribute("color") || "").toUpperCase();
      if (actualBase !== expectedBase && actualBase !== `${expectedBase}FF`) {
        reasons.push(`Base color mismatch: expected ${expectedBase}, got ${actualBase}.`);
      }
    }
    if (opts.colorMeshes && colorGroups[0]) {
      const colors = childElementsByLocalName(colorGroups[0], "color");
      for (let i = 0; i < opts.colorMeshes.length; i += 1) {
        const entry = opts.colorMeshes[i];
        if (!entry.color) continue;
        const expected = rgbToMaterialColor(entry.color).toUpperCase();
        const actual = (colors[i + 1]?.getAttribute("color") || "").toUpperCase();
        if (actual !== expected && actual !== `${expected}FF`) {
          reasons.push(`Artwork color[${i}] mismatch: expected ${expected}, got ${actual}.`);
        }
      }
    }

    if (opts.baseMesh && meshObjects[0]) {
      const info = inspectObject(meshObjects[0]);
      if (info.vertices.length !== vertexCount(opts.baseMesh)) {
        reasons.push("Packaged base vertex count differs from input mesh.");
      }
      if (info.triangles.length !== triangleCount(opts.baseMesh)) {
        reasons.push("Packaged base triangle count differs from input mesh.");
      }
    }
    const backingMesh = opts.backingMesh || opts.roofMesh;
    if (backingMesh && meshObjects[1]) {
      const info = inspectObject(meshObjects[1]);
      if (info.vertices.length !== vertexCount(backingMesh)) {
        reasons.push("Packaged magnet-backing vertex count differs from input mesh.");
      }
      if (info.triangles.length !== triangleCount(backingMesh)) {
        reasons.push("Packaged magnet-backing triangle count differs from input mesh.");
      }
    }
    if (opts.colorMeshes) {
      for (let i = 0; i < opts.colorMeshes.length; i += 1) {
        const obj = meshObjects[i + 2];
        if (!obj) {
          reasons.push(`Missing packaged artwork object for color ${i}.`);
          continue;
        }
        const info = inspectObject(obj);
        if (info.vertices.length !== vertexCount(opts.colorMeshes[i].mesh)) {
          reasons.push(`Packaged color[${i}] vertex count differs from input mesh.`);
        }
        if (info.triangles.length !== triangleCount(opts.colorMeshes[i].mesh)) {
          reasons.push(`Packaged color[${i}] triangle count differs from input mesh.`);
        }
      }
    }
  } catch (err) {
    reasons.push(err instanceof Error ? err.message : String(err));
  }

  return {
    ok: reasons.length === 0,
    reasons,
    entryPaths,
    objectCount,
    childObjectCount,
    materialCount,
    colorCount,
    buildItemCount,
    assemblyObjectId: parentAssemblyId,
    unit,
    hasMaterialsNamespace,
    hasColorGroup,
  };
}
