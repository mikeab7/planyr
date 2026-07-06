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
 *   - storage 'doc-review-files' (private): the source PDF bytes at
 *     <uid>/<reviewId>/<srcId>.pdf. Free tier caps a file at 50 MB; larger files
 *     are skipped and flagged `oversize` so the work layer still saves and the file
 *     is "re-drop on load".
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

export const BUCKET = "doc-review-files";
export const MAX_BYTES = 50 * 1024 * 1024; // Supabase free-tier per-file upload limit
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
// Header values must be printable ASCII — fetch() THROWS on non-Latin-1 header bytes, which
// would kill the whole upload over a free-typed discipline like "Landscaping (北)". The server
// match is fuzzy (slug-tolerant) and unknown disciplines fall back to the Drawings folder, so
// a stripped value degrades gracefully instead of failing loudly-in-the-wrong-place.
const headerSafe = (s) => String(s || "").replace(/[^\x20-\x7E]/g, "-").trim() || "Other";
const storageKeyFor = (uid, projectId, discipline, srcId) =>
  `${uid}/project-${projectId ? slug(projectId) : "unfiled"}/${discipline ? slug(discipline) : "other"}/${srcId}.pdf`;

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

async function upsertReviewCore(record) {
  if (!supabase) return { ok: false, error: "Cloud not configured." };
  const uid = await currentUid();
  if (!uid) return { ok: false, error: "Sign in to save." };
  if (!record || !record.id) return { ok: false, error: "Review has no id." };
  const data = { ...record, schemaVersion: REVIEW_SCHEMA };
  // Core columns (exist since the first persistence migration) + the data jsonb, which
  // always carries every field (incl. the library ones). The library index columns are
  // added on top; if that migration hasn't run yet we fall back to the core row so
  // saving never regresses — the new fields still round-trip through `data`.
  // No user_id here: casUpsert stamps the creator only on INSERT, so a teammate editing a
  // SHARED review never re-stamps the owner. team_id rides along (null = private; when set,
  // RLS lets the project's team read/edit it).
  const base = {
    id: record.id,
    title: record.title || null,
    kind: record.kind || null,
    project: record.project || null,
    discipline: record.discipline || null,
    team_id: record.teamId || null,
    updated_at: new Date(record.updatedAt || Date.now()).toISOString(),
    data,
  };
  const full = { ...base, project_id: record.projectId || null, item: record.item || null, revision: record.revision || null, doc_date: record.docDate || null };
  // Optimistic concurrency (B314), guarded by the version we last synced. THREE independent
  // graceful degrades layer here so saving never regresses against a partially-migrated DB:
  // (a) the team_id column may be un-migrated → retry without it; (b) the library index columns
  // may be un-migrated → retry the core `base` row; (c) the `version` column may be un-migrated →
  // fall back to a plain upsert.
  const stripTeam = (row) => { const { team_id, ...rest } = row; return rest; };
  const libColMiss = (e) => !!e && /column|project_id|doc_date|revision|item|schema cache/i.test(e) && !/version/i.test(e) && !/team_id/i.test(e);
  const expected = reviewVersions[record.id];
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
    if (!error) writeDraft(uid, data);
    return { ok: !error, error: error ? error.message : null };
  }
  if (r.conflict) return { ok: false, conflict: true }; // another session advanced this review — caller prompts a reload
  if (r.ok) { reviewVersions[record.id] = r.version; writeDraft(uid, data); return { ok: true }; }
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
  const data = { ...record, schemaVersion: REVIEW_SCHEMA };
  const row = {
    id: record.id,
    title: record.title || null, kind: record.kind || null,
    project: record.project || null, discipline: record.discipline || null,
    team_id: record.teamId || null,
    updated_at: new Date(record.updatedAt || Date.now()).toISOString(),
    data,
  };
  return keepaliveCasPush({ url, anon, token, table: "doc_reviews", id: record.id, row, expected: reviewVersions[record.id] });
}

