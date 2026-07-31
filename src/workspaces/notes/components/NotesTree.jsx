/* NotesTree — the left rail: notebooks › sections › pages, plus search, Recent and the Bin.
 *
 * NO DIALOG BOXES (house rule, CLAUDE.md → KEY DECISIONS). Renaming is an inline field
 * (Enter commits, Esc cancels), deleting asks with an inline "Delete? ✓ ✕" row on the row
 * itself, and MOVING is an inline panel that opens under the row — never `window.prompt` /
 * `confirm` / `alert`.
 *
 * ⛔ THE RAIL SHOWS NAMES. ACTIONS ARE ON A RIGHT-CLICK MENU (B1367).
 * Every row used to sprout four controls the moment the pointer crossed it — ＋ ✎ ⇅ 🗑 —
 * plus a ↓ Markdown / ⎙ Print pair repeated under EVERY notebook, duplicating the toolbar's
 * own two buttons. Owner: "I don't know that I like the hover and then add section, rename,
 * move, delete. We should get rid of that… Delete should be, like, a right click type
 * thing." So the row now renders its name (and, on a page, when it was edited) and nothing
 * else; Add / Rename / Move / Export / Delete live on a context menu opened by right-click.
 * The house rules survive the move intact: Rename still opens the INLINE field, Delete still
 * asks inline and still BINS rather than destroys, and the menu is reachable from the
 * keyboard (see `openMenuFromKeyboard`) so this is not a mouse-only product.
 *
 * ⛔ AND THE KEYBOARD DOES NOT DESTROY WHAT THE MOUSE IS MERELY OVER (B1366).
 * A row's key handler answers Enter/Space (select) and the context-menu keys, and NOTHING
 * else — Delete and Backspace are deliberately, permanently unhandled here. Hovering is not
 * intent; a destructive key that acts on whatever the pointer happens to be near is a way to
 * lose a notebook by resting your hand on the desk. The 30-day bin (B1310) still catches it,
 * but a bin is a safety net, not a licence. `ui-audit/verify-notes.mjs` presses Delete over
 * a hovered row and asserts the tree is untouched, so this can never quietly grow back.
 *
 * ⛔ MOVE IS REACHABLE (B1316). `notesModel` has exported `movePage` / `moveSection` /
 * `moveNotebook` since the module shipped, fully unit-tested across a dozen cases — and NO
 * component called any of them. The tests passed and proved nothing a user could do: a page
 * could not be reordered, moved to another section, or moved to another notebook. Every one
 * of the three is now wired to the ⇅ control on its row, so the unit tests describe real
 * behaviour instead of decorating it.
 *
 * Every component here is at MODULE SCOPE (MODULE-SCOPE-COMPONENTS): a component defined
 * inside another component's render body is a new type on every render, so React remounts
 * it and the inline rename field would lose focus on its own first keystroke.
 *
 * Chrome is theme tokens only — no literal colours in this file.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { recentPages, trashEntries, visibleNotebooks } from "../lib/notesModel.js";
import { absoluteStamp, daysLeft, relativeTime } from "../lib/notesTime.js";

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar

const rowBase = {
  display: "flex", alignItems: "center", gap: 6, width: "100%",
  padding: "5px 8px", borderRadius: RADIUS.control, border: "1px solid transparent",
  background: "transparent", font: "inherit", fontSize: 13, textAlign: "left",
  color: "var(--text-primary)", cursor: "pointer", minWidth: 0,
};

const VIEWS = [
  { id: "tree", label: "Notebooks" },
  { id: "recent", label: "Recent" },
  { id: "bin", label: "Bin" },
];

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

/** The inline MOVE panel — reorder within the parent, or pick a new parent.
 *
 *  Reorder and re-parent are the same panel because they are the same intent ("put this
 *  somewhere else") and splitting them would double the number of controls on a row that
 *  already has four. A notebook has no parent, so it gets the reorder half only. */
