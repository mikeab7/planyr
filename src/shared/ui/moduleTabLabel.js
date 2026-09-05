/* Per-module NAV TAB LABEL — the one source of truth for what the Row-2 module tabs say
 * (AppHeader.jsx) and for the browser tab title (app/pageTitle.js), so the two can never
 * drift apart. Same shape/placement as the sibling `moduleAccent.js`. Pure constants, no
 * React, so a pure title function can import it without pulling in a component tree.
 *
 * Deliberately excludes "food" — Food has no nav tab (NEW-2 to B568400; enforced by
 * test/foodModule.test.js) — and there is no "admin" key, because /admin is not a workspace
 * (route.js's isAdminRoute reads the raw hash directly, never route.module). */
export const MODULE_TAB_LABEL = {
  // B1196304 (NEW-1) — the dashboard has no nav tab (it's never in Shell's WORKSPACES registry,
  // so this key is never read to render a tab), but pageTitle.js reads the SAME table, and
  // without an entry here the browser tab title falls back to the bare brand string instead of
  // naming the page you're actually on.
  "dashboard":    "Dashboard",
  "site-planner": "Site",
  "scheduler":    "Schedule",
  "doc-review":   "Review",
  "library":      "Library",
  "notes":        "Notes",
  // B1166768 — user-facing name is "Spreadsheet", not "Model" (the internal workspace id,
  // route.js's MODULE_BY_SLUG legacy alias, and every file/state-key under
  // src/workspaces/model/ all deliberately keep the old name — see that rename's own note in
  // route.js). Never re-introduce a domain word here (no "Pro Forma", "Underwriting", …) — this
  // container is used by GCs and engineers too, not just developers/finance.
  "model":        "Spreadsheet",
};
