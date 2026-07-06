// Element-level sync, phase 2 (B671) — the network seam for the per-element write/read path.
// Thin over the supabase-js client; the keepalive path is pure over an injected fetch so its
// request shape is unit-tested (mirrors keepaliveCasPush in shared/cloud/optimisticUpsert.js).
//
// The write RPC is `commit_elements(p_site, p_ops)` (B670): one transaction, per-op rev guard,
// returns a per-op result array (status ok|conflict|deleted|exists|missing + the current row on a
// miss). The engine (elementSync.js) owns batching/conflict policy; this file just moves bytes.

// The columns the client reads for a site's element rows (load + realtime refetch).
export const ELEMENT_SELECT = "id,kind,data,z_index,rev,updated_by,updated_at,deleted_at,deleted_by";

// Commit a batch of ops in one round trip. Returns { ok, results, error }.
// `results` is the RPC's per-op array (same order as `ops`); [] on failure.
export async function commitElements(client, siteId, ops) {
  if (!client) return { ok: false, results: [], error: "no client" };
  if (!Array.isArray(ops) || ops.length === 0) return { ok: true, results: [] };
  try {
    const { data, error } = await client.rpc("commit_elements", { p_site: siteId, p_ops: ops });
    if (error) return { ok: false, results: [], error: error.message || String(error) };
    return { ok: true, results: Array.isArray(data) ? data : [] };
  } catch (e) {
    return { ok: false, results: [], error: (e && e.message) || "commit threw" };
  }
}

// Fetch ALL of a site's element rows (live + tombstoned — the caller filters). Returns
// { ok, rows, error }. Throws are caught; a real fetch error returns ok:false so the caller can
// keep the current canvas rather than blanking it (mirrors cloudList's B54 discipline).
export async function fetchElements(client, siteId) {
  if (!client) return { ok: false, rows: [], error: "no client" };
  try {
    const { data, error } = await client
      .from("site_elements")
      .select(ELEMENT_SELECT)
      .eq("site_id", siteId);
    if (error) return { ok: false, rows: [], error: error.message || String(error) };
    return { ok: true, rows: Array.isArray(data) ? data : [] };
  } catch (e) {
    return { ok: false, rows: [], error: (e && e.message) || "fetch threw" };
  }
}

// Last-ditch flush of pending ops during page unload — the supabase-js client can't issue a
// fetch({keepalive:true}), so hit the PostgREST RPC endpoint directly. Guard-only over what it
// needs; never throws. Returns true if a request was dispatched. Subject to the browser's ~64KB
// keepalive budget, so a very large batch may quietly no-op — acceptable for a safety net (the
// dirty queue + next-load refetch remain the guarantee).
export function keepaliveCommit({ fetchImpl, url, anon, token, siteId, ops }) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f || !url || !anon || !token || !siteId || !Array.isArray(ops) || ops.length === 0) return false;
  try {
    f(`${url}/rest/v1/rpc/commit_elements`, {
      method: "POST",
      keepalive: true,
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_site: siteId, p_ops: ops }),
    }).catch(() => { /* fire-and-forget; the page is navigating away */ });
    return true;
  } catch {
    return false;
  }
}
