/* Document Review — cloud persistence I/O (Supabase).
 *
 * Reuses the SINGLE Supabase client + auth session already wired into the app
 * (site-planner/lib/supabase.js, auth.js). No new project, client, or keys — a
 * signed-in user's review state is private by default (the same RLS rule as their
 * Site Planner sites): they only ever read/write their own reviews and own PDFs.
 *
 * Two stores per review (see db/doc_reviews.sql):
 *   - public.doc_reviews (Postgres): the small work layer — markups, measurements,
 *     calibration, stitch transforms, takeoff, plus the list of source-file refs.
 *   - source-file BYTES: Google Drive, via the chunked same-origin upload (B409 rework —
 *     ~16 MB slices through /api/uploads/*, so ANY file size works; no whole-file request
 *     ever rides through the Worker). The old Supabase Storage 'doc-review-files' bucket
 *     (50 MB cap) is READ-BACK ONLY for files stored there before the cutover.
 *
 * A synchronous localStorage mirror of the work layer backs the beforeunload flush
 * (a cloud upsert can't reliably complete during page unload) and lets a refresh
 * restore the last edit even if the debounced cloud write hadn't landed yet —
 * exactly the local-cache + cloud-mirror shape the Site Planner uses.
 */
import { supabase, supabaseRest, currentAccessToken } from "../../site-planner/lib/supabase.js";
import { getUser } from "../../site-planner/lib/auth.js";
import { cloudUpsert } from "../../site-planner/lib/cloudSync.js";
import { casUpsert, keepaliveCasPush, isMissingVersionColumn, isMissingColumn } from "../../../shared/cloud/optimisticUpsert.js";
import { makeWriteSerializer } from "../../../shared/cloud/serializeWrites.js";
import { STATUSES, STATUS_META, statusOf } from "../../site-planner/lib/siteModel.js";
import { uploadFileInChunks } from "../../../shared/files/chunkedUpload.js";

export const BUCKET = "doc-review-files";
// The OLD Supabase free-tier per-file cap. It no longer limits uploads (B409 rework:
// chunked Drive uploads are size-unbounded); it survives as (a) the threshold above which
// a Drive-stored PDF opens by RANGE-STREAMING instead of a full download, and (b) the
// size that classifies LEGACY never-stored `oversize` records (sourceState).
export const MAX_BYTES = 50 * 1024 * 1024;
export const REVIEW_SCHEMA = 1;

// Filing taxonomy. Disciplines are a fixed set (the filing dropdown / library folders); the
// canonical list lives in the reader (shared/files/titleBlockParse.js) and is re-exported here so
// the reader's output vocabulary and this UI can't drift. Project lifecycle status is REUSED from
// the Site Model so both workspaces agree on one source of truth (sites.data ->> status).
export { DISCIPLINES } from "../../../shared/files/titleBlockParse.js";
export { STATUSES, STATUS_META, statusOf };

// "<Project> - <Item> - YYYY.MM.DD" — the default review/file name; each piece editable.
const pad = (n) => String(n).padStart(2, "0");
export function fmtDocDate(d) {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) { const [y, m, day] = d.slice(0, 10).split("-"); return `${y}.${m}.${day}`; }
  const dt = d ? new Date(d) : new Date();
  if (isNaN(dt)) return "";
  return `${dt.getFullYear()}.${pad(dt.getMonth() + 1)}.${pad(dt.getDate())}`;
}
export function composeTitle({ project, item, docDate } = {}) {
  // DATE-FIRST — the owner's own filing convention ("2026.06.23 GPL - Arch IFR"): every file he
  // names starts with the document date, so auto-named files sort and read the same way his do
  // (B659; was "<Project> - <Item> - date"). Keep server/filing/naming.js in lockstep.
  const head = [project, item].map((s) => (s || "").trim()).filter(Boolean).join(" - ") || "Untitled";
  const date = fmtDocDate(docDate);
  return date ? `${date} ${head}` : head;
}

export const cloudConfigured = () => !!supabase;

export async function currentUid() {
  const u = await getUser();
  return u ? u.id : null;
}

// True only when we can actually persist to the cloud: configured AND signed in.
export async function cloudReady() {
  return !!supabase && !!(await currentUid());
}

export const newReviewId = () => "rv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const newSourceId = () => "src" + Math.random().toString(36).slice(2, 9);

// Organize objects as <uid>/project-<id>/<discipline>/<srcId>.pdf. The uid stays first
// so the existing Storage RLS (first folder = auth.uid()) is unchanged; the rest is the
// requested project/discipline structure. srcId is the object name (unique, safe); the
// human filename lives in the index/metadata.
const slug = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";

// Best-effort MIME for a stored file (B685 — any file type). The browser fills `file.type` for
// most picks, but drag-dropped CAD files (.dwg/.dxf) and some pickers hand back an EMPTY type;
// derive one from the extension so Drive/Supabase file the bytes with a sensible content type
// (a wrong "application/pdf" on a DWG would mislabel it in Drive). Unknown → the safe generic
// binary type, never a wrong specific one.
const CONTENT_TYPE_BY_EXT = {
  pdf: "application/pdf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  tif: "image/tiff", tiff: "image/tiff", bmp: "image/bmp", svg: "image/svg+xml", heic: "image/heic",
  dwg: "image/vnd.dwg", dxf: "image/vnd.dxf", dwf: "model/vnd.dwf",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv", txt: "text/plain", rtf: "application/rtf",
  zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  kml: "application/vnd.google-earth.kml+xml", kmz: "application/vnd.google-earth.kmz",
};
export function guessContentType(name = "", type = "") {
  if (type) return type;
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  const ext = m ? m[1].toLowerCase() : "";
  return CONTENT_TYPE_BY_EXT[ext] || "application/octet-stream";
}

// Strip a trailing FILE EXTENSION for a display label — but only a REAL extension, one that
// STARTS WITH A LETTER (B686). This keeps version-style names intact: "Rev.3", "Site Plan v1.2",
// "Lot2.5Acres" are NOT clipped (their trailing ".3"/".2"/".5Acres" begin with a digit), while
// "survey.pdf" / "plan.dwg" / "budget.xlsx" lose their extension as intended.
export function stripFileExt(name = "") {
  return String(name || "").replace(/\.[a-z][a-z0-9]{0,7}$/i, "");
}

