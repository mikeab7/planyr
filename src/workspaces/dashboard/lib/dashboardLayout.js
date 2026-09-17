/* dashboardLayout — pure model for the Dashboard's arrangeable card grid (B1213313, NEW-1
 * arrangeable-grid rework — the free-form drag/resize/add/remove/reset grid react-grid-layout
 * renders in Dashboard.jsx).
 *
 * A layout is an array of { key, x, y, w, h } — a react-grid-layout-shaped position/size per
 * card, in GRID_COLS-wide grid units. `key` names one of CARD_DEFS; x/y/w/h are the same units
 * react-grid-layout's own onLayoutChange reports, so Dashboard.jsx can round-trip a change with
 * no translation. Array ORDER carries no meaning any more (x/y decide placement) — the narrow/
 * single-column view derives its own top-to-bottom order by sorting on (y, x) at render time.
 *
 * Kept pure and dependency-free so the arrange/persist logic is unit-testable without a browser,
 * a network, or react-grid-layout itself — Dashboard.jsx and dashboardPrefs.js are the only two
 * things that touch React/Supabase/the grid library.
 */

export const GRID_COLS = 12;

// The full card catalog. `title` is the label used in the "Add card" picker; `defaultW`/
// `defaultH` seed a first-run layout; `minW`/`minH` are the floor react-grid-layout enforces
// while resizing, so a card can never be crushed to unreadable. The actual card UI (data fetch +
// render) lives in components/*.jsx, keyed the same way. Sizes are deliberately code, not data —
// adding a new card type here never requires migrating anyone's saved layout (a saved layout
// that doesn't mention it just doesn't place it; see normalizeLayout).
export const CARD_DEFS = {
  jumpBackIn:     { title: "Jump back in",    defaultW: 8, defaultH: 4, minW: 3, minH: 3 },
  // NEW-1 (2026-09-08) — the one picture card among six text/number ones (see
  // components/RecentPlansCard.jsx). minW/minH keep it big enough for a 2x2 grid of
  // recognizable thumbnails before recentPlansLayout.js drops it to two.
  recentPlans:    { title: "Recent plans",    defaultW: 6, defaultH: 8, minW: 4, minH: 5 },
  pipelineStatus: { title: "Pipeline",        defaultW: 4, defaultH: 4, minW: 3, minH: 3 },
  // B1161792/B1161793 (NEW-1/NEW-2, Direction C) — the first two real content cards, replacing
  // the placeholder "Pursuits by activity" card (directly superseded by the richer sortable
  // "pursuitsTable" below) with two data-backed cards the owner reviewed and approved in chat.
  needsAttention: { title: "Needs attention", defaultW: 8, defaultH: 9, minW: 4, minH: 5 },
  pursuitsTable:  { title: "Pursuits",        defaultW: 8, defaultH: 9, minW: 5, minH: 5 },
  scheduleHealth: { title: "Schedule health", defaultW: 8, defaultH: 7, minW: 3, minH: 4 },
  // NEW-COMPS-CARD — taller/wider than the old bare-count card: a headline address, a rate, chips,
  // a spec line and a footer scale need real room. The KEY stays `compsSummary` (never renamed) so
  // every account's already-saved layout keeps placing this card without a migration.
  compsSummary:   { title: "Comps",           defaultW: 4, defaultH: 9, minW: 3, minH: 7 },
  goingQuiet:     { title: "Going quiet",     defaultW: 4, defaultH: 6, minW: 3, minH: 4 },
  // B1366384 (NEW-1) — one merged feed replacing the "reconstruct it from four separate cards"
  // problem; the largest card on the board, sized accordingly.
  sinceLastHere:  { title: "Since you were last here", defaultW: 12, defaultH: 11, minW: 5, minH: 5 },
  // NEW-1 (Locations map card, owner chat block 2026-09-08) — a real interactive map needs real
  // room to be legible; minW/minH keep it from being crushed into an unreadable strip.
  locationsMap:   { title: "Locations",       defaultW: 8, defaultH: 9, minW: 5, minH: 6 },
};

