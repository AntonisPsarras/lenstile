# Risk Register

| ID | Risk | Impact | Likelihood | Mitigation | Milestone |
|----|------|--------|------------|------------|-----------|
| R1 | Magnet depth inferred from mesh only | Wrong recess in generated tile | L | Document confidence; single constant; version bump if revised | M0/M6 |
| R2 | CAD STL offset vs center-origin | Misaligned exports | M | Always recenter; never persist CAD offset in project JSON | M4–M6 |
| R3 | Float / winding errors in STL | Slicer rejects mesh | M | Validation tests; consistent CCW winding | M4 |
| R4 | Multicolor part drift | Layers misregister | H | Shared origin; alignment tests | M5–M7 |
| R5 | 3MF color support varies by slicer | Bad prints | M | Document tested slicers; STL fallback | M7 |
| R6 | Large images freeze UI | Poor UX | M | Size warning; workers in M2+ | M1–M2 |
| R7 | Over-cleanup of masks | Lost detail | M | Tunable thresholds; before/after preview | M3 |
| R8 | Accidental network/deps | Privacy/supply-chain breach | H | AGENTS.md + prohibited-pattern tests | All |
| R9 | Browser API gaps | App broken on old browsers | M | Feature detect; clear error | M1/M8 |
| R10 | SW serving stale assets | Confusing bugs | M | Versioned cache; update messaging | M8 |
| R11 | Triangle explosion from noisy masks | Memory/time blowups | M | Rectangle merge; resolution cap | M5 |
| R13 | Local magnet backing leaves fragmented first layers above cavities | Poor bridges / top-surface defects | M | Full-width 0.5 mm structural bridge (Z 2.5…3.0); artwork begins at 3.0 | M9.1 |
