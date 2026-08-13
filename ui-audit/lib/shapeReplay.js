/* ═══ THE RECORDED-AGENCY REPLAY, IN ONE PLACE ═══════════════════════════════════════════════════
 *
 * `test/jurisdictionShapes.test.js` drives the WHOLE identify chain — real parcel geometry, through
 * the real query builder, against agency answers recorded live by
 * `ui-audit/record-jurisdiction-shapes.mjs`. NEW-1 (B367296) needs the identical replay in a REAL
 * BROWSER, because the jurisdiction badge is a rendering surface and a unit test cannot see a label
 * that is clipped, wrapped, empty, or painted in an unreadable colour.
 *
 * It lives here, imported by both, rather than being copied into the harness. A second copy of a
 * replay is a second thing to keep in step with the recorder, and the moment they drift the browser
 * check is testing a fixture the CI check has never seen.
 *
 * The request is DECODED from the URL the real query builder produced, so a change to how geometry
 * is encoded surfaces as a decode failure rather than quietly returning the wrong recording. */

/* ⚠ NEW-1 — Baytown publishes its ETJ (layer 11) and its city limits (layer 12) from ONE service,
 * so the layer number is part of the identity. Before the city-limits row existed, any Baytown URL
 * was the ETJ; matching on the service alone would now route a city-limits query to the ETJ
 * recording and quietly answer the wrong question. */
import { esriPolygons, pointInPolygons, intersectionAreaSqM, ringsAsPolygons } from "../../src/workspaces/site-planner/lib/jurisdictionShare.js";

const ROLE_OF_URL = (url) =>
  /Texas_County_Boundaries/.test(url) ? "county"
  : /Texas_City_Boundaries/.test(url) ? "city"
  : /City_of_Baytown_Citizen_Map.*FeatureServer\/12/.test(url) ? "city_baytown"
  : /City_of_Baytown_Citizen_Map/.test(url) ? "etj_baytown"
  : /ETJ/i.test(url) ? "etj"
  : null;
const FIELD = { county: "CNTY_NM", city: "city_name", etj: "CITY", etj_baytown: null, city_baytown: null };

/* Map a queried point back to the probe point it was recorded for. Exact in practice; nearest keeps
 * the replay robust to a last-digit rounding change without ever silently matching a distant point. */
export function nearestRecorded(rec, [x, y]) {
  let best = -1, bestD = Infinity;
  rec.probe.forEach(([px, py], i) => {
    const d = Math.hypot(px - x, py - y);
    if (d < bestD) { bestD = d; best = i; }
  });
  if (bestD > 1e-4) throw new Error(`no recorded answer near ${x},${y} (closest ${bestD})`);
  return best;
}

// Does this recording carry boundary polygons for that role? (Reserved for a future re-record; the
// five shape fixtures carry attributes only.)
const recordsGeometry = (rec, role) => !!(rec && rec.geometry && rec.geometry[role]);

/* A `fetchJson` stand-in for one recorded shape. `fail` names roles that should throw, so the
 * unresolved-role states are exercised on the same fixtures as the settled ones. */