/* ------------------------- review records (Postgres) ------------------------ */

// Per-tab `version` tokens for the optimistic-concurrency guard (B314), populated by
// loadReview/listReviews and advanced on every successful write. Same primitive the Site
// Planner uses (shared casUpsert), so a review changed in another session can't be silently
// clobbered. Until db/optimistic_concurrency.sql adds the column, every write degrades to a
// plain upsert (today's behaviour) and this stays empty.
const reviewVersions = {};
export function clearReviewVersions() { for (const k of Object.keys(reviewVersions)) delete reviewVersions[k]; }

// B528: serialize cloud writes per review id so a tab can't race ITSELF (debounced autosave +
// a visibility/unmount/manual flush firing together) into a false self-conflict that locks out
// autosave. A second write for an id waits for the in-flight one, so it reads the version that
// write threaded back into `reviewVersions` → the CAS succeeds. Cross-device conflicts are
// unaffected (the genuine guard in casUpsert is untouched).
const serializeReviewWrite = makeWriteSerializer();
export function upsertReview(record) {
  if (!record || !record.id) return upsertReviewCore(record); // no id → nothing to serialize on; core returns the error
  return serializeReviewWrite(record.id, () => upsertReviewCore(record));
}

// B714 — the core column payload a review save sends (pure; exported for tests). team_id rides
// ONLY on a brand-new row (isNew): an ordinary update must never carry the sharing pointer, so a
// stale in-memory record can't silently unshare a project (see cloudSync.siteRowFor for the full
// story — same bug class, same rule).
export function reviewRowFor(record, { isNew = false } = {}) {
  const row = {
    id: record.id,
    title: record.title || null,
    kind: record.kind || null,
    project: record.project || null,
    discipline: record.discipline || null,
    updated_at: new Date(record.updatedAt || Date.now()).toISOString(),
    data: { ...record, schemaVersion: REVIEW_SCHEMA },
  };
  if (isNew) row.team_id = record.teamId || null;
  return row;
}

async function upsertReviewCore(record) {
  if (!supabase) return { ok: false, error: "Cloud not configured." };
  const uid = await currentUid();
  if (!uid) return { ok: false, error: "Sign in to save." };
  if (!record || !record.id) return { ok: false, error: "Review has no id." };
  // Core columns (exist since the first persistence migration) + the data jsonb, which
  // always carries every field (incl. the library ones). The library index columns are
  // added on top; if that migration hasn't run yet we fall back to the core row so
  // saving never regresses — the new fields still round-trip through `data`.
  // No user_id here: casUpsert stamps the creator only on INSERT, so a teammate editing a
  // SHARED review never re-stamps the owner.
  const expected = reviewVersions[record.id];
  // B714 — team_id is INSERT-ONLY (mirrors cloudSync.siteRowFor): a content save from a tab whose
  // in-memory record predates a share must never be able to revert the sharing column. Share and
  // unshare go ONLY through lib/sharing.js's explicit column update; a brand-new row still stamps
  // the record's teamId so a review created inside a shared project is born shared.
  const base = reviewRowFor(record, { isNew: expected == null });
  const full = { ...base, project_id: record.projectId || null, item: record.item || null, revision: record.revision || null, doc_date: record.docDate || null };
  // Optimistic concurrency (B314), guarded by the version we last synced. THREE independent
  // graceful degrades layer here so saving never regresses against a partially-migrated DB:
  // (a) the team_id column may be un-migrated → retry without it; (b) the library index columns
  // may be un-migrated → retry the core `base` row; (c) the `version` column may be un-migrated →
  // fall back to a plain upsert.
  const stripTeam = (row) => { const { team_id, ...rest } = row; return rest; };
  const libColMiss = (e) => !!e && /column|project_id|doc_date|revision|item|schema cache/i.test(e) && !/version/i.test(e) && !/team_id/i.test(e);
  // full → (lib cols missing) → base, for a given row-shaper (identity or team-stripped).
  const attempt = async (shape) => {
    let r = await casUpsert(supabase, "doc_reviews", { uid, id: record.id, row: shape(full), expected });
    if (r.ok === false && r.error && libColMiss(r.error))
      r = await casUpsert(supabase, "doc_reviews", { uid, id: record.id, row: shape(base), expected });
    return r;
  };
  let r = await attempt((x) => x);
  if (r.ok === false && r.error && isMissingColumn(r.error, "team_id")) // team_id column absent → drop it
    r = await attempt(stripTeam);
  if (r.degrade) { // version column absent → plain upsert. Target the live single-column PK
    // "id" (post db/team_sharing.sql); fall back to the old composite (user_id,id) only if that
    // 42P10s on a genuinely pre-migration DB. Mirrors upsertFileFacts' id-first→composite fallback.
    const isPkMismatch = (e) => /on conflict|no unique|constraint|exclusion/i.test(e || "");
    const isLibColMiss = (e) => /column|project_id|doc_date|revision|item|schema cache/i.test(e || "");
    const plainUpsert = async (onConflict, withUid) => {
      const stamp = (row) => (withUid ? { ...row, user_id: uid } : row);
      let { error } = await supabase.from("doc_reviews").upsert(stamp(stripTeam(full)), { onConflict });
      if (error && isLibColMiss(error.message)) // library index columns un-migrated → core row
        ({ error } = await supabase.from("doc_reviews").upsert(stamp(stripTeam(base)), { onConflict }));
      return error;
    };
    let error = await plainUpsert("id", false);
    if (isPkMismatch(error && error.message)) // pre-PK-change DB: target is (user_id,id)
      error = await plainUpsert("user_id,id", true);
    if (!error) writeDraft(uid, base.data);
    return { ok: !error, error: error ? error.message : null };
  }
  if (r.conflict) return { ok: false, conflict: true }; // another session advanced this review — caller prompts a reload
  if (r.ok) { reviewVersions[record.id] = r.version; writeDraft(uid, base.data); return { ok: true }; }
  return { ok: false, error: r.error || "save failed" };
}

