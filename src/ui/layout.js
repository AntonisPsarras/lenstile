/**
 * Build the static application layout (semantic HTML via DOM APIs).
 * Printability actions are inline in the Make printable panel (no Advanced wrapper).
 */

import {
  APP_NAME,
  APP_TAGLINE,
  STEP_LABELS,
  STEPS,
  FEATURES,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  DETAIL_PROFILES,
  PRINT_PROFILES,
  DEFAULT_DETAIL_PROFILE_ID,
  DEFAULT_PRINT_PROFILE_ID,
} from "../config.js";
import { buildProgressCard } from "./progress.js";
import {
  NOZZLE_PIPELINE_STAGES,
  MODEL_BUILD_STAGES,
} from "../workflow/pipeline-status.js";

/**
 * @param {HTMLElement} root
 */
export function mountLayout(root) {
  root.innerHTML = "";
  root.className = "app-shell";

  const header = el("header", { class: "app-header", role: "banner" }, [
    el("div", { class: "brand-block" }, [
      el("p", { class: "brand-name" }, [APP_NAME]),
      el("p", { class: "brand-tagline" }, [APP_TAGLINE]),
    ]),
  ]);

  const nav = el("nav", {
    class: "workflow-nav step-nav",
    "aria-label": "Workflow steps",
  });
  const list = el("ol", { class: "step-list" });
  for (const step of STEPS) {
    const btn = el("button", {
      type: "button",
      class: "step-button",
      "data-step": step,
      id: `step-${step}`,
    }, [STEP_LABELS[step]]);
    list.appendChild(el("li", {}, [btn]));
  }
  nav.appendChild(list);

  const cropCanvas = el("canvas", {
    id: "crop-canvas",
    class: "crop-canvas",
    role: "img",
    "aria-label": "Tile crop preview canvas",
  });
  cropCanvas.appendChild(
    el("p", {
      class: "canvas-fallback",
      id: "canvas-fallback",
      "aria-hidden": "true",
    }, [
      "Your browser cannot display the canvas preview.",
    ]),
  );

  const dropZone = el("div", {
    id: "image-drop-zone",
    class: "image-drop-zone",
    role: "button",
    tabindex: "0",
    "aria-label": "Drop an image here or choose an image file",
  }, [
    el("p", { class: "drop-zone-title" }, ["Drop an image here"]),
    el("p", { class: "drop-zone-or" }, ["or"]),
    el("button", {
      type: "button",
      class: "button button-primary button-choose-image",
      id: "btn-choose-image",
    }, ["Choose image"]),
    el("p", { class: "drop-zone-formats" }, ["Accepted formats: PNG, JPEG, WebP"]),
    el("p", { class: "drop-zone-privacy" }, [
      "Processed only on this device — images never leave your browser.",
    ]),
    el("p", {
      id: "drop-zone-error",
      class: "drop-zone-error",
      hidden: "true",
      role: "alert",
    }),
  ]);

  const imageInput = el("input", {
    id: "image-input",
    class: "visually-hidden",
    type: "file",
    accept: "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp",
    tabindex: "-1",
    "aria-hidden": "true",
  });

  const toastHost = el("div", {
    id: "toast-host",
    class: "toast-host app-status-host",
    "aria-label": "Application status",
    role: "region",
  });

  const canvasShell = el("div", { class: "canvas-shell", id: "canvas-shell" }, [
    cropCanvas,
    dropZone,
    imageInput,
  ]);

  const previewPane = el("section", {
    class: "preview-pane preview-panel",
    "aria-label": "Tile image preview",
  }, [
    el("div", { class: "canvas-shell-wrap" }, [canvasShell]),
    toastHost,
    el("p", { class: "privacy-banner" }, [
      "Privacy: processing stays in your browser. No uploads, accounts, or trackers.",
    ]),
  ]);

  const settingsPane = el("aside", {
    class: "settings-pane control-panel",
    "aria-label": "Editor controls",
  }, [
    el("div", { class: "settings-header" }, [
      el("p", {
        id: "pipeline-status",
        class: "pipeline-status",
        role: "status",
        "aria-live": "polite",
        hidden: "true",
      }),
    ]),
    el("div", { class: "settings-scroll" }),
  ]);

  const workspace = el("div", { class: "workspace" }, [previewPane, settingsPane]);

  const liveRegion = el("div", {
    id: "live-region",
    class: "live-region",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
  });

  const main = el("main", { class: "app-main", id: "main" }, [nav, workspace]);
  root.append(header, main, liveRegion);

  const scroll = root.querySelector(".settings-scroll");
  if (scroll) {
    scroll.append(
      buildImageControls(),
      buildColorControls(),
      buildPrintabilityControls(),
      buildExportControls(),
    );
  }

  return {
    canvas: /** @type {HTMLCanvasElement} */ (root.querySelector("#crop-canvas")),
    canvasShell: /** @type {HTMLElement} */ (root.querySelector("#canvas-shell")),
    imageInput: /** @type {HTMLInputElement} */ (root.querySelector("#image-input")),
    features: FEATURES,
  };
}

