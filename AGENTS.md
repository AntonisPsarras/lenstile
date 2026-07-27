# Agent Instructions — LensTile

All coding agents and automated assistants must follow these rules.

## Before changing code

1. Read `PROJECT_SPEC.md`.
2. Read `hardware/TILE_V1_SPEC.md` for any geometry or export work.
3. Read `ROADMAP.md` and implement only the active milestone scope.
4. Skim `docs/ARCHITECTURE.md` and `AGENTS.md` (this file).

## Hard prohibitions

- Do **not** add dependencies, package managers, frameworks, or bundlers.
- Do **not** add network requests (`fetch`, XHR, WebSocket, EventSource, beacons, remote imports).
- Do **not** introduce a build step.
- Do **not** load CDN scripts, remote styles, or remote fonts.
- Do **not** add analytics, auth, databases, or cloud services.
- Do **not** use AI APIs in the delivered application.
- Do **not** modify `hardware/Body122.stl`.
- Do **not** invent magnet depth or other hardware values; use the inspected spec.
- Do **not** fake completed functionality with stubbed “success” UI for unimplemented features.
- Do **not** use `Math.random()` in product algorithms.
- Do **not** use Node.js, npm, or a headless Node runner for this project.

## Implementation rules

- Keep changes scoped to the requested milestone.
- Prefer pure functions for math, validation, and serialization.
- Preserve public module interfaces unless the task explicitly changes them.
- Separate serializable state from runtime-only objects (`ImageBitmap`, canvas, etc.).
- Use design tokens in `styles/tokens.css`; avoid scattered magic numbers.
- No inline JavaScript or CSS in HTML.
- Report failures honestly.
- Commit only conceptually complete units when the user asks for a commit.
- Prefer the public product name **LensTile** in user-facing copy; do not blindly rename
  internal algorithm IDs, fixture paths, or historical milestone names.

## Testing

- Run `/tests/test-runner.html` after relevant changes (Python static server only).
- Do **not** require Node.js, npm, or a headless Node runner.
- Add tests alongside new pure logic.
- Never delete failing tests to “make CI green.”
- Automated tests and sample/export pages must use the **test download adapter**
  (`createTestDownloadAdapter` / `setDownloadAdapter` in `src/export/download.js`).
- Tests must never initiate a real browser download, Save As dialog, or file picker
  for saving exports.

## Determinism

- No `Math.random()` in product algorithms.
- No time-based seeds.
- Keep palette and geometry iteration order stable.

## When unsure

- Prefer documenting an unknown over inventing a hardware value.
- Ask only when work is truly blocked.
- Default to the smaller change that preserves architecture.

## User-controlled external actions (permanent)

Never perform any of the following without **explicit user approval for that
specific action**:

- Launch a GUI application (including browsers outside the controlled test page)
- Launch a slicer (Bambu Studio, PrusaSlicer, Cura, Orca, etc.)
- Invoke a system Open With action
- Trigger a browser download
- Trigger a Save As or file-picker dialog for saving
- Call `showSaveFilePicker()`
- Programmatically click an anchor with a `download` attribute
- Write generated artifacts outside an explicitly approved repository test folder
- Open exported files in another application

### Download adapter rules

- Production adapter may trigger a download **only** from a direct real user action
  (one click → one download) and must revoke object URLs safely.
- Test adapter must **never** trigger browser UI; it records filename, MIME type,
  Blob, byte length, and invocation count for in-memory assertions.
- All automated browser tests and sample/export helper pages must inject the
  test adapter.
- Do not leave pages that automatically download on load.

Automated tests must generate bytes and Blobs in memory.

Tests may assert filename, MIME type, byte length, and Blob contents, but must
not initiate a real download.

Generated inspection artifacts may only be written inside a documented
repository directory after explicit user approval.

You may generate files for manual inspection and provide their paths — but do
not launch slicers or claim slicer validation from merely opening a file.

Preserve real-world failing fixtures as regression tests (geometry debug JSON
and reduced masks). Do not discard a reproduced failure once fixed.
