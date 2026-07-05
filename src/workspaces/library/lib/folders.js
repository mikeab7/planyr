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

// One sync pass: loop the server's chunks until remaining hits 0. Internal — the exported
// syncFoldersToDrive wraps this in a per-project single-flight.
async function syncRounds(projectId, emit) {
  const token = await authToken();
  if (!token) return { ok: false, skipped: true, error: "Not signed in." };
  const summary = { created: 0, renamed: 0, moved: 0, trashed: 0 };
  const MAX_ROUNDS = 25; // 25 × 20 ops = 500 ops — far beyond any real tree; a hard runaway stop
  let grandTotal = null;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await fetch("/api/folders", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "sync", projectId }),
      });
      if (resp.status === 404 || resp.status === 503) return { ok: false, skipped: true, error: "Drive not enabled yet." };
      let jr = {}; try { jr = await resp.json(); } catch (_) { /* keep */ }
      if (!(resp.ok && jr.ok)) return { ok: false, error: jr.error || `HTTP ${resp.status}`, summary };
      for (const k of Object.keys(summary)) summary[k] += (jr.summary && jr.summary[k]) || 0;
      if (grandTotal == null) grandTotal = jr.total || 0;
      const remaining = jr.remaining || 0;
      if (grandTotal > 0) emit({ done: Math.max(0, grandTotal - remaining), total: grandTotal });
      if (remaining === 0) return { ok: true, summary };
    }
    return { ok: false, error: "Drive sync didn't finish — try Sync now again.", summary };
  } catch (e) { return { ok: false, error: (e && e.message) || "Network error.", summary }; }
}

// Per-project single-flight for the mirror (B662 review #2): two overlapping sync loops both
// plan the same not-yet-mirrored creates and DOUBLE-create folders in Drive (create is
// deliberately create-not-ensure). One loop runs at a time per project in this tab; an edit
// arriving mid-loop flags a trailing re-run so it's never lost. (Same pattern as `seeding`.)
const syncing = new Map(); // projectId -> { promise, rerun, listeners }

/* Ask the server to reconcile the Drive mirror. The server executes ONE small chunk per
 * request (its 502 fix — one giant request gets killed by the platform), so this loops,
 * accumulating progress until `remaining` hits 0. Each completed chunk is durably recorded
 * server-side, so an interrupted loop resumes exactly where it stopped — never duplicates.
 * `onProgress({ done, total })` fires per round for the UI's "Mirroring… X of Y".
 * 404/503 = Drive not enabled yet (the tree still lives in Supabase) → a graceful skip. */
export async function syncFoldersToDrive(projectId, { onProgress } = {}) {
  if (!supabase) return { ok: false, skipped: true, error: "Cloud not configured." };
  const inflight = syncing.get(projectId);
  if (inflight) {
    inflight.rerun = true; // pick up whatever changed after the running pass finishes
    if (onProgress) inflight.listeners.push(onProgress);
    return inflight.promise;
  }
  const state = { rerun: false, listeners: onProgress ? [onProgress] : [] };
  const emit = (p) => state.listeners.forEach((fn) => { try { fn(p); } catch (_) { /* listener bug ≠ sync failure */ } });
  state.promise = (async () => {
    let r = await syncRounds(projectId, emit);
    let trailing = 0;
    while (state.rerun && r.ok && trailing++ < 3) { // bounded: edits during a pass get one more pass
      state.rerun = false;
      r = await syncRounds(projectId, emit);
    }
    return r;
  })().finally(() => syncing.delete(projectId));
  syncing.set(projectId, state);
  return state.promise;
}

/* Move ONE stored file's Drive bytes to the tree folder of an EXPLICIT discipline (the refile
 * flow — the stored key keeps its original discipline forever, so the confirmed one is passed).
 * 404/503 → skipped (Drive off); tree not mirrored → server reports skipped. Never throws. */
export async function moveDriveFileToFolder(projectId, planyrKey, discipline) {
  if (!supabase) return { ok: false, skipped: true, error: "Cloud not configured." };
  const token = await authToken();
  if (!token) return { ok: false, skipped: true, error: "Not signed in." };
  try {
    const resp = await fetch("/api/folders", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "file-move", projectId, planyrKey, discipline }),
    });
    if (resp.status === 404 || resp.status === 503) return { ok: false, skipped: true, error: "Drive not enabled yet." };
    let jr = {}; try { jr = await resp.json(); } catch (_) { /* keep */ }
    return resp.ok && jr.ok ? jr : { ok: false, error: jr.error || `HTTP ${resp.status}` };
  } catch (e) { return { ok: false, error: (e && e.message) || "Network error." }; }
}

/* One project's chunk-looped FILE migration (B663): asks the server to move this project's
 * already-uploaded Drive files into the standard tree, batch by batch, until done. Idempotent
 * server-side (already-in-place files skip), so an interrupted run just resumes. */
