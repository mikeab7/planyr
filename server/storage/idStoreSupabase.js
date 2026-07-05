/* Durable Planyr-key ↔ Drive-id store, backed by Supabase Postgres (B207 / NEW-2).
 *
 * The in-memory idMap (idMap.js) is per-request — fine for a single round-trip, but a
 * serverless Function forgets it between requests. This store persists the mapping in the
 * `public.drive_files` table (migration: db/drive_files.sql) so a file saved to Drive in
 * one request can be FETCHED in a later one. Scoped to the caller by RLS via their token.
 *
 * Implements the same { get, getByBackend, set, del } shape memoryIdStore() exposes;
 * createIdMap() awaits these transparently. Network is injectable for tests. `set` REPORTS
 * failure ({ ok:false }) so the caller (adapter.save / the resumable COMMIT) can roll the
 * just-uploaded bytes back and fail honestly — a file whose mapping never persisted reads
 * back as "missing", exactly the silent success NEW-4 forbids. Still never throws.
 */
const REST = (url) => `${String(url).replace(/\/+$/, "")}/rest/v1/drive_files`;

export function supabaseIdStore({ supabaseUrl, anonKey, token, fetchImpl = fetch } = {}) {
  const headers = { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" };
  const enc = encodeURIComponent;

  const query = async (qs) => {
    const res = await fetchImpl(`${REST(supabaseUrl)}?${qs}`, { headers });
    if (!res.ok) throw new Error(`drive_files query ${res.status}`);
    return res.json();
  };

  return {
    async get(planyrKey) {
      try {
        const rows = await query(`select=drive_id&limit=1&planyr_key=eq.${enc(planyrKey)}`);
        return (rows && rows[0] && rows[0].drive_id) || null;
      } catch (_) { return null; }
    },
    async getByBackend(driveId) {
      try {
        const rows = await query(`select=planyr_key&limit=1&drive_id=eq.${enc(driveId)}`);
        return (rows && rows[0] && rows[0].planyr_key) || null;
      } catch (_) { return null; }
    },
    async set(planyrKey, driveId, meta = {}) {
      // Upsert on the (user_id, planyr_key) primary key; user_id defaults to auth.uid().
      // Returns { ok } so the caller can roll back + fail honestly if the mapping doesn't land.
      try {
        const row = { planyr_key: planyrKey, drive_id: driveId, updated_at: new Date().toISOString() };
        if (meta && meta.name) row.name = meta.name; // store the display name (Cowork: was NULL)
        const res = await fetchImpl(REST(supabaseUrl), {
          method: "POST",
          headers: { ...headers, prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(row),
        });
        if (!res.ok) {
          console.warn(`drive_files set ${res.status} (mapping not persisted)`);
          return { ok: false, error: `drive_files set ${res.status}` };
        }
        return { ok: true };
      } catch (e) {
        console.warn("drive_files set failed:", e && e.message);
        return { ok: false, error: (e && e.message) || "drive_files set failed" };
      }
    },
    async del(planyrKey) {
      try { await fetchImpl(`${REST(supabaseUrl)}?planyr_key=eq.${enc(planyrKey)}`, { method: "DELETE", headers }); } catch (_) { /* best-effort */ }
    },

    /* Page through the caller's Drive-stored files under a key prefix (B663 one-time
     * migration: every filed key starts `<uid>/project-<id>/…`, so a prefix scan finds exactly
     * one project's files — RLS scopes rows to the caller anyway). Ordered + offset so a
     * chunked caller walks the set deterministically. Returns [{ planyrKey, driveId }], or
     * NULL on a failed read — callers MUST treat null as "couldn't list", never as
     * "end of list": an [] lookalike made a blipped page read report the one-time migration
     * COMPLETE and write the permanent done-marker (B663 review #1, LOUD-FAILURE class). */
    async listByPrefix(prefix, { limit = 10, offset = 0 } = {}) {
      try {
        const pattern = enc(String(prefix || "") + "*");
        const rows = await query(`select=planyr_key,drive_id&planyr_key=like.${pattern}&order=planyr_key.asc&limit=${limit}&offset=${offset}`);
        return (rows || []).map((r) => ({ planyrKey: r.planyr_key, driveId: r.drive_id }));
      } catch (_) { return null; } // a failed read is a FAILURE, not an empty page
    },
  };
}
