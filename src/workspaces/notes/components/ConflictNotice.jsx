/* ConflictNotice — the QUIET notice NEW-3 asks for, replacing the tall inline comparison bar
 *  B842624 shipped. The owner, verbatim: *"it shouldn't just pop up with this massive banner,
 *  i should be able to click something that takes me to this but on full screen for review."*
 *  In his screenshot the old bar filled roughly the top third of the window, pushing the note
 *  he was actually working in down out of the way — for a situation that is genuinely low-
 *  stakes (nothing is ever destroyed by either choice; see `handleConflict` in `Notes.jsx`).
 *
 *  ⛔ STAYS INLINE, NEVER FLOATED (docs/DESIGN.md "Floating notifications" names this module's
 *  `role="alert"` blocks, including this one's predecessor, as inline chrome that must not
 *  move) — just SHORT now: one line of text and one button, not two full comparison panes.
 *
 *  The two resolve choices live only in the full-screen `ConflictReview.jsx` this opens,
 *  never on the compact notice itself — the notice's whole job is to be small, and stacking a
 *  second decision surface on top of "click here to review" would immediately undo that. The
 *  footer's own unresolved/resolved indicator (`notesStorageLine`'s "conflict" mode, unchanged
 *  by this file) is exactly as reachable as it always was — resolving still runs through
 *  `resolveNotesConflict` via `onKeepMine`/`onKeepTheirs`, just from one screen further in. */
import { useState } from "react";
import ConflictReview from "./ConflictReview.jsx";
import { notesConflictLine } from "../lib/notesStore.js";

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar

export default function ConflictNotice({
  title, localDoc, serverDoc, localUpdatedAt, serverUpdatedAt, onKeepMine, onKeepTheirs,
}) {
  const [open, setOpen] = useState(false);
  const copy = notesConflictLine(title);

  const choose = (fn) => { setOpen(false); fn?.(); };

  return (
    <>
      <div
        role="alert"
        data-testid="notes-conflict-bar"
        style={{
          flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          flexWrap: "wrap", padding: "6px 14px", background: "var(--warn-bg)", borderBottom: "1px solid var(--border-default)",
        }}
      >
        {/* Wraps onto a second line on a narrow phone rather than truncating — a notice this
         * short can afford two lines; it cannot afford hiding its own message (round 2 of the
         * critique loop: at a phone width this used to ellipsis down to "…also cha…", which
         * is worse than a slightly taller bar). */}
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--warn-text)", flex: "1 1 220px" }}>{copy.text}</span>
        <button
          type="button"
          data-testid="notes-conflict-review-open"
          onClick={() => setOpen(true)}
          style={{
            flex: "0 0 auto", border: "1px solid var(--warn-text)", borderRadius: RADIUS.pill,
            background: "transparent", color: "var(--warn-text)", font: "inherit",
            fontSize: 10.5, fontWeight: 700, padding: "3px 12px", cursor: "pointer",
          }}
        >Review changes →</button>
      </div>
      {open ? (
        <ConflictReview
          title={title}
          localDoc={localDoc}
          serverDoc={serverDoc}
          localUpdatedAt={localUpdatedAt}
          serverUpdatedAt={serverUpdatedAt}
          keepMine={copy.keepMine}
          keepTheirs={copy.keepTheirs}
          onKeepMine={() => choose(onKeepMine)}
          onKeepTheirs={() => choose(onKeepTheirs)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
