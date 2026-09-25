# Architecture

## Overview

LensTile is a static, dependency-free browser application. There is no build step. ES modules are loaded directly by the browser.

```
index.html
   └── src/app.js
         ├── state.js          centralized immutable-style state + runtime stores
         ├── config.js         constants, feature flags, profile re-exports
         ├── config/           PRINT_PROFILES, DETAIL_PROFILES (immutable)
         ├── events.js         lightweight pub/sub
         ├── validation.js     input / settings validation
         ├── ui/*              DOM layout, controls, image-import controller
         ├── image/*           load, transform, quantize, preview
         ├── geometry/*        tile spec, mesh, extrusion
         ├── export/*          STL / 3MF (project JSON helpers)
         └── workers/*         off-main-thread jobs
```

## Layering rules

1. **UI** may read state and dispatch intents; it must not own algorithm logic.
2. **Image / geometry / export** modules expose pure or narrowly side-effecting functions.
3. **Workers** receive transferable/plain data only — never DOM nodes.
4. **Serializable project JSON** must not include `ImageBitmap`, canvas, index buffers, RGBA buffers, or worker handles.
5. **Hardware constants** live in `src/geometry/tile-spec.js` and are documented in `hardware/TILE_V1_SPEC.md`.
6. **Print/detail thresholds** live only in frozen profile config; UI and state store profile IDs and derive numbers.

## State

- Single source of truth in `state.js` for serializable project fields.
- Runtime-only stores (source bitmap, quantization indices / preview RGBA) live beside state.
- `sourceRevision` increments whenever result-affecting inputs change (image, crop transform, detail profile, color count, transparency, algorithm settings). Palette overrides do **not** bump the revision.
- `printabilityRevision` increments when the nozzle profile ID changes (invalidates cleanup).
- Updates return new state objects (shallow immutable style).
- Subscribers render from state; canvas redraws are scheduled with `requestAnimationFrame`.
- **Milestone 7.4.1 workflow runtime** (`getRuntimeWorkflow()`): FSM `pipelineStatus`, operation ids, stage progress fields, watchdog flags, `needsReview`, `cropNeedsUpdate`. Never serialized.
- **FSM:** `src/workflow/workflow-fsm.js` defines `ALLOWED_TRANSITIONS` and rejects illegal edges in tests.
- **Live vs committed crop:** `setLiveTransform` updates preview without bumping `sourceRevision`; `commitLiveTransform` / `setTransform` commits and invalidates dependents.
- **Coordinator:** `src/workflow/pipeline.js` + `dependency-graph.js` + `pipeline-status.js` call existing controllers without duplicating algorithms. Every async path uses `try`/`catch`/`finally` and returns `{ status: "success"|"error"|"superseded", operationId }`.
- **Approval/build boundary:** color→printable pipelines stop at `waiting-for-review`. `regenerateModel` / `ensureModelAfterApproval` require an approved current printable design. `canGenerate` must not self-block on `building-model` (7.4.1 deadlock fix).
- **Watchdog:** after 15s show “This is taking longer than usual” with Cancel/Retry; do not auto-fail solely on elapsed time.
- Nozzle change: stay on Make printable → colors → analyze → recommended fix → review → Use this design → Download auto-builds once.

## Image import (Milestone 2.1)

- One hidden `#image-input`; only `openImagePicker()` in `image-import-controller.js` may call `input.click()`.
- Choose image, Replace image, and the empty drop zone (click / Enter / Space) call that function; Fit/Fill/Reset/Rotate/Flip/steps must not.
- Choose / Replace / drag-and-drop share `importImageFile()` → `loadImageFile()`.
- Empty state: accessible DOM drop zone over the canvas shell. Loaded state: canvas is pan/zoom only; Remove clears bitmap, crop, and quantization after confirm.

## Printer and detail profiles

- `PRINT_PROFILES` / `DETAIL_PROFILES` are deep-frozen; values are conservative defaults for 0.2 mm and 0.4 mm nozzles — verify on your printer.
- Nozzle choices are **0.2 mm Fine detail** and **0.4 mm Standard** (default). These are nozzle diameters, not layer heights.
- Legacy `nozzle06` migrates to `nozzle04` (`PRINT_PROFILES_VERSION = 2`).
- State stores `printability.profileId` and `quantization.detailProfileId`.
- Quantization reads numeric ppm via `getResolutionPxPerMm()` (derived from the **nozzle** processing profile; Milestone 7.3.2).
- Serialization includes profile IDs + `printProfilesVersion` / `detailProfilesVersion`. Legacy numeric `resolutionPxPerMm` migrates to the nearest detail profile.

