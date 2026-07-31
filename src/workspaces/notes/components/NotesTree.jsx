/* NotesTree — the left rail: notebooks › sections › pages, plus search.
 *
 * NO DIALOG BOXES (house rule, CLAUDE.md → KEY DECISIONS). Renaming is an inline field
 * (Enter commits, Esc cancels) and deleting asks with an inline "Delete? ✓ ✕" row on the
 * row itself — never `window.prompt` / `confirm` / `alert`.
 *
 * Every component here is at MODULE SCOPE (MODULE-SCOPE-COMPONENTS): a component defined
 * inside another component's render body is a new type on every render, so React remounts
 * it and the inline rename field would lose focus on its own first keystroke.
 *
 * Chrome is theme tokens only — no literal colours in this file.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { visibleNotebooks } from "../lib/notesModel.js";

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar

const rowBase = {
  display: "flex", alignItems: "center", gap: 6, width: "100%",
  padding: "5px 8px", borderRadius: RADIUS.control, border: "1px solid transparent",
  background: "transparent", font: "inherit", fontSize: 13, textAlign: "left",
  color: "var(--text-primary)", cursor: "pointer", minWidth: 0,
};

/* ---- primitives ------------------------------------------------------------------------ */

function MiniButton({ title, onClick, children, testid, tone = "quiet" }) {
  return (
    <button
      type="button" title={title} aria-label={title} data-testid={testid}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      style={{
        flex: "0 0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 20, height: 20, padding: 0, borderRadius: RADIUS.control,
        border: "1px solid transparent", background: "transparent",
        color: tone === "danger" ? "var(--danger-text)" : "var(--text-tertiary)",
        font: "inherit", fontSize: 13, lineHeight: 1, cursor: "pointer",
      }}
    >{children}</button>
  );
}

/** Inline rename field. Enter commits, Esc cancels, blur commits. */
function RenameField({ value, onCommit, onCancel, testid }) {
  const [text, setText] = useState(value);
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (el) { el.focus(); el.select(); } }, []);
  return (
    <input
      ref={ref}
      data-testid={testid}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); onCommit(text); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
      onBlur={() => onCommit(text)}
      style={{
        flex: 1, minWidth: 0, height: 22, padding: "0 6px", borderRadius: RADIUS.control,
        border: "1px solid var(--accent-notes)", background: "var(--surface-raised)",
        color: "var(--text-primary)", font: "inherit", fontSize: 13,
      }}
    />
  );
}

/** Inline delete confirmation — replaces the row's controls with "Delete? ✓ ✕". */
function ConfirmDelete({ onYes, onNo, testid }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, flex: "0 0 auto" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--danger-text)" }}>Delete?</span>
      <MiniButton title="Confirm delete" tone="danger" testid={`${testid}-yes`} onClick={onYes}>✓</MiniButton>
      <MiniButton title="Keep it" testid={`${testid}-no`} onClick={onNo}>✕</MiniButton>
    </span>
  );
}

/* One row of the tree, at every depth. `kind` only changes weight and indent — the
 * rename / delete / add affordances behave identically, so they live in one place. */
