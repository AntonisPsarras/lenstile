/**
 * Tile V1 base and combined solid construction with magnet recesses.
 *
 * No general Boolean / CSG library. Boundary meshes are built directly:
 *
 * Combined single-color (Z 0…4):
 * - Solid outer envelope 148×53×4
 * - Two bottom-open cylindrical recesses (Z 0…2.5) with ceilings at Z = 2.5
 *
 * Aligned base (Z 0…2.5):
 * - Through-holes (open at Z = 0 and Z = 2.5); the structural bridge (Z 2.5…3.0)
 *   forms the continuous roof above the cavities
 *
 * Planar faces with circular holes use a circumscribed-square + annular-ring
 * construction. Outer walls share the same perimeter polylines as those faces.
 */

import { TILE_V1, MAGNET_CIRCLE_SEGMENTS } from "./tile-spec.js";
import {
  createMesh,
  addTriangle,
  createVertexDeduper,
  packMesh,
} from "./mesh.js";
import { addQuad } from "./primitives.js";
import {
  unitCirclePoints,
  raySquareIntersection,
  magnetRadiusMm,
} from "./magnet-circle.js";

/**
 * @typedef {object} TileMeshOptions
 * @property {number} [segments]
 * @property {typeof TILE_V1} [tile]
 */

/** Snap mm coordinates so mirrored magnet samples share exact keys. */
function snapMm(value) {
  return Math.round(value * 1e10) / 1e10;
}

/**
 * @param {import("./mesh.js").GrowableMesh} mesh
 * @param {ReturnType<typeof createVertexDeduper>} v
 * @param {number} minX
 * @param {number} minY
 * @param {number} maxX
 * @param {number} maxY
 * @param {number} z
 * @param {boolean} normalUp
 */
function addRectZ(mesh, v, minX, minY, maxX, maxY, z, normalUp) {
  const a = v.get(snapMm(minX), snapMm(minY), z);
  const b = v.get(snapMm(maxX), snapMm(minY), z);
  const c = v.get(snapMm(maxX), snapMm(maxY), z);
  const d = v.get(snapMm(minX), snapMm(maxY), z);
  if (normalUp) addQuad(mesh, a, b, c, d);
  else addQuad(mesh, a, d, c, b);
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {Array<{ x: number, y: number }>} unitPts
 */
function squareSamplePoints(cx, cy, radius, unitPts) {
  /** @type {Array<{ x: number, y: number }>} */
  const pts = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const u of unitPts) {
    const s = raySquareIntersection(u.x, u.y, radius);
    const x = snapMm(cx + s.x);
    const y = snapMm(cy + s.y);
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pts.push({ x, y });
  }
  return pts;
}

/**
 * @param {Array<{ x: number, y: number }>} pts
 * @param {number} cy
 * @param {number} radius
 * @param {"top" | "bottom"} side
 */
function squareSidePointsSortedX(pts, cy, radius, side) {
  const targetY = snapMm(side === "top" ? cy + radius : cy - radius);
  return pts
    .filter((p) => p.y === targetY)
    .sort((a, b) => a.x - b.x);
}

/**
 * @param {Array<{ x: number, y: number }>} pts
 * @param {number} cx
 * @param {number} radius
 * @param {"left" | "right"} side
 */
function squareSidePointsSortedY(pts, cx, radius, side) {
  const targetX = snapMm(side === "left" ? cx - radius : cx + radius);
  return pts
    .filter((p) => p.x === targetX)
    .sort((a, b) => a.y - b.y);
}

/**
 * Annulus between circle and circumscribed square.
 * @param {import("./mesh.js").GrowableMesh} mesh
 * @param {ReturnType<typeof createVertexDeduper>} v
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} z
 * @param {boolean} normalUp
 * @param {Array<{ x: number, y: number }>} unitPts
 */
