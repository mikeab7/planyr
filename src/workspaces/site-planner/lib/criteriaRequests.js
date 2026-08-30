/* "Request criteria for this county" (B877440/B877441) — the one action a "no criteria on
 * file" state offers instead of a fabricated number. Owner's framing, verbatim: "if someone
 * clicks it, I'll add the detention criteria for that county. Otherwise it doesn't work."
 *
 * LOUD-FAILURE: a request that doesn't reach the server must say so and must NOT render as
 * filed. A unique-violation (23505) from db/criteria_requests.sql's per-(user,county,family)
 * index is not a failure — it means this user already filed this exact request — and is
 * reported as `duplicate: true`, not an error.
 *
 * `wasRequested`/`markRequested` are a pure localStorage convenience so the button reads back
 * "Requested ✓ <date>" without a round trip (there is no SELECT policy on the table to ask the
 * server — see criteria_requests.sql). If storage is cleared the button just re-files, and the
 * server-side unique index reports it as a duplicate rather than a second row.
 */
const LS = "planarfit:criteriaRequested:v1";
const reqKey = (countyKey, family) => `${countyKey}:${family}`;

/* Has THIS device already filed (or been told it already filed) this exact request? Returns the
 * ISO timestamp string it was marked at, or null. Pure aside from the injected store. */
export function wasRequested(countyKey, family, store) {
  if (!countyKey || !family) return null;
  const s = store || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!s) return null;
  try {
    const v = JSON.parse(s.getItem(LS));
    return (v && v[reqKey(countyKey, family)]) || null;
  } catch (_) { return null; }
}

function markRequested(countyKey, family, at, store) {
  const s = store || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!s) return;
  try {
    const v = JSON.parse(s.getItem(LS)) || {};
    v[reqKey(countyKey, family)] = at;
    s.setItem(LS, JSON.stringify(v));
  } catch (_) {}
}

/* File the request. Returns one of:
 *   { ok: true,  duplicate: false, at }   — filed just now
 *   { ok: true,  duplicate: true,  at }   — this user/device already filed this exact request
 *   { ok: false, error: "…" }             — did not reach the server; render as NOT filed
 * `client` is the supabase-js client (injectable for tests); a missing/unconfigured client is
 * an honest failure, never a silent success. `store` (injectable, defaults to localStorage) is
 * the same convenience marker `wasRequested` reads. */
export async function requestCriteria(client, { countyKey, countyLabel = null, state = null, family, siteId = null }, store) {
  if (!countyKey || !family) return { ok: false, error: "missing county or criteria family" };
  const already = wasRequested(countyKey, family, store);
  if (already) return { ok: true, duplicate: true, at: already };
  if (!client) return { ok: false, error: "Not connected — the request wasn't sent. Try again once you're online." };
  try {
    const { error } = await client.from("criteria_requests").insert({
      county_key: countyKey, county_label: countyLabel, state, family, site_id: siteId,
    });
    const now = new Date().toISOString();
    if (error) {
      if (error.code === "23505") { markRequested(countyKey, family, now, store); return { ok: true, duplicate: true, at: now }; }
      return { ok: false, error: error.message || String(error) };
    }
    markRequested(countyKey, family, now, store);
    return { ok: true, duplicate: false, at: now };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}