// Synchronous best-effort cloud push for a forced reload (B452) — the doc-review mirror of
// keepaliveFlushSite. A guarded keepalive write that survives the navigation; version-guarded
// so it can never clobber a newer copy, and uses the always-present core columns (the library
// index columns may be un-migrated) — the `data` jsonb carries every field regardless. The
// synchronous localStorage mirror remains the guarantee; this just shortens the lost window.
// Returns true if a request was dispatched.
export function keepaliveFlushReview(record) {
  if (!supabase || !record || !record.id) return false;
  const { url, anon } = supabaseRest();
  const token = currentAccessToken();
  // Core-column row, NO team_id (B714) — the keepalive is always an update, and an update must
  // never carry the sharing pointer (a stale in-memory teamId would silently unshare).
  const row = reviewRowFor(record);
  return keepaliveCasPush({ url, anon, token, table: "doc_reviews", id: record.id, row, expected: reviewVersions[record.id] });
}

// The full serialized review (the `data` jsonb), or null. RLS scopes to the user.
// A soft-deleted review (NEW-F3) reads as null unless the caller opts in — so the boot-resume
// pointers, refile, and place-on-map can never silently reopen a review sitting in the
// Recently-deleted bin; only the restore/purge paths pass includeDeleted.
export async function loadReview(id, { includeDeleted = false } = {}) {
  if (!supabase || !id) return null;
  let { data, error } = await supabase.from("doc_reviews").select("data, version, team_id, deleted_at").eq("id", id).maybeSingle();
  if (error && isMissingColumn(error, "deleted_at")) // soft-delete migration not run → drop deleted_at
    ({ data, error } = await supabase.from("doc_reviews").select("data, version, team_id").eq("id", id).maybeSingle());
  if (error && isMissingColumn(error, "team_id")) // team-sharing migration not run → drop team_id
    ({ data, error } = await supabase.from("doc_reviews").select("data, version").eq("id", id).maybeSingle());
  if (error && isMissingVersionColumn(error)) // pre-migration → re-select without version
    ({ data, error } = await supabase.from("doc_reviews").select("data").eq("id", id).maybeSingle());
  if (error || !data) return null;
  if (data.deleted_at && !includeDeleted) return null; // in the Recently-deleted bin — not openable
  if (data.version != null) reviewVersions[id] = data.version; // remember it for the next save's CAS guard (B314)
  const rec = data.data || null;
  // Overlay the authoritative team_id column so a subsequent save preserves the share (the
  // record's own field can lag); null = private.
  if (rec && "team_id" in data) rec.teamId = data.team_id || null;
  return rec;
}

// Lightweight list for the picker / library (no heavy `data` payload). Falls back to
// the core columns if the library migration hasn't run yet (so the picker still works).
// fetchReviews is the honest read (NEW-F5, the pinStore.fetchPinsCloud pattern): a FAILED read
// returns { ok:false } — DISTINGUISHABLE from a truly empty account — so the Library keeps
// showing the last loaded list instead of a terrifying (and wrong) "no files". Only when every
// fallback tier errors is the read a failure. listReviews stays as the graceful [] wrapper for
// callers where empty-on-error is acceptable (pickers).
export async function fetchReviews() {
  if (!supabase) return { ok: false, rows: [], error: "Cloud not configured." };
  if (!(await currentUid())) return { ok: true, rows: [] }; // signed out — genuinely empty, the UI gates on sign-in
  // `placed:data->placed` pulls just the on-map flag out of the data jsonb (NOT the whole
  // heavy payload) so the drawer's Filed/On-map badge can reflect it (NEW-3). `sfile`/`folderId`
  // (B685/B686) likewise pull the authoritative source filename + explicit folder pick out of
  // `data` so the Library classifies type + places the file without re-reading the record. On any
  // error we fall back to the core columns — those extras degrade to absent, never a regression.
  const FULL = "id,title,kind,project,project_id,discipline,item,revision,doc_date,team_id,user_id,updated_at,placed:data->placed,sfile:data->>sourceFile,folderId:data->>folderId";
  // Newest tier adds the NEW-F3 soft-delete filter: a review in Recently-deleted leaves every list.
  let res = await supabase.from("doc_reviews").select(FULL).is("deleted_at", null).order("updated_at", { ascending: false });
  if (res.error) {
    // The filterless fallback tiers may run ONLY when deleted_at genuinely isn't migrated in
    // (then no soft-deleted rows can exist, so dropping the filter is safe). Any OTHER tier-1
    // error — a transient 5xx/timeout on a MIGRATED DB — must be an honest ok:false, or the
    // fallback would list Recently-deleted reviews as live (adversarial-review finding; the
    // caller's NEW-F5 keep-last-list path handles the failure). Migration order guarantees a
    // DB with deleted_at also has every older column, so the sub-tiers stay nested here.
    if (!isMissingColumn(res.error, "deleted_at"))
      return { ok: false, rows: [], error: res.error.message || "Couldn't load your files." };
    res = await supabase.from("doc_reviews").select(FULL).order("updated_at", { ascending: false });
    // team_id/user_id may be un-migrated → drop to the prior column set; then the older core set.
    if (res.error) res = await supabase.from("doc_reviews")
      .select("id,title,kind,project,project_id,discipline,item,revision,doc_date,updated_at,placed:data->placed")
      .order("updated_at", { ascending: false });
    if (res.error) res = await supabase.from("doc_reviews").select("id,title,kind,project,discipline,updated_at").order("updated_at", { ascending: false });
  }
  if (res.error || !res.data) return { ok: false, rows: [], error: (res.error && res.error.message) || "Couldn't load your files." };
  return { ok: true, rows: res.data };
}
export async function listReviews() {
  const r = await fetchReviews();
  return r.ok ? r.rows : [];
}

// The Recently-deleted bin (NEW-F3): light rows for soft-deleted reviews, newest delete first.
// Empty on a pre-migration DB (nothing soft-deleted can exist) — but a FAILED read returns
// NULL, never a fake-empty [] (the same failed-read≠empty rule as fetchReviews): the caller
// keeps its last-known bin instead of rendering it wiped.
export async function listDeletedReviews() {
  if (!supabase || !(await currentUid())) return [];
  const { data, error } = await supabase.from("doc_reviews")
    .select("id,title,kind,project,project_id,discipline,item,updated_at,deleted_at,sfile:data->>sourceFile")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) return isMissingColumn(error, "deleted_at") ? [] : null;
  return data || [];
}

