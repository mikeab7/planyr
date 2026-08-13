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
 *   delete-vs-create — NEW-1. The row the delete lost its guard to was CREATED AFTER the delete
 *                   was formed, so the delete is a decision about a row that no longer exists.
 *                   The DELETER's side drops the op, gets the element back on the canvas, and is
 *                   told so (the canvas visibly changes — silence here would read as a ghost).
 *                   The CREATOR's side sees nothing at all: their create simply stands, which is
 *                   the whole point, and there is no event on that side to render.
 *   create-vs-create — impossible by construction (per-tab salted ids, B591): telemetry assert
 *                   only, never a toast.
 *   Quiet passes  — a remote upsert/delete OUTSIDE the authored window is normal live sync (the
 *                   canvas just updates); a re-applied delete on the deleting side is silent.
 *
 * ⛔ NEW-4 — WHO IS BLAMED, and the rule the owner set after ~5 banners named a collaborator who
 * does not exist. `self: true` means the actor is THIS ACCOUNT — another tab, another window, the
 * same person — or an actor we could not PROVE is a different account. In both cases the sentence
 * names a TAB, never a person. An action is attributed to a person only on a positive
 * different-account answer, which is what `self: false` means (see lib/editorNames.js, which is
 * the only thing allowed to decide it). Defaulting `self` to true here is deliberate: a caller
 * that forgets to pass it gets the unattributed wording, which is wrong in a harmless direction.
 */
export function toastForSyncEvent(ev, { name, label, self = true } = {}) {
  if (!ev) return null;
  switch (ev.type) {
    case "edit-vs-edit-lost-race":
      // our commit lost the race but LWW re-commits our data — "your version was kept"
      return self
        ? { text: `${label} was also just edited in another tab of yours — your version was kept.`, action: "zoom" }
        : { text: `${label} was also just edited by ${name} — your version was kept.`, action: "zoom" };
    case "remote-while-dirty":
      // a foreign row landed while our edit is still in flight — their write is being overtaken
      // by our pending re-commit, but both hands are on the element: heads-up with zoom.
      return self
        ? { text: `${label} was also just edited in another tab of yours — your version is being kept.`, action: "zoom" }
        : { text: `${name} also just edited ${label} — your version is being kept.`, action: "zoom" };
    case "remote-upsert":
      // normal live sync unless WE touched this element within the window (the overwritten side)
      if (!ev.authoredRecently) return null;
      return self
        ? { text: `${label} you just edited changed in another tab of yours — that version is showing.`, action: "zoom" }
        : { text: `${name} changed ${label} you just edited — their version is showing.`, action: "zoom" };
    case "remote-delete":
      // delete-vs-edit, the editor's side: removal already applied; supersede notice
      if (!ev.authoredRecently) return null;
      return self
        ? { text: `${label} you just edited was deleted in another tab of yours.`, action: null }
        : { text: `${label} you just edited was deleted by ${name}.`, action: null };
    case "edit-vs-deleted":
      // our edit hit a tombstone → offer Restore, and reflect the deletion on canvas meanwhile
      return self
        ? { text: `${label} was deleted in another tab of yours.`, action: "restore", removeFromCanvas: true }
        : { text: `${label} was deleted by ${name}.`, action: "restore", removeFromCanvas: true };
    case "delete-vs-create-dropped":
      // NEW-1 — the deleter's side. The element is BACK on the canvas, so this is never silent:
      // an object reappearing with no explanation is the worst reading of a correct outcome.
      return self
        ? { text: `${label} was re-created in another tab of yours after you deleted it — it's back on the plan.`, action: "zoom" }
        : { text: `${name} re-created ${label} after you deleted it — it's back on the plan.`, action: "zoom" };
    case "restore-conflict":
      // our Restore raced someone who got there first — current row is the truth
      return self
        ? { text: `${label} was already restored or edited in another tab of yours — that version is showing.`, action: "zoom" }
        : { text: `${label} was already restored or edited by ${name} — their version is showing.`, action: "zoom" };
    case "client-stale":
      // NEW-3 — every op in several consecutive batches was rejected on the rev guard: this tab is
      // running against a plan that has moved on, so it has STOPPED re-committing rather than
      // hot-looping the RPC. This one is not about a single element and never zooms — it is the one
      // state the user must act on, so it is always shown, with no `authoredRecently` gate.
      return { text: "This tab is out of date — your recent changes here can't be saved. Reload the page to catch up.", action: null };
    case "delete-reapplied":
    default:
      return null; // silent: telemetry-only classes
  }
}
