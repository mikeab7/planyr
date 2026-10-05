/* Site Analysis — the orchestrator for the redesigned panel (NEW-1, 2026-10-05).
 *
 * `runSiteScreen(rings, opts)` replaces `runSiteAnalysis` as what the PANEL runs. It deliberately asks
 * LESS than the old screen: the eleven untrusted cards (power, rail, traffic, contamination, faults,
 * airports, zoning, water/sewer CCN…) no longer render a verdict, so they are no longer queried for one.
 * What it still asks:
 *   · the five TRUSTED checks (siteChecksRun) — each gated on the site's region;
 *   · jurisdiction + road authority (the "who governs" block) through the SAME engine as the header pill;
 *   · the two CCN layers, ONLY to decide whether the "Water and sewer provider" call applies.
 * `runSiteAnalysis` is untouched and still exported — other callers and its tests keep working.
 */

import { identifyJurisdiction, identifyRoadAuthority, formatJurisdictionBadge } from "./jurisdiction.js";
import { GIS_SOURCES, sourceCoversState } from "../../../shared/gis/sources.js";
import { siteState } from "./siteRegion.js";
import { pLimit } from "./gisFetch.js";
import { fetchArcgisJson } from "./gisFetch.js";
import { ANALYSIS_SOURCES, analyzeSource, representativeRing, ringCentroid, stateName } from "./siteAnalysis.js";
import { runTrustedChecks } from "./siteChecksRun.js";
import { buildGovernsModel, buildCalls, mergeRoadAnswers } from "./siteGoverns.js";
import { TRUSTED_CHECKS } from "./siteChecks.js";

/* The city-limits layer keys per state — the Layers panel's own "City limits & ETJ" pair in Texas (one merged
 * row), the state's city layer elsewhere. Anything unknown gets no "Show lines" link rather than a dead one. */
const LINE_LAYERS = { TX: ["jur_city", "jur_etj"], GA: ["ga_city"], CA: ["ca_city"], CO: ["co_city"] };

/* Road frontage is asked of EVERY active parcel (largest first, capped) — see mergeRoadAnswers. */
const MAX_ROAD_RINGS = 12;
const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
export const roadRings = (rings) => (rings || []).filter((r) => r && r.length >= 3).sort((a, b) => ringArea(b) - ringArea(a)).slice(0, MAX_ROAD_RINGS);

const ccnSource = (id) => ANALYSIS_SOURCES.find((s) => s.id === id);

/* The old `onFindings` contract (SitePlanner's wetlands → buildability link reads `status` of the
 * "wetlands" finding): translate the trusted wetlands row, so no second fetch is made for it. */
export function legacyFindings(rows) {
  const w = (rows || []).find((r) => r.id === "wetlands");
  if (!w) return [];
  return [{ id: "wetlands", status: w.severity === "red" ? "present" : w.severity === "green" ? "absent" : "unavailable" }];
}

/* Run the screen. opts: holes · only (trusted-check ids — a Retry; skips the governs/utility fetches) ·
 * force · cache · fetchJson · injectable identify* for tests. Never rejects for a source failure. */
export async function runSiteScreen(rings, opts = {}) {
  if (!rings || !rings.length) return { empty: true, generatedAt: Date.now(), rows: [], governs: null, calls: [], untrusted: [], findings: [] };
  const rep = representativeRing(rings);
  const c = ringCentroid(rep);
  const state = siteState({ lat: c.lat, lng: c.lng });

  // A Retry of one trusted row never re-asks jurisdiction, roads or CCN.
  if (Array.isArray(opts.only)) {
    const t = await runTrustedChecks(rings, opts);
    return { partial: true, generatedAt: t.generatedAt, rows: t.rows, untrusted: t.untrusted, regions: t.regions, findings: legacyFindings(t.rows) };
  }

  const idJur = opts.identifyJurisdiction || identifyJurisdiction;
  const idRoad = opts.identifyRoadAuthority || identifyRoadAuthority;
  const baseFetch = opts.fetchJson || ((url, o) => fetchArcgisJson(url, o));
  const limit = pLimit(opts.poolSize || 3);
  const pooledFetch = (url, o) => limit(() => baseFetch(url, o));
  const jurFetch = opts.jurFetchJson || pooledFetch;

  const jurP = Promise.resolve().then(() => idJur(c.lng, c.lat, { ring: rep, ...(rings.length > 1 ? { rings } : {}), cache: opts.cache, fetchJson: jurFetch })).catch((e) => ({ __error: e }));
  const roadP = !sourceCoversState(GIS_SOURCES.road, state)
    ? Promise.resolve({ __notScreened: true })
    : Promise.all(roadRings(rings).map((ring) => Promise.resolve().then(() => idRoad(c.lng, c.lat, { ring, cache: opts.cache, fetchJson: jurFetch })).catch((e) => ({ __error: e })))).then(mergeRoadAnswers);
  // CCN: Texas institutions (PUC). Off Texas ground they are never asked — the call simply applies.
  const ccnP = (id) => (!sourceCoversState(GIS_SOURCES[id], state) ? Promise.resolve(null)
    : analyzeSource(ccnSource(id), rings, { ...opts, fetchJson: pooledFetch }).catch(() => null));

  const [trusted, j, road, ccnW, ccnS] = await Promise.all([
    runTrustedChecks(rings, { ...opts, fetchJson: opts.fetchJson }), jurP, roadP, ccnP("ccnWater"), ccnP("ccnSewer"),
  ]);

  const badge = j && !j.__error ? formatJurisdictionBadge(j) : null;
  const governs = buildGovernsModel(badge, road, { state, stateLabel: stateName(state), layerKeys: LINE_LAYERS[state] || (state ? [] : LINE_LAYERS.TX) });
  const covered = (f) => (f && f.status === "info" && typeof f.covered === "boolean" ? f.covered : null);
  const calls = buildCalls({ ccn: { water: covered(ccnW), sewer: covered(ccnS) }, badge, rows: trusted.rows });
  return {
    generatedAt: trusted.generatedAt, state, regions: trusted.regions,
    rows: trusted.rows, untrusted: trusted.untrusted, governs, calls, findings: legacyFindings(trusted.rows),
  };
}

export { TRUSTED_CHECKS };