function buildImageControls() {
  return el("section", {
    class: "control-section",
    "data-panel": "image",
    "aria-labelledby": "controls-image-title",
  }, [
    el("div", { class: "settings-body" }, [
      el("h2", { id: "controls-image-title", class: "panel-title" }, ["Image"]),
      el("p", { class: "panel-goal help-text" }, ["Choose and position your image."]),

      el("div", {
        id: "image-empty-actions",
        class: "image-actions image-actions-empty",
      }, [
        el("p", { class: "help-text" }, [
          "Use the drop zone or Choose image to import a local PNG, JPEG, or WebP.",
        ]),
      ]),

      el("div", {
        id: "image-loaded-actions",
        class: "image-actions image-actions-loaded",
        hidden: "true",
      }, [
        el("div", { class: "button-row" }, [
          el("button", {
            type: "button",
            class: "button button-primary",
            id: "btn-replace-image",
          }, ["Replace image"]),
        ]),
        el("details", { class: "tech-disclosure quiet-disclosure" }, [
          el("summary", {}, ["More image options"]),
          el("div", { class: "button-row" }, [
            el("button", {
              type: "button",
              class: "button button-danger button-quiet",
              id: "btn-remove-image",
            }, ["Remove image"]),
          ]),
        ]),
        el("div", {
          id: "image-meta",
          class: "image-meta",
          "aria-live": "polite",
        }, [
          el("p", { class: "image-meta-name", id: "image-meta-name" }),
          el("p", { class: "image-meta-dims mono-meta", id: "image-meta-dims" }),
        ]),
      ]),

      el("div", { class: "control-group transform-controls", "aria-label": "Transform controls" }, [
        el("h3", { class: "panel-subtitle" }, ["Position"]),
        el("div", { class: "button-row button-row-compact" }, [
          btn("btn-fit", "Fit"),
          btn("btn-fill", "Fill"),
          btn("btn-reset", "Reset"),
          btn("btn-rotate", "Rotate"),
          btn("btn-flip-h", "Flip H"),
          btn("btn-flip-v", "Flip V"),
        ]),
        fieldRange(
          "zoom",
          "Zoom",
          String(ZOOM_MIN),
          String(ZOOM_MAX),
          String(ZOOM_STEP),
          "1",
        ),
        el("p", { class: "help-text" }, [
          "Drag the preview to pan. Use the wheel or zoom slider to scale.",
        ]),
      ]),
    ]),

    el("div", { class: "settings-footer panel-footer stage-continue" }, [
      el("p", {
        class: "stage-footer-hint",
        id: "image-footer-hint",
        hidden: "true",
      }),
      el("button", {
        type: "button",
        class: "button button-primary",
        id: "btn-update-design",
        hidden: "true",
      }, ["Update design"]),
      el("button", {
        type: "button",
        class: "button button-primary",
        id: "btn-continue-colors",
        disabled: "true",
      }, ["Continue"]),
    ]),
  ]);
}