## Tile V1 geometry constants

- `src/geometry/tile-spec.js` freezes envelope, magnets, and vertical structure:
  - Base 2.5 mm (Z 0…2.5), structural bridge 0.5 mm (Z 2.5…3.0), artwork 1.0 mm (Z 3.0…4.0), total 4.0 mm
  - `MAGNET_CIRCLE_SEGMENTS = 64` for recess approximation
- Mesh generation (Milestones 4–6): constructive boundary meshes (no CSG library)

## Geometry and STL export (Milestones 4–6.2.3)

- Mesh model: indexed `{ positions, triangles }` in `geometry/mesh.js`
- Raster mapping: column 0 at X=−74, row 0 at Y=+26.5 (rows toward −Y)
- Rectangle merge in `mask-to-rectangles.js`; artwork solids via boundary-face extrusion per 4-connected component
- **Per-color vertex policy (6.2.2):** within a component, grid vertices are sector-scoped — edge-adjacent cells share indices; diagonal-only contacts keep distinct identities so self-touching arms do not create incidence-4 edges. Disconnected islands still use separate namespaces after `mergeMeshes`
- Combined single-color STL (Flat): full 148×53×4 mm closed solid with bottom magnet recesses to Z=2.5
- Combined relief STL: same base/magnets + variable top in 3.4…4.0 mm (`relief.js`, `relief-mesh.js`)
- Relief saddles (Milestone 6.2.1): ambiguous 2×2 junctions resolved with a deterministic diagonal; binary equal-diagonal saddles use sector-tagged vertices so opposite step walls do not share one cross-edge
- **Multi-height T-junctions (6.2.3):** junctions with 3+ distinct tops (missed by classical saddle detection) merge equal-height adjacent roles and close hanging vertical edges with an offset-apex fan (`needsReliefJunctionCap`, `mergeEqualHeightRoles`)
- Combined relief treats equal-height neighbors as one material (no interior walls from palette identity alone)
- Per-color relief: each palette object is an independent closed solid (coincident boundaries OK)
- Aligned set: base (Z 0…2.5, through-holes) + structural bridge (Z 2.5…3.0) + one artwork STL per used palette index (Flat: Z 3.0…4; Relief: Z 3.0…assigned top)
- Validation rejects boundary edges, incidence > 2, zero-area / duplicate triangles, and inconsistent windings; UI shows a plain-language primary error with Technical details (object name, edge counts, offending coordinates)
- Geometry debug fixture download under Technical details (`geometry-debug-fixture.js`) — local JSON only, no image, no network
- **Download invalidation:** `beginGeometryRequest` clears meshes; validation failure stores no downloadable meshes; surface changes bump `geometryRevision` and clear runtime geometry
- Serializable `surface` settings; mesh buffers remain runtime-only
- Binary STL writer in `export/binary-stl.js`; mesh worker in `workers/mesh-worker.js`
- Export requires accepted, current cleaned indices — never quantized fallback
- Geometry becomes stale on topology-affecting changes; palette RGB overrides stale relief only when automatic height order is active
- User-facing Download step uses plain labels; readiness checkmarks hide internal flags

## Multicolor 3MF export (Milestone 7.1 / 7.2)

- Modules: `export/crc32.js`, `export/zip-store.js`, `export/three-mf.js`, `export/three-mf-validate.js`, `export/three-mf-packaging.js`, `export/xml-escape.js`
- Packages already-validated `runtimeGeometry.base` + used `colors[]` — no remesh, repair, merge, or coordinate mutation
- Minimal package (Store ZIP, forward slashes, fixed DOS timestamp):
  - `[Content_Types].xml`
  - `_rels/.rels` → `/3D/3dmodel.model`
  - `3D/3dmodel.model` (`unit="millimeter"`)
