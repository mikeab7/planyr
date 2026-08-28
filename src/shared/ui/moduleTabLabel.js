/* Per-module NAV TAB LABEL — the one source of truth for what the Row-2 module tabs say
 * (AppHeader.jsx) and for the browser tab title (app/pageTitle.js), so the two can never
 * drift apart. Same shape/placement as the sibling `moduleAccent.js`. Pure constants, no
 * React, so a pure title function can import it without pulling in a component tree.
 *
 * Deliberately excludes "food" — Food has no nav tab (NEW-2 to B568400; enforced by
 * test/foodModule.test.js) — and there is no "admin" key, because /admin is not a workspace
 * (route.js's isAdminRoute reads the raw hash directly, never route.module). */
export const MODULE_TAB_LABEL = {
  "site-planner": "Site",
  "scheduler":    "Schedule",
  "doc-review":   "Review",
  "library":      "Library",
  "notes":        "Notes",
};
