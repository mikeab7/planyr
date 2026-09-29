/* Model workspace — persistence. Local storage is the WRITE-THROUGH, always-on save (works
 * signed out, works before any migration runs, never blocks on the network); the cloud push
 * is best-effort on top of it, through the SAME guarded save path every other cloud table in
 * this repo uses — never a bespoke one (the build brief is explicit that this repo has a
 * history of an unserialised save path silently losing writes: B528/B529, where a debounced
 * autosave racing a manual/unmount flush for the SAME key both read the same tracked
 * `version`, so the second write's compare-and-swap matched 0 rows and was wrongly reported
 * as a conflict — which then froze autosave until reload).
 *
 * ⛔ STAGE 3 (NEW-1) — the persisted blob is now a WORKBOOK (`lib/sheetModel.js`'s
 * `{version, nextSheetId, sheets:[{id,name,sheet}], activeSheetId}` shape), not a bare sheet.
 * NOTHING BELOW IN THIS FILE CHANGED to make that true: `data` was always an untyped jsonb
 * blob (see `db/model_sheets.sql`'s own header), this module has never known or cared what
 * shape it holds, and it still doesn't — it reads/writes whatever `ModelApp.jsx` hands it
 * verbatim. `migrateWorkbook` (sheetModel.js) is what turns an old bare-sheet blob (or a
 * corrupt/foreign one) into a valid workbook on load; this file's job stays exactly "move
 * bytes," never "understand them."
 *
 * The two shared primitives that fix exactly that (src/shared/cloud/):
 *   - serializeWrites.makeWriteSerializer() — same-key writes for THIS tab run strictly in
 *     submission order, so a tab can never race itself.
 *   - optimisticUpsert.casUpsert() — the version-guarded compare-and-swap every cloud table
 *     here already uses (public.sites, public.doc_reviews). A REAL cross-device conflict
 *     still surfaces (0 rows matched because another session moved the row) — this only
 *     stops a tab racing ITSELF from manufacturing a false one.
 *
 * db/model_sheets.sql mirrors doc_reviews.sql's ORIGINAL four-column CAS shape (id/user_id/
 * data jsonb/version int/updated_at, same plain-owner RLS) — not the live public.doc_reviews
 * table, which has since grown team_id/project_id/etc. through later migrations; this table is
 * deliberately private/per-user, with no team_id, matching the payload below exactly. It has
 * NOT been applied to production by this session — the
 * house rule for this task is read-only/SELECT-only on production data, and this repo's own
 * precedent (the Comps migrations, src/shared/CLAUDE.md) is that a session with read-only
 * production access hands a migration to the owner rather than applying it. Until it runs,
 * every cloud call below degrades to "not-provisioned" and the local save keeps working —
 * the exact shape doc-review's own AI-filing proxy uses for "not deployed yet" (a 503/absent
 * table means the feature is dormant, never a crash).
 */
import { supabase, supabaseConfigured } from "../../site-planner/lib/supabase.js";
import { casUpsert, degradeUpsert } from "../../../shared/cloud/optimisticUpsert.js";
import { makeWriteSerializer } from "../../../shared/cloud/serializeWrites.js";
import { ensureProjectExists } from "../../../shared/projects/projects.js";

const TABLE = "model_sheets";
// model_sheets' real primary key is COMPOSITE — (user_id, id), not `id` alone (db/model_sheets.sql;
// deliberately scopes a sheet to one user × one project, so two users can each hold their own model
// for the same project id — a real safety property, kept as-is rather than weakened to a single-
// column key). Every guarded write below names this explicitly rather than letting optimisticUpsert
// assume "id" — see that module's own header for the production bug this closes (HTTP 400 / Postgres
// 42P10, "no unique or exclusion constraint matching the ON CONFLICT specification").
const CONFLICT_TARGET = "user_id,id";
const serializeWrite = makeWriteSerializer();

const localKey = (scope, projectId) => `planyr:model:sheet:v1:${scope}:${projectId}`;

/** Read the locally-saved sheet for this project, scoped by account (or "local" signed out) —
 *  same scoping shape as Notes' storage keys. Never throws; a corrupt/blocked store reads as
 *  "nothing saved yet" rather than crashing the workspace. */