// The full serialized review (the `data` jsonb), or null. RLS scopes to the user.
export async function loadReview(id) {
  if (!supabase || !id) return null;
  let { data, error } = await supabase.from("doc_reviews").select("data, version, team_id").eq("id", id).maybeSingle();
  if (error && isMissingColumn(error, "team_id")) // team-sharing migration not run → drop team_id
    ({ data, error } = await supabase.from("doc_reviews").select("data, version").eq("id", id).maybeSingle());
  if (error && isMissingVersionColumn(error)) // pre-migration → re-select without version
    ({ data, error } = await supabase.from("doc_reviews").select("data").eq("id", id).maybeSingle());
  if (error || !data) return null;
  if (data.version != null) reviewVersions[id] = data.version; // remember it for the next save's CAS guard (B314)
  const rec = data.data || null;
  // Overlay the authoritative team_id column so a subsequent save preserves the share (the
  // record's own field can lag); null = private.
  if (rec && "team_id" in data) rec.teamId = data.team_id || null;
  return rec;
}

// Lightweight list for the picker / library (no heavy `data` payload). Falls back to
// the core columns if the library migration hasn't run yet (so the picker still works).
export async function listReviews() {
  if (!supabase || !(await currentUid())) return [];
  // `placed:data->placed` pulls just the on-map flag out of the data jsonb (NOT the whole
  // heavy payload) so the drawer's Filed/On-map badge can reflect it (NEW-3). `sfile`/`folderId`
  // (B685/B686) likewise pull the authoritative source filename + explicit folder pick out of
  // `data` so the Library classifies type + places the file without re-reading the record. On any
  // error we fall back to the core columns — those extras degrade to absent, never a regression.
  let res = await supabase.from("doc_reviews")
    .select("id,title,kind,project,project_id,discipline,item,revision,doc_date,team_id,user_id,updated_at,placed:data->placed,sfile:data->>sourceFile,folderId:data->>folderId")
    .order("updated_at", { ascending: false });
  // team_id/user_id may be un-migrated → drop to the prior column set; then the older core set.
  if (res.error) res = await supabase.from("doc_reviews")
    .select("id,title,kind,project,project_id,discipline,item,revision,doc_date,updated_at,placed:data->placed")
    .order("updated_at", { ascending: false });
  if (res.error) res = await supabase.from("doc_reviews").select("id,title,kind,project,discipline,updated_at").order("updated_at", { ascending: false });
  return res.error || !res.data ? [] : res.data;
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

export async function deleteReview(id) {
  if (!supabase || !id) return { ok: false };
  delete reviewVersions[id]; // stop tracking a removed review's version (B314)
  const uid = await currentUid();
  // Remove the source files (by their stored keys, so any path scheme is covered),
  // then the row. RLS scopes both stores to the owner. Track cleanup failures so the caller
  // can surface "some bytes may be orphaned" (NEW-4) — the row delete stays authoritative, so
  // this is a non-blocking notice, not data loss.
  let orphaned = 0;      // # source files whose byte-cleanup didn't confirm
  let cleanupErr = false; // an unexpected throw during cleanup
  try {
    // Prefer the cloud record; if the network read misses, fall back to the local mirror so
    // we can still clean up Storage + Drive instead of orphaning bytes (B321/NEW-1).
    let rec = await loadReview(id);
    if (!rec && uid) rec = readDraft(uid, id);
    const srcs = (rec && rec.sources) || [];
    const keys = srcs.map((s) => s.storageKey).filter(Boolean);
    if (keys.length) { const { error: rmErr } = await supabase.storage.from(BUCKET).remove(keys); if (rmErr) orphaned += keys.length; }
    // Also remove the Google Drive copy (B207) so a Drive-only file doesn't orphan bytes
    // in Drive when its review is deleted. Best-effort, in parallel; never blocks the row.
    const driveKeys = srcs.map((s) => s.driveKey).filter(Boolean);
    if (driveKeys.length) {
      const results = await Promise.allSettled(driveKeys.map((k) => deleteFromDrive(k)));
      orphaned += results.filter((rr) => rr.status !== "fulfilled" || rr.value !== true).length;
    }
    if (uid) { // back-compat: also clear any legacy <uid>/<reviewId>/ folder
      const { data: files } = await supabase.storage.from(BUCKET).list(`${uid}/${id}`);
      if (files && files.length) { const { error: legErr } = await supabase.storage.from(BUCKET).remove(files.map((f) => `${uid}/${id}/${f.name}`)); if (legErr) orphaned += files.length; }
    }
  } catch (_) { cleanupErr = true; }
  // Scope by id only; RLS decides (own review OR team-admin on a shared one). A user_id filter
  // would block an admin from deleting a teammate's shared review, which the policy permits.
  const { error } = await supabase.from("doc_reviews").delete().eq("id", id);
  // B579: clear the localStorage mirror only AFTER the cloud delete succeeds. Clearing it first
  // (the old order) meant a failed delete (network/auth) left the cloud row alive but the local
  // mirror gone → the row stayed in the library yet could no longer auto-resume; keep them in
  // step so a failed delete leaves a fully consistent, retry-able state.
  if (!error && uid) clearDraft(uid, id);
  const cleanupFailed = orphaned > 0 || cleanupErr;
  return { ok: !error, error: error ? error.message : null, orphaned: orphaned || undefined, cleanupFailed: cleanupFailed || undefined };
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
export async function listProjects() {
  if (!supabase || !(await currentUid())) return [];
  // Prefer the richest select (status + team_id); degrade if either column isn't migrated in.
  let res = await supabase.from("sites").select("group_id,site,updated_at,team_id,status:data->>status").order("updated_at", { ascending: false });
  if (res.error) res = await supabase.from("sites").select("group_id,site,updated_at,status:data->>status").order("updated_at", { ascending: false });
  if (res.error) res = await supabase.from("sites").select("group_id,site,updated_at").order("updated_at", { ascending: false }); // tolerate older PostgREST
  const { data } = res;
  if (!data) return [];
  const byId = new Map();
  for (const r of data) {
    const id = r.group_id;
    if (!id) continue;
    if (!byId.has(id)) // newest row wins for the name/status
      byId.set(id, { id, name: r.site || "Untitled site", status: STATUSES.includes(r.status) ? r.status : "unknown", teamId: r.team_id || null });
    else if (r.team_id && !byId.get(id).teamId) byId.get(id).teamId = r.team_id; // any shared plan ⇒ project is shared
  }
  return [...byId.values()];
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
  // teammate edit of a shared row won't re-stamp the owner. team_id carries the share (null =
  // private); category/state are the Work Item B index columns. onConflict = the PK "id" (post the
  // phase-2 migration). Degrade gracefully if any optional column (team_id / category / state) or
  // the old composite PK isn't where we expect, so indexing never regresses on a partial migration.
  const { teamId, team_id: t0, ...rest } = row;
  const payload = { ...rest, team_id: teamId || t0 || null };
  const core = () => { const { team_id, category, state, ...c } = payload; return c; };
  let { error } = await supabase.from("file_facts").upsert(payload, { onConflict: "id" });
  if (error && /team_id|category|state|column|schema cache/i.test(error.message || ""))
    ({ error } = await supabase.from("file_facts").upsert(core(), { onConflict: "id" }));
  if (error && /on conflict|no unique|constraint|exclusion/i.test(error.message || "")) // pre-PK-change: target is (user_id,id)
    ({ error } = await supabase.from("file_facts").upsert({ ...core(), user_id: uid }, { onConflict: "user_id,id" }));
  return { ok: !error, error: error ? error.message : null };
}

const FILE_FACTS_CORE = "id,review_id,project_id,discipline,item,sheet_number,sheet_title,revision,doc_date,source_file,match_confidence,needs_filing,placement,updated_at";
export async function listFileFacts() {
  if (!supabase || !(await currentUid())) return [];
  let { data, error } = await supabase.from("file_facts")
    .select(FILE_FACTS_CORE + ",team_id,category,state")
    .order("updated_at", { ascending: false });
  if (error) // an optional column (team_id / category / state) isn't migrated in → read the core set
    ({ data, error } = await supabase.from("file_facts").select(FILE_FACTS_CORE).order("updated_at", { ascending: false }));
  return error || !data ? [] : data;
}

/* Push a file's bytes to Google Drive via the /server files API (B207 wiring). Returns
 * { ok, driveKey } on success (driveKey = the stable key to read it back with),
 * { ok:false, skipped:true } when Drive isn't enabled yet, or { ok:false, error }.
 * Best-effort — never throws. */
export async function pushFileToDrive(file, { projectId = null, discipline = "Other", fileName, folderId = null } = {}) {
  if (!supabase) return { ok: false, skipped: true, error: "Cloud not configured." };
  let token = null;
  try { const { data } = await supabase.auth.getSession(); token = data && data.session && data.session.access_token; } catch (_) { /* none */ }
  if (!token) return { ok: false, skipped: true, error: "Not signed in." };
  const folder = `project-${projectId ? slug(projectId) : "unfiled"}/${slug(discipline)}`;
  const name = fileName || "document.pdf";
  const driveKey = `${folder}/${name}`; // the key the read-back GET uses (server prefixes the uid)
  try {
    const resp = await fetch("/api/files", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": guessContentType(name, file.type),
        "x-planyr-key": driveKey, "x-planyr-folder": folder, "x-planyr-name": name,
        // Tree targeting (B650 follow-on): the server files the bytes into the project's
        // standard folder tree (Design → Drawings → discipline → Current) when it's mirrored;
        // the flat x-planyr-folder path above stays the fallback, so nothing regresses.
        ...(projectId ? { "x-planyr-project": String(projectId) } : {}),
        // Explicit folder pick (B686): the user dropped into a folder they clicked → the server
        // files the bytes into THAT folder's Drive folder, overriding the discipline route.
        ...(folderId ? { "x-planyr-folder-id": String(folderId) } : {}),
        "x-planyr-discipline": headerSafe(discipline) },
      body: file,
    });
    if (resp.status === 404 || resp.status === 503) return { ok: false, skipped: true, error: "Drive not enabled yet." };
    let jr = {}; try { jr = await resp.json(); } catch (_) { /* ignore */ }
    return resp.ok && jr.ok ? { ok: true, driveKey } : { ok: false, error: jr.error || `HTTP ${resp.status}` };
  } catch (e) { return { ok: false, error: (e && e.message) || "Network error." }; }
}

