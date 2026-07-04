/* Drive folder-mirror executor (B645) — the I/O half of the one-way Planyr → Drive sync.
 *
 * folderReconcile.js decides WHAT to do (pure); this runs it against Google Drive and writes
 * the resulting Drive ids back into the folder index. Both the Drive `client` and the Supabase
 * `store` are injected, so the whole thing is unit-tested with fakes — no network, no creds.
 *
 * Guarantees:
 *  • Reconcile is BY STORED DRIVE ID — rename/move act on the existing folder in place.
 *  • Creates run parents-first (folderReconcile orders them); each new id is threaded to its
 *    children within the same pass, so a fresh tree materializes in one sync.
 *  • Delete mirrors as Drive TRASH (recoverable ~30 days), and trashing a subtree root cascades
 *    in Drive — so we trash only roots, then flag the whole subtree drive_trashed.
 *  • Every op is guarded: a single failure is collected and reported, never thrown, never a
 *    silent success (a create whose id doesn't persist would read back as "never mirrored").
 */
import { folderReconcilePlan, planIsEmpty } from "./folderReconcile.js";

// Path-safe slug matching functions/api/files.js, so the folder tree and filed documents share
// one project root in Drive (Planyr/<uid>/project-<slug>/…).
export const slugSeg = (s) =>
  (s || "").toString().toLowerCase().replace(/[^a-z0-9/]+/g, "-").replace(/^-+|-+$/g, "") || "x";

// id + all descendant ids from a flat row list (server-side twin of folderTree.subtreeIds).
function subtreeRowIds(rows, id) {
  const kids = new Map();
  for (const r of rows || []) {
    const p = r.parentId ?? null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(r.id);
  }
  const out = new Set([id]);
  const stack = [id];
  while (stack.length) {
    for (const c of kids.get(stack.pop()) || []) {
      if (!out.has(c)) { out.add(c); stack.push(c); }
    }
  }
  return out;
}

/* Reconcile a project's folder tree into Drive. Returns
 * { ok, summary:{ created, renamed, moved, trashed }, errors:[...] }.
 * `ok` is true when every planned op succeeded (errors empty). */
