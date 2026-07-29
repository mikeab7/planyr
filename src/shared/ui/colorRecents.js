/* Recently-used colors (NEW-4) — ONE shared most-recently-used list across the whole app.
 *
 * The list lives INSIDE the colour picker (a section of the popover the current-colour chip opens),
 * not permanently beside it in the panel, so a colour used a moment ago is one click away at the
 * moment you are choosing one.
 * Deliberately ONE list, not one per control: a color just used on a parcel outline is immediately
 * available on a markup, a callout, or an element fill — which is how a plan ends up internally
 * consistent instead of drifting a shade per surface.
 *
 * Persistence is `localStorage` (per browser), matching every other lightweight UI preference in
 * the app (`planarfit:measureMode`, `planyr:docreview:lastMode`, …). This is a scratch list of what
 * you just used, not a setting worth a round-trip; it is NOT the cross-machine default store that
 * Standards' "all projects" scope needs.
 *
 * Pure functions + a tiny subscription so every open picker updates the instant one records a
 * color. Unit tests: test/colorRecents.test.js.
 */

export const RECENTS_MAX = 10;
const KEY = "planyr:colorRecents:v1";

/** Coerce anything we store into the lowercase #rrggbb an <input type=color> round-trips, or null. */
export function normalizeHex(c) {
  if (typeof c !== "string") return null;
  const s = c.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return "#" + s.slice(1).split("").map((h) => h + h).join("");
  return null;
}

/** Pure MRU insert: newest first, de-duplicated (a re-used color moves up, never doubles), capped. */
export function mergeRecent(list, color, max = RECENTS_MAX) {
  const hex = normalizeHex(color);
  if (!hex) return Array.isArray(list) ? list.slice(0, max) : [];
  const rest = (Array.isArray(list) ? list : []).map(normalizeHex).filter((c) => c && c !== hex);
  return [hex, ...rest].slice(0, max);
}

/**
 * Normalize + de-duplicate a list of colours for rendering (the standard palette grid, or the
 * recents row). NOT padded: the recents section shows only colours actually used, and hides
 * itself when there are none — the default palette is its own row above it, so padding recents
 * out of the palette would only make the list lie about what you had used.
 */
export function uniqueHexes(list, max = RECENTS_MAX) {
  const out = [];
  const seen = new Set();
  for (const c of list || []) {
    const hex = normalizeHex(c);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
    if (out.length >= max) break;
  }
  return out;
}

/* ------------------------------------------------------------- persistence */

const hasLS = () => { try { return typeof localStorage !== "undefined" && !!localStorage; } catch { return false; } };

export function loadRecents() {
  if (!hasLS()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(normalizeHex).filter(Boolean).slice(0, RECENTS_MAX) : [];
  } catch { return []; } // a corrupt/absent entry is an empty list, never a crash on boot
}

export function saveRecents(list) {
  if (!hasLS()) return;
  // A full quota must never break the actual color change the user just made — recents are the
  // least important thing on the page, so a failed write is swallowed here on purpose.
  try { localStorage.setItem(KEY, JSON.stringify((list || []).slice(0, RECENTS_MAX))); } catch { /* quota / private mode */ }
}

/* ------------------------------------------------------ live shared state */

let cache = null;
const subs = new Set();

/** The current list (cached after the first read so a panel re-render doesn't hit storage). */
export function getRecents() {
  if (cache == null) cache = loadRecents();
  return cache;
}

/** Record a color as just-used. Returns the new list. No-op for an unparseable value. */
export function pushRecent(color) {
  const hex = normalizeHex(color);
  if (!hex) return getRecents();
  const next = mergeRecent(getRecents(), hex);
  if (next.length === cache?.length && next[0] === cache?.[0] && next.every((c, i) => c === cache[i])) return cache;
  cache = next;
  saveRecents(next);
  subs.forEach((fn) => { try { fn(next); } catch { /* a broken listener never blocks the others */ } });
  return next;
}

/** Subscribe to changes (every open picker's row stays in step). Returns an unsubscribe. */
export function subscribeRecents(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/* --------------------------------------------------- the picking SESSION (NEW-4 bug)
 *
 * The colour wheel picks LIVE — that is deliberate and stays. The consequence is that the
 * browser fires a change event for EVERY shade the cursor passes through, so recording each one
 * filled all ten slots with near-identical intermediates from a single drag. The list then
 * described where the cursor travelled, not what the plan actually uses.
 *
 * So a picking session records exactly ONE entry, at commit: `notePick` on every live value
 * (recorded nowhere yet — the object still recolors live, that is the caller's `apply`), and
 * `commitPick` at the session boundary (the wheel blurs, or the picker closes/unmounts), which
 * pushes the value it SETTLED on. Discrete paths — a swatch click — never open a session; they
 * call `pushRecent` straight, one entry per click, as before.
 */

let pendingPick = null;

/** The colour the open picking session is currently on. Applied live, NOT recorded yet. */
export function notePick(color) {
  const hex = normalizeHex(color);
  if (hex) pendingPick = hex;
  return hex;
}

/** End the session: record EXACTLY ONE entry — the colour it settled on. No-op if none. */
export function commitPick() {
  const hex = pendingPick;
  pendingPick = null;
  return hex ? pushRecent(hex) : getRecents();
}

/** The value a session would commit right now (test/debug introspection). */
export function pendingPickValue() { return pendingPick; }

/** Test-only: drop the in-memory cache so a suite can start from a known state. */
export function _resetRecentsCache() { cache = null; pendingPick = null; subs.clear(); }
