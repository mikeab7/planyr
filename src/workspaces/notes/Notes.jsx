/* Notes — the workspace root. Owns the TREE; the editor arrives lazily beside it.
 *
 * A OneNote-shaped notebook › section › page rail on the left, a rich-text DOCUMENT page
 * on the right. Notebooks bind to a project (or stay loose and follow you everywhere).
 *
 * ⛔ BUNDLE — LOAD-BEARING, and the repo's perf gate fails without it. The editor engine is
 * pulled by a `lazy()` import FROM THIS FILE, inside a Suspense, so the notebook tree paints
 * before ~460 KB of engine downloads. Nothing on this module's static path may import
 * `@tiptap/*`; test/notesModule.test.js source-scans for exactly that. The print serializer
 * (lib/notesDocHtml.js) is on the same side of that line and is therefore reached from here
 * ONLY by a dynamic `import()`.
 *
 * ⛔ EDITOR REMOUNT PER PAGE — also load-bearing, and not a style choice. `key={activePageId}`
 * is what makes the outgoing page's autosave flush on unmount (so an edit made a split second
 * before switching pages survives) and what removes the whole "setContent against a
 * torn-down instance" crash class. See the header of components/NoteEditor.jsx for both
 * bugs in full. Do not lift the editor above this key.
 *
 * ⛔ DELETE IS UNDOABLE (B1310). Every delete here bins rather than destroys: the model
 * moves the node into `tree.trash` with its FULL page cascade stamped on it, an Undo appears
 * immediately, and the bytes are cleared only at PURGE — which is the one call site of
 * `purgePages`. TOMBSTONE-DELETES is unchanged in substance: the cascade is still computed
 * at delete time and every id in it is still cleared, just later and only once.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import NotesTree from "./components/NotesTree.jsx";
import {
  addPage, allPageIds, ancestorIds, deleteNode, emptyTree, expiredTrashIds, findPage,
  firstPageId, migrate, movePage, pagesInScope, purgeTrashEntry, renameNode, restoreNode,
  setPageProject, subtreePageIds, touchPage, trashEntries, trashPageIds,
  SCOPE_ALL, SCOPE_PROJECT,
} from "./lib/notesModel.js";
import { listProjects, warmProjects, onProjectsChanged } from "../../shared/projects/projects.js";
import {
  clearNotesStorageError, markPagesBinned, markPagesRestored, notesConflictFor, notesConflictLine,
  notesScopeLabel, notesStorageLine, onNotesConflict, onNotesStorageError, onNotesSyncState,
  onNotesPagesChanged, purgePages, readNoteImages, readPage, readTreeRaw, resolveNotesConflict, searchNotes,
  setNotesScope, startNotesSync, stopNotesSync, sweepImagesOfMissingPages, sweepOrphans,
  writePage, writeTree,
} from "./lib/notesStore.js";
import { imageIdsInDocs, pageToMarkdown, safeFileName } from "./lib/notesMarkdown.js";

const NoteEditor = lazy(() => import("./components/NoteEditor.jsx"));

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar
/* The footer's one line is coloured by what it SAYS, never by anything else — a failed sync
 * has to read as a failure at a glance, not as quiet grey furniture. Tokens only (B341). */
const TONE_COLOR = {
  quiet: "var(--text-tertiary)",
  good: "var(--save-badge)",
  warn: "var(--warn-text)",
  error: "var(--danger-text)",
};
const TREE_SAVE_MS = 400;
const UNDO_MS = 14000;

/* ---- module-scope pieces (MODULE-SCOPE-COMPONENTS) --------------------------------------- */

/** LOUD-FAILURE: a storage failure is a NAMED banner, never a quiet no-op. A full or
 *  disabled browser store must not be able to look like a clean save. */
