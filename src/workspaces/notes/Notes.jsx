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
  addNotebook, addPage, addSection, allPageIds, deleteNode, emptyTree, expiredTrashIds,
  findPage, firstPageId, migrate, moveNotebook, movePage, moveSection, purgeTrashEntry,
  renameNode, restoreNode, touchPage, trashEntries, trashPageIds, visibleNotebooks,
} from "./lib/notesModel.js";
import {
  clearNotesStorageError, notesScopeLabel, onNotesStorageError, purgePages,
  readNoteImages, readPage, readTreeRaw, searchNotes, setNotesScope,
  sweepImagesOfMissingPages, sweepOrphans, writeTree,
} from "./lib/notesStore.js";
import { imageIdsInDocs, notebookToMarkdown, safeFileName } from "./lib/notesMarkdown.js";

const NoteEditor = lazy(() => import("./components/NoteEditor.jsx"));

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar
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
  const [highlight, setHighlight] = useState("");
  const [deleted, setDeleted] = useState(null);
  const treeTimer = useRef(0);
  const treeRef = useRef(null);   // the latest tree, captured at edit time (see the flush note below)
  const undoTimer = useRef(0);

  /* Scope FIRST, then read: the store keys by the signed-in user's id (or `local`), so two
   * accounts on one machine never read each other's notes. A scope change re-reads. */
  useEffect(() => {
    setNotesScope(userId || null);
    let loaded = migrate(readTreeRaw());

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

  const active = useMemo(() => (activePageId ? findPage(tree, activePageId) : null), [tree, activePageId]);
  const activePage = active?.page || null;

  /* The page-id set of the notebook the open page lives in — what a pasted picture is
   * charged against. Recomputed from the tree, never captured, so adding a page beside
   * this one is immediately reflected in the ceiling. */
  const notebookPageIds = useMemo(() => {
    const nb = active?.notebook;
    if (!nb) return [];
    return (nb.sections || []).flatMap((s) => (s.pages || []).map((p) => p.id));
  }, [active]);

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

  /* ---- the bin ---- */

  /** TOMBSTONE-DELETES, DEFERRED — never weakened. The model computes the FULL cascade of
   *  orphaned page ids and stamps it on the trash entry; nothing is cleared here, and the
   *  purge later clears every id on that entry (bodies AND images). */
  const handleDelete = useCallback((id) => {
    const { tree: next, removedPageIds, entry } = deleteNode(tree, id);
    if (!entry) return;
    persistTree(next);
    if (removedPageIds.includes(activePageId)) setActivePageId(firstPageId(next));
    setDeleted({ id: entry.id, title: entry.title, pageIds: entry.pageIds });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => { undoTimer.current = 0; setDeleted(null); }, UNDO_MS);
  }, [tree, activePageId, persistTree]);

  const handleRestore = useCallback((entryId) => {
    const r = restoreNode(tree, entryId);
    persistTree(r.tree);
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

  /* ---- moves (B1316 — these model functions had no caller at all before this) ---- */

  const handleMovePage = useCallback((pageId, toSectionId, index) => persistTree(movePage(tree, pageId, toSectionId, index)), [tree, persistTree]);
  const handleMoveSection = useCallback((sectionId, toNotebookId, index) => persistTree(moveSection(tree, sectionId, toNotebookId, index)), [tree, persistTree]);
  const handleMoveNotebook = useCallback((notebookId, index) => persistTree(moveNotebook(tree, notebookId, index)), [tree, persistTree]);

  const handleTitleChange = useCallback((title) => {
    if (activePageId) handleRename(activePageId, title);
  }, [activePageId, handleRename]);

  /** Stamp the edited time — driven by the editor's write, NOT by a keystroke, so the field
   *  can only ever record a save that actually landed. */
  const handleSaved = useCallback((pageId) => {
    const next = touchPage(treeRef.current || tree, pageId);
    if (next !== (treeRef.current || tree)) persistTree(next);
  }, [tree, persistTree]);

  /* ---- export + print ---- */

  const handleExportPage = useCallback(({ markdown, lossy, filename }) => {
    downloadMarkdown(filename, markdown);
    setExportNote(lossy.length
      ? `Exported. Markdown can't carry ${lossy.length === 1 ? lossy[0] : `${lossy.slice(0, -1).join(", ")} and ${lossy[lossy.length - 1]}`} — those parts were written as HTML so they still display.`
      : null);
  }, []);

  const handleExportNotebook = useCallback(async (notebookId) => {
    const nb = (tree.notebooks || []).find((n) => n.id === notebookId);
    if (!nb) return;
    const bodies = {};
    for (const sec of nb.sections || []) for (const pg of sec.pages || []) bodies[pg.id] = readPage(pg.id);
    // Pictures are inlined as data URLs so an exported notebook is one self-contained file.
    const images = await readNoteImages(imageIdsInDocs(bodies));
    const { markdown, lossy } = notebookToMarkdown(nb, bodies, { images });
    handleExportPage({ markdown, lossy, filename: safeFileName(nb.title) });
  }, [tree, handleExportPage]);

  /* The print serializer imports the schema, and the schema pulls the editor engine — so it
   * is reached from this file by a DYNAMIC import only. A static one here would put ~460 KB
   * back on the route the lazy boundary exists to keep clear. */
  const handlePrintNotebook = useCallback(async (notebookId) => {
    const nb = (tree.notebooks || []).find((n) => n.id === notebookId);
    if (!nb) return;
    const bodies = {};
    const pages = [];
    for (const sec of nb.sections || []) {
      for (const pg of sec.pages || []) {
        bodies[pg.id] = readPage(pg.id);
        pages.push({ id: pg.id, title: pg.title, updatedAt: pg.updatedAt, sectionTitle: sec.title });
      }
    }
    const images = await readNoteImages(imageIdsInDocs(bodies));
    const [{ docToHtml }, { buildPrintDocument, printHtmlDocument }] = await Promise.all([
      import("./lib/notesDocHtml.js"),
      import("./lib/notesPrint.js"),
    ]);
    const html = buildPrintDocument({
      title: nb.title || "Notebook",
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

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <NotesTree
          tree={tree}
          projectId={projectId}
          activePageId={activePageId}
          query={query}
          results={results}
          onQueryChange={setQuery}
          onSelectPage={(id) => { setActivePageId(id); setQuery(""); setHighlight(""); }}
          /* Opening a SEARCH HIT carries the phrase into the page, so the editor can mark
             where it actually is — the thing search used to abandon you without. */
          onSelectHit={(id) => { setActivePageId(id); setHighlight(query); setQuery(""); }}
          onAddNotebook={handleAddNotebook}
          onAddSection={handleAddSection}
          onAddPage={handleAddPage}
          onRename={handleRename}
          onDelete={handleDelete}
          onExportNotebook={handleExportNotebook}
          onPrintNotebook={handlePrintNotebook}
          onMovePage={handleMovePage}
          onMoveSection={handleMoveSection}
          onMoveNotebook={handleMoveNotebook}
          onRestore={handleRestore}
          onPurge={handlePurge}
          onPurgeAll={handlePurgeAll}
        />

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {activePage ? (
            <Suspense fallback={<EditorFallback />}>
              {/* key = page id — the remount is the fix. See this file's header. */}
              <NoteEditor
                key={activePage.id}
                pageId={activePage.id}
                title={activePage.title}
                updatedAt={activePage.updatedAt}
                notebookTitle={active?.notebook?.title}
                sectionTitle={active?.section?.title}
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