function buildColorControls() {
  const detailOptions = Object.values(DETAIL_PROFILES).map((profile) =>
    el("option", {
      value: profile.id,
      ...(profile.id === DEFAULT_DETAIL_PROFILE_ID ? { selected: "selected" } : {}),
    }, [`${profile.label} (${profile.pixelsPerMm} px/mm)`]),
  );

  return el("section", {
    class: "control-section",
    "data-panel": "colors",
    "aria-labelledby": "controls-colors-title",
  }, [
    el("div", { class: "settings-body" }, [
      el("h2", { id: "controls-colors-title", class: "panel-title" }, ["Colors"]),
      el("p", { class: "panel-goal help-text" }, ["Choose how the image is simplified."]),
      buildProgressCard(el, NOZZLE_PIPELINE_STAGES, "colors"),
      el("div", { class: "field" }, [
        el("label", { class: "field-label", for: "color-count" }, ["Image detail colors (1–8)"]),
        el("input", {
          id: "color-count",
          class: "input",
          type: "number",
          value: "4",
          min: "1",
          max: "8",
          step: "1",
          "aria-describedby": "color-count-help",
        }),
        el("p", {
          id: "color-count-help",
          class: "help-text",
        }, [
          "Image colors describe regions taken from the picture. They do not have to match the number of filament colors you will print.",
        ]),
      ]),

      el("div", { class: "field" }, [
        el("p", {
          id: "automatic-detail-label",
          class: "field-label",
        }, ["Automatic detail"]),
        el("p", {
          id: "automatic-detail-value",
          class: "help-text",
          "aria-live": "polite",
        }, ["Automatic detail: driven by nozzle size"]),
      ]),
      el("p", {
        id: "resolution-hint",
        class: "help-text",
      }, ["Output size updates from the nozzle processing profile."]),
      el("p", {
        id: "detail-warning",
        class: "status-warning",
        role: "status",
        hidden: "true",
      }, ["Higher detail may take longer on large crops."]),

      el("div", { class: "button-row" }, [
        el("button", {
          type: "button",
          class: "button button-primary",
          id: "btn-quantize",
          disabled: "true",
        }, ["Create color preview"]),
      ]),
      el("p", {
        id: "quantize-status",
        class: "help-text visually-hidden",
        role: "status",
        "aria-live": "polite",
      }, ["Press Create color preview to build a 1–8 color preview."]),
      el("p", {
        id: "stale-notice",
        class: "status-warning",
        hidden: "true",
        role: "status",
      }, ["Your image changed. Update the color preview."]),

      el("div", {
        class: "preview-compare colors-preview-compact",
        id: "colors-preview-compare",
        "aria-label": "Source and color preview comparison",
      }, [
        el("div", {
          class: "segmented-control",
          role: "radiogroup",
          "aria-label": "Preview mode",
        }, [
          el("label", { class: "segmented-option", for: "compare-mode-source" }, [
            el("input", {
              id: "compare-mode-source",
              type: "radio",
              name: "compare-mode-seg",
              value: "source",
            }),
            el("span", {}, ["Original"]),
          ]),
          el("label", { class: "segmented-option", for: "compare-mode-quantized" }, [
            el("input", {
              id: "compare-mode-quantized",
              type: "radio",
              name: "compare-mode-seg",
              value: "quantized",
              checked: "checked",
            }),
            el("span", {}, ["Preview"]),
          ]),
          el("label", { class: "segmented-option", for: "compare-mode-both" }, [
            el("input", {
              id: "compare-mode-both",
              type: "radio",
              name: "compare-mode-seg",
              value: "both",
            }),
            el("span", {}, ["Compare"]),
          ]),
        ]),
        // Hidden select kept for existing control bindings.
        el("select", { id: "compare-mode", class: "input visually-hidden", "aria-hidden": "true" }, [
          el("option", { value: "both" }, ["Side by side"]),
          el("option", { value: "source" }, ["Source only"]),
          el("option", { value: "quantized", selected: "selected" }, ["Color preview only"]),
        ]),
        el("div", {
          class: "preview-compare-grid preview-compare-bounded",
          id: "compare-grid",
          "data-mode": "quantized",
        }, [
          el("figure", { class: "preview-figure", "data-compare": "source", hidden: "true" }, [
            el("figcaption", {}, ["Original"]),
            el("canvas", {
              id: "source-preview-canvas",
              class: "indexed-preview-canvas",
              width: "296",
              height: "106",
              role: "img",
              "aria-label": "Source crop preview at output resolution",
            }),
            el("p", { class: "canvas-fallback-text" }, ["Source preview unavailable."]),
          ]),
          el("figure", { class: "preview-figure", "data-compare": "quantized" }, [
            el("figcaption", {}, ["Color preview"]),
            el("canvas", {
              id: "quantized-preview-canvas",
              class: "indexed-preview-canvas",
              width: "296",
              height: "106",
              role: "img",
              "aria-label": "Color preview",
            }),
            el("p", { class: "canvas-fallback-text" }, ["Create a color preview to see the result."]),
          ]),
        ]),
      ]),

      el("div", {
        id: "palette-editor",
        class: "palette-editor palette-editor-compact",
        "aria-label": "Image colors",
      }, [
        el("div", { class: "palette-editor-header" }, [
          el("h3", { class: "panel-subtitle" }, ["Image colors"]),
          el("button", {
            type: "button",
            class: "button button-secondary",
            id: "btn-reset-palette",
            disabled: "true",
          }, ["Reset colors"]),
        ]),
        el("ul", { id: "palette-list", class: "palette-list palette-list-compact" }),
        el("p", { id: "palette-empty", class: "help-text" }, [
          "Image colors appear after a successful color preview.",
        ]),
      ]),

      el("details", {
        id: "colors-advanced",
        class: "tech-disclosure",
      }, [
        el("summary", {}, ["Advanced"]),
        el("fieldset", { class: "field-set", id: "transparency-fieldset" }, [
          el("legend", { class: "field-label" }, ["Transparency background"]),
          el("div", { class: "choice-row" }, [
            radio("transparency-white", "transparency-mode", "white", "White", true),
            radio("transparency-black", "transparency-mode", "black", "Black", false),
            radio("transparency-custom", "transparency-mode", "custom", "Custom", false),
          ]),
          el("div", {
            class: "field",
            id: "custom-bg-field",
            hidden: "true",
          }, [
            el("label", { class: "field-label", for: "custom-bg-color" }, ["Custom background"]),
            el("input", {
              id: "custom-bg-color",
              class: "input input-color",
              type: "color",
              value: "#ffffff",
              "aria-label": "Custom transparency background color",
            }),
          ]),
        ]),
        el("details", {
          id: "legacy-detail-details",
          class: "tech-disclosure",
          hidden: "true",
        }, [
          el("summary", {}, ["Legacy detail profile"]),
          el("div", { class: "field" }, [
            el("label", { class: "field-label", for: "detail-profile" }, ["Detail (legacy)"]),
            el("select", {
              id: "detail-profile",
              class: "input",
              "aria-describedby": "resolution-hint detail-warning",
            }, detailOptions),
          ]),
        ]),
        el("details", {
          id: "quantize-diagnostics-details",
          class: "tech-disclosure",
          hidden: "true",
        }, [
          el("summary", {}, ["Technical details"]),
          el("p", {
            id: "quantize-diagnostics",
            class: "help-text mono-meta",
          }),
        ]),
      ]),
    ]),

    el("div", { class: "panel-footer settings-footer stage-continue" }, [
      el("span", {
        id: "workflow-footer-status",
        class: "workflow-footer-status",
        hidden: "true",
      }),
      el("button", {
        type: "button",
        class: "button button-primary",
        id: "btn-continue-print",
        disabled: "true",
      }, ["Continue"]),
    ]),
  ]);
}