function MovePanel({ kind, depth, destinations, onReorder, onMoveTo, onClose, testid }) {
  return (
    <div
      data-testid={testid}
      onClick={(e) => e.stopPropagation()}
      style={{
        margin: "2px 6px 6px", marginLeft: 8 + depth * 13, padding: 7,
        borderRadius: RADIUS.control, border: "1px solid var(--accent-notes)",
        background: "var(--surface-page)", display: "flex", flexDirection: "column", gap: 5,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <button
          type="button" data-testid={`${testid}-up`} onMouseDown={(e) => e.preventDefault()}
          onClick={() => onReorder(-1)}
          style={{ ...rowBase, width: "auto", padding: "3px 9px", fontSize: 12, fontWeight: 650, border: "1px solid var(--border-default)", background: "var(--surface-raised)" }}
        >↑ Up</button>
        <button
          type="button" data-testid={`${testid}-down`} onMouseDown={(e) => e.preventDefault()}
          onClick={() => onReorder(1)}
          style={{ ...rowBase, width: "auto", padding: "3px 9px", fontSize: 12, fontWeight: 650, border: "1px solid var(--border-default)", background: "var(--surface-raised)" }}
        >↓ Down</button>
        <span style={{ flex: 1 }} />
        <MiniButton title="Close" testid={`${testid}-close`} onClick={onClose}>✕</MiniButton>
      </div>

      {destinations.length > 0 && (
        <>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
            {kind === "page" ? "Move to section" : "Move to notebook"}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 168, overflow: "auto" }}>
            {destinations.map((d) => (
              <button
                key={d.id}
                type="button"
                data-testid={`${testid}-to-${d.id}`}
                disabled={d.current}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onMoveTo(d.id)}
                style={{
                  ...rowBase, fontSize: 12, padding: "4px 7px",
                  opacity: d.current ? 0.45 : 1, cursor: d.current ? "default" : "pointer",
                  color: "var(--text-primary)",
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
                {d.current ? <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)" }}>HERE</span> : null}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The row context menu (B1367) — where every row action now lives.
 *
 *  Positioned at the pointer and flipped back inside the viewport when it would hang off the
 *  bottom or the right. It closes on Escape, on an outside press and on a pick; arrow keys
 *  walk it and Enter chooses, so the menu is fully usable without a mouse. It is NOT a
 *  dialog: nothing is modal, nothing blocks, and picking Rename opens the inline field on
 *  the row rather than a box (house rule). */
function RowMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    const first = ref.current?.querySelector("button");
    if (first) first.focus();
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey, true); };
  }, [onClose]);

  const step = (e, d) => {
    const btns = [...(ref.current?.querySelectorAll("button") || [])];
    if (!btns.length) return;
    e.preventDefault();
    const i = btns.indexOf(document.activeElement);
    btns[(i + d + btns.length) % btns.length].focus();
  };

  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const height = items.length * 27 + 12;

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="notes-row-menu"
      onKeyDown={(e) => { if (e.key === "ArrowDown") step(e, 1); if (e.key === "ArrowUp") step(e, -1); }}
      style={{
        position: "fixed", zIndex: 60,
        left: Math.min(x, Math.max(8, vw - 208)),
        top: Math.min(y, Math.max(8, vh - height - 8)),
        minWidth: 196, padding: "5px 0",
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: RADIUS.control, boxShadow: "0 14px 36px rgba(0,0,0,0.22)",
        display: "flex", flexDirection: "column",
      }}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="menuitem"
          data-testid={`notes-menu-${it.id}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { onClose(); it.onPick(); }}
          style={{
            ...rowBase, borderRadius: 0, padding: "5px 12px", fontSize: 12.5, fontWeight: 600,
            color: it.danger ? "var(--danger-text)" : "var(--text-primary)",
          }}
        >{it.label}</button>
      ))}
    </div>
  );
}

/* One row of the tree, at every depth. `kind` only changes weight and indent.
 *
 * The row renders its NAME and nothing else (B1367) — no hover controls. Its actions come
 * from the context menu, which right-click opens and which the keyboard reaches through the
 * dedicated context-menu key or Shift+F10. Delete/Backspace are deliberately not handled
 * (B1366): see this file's header. */
function TreeRow({
  id, kind, title, depth, selected, expanded, hasChildren,
  editing, confirming, onToggle, onSelect, onCommitRename, onCancelRename,
  onConfirmDelete, onCancelDelete, badge, stamp, onMenu,
}) {
  const [hover, setHover] = useState(false);
  const ref = useRef(null);
  const weight = kind === "notebook" ? 700 : kind === "section" ? 600 : 500;

  /* The keyboard route to the same menu. `ContextMenu` is the dedicated key on a PC
   * keyboard; Shift+F10 is the chord every desktop platform honours for it. Anchored to the
   * row's own box, because there is no pointer to anchor to. */
  const openMenuFromKeyboard = (e) => {
    const box = ref.current?.getBoundingClientRect();
    e.preventDefault();
    onMenu({ x: (box?.left ?? 0) + 24, y: (box?.bottom ?? 0) });
  };

  return (
    <div
      ref={ref}
      data-testid={`notes-row-${id}`}
      data-kind={kind}
      role="treeitem"
      tabIndex={0}
      aria-selected={!!selected}
      aria-expanded={hasChildren ? !!expanded : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
      onContextMenu={(e) => { e.preventDefault(); onMenu({ x: e.clientX, y: e.clientY }); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); return; }
        if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) openMenuFromKeyboard(e);
        // Everything else — Delete and Backspace above all — falls through UNHANDLED, on
        // purpose. See the header: a key must not destroy the row the pointer is over.
      }}
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
          ) : stamp ? (
            <span
              data-testid={`notes-when-${id}`}
              title={stamp.title}
              style={{ flex: "0 0 auto", fontSize: 10.5, fontWeight: 600, color: selected ? "var(--on-accent-notes)" : "var(--text-tertiary)" }}
            >{stamp.text}</span>
          ) : null}
        </>
      )}
    </div>
  );
}

function SearchResults({ results, onSelectHit, query }) {
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
          onClick={() => onSelectHit(r.pageId)}
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

/** Pages by when they were last touched — the answer to "the note I was in yesterday",
 *  which before timestamps existed could only be answered by remembering its name. */
function RecentList({ pages, activePageId, onSelectPage }) {
  if (!pages.length) {
    return <p style={{ margin: "10px 8px", fontSize: 12.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>No pages yet.</p>;
  }
  return (
    <div data-testid="notes-recent-list" style={{ padding: "2px 6px 10px" }}>
      {pages.map((p) => (
        <button
          key={p.pageId}
          type="button"
          data-testid={`notes-recent-${p.pageId}`}
          onClick={() => onSelectPage(p.pageId)}
          style={{
            ...rowBase, flexDirection: "column", alignItems: "stretch", gap: 1, marginBottom: 2,
            background: p.pageId === activePageId ? "var(--accent-notes)" : "transparent",
            color: p.pageId === activePageId ? "var(--on-accent-notes)" : "var(--text-primary)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.pageTitle}</span>
            <span title={absoluteStamp(p.updatedAt)} style={{ flex: "0 0 auto", fontSize: 10.5, fontWeight: 600, color: p.pageId === activePageId ? "var(--on-accent-notes)" : "var(--text-tertiary)" }}>
              {relativeTime(p.updatedAt)}
            </span>
          </span>
          <span style={{ fontSize: 11, color: p.pageId === activePageId ? "var(--on-accent-notes)" : "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {p.notebookTitle} · {p.sectionTitle}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Recently deleted. Restore puts it back where it came from; Delete forever is the ONLY
 *  place in the module where a note's bytes are actually destroyed. */
function BinList({ entries, onRestore, onPurge, onPurgeAll }) {
  if (!entries.length) {
    return (
      <p style={{ margin: "10px 8px", fontSize: 12.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
        Nothing deleted. Anything you delete waits here for 30 days before it is cleared.
      </p>
    );
  }
  return (
    <div data-testid="notes-bin-list" style={{ padding: "2px 6px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
      {entries.map((e) => (
        <div
          key={e.id}
          data-testid={`notes-bin-${e.id}`}
          style={{
            padding: "6px 8px", borderRadius: RADIUS.control,
            border: "1px solid var(--border-default)", background: "var(--surface-page)",
            display: "flex", flexDirection: "column", gap: 3,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 650, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.title || "Untitled"}
            </span>
            <span style={{ flex: "0 0 auto", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--accent-notes-text)" }}>{e.kind || "item"}</span>
          </span>
          <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
            {e.pageIds.length === 1 ? "1 page" : `${e.pageIds.length} pages`} · deleted {relativeTime(e.deletedAt) || "recently"} · {daysLeft(e.expiresAt)}
          </span>
          <span style={{ display: "flex", gap: 5 }}>
            <button
              type="button"
              data-testid={`notes-bin-restore-${e.id}`}
              disabled={!e.restorable}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => onRestore(e.id)}
              style={{
                ...rowBase, width: "auto", padding: "3px 10px", fontSize: 12, fontWeight: 650,
                border: "1px solid var(--accent-notes)", background: "var(--accent-notes)",
                color: "var(--on-accent-notes)", opacity: e.restorable ? 1 : 0.5,
                cursor: e.restorable ? "pointer" : "default",
              }}
            >Restore</button>
            <button
              type="button"
              data-testid={`notes-bin-purge-${e.id}`}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => onPurge(e.id)}
              style={{
                ...rowBase, width: "auto", padding: "3px 10px", fontSize: 12, fontWeight: 650,
                border: "1px solid var(--border-default)", color: "var(--danger-text)",
              }}
            >Delete forever</button>
          </span>
        </div>
      ))}
      <button
        type="button"
        data-testid="notes-bin-empty"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onPurgeAll}
        style={{ ...rowBase, justifyContent: "center", fontSize: 12, fontWeight: 650, color: "var(--danger-text)", border: "1px solid var(--border-default)" }}
      >Empty the bin</button>
    </div>
  );
}

function ViewTabs({ view, onView, binCount }) {
  return (
    <div role="tablist" aria-label="Notes view" style={{ display: "flex", gap: 3 }}>
      {VIEWS.map((v) => {
        const on = view === v.id;
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={on}
            data-testid={`notes-view-${v.id}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onView(v.id)}
            style={{
              flex: 1, height: 24, borderRadius: RADIUS.control, cursor: "pointer",
              border: `1px solid ${on ? "var(--accent-notes)" : "var(--border-default)"}`,
              background: on ? "var(--accent-notes)" : "transparent",
              color: on ? "var(--on-accent-notes)" : "var(--text-secondary)",
              font: "inherit", fontSize: 11.5, fontWeight: 650,
            }}
          >{v.label}{v.id === "bin" && binCount ? ` ${binCount}` : ""}</button>
        );
      })}
    </div>
  );
}

