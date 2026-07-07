/* FolderTree (B650) — the in-app editor for a project's standard folder tree, mirrored one-way
 * into Google Drive. Structure edits write straight to Supabase (instant, authoritative); after
 * each change we ask the server to reconcile the Drive mirror. A brand-new project is seeded
 * from the canonical template on first open (idempotent).
 *
 * Editing follows the house rules: rename is an INLINE editor (no window.prompt), and a
 * non-empty delete is gated behind a LOUD confirmation that enumerates exactly what will be
 * removed from Drive (folders + files), which then mirrors as a recoverable Drive-trash move.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  treeify, childrenOf, subtreeIds, wouldCreateCycle,
  validateFolderName, suggestNextNumberedName, liveRows, displayLabel,
} from "../../../shared/folders/folderTree.js";
import {
  listFolders, ensureSeeded, addFolder, renameFolder, moveFolder,
  trashSubtree, syncFoldersToDrive, planFolderDelete,
} from "../lib/folders.js";
import { loadIdSet, saveIdSet, pruneSet } from "../../../shared/ui/persistedSet.js";
import { relTime } from "../../../shared/projects/projectModel.js";

/* Per-project remembered expansion (B-item: tree opens collapsed, not with every
 * category flung open). One key per project so switching projects can't bleed state. */
const treeOpenKey = (projectId) => `planyr:library:treeOpen:v1:${projectId}`;

/* Per-project "last CONFIRMED Drive sync on this device" (B701 — the honest resting
 * footer). Written ONLY when a real reconcile returns ok; read at mount so a mirrored-
 * but-untouched project shows "Synced · N min ago" instead of nothing. The mount sync
 * re-verifies against the real backend within seconds either way. */
const driveSyncAtKey = (projectId) => `planyr:library:driveSyncAt:v1:${projectId}`;

// Is this drag carrying OS files (vs. a text/element drag we must ignore)?
const hasFilesDrag = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

const T = {
  page: "var(--surface-page)", raised: "var(--surface-raised)", overlay: "var(--surface-overlay)",
  text: "var(--text-primary)", sub: "var(--text-secondary)", faint: "var(--text-tertiary)",
  border: "var(--border-default)", borderStrong: "var(--border-strong)",
  accent: "var(--accent-library)", onAccent: "var(--on-accent-library)", accentText: "var(--accent-library-text)",
  danger: "var(--danger)", dangerText: "var(--danger-text)", warn: "var(--warn-text)",
};

const centered = (children) => (
  <div data-testid="folder-tree" style={{ height: "100%", display: "grid", placeItems: "center", color: T.sub, padding: 24, textAlign: "center" }}>
    <div style={{ maxWidth: 340 }}>{children}</div>
  </div>
);

/* Standalone (full-page) or `embedded` as the Library's left rail (the unified view): embedded
 * adds row SELECTION (`selectedId` + `onSelect(folderId|null)` — null = "All files"), per-folder
 * file counts (`fileCounts`: Map folderId→n, null key = total), and publishes its rows upward
 * (`onRowsChange`) so the file list can place files into this same tree. */
