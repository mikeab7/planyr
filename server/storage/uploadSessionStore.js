/* Durable chunked-upload session store, backed by Supabase Postgres (B409 rework).
 *
 * One row per in-flight Google Drive resumable upload (table: db/upload_sessions.sql).
 * The /api/uploads/* Pages Functions are stateless — chunk N arrives in a different
 * request (often a different isolate) than the one that opened the Drive session — so the
 * session URI must persist server-side between requests. It persists HERE, scoped to the
 * caller by RLS via their own token, and is never returned to the browser (the uploadId
 * is the only handle the client ever sees).
 *
 * Same discipline as idStoreSupabase: network is injectable, results are honest
 * ({ ok:false } on a write that didn't land — LOUD-FAILURE), reads return null on any
 * failure so a lost row and a failed read are both "no session" to the ownership check.
 */
const REST = (url) => `${String(url).replace(/\/+$/, "")}/rest/v1/upload_sessions`;

export function uploadSessionStore({ supabaseUrl, anonKey, token, fetchImpl = fetch } = {}) {
  const headers = { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" };
  const enc = encodeURIComponent;

  return {
    /* Insert a new session row; returns { ok, id } or { ok:false, error }. user_id is
     * stamped by the column default (auth.uid()) so the creator is always the caller. */
    async create({ planyrKey, driveSessionUri, fileName, mimeType, totalBytes }) {
      try {
        const res = await fetchImpl(REST(supabaseUrl), {
          method: "POST",
          headers: { ...headers, prefer: "return=representation" },
          body: JSON.stringify({
            planyr_key: planyrKey, drive_session_uri: driveSessionUri,
            file_name: fileName, mime_type: mimeType, total_bytes: totalBytes,
          }),
        });
        if (!res.ok) return { ok: false, error: `upload_sessions insert ${res.status}` };
        const rows = await res.json();
        const id = rows && rows[0] && rows[0].id;
        return id ? { ok: true, id } : { ok: false, error: "upload_sessions insert returned no id" };
      } catch (e) { return { ok: false, error: (e && e.message) || "upload_sessions insert failed" }; }
    },

    /* Fetch one session by id. RLS scopes to the caller, so another user's uploadId reads
     * as null — the ownership check every endpoint runs before touching Drive (B491). */
    async get(id) {
      try {
        const res = await fetchImpl(`${REST(supabaseUrl)}?id=eq.${enc(id)}&limit=1`, { headers });
        if (!res.ok) return null;
        const rows = await res.json();
        return (rows && rows[0]) || null;
      } catch (_) { return null; }
    },

    /* Patch a session row (bytes_received progress, drive_file_id + status on the final
     * chunk, aborted on rollback). Returns { ok } — a progress write that misses is
     * non-fatal for the transfer (Drive holds the truth; /status re-syncs) but the caller
     * decides that, not this store. */
    async update(id, patch) {
      try {
        const res = await fetchImpl(`${REST(supabaseUrl)}?id=eq.${enc(id)}`, {
          method: "PATCH",
          headers: { ...headers, prefer: "return=minimal" },
          body: JSON.stringify(patch),
        });
        return res.ok ? { ok: true } : { ok: false, error: `upload_sessions update ${res.status}` };
      } catch (e) { return { ok: false, error: (e && e.message) || "upload_sessions update failed" }; }
    },

    /* Delete a finished session row (the mapping is recorded; nothing left to resume). */
    async remove(id) {
      try { await fetchImpl(`${REST(supabaseUrl)}?id=eq.${enc(id)}`, { method: "DELETE", headers }); } catch (_) { /* best-effort */ }
    },

    /* Purge the CALLER'S expired sessions (Google kills the URI after ~1 week, so the rows
     * are dead weight). Best-effort housekeeping run from /start; RLS keeps it own-rows. */
    async purgeExpired() {
      try {
        await fetchImpl(`${REST(supabaseUrl)}?expires_at=lt.${enc(new Date().toISOString())}`, { method: "DELETE", headers });
      } catch (_) { /* best-effort */ }
    },
  };
}
