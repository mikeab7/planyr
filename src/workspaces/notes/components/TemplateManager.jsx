/* TemplateManager — NEW-1: "Manage templates". Create, rename, edit the body, duplicate and
 * delete the account's page templates.
 *
 * ⛔ NOT A SECOND EDITOR. The body pane below is the exact same `NoteEditor` a page uses,
 * given a `loadDoc`/`saveDoc` pair that read/write one template record instead of a page's
 * storage key (see that file's own header for the two-line hook this needed). A template's
 * title field doubles as its RENAME control — there is no separate rename UI — because the
 * title field already IS a tested, working rename affordance and building a second one next
 * to it would be the very thing this module keeps warning against.
 *
 * ⛔ THIS FILE MAY IMPORT THE EDITOR STATICALLY. It is itself only ever reached through
 * Notes.jsx's `lazy(() => import("./components/TemplateManager.jsx"))`, so by the time any
 * line here runs the static-path/no-@tiptap rule has already done its job — the same reason
 * NoteEditor.jsx itself is allowed to import `@tiptap/react`.
 *
 * Storage is entirely the caller's (Notes.jsx) job: this component reads the `templates`
 * prop and calls back (`onCreate`/`onRename`/`onCommitLabel`/`onSaveBody`/`onDuplicate`/
 * `onDelete`); it holds no storage of its own beyond which row is selected.
 */
import { useEffect, useState } from "react";
import NoteEditor from "./NoteEditor.jsx";
import { displayTemplateLabel } from "../lib/notesTemplates.js";

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar / ConflictReview
const PAD = { sm: "5px 10px", lg: "9px 14px" }; // mirrored, same reason
const FONT = { sm: 10.5 };
const REST_SHADOW = "0 1px 2px rgba(0,0,0,0.05)"; // design-exempt: neutral rest-shadow mirrored verbatim, token-independent by design
const NOTES_ACCENT = { accent: "var(--accent-notes)", onAccent: "var(--on-accent-notes)" };

/* ⛔ MIRRORS shared/ui/controls.jsx's Button(primary/ghost) rather than importing it — the
 * same reasoning NoteToolbar.jsx / ConflictReview.jsx already document: importing controls.jsx
 * from Notes hoists a shared chunk onto other routes and risks the Site route's chunk
 * allowlist. Keep in step with controls.jsx's own Button if either changes shape. */
function PrimaryButton({ size = "lg", accent = "var(--accent)", onAccent = "var(--on-accent)", style, children, ...rest }) {
  return (
    <button
      type="button"
      style={{
        padding: PAD[size] || PAD.lg, fontSize: 12, borderRadius: RADIUS.control, cursor: "pointer",
        fontFamily: "inherit", fontWeight: 600, boxShadow: REST_SHADOW,
        border: `1px solid ${accent}`, background: accent, color: onAccent, ...style,
      }}
      {...rest}
    >{children}</button>
  );
}

function GhostButton({ size = "sm", style, children, ...rest }) {
  return (
    <button
      type="button"
      style={{
        padding: PAD[size] || PAD.sm, fontSize: FONT.sm, borderRadius: RADIUS.control, cursor: "pointer",
        fontFamily: "inherit", fontWeight: 600, boxShadow: REST_SHADOW,
        border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-primary)", ...style,
      }}
      {...rest}
    >{children}</button>
  );
}

function MiniIconButton({ title, danger, onClick, children, testid }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-testid={testid}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        flex: "0 0 auto", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: "none", borderRadius: RADIUS.control, background: "transparent", cursor: "pointer",
        color: danger ? "var(--danger-text)" : "var(--text-tertiary)", fontSize: 13, lineHeight: 1,
      }}
    >{children}</button>
  );
}

/** The row's own "Delete? ✓ ✕" — the app's normal confirm pattern (NotesTree.jsx's
 *  ConfirmDelete), mirrored here rather than imported (this component sits in its own lazy
 *  chunk; NotesTree.jsx's is a private, unexported piece of a different file). */
function ConfirmDeleteRow({ onYes, onNo }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: FONT.sm, color: "var(--text-secondary)" }}>Delete?</span>
      <MiniIconButton title="Confirm delete" danger onClick={onYes} testid="tpl-del-yes">✓</MiniIconButton>
      <MiniIconButton title="Keep it" onClick={onNo} testid="tpl-del-no">✕</MiniIconButton>
    </span>
  );
}

function TemplateRow({ t, selected, confirming, onSelect, onDuplicate, onBeginDelete, onConfirmDelete, onCancelDelete }) {
  return (
    <div
      data-testid={`tpl-row-${t.id}`}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", borderRadius: RADIUS.control,
        cursor: "pointer", background: selected ? "var(--accent-notes)" : "transparent",
        color: selected ? "var(--on-accent-notes)" : "var(--text-primary)",
      }}
    >
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 12, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {displayTemplateLabel(t.label)}
        </span>
        {t.description ? (
          <span style={{ fontSize: 10.5, opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t.description}
          </span>
        ) : null}
      </span>
      {confirming ? (
        <ConfirmDeleteRow onYes={onConfirmDelete} onNo={onCancelDelete} />
      ) : (
        <>
          <MiniIconButton title="Duplicate this template" onClick={(e) => { e.stopPropagation(); onDuplicate(); }} testid={`tpl-dup-${t.id}`}>⧉</MiniIconButton>
          <MiniIconButton title="Delete this template" danger onClick={(e) => { e.stopPropagation(); onBeginDelete(); }} testid={`tpl-del-${t.id}`}>✕</MiniIconButton>
        </>
      )}
    </div>
  );
}

