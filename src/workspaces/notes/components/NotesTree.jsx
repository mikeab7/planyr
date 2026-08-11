/* NotesTree — the left rail: PAGES THAT HOLD PAGES, plus search and the Bin.
 *
 * ⛔ TWO CONCEPTS, NOT FOUR (B1420). A project, and pages that can hold subpages. There is no
 * notebook row and no section row — "Entitlements" is a page that has pages under it, drawn
 * by the SAME component at a deeper indent. If a change here starts wanting a `kind` prop
 * back, that is the wrong branch: see the header of lib/notesModel.js.
 *
 * ⛔ WHAT THE RAIL SHOWS, BY WHERE YOU ARE STANDING.
 *   • INSIDE A PROJECT — that project's pages, nested, and **no project badge on any row**.
 *     Everything on screen belongs to where you are standing, so a badge has nothing to say;
 *     one on every row was pure noise (PANEL-BREVITY).
 *   • FROM THE DASHBOARD — every project's pages, GROUPED under the project's name, with a
 *     "Not in a project" group last. That heading is the ONE place a project label belongs.
 *
 * ⛔ AND IT OPENS THE PATH TO THE PAGE YOU ARE ON — NOT EVERY BRANCH AT ONCE. The owner's
 * screenshot was fourteen rows to find six pages. Collapsed is the default; the ancestors of
 * the open page are expanded, and anything you open by hand STAYS open. Never auto-collapse
 * a branch the user opened — that is a rail arguing with its reader.
 *
 * NO DIALOG BOXES (house rule, CLAUDE.md → KEY DECISIONS). Renaming is an inline field (Enter
 * commits, Esc cancels), deleting asks with an inline "Delete? ✓ ✕" row on the row itself,
 * and moving is an inline panel that opens under the row — never `window.prompt` / `confirm`
 * / `alert`.
 *
 * ⛔ THE RAIL SHOWS NAMES. ACTIONS ARE ON A RIGHT-CLICK MENU (B1367). A row renders its name
 * and nothing else — no hover controls, and (B1420) **no timestamp column either**: the time
 * was on every page row permanently and the owner read straight past it. It survives as the
 * row's hover title, which costs the default view nothing. (B36050 then removed the Recent
 * view as well — see the VIEWS note for why the hover is deliberately the whole of it now.)
 *
 * ⛔ AND THE KEYBOARD DOES NOT DESTROY WHAT THE MOUSE IS MERELY OVER (B1366). A row's key
 * handler answers Enter/Space (select), Left/Right (collapse/expand) and the context-menu
 * keys, and NOTHING else — Delete and Backspace are deliberately, permanently unhandled.
 * Hovering is not intent. `ui-audit/verify-notes.mjs` presses Delete over a hovered row and
 * asserts the tree is untouched, so this can never quietly grow back.
 *
 * DRAG TO NEST (B1420). Dragging one row onto another files it under that page; dragging onto
 * a project's group heading lifts it back to the top level of that project. The model REFUSES
 * a move into the dragged page's own subtree (that would detach the branch from the tree), so
 * the drop target simply does not light up for one.
 *
 * Every component here is at MODULE SCOPE (MODULE-SCOPE-COMPONENTS): a component defined
 * inside another component's render body is a new type on every render, so React remounts it
 * and the inline rename field would lose focus on its own first keystroke.
 *
 * Chrome is theme tokens only — no literal colours in this file.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ancestorIds, boundProjectIds, descendantPageIds, findPage, pagesInScope, projectGroups,
  subpagesPhrase, subtreePageIds, trashEntries,
  NO_PROJECT_LABEL, SCOPE_ALL, SCOPE_PROJECT,
} from "../lib/notesModel.js";
import { absoluteStamp, daysLeft } from "../lib/notesTime.js";
import { QUICK_OPEN_KEY } from "../lib/notesQuickOpen.js";

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar
const INDENT = 13;

const rowBase = {
  display: "flex", alignItems: "center", gap: 6, width: "100%",
  padding: "5px 8px", borderRadius: RADIUS.control, border: "1px solid transparent",
  background: "transparent", font: "inherit", fontSize: 13, textAlign: "left",
  color: "var(--text-primary)", cursor: "pointer", minWidth: 0,
};

/* "Notebooks" stopped being true the moment the notebook stopped existing (B1420), and the
 * Bin's permanent count went with it — advertising how many deleted things you have is noise,
 * not information. The count lives INSIDE the Bin view, where it is the point.
 *
 * ⛔ AND **RECENT** IS GONE (B36050). Owner, verbatim: *"I don't think I need a recent
 * option."* Two segments, not three.
 *
 * ⛔ THE CONSEQUENCE, DECIDED RATHER THAN DISCOVERED. B1420 took the timestamp off every page
 * row and named Recent as its home. With Recent gone the only recency signal left is the
 * row's hover title — and that is the RIGHT amount, deliberately: the owner has now removed
 * BOTH surfaces that showed dates, which is a clear statement that a date on a note is not
 * something he navigates by. Putting the column back to compensate would be answering a
 * removal with the thing that was removed before it. **The data is NOT orphaned:**
 * `createdAt` / `updatedAt` stay on every page node, `touchPage` still stamps them, they
 * still ride the cloud sync, `recentPages` is still exported and unit-tested, and the hover
 * still reads them. Nothing has to be migrated to bring a Recent view back if he ever wants
 * one — it is a component, not a schema.
 *
 * ⛔ AND **TASKS** IS BACK TO THREE (NEW-4), which is not a reversal of the above. Recent
 * was removed because it re-sorted the SAME pages by a fact the owner does not navigate by;
 * this shows something no other surface in the module can show at all — every unticked
 * checklist line in every note, which is otherwise trapped one note at a time. It earns a
 * segment because without it the information does not exist anywhere. */
