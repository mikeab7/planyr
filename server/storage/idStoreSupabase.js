/* Durable Planyr-key ↔ Drive-id store, backed by Supabase Postgres (B207 / NEW-2).
 *
 * The in-memory idMap (idMap.js) is per-request — fine for a single round-trip, but a
 * serverless Function forgets it between requests. This store persists the mapping in the
 * `public.drive_files` table (migration: db/drive_files.sql) so a file saved to Drive in
 * one request can be FETCHED in a later one. Scoped to the caller by RLS via their token.
 *
 * Implements the same { get, getByBackend, set, del } shape memoryIdStore() exposes;
 * createIdMap() awaits these transparently. Network is injectable for tests. `set` is
 * best-effort (a missing table / transient error won't break the underlying Drive write —
 * the bytes still land; only the mapping is skipped, surfaced via console.warn).
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
    async set(planyrKey, driveId) {
      // Upsert on the (user_id, planyr_key) primary key; user_id defaults to auth.uid().
      try {
        const res = await fetchImpl(REST(supabaseUrl), {
          method: "POST",
          headers: { ...headers, prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ planyr_key: planyrKey, drive_id: driveId }),
        });
        if (!res.ok) console.warn(`drive_files set ${res.status} (mapping not persisted; Drive bytes are saved)`);
      } catch (e) { console.warn("drive_files set failed:", e && e.message); }
    },
    async del(planyrKey) {
      try { await fetchImpl(`${REST(supabaseUrl)}?planyr_key=eq.${enc(planyrKey)}`, { method: "DELETE", headers }); } catch (_) { /* best-effort */ }
    },
  };
}