export const CARD_KEYS = Object.keys(CARD_DEFS);

// NEW-1 (2026-09-17, owner ask — "jump back in should be the last couple projects I was working
// on, and I should be able to increase the amount it shows") — how many recent projects the
// Jump-back-in card lists, a per-user preference persisted the same way as the rest of the
// layout (see dashboardPrefs.js's `dashboardJumpBackInCount`). 3 reads as "a couple plus a
// little headroom" without crowding the card's own "Last document" row at its default width (8
// of 12 grid columns) — and the card sizes to its own content (DashboardCard's `sizeToContent`),
// so a higher count grows the card rather than overflowing a fixed box. The ceiling (6) keeps a
// maxed-out card from turning into an unbounded list; MAX rows still scroll inside the card's own
// tile once they exceed its reserved height, same as any other card.
export const JUMP_BACK_IN_COUNT_DEFAULT = 3;
export const JUMP_BACK_IN_COUNT_MIN = 1;
export const JUMP_BACK_IN_COUNT_MAX = 6;

/** Normalize a raw persisted jump-back-in count: `null`/`undefined` (never saved — the bootstrap
 * case for every account before this shipped, same convention as normalizeDismissed's own
 * bootstrap) or any other non-finite value falls back to the default; any real number clamps
 * into [MIN, MAX] — never zero, never unbounded. `null`/`undefined` is checked explicitly rather
 * than left to `Number(raw)` because `Number(null) === 0`, which is finite and would otherwise
 * clamp a "never set" value down to MIN instead of the default. */
export function normalizeJumpBackInCount(raw) {
  if (raw === null || raw === undefined) return JUMP_BACK_IN_COUNT_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return JUMP_BACK_IN_COUNT_DEFAULT;
  return clamp(Math.round(n), JUMP_BACK_IN_COUNT_MIN, JUMP_BACK_IN_COUNT_MAX);
}

// The order a first-run (or reset) Dashboard packs its cards in — row-major, wrapping at
// GRID_COLS, each card's own defaultW/defaultH. Every catalog card ships by default (NEW-2 — a
// first-run Dashboard must never be empty); a user who wants a leaner view removes what they
// don't need in Customize mode, rather than building one up from nothing.
export const DEFAULT_ORDER = [
  "sinceLastHere", "jumpBackIn", "recentPlans", "pipelineStatus", "locationsMap", "needsAttention", "pursuitsTable",
  "scheduleHealth", "compsSummary", "goingQuiet",
];

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/** Row-major pack: place each key in `order` left-to-right at its own defaultW/defaultH,
 * wrapping to a new row when it wouldn't fit. Deterministic and pure — used both to derive
 * DEFAULT_LAYOUT and to migrate a pre-grid ordered layout (see normalizeLayout). */
function packOrder(order) {
  let x = 0, y = 0, rowH = 0;
  const out = [];
  for (const key of order) {
    const def = CARD_DEFS[key];
    if (!def) continue;
    const w = Math.min(def.defaultW, GRID_COLS);
    if (x + w > GRID_COLS) { x = 0; y += rowH; rowH = 0; }
    out.push({ key, x, y, w, h: def.defaultH });
    x += w;
    rowH = Math.max(rowH, def.defaultH);
  }
  return out;
}

export const DEFAULT_LAYOUT = packOrder(DEFAULT_ORDER);

/** The default arrangement, as a fresh copy — what "Reset layout" restores. */
export function resetLayout() {
  return DEFAULT_LAYOUT.map((e) => ({ ...e }));
}

function isKeyedEntry(e) {
  return !!e && typeof e === "object" && typeof e.key === "string" && !!CARD_DEFS[e.key];
}
function isGridEntry(e) {
  return isKeyedEntry(e) && Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.w) && Number.isFinite(e.h);
}