function StorageBanner({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      data-testid="notes-storage-error"
      style={{
        flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "7px 14px",
        background: "var(--danger-bg)", borderBottom: "1px solid var(--border-default)",
        color: "var(--danger-text)", fontSize: 12.5, fontWeight: 600,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{error.message}</span>
      <button
        type="button" onClick={onDismiss}
        style={{
          flex: "0 0 auto", border: "1px solid var(--danger-text)", borderRadius: RADIUS.pill,
          background: "transparent", color: "var(--danger-text)", font: "inherit",
          fontSize: 11.5, fontWeight: 700, padding: "2px 10px", cursor: "pointer",
        }}
      >Dismiss</button>
    </div>
  );
}

/** Names what a Markdown export could not carry. An export that quietly drops a merged
 *  cell is the same lie as a save that didn't save, just slower to notice. */
function ExportNotice({ note, onDismiss }) {
  if (!note) return null;
  return (
    <div
      role="status"
      data-testid="notes-export-notice"
      style={{
        flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "6px 14px",
        background: "var(--warn-bg)", borderBottom: "1px solid var(--border-default)",
        color: "var(--warn-text)", fontSize: 12.5, fontWeight: 600,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{note}</span>
      <button
        type="button" onClick={onDismiss}
        style={{
          flex: "0 0 auto", border: "1px solid var(--warn-text)", borderRadius: RADIUS.pill,
          background: "transparent", color: "var(--warn-text)", font: "inherit",
          fontSize: 11.5, fontWeight: 700, padding: "2px 10px", cursor: "pointer",
        }}
      >Dismiss</button>
    </div>
  );
}

/** The way back from a delete, offered at the moment the delete happens.
 *
 *  A bin nobody can find is not an undo. This is deliberately NOT a dialog (house rule) and
 *  deliberately not a confirmation step either — the inline "Delete? ✓ ✕" already asks; a
 *  second prompt would make every delete two decisions. It states what went, offers the way
 *  back, and gets out of the way. */
function UndoBar({ deleted, onUndo, onDismiss }) {
  if (!deleted) return null;
  return (
    <div
      role="status"
      data-testid="notes-undo-bar"
      style={{
        flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "6px 14px",
        background: "var(--surface-raised)", borderBottom: "1px solid var(--border-default)",
        color: "var(--text-secondary)", fontSize: 12.5, fontWeight: 600,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        Deleted “{deleted.title || "Untitled"}”{deleted.pageIds.length > 1 ? ` and its ${deleted.pageIds.length} pages` : ""}. It is in the bin for 30 days.
      </span>
      <button
        type="button" data-testid="notes-undo" onClick={onUndo}
        style={{
          flex: "0 0 auto", border: "1px solid var(--accent-notes)", borderRadius: RADIUS.pill,
          background: "var(--accent-notes)", color: "var(--on-accent-notes)", font: "inherit",
          fontSize: 11.5, fontWeight: 700, padding: "2px 12px", cursor: "pointer",
        }}
      >Undo</button>
      <button
        type="button" onClick={onDismiss}
        style={{
          flex: "0 0 auto", border: "1px solid var(--border-default)", borderRadius: RADIUS.pill,
          background: "transparent", color: "var(--text-tertiary)", font: "inherit",
          fontSize: 11.5, fontWeight: 700, padding: "2px 10px", cursor: "pointer",
        }}
      >Dismiss</button>
    </div>
  );
}

/** TWO WINDOWS, ONE PAGE, BOTH EDITED — named, never resolved behind your back.
 *
 *  This is the visible half of the concurrency rule: a push refused because the revision
 *  moved does NOT overwrite and does NOT get thrown away. Both copies exist, this bar says
 *  so in as many words, and the two buttons are the only ways out. "Use the other" parks
 *  this window's text as a page beside it first, so choosing cannot lose the copy you did
 *  not pick either.
 *
 *  ⛔ IT REACHES THE SCREEN FAR LESS OFTEN NOW, AND IT NAMES NOBODY (B1391). A moved
 *  revision is no longer enough to raise it: the store compares the two documents first and
 *  reconciles in silence when they say the same thing (`judgeConflict`), so the ordinary
 *  same-account, two-window race resolves without a word. When it IS raised the divergence
 *  is real — and the words come from `notesConflictLine`, which may only ever say WINDOW or
 *  COMPUTER. These notes are private to one account; there is no other person to name. */
function ConflictBar({ conflict, onKeepMine, onKeepTheirs }) {
  if (!conflict) return null;
  const copy = notesConflictLine(conflict.title);
  return (
    <div
      role="alert"
      data-testid="notes-conflict-bar"
      style={{
        flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "6px 14px",
        background: "var(--warn-bg)", borderBottom: "1px solid var(--border-default)",
        color: "var(--warn-text)", fontSize: 12.5, fontWeight: 600,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{copy.text}</span>
      <button
        type="button" data-testid="notes-conflict-mine" onClick={onKeepMine}
        style={{
          flex: "0 0 auto", border: "1px solid var(--warn-text)", borderRadius: RADIUS.pill,
          background: "transparent", color: "var(--warn-text)", font: "inherit",
          fontSize: 11.5, fontWeight: 700, padding: "2px 10px", cursor: "pointer",
        }}
      >{copy.keepMine}</button>
      <button
        type="button" data-testid="notes-conflict-theirs" onClick={onKeepTheirs}
        style={{
          flex: "0 0 auto", border: "1px solid var(--warn-text)", borderRadius: RADIUS.pill,
          background: "transparent", color: "var(--warn-text)", font: "inherit",
          fontSize: 11.5, fontWeight: 700, padding: "2px 10px", cursor: "pointer",
        }}
      >{copy.keepTheirs}</button>
    </div>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 28, background: "var(--surface-page)" }}>
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 19, fontWeight: 700, color: "var(--text-primary)" }}>No page open</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
          Make a page and start typing. Anything you write can hold pages of its own, so there
          is nothing to set up first.
        </p>
        <button
          type="button"
          data-testid="notes-empty-create"
          onClick={onCreate}
          style={{
            height: 32, padding: "0 16px", borderRadius: RADIUS.control,
            border: "1px solid var(--accent-notes)", background: "var(--accent-notes)",
            color: "var(--on-accent-notes)", font: "inherit", fontSize: 13.5, fontWeight: 650, cursor: "pointer",
          }}
        >＋ New page</button>
      </div>
    </div>
  );
}

function EditorFallback() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-page)" }}>
      <span data-testid="notes-editor-loading" style={{ fontSize: 13, fontWeight: 600, color: "var(--accent-notes-text)" }}>Opening the editor…</span>
    </div>
  );
}

/** Hand a Markdown file to the browser. Kept here rather than in lib/notesMarkdown.js so
 *  that module stays pure and unit-testable with no DOM. */
function downloadMarkdown(filename, markdown) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---- the workspace ------------------------------------------------------------------------ */

export default function Notes({
  isActive, shellModule, onShellSwitch, authControl, accountActive, userId,
  projectId, crossProject, onNavigate, onGoDashboard, onNewProject,
}) {
  const [tree, setTree] = useState(emptyTree);
  const [activePageId, setActivePageId] = useState(null);
  const [status, setStatus] = useState("saved");
  const [storageError, setStorageError] = useState(null);
  const [exportNote, setExportNote] = useState(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState("");
  const [deleted, setDeleted] = useState(null);
  const [storageLine, setStorageLine] = useState(() => notesStorageLine());
  const [conflictIds, setConflictIds] = useState([]);
  /* ⛔ THE IN-RAIL SCOPE SWITCH IS GONE (B1420), and B1374's guarantee is UNCHANGED.
   * "Show me everything" is now the DASHBOARD — which shows every project's pages grouped by
   * project — and its crumb is at the top of every screen, so it is still exactly one click
   * from inside a project. What went is a whole segmented control that duplicated a control
   * already on screen (PANEL-BREVITY). The empty-rail state still offers the same click
   * explicitly, in the one place someone could conclude their notes were gone. */
  const treeTimer = useRef(0);
  const treeRef = useRef(null);   // the latest tree, captured at edit time (see the flush note below)
  const undoTimer = useRef(0);

  /* Scope FIRST, then read: the store keys by the signed-in user's id (or `local`), so two
   * accounts on one machine never read each other's notes. A scope change re-reads. */
  useEffect(() => {
    setNotesScope(userId || null);
    const raw = readTreeRaw();
    let loaded = migrate(raw);

    /* ⛔ THE COLLAPSE IS WRITTEN BACK ONCE, ON THE FIRST LOAD THAT SEES THE OLD SHAPE (B1420).
     * `migrate` converts on READ, which is what makes opening safe — but a conversion that is
     * never persisted means the stored blob stays four-level forever, every device keeps
     * re-converting it, and (the part that matters) the SHAPE never rides the cloud tree blob
     * to the other machine. One write settles it. It is safe to do here because the migration
     * is a fixed point: a tree already in the new shape takes this branch never, and running
     * it twice is a no-op either way (test/notesModel.test.js asserts both). */
    const wasLegacy = !!raw && typeof raw === "object" && Array.isArray(raw.notebooks) && !Array.isArray(raw.pages);
    if (wasLegacy) writeTree(loaded);

    /* THE 30-DAY SWEEP, run here on the load and nowhere else. Deliberately lazy (like the
     * Site Planner's own bin) rather than on a timer: nothing needs to happen while the tab
     * is closed, and a background job whose whole purpose is destroying data is a worse
     * thing to get wrong. Everything past its retention window is purged for real — bodies
     * AND images — which is what stops the bin becoming a place storage goes to hide. */
    const expired = expiredTrashIds(loaded);
    if (expired.length) {
      const ids = [];
      for (const id of expired) {
        const r = purgeTrashEntry(loaded, id);
        loaded = r.tree;
        ids.push(...r.pageIds);
      }
      writeTree(loaded);
      purgePages(ids);
    }

    /* The safety net for a delete that was INTERRUPTED (a tab closed between the tree
     * write and the purge), for bodies and for pictures. Both are handed the union of
     * LIVE and BINNED page ids: a binned page's bytes are deliberately still on disk, and
     * sweeping against the live tree alone would destroy what a restore needs. */
    const keep = [...allPageIds(loaded), ...trashPageIds(loaded)];
    sweepOrphans(keep);
    sweepImagesOfMissingPages(keep);

    treeRef.current = loaded;   // seed the ref with what was just read, so a flush before
    setTree(loaded);            // the first edit cannot write a null over real notebooks
    setActivePageId(firstPageId(loaded));
    setQuery("");
    setHighlight("");
    setDeleted(null);
    setConflictIds([]);

    /* CLOUD SYNC (B1291). Signed out this is a no-op and everything above is the whole
     * story, unchanged. Signed in, it adopts any signed-out notebooks into the account,
     * pulls what the other machine wrote, and pushes what this one owes — and calls back
     * whenever it changed the tree underneath us, so the rail shows the account's truth
     * rather than this device's stale copy. */
    let live = true;
    startNotesSync({
      onTree: () => {
        if (!live) return;
        const next = migrate(readTreeRaw());
        treeRef.current = next;
        setTree(next);
        setActivePageId((cur) => (cur && findPage(next, cur) ? cur : firstPageId(next)));
      },
    });
    return () => { live = false; stopNotesSync(); };
  }, [userId]);

  // LOUD-FAILURE, the cloud half: the footer line is whatever the store says is TRUE.
  useEffect(() => onNotesSyncState(() => setStorageLine(notesStorageLine())), []);
  useEffect(() => onNotesConflict((ids) => setConflictIds(ids)), []);

  /* ⛔ A BODY THAT CHANGED UNDERNEATH THE OPEN EDITOR (B1391).
   *
   * The editor reads its document ONCE, at mount — deliberately, and that must not change
   * (NoteEditor's header explains what the "sync content on pageId change" effect used to
   * crash). But the body on disk can be replaced by something other than typing: the same
   * account in a SECOND WINDOW writing the same key, or the cloud seed adopting the
   * account's row. Left alone the editor keeps its stale copy and the next keystroke writes
   * the whole of it back — cleanly, past a revision guard this window legitimately holds —
   * and the other window's paragraph is gone silently. That is the self-race the false
   * "someone else edited this" prompt was only the symptom of.
   *
   * The fix is a REMOUNT, not an effect: bumping this epoch changes the editor's key, so a
   * fresh instance reads the fresh document through the same one-shot path. The store only
   * announces a page it knows this window has no unflushed edit on, so a remount can never
   * discard work in progress. */
  const [bodyEpoch, setBodyEpoch] = useState(0);
  useEffect(() => onNotesPagesChanged((ids) => {
    if (activePageId && ids.includes(activePageId)) setBodyEpoch((n) => n + 1);
  }), [activePageId]);

  /* The relative "synced 5m ago" would otherwise freeze at the moment of the last sync and
   * quietly become a lie the longer the tab stays open. */
  useEffect(() => {
    const t = setInterval(() => setStorageLine(notesStorageLine()), 30000);
    return () => clearInterval(t);
  }, []);

  // LOUD-FAILURE: surface every storage failure the store reports, from anywhere.
  useEffect(() => onNotesStorageError((err) => setStorageError(err)), []);

  /* The tree flush follows the SAME discipline as the editor's (see NoteEditor's header):
   * the value to be written is captured the moment the edit happens, in a ref, and the
   * flush is referentially STABLE so it registers once and runs only on a real unmount.
   *
   * The bug this shape fixes, caught by ui-audit/verify-notes.mjs: with the flush effect
   * keyed on `tree`, every tree change ran the previous effect's cleanup — which cleared
   * the freshly-scheduled timer AND wrote the tree from its stale closure. Creating the
   * first notebook therefore persisted the EMPTY tree and cancelled the real write, so the
   * notebook vanished on reload. A debounce and an effect that both own the same write is
   * a race; only one of them may. */

  /* Persist the tree on a short debounce. Titles are cheap, but a rename is a keystroke
   * stream like any other, and page BODIES are not in here — this write stays small no
   * matter how much has been written into the notebook. */
  const persistTree = useCallback((next) => {
    treeRef.current = next;                       // capture at edit time, never read back later
    setTree(next);
    if (treeTimer.current) clearTimeout(treeTimer.current);
    treeTimer.current = setTimeout(() => {
      treeTimer.current = 0;
      if (!writeTree(treeRef.current)) setStatus("error");
    }, TREE_SAVE_MS);
  }, []);

  const flushTree = useCallback(() => {
    if (!treeTimer.current || !treeRef.current) return;
    clearTimeout(treeTimer.current);
    treeTimer.current = 0;
    if (!writeTree(treeRef.current)) setStatus("error");
  }, []);

  // A pending tree write must not be lost to a tab close, same as a pending page body.
  useEffect(() => {
    window.addEventListener("beforeunload", flushTree);
    return () => { window.removeEventListener("beforeunload", flushTree); flushTree(); };
  }, [flushTree]);

  /* THE PROJECT LIST — and, just as important, WHETHER IT LOADED (B482 ×2, NEW-1).
   *
   * Read from the SAME per-user, RLS-scoped store the header breadcrumb reads (no parallel
   * project store, and no new chunk on this route — AppHeader already pulls it in).
   *
   * ⛔ A SYNCHRONOUS READ IS NOT AN ANSWER. `listProjects()` reads an on-device cache that a
   * cloud pull fills, so on a machine that booted straight into Notes it legitimately returns
   * an EMPTY list for a signed-in user with projects. The old code read it once per project /
   * account change and treated whatever came back as the truth — which is how a notebook bound
   * to Grand Port ended up wearing a badge that described a failed lookup instead of his data.
   *
   * So the list is a small state machine and every branch is named: `loading` while a warm is
   * in flight, `failed` when the pull actually failed (LOUD — the rail says so and offers the
   * retry), `ready` otherwise. An unresolved id under `ready` is a genuinely missing project;
   * under `failed` it is our own ignorance, and the two must never be captioned the same way. */
  const [warmTick, setWarmTick] = useState(0);
  const [projectList, setProjectList] = useState(() => ({ projects: listProjects(), state: "ready", error: "" }));
  const projects = projectList.projects;

  useEffect(() => {
    let live = true;
    const read = () => { if (live) setProjectList((p) => ({ ...p, projects: listProjects() })); };
    read();
    (async () => {
      if (listProjects().length) return;                       // already warm — nothing to wait on
      if (live) setProjectList((p) => ({ ...p, state: "loading" }));
      const r = await warmProjects();
      if (!live) return;
      setProjectList({
        projects: listProjects(),
        state: r.ok ? "ready" : "failed",
        error: r.ok ? "" : r.error,
      });
    })();
    /* …and a warm that lands somewhere ELSE (the header's own switcher opening, a rename in
     * another tab) reaches this rail too, instead of leaving it on the copy it read at mount. */
    const off = onProjectsChanged(read);
    return () => { live = false; off(); };
  }, [projectId, userId, warmTick]);

  const retryProjects = useCallback(() => setWarmTick((n) => n + 1), []);

  const projectName = useMemo(
    () => projects.find((p) => p.id === projectId)?.name || null,
    [projects, projectId],
  );

  /* THE HEADER MUST SAY WHERE YOU ACTUALLY ARE (B1343 ×2). Every other workspace hands
   * AppHeader a `currentProject`; Notes never did, so walking into Notes from inside a project
   * left the crumb reading "Dashboard / Select a project" while the URL named the project.
   * Same shape as Review and Library: the route's id, with the store's name when it resolves
   * (the breadcrumb re-resolves the live name itself, so a rename shows without a reload). */
  const notesProject = useMemo(
    () => (projectId ? { id: projectId, name: projectName || "Project" } : null),
    [projectId, projectName],
  );

  /* Keep the open page inside the visible set. Switching projects — or narrowing the scope
   * — with a page open from a notebook the rail can no longer see would otherwise leave the
   * rail and the document disagreeing about what is open. */
  useEffect(() => {
    const roots = pagesInScope(tree, projectId, projectId == null ? SCOPE_ALL : SCOPE_PROJECT);
    const visible = new Set(roots.flatMap((r) => subtreePageIds(r)));
    if (!activePageId || !visible.has(activePageId)) setActivePageId(roots[0]?.id || null);
  }, [projectId, tree, activePageId]);

  const active = useMemo(() => (activePageId ? findPage(tree, activePageId) : null), [tree, activePageId]);
  const activePage = active?.page || null;
  /* The open page's ancestors, root first — the "where am I?" the editor shows and the print
   * sheet carries. Derived from the tree, so a re-parent updates it with no second copy. */
  const activeTrail = useMemo(
    () => (activePageId ? ancestorIds(tree, activePageId).map((id) => findPage(tree, id)?.page?.title).filter(Boolean) : []),
    [tree, activePageId],
  );

  /* The page-id set the open page's pictures are CHARGED AGAINST — its whole top-level
   * branch, which is what a notebook used to be. Recomputed from the tree, never captured,
   * so adding a subpage beside this one is immediately reflected in the ceiling. */
  const notebookPageIds = useMemo(() => (active?.root ? subtreePageIds(active.root) : []), [active]);

  const results = useMemo(
    () => (query.trim() ? searchNotes(tree, query, { projectId, scope: projectId == null ? SCOPE_ALL : SCOPE_PROJECT }) : []),
    [query, tree, projectId],
  );

  /* ---- tree actions ---- */

  /* ⛔ A PAGE MADE INSIDE A PROJECT IS FILED THERE, WITH NO EXTRA STEP (B1374, kept through
   * B1420's collapse). Made from the Dashboard it belongs to no project, which is a real
   * place with the same shape — never a holding pen. */
  const handleAddPage = useCallback(() => {
    const r = addPage(tree, { projectId: projectId || null });
    persistTree(r.tree);
    setActivePageId(r.pageId);
    setQuery("");
  }, [tree, projectId, persistTree]);

  /** A page UNDER another page — the whole point of the collapse, and reachable by direct
   *  action (the row's menu) rather than by a mode. */
  const handleAddSubpage = useCallback((parentId) => {
    const r = addPage(tree, { parentId });
    persistTree(r.tree);
    if (r.pageId) setActivePageId(r.pageId);
  }, [tree, persistTree]);

  /** Re-file a TOP-LEVEL page into a project, or out of every project (B1374, B1420). */
  const handleSetPageProject = useCallback((pageId, pid) => {
    persistTree(setPageProject(tree, pageId, pid));
  }, [tree, persistTree]);

  const handleRename = useCallback((id, title) => persistTree(renameNode(tree, id, title)), [tree, persistTree]);

  /* ---- the bin ---- */

  /** TOMBSTONE-DELETES, DEFERRED — never weakened. The model computes the FULL cascade of
   *  orphaned page ids and stamps it on the trash entry; nothing is cleared here, and the
   *  purge later clears every id on that entry (bodies AND images). */
  const handleDelete = useCallback((id) => {
    const { tree: next, removedPageIds, entry } = deleteNode(tree, id);
    if (!entry) return;
    persistTree(next);
    // The cloud half of the same cascade: the bodies STAY (that is the bin), the rows are
    // stamped as binned, so the other computer can restore what this one deleted.
    markPagesBinned(entry.pageIds);
    if (removedPageIds.includes(activePageId)) setActivePageId(firstPageId(next));
    setDeleted({ id: entry.id, title: entry.title, pageIds: entry.pageIds });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => { undoTimer.current = 0; setDeleted(null); }, UNDO_MS);
  }, [tree, activePageId, persistTree]);

  const handleRestore = useCallback((entryId) => {
    const r = restoreNode(tree, entryId);
    persistTree(r.tree);
    if (r.pageIds.length) markPagesRestored(r.pageIds);   // …and it reaches the other one back
    setDeleted((d) => (d && d.id === entryId ? null : d));
    if (r.restored && r.pageIds.length) setActivePageId(r.pageIds[0]);
  }, [tree, persistTree]);

  /** DELETE FOREVER — the ONE place a note's bytes are destroyed. */
  const handlePurge = useCallback((entryId) => {
    const r = purgeTrashEntry(tree, entryId);
    persistTree(r.tree);
    setDeleted((d) => (d && d.id === entryId ? null : d));
    purgePages(r.pageIds);
  }, [tree, persistTree]);

  const handlePurgeAll = useCallback(() => {
    let next = tree;
    const ids = [];
    for (const e of trashEntries(tree)) {
      const r = purgeTrashEntry(next, e.id);
      next = r.tree;
      ids.push(...r.pageIds);
    }
    persistTree(next);
    setDeleted(null);
    purgePages(ids);
  }, [tree, persistTree]);

  /* ---- moves (B1316 — the model op had no caller at all before that item) ----
   *
   * ONE op now, for every move there is: reorder among siblings, nest under another page,
   * lift back to the top level. Three ops became one when the three levels became one. */
  const handleMovePage = useCallback((pageId, toParentId, index, opts) => persistTree(movePage(tree, pageId, toParentId, index, opts)), [tree, persistTree]);

  const handleTitleChange = useCallback((title) => {
    if (activePageId) handleRename(activePageId, title);
  }, [activePageId, handleRename]);

  /** Stamp the edited time — driven by the editor's write, NOT by a keystroke, so the field
   *  can only ever record a save that actually landed. */
  const handleSaved = useCallback((pageId) => {
    const next = touchPage(treeRef.current || tree, pageId);
    if (next !== (treeRef.current || tree)) persistTree(next);
  }, [tree, persistTree]);

  /* ---- conflicts (B1291) ----
   *
   * The store hands over page ids; the titles live here, in the tree. Only the first is
   * shown — a queue of conflict bars would be its own kind of noise, and resolving one
   * reveals the next. */
  const conflict = useMemo(() => {
    const id = conflictIds.find((pid) => findPage(tree, pid)) || conflictIds[0];
    if (!id) return null;
    return { pageId: id, title: findPage(tree, id)?.page?.title || "" };
  }, [conflictIds, tree]);

  const handleConflict = useCallback(async (pageId, choice) => {
    /* ⛔ "Use the other" PARKS THIS WINDOW'S TEXT FIRST, as a page beside the
     * one being replaced. Without that step the choice would destroy an edit the user made
     * — and "never a lost edit" would be a slogan rather than a property. */
    if (choice === "theirs") {
      const base = treeRef.current || tree;
      const hit = findPage(base, pageId);
      const localDoc = readPage(pageId);
      if (hit && localDoc != null) {
        /* Parked as a SIBLING of the page being replaced — under its parent, or at the top
         * level of its project when it is a top-level page itself. */
        const r = addPage(base, hit.parent
          ? { parentId: hit.parent.id, title: `${hit.page.title} ${notesConflictLine().parkedSuffix}` }
          : { projectId: hit.root.projectId ?? null, title: `${hit.page.title} ${notesConflictLine().parkedSuffix}` });
        if (r.pageId && writePage(r.pageId, localDoc)) persistTree(r.tree);
      }
    }
    const res = await resolveNotesConflict(pageId, choice);
    if (!res.ok) setExportNote(res.error || "That copy could not be saved — nothing was changed.");
  }, [tree, persistTree]);

  /* ---- export + print ---- */

  const handleExportPage = useCallback(({ markdown, lossy, filename }) => {
    downloadMarkdown(filename, markdown);
    setExportNote(lossy.length
      ? `Exported. Markdown can't carry ${lossy.length === 1 ? lossy[0] : `${lossy.slice(0, -1).join(", ")} and ${lossy[lossy.length - 1]}`} — those parts were written as HTML so they still display.`
      : null);
  }, []);

  /** Export a page AND EVERYTHING UNDER IT. Nesting rides out as heading depth — see
   *  `pageToMarkdown`, which is where the one degradation (past six levels) is named. */
  const handleExportPageTree = useCallback(async (pageId) => {
    const hit = findPage(tree, pageId);
    if (!hit) return;
    const bodies = {};
    for (const id of subtreePageIds(hit.page)) bodies[id] = readPage(id);
    // Pictures are inlined as data URLs so an exported branch is one self-contained file.
    const images = await readNoteImages(imageIdsInDocs(bodies));
    const { markdown, lossy } = pageToMarkdown(hit.page, bodies, { images });
    handleExportPage({ markdown, lossy, filename: safeFileName(hit.page.title) });
  }, [tree, handleExportPage]);

  /* The print serializer imports the schema, and the schema pulls the editor engine — so it
   * is reached from this file by a DYNAMIC import only. A static one here would put ~460 KB
   * back on the route the lazy boundary exists to keep clear. */
  const handlePrintPageTree = useCallback(async (pageId) => {
    const hit = findPage(tree, pageId);
    if (!hit) return;
    const bodies = {};
    const pages = [];
    /* Reading order, with each page's TRAIL — which is what paper uses in place of the
     * section heading it no longer has (PDF-PARITY; see buildPrintDocument). */
    const walk = (node, trail) => {
      bodies[node.id] = readPage(node.id);
      pages.push({ id: node.id, title: node.title, updatedAt: node.updatedAt, trail });
      for (const k of node.pages || []) walk(k, [...trail, node.title]);
    };
    walk(hit.page, []);
    const images = await readNoteImages(imageIdsInDocs(bodies));
    const [{ docToHtml }, { buildPrintDocument, printHtmlDocument }] = await Promise.all([
      import("./lib/notesDocHtml.js"),
      import("./lib/notesPrint.js"),
    ]);
    const html = buildPrintDocument({
      title: hit.page.title || "Note",
      meta: `${pages.length === 1 ? "1 page" : `${pages.length} pages`} · Planyr Notes`,
      pages: pages.map((p) => ({ ...p, html: docToHtml(bodies[p.id], images) })),
    });
    const r = await printHtmlDocument(html);
    if (!r.ok) setExportNote(r.error);
  }, [tree]);

  const scopeLabel = notesScopeLabel();

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--surface-page)" }}>
      <AppHeader
        module={shellModule || "notes"}
        onSwitch={onShellSwitch}
        onDashboard={onGoDashboard}
        // B1343 ×2 — the crumb names the project the route is standing in, like every
        // other workspace. Without it the header forgot the project on the way into Notes.
        currentProject={notesProject}
        cross={crossProject}
        onSelectProject={(id) => onNavigate?.({ projectId: id, cross: false })}
        onNewProject={onNewProject}
        authControl={authControl}
        accountActive={accountActive}
        // Notes are per-page documents with no single-active-editor lock, so two tabs can
        // both be open safely and the "read-only until you take over" banner would be false.
        multiEditOk
      />

      <StorageBanner error={storageError} onDismiss={() => { clearNotesStorageError(); setStorageError(null); }} />
      <ExportNotice note={exportNote} onDismiss={() => setExportNote(null)} />
      <UndoBar deleted={deleted} onUndo={() => handleRestore(deleted.id)} onDismiss={() => setDeleted(null)} />
      <ConflictBar
        conflict={conflict}
        onKeepMine={() => handleConflict(conflict.pageId, "mine")}
        onKeepTheirs={() => handleConflict(conflict.pageId, "theirs")}
      />

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <NotesTree
          tree={tree}
          projectId={projectId}
          projects={projects}
          projectsState={projectList.state}
          projectsError={projectList.error}
          onRetryProjects={retryProjects}
          projectName={projectName}
          activePageId={activePageId}
          query={query}
          results={results}
          onQueryChange={setQuery}
          onSelectPage={(id) => { setActivePageId(id); setQuery(""); setHighlight(""); }}
          /* Opening a SEARCH HIT carries the phrase into the page, so the editor can mark
             where it actually is — the thing search used to abandon you without. */
          onSelectHit={(id) => { setActivePageId(id); setHighlight(query); setQuery(""); }}
          onAddPage={handleAddPage}
          onAddSubpage={handleAddSubpage}
          onSetPageProject={handleSetPageProject}
          onRename={handleRename}
          onDelete={handleDelete}
          onExportPage={handleExportPageTree}
          onPrintPage={handlePrintPageTree}
          onMovePage={handleMovePage}
          /* ⛔ "See all your notes" STAYS IN NOTES (B1420). The shell's own Dashboard action
             switches to the Site workspace — using it here would answer "where are my other
             notes?" by leaving the notes module entirely, which is worse than the empty rail
             it is trying to explain. This drops the project and keeps the route's module. */
          onAllNotes={() => onNavigate?.({ projectId: null, cross: false })}
          onRestore={handleRestore}
          onPurge={handlePurge}
          onPurgeAll={handlePurgeAll}
        />

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {activePage ? (
            <Suspense fallback={<EditorFallback />}>
              {/* key = page id + BODY EPOCH — the remount is the fix. See this file's
                  header for the page half, and `bodyEpoch` above for the second window's. */}
              <NoteEditor
                key={`${activePage.id}:${bodyEpoch}`}
                pageId={activePage.id}
                title={activePage.title}
                updatedAt={activePage.updatedAt}
                /* WHERE THIS PAGE SITS — its ancestors' titles, which is what the editor
                   puts on the printed sheet in place of the section heading it no longer
                   has (PDF-PARITY). */
                trail={activeTrail}
                notebookPageIds={notebookPageIds}
                searchTerm={highlight}
                onClearSearch={() => setHighlight("")}
                status={status}
                scopeLabel={scopeLabel}
                onTitleChange={handleTitleChange}
                onStatus={setStatus}
                onSaved={handleSaved}
                onExportMarkdown={handleExportPage}
                onPrintNotice={setExportNote}
              />
            </Suspense>
          ) : (
            <EmptyState onCreate={handleAddPage} />
          )}

          <div
            data-testid="notes-scope-label"
            data-sync-tone={storageLine.tone}
            style={{
              flex: "none", padding: "5px 14px", borderTop: "1px solid var(--border-default)",
              background: "var(--surface-raised)", color: TONE_COLOR[storageLine.tone] || "var(--text-tertiary)",
              fontSize: 11.5, fontWeight: 600,
            }}
          >
            {/* ONE line, and it is whatever is TRUE right now — saved locally / syncing /
                synced with a real time / offline / failed with a reason. It REPLACES the
                old "{scope} · not synced to the cloud yet" sentence rather than joining it
                (PANEL-BREVITY); the wording is decided once, in notesStore.notesStorageLine,
                so this surface cannot claim a sync the store did not make. */}
            {storageLine.text}
          </div>
        </div>
      </div>
    </div>
  );
}
