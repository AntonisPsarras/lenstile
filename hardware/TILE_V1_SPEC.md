# Tile V1 Hardware Specification

**Version:** 1.1  
**Reference mesh:** `hardware/Body122.stl` (do not modify)  
**Coordinate convention (application):** center of the tile is the origin

## Physical dimensions

| Property | Value | Unit | Notes |
|----------|-------|------|-------|
| Width | 148 | mm | X extent |
| Height | 53 | mm | Y extent |
| Total thickness | 4.0 | mm | Z extent |
| Base section thickness | 2.5 | mm | Single-color structural base with magnet cavities |
| Structural bridge thickness | 0.5 | mm | Full-width base-color slab Z 2.5…3.0 |
| Artwork section thickness | 1.0 | mm | Decorative palette colors / Relief only (Z 3.0…4.0) |
| Corner radius | 0 | mm | Sharp corners in reference STL |
| Magnet recess diameter | 8.5 | mm | Radius 4.25 mm |
| Magnet recess depth | 2.5 | mm | Inspected from STL; see confidence |
| Left magnet center from left edge | 49 | mm | |
| Right magnet center from right edge | 49 | mm | |
| Magnet center-to-center | 50 | mm | |

## Vertical structure (Milestone 9.1)

Tile V1 is a three-section extrusion:

| Section | Z range (mm) | Thickness | Role |
|---------|--------------|-----------|------|
| Base | 0.0 … 2.5 | 2.5 mm | Always one single-color object; magnet pockets live here |
| Structural bridge | 2.5 … 3.0 | 0.5 mm | Continuous full-tile base-color slab (bridging layer) |
| Artwork | 3.0 … 4.0 | 1.0 mm | Decorative artwork and palette colors / Relief only |

Rules:

- Magnet cavities end at **Z = 2.5 mm**; cavity openings remain on the underside
- From **Z = 2.5 mm through Z = 3.0 mm**, the entire 148 × 53 mm footprint is one continuous structural base-color slab
- No image-color artwork, multicolor boundary, or Relief variation may exist in Z 2.5…3.0
- Artwork section starts globally at **Z = 3.0 mm** (`artworkStartZMm`)
- There is **no** local circular magnet backing, no visible radial keepout disk, and no full-height Z 2.5…4.0 roof child
- Finished top is **Z = 4.0 mm** (`artworkEndZMm` / `totalThicknessMm`) for Flat mode
- **Optional Relief mode (Milestone 6.2):** decorative top may vary between **Z = 3.4 mm** and **Z = 4.0 mm** (at most four distinct levels). Lowest relief top leaves ≥ **0.9 mm** above the magnet recess ceiling at Z = 2.5; Relief remains visible above the bridge
- **Structural bridge (Milestone 9.1):** full-width 0.5 mm slab; accepted cleaned indices unchanged; cavities Z 0…2.5 unchanged; bridge may be a separate 3MF child sharing the base color property
- **No decorative geometry may extend below Z = 3.0 mm**
- Artwork objects together must cover the intended upper artwork area
- Flat mode: final top surface is flat at 4.0 mm. Relief mode: stepped tops; nothing may exceed 4.0 mm
- Magnet recesses are cut from the bottom into the base section only
- Magnet depth (2.5 mm) does not exceed the base section thickness
- Relief geometry must not enter magnet recess volumes

Invariants enforced in `src/geometry/tile-spec.js`:

- `baseThicknessMm + structuralBridgeThicknessMm + artworkThicknessMm === totalThicknessMm`
- `structuralBridgeStartZMm === baseThicknessMm`
- `structuralBridgeEndZMm === structuralBridgeStartZMm + structuralBridgeThicknessMm`
- `artworkStartZMm === structuralBridgeEndZMm`
- `artworkEndZMm === totalThicknessMm`
- `magnetDepthMm <= baseThicknessMm`

Relief constants in `src/geometry/relief.js` additionally enforce:

- `maxTopZMm === totalThicknessMm` (4.0)
- `minTopZMm >= 3.4` and `minTopZMm > artworkStartZMm`
- minimum roof `minTopZMm - baseThicknessMm >= 0.9`
- at most four distinct height levels

## Application coordinate system

Origin at the geometric center of the tile bounding box.

| Axis | Bounds | Direction |
|------|--------|-----------|
| X | −74 … +74 mm | Width |
| Y | −26.5 … +26.5 mm | Height |
| Z | 0 … 4 mm | Thickness; Z=0 is the bottom face |

### Magnet centers (application frame)

| Magnet | (X, Y) mm |
|--------|-----------|
| Left | (−25, 0) |
| Right | (+25, 0) |

Both centers lie on the horizontal centerline (Y = 0).

## STL inspection results (`Body122.stl`)

Inspected 2026-07-23. Source file was **not** modified.

