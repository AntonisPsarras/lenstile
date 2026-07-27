import { describe, test, assertEqual } from "./test-utils.js";

/**
 * Development-time repository scan for prohibited network / remote asset patterns.
 * Fetches same-origin source files via relative URLs (allowed for the test page itself).
 */

const SOURCE_FILES = [
  "../index.html",
  "../src/app.js",
  "../src/state.js",
  "../src/config.js",
  "../src/events.js",
  "../src/validation.js",
  "../src/ui/layout.js",
  "../src/ui/controls.js",
  "../src/ui/notifications.js",
  "../src/ui/accessibility.js",
  "../src/ui/quantize-controller.js",
  "../src/ui/printability-controller.js",
  "../src/ui/image-import-controller.js",
  "../src/ui/export-controller.js",
  "../src/export/download.js",
  "../src/export/stl-filenames.js",
  "../src/geometry/tile-base.js",
  "../src/geometry/artwork-mesh.js",
  "../src/geometry/generate-geometry.js",
  "../src/geometry/magnet-circle.js",
  "../src/geometry/mesh-math.js",
  "../src/geometry/raster-coords.js",
  "../src/geometry/geometry-errors.js",
  "../src/workers/mesh-worker-client.js",
  "../src/workers/mesh-worker-protocol.js",
  "../src/config/print-profiles.js",
  "../src/config/detail-profiles.js",
  "../src/image/image-loader.js",
  "../src/image/crop-transform.js",
  "../src/image/crop-renderer.js",
  "../src/image/crop-rasterize.js",
  "../src/image/quantize.js",
  "../src/image/quantize-errors.js",
  "../src/image/color-space.js",
  "../src/image/palette.js",
  "../src/image/transparency.js",
  "../src/image/resolution.js",
  "../src/image/indexed-preview.js",
  "../src/image/mask-cleanup.js",
  "../src/image/feature-thicken.js",
  "../src/image/connected-components.js",
  "../src/image/printability.js",
  "../src/image/printability-errors.js",
  "../src/image/pixel-metrics.js",
  "../src/geometry/magnet-backing.js",
  "../src/geometry/magnet-backing-mesh.js",
  "../src/geometry/magnet-roof.js",
  "../src/geometry/magnet-roof-mesh.js",
  "../src/geometry/tile-spec.js",
  "../src/geometry/primitives.js",
  "../src/geometry/mesh.js",
  "../src/geometry/normals.js",
  "../src/geometry/mask-to-rectangles.js",
  "../src/geometry/extrusion.js",
  "../src/geometry/mesh-validation.js",
  "../src/geometry/geometry-debug-fixture.js",
  "../src/geometry/relief.js",
  "../src/geometry/relief-mesh.js",
  "../src/ui/surface-controls.js",
  "../src/export/binary-stl.js",
  "../src/export/project-json.js",
  "../src/export/crc32.js",
  "../src/export/zip-store.js",
  "../src/export/three-mf.js",
  "../src/export/three-mf-validate.js",
  "../src/export/three-mf-packaging.js",
  "../src/export/xml-escape.js",
  "../src/workers/image-worker.js",
  "../src/workers/image-worker-client.js",
  "../src/workers/image-worker-protocol.js",
  "../src/workers/mesh-worker.js",
  "../styles/reset.css",
  "../styles/tokens.css",
  "../styles/layout.css",
  "../styles/components.css",
  "../styles/editor.css",
  "../styles/responsive.css",
];

/** Patterns that must not appear in application source. */
const PROHIBITED = [
  { name: "fetch(", re: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
  { name: "WebSocket", re: /\bWebSocket\b/ },
  { name: "EventSource", re: /\bEventSource\b/ },
  { name: "sendBeacon", re: /\bsendBeacon\s*\(/ },
  { name: "remote importScripts", re: /importScripts\s*\(\s*['"]https?:/i },
  { name: "external script src", re: /<script[^>]+src\s*=\s*['"]https?:/i },
  { name: "external stylesheet", re: /<link[^>]+href\s*=\s*['"]https?:/i },
];

describe("prohibited network APIs", () => {
  test("application sources contain no network or remote asset APIs", async () => {
    /** @type {string[]} */
    const violations = [];

    for (const path of SOURCE_FILES) {
      const response = await fetch(path);
      if (!response.ok) {
        violations.push(`Missing source file: ${path} (${response.status})`);
        continue;
      }
      const text = await response.text();
      for (const rule of PROHIBITED) {
        if (rule.re.test(text)) {
          violations.push(`${path}: matched ${rule.name}`);
        }
      }
    }

    assertEqual(
      violations.length,
      0,
      violations.length ? violations.join("\n") : undefined,
    );
  });
});
