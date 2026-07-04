/* FolderTree (B645) — the in-app editor for a project's standard folder tree, mirrored one-way
 * into Google Drive. Structure edits write straight to Supabase (instant, authoritative); after
 * each change we ask the server to reconcile the Drive mirror. A brand-new project is seeded
 * from the canonical template on first open (idempotent).
 *
 * Editing follows the house rules: rename is an INLINE editor (no window.prompt), and a
 * non-empty delete is gated behind a LOUD confirmation that enumerates exactly what will be
 * removed from Drive (folders + files), which then mirrors as a recoverable Drive-trash move.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  treeify, childrenOf, subtreeIds, wouldCreateCycle,
  validateFolderName, suggestNextNumberedName, liveRows,
} from "../../../shared/folders/folderTree.js";
import {
  listFolders, ensureSeeded, addFolder, renameFolder, moveFolder,
  trashSubtree, syncFoldersToDrive, planFolderDelete,
} from "../lib/folders.js";

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

export default function FolderTree({ projectId = null, signedIn = false, projectName = "" }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const [editing, setEditing] = useState(null); // { id, value }
  const [moving, setMoving] = useState(null); // id being re-parented
  const [hoveredId, setHoveredId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null); // { id, name, folders, files, empty, loading }
  const [drive, setDrive] = useState({ state: "idle", msg: "" }); // idle|syncing|ok|off|error
  const syncTimer = useRef(null);

  const reload = useCallback(async () => {
    if (!signedIn || !projectId) return;
    const list = await listFolders(projectId);
    setRows(list);
    return list;
  }, [signedIn, projectId]);

  // Seed-on-first-open (idempotent) → load → expand the top level → kick a background mirror sync.
  useEffect(() => {
    let live = true;
    if (!signedIn || !projectId) { setRows([]); return; }
    (async () => {
      setLoading(true); setError("");
      const seed = await ensureSeeded(projectId);
      if (!live) return;
      if (seed && seed.ok === false && !seed.skipped) setError(seed.error || "Couldn't set up folders.");
      const list = await listFolders(projectId);
      if (!live) return;
      setRows(list);
      setExpanded(new Set(childrenOf(list, null).map((r) => r.id))); // top level open
      setLoading(false);
      scheduleSync(seed && seed.seeded ? 0 : 400); // seed → sync now so Drive materializes promptly
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, projectId]);

  // Debounced one-way reconcile to Drive after edits.
  const scheduleSync = useCallback((delay = 800) => {
    if (!projectId) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      setDrive({ state: "syncing", msg: "Mirroring to Google Drive…" });
      const r = await syncFoldersToDrive(projectId);
      if (r.skipped) setDrive({ state: "off", msg: "Saved in Planyr. Google Drive mirror is off." });
      else if (r.ok) setDrive({ state: "ok", msg: "Mirrored to Google Drive." });
      else setDrive({ state: "error", msg: r.error || "Drive sync had a problem." });
    }, delay);
  }, [projectId]);

  useEffect(() => () => { if (syncTimer.current) clearTimeout(syncTimer.current); }, []);

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
    return (
      <div key={node.id}>
        <div
          data-testid="folder-row"
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", paddingLeft: 8 + depth * 16,
            borderRadius: 6, color: T.text, minHeight: 30,
            background: hoveredId === node.id ? T.raised : "transparent",
          }}
          onMouseEnter={() => setHoveredId(node.id)}
          onMouseLeave={() => setHoveredId((h) => (h === node.id ? null : h))}
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
            <span style={{ flex: 1, cursor: kids.length ? "pointer" : "default", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => kids.length && toggle(node.id)}>{node.name}</span>
          )}

          {!isEditing && !isMoving && (
            <span style={{ display: "flex", gap: 2, opacity: hoveredId === node.id ? 1 : 0, transition: "opacity .1s" }}>
              <IconBtn title="Add subfolder" onClick={() => onAdd(node.id)}>＋</IconBtn>
              <IconBtn title="Rename" onClick={() => setEditing({ id: node.id, value: node.name })}>✎</IconBtn>
              <IconBtn title="Move" onClick={() => setMoving(node.id)}>⇄</IconBtn>
              <IconBtn title="Delete" danger onClick={() => askDelete(node)}>🗑</IconBtn>
            </span>
          )}
        </div>
        {open && kids.map((c) => renderRow(c, depth + 1))}
      </div>
    );
  };

  return (
    <div data-testid="folder-tree" style={{ height: "100%", display: "flex", flexDirection: "column", background: T.page, color: T.text, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${T.border}` }}>
        <b style={{ fontSize: 13, letterSpacing: ".02em" }}>{projectName || "Project"} · Folders</b>
        <span style={{ color: T.faint, fontSize: 12 }}>{liveCount} folder{liveCount === 1 ? "" : "s"}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => onAdd(null)} style={{ font: "inherit", fontSize: 12, padding: "4px 10px", border: "none", borderRadius: 6, background: T.accent, color: T.onAccent, cursor: "pointer" }}>＋ Category</button>
      </div>

      <DriveBadge drive={drive} onSync={() => scheduleSync(0)} />
      {error && (
        <div role="alert" style={{ padding: "6px 14px", color: T.dangerText, fontSize: 12, borderBottom: `1px solid ${T.border}` }}>
          {error} <button onClick={() => setError("")} style={{ marginLeft: 8, border: "none", background: "none", color: T.faint, cursor: "pointer" }}>dismiss</button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "8px 6px" }}>
        {loading ? <div style={{ color: T.sub, padding: 16, fontSize: 13 }}>Loading folders…</div>
          : tree.length === 0 ? <div style={{ color: T.sub, padding: 16, fontSize: 13 }}>No folders yet.</div>
            : tree.map((n) => renderRow(n, 0))}
      </div>

      {pendingDelete && (
        <DeleteConfirm info={pendingDelete} onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete} />
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick, danger }) {
  return (
    <button title={title} onClick={onClick} style={{
      width: 24, height: 24, border: "none", background: "none", cursor: "pointer", borderRadius: 4,
      color: danger ? "var(--danger)" : "var(--text-secondary)", fontSize: 13, lineHeight: 1,
    }}>{children}</button>
  );
}

function DriveBadge({ drive, onSync }) {
  if (drive.state === "idle") return null;
  const color = drive.state === "error" ? "var(--danger-text)" : drive.state === "off" ? "var(--warn-text)" : "var(--text-tertiary)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 14px", fontSize: 12, color, borderBottom: "1px solid var(--border-default)" }}>
      <span>{drive.state === "syncing" ? "↻" : drive.state === "off" ? "☁︎" : drive.state === "error" ? "!" : "✓"}</span>
      <span>{drive.msg}</span>
      {drive.state !== "syncing" && <button onClick={onSync} style={{ marginLeft: "auto", border: "none", background: "none", color: "var(--accent-library-text)", cursor: "pointer", font: "inherit" }}>Sync now</button>}
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
      style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", zIndex: 40, padding: 20 }}>
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
            {!info.driveOff && <p style={{ color: "var(--text-secondary)", fontSize: 12 }}>These move to your Google Drive trash and are recoverable for ~30 days.</p>}
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
