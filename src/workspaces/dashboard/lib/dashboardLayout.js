/* dashboardLayout — pure model for the Dashboard's arrangeable card grid (B1213313).
 *
 * A layout is an ORDERED array of { key, size } — `key` names one of CARD_DEFS, `size` is
 * "normal" | "wide" (the one resize distinction this release ships: a card either takes its
 * natural column or spans two). Order in the array IS the on-screen order (row-major in the
 * grid), so reordering is just moving an array element — no x/y coordinates to keep in sync.
 *
 * Kept pure and dependency-free so the arrange/persist logic is unit-testable without a
 * browser or a network — Dashboard.jsx and dashboardPrefs.js are the only two things that
 * touch React/Supabase.
 */

export const SIZES = ["normal", "wide"];

// The full card catalog. `title` is the label used in the "Add card" row; the actual card
// UI (data fetch + render) lives in components/*.jsx, keyed the same way.
export const CARD_DEFS = {
  jumpBackIn:          { title: "Jump back in" },
  pipelineStatus:       { title: "Pipeline" },
  scheduleHealth:       { title: "Schedule health" },
  pursuitsByActivity:   { title: "Pursuits by activity" },
  compsSummary:         { title: "Comps" },
  goingQuiet:           { title: "Going quiet" },
};

export const CARD_KEYS = Object.keys(CARD_DEFS);

// NEW-2 — a first-run Dashboard must never be empty (a blank grid is a worse landing than the
// map it replaces). Every card in the catalog ships in the default layout; a user who wants a
// leaner view removes what they don't need in Customize mode, rather than building one up from
// nothing.
export const DEFAULT_LAYOUT = [
  { key: "jumpBackIn", size: "wide" },
  { key: "pipelineStatus", size: "normal" },
  { key: "scheduleHealth", size: "wide" },
  { key: "pursuitsByActivity", size: "wide" },
  { key: "compsSummary", size: "normal" },
  { key: "goingQuiet", size: "normal" },
];

function isPlainEntry(e) {
  return !!e && typeof e === "object" && typeof e.key === "string" && CARD_DEFS[e.key];
}

/** Validate a raw (possibly stored/round-tripped) layout: unknown keys dropped, duplicates
 * dropped (first occurrence wins), size normalized, and an empty/invalid result falls back to
 * DEFAULT_LAYOUT rather than ever rendering a blank grid. */
export function normalizeLayout(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const e of list) {
    if (!isPlainEntry(e) || seen.has(e.key)) continue;
    seen.add(e.key);
    out.push({ key: e.key, size: SIZES.includes(e.size) ? e.size : "normal" });
  }
  return out.length ? out : DEFAULT_LAYOUT.map((e) => ({ ...e }));
}

/** Which catalog cards are not currently in the layout — the "Add card" row's contents. */
export function availableToAdd(layout) {
  const present = new Set(layout.map((e) => e.key));
  return CARD_KEYS.filter((k) => !present.has(k));
}

export function addCard(layout, key) {
  if (!CARD_DEFS[key] || layout.some((e) => e.key === key)) return layout;
  return [...layout, { key, size: "normal" }];
}

export function removeCard(layout, key) {
  return layout.filter((e) => e.key !== key);
}

export function toggleCardSize(layout, key) {
  return layout.map((e) => (e.key === key ? { ...e, size: e.size === "wide" ? "normal" : "wide" } : e));
}

/** Move the card at `fromIndex` to `toIndex` (array reorder — drag-and-drop's pure half). Out-of-
 * range indices are a no-op rather than throwing, since a drop target can race a re-render. */
export function moveCard(layout, fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= layout.length || toIndex < 0 || toIndex >= layout.length) {
    return layout;
  }
  const next = layout.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
