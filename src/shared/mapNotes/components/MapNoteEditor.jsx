/* MapNoteEditor — the small card that opens on a map note: read it, edit it, delete it.
 *
 * Deliberately SMALL. A map note is a short piece of text pinned to a place; a document belongs in
 * the Notes workspace (src/workspaces/notes), which this component does not import, link to, or
 * know about. See db/map_notes.sql's header for why that split is load-bearing rather than tidy.
 *
 * INLINE EDITOR, never a dialog box (owner rule, 2026-06-17: no window.prompt/confirm/alert). The
 * delete confirmation swaps the action row for a dedicated Confirm/Keep-it pair (NEW-1,
 * B1372144-HARDENING-1) rather than relabeling the Delete button in place — see that swap's own
 * comment below for why the relabel version could be misclicked into a silent no-op.
 *
 * LOUD-FAILURE — every save/delete failure is shown in the card, in the words the store handed
 * back, and the card STAYS OPEN with the user's text intact. Nothing here reports a success it did
 * not get: the parent's `onSaved` only ever runs on a row the server actually returned.
 *
 * ⛔ THERE IS NO SITE PICKER HERE, AND NONE SHOULD BE ADDED (NEW-2, 2026-09-24 — reversing the
 * dropdown this card used to carry). A note is pinned to a map location, not to a site, and the
 * dropdown offered every one of the account's sites regardless of where they actually were — "pick
 * a site" from a list of unrelated ones the owner reported as pointless. `projectId` stays on the
 * data model (db/map_notes.sql) purely so an already-linked note keeps whatever it was linked to;
 * this editor neither sets it on a new note nor offers a way to change it on an existing one. Do
 * not add a "create a site from this note" path either — that is exactly what B843792 does for
 * comps and exactly what this feature must not do.
 */
import React, { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/controls.jsx";
import { RADIUS } from "../../ui/radius.js";
import { FONT_SIZE, SPACE } from "../../ui/designTokens.js";
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, validateMapNote, mapNoteHeadline } from "../lib/mapNotes.js";

const INPUT_STYLE = {
  width: "100%", boxSizing: "border-box",
  background: "var(--surface-raised)", color: "var(--text-primary)",
  border: "1px solid var(--border-default)", borderRadius: RADIUS.sm,
  padding: `${SPACE.sm}px ${SPACE.md}px`, fontSize: FONT_SIZE.control, fontFamily: "inherit",
};

/**
 * props:
 *  - note            the note being edited: a saved row, or a fresh one from emptyMapNote(anchor)
 *  - saving/busy     handled internally; the parent only supplies the async actions
 *  - onSave(note)    → { data, error }  (parent calls insertMapNote/updateMapNote)
 *  - onDelete(id)    → { error }        (parent calls deleteMapNote — SOFT)
 *  - onClose()
 *  - targetLabel     { kind, text } — WHAT the note is attached to, by name (a saved site, a parcel's
 *                    address or account, a pin's coordinates). Replaces the old bare "On a parcel",
 *                    which left an owner on a phone unable to tell where the note was going.
 *  - compact         true while the on-screen keyboard is up: the Cancel / Save row moves up beside the
 *                    target name and the text box shrinks, so card AND target both fit in the sliver of
 *                    map the keyboard leaves. Same controls, same test ids — only their position moves.
 *  - maxHeight       px cap from the parent (map height minus keyboard); the card scrolls inside it
 *                    and the text box shrinks, so the thing being annotated stays visible above it.
 */