- Structure: Materials `m:colorgroup` → child mesh objects → parent `<components>` assembly → **one** build item
- Color model: official Materials and Properties extension (`xmlns:m="…/material/2015/02"`, `recommendedextensions="m"`)
- Property strategy (Option A): child `pid`/`pindex` into the color group; parent has no mesh and no `pid`/`pindex`
- Explicit maps: `paletteIndex → colorGroupIndex` and `paletteIndex → childObjectId` (dense pindex ≠ palette index)
- Stable IDs: color group `1`, Tile Base `2`, Structural Bridge `3`, artwork `4+`, parent assembly last
- Core `basematerials`/`displaycolor` is not used for printable color intent
- Lazy generation on first 3MF download; `runtimeThreeMf` cache cleared on geometry rebuild, palette override, base-color edit, or project rename
- `export.baseColor` (default `#2A2A2A`) is serializable metadata only — does not rebuild geometry or appear in STL
- Prerequisites: image + current color preview + approved printable design + current valid geometry + ≥2 used artwork colors + structural-bridge mesh
- Filenames: `*-multicolor.3mf` / `*-relief-multicolor.3mf` (default basename `lenstile`)
- Default combined STL filenames: `lenstile-smooth.stl` / `lenstile-relief.stl`
- No editable Design name in the UI; `project.name` defaults to `lenstile` for serialization/filename helpers
- No vendor extensions, thumbnails, slicer profiles, or network APIs
- Standard RGB expresses design intent only; AMS filament mapping remains a slicer/user step
- Extension listed in `recommendedextensions` (not `requiredextensions`) so consumers that ignore Materials can still load printable geometry
- **Milestone 7.2 root cause:** Download validation still used Milestone 7’s `expectedObjectCount = 1 + usedColors` (children only), rejecting the valid 7.1 parent assembly (`Expected 5 objects, found 6` on the full four-color fixture). Fix: `expectedThreeMfObjectCount = usedColors + 2` (pre-roof).
- **Milestone 7.3 / 9.1:** structural bridge child; `expectedThreeMfObjectCount = usedColors + 3` (base + bridge + artwork + parent). Bridge shares base `pindex` 0 and is not an image color.
- Download adapter (`src/export/download.js`): production may download only from a real user click; tests inject `createTestDownloadAdapter()` (in-memory only).
- Staged packaging errors (`prepare-inputs` … `initiate-download`) surface in Technical details; concurrent downloads share one in-flight operation; 3MF failure clears stale package bytes but keeps STL geometry
- Full-size regression: `tests/fixtures/manual/Untitled_tile-geometry-debug.json`

## Structural bridge (Milestone 9.1)

- Full-width 0.5 mm base-colored slab across the entire 148 × 53 mm tile: Z 2.5…3.0
- `STRUCTURAL_BRIDGE` in `magnet-backing.js` (aliases retain `MAGNET_BACKING` for one transition)
- Artwork bottoms are globally Z = 3.0 mm; Relief tops unchanged (3.4…4.0)
- Dedicated closed bridge mesh (`magnet-backing-mesh.js` → full-tile box); Flat combined STL envelope unchanged; no visible top-surface disk
- Local circular 0.2 mm magnet disks (Milestone 7.3.2) are retired
- Website nozzle profile drives automatic processing grids (`PROCESSING_PROFILES`) and printable thresholds; user must select the matching nozzle in the slicer
- Thresholds are conservative defaults; verify on your printer and filament

## Relief saddles (Milestone 6.2.1)

- **Definition:** an ambiguous 2×2 cell junction where cardinal neighbor heights cross (equal-diagonal binary saddle, bilinear contour cross, separated diagonals, or four distinct heights with all four steps).
- **Diagonal rule:** greater combined top height → lower min palette index on that diagonal → northwest–southeast (`nwse`).
- **Combined relief:** equal-height neighbors are one material (no interior walls from palette identity alone). Binary-like saddles share preferred-diagonal sector tags; non-binary junctions use merged equal-height group tags plus a CCW offset-apex fan so no undirected edge has incidence ≠ 2.
- **Per-color relief:** each palette object is an independent closed solid; coincident boundaries between colors are acceptable.
- **Validation:** rejects boundary edges, incidence ≠ 2, zero-area / duplicate triangles, and inconsistent windings; reports object name, edge coords, incidence, and triangle IDs. Downloads stay disabled on failure.

## Per-color diagonal pinches (Milestone 6.2.2)

- **Defect:** a 4-connected same-color region that meets itself only at a grid point (diagonal self-touch) previously shared one vertical edge among four wall triangles (`boundary=0`, `nonManifold≥1`). Three such pinches match the real UI failure `nonManifold=3`.
- **Correction:** `vertexSectorsAt` unions only edge-adjacent occupants of each grid vertex; diagonal occupants keep separate sector tags in the vertex key.
- **Regression:** `tests/fixtures/manifold-pinch-golden.js` + legacy `vertexScope: "grid"` reproduces the old failure; default `sector` mode is closed. Exhaustive binary 3×3 coverage included.
- **Debug capture:** Download geometry debug case under Download → Technical details.

