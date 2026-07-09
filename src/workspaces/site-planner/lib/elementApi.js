// Element-level sync, phase 2 (B671) — the network seam for the per-element write/read path.
// Thin over the supabase-js client; the keepalive path is pure over an injected fetch so its
// request shape is unit-tested (mirrors keepaliveCasPush in shared/cloud/optimisticUpsert.js).
//
// The write RPC is `commit_elements(p_site, p_ops)` (B670): one transaction, per-op rev guard,
// returns a per-op result array (status ok|conflict|deleted|exists|missing + the current row on a
// miss). The engine (elementSync.js) owns batching/conflict policy; this file just moves bytes.

// The columns the client reads for a site's element rows (load + realtime refetch).
export const ELEMENT_SELECT = "id,kind,data,z_index,rev,updated_by,updated_at,deleted_at,deleted_by";

// A hung request (a sleeping socket, a proxy stall) would otherwise never settle — leaving the sync
// engine's single in-flight slot stuck TRUE forever, so no create/edit/delete ever reaches the cloud
// and the save badge sits on "saving" with no error. That is the silent-wedge bug behind "delete did
// nothing ~20 times, then suddenly worked" (the backlog floods out when the stall finally clears).
// Bound every round trip with a timeout that ALSO aborts the real request when the builder supports it.
// (LOUD-FAILURE — a stuck save becomes a typed failure the engine can retry/surface, NEW-1/NEW-2.)
export const COMMIT_TIMEOUT_MS = 8000; // mirrors PARCEL_FETCH_TIMEOUT_MS — above normal latency, well under "stuck forever"

// Race a supabase-js query builder against a timeout. `build(ctrl)` returns the builder (thenable);
// when it exposes `.abortSignal` we wire the AbortController so a timeout truly cancels the request.
// Timers are injectable so the unit fakes (plain promises, no `.abortSignal`) run without real delay.
function raceWithTimeout(build, label, { timeoutMs = COMMIT_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((_, reject) => { timer = setTimer(() => { if (ctrl) ctrl.abort(); reject(new Error(`${label} timeout`)); }, timeoutMs); });
  let q = build(ctrl);
  if (ctrl && q && typeof q.abortSignal === "function") q = q.abortSignal(ctrl.signal);
  return { race: Promise.race([q, timeout]), done: () => { if (timer != null) clearTimer(timer); } };
}

// Commit a batch of ops in one round trip. Returns { ok, results, error }.
// `results` is the RPC's per-op array (same order as `ops`); [] on failure.
export async function commitElements(client, siteId, ops, opts = {}) {
  if (!client) return { ok: false, results: [], error: "no client" };
  if (!Array.isArray(ops) || ops.length === 0) return { ok: true, results: [] };
  const t = raceWithTimeout(() => client.rpc("commit_elements", { p_site: siteId, p_ops: ops }), "commit", opts);
  try {
    const { data, error } = await t.race;
    if (error) return { ok: false, results: [], error: error.message || String(error) };
    return { ok: true, results: Array.isArray(data) ? data : [] };
  } catch (e) {
    return { ok: false, results: [], error: (e && e.message) || "commit threw" };
  } finally { t.done(); }
}

// Fetch ALL of a site's element rows (live + tombstoned — the caller filters). Returns
// { ok, rows, error }. Throws are caught; a real fetch error returns ok:false so the caller can
// keep the current canvas rather than blanking it (mirrors cloudList's B54 discipline).
export async function fetchElements(client, siteId, opts = {}) {
  if (!client) return { ok: false, rows: [], error: "no client" };
  const t = raceWithTimeout(() => client.from("site_elements").select(ELEMENT_SELECT).eq("site_id", siteId), "fetch", opts);
  try {
    const { data, error } = await t.race;
    if (error) return { ok: false, rows: [], error: error.message || String(error) };
    return { ok: true, rows: Array.isArray(data) ? data : [] };
  } catch (e) {
    return { ok: false, rows: [], error: (e && e.message) || "fetch threw" };
  } finally { t.done(); }
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