/* ---- the rail --------------------------------------------------------------------------- */

export default function NotesTree({
  tree, projectId, activePageId, query, results,
  onQueryChange, onSelectPage, onSelectHit, onAddNotebook, onAddSection, onAddPage,
  onRename, onDelete, onExportNotebook, onPrintNotebook,
  onMovePage, onMoveSection, onMoveNotebook, onRestore, onPurge, onPurgeAll,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [editingId, setEditingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [movingId, setMovingId] = useState(null);
  const [view, setView] = useState("tree");
  // The open context menu: { id, x, y, items }. One at a time, by construction.
  const [menu, setMenu] = useState(null);

  const notebooks = useMemo(() => visibleNotebooks(tree, projectId), [tree, projectId]);
  const bin = useMemo(() => trashEntries(tree), [tree]);
  const recent = useMemo(() => (view === "recent" ? recentPages(tree, { projectId }) : []), [view, tree, projectId]);

  const isOpen = (id) => !collapsed.has(id);
  const toggle = (id) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const commitRename = (id, text) => { setEditingId(null); onRename(id, text); };
  const confirmDelete = (id) => { setConfirmingId(null); onDelete(id); };

  const beginRename = (id) => { setConfirmingId(null); setMovingId(null); setEditingId(id); };
  const beginDelete = (id) => { setEditingId(null); setMovingId(null); setConfirmingId(id); };
  const beginMove = (id) => { setEditingId(null); setConfirmingId(null); setMovingId((m) => (m === id ? null : id)); };

  /* Everything a row can do, in one place, ordered by how often it is wanted and with the
   * destructive one last and marked. `extra` is the per-kind head of the list (Add section /
   * Add page / the notebook's two exports); Rename · Move · Delete are common to all three
   * kinds, which is why they are built here rather than per call site. */
  const rowProps = (id, { extra = [] } = {}) => ({
    editing: editingId === id,
    confirming: confirmingId === id,
    onCommitRename: (t) => commitRename(id, t),
    onCancelRename: () => setEditingId(null),
    onConfirmDelete: () => confirmDelete(id),
    onCancelDelete: () => setConfirmingId(null),
    onMenu: ({ x, y }) => setMenu({
      id,
      x,
      y,
      items: [
        ...extra,
        { id: `rn-${id}`, label: "Rename", onPick: () => beginRename(id) },
        { id: `mv-${id}`, label: "Move…", onPick: () => beginMove(id) },
        { id: `rm-${id}`, label: "Delete", danger: true, onPick: () => beginDelete(id) },
      ],
    }),
  });

  /* Where a page or a section may go. Built from the WHOLE tree rather than the visible
   * subset: moving a page into a notebook this project cannot see would make it vanish, so
   * the destinations offered are exactly the ones that stay reachable from here. */
  const pageDestinations = (currentSectionId) => notebooks.flatMap((nb) =>
    (nb.sections || []).map((s) => ({ id: s.id, label: `${nb.title} › ${s.title}`, current: s.id === currentSectionId })));
  const sectionDestinations = (currentNotebookId) => notebooks
    .map((nb) => ({ id: nb.id, label: nb.title, current: nb.id === currentNotebookId }));

  const indexOfPage = (sec, pageId) => (sec.pages || []).findIndex((p) => p.id === pageId);

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
          /* Esc clears the query and gives the tree back. It used to do nothing at all,
             which left the only way out of a search as selecting the text and deleting it. */
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            onQueryChange("");
          }}
          style={{
            height: 28, padding: "0 9px", borderRadius: RADIUS.control,
            border: "1px solid var(--border-default)", background: "var(--surface-page)",
            color: "var(--text-primary)", font: "inherit", fontSize: 13,
          }}
        />
        <ViewTabs view={view} onView={(v) => { setView(v); onQueryChange(""); }} binCount={bin.length} />
        <button
          type="button"
          data-testid="notes-new-notebook"
          onClick={() => { setView("tree"); onAddNotebook(); }}
          style={{
            height: 28, borderRadius: RADIUS.control, border: "1px solid var(--accent-notes)",
            background: "var(--accent-notes)", color: "var(--on-accent-notes)",
            font: "inherit", fontSize: 13, fontWeight: 650, cursor: "pointer",
          }}
        >＋ New notebook</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "6px 6px 14px" }}>
        {query ? (
          <SearchResults results={results} query={query} onSelectHit={onSelectHit} />
        ) : view === "recent" ? (
          <RecentList pages={recent} activePageId={activePageId} onSelectPage={onSelectPage} />
        ) : view === "bin" ? (
          <BinList entries={bin} onRestore={onRestore} onPurge={onPurge} onPurgeAll={onPurgeAll} />
        ) : notebooks.length === 0 ? (
          <p style={{ margin: "10px 8px", fontSize: 12.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
            No notebooks yet. Make one — it starts with a page ready to type in.
          </p>
        ) : notebooks.map((nb, nbIdx) => (
          <div key={nb.id} style={{ marginBottom: 3 }}>
            <TreeRow
              id={nb.id} kind="notebook" title={nb.title} depth={0}
              hasChildren expanded={isOpen(nb.id)} onToggle={() => toggle(nb.id)}
              onSelect={() => toggle(nb.id)}
              badge={nb.projectId == null ? "Loose" : null}
              {...rowProps(nb.id, {
                /* The notebook's exports moved HERE from a pair of links repeated under
                   every notebook in the rail (B1365). They are notebook-level (the toolbar's
                   Print / Markdown are page-level), so they are kept — just not printed
                   twice per notebook on a surface whose job is showing names. */
                extra: [
                  { id: `add-${nb.id}`, label: "Add section", onPick: () => onAddSection(nb.id) },
                  { id: `md-${nb.id}`, label: "Export notebook to Markdown", onPick: () => onExportNotebook(nb.id) },
                  { id: `print-${nb.id}`, label: "Print notebook / save as PDF", onPick: () => onPrintNotebook(nb.id) },
                ],
              })}
            />
            {movingId === nb.id && (
              <MovePanel
                kind="notebook" depth={0} destinations={[]} testid={`notes-move-${nb.id}`}
                onReorder={(d) => onMoveNotebook(nb.id, nbIdx + d)}
                onMoveTo={() => {}}
                onClose={() => setMovingId(null)}
              />
            )}
            {isOpen(nb.id) && (
              <>
                {(nb.sections || []).map((sec, secIdx) => (
                  <div key={sec.id}>
                    <TreeRow
                      id={sec.id} kind="section" title={sec.title} depth={1}
                      hasChildren expanded={isOpen(sec.id)} onToggle={() => toggle(sec.id)}
                      onSelect={() => toggle(sec.id)}
                      {...rowProps(sec.id, { extra: [{ id: `add-${sec.id}`, label: "Add page", onPick: () => onAddPage(sec.id) }] })}
                    />
                    {movingId === sec.id && (
                      <MovePanel
                        kind="section" depth={1} destinations={sectionDestinations(nb.id)} testid={`notes-move-${sec.id}`}
                        onReorder={(d) => onMoveSection(sec.id, nb.id, secIdx + d)}
                        onMoveTo={(toId) => { onMoveSection(sec.id, toId, 9999); setMovingId(null); }}
                        onClose={() => setMovingId(null)}
                      />
                    )}
                    {isOpen(sec.id) && (sec.pages || []).map((pg) => (
                      <div key={pg.id}>
                        <TreeRow
                          id={pg.id} kind="page" title={pg.title} depth={2}
                          selected={pg.id === activePageId}
                          onSelect={() => onSelectPage(pg.id)}
                          stamp={relativeTime(pg.updatedAt) ? { text: relativeTime(pg.updatedAt), title: `Edited ${absoluteStamp(pg.updatedAt)}` } : null}
                          {...rowProps(pg.id)}
                        />
                        {movingId === pg.id && (
                          <MovePanel
                            kind="page" depth={2} destinations={pageDestinations(sec.id)} testid={`notes-move-${pg.id}`}
                            onReorder={(d) => onMovePage(pg.id, sec.id, indexOfPage(sec, pg.id) + d)}
                            onMoveTo={(toId) => { onMovePage(pg.id, toId, 9999); setMovingId(null); }}
                            onClose={() => setMovingId(null)}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {/* ⛔ The per-notebook "↓ Markdown / ⎙ Print / PDF" pair that used to sit
                    here is GONE (B1365) — two links repeated under every notebook in the
                    rail, duplicating the toolbar's own Print and Markdown buttons. They now
                    live on the notebook's context menu, so nothing is lost and the rail
                    reads as a list of names again. Do not put them back. */}
              </>
            )}
          </div>
        ))}
      </div>

      {menu && <RowMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