function addCircleSquareAnnulus(mesh, v, cx, cy, radius, z, normalUp, unitPts) {
  const n = unitPts.length;
  for (let i = 0; i < n; i += 1) {
    const u0 = unitPts[i];
    const u1 = unitPts[(i + 1) % n];
    const s0 = raySquareIntersection(u0.x, u0.y, radius);
    const s1 = raySquareIntersection(u1.x, u1.y, radius);
    const c0 = v.get(snapMm(cx + u0.x * radius), snapMm(cy + u0.y * radius), z);
    const c1 = v.get(snapMm(cx + u1.x * radius), snapMm(cy + u1.y * radius), z);
    const q0 = v.get(snapMm(cx + s0.x), snapMm(cy + s0.y), z);
    const q1 = v.get(snapMm(cx + s1.x), snapMm(cy + s1.y), z);
    const touch0 = c0 === q0;
    const touch1 = c1 === q1;
    if (normalUp) {
      if (!touch0 && !touch1) {
        addTriangle(mesh, c0, q0, q1);
        addTriangle(mesh, c0, q1, c1);
      } else if (touch0 && !touch1) {
        addTriangle(mesh, c0, q1, c1);
      } else if (!touch0 && touch1) {
        addTriangle(mesh, c0, q0, c1);
      }
    } else if (!touch0 && !touch1) {
      addTriangle(mesh, c0, q1, q0);
      addTriangle(mesh, c0, c1, q1);
    } else if (touch0 && !touch1) {
      addTriangle(mesh, c0, c1, q1);
    } else if (!touch0 && touch1) {
      addTriangle(mesh, c0, c1, q0);
    }
  }
}

/**
 * @param {import("./mesh.js").GrowableMesh} mesh
 * @param {ReturnType<typeof createVertexDeduper>} v
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} z
 * @param {Array<{ x: number, y: number }>} unitPts
 * @param {boolean} normalDown
 */
function addDisk(mesh, v, cx, cy, radius, z, unitPts, normalDown) {
  const center = v.get(snapMm(cx), snapMm(cy), z);
  const n = unitPts.length;
  for (let i = 0; i < n; i += 1) {
    const u0 = unitPts[i];
    const u1 = unitPts[(i + 1) % n];
    const a = v.get(snapMm(cx + u0.x * radius), snapMm(cy + u0.y * radius), z);
    const b = v.get(snapMm(cx + u1.x * radius), snapMm(cy + u1.y * radius), z);
    if (normalDown) addTriangle(mesh, center, b, a);
    else addTriangle(mesh, center, a, b);
  }
}

/**
 * @param {import("./mesh.js").GrowableMesh} mesh
 * @param {ReturnType<typeof createVertexDeduper>} v
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} zBottom
 * @param {number} zTop
 * @param {Array<{ x: number, y: number }>} unitPts
 */
function addCylinderCavityWall(mesh, v, cx, cy, radius, zBottom, zTop, unitPts) {
  const n = unitPts.length;
  for (let i = 0; i < n; i += 1) {
    const u0 = unitPts[i];
    const u1 = unitPts[(i + 1) % n];
    const x0 = snapMm(cx + u0.x * radius);
    const y0 = snapMm(cy + u0.y * radius);
    const x1 = snapMm(cx + u1.x * radius);
    const y1 = snapMm(cy + u1.y * radius);
    const b0 = v.get(x0, y0, zBottom);
    const b1 = v.get(x1, y1, zBottom);
    const t0 = v.get(x0, y0, zTop);
    const t1 = v.get(x1, y1, zTop);
    addQuad(mesh, b0, t0, t1, b1);
  }
}

/**
 * Horizontal strip: poly along one Y, opposite straight edge at yOpposite.
 * Records outer perimeter points when the opposite edge is a tile boundary.
 *
 * @param {import("./mesh.js").GrowableMesh} mesh
 * @param {ReturnType<typeof createVertexDeduper>} v
 * @param {Array<{ x: number, y: number }>} poly
 * @param {number} yOpposite
 * @param {number} z
 * @param {boolean} normalUp
 * @param {boolean} polyIsLowY
 * @param {Array<{ x: number, y: number }> | null} outerRecord
 */