/** Validate a raw (possibly stored/round-tripped) layout: unknown keys dropped, duplicates
 * dropped (first occurrence wins), positions/sizes clamped to sane bounds (respecting each
 * card's own minW/minH), and an empty/invalid result falls back to DEFAULT_LAYOUT rather than
 * ever rendering a blank grid.
 *
 * Also migrates the PRE-GRID saved shape (`{ key, size: "normal"|"wide" }`, ordered array —
 * B1213313's original release) into the grid shape: an old-format save has no numeric x/y/w/h
 * on any of its entries, so the whole array is treated as an ORDER and re-packed with
 * packOrder(), the same layout a first-run Dashboard would get for that same card order. */
export function normalizeLayout(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const keyed = list.filter(isKeyedEntry);
  if (!keyed.length) return resetLayout();

  const isGridShape = keyed.some((e) => Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.w) && Number.isFinite(e.h));
  if (!isGridShape) {
    const seen = new Set();
    const order = [];
    for (const e of keyed) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      order.push(e.key);
    }
    return packOrder(order);
  }

  const seen = new Set();
  const out = [];
  for (const e of keyed) {
    if (seen.has(e.key) || !isGridEntry(e)) continue;
    seen.add(e.key);
    const def = CARD_DEFS[e.key];
    const w = clamp(Math.round(e.w), def.minW, GRID_COLS);
    const h = Math.max(Math.round(e.h), def.minH);
    const x = clamp(Math.round(e.x), 0, GRID_COLS - w);
    const y = Math.max(Math.round(e.y), 0);
    out.push({ key: e.key, x, y, w, h });
  }
  return out.length ? out : resetLayout();
}

/** Which catalog cards are not currently in the layout — the "Add card" picker's contents. */
export function availableToAdd(layout) {
  const present = new Set(layout.map((e) => e.key));
  return CARD_KEYS.filter((k) => !present.has(k));
}

/** Add a catalog card back at its default size, appended below whatever is already placed. A
 * removed card re-enters this way, never destroyed (its saved size isn't kept — it gets a fresh
 * default, same as a first-time add). No-op for an already-present or unknown key. */
export function addCard(layout, key) {
  const def = CARD_DEFS[key];
  if (!def || layout.some((e) => e.key === key)) return layout;
  const y = layout.reduce((m, e) => Math.max(m, e.y + e.h), 0);
  return [...layout, { key, x: 0, y, w: def.defaultW, h: def.defaultH }];
}

/** Remove a card from the grid. It goes back into the "Add card" picker (availableToAdd), not
 * destroyed — removing is just leaving it out of this array. */
export function removeCard(layout, key) {
  return layout.filter((e) => e.key !== key);
}

// ── Catalog reconciliation (B1422496) — a newly shipped card reaches an already-saved layout ──
//
// Before this, a saved layout was purely a list of what the user placed. A catalog card added
// after that save simply never appeared anywhere but the "Add a card" picker — indistinguishable
// from a card the user had deliberately removed, so nothing here could safely re-add it. Michael
// had to hand-add four cards through the picker after they'd already shipped and deployed; the
// same silent miss will repeat for every future card unless something tells "never reached this
// layout" apart from "removed on purpose."
//
// The fix: every account carries a `dismissed` list (persisted alongside the layout — see
// dashboardPrefs.js's `dashboardDismissedCards`) naming exactly the catalog cards it has
// deliberately excluded. A catalog card that is neither currently placed NOR in `dismissed` is
// "new" and gets appended automatically, in DEFAULT_ORDER, below whatever's already on the grid
// — existing cards' own x/y/w/h are never touched. A card in `dismissed` stays out even though
// it's just as absent from the layout; it's still reachable any time from the "Add a card"
// picker (availableToAdd doesn't consult `dismissed` — removal is reversible, never destructive).
//
// Bootstrap (normalizeDismissed below): an account saved before this shipped has no `dismissed`
// list at all. Defaulting that to "empty" would treat every already-missing catalog card as
// brand new and auto-resurrect anything that account ever removed — exactly the outcome rule 3
// forbids, and there is no way to tell, from the layout alone, which historical absence was which.
// So the bootstrap default is the opposite: every catalog card already missing at that moment is
// treated as already-decided (silently seeded into `dismissed`), so a legacy layout is left
// exactly as it was the first time this runs. From that point on `dismissed` is a real, persisted
// list, so only cards added to the catalog AFTER this shipped are new to that account — and stay
// new to every account, indefinitely, the same way, going forward.

