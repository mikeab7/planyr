/* Chunked file upload to Google Drive THROUGH the same-origin Worker proxy (B409 rework).
 *
 * Why this shape: three hard ceilings make any whole-file transfer impossible —
 * the Cloudflare Worker request-body cap (~100 MB), the Worker memory cap (128 MB, so it
 * can't buffer a big file), and Supabase Storage's 50 MB free-tier per-file cap. And the
 * obvious dodge — browser → Google directly — is CORS-dead: the browser can't read the
 * resumable session's Location header, and Google's upload endpoint answers preflights
 * with no Access-Control-Allow-Origin (B409's first attempt shipped exactly that and
 * could never work). So the bytes go in ~16 MB slices to OUR origin, and the Worker
 * relays each slice to the Drive resumable session it holds server-side. No single HTTP
 * request is ever large → every cap clears → file size is effectively unbounded.
 *
 *   POST /api/uploads/start        → { uploadId, chunkSize }         (mints the Drive session)
 *   PUT  /api/uploads/<id>/chunk   → { received, complete? }         (relays one slice)
 *   GET  /api/uploads/<id>/status  → { received, complete? }         (resume point after a drop)
 *   POST /api/uploads/<id>/complete→ { planyrKey }                   (records the file mapping)
 *
 * Pure chunk math is exported for unit tests. The uploader slices with File.slice (never
 * reads the whole file into memory), sends chunks SEQUENTIALLY (Drive resumable requires
 * in-order byte ranges), retries a failed chunk up to 5× with exponential backoff, and
 * RESUMES from the server's byte count after a drop instead of restarting. Never throws.
 */

// 16 MiB — a multiple of 256 KiB (Google rejects any non-final chunk that isn't) with
// huge headroom under the Worker's ~100 MB request-body cap.
export const CHUNK_SIZE = 16 * 1024 * 1024;
export const DRIVE_CHUNK_GRANULE = 256 * 1024; // Google's required chunk granularity

// The Content-Range header for a slice [start, endExclusive) of a total-byte file:
// "bytes 0-16777215/125176019". End index is INCLUSIVE per RFC 7233.
export function contentRangeFor(start, endExclusive, total) {
  return `bytes ${start}-${endExclusive - 1}/${total}`;
}

/* Slice plan for a file: every chunk is `chunkSize` except a (possibly short) final one.
 * chunkSize must be a positive multiple of Google's 256 KiB granule — a bad size fails
 * loudly here rather than as a cryptic Drive 400 eleven chunks in. */
export function chunkPlan(totalBytes, chunkSize = CHUNK_SIZE) {
  if (!(chunkSize > 0) || chunkSize % DRIVE_CHUNK_GRANULE !== 0)
    throw new Error(`chunkSize must be a positive multiple of ${DRIVE_CHUNK_GRANULE} bytes.`);
  const chunks = [];
  for (let start = 0; start < totalBytes; start += chunkSize) {
    const end = Math.min(start + chunkSize, totalBytes);
    chunks.push({ start, end, last: end === totalBytes });
  }
  return chunks;
}

// Default backoff: 1s, 2s, 4s, 8s, 16s. Injectable so tests don't sleep.
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const backoffMs = (attempt) => Math.min(16_000, 1000 * 2 ** Math.max(0, attempt - 1));

const jsonOf = async (res) => { try { return await res.json(); } catch (_) { return {}; } };

// Google's "the Drive account is out of space" error, surfaced as plain English — the one
// failure retrying can never fix (Workspace Business Starter = 30 GB), so it short-circuits.
const QUOTA_RE = /storageQuotaExceeded|storage quota/i;
export const QUOTA_MESSAGE =
  "Google Drive is out of storage space — free up room in the connected Drive account and try again.";

/* Upload one file. Returns (never throws):
 *   { ok:true, driveKey }                 — bytes in Drive + mapping recorded
 *   { ok:false, skipped:true, error }     — Drive/storage backend not enabled (404/503)
 *   { ok:false, error }                   — a real, already-retried failure
 * `onProgress(sentBytes, totalBytes)` fires as the server confirms bytes (resume-accurate:
 * after a drop it continues from the server's count, and so does the progress bar). */