/**
 * @param {string} id
 * @param {string} name
 * @param {string} value
 * @param {string} label
 * @param {boolean} checked
 */
function radio(id, name, value, label, checked) {
  const inputAttrs = {
    id,
    class: "input-radio",
    type: "radio",
    name,
    value,
  };
  if (checked) inputAttrs.checked = "checked";
  return el("label", { class: "choice", for: id }, [
    el("input", inputAttrs),
    el("span", {}, [label]),
  ]);
}

function buildPrintabilityControls() {
  const profileOptions = Object.values(PRINT_PROFILES).map((profile) =>
    el("option", {
      value: profile.id,
      ...(profile.id === DEFAULT_PRINT_PROFILE_ID ? { selected: "selected" } : {}),
    }, [profile.label]),
  );

  return el("section", {
    class: "control-section",
    "data-panel": "printability",
    "aria-labelledby": "controls-print-title",
  }, [
    el("div", { class: "settings-body" }, [
      el("h2", { id: "controls-print-title", class: "panel-title" }, ["Make printable"]),
      el("p", { class: "panel-goal help-text" }, ["Prepare the design for your nozzle."]),
      el("div", { class: "field" }, [
        el("label", { class: "field-label", for: "print-profile" }, ["Nozzle size"]),
        el("select", {
          id: "print-profile",
          class: "input",
          "aria-describedby": "print-profile-help",
        }, profileOptions),
        el("p", {
          id: "print-profile-help",
          class: "help-text",
        }, [
          "Nozzle size prepares image detail automatically. Select the matching nozzle in your slicer before printing.",
        ]),
      ]),
      buildProgressCard(el, NOZZLE_PIPELINE_STAGES, "print"),
      el("div", { class: "field visually-hidden", id: "print-status-field" }, [
        el("p", { class: "field-label", id: "print-status-label" }, ["Status"]),
        el("p", {
          id: "print-status",
          class: "help-text",
          "aria-live": "polite",
        }, ["Waiting for automatic check and fix"]),
      ]),
      el("div", {
        class: "button-stack print-actions",
        "aria-label": "Printability actions",
      }, [
        el("button", {
          type: "button",
          class: "button button-secondary",
          id: "btn-analyze-print",
        }, ["Check only"]),
        el("button", {
          type: "button",
          class: "button button-secondary",
          id: "btn-clean-print",
          hidden: "true",
        }, ["Fix small details"]),
        el("button", {
          type: "button",
          class: "button button-secondary",
          id: "btn-reset-cleanup",
          disabled: "true",
        }, ["Undo fixes"]),
      ]),
      el("p", {
        id: "print-issue-summary",
        class: "issue-summary",
        role: "status",
        hidden: "true",
      }),
      el("div", { class: "issue-legend", "aria-label": "Problem area legend" }, [
        el("span", { class: "issue-swatch issue-island" }, ["Tiny area"]),
        el("span", { class: "issue-swatch issue-hole" }, ["Tiny hole"]),
        el("span", { class: "issue-swatch issue-feature" }, ["Narrow detail"]),
        el("span", { class: "issue-swatch issue-gap" }, ["Narrow gap"]),
      ]),
      el("div", {
        class: "preview-compare",
        id: "print-preview-compare",
      }, [
        el("div", { class: "field", id: "print-comparison-field" }, [
          el("span", { class: "field-label", id: "print-comparison-label" }, ["Compare"]),
          el("div", {
            class: "choice-row",
            role: "radiogroup",
            "aria-labelledby": "print-comparison-label",
          }, [
            comparisonChoice("print-view-quantized", "quantized", "Color preview", false),
            comparisonChoice("print-view-issues", "issues", "Problem areas", false),
            comparisonChoice("print-view-cleaned", "cleaned", "Fixed", false),
            comparisonChoice("print-view-side", "side-by-side", "Side by side", true),
          ]),
        ]),
        el("div", {
          class: "preview-compare-grid preview-compare-bounded",
          id: "print-compare-grid",
          "data-mode": "side-by-side",
        }, [
          el("figure", { class: "preview-figure", "data-print-view": "quantized" }, [
            el("figcaption", {}, ["Before"]),
            el("canvas", {
              id: "print-quantized-canvas",
              class: "indexed-preview-canvas",
              width: "296",
              height: "106",
              role: "img",
              "aria-label": "Color preview",
            }),
          ]),
          el("figure", { class: "preview-figure", "data-print-view": "issues", hidden: "true" }, [
            el("figcaption", {}, ["Problem areas"]),
            el("canvas", {
              id: "print-issues-canvas",
              class: "indexed-preview-canvas",
              width: "296",
              height: "106",
              role: "img",
              "aria-label": "Problem areas overlay",
            }),
          ]),
          el("figure", { class: "preview-figure", "data-print-view": "cleaned" }, [
            el("figcaption", {}, ["Fixed"]),
            el("canvas", {
              id: "print-cleaned-canvas",
              class: "indexed-preview-canvas",
              width: "296",
              height: "106",
              role: "img",
              "aria-label": "Fixed design preview",
            }),
          ]),
        ]),
      ]),
      el("details", {
        id: "print-tech-details",
        class: "tech-disclosure",
      }, [
        el("summary", {}, ["Technical details"]),
        el("dl", {
          id: "print-derived-settings",
          class: "derived-settings",
        }, [
          el("div", { class: "derived-row" }, [
            el("dt", {}, ["Nozzle diameter"]),
            el("dd", { id: "print-derived-nozzle" }, ["0.4 mm"]),
          ]),
          el("div", { class: "derived-row" }, [
            el("dt", {}, ["Minimum printable feature"]),
            el("dd", { id: "print-derived-feature" }, ["0.45 mm"]),
          ]),
          el("div", { class: "derived-row" }, [
            el("dt", {}, ["Minimum gap"]),
            el("dd", { id: "print-derived-gap" }, ["0.45 mm"]),
          ]),
          el("div", { class: "derived-row" }, [
            el("dt", {}, ["Minimum island area"]),
            el("dd", { id: "print-derived-island" }, ["0.30 mm²"]),
          ]),
          el("div", { class: "derived-row" }, [
            el("dt", {}, ["Maximum hole fill"]),
            el("dd", { id: "print-derived-hole" }, ["0.30 mm²"]),
          ]),
        ]),
      ]),
      el("details", {
        id: "print-report",
        class: "tech-disclosure print-report",
        hidden: "true",
      }, [
        el("summary", {}, ["Technical report"]),
        el("dl", { class: "derived-settings", id: "print-report-stats" }, []),
        el("ul", { class: "print-report-warnings", id: "print-report-warnings" }, []),
      ]),
    ]),

    el("div", { class: "panel-footer settings-footer stage-continue" }, [
      el("span", {
        class: "workflow-footer-status",
        hidden: "true",
      }),
      el("p", {
        class: "stage-footer-hint",
        id: "print-footer-hint",
        hidden: "true",
      }),
      el("button", {
        type: "button",
        class: "button button-primary",
        id: "btn-accept-cleanup",
        disabled: "true",
      }, ["Use this design"]),
      el("button", {
        type: "button",
        class: "button button-primary",
        id: "btn-continue-download",
        disabled: "true",
        hidden: "true",
      }, ["Continue to download"]),
    ]),
  ]);
}