export async function syncProjectFolders({ projectId, userId, client, store }) {
  if (!projectId) return { ok: false, error: "Missing projectId." };
  const rows = await store.list(projectId);
  const plan = folderReconcilePlan(rows);
  const summary = { created: 0, renamed: 0, moved: 0, trashed: 0 };
  const errors = [];
  if (planIsEmpty(plan)) return { ok: true, summary, errors };

  // The project's own Drive root (created on demand, app-created under drive.file).
  const projectRoot = await client.folderId(`${userId}/project-${slugSeg(projectId)}`);

  // Drive id per row: seed from what's already mirrored, fill as we create.
  const driveId = new Map(rows.filter((r) => r.driveFolderId).map((r) => [r.id, r.driveFolderId]));
  const resolveParent = (parentId) => (parentId == null ? projectRoot : driveId.get(parentId));

  // 1) Creates — parents first (already ordered), threading each new id to its children.
  for (const c of plan.creates) {
    let createdId = null;
    try {
      const parent = resolveParent(c.parentId);
      if (!parent) { errors.push(`create ${c.id}: parent not yet in Drive`); continue; }
      const res = await client.createSubfolder({ name: c.name, parentFolderId: parent });
      if (!res || !res.id) { errors.push(`create ${c.id}: Drive returned no id`); continue; }
      createdId = res.id;
      driveId.set(c.id, res.id);
      const persisted = await store.updateDrive(c.id, {
        driveFolderId: res.id,
        driveParentId: c.parentId == null ? null : parent,
        driveName: c.name,
      });
      if (persisted && persisted.ok === false) {
        // The Drive folder exists but its id never persisted → the next sync would RE-create it
        // (createSubfolder is create-not-ensure), leaving a duplicate empty folder in Drive. Trash
        // the orphan and forget it so the retry starts clean; its children defer to that retry.
        driveId.delete(c.id);
        try { await client.trash(createdId); } catch (_) { /* best-effort rollback */ }
        errors.push(`create ${c.id}: ${persisted.error} (rolled back the orphaned Drive folder)`);
      } else summary.created += 1;
    } catch (e) {
      // Persist (or a later step) threw AFTER the Drive folder was made → same rollback.
      if (createdId) { driveId.delete(c.id); try { await client.trash(createdId); } catch (_) { /* best-effort */ } }
      errors.push(`create ${c.id}: ${(e && e.message) || e}`);
    }
  }

  // 2) Renames in place.
  for (const r of plan.renames) {
    try {
      await client.update(r.driveFolderId, { name: r.name });
      const persisted = await store.updateDrive(r.id, { driveName: r.name });
      if (persisted && persisted.ok === false) errors.push(`rename ${r.id}: ${persisted.error}`);
      else summary.renamed += 1;
    } catch (e) { errors.push(`rename ${r.id}: ${(e && e.message) || e}`); }
  }

  // 3) Moves in place (add new parent, remove old — old null means it sat at the project root).
  for (const m of plan.moves) {
    try {
      const addParent = m.newParentId == null ? projectRoot : driveId.get(m.newParentId);
      if (!addParent) { errors.push(`move ${m.id}: new parent not in Drive`); continue; }
      await client.update(m.driveFolderId, { addParents: addParent, removeParents: m.removeParent || projectRoot });
      const persisted = await store.updateDrive(m.id, { driveParentId: m.newParentId == null ? null : addParent });
      if (persisted && persisted.ok === false) errors.push(`move ${m.id}: ${persisted.error}`);
      else summary.moved += 1;
    } catch (e) { errors.push(`move ${m.id}: ${(e && e.message) || e}`); }
  }

  // 4) Trash subtree roots; Drive cascades to the contents, so flag the whole subtree.
  for (const t of plan.trashes) {
    try {
      await client.trash(t.driveFolderId);
      for (const id of subtreeRowIds(rows, t.id)) {
        const persisted = await store.updateDrive(id, { driveTrashed: true });
        if (persisted && persisted.ok === false) errors.push(`trash ${id}: ${persisted.error}`);
      }
      summary.trashed += 1;
    } catch (e) { errors.push(`trash ${t.id}: ${(e && e.message) || e}`); }
  }

  return { ok: errors.length === 0, summary, errors };
}

/* Enumerate exactly what deleting `folderId`'s subtree would remove from Drive, for the loud
 * confirmation the brief requires. Returns { ok, folders:[{id,name}], files:[{name,folder}] }.
 * Folders come from the index (always known); files are read LIVE from Drive (so it catches
 * files the user dropped straight into the Drive folder too, not just Planyr-filed ones). If a
 * subtree folder was never mirrored (no drive id), it simply contributes no Drive files. */
export async function planDelete({ projectId, folderId, client, store }) {
  if (!folderId) return { ok: false, error: "Missing folderId." };
  const rows = await store.list(projectId);
  const ids = subtreeRowIds(rows, folderId);
  const inSubtree = rows.filter((r) => ids.has(r.id) && !r.trashed);
  const folders = inSubtree.map((r) => ({ id: r.id, name: r.name }));

  const files = [];
  let truncated = false; // a folder returned a full page → the file list may be incomplete (>1000)
  for (const r of inSubtree) {
    if (!r.driveFolderId) continue;
    try {
      const children = await client.list({ parentFolderId: r.driveFolderId });
      if ((children || []).length >= 1000) truncated = true;
      for (const ch of children || []) {
        if (ch.mimeType === "application/vnd.google-apps.folder") continue; // subfolders already counted
        files.push({ name: ch.name, folder: r.name });
      }
    } catch (_) { /* a listing hiccup shouldn't block the confirmation; folders are still enumerated */ }
  }
  // Under the drive.file scope the app can only SEE the files+folders it created, so anything the
  // user added straight into Drive is trashed by the cascade but can't be itemized here — the UI
  // surfaces that caveat. `truncated` flags a folder with >1000 children (list isn't paginated).
  return { ok: true, folders, files, truncated };
}
