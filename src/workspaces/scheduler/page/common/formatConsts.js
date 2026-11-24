import { exposeToHarness } from "../harnessGlobals.js";

// Excel-style fill palette: 5 columns x 4 rows = 20 swatches. Top rows = pastel tints
// (read well on light grid rows + leave room for text); bottom rows = stronger fills
// (work well as Gantt-bar accents). Used by the right-click Format toolbar.
export const ROW_COLORS = [
  { color: '#fef3c7', label: 'Yellow tint'  },
  { color: '#ffedd5', label: 'Orange tint'  },
  { color: '#fee2e2', label: 'Red tint'     },
  { color: '#fce7f3', label: 'Pink tint'    },
  { color: '#f3e8ff', label: 'Purple tint'  },
  { color: '#fde68a', label: 'Yellow'       },
  { color: '#fed7aa', label: 'Orange'       },
  { color: '#fecaca', label: 'Red'          },
  { color: '#fbcfe8', label: 'Pink'         },
  { color: '#e9d5ff', label: 'Purple'       },
  { color: '#d9f99d', label: 'Lime'         },
  { color: '#bbf7d0', label: 'Green'        },
  { color: '#a5f3fc', label: 'Cyan'         },
  { color: '#bfdbfe', label: 'Blue'         },
  { color: '#c7d2fe', label: 'Indigo'       },
  { color: '#ecfccb', label: 'Lime tint'    },
  { color: '#d1fae5', label: 'Green tint'   },
  { color: '#cffafe', label: 'Cyan tint'    },
  { color: '#dbeafe', label: 'Blue tint'    },
  { color: '#e0e7ff', label: 'Indigo tint'  },
];
// isValidColor: rowColor is placed into CSS background via inline styles.
// Restrict to hex colors from the ROW_COLORS palette or null to prevent CSS injection.
const SAFE_COLOR_RE = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;
export const isValidColor = v => v == null || SAFE_COLOR_RE.test(v);
// B<PENDING> (NEW-2) — cell/row text-size steps for the format mini-toolbar's grow/shrink
// buttons and its type-in size box. Bounded so a runaway size can't blow out a fixed-height
// grid row (ROW_H floors at 20px, ceilings at 34px — see settings.rowHeight) or the Gantt bar
// labels; the cell itself clips with overflow:hidden regardless, this just keeps the picked
// values sane. Values chosen to bracket the grid's own default per-level sizes (11–13px).
export const FONT_SIZE_STEPS = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24];
export const FONT_SIZE_MIN = FONT_SIZE_STEPS[0], FONT_SIZE_MAX = FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1];
export const isValidFontSize = n => typeof n === "number" && Number.isFinite(n) && n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX;
export const stepFontSize = (cur, dir) => {
  const base = typeof cur === "number" ? cur : 12;
  if (dir > 0) { const next = FONT_SIZE_STEPS.find(v => v > base); return next != null ? next : FONT_SIZE_MAX; }
  const prev = FONT_SIZE_STEPS.filter(v => v < base);
  return prev.length ? prev[prev.length - 1] : FONT_SIZE_MIN;
};

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  ROW_COLORS: [() => ROW_COLORS],
  SAFE_COLOR_RE: [() => SAFE_COLOR_RE],
  isValidColor: [() => isValidColor],
  FONT_SIZE_STEPS: [() => FONT_SIZE_STEPS],
  FONT_SIZE_MIN: [() => FONT_SIZE_MIN],
  FONT_SIZE_MAX: [() => FONT_SIZE_MAX],
  isValidFontSize: [() => isValidFontSize],
  stepFontSize: [() => stepFontSize],
});