/* Upload a LARGE file (> the Supabase per-file cap) straight to Google Drive, bypassing the
 * Cloudflare Worker entirely (B409). pushFileToDrive() above POSTs the whole file through the
 * Pages Function, which buffers it (request.arrayBuffer) and Drive-creates it with
 * uploadType=multipart — Google's ≤5 MB path — so it's capped by the Worker's ~100 MB body
 * limit + 128 MB memory and a real E-size civil set (100 MB+) silently fails. Here the server
 * only MINTS a resumable session; the browser PUTs the bytes DIRECTLY to Google (cross-origin),
 * so neither limit applies (multi-GB works). Mirrors pushFileToDrive's return:
 * { ok, driveKey } | { ok:false, skipped:true, error } | { ok:false, error }. Never throws. */
export async function uploadLargeToDrive(file, { projectId = null, discipline = "Other", fileName, folderId = null } = {}) {
  if (!supabase) return { ok: false, skipped: true, error: "Cloud not configured." };
  let token = null;
  try { const { data } = await supabase.auth.getSession(); token = data && data.session && data.session.access_token; } catch (_) { /* none */ }
  if (!token) return { ok: false, skipped: true, error: "Not signed in." };
  const folder = `project-${projectId ? slug(projectId) : "unfiled"}/${slug(discipline)}`;
  const name = fileName || "document.pdf";
  const driveKey = `${folder}/${name}`; // the key the read-back GET uses (server prefixes the uid)
  const contentType = guessContentType(name, file.type);
  try {
    // 1) INIT — server mints a resumable session bound to this origin (for the cross-origin PUT).
    const initResp = await fetch("/api/files/resumable", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "x-planyr-key": driveKey, "x-planyr-folder": folder,
        "x-planyr-name": name, "x-planyr-content-type": contentType, "x-planyr-size": String(file.size || 0),
        // Tree targeting (B650 follow-on) — same as pushFileToDrive; flat path stays the fallback.
        ...(projectId ? { "x-planyr-project": String(projectId) } : {}),
        ...(folderId ? { "x-planyr-folder-id": String(folderId) } : {}), // explicit folder pick wins (B686)
        "x-planyr-discipline": headerSafe(discipline) },
    });
    if (initResp.status === 404 || initResp.status === 503) return { ok: false, skipped: true, error: "Drive not enabled yet." };
    let init = {}; try { init = await initResp.json(); } catch (_) { /* ignore */ }
    if (!initResp.ok || !init.ok || !init.uploadUri) return { ok: false, error: init.error || `HTTP ${initResp.status}` };
    // 2) PUT the bytes STRAIGHT to Google — never through the Worker, so no body/memory limit.
    const putResp = await fetch(init.uploadUri, { method: "PUT", headers: { "content-type": contentType }, body: file });
    if (!putResp.ok) return { ok: false, error: `Drive upload didn’t finish (HTTP ${putResp.status}).` };
    let meta = {}; try { meta = await putResp.json(); } catch (_) { /* ignore */ }
    if (!meta.id) return { ok: false, error: "Drive upload returned no file id." };
    // 3) COMMIT — server records the key ↔ Drive-id mapping so the file reads back later.
    const commitResp = await fetch("/api/files/resumable", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ planyrKey: driveKey, fileId: meta.id, name }),
    });
    let commit = {}; try { commit = await commitResp.json(); } catch (_) { /* ignore */ }
    if (!commitResp.ok || !commit.ok) return { ok: false, error: commit.error || "Couldn’t record the Drive file." };
    return { ok: true, driveKey };
  } catch (e) { return { ok: false, error: (e && e.message) || "Network error." }; }
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

