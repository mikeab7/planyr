/* ConflictCompare — the Notes conflict bar SHOWS THE TWO VERSIONS, instead of asking for a
 *  blind pick (B842624, amending B1391/V680: the earlier item made the choice safe — nothing
 *  is destroyed — this one makes it INFORMED).
 *
 *  ⛔ THE PROBLEM, in the owner's own words, with a screenshot: *"this warning banner about
 *  utilities does nothing for me, i have no clue which one to choose, i should be able to
 *  decide which one i should by at least looking at it."* The old bar was two verbs and no
 *  content — he could not see either version, when either was edited, what differed, or what
 *  would happen to the one he did not pick. This component is the fix: both copies, read-only,
 *  in full, with the differing words marked (a plain highlight, never a raw +/- diff — the
 *  reference is Google Docs' version history, not a developer tool), each stamped with WHEN it
 *  was last saved and WHERE it came from, and each choice stating in the same breath what
 *  happens to the copy it doesn't pick.
 *
 *  ⛔ IT STAYS INLINE, NEVER A FLOATING NOTICE (docs/DESIGN.md "Floating notifications" names
 *  this module's `role="alert"` blocks as a surface that must NOT move — a floated bar over the
 *  page would divorce the decision from the note it is about).
 *
 *  ⛔ THE URGENCY MUST MATCH THE STAKES, WHICH ARE LOW (B1391: nothing is ever destroyed by
 *  either choice — see `handleConflict` in `Notes.jsx`, which now parks the un-picked copy as a
 *  sibling page for BOTH choices, not just one). So this reads as an amber INFORMATIONAL bar —
 *  the same tone the module already uses for `IntegrityBanner` — never a red, blocking modal.
 *
 *  The diff itself is `lib/notesConflictDiff.js`, PURE and unit-tested; this file only renders
 *  what it returns. */
import { useMemo } from "react";
import { notesConflictLine } from "../lib/notesStore.js";
import { docToText } from "../lib/notesMarkdown.js";
import { diffNoteText, diffHasChanges, sideOps } from "../lib/notesConflictDiff.js";
import { stampLabel, absoluteStamp } from "../lib/notesTime.js";

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar

/** One run of a side's text, plain or highlighted. MODULE-SCOPE, not a closure per render. */
function DiffRun({ text, changed }) {
  if (!changed) return text;
  return (
    <mark
      style={{
        background: "var(--warn-bg)", color: "var(--text-primary)",
        boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone",
      }}
    >{text}</mark>
  );
}

/** One version, read-only and in full — the Google Docs half of the reference: a whole,
 *  legible copy of the note, with only the genuinely differing words picked out. */
function VersionCard({ label, when, whenExact, ops, buttonLabel, consequence, onChoose, testId }) {
  return (
    <div
      data-testid={testId}
      style={{
        minWidth: 0, display: "flex", flexDirection: "column", gap: 6,
        background: "var(--surface-raised)", border: "1px solid var(--warn-border)", borderRadius: RADIUS.control,
        padding: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text-primary)" }}>{label}</span>
        <span
          title={whenExact || undefined}
          style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-secondary)", flex: "0 0 auto" }}
        >{when ? `edited ${when}` : "edit time unknown"}</span>
      </div>
      <div
        data-testid={`${testId}-text`}
        style={{
          maxHeight: 200, overflowY: "auto", fontSize: 12, lineHeight: 1.5, color: "var(--text-primary)",
          whiteSpace: "pre-wrap", overflowWrap: "anywhere",
          border: "1px solid var(--border-default)", borderRadius: RADIUS.control,
          padding: 8,
          /* A round of screenshot review on a phone width found real content silently
           * scrolled out of view with no hint there was more — exactly the "differences
           * marked" promise this bar makes, hidden below an unlabelled fold. This is the
           * standard background-attachment scroll-shadow: two solid layers riding the
           * SCROLLING content (so they cover it, "local") and two soft shadow layers fixed
           * to the box ("scroll") — the shadow only shows once the solid layer has scrolled
           * far enough to reveal it, so it self-cancels the moment there's nothing left to
           * scroll toward. No JS, no scroll listener, correct at any content length. */
          background:
            "linear-gradient(var(--surface-page) 30%, transparent),"
            + "linear-gradient(transparent, var(--surface-page) 70%) 0 100%,"
            + "linear-gradient(rgba(0,0,0,.16), transparent) 0 0," // design-exempt: scroll-shadow hint — no shadow-color token exists repo-wide yet (same gap SheetView.jsx/CompEntryGrid.jsx already cite)
            + "linear-gradient(transparent, rgba(0,0,0,.16)) 0 100%", // design-exempt: scroll-shadow hint — no shadow-color token exists repo-wide yet (same gap SheetView.jsx/CompEntryGrid.jsx already cite)
          backgroundRepeat: "no-repeat",
          backgroundColor: "var(--surface-page)",
          backgroundSize: "100% 24px, 100% 24px, 100% 8px, 100% 8px",
          backgroundAttachment: "local, local, scroll, scroll",
        }}
      >
        {ops.length
          ? ops.map((op, i) => <DiffRun key={i} text={op.text} changed={op.changed} />)
          : <em style={{ color: "var(--text-secondary)" }}>This copy is empty.</em>}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 180px", fontSize: 10.5, color: "var(--text-secondary)" }}>{consequence}</span>
        <button
          type="button"
          data-testid={`${testId}-choose`}
          onClick={onChoose}
          style={{
            flex: "0 0 auto", border: "1px solid var(--warn-text)", borderRadius: RADIUS.pill,
            background: "transparent", color: "var(--warn-text)", font: "inherit",
            fontSize: 10.5, fontWeight: 700, padding: "3px 12px", cursor: "pointer",
          }}
        >{buttonLabel}</button>
      </div>
    </div>
  );
}