/** Catalog cards this layout has never been reconciled against: not currently placed, and not
 * recorded as deliberately removed. DEFAULT_ORDER for a deterministic, sensible append order. */
export function newCatalogCards(layout, dismissed) {
  const present = new Set((Array.isArray(layout) ? layout : []).map((e) => e.key));
  const removed = new Set(Array.isArray(dismissed) ? dismissed : []);
  return DEFAULT_ORDER.filter((k) => !present.has(k) && !removed.has(k));
}

/** Append every not-yet-decided catalog card (see newCatalogCards) below what's already placed,
 * at its own default size, via the same addCard used for a manual "Add a card" click — so an
 * auto-reconciled card behaves identically to one the user added themselves. Existing entries are
 * never reordered or resized. No-op (same array reference) when there's nothing new. */
export function appendNewCatalogCards(layout, dismissed) {
  const toAdd = newCatalogCards(layout, dismissed);
  return toAdd.length ? toAdd.reduce((l, key) => addCard(l, key), layout) : layout;
}

/** Normalize a raw persisted `dismissed` list. `undefined`/`null` means "never recorded" — the
 * bootstrap case for every account saved before this reconciliation existed — see the block
 * comment above for why that defaults to "every catalog card currently missing," not to empty.
 * An explicitly-saved list (even `[]`) is used as-is: unknown/malformed entries dropped, deduped. */
export function normalizeDismissed(raw, layout) {
  if (raw === undefined || raw === null) {
    const present = new Set((Array.isArray(layout) ? layout : []).map((e) => e.key));
    return CARD_KEYS.filter((k) => !present.has(k));
  }
  const list = Array.isArray(raw) ? raw : [];
  return [...new Set(list.filter((k) => typeof k === "string" && !!CARD_DEFS[k]))];
}

/** Record a card as deliberately removed — idempotent. Called wherever removeCard is. */
export function dismissCard(dismissed, key) {
  const list = Array.isArray(dismissed) ? dismissed : [];
  return list.includes(key) ? list : [...list, key];
}

/** Clear a card's dismissal — called wherever addCard is, so manually re-adding a dismissed card
 * (from the picker) makes a later removal a fresh, freely-reachable decision again rather than
 * silently reusing the stale record. */
export function undismissCard(dismissed, key) {
  const list = Array.isArray(dismissed) ? dismissed : [];
  return list.filter((k) => k !== key);
}

/** Fold react-grid-layout's onLayoutChange payload (an array of { i, x, y, w, h }, `i` matching
 * our `key`) back into our own layout array — the pure half of drag-reorder and corner-resize.
 * Entries react-grid-layout doesn't mention (it always echoes every item, but a defensive fold
 * keeps this correct even if it doesn't) pass through unchanged; array order is preserved since
 * it carries no meaning. */
export function applyGridChange(layout, rglItems) {
  const rglByKey = new Map((Array.isArray(rglItems) ? rglItems : []).map((it) => [it.i, it]));
  return layout.map((e) => {
    const r = rglByKey.get(e.key);
    if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.w) || !Number.isFinite(r.h)) return e;
    return { key: e.key, x: r.x, y: r.y, w: r.w, h: r.h };
  });
}

/** The narrow/single-column view's reading order: top-to-bottom, left-to-right by the grid
 * position the user actually arranged — never the array's own storage order (see
 * applyGridChange's note: order isn't meaningful once x/y decide placement). */
export function narrowOrder(layout) {
  return [...layout].sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

/** react-grid-layout's own layout prop shape for one entry: { i, x, y, w, h, minW, minH }. */
export function toRglItem(entry) {
  const def = CARD_DEFS[entry.key];
  return { i: entry.key, x: entry.x, y: entry.y, w: entry.w, h: entry.h, minW: def?.minW ?? 1, minH: def?.minH ?? 1 };
}
