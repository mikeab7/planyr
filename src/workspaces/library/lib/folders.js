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
import { ensureProjectExists } from "../../../shared/projects/projects.js";
import { authedFetch, FAIL_UNREACHABLE } from "../../../shared/auth/apiAuth.js";

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

// NEW-1 (2026-11-09) — every /api/folders call goes through the ONE shared helper
// (shared/auth/apiAuth.js): a token that is not expired, and on a 401 one refresh + one retry. The old
// bare getSession → Bearer sent a stale token as-is, so a tab left open over a weekend made the
// one-time organizer print "Invalid or expired session (403)".
const SIGNED_OUT = "Not signed in.";

async function postFolders(payload) {
  const r = await authedFetch("/api/folders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.resp) return { failure: r.failure || "signed-out" };
  return { resp: r.resp };
}

// The result for "no usable sign-in". `skipped` + "Not signed in." is the shape every existing caller
// already reads as signed out; `authExpired` is the new, explicit flag (the sign-in is the cause).
function noSignIn(failure, extra = {}) {
  if (failure === FAIL_UNREACHABLE) return { ok: false, error: "Couldn't reach Planyr — check your connection.", ...extra };
  return { ok: false, skipped: true, authExpired: true, error: SIGNED_OUT, ...extra };
}

// A non-ok API answer. A 401 that survived the refresh-and-retry is a real "sign in again".
function apiFailure(resp, jr, extra = {}) {
  return { ok: false, error: (jr && jr.error) || `HTTP ${resp.status}`, ...(resp.status === 401 ? { authExpired: true } : {}), ...extra };
}

// All of a project's folder rows (trashed included, so subtree math is correct), client-shaped.
// ⛔ NEW-4 — answers `{ ok, rows, error }`, NEVER a bare `[]` on failure: a failed read used to be
// indistinguishable from an empty project, so FolderTree rendered the "Create the standard
// N-folder structure" template over a project with a real tree, and `addFolder`/`trashSubtree`
// computed siblings / the subtree from an EMPTY list — a delete trashed only `[id]`, reported
// `ok: true`, and left the children live under a trashed parent (treeify re-parents them to top
// level, the Drive mirror trashes only the root). Signed out / no project is an honest empty
// success (`skipped`), not a failure. Every caller reads `.ok` (folderLoadDecision.js applies it).
export async function listFolders(projectId) {
  if (!supabase || !projectId) return { ok: true, rows: [], skipped: true, error: null };
  const { data, error } = await supabase.from("project_folders").select(COLS).eq("project_id", projectId);
  if (error) { console.warn("listFolders failed:", error.message); return { ok: false, rows: [], error: error.message }; }
  return { ok: true, rows: (data || []).map(toClientRow), error: null };
}

const READ_REFUSED = (what, error) => ({ ok: false, error: `Couldn't read the folder tree, so ${what} wasn't done — ${error || "the cloud didn't answer"}. Try again.`, readFailed: true });

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
    // B1202176 ×2 / B1160480 — this is the project's FIRST folder-tree write, and nothing
    // otherwise guarantees its own `sites` row exists yet (creation is deliberately lazy — see
    // storage.js's `ensureProjectRow`). A project opened straight into the Library, never
    // touching the Site Planner canvas, would otherwise seed 12 real `project_folders` rows with
    // no parent at all. BLOCKS the seed (never a silent best-effort) exactly like the
    // already-shipped Doc Review guard, so a deleted/unconfirmable project never gets a tree.
    // ⛔ B1235168 — `confirmLive: true` is load-bearing: this write creates a durable EXTERNAL
    // side effect (a real Google Drive folder tree via syncFoldersToDrive), so it must NEVER trust
    // `ensureProjectRow`'s ordinary fast path, which answers "already real" off a stale local
    // `sites` row without checking whether the project was binned from another tab/device since.
    // Measured on production: three binned projects each grew a full 133-folder Drive tree one to
    // two days after being binned, because this call used to skip the deletion check entirely.
    const ensured = await ensureProjectExists(projectId, { name: "Untitled project", confirmLive: true }).catch((e) => ({ ok: false, error: (e && e.message) || "" }));
    if (!ensured.ok) {
      return { ok: false, error: ensured.deleted
        ? "This project has been deleted. Restore it before organizing its files."
        : (ensured.error || "Couldn't confirm this project with the cloud, so its folders weren't created.") };
    }
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
  const read = await listFolders(projectId);
  if (!read.ok) return READ_REFUSED("the folder", read.error); // NEW-4 — never act on an empty list that isn't one
  const siblings = childrenOf(read.rows, parentId);
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
  const read = await listFolders(projectId);
  if (!read.ok) return READ_REFUSED("the delete", read.error); // NEW-4 — a failed read would trash only [id] and strand the children
  const ids = [...subtreeIds(read.rows, id)];
  const { error } = await supabase.from("project_folders")
    .update({ trashed: true, updated_at: new Date().toISOString() }).in("id", ids);
  return error ? { ok: false, error: error.message } : { ok: true, ids };
}