export default function FolderTree({
  projectId = null, signedIn = false, projectName = "",
  embedded = false, selectedId = null, onSelect = null, onRowsChange = null, fileCounts = null,
  // Library-Home pins: which folder ids are pinned + the ☆ toggle (both optional).
  pinnedIds = null, onTogglePin = null,
  /* Folder rows as DROP TARGETS (B699): dragging files over a row highlights it and
   * dropping hands the raw drop event up — `onFileDrop(folderId|null, event)` — for the
   * file browser to ingest straight into that folder (null = the "All files" row → the
   * auto-file path). `onDragTarget(label|null)` keeps the drop-overlay pill honest. */
  onFileDrop = null, onDragTarget = null,
}) {
  const [rows, setRowsRaw] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const [editing, setEditing] = useState(null); // { id, value }
  const [moving, setMoving] = useState(null); // id being re-parented
  const [hoveredId, setHoveredId] = useState(null);
  const [menu, setMenu] = useState(null); // right-click actions: { node, x, y } (node null = empty space)
  const [pendingDelete, setPendingDelete] = useState(null); // { id, name, folders, files, empty, loading }
  const [drive, setDrive] = useState({ state: "idle", msg: "", at: 0 }); // idle|syncing|ok|off|error
  const [dropTargetId, setDropTargetId] = useState(undefined); // undefined = none; null = the "All files" row
  const dropTargetRef = useRef(undefined); // ref mirror — dragover/dragleave race without re-render lag
  const setDropTarget = (id, label) => { dropTargetRef.current = id; setDropTargetId(id); onDragTarget?.(label); };
  const syncTimer = useRef(null);
  // Which project's stored expansion has been restored — persistence must not fire before the
  // restore (the initial empty set would overwrite what the user had open last visit).
  const expandedLoadedFor = useRef(null);

  // Every rows update also publishes upward (the unified view places files by these rows).
  const setRows = useCallback((list) => { setRowsRaw(list); onRowsChange?.(list); },
    [onRowsChange]);

  const reload = useCallback(async () => {
    if (!signedIn || !projectId) return;
    const list = await listFolders(projectId);
    setRows(list);
    return list;
  }, [signedIn, projectId, setRows]);

  // Seed-on-first-open (idempotent) → load → restore this project's remembered expansion
  // (default: everything collapsed) → kick a background mirror sync.
  useEffect(() => {
    let live = true;
    expandedLoadedFor.current = null;
    setDrive({ state: "idle", msg: "", at: 0 }); // a project switch must not inherit the last project's status
    if (!signedIn || !projectId) { setRows([]); return; }
    (async () => {
      setLoading(true); setError("");
      const seed = await ensureSeeded(projectId);
      if (!live) return;
      if (seed && seed.ok === false && !seed.skipped) setError(seed.error || "Couldn't set up folders.");
      const list = await listFolders(projectId);
      if (!live) return;
      setRows(list);
      // Restore what the user last had open, pruning ids of since-deleted folders. A first
      // visit restores the empty set = all collapsed (the tree no longer flings itself open).
      setExpanded(pruneSet(loadIdSet(treeOpenKey(projectId)), new Set(list.map((r) => r.id))));
      expandedLoadedFor.current = projectId;
      setLoading(false);
      // Resting mirror status (B701): every live folder already has its Drive id AND this
      // device saw a confirmed sync → show the honest "Synced · N min ago" instead of a
      // blank footer. Anything less stays idle until the real reconcile below reports.
      let at = 0;
      try { at = Number(localStorage.getItem(driveSyncAtKey(projectId))) || 0; } catch (_) { at = 0; }
      const liveList = liveRows(list);
      if (at && liveList.length > 0 && liveList.every((r) => r.driveFolderId)) {
        setDrive({ state: "ok", msg: "", at });
      }
      scheduleSync(seed && seed.seeded ? 0 : 400); // seed → sync now so Drive materializes promptly
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, projectId]);

  // Persist expansion the moment it changes — but only after this project's restore ran,
  // and only for the project the state belongs to (guards the project-switch transition).
  useEffect(() => {
    if (projectId && expandedLoadedFor.current === projectId) saveIdSet(treeOpenKey(projectId), expanded);
  }, [expanded, projectId]);

  // Debounced one-way reconcile to Drive after edits. The server syncs one small chunk per
  // request (the 502 fix), so this reports live progress across the rounds.
  const scheduleSync = useCallback((delay = 800) => {
    if (!projectId) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      setDrive({ state: "syncing", msg: "Mirroring to Google Drive…" });
      const r = await syncFoldersToDrive(projectId, {
        onProgress: ({ done, total }) => setDrive({ state: "syncing", msg: `Mirroring to Google Drive… ${done} of ${total}` }),
      });
      if (r.skipped) setDrive({ state: "off", msg: "Saved in Planyr — Google Drive isn't connected.", at: 0 });
      else if (r.ok) {
        // A CONFIRMED reconcile — the only thing that may claim "Synced" (LOUD-FAILURE:
        // the label is driven by the real backend result, never a static checkmark).
        const at = Date.now();
        try { localStorage.setItem(driveSyncAtKey(projectId), String(at)); } catch (_) { /* footer still shows this session's time */ }
        setDrive({ state: "ok", msg: "", at });
      } else setDrive({ state: "error", msg: r.error || "Drive sync had a problem.", at: 0 });
    }, delay);
  }, [projectId]);

  useEffect(() => () => { if (syncTimer.current) clearTimeout(syncTimer.current); }, []);

  // Right-click context menu closes on Escape (the backdrop handles click-away).
  useEffect(() => {
    if (!menu) return;
    const onKey = (e) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const tree = useMemo(() => treeify(rows), [rows]);
  const live = useMemo(() => liveRows(rows), [rows]);
  const liveCount = live.length;

  // ── structural ops (optimistic-ish: write, reload, sync) ───────────────────────────────
  const toggle = (id) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const onAdd = async (parentId) => {
    const siblings = childrenOf(rows, parentId);
    // Keep the suggested name unique among siblings (an unnumbered parent can otherwise yield two
    // "New Folder"s — a duplicate the rename path + Drive mirror assume can't exist).
    const base = suggestNextNumberedName(siblings, "New Folder");
    let name = base, n = 2;
    while (!validateFolderName(name, siblings).ok && n < 100) name = `${base} (${n++})`;
    const r = await addFolder({ projectId, parentId, name });
    if (!r.ok) { setError(r.error || "Couldn't add the folder."); return; }
    if (parentId) setExpanded((s) => new Set(s).add(parentId));
    await reload();
    setEditing({ id: r.id, value: name }); // drop straight into rename so they can label it
    scheduleSync();
  };

  const commitRename = async () => {
    if (!editing) return;
    const row = rows.find((x) => x.id === editing.id);
    const siblings = childrenOf(rows, row ? row.parentId : null);
    const v = validateFolderName(editing.value, siblings, editing.id);
    if (!v.ok) { setError(v.error); return; }
    setEditing(null); setError("");
    if (row && v.name === row.name) return; // no-op
    const r = await renameFolder(editing.id, v.name);
    if (!r.ok) { setError(r.error || "Rename failed."); await reload(); return; }
    await reload();
    scheduleSync();
  };

  const onMove = async (id, newParentId) => {
    setMoving(null);
    if (wouldCreateCycle(rows, id, newParentId)) { setError("Can’t move a folder into itself."); return; }
    // Reject a move that would collide with a same-named folder already at the destination.
    const movingRow = rows.find((x) => x.id === id);
    const v = validateFolderName(movingRow ? movingRow.name : "", childrenOf(rows, newParentId), id);
    if (!v.ok) { setError(`Can’t move here — ${v.error}`); return; }
    const r = await moveFolder(id, newParentId);
    if (!r.ok) { setError(r.error || "Move failed."); return; }
    if (newParentId) setExpanded((s) => new Set(s).add(newParentId));
    await reload();
    scheduleSync();
  };

  const askDelete = async (row) => {
    const subtree = subtreeIds(rows, row.id);
    const subfolderCount = subtree.size - 1;
    setPendingDelete({ id: row.id, name: row.name, folders: [], files: [], subfolderCount, empty: false, loading: true });
    const plan = await planFolderDelete(projectId, row.id); // live Drive enumeration
    const known = !!plan.ok;                  // we actually listed Drive contents
    const driveOff = !!plan.skipped;          // Drive mirror off → index-only, no Drive files exist
    const failed = !plan.ok && !plan.skipped; // couldn't check (network / auth / 5xx) → UNKNOWN
    setPendingDelete((p) => (p && p.id === row.id ? {
      ...p, loading: false, driveOff, failed,
      folders: known ? plan.folders : [],
      files: known ? plan.files : [],
      truncated: known ? !!plan.truncated : false,
      // NEVER claim "empty" when the check FAILED — that would let a folder holding real Drive
      // files be deleted behind a false "This folder is empty" (silent data loss). "Empty" is
      // trustworthy only when we listed Drive (known) or Drive is legitimately off (index-only).
      empty: known ? (plan.files.length === 0 && plan.folders.length <= 1) : driveOff ? subfolderCount === 0 : false,
      planError: failed ? (plan.error || "Couldn’t check Google Drive contents.") : "",
    } : p));
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setPendingDelete(null);
    const r = await trashSubtree(projectId, id);
    if (!r.ok) { setError(r.error || "Delete failed."); return; }
    await reload();
    scheduleSync(0); // trash the Drive folders promptly
  };

  // ── render ─────────────────────────────────────────────────────────────────────────────
  if (!signedIn) return centered(<><b style={{ color: T.text }}>Sign in to use project folders.</b><p style={{ marginTop: 8 }}>Folders live in your account and mirror to your Google Drive.</p></>);
  if (!projectId) return centered(<><b style={{ color: T.text }}>Pick a project</b><p style={{ marginTop: 8 }}>Choose a project to see and edit its folder tree.</p></>);

  const moveTargets = (id) => {
    const banned = subtreeIds(rows, id); // self + descendants
    return [{ id: null, name: "— Top level —" }, ...live.filter((r) => !banned.has(r.id)).sort((a, b) => a.name.localeCompare(b.name))];
  };

  // Rendered as a plain recursive FUNCTION (not a `<Row/>` component), so React reconciles the
  // rows by position instead of unmounting/remounting a freshly-defined component type on every
  // FolderTree re-render — which had torn down the inline rename <input> mid-edit (lost focus /
  // dropped keystrokes) and churned every row on hover. The returned root <div> carries the key.
  const renderRow = (node, depth) => {
    const kids = node.children || [];
    const open = expanded.has(node.id);
    const isEditing = editing && editing.id === node.id;
    const isMoving = moving === node.id;
    const isSelected = embedded && selectedId === node.id;
    const count = fileCounts ? fileCounts.get(node.id) || 0 : null;
    // Embedded (the unified Library): single-click a name SELECTS the folder (peek — filters
    // the file list); the caret owns expand/collapse. DOUBLE-click OPENS it like File Explorer
    // — select it AND expand it in place so its subfolders reveal (drill in). Standalone keeps
    // click-to-toggle.
    const onNameClick = embedded
      ? () => onSelect?.(node.id)
      : () => kids.length && toggle(node.id);
    const onNameDouble = embedded
      ? () => { onSelect?.(node.id); if (kids.length) setExpanded((s) => new Set(s).add(node.id)); }
      : undefined;
    const isDropTarget = !!onFileDrop && dropTargetId === node.id;
    return (
      <div key={node.id}>
        <div
          data-testid="folder-row"
          title={`${node.name} — right-click for options`}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", paddingLeft: 8 + depth * 16,
            borderRadius: 6, color: T.text, minHeight: 30,
            outline: isDropTarget ? `1.5px dashed ${T.accent}` : "none", outlineOffset: -1.5,
            background: isDropTarget ? "var(--hover-menu)"
              : isSelected ? "var(--hover-menu)"
              : (hoveredId === node.id || (menu && menu.node && menu.node.id === node.id)) ? T.raised : "transparent",
          }}
          onMouseEnter={() => setHoveredId(node.id)}
          onMouseLeave={() => setHoveredId((h) => (h === node.id ? null : h))}
          onContextMenu={(e) => { if (isEditing || isMoving) return; e.preventDefault(); e.stopPropagation(); setMenu({ node, x: e.clientX, y: e.clientY }); }}
          /* Drop a drag straight INTO this folder (B699) — the Explorer gesture. ARM on
           * dragenter (Chromium fires the new row's dragenter BEFORE the old row's
           * dragleave, so hopping rows re-targets before the clear can fire — no flicker)
           * and keep dragover as the belt-and-suspenders re-arm; leave clears only if this
           * row is STILL the current target (the ref mirror) and only when the pointer
           * really left this row's subtree (child spans can't flicker it). */
          onDragEnter={onFileDrop ? (e) => {
            if (!hasFilesDrag(e)) return;
            e.preventDefault();
            if (dropTargetRef.current !== node.id) setDropTarget(node.id, displayLabel(node.name));
          } : undefined}
          onDragOver={onFileDrop ? (e) => {
            if (!hasFilesDrag(e)) return;
            e.preventDefault(); e.stopPropagation();
            if (dropTargetRef.current !== node.id) setDropTarget(node.id, displayLabel(node.name));
          } : undefined}
          onDragLeave={onFileDrop ? (e) => {
            if (e.currentTarget.contains(e.relatedTarget)) return;
            if (dropTargetRef.current === node.id) setDropTarget(undefined, null);
          } : undefined}
          onDrop={onFileDrop ? (e) => {
            e.preventDefault(); e.stopPropagation();
            setDropTarget(undefined, null);
            onFileDrop(node.id, e);
          } : undefined}
        >
          <button
            onClick={() => kids.length && toggle(node.id)}
            aria-label={open ? "Collapse" : "Expand"}
            style={{ width: 16, height: 16, border: "none", background: "none", cursor: kids.length ? "pointer" : "default", color: T.faint, fontSize: 10, padding: 0, visibility: kids.length ? "visible" : "hidden" }}
          >{open ? "▾" : "▸"}</button>
          <span aria-hidden style={{ color: T.accentText }}>{kids.length ? (open ? "📂" : "📁") : "📁"}</span>

          {isEditing ? (
            <input
              autoFocus
              value={editing.value}
              onChange={(e) => setEditing({ id: node.id, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setEditing(null); setError(""); } }}
              onBlur={commitRename}
              style={{ flex: 1, font: "inherit", padding: "2px 6px", border: `1px solid ${T.accent}`, borderRadius: 4, background: T.raised, color: T.text }}
            />
          ) : isMoving ? (
            <select
              autoFocus
              defaultValue={String(node.parentId ?? "")}
              onChange={(e) => onMove(node.id, e.target.value === "" ? null : e.target.value)}
              onBlur={() => setMoving(null)}
              style={{ flex: 1, font: "inherit", padding: "2px 6px", border: `1px solid ${T.accent}`, borderRadius: 4, background: T.raised, color: T.text }}
            >
              {moveTargets(node.id).map((t) => <option key={t.id ?? "top"} value={t.id ?? ""}>{t.name}</option>)}
            </select>
          ) : (
            <span style={{ flex: 1, cursor: embedded || kids.length ? "pointer" : "default", fontWeight: isSelected ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={onNameClick} onDoubleClick={onNameDouble}>{node.name}</span>
          )}

          {/* Row actions (pin / add / rename / move / delete) moved to a right-click context
              menu (B-item) so they no longer clutter the row on hover. The quiet pinned marker
              and rolled-up file count still show inline. */}
          {!isEditing && !isMoving && (
            pinnedIds && pinnedIds.has(node.id) ? (
              <span aria-hidden style={{ flex: "none", fontSize: 11, color: T.accentText, paddingRight: 4 }}>★</span>
            ) : count ? (
              // Rolled-up file count (files in this folder + everything under it).
              <span style={{ flex: "none", fontSize: 11, fontWeight: 600, color: T.faint, paddingRight: 4 }}>{count}</span>
            ) : null
          )}
        </div>
        {open && kids.map((c) => renderRow(c, depth + 1))}
      </div>
    );
  };

  const totalFiles = fileCounts ? fileCounts.get(null) || 0 : null;

  return (
    <div data-testid="folder-tree" style={{ height: "100%", display: "flex", flexDirection: "column", background: embedded ? "transparent" : T.page, color: T.text, overflow: "hidden" }}>
      {embedded ? (
        // Rail header (the unified Library) — the project name lives in the breadcrumb above,
        // so this stays a quiet label. Folder creation is right-click → New folder (B698):
        // one word ("folder"), one gesture, matching File Explorer — no header button.
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "11px 10px 7px 14px" }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {projectName || "Project"} · Folders
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
          <b style={{ fontSize: 13, letterSpacing: ".02em" }}>{projectName || "Project"} · Folders</b>
          <span style={{ color: T.faint, fontSize: 12 }}>{liveCount} folder{liveCount === 1 ? "" : "s"}</span>
        </div>
      )}

      {error && (
        <div role="alert" style={{ padding: "6px 14px", color: T.dangerText, fontSize: 12, borderBottom: `1px solid ${T.border}` }}>
          {error} <button onClick={() => setError("")} style={{ marginLeft: 8, border: "none", background: "none", color: T.faint, cursor: "pointer" }}>dismiss</button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "4px 6px 8px" }}
        /* Right-click on EMPTY tree space → "New folder" at the top level (B698, the File
         * Explorer convention). A row's own context menu handled the event already (it
         * stops propagation), and the closest() check catches the row's inner elements. */
        onContextMenu={(e) => {
          if (e.target.closest && e.target.closest('[data-testid="folder-row"]')) return;
          e.preventDefault();
          setMenu({ node: null, x: e.clientX, y: e.clientY });
        }}>
        {/* "All files" — clears the folder filter (embedded only; standalone has no file list).
            As a drop target it means "auto-file by title block" (B699). */}
        {embedded && !loading && (
          <div
            onClick={() => onSelect?.(null)}
            onDragEnter={onFileDrop ? (e) => {
              if (!hasFilesDrag(e)) return;
              e.preventDefault();
              if (dropTargetRef.current !== null) setDropTarget(null, "All files — auto-sort (a folder keeps its own layout)");
            } : undefined}
            onDragOver={onFileDrop ? (e) => {
              if (!hasFilesDrag(e)) return;
              e.preventDefault(); e.stopPropagation();
              if (dropTargetRef.current !== null) setDropTarget(null, "All files — auto-sort (a folder keeps its own layout)");
            } : undefined}
            onDragLeave={onFileDrop ? (e) => {
              if (e.currentTarget.contains(e.relatedTarget)) return;
              if (dropTargetRef.current === null) setDropTarget(undefined, null);
            } : undefined}
            onDrop={onFileDrop ? (e) => {
              e.preventDefault(); e.stopPropagation();
              setDropTarget(undefined, null);
              onFileDrop(null, e);
            } : undefined}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", marginBottom: 2, borderRadius: 6, cursor: "pointer",
              outline: onFileDrop && dropTargetId === null ? `1.5px dashed ${T.accent}` : "none", outlineOffset: -1.5,
              background: (onFileDrop && dropTargetId === null) || selectedId == null ? "var(--hover-menu)" : "transparent", color: T.text }}>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700 }}>All files</span>
            {totalFiles != null && <span style={{ flex: "none", fontSize: 11, fontWeight: 600, color: T.faint, paddingRight: 4 }}>{totalFiles}</span>}
          </div>
        )}
        {loading ? <div style={{ color: T.sub, padding: 16, fontSize: 13 }}>Loading folders…</div>
          : tree.length === 0 ? <div style={{ color: T.sub, padding: 16, fontSize: 13 }}>No folders yet. Right-click here to create one.</div>
            : tree.map((n) => renderRow(n, 0))}
        {/* Guaranteed right-clickable empty space even when the rows fill the rail — without
            it a full tree would leave NO reachable spot for a top-level "New folder". */}
        {!loading && <div aria-hidden style={{ minHeight: 44 }} />}
      </div>

      {/* Drive-mirror status pinned at the rail's foot, always visible while syncing. */}
      <DriveBadge drive={drive} onSync={() => scheduleSync(0)} />

      {menu && (
        <FolderContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          pinnedIds={pinnedIds}
          onTogglePin={onTogglePin}
          onAdd={onAdd}
          onRename={(node) => setEditing({ id: node.id, value: node.name })}
          onMove={(id) => setMoving(id)}
          onDelete={askDelete}
        />
      )}

      {pendingDelete && (
        <DeleteConfirm info={pendingDelete} onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete} />
      )}
    </div>
  );
}

