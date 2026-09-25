# LensTile — Project Specification

## Problem

Owners of a modular glasses case need custom printable face tiles. Commercial workflows often require accounts, uploads, or paid tools. Users need a free, local, privacy-first browser tool that turns their own images into printable tile geometry without sending data off-device.

## Product identity

| Field | Value |
|-------|-------|
| Name | LensTile |
| Short description | Open-source magnetic image tiles for modular glasses cases. |
| Longer description | LensTile converts an image into a printable rectangular tile with magnetic mounting recesses for compatible modular glasses cases. |
| Preferred repository slug | `lenstile` |

## Audience

- Makers and 3D-printing hobbyists
- Glasses-case owners who want custom artwork tiles
- Contributors maintaining a zero-dependency static web app

## User journey

1. Open the app (static files in a browser).
2. Import a PNG, JPEG, or WebP image.
3. Reposition, crop, zoom, rotate, and flip within the 148×53 mm tile frame.
4. Choose 1–8 colors and create a deterministic color preview.
5. Optionally replace palette colors (“Image colors”).
6. Check the design for print problems, fix small details, and approve the printable design.
7. Build the printable model.
8. Download one-color STL and/or multicolor 3MF / separate color files.
9. Print with a local slicer. No account required.

## Functional requirements

| ID | Requirement |
|----|-------------|
| F1 | Local image import (PNG, JPEG, WebP) |
| F2 | Crop editor: pan, zoom, rotate 90°, flip H/V, fit, fill, reset |
| F3 | Deterministic color reduction for 1–8 colors |
| F4 | Manual palette color replacement |
| F5 | Printability cleanup and feature-width warnings |
| F6 | Single-color combined STL export (Flat or Relief) |
| F7 | Multicolor 3MF export |
| F8 | Separate aligned STL fallback for multicolor (Flat or Relief tops) |
| F10 | Four-step UI: 1. Image → 2. Colors → 3. Make printable → 4. Download |
| F11 | Keyboard-accessible controls and privacy notice |
| F12 | Optional relief surface style with strength and height order |

## Non-functional requirements

- Local-first, privacy-first; no accounts or network processing
- Deterministic algorithms (no `Math.random()`, no time-based seeds)
- No accounts, backends, analytics, telemetry, or paid APIs
- Zero third-party runtime dependencies
- Browser tests via `/tests/test-runner.html` only (no Node.js requirement)
- Usable on desktop; responsive mobile fallback

## Constraints (non-negotiable)

Do **not** use: npm/pnpm/yarn/bun, Node.js for development/testing/runtime, React/Vue/Svelte/Angular, TypeScript, Vite/Webpack/Rollup/Parcel, external JS libraries, CDN scripts, external fonts, cloud APIs, auth, databases, analytics, image uploads, remote/server processing, or runtime network requests.

Allowed: HTML, CSS, standard browser JS, ES modules, Canvas, Web Workers, typed arrays, File/Blob APIs, IndexedDB/localStorage where appropriate, Service Worker if used.

Dev-only static server: `python3 -m http.server 8080` (Windows: `python -m http.server 8080`)

## User-facing language (Milestone 6.1)

The standard UI uses plain language. Internal code and developer docs may keep technical terms (quantize, printability, revisions, stale, manifold, etc.).

| User-facing | Avoid in standard UI |
|-------------|----------------------|
| Create color preview / Color preview | Quantize / Quantized / Quantization current |
| Make printable | Printability (as a tab label) |
| Check only / Fix small details / Use this design | Analyze printability / Clean automatically / Accept cleaned design |
| Problem areas / Fixed | Issues overlay / Cleaned |
| Download / Build printable model | Export / Generate model |
| Your colors / Image colors | Palette / effective palette |
| Image detail colors | Color count (internal `colorCount`) |
| Needs updating / Update design | Stale / sourceRevision |
| Smooth surface / Relief surface | Flat (internal id remains `flat`) |

There is **no** editable Design name in the current UI (exports use deterministic
`lenstile-*` filenames). Project JSON save/load is not part of the current UI.

Technical mm / mm² thresholds live under a collapsed **Technical details** disclosure on Make printable.

### Workflow orchestration (Milestone 7.4 / 7.4.1)

