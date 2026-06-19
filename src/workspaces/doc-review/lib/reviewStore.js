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
import { supabase } from "../../site-planner/lib/supabase.js";
import { getUser } from "../../site-planner/lib/auth.js";
import { cloudUpsert } from "../../site-planner/lib/cloudSync.js";
import { STATUSES, STATUS_META, statusOf } from "../../site-planner/lib/siteModel.js";

export const BUCKET = "doc-review-files";
export const MAX_BYTES = 50 * 1024 * 1024; // Supabase free-tier per-file upload limit
export const REVIEW_SCHEMA = 1;

// Filing taxonomy. Disciplines are a fixed set (the library's drag-drop folders);
// project lifecycle status is REUSED from the Site Model so both workspaces agree on
// one source of truth (sites.data ->> status).
export const DISCIPLINES = ["Survey", "Civil", "Architectural", "Landscape", "Environmental", "CAD", "Geotech", "Other"];
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
  const head = [project, item].map((s) => (s || "").trim()).filter(Boolean).join(" - ") || "Untitled";
  const date = fmtDocDate(docDate);
  return date ? `${head} - ${date}` : head;
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
const storageKeyFor = (uid, projectId, discipline, srcId) =>
  `${uid}/project-${projectId ? slug(projectId) : "unfiled"}/${discipline ? slug(discipline) : "other"}/${srcId}.pdf`;

/* ------------------------- review records (Postgres) ------------------------ */

export async function upsertReview(record) {
  if (!supabase) return { ok: false, error: "Cloud not configured." };
  const uid = await currentUid();
  if (!uid) return { ok: false, error: "Sign in to save." };
  if (!record || !record.id) return { ok: false, error: "Review has no id." };
  const data = { ...record, schemaVersion: REVIEW_SCHEMA };
  // Core columns (exist since the first persistence migration) + the data jsonb, which
  // always carries every field (incl. the library ones). The library index columns are
  // added on top; if that migration hasn't run yet we fall back to the core row so
  // saving never regresses — the new fields still round-trip through `data`.
  const base = {
    id: record.id, user_id: uid,
    title: record.title || null,
    kind: record.kind || null,
    project: record.project || null,
    discipline: record.discipline || null,
    updated_at: new Date(record.updatedAt || Date.now()).toISOString(),
    data,
  };
  const full = { ...base, project_id: record.projectId || null, item: record.item || null, revision: record.revision || null, doc_date: record.docDate || null };
  let { error } = await supabase.from("doc_reviews").upsert(full, { onConflict: "user_id,id" });
  if (error && /column|project_id|doc_date|revision|item|schema cache/i.test(error.message || ""))
    ({ error } = await supabase.from("doc_reviews").upsert(base, { onConflict: "user_id,id" }));
  if (!error) writeDraft(uid, data); // keep the local mirror in lockstep with the cloud
  return { ok: !error, error: error ? error.message : null };
}

// The full serialized review (the `data` jsonb), or null. RLS scopes to the user.
export async function loadReview(id) {
  if (!supabase || !id) return null;
  const { data, error } = await supabase.from("doc_reviews").select("data").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data.data || null;
}

// Lightweight list for the picker / library (no heavy `data` payload). Falls back to
// the core columns if the library migration hasn't run yet (so the picker still works).
export async function listReviews() {
  if (!supabase || !(await currentUid())) return [];
  let res = await supabase.from("doc_reviews")
    .select("id,title,kind,project,project_id,discipline,item,revision,doc_date,updated_at")
    .order("updated_at", { ascending: false });
  if (res.error) res = await supabase.from("doc_reviews").select("id,title,kind,project,discipline,updated_at").order("updated_at", { ascending: false });
  return res.error || !res.data ? [] : res.data;
}

export async function deleteReview(id) {
  if (!supabase || !id) return { ok: false };
  const uid = await currentUid();
  // Remove the source files (by their stored keys, so any path scheme is covered),
  // then the row. RLS scopes both stores to the owner.
  try {
    const rec = await loadReview(id);
    const keys = ((rec && rec.sources) || []).map((s) => s.storageKey).filter(Boolean);
    if (keys.length) await supabase.storage.from(BUCKET).remove(keys);
    if (uid) { // back-compat: also clear any legacy <uid>/<reviewId>/ folder
      const { data: files } = await supabase.storage.from(BUCKET).list(`${uid}/${id}`);
      if (files && files.length) await supabase.storage.from(BUCKET).remove(files.map((f) => `${uid}/${id}/${f.name}`));
    }
  } catch (_) {}
  if (uid) clearDraft(uid, id);
  const { error } = await supabase.from("doc_reviews").delete().eq("user_id", uid).eq("id", id); // scope by owner (defense-in-depth, matches cloudDelete)
  return { ok: !error, error: error ? error.message : null };
}

// Re-file an existing review under a (different) project/discipline — the one-click
// confirm out of the "needs filing" holding area (B189). Loads the full record, updates
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
  let res = await supabase.from("sites").select("group_id,site,updated_at,status:data->>status").order("updated_at", { ascending: false });
  if (res.error) res = await supabase.from("sites").select("group_id,site,updated_at").order("updated_at", { ascending: false }); // tolerate older PostgREST
  const { data } = res;
  if (!data) return [];
  const byId = new Map();
  for (const r of data) {
    const id = r.group_id;
    if (!id || byId.has(id)) continue; // newest row wins for the name/status
    byId.set(id, { id, name: r.site || "Untitled site", status: STATUSES.includes(r.status) ? r.status : "unknown" }); // don't claim "active" when status is missing or the read fell back to the no-status query (B35)
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

// File a dropped PDF as a new (single-sheet) review under a project/discipline: upload
// the bytes, then upsert the indexed record. Returns { ok, id }.
export async function fileNewReview({ projectId = null, project = "", discipline = "Other", item = "", blob, fileName }) {
  if (!(await cloudReady())) return { ok: false, error: "Sign in to file documents." };
  const id = newReviewId();
  const srcId = newSourceId();
  const up = await uploadSource(srcId, blob, projectId, discipline);
  const docDate = new Date().toISOString().slice(0, 10);
  const itemLabel = item || (fileName || "Document").replace(/\.pdf$/i, "");
  // A non-oversize upload failure (network / RLS / transient 5xx) still files the work layer, but
  // the bytes weren't stored — surface it so the caller can warn, rather than silently filing a
  // document that can't be opened until it's re-dropped (storageKey stays null → re-drop on load).
  const uploadFailed = !up.ok && !up.oversize;
  const record = {
    id, kind: "single", title: composeTitle({ project, item: itemLabel, docDate }),
    project, projectId, discipline, item: itemLabel, revision: "", docDate,
    sources: [{ srcId, name: fileName || "document.pdf", size: blob ? blob.size : 0, storageKey: up.storageKey || null, oversize: !!up.oversize }],
    single: { srcId, fileName: fileName || "document.pdf", numPages: 0, page: 1, markups: [], calByPage: {} },
  };
  const res = await upsertReview({ ...record, updatedAt: Date.now() });
  return { ok: res.ok, id, error: res.error, uploadFailed, oversize: !!up.oversize, name: fileName || "document.pdf" };
}

/* --------------------------- source PDFs (Storage) -------------------------- */

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
    contentType: "application/pdf", upsert: true,
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
