# Optional manual fixtures

## Geometry debug (Milestone 7.2)

`Untitled_tile-geometry-debug.json` — exact user-provided full-size Flat
four-color geometry debug export (296×106). Used as the packaging regression
fixture. Do not replace with a synthetic miniature.

## Bambu Studio reference

Place a user-approved Bambu Studio two-color `.3mf` here as:

`bambu-two-color-reference.3mf`

When present, the browser test harness parses its ZIP entry list and produces a
diagnostic comparison against the standards-based exporter.

Do **not** commit copyrighted or user-specific Bambu projects unless explicitly
approved. The standards suite skips this diagnostic cleanly when the file is absent.