function addHorizontalStripAgainstPoly(
  mesh,
  v,
  poly,
  yOpposite,
  z,
  normalUp,
  polyIsLowY,
  outerRecord,
) {
  /** @type {Array<{ x: number, y: number }>} */
  const outerPts = [];
  for (let i = 0; i < poly.length - 1; i += 1) {
    const p0 = poly[i];
    const p1 = poly[i + 1];
    if (p0.x === p1.x) continue;
    const a = v.get(p0.x, p0.y, z);
    const b = v.get(p1.x, p1.y, z);
    const c = v.get(p1.x, snapMm(yOpposite), z);
    const d = v.get(p0.x, snapMm(yOpposite), z);
    if (polyIsLowY) {
      if (normalUp) addQuad(mesh, a, b, c, d);
      else addQuad(mesh, a, d, c, b);
    } else if (normalUp) {
      addQuad(mesh, d, c, b, a);
    } else {
      addQuad(mesh, d, a, b, c);
    }
    outerPts.push({ x: p0.x, y: snapMm(yOpposite) });
  }
  if (poly.length) {
    const last = poly[poly.length - 1];
    outerPts.push({ x: last.x, y: snapMm(yOpposite) });
  }
  if (outerRecord) {
    for (const p of outerPts) outerRecord.push(p);
  }
}

/**
 * @param {import("./mesh.js").GrowableMesh} mesh
 * @param {ReturnType<typeof createVertexDeduper>} v
 * @param {number} xLeft
 * @param {number} xRight
 * @param {number} yBottom
 * @param {number} yTop
 * @param {number} z
 * @param {boolean} normalUp
 * @param {Array<{ x: number, y: number }> | null} leftPoly
 * @param {Array<{ x: number, y: number }> | null} rightPoly
 * @param {Array<{ x: number, y: number }> | null} [recordLeft]
 * @param {Array<{ x: number, y: number }> | null} [recordRight]
 */
function addVerticalBand(
  mesh,
  v,
  xLeft,
  xRight,
  yBottom,
  yTop,
  z,
  normalUp,
  leftPoly,
  rightPoly,
  recordLeft = null,
  recordRight = null,
) {
  /** @type {number[]} */
  const ys = [snapMm(yBottom), snapMm(yTop)];
  if (leftPoly) for (const p of leftPoly) ys.push(p.y);
  if (rightPoly) for (const p of rightPoly) ys.push(p.y);
  const uniq = [...new Set(ys)].sort((a, b) => a - b);
  for (let i = 0; i < uniq.length - 1; i += 1) {
    const y0 = uniq[i];
    const y1 = uniq[i + 1];
    if (y0 === y1) continue;
    addRectZ(mesh, v, xLeft, y0, xRight, y1, z, normalUp);
    if (recordLeft) {
      recordLeft.push({ x: snapMm(xLeft), y: y0 });
    }
    if (recordRight) {
      recordRight.push({ x: snapMm(xRight), y: y0 });
    }
  }
  if (recordLeft) recordLeft.push({ x: snapMm(xLeft), y: uniq[uniq.length - 1] });
  if (recordRight) recordRight.push({ x: snapMm(xRight), y: uniq[uniq.length - 1] });
}

/**
 * @returns {{
 *   bottomOuter: { south: Array<{x:number,y:number}>, north: Array<{x:number,y:number}>, west: Array<{x:number,y:number}>, east: Array<{x:number,y:number}> }
 * }}
 */