export default function MapNoteEditor({ note, onSave, onDelete, onClose, targetLabel = null, maxHeight = null, compact = false }) {
  const [title, setTitle] = useState(note?.title || "");
  const [body, setBody] = useState(note?.body || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const bodyRef = useRef(null);
  const isNew = !note?.id;

  // Re-seed when the card is pointed at a DIFFERENT note (clicking a second marker while one is
  // open) — keyed on id so a re-render of the same note never stomps what the user is typing.
  useEffect(() => {
    setTitle(note?.title || ""); setBody(note?.body || "");
    setErr(""); setConfirmDel(false);
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (isNew && bodyRef.current) bodyRef.current.focus(); }, [isNew]);

  // NEW-2 (2026-09-24) — `projectId` rides straight through from whatever the note already had
  // (null for a brand-new one); there is no control here that can change it. See the file header.
  const draft = { ...(note || {}), title, body, projectId: note?.projectId || null };
  const problems = validateMapNote(draft);

  const save = async () => {
    if (problems.length) { setErr(problems[0]); return; }
    setBusy(true); setErr("");
    try {
      const res = await onSave(draft);
      if (res?.error) { setErr(res.error.message || String(res.error)); return; }
      onClose?.();
    } catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  const confirmRemove = async () => {
    setBusy(true); setErr("");
    try {
      const res = await onDelete(note.id);
      if (res?.error) { setErr(res.error.message || String(res.error)); return; }
      onClose?.();
    } catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  // The action buttons are one fragment used in ONE of two places (bottom row, or — compact — the
  // header), so there is never a second copy of the Save / Cancel / Delete wiring.
  const actions = (
    <>
          {!isNew && (
            <Button variant="ghost" onClick={() => setConfirmDel(true)} disabled={busy} data-testid="map-note-delete"
              title="Delete this note" style={{ color: "var(--danger-text)" }}>
              Delete
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={() => onClose?.()} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || problems.length > 0}
            accent="var(--accent-notes)" onAccent="var(--on-accent-notes)"
            data-testid="map-note-save"
            title={problems.length ? problems[0] : `Save ${mapNoteHeadline(draft)}`}>
            {busy ? "Saving…" : "Save"}
          </Button>
            </>
  );
  const confirmRow = (
    <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>
          <span style={{ flex: 1, fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>Delete this note?</span>
          <Button variant="ghost" onClick={() => setConfirmDel(false)} disabled={busy}>Keep it</Button>
          <Button variant="danger" onClick={confirmRemove} disabled={busy} data-testid="map-note-delete-confirm">
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </div>
  );

  return (
    <div
      data-testid="map-note-editor"
      // Stop map gestures underneath: a drag inside the card must not pan the map behind it.
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose?.(); } }}
      style={{
        display: "flex", flexDirection: "column", gap: SPACE.sm,
        width: 300, maxWidth: "calc(100vw - 24px)",
        background: "var(--surface-raised)", color: "var(--text-primary)",
        border: "1px solid var(--border-default)", borderRadius: RADIUS.lg,
        boxShadow: "0 10px 30px rgba(28,25,20,0.22)", // design-exempt: shadow tint, matches the map's other floating panels (ContextMenu)
        padding: compact ? SPACE.md : SPACE.xl,
        ...(compact ? { gap: SPACE.xs } : null),
        ...(maxHeight ? { maxHeight, overflowY: "auto", overscrollBehavior: "contain" } : null),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>
        <span style={{ width: SPACE.sm, height: SPACE.sm, borderRadius: RADIUS.pill, background: "var(--accent-notes)", flex: "none" }} />
        {!compact && (
          <span style={{ flex: 1, fontSize: FONT_SIZE.label, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
            {isNew ? "New note" : "Note"}
          </span>
        )}
        <span
          data-testid="map-note-target"
          data-target-kind={targetLabel?.kind || note?.anchor?.kind || ""}
          title={targetLabel?.text ? `On ${targetLabel.text}` : undefined}
          style={{ fontSize: FONT_SIZE.control, fontWeight: 600, color: "var(--text-primary)", minWidth: 0, maxWidth: compact ? "46%" : "70%", flex: compact ? "1 1 auto" : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {targetLabel?.text
            ? `On ${targetLabel.text}`
            : (note?.anchor?.kind === "parcel" ? "On a parcel" : "Dropped pin")}
        </span>
        {compact && !confirmDel && (
          <span style={{ display: "flex", alignItems: "center", gap: SPACE.sm, flex: "none" }}>{actions}</span>
        )}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={NOTE_TITLE_MAX}
        placeholder="Title (optional)"
        aria-label="Note title"
        data-testid="map-note-title"
        style={INPUT_STYLE}
      />
      <textarea
        ref={bodyRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={NOTE_BODY_MAX}
        rows={compact ? 2 : maxHeight && maxHeight < 360 ? 3 : 5}
        placeholder="Type your note…"
        aria-label="Note text"
        data-testid="map-note-body"
        style={{ ...INPUT_STYLE, resize: "vertical", minHeight: compact ? 44 : maxHeight && maxHeight < 360 ? 56 : 84, lineHeight: 1.45 }}
      />

      {err && (
        <div role="alert" data-testid="map-note-error" style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>{err}</div>
      )}

      {/* ⛔ CONFIRM IS A SEPARATE ROW, NEVER A RELABEL OF THE SAME BUTTON IN PLACE — the SitePlansSection
          kebab menu's "the menu swaps its OWN content for a confirm step rather than closing" pattern,
          copied here rather than reinvented, because the relabel version has a real hazard: "Delete"
          growing to "Delete — sure?" in a fixed-width row shrinks the flex spacer next to it, which
          shifts Cancel/Save left underneath wherever the user's second click lands. A miss there reads
          as "I clicked Delete and it just closed" with zero network traffic — exactly the reported
          defect, and exactly the class LOUD-FAILURE exists to prevent. Replacing the whole row means
          the second click can only ever land on a control that belongs to the confirm step itself. */}
      {confirmDel ? (
        confirmRow
      ) : compact ? null : (
        <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>{actions}</div>
      )}
    </div>
  );
}
