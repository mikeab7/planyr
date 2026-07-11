/* PUT /api/uploads/<id>/chunk — relay one ~16 MB slice to Google Drive (B409 rework).
 *
 * Body: the raw chunk bytes. Header: Content-Range "bytes <start>-<end>/<total>".
 * → { ok, received }                    while Drive wants more (Drive replied 308)
 * → { ok, received, complete: true }    when the final chunk landed (Drive replied 200/201)
 *
 * Exactly ONE chunk is ever in memory (~16 MB against the Worker's 128 MB) and no request
 * exceeds ~16 MB (against the ~100 MB body cap) — that's the whole trick that makes total
 * file size unbounded. Ownership is enforced by loading the session through the caller's
 * token (RLS): a guessed/foreign uploadId is a 404 before a single byte is read (B491).
 */
import { parseContentRange, relayChunk } from "../../../../server/uploads/resumableProxy.js";
import { json, uploadContext, ownSession } from "../_common.js";

// Hard backstop on a single chunk request body: the client's chunk is 16 MiB; anything
// far bigger is a misbehaving caller and would erode the Worker-memory headroom.
const MAX_CHUNK_BODY = 64 * 1024 * 1024;

export async function onRequestPut(context) {
  const { env, request, params } = context;
  const c = await uploadContext(env, request);
  if (c.error) return c.error;
  const s = await ownSession(c, params && params.id);
  if (s.error) return s.error;
  const session = s.session;
  if (session.status !== "in_progress") return json({ ok: false, error: `This upload is ${session.status}.` }, 409);

  const range = parseContentRange(request.headers.get("content-range"));
  if (!range) return json({ ok: false, error: 'Missing or malformed Content-Range (expected "bytes a-b/total").' }, 400);
  if (range.total !== Number(session.total_bytes))
    return json({ ok: false, error: `Content-Range total (${range.total}) doesn't match this upload (${session.total_bytes}).` }, 400);
  // Deliberately NO start-vs-bytes_received ordering check here: bytes_received is best-effort
  // bookkeeping (the PATCH below may miss), and an ordering guard against a stale row would 400
  // a perfectly ordered chunk — bricking a healthy upload (adversarial-review finding). Drive
  // validates offsets AUTHORITATIVELY: an out-of-order or overlapping PUT gets a 308 carrying
  // the true cumulative Range, which flows back to the client as { received } to re-sync on.

  // Read the ONE chunk (bounded; the only buffering in the whole pipeline).
  const len = Number(request.headers.get("content-length"));
  if (Number.isFinite(len) && len > MAX_CHUNK_BODY) return json({ ok: false, error: "Chunk too large." }, 413);
  let bytes;
  try { bytes = await request.arrayBuffer(); } catch (_) { return json({ ok: false, error: "Couldn't read the chunk body." }, 400); }
  if (bytes.byteLength > MAX_CHUNK_BODY) return json({ ok: false, error: "Chunk too large." }, 413);
  if (bytes.byteLength !== range.end - range.start + 1)
    return json({ ok: false, error: `Chunk body is ${bytes.byteLength} bytes but Content-Range spans ${range.end - range.start + 1}.` }, 400);

  const r = await relayChunk({ sessionUri: session.drive_session_uri, bytes, contentRange: request.headers.get("content-range") });

  if (r.kind === "progress") {
    // Progress bookkeeping is best-effort: Drive holds the truth and /status re-syncs, so
    // a missed write here can slow a resume but never lose bytes.
    await c.store.update(session.id, { bytes_received: r.received });
    return json({ ok: true, received: r.received });
  }
  if (r.kind === "complete") {
    // This write is NOT best-effort — /complete refuses until the row says complete. If it
    // misses, we fail honestly; the client's retry re-probes Drive (which answers 200 for
    // a finished session) and the status route records it then.
    const up = await c.store.update(session.id, { drive_file_id: r.fileId, status: "complete", bytes_received: Number(session.total_bytes) });
    if (!up.ok) return json({ ok: false, error: "Drive has the file but recording it failed — please retry." }, 502);
    return json({ ok: true, received: Number(session.total_bytes), complete: true });
  }
  if (r.sessionLost) await c.store.update(session.id, { status: "aborted" }); // dead at Google — un-resumable
  return json({ ok: false, error: r.error, sessionLost: r.sessionLost || undefined }, r.status || 502);
}
