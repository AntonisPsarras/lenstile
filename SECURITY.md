# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| Main branch | Yes |
| Tagged releases | Latest tag only unless noted |

## Reporting a vulnerability

Please open a GitHub security advisory or privately contact the maintainers if a
public issue would put users at risk. Include:

- Affected file paths / commit
- Impact (privacy leak, XSS via local files, denial of service, etc.)
- Reproduction steps

Do not file reports that require adding network access or third-party services as
“fixes.”

## Honesty statement

No audit can prove that software has no vulnerabilities whatsoever. LensTile is
reviewed on a best-effort basis against a documented threat model. Language such
as “perfectly secure,” “vulnerability-free,” or “impossible to leak data” is not
used here.

Accurate claims for this project:

- Local-first processing of user images
- No intended application network requests in product source
- Tested against documented threat cases in the browser harness
- Known limitations and residual risks are listed below
- A responsible disclosure process exists

## Threat model

| Asset | Threat | Control |
|-------|--------|---------|
| User images | Exfiltration | No network APIs in application source; local-only processing |
| Generated meshes | Supply-chain tampering | Zero runtime dependencies |
| Project / debug JSON | Unexpected code execution | Parse as data only; no `eval` |
| Host page | XSS from filenames / metadata | Prefer `textContent` / safe DOM construction; escape XML |
| Browser process | Memory / CPU exhaustion | Pixel caps, revision-aware workers, bounded cleanup passes |

Out of scope: physical security of the user’s machine; malicious browser
extensions; bugs solely in the host browser.

## Dependency policy

- **No** npm/pnpm/yarn/bun packages
- **No** CDN scripts, external stylesheets, or external fonts
- **No** vendored third-party libraries without an explicit project decision and license review

Zero dependencies reduces supply-chain exposure but **does not eliminate**
browser bugs, logic flaws, or XSS.

## Network policy

Application source must not use:

- `fetch`
- `XMLHttpRequest`
- `WebSocket`
- `EventSource`
- `navigator.sendBeacon`
- Remote `importScripts`
- External `<script src>` or `<link href>`

A development test scans the repository for these patterns and fails on matches.
(The test harness itself may use same-origin `fetch` to load local fixtures.)

## File handling policy

- Accept only user-selected local files via `<input type="file">` / drag-drop `File` objects
- Validate MIME/extension before decode; bound extreme dimensions where possible
- Do not upload files anywhere
- Cap quantization output (`MAX_QUANTIZATION_PIXELS`) instead of silently downscaling
- Export filenames strip control characters and unsafe punctuation
- Object URLs are revoked after use
- Errors and diagnostics must not embed source image pixels

## Worker and packaging boundaries

- Worker messages validate types, dimensions, lengths, and revisions
- Stale / mismatched results are ignored
- 3MF XML content is escaped; ZIP paths are fixed and validated
- Automated tests use the in-memory download adapter (never Save As / real download UI)

## Residual risks

- Logic bugs or XSS in unreviewed UI paths remain possible
- Extremely large or hostile images can still stress memory/CPU within browser limits
- Cloning or running arbitrary repository revisions is never inherently risk-free
- Browser vulnerabilities are outside this project’s control

## Local processing guarantees

- Decoding, quantization, geometry, and export run in the browser process
- Optional Web Workers remain same-origin local scripts
- This product does not install an offline cache
