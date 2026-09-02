/* ConflictSideBySide — the two-card, side-by-side comparison (B842624's original shape),
 *  now the SECONDARY view inside `ConflictReview.jsx` — the redline (`NoteRedline.jsx`) is what
 *  the review opens on by default, per the owner's own ask: *"wouldn't a redline be better, so
 *  I can see the differences over each other."* Side by side stays reachable (a toggle in the
 *  review's header) because two full, independently-scrollable copies are still occasionally
 *  the easier read for a genuinely large rewrite — but it is no longer the resting view.
 *
 *  ⛔ B849104 — CARDS AND BUTTONS ARE ORDERED AND LABELLED BY RECENCY, MATCHING
 *  `ConflictReview.jsx`'s footer (`lib/notesVersionOrder.js`), NOT by "This window"/"the other
 *  window" and never two identical "Keep this version" buttons — see that file's header for the
 *  full argument (both the original asymmetric verbs AND the first fix's identical ones read as
 *  unclear to the owner). Each button's `aria-label` still separately names the window, for a
 *  screen-reader user who loses the positional cue a sighted reader gets for free.
 */
import { useMemo } from "react";
import { docToText } from "../lib/notesMarkdown.js";
import { diffNoteText, sideOps } from "../lib/notesConflictDiff.js";
import { orderConflictVersions } from "../lib/notesVersionOrder.js";
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

/** One version, read-only and in full. */
function VersionCard({ label, when, whenExact, ops, buttonLabel, buttonAriaLabel, onChoose, testId }) {
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
          maxHeight: 320, overflowY: "auto", fontSize: 12, lineHeight: 1.5, color: "var(--text-primary)",
          whiteSpace: "pre-wrap", overflowWrap: "anywhere",
          border: "1px solid var(--border-default)", borderRadius: RADIUS.control,
          padding: 8,
          /* The standard background-attachment scroll-shadow — two solid layers riding the
           * SCROLLING content ("local") and two soft shadow layers fixed to the box ("scroll"),
           * so the shadow only shows once there is more to scroll toward. No JS. */
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
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          data-testid={`${testId}-choose`}
          aria-label={buttonAriaLabel}
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

/** The visible name for one slot — same recency-first framing as `ConflictReview.jsx`'s
 *  `roleLabel` (kept as a sibling copy rather than a shared import: the two files' JSX shapes
 *  differ enough that a shared component would need its own prop surface for no real reuse). */
function roleLabel(comparable, isNewer, which) {
  if (comparable) return isNewer ? "Newer version" : "Older version";
  return which === "mine" ? "This window’s version" : "The other window’s version";
}

/** THE TWO CARDS SIT SIDE BY SIDE ON A WIDE SCREEN, STACKED ON A NARROW ONE — see the
 *  original B842624 header for why this is a CSS grid question, never a JS breakpoint. */
export default function ConflictSideBySide({
  title, localDoc, serverDoc, localUpdatedAt, serverUpdatedAt, onKeepMine, onKeepTheirs,
}) {
  const localText = useMemo(() => docToText(localDoc), [localDoc]);
  const serverText = useMemo(() => docToText(serverDoc), [serverDoc]);
  const { ops } = useMemo(() => diffNoteText(localText, serverText), [localText, serverText]);
  const mineOps = useMemo(() => sideOps(ops, "a"), [ops]);
  const theirsOps = useMemo(() => sideOps(ops, "b"), [ops]);
  const name = String(title || "").trim() || "Untitled";

  const order = useMemo(
    () => orderConflictVersions({ localDoc, serverDoc, localUpdatedAt, serverUpdatedAt }),
    [localDoc, serverDoc, localUpdatedAt, serverUpdatedAt],
  );
  const newerLabel = roleLabel(order.comparable, true, order.newer.which);
  const olderLabel = roleLabel(order.comparable, false, order.older.which);
  const cardFor = (which) => (which === "mine"
    ? { when: stampLabel(localUpdatedAt), whenExact: absoluteStamp(localUpdatedAt), ops: mineOps, onChoose: onKeepMine, testId: "notes-conflict-mine" }
    : { when: stampLabel(serverUpdatedAt), whenExact: absoluteStamp(serverUpdatedAt), ops: theirsOps, onChoose: onKeepTheirs, testId: "notes-conflict-theirs" });
  const newerCard = cardFor(order.newer.which);
  const olderCard = cardFor(order.older.which);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* NEW-1 — stated once, above both cards, not repeated per card. */}
      <p style={{ fontSize: 10.5, color: "var(--text-secondary)", margin: 0 }}>
        Nothing is lost either way — the version you don’t keep is saved as a copy next to “{name}”.
      </p>
      <div data-testid="notes-conflict-sidebyside" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8, alignItems: "start" }}>
        <VersionCard
          label={newerLabel} when={newerCard.when} whenExact={newerCard.whenExact} ops={newerCard.ops}
          buttonLabel={order.comparable ? "Keep the newer version" : `Keep ${order.newer.which === "mine" ? "this window’s" : "the other window’s"} version`}
          buttonAriaLabel={`Keep the version edited ${newerCard.when || "at an unknown time"}, from ${order.newer.which === "mine" ? "this window" : "the other window"}`}
          onChoose={newerCard.onChoose} testId={newerCard.testId}
        />
        <VersionCard
          label={olderLabel} when={olderCard.when} whenExact={olderCard.whenExact} ops={olderCard.ops}
          buttonLabel={order.comparable ? "Keep the older version" : `Keep ${order.older.which === "mine" ? "this window’s" : "the other window’s"} version`}
          buttonAriaLabel={`Keep the version edited ${olderCard.when || "at an unknown time"}, from ${order.older.which === "mine" ? "this window" : "the other window"}`}
          onChoose={olderCard.onChoose} testId={olderCard.testId}
        />
      </div>
    </div>
  );
}
