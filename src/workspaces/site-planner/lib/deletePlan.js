/* Delete resolution (NEW-1) — the ONE pure decision behind EVERY delete entry point in the planner.
 *
 * WHY THIS MODULE EXISTS. "Delete does nothing" has come back repeatedly, and the reason it kept
 * coming back is that it was never one bug: `deleteSel` in SitePlanner.jsx opened with
 * `if (!sel) return;` — a silent no-op with no message, no telemetry, and no way to tell WHICH of
 * its sixteen call sites had just died. Several ordinary states reach that return:
 *
 *   • a MULTI-SELECTION OF EXACTLY ONE. The old code branched on `multi.length > 1` and otherwise
 *     fell through to `sel`, so a one-item multi with no matching `sel` deleted nothing.
 *   • a STALE `multi` LEFT BEHIND BY A SUCCESSFUL DELETE. The single-selection branch cleared `sel`
 *     but not `multi`, so the next Delete keypress saw `multi.length === 1`, `sel === null` and
 *     returned silently — the Delete key stayed dead until an unrelated click reset it.
 *   • a STALE `multi` LEFT BEHIND BY UNDO/REDO. `applySnapshot` cleared `sel` but not `multi`.
 *   • a SELECTION POINTING AT SOMETHING THAT NO LONGER EXISTS. The old branches filtered by id, so a
 *     dead id removed nothing, tombstoned nothing (`tombstone([])` short-circuits), and reported
 *     success by saying nothing at all.
 *
 * THE CONTRACT THIS MODULE ENFORCES:
 *   1. DELETE IS UNCONDITIONAL. Anything the user can see as selected is deletable — including a
 *      PINNED/locked item. Pinning guards against an accidental drag, never against a deliberate
 *      Delete. `lockedCount` rides on the plan so telemetry can still see it happened.
 *   2. SELECTION IS THE UNION of `multi` and `sel`, at any count. There is no count-dependent
 *      branch, so a one-item marquee behaves exactly like a five-item one.
 *   3. SILENCE IS IMPOSSIBLE. Every call returns an `outcome` and, when nothing was removed, a
 *      plain-English `message` the caller must show. There is no path that returns "nothing
 *      happened" without saying why.
 *
 * Pure: no React, no DOM, no I/O. The caller applies `remove` to its collections and shows
 * `message`. Unit-tested in test/deletePlan.test.js.
 */

const arr = (x) => (Array.isArray(x) ? x : []);

/* Every delete entry point in the planner, by id. These strings are what lands in telemetry
 * (`entry` on the delete-attempt / delete-outcome events), so the next "delete is broken" report
 * is one query instead of a guessing game. Keep this list and the call sites in step. */
export const DELETE_ENTRIES = [
  "key:delete",        // window keydown — Delete / Backspace
  "cut",               // Ctrl/⌘+X (copy, then delete)
  "panel:element",     // Properties → "Delete element"
  "panel:pond",        // Pond inspector header → "Delete"
  "panel:parcel",      // Parcel section → "Delete parcel"
  "panel:easement",    // Easement section → "Delete"
  "panel:markup",      // Markup section → "Delete"
  "panel:callout",     // Callout / text-box section → "Delete"
  "panel:measure",     // Measurement section → "Delete"
  "menu:element",      // element right-click menu → "Delete"
  "menu:measure",      // canvas right-click on a measurement → "Delete measurement"
  "menu:callout",      // canvas right-click on a callout → "Delete callout"
  "menu:markup",       // canvas right-click on a markup → "Delete markup/easement/deed"
  "menu:parcel",       // parcel right-click menu → "Delete parcel"
];

/* Ref kind ↔ site-model collection. An unknown kind resolves to NOTHING — the old code's
 * trailing `else` treated every unrecognised kind as a parcel, which silently filtered the
 * parcel list on a ref it never understood. */
export const REF_FIELD = {
  el: "els",
  markup: "markups",
  measure: "measures",
  callout: "callouts",
  parcel: "parcels",
};

/* Human word for one ref, for the toast and the telemetry label. */
function wordFor(kind, item) {
  if (kind === "el") return (item && typeof item.type === "string" && item.type) || "element";
  if (kind === "measure") return "measurement";
  if (kind === "callout") return item && item.noLeader ? "text box" : "callout";
  return kind; // markup | parcel
}

/* Resolve one ref to the live item it names, or null.
 * A measurement arrives in TWO forms — index-keyed (`{kind:"measure", i}`, what `sel` carries) or
 * id-keyed (`{kind:"measure", id}`, what `multi` carries). Both resolve here, so the two forms can
 * never disagree about what is selected. */
export function resolveRef(ref, state) {
  if (!ref || typeof ref.kind !== "string") return null;
  const field = REF_FIELD[ref.kind];
  if (!field) return null;
  const list = arr(state && state[field]);
  if (ref.kind === "measure") {
    if (typeof ref.id === "string") {
      const i = list.findIndex((m) => m && m.id === ref.id);
      return i < 0 ? null : { kind: "measure", id: ref.id, index: i, item: list[i] };
    }
    if (Number.isInteger(ref.i) && ref.i >= 0 && ref.i < list.length) {
      const m = list[ref.i];
      return { kind: "measure", id: (m && m.id) || null, index: ref.i, item: m };
    }
    return null;
  }
  if (typeof ref.id !== "string") return null;
  const item = list.find((x) => x && x.id === ref.id);
  return item ? { kind: ref.kind, id: ref.id, index: null, item } : null;
}

/* Dedupe refs by their resolved identity. `sel` is normally also a member of `multi`, and a
 * measurement can appear once by index and once by id. */
