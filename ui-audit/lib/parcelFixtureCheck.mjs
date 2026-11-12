/* parcelFixtureCheck.mjs — NEW-1 (2026-11-12): the nightly "known parcels still come back right" check.
 *
 * `parcel-source-health-sweep.mjs` asks "does this layer answer and hold features"; this asks the harder
 * question a re-keyed id column, a swapped owner field or a unit change would fail: re-query a handful of
 * MEASURED lots by id and assert the owner string and the acreage (±1%) still match.
 * Fixtures: `src/shared/gis/sourceFixturesParcels.js` (the layer URL is read from the registry, never copied).
 *
 * Pure core (`buildFixtureQuery`, `judgeParcelFixture`, `sameOwner`, `acresMatch`) + one network driver
 * (`checkParcelFixtures`) that takes the injected `fetchJson` the sweep already uses (the per-host throttle +
 * breaker). Verdicts per parcel: pass · fail (the layer answered and disagrees — a real drift) ·
 * unmeasured (host unreachable or sandbox-blocked — said, never counted as a pass OR a failure of the data).
 */
import { ownerKey } from "../../src/workspaces/site-planner/lib/appraisal.js";

export const ACRES_TOLERANCE = 0.01; // ±1% (the owner-set bar), with an absolute floor for rounding on tiny lots
export const ACRES_ABS_FLOOR = 0.0005;

const collapse = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
export const sameOwner = (a, b) => collapse(a) !== "" && collapse(a) === collapse(b);
export function acresMatch(actual, expected) {
  const a = Number(actual), e = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(e)) return false;
  return Math.abs(a - e) <= Math.max(Math.abs(e) * ACRES_TOLERANCE, ACRES_ABS_FLOOR);
}

/* The URL of the by-id query. outFields=* so a joined layer's table-prefixed owner column resolves through the
 * app's own `ownerKey`, and no resultRecordCount (a few services reject pagination params — Nevada). */
export function buildFixtureQuery(layerUrl, idField, id) {
  const where = `${idField}='${String(id).replace(/'/g, "''")}'`;
  const qs = new URLSearchParams({ where, outFields: "*", returnGeometry: "false", f: "json" });
  return `${String(layerUrl).replace(/\/+$/, "")}/query?${qs.toString()}`;
}

/* One feature's attributes → { owner, acres } by the fixture's declared fields. A fixture with no `ownerField`
 * resolves it through the app's `ownerKey` (and so also proves that resolver still finds the owner on this layer). */
export function readFeature(attrs, spec) {
  const ownerCol = spec.ownerField || ownerKey(attrs);
  return { ownerCol, owner: ownerCol ? attrs[ownerCol] : undefined, acres: attrs[spec.acresField] };
}

/* Judge the rows one id returned. Pure. `spec` is the county's fixture block, `parcel` one { id, owner, acres }. */
export function judgeParcelFixture(features, spec, parcel) {
  const rows = Array.isArray(features) ? features : [];
  if (rows.length === 0) return { verdict: "fail", problem: `no row for ${spec.idField}=${parcel.id} (id column re-keyed, or the lot is gone)` };
  if (spec.oneLot && rows.length !== 1) return { verdict: "fail", problem: `${rows.length} rows for ONE lot ${parcel.id} (stacked rows are back)`, rowCount: rows.length };
  for (const f of rows) {
    const { ownerCol, owner, acres } = readFeature(f.attributes || {}, spec);
    if (!ownerCol) return { verdict: "fail", problem: `no owner column resolves on this layer (${parcel.id})`, rowCount: rows.length };
    if (!sameOwner(owner, parcel.owner)) return { verdict: "fail", problem: `owner "${String(owner ?? "").trim()}" ≠ expected "${parcel.owner}"`, rowCount: rows.length };
    if (!acresMatch(acres, parcel.acres)) return { verdict: "fail", problem: `acres ${acres} ≠ expected ${parcel.acres} (±${ACRES_TOLERANCE * 100}%)`, rowCount: rows.length };
  }
  return { verdict: "pass", rowCount: rows.length, stackedNote: rows.length > 1 ? `${rows.length} stacked rows (all agree)` : null };
}

/* Re-query every fixture. Never throws — a network exception is an `unmeasured` row. */
export async function checkParcelFixtures({ fixtures, registry, fetchJson }) {
  const out = [];
  for (const [county, spec] of Object.entries(fixtures || {})) {
    const layerUrl = registry?.[county]?.layerUrl;
    if (!layerUrl) {
      out.push({ county, id: "*", verdict: "fail", problem: `"${county}" has parcel fixtures but no layerUrl in the registry` });
      continue;
    }
    for (const parcel of spec.parcels) {
      let r;
      try { r = await fetchJson(buildFixtureQuery(layerUrl, spec.idField, parcel.id)); }
      catch (err) { r = { ok: false, error: String(err?.message || err) }; }
      if (!r || !r.ok || !r.json) {
        out.push({ county, id: parcel.id, verdict: "unmeasured", problem: r?.blocked ? "host blocked in this environment" : `unreachable: ${r?.error || `HTTP ${r?.status}`}` });
        continue;
      }
      if (r.json.error) {
        out.push({ county, id: parcel.id, verdict: "fail", problem: `ArcGIS error: ${r.json.error.message || JSON.stringify(r.json.error)}` });
        continue;
      }
      out.push({ county, id: parcel.id, ...judgeParcelFixture(r.json.features, spec, parcel) });
    }
  }
  return out;
}

export const summariseFixtureChecks = (rows) => ({
  total: rows.length,
  passed: rows.filter((x) => x.verdict === "pass").length,
  failed: rows.filter((x) => x.verdict === "fail"),
  unmeasured: rows.filter((x) => x.verdict === "unmeasured"),
});
