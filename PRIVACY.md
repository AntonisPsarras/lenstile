# Privacy Policy

LensTile is a local-first tool. It is designed so that **images never leave your
device**.

## What data is processed

- Images you choose (PNG, JPEG, WebP)
- Editor settings (crop transform, color count, printability options, surface style)
- Derived previews, masks, and meshes created from that input

## Where it is processed

- Entirely in your browser on your device
- Optional Web Workers are local scripts from this origin only

## What may be stored locally

- The current app keeps session state in memory until you export a file
- Project save/load and IndexedDB persistence are **not** enabled yet
- Downloaded STL / 3MF / JSON files are saved where you choose via the browser
  download UI (only after an explicit click)

## What is never collected

- No accounts
- No analytics or telemetry
- No cookies for tracking
- No crash reporting services
- No cloud backups
- No advertising identifiers

## Network

The application source does not perform intended runtime network requests. A
future offline mode may cache **same-origin** files only; that is not image upload.

## Clearing data

Until persistence is added, closing the tab clears in-memory state. Exported
files on disk must be deleted manually by you. You can also clear site data for
this origin in your browser settings.

## Contact

Privacy questions can be raised via the project issue tracker.