// Mark a review as placed on the map at least once (NEW-3) — the write half of the
// Filed → On-map transition the drawer's "Place on map" action triggers. Stores `placed`
// in the review's data jsonb (so listReviews' `data->placed` surfaces it); idempotent.
export async function markReviewPlaced(id) {
  if (!(await cloudReady())) return { ok: false, error: "Sign in to place documents." };
  const rec = await loadReview(id);
  if (!rec) return { ok: false, error: "Review not found." };
  if (rec.placed) return { ok: true }; // already on the map — nothing to write
  return upsertReview({ ...rec, placed: true, placedAt: Date.now(), updatedAt: Date.now() });
}

/* Delete = SOFT delete (NEW-F3): stamp deleted_at and keep everything — the row (the markup
 * work layer), the stored bytes, and the local draft — so a mistaken two-click delete is
 * restorable from the Library's "Recently deleted" view for ~30 days (purgeExpiredDeleted
 * hard-purges after that, and purged bytes then get Drive's own ~30-day trash via NEW-F2).
 * B757's `.select("id")` no-op detection carries over unchanged: an UPDATE returns the rows it
 * touched the same way, so a 0-row RLS/ownership no-op stays DISTINGUISHABLE from a real delete.
 * On a pre-migration DB (no deleted_at column) this degrades to the old immediate hard delete
 * (purgeReview) so deleting never regresses. The local draft mirror IS cleared (B579 ordering:
 * only after the cloud write succeeds) — restore needs nothing from it (the soft-deleted row
 * keeps the full data jsonb), and a lingering draft would let the boot-resume path
 * (reconcile(cloud, draft)) reopen a deleted review from its stale local copy. */
export async function deleteReview(id) {
  if (!supabase || !id) return { ok: false };
  delete reviewVersions[id]; // the row advances server-side; drop the stale CAS token (B314)
  const { data, error } = await supabase.from("doc_reviews")
    .update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error && isMissingColumn(error, "deleted_at")) return purgeReview(id); // un-migrated DB → old behavior
  const removed = Array.isArray(data) ? data.length : 0;
  if (!error && removed > 0) { const uid = await currentUid(); if (uid) clearDraft(uid, id); }
  return { ok: !error, removed, soft: true, error: error ? error.message : null };
}

// Bring a soft-deleted review back (NEW-F3) — the "Restore" / undo-toast action.
export async function restoreReview(id) {
  if (!supabase || !id) return { ok: false };
  delete reviewVersions[id]; // force a fresh CAS token on the next load (B314)
  const { data, error } = await supabase.from("doc_reviews")
    .update({ deleted_at: null }).eq("id", id).select("id");
  const restored = Array.isArray(data) ? data.length : 0;
  return { ok: !error && restored > 0, restored, error: error ? error.message : null };
}

/* NEW-F1 shared-key guard — is this Drive key still referenced by ANOTHER review row?
 * jsonb containment (`data @> {"sources":[{"driveKey":k}]}`). RLS scopes the check to rows this
 * user can see, which is sufficient: Drive keys are uid-prefixed server-side, so another USER's
 * identical-looking key names a different physical file. Soft-deleted rows count as references
 * by design — a review in Recently-deleted still owns its bytes until purged. */
async function driveKeyReferencedElsewhere(id, driveKey) {
  try {
    const { data, error } = await supabase.from("doc_reviews")
      .select("id").neq("id", id).contains("data", { sources: [{ driveKey }] }).limit(1);
    if (error) return { guardOk: false, sharedByOther: false };
    return { guardOk: true, sharedByOther: (data || []).length > 0 };
  } catch (_) { return { guardOk: false, sharedByOther: false }; }
}
// Pure decision (exported for tests): bytes may be deleted ONLY on a CONFIRMED not-shared
// answer. A failed guard query fails SAFE — skip the byte delete and report it as possibly
// orphaned; never delete bytes another review might still need (legacy name-shared keys, B?F1).
export const shouldDeleteBytes = ({ guardOk, sharedByOther }) => guardOk === true && !sharedByOther;

/* HARD delete (was deleteReview's body): remove the bytes, the facts row, the doc_reviews row,
 * and the local mirror. Reached only via "Delete forever" in Recently-deleted, the 30-day lazy
 * purge, or the pre-migration degrade above. RLS scopes every store to the owner (or a
 * team-admin on a shared review). Cleanup failures surface via orphaned/cleanupFailed (NEW-4). */
