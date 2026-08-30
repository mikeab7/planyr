// Element-level sync, phase 2 (B671) — the network seam for the per-element write/read path.
// Thin over the supabase-js client; the keepalive path is pure over an injected fetch so its
// request shape is unit-tested (mirrors keepaliveCasPush in shared/cloud/optimisticUpsert.js).
//
// The write RPC is `commit_elements(p_site, p_ops)` (B670): one transaction, per-op rev guard,
// returns a per-op result array (status ok|conflict|deleted|exists|missing + the current row on a
// miss). The engine (elementSync.js) owns batching/conflict policy; this file just moves bytes.

// The columns the client reads for a site's element rows (load + realtime refetch).
// NEW-2 (B712225) — op_id/op_kind/actor_session_id/client_ts ride along so a freshly loaded or
// refetched row carries its operation envelope (operationEnvelope.js's groupRowsIntoOperations
// reads them straight off the row); realtime postgres_changes payloads already include every
// column regardless of this list (CDC ships the whole row), so this only affects the REST fetch.
export const ELEMENT_SELECT = "id,kind,data,z_index,rev,updated_by,updated_at,deleted_at,deleted_by,op_id,op_kind,actor_session_id,client_ts";

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
// B1117 — the 3-arg ATOMIC overload is not available everywhere. Production has the migration
// (`db/commit_elements_atomic.sql`, applied + rollback-verified 2026-07-29), but any other project
// that has not run it answers a 3-arg call with a PostgREST "function not found" — which would fail
// EVERY write. So the first such error latches this flag and every later batch falls back to the
// plain 2-arg call for the rest of the session: the B1116 client-side split detector is still the
// backstop, so a project without the migration degrades to the previous behaviour rather than
// breaking. Module-scoped on purpose (one probe per page load, not one per site).
let atomicUnavailable = false;
// B1341 stage 2 — the same latch for the 4-arg group-CAS overload. A project without that migration
// answers PGRST202, and that must degrade to the 3-arg atomic call rather than reaching the engine
// as a write failure (the B1117 precedent, which this deliberately mirrors rather than reinvents).
let groupsUnavailable = false;
const missingFunction = (err) => {
  const m = ((err && (err.message || err.hint || err.details)) || "").toLowerCase();
  return (err && err.code === "PGRST202") || m.includes("could not find the function") ||
    m.includes("does not exist") || m.includes("no function matches");
};

/** `opts.atomic` asks for all-or-nothing group semantics (B1116/B1117). Returns
 *  { ok, results, applied } — `applied === false` means the server rolled the WHOLE call back and
 *  NOTHING landed, including ops whose own status reads "ok". `applied` is undefined on the plain
 *  path. The two modes return different shapes on the wire (atomic → an object, plain → a bare
 *  array), so both are normalised here rather than at the call site. */