// One sync pass: loop the server's chunks until remaining hits 0. Internal — the exported
// syncFoldersToDrive wraps this in a per-project single-flight.
async function syncRounds(projectId, emit) {
  const summary = { created: 0, renamed: 0, moved: 0, trashed: 0 };
  const MAX_ROUNDS = 25; // 25 × 20 ops = 500 ops — far beyond any real tree; a hard runaway stop
  let grandTotal = null;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const call = await postFolders({ action: "sync", projectId });
      if (call.failure) return noSignIn(call.failure, { summary });
      const resp = call.resp;
      if (resp.status === 404 || resp.status === 503) return { ok: false, skipped: true, error: "Drive not enabled yet." };
      let jr = {}; try { jr = await resp.json(); } catch (_) { /* keep */ }
      if (!(resp.ok && jr.ok)) return apiFailure(resp, jr, { summary });
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
export async function moveDriveFileToFolder(projectId, planyrKey, discipline, folderId = null) {
  if (!supabase) return { ok: false, skipped: true, error: "Cloud not configured." };
  try {
    const call = await postFolders({ action: "file-move", projectId, planyrKey, discipline, ...(folderId ? { folderId } : {}) });
    if (call.failure) return noSignIn(call.failure);
    const resp = call.resp;
    if (resp.status === 404 || resp.status === 503) return { ok: false, skipped: true, error: "Drive not enabled yet." };
    let jr = {}; try { jr = await resp.json(); } catch (_) { /* keep */ }
    return resp.ok && jr.ok ? jr : apiFailure(resp, jr);
  } catch (e) { return { ok: false, error: (e && e.message) || "Network error." }; }
}

/* One project's chunk-looped FILE migration (B663): asks the server to move this project's
 * already-uploaded Drive files into the standard tree, batch by batch, until done. Idempotent
 * server-side (already-in-place files skip), so an interrupted run just resumes. */
export async function migrateProjectFiles(projectId, { onProgress } = {}) {
  if (!supabase) return { ok: false, skipped: true, error: "Cloud not configured." };
  const totals = { moved: 0, already: 0, skipped: 0 };
  const fileErrors = []; // per-file failures ride along — they never stop the walk (B663 review)
  let offset = 0;
  const HARD_CAP = 500; // absolute runaway backstop; the real exit is done/stall below
  try {
    for (let round = 0; round < HARD_CAP; round++) {
      const call = await postFolders({ action: "migrate-files", projectId, offset });
      if (call.failure) return noSignIn(call.failure, { ...totals, fileErrors });
      const resp = call.resp;
      if (resp.status === 404 || resp.status === 503) return { ok: false, skipped: true, error: "Drive not enabled yet." };
      let jr = {}; try { jr = await resp.json(); } catch (_) { /* keep */ }
      // Chunk-level failure (index/page read, auth) is positional — stop here, report loudly.
      if (!(resp.ok && jr.ok)) return apiFailure(resp, jr, { ...totals, fileErrors });
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

// The words the organizer banner uses (NEW-1, 2026-11-09). Plain language only: never a raw status code, never a
// project name as if it were the problem of the project the person is looking at (the organizer walks EVERY project,
// so a failure on one shows on any project's Library). The technical detail goes to `result.errors` (console /
// telemetry), not to the banner.
export const ORGANIZER_SIGNIN_EXPIRED = "Your sign-in expired — sign in again and the folder setup will finish.";
export const ORGANIZER_UNREACHABLE = "Couldn't reach Planyr to finish the folder setup — check your connection and try again.";
const AUTH_ERROR_RE = /\bjwt\b|invalid or expired session|session (has )?expired|not authenticated|invalid (token|session)/i;
const UNREACHABLE_RE = /couldn't reach planyr|network error|failed to fetch|load failed/i;

export function organizerFailureMessage(failures, total) {
  if (failures.length && failures.every((f) => UNREACHABLE_RE.test(f.reason || ""))) return ORGANIZER_UNREACHABLE;
  const n = failures.length;
  return `Folder setup couldn't finish for ${n} of ${total} project${total === 1 ? "" : "s"}. Retry will pick up where it stopped.`;
}

/* THE one-time account migration (B663, owner-requested 2026-07-05): give EVERY existing
 * project the standard folder tree and move its already-uploaded files into the right tree
 * folders in Drive. Per project: idempotent seed → chunked Drive mirror → chunked file moves.
 * Everything inside is resumable/idempotent, so a failure mid-way is safe to re-run; the
 * caller records completion (a local marker) and shows honest progress + errors.
 * Result: `{ ok, projects, seeded, mirrored, movedFiles, errors, message, authExpired }` — `message` is the
 * banner text (plain words), `errors` the technical lines. A sign-in problem (`authExpired`) STOPS the walk: every
 * later project would fail the same way, and it is the person's sign-in — not a project — that needs attention.
 * By the time it is reported, the API call has already been refreshed-and-retried once (shared/auth/apiAuth.js). */
export async function migrateAllProjects(projects = [], { onProgress, checkIdentity } = {}) {
  const result = { ok: true, projects: projects.length, seeded: 0, mirrored: 0, movedFiles: 0, errors: [], message: "", authExpired: false };
  const failures = []; // { project, reason } — projects that did not finish for a non-sign-in reason
  const stopForSignIn = (label, why) => { result.authExpired = true; result.errors.push(`${label}: ${why || "sign-in expired"}`); result.message = ORGANIZER_SIGNIN_EXPIRED; };
  for (let i = 0; i < projects.length; i++) {
    // Identity pin (B663 review #9): an account switch mid-run must stop the walk — the next
    // project would run under the WRONG user's token/marker.
    if (checkIdentity && !(await checkIdentity())) { result.errors.push("Account changed — organization stopped."); result.message = "Account changed — folder setup stopped."; break; }
    const p = projects[i];
    const label = p.name || p.id;
    onProgress?.({ index: i, total: projects.length, project: label, phase: "folders" });
    const seed = await ensureSeeded(p.id);
    if (seed.ok && seed.seeded) result.seeded += 1;
    if (seed.ok === false && !seed.skipped) {
      if (AUTH_ERROR_RE.test(seed.error || "")) { stopForSignIn(label, seed.error); break; }
      failures.push({ project: label, reason: seed.error || "couldn't set up folders" });
      continue;
    }
    const sync = await syncFoldersToDrive(p.id, {
      onProgress: ({ done, total }) => onProgress?.({ index: i, total: projects.length, project: label, phase: "mirror", mirrorDone: done, mirrorTotal: total }),
    });
    if (sync.authExpired) { stopForSignIn(label, sync.error); break; }
    if (sync.skipped) {
      // Drive isn't on for this deployment — "Drive off" needs different user action than a sign-in problem.
      result.errors.push("Google Drive isn't connected — folders saved in Planyr only.");
      result.message = "Google Drive isn't connected — folders saved in Planyr only.";
      break;
    }
    if (!sync.ok) {
      if (AUTH_ERROR_RE.test(sync.error || "")) { stopForSignIn(label, sync.error); break; }
      failures.push({ project: label, reason: sync.error || "Drive mirror failed" });
      continue;
    }
    result.mirrored += 1;
    onProgress?.({ index: i, total: projects.length, project: label, phase: "files" });
    const mig = await migrateProjectFiles(p.id, {
      onProgress: ({ moved }) => onProgress?.({ index: i, total: projects.length, project: label, phase: "files", moved }),
    });
    // 401 on the FILE-MOVE phase is the same sign-in problem as on the mirror phase.
    if (mig.authExpired) { stopForSignIn(label, mig.error); break; }
    // The mirror just succeeded, so a skipped file phase is anomalous — record it so the
    // done-marker can't be written over a silent gap.
    if (mig.skipped) { failures.push({ project: label, reason: mig.error || "file move skipped" }); continue; }
    if (!mig.ok) {
      if (AUTH_ERROR_RE.test(mig.error || "")) { stopForSignIn(label, mig.error); break; }
      failures.push({ project: label, reason: mig.error || "file move failed" });
      continue;
    }
    result.movedFiles += mig.moved;
  }
  for (const f of failures) result.errors.push(`${f.project}: ${f.reason}`);
  if (failures.length && !result.message) result.message = organizerFailureMessage(failures, projects.length);
  result.ok = result.errors.length === 0;
  return result;
}

// Pre-flight: what a delete of this folder's subtree would remove from Drive (folders + files),
// so the confirmation can enumerate it. Falls back to { skipped } when Drive isn't enabled.
export async function planFolderDelete(projectId, folderId) {
  if (!supabase) return { ok: false, skipped: true };
  try {
    const call = await postFolders({ action: "plan-delete", projectId, folderId });
    if (call.failure) return noSignIn(call.failure);
    const resp = call.resp;
    if (resp.status === 404 || resp.status === 503) return { ok: false, skipped: true, error: "Drive not enabled yet." };
    let jr = {}; try { jr = await resp.json(); } catch (_) { /* keep */ }
    return resp.ok && jr.ok
      ? { ok: true, folders: jr.folders || [], files: jr.files || [], truncated: !!jr.truncated }
      : apiFailure(resp, jr);
  } catch (e) { return { ok: false, error: (e && e.message) || "Network error." }; }
}

/* B1235169 — permanently remove a PURGED project's whole folder tree: the project-wide
 * counterpart to `trashSubtree` above, called only from storage.js's "Delete forever" and the
 * 30-day expiry purge — never from an ordinary in-app folder delete (an ordinary delete goes
 * through `trashSubtree` + `planFolderDelete`, which stay soft/recoverable by design).
 *
 * Order matters: the Drive trash is asked for FIRST, while this project's `project_folders` rows
 * still exist server-side (the server needs them to know whether — and where — a Drive tree was
 * ever mirrored; see `purgeProjectDrive` in server/storage/folderMirror.js).
 *
 * NEW-6 (data-risk 2026-10-29) — THE ROWS ARE DELETED ONLY ONCE DRIVE IS DONE WITH. This used to delete
 * them "regardless of whether the Drive half succeeded": on 2026-10-06 Drive answered HTTP 502, the rows
 * were deleted anyway and a ~118-folder tree was stranded with nothing left to find it by (B2146554). The
 * rows ARE the retry handle, so a Drive failure now leaves them in place, reports it (LOUD-FAILURE) and
 * the purge can be run again. Drive not enabled (404/503) is not a failure — there is nothing in Drive.
 * A server refusal because the project still has a live plan (409) leaves the rows too.
 * Signed-out / unconfigured → skipped (there is nothing to purge). */
export async function purgeProjectFolders(projectId) {
  if (!supabase || !projectId) return { ok: true, skipped: true };
  let drive = { ok: true, trashed: false };
  try {
    const call = await postFolders({ action: "purge-project", projectId });
    if (call.failure) {
      drive = { ok: false, error: call.failure === FAIL_UNREACHABLE ? "Couldn't reach Planyr — check your connection." : SIGNED_OUT };
    } else {
      const resp = call.resp;
      if (resp.status === 404 || resp.status === 503) drive = { ok: true, trashed: false, skipped: true }; // Drive not enabled — nothing there to trash
      else {
        let jr = {}; try { jr = await resp.json(); } catch (_) { /* keep */ }
        drive = resp.ok && jr.ok ? jr : { ok: false, live: !!jr.live, error: jr.error || `HTTP ${resp.status}` };
      }
    }
  } catch (e) { drive = { ok: false, error: (e && e.message) || "Network error." }; }
  if (drive.ok === false) {
    // Drive failed (or the server refused): keep every row so the cleanup stays retryable.
    return { ok: false, rowsDeleted: false, driveTrashed: false, live: !!drive.live || undefined, error: drive.error || "Drive cleanup failed." };
  }
  const { error: delErr } = await supabase.from("project_folders").delete().eq("project_id", projectId);
  return {
    ok: !delErr,
    rowsDeleted: !delErr,
    driveTrashed: !!drive.trashed,
    error: delErr ? delErr.message : null,
  };
}