| Property | Result |
|----------|--------|
| Format | Binary STL |
| Header | `STLB ATF 15.8.0.0` (Autodesk Fusion export) |
| File size | 12 684 bytes |
| Triangle count | 252 |
| AABB size | 148.0 × 53.0 × 4.0 mm |
| AABB min (CAD) | (−556.5, −236.5, 1.0) |
| AABB max (CAD) | (−408.5, −183.5, 5.0) |
| AABB center (CAD) | (−482.5, −210.0, 3.0) |
| Distinct Z levels | 1.0, 3.5, 5.0 |
| Outer corners | Sharp (radius 0); single corner vertex at each AABB corner |
| Magnet radius | 4.25 mm (exact within float noise) |
| Magnet centers (CAD) | (−507.5, −210.0) and (−457.5, −210.0) — i.e. center ± 25 mm in X |
| Recess opening | Bottom face (Z = 1.0 CAD); no bottom triangles inside cylinders |
| Recess floor | Z = 3.5 CAD |
| Material above recess floor | 1.5 mm (to Z = 5.0) |

Interpretation relative to the frozen vertical structure:

- CAD Z span 1.0 → 5.0 maps to application Z 0 → 4 after recentering by `zMin_cad`
- Recess walls 1.0 → 3.5 CAD → **2.5 mm** depth from the bottom (base section)
- Material above the recess floor (1.5 mm) aligns with the **artwork section** thickness

### Transform from CAD AABB to application frame

```
x_app = x_cad - centerX_cad
y_app = y_cad - centerY_cad
z_app = z_cad - zMin_cad
```

With the inspected mesh: `centerX_cad = -482.5`, `centerY_cad = -210.0`, `zMin_cad = 1.0`.

## Magnet depth confidence

| Claim | Value | Confidence | Basis |
|-------|-------|------------|-------|
| Recess diameter | 8.5 mm | **High** | Rim vertices at r ≈ 4.25 |
| Recess depth | 2.5 mm | **High** | Only Z ∈ {1.0, 3.5, 5.0}; walls span 1.0→3.5 |
| Opening face | Bottom | **High** | Hole in bottom; floor at mid Z |
| Designer-intended depth | — | **Unresolved as a written manufacturer spec** | Depth inferred from mesh, not a separate datasheet |

**Do not invent a different depth.** Use `2.5` mm in code when a depth is required, and keep `TILE_V1.magnetDepthMm` sourced from this inspection note. If a future hardware revision differs, bump the tile version.

## Known unknowns

- Exact manufacturing tolerance band for the case pocket (not in STL).
- Whether future tile revisions will add corner fillets.
- Artwork clearance relative to magnet recesses (product policy; default: artwork must not undercut recess volumes).
- Preferred print orientation for end users.

## Manufacturing tolerances (working guidance)

Working mesh-validation tolerances (not certified metrology):

| Feature | Working tolerance |
|---------|-------------------|
| Outer envelope | ±0.2 mm |
| Magnet diameter | ±0.1 mm |
| Magnet center position | ±0.2 mm |
| Thickness | ±0.15 mm |

These are **guidance for mesh validation warnings**, not certified metrology.

## Geometry tolerances (software)

| Concern | Rule |
|---------|------|
| Coordinate comparison | Prefer exact mm constants from this spec |
| Float equality in tests | `assertApproxEqual` with documented epsilon (default 1e-6 mm unless noted) |
| Rounding | Only at export serialization boundaries when required by format |
| Triangle area | Reject area ≤ 1e-12 mm² as zero-area |

## Versioning rules

- **Tile V1** is defined by this document and `Body122.stl`.
- Breaking changes to dimensions, magnet layout, or origin convention require **Tile V2** (new folder/spec) and a project-file migration note.
- Non-breaking documentation clarifications keep V1 and bump the doc patch notes in git history.

## Compatibility rules

- Generated meshes **must** use the application center-origin frame.
- Exported single-color STL may optionally include the tile base derived from (or aligned to) the reference geometry after recentering.
- Multicolor parts must share the same origin and units (millimetres).
- Do not bake the CAD AABB offset (−482.5, −210.0, …) into the public project format.
- **Milestones 4–6:** procedural Tile V1 meshes are generated in-app (combined STL + aligned base/color STLs). `Body122.stl` remains the inspection reference and must not be modified. Magnet recesses use `MAGNET_CIRCLE_SEGMENTS = 64`. Confirm fit and print quality on your printer and case before batch printing.
- **Milestone 7.1 — multicolor 3MF:** packages the same validated base + used artwork meshes as one parent multipart assembly (millimetre units, identity transforms, shared origin, one build item). Uses Materials-extension `m:colorgroup` color resources for design intent — not Core `basematerials`/`displaycolor` as printable color. No vendor-specific Bambu/Prusa/Cura/Orca extensions, profiles, or thumbnails. Standard RGB does not auto-select AMS slots; confirm import and filament mapping manually. Separate aligned STLs remain the fallback.