export function readLocalSheet(userId, projectId) {
  if (!projectId) return null;
  try {
    const raw = localStorage.getItem(localKey(userId || "local", projectId));
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

/** B1953796 (R3) — a workbook built signed OUT lives under the "local" scope and, without this,
 *  was invisible the moment the user signed in (their own scope is empty; the cloud has none).
 *  Pure decision, one place: adopt the signed-out copy ONLY when the user's own scope is empty AND
 *  the cloud has nothing; never overwrite a non-empty user/cloud workbook — when the signed-out copy
 *  differs from what's there, report "diverged" so the caller surfaces it (nothing is deleted). */
export function decideAnonAdoption({ userId, userLocal, cloudSheet, cloudOk, anonLocal, diverges }) {
  if (!userId || !anonLocal || userLocal || !cloudOk) return "none";
  if (!cloudSheet) return "adopt";
  return diverges ? "diverged" : "none";
}

/** Write-through, synchronous, every commit — never debounced (B400176's rule: the stored
 *  copy must never be staler than the screen). Returns false on a storage failure so the
 *  caller can surface it (LOUD-FAILURE) rather than silently believing it saved. */
export function writeLocalSheet(userId, projectId, sheet) {
  if (!projectId) return false;
  try { localStorage.setItem(localKey(userId || "local", projectId), JSON.stringify(sheet)); return true; }
  catch (_) { return false; }
}

// The table not existing at all (migration never run) is a DIFFERENT signal from casUpsert's
// own "version column missing" degrade, which assumes the table is there. Detected the same
// way this repo detects any not-yet-migrated column (optimisticUpsert.isMissingColumn), just
// without a column name to require in the message.
function isMissingRelation(error) {
  const msg = String((error && error.message) || error || "").toLowerCase();
  const code = String((error && error.code) || "").toLowerCase();
  return code === "42p01" || msg.includes("does not exist") || msg.includes("schema cache");
}

/** Load this project's cloud row, if the table exists and one has been saved. Returns one of:
 *  { ok:true, sheet, version } · { ok:true, sheet:null, version:null } (nothing saved yet) ·
 *  { ok:false, reason:"not-provisioned" } · { ok:false, reason:"unavailable" } (signed out /
 *  no Supabase config) · { ok:false, reason:"error", error }. */
export async function loadCloudSheet(projectId) {
  if (!supabaseConfigured() || !projectId) return { ok: false, reason: "unavailable" };
  const { data, error } = await supabase.from(TABLE).select("data, version").eq("id", projectId).maybeSingle();
  if (error) return isMissingRelation(error) ? { ok: false, reason: "not-provisioned" } : { ok: false, reason: "error", error: error.message };
  if (!data) return { ok: true, sheet: null, version: null };
  return { ok: true, sheet: data.data, version: data.version ?? null };
}

async function upsertCore({ uid, projectId, sheet, expected }) {
  // B1202176 ×2 / B1160480 — this is the FIRST cloud write for a project's workbook, and nothing
  // guarantees the project's own `sites` row exists yet (creation is deliberately lazy — see
  // storage.js's `ensureProjectRow`). A `model_sheets` row must never be the only trace of a
  // project, so this BLOCKS the save (never a silent best-effort) exactly like the already-shipped
  // Doc Review guard (`reviewStore.js`'s `fileNewReview`/`refileReview`) — a project that can't be
  // confirmed, or was genuinely soft-deleted, gets no orphaned workbook rows written against it.
  const ensured = await ensureProjectExists(projectId, { name: "Untitled project" }).catch((e) => ({ ok: false, error: (e && e.message) || "" }));
  if (!ensured.ok) {
    return { ok: false, reason: "error", error: ensured.deleted
      ? "This project has been deleted. Restore it before saving anything to it."
      : (ensured.error || "Couldn't confirm this project with the cloud, so nothing was saved.") };
  }
  // ⛔ B891184-FOLLOWUP-2 (live production finding, 2026-08-31) — `row` must carry `id` itself,
  // same as `sites`/`doc_reviews`' row-builders (siteRowFor/reviewRowFor) already do; casUpsert's
  // own contract comment says so. This one didn't, so casUpsert's INSERT branch sent `{ data,
  // user_id, version }` with no `id` at all — a real Postgres 23502 (null value in column "id"
  // violates not-null constraint) on every first-ever save, proven live against production via a
  // rolled-back impersonated-role insert. casUpsert is now hardened to spread `id` in defensively
  // too (belt + suspenders — see its own comment), but the contract here is the primary fix.
  //
  // ⛔ 2026-09-01 — `conflictTarget: CONFLICT_TARGET` ("user_id,id") is passed explicitly on every
  // guarded write below, never left to optimisticUpsert's "id" default: model_sheets' real primary
  // key is composite, and a write that targets only "id" (the CAS filter, or the degrade upsert's
  // ON CONFLICT) either matches the wrong row or — on the degrade path — has no matching unique
  // constraint at all (Postgres 42P10, surfaced to the client as an HTTP 400 on the write). See
  // optimisticUpsert.js's own header for the full history.
  const r = await casUpsert(supabase, TABLE, { uid, id: projectId, row: { id: projectId, data: sheet }, expected, conflictTarget: CONFLICT_TARGET });
  if (r.degrade) {
    // The version column specifically is missing (a partially-applied migration) — never
    // regress a save into a crash; fall back to plain last-write-wins, exactly like
    // doc-review's own degrade path for the identical shape. Routed through the shared
    // degradeUpsert helper (optimisticUpsert.js) so the ON CONFLICT target is the SAME
    // CONFLICT_TARGET the guarded write above used, rather than a second, independently-typed
    // literal that can drift out of step with it.
    const res = await degradeUpsert(supabase, TABLE, { row: { id: projectId, user_id: uid, data: sheet }, conflictTarget: CONFLICT_TARGET });
    return res.ok
      ? { ok: true, version: null }
      : (isMissingRelation({ message: res.error }) ? { ok: false, reason: "not-provisioned" } : { ok: false, reason: "error", error: res.error });
  }
  if (!r.ok) {
    if (r.conflict) return { ok: false, reason: "conflict" };
    return isMissingRelation({ message: r.error }) ? { ok: false, reason: "not-provisioned" } : { ok: false, reason: "error", error: r.error };
  }
  return { ok: true, version: r.version };
}

/** Guarded cloud save. `expected` is the version this session last saw for this project (null
 *  = never synced, treated as a fresh insert). Writes for the SAME project always run through
 *  the one write serializer, so a debounced autosave and a beforeunload flush can never race
 *  each other into a false conflict. Never throws. */
export function saveCloudSheet({ uid, projectId, sheet, expected }) {
  if (!supabaseConfigured() || !uid || !projectId) return Promise.resolve({ ok: false, reason: "unavailable" });
  return serializeWrite(projectId, () => upsertCore({ uid, projectId, sheet, expected }));
}

/* ---------------------------------------------------------------------------------------------
 * ORGANIZATION-scoped workbooks (NEW-1, B1912209) — org scope in this app is not a multi-tenant
 * team entity (see org_model_sheets.sql's own header): it is the SAME per-account ownership every
 * table here already uses, just not tied to one project. Unlike the one-workbook-per-project
 * shape above, an account can hold SEVERAL org workbooks, so this half of the file additionally
 * tracks a real per-workbook id + name and a LIST of them — everything else (local write-through,
 * the guarded cloud upsert, the "move bytes, never understand them" rule for `data`) is the exact
 * same shape as the project-scoped functions above, just against `org_model_sheets`.
 * --------------------------------------------------------------------------------------------- */
const ORG_TABLE = "org_model_sheets";
const ORG_CONFLICT_TARGET = "user_id,id"; // org_model_sheets' PK is composite too — see its own db/*.sql header
const serializeOrgWrite = makeWriteSerializer();

const orgIndexKey = (scope) => `planyr:model:orgIndex:v1:${scope}`;

/** The local CACHE of "which org workbooks exist" (id/name/updatedAt only, never the workbook
 *  bytes — those still live under `localKey`, keyed by workbook id exactly like a project's).
 *  This is what makes the workbook LIST usable signed out or offline: the cloud list (below) is
 *  the source of truth when reachable, but this cache is what a fresh mount shows instantly and
 *  what a signed-out account has at all. Never throws. */
export function readLocalOrgIndex(userId) {
  try {
    const raw = localStorage.getItem(orgIndexKey(userId || "local"));
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((w) => w && typeof w.id === "string" && w.id) : [];
  } catch (_) { return []; }
}

export function writeLocalOrgIndex(userId, list) {
  try { localStorage.setItem(orgIndexKey(userId || "local"), JSON.stringify(list || [])); return true; }
  catch (_) { return false; }
}

/** Add or update one entry (by id) in the local index, newest-first. Returns the new list so a
 *  caller can set state from it directly without a second read. */
export function touchLocalOrgIndex(userId, entry) {
  const list = readLocalOrgIndex(userId).filter((w) => w.id !== entry.id);
  list.push(entry);
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  writeLocalOrgIndex(userId, list);
  return list;
}

export function removeLocalOrgIndexEntry(userId, id) {
  const list = readLocalOrgIndex(userId).filter((w) => w.id !== id);
  writeLocalOrgIndex(userId, list);
  return list;
}

/** List this account's org workbooks from the cloud — id/name/updatedAt only, never the bytes
 *  (those load lazily on open, same as a project's). Mirrors loadCloudSheet's result shape. */
export async function listOrgWorkbooksCloud() {
  if (!supabaseConfigured()) return { ok: false, reason: "unavailable" };
  const { data, error } = await supabase.from(ORG_TABLE).select("id, name, updated_at").is("deleted_at", null).order("updated_at", { ascending: false });
  if (error) return isMissingRelation(error) ? { ok: false, reason: "not-provisioned" } : { ok: false, reason: "error", error: error.message };
  return { ok: true, rows: (data || []).map((r) => ({ id: r.id, name: r.name || "Untitled workbook", updatedAt: r.updated_at ? Date.parse(r.updated_at) : 0 })) };
}

export async function loadOrgWorkbookCloud(id) {
  if (!supabaseConfigured() || !id) return { ok: false, reason: "unavailable" };
  const { data, error } = await supabase.from(ORG_TABLE).select("data, version, name").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) return isMissingRelation(error) ? { ok: false, reason: "not-provisioned" } : { ok: false, reason: "error", error: error.message };
  if (!data) return { ok: true, sheet: null, version: null, name: null };
  return { ok: true, sheet: data.data, version: data.version ?? null, name: data.name || null };
}

/** B1953796 (R6) — the org workbook NAME has ONE writer after creation: renameOrgWorkbookCloud.
 *  A content save carries `name` only on an INSERT (expected == null, the row doesn't exist yet), so
 *  a stale tab's autosave can never revert another tab's rename. Pure; exported for tests. */
export function orgContentRow({ id, name, sheet, expected }) {
  return expected == null ? { id, name, data: sheet } : { id, data: sheet };
}

async function upsertOrgCore({ uid, id, name, sheet, expected }) {
  // Same shape as upsertCore above, minus the ensureProjectExists guard — an org workbook has no
  // project row to confirm against, so there's nothing to block a first save on.
  const r = await casUpsert(supabase, ORG_TABLE, { uid, id, row: orgContentRow({ id, name, sheet, expected }), expected, conflictTarget: ORG_CONFLICT_TARGET });
  if (r.degrade) {
    const res = await degradeUpsert(supabase, ORG_TABLE, { row: { id, user_id: uid, name, data: sheet }, conflictTarget: ORG_CONFLICT_TARGET });
    return res.ok
      ? { ok: true, version: null }
      : (isMissingRelation({ message: res.error }) ? { ok: false, reason: "not-provisioned" } : { ok: false, reason: "error", error: res.error });
  }
  if (!r.ok) {
    if (r.conflict) return { ok: false, reason: "conflict" };
    return isMissingRelation({ message: r.error }) ? { ok: false, reason: "not-provisioned" } : { ok: false, reason: "error", error: r.error };
  }
  return { ok: true, version: r.version };
}

/** Guarded cloud save for one org workbook — same CAS contract as saveCloudSheet, keyed by
 *  workbook id (never a project id) so two different workbooks' writes can never serialize
 *  against each other. */
export function saveOrgWorkbookCloud({ uid, id, name, sheet, expected }) {
  if (!supabaseConfigured() || !uid || !id) return Promise.resolve({ ok: false, reason: "unavailable" });
  return serializeOrgWrite(id, () => upsertOrgCore({ uid, id, name, sheet, expected }));
}

/** Rename is metadata-only — never touches `data` or bumps the CAS `version`, so it can't
 *  conflict with (or be conflicted by) a concurrent content save for the same workbook. */
export async function renameOrgWorkbookCloud(uid, id, name) {
  if (!supabaseConfigured() || !uid || !id) return { ok: false, reason: "unavailable" };
  const { error } = await supabase.from(ORG_TABLE).update({ name }).eq("id", id).eq("user_id", uid);
  if (error) return isMissingRelation(error) ? { ok: false, reason: "not-provisioned" } : { ok: false, reason: "error", error: error.message };
  return { ok: true };
}

/** Soft-delete (TOMBSTONE-DELETES / docs/DATA.md §13 — a tombstone UPDATE, never a row DELETE),
 *  matching doc_reviews' own convention. */
export async function deleteOrgWorkbookCloud(uid, id) {
  if (!supabaseConfigured() || !uid || !id) return { ok: false, reason: "unavailable" };
  const { error } = await supabase.from(ORG_TABLE).update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("user_id", uid);
  if (error) return isMissingRelation(error) ? { ok: false, reason: "not-provisioned" } : { ok: false, reason: "error", error: error.message };
  return { ok: true };
}