export async function purgeReview(id) {
  if (!supabase || !id) return { ok: false };
  delete reviewVersions[id]; // stop tracking a removed review's version (B314)
  const uid = await currentUid();
  let orphaned = 0;       // # source files whose byte-cleanup didn't confirm
  let sharedKept = 0;     // # Drive files kept because another review still references the key (NEW-F1)
  let cleanupErr = false; // an unexpected throw during cleanup
  try {
    // Prefer the cloud record; if the network read misses, fall back to the local mirror so
    // we can still clean up Storage + Drive instead of orphaning bytes (B321/NEW-1).
    let rec = await loadReview(id, { includeDeleted: true });
    if (!rec && uid) rec = readDraft(uid, id);
    const srcs = (rec && rec.sources) || [];
    // Supabase Storage keys are srcId-named (unique per source) — no sharing possible there.
    const keys = srcs.map((s) => s.storageKey).filter(Boolean);
    if (keys.length) { const { error: rmErr } = await supabase.storage.from(BUCKET).remove(keys); if (rmErr) orphaned += keys.length; }
    // Drive copies (B207): deduped (a stitched review can repeat a key), and each byte-delete
    // gated by the NEW-F1 shared-key guard — legacy name-based keys can be shared by two
    // reviews, and deleting one review must never blank the other's backdrop.
    const driveKeys = [...new Set(srcs.map((s) => s.driveKey).filter(Boolean))];
    for (const k of driveKeys) {
      const ref = await driveKeyReferencedElsewhere(id, k);
      if (!shouldDeleteBytes(ref)) { if (ref.sharedByOther) sharedKept += 1; else orphaned += 1; continue; }
      if ((await deleteFromDrive(k)) !== true) orphaned += 1;
    }
    if (uid) { // back-compat: also clear any legacy <uid>/<reviewId>/ folder
      const { data: files } = await supabase.storage.from(BUCKET).list(`${uid}/${id}`);
      if (files && files.length) { const { error: legErr } = await supabase.storage.from(BUCKET).remove(files.map((f) => `${uid}/${id}/${f.name}`)); if (legErr) orphaned += files.length; }
    }
  } catch (_) { cleanupErr = true; }
  // NEW-F7 — the facts index row is part of this review's cascade set (TOMBSTONE-DELETES:
  // the FULL set, not just the obvious row). Facts are keyed id = review id for singles and
  // review_id for linked rows — cover both. A missing table/column (un-migrated DB) is fine;
  // any other failure surfaces via cleanupFailed.
  let factsFailed = false;
  try {
    const { error: fErr } = await supabase.from("file_facts").delete().or(`id.eq.${id},review_id.eq.${id}`);
    if (fErr && !isMissingColumn(fErr) && !/relation|does not exist|schema cache/i.test(fErr.message || "")) factsFailed = true;
  } catch (_) { factsFailed = true; }
  // Scope by id only; RLS decides (own review OR team-admin on a shared one). A user_id filter
  // would block an admin from deleting a teammate's shared review, which the policy permits.
  // B757 — `.select("id")` returns the rows actually removed, so a 0-row no-op (RLS/ownership
  // mismatch, or an already-deleted row) is DISTINGUISHABLE from a real removal — matching the
  // sites path (B372/B468). A bare `.delete()` reported success on both, the silent no-op this fixes.
  const { data, error } = await supabase.from("doc_reviews").delete().eq("id", id).select("id");
  const removed = Array.isArray(data) ? data.length : 0;
  // B579: clear the localStorage mirror only AFTER the cloud delete succeeds. Clearing it first
  // (the old order) meant a failed delete (network/auth) left the cloud row alive but the local
  // mirror gone → the row stayed in the library yet could no longer auto-resume; keep them in
  // step so a failed delete leaves a fully consistent, retry-able state.
  if (!error && uid) clearDraft(uid, id);
  const cleanupFailed = orphaned > 0 || cleanupErr || factsFailed;
  return { ok: !error, removed, error: error ? error.message : null, orphaned: orphaned || undefined, sharedKept: sharedKept || undefined, cleanupFailed: cleanupFailed || undefined };
}

/* Lazy 30-day purge (NEW-F3): hard-purge anything that's sat in Recently-deleted past the
 * window. Called best-effort from the Library's refresh — symmetric with Drive's own ~30-day
 * trash, so "deleted" data has two sequential recovery windows before it's truly gone.
 * Returns { ok, purged, failed } — the caller surfaces failures via its notice rail. */
export async function purgeExpiredDeleted({ days = 30 } = {}) {
  if (!supabase || !(await currentUid())) return { ok: true, purged: 0, failed: 0 };
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase.from("doc_reviews").select("id").not("deleted_at", "is", null).lt("deleted_at", cutoff);
  if (error) // un-migrated DB (no deleted_at) has nothing soft-deleted to purge — that's fine
    return isMissingColumn(error, "deleted_at") ? { ok: true, purged: 0, failed: 0 } : { ok: false, purged: 0, failed: 0, error: error.message };
  let purged = 0, failed = 0, cleanupFailed = false;
  for (const row of data || []) {
    const r = await purgeReview(row.id);
    if (r.ok && r.removed > 0) purged += 1; else if (!r.ok) failed += 1;
    if (r.cleanupFailed) cleanupFailed = true; // stranded bytes surface, even from the automated purge
  }
  return { ok: failed === 0, purged, failed, cleanupFailed };
}

// Re-file an existing review under a (different) project/discipline — the one-click
// confirm out of the "needs filing" holding area (B217). Loads the full record, updates
// only the filing fields, and re-upserts; the work layer + sources are untouched. (The
// stored object path doesn't move — storageKey already encodes the prior location and
// stays valid; re-pathing the bytes is a backend-tranche nicety, not needed to re-file.)
export async function refileReview(id, { projectId = null, project = "", discipline, item } = {}) {
  if (!(await cloudReady())) return { ok: false, error: "Sign in to file documents." };
  const rec = await loadReview(id);
  if (!rec) return { ok: false, error: "Review not found." };
  const next = { ...rec, projectId: projectId || null, project: project || "" };
  if (discipline) next.discipline = discipline;
  if (item) next.item = item;
  return upsertReview({ ...next, updatedAt: Date.now() });
}

/* --------------------------- projects (Site groups) ------------------------ */

// A "project" = a Site Planner site group. One entry per group_id with its display
// name + lifecycle status (read straight from the Site Model jsonb).
export async function fetchProjects() {
  if (!supabase) return { ok: false, rows: [], error: "Cloud not configured." };
  if (!(await currentUid())) return { ok: true, rows: [] };
  // Prefer the richest select (status + team_id); degrade if either column isn't migrated in.
  let res = await supabase.from("sites").select("group_id,site,updated_at,team_id,status:data->>status").order("updated_at", { ascending: false });
  if (res.error) res = await supabase.from("sites").select("group_id,site,updated_at,status:data->>status").order("updated_at", { ascending: false });
  if (res.error) res = await supabase.from("sites").select("group_id,site,updated_at").order("updated_at", { ascending: false }); // tolerate older PostgREST
  // NEW-F5: only a failure of EVERY tier is an honest read failure — the caller keeps its
  // prior list instead of rendering "no projects" off a network blip.
  if (res.error || !res.data) return { ok: false, rows: [], error: (res.error && res.error.message) || "Couldn't load projects." };
  const data = res.data;
  const byId = new Map();
  for (const r of data) {
    const id = r.group_id;
    if (!id) continue;
    if (!byId.has(id)) // newest row wins for the name/status
      byId.set(id, { id, name: r.site || "Untitled site", status: STATUSES.includes(r.status) ? r.status : "unknown", teamId: r.team_id || null });
    else if (r.team_id && !byId.get(id).teamId) byId.get(id).teamId = r.team_id; // any shared plan ⇒ project is shared
  }
  return { ok: true, rows: [...byId.values()] };
}
export async function listProjects() {
  const r = await fetchProjects();
  return r.ok ? r.rows : [];
}