/**
 * @param {string} id
 * @param {string} value
 * @param {string} label
 * @param {boolean} checked
 */
function comparisonChoice(id, value, label, checked) {
  const inputAttrs = {
    id,
    type: "radio",
    name: "print-comparison",
    value,
  };
  if (checked) inputAttrs.checked = "checked";
  return el("label", { class: "choice", for: id }, [
    el("input", inputAttrs),
    el("span", {}, [label]),
  ]);
}

function buildReliefEditorPanel() {
  return el("div", {
    class: "export-relief-editor relief-dropdown-panel",
    id: "export-relief-editor",
    hidden: "true",
    role: "region",
    "aria-labelledby": "btn-edit-relief",
  }, [
    el("div", { id: "surface-relief-controls", class: "relief-editor-body" }, [
      el("p", {
        id: "surface-relief-guidance",
        class: "help-text relief-editor-guidance",
      }, [
        "Relief works with one filament or multicolor printing. Physical validation is still required.",
      ]),
      el("fieldset", { class: "nested-fieldset relief-editor-fieldset" }, [
        el("legend", {}, ["Relief strength"]),
        el("div", { class: "choice-row relief-strength-choices" }, [
          el("label", { class: "choice", for: "relief-strength-subtle" }, [
            el("input", {
              id: "relief-strength-subtle",
              type: "radio",
              name: "relief-strength",
              value: "subtle",
            }),
            el("span", {}, ["Subtle"]),
          ]),
          el("label", { class: "choice", for: "relief-strength-standard" }, [
            el("input", {
              id: "relief-strength-standard",
              type: "radio",
              name: "relief-strength",
              value: "standard",
              checked: "checked",
            }),
            el("span", {}, ["Standard"]),
          ]),
          el("label", { class: "choice", for: "relief-strength-bold" }, [
            el("input", {
              id: "relief-strength-bold",
              type: "radio",
              name: "relief-strength",
              value: "bold",
            }),
            el("span", {}, ["Bold"]),
          ]),
        ]),
      ]),
      el("fieldset", { class: "nested-fieldset relief-editor-fieldset" }, [
        el("legend", {}, ["Height order"]),
        el("div", { class: "choice-stack" }, [
          el("label", { class: "choice", for: "height-order-darkest-highest" }, [
            el("input", {
              id: "height-order-darkest-highest",
              type: "radio",
              name: "height-order",
              value: "darkest-highest",
              checked: "checked",
            }),
            el("span", {}, ["Darkest highest"]),
          ]),
          el("label", { class: "choice", for: "height-order-lightest-highest" }, [
            el("input", {
              id: "height-order-lightest-highest",
              type: "radio",
              name: "height-order",
              value: "lightest-highest",
            }),
            el("span", {}, ["Lightest highest"]),
          ]),
          el("label", { class: "choice", for: "height-order-custom" }, [
            el("input", {
              id: "height-order-custom",
              type: "radio",
              name: "height-order",
              value: "custom",
            }),
            el("span", {}, ["Custom order"]),
          ]),
        ]),
        el("div", { class: "button-row relief-editor-actions" }, [
          el("button", {
            type: "button",
            class: "button button-secondary button-compact",
            id: "btn-reset-height-order",
          }, ["Reset automatic order"]),
        ]),
      ]),
      el("p", {
        id: "surface-share-notice",
        class: "help-text notice-inline",
        hidden: "true",
        role: "status",
      }),
      el("p", { id: "surface-height-summary", class: "help-text relief-height-summary" }),
      el("div", {
        id: "surface-color-height-list",
        class: "surface-color-height-list",
      }),
      el("div", {
        id: "surface-height-preview-wrap",
        class: "surface-height-preview-wrap",
      }, [
        el("p", { class: "field-label" }, ["Height preview"]),
        el("canvas", {
          id: "surface-height-preview",
          class: "surface-height-preview",
          width: "160",
          height: "60",
          "aria-label": "Brightness preview of surface heights",
        }),
        el("div", { id: "surface-height-legend", class: "surface-height-legend" }),
      ]),
      el("details", { class: "tech-disclosure", id: "surface-tech-details" }, [
        el("summary", {}, ["Technical details"]),
        el("pre", { id: "surface-tech-heights", class: "help-text mono-meta" }),
      ]),
    ]),
  ]);
}