export default function TemplateManager({
  templates = [], narrow = false, onClose, onCreate, onRename, onCommitLabel, onSaveBody, onDuplicate, onDelete,
}) {
  const [selectedId, setSelectedId] = useState(templates[0]?.id || null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [status, setStatus] = useState("saved");
  /* PHONE DRILL-IN — the same shape Notes.jsx itself uses (list OR detail, never a sliver of
   * each): starts on the list so opening "Manage templates" never launches straight into an
   * editor with no way back visible yet. */
  const [showList, setShowList] = useState(true);

  // A template deleted out from under the current selection (or the very first load) falls
  // back to whatever is first in the list, never a dangling id pointing at nothing.
  useEffect(() => {
    if (selectedId && templates.some((t) => t.id === selectedId)) return;
    setSelectedId(templates[0]?.id || null);
  }, [templates, selectedId]);

  const selected = templates.find((t) => t.id === selectedId) || null;

  // A save-state badge is per EDITOR INSTANCE (the editor below remounts by `key`
  // whenever the selection changes), so the header's copy of it must reset with it — never
  // carry template A's "Could not save" onto template B, which nobody has touched yet.
  useEffect(() => { setStatus("saved"); }, [selectedId]);

  const closeOnEscape = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose?.(); } };

  const selectRow = (id) => { setSelectedId(id); setConfirmingId(null); setShowList(false); };

  const createAndOpen = () => {
    const id = onCreate?.();
    if (id) { setSelectedId(id); setShowList(false); }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage templates"
      data-testid="notes-template-manager"
      onKeyDown={closeOnEscape}
      style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", flexDirection: "column", background: "var(--surface-page)" }}
    >
      <div style={{
        flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        padding: "10px 14px", borderBottom: "1px solid var(--border-default)",
      }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Manage templates</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* LOUD-FAILURE: a template body write that did not land is said out loud, not left
              to a silent editor with nothing here to notice it. */}
          {selected && status === "error" ? (
            <span role="alert" style={{ fontSize: FONT.sm, fontWeight: 650, color: "var(--danger-text)" }}>Could not save</span>
          ) : selected && status === "unsaved" ? (
            <span style={{ fontSize: FONT.sm, fontWeight: 600, color: "var(--text-tertiary)" }}>Saving…</span>
          ) : null}
          <GhostButton data-testid="notes-template-manager-close" onClick={onClose}>✕ Close</GhostButton>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div
          data-testid="notes-template-list"
          role="listbox"
          aria-label="Templates"
          style={{
            display: narrow ? (showList ? "flex" : "none") : "flex",
            width: narrow ? "100%" : 260, flex: narrow ? "1 1 auto" : "0 0 auto",
            flexDirection: "column", minHeight: 0, borderRight: narrow ? "none" : "1px solid var(--border-default)",
            padding: 8, gap: 6, overflow: "auto",
          }}
        >
          <PrimaryButton data-testid="tpl-new" onClick={createAndOpen} {...NOTES_ACCENT}>＋ New template</PrimaryButton>
          {templates.length === 0 ? (
            <p style={{ margin: "6px 2px", fontSize: 12, color: "var(--text-secondary)" }}>
              No templates yet — make one above, or save any page as a template from its right-click menu.
            </p>
          ) : templates.map((t) => (
            <TemplateRow
              key={t.id}
              t={t}
              selected={t.id === selectedId}
              confirming={confirmingId === t.id}
              onSelect={() => selectRow(t.id)}
              onDuplicate={() => { const id = onDuplicate?.(t.id); if (id) selectRow(id); }}
              onBeginDelete={() => setConfirmingId(t.id)}
              onConfirmDelete={() => { setConfirmingId(null); onDelete?.(t.id); }}
              onCancelDelete={() => setConfirmingId(null)}
            />
          ))}
        </div>

        <div style={{ display: narrow ? (showList ? "none" : "flex") : "flex", flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }}>
          {selected ? (
            <NoteEditor
              key={selected.id}
              pageId={`tpl:${selected.id}`}
              title={selected.label}
              onTitleChange={(v) => onRename?.(selected.id, v)}
              onTitleCommit={() => onCommitLabel?.(selected.id)}
              status={status}
              onStatus={setStatus}
              updatedAt={selected.updatedAt}
              notebookPageIds={[]}
              narrow={narrow}
              onBack={narrow ? () => setShowList(true) : undefined}
              loadDoc={() => selected.doc}
              saveDoc={(doc) => onSaveBody?.(selected.id, doc)}
            />
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
              <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Pick a template on the left, or make a new one.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