function addFaceWithMagnetHoles(mesh, v, tile, z, normalUp, radius, unitPts) {
  const minX = snapMm(tile.boundsMm.minX);
  const maxX = snapMm(tile.boundsMm.maxX);
  const minY = snapMm(tile.boundsMm.minY);
  const maxY = snapMm(tile.boundsMm.maxY);
  const r = snapMm(radius);
  const sorted = [...tile.magnetCentersMm].sort((a, b) => a.x - b.x);

  const magnets = sorted.map((m) => {
    const pts = squareSamplePoints(m.x, m.y, radius, unitPts);
    return {
      m: { x: snapMm(m.x), y: snapMm(m.y) },
      top: squareSidePointsSortedX(pts, m.y, radius, "top"),
      bottom: squareSidePointsSortedX(pts, m.y, radius, "bottom"),
      left: squareSidePointsSortedY(pts, m.x, radius, "left"),
      right: squareSidePointsSortedY(pts, m.x, radius, "right"),
    };
  });

  for (let i = 0; i < sorted.length; i += 1) {
    const m = sorted[i];
    addCircleSquareAnnulus(mesh, v, m.x, m.y, radius, z, normalUp, unitPts);
  }

  /** @type {Array<{ x: number, y: number }>} */
  const southOuter = [];
  /** @type {Array<{ x: number, y: number }>} */
  const northOuter = [];
  /** @type {Array<{ x: number, y: number }>} */
  const westMid = [];
  /** @type {Array<{ x: number, y: number }>} */
  const eastMid = [];

  /** @type {Array<{ x: number, y: number }>} */
  const topPoly = [{ x: minX, y: r }];
  for (const mag of magnets) {
    for (const p of mag.top) topPoly.push(p);
  }
  topPoly.push({ x: maxX, y: r });
  addHorizontalStripAgainstPoly(mesh, v, topPoly, maxY, z, normalUp, true, northOuter);

  /** @type {Array<{ x: number, y: number }>} */
  const bottomPoly = [{ x: minX, y: -r }];
  for (const mag of magnets) {
    for (const p of mag.bottom) bottomPoly.push(p);
  }
  bottomPoly.push({ x: maxX, y: -r });
  addHorizontalStripAgainstPoly(mesh, v, bottomPoly, minY, z, normalUp, false, southOuter);

  let cursor = minX;
  for (let mi = 0; mi < magnets.length; mi += 1) {
    const mag = magnets[mi];
    const left = snapMm(mag.m.x - r);
    const right = snapMm(mag.m.x + r);
    if (left > cursor) {
      const prev = mi > 0 ? magnets[mi - 1] : null;
      addVerticalBand(
        mesh,
        v,
        cursor,
        left,
        -r,
        r,
        z,
        normalUp,
        prev ? prev.right : null,
        mag.left,
        cursor === minX ? westMid : null,
        null,
      );
    }
    cursor = right;
  }
  if (cursor < maxX) {
    const last = magnets[magnets.length - 1];
    addVerticalBand(
      mesh,
      v,
      cursor,
      maxX,
      -r,
      r,
      z,
      normalUp,
      last.right,
      null,
      null,
      eastMid,
    );
  }

  /**
   * @param {Array<{ x: number, y: number }>} pts
   */
  function uniqPoly(pts) {
    /** @type {Array<{ x: number, y: number }>} */
    const out = [];
    /** @type {Set<string>} */
    const seen = new Set();
    for (const p of pts) {
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }

  const west = uniqPoly([
    { x: minX, y: minY },
    { x: minX, y: -r },
    ...westMid,
    { x: minX, y: r },
    { x: minX, y: maxY },
  ]).sort((a, b) => a.y - b.y);

  const east = uniqPoly([
    { x: maxX, y: minY },
    { x: maxX, y: -r },
    ...eastMid,
    { x: maxX, y: r },
    { x: maxX, y: maxY },
  ]).sort((a, b) => a.y - b.y);

  return {
    bottomOuter: {
      south: uniqPoly(southOuter).sort((a, b) => a.x - b.x),
      north: uniqPoly(northOuter).sort((a, b) => a.x - b.x),
      west,
      east,
    },
  };
}

/**
 * Solid top face matching wall perimeter XY samples on all four sides.
 */
function addSubdividedSolidTop(mesh, v, z, normalUp, perimeter) {
  /** @type {number[]} */
  const xs = [];
  /** @type {number[]} */
  const ys = [];
  for (const p of perimeter.south) xs.push(p.x);
  for (const p of perimeter.north) xs.push(p.x);
  for (const p of perimeter.west) {
    xs.push(p.x);
    ys.push(p.y);
  }
  for (const p of perimeter.east) {
    xs.push(p.x);
    ys.push(p.y);
  }
  for (const p of perimeter.south) ys.push(p.y);
  for (const p of perimeter.north) ys.push(p.y);
  const uniqX = [...new Set(xs)].sort((a, b) => a - b);
  const uniqY = [...new Set(ys)].sort((a, b) => a - b);
  for (let ix = 0; ix < uniqX.length - 1; ix += 1) {
    for (let iy = 0; iy < uniqY.length - 1; iy += 1) {
      addRectZ(mesh, v, uniqX[ix], uniqY[iy], uniqX[ix + 1], uniqY[iy + 1], z, normalUp);
    }
  }
}

/**
 * @param {{
 *   south: Array<{x:number,y:number}>,
 *   north: Array<{x:number,y:number}>,
 *   west: Array<{x:number,y:number}>,
 *   east: Array<{x:number,y:number}>
 * }} peri
 */
function sameXyPerimeter(peri) {
  return {
    south: peri.south.map((p) => ({ ...p })),
    north: peri.north.map((p) => ({ ...p })),
    west: peri.west.map((p) => ({ ...p })),
    east: peri.east.map((p) => ({ ...p })),
  };
}

/**
 * Outer walls with subdivided edges matching planar face perimeters.
 */
function addOuterWallsSubdivided(mesh, v, z0, z1, bottomPerimeter, topPerimeter) {
  /**
   * @param {Array<{x:number,y:number}>} bottom
   * @param {Array<{x:number,y:number}>} top
   * @param {boolean} flip
   */
  function wallStrip(bottom, top, flip) {
    if (bottom.length < 2 || top.length < 2) return;
    const t = top.length === bottom.length
      ? top
      : bottom.map((p) => (
        top[0].x === top[top.length - 1].x
          ? { x: top[0].x, y: p.y }
          : { x: p.x, y: top[0].y }
      ));
    for (let i = 0; i < bottom.length - 1; i += 1) {
      const b0 = v.get(bottom[i].x, bottom[i].y, z0);
      const b1 = v.get(bottom[i + 1].x, bottom[i + 1].y, z0);
      const t0 = v.get(t[i].x, t[i].y, z1);
      const t1 = v.get(t[i + 1].x, t[i + 1].y, z1);
      if (flip) addQuad(mesh, b0, b1, t1, t0);
      else addQuad(mesh, b0, t0, t1, b1);
    }
  }

  // South (−Y): poly left→right, flip true → outward −Y
  wallStrip(bottomPerimeter.south, topPerimeter.south, true);
  // North (+Y): poly left→right, flip false → outward +Y
  wallStrip(bottomPerimeter.north, topPerimeter.north, false);
  // West (−X): poly bottom→top, flip false → outward −X
  wallStrip(bottomPerimeter.west, topPerimeter.west, false);
  // East (+X): poly bottom→top, flip true → outward +X
  wallStrip(bottomPerimeter.east, topPerimeter.east, true);
}

/**
 * Bottom face + magnet cavities/ceilings only (no outer walls, no top).
 * Used by relief combined meshing. Flat combined keeps a separate construction
 * order for byte-identical golden output.
 *
 * @param {TileMeshOptions} [options]
 * @returns {{
 *   mesh: import("./mesh.js").GrowableMesh,
 *   vertexDeduper: ReturnType<typeof createVertexDeduper>,
 *   bottomOuter: {
 *     south: Array<{x:number,y:number}>,
 *     north: Array<{x:number,y:number}>,
 *     west: Array<{x:number,y:number}>,
 *     east: Array<{x:number,y:number}>
 *   },
 *   tile: typeof TILE_V1,
 *   zBottom: number,
 *   zRecessTop: number,
 *   radius: number,
 *   unitPts: Array<{ x: number, y: number }>
 * }}
 */
export function buildCombinedTileOpenShell(options = {}) {
  const tile = options.tile || TILE_V1;
  const segments = options.segments ?? MAGNET_CIRCLE_SEGMENTS;
  const radius = magnetRadiusMm(tile);
  const unitPts = unitCirclePoints(segments);
  const zBottom = tile.boundsMm.minZ;
  const zRecessTop = tile.baseThicknessMm;

  const mesh = createMesh();
  const v = createVertexDeduper(mesh);

  const { bottomOuter } = addFaceWithMagnetHoles(
    mesh,
    v,
    tile,
    zBottom,
    false,
    radius,
    unitPts,
  );

  for (const m of tile.magnetCentersMm) {
    addCylinderCavityWall(mesh, v, m.x, m.y, radius, zBottom, zRecessTop, unitPts);
    addDisk(mesh, v, m.x, m.y, radius, zRecessTop, unitPts, true);
  }

  return {
    mesh,
    vertexDeduper: v,
    bottomOuter,
    tile,
    zBottom,
    zRecessTop,
    radius,
    unitPts,
  };
}

/**
 * Combined single-color Tile V1 solid: 148×53×4 with bottom magnet recesses to Z=2.5.
 * Construction order is frozen for golden STL byte identity.
 * @param {TileMeshOptions} [options]
 * @returns {import("./mesh.js").PackedMesh}
 */
export function buildCombinedTileMesh(options = {}) {
  const tile = options.tile || TILE_V1;
  const segments = options.segments ?? MAGNET_CIRCLE_SEGMENTS;
  const radius = magnetRadiusMm(tile);
  const unitPts = unitCirclePoints(segments);
  const zBottom = tile.boundsMm.minZ;
  const zRecessTop = tile.baseThicknessMm;
  const zTop = tile.totalThicknessMm;

  const mesh = createMesh();
  const v = createVertexDeduper(mesh);

  const { bottomOuter } = addFaceWithMagnetHoles(
    mesh,
    v,
    tile,
    zBottom,
    false,
    radius,
    unitPts,
  );
  const topPeri = sameXyPerimeter(bottomOuter);
  addSubdividedSolidTop(mesh, v, zTop, true, topPeri);
  addOuterWallsSubdivided(mesh, v, zBottom, zTop, bottomOuter, topPeri);

  for (const m of tile.magnetCentersMm) {
    addCylinderCavityWall(mesh, v, m.x, m.y, radius, zBottom, zRecessTop, unitPts);
    addDisk(mesh, v, m.x, m.y, radius, zRecessTop, unitPts, true);
  }

  return packMesh(mesh);
}

/**
 * Aligned base mesh: Z 0…2.5 with through magnet holes (open top and bottom).
 * @param {TileMeshOptions} [options]
 * @returns {import("./mesh.js").PackedMesh}
 */
export function buildBaseTileMesh(options = {}) {
  const tile = options.tile || TILE_V1;
  const segments = options.segments ?? MAGNET_CIRCLE_SEGMENTS;
  const radius = magnetRadiusMm(tile);
  const unitPts = unitCirclePoints(segments);
  const zBottom = tile.boundsMm.minZ;
  const zTop = tile.baseThicknessMm;

  const mesh = createMesh();
  const v = createVertexDeduper(mesh);

  const topFace = addFaceWithMagnetHoles(mesh, v, tile, zTop, true, radius, unitPts);
  const bottomFace = addFaceWithMagnetHoles(mesh, v, tile, zBottom, false, radius, unitPts);
  addOuterWallsSubdivided(
    mesh,
    v,
    zBottom,
    zTop,
    bottomFace.bottomOuter,
    topFace.bottomOuter,
  );

  for (const m of tile.magnetCentersMm) {
    addCylinderCavityWall(mesh, v, m.x, m.y, radius, zBottom, zTop, unitPts);
  }

  return packMesh(mesh);
}