function TreeRow({
  id, kind, title, depth, selected, expanded, hasChildren,
  editing, confirming, onToggle, onSelect, onBeginRename, onCommitRename, onCancelRename,
  onBeginDelete, onConfirmDelete, onCancelDelete, onAdd, addTitle, badge,
}) {
  const [hover, setHover] = useState(false);
  const weight = kind === "notebook" ? 700 : kind === "section" ? 600 : 500;
  return (
    <div
      data-testid={`notes-row-${id}`}
      data-kind={kind}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
      style={{
        ...rowBase,
        paddingLeft: 8 + depth * 13,
        fontWeight: weight,
        background: selected ? "var(--accent-notes)" : hover ? "var(--surface-page)" : "transparent",
        color: selected ? "var(--on-accent-notes)" : "var(--text-primary)",
        borderColor: selected ? "var(--accent-notes)" : "transparent",
      }}
    >
      {hasChildren ? (
        <MiniButton title={expanded ? "Collapse" : "Expand"} testid={`notes-toggle-${id}`} onClick={onToggle}>
          <span style={{ display: "inline-block", transform: expanded ? "rotate(90deg)" : "none", transition: "transform 90ms", color: "inherit" }}>▸</span>
        </MiniButton>
      ) : <span style={{ width: 20, flex: "0 0 auto" }} />}

      {editing ? (
        <RenameField value={title} testid={`notes-rename-${id}`} onCommit={onCommitRename} onCancel={onCancelRename} />
      ) : (
        <>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          {badge ? (
            <span style={{
              flex: "0 0 auto", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
              padding: "1px 6px", borderRadius: RADIUS.pill,
              border: "1px solid var(--border-default)",
              color: selected ? "var(--on-accent-notes)" : "var(--accent-notes-text)",
            }}>{badge}</span>
          ) : null}
          {confirming ? (
            <ConfirmDelete testid={`notes-del-${id}`} onYes={onConfirmDelete} onNo={onCancelDelete} />
          ) : hover ? (
            <span style={{ display: "inline-flex", gap: 1, flex: "0 0 auto" }}>
              {onAdd ? <MiniButton title={addTitle} testid={`notes-add-${id}`} onClick={onAdd}>＋</MiniButton> : null}
              <MiniButton title="Rename" testid={`notes-rn-${id}`} onClick={onBeginRename}>✎</MiniButton>
              <MiniButton title="Delete" tone="danger" testid={`notes-rm-${id}`} onClick={onBeginDelete}>🗑</MiniButton>
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

function SearchResults({ results, onSelectPage, query }) {
  if (!query) return null;
  if (!results.length) {
    return <p style={{ margin: "8px 10px", fontSize: 12, color: "var(--text-tertiary)" }}>No pages match “{query}”.</p>;
  }
  return (
    <div data-testid="notes-search-results" style={{ padding: "2px 6px 10px" }}>
      {results.map((r) => (
        <button
          key={r.pageId}
          type="button"
          data-testid={`notes-hit-${r.pageId}`}
          onClick={() => onSelectPage(r.pageId)}
          style={{ ...rowBase, flexDirection: "column", alignItems: "stretch", gap: 2, marginBottom: 2 }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.pageTitle}</span>
            <span style={{
              flex: "0 0 auto", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
              color: "var(--accent-notes-text)",
            }}>{r.where === "body" ? "in text" : "title"}</span>
          </span>
          <span style={{ fontSize: 11, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.notebookTitle} · {r.sectionTitle}
          </span>
          {r.excerpt ? (
            <span style={{ fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.excerpt}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ---- the rail --------------------------------------------------------------------------- */

export default function NotesTree({
  tree, projectId, activePageId, query, results,
  onQueryChange, onSelectPage, onAddNotebook, onAddSection, onAddPage,
  onRename, onDelete, onExportNotebook,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [editingId, setEditingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);

  const notebooks = useMemo(() => visibleNotebooks(tree, projectId), [tree, projectId]);

  const isOpen = (id) => !collapsed.has(id);
  const toggle = (id) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const commitRename = (id, text) => { setEditingId(null); onRename(id, text); };
  const confirmDelete = (id) => { setConfirmingId(null); onDelete(id); };

  const rowProps = (id) => ({
    editing: editingId === id,
    confirming: confirmingId === id,
    onBeginRename: () => { setConfirmingId(null); setEditingId(id); },
    onCommitRename: (t) => commitRename(id, t),
    onCancelRename: () => setEditingId(null),
    onBeginDelete: () => { setEditingId(null); setConfirmingId(id); },
    onConfirmDelete: () => confirmDelete(id),
    onCancelDelete: () => setConfirmingId(null),
  });

  return (
    <div
      data-testid="notes-tree"
      style={{
        width: 268, flex: "0 0 auto", display: "flex", flexDirection: "column", minHeight: 0,
        borderRight: "1px solid var(--border-default)", background: "var(--surface-raised)",
      }}
    >
      <div style={{ padding: "9px 9px 7px", borderBottom: "1px solid var(--border-default)", display: "flex", flexDirection: "column", gap: 7 }}>
        <input
          data-testid="notes-search"
          value={query}
          placeholder="Search notes…"
          aria-label="Search notes"
          onChange={(e) => onQueryChange(e.target.value)}
          style={{
            height: 28, padding: "0 9px", borderRadius: RADIUS.control,
            border: "1px solid var(--border-default)", background: "var(--surface-page)",
            color: "var(--text-primary)", font: "inherit", fontSize: 13,
          }}
        />
        <button
          type="button"
          data-testid="notes-new-notebook"
          onClick={() => onAddNotebook()}
          style={{
            height: 28, borderRadius: RADIUS.control, border: "1px solid var(--accent-notes)",
            background: "var(--accent-notes)", color: "var(--on-accent-notes)",
            font: "inherit", fontSize: 13, fontWeight: 650, cursor: "pointer",
          }}
        >＋ New notebook</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "6px 6px 14px" }}>
        {query ? (
          <SearchResults results={results} query={query} onSelectPage={onSelectPage} />
        ) : notebooks.length === 0 ? (
          <p style={{ margin: "10px 8px", fontSize: 12.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
            No notebooks yet. Make one — it starts with a page ready to type in.
          </p>
        ) : notebooks.map((nb) => (
          <div key={nb.id} style={{ marginBottom: 3 }}>
            <TreeRow
              id={nb.id} kind="notebook" title={nb.title} depth={0}
              hasChildren expanded={isOpen(nb.id)} onToggle={() => toggle(nb.id)}
              onSelect={() => toggle(nb.id)}
              onAdd={() => onAddSection(nb.id)} addTitle="Add section"
              badge={nb.projectId == null ? "Loose" : null}
              {...rowProps(nb.id)}
            />
            {isOpen(nb.id) && (
              <>
                {(nb.sections || []).map((sec) => (
                  <div key={sec.id}>
                    <TreeRow
                      id={sec.id} kind="section" title={sec.title} depth={1}
                      hasChildren expanded={isOpen(sec.id)} onToggle={() => toggle(sec.id)}
                      onSelect={() => toggle(sec.id)}
                      onAdd={() => onAddPage(sec.id)} addTitle="Add page"
                      {...rowProps(sec.id)}
                    />
                    {isOpen(sec.id) && (sec.pages || []).map((pg) => (
                      <TreeRow
                        key={pg.id} id={pg.id} kind="page" title={pg.title} depth={2}
                        selected={pg.id === activePageId}
                        onSelect={() => onSelectPage(pg.id)}
                        {...rowProps(pg.id)}
                      />
                    ))}
                  </div>
                ))}
                <button
                  type="button"
                  data-testid={`notes-export-${nb.id}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onExportNotebook(nb.id)}
                  style={{
                    ...rowBase, paddingLeft: 21, fontSize: 12, color: "var(--text-tertiary)",
                    cursor: "pointer",
                  }}
                >↓ Export notebook to Markdown</button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