/* Right-click actions for a folder row — or, with `menu.node` null, for EMPTY tree space
 * (just "New folder" at the top level, the File Explorer convention — B698). Rendered in a
 * body portal (like the project-manage menu in ProjectBreadcrumb) so it floats above the
 * tree at the cursor: a full-screen backdrop closes it on any click / right-click, and each
 * item runs its action then dismisses. Positioned at the click point, clamped so it never
 * spills past the viewport edge. */
function FolderContextMenu({ menu, onClose, pinnedIds, onTogglePin, onAdd, onRename, onMove, onDelete }) {
  const node = menu.node; // null = empty-space menu
  const pinned = !!(node && pinnedIds && pinnedIds.has(node.id));
  const W = 210, H = 232; // approx footprint for edge clamping
  const left = Math.max(6, Math.min(menu.x, window.innerWidth - W - 8));
  const top = Math.max(6, Math.min(menu.y, window.innerHeight - H - 8));
  const item = (extra) => ({
    display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
    padding: "7px 10px", border: "none", background: "transparent", cursor: "pointer",
    borderRadius: 6, font: "inherit", fontSize: 13, color: T.text, ...extra,
  });
  const hoverOn = (e) => { e.currentTarget.style.background = "var(--hover-ghost)"; };
  const hoverOff = (e) => { e.currentTarget.style.background = "transparent"; };
  const run = (fn) => () => { onClose(); fn(); };
  const glyph = { flex: "none", width: 16, textAlign: "center", fontSize: 13 };
  return createPortal(
    <>
      <div role="presentation" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}
        style={{ position: "fixed", inset: 0, zIndex: 5000 }} />
      <div data-testid="folder-context-menu" role="menu" aria-label="Folder actions"
        style={{
          // OPAQUE surface (not --surface-overlay, which is translucent "frosted" — folder names
          // behind the menu would bleed through it): a context menu over a text list must be solid.
          position: "fixed", zIndex: 5001, left, top, minWidth: W, padding: 5,
          background: T.raised, color: T.text, border: `1px solid ${T.borderStrong}`,
          borderRadius: 10, boxShadow: "0 12px 40px rgba(0,0,0,.35)",
        }}>
        <div style={{ padding: "4px 10px 6px", fontSize: 11, fontWeight: 700, color: T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node ? node.name : "Folders"}</div>
        {node && onTogglePin && (
          <button role="menuitem" onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={run(() => onTogglePin(node))} style={item()}>
            <span aria-hidden style={glyph}>{pinned ? "★" : "☆"}</span>{pinned ? "Unpin from Library home" : "Pin to Library home"}
          </button>
        )}
        {/* On a row this creates INSIDE it; on empty space, at the top level (B698). */}
        <button role="menuitem" onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={run(() => onAdd(node ? node.id : null))} style={item()}>
          <span aria-hidden style={glyph}>＋</span>New folder
        </button>
        {node && <button role="menuitem" onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={run(() => onRename(node))} style={item()}>
          <span aria-hidden style={glyph}>✎</span>Rename
        </button>}
        {node && <button role="menuitem" onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={run(() => onMove(node.id))} style={item()}>
          <span aria-hidden style={glyph}>⇄</span>Move
        </button>}
        {node && <button role="menuitem" onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={run(() => onDelete(node))} style={item({ color: T.dangerText })}>
          <span aria-hidden style={glyph}>🗑</span>Delete
        </button>}
      </div>
    </>,
    document.body,
  );
}