const refKey = (r) => `${r.kind}|${r.id != null ? r.id : `#${r.index}`}`;

/* The BONDED SUBTREE of an element: the element itself plus everything `attachedTo` it. A building
 * therefore takes its truck court, trailer parking, sidewalks and dock bump-outs with it (and every
 * one of those ids is tombstoned — TOMBSTONE-DELETES). Deliberately DOWNWARD only: selecting a
 * truck court deletes the truck court, never the building it hangs off. The old code disagreed with
 * itself here — the single-selection branch went downward, the multi branch resolved to the ROOT
 * first, so shift-clicking a truck court silently took the whole building. */
export function bondedSubtree(els, id) {
  const out = [];
  for (const e of arr(els)) if (e && (e.id === id || e.attachedTo === id)) out.push(e);
  return out;
}

/* Plan a delete.
 *
 *   sel      — the live single selection ref (or null)
 *   multi    — the live multi-selection refs (or [])
 *   explicit — a menu's just-clicked ref; when present it is the ONLY target (it does not wait for
 *              a setSel() to land, which is the stale-selection class the refs were meant to kill)
 *   state    — the live site model ({ els, markups, measures, callouts, parcels })
 *   entry    — which entry point asked (see DELETE_ENTRIES); carried through for telemetry
 *
 * Returns:
 *   { outcome, entry, refs, stale, remove, tombstones, count, lockedCount, label, message }
 *   outcome: "removed" — `remove` is non-empty and must be applied
 *            "empty"   — nothing was selected
 *            "stale"   — everything selected has already gone
 * `message` is set on every non-"removed" outcome and MUST be shown to the user.
 */
export function planDelete({ sel, multi, explicit, state, entry } = {}) {
  const st = state || {};
  const base = {
    entry: entry || "unknown",
    refs: [], stale: [], count: 0, lockedCount: 0, label: "",
    remove: { els: [], markups: [], measures: [], measureIdx: [], callouts: [], parcels: [] },
    tombstones: [],
  };

  const wanted = explicit && explicit.kind
    ? [explicit]
    : [...arr(multi), ...(sel ? [sel] : [])];

  if (!wanted.length) {
    return {
      ...base,
      outcome: "empty",
      message: "Nothing is selected — click the item on the plan first, then press Delete.",
    };
  }

  const seen = new Set();
  const resolved = [];
  const stale = [];
  for (const ref of wanted) {
    const r = resolveRef(ref, st);
    if (!r) { stale.push({ kind: (ref && ref.kind) || "unknown", id: (ref && ref.id) || null }); continue; }
    const k = refKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    resolved.push(r);
  }

  if (!resolved.length) {
    return {
      ...base,
      outcome: "stale",
      stale,
      // The selection pointed at something that is no longer on the plan (an undo, a delete from
      // another tab, a reload that re-seeded from the server). Saying so beats saying nothing.
      message: "That's already gone — nothing left to delete. Click the item you want, then press Delete.",
    };
  }

  const els = new Set(), markups = new Set(), callouts = new Set(), parcels = new Set();
  const measureIds = new Set(), measureIdx = new Set();
  let lockedCount = 0;

  for (const r of resolved) {
    if (r.item && r.item.locked) lockedCount += 1;
    if (r.kind === "el") {
      for (const m of bondedSubtree(st.els, r.id)) els.add(m.id);
    } else if (r.kind === "markup") {
      markups.add(r.id);
    } else if (r.kind === "callout") {
      callouts.add(r.id);
    } else if (r.kind === "parcel") {
      parcels.add(r.id);
    } else if (r.kind === "measure") {
      // Prefer the stable id (a measure counts in contentCount, so a delete without a tombstone
      // resurrects on merge — B556). Legacy id-less measures fall back to their index.
      if (r.id) measureIds.add(r.id); else measureIdx.add(r.index);
    }
  }

  const remove = {
    els: [...els],
    markups: [...markups],
    measures: [...measureIds],
    measureIdx: [...measureIdx],
    callouts: [...callouts],
    parcels: [...parcels],
  };
  // Every removed id gets a tombstone — including each bonded child, so a cloud / cross-tab union
  // merge can't put half an assembly back (TOMBSTONE-DELETES).
  const tombstones = [...remove.els, ...remove.markups, ...remove.measures, ...remove.callouts, ...remove.parcels];
  const count = resolved.length;
  const label = count === 1
    ? wordFor(resolved[0].kind, resolved[0].item)
    : `${count} items`;

  return { ...base, outcome: "removed", refs: resolved, stale, remove, tombstones, count, lockedCount, label, message: "" };
}

/* Should the "your keystroke went into the box you're typing in" hint fire?
 *
 * The keyboard handler deliberately ignores shortcuts while a text/number field has focus — you
 * must be able to type. But that guard made Delete a dead key with no explanation while an element
 * sat visibly selected behind the panel (edit a building's width, then press Delete → nothing).
 * So: explain it, but only where it can't become noise —
 *   • the Delete key only. Backspace is the natural editing key inside a field; hinting on it would
 *     fire on every corrected digit.
 *   • only when something is actually selected (otherwise Delete wasn't going to do anything anyway).
 *   • once per focused field, not once per keypress.
 */
export function shouldHintTypingGuard({ key, hasSelection, fieldKey, lastHintedField } = {}) {
  if (key !== "Delete") return false;
  if (!hasSelection) return false;
  if (!fieldKey) return false;
  return fieldKey !== lastHintedField;
}

export const TYPING_GUARD_HINT =
  "Delete went to the box you're typing in. Click the plan, then press Delete.";
