/* The B673 conflict policy matrix as a PURE mapping: elementSync event → toast spec (or null).
 * Whole-element granularity, last-write-wins, no field merging — the matrix only decides WHO gets
 * TOLD WHAT, and which action rides along. Kept pure (name + label already resolved by the caller)
 * so the whole matrix is unit-testable without React or network.
 *
 * Returns null (no toast) or:
 *   { text, action: 'zoom' | 'restore' | null, removeFromCanvas?: true }
 *
 * The matrix (owner brief, NEW-4):
 *   edit-vs-edit  — second committer wins. The tab whose rev check failed re-commits (LWW) and is
 *                   told "…was also just edited by ⟨name⟩ — your version was kept". The tab whose
 *                   write got overwritten (a foreign rev arrives for an element it authored within
 *                   ~15s) is told "⟨name⟩ changed ⟨element⟩ you just edited — their version is
 *                   showing". Slight over-trigger inside the window is BY DESIGN — two people on
 *                   one element within 15s warrants a heads-up regardless.
 *   edit-vs-deleted — the commit hit a tombstone: "⟨element⟩ was deleted by ⟨name⟩" + RESTORE
 *                   (clears the tombstone, writes your data, new rev) + take it off the canvas.
 *   delete-vs-edit — delete WINS (re-applied at the fresh rev, silent for the deleter); the
 *                   editor's side sees the standard removal + supersede notice (remote-delete
 *                   within the authored window).
 *   create-vs-create — impossible by construction (per-tab salted ids, B591): telemetry assert
 *                   only, never a toast.
 *   Quiet passes  — a remote upsert/delete OUTSIDE the authored window is normal live sync (the
 *                   canvas just updates); a re-applied delete on the deleting side is silent.
 */
export function toastForSyncEvent(ev, { name, label }) {
  if (!ev) return null;
  switch (ev.type) {
    case "edit-vs-edit-lost-race":
      // our commit lost the race but LWW re-commits our data — "your version was kept"
      return { text: `${label} was also just edited by ${name} — your version was kept.`, action: "zoom" };
    case "remote-while-dirty":
      // a foreign row landed while our edit is still in flight — their write is being overtaken
      // by our pending re-commit, but both hands are on the element: heads-up with zoom.
      return { text: `${name} also just edited ${label} — your version is being kept.`, action: "zoom" };
    case "remote-upsert":
      // normal live sync unless WE touched this element within the window (the overwritten side)
      if (!ev.authoredRecently) return null;
      return { text: `${name} changed ${label} you just edited — their version is showing.`, action: "zoom" };
    case "remote-delete":
      // delete-vs-edit, the editor's side: removal already applied; supersede notice
      if (!ev.authoredRecently) return null;
      return { text: `${label} you just edited was deleted by ${name}.`, action: null };
    case "edit-vs-deleted":
      // our edit hit a tombstone → offer Restore, and reflect the deletion on canvas meanwhile
      return { text: `${label} was deleted by ${name}.`, action: "restore", removeFromCanvas: true };
    case "restore-conflict":
      // our Restore raced someone who got there first — current row is the truth
      return { text: `${label} was already restored or edited by ${name} — their version is showing.`, action: "zoom" };
    case "delete-reapplied":
    default:
      return null; // silent: telemetry-only classes
  }
}