## Combined relief multi-height T-junctions (Milestone 6.2.3)

- **Defect:** real one-color Relief builds failed with `boundary=129` on the combined solid while Flat multicolor and all separate color meshes validated. Classical saddle detection missed 3+ distinct top heights meeting at a grid vertex when not all four cardinal steps differed (T-junction / multi-height corner). Step walls left unpaired vertical edges.
- **Fixture:** `tests/fixtures/combined-relief-geometry-debug.json` (exact browser export). Legacy `junctionCapMode: "ambiguous-only"` reproduces `boundary=129`.
- **Correction:** `needsReliefJunctionCap` also triggers on `uniqueHeights ≥ 3`; equal-height adjacent roles share a group tag; offset-apex fan walks merged groups.
- **Download safety:** build start clears prior meshes; validation failure does not retain downloadable buffers; surface changes invalidate geometry.

## Remaining geometry limitations

- Non-binary / multi-height junctions insert a small offset apex near the junction (intentional micro-geometry for manifold closure), not a large decorative bridge.
- Multicolor separate STLs may have coplanar opposing faces along shared XY boundaries; slicers typically treat this as aligned multi-body input.
- Confirm slicer import, any repair dialog, and filament mapping on a test file for your workflow.
- Multicolor 3MF packaging is implemented (Milestone 7.1/7.2 multipart + Materials color groups + full-size packaging repair); slicer filament assignment still needs manual confirmation.
## Printability (Milestone 3 / UI polish 6.1)

- Pure algorithms in `connected-components.js`, `mask-cleanup.js`, `printability.js`, `pixel-metrics.js`.
- Runtime store: `cleanedIndices`, `issueMask`, `report`, acceptance flag — separate from `runtime.quantization.indices`.
- Shared `image-worker.js` handles quantize + printability messages with revision-aware stale rejection.
- UI: Check only / Fix small details under Advanced; sticky **Use this design** after automatic check/fix; visible footer prerequisite copy when approval is blocked; derived thresholds under Technical details; plain-language issue summary.
- Palette RGB overrides do not invalidate topology cleanup; crop/quantize/nozzle changes do.

## Rendering

- `crop-renderer.js` paints the preview from state + runtime image bitmap.
- `drawTransformedImage` is shared with crop rasterization so quantization matches the editor.
- Crop math lives in pure `crop-transform.js` for testability.
- Dimmed exterior + tile overlay communicate the printable region.
- Printability comparison canvases live in the Make printable panel.
- Success feedback uses temporary toasts (`notifications.js`); errors remain until dismissed.

## Color quantization (Milestone 2)

- Output size: `round(148 × ppm)` × `round(53 × ppm)`, capped by `MAX_QUANTIZATION_PIXELS` (1 500 000). Oversized settings error; resolution is never silently reduced.
- Transparency: White / Black / Custom background with standard source-over compositing; clustering receives fully opaque RGB only.
- Algorithm: deterministic RGB frequency table + farthest-point centroid init + fixed-iteration k-means (`QUANTIZE_ALGORITHM_VERSION`, max 32 iterations). See `PROJECT_SPEC.md` and `src/image/quantize.js` for tie-breaks and palette ordering (population ↓, Rec. 709 luminance ↑, packed RGB ↑).
- One reusable module worker (`image-worker.js`) with an explicit request/response protocol; stale `requestId` / mismatched `sourceRevision` results are ignored.
- Palette overrides update the indexed preview locally without re-clustering.
- Standard UI labels this step “Create color preview” / “Image colors”.

## Determinism

- No `Math.random()` in product code.
- Fixed seeds only when an algorithm requires randomness — and then seeded explicitly.
- Stable iteration and palette ordering.

## Network policy

- Application source must not call network APIs.
- A repository scan test fails on prohibited patterns (`fetch(`, `XMLHttpRequest`, etc.).

## Testing

- Browser harness only: `tests/test-runner.html`
- No Node.js runner, no package manager, no test framework dependencies
- Prefer pure-function unit tests; UI workflow tests cover Milestone 6.1 terminology and Continue enablement

## Workers

- `image-worker.js` — quantization (M2) + printability analysis/cleanup (M3)
- `mesh-worker.js` — Tile V1 mesh generation / STL assembly (M4–6)
