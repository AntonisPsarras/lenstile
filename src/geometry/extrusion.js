/**
 * Extrusion helpers (Milestone 5).
 *
 * Rectangle cuboids may be used for diagnostics; production artwork export
 * uses boundary-face generation in artwork-mesh.js to avoid internal faces.
 */

import { createBoxMesh } from "./primitives.js";
import { createRasterMapping, rectangleToCuboidMm } from "./raster-coords.js";
import { TILE_V1 } from "./tile-spec.js";
import { mergeMeshes, packMesh } from "./mesh.js";
import { buildArtworkColorMesh, buildAllArtworkMeshes } from "./artwork-mesh.js";

export { buildArtworkColorMesh, buildAllArtworkMeshes };

/**
 * Extrude mask rectangles into individual boxes and merge.
 * WARNING: adjacent same-color rectangles retain internal coplanar faces.
 * Prefer buildArtworkColorMesh for export solids.
 *
 * @param {import("./mask-to-rectangles.js").MaskRectangle[]} rectangles
 * @param {number} width
 * @param {number} height
 * @param {number} [zMin]
 * @param {number} [zMax]
 * @param {typeof TILE_V1} [tile]
 * @returns {import("./mesh.js").PackedMesh}
 */
export function extrudeRectangles(
  rectangles,
  width,
  height,
  zMin = TILE_V1.artworkStartZMm,
  zMax = TILE_V1.artworkEndZMm,
  tile = TILE_V1,
) {
  const mapping = createRasterMapping(width, height, tile);
  const boxes = rectangles.map((rect) => {
    const c = rectangleToCuboidMm(
      mapping,
      rect.x0Pixel,
      rect.y0Pixel,
      rect.widthPixels,
      rect.heightPixels,
      zMin,
      zMax,
    );
    return createBoxMesh(c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ);
  });
  return packMesh(mergeMeshes(boxes));
}