const VIEWS = [
  { id: "tree", label: "Pages" },
  { id: "tasks", label: "Tasks" },
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
function ConfirmDelete({ onYes, onNo, testid, count }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, flex: "0 0 auto" }}>
      {/* ⛔ THE NUMBER NAMES WHAT ELSE GOES, NEVER THE PAGE YOU CLICKED (NEW-4). It used to
          render the whole cascade set, which includes this page — so one page with one child
          asked "Delete 2?". A count that is wrong in the alarming direction is how somebody
          is led to believe they lost something they did not. */}
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--danger-text)" }}>
        {count > 0 ? `Delete + ${subpagesPhrase(count).replace("its ", "")}?` : "Delete?"}
      </span>
      <MiniButton title="Confirm delete" tone="danger" testid={`${testid}-yes`} onClick={onYes}>✓</MiniButton>
      <MiniButton title="Keep it" testid={`${testid}-no`} onClick={onNo}>✕</MiniButton>
    </span>
  );
}

/** The inline MOVE panel — reorder among siblings, or pick a new parent.
 *
 *  Reorder and re-parent are the same panel because they are the same intent ("put this
 *  somewhere else"). Every destination is a PAGE now (or the top level), which is what
 *  collapsing the hierarchy bought: one list instead of one per level. */