export async function commitElements(client, siteId, ops, opts = {}) {
  if (!client) return { ok: false, results: [], error: "no client" };
  if (!Array.isArray(ops) || ops.length === 0) return { ok: true, results: [] };
  const wantAtomic = !!opts.atomic && !atomicUnavailable;
  const latched = !!opts.atomic && atomicUnavailable;   // asked, but this project has no overload
  // B1341 stage 2 — groups ride ONLY on an atomic call: "the named assemblies are current" and "the
  // whole batch landed" are one guarantee, and sending groups without atomicity would let a batch
  // half-apply after passing the group check, which is the defect wearing a new hat.
  const groups = wantAtomic && Array.isArray(opts.groups) && opts.groups.length && !groupsUnavailable
    ? opts.groups : null;
  // Annotate the result ONLY when the caller asked for atomic: a plain call's return shape stays
  // exactly what it was before B1120, so no existing caller or test sees a new field. `sentAtomic`
  // is what actually went on the wire; `fellBack` marks the one legitimate un-atomic send.
  // `sentGroups` is the B1120 lesson applied to stage 2: report what went ON THE WIRE, not what was
  // asked for, so the engine can catch its own request being lost. That exact loss shipped silently
  // once already for `atomic`, and a fixed-arity adapter would drop `groups` the identical way.
  const tag = (r) => (opts.atomic
    ? { ...r, sentAtomic: wantAtomic, sentGroups: groups ? groups.length : 0, ...(latched ? { fellBack: true } : {}) }
    : r);
  const args = groups
    ? { p_site: siteId, p_ops: ops, p_atomic: true, p_groups: groups }
    : wantAtomic
      ? { p_site: siteId, p_ops: ops, p_atomic: true }
      : { p_site: siteId, p_ops: ops };
  const t = raceWithTimeout(() => client.rpc("commit_elements", args), "commit", opts);
  try {
    const { data, error } = await t.race;
    if (error) {
      // B1341 stage 2 — no 4-arg overload on this project: latch and retry WITHOUT groups. The
      // retry keeps `atomic`, so the call degrades to exactly the B1117 behaviour rather than to
      // the un-guarded per-row path.
      if (groups && missingFunction(error)) {
        groupsUnavailable = true;
        t.done();
        const r = await commitElements(client, siteId, ops, { ...opts, groups: null });
        return { ...r, groupsFellBack: true };
      }
      if (wantAtomic && missingFunction(error)) {
        atomicUnavailable = true;                       // latch, then retry this batch un-atomically
        t.done();
        // `fellBack` marks this as the ONE legitimate reason a batch goes out un-atomically after
        // asking: the project has no 3-arg overload. B1120's wiring guard must not flag it.
        const r = await commitElements(client, siteId, ops, { ...opts, atomic: false });
        return { ...r, fellBack: true };
      }
      return tag({ ok: false, results: [], error: error.message || String(error) });
    }
    // Atomic mode answers { applied, results }; the plain path answers the bare results array.
    // `sentAtomic` reports what actually went ON THE WIRE (B1120) — not what the caller asked for —
    // so the engine can catch its own request being lost between here and there. That exact loss
    // shipped silently once already.
    if (data && !Array.isArray(data) && typeof data === "object") {
      // B1341 stage 2 — `groupConflict` means the server refused the call OUTRIGHT because a named
      // assembly had moved, and wrote NOTHING. It is carried through verbatim (assembly, expected,
      // actual, members) because naming what moved is the whole point of the derived digest.
      return tag({
        ok: true,
        results: Array.isArray(data.results) ? data.results : [],
        applied: data.applied !== false,
        ...(Array.isArray(data.groupConflict) && data.groupConflict.length ? { groupConflict: data.groupConflict } : {}),
      });
    }
    return tag({ ok: true, results: Array.isArray(data) ? data : [] });
  } catch (e) {
    return tag({ ok: false, results: [], error: (e && e.message) || "commit threw" });
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

// B849344 — canonical parcel geometry for the WHOLE portfolio in ONE round trip: the site LIST
// and map PIN's "does this site have a boundary, and how big is it" must read `site_elements`
// (the row-synced engine), never `sites.data->'parcels'` — a dead mirror the cloud row keeps
// EMPTIED since the B672 element-sync cutover (see cloudSync.js's slimForCloud). RLS already
// scopes `site_elements` to sites this user can see (own + shared), so no `site_id` filter is
// needed; `kind`/`deleted_at` narrow it to LIVE parcel rows only. Returns { ok, rows, error }
// where each row is { site_id, data } — `data` is the parcel object verbatim, same shape the
// open planner canvas draws from.
export async function fetchParcelSummaries(client, opts = {}) {
  if (!client) return { ok: false, rows: [], error: "no client" };
  const t = raceWithTimeout(
    () => client.from("site_elements").select("site_id,data").eq("kind", "parcel").is("deleted_at", null),
    "fetch-parcel-summary", opts
  );
  try {
    const { data, error } = await t.race;
    if (error) return { ok: false, rows: [], error: error.message || String(error) };
    return { ok: true, rows: Array.isArray(data) ? data : [] };
  } catch (e) {
    return { ok: false, rows: [], error: (e && e.message) || "fetch threw" };
  } finally { t.done(); }
}

// B845089 (NEW-2) — the network half of "when was this project last actually edited" (see
// lib/siteRecency.js). Same shape as fetchParcelSummaries above (one request for the WHOLE
// portfolio, RLS already scopes it to sites this user can see — own + shared, never per-site),
// but narrowed to two skinny columns instead of full geometry: this reads every live element
// row's `site_id` + `updated_at`, not just parcels', because any drawn kind counts as an edit.
// Returns { ok, rows, error } where each row is { site_id, updated_at }.
export async function fetchElementRecency(client, opts = {}) {
  if (!client) return { ok: false, rows: [], error: "no client" };
  const t = raceWithTimeout(
    () => client.from("site_elements").select("site_id,updated_at").is("deleted_at", null),
    "fetch-element-recency", opts
  );
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