- Formal FSM states: `idle`, `updating-colors`, `analyzing-printability`, `preparing-fix`, `waiting-for-review`, `approved`, `building-model`, `validating-model`, `model-ready`, `creating-3mf`, `error`.
- Every async pipeline ends in success, recoverable error, or superseded; no branch may leave a permanent processing status.
- Changing nozzle size automatically regenerates colors → analyze → recommended fix, then stops at **waiting-for-review** on Make printable.
- **Use this design** (sticky footer) approves the current cleaned result; model generation must not start before that approval. When approval is blocked, the footer shows the prerequisite reason in plain language (not only a tooltip).
- Entering Download with an approved current design starts exactly one model build; **Rebuild model** stays under More file options.
- Superseded operations resolve their promises with `{ status: "superseded", operationId }` and must not clear a newer operation’s loading state.
- Stage-based progress reports completed/total stages and a derived percentage (never timer-faked).
- Crop pan uses a live preview transform; committing the crop shows **Update design** (no per-pointer processing).
- Automatic processing never silently re-approves a changed printable design.
- Packaging requires validated geometry.
- `runtime.workflow` is runtime-only and never serialized.
- Magnet guides: visible on Image; hidden on Colors / Make printable / Download by default.

## Surface style — Flat vs Relief (Milestone 6.2 / 6.2.1)

| Topic | Rule |
|-------|------|
| Default | **Flat** — every used color ends at Z = 4.0 mm; combined STL matches the frozen golden mesh |
| Relief | Optional; image colors map to up to **four** distinct top heights in **3.4…4.0 mm** |
| Strength | Subtle 0.2 mm, Standard 0.4 mm, Bold 0.6 mm range below 4.0 mm |
| Roof | Minimum **0.9 mm** material above magnet recess ceiling (Z = 2.5 → ≥ 3.4) |
| Order | Darkest highest / Lightest highest (Rec. 709 + palette-index tie) / Custom |
| Topology | Indexed mask unchanged — no re-quantize or re-cleanup when only surface settings change |
| Palette RGB | Auto order: rebuild relief geometry; Custom levels unchanged: do not stale geometry |
| One-color | Relief STL is one closed solid with stepped top; works with one filament |
| Multicolor | Per-color objects keep assigned tops; base Z 0…2.5 and bridge Z 2.5…3.0 unchanged; Milestone 7.1 3MF packages these meshes as one multipart assembly |
| Printing mode | Independent of surface style: Flat/Relief × one-filament/multicolor are all supported |
| Saddles | Ambiguous 2×2 junctions use a deterministic diagonal (higher combined top → lower palette index → NW–SE). Combined relief ignores palette identity for equal-height neighbors (no spurious internal walls). Per-color meshes stay separately closed. |
| Manifold | Every supported combined and per-color relief STL must be closed and two-manifold (no edge incidence > 2) |
| Layer height | Remains a **slicer** setting, not an app geometry control |
| Preview | 2D brightness height preview + legend (not a 3D viewer) |

User-facing labels: **Surface style**, **Relief strength**, **Height order**. Avoid “Z mapping”, “topology”, “height mapping” in the standard UI.

### Remaining limitations (post-6.2.3 / Milestone 7.2)

- Non-binary / multi-height junctions add a tiny offset apex for manifold closure (does not change Tile V1 envelope or permitted top Z range).
- Separate color meshes may touch with coincident faces; each object must still validate closed independently.
- Slicer auto-repair warnings must be checked in the slicer UI — the app blocks download on local validation failure but cannot read Bambu Studio’s repair dialog.
- Combined relief geometry is locally closed for the preserved real fixture. Confirm slicer import and any repair dialog on a test file for your workflow.
- Multicolor 3MF uses Materials-extension color groups for design intent. Standard RGB colors do **not** automatically select AMS filament slots; Bambu Studio may still require manual filament mapping.
- Exact RGB intent may not match physically loaded filament colors.
- Full-size packages can be multi-megabyte XML/ZIP; packaging uses fragment join (not streaming) and reports XML/ZIP byte lengths in diagnostics.

## Export strategy

| Mode | When | Format |
|------|------|--------|
| Single STL | 1+ colors, Flat or Relief | One binary STL of tile + artwork (relief uses variable top) |
| Multicolor 3MF | 2–8 used artwork colors | Standards 3MF: Store ZIP, mm units, parent multipart assembly, Materials `m:colorgroup` colors, structural base + Structural Bridge children |
| Aligned STL set | Multicolor fallback | Separate STLs sharing the same origin (base Z 0…2.5; artwork; roof is packaged in 3MF) |
| Project JSON | Not in the current UI | Serialization helpers only; no save/load I/O |

Artwork is generated in the center-origin millimetre frame defined in `hardware/TILE_V1_SPEC.md`. The reference `Body122.stl` is CAD-offset; export recenters to the app standard.

### Structural bridge (Milestone 9.1)

- From Z = 2.5 mm through Z = 3.0 mm, the entire 148 × 53 mm tile is one continuous base-colored structural bridge slab
- No image-color artwork, multicolor boundary, or Relief variation may exist in those layers
- All artwork across the complete tile begins at Z = 3.0 mm
- Magnet cavities remain Ø8.5 × 2.5 mm at centers (±25, 0); cavity ceiling remains Z = 2.5 mm
- Visible top surface and Relief heights (3.4…4.0) remain unchanged — no visible magnet disk, halo, depression, or seam
- This is a global horizontal bridge layer, not a local circular magnet backing (Milestone 7.3.2 retired)
- Downloads use an injected adapter; tests never trigger browser Save As / download UI

