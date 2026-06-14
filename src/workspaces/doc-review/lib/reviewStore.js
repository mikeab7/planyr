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

export const BUCKET = "doc-review-files";
export const MAX_BYTES = 50 * 1024 * 1024; // Supabase free-tier per-file upload limit
export const REVIEW_SCHEMA = 1;

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

const storageKeyFor = (uid, reviewId, srcId) => `${uid}/${reviewId}/${srcId}.pdf`;

/* ------------------------- review records (Postgres) ------------------------ */

export async function upsertReview(record) {
  if (!supabase) return { ok: false, error: "Cloud not configured." };
  const uid = await currentUid();
  if (!uid) return { ok: false, error: "Sign in to save." };
  if (!record || !record.id) return { ok: false, error: "Review has no id." };
  const data = { ...record, schemaVersion: REVIEW_SCHEMA };
  const row = {
    id: record.id, user_id: uid,
    title: record.title || null,
    kind: record.kind || null,
    project: record.project || null,
    discipline: record.discipline || null,
    updated_at: new Date(record.updatedAt || Date.now()).toISOString(),
    data,
  };
  const { error } = await supabase.from("doc_reviews").upsert(row, { onConflict: "user_id,id" });
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

// Lightweight list for the picker (no heavy `data` payload).
export async function listReviews() {
  if (!supabase || !(await currentUid())) return [];
  const { data, error } = await supabase
    .from("doc_reviews")
    .select("id,title,kind,project,discipline,updated_at")
    .order("updated_at", { ascending: false });
  return error || !data ? [] : data;
}

export async function deleteReview(id) {
  if (!supabase || !id) return { ok: false };
  const uid = await currentUid();
  // Best-effort: remove the review's source files first (RLS scopes both stores).
  try {
    if (uid) {
      const { data: files } = await supabase.storage.from(BUCKET).list(`${uid}/${id}`);
      if (files && files.length)
        await supabase.storage.from(BUCKET).remove(files.map((f) => `${uid}/${id}/${f.name}`));
    }
  } catch (_) {}
  if (uid) clearDraft(uid, id);
  const { error } = await supabase.from("doc_reviews").delete().eq("id", id);
  return { ok: !error, error: error ? error.message : null };
}

/* --------------------------- source PDFs (Storage) -------------------------- */

// Upload one source PDF. Returns { ok, oversize, storageKey, error }. A file over
// the free-tier cap is NOT uploaded (oversize:true, no key) so the caller can still
// save the work layer and flag the file "re-drop on load".
export async function uploadSource(reviewId, srcId, blob) {
  if (!supabase) return { ok: false, error: "Cloud not configured." };
  const uid = await currentUid();
  if (!uid) return { ok: false, error: "Sign in to save." };
  if (!blob) return { ok: false, error: "No file bytes." };
  if (blob.size > MAX_BYTES) return { ok: false, oversize: true, storageKey: null };
  const key = storageKeyFor(uid, reviewId, srcId);
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
