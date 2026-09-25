# Test Strategy

## Harness

- Browser-based, zero dependencies: `tests/test-runner.html`
- API: `describe`, `test`, `assertEqual`, `assertApproxEqual`, `assertDeepEqual`, `assertThrows`
- **Authoritative runner:** the browser page only. There is no Node.js test runner and no package manifest.

## What to test now (through Milestone 7.4.1)

- Tile specification constants, magnet centers, and vertical-structure invariants (2.5 + 0.5 + 1.0 = 4)
- Crop transform math (fit/fill/rotate/flip/clamp)
- State updates, `sourceRevision`, `printabilityRevision`, `geometryRevision`, and serializable project exclusions
- Image file type validation
- Image-import UX: single picker path, drop zone, Replace/Remove, no accidental chooser opens
- Printer and detail profiles: defaults (`nozzle04`), `nozzle02` thresholds, immutability, legacy `nozzle06` → `nozzle04`
- UI mount smoke test (no free-form nozzle/ppm; “Nozzle size” label; not layer height)
- Prohibited network / remote asset pattern scan over application sources
- Quantization determinism on hard-coded pixel arrays (including golden FNV-1a fixture)
- Resolution / pixel-limit validation
- Transparency compositing
- Palette overrides vs preview (no worker re-run)
- Worker request validation and stale-result rejection
- No `Math.random()` in quantization / printability / geometry application sources
- Printability: islands, holes, run-width features/gaps, issue-mask categories, cleanup passes, accept/reset, stale behaviour, serialization without buffers, byte-identical reruns
- Mesh math, validation, binary STL byte layout, golden combined Tile V1 metrics
- Raster→rectangle merge, artwork boundary meshes, closed combined/base solids, export readiness / stale geometry
- Milestone 6.1: no Node runner/package.json, plain-language UI labels, numbered steps, Continue enablement, technical disclosures, toast behaviour, reduced-motion CSS
- Milestone 6.2: relief constants/levels/ordering, surface state migration and staleness rules, combined/per-color relief meshes, flat golden regression, relief golden fixture, Download surface controls
- Milestone 6.2.1: saddle detection / diagonal rule, closed checkerboard and four-label fixtures, exhaustive binary 2×2 height patterns, saddle golden `c8fab817`, strengthened manifold validation reporting, flat `e7568185` + non-saddle relief `3fd8a805` unchanged
- Milestone 6.2.2: diagonal self-touch pinch fixtures (legacy grid vs sector), three-pinch `nonManifold=3` reproduction, exhaustive binary 3×3 per-color manifoldness, geometry debug fixture codec, plain-language errors + technical diagnostics, goldens unchanged
- Milestone 6.2.3: real combined-relief debug fixture (`combined-relief-geometry-debug.json`), legacy `boundary=129` reproduction, multi-height T-junction caps, exhaustive binary 3×3 combined relief, bounded ternary junction classes, download invalidation on build start / validation failure / surface change, goldens unchanged
- Milestone 7 / 7.1 / 7.3.2 / 9.1 packaging: CRC-32, Store ZIP, Materials `m:colorgroup` + multipart parent + Structural Bridge child, Flat/Relief packaging, export readiness gating
- Milestone 7.2: full-size Flat four-color fixture, stale object-count reproduction, dense/sparse palette→pindex mapping, staged diagnostics, STL retained on 3MF failure
- Milestone 7.3 / 7.3.1 historical: visible magnet-roof keepout (superseded)
- Milestone 7.3.2 historical: local hidden magnet backing Z 2.5–2.7 (superseded by 9.1)
- Milestone 9.1: full-width structural bridge Z 2.5–3.0, global artwork start at Z = 3.0, no local magnet disks; Flat combined STL golden unchanged; intentional 3MF name/hash update; download adapter only
- Milestone 7.4: dependency graph boundaries, live vs commit crop, nozzle stay-on-stage, reapproval / export blocking, runtime workflow excluded from serialization, Design name / Smooth surface wording, responsive shell metrics (overflow, settings scroll, sticky footer), no automatic downloads
- Milestone 7.4.1: FSM transition table, model-build deadlock (`canGenerate` while `building-model`), terminal/superseded operation results, approval-before-build, stage-derived progress percent, magnet guides by stage, Use this design in sticky footer, bounded Colors compare, contained Relief editor, longer-than-usual + Retry affordances, no duplicate auto-downloads
- Milestone 9: LensTile rename, Design name removal, deterministic `lenstile-*` filenames, dead “Export design JSON (later)” removed, STL header-only FNV updates (`a1f5c9ce` / `5ffdbc1e` / `f517f424`), repository hygiene

## Slicer checks (manual)

After browser tests pass for geometry milestones, spot-check generated STLs in Bambu Studio (or equivalent):

1. Flat combined STL
2. Simple two-level relief STL
3. Checkerboard / saddle relief STL
4. Four-color separate STL set (base + colors)
5. Real combined-relief debug fixture STL (Milestone 6.2.3)
6. Multicolor Flat 3MF (base + ≥2 colors)
7. Multicolor Relief 3MF (distinct top heights preserved)

Record import success, dimensions (148 × 53 × 4), whether the parent assembly prevents “multi-part object” reposition dialogs, object count (one logical tile with base + color parts), whether an automatic repair warning appears, visibility of relief steps and magnet recesses, whether preview colors appear, and whether filament assignment still needs to be performed manually. Do not claim “no repair warning”, “colors assigned correctly”, or “AMS auto-mapped” unless observed in the slicer UI. Local edge-incidence validation supplements unclear slicer repair status.

## Optional follow-up coverage

| Area | Focus |
|------|--------|
| Project files / offline | Project JSON round-trip, offline SW behavior |

## Running

```bash
python3 -m http.server 8080
```

Open http://localhost:8080/tests/test-runner.html

Windows: `python -m http.server 8080`

Do not report tests as passing when they were only registered. DOM / browser failures are real failures.

## Honesty rule

A feature is only “done” when implemented **and** covered by relevant tests. Placeholder modules must throw or stay disabled.
