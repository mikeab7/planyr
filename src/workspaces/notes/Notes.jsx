/* Notes — the workspace root. Owns the TREE; the editor arrives lazily beside it.
 *
 * A OneNote-shaped notebook › section › page rail on the left, a rich-text DOCUMENT page
 * on the right. Notebooks bind to a project (or stay loose and follow you everywhere).
 *
 * ⛔ BUNDLE — LOAD-BEARING, and the repo's perf gate fails without it. The editor engine is
 * pulled by a `lazy()` import FROM THIS FILE, inside a Suspense, so the notebook tree paints
 * before ~460 KB of engine downloads. Nothing on this module's static path may import
 * `@tiptap/*`; test/notesModule.test.js source-scans for exactly that.
 *
 * ⛔ EDITOR REMOUNT PER PAGE — also load-bearing, and not a style choice. `key={activePageId}`
 * is what makes the outgoing page's autosave flush on unmount (so an edit made a split second
 * before switching pages survives) and what removes the whole "setContent against a
 * torn-down instance" crash class. See the header of components/NoteEditor.jsx for both
 * bugs in full. Do not lift the editor above this key.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import NotesTree from "./components/NotesTree.jsx";
import {
  addNotebook, addPage, addSection, deleteNode, emptyTree, findPage,
  firstPageId, migrate, renameNode, visibleNotebooks,
} from "./lib/notesModel.js";
import {
  clearNotesStorageError, deletePages, notesScopeLabel, onNotesStorageError,
  readPage, readTreeRaw, searchNotes, setNotesScope, writeTree,
} from "./lib/notesStore.js";
import { notebookToMarkdown, safeFileName } from "./lib/notesMarkdown.js";

const NoteEditor = lazy(() => import("./components/NoteEditor.jsx"));

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar
const TREE_SAVE_MS = 400;

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

function EmptyState({ onCreate }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 28, background: "var(--surface-page)" }}>
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 19, fontWeight: 700, color: "var(--text-primary)" }}>No page open</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
          Make a notebook and start typing. It arrives with a section and a page already in it,
          so there is nothing to set up first.
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
        >＋ New notebook</button>
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
  const treeTimer = useRef(0);
  const treeRef = useRef(null);   // the latest tree, captured at edit time (see the flush note below)

  /* Scope FIRST, then read: the store keys by the signed-in user's id (or `local`), so two
   * accounts on one machine never read each other's notes. A scope change re-reads. */
  useEffect(() => {
    setNotesScope(userId || null);
    const loaded = migrate(readTreeRaw());
    treeRef.current = loaded;   // seed the ref with what was just read, so a flush before
    setTree(loaded);            // the first edit cannot write a null over real notebooks
    setActivePageId(firstPageId(loaded));
    setQuery("");
  }, [userId]);

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

  /* Keep the open page inside the current project's visible set. Switching projects with a
   * page open from a notebook this project can't see would otherwise leave the rail and the
   * document disagreeing about what is open. */
  useEffect(() => {
    const visible = visibleNotebooks(tree, projectId);
    const ok = activePageId && visible.some((nb) => (nb.sections || []).some((s) => (s.pages || []).some((p) => p.id === activePageId)));
    if (!ok) {
      const first = visible[0]?.sections?.[0]?.pages?.[0]?.id || null;
      setActivePageId(first);
    }
  }, [projectId, tree, activePageId]);

  const activePage = useMemo(() => (activePageId ? findPage(tree, activePageId)?.page || null : null), [tree, activePageId]);

  const results = useMemo(
    () => (query.trim() ? searchNotes(tree, query, { projectId }) : []),
    [query, tree, projectId],
  );

  /* ---- tree actions ---- */

  const handleAddNotebook = useCallback(() => {
    // A notebook created from inside a project belongs to it; from the dashboard it is loose.
    const r = addNotebook(tree, { projectId: projectId || null });
    persistTree(r.tree);
    setActivePageId(r.pageId);
    setQuery("");
  }, [tree, projectId, persistTree]);

  const handleAddSection = useCallback((notebookId) => {
    const r = addSection(tree, notebookId);
    persistTree(r.tree);
    if (r.pageId) setActivePageId(r.pageId);
  }, [tree, persistTree]);

  const handleAddPage = useCallback((sectionId) => {
    const r = addPage(tree, sectionId);
    persistTree(r.tree);
    if (r.pageId) setActivePageId(r.pageId);
  }, [tree, persistTree]);

  const handleRename = useCallback((id, title) => persistTree(renameNode(tree, id, title)), [tree, persistTree]);

  /** TOMBSTONE-DELETES: clear a body for the FULL cascade the model reports, not just the
   *  node that was clicked. Deleting a notebook orphans every page under every one of its
   *  sections; a body left behind can never be reached and never be removed. */
  const handleDelete = useCallback((id) => {
    const { tree: next, removedPageIds } = deleteNode(tree, id);
    deletePages(removedPageIds);
    persistTree(next);
    if (removedPageIds.includes(activePageId)) setActivePageId(firstPageId(next));
  }, [tree, activePageId, persistTree]);

  const handleTitleChange = useCallback((title) => {
    if (activePageId) handleRename(activePageId, title);
  }, [activePageId, handleRename]);

  /* ---- export ---- */

  const handleExportPage = useCallback(({ markdown, lossy, filename }) => {
    downloadMarkdown(filename, markdown);
    setExportNote(lossy.length
      ? `Exported. Markdown can't carry ${lossy.length === 1 ? lossy[0] : `${lossy.slice(0, -1).join(", ")} and ${lossy[lossy.length - 1]}`} — those parts were written as HTML so they still display.`
      : null);
  }, []);

  const handleExportNotebook = useCallback((notebookId) => {
    const nb = (tree.notebooks || []).find((n) => n.id === notebookId);
    if (!nb) return;
    const bodies = {};
    for (const sec of nb.sections || []) for (const pg of sec.pages || []) bodies[pg.id] = readPage(pg.id);
    const { markdown, lossy } = notebookToMarkdown(nb, bodies);
    handleExportPage({ markdown, lossy, filename: safeFileName(nb.title) });
  }, [tree, handleExportPage]);

  const scopeLabel = notesScopeLabel();

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--surface-page)" }}>
      <AppHeader
        module={shellModule || "notes"}
        onSwitch={onShellSwitch}
        onDashboard={onGoDashboard}
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

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <NotesTree
          tree={tree}
          projectId={projectId}
          activePageId={activePageId}
          query={query}
          results={results}
          onQueryChange={setQuery}
          onSelectPage={(id) => { setActivePageId(id); setQuery(""); }}
          onAddNotebook={handleAddNotebook}
          onAddSection={handleAddSection}
          onAddPage={handleAddPage}
          onRename={handleRename}
          onDelete={handleDelete}
          onExportNotebook={handleExportNotebook}
        />

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {activePage ? (
            <Suspense fallback={<EditorFallback />}>
              {/* key = page id — the remount is the fix. See this file's header. */}
              <NoteEditor
                key={activePage.id}
                pageId={activePage.id}
                title={activePage.title}
                status={status}
                scopeLabel={scopeLabel}
                onTitleChange={handleTitleChange}
                onStatus={setStatus}
                onExportMarkdown={handleExportPage}
              />
            </Suspense>
          ) : (
            <EmptyState onCreate={handleAddNotebook} />
          )}

          <div
            data-testid="notes-scope-label"
            style={{
              flex: "none", padding: "5px 14px", borderTop: "1px solid var(--border-default)",
              background: "var(--surface-raised)", color: "var(--text-tertiary)", fontSize: 11.5, fontWeight: 600,
            }}
          >
            {/* Says "on this device" because that is TRUE today. When cloud sync lands this
                string changes with it — see notesStore.notesScopeLabel(). */}
            {scopeLabel} · not synced to the cloud yet
          </div>
        </div>
      </div>
    </div>
  );
}