/* The rail-foot mirror status (B701 — honest, backend-driven, per the B125 badge rules):
 *   ok      → "✓ Synced to Google Drive · N min ago" — ONLY after a confirmed reconcile
 *             (or the resting restore of one); the timestamp ticks live.
 *   syncing → progress text, no button.
 *   off     → amber "Google Drive isn't connected" — a graceful skip, named as such.
 *   error   → red, PERSISTENT failure text + a loud Retry. Never silently green.
 * "Sync now" is the demoted secondary action (quiet tertiary link): it forces a full
 * reconcile pass — every folder re-checked against Drive, anything missing re-mirrored. */
function DriveBadge({ drive, onSync }) {
  // Ticking clock for "· N min ago" (60s beat — relTime is minute-grained).
  const [, bump] = useState(0);
  useEffect(() => {
    if (drive.state !== "ok" || !drive.at) return;
    const t = setInterval(() => bump((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [drive.state, drive.at]);
  if (drive.state === "idle") return null;
  const color = drive.state === "error" ? "var(--danger-text)" : drive.state === "off" ? "var(--warn-text)" : "var(--text-tertiary)";
  const glyph = { syncing: "↻", off: "☁︎", error: "!", ok: "✓" }[drive.state] || "";
  const label = drive.state === "ok"
    ? `Synced to Google Drive${drive.at ? ` · ${relTime(drive.at)}` : ""}`
    : drive.msg;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", fontSize: 12, color, borderTop: "1px solid var(--border-default)", flexWrap: "wrap" }}>
      <span>{glyph}</span>
      <span style={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}>{label}</span>
      {drive.state !== "syncing" && (
        <button onClick={onSync}
          title="Force a full re-check: verifies every folder against Google Drive and re-mirrors anything missing"
          style={{ flex: "none", border: "none", background: "none", cursor: "pointer", font: "inherit",
            color: drive.state === "error" ? "var(--danger-text)" : "var(--text-tertiary)",
            fontWeight: drive.state === "error" ? 700 : 400, textDecoration: "underline" }}>
          {drive.state === "error" ? "Retry" : "Sync now"}
        </button>
      )}
    </div>
  );
}

/* The loud, explicit delete confirmation the brief requires: it enumerates exactly the folders
 * and files that will be removed from Drive so the user never blindly confirms a destructive
 * delete. The mirror moves them to Drive's trash (recoverable ~30 days), not a permanent wipe. */
function DeleteConfirm({ info, onCancel, onConfirm }) {
  const many = (arr, n = 8) => arr.slice(0, n);
  const fileCount = info.files.length;
  const folderCount = info.folders.length;
  return (
    <div role="dialog" aria-modal="true" onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", zIndex: 40, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(460px, 96%)", maxHeight: "84%", overflow: "auto", background: "var(--surface-overlay)", color: "var(--text-primary)", borderRadius: 12, border: "1px solid var(--border-strong)", boxShadow: "0 12px 40px rgba(0,0,0,.35)", padding: 20 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>Delete “{info.name}”?</h3>
        {info.loading ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>Checking what’s inside on Google Drive…</p>
        ) : info.failed ? (
          <>
            <p style={{ color: "var(--danger-text)", fontSize: 13.5, fontWeight: 600, margin: "0 0 8px" }}>
              ⚠ Couldn’t check what’s on Google Drive right now ({info.planError}).
            </p>
            <p style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>
              Deleting removes this folder and <b>everything inside it</b> — its subfolders and any files, in Planyr and its Drive mirror — but the exact contents can’t be listed at the moment. The Drive copies move to trash (recoverable ~30 days). Delete anyway?
            </p>
          </>
        ) : info.empty ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 13.5 }}>This folder is empty. It will be removed from Planyr{!info.driveOff ? " and moved to your Google Drive trash (recoverable ~30 days)" : ""}.</p>
        ) : (
          <>
            <p style={{ color: "var(--danger-text)", fontSize: 13.5, fontWeight: 600, margin: "0 0 8px" }}>
              This removes {folderCount} folder{folderCount === 1 ? "" : "s"}{fileCount ? ` and ${fileCount}${info.truncated ? "+" : ""} file${fileCount === 1 && !info.truncated ? "" : "s"}` : ""} from {info.driveOff ? "Planyr" : "Google Drive"}.
            </p>
            {info.driveOff && <p style={{ color: "var(--warn-text)", fontSize: 12 }}>Drive mirror is off — this can’t list Drive files, only the Planyr subfolders.</p>}
            {fileCount > 0 && (
              <div style={{ fontSize: 12.5, marginBottom: 8 }}>
                <div style={{ color: "var(--text-tertiary)", marginBottom: 3 }}>Files that will be removed:</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {many(info.files).map((f, i) => <li key={i}><b>{f.name}</b> <span style={{ color: "var(--text-tertiary)" }}>· {f.folder}</span></li>)}
                </ul>
                {fileCount > 8 && <div style={{ color: "var(--text-tertiary)", marginTop: 2 }}>+{fileCount - 8} more…</div>}
              </div>
            )}
            {info.truncated && <p style={{ color: "var(--warn-text)", fontSize: 12 }}>Some folders hold more than 1,000 files — the list above may be partial; all of them are removed.</p>}
            {!info.driveOff && <p style={{ color: "var(--text-tertiary)", fontSize: 11.5 }}>Plus anything added straight into Google Drive (not shown — Planyr only tracks files it filed).</p>}
            {!info.driveOff && <p style={{ color: "var(--text-secondary)", fontSize: 12 }}>These move to your Google Drive trash and are recoverable for ~30 days. Their entries stay in your file list (they re-shelve under Drawings) until you delete them individually.</p>}
          </>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} style={{ font: "inherit", fontSize: 13, padding: "7px 14px", borderRadius: 7, border: "1px solid var(--border-strong)", background: "var(--surface-raised)", color: "var(--text-primary)", cursor: "pointer" }}>Cancel</button>
          <button onClick={onConfirm} disabled={info.loading} style={{ font: "inherit", fontSize: 13, fontWeight: 600, padding: "7px 14px", borderRadius: 7, border: "none", background: "var(--danger)", color: "#fff", cursor: info.loading ? "default" : "pointer", opacity: info.loading ? 0.6 : 1 }}>Delete</button>
        </div>
      </div>
    </div>
  );
}