// Set a project's lifecycle status across its whole site group, reusing the Site
// Planner's own write path so there's a single source of truth (no parallel store).
export async function setProjectStatus(projectId, status) {
  if (!supabase || !projectId || !STATUSES.includes(status)) return { ok: false };
  const uid = await currentUid();
  if (!uid) return { ok: false };
  const { data, error } = await supabase.from("sites").select("data").eq("group_id", projectId);
  if (error || !data) return { ok: false };
  // Write each plan in the group in parallel and report partial failure, rather than a
  // serial loop that returned ok:true even if one plan kept its old status (B56c).
  const rows = data.filter((r) => r.data);
  const results = await Promise.allSettled(rows.map((r) => cloudUpsert(uid, { ...r.data, status, updatedAt: Date.now() })));
  const failed = results.filter((x) => x.status === "rejected" || !(x.value && x.value.ok)).length;
  return { ok: failed === 0, failed, total: rows.length };
}

/* --------------------------- file-facts index (B299) ----------------------- */
// The queryable auto-filing index (db/file_facts.sql): one small row per filed drawing, so the
// library can answer "this project's Civil set, latest revision" WITHOUT re-reading the PDF.
// Degrades gracefully — if the migration hasn't run (or the user's signed out) upsert no-ops
// and list returns [], so filing never regresses (same discipline as listReviews' fallback).
export async function upsertFileFacts(row) {
  if (!supabase || !row || !row.id) return { ok: false, error: "Cloud not configured." };
  const uid = await currentUid();
  if (!uid) return { ok: false, error: "Sign in to file documents." };
  // No user_id in the payload: the column default (auth.uid()) stamps the creator on INSERT, so a
  // teammate edit of a shared row won't re-stamp the owner. category/state are the Work Item B
  // index columns. onConflict = the PK "id" (post the phase-2 migration). Degrade gracefully if
  // any optional column (team_id / category / state) or the old composite PK isn't where we
  // expect, so indexing never regresses on a partial migration.
  // B714 — team_id rides ONLY when a caller explicitly set it: this is a plain UPSERT, and the
  // regular filing callers (toFactsRow) never carry teamId, so the old `teamId || t0 || null`
  // rewrote a SHARED fact row back to private on every refile. Omitting the key leaves the
  // column untouched on update; sharing stamps it project-wide via lib/sharing.js.
  const { teamId, team_id: t0, ...rest } = row;
  const payload = (teamId !== undefined || t0 !== undefined) ? { ...rest, team_id: teamId || t0 || null } : rest;
  const core = () => { const { team_id, category, state, ...c } = payload; return c; };
  let { error } = await supabase.from("file_facts").upsert(payload, { onConflict: "id" });
  if (error && /team_id|category|state|column|schema cache/i.test(error.message || ""))
    ({ error } = await supabase.from("file_facts").upsert(core(), { onConflict: "id" }));
  if (error && /on conflict|no unique|constraint|exclusion/i.test(error.message || "")) // pre-PK-change: target is (user_id,id)
    ({ error } = await supabase.from("file_facts").upsert({ ...core(), user_id: uid }, { onConflict: "user_id,id" }));
  return { ok: !error, error: error ? error.message : null };
}

const FILE_FACTS_CORE = "id,review_id,project_id,discipline,item,sheet_number,sheet_title,revision,doc_date,source_file,match_confidence,needs_filing,placement,updated_at";
export async function fetchFileFacts() {
  if (!supabase) return { ok: false, rows: [], error: "Cloud not configured." };
  if (!(await currentUid())) return { ok: true, rows: [] };
  let { data, error } = await supabase.from("file_facts")
    .select(FILE_FACTS_CORE + ",team_id,category,state")
    .order("updated_at", { ascending: false });
  if (error) // an optional column (team_id / category / state) isn't migrated in → read the core set
    ({ data, error } = await supabase.from("file_facts").select(FILE_FACTS_CORE).order("updated_at", { ascending: false }));
  // NEW-F5: a failed read is { ok:false }, never a fake-empty [] — but a MISSING TABLE
  // (pre-migration DB) genuinely has no facts, which is an honest empty, not a failure.
  if (error) return /relation|does not exist|schema cache/i.test(error.message || "")
    ? { ok: true, rows: [] }
    : { ok: false, rows: [], error: error.message };
  return { ok: true, rows: data || [] };
}
export async function listFileFacts() {
  const r = await fetchFileFacts();
  return r.ok ? r.rows : [];
}

/* Build the stable Drive key for one stored source (NEW-F1). The key embeds the SOURCE id in
 * its last segment — `project-<pid>/<discipline>/<srcId>__<fileName>` — so two uploads of the
 * same-named file (a revised C-101.pdf is the norm in construction sets) mint DIFFERENT keys.
 * The old name-only key made them collide: the `drive_files` mapping upsert rebound the shared
 * key to the newest Drive file, silently swapping the older review's backdrop, and deleting
 * either review deleted the one mapped file out from under the other. srcId rides in the LAST
 * segment (never the folder part) so the server's flat-folder derivation (uploads/start.js drops
 * the last segment) and the B663 prefix scans see exactly the folder shape they always did.
 * Legacy name-only keys stay valid forever: every read/share/move/delete resolves the key STORED
 * on the source record, and new keys (containing `__` after an srcId) can't collide with them.
 * srcId charset is [a-z0-9] (newSourceId), so the key stays URL- and pattern-safe. Pure; exported
 * for tests. */
export function buildDriveKey({ projectId = null, discipline = "Other", fileName, srcId = null } = {}) {
  const folder = `project-${projectId ? slug(projectId) : "unfiled"}/${slug(discipline)}`;
  const name = fileName || "document.pdf";
  return `${folder}/${srcId ? `${srcId}__${name}` : name}`;
}