// File a dropped PDF as a new (single-sheet) review under a project/discipline. Drive is
// the home: push there first; only fall back to Supabase Storage if Drive didn't take it,
// so a file is never left unstored AND the redundant Supabase copy stops consuming storage
// on the happy path. Then upsert the indexed record. Returns { ok, id }.
export async function fileNewReview({ projectId = null, project = "", discipline = "Other", item = "", docDate = null, blob, fileName, folderId = null }) {
  if (!(await cloudReady())) return { ok: false, error: "Sign in to file documents." };
  const id = newReviewId();
  const srcId = newSourceId();
  // Use the drawing's own date when auto-filing supplies one (YYYY-MM-DD); else today.
  const filedDate = (typeof docDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(docDate)) ? docDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const itemLabel = item || stripFileExt(fileName || "Document");
  // Store the bytes Drive-first, Supabase-fallback (the one shared policy — see storeSource).
  const stored = blob
    ? await storeSource(srcId, blob, { projectId, discipline, fileName, folderId })
    : { ok: false, storageKey: null, driveKey: null, oversize: false, driveError: null, driveSkipped: true };
  // Unstored only if NEITHER backend took it (and it wasn't merely oversize for Supabase).
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

/* Store ONE interactively-opened source PDF (the "Open PDF…" single sheet and every Stitcher
 * sheet) the same way filing does: Google Drive is the primary home, Supabase Storage the
 * fallback — so these files (a) live in Drive like filed ones and (b) bypass Supabase's 50 MB
 * per-file cap (the cap otherwise silently flagged big E-size drawings "oversize"). Files OVER
 * that cap take the browser-direct resumable path (uploadLargeToDrive, B409) so their bytes
 * skip the Cloudflare Worker's body/memory limits; smaller files keep the proven multipart
 * path. Returns { ok, storageKey, driveKey, oversize, large, driveError, driveSkipped }.
 * Never throws. (B322/NEW-2; B409 large-file path.) */
export async function storeSource(srcId, blob, { projectId = null, discipline = "Other", fileName, folderId = null } = {}) {
  // A file over the Supabase cap can't go through the Worker AND Supabase rejects it as
  // "oversize" — so route it straight to Drive (B409). If that path is unavailable it falls back
  // to the Supabase attempt (still flags oversize), so behaviour is never worse than before.
  const isLarge = !!(blob && blob.size > MAX_BYTES);
  const drive = blob
    ? (isLarge ? await uploadLargeToDrive(blob, { projectId, discipline, fileName, folderId })
               : await pushFileToDrive(blob, { projectId, discipline, fileName, folderId }))
    : { ok: false, skipped: true };
  if (drive.ok) return { ok: true, storageKey: null, driveKey: drive.driveKey, oversize: false, large: isLarge, driveError: null, driveSkipped: false };
  const up = await uploadSource(srcId, blob, projectId, discipline);
  return { ok: up.ok, storageKey: up.storageKey || null, driveKey: null, oversize: !!up.oversize, large: isLarge,
    driveError: drive.skipped ? null : (drive.error || null), driveSkipped: !!drive.skipped };
}

// Upload one source PDF. Returns { ok, oversize, storageKey, error }. A file over
// the free-tier cap is NOT uploaded (oversize:true, no key) so the caller can still
// save the work layer and flag the file "re-drop on load".
export async function uploadSource(srcId, blob, projectId, discipline) {
  if (!supabase) return { ok: false, error: "Cloud not configured." };
  const uid = await currentUid();
  if (!uid) return { ok: false, error: "Sign in to save." };
  if (!blob) return { ok: false, error: "No file bytes." };
  if (blob.size > MAX_BYTES) return { ok: false, oversize: true, storageKey: null };
  const key = storageKeyFor(uid, projectId, discipline, srcId);
  const { error } = await supabase.storage.from(BUCKET).upload(key, blob, {
    contentType: guessContentType(blob && blob.name, blob && blob.type), upsert: true,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, oversize: false, storageKey: key };
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