export async function migrateProjectFiles(projectId, { onProgress } = {}) {
  if (!supabase) return { ok: false, skipped: true, error: "Cloud not configured." };
  const token = await authToken();
  if (!token) return { ok: false, skipped: true, error: "Not signed in." };
  const totals = { moved: 0, already: 0, skipped: 0 };
  const fileErrors = []; // per-file failures ride along — they never stop the walk (B663 review)
  let offset = 0;
  const HARD_CAP = 500; // absolute runaway backstop; the real exit is done/stall below
  try {
    for (let round = 0; round < HARD_CAP; round++) {
      const resp = await fetch("/api/folders", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "migrate-files", projectId, offset }),
      });
      if (resp.status === 404 || resp.status === 503) return { ok: false, skipped: true, error: "Drive not enabled yet." };
      let jr = {}; try { jr = await resp.json(); } catch (_) { /* keep */ }
      // Chunk-level failure (index/page read, auth) is positional — stop here, report loudly.
      if (!(resp.ok && jr.ok)) return { ok: false, error: jr.error || `HTTP ${resp.status}`, ...totals, fileErrors };
      totals.moved += jr.moved || 0; totals.already += jr.already || 0; totals.skipped += jr.skipped || 0;
      if (Array.isArray(jr.errors) && jr.errors.length) fileErrors.push(...jr.errors);
      const next = jr.nextOffset ?? offset;
      onProgress?.({ ...totals });
      if (jr.done) {
        return fileErrors.length
          ? { ok: false, error: `${fileErrors.length} file${fileErrors.length === 1 ? "" : "s"} couldn't be moved (${fileErrors[0]})`, ...totals, fileErrors }
          : { ok: true, ...totals };
      }
      // Stall guard: an ok round that didn't advance the cursor would loop forever — bail loudly.
      if (next <= offset) return { ok: false, error: "File move stalled — run it again.", ...totals, fileErrors };
      offset = next;
    }
    return { ok: false, error: "File move didn't finish — run it again.", ...totals, fileErrors };
  } catch (e) { return { ok: false, error: (e && e.message) || "Network error.", ...totals, fileErrors }; }
}

/* THE one-time account migration (B663, owner-requested 2026-07-05): give EVERY existing
 * project the standard folder tree and move its already-uploaded files into the right tree
 * folders in Drive. Per project: idempotent seed → chunked Drive mirror → chunked file moves.
 * Everything inside is resumable/idempotent, so a failure mid-way is safe to re-run; the
 * caller records completion (a local marker) and shows honest progress + errors. */
export async function migrateAllProjects(projects = [], { onProgress, checkIdentity } = {}) {
  const result = { ok: true, projects: projects.length, seeded: 0, mirrored: 0, movedFiles: 0, errors: [] };
  for (let i = 0; i < projects.length; i++) {
    // Identity pin (B663 review #9): an account switch mid-run must stop the walk — the next
    // project would run under the WRONG user's token/marker.
    if (checkIdentity && !(await checkIdentity())) { result.errors.push("Account changed — organization stopped."); break; }
    const p = projects[i];
    const label = p.name || p.id;
    onProgress?.({ index: i, total: projects.length, project: label, phase: "folders" });
    const seed = await ensureSeeded(p.id);
    if (seed.ok && seed.seeded) result.seeded += 1;
    if (seed.ok === false && !seed.skipped) { result.errors.push(`${label}: ${seed.error || "couldn't set up folders"}`); continue; }
    const sync = await syncFoldersToDrive(p.id, {
      onProgress: ({ done, total }) => onProgress?.({ index: i, total: projects.length, project: label, phase: "mirror", mirrorDone: done, mirrorTotal: total }),
    });
    if (sync.skipped) {
      // Name the actual cause — "signed out" and "Drive off" need different user action.
      result.errors.push(sync.error === "Not signed in."
        ? "You were signed out — sign back in and the organizer will finish automatically."
        : "Google Drive isn't connected — folders saved in Planyr only.");
      break;
    }
    if (!sync.ok) { result.errors.push(`${label}: ${sync.error || "Drive mirror failed"}`); continue; }
    result.mirrored += 1;
    onProgress?.({ index: i, total: projects.length, project: label, phase: "files" });
    const mig = await migrateProjectFiles(p.id, {
      onProgress: ({ moved }) => onProgress?.({ index: i, total: projects.length, project: label, phase: "files", moved }),
    });
    // The mirror just succeeded, so a skipped file phase is anomalous (e.g. signed out
    // between calls) — record it so the done-marker can't be written over a silent gap.
    if (mig.skipped) { result.errors.push(`${label}: ${mig.error || "file move skipped"}`); continue; }
    if (!mig.ok) { result.errors.push(`${label}: ${mig.error || "file move failed"}`); continue; }
    result.movedFiles += mig.moved;
  }
  result.ok = result.errors.length === 0;
  return result;
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
