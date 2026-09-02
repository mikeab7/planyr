/* ConflictReview — the full-screen conflict review NEW-3 asks for: room to actually read, one
 *  click away from the compact notice (`ConflictNotice.jsx`) rather than a banner that seizes
 *  the top third of the window. The owner, verbatim: *"it shouldn't just pop up with this
 *  massive banner, i should be able to click something that takes me to this but on full
 *  screen for review."*
 *
 *  Opens on the REDLINE (`NoteRedline.jsx`) by default — NEW-2's ask, "wouldn't a redline be
 *  better, so I can see the differences over each other" — with the original two-card
 *  side-by-side (`ConflictSideBySide.jsx`) one click away for the rare case a full rewrite
 *  reads easier as two independent columns.
 *
 *  ⛔ NOT A FLOATING NOTIFICATION. `docs/DESIGN.md`'s "Floating notifications" rule governs
 *  ambient, app-level toasts that overlay content uninvited; this is a full-screen surface the
 *  user explicitly opened by pressing a button, the same category as `QuickOpen.jsx`'s overlay
 *  — so it takes the whole viewport rather than sitting bottom-centered over other content.
 *
 *  Resolving (either "Keep this version" button) is reachable from here and ONLY from here —
 *  the compact notice carries no choices of its own, by design (see that file's header) — so
 *  this is where NEW-3's "resolution must still be reachable" promise is kept. Closing (Esc or
 *  ✕) does NOT resolve anything; it just returns to the compact notice, unresolved. */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildRedline } from "../lib/notesRedline.js";
import NoteRedline from "./NoteRedline.jsx";
import ConflictSideBySide from "./ConflictSideBySide.jsx";
import { stampLabel } from "../lib/notesTime.js";

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar

/** One resolve choice, in the footer — the condensed sibling of `ConflictSideBySide`'s
 *  `VersionCard`: same symmetric "Keep this version" text (NEW-1), no text pane (the redline or
 *  side-by-side view above already shows the content), just enough context to know which
 *  window this button acts on. MODULE-SCOPE, not a closure per render. */
function ChoiceColumn({ label, when, buttonLabel, buttonAriaLabel, consequence, onChoose, testId }) {
  return (
    <div style={{ minWidth: 0, flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text-primary)" }}>{label}</span>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-secondary)" }}>{when ? `edited ${when}` : "edit time unknown"}</span>
      </div>
      <span style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{consequence}</span>
      <button
        type="button"
        data-testid={testId}
        aria-label={buttonAriaLabel}
        onClick={onChoose}
        style={{
          alignSelf: "flex-start", border: "1px solid var(--warn-text)", borderRadius: RADIUS.pill,
          background: "transparent", color: "var(--warn-text)", font: "inherit",
          fontSize: 10.5, fontWeight: 700, padding: "4px 14px", cursor: "pointer",
        }}
      >{buttonLabel}</button>
    </div>
  );
}

