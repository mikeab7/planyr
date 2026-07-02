/* Per-module accent colors — the one source of truth for workspace theming
 * (tabs, logo chip, the assembling loader). Pure constants, no React, so both
 * the JSX chrome and pure helpers/tests can share them without pulling in a
 * component tree. */
export const MODULE_ACCENT = {
  "site-planner": "#1D9E75",
  "scheduler":    "#7F77DD",
  "doc-review":   "#EF9F27",
  "library":      "#0E7490",
};
