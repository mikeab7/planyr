/* ⛔ ONE UNDO TOAST, AND IT NEVER LIES (owner pick "A", 2026-11-25).
 *
 * Before: every Site Planner action that offered Undo pushed its OWN toast whose button called the global
 * `undo` (one step back). Deleting Parcel 2 then Parcel 3 left two "Deleted … · Undo" toasts, and Undo on the
 * Parcel 2 toast brought back Parcel 3. Owner: "I like option A" — one banner that keeps count.
 *
 * The model (pure, unit-tested in test/undoToast.test.js):
 *   - There is at most ONE undo toast (dedupeKey UNDO_TOAST_KEY). A new undoable action REPLACES it.
 *   - The same kind of action again, straight after (same `mergeKey`, and the toast's actions are still the
 *     newest real steps: `history.stepsAreTop`), MERGES: the count goes up, the names are listed, and the
 *     button reverses ALL of them in one press ("Undo all 3" → undoN(3)).
 *   - Anything that makes the toast's actions no longer the newest steps (Ctrl+Z, another edit) WITHDRAWS it,
 *     so its button can never reverse something it does not name. The caller re-checks at press time too.
 *   - Other notices (sync conflicts, "this tab is out of date") are NOT undo toasts and never merge into it.
 */
export const UNDO_TOAST_KEY = "undo";
export const UNDO_TOAST_TTL_MS = 10000;
const NAMES_SHOWN = 4;

/* The words for a merged run. `entry`: { mergeKey, count, names, one, many } where `one(names)` is the text for a
 * single action and `many(count)` for a merged run ("Deleted 3 parcels"). Returns { text, detail, label }. */
export function undoToastWords(entry) {
  const steps = entry.frames ? entry.frames.length : 1;
  const names = entry.names || [];
  const text = steps > 1 && entry.many ? entry.many(entry.count, steps) : entry.text;
  let detail = "";
  if (steps > 1 && names.length > 1) {
    const shown = names.slice(0, NAMES_SHOWN).join(", ");
    detail = names.length > NAMES_SHOWN ? `${shown} and ${names.length - NAMES_SHOWN} more` : shown;
  }
  return { text, detail, label: steps > 1 ? `Undo all ${steps}` : "Undo" };
}

/* Merge decision. `prev` is the toast entry now showing (or null), `next` the new action's entry
 * { mergeKey, frame, count, names, text, many }. `isTop(frames)` answers history.stepsAreTop(frames, null)
 * for the stack as it is NOW (the new action's frame already pushed, its change not yet committed).
 * Returns the entry to show: a merged one, or `next` on its own. */
export function nextUndoEntry(prev, next, isTop) {
  const own = { ...next, frames: [next.frame], count: next.count || 1, names: next.names || [] };
  if (!prev || !next.mergeKey || prev.mergeKey !== next.mergeKey) return own;
  if (!prev.frames || prev.frames.includes(next.frame)) return own;
  const frames = [...prev.frames, next.frame];
  if (!isTop(frames)) return own;
  return { ...own, frames, count: (prev.count || prev.frames.length) + own.count, names: [...(prev.names || []), ...own.names] };
}
