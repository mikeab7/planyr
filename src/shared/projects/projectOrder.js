/* projectOrder — the ONE pure model for "the order Michael wants his projects in" on the Dashboard
 * (NEW-1, 2026-10-08, owner ask: "Eight South — I don't really want it at the top right now. I want
 * Grand Port or Goose Creek").
 *
 * WHAT DECIDED THE ORDER BEFORE: the Pursuits card sorted alphabetically (pursuitsList.js,
 * B1342848), so "Eight South" sat above "Goose Creek" and "Grand Port" purely because E < G. That
 * alphabetical order stays as the FALLBACK ("today's order"); this module lays his chosen order on
 * top of it.
 *
 * SHAPE — `{ ids: string[], at: epochMs }`, one per user, stored in `profiles.prefs`
 * (dashboardProjectOrderPrefs.js). `ids` are project GROUP ids (a project's group_id — stable
 * across rename/open/edit, so none of those can reshuffle anything). `at` is when the order was
 * last saved; it is how a NEW project (created after that moment, not in `ids`) is told apart from
 * an OLD project the saved list simply doesn't mention.
 *
 *   saved order (in his order)  ←  positioned
 *   created after `at`, unlisted ← NEW   → land at the TOP, newest first ("just created = what he's
 *                                          working on"); he can move them after
 *   created before `at`, unlisted ← LEGACY → keep today's order, BENEATH everything positioned
 *
 * A stale id (project deleted/archived/unshared) is simply not found and skipped — it can never
 * blank or break the list — and the next save rewrites the list from what exists.
 *
 * Pure and dependency-free so it's unit-testable and so every surface that lists projects in
 * dashboard order calls this, never its own sort (ALL SHARED DATA HAS ONE SOURCE OF TRUTH).
 */

// An account that has never positioned anything has no `at`. New projects should still land on
// top for it, so "new" is measured from this ship date: anything created after it and not listed
// goes first; anything older keeps today's order, undisturbed (no surprise reshuffle on first load).
export const ORDER_EPOCH_MS = Date.parse("2026-10-08T12:00:00Z");

const toMs = (t) => {
  if (t == null) return null;
  const n = typeof t === "number" ? t : Date.parse(t);
  return Number.isFinite(n) ? n : null;
};

/** Validate a raw (persisted / round-tripped) order. Returns `{ ids, at }` or null when there is
 * nothing usable. Non-string and duplicate ids are dropped (first occurrence wins). */
export function normalizeProjectOrder(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.ids)) return null;
  const seen = new Set();
  const ids = [];
  for (const id of raw.ids) {
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const at = toMs(raw.at);
  return { ids, at: at == null ? ORDER_EPOCH_MS : at };
}

/** `projects` — items with `groupId` (and optionally `createdAt`), already in TODAY'S order (the
 * caller's fallback sort). `saved` — a normalized order or null. Returns a NEW array in his order. */
export function orderProjects(projects, saved) {
  const list = (projects || []).filter((p) => p && p.groupId != null);
  const order = normalizeProjectOrder(saved) || { ids: [], at: ORDER_EPOCH_MS };
  const byId = new Map(list.map((p) => [p.groupId, p]));
  const placed = new Set();
  const positioned = [];
  for (const id of order.ids) {
    const p = byId.get(id);
    if (!p || placed.has(id)) continue; // stale id — skipped, never fatal
    placed.add(id);
    positioned.push(p);
  }
  const fresh = [];
  const legacy = [];
  for (const p of list) {
    if (placed.has(p.groupId)) continue;
    const created = toMs(p.createdAt);
    (created != null && created > order.at ? fresh : legacy).push(p);
  }
  fresh.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt)); // newest first
  return [...fresh, ...positioned, ...legacy];
}

/** The full ordered id list a save should write: every project that exists, in display order. */
export function orderedIds(projects, saved) {
  return orderProjects(projects, saved).map((p) => p.groupId);
}

/** Move `id` within `fullIds` (the complete ordered id list) and return the NEW complete list.
 *  - `{ to: "top" }` / `{ to: "bottom" }` — the whole list's first / last slot.
 *  - `{ index: n }` — position n among the VISIBLE ids (`visibleIds` is the subset one card shows,
 *    in display order). Only the visible ids' own slots are rearranged, so projects that card
 *    doesn't show keep exactly the place they had.
 * An unknown id, or a no-op, returns the list unchanged (same contents). */
export function moveProject(fullIds, visibleIds, id, dest) {
  const full = [...(fullIds || [])];
  if (!full.includes(id)) return full;
  if (dest && dest.to === "top") return [id, ...full.filter((x) => x !== id)];
  if (dest && dest.to === "bottom") return [...full.filter((x) => x !== id), id];
  if (!dest || !Number.isInteger(dest.index)) return full;
  const visible = (visibleIds || []).filter((x) => full.includes(x));
  if (!visible.includes(id)) return full;
  const rest = visible.filter((x) => x !== id);
  const at = Math.max(0, Math.min(dest.index, rest.length));
  const nextVisible = [...rest.slice(0, at), id, ...rest.slice(at)];
  const vis = new Set(visible);
  let k = 0;
  return full.map((x) => (vis.has(x) ? nextVisible[k++] : x));
}

/** Build the order to persist after a move: the full list plus a fresh `at`. */
export function buildSavedOrder(ids, now = Date.now()) {
  return { ids: [...ids], at: now };
}

/** TODAY'S order — the fallback beneath his saved order: alphabetical by name. ONE implementation for
 * every surface that lists projects in his order (the Dashboard's Pursuits card, the Task Report). */
export function byNameToday(projects) {
  return [...(projects || [])].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

/** The whole move, start to finish, for ANY surface: the order to persist after moving `id` to
 * `dest`, or null when nothing would change. `projects` is every project that exists (`{groupId,
 * name, createdAt}`), `saved` the loaded order, `visibleIds` the ids that surface shows, in its
 * display order. The Dashboard and the Task Report both call this — never a second move path. */
export function planProjectMove(projects, saved, id, dest, visibleIds, now = Date.now()) {
  const full = orderedIds(byNameToday(projects), saved);
  const next = moveProject(full, visibleIds, id, dest);
  if (next.length === full.length && next.every((x, i) => x === full[i])) return null;
  return buildSavedOrder(next, now);
}
