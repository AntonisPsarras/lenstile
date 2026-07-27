/**
 * Hard-coded golden multicolor 3MF fixtures (Milestone 7.1 / 9.1).
 *
 * Minimal closed box meshes (not full Tile V1) used only to lock ZIP/XML
 * packaging determinism. Geometry goldens for Flat/Relief STLs are unchanged.
 *
 * Milestone 9.1: structural child renamed to "Structural Bridge" (same base-color
 * property). Name change from "Magnet Backing" intentionally updates byte length / hash.
 *
 * Expected values were recorded from reviewed builds — do not recompute from
 * the implementation under test when updating.
 */

/** Shared minimal base + bridge + artwork color boxes. */
export const GOLDEN_3MF_MESH_SPEC = Object.freeze({
  projectName: "Golden Tile",
  baseColor: Object.freeze({ r: 42, g: 42, b: 42 }),
  baseBox: Object.freeze({
    minX: -1, minY: -1, minZ: 0,
    maxX: 1, maxY: 1, maxZ: 2.5,
  }),
  /** Structural bridge stand-in for packaging golden only (box size locked). */
  roofBox: Object.freeze({
    minX: -0.25, minY: -0.25, minZ: 2.5,
    maxX: 0.25, maxY: 0.25, maxZ: 4,
  }),
  /** Flat golden: base + bridge + two artwork colors. */
  colorBoxes: Object.freeze([
    Object.freeze({
      paletteIndex: 0,
      color: Object.freeze({ r: 255, g: 0, b: 0 }),
      minX: -1, minY: -1, minZ: 2.5,
      maxX: 0, maxY: 1, maxZ: 4,
    }),
    Object.freeze({
      paletteIndex: 1,
      color: Object.freeze({ r: 0, g: 128, b: 255 }),
      minX: 0, minY: -1, minZ: 2.5,
      maxX: 1, maxY: 1, maxZ: 4,
    }),
  ]),
  /** Relief golden: base + bridge + four artwork colors with distinct tops. */
  reliefColorBoxes: Object.freeze([
    Object.freeze({
      paletteIndex: 0,
      color: Object.freeze({ r: 255, g: 0, b: 0 }),
      minX: -1, minY: -1, minZ: 2.5,
      maxX: -0.5, maxY: 1, maxZ: 4,
    }),
    Object.freeze({
      paletteIndex: 1,
      color: Object.freeze({ r: 0, g: 128, b: 255 }),
      minX: -0.5, minY: -1, minZ: 2.5,
      maxX: 0, maxY: 1, maxZ: 3.8,
    }),
    Object.freeze({
      paletteIndex: 2,
      color: Object.freeze({ r: 0, g: 180, b: 80 }),
      minX: 0, minY: -1, minZ: 2.5,
      maxX: 0.5, maxY: 1, maxZ: 3.6,
    }),
    Object.freeze({
      paletteIndex: 3,
      color: Object.freeze({ r: 220, g: 180, b: 40 }),
      minX: 0.5, minY: -1, minZ: 2.5,
      maxX: 1, maxY: 1, maxZ: 3.4,
    }),
  ]),
});

/**
 * Flat multicolor 3MF golden (base + bridge + two colors + parent).
 * Metrics filled after reviewed packaging run (Milestone 9.1 name update).
 * Previous (Magnet Backing name): byteLength 5830, fnv1a 7fd9b380.
 */
export const GOLDEN_3MF_FLAT = Object.freeze({
  filename: "golden-tile-multicolor.3mf",
  surfaceStyle: "flat",
  byteLength: 5833,
  fnv1a: "682e74ac",
  entryPaths: Object.freeze([
    "[Content_Types].xml",
    "_rels/.rels",
    "3D/3dmodel.model",
  ]),
  objectCount: 5,
  childObjectCount: 4,
  componentCount: 4,
  buildItemCount: 1,
  assemblyObjectId: 6,
  keepoutObjectCount: 1,
  colorCount: 3,
  materialCount: 3,
  vertexCount: 32,
  triangleCount: 48,
  unit: "millimeter",
});

/**
 * Relief multicolor 3MF golden (base + bridge + four colors + parent).
 * Previous (Magnet Backing name): byteLength 8108, fnv1a 7583dddf.
 */
export const GOLDEN_3MF_RELIEF = Object.freeze({
  filename: "golden-tile-relief-multicolor.3mf",
  surfaceStyle: "relief",
  byteLength: 8111,
  fnv1a: "3a58bcd5",
  entryPaths: Object.freeze([
    "[Content_Types].xml",
    "_rels/.rels",
    "3D/3dmodel.model",
  ]),
  objectCount: 7,
  childObjectCount: 6,
  componentCount: 6,
  buildItemCount: 1,
  assemblyObjectId: 8,
  keepoutObjectCount: 1,
  colorCount: 5,
  materialCount: 5,
  vertexCount: 48,
  triangleCount: 72,
  unit: "millimeter",
});