/* Push a file's bytes to Google Drive through the CHUNKED same-origin upload (B409 rework).
 * Works at ANY size: the file goes up in ~16 MB slices via /api/uploads/* — the server
 * relays each slice to a Drive resumable session it holds — so no single request is ever
 * large and neither the Worker's ~100 MB body cap, its 128 MB memory, nor any per-file
 * storage ceiling applies. (The previous two transports both hit walls: the whole-file
 * POST buffered in the Worker, and B409's browser-direct PUT to Google was CORS-dead.)
 * Sequential chunks, 5× retry with backoff, and resume-from-offset after a drop live in
 * shared/files/chunkedUpload.js. `onProgress(sentBytes, totalBytes)` drives the Library
 * tray's per-file progress bar. Returns { ok, driveKey } on success (driveKey = the stable
 * key to read it back with), { ok:false, skipped:true } when Drive isn't enabled yet, or
 * { ok:false, error }. Best-effort — never throws. */
export async function pushFileToDrive(file, { projectId = null, discipline = "Other", fileName, srcId = null, folderId = null, onProgress = null } = {}) {
  if (!supabase) return { ok: false, skipped: true, error: "Cloud not configured." };
  // Token as a GETTER, not a snapshot: a multi-GB upload outlives a Supabase access token
  // (~1 h), so every request re-reads the current (auto-refreshed) session token.
  const getToken = async () => {
    try { const { data } = await supabase.auth.getSession(); return (data && data.session && data.session.access_token) || ""; }
    catch (_) { return ""; }
  };
  if (!(await getToken())) return { ok: false, skipped: true, error: "Not signed in." };
  const name = fileName || "document.pdf";
  const driveKey = buildDriveKey({ projectId, discipline, fileName, srcId }); // unique per source (NEW-F1); server prefixes the uid
  return uploadFileInChunks({
    file, token: getToken, planyrKey: driveKey, name, contentType: guessContentType(name, file.type),
    // Tree targeting (B650 follow-on): the server files the bytes into the project's standard
    // folder tree when it's mirrored; an explicit folder pick (B686) wins over the discipline
    // route; the flat path derived from the key stays the never-blocking fallback.
    projectId: projectId ? String(projectId) : null,
    discipline: discipline ? String(discipline) : null,
    folderId: folderId ? String(folderId) : null,
    onProgress,
  });
}

/* Delete a file's bytes FROM Google Drive (DELETE /api/files?key=…). Best-effort —
 * returns true on a clean delete, false otherwise; never throws. Called when a review is
 * deleted so a Drive-only file doesn't orphan a copy in Drive. */
