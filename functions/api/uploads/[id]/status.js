/* GET /api/uploads/<id>/status — resume point for a dropped upload (B409 rework).
 *
 * Asks Google Drive how many bytes it ACTUALLY has (a zero-byte probe against the stored
 * session URI), so the browser can continue a 125 MB upload from where it broke instead
 * of restarting. → { ok, received } or { ok, received, complete: true }. The probe also
 * repairs our bookkeeping: if Drive says "finished" (e.g. the final chunk's DB write
 * missed), the row is marked complete here so /complete can proceed.
 */
import { probeSession } from "../../../../server/uploads/resumableProxy.js";
import { json, uploadContext, ownSession } from "../_common.js";

export async function onRequestGet(context) {
  const { env, request, params } = context;
  const c = await uploadContext(env, request);
  if (c.error) return c.error;
  const s = await ownSession(c, params && params.id);
  if (s.error) return s.error;
  const session = s.session;
  const total = Number(session.total_bytes);

  // Already recorded complete → answer from the row (no Drive round-trip needed).
  if (session.status === "complete") return json({ ok: true, received: total, complete: true });
  if (session.status !== "in_progress") return json({ ok: false, error: `This upload is ${session.status}.` }, 409);

  const r = await probeSession({ sessionUri: session.drive_session_uri, totalBytes: total });
  if (r.kind === "progress") {
    await c.store.update(session.id, { bytes_received: r.received }); // best-effort sync
    return json({ ok: true, received: r.received });
  }
  if (r.kind === "complete") {
    const up = await c.store.update(session.id, { drive_file_id: r.fileId, status: "complete", bytes_received: total });
    if (!up.ok) return json({ ok: false, error: "Drive has the file but recording it failed — please retry." }, 502);
    return json({ ok: true, received: total, complete: true });
  }
  if (r.sessionLost) await c.store.update(session.id, { status: "aborted" });
  return json({ ok: false, error: r.error, sessionLost: r.sessionLost || undefined }, r.status || 502);
}
