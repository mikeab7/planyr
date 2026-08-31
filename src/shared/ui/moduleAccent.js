/* Per-module accent colors — the one source of truth for workspace theming
 * (tabs, logo chip, the assembling loader). Pure constants, no React, so both
 * the JSX chrome and pure helpers/tests can share them without pulling in a
 * component tree. */
export const MODULE_ACCENT = {
  "site-planner": "#1D9E75",
  "scheduler":    "#7F77DD",
  "doc-review":   "#EF9F27",
  "library":      "#0E7490",
  "notes":        "#B8418C",
  "model":        "#2B5FBF",
  // ⛔ NO "food" ENTRY (NEW-2) — this dictionary drives tab/loader theming for LISTED
  // workspaces; /food is an unlisted route and gets the generic loader fallback instead.
};