export function replay(rec, { fail = [] } = {}) {
  return async (url) => {
    const u = new URL(url);
    const role = ROLE_OF_URL(url);
    if (!role) throw new Error("unexpected service: " + url);
    if (fail.includes(role)) throw new Error(`simulated ${role} outage`);
    /* ⛔ NEW-2 — THESE FIXTURES PREDATE THE AREA PASS AND CARRY NO POLYGONS, so a share query is
     * REFUSED here rather than answered with an empty feature list. Answering it emptily would be
     * a fabricated negative — "no city polygon anywhere near this site" — computed from a recording
     * that was never asked the question. Refusing it drives the identify down its own documented
     * fallback (the point probe, `shareMethod: "points"`), which is what these five shapes have
     * always exercised and still should. The area pass has its own fixtures, recorded WITH
     * geometry, in `test/fixtures/jurisdictionAreas.json`. */
    if (u.searchParams.get("returnGeometry") === "true" && !recordsGeometry(rec, role)) {
      throw new Error(`no boundary geometry recorded for ${role} on ${rec.site} — share queries use the area fixtures`);
    }
    const type = u.searchParams.get("geometryType");
    const g = JSON.parse(u.searchParams.get("geometry"));
    const a = rec.answers[role];
    let names;
    if (type === "esriGeometryPolygon") names = a.ring;
    else if (type === "esriGeometryMultipoint") {
      names = [...new Set(g.points.map((p) => nearestRecorded(rec, p)).flatMap((i) => a.points[i]))];
    } else if (type === "esriGeometryPoint") {
      names = a.points[nearestRecorded(rec, [g.x, g.y])];
    } else throw new Error("unexpected geometryType " + type);
    // A presence-only layer answers with featureless rows; `normalizeFeature` supplies `nameConst`.
    if (!FIELD[role]) return { features: (names || []).map(() => ({ attributes: {} })) };
    return { features: (names || []).map((n) => ({ attributes: { [FIELD[role]]: n } })) };
  };
}

/* An in-memory stand-in for the SWR cache. Per-run, so nothing is served from a copy an earlier
 * run left behind. */
export function freshCache() {
  const store = new Map();
  return {
    swr(key, fetcher) {
      if (store.has(key)) {
        const d = store.get(key);
        return { cached: { data: d, ageMs: 0, ts: 1 }, stale: false, fresh: Promise.resolve({ data: d, ageMs: 0, ts: 1 }) };
      }
      const fresh = fetcher()
        .then((data) => { store.set(key, data); return { data, ageMs: 0, ts: 1, updated: true }; })
        .catch((error) => ({ data: [], ageMs: null, ts: null, error }));
      return { cached: null, stale: false, fresh };
    },
  };
}

/* ═══ NEW-2 — THE AREA REPLAY, which serves real POLYGONS ════════════════════════════════════════
 *
 * `replay` above answers from recordings that carry attribute rows only. The area pass measures a
 * SHARE, so its fixtures carry the jurisdictions' real geometry (holes included) and this replay
 * has to behave like the service: apply the spatial filter, and return geometry only when the
 * query asked for it.
 *
 * ⛔ THE SPATIAL FILTER IS REAL, not "return everything recorded". The recorded set is everything
 * within 3 km of the site, so serving it wholesale would report every city in the neighbourhood as
 * TOUCHING the parcels — inventing exactly the frontage-sliver noise B793 spent an item removing,
 * and making the fixture unable to fail on it.
 */
export function replayAreas(rec, { fail = [] } = {}) {
  return async (url) => {
    const u = new URL(url);
    const id = ROLE_OF_URL(url);
    if (!id) throw new Error("unexpected service: " + url);
    if (fail.includes(id)) throw new Error(`simulated ${id} outage`);
    const rows = ((rec.answers || {})[id] || {}).features || [];
    const g = JSON.parse(u.searchParams.get("geometry"));
    const type = u.searchParams.get("geometryType");
    const wantGeom = u.searchParams.get("returnGeometry") === "true";
    const ref = [rec.origin.lon, rec.origin.lat];
    const hit = (f) => {
      const polys = esriPolygons(f.geometry || {});
      if (!polys.length) return false;
      if (type === "esriGeometryPoint") return pointInPolygons([g.x, g.y], polys);
      if (type === "esriGeometryMultipoint") return (g.points || []).some((p) => pointInPolygons(p, polys));
      if (type === "esriGeometryPolygon") return intersectionAreaSqM(ringsAsPolygons(g.rings), polys, ref) > 0;
      throw new Error("unexpected geometryType " + type);
    };
    const keep = rows.filter(hit);
    return { features: keep.map((f) => (wantGeom ? { attributes: f.attributes, geometry: f.geometry } : { attributes: f.attributes })) };
  };
}
