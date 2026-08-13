/* NoteHistory — every earlier state of this page, and the way back to one (NEW-3).
 *
 * WHAT IT IS FOR, and why the bin does not already do it. The 30-day bin protects a note
 * somebody DELETED. This protects one somebody MANGLED — a paste over a selection, an undo
 * history lost with the tab, or a second window of the same account writing over it. Those
 * are not hypothetical here: this module already has a named conflict state for the last one.
 *
 * ⛔ RESTORE CREATES A NEW VERSION. It never destroys history — the state being left is
 * snapshotted first and pinned, so restoring the wrong one is itself undoable. That rule
 * lives in lib/notesVersions.js (`planRestore`, pure and unit-tested) and is performed by
 * the store; this panel only asks.
 *
 * ⛔ NOT A DIALOG (house rule). It is a pane beside the note, dismissed with its own ✕ or
 * with Escape, and nothing behind it is blocked while it is open.
 */
import { useEffect, useRef } from "react";
import { versionReasonLabel } from "../lib/notesVersions.js";
import { absoluteStamp, stampLabel } from "../lib/notesTime.js";

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar

export default function NoteHistory({ open, versions = [], busy = false, onRestore, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose?.(); } };
    const el = ref.current;
    el?.addEventListener("keydown", key);
    return () => el?.removeEventListener("keydown", key);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside
      ref={ref}
      data-testid="note-history"
      aria-label="Version history"
      style={{
        /* ⛔ SHRINKS BEFORE THE PAGE DOES (B421492), but keeps enough width to read a row. */
        flex: "0 1 auto", width: 268, minWidth: 180, overflowY: "auto",
        borderLeft: "1px solid var(--border-default)", background: "var(--surface-raised)",
        padding: "10px 8px 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 2px 8px" }}>
        <span style={{ flex: 1, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
          Version history
        </span>
        <button
          type="button" data-testid="note-history-close" title="Close" aria-label="Close version history"
          onMouseDown={(e) => e.preventDefault()} onClick={onClose}
          style={{
            width: 20, height: 20, borderRadius: RADIUS.control, border: "1px solid transparent",
            background: "transparent", color: "var(--text-tertiary)", font: "inherit", fontSize: 12, lineHeight: 1, cursor: "pointer",
          }}
        >✕</button>
      </div>

      {/* LOUD-FAILURE's quiet cousin: an empty history says WHY it is empty, so nobody
          reads "no versions" as "your history was lost". */}
      {!versions.length ? (
        <p data-testid="note-history-empty" style={{ margin: "4px 4px", fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>
          {busy ? "Reading this note’s history…" : "No earlier versions yet. Planyr keeps one every couple of minutes while you write, and one when you leave the page."}
        </p>
      ) : versions.map((v, i) => (
        <div
          key={v.key}
          data-testid={`note-history-row-${i}`}
          data-version-at={v.at}
          style={{
            display: "flex", flexDirection: "column", gap: 3, padding: "6px 8px", marginBottom: 5,
            border: "1px solid var(--border-default)", borderRadius: RADIUS.control,
            background: "var(--surface-page)",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span title={absoluteStamp(v.at)} style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" }}>
              {stampLabel(v.at)}
            </span>
            <span style={{ flex: "0 0 auto", fontSize: 10.5, fontWeight: 650, color: "var(--text-tertiary)" }}>
              {versionReasonLabel(v.reason)}
            </span>
          </div>
          <p style={{
            margin: 0, fontSize: 11.5, lineHeight: 1.4, color: "var(--text-secondary)",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{v.preview || "(this version was empty)"}</p>
          <div>
            <button
              type="button"
              data-testid={`note-history-restore-${i}`}
              disabled={busy}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onRestore?.(v)}
              style={{
                height: 22, padding: "0 10px", borderRadius: RADIUS.pill,
                border: "1px solid var(--accent-notes)", background: "transparent",
                color: "var(--accent-notes-text)", font: "inherit", fontSize: 11.5, fontWeight: 700,
                cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1,
              }}
            >Restore</button>
          </div>
        </div>
      ))}

      {versions.length ? (
        <p style={{ margin: "6px 4px 0", fontSize: 11, lineHeight: 1.45, color: "var(--text-tertiary)" }}>
          Restoring keeps what is on the page now as its own version, so you can change your mind.
          History is kept on this computer.
        </p>
      ) : null}
    </aside>
  );
}