export async function deleteFromDrive(driveKey) {
  if (!supabase || !driveKey) return false;
  let token = null;
  try { const { data } = await supabase.auth.getSession(); token = data && data.session && data.session.access_token; } catch (_) { return false; }
  if (!token) return false;
  try {
    const resp = await fetch(`/api/files?key=${encodeURIComponent(driveKey)}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    return resp.ok;
  } catch (_) { return false; }
}

/* Read a file's bytes back FROM Google Drive (B207 read-back). Returns an ArrayBuffer
 * (ready for loadPdf) or null — null lets the caller fall back to Supabase Storage so a
 * pre-Drive file (or any Drive miss) still opens. Never throws. */
export async function downloadFromDrive(driveKey) {
  if (!supabase || !driveKey) return null;
  let token = null;
  try { const { data } = await supabase.auth.getSession(); token = data && data.session && data.session.access_token; } catch (_) { return null; }
  if (!token) return null;
  try {
    const resp = await fetch(`/api/files?key=${encodeURIComponent(driveKey)}`, { headers: { authorization: `Bearer ${token}` } });
    if (!resp.ok) return null;
    return await resp.arrayBuffer();
  } catch (_) { return null; }
}

/* Generate a shareable link for a filed drawing (POST /api/files/share?key=…). Returns
 * { ok, url } or an honest { ok:false, error } — never a silent failure (NEW-4/NEW-3). The
 * link is minted server-side through the storage adapter's link provider: Drive's native
 * "anyone with the link" webViewLink today, a future planyr.io/s/<token> being a one-place
 * switch with no change here. driveKey = the same stable key downloadFromDrive uses (the
 * server prefixes the uid). Never throws. */
export async function getShareLink(driveKey) {
  if (!supabase || !driveKey) return { ok: false, error: "No file to share." };
  let token = null;
  try { const { data } = await supabase.auth.getSession(); token = data && data.session && data.session.access_token; } catch (_) { return { ok: false, error: "Sign in to share." }; }
  if (!token) return { ok: false, error: "Sign in to share." };
  try {
    const resp = await fetch(`/api/files/share?key=${encodeURIComponent(driveKey)}`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    let jr = {}; try { jr = await resp.json(); } catch (_) { /* ignore */ }
    if (resp.status === 503) return { ok: false, error: "Drive isn’t enabled yet." };
    if (resp.status === 404) return { ok: false, error: jr.error || "This file isn’t stored in Drive, so there’s no shareable link." };
    return resp.ok && jr.ok && jr.url ? { ok: true, url: jr.url } : { ok: false, error: jr.error || `HTTP ${resp.status}` };
  } catch (e) { return { ok: false, error: (e && e.message) || "Network error." }; }
}

// File a dropped file as a new (single-sheet) review under a project/discipline. Drive is
// the one home for bytes (chunked upload, any size — B409 rework); a failed upload is
// reported loudly (uploadFailed) rather than degraded into a capped fallback store. Then
// upsert the indexed record. Returns { ok, id }.
export async function fileNewReview({ projectId = null, project = "", discipline = "Other", item = "", docDate = null, blob, fileName, folderId = null, onProgress = null }) {
  if (!(await cloudReady())) return { ok: false, error: "Sign in to file documents." };
  const id = newReviewId();
  const srcId = newSourceId();
  // Use the drawing's own date when auto-filing supplies one (YYYY-MM-DD); else today.
  const filedDate = (typeof docDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(docDate)) ? docDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const itemLabel = item || stripFileExt(fileName || "Document");
  // Store the bytes Drive-first, Supabase-fallback (the one shared policy — see storeSource).
  const stored = blob
    ? await storeSource(srcId, blob, { projectId, discipline, fileName, folderId, onProgress })
    : { ok: false, storageKey: null, driveKey: null, oversize: false, driveError: null, driveSkipped: true };
  // stored.oversize is always false on the chunked path (there is no size cap anymore);
  // the guard survives for the shape's sake — any not-ok store is a loud upload failure.
  const uploadFailed = !stored.ok && !stored.oversize;
  const record = {
    id, kind: "single", title: composeTitle({ project, item: itemLabel, docDate: filedDate }),
    project, projectId, discipline, item: itemLabel, revision: "", docDate: filedDate,
    // The original upload filename lives on the review itself (B685/B686) — AUTHORITATIVE for
    // "is this a PDF?" (listReviews surfaces it), so a missed best-effort facts write can't make a
    // non-PDF look like a PDF. folderId records an explicit folder pick so on-screen placement +
    // the Drive folder agree.
    sourceFile: fileName || "document.pdf",
    ...(folderId ? { folderId } : {}),
    sources: [{ srcId, name: fileName || "document.pdf", size: blob ? blob.size : 0, storageKey: stored.storageKey, oversize: stored.oversize, driveKey: stored.driveKey }],
    single: { srcId, fileName: fileName || "document.pdf", numPages: 0, page: 1, markups: [], calByPage: {} },
  };
  const res = await upsertReview({ ...record, updatedAt: Date.now() });
  return { ok: res.ok, id, error: res.error, uploadFailed, oversize: stored.oversize, large: stored.large, name: fileName || "document.pdf",
    driveError: stored.driveError };
}

/* --------------------------- source PDFs (Storage) -------------------------- */

// A source is safe to PERSIST only once its bytes are actually stored somewhere — it has a
// Drive key, a Supabase Storage key, or is known-oversize (which the loader turns into a
// "re-drop" placeholder). Persisting a still-uploading (keyless) source would save a pointer
// the loader can't fetch → a permanent "re-open it to view" even though the bytes may have
// landed; buildSnapshot filters by this so a quick reload mid-upload can't strand a backdrop
// (B323/NEW-3).
export const isStoredSource = (s) => !!(s && (s.storageKey || s.driveKey || s.oversize));

/* Store ONE source file (filing drops, "Open PDF…", every Stitcher sheet): Google Drive,
 * via the chunked same-origin upload — ANY size (B409 rework). The old Supabase Storage
 * upload FALLBACK is deliberately GONE: its 50 MB cap is what produced the silent
 * "oversize" dead end, and a fallback that stores some files and rejects others is worse
 * than an honest failure. A failed Drive upload now surfaces loudly and retryably
 * (LOUD-FAILURE); files stored in Supabase before the cutover still read back via
 * downloadSource. `srcId` rides into the driveKey's last segment (NEW-F1) so every stored
 * source gets its own key — two same-named uploads can never collide. Returns
 * { ok, storageKey:null, driveKey, oversize:false, large, driveError, driveSkipped }. Never throws. */
export async function storeSource(srcId, blob, { projectId = null, discipline = "Other", fileName, folderId = null, onProgress = null } = {}) {
  const isLarge = !!(blob && blob.size > MAX_BYTES);
  const drive = blob
    ? await pushFileToDrive(blob, { projectId, discipline, fileName, srcId, folderId, onProgress })
    : { ok: false, skipped: true, error: "No file bytes." };
  if (drive.ok) return { ok: true, storageKey: null, driveKey: drive.driveKey, oversize: false, large: isLarge, driveError: null, driveSkipped: false };
  return { ok: false, storageKey: null, driveKey: null, oversize: false, large: isLarge,
    driveError: drive.skipped ? null : (drive.error || null), driveSkipped: !!drive.skipped };
}

/* A pdf.js-ready STREAMING source for a Drive-stored file (B409 rework — the read half of
 * unlimited-size files): the viewer opens `/api/files?key=…` BY URL and pdf.js reads it
 * with HTTP Range requests (206 Partial Content) through the streaming proxy — so a huge
 * PDF renders progressively instead of downloading in full first. Returns
 * { url, httpHeaders } for loadPdf, or null when signed out / not configured (callers
 * fall back to the buffered download). Never throws. */
export async function driveStreamSource(driveKey) {
  if (!supabase || !driveKey) return null;
  let token = null;
  try { const { data } = await supabase.auth.getSession(); token = data && data.session && data.session.access_token; } catch (_) { return null; }
  if (!token) return null;
  return { url: `/api/files?key=${encodeURIComponent(driveKey)}`, httpHeaders: { authorization: `Bearer ${token}` } };
}

// Download a source PDF as an ArrayBuffer (ready for loadPdf), or null if missing.
export async function downloadSource(storageKey) {
  if (!supabase || !storageKey) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(storageKey);
  if (error || !data) return null;
  try { return await data.arrayBuffer(); } catch (_) { return null; }
}

/* ----------------------- local mirror (flush / refresh) --------------------- */

const draftKey = (uid, id) => `planyr:docreview:draft:${uid || "anon"}:${id}`;

export function writeDraft(uid, record) {
  if (!record || !record.id) return;
  try { localStorage.setItem(draftKey(uid, record.id), JSON.stringify({ ...record, _localAt: Date.now() })); } catch (_) {}
}
export function readDraft(uid, id) {
  try { const s = localStorage.getItem(draftKey(uid, id)); return s ? JSON.parse(s) : null; } catch (_) { return null; }
}
export function clearDraft(uid, id) {
  try { localStorage.removeItem(draftKey(uid, id)); } catch (_) {}
}

// Cloud is the source of truth, but prefer a local draft that's strictly newer than
// the cloud copy (i.e. an edit made just before close that the debounce missed).
export function reconcile(cloud, draft) {
  if (!draft) return cloud;
  if (!cloud) return draft;
  const cloudAt = new Date(cloud.updatedAt || 0).getTime();
  return (draft._localAt || 0) > cloudAt ? draft : cloud;
}