function buildExportControls() {
  return el("section", {
    class: "control-section",
    "data-panel": "export",
    "aria-labelledby": "controls-export-title",
  }, [
    el("div", {
      class: "settings-body export-main-view",
      id: "export-main-view",
    }, [
      el("h2", { id: "controls-export-title", class: "panel-title" }, ["Download"]),
      el("p", { class: "panel-goal help-text" }, ["Choose how you want to print."]),
      buildProgressCard(el, MODEL_BUILD_STAGES, "export"),
      el("div", {
        id: "export-readiness",
        class: "export-readiness stage-checklist",
        role: "status",
        "aria-live": "polite",
      }),
      el("p", { id: "export-gaps", class: "help-text export-gaps", hidden: "true" }),
      el("fieldset", { class: "surface-style-fieldset", id: "surface-style-fieldset" }, [
        el("legend", {}, ["Surface style"]),
        el("p", { id: "surface-style-help", class: "help-text" }, [
          "Relief uses raised and lowered areas. It can be printed with one filament or multiple colors.",
        ]),
        el("div", { class: "choice-row" }, [
          el("label", { class: "choice", for: "surface-style-flat" }, [
            el("input", {
              id: "surface-style-flat",
              type: "radio",
              name: "surface-style",
              value: "flat",
              checked: "checked",
            }),
            el("span", {}, ["Smooth surface"]),
          ]),
          el("label", { class: "choice", for: "surface-style-relief" }, [
            el("input", {
              id: "surface-style-relief",
              type: "radio",
              name: "surface-style",
              value: "relief",
            }),
            el("span", {}, ["Relief surface"]),
          ]),
        ]),
        el("div", { id: "relief-summary-row", class: "relief-summary-row", hidden: "true" }, [
          el("p", { id: "relief-summary-text", class: "help-text relief-summary-text" }),
          el("div", { class: "relief-dropdown" }, [
            el("button", {
              type: "button",
              class: "button button-secondary relief-dropdown-trigger",
              id: "btn-edit-relief",
              "aria-expanded": "false",
              "aria-controls": "export-relief-editor",
            }, ["Edit relief"]),
            buildReliefEditorPanel(),
          ]),
        ]),
      ]),
      el("div", { class: "export-file-cards", "aria-label": "File choices" }, [
        el("div", { class: "export-file-card" }, [
          el("h3", { class: "panel-subtitle" }, ["One filament"]),
          el("p", { class: "help-text" }, [
            "Works with Smooth or Relief. No filament changes required.",
          ]),
        ]),
        el("div", { class: "export-file-card" }, [
          el("h3", { class: "panel-subtitle" }, ["Multicolor"]),
          el("p", { class: "help-text" }, [
            "Works with Smooth or Relief. Image regions become separate color parts.",
          ]),
        ]),
      ]),
      el("p", { id: "geometry-status", class: "status-line visually-hidden", role: "status" }, [
        "Model not built yet.",
      ]),
      el("div", { class: "button-stack export-primary-downloads" }, [
        el("button", {
          type: "button",
          class: "button button-primary",
          id: "btn-download-combined-stl",
          disabled: "true",
        }, ["Download one-filament STL"]),
        el("button", {
          type: "button",
          class: "button button-secondary",
          id: "btn-export-3mf",
          disabled: "true",
        }, ["Download multicolor 3MF"]),
        el("p", {
          id: "export-3mf-status",
          class: "help-text visually-hidden",
          role: "status",
        }),
      ]),
      el("details", {
        id: "export-more-options",
        class: "tech-disclosure",
      }, [
        el("summary", {}, ["More file options"]),
        el("div", { class: "button-stack" }, [
          el("button", {
            type: "button",
            class: "button button-secondary",
            id: "btn-generate-model",
          }, ["Rebuild model"]),
          el("button", {
            type: "button",
            class: "button button-secondary",
            id: "btn-download-base-stl",
            disabled: "true",
          }, ["Download base STL"]),
          el("button", {
            type: "button",
            class: "button button-secondary",
            id: "btn-download-all-colors-stl",
            disabled: "true",
          }, ["Download separate color STLs"]),
        ]),
        el("p", { class: "help-text" }, [
          "Separate color files download one at a time.",
        ]),
        el("div", {
          id: "export-color-downloads",
          class: "export-color-downloads",
        }),
        el("div", {
          id: "export-base-color-row",
          class: "export-base-color-row",
        }, [
          el("label", { class: "field-label", for: "export-base-color" }, ["Base color"]),
          el("input", {
            id: "export-base-color",
            type: "color",
            value: "#2a2a2a",
            title: "Structural base color for the multicolor file (does not rebuild the model)",
          }),
          el("span", {
            id: "export-base-color-hex",
            class: "help-text mono-meta",
          }, ["#2A2A2A"]),
        ]),
        el("div", {
          id: "export-3mf-swatches",
          class: "export-3mf-swatches",
          "aria-label": "Used artwork colors",
        }),
        el("details", {
          id: "export-3mf-tech-details",
          class: "tech-disclosure",
          hidden: "true",
        }, [
          el("summary", {}, ["3MF technical details"]),
          el("pre", { id: "export-3mf-tech", class: "help-text mono-meta" }),
          el("div", { class: "button-stack", id: "export-3mf-diagnostics-actions" }, [
            el("button", {
              type: "button",
              class: "button button-secondary",
              id: "btn-download-3mf-diagnostics",
              hidden: "true",
              title: "Download local 3MF packaging diagnostics (no image data)",
            }, ["Download 3MF diagnostics"]),
          ]),
        ]),
        el("details", {
          id: "geometry-validation-details",
          class: "tech-disclosure",
          hidden: "true",
        }, [
          el("summary", {}, ["Model technical details"]),
          el("p", {
            id: "magnet-backing-tech-note",
            class: "help-text",
          }, ["Full-width 0.5 mm base-colored structural bridge (Z 2.5–3.0) across the entire tile; artwork begins at Z = 3.0."]),
          el("p", { id: "geometry-validation", class: "help-text mono-meta" }),
          el("div", { class: "button-stack", id: "geometry-debug-actions" }, [
            el("button", {
              type: "button",
              class: "button button-secondary",
              id: "btn-download-geometry-debug",
              disabled: "true",
              title: "Download a local JSON fixture that reproduces mesh generation (no image, no upload)",
            }, ["Download geometry debug case"]),
          ]),
        ]),
      ]),
    ]),

    el("div", { class: "panel-footer settings-footer stage-continue" }, [
      el("span", { class: "workflow-footer-status", hidden: "true" }),
    ]),
  ]);
}

/** @param {string} id @param {string} label */
function btn(id, label) {
  return el("button", { type: "button", class: "button", id }, [label]);
}

/**
 * @param {string} id
 * @param {string} label
 * @param {string} min
 * @param {string} max
 * @param {string} step
 * @param {string} value
 */
function fieldRange(id, label, min, max, step, value) {
  return el("div", { class: "field" }, [
    el("label", { class: "field-label", for: id }, [label]),
    el("input", {
      id,
      class: "input-range",
      type: "range",
      min,
      max,
      step,
      value,
    }),
    el("output", { id: `${id}-value`, class: "field-value", for: id }, [value]),
  ]);
}

/**
 * @param {string} id
 * @param {string} label
 * @param {string} value
 * @param {string} min
 * @param {string} max
 * @param {string} step
 */
function fieldNumber(id, label, value, min, max, step) {
  return el("div", { class: "field" }, [
    el("label", { class: "field-label", for: id }, [label]),
    el("input", {
      id,
      class: "input",
      type: "number",
      value,
      min,
      max,
      step,
    }),
  ]);
}

/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {Array<Node|string>} [children]
 */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    node.setAttribute(k, v);
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}