/** THE TWO CARDS SIT SIDE BY SIDE ON A WIDE SCREEN, STACKED ON A NARROW ONE — with no
 *  breakpoint hook and no JS at all. `Notes.jsx` already has `useNarrow()` for the phone
 *  drill-in, and a SECOND one here would be a third the module owns (see
 *  `components/NotesTree.jsx`'s header on reusing the one that exists) — worse, a JS
 *  breakpoint reads the WINDOW, not the space this bar actually has, which is narrower once a
 *  side rail is open. `grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))` asks
 *  neither question: two columns render only when two 260px cards plus the gap genuinely fit
 *  the row they are actually in, and it collapses to one on its own the moment they don't — a
 *  round-trip layout question CSS was already built to answer. The first screenshot pass (round
 *  1) shipped this stacked always, which read thin and under-designed at a desktop width where
 *  GitHub's split-diff reference (named as the fallback shape in the brief) reads better. */
export default function ConflictCompare({
  title, localDoc, serverDoc, localUpdatedAt, serverUpdatedAt, onKeepMine, onKeepTheirs,
}) {
  const copy = notesConflictLine(title);
  const localText = useMemo(() => docToText(localDoc), [localDoc]);
  const serverText = useMemo(() => docToText(serverDoc), [serverDoc]);
  const { ops } = useMemo(() => diffNoteText(localText, serverText), [localText, serverText]);
  const changed = diffHasChanges(ops);
  const mineOps = useMemo(() => sideOps(ops, "a"), [ops]);
  const theirsOps = useMemo(() => sideOps(ops, "b"), [ops]);
  const name = String(title || "").trim() || "Untitled";

  return (
    <div
      role="alert"
      data-testid="notes-conflict-bar"
      data-has-diff={changed ? "1" : "0"}
      style={{
        flex: "none", display: "flex", flexDirection: "column", gap: 8, padding: "8px 14px 10px",
        background: "var(--warn-bg)", borderBottom: "1px solid var(--border-default)",
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--warn-text)" }}>{copy.text}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8, alignItems: "start" }}>
        <VersionCard
          label="This window"
          when={stampLabel(localUpdatedAt)}
          whenExact={absoluteStamp(localUpdatedAt)}
          ops={mineOps}
          buttonLabel={copy.keepMine}
          consequence={`Keeps this text. The other window’s version is saved as “${name} ${copy.otherParkedSuffix}” — nothing is lost.`}
          onChoose={onKeepMine}
          testId="notes-conflict-mine"
        />
        <VersionCard
          label="The other window"
          when={stampLabel(serverUpdatedAt)}
          whenExact={absoluteStamp(serverUpdatedAt)}
          ops={theirsOps}
          buttonLabel={copy.keepTheirs}
          consequence={`Switches to this text. What’s on this screen now is saved as “${name} ${copy.parkedSuffix}” — nothing is lost.`}
          onChoose={onKeepTheirs}
          testId="notes-conflict-theirs"
        />
      </div>
    </div>
  );
}
