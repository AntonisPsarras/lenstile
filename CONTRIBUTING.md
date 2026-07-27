# Contributing

Thanks for helping improve LensTile.

## Ground rules

- Read `PROJECT_SPEC.md` and `AGENTS.md` first.
- No third-party runtime dependencies.
- No network access from application code.
- No build tooling — ship static HTML/CSS/JS.
- Keep milestones small and reviewable.
- Prefer the public name **LensTile** in user-facing copy; do not rename
  historical milestones, fixture paths, or internal algorithm IDs without need.

## Development setup

```bash
cd lenstile   # or this repository root
python3 -m http.server 8080
```

Open `http://localhost:8080/` for the app and
`http://localhost:8080/tests/test-runner.html` for tests.

On Windows, `python -m http.server 8080` is fine if `python3` is unavailable.

## Coding conventions

- ES modules only; one concern per file where practical
- JSDoc on exported functions
- Pure functions for transforms, validation, serialization
- CSS values via tokens in `styles/tokens.css`
- Descriptive control labels; keyboard access required for new controls
- Mark unimplemented features as disabled — do not pretend they work
- Do not leave placeholder buttons such as “Export … (later)” in the product UI

## Tests

Add or update browser tests under `/tests` for new logic. The harness provides
`describe`, `test`, `assertEqual`, `assertApproxEqual`, `assertDeepEqual`, and
`assertThrows`.

Open `/tests/test-runner.html` via the Python static server. Node.js is not
required and must not be introduced as a project dependency.

Automated export tests must inject the in-memory download adapter and must never
trigger real browser downloads.

## Pull requests

- Explain the milestone and acceptance criteria touched
- Note any hardware/spec assumptions
- Confirm prohibited-network tests still pass
- Do not include secrets or personal images
- Prefer updating goldens only with an explicit old→new hash report when
  serialization intentionally changes

## License

By contributing, you agree your contributions are licensed under the project
license (MIT).
