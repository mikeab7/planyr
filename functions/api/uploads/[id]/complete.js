/* POST /api/uploads/<id>/complete — record the finished upload so it reads back (B409 rework).
 *
 * The Drive bytes are in; this writes the Planyr-key ↔ Drive-id mapping (public.drive_files,
 * the same index every download/share/delete resolves through) and retires the session row.
 * → { ok, planyrKey }.
 *
 * NEW-4 guard (same as the old commit path, kept verbatim in spirit — see V191): if the
 * mapping write FAILS, the file would exist in Drive but read back as "missing" while the
 * upload looked like a success. So the just-uploaded Drive file is deleted (best-effort
 * rollback) and the request fails honestly; the client retries the whole upload.
 */
import { defaultDriveClientFactory } from "../../../../server/storage/index.js";
import { supabaseIdStore } from "../../../../server/storage/idStoreSupabase.js";
import { json, uploadContext, ownSession } from "../_common.js";

export async function onRequestPost(context) {
  const { env, request, params } = context;
  const c = await uploadContext(env, request);
  if (c.error) return c.error;
  const s = await ownSession(c, params && params.id);
  if (s.error) return s.error;
  const session = s.session;
  // Idempotent success: the mapping already landed but the RESPONSE was lost — the client's
  // retry must succeed, not 404/409 a fully-successful upload (adversarial-review finding).
  if (session.status === "recorded") return json({ ok: true, planyrKey: session.planyr_key });
  // A rolled-back upload can never complete — say so, distinctly from "not finished yet"
  // (the generic 409 sent the user hunting for missing chunks whose bytes were deleted).
  if (session.status === "aborted")
    return json({ ok: false, error: "This upload was rolled back — start it again.", sessionLost: true }, 410);
  if (session.status !== "complete" || !session.drive_file_id)
    return json({ ok: false, error: "This upload hasn't finished — send the remaining chunks first." }, 409);

  // Record the key ↔ Drive-id mapping, scoped to the caller (mirrors /api/files exactly).
  const idStore = supabaseIdStore({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, token: c.token });
  const fullKey = `${c.user.id}/${session.planyr_key}`;
  // NEW-F1 telemetry: a mapping REBIND (same key, different Drive file) is the backdrop-swap
  // signature. New uploads mint srcId-unique keys so this should now only fire for a retry of
  // the same source or a legacy-format key from a stale (un-reloaded) client — log it, don't
  // block, and never delete the old file (a share link may still point at its file id).
  try {
    const prior = await idStore.get(fullKey);
    if (prior && prior !== session.drive_file_id)
      console.warn(`drive-mapping-rebind: key ${session.planyr_key} rebinding ${prior} -> ${session.drive_file_id} (old file orphaned, not deleted)`);
  } catch (_) { /* telemetry only */ }
  const setRes = await idStore.set(fullKey, session.drive_file_id, { name: session.file_name });
  if (setRes && setRes.ok === false) {
    // NEW-F2: rollback TRASHES (not hard-deletes) — if the mapping failure was a false
    // negative (write landed, response lost), the bytes stay recoverable for ~30 days.
    try { const client = defaultDriveClientFactory(c.cfg.drive); if (client) await client.trash(session.drive_file_id); } catch (_) { /* best-effort rollback */ }
    await c.store.update(session.id, { status: "aborted" });
    return json({ ok: false, error: "Uploaded to Drive but couldn't record the file; it was rolled back — please retry." }, 502);
  }

  // Mark recorded rather than delete: if THIS response is lost in transit, the client's retry
  // finds the row and returns success idempotently (above) instead of a 404 that would report
  // a fully-successful upload as failed. The row is retired by the expires_at housekeeping.
  await c.store.update(session.id, { status: "recorded" });
  return json({ ok: true, planyrKey: session.planyr_key });
}