function MovePanel({ depth, destinations, onReorder, onMoveTo, onClose, testid }) {
  return (
    <div
      data-testid={testid}
      onClick={(e) => e.stopPropagation()}
      style={{
        margin: "2px 6px 6px", marginLeft: 8 + depth * INDENT, padding: 7,
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
            File under
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 168, overflow: "auto" }}>
            {destinations.map((d) => (
              <button
                key={d.id}
                type="button"
                data-testid={`${testid}-to-${d.id}`}
                disabled={d.current}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onMoveTo(d.value)}
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

/** WHICH PROJECT THIS PAGE BELONGS TO — an inline panel, never a dialog (B1374, B1420).
 *
 *  Only a TOP-LEVEL page can be re-filed: a subpage's project is its parent's, derived, so
 *  offering it here would be offering a state the model cannot hold. Deliberately the same
 *  shape as the Move panel — it opens under the row, lists destinations with the current one
 *  marked, and closes on a pick. */
function ProjectPanel({ projects, currentProjectId, boundTo, onBind, onClose, testid }) {
  const rows = [
    { id: "__none__", label: NO_PROJECT_LABEL, current: boundTo == null, value: null },
    ...projects.map((p) => ({
      id: p.id,
      label: p.id === currentProjectId ? `${p.name} (this project)` : (p.name || `Unknown project (${p.id})`),
      current: boundTo === p.id,
      value: p.id,
    })),
  ];
  /* THE PROJECT YOU ARE STANDING IN IS ALWAYS OFFERED, even when the project list has not
   * resolved it — a fresh device that went straight to Notes has an empty project cache, and
   * "file this here" must not depend on a lookup succeeding. */
  if (currentProjectId && !projects.some((p) => p.id === currentProjectId)) {
    rows.splice(1, 0, { id: currentProjectId, label: "This project", current: boundTo === currentProjectId, value: currentProjectId });
  }
  /* A binding whose project this device cannot resolve — deleted, or belonging to an account
   * that is not signed in — is shown AS ITSELF rather than silently dropped. The user has to
   * be able to see the state they are in before they can change it. And NOT when it is the
   * project you are standing in, which the row above already offers: both branches used to
   * fire, emitting two buttons with the same id (B1419). */
  if (boundTo != null && boundTo !== currentProjectId && !projects.some((p) => p.id === boundTo)) {
    rows.push({ id: boundTo, label: `Unknown project (${boundTo})`, current: true, value: boundTo });
  }

  return (
    <div
      data-testid={testid}
      onClick={(e) => e.stopPropagation()}
      style={{
        margin: "2px 6px 6px", marginLeft: 8, padding: 7,
        borderRadius: RADIUS.control, border: "1px solid var(--accent-notes)",
        background: "var(--surface-page)", display: "flex", flexDirection: "column", gap: 5,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ flex: 1, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
          Belongs to
        </span>
        <MiniButton title="Close" testid={`${testid}-close`} onClick={onClose}>✕</MiniButton>
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 200, overflow: "auto" }}>
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            data-testid={`${testid}-to-${r.id}`}
            disabled={r.current}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onBind(r.value)}
            style={{
              ...rowBase, fontSize: 12, padding: "4px 7px",
              opacity: r.current ? 0.45 : 1, cursor: r.current ? "default" : "pointer",
            }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
            {r.current ? <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)" }}>HERE</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/** ⛔ A BADGE THAT DESCRIBES A FAILED LOOKUP MUST NOT LOOK LIKE DATA (B1419, LOUD-FAILURE).
 *
 *  The rail no longer badges rows at all — but the Dashboard's group HEADINGS still name
 *  projects, so the same honesty problem lives there now. When the project list failed to
 *  load, the headings cannot name anything, and this says so with a way to try again.
 *  Renders nothing when the list is fine, so it costs the default view nothing. */
function ProjectListBanner({ state, error, unresolved, onRetry }) {
  if (state !== "failed" || !unresolved) return null;
  return (
    <div
      role="alert"
      data-testid="notes-projects-error"
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
        borderRadius: RADIUS.control, border: "1px solid var(--danger-text)",
        background: "var(--danger-bg)", color: "var(--danger-text)",
        fontSize: 11.5, fontWeight: 600, lineHeight: 1.4,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        {`Your projects didn't load${error ? ` — ${error}` : ""}.`}
      </span>
      <button
        type="button"
        data-testid="notes-projects-retry"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRetry}
        style={{
          flex: "0 0 auto", border: "1px solid var(--danger-text)", borderRadius: RADIUS.pill,
          background: "transparent", color: "var(--danger-text)", font: "inherit",
          fontSize: 11, fontWeight: 700, padding: "1px 9px", cursor: "pointer",
        }}
      >Retry</button>
    </div>
  );
}

/** The row context menu (B1367) — where every row action now lives.
 *
 *  Positioned at the pointer and flipped back inside the viewport when it would hang off the
 *  bottom or the right. It closes on Escape, on an outside press and on a pick; arrow keys
 *  walk it and Enter chooses, so the menu is fully usable without a mouse. It is NOT a
 *  dialog: nothing is modal, nothing blocks, and picking Rename opens the inline field on the
 *  row rather than a box (house rule). */
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

/* One row of the tree, at EVERY depth — there is only one kind of thing here now (B1420).
 * Weight falls off with depth so the eye can find the top of a branch, but that is typography,
 * not a type distinction: a page with children and a page without are the same node. */
function TreeRow({
  id, title, depth, selected, expanded, hasChildren, editing, confirming, confirmCount,
  onToggle, onSelect, onCommitRename, onCancelRename, onConfirmDelete, onCancelDelete,
  onMenu, when, dropping, onDragStart, onDragEnter, onDragOver, onDragLeave, onDrop,
}) {
  const [hover, setHover] = useState(false);
  const ref = useRef(null);
  const weight = depth === 0 ? 650 : depth === 1 ? 600 : 500;

  const openMenuFromKeyboard = (e) => {
    const box = ref.current?.getBoundingClientRect();
    e.preventDefault();
    onMenu({ x: (box?.left ?? 0) + 24, y: (box?.bottom ?? 0) });
  };

  return (
    <div
      ref={ref}
      data-testid={`notes-row-${id}`}
      data-depth={depth}
      role="treeitem"
      tabIndex={0}
      aria-selected={!!selected}
      aria-expanded={hasChildren ? !!expanded : undefined}
      aria-level={depth + 1}
      /* The time a page was last edited is a HOVER, not a column (B1420/B36050) — on every
         row, permanently, it was noise the owner read straight past. */
      title={when ? `${title} — edited ${when}` : title}
      draggable={!editing}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
      onContextMenu={(e) => { e.preventDefault(); onMenu({ x: e.clientX, y: e.clientY }); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); return; }
        if (e.key === "ArrowRight" && hasChildren && !expanded) { e.preventDefault(); onToggle(); return; }
        if (e.key === "ArrowLeft" && hasChildren && expanded) { e.preventDefault(); onToggle(); return; }
        if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) openMenuFromKeyboard(e);
        // Everything else — Delete and Backspace above all — falls through UNHANDLED, on
        // purpose. See the header: a key must not destroy the row the pointer is over.
      }}
      style={{
        ...rowBase,
        paddingLeft: 8 + depth * INDENT,
        fontWeight: weight,
        background: selected ? "var(--accent-notes)" : dropping ? "var(--surface-page)" : hover ? "var(--surface-page)" : "transparent",
        color: selected ? "var(--on-accent-notes)" : "var(--text-primary)",
        borderColor: dropping ? "var(--accent-notes)" : selected ? "var(--accent-notes)" : "transparent",
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
          {confirming ? (
            <ConfirmDelete testid={`notes-del-${id}`} count={confirmCount} onYes={onConfirmDelete} onNo={onCancelDelete} />
          ) : null}
        </>
      )}
    </div>
  );
}

/** A project's heading on the Dashboard — the ONE place a project label belongs (B1420).
 *  It is also a drop target: dragging a page onto it lifts that page to the top level of
 *  that project, which is the only way back out of a deep nest by dragging. */
/* ⛔ A HEADING STATES A FACT THE OWNER CAN ACT ON (B1419 ×2, LOUD-FAILURE).
 *
 * "PROJECT NOT LOADED" described an internal loading state, not his data — the same class of
 * quiet lie as the old "OTHER PROJECT" it replaced, just a layer up. There are THREE genuinely
 * different situations here and they were being told with one sentence:
 *   • the page was never filed anywhere            → "Not in a project"
 *   • its project was DELETED (the list is fine, this id is not in it)
 *                                                  → "From a project you deleted"
 *   • the project LIST itself failed to load       → "Project names didn't load"
 * The middle one is the owner's actual case (the notebook these pages came from pointed at a
 * project that no longer exists), and it is the one he can do something about: re-file them
 * from the row's own menu. So it says so, in his language, rather than in ours. */
function groupHeading(group, projectsState) {
  if (group.projectId == null) return NO_PROJECT_LABEL;
  if (group.name) return group.name;
  if (projectsState === "failed") return "Project names didn't load";
  if (projectsState === "loading") return "Loading…";
  return "From a project you deleted";
}

function GroupHead({ group, projectsState, dropping, onDragEnter, onDragOver, onDragLeave, onDrop }) {
  const named = groupHeading(group, projectsState);
  return (
    <div
      data-testid={`notes-group-${group.projectId ?? "none"}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "9px 8px 6px",
        fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
        color: group.resolved ? "var(--text-tertiary)" : "var(--danger-text)",
        borderRadius: RADIUS.control,
        border: `1px solid ${dropping ? "var(--accent-notes)" : "transparent"}`,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}
    >{named}</div>
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
          key={`${r.pageId}:${r.where}`}
          type="button"
          data-testid={`notes-hit-${r.pageId}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelectHit(r.pageId)}
          style={{ ...rowBase, flexDirection: "column", alignItems: "stretch", gap: 2, padding: "6px 8px" }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.pageTitle}</span>
            <span style={{ flex: "0 0 auto", fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)" }}>{r.where === "title" ? "NAME" : "IN TEXT"}</span>
          </span>
          {(r.trail || []).length ? (
            <span style={{ fontSize: 11, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {(r.trail || []).join(" › ")}
            </span>
          ) : null}
          {r.excerpt ? (
            <span style={{ fontSize: 11.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.excerpt}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function BinList({ entries, onRestore, onPurge, onPurgeAll }) {
  if (!entries.length) {
    return <p style={{ margin: "8px 10px", fontSize: 12, color: "var(--text-tertiary)" }}>The bin is empty.</p>;
  }
  return (
    <div data-testid="notes-bin" style={{ padding: "2px 6px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
      {/* The count belongs HERE — where it answers a question you actually asked by opening
          the bin — not permanently on the tab (PANEL-BREVITY). */}
      <p style={{ margin: "2px 4px 4px", fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)" }}>
        {entries.length === 1 ? "1 deleted page" : `${entries.length} deleted pages`} · kept 30 days
      </p>
      {entries.map((e) => (
        <div key={e.id} data-testid={`notes-bin-${e.id}`} style={{ ...rowBase, flexDirection: "column", alignItems: "stretch", gap: 4, cursor: "default", border: "1px solid var(--border-default)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title || "Untitled"}</span>
            <span style={{ flex: "0 0 auto", fontSize: 10.5, fontWeight: 600, color: "var(--text-tertiary)" }}>{daysLeft(e.expiresAt)}</span>
          </span>
          {e.pageIds?.length > 1 ? (
            <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{e.pageIds.length} pages</span>
          ) : null}
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
                color: "var(--on-accent-notes)", opacity: e.restorable ? 1 : 0.45,
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

/** ⛔ EVERY UNTICKED LINE IN EVERY NOTE, IN ONE PLACE (NEW-4).
 *
 *  Ticking a row here flips the checkbox IN THE NOTE — through the store, which hands the
 *  change to the open editor when the note is the one on screen (see `toggleNoteTask`).
 *  Clicking the words opens that note. The row shows the item and the note it came from and
 *  NOTHING else: no owner, no due date, no project badge inside a project (PANEL-BREVITY,
 *  and the rail's standing rule that everything on screen belongs to where you are
 *  standing). From the Dashboard the project's name is the group heading, exactly as the
 *  Pages view already does it.
 *
 *  A ticked item LEAVES the list, because "one view of every OPEN item" is what was asked
 *  for; the note keeps it, ticked, where it was written. */
function TaskGroup({ group, onToggle, onOpen }) {
  return (
    <div style={{ marginBottom: 6 }}>
      {group.name !== undefined && group.name !== null ? (
        <div style={{ padding: "3px 8px 2px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
          {group.name}
        </div>
      ) : null}
      {group.tasks.map((t) => (
        <div key={t.key} data-testid={`notes-task-${t.key}`} style={{ ...rowBase, alignItems: "flex-start", cursor: "default", gap: 7 }}>
          <input
            type="checkbox"
            checked={false}
            data-testid={`notes-task-check-${t.key}`}
            aria-label={`Tick “${t.text}”`}
            onChange={() => onToggle(t)}
            style={{ flex: "0 0 auto", marginTop: 2, width: 14, height: 14, accentColor: "var(--accent-notes)", cursor: "pointer" }}
          />
          <button
            type="button"
            data-testid={`notes-task-open-${t.key}`}
            title={`Open “${t.pageTitle}” at this line`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onOpen(t)}
            style={{
              flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1,
              border: "none", background: "transparent", font: "inherit", textAlign: "left",
              color: "var(--text-primary)", cursor: "pointer", padding: 0,
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 }}>{t.text}</span>
            <span style={{ fontSize: 11, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t.pageTitle || "Untitled page"}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

function TaskList({ groups, onToggle, onOpen }) {
  const total = groups.reduce((n, g) => n + g.tasks.length, 0);
  if (!total) {
    return (
      <p data-testid="notes-tasks-empty" style={{ margin: "8px 10px", fontSize: 12, lineHeight: 1.5, color: "var(--text-tertiary)" }}>
        Nothing outstanding. Checklist lines you write in any note show up here until they are ticked.
      </p>
    );
  }
  return (
    <div data-testid="notes-tasks" style={{ padding: "2px 2px 10px" }}>
      {/* The count answers the question opening this view asked. One line (PANEL-BREVITY). */}
      <p style={{ margin: "2px 8px 5px", fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)" }}>
        {total === 1 ? "1 open item" : `${total} open items`}
      </p>
      {groups.map((g) => <TaskGroup key={g.projectId ?? "none"} group={g} onToggle={onToggle} onOpen={onOpen} />)}
    </div>
  );
}

function ViewTabs({ view, onView }) {
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
          >{v.label}</button>
        );
      })}
    </div>
  );
}

/* ---- the rail --------------------------------------------------------------------------- */

export default function NotesTree({
  tree, projectId, projects = [], projectsState = "ready", projectsError = "", onRetryProjects,
  activePageId, query, results,
  onQueryChange, onSelectPage, onSelectHit, onAddPage, onAddSubpage,
  onRename, onDelete, onExportPage, onPrintPage, onSetPageProject,
  onMovePage, onRestore, onPurge, onPurgeAll, onAllNotes,
  taskGroups = [], onToggleTask, onOpenTask, onViewChange,
}) {
  /* EXPANDED, not collapsed — the inverse of what this used to hold, and the whole point.
   * An empty set means everything is shut, which is the honest default for a rail whose job
   * is showing you where things are rather than showing you everything at once. */
  const [expanded, setExpanded] = useState(() => new Set());
  const [editingId, setEditingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [movingId, setMovingId] = useState(null);
  const [bindingId, setBindingId] = useState(null);
  const [view, setView] = useState("tree");
  const [menu, setMenu] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dropId, setDropId] = useState(null);   // page id, or `root:<projectId>` for a group head

  const grouped = projectId == null;
  const roots = useMemo(
    () => pagesInScope(tree, projectId, grouped ? SCOPE_ALL : SCOPE_PROJECT),
    [tree, projectId, grouped],
  );
  const groups = useMemo(() => (grouped ? projectGroups(tree, projects) : []), [grouped, tree, projects]);
  /* ⛔ THE "BELONGS TO" PANEL MUST OFFER EVERY PROJECT YOU ACTUALLY HAVE NOTES IN, not only
   * the ones the project list resolved. From the Dashboard there is no "this project" to
   * lend, so without this the panel could only ever un-file a page and never file one —
   * which would make the Dashboard a one-way door. An id with no resolvable name is offered
   * AS ITSELF rather than withheld (B1419: say what you know, never pretend). */
  const fileableProjects = useMemo(() => {
    const out = projects.slice();
    for (const pid of boundProjectIds(tree)) {
      if (!out.some((p) => p.id === pid)) out.push({ id: pid, name: null });
    }
    return out;
  }, [projects, tree]);
  const bin = useMemo(() => trashEntries(tree), [tree]);

  /* OPEN THE PATH TO THE PAGE YOU ARE ON, and leave the rest shut. It only ever ADDS: a
   * branch the user opened by hand stays open, because a rail that closes what you just
   * opened is arguing with you. */
  useEffect(() => {
    if (!activePageId) return;
    const chain = ancestorIds(tree, activePageId);
    if (!chain.length) return;
    setExpanded((s) => {
      if (chain.every((id) => s.has(id))) return s;
      const n = new Set(s);
      for (const id of chain) n.add(id);
      return n;
    });
  }, [activePageId, tree]);

  const isOpen = (id) => expanded.has(id);
  const toggle = (id) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const commitRename = (id, text) => { setEditingId(null); onRename(id, text); };
  const confirmDelete = (id) => { setConfirmingId(null); onDelete(id); };

  const beginRename = (id) => { setConfirmingId(null); setMovingId(null); setBindingId(null); setEditingId(id); };
  const beginDelete = (id) => { setEditingId(null); setMovingId(null); setBindingId(null); setConfirmingId(id); };
  const beginMove = (id) => { setEditingId(null); setConfirmingId(null); setBindingId(null); setMovingId((m) => (m === id ? null : id)); };
  const beginBind = (id) => { setEditingId(null); setConfirmingId(null); setMovingId(null); setBindingId((b) => (b === id ? null : id)); };

  /** How many pages a delete would take — so the inline confirmation can say so before it
   *  happens, rather than the Undo bar saying so afterwards (TOMBSTONE-DELETES made visible). */
  const cascadeCount = (id) => descendantPageIds(findPage(tree, id)?.page).length;

  /* Where a page may be filed. Built from the WHOLE visible set, and a page can never be
   * offered ITS OWN SUBTREE — that move would detach the branch, so the model refuses it and
   * this must not tempt anyone into trying. */
  const moveDestinations = (pageId) => {
    const banned = new Set(subtreePageIds(findPage(tree, pageId)?.page));
    const hit = findPage(tree, pageId);
    const out = [{ id: "__root__", label: "Top level", value: null, current: !hit?.parent }];
    const walk = (page, trail) => {
      if (!banned.has(page.id)) {
        out.push({ id: page.id, label: [...trail, page.title].join(" › "), value: page.id, current: hit?.parent?.id === page.id });
      }
      for (const k of page.pages || []) walk(k, [...trail, page.title]);
    };
    for (const r of roots) walk(r, []);
    return out;
  };

  const rowProps = (id, { root = false } = {}) => ({
    editing: editingId === id,
    confirming: confirmingId === id,
    confirmCount: confirmingId === id ? cascadeCount(id) : 0,
    onCommitRename: (t) => commitRename(id, t),
    onCancelRename: () => setEditingId(null),
    onConfirmDelete: () => confirmDelete(id),
    onCancelDelete: () => setConfirmingId(null),
    onMenu: ({ x, y }) => setMenu({
      id,
      x,
      y,
      items: [
        { id: `sub-${id}`, label: "New subpage", onPick: () => onAddSubpage(id) },
        { id: `rn-${id}`, label: "Rename", onPick: () => beginRename(id) },
        { id: `mv-${id}`, label: "Move…", onPick: () => beginMove(id) },
        ...(root ? [{ id: `bind-${id}`, label: "Belongs to…", onPick: () => beginBind(id) }] : []),
        { id: `md-${id}`, label: "Export to Markdown", onPick: () => onExportPage(id) },
        { id: `print-${id}`, label: "Print / save as PDF", onPick: () => onPrintPage(id) },
        { id: `rm-${id}`, label: "Delete", danger: true, onPick: () => beginDelete(id) },
      ],
    }),
  });

  /* ---- drag to nest ---- */

  const canDropOn = (targetId) => !!dragId && dragId !== targetId
    && !subtreePageIds(findPage(tree, dragId)?.page).includes(targetId);

  const dragProps = (pageId) => ({
    onDragStart: (e) => { setDragId(pageId); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", pageId); } catch (_) {} },
    /* dragenter AND dragover both preventDefault: Chromium will refuse a drop on a target
     * that only answered one of them when the pointer arrives from a sibling that answered
     * both, which is exactly the "row → group heading" path. */
    onDragEnter: (e) => { if (!canDropOn(pageId)) return; e.preventDefault(); setDropId(pageId); },
    onDragOver: (e) => { if (!canDropOn(pageId)) return; e.preventDefault(); setDropId(pageId); },
    onDragLeave: () => setDropId((d) => (d === pageId ? null : d)),
    onDrop: (e) => {
      e.preventDefault();
      const id = dragId;
      setDropId(null); setDragId(null);
      if (!id || !canDropOn(pageId)) return;
      onMovePage(id, pageId, 9999);
      setExpanded((s) => new Set(s).add(pageId));   // land it somewhere you can see
    },
  });

  const groupDropProps = (pid) => {
    const key = `root:${pid ?? "none"}`;
    return {
      onDragEnter: (e) => { if (!dragId) return; e.preventDefault(); setDropId(key); },
      onDragOver: (e) => { if (!dragId) return; e.preventDefault(); setDropId(key); },
      onDragLeave: () => setDropId((d) => (d === key ? null : d)),
      onDrop: (e) => {
        e.preventDefault();
        const id = dragId;
        setDropId(null); setDragId(null);
        if (id) onMovePage(id, null, 9999, { projectId: pid ?? null });
      },
    };
  };

  /* ---- one branch, drawn by one function at every depth ---- */

  const renderPage = (page, depth, rootFlag) => {
    const kids = page.pages || [];
    const open = isOpen(page.id);
    return (
      <div key={page.id}>
        <TreeRow
          id={page.id}
          title={page.title}
          depth={depth}
          selected={page.id === activePageId}
          hasChildren={kids.length > 0}
          expanded={open}
          when={absoluteStamp(page.updatedAt) || null}
          dropping={dropId === page.id}
          onToggle={() => toggle(page.id)}
          onSelect={() => onSelectPage(page.id)}
          {...dragProps(page.id)}
          {...rowProps(page.id, { root: rootFlag })}
        />
        {movingId === page.id && (
          <MovePanel
            depth={depth}
            destinations={moveDestinations(page.id)}
            testid={`notes-move-${page.id}`}
            onReorder={(d) => {
              const hit = findPage(tree, page.id);
              const sibs = hit?.parent ? hit.parent.pages : roots;
              onMovePage(page.id, hit?.parent?.id ?? null, sibs.findIndex((p) => p.id === page.id) + d);
            }}
            onMoveTo={(toId) => { onMovePage(page.id, toId, 9999); setMovingId(null); }}
            onClose={() => setMovingId(null)}
          />
        )}
        {bindingId === page.id && (
          <ProjectPanel
            projects={fileableProjects}
            currentProjectId={projectId}
            boundTo={page.projectId ?? null}
            testid={`notes-bind-${page.id}`}
            onBind={(pid) => { onSetPageProject(page.id, pid); setBindingId(null); }}
            onClose={() => setBindingId(null)}
          />
        )}
        {open && kids.map((k) => renderPage(k, depth + 1, false))}
      </div>
    );
  };

  const emptyLine = grouped
    ? "No notes yet. Make a page — it opens ready to type in."
    : "No notes in this project yet. Make a page and it files itself here.";

  return (
    <div
      data-testid="notes-tree"
      style={{
        width: 268, flex: "0 0 auto", display: "flex", flexDirection: "column", minHeight: 0,
        borderRight: "1px solid var(--border-default)", background: "var(--surface-raised)",
      }}
    >
      {/* ⛔ THE HEADER BLOCK IS TWO ROWS (B1420). It was four — search, a project/all scope
          switch, the view tabs, and a full-width PRIMARY-FILLED "＋ New notebook" — so four
          rows of chrome stacked up before a single note was visible, and the loudest thing in
          the panel was a button for one of the rarest actions. The scope switch is gone
          because the Dashboard IS the all-projects view and its crumb sits at the top of every
          screen; the button is quiet, sits beside the search field instead of owning a row of
          its own, and says "New page" because there is no notebook to make. */}
      <div style={{ padding: "9px 9px 7px", borderBottom: "1px solid var(--border-default)", display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            data-testid="notes-search"
            value={query}
            /* ⛔ THE SHORTCUT IS PRINTED HERE, and it costs no chrome (NEW-2). A keyboard
               affordance nobody can discover is one that does not exist — B1371's lesson,
               applied to a key instead of a button — but a third control in this row would
               crowd a 268px rail for a feature the keyboard already reaches. The placeholder
               is the one surface someone looking for "how do I find a note" is already
               reading. */
            placeholder={`Search notes — ${QUICK_OPEN_KEY} to jump`}
            title={`Search these notes. Press ${QUICK_OPEN_KEY} to jump straight to a note by name.`}
            aria-label="Search notes"
            aria-keyshortcuts={QUICK_OPEN_KEY.replace("⌘", "Meta+").replace("Ctrl+", "Control+")}
            onChange={(e) => onQueryChange(e.target.value)}
            /* Esc clears the query and gives the tree back. */
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              onQueryChange("");
            }}
            style={{
              flex: 1, minWidth: 0, height: 28, padding: "0 9px", borderRadius: RADIUS.control,
              border: "1px solid var(--border-default)", background: "var(--surface-page)",
              color: "var(--text-primary)", font: "inherit", fontSize: 13,
            }}
          />
          <button
            type="button"
            data-testid="notes-new-page"
            title="New page"
            onClick={() => { setView("tree"); onViewChange?.("tree"); onAddPage(); }}
            style={{
              flex: "0 0 auto", height: 28, padding: "0 10px", borderRadius: RADIUS.control,
              border: "1px solid var(--border-default)", background: "var(--surface-page)",
              color: "var(--text-secondary)", font: "inherit", fontSize: 12.5, fontWeight: 650,
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >＋ Page</button>
        </div>
        {/* The workspace root is told which view is showing, so the task rollup — which has
            to read every page BODY in scope — is computed only while it is on screen. */}
        <ViewTabs view={view} onView={(v) => { setView(v); onQueryChange(""); onViewChange?.(v); }} />
        <ProjectListBanner
          state={projectsState}
          error={projectsError}
          unresolved={grouped && groups.some((g) => g.projectId != null && !g.resolved)}
          onRetry={onRetryProjects}
        />
      </div>

      <div role="tree" aria-label="Notes" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "6px 6px 14px" }}>
        {query ? (
          <SearchResults results={results} query={query} onSelectHit={onSelectHit} />
        ) : view === "tasks" ? (
          <TaskList groups={taskGroups} onToggle={onToggleTask} onOpen={onOpenTask} />
        ) : view === "bin" ? (
          <BinList entries={bin} onRestore={onRestore} onPurge={onPurge} onPurgeAll={onPurgeAll} />
        ) : roots.length === 0 ? (
          /* ⛔ AN EMPTY RAIL MUST EXPLAIN ITSELF (B1374, kept). Inside a project with notes
             living elsewhere, the way to all of them is the Dashboard — one click, from here
             as well as from the crumb, so "nothing can become unreachable" stays true. */
          <div style={{ margin: "10px 8px", display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
            <p data-testid="notes-empty-scope" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
              {!grouped && (tree?.pages || []).length
                ? "No notes in this project yet. Your other notes are still here — they belong to a different project."
                : emptyLine}
            </p>
            {!grouped && (tree?.pages || []).length ? (
              <button
                type="button"
                data-testid="notes-show-all"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onAllNotes?.()}
                style={{
                  ...rowBase, width: "auto", padding: "4px 11px", fontSize: 12, fontWeight: 650,
                  border: "1px solid var(--accent-notes)", background: "var(--accent-notes)",
                  color: "var(--on-accent-notes)",
                }}
              >See all your notes</button>
            ) : null}
          </div>
        ) : grouped ? (
          groups.map((g) => (
            <div key={g.projectId ?? "none"} style={{ marginBottom: 4 }}>
              <GroupHead
                group={g}
                projectsState={projectsState}
                dropping={dropId === `root:${g.projectId ?? "none"}`}
                {...groupDropProps(g.projectId)}
              />
              {g.pages.map((p) => renderPage(p, 0, true))}
            </div>
          ))
        ) : (
          roots.map((p) => renderPage(p, 0, true))
        )}
      </div>

      {menu && <RowMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