export default function ConflictReview({
  title, localDoc, serverDoc, localUpdatedAt, serverUpdatedAt, keepMine, keepTheirs,
  onKeepMine, onKeepTheirs, onClose,
}) {
  const [view, setView] = useState("redline");
  const panelRef = useRef(null);
  const name = String(title || "").trim() || "Untitled";
  const redline = useMemo(() => buildRedline(localDoc, serverDoc), [localDoc, serverDoc]);

  useEffect(() => {
    const opener = document.activeElement;
    panelRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && document.contains(opener)) {
        try { opener.focus(); } catch (_) { /* an element that went away needs no focus */ }
      }
    };
  }, []);

  const keys = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose?.(); } };

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Compare versions of “${name}”`}
      data-testid="notes-conflict-review"
      onKeyDown={keys}
      style={{
        position: "fixed", inset: 0, zIndex: 90, display: "flex", flexDirection: "column",
        background: "var(--surface-page)",
      }}
    >
      <div style={{
        flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        padding: "10px 14px", borderBottom: "1px solid var(--border-default)", flexWrap: "wrap",
      }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Compare versions — {name}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ display: "flex", border: "1px solid var(--border-default)", borderRadius: RADIUS.pill, overflow: "hidden" }}>
            {[["redline", "Redline"], ["sidebyside", "Side by side"]].map(([id, label]) => (
              <button
                key={id}
                type="button"
                data-testid={`notes-conflict-view-${id}`}
                onClick={() => setView(id)}
                aria-pressed={view === id}
                style={{
                  border: "none", cursor: "pointer", font: "inherit", fontSize: 10.5, fontWeight: 700,
                  padding: "5px 12px", color: view === id ? "var(--on-accent-notes)" : "var(--text-secondary)",
                  background: view === id ? "var(--accent-notes)" : "transparent",
                }}
              >{label}</button>
            ))}
          </div>
          <button
            type="button"
            data-testid="notes-conflict-review-close"
            aria-label="Close review"
            onClick={onClose}
            style={{
              border: "1px solid var(--border-default)", borderRadius: RADIUS.control, background: "transparent",
              color: "var(--text-secondary)", font: "inherit", fontSize: 13, fontWeight: 700,
              width: 26, height: 26, lineHeight: "24px", cursor: "pointer",
            }}
          >✕</button>
        </div>
      </div>

      <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "14px 16px" }}>
        {view === "redline" ? (
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            <p style={{ fontSize: 10.5, color: "var(--text-secondary)", margin: "0 0 10px" }}>
              <span style={{ color: "var(--success-text)", textDecoration: "underline" }}>Underlined</span> text is only in
              {" "}<strong>This window</strong>. <span style={{ color: "var(--danger-text)", textDecoration: "line-through" }}>Struck-through</span> text
              {" "}is only in <strong>the other window</strong>.
            </p>
            {/* A bordered "page" rather than text floating on the bare background — the
             * empty margin either side is a document-reading width, not unfinished chrome
             * (round 1 of the critique loop read this as sparse without the card). */}
            <div style={{
              background: "var(--surface-raised)", border: "1px solid var(--border-default)",
              borderRadius: RADIUS.control, padding: "18px 24px",
            }}
            >
              <NoteRedline blocks={redline.blocks} />
              {!redline.changed ? (
                <p style={{ fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" }}>The two copies read the same — nothing found to mark.</p>
              ) : null}
            </div>
          </div>
        ) : (
          <ConflictSideBySide
            title={title} localDoc={localDoc} serverDoc={serverDoc}
            localUpdatedAt={localUpdatedAt} serverUpdatedAt={serverUpdatedAt}
            keepMine={keepMine} keepTheirs={keepTheirs}
            onKeepMine={onKeepMine} onKeepTheirs={onKeepTheirs}
          />
        )}
      </div>

      {/* ⛔ ONLY THE REDLINE NEEDS A FOOTER. The side-by-side view already carries both
       * "Keep this version" buttons — one per card, right next to that card's own text — so
       * a second, identical pair of buttons down here would be the exact redundancy
       * PANEL-BREVITY forbids (found in round 1 of the critique loop: both surfaces on
       * screen at once). Redline has no per-card buttons to reuse, so it alone needs this. */}
      {view === "redline" ? (
        <div style={{
          flex: "0 0 auto", display: "flex", gap: 16, flexWrap: "wrap",
          padding: "10px 14px", borderTop: "1px solid var(--border-default)", background: "var(--warn-bg)",
        }}
        >
          <ChoiceColumn
            label="This window" when={stampLabel(localUpdatedAt)}
            buttonLabel={keepMine} buttonAriaLabel="Keep this window’s version"
            consequence={`The other window’s version is saved as “${name} (the other window’s copy)” — nothing is lost.`}
            onChoose={onKeepMine} testId="notes-conflict-review-keep-mine"
          />
          <ChoiceColumn
            label="The other window" when={stampLabel(serverUpdatedAt)}
            buttonLabel={keepTheirs} buttonAriaLabel="Keep the other window’s version"
            consequence={`This window’s version is saved as “${name} (this window’s copy)” — nothing is lost.`}
            onChoose={onKeepTheirs} testId="notes-conflict-review-keep-theirs"
          />
        </div>
      ) : null}
    </div>
  );
}
