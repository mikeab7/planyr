/* Google Drive resumable-upload RELAY — the pure logic behind /api/uploads/* (B409 rework).
 *
 * The browser sends ~16 MB chunks to our own origin; the Pages Function forwards each one
 * to the Drive resumable session URI it holds server-side. This module owns the protocol
 * details so they're unit-tested without a Worker or Google:
 *
 *   - Content-Range parsing/validation (the client's "bytes a-b/total" per chunk);
 *   - Drive's reply mapping. THE trap: **308 "Resume Incomplete" is a SUCCESS signal**
 *     ("got that chunk, send the next"), not an error — and `res.ok` is false for a 308,
 *     so a generic ok-check would fail every intermediate chunk. Handled explicitly here.
 *   - The resume probe ("how many bytes do you actually have?") — a zero-byte PUT whose
 *     Content-Range is `bytes` + ` * / ` + `total` (no spaces; spaced here so the header
 *     doesn't end this comment).
 *
 * All network goes through an injectable fetchImpl. Results are plain discriminated
 * objects ({ kind: "progress" | "complete" | "error" }) — never throws on a Drive error.
 */

// 16 MiB = 64 × Google's required 256 KiB granularity; far under the Worker's ~100 MB
// request-body cap. The server is the single source of truth for this number — /start
// hands it to the browser, so client and relay can never disagree.
export const UPLOAD_CHUNK_SIZE = 16 * 1024 * 1024;

// Parse the CLIENT'S chunk header "bytes <start>-<end>/<total>" (end inclusive).
// Returns { start, end, total } or null on anything malformed.
export function parseContentRange(header) {
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(header || "").trim());
  if (!m) return null;
  const start = Number(m[1]), end = Number(m[2]), total = Number(m[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total)) return null;
  if (start > end || end >= total) return null;
  return { start, end, total };
}

// Parse DRIVE'S 308 progress header "Range: bytes=0-<lastByte>" into the count of bytes
// Drive holds (lastByte + 1). A 308 with no Range header means "nothing received yet" → 0.
export function parseDriveReceived(rangeHeader) {
  const m = /bytes=0-(\d+)/.exec(String(rangeHeader || ""));
  return m ? Number(m[1]) + 1 : 0;
}

// A readable error out of a Drive failure body. Keeps Google's `reason` code (e.g.
// storageQuotaExceeded) in the text so the client can recognize "Drive is full" and stop
// retrying — and so the failure names its cause instead of a bare status (LOUD-FAILURE).
export async function driveErrorText(res) {
  let msg = `Drive upload ${res.status}`;
  try {
    const j = await res.json();
    const e = j && j.error;
    if (e) {
      const reason = (Array.isArray(e.errors) && e.errors[0] && e.errors[0].reason) || "";
      msg = [e.message || msg, reason && `(${reason})`].filter(Boolean).join(" ");
    }
  } catch (_) { /* non-JSON body — keep the status text */ }
  return msg;
}

// Map one Drive reply (chunk PUT or probe) to a result. 308 = progress; 200/201 = the
// whole file landed (body carries the file resource, incl. its id).
async function mapDriveReply(res) {
  if (res.status === 308) return { kind: "progress", received: parseDriveReceived(res.headers.get("range")) };
  if (res.ok) {
    let j = null;
    try { j = await res.json(); } catch (_) { /* fall through */ }
    if (j && j.id) return { kind: "complete", fileId: j.id };
    return { kind: "error", status: 502, error: "Drive finished the upload but returned no file id." };
  }
  // 404/410 = the resumable session itself is gone (they expire after ~1 week) — a
  // distinct, restartable condition, not a retry-the-chunk one.
  if (res.status === 404 || res.status === 410)
    return { kind: "error", status: 410, error: "The upload session expired — start the upload again.", sessionLost: true };
  return { kind: "error", status: 502, error: await driveErrorText(res) };
}

/* Forward one chunk to the Drive session. `bytes` is the single already-read chunk body
 * (≤ one chunk is ever buffered); contentRange is the client's validated header, passed
 * through verbatim — the byte math is the client's, the relay just must not distort it. */
export async function relayChunk({ sessionUri, bytes, contentRange, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(sessionUri, { method: "PUT", headers: { "content-range": contentRange }, body: bytes });
  } catch (e) {
    return { kind: "error", status: 502, error: `Couldn't reach Google Drive: ${(e && e.message) || e}` };
  }
  return mapDriveReply(res);
}

// Ask Drive how much of the upload it actually has (resume support): a zero-byte PUT
// with Content-Range "bytes */<total>". 308 + Range = partial; 200/201 = already done.
export async function probeSession({ sessionUri, totalBytes, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(sessionUri, { method: "PUT", headers: { "content-range": `bytes */${totalBytes}` } });
  } catch (e) {
    return { kind: "error", status: 502, error: `Couldn't reach Google Drive: ${(e && e.message) || e}` };
  }
  return mapDriveReply(res);
}