### Multicolor 3MF (Milestone 7.1 / 7.2)

- Package layout: `[Content_Types].xml`, `_rels/.rels`, `3D/3dmodel.model`
- Store-only ZIP (no compression), fixed DOS timestamp, UTF-8 paths, deterministic bytes
- Resources: Materials `m:colorgroup` id `1`, Tile Base object `2`, artwork objects `3+`, parent assembly last
- Build contains **exactly one** item referencing the parent component object (identity transforms)
- Child meshes keep shared coordinates; packaging never remeshes, repairs, merges, or mutates buffers
- Color intent: official Materials and Properties extension (`xmlns:m`, `recommendedextensions="m"`)
- Property strategy (Option A): child objects use `pid`/`pindex` into the color group; parent has neither
- Dense `pindex` values map through explicit `paletteIndex → colorGroupIndex` (not assumed equal to palette indices)
- Core `basematerials`/`displaycolor` is **not** used as printable-color intent (Core says displaycolor is for rendering)
- Base color is a Download-step setting (default `#2A2A2A`); changing it updates 3MF metadata only
- One used artwork color → keep one-color STL; 3MF stays disabled as unnecessary
- Flat and Relief multicolor both package already-generated per-color meshes (Relief keeps distinct top heights)
- Standard RGB colors express design intent only — they do **not** promise automatic AMS filament slot selection
- No proprietary Bambu/Prusa/Cura/Orca extensions, thumbnails, or slicer profiles
- Packaging stages + structured errors (Milestone 7.2); plain UI message with Technical details on failure
- Full-size regression fixture: `tests/fixtures/manual/Untitled_tile-geometry-debug.json`
- Optional diagnostic: `tests/fixtures/manual/bambu-two-color-reference.3mf` (skip if absent; never copy vendor metadata)

## Privacy model

- All image and geometry processing happens in the browser.
- Images never leave the device.
- No `fetch`, `XMLHttpRequest`, `WebSocket`, or `EventSource`.
- No cookies, trackers, external scripts/styles/fonts, or API keys.
- See `PRIVACY.md` and `SECURITY.md`.

## Product definition

**Shipped:** static shell, image import, crop editor, deterministic color preview, print check/cleanup, Tile V1 STL export (combined + aligned set), optional relief surfaces with manifold saddle junctions, per-color diagonal-pinch manifold fix, combined-relief multi-height T-junction fix, standards-oriented multipart multicolor 3MF with Materials color groups, full-size packaging repair + staged diagnostics, browser-only testing, plain-language numbered workflow, toast notifications.

Confirm fit, print quality, and slicer filament mapping on your hardware before batch printing.

## Image import (Milestone 2.1)

| Topic | Rule |
|-------|------|
| Entry path | One hidden file input; only `openImagePicker()` opens the system chooser |
| Empty state | Large accessible drop zone with Choose image, formats, privacy copy; click / Enter / Space open picker |
| Loaded state | Canvas is pan/zoom only — never opens the file chooser; explicit Replace image / Remove image |
| Drag-and-drop | Same load pipeline as Choose/Replace; replace mode shows a clear visual when an image is already loaded |
| Formats | PNG, JPEG, WebP (existing validation + decode fallbacks) |

## Printer and detail profiles (Milestone 2.1 / 3)

| Topic | Rule |
|-------|------|
| Nozzle profiles | Exactly two choices: `nozzle02` (0.2 mm — Fine detail) and `nozzle04` (0.4 mm — Standard, **default**) |
| Meaning | Website nozzle choice controls **image preparation** (processing grid + printable thresholds). It does **not** set the slicer's hardware nozzle profile — select the matching nozzle in the slicer |
| Automatic detail | `PROCESSING_PROFILES`: nozzle02 → 10 px/mm (0.10 mm); nozzle04 → 8 px/mm (0.125 mm). Both below the 1,500,000-pixel limit |
| Feature thresholds | Conservative defaults for 0.2 mm and 0.4 mm nozzles; verify on your printer: nozzle02 → 0.25 mm / 0.10 mm²; nozzle04 → 0.45 mm / 0.30 mm² |
| Derived print settings | Nozzle diameter, min feature, min gap, island/hole thresholds, and processing ppm come from `PRINT_PROFILES` |
| Legacy detail profiles | Low/Standard/High retained for serialization migration only; not the primary resolution driver |
| State | Stores `printability.profileId` and legacy `quantization.detailProfileId`; resolution derives from nozzle processing profile |
| Serialization | Project snapshot stores profile IDs + profile schema versions; not duplicated editable nozzle/ppm fields |
| Legacy nozzle | `nozzle06` (removed) migrates to `nozzle04`; `nozzle04` stays `nozzle04`. 0.6 mm is not preserved as a hidden profile |
| Legacy ppm | Exact 1/2/4 → low/standard/high; other finite values → nearest of {1,2,4} (equidistant ties prefer standard) |
| Validation note | Profile threshold values are conservative defaults; verify on your printer and filament |
| Printability revision | `printabilityRevision` and `sourceRevision` increment when the nozzle profile changes |

