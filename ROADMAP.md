# Roadmap — LensTile

> Historical milestone titles may still say “Open Tile Generator” in older notes;
> the public product name is now **LensTile**.
>
> This file is a **historical milestone log**. The shipping import → colors →
> printable → STL/3MF path is complete. Open items below are optional follow-ups,
> not blockers for local use.

## Milestone 0 — Specification and repository foundation

**Effort:** S  
**Dependencies:** Reference STL available  

### Deliverables

- Product, hardware, architecture, security, privacy, agent, and contributor docs
- Repository structure and coding conventions
- Risk register and test strategy

### Acceptance criteria

- [ ] `PROJECT_SPEC.md`, `hardware/TILE_V1_SPEC.md`, `ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/RISKS.md` exist
- [ ] `SECURITY.md`, `PRIVACY.md`, `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `LICENSE` exist
- [ ] STL inspection documented; magnet depth confidence stated
- [ ] Directory layout matches modular separation (UI / image / geometry / export / workers / tests / hardware)

### Risks

- Hardware unknowns → document as unresolved, do not invent

---

## Milestone 1 — Application shell and image editor

**Effort:** M  
**Dependencies:** M0  

### Deliverables

- Responsive static UI with four steps
- Local image load + crop editor (pan, zoom, rotate 90°, flip, fit, fill, reset)
- Centralized state, privacy notice, foundation tests

### Acceptance criteria

- [ ] Image PNG/JPEG/WebP loads locally
- [ ] Transform controls update preview via rAF
- [ ] Tile crop overlay 148:53 with dimmed exterior
- [ ] No network APIs in source (enforced by test)
- [ ] `/tests/test-runner.html` passes foundation tests
- [ ] Keyboard-operable primary controls

### Risks

- Touch vs mouse pointer inconsistencies
- Large images stalling main thread (warn; workers off main thread)

---

## Milestone 2 — Deterministic color reduction

**Effort:** M  
**Dependencies:** M1  
**Status:** Complete (frozen)

### Deliverables

- 1–8 color deterministic quantization, palette edit, worker processing, tests

### Acceptance criteria

- [x] Same input bytes → same palette and indexed preview
- [x] No `Math.random()`
- [x] Transparency handled explicitly
- [x] Palette order stable across runs
- [x] Hard-coded pixel array tests pass

### Risks

- Perceptual color space choices affecting printability
- Worker transferables browser differences

---

## Milestone 2.1 — Image-import UX and printer/detail profiles

**Effort:** S  
**Dependencies:** M2  
**Status:** Complete (profiles corrected in M3: 0.2 / 0.4 mm)

### Deliverables

- Unambiguous image import (empty drop zone, Replace/Remove, single picker path)
- Immutable `PRINT_PROFILES` and `DETAIL_PROFILES` (Low / Standard / High)
- Derived settings display; legacy ppm migration; docs and tests

### Acceptance criteria

- [x] One predictable image entry path; canvas never unexpectedly opens the file chooser
- [x] Drag-and-drop initial + replace; unsupported files show validation errors
- [x] Standard UI exposes only nozzle and detail profiles (no free-form nozzle/ppm)
- [x] Existing quantization remains deterministic; prior tests still pass
- [x] Serialization stores profile IDs + version metadata; legacy ppm migrates

### Risks

- Profile thresholds are initial defaults until physical print validation

---

## Milestone 3 — Printability cleanup

**Effort:** M  
**Dependencies:** M2.1  
**Status:** Complete

### Deliverables

- Corrected nozzle profiles (0.2 mm Fine / 0.4 mm Standard)
- Frozen Tile V1 vertical structure (2.5 mm base + 1.5 mm artwork)
- Connected components, island/hole cleanup, min feature/gap detection, overlays, worker, tests

### Acceptance criteria

- [x] Physical mm conversion via detail-profile-derived resolution and tile size
- [x] Nozzle / min-feature settings from print profiles affect analysis deterministically
- [x] Before/after mask preview with explicit accept/reset
- [x] Deterministic tests for islands/holes/features/gaps/stale/serialization
- [x] Original quantized indices preserved; cleaned buffer separate
- [x] Layer height not confused with nozzle diameter

### Risks

- Over-aggressive cleanup destroying intentional detail (mitigated: thin-branch erosion is not automatic; user must accept)

---

## Milestone 4 — Geometry and STL foundation

**Effort:** M  
**Dependencies:** M0 (tile spec)  
**Status:** Complete

### Deliverables

- Mesh model, prisms, normals, binary STL, validation, unit tests (no UI)

### Acceptance criteria

- [x] Bounding box tests for known prisms
- [x] No zero-area triangles
- [x] Correct STL byte length and triangle count
- [x] Finite coordinates only

### Risks

- Winding / normal errors rejected by slicers

---

## Milestone 5 — Image mask to printable geometry

**Effort:** L  
**Dependencies:** M3, M4  
**Status:** Complete

### Deliverables

- Run-length rectangles, extrusion, color-separated meshes, raised artwork meshes

### Acceptance criteria

- [x] Stable rectangle merge order
- [x] Physical scaling correct
- [x] Color parts align to shared origin

### Risks

- Triangle explosion on noisy masks
- Flush inlay path was out of scope; interfaces reserved

---

## Milestone 6 — Tile integration

**Effort:** M  
**Dependencies:** M4, M5, hardware spec  
**Status:** Complete

### Deliverables

- Tile base + artwork, magnet recesses preserved, single STL + separate aligned STLs

### Acceptance criteria

- [x] Envelope 148×53×(base+artwork policy)
- [x] Magnets at (−25,0) and (25,0)
- [x] Identical alignment across color parts

### Risks

- Boolean complexity without CSG libs → prefer constructive composition

---

## Milestone 6.1 — STL validation, browser-only tooling, workflow polish

**Effort:** S  
**Dependencies:** M6  
**Status:** Complete

### Deliverables

- Remove Node as a project requirement; browser harness is the only test runner
- Validate full STL workflow (dimensions, magnets, closed mesh metrics)
- Plain-language UI terminology and numbered four-step workflow
- Toast notifications; technical thresholds behind disclosures
- Primary vs advanced download separation; 3MF belonged to Milestone 7

### Acceptance criteria

- [x] No Node runner / package manifest
- [x] `/tests/test-runner.html` passes the complete suite
- [x] Combined STL golden hash / structural metrics unchanged by UI work
- [x] Primary UI avoids engineering jargon; advanced terms stay internal
- [x] Continue actions and stage checkmarks clarify progression
- [x] 3MF remains disabled

### Risks

- Terminology refactors accidentally changing geometry bytes — mitigated by golden STL tests

---

## Milestone 6.2 — Optional single-color and multicolor relief surfaces

**Effort:** M  
**Dependencies:** M6.1  
**Status:** Complete

### Deliverables

- Optional Surface style: Flat (default, byte-identical) or Relief
- Relief strength Subtle / Standard / Bold within Z 3.4…4.0 mm (max four distinct levels)
- Automatic luminance height order + custom order
- Combined one-color relief STL and per-color relief STLs
- 2D height preview; plain-language Download controls
- Browser tests + golden relief fixture; flat golden unchanged

### Acceptance criteria

- [x] Prior browser tests still pass; new relief tests pass
- [x] Flat combined STL golden hash unchanged
- [x] Relief combined mesh closed / manifold; tops in 3.4…4.0; magnets unchanged
- [x] Surface changes rebuild geometry without re-quantize / re-cleanup
- [x] No Node, npm, network, ZIP/3MF, or 3D viewer added

### Risks

- Variable-height outer walls vs magnet perimeter tessellation — mitigated by endpoint-aware wall triangulation

---

## Milestone 6.2.1 — Manifold saddle junctions and slicer validation

**Effort:** S  
**Dependencies:** M6.2  
**Status:** Complete (see 6.2.2 for pinch follow-up)

### Deliverables

- Deterministic diagonal resolution for ambiguous 2×2 relief junctions
- Closed two-manifold combined and per-color relief meshes for supported saddles
- Strengthened mesh validation (edge incidence, duplicates, winding, reporting)
- Saddle golden fixture; exhaustive binary 2×2 coverage
- Documentation of saddle rule; removal of accepted non-manifold saddle limitation

### Acceptance criteria

- [x] Prior browser tests still pass; new saddle tests pass
- [x] Every binary 2×2 height pattern with a max-height cell is closed / two-manifold
- [x] Separate color meshes remain individually closed
- [x] Flat golden `e7568185` and non-saddle relief golden `3fd8a805` unchanged
- [x] Tile dimensions and magnet geometry unchanged; tops stay in 3.4…4.0
- [x] Downloads remain blocked on validation failure
- [x] No Node, dependencies, network, or build step

### Risks

- Non-binary multi-height junctions need offset-pyramid closure; keep covered by fixtures
- Bambu Studio CLI file-open is unreliable; confirm repair status in the slicer UI when validating exports
- Per-color diagonal self-touch pinches remained (caught in real UI; fixed in 6.2.2)

---

## Milestone 6.2.2 — Per-color diagonal pinch manifolds

**Effort:** S  
**Dependencies:** M6.2.1  
**Status:** Complete

### Deliverables

- Geometry debug fixture download (Technical details) for local regression capture
- Sector-scoped artwork vertices so same-component diagonal contacts stay manifold
- Plain-language build errors + technical edge diagnostics
- Reduced real-world-class fixtures (single pinch + three-pinch nonManifold=3)
- Exhaustive binary 3×3 per-color manifold coverage

### Acceptance criteria

- [x] Failing topology preserved as fixtures (legacy grid mode reproduces; sector mode closed)
- [x] color[0] closed / two-manifold on pinch fixtures; all used colors + combined validate
- [x] Flat `e7568185`, relief `3fd8a805`, saddle `c8fab817` unchanged
- [x] Downloads blocked on invalid objects; strict validation remains enabled
- [x] No Node, dependencies, network, 3MF/ZIP, or GUI slicer launch without approval

### Risks

- Extremely large masks remain expensive to validate in-browser; keep fixtures small where possible

---

## Milestone 6.2.3 — Combined relief multi-height T-junctions

**Effort:** S  
**Dependencies:** M6.2.2  
**Status:** Complete (slicer spot-check recommended)

### Deliverables

- Preserve real browser combined-relief failure as `tests/fixtures/combined-relief-geometry-debug.json`
- Cap multi-height T-junctions (3+ distinct tops) that classical saddle detection missed
- Equal-height adjacent roles share vertex identity; offset-apex fan closes hanging vertical edges
- Download invalidation: build start / validation failure / surface change clear downloadable meshes
- Exhaustive binary 3×3 combined-relief coverage + bounded ternary junction classes

### Acceptance criteria

- [x] Legacy `junctionCapMode: "ambiguous-only"` reproduces `boundary=129` on the real fixture
- [x] Corrected combined relief is closed / two-manifold; separate colors + base remain valid
- [x] Flat `e7568185`, relief `3fd8a805`, saddle `c8fab817` unchanged
- [x] Failed builds leave downloads disabled; successful rebuild restores readiness path
- [x] Strict validation remains enabled; no Node, dependencies, network, 3MF/ZIP, or GUI launches

### Risks

- Extremely complex multi-height junctions may still need slicer UI confirmation
- 3MF packaging remains Milestone 7

---

## Milestone 7 — 3MF export

**Effort:** M  
**Dependencies:** M6.2.3  
**Status:** Complete (superseded package structure in 7.1)

### Deliverables

- ZIP store, CRC-32, Core 3MF package, tests, slicer notes
- Package validated Flat and Relief meshes without further geometry changes
- Download-step base color (3MF metadata only)
- Lazy packaging on first multicolor download

### Acceptance criteria

- [x] Valid package structure (`[Content_Types].xml`, `_rels/.rels`, `3D/3dmodel.model`)
- [x] mm units, build items, object names, stable IDs
- [x] Tests for CRC and zip layout
- [x] Relief multicolor objects keep assigned top heights
- [x] Prior browser tests still pass; geometry goldens unchanged
- [x] No Node, dependencies, network, or vendor 3MF extensions

### Risks

- Slicer-specific 3MF color interpretation — confirm in Bambu/Prusa/Cura UI

---

## Milestone 7.1 — Multipart assembly and Materials color intent

**Effort:** M  
**Dependencies:** M7  
**Status:** Complete (manual Bambu import confirmation still recommended)

### Deliverables

- Parent multipart/component assembly with one build item
- Official Materials and Properties extension `m:colorgroup` color resources
- Flat and Relief multicolor packaging of existing per-color meshes (no remesh)
- Step 2 / Download terminology separating image detail colors from filament count
- Optional Bambu reference diagnostic fixture workflow (skip if absent)
- New Flat (2-color) and Relief (4-color) 3MF packaging goldens

### Acceptance criteria

- [x] One parent component object; build contains exactly one item
- [x] Child mesh geometry unchanged; Flat/Relief goldens for STL unchanged
- [x] Materials-extension color groups are authoritative color intent
- [x] Every child references the correct color property; parent has no pid/pindex
- [x] Flat + Relief multicolor exports both work
- [x] UI separates extracted image colors from filament count; Relief works with one filament or multicolor
- [x] Browser tests pass; no Node, dependencies, network, or GUI launches
- [x] Docs do not promise automatic AMS filament mapping

### Risks

- Bambu may still require manual filament assignment even with standard color groups
- Some slicers may ignore Materials-extension colors; vendor-specific color mapping is not in this product

---

## Milestone 7.2 — Full-size 3MF packaging repair

**Effort:** S  
**Dependencies:** M7.1  
**Status:** Complete

### Deliverables

- Reproduce and fix the real full-size Flat four-color packaging failure
- Staged packaging diagnostics (`prepare-inputs` … `initiate-download`)
- Structured packaging errors with Technical details (stage, code, expected/actual)
- Explicit paletteIndex → colorGroupIndex / childObjectId mapping
- Development “Download 3MF diagnostics” JSON (no image / mesh dumps)
- Regression fixture: `tests/fixtures/manual/Untitled_tile-geometry-debug.json`

### Acceptance criteria

- [x] Exact uploaded fixture reproduces former failure (`Expected 5 objects, found 6`)
- [x] Root cause identified: Export controller used pre-assembly `expectedObjectCount`
- [x] Same fixture produces a non-empty, internally validated 3MF
- [x] Flat and Relief multicolor packaging work; one parent + one build item preserved
- [x] Failed packaging leaves STL downloads available and clears stale 3MF bytes
- [x] Geometry goldens unchanged (`e7568185` / `3fd8a805` / `c8fab817`)
- [x] Browser tests pass; no Node, dependencies, network, or GUI launches

### Risks

- Bambu / slicer filament mapping remains user-verified (not claimed from packaging alone)

---

## Milestone 7.3 — Magnet-roof keepout and user-controlled downloads

**Effort:** M  
**Dependencies:** M7.2  
**Status:** Complete

### Deliverables

- Authoritative magnet-roof keepout (initially margin 0.75 mm → radius 5.0 mm; superseded by 7.3.1), Z 2.5…4.0, flat, base color
- Derived geometry assignment that excludes keepout cells from artwork / Relief
- Dedicated structural roof mesh in multicolor 3MF (same property as Tile Base)
- Injected download adapter (production vs in-memory test); no autonomous downloads
- Download Technical details note for magnet roof protection
- Browser tests for keepout + adapter policy

### Acceptance criteria

- [x] Keepout radius = magnet radius + margin; both magnet centers covered
- [x] Relief cannot lower keepout tops; cavities unchanged; full 1.5 mm roof
- [x] Accepted indices unchanged; derived geometry excludes keepout from artwork
- [x] 3MF includes roof child; roof does not increase reported image-color count
- [x] Test adapter never triggers browser download / Save As / showSaveFilePicker
- [x] Flat combined STL golden unchanged; intentional 3MF golden updates reviewed
- [x] `/tests/test-runner.html` passes; no Node, network, GUI launches

### Risks

- Coarse grids may have zero keepout cells (cell centers miss circles) — product detail profiles still cover magnets

---

## Milestone 7.3.1 — Minimal magnet-roof keepout border

**Effort:** S  
**Dependencies:** M7.3  
**Status:** Complete (superseded by 7.3.2)

### Deliverables

- Reduce keepout radial margin from 0.75 mm to 0.20 mm (radius 4.45 mm, protected Ø8.9 mm)
- Preserve full 1.5 mm roof thickness, cavity geometry, and cell-center classification
- Update docs and keepout-size tests; review export goldens if roof footprint changes hashes

### Acceptance criteria

- [x] Margin 0.20 mm; radius = magnetDiameterMm / 2 + margin = 4.45 mm; diameter 8.90 mm
- [x] Roof Z 2.5…4.0 and thickness 1.5 mm unchanged; cavities and centers unchanged
- [x] Artwork / Relief resume immediately outside 4.45 mm; old 5.0 mm disk no longer used
- [x] Flat / Relief / multicolor 3MF validate; roof not counted as an image color
- [x] Tests use download adapter only (no Save As / GUI / Node / network)
- [x] Documentation matches the new 0.2 mm border

### Risks

- At Standard detail, the visual border snaps to approximately the nearest cell (radius not enlarged for the grid)

---

## Milestone 7.3.2 — Hidden magnet backing + automatic high-detail processing

**Effort:** M  
**Dependencies:** M7.3.1  
**Status:** Complete

### Deliverables

- Replace visible radial magnet-roof keepout with a hidden 0.2 mm base-colored backing (Z 2.5…2.7) over the exact Ø8.5 mm cavity footprint
- Per-cell artwork bottoms (2.7 mm above magnets, 2.5 mm elsewhere); Relief tops preserved above magnets
- Automatic nozzle-aware processing grids (0.2 → 10 px/mm; 0.4 → 8 px/mm) with detail-preserving thresholds and optional feature thickening
- UI: nozzle prepares image detail (user selects matching nozzle in slicer); automatic detail readout; legacy Detail selector de-emphasized
- Browser tests for backing + processing; docs updated

### Acceptance criteria

- [x] No visible magnet disk/halo; backing Z 2.5…2.7; artwork resumes at 2.7 above magnets
- [x] Magnet cavity geometry unchanged; no radial margin; previous 4.45 radius retired
- [x] Flat/Relief STL and multicolor 3MF validate; Magnet Backing not counted as an image color
- [x] nozzle02 / nozzle04 produce measurably different cleaned masks on the visual-detail fixture
- [x] High-detail grids remain below the 1,500,000-pixel limit
- [x] Tests use download adapter only (no Save As / GUI / Node / network)
- [x] Documentation matches the hidden-backing + automatic-detail model

### Risks

- New feature thresholds should be verified on target printers
- High-resolution grids increase quantization / cleanup / geometry time

---

## Milestone 7.4 — Responsive UI/UX and workflow orchestration

**Effort:** L  
**Dependencies:** M7.3.2  
**Status:** Superseded by corrective Milestone 7.4.1

### Deliverables

- Dependency-aware workflow coordinator (nozzle / color / crop / relief / packaging)
- Automatic color + printable regeneration on nozzle change without returning to Colors
- Full-viewport responsive app shell (desktop / tablet / mobile)
- Design-system token refresh, stage simplification, Design name terminology
- Browser tests for pipeline boundaries and layout metrics

### Acceptance criteria

- [x] Nozzle change stays on Make printable and auto-updates color + printable preview
- [x] Changed printable topology requires reapproval; geometry waits for approval
- [x] Desktop uses available viewport; sticky primary actions; no horizontal overflow on tested widths
- [x] Algorithms and export goldens unchanged; test download adapter only
- [ ] Formal terminal-safe FSM (completed in 7.4.1)
- [ ] No indefinite “Building printable model…” (completed in 7.4.1)

### Risks

- High-detail nozzle pipelines remain slower on large crops
- Thresholds should be verified on target printers

---

## Milestone 7.4.1 — Workflow stabilization and compact product UI

**Effort:** L  
**Dependencies:** M7.4  
**Status:** Complete

### Deliverables

- Formal workflow FSM with allowed transitions and terminal/waiting guarantee
- Operation lifecycle (`try`/`catch`/`finally`) with superseded resolution and soft watchdog
- Approval-before-build invariant; auto model build once on Download after approval
- Recommended printability flow (auto fix → review → Use this design in sticky footer)
- Stage-based progress (no timer fake percentages)
- Compact Colors and Download layouts; contained Relief editor subview
- Magnet guides visible on Image only by default
- Browser tests for stuck workflows, supersede, UX compaction; goldens unchanged

### Acceptance criteria

- [x] “Building printable model…” always completes, errors, or is superseded
- [x] No pipeline remains indefinitely active after its work settles
- [x] No model build before user approval
- [x] Recommended fixing is automatic and not hidden in Advanced
- [x] Downloads become available after a successful build
- [x] Progress is stage-based and truthful
- [x] Algorithms and export goldens unchanged; test download adapter only

### Risks

- Heavy crops can still take >15s (soft notice + Cancel/Retry; not a fake failure)
- Duplicate superseded worker jobs may still run to completion (results ignored)

---

## Milestone 8.2.1 — Warm Workshop Amber UX polish

**Effort:** S  
**Dependencies:** M7.4.1  
**Status:** Complete

### Deliverables

- Amber drop-zone hover/drag-over (no olive/success-green wash)
- Visible stage footer prerequisites for Image and Make printable blocked states
- Status copy clarifies automatic check/fix before review
- Sidebar spacing: `.settings-body` gap owns rhythm (no double margins)
- Advanced remains power-user; recommended auto-fix path unchanged

### Acceptance criteria

- [x] Drop zone hover/drag uses warm amber surface + border emphasis (no success green)
- [x] Use this design disable reasons visible in sticky footer when blocked
- [x] Image footer explains missing image / Update design pending
- [x] Check only / Fix remain under collapsed Advanced; auto flow unchanged
- [x] Algorithms, geometry, STL/3MF, Tile V1, and approval semantics unchanged
- [x] Browser tests cover footer hints and amber drop-zone treatment

### Risks

- Users who expect Check/Fix as primary CTAs may still open Advanced; footer copy mitigates the dead-end feel

---

## Milestone 8 — Offline caching and project files (optional)

**Effort:** M  
**Dependencies:** M1–M7.4.1 core  

### Deliverables

- Service worker, samples, project JSON I/O, a11y + security review, docs

### Acceptance criteria

- [ ] Offline after first load
- [ ] Project JSON round-trip excludes runtime objects
- [ ] Compatibility and privacy docs complete

### Risks

- SW caching stale app versions — needs clear update story

---

## Milestone 9 — Release polish and public-repository preparation

**Effort:** M  
**Dependencies:** M7.4.1 / M8.2.1  
**Status:** Complete

### Deliverables

- Public rename to **LensTile** across user-facing copy and docs
- Remove Design name UI; deterministic `lenstile-*` export filenames
- Remove confirmed dead/misleading controls (e.g. Export design JSON later)
- Harden `.gitignore` / `.gitattributes`; add repository templates
- Security/privacy documentation with honest residual-risk language
- Full browser harness verification; preserve geometry goldens (header-only STL hash updates reported)

### Acceptance criteria

- [x] Product name LensTile is consistent in app title, metadata, README, and docs
- [x] Design name control removed; default exports use `lenstile-smooth.stl` / `lenstile-relief.stl` / `lenstile-multicolor.3mf`
- [x] No placeholder “later” export controls in the product UI
- [x] `/tests/test-runner.html` passes with in-memory download adapter
- [x] Geometry triangle payloads unchanged; any STL FNV updates are header-only and reported
- [x] No Node, npm, network APIs, CDN assets, or geometry dimension changes
- [x] Recommended Git commands prepared; no automatic publish/push/commit

### Risks

- Header-only STL byte changes update FNV goldens without geometry change — document old→new hashes
- Remaining Milestone 8 items (SW, project JSON) are optional follow-ups

---

## Milestone 9.1 — Full-width structural bridge layer

**Effort:** S  
**Dependencies:** M9 / physical print feedback  
**Status:** Complete

### Deliverables

- Replace local circular magnet backing (Z 2.5…2.7 over cavity disks) with a full-width 0.5 mm structural bridge (Z 2.5…3.0 over the entire 148 × 53 mm tile)
- Global artwork start at Z = 3.0 mm (no per-cell raised bottoms above magnets)
- Preserve magnet cavities, Smooth total height 4.0 mm, and Relief top range 3.4…4.0 mm
- Update Tile V1 docs, validators, 3MF Structural Bridge child, and browser tests

### Acceptance criteria

- [x] Magnet cavities end at Z = 2.5 mm; continuous base-color bridge spans Z 2.5…3.0 across the full tile
- [x] No artwork / color boundary / Relief variation exists in Z 2.5…3.0
- [x] All artwork begins at Z = 3.0 mm; visible tops and Relief heights unchanged
- [x] No visible magnet disk, halo, depression, seam, or top-surface artifact from the bridge
- [x] Flat combined STL golden unchanged; intentional 3MF packaging updates reviewed
- [x] `/tests/test-runner.html` passes with in-memory download adapter
- [x] No Node, npm, network, GUI slicer launches, or weakened mesh validation

### Risks

- Confirm bridge quality on target printers before batch printing
- Multicolor 3MF byte hashes change when the structural child name / mesh changes

**3MF golden updates (intentional name change Magnet Backing → Structural Bridge):**
- Flat: `7fd9b380` / 5830 → `682e74ac` / 5833
- Relief: `7583dddf` / 8108 → `3a58bcd5` / 8111
- Flat combined STL golden `a1f5c9ce` unchanged

---

## Cross-cutting risks

See `docs/RISKS.md` for the full register.
