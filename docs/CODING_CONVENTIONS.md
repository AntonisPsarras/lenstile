# Coding Conventions

- ES modules only; one primary concern per file
- JSDoc on exported functions and public typedefs
- Prefer pure functions for math, validation, and serialization
- Immutable-style state updates via `state.js`
- No inline scripts or styles in HTML
- Design tokens live in `styles/tokens.css`
- No magic numbers — name constants in `config.js` or `tile-spec.js`
- Guard clauses over deep nesting
- Surface errors to UI and console; never swallow silently
- Disable unimplemented features; do not fake success
- System fonts only; no remote fonts