## Printability cleanup (Milestone 3)

| Topic | Rule |
|-------|------|
| Input | Successful indexed-color result from Milestone 2; original indices are never overwritten |
| Runtime buffers | `runtime.quantization.indices`, `runtime.printability.cleanedIndices`, `runtime.printability.issueMask`, `runtime.printability.report` |
| Physical units | All thresholds convert via tile mm ÷ indexed width/height (never raw pixel counts alone) |
| Connectivity | Deterministic **4-connectivity** (N/E/S/W); row-major discovery; component IDs by discovery order. Product labeling uses 4-connectivity |
| Why 4-conn | Diagonal-only touches do not share an edge and often print as disconnected under FDM |
| Islands | Components with area `< minimumIslandAreaMm2` replaced by dominant 4-neighbour boundary colour (tie → lower palette index; no neighbours → global dominant) |
| Holes | Non-boundary-touching components with area `< maximumHoleAreaToFillMm2` filled the same way |
| Passes | Repeat until stable or **`MAX_CLEANUP_PASSES = 16`** |
| Narrow features/gaps | Horizontal/vertical run-width analysis in mm; issue detection mandatory; auto-cleanup does **not** erode large components for thin branches |
| Issue mask | UI-only categories: 0 none, 1 island, 2 hole, 3 narrow feature, 4 narrow gap |
| Workflow | Analyze → inspect report → Clean automatically (preview) → Accept or Reset. Never silently accept |
| Comparison | Quantized / Issues overlay / Cleaned / Side by side |
| Stale when | Source image, crop, color count, detail profile, transparency, quantization result, or nozzle profile change. Palette **display** overrides (RGB only) do not require re-cleanup |
| Export readiness | Stale or unaccepted cleanup must never be treated as export-ready |
| Serialization | Profile ID, accepted flag, cleanup algorithm version, revisions — **not** index/issue buffers |
| Worker | Shared `image-worker.js`; request IDs + source/printability revisions; stale rejection; transferable buffers |

## Color quantization (Milestone 2)

| Topic | Rule |
|-------|------|
| Output size | `widthPx = round(148 × ppm)`, `heightPx = round(53 × ppm)` where `ppm` is derived from the detail profile |
| Pixel limit | `MAX_QUANTIZATION_PIXELS = 1_500_000`; oversize → clear error, no silent downscale |
| Transparency | White (default), Black, or Custom; `out = src×α + bg×(1−α)`; clustering sees opaque RGB only |
| Crop rasterization | Main-thread canvas at exact output size; image smoothing disabled; transform scaled from the live editor crop size |
| Algorithm | Deterministic RGB frequency aggregation + farthest-point init + k-means (max 32 iterations) |
| Algorithm version | `QUANTIZE_ALGORITHM_VERSION` in `config.js` (bump when output rules change) |
| Init | First centroid = highest population (tie → lowest packed RGB); later = max squared distance to nearest centroid (ties → higher population, then lower packed RGB) |
| Assignment ties | Lower centroid index wins |
| Channel rounding | `Math.round` on Float64 means, clamped to 0…255 |
| Empty clusters | Removed; colors are never fabricated |
| Palette order | Descending population, then ascending Rec. 709 luminance (`0.2126 R + 0.7152 G + 0.0722 B`), then ascending packed RGB; indices remapped after sort |
| One color | Population-weighted RGB mean of all composited pixels; every index `0` |
| Worker | One reusable module worker; transfer RGBA/index buffers; ignore stale `requestId` / `sourceRevision` |
| Palette overrides | Serializable; update preview from indices without re-clustering; Reset clears overrides |
| Source revision | Bumps on image/crop/detail profile/color count/transparency/algorithm inputs; not on palette overrides or UI-only fields |

## Out of scope (current)

- AI / ML color or geometry assistance
- Cloud sync, accounts, marketplaces
- Mesh boolean CSG libraries
- Live 3D WebGL preview
- SVG import
- Undo/redo stack
- Project JSON save/load, IndexedDB persistence, and offline service worker
- Sample / icon asset packs
- Automatic slicer integration
- Physical manufacturing or fulfillment
- Layer height as a user-facing mesh setting
