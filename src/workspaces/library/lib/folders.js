/* Client folder-index store (B650) — the Library's authoritative read/write of a project's
 * folder tree, straight to Supabase (own-row RLS) for instant edits, plus the trigger that
 * asks the server to reconcile the Google Drive mirror.
 *
 * Split of responsibility (matches the table doc in project_folders.sql):
 *   • THIS module writes STRUCTURE columns (parent_id / name / sort_order / trashed) via
 *     supabase-js — authoritative, no server hop.
 *   • syncFoldersToDrive()/planFolderDelete() call the /api/folders Pages Function, which owns
 *     the drive_* columns and the one-way push to Drive (creds are server-side only).
 *
 * Every function degrades gracefully: no Supabase (signed out / unconfigured) → { skipped:true }
 * and the caller shows a sign-in prompt, never a crash. Mirrors reviewStore's token+fetch shape.
 */
import { supabase } from "../../site-planner/lib/supabase.js";
import { FOLDER_TEMPLATE, TEMPLATE_VERSION } from "../../../shared/folders/folderTemplate.js";
import { buildSeedRows, subtreeIds, childrenOf } from "../../../shared/folders/folderTree.js";

const COLS = "id,parent_id,name,sort_order,trashed,drive_folder_id";

const toClientRow = (r) => ({
  id: r.id,
  parentId: r.parent_id ?? null,
  name: r.name,
  order: r.sort_order ?? 0,
  trashed: !!r.trashed,
  driveFolderId: r.drive_folder_id ?? null,
});

// A stable folder id, assigned client-side so parent/child refs resolve within one seed insert.
function makeId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function authToken() {
  if (!supabase) return null;
  try { const { data } = await supabase.auth.getSession(); return (data && data.session && data.session.access_token) || null; }
  catch (_) { return null; }
}

// All of a project's folder rows (trashed included, so subtree math is correct), client-shaped.
export async function listFolders(projectId) {
  if (!supabase || !projectId) return [];
  const { data, error } = await supabase.from("project_folders").select(COLS).eq("project_id", projectId);
  if (error) { console.warn("listFolders failed:", error.message); return []; }
  return (data || []).map(toClientRow);
}

// In-tab guard: the in-flight seed PROMISE per project, so a double-mount awaits the SAME seed
// and gets its real result (returning a premature {seeded:false} let the caller then read zero
// rows and render "No folders yet"). The DB unique index (project_folders.sql) is the real
// cross-tab/device guard — this just avoids a redundant insert within one runtime.
const seeding = new Map();

/* Seed a project's tree from the canonical template — ONCE. Idempotent: if the project already
 * has any folder rows it is left untouched (so a later template edit never restructures an
 * existing project, and a re-open never duplicates the tree). Returns { ok, seeded, count }. */
export async function ensureSeeded(projectId) {
  if (!supabase || !projectId) return { ok: false, skipped: true };
  if (seeding.has(projectId)) return seeding.get(projectId); // await the same seed, not a premature result
  const run = (async () => {
    const { count, error } = await supabase
      .from("project_folders").select("id", { count: "exact", head: true }).eq("project_id", projectId);
    if (error) return { ok: false, error: error.message };
    if ((count || 0) > 0) return { ok: true, seeded: false };
    const rows = buildSeedRows(FOLDER_TEMPLATE, { projectId, templateVersion: TEMPLATE_VERSION, makeId });
    const { error: insErr } = await supabase.from("project_folders").insert(rows);
    if (insErr) {
      // A concurrent first-open (another tab/device) may have seeded first — the DB unique index
      // then rejects this duplicate insert. Re-check: if rows now exist, treat it as "already
      // seeded" success rather than a double tree.
      const now = await supabase.from("project_folders").select("id", { count: "exact", head: true }).eq("project_id", projectId);
      if (!now.error && (now.count || 0) > 0) return { ok: true, seeded: false };
      return { ok: false, error: insErr.message };
    }
    return { ok: true, seeded: true, count: rows.length };
  })();
  seeding.set(projectId, run);
  try { return await run; } finally { seeding.delete(projectId); }
}

// Add one folder under a parent (null = top level). `order` = next among live siblings.
export async function addFolder({ projectId, parentId = null, name }) {
  if (!supabase || !projectId) return { ok: false, skipped: true };
  const siblings = childrenOf(await listFolders(projectId), parentId);
  const order = siblings.reduce((m, r) => Math.max(m, r.order || 0), 0) + 1;
  const id = makeId();
  const { error } = await supabase.from("project_folders").insert({
    id, project_id: projectId, parent_id: parentId, name, sort_order: order,
  });
  return error ? { ok: false, error: error.message } : { ok: true, id };
}

export async function renameFolder(id, name) {
  if (!supabase) return { ok: false, skipped: true };
  const { error } = await supabase.from("project_folders")
    .update({ name, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function moveFolder(id, newParentId = null) {
  if (!supabase) return { ok: false, skipped: true };
  const { error } = await supabase.from("project_folders")
    .update({ parent_id: newParentId, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* Soft-delete a folder and everything under it (structure write). The rows stay (trashed=true,
 * hidden from the tree) so the next Drive sync can move the matching Drive folders to trash;
 * the enumerated confirmation the user already approved lives in the UI (planFolderDelete). */
export async function trashSubtree(projectId, id) {
  if (!supabase || !projectId) return { ok: false, skipped: true };
  const ids = [...subtreeIds(await listFolders(projectId), id)];
  const { error } = await supabase.from("project_folders")
    .update({ trashed: true, updated_at: new Date().toISOString() }).in("id", ids);
  return error ? { ok: false, error: error.message } : { ok: true, ids };
}

// Ask the server to reconcile the Drive mirror. 404/503 = Drive not enabled yet (the tree still
// lives in Supabase) → a graceful skip, never an error the user must act on.
export async function syncFoldersToDrive(projectId) {
  if (!supabase) return { ok: false, skipped: true, error: "Cloud not configured." };
  const token = await authToken();
  if (!token) return { ok: false, skipped: true, error: "Not signed in." };
  try {
    const resp = await fetch("/api/folders", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "sync", projectId }),
    });
    if (resp.status === 404 || resp.status === 503) return { ok: false, skipped: true, error: "Drive not enabled yet." };
    let jr = {}; try { jr = await resp.json(); } catch (_) { /* keep */ }
    return resp.ok && jr.ok ? { ok: true, summary: jr.summary } : { ok: false, error: jr.error || `HTTP ${resp.status}`, summary: jr.summary };
  } catch (e) { return { ok: false, error: (e && e.message) || "Network error." }; }
}

// Pre-flight: what a delete of this folder's subtree would remove from Drive (folders + files),
// so the confirmation can enumerate it. Falls back to { skipped } when Drive isn't enabled.
export async function planFolderDelete(projectId, folderId) {
  if (!supabase) return { ok: false, skipped: true };
  const token = await authToken();
  if (!token) return { ok: false, skipped: true, error: "Not signed in." };
  try {
    const resp = await fetch("/api/folders", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "plan-delete", projectId, folderId }),
    });
    if (resp.status === 404 || resp.status === 503) return { ok: false, skipped: true, error: "Drive not enabled yet." };
    let jr = {}; try { jr = await resp.json(); } catch (_) { /* keep */ }
    return resp.ok && jr.ok
      ? { ok: true, folders: jr.folders || [], files: jr.files || [], truncated: !!jr.truncated }
      : { ok: false, error: jr.error || `HTTP ${resp.status}` };
  } catch (e) { return { ok: false, error: (e && e.message) || "Network error." }; }
}