export async function uploadFileInChunks({
  file, token, planyrKey, name, contentType, projectId = null, discipline = null, folderId = null,
  onProgress = null, fetchImpl = fetch, sleep = defaultSleep, maxAttempts = 5,
} = {}) {
  if (!file || !token || !planyrKey) return { ok: false, error: "Missing file, session, or key." };
  const total = file.size;
  if (!(total > 0)) return { ok: false, error: "This file is empty or couldn’t be read." };
  const auth = { authorization: `Bearer ${token}` };
  const progress = (n) => { try { if (onProgress) onProgress(Math.min(n, total), total); } catch (_) { /* UI-only */ } };

  // 1) START — the server mints the Drive resumable session and keeps its URI; we only
  // ever hold the opaque uploadId.
  let start;
  try {
    const res = await fetchImpl("/api/uploads/start", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ fileName: name, mimeType: contentType, totalBytes: total, planyrKey, projectId, discipline, folderId }),
    });
    if (res.status === 404 || res.status === 503) return { ok: false, skipped: true, error: "Drive not enabled yet." };
    const jr = await jsonOf(res);
    if (!res.ok || !jr.ok || !jr.uploadId) return { ok: false, error: jr.error || `HTTP ${res.status}` };
    start = jr;
  } catch (e) { return { ok: false, error: (e && e.message) || "Network error." }; }
  const { uploadId } = start;
  const chunkSize = Number(start.chunkSize) || CHUNK_SIZE;
  progress(0);

  // Ask the server how many bytes Drive actually has — the resume point after a drop.
  const syncOffset = async () => {
    const res = await fetchImpl(`/api/uploads/${encodeURIComponent(uploadId)}/status`, { headers: auth });
    const jr = await jsonOf(res);
    if (!res.ok || !jr.ok) throw new Error(jr.error || `HTTP ${res.status}`);
    return { received: Number(jr.received) || 0, complete: !!jr.complete };
  };

  // 2) CHUNKS — sequential, in order; on any failure back off, re-sync the offset from the
  // server, and continue from there (a 125 MB upload resumes, never restarts).
  let offset = 0;
  let attempts = 0;
  let done = false;
  while (!done && offset < total) {
    const end = Math.min(offset + chunkSize, total);
    try {
      const res = await fetchImpl(`/api/uploads/${encodeURIComponent(uploadId)}/chunk`, {
        method: "PUT",
        headers: { ...auth, "content-type": "application/octet-stream", "content-range": contentRangeFor(offset, end, total) },
        body: file.slice(offset, end),
      });
      const jr = await jsonOf(res);
      if (!res.ok || !jr.ok) {
        if (QUOTA_RE.test(jr.error || "")) return { ok: false, error: QUOTA_MESSAGE }; // retrying can't fix a full Drive
        throw new Error(jr.error || `HTTP ${res.status}`);
      }
      const received = Number(jr.received) || 0;
      if (jr.complete) { offset = total; done = true; }
      else if (received > offset) offset = received;
      else throw new Error("The upload didn’t advance."); // a stuck offset must not loop forever
      attempts = 0; // a chunk landed — reset the retry budget for the next one
      progress(offset);
    } catch (e) {
      attempts += 1;
      if (attempts >= maxAttempts) return { ok: false, error: (e && e.message) || "Upload failed." };
      await sleep(backoffMs(attempts));
      try { const s = await syncOffset(); offset = s.received; if (s.complete) { offset = total; done = true; } progress(offset); }
      catch (_) { /* status probe failed too — the next loop retries the chunk from the last known offset */ }
    }
  }

  // 3) COMPLETE — the server records the Planyr-key ↔ Drive-id mapping (rolling back the
  // Drive file if the mapping write fails, so there's never a stored-but-unfindable file).
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const res = await fetchImpl(`/api/uploads/${encodeURIComponent(uploadId)}/complete`, { method: "POST", headers: auth });
      const jr = await jsonOf(res);
      if (res.ok && jr.ok) { progress(total); return { ok: true, driveKey: planyrKey }; }
      if (res.status >= 400 && res.status < 500) return { ok: false, error: jr.error || `HTTP ${res.status}` }; // no point retrying a rejection
      throw new Error(jr.error || `HTTP ${res.status}`);
    } catch (e) {
      if (i >= maxAttempts) return { ok: false, error: (e && e.message) || "Couldn’t record the uploaded file." };
      await sleep(backoffMs(i));
    }
  }
  return { ok: false, error: "Couldn’t record the uploaded file." };
}
