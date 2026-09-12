#!/usr/bin/env node
/* discover-county-parcels.mjs — B1551616/B1551617 (2026-09-11): COUNTY-level parcel-source discovery,
 * the sibling of probe-statewide-parcels.mjs (which discovers STATE-wide aggregations only — "the
 * existing per-county tier in counties.js" is explicitly out of its scope, and is exactly this file's
 * scope).
 *
 * THE MEASUREMENT THAT JUSTIFIES THIS (owner brief, 2026-09-10). 42 counties across the 18 states with
 * no statewide source were run through two routes: ArcGIS Hub dataset search (10/42) and ArcGIS Online
 * item search (found 16 MORE of the 32 route 1 missed — 26/42 total). Of those 16, NONE were genuinely
 * absent — they were SEARCH FAILURES. A third, untried route — the county's own GIS hostname — is how
 * Allegheny, Will, DuPage, Cook and Jefferson AL were actually reached in that measurement, none of them
 * by keyword. Conclusion: coverage is limited by how many routes are tried, not by what exists.
 *
 * FOUR ROUTES, TRIED IN ORDER, FIRST ONE TO PRODUCE AN ACCEPTED CANDIDATE WINS (and is recorded):
 *   1. ArcGIS Hub dataset API      (hub.arcgis.com/api/v3/datasets)      — routeHubDatasets
 *   2. ArcGIS Online item search   (arcgis.com/sharing/rest/search)      — routeAgolSearch
 *   3. County GIS hostname pattern + REST-directory walk (UNTRIED before this)  — routeCountyHostname
 *   4. The state's own open-data organization, filtered to the county    — routeStateOpenData
 *
 * ACCEPTANCE TEST for a candidate layer — ALL FOUR must hold (acceptCandidate):
 *   - answers a point query inside the FL/TN timing budget (ENVELOPE_QUERY_BUDGET_MS = 8000ms, the
 *     same constant + ~7-mile envelope shape statewideCoverage.mjs already measured against Florida/
 *     Tennessee — reused verbatim, not re-derived);
 *   - returns OWNERSHIP-SHAPED attributes (owner / situs address / APN·PIN / acreage / assessed value)
 *     with a REAL, non-empty VALUE in at least one of them on at least one returned feature — a field
 *     merely existing in the schema is not enough (that is exactly how a PLSS survey grid or an
 *     address-point layer would otherwise pass);
 *   - hits at ALL THREE geometry-verified spread points inside the county (never only the county seat)
 *     — the check that catches the City-of-Detroit-offered-as-Wayne-County class of error;
 *   - is not a test/demo/sandbox/draft/archive/historical service and is not a stale vintage — see
 *     REJECT_TITLE_RE / STALE_YEAR_THRESHOLD below (item 2's rejection rules, applied as a hard reject
 *     rather than a ranking demotion, per the brief's "is not a test service... see item 2").
 *
 * RANKING (item 2) — among every candidate a SINGLE successful route returns that clears acceptance,
 * prefer (a) most recent vintage (a year in the title/name, or the service's own editingInfo date),
 * (b) an organizational publisher over a personal account, (c) a parcel layer over a derived one
 * (soft demotion for names suggesting points/summaries/rolls rather than the parcel polygon itself).
 * The chosen candidate's vintage is always recorded, so a stale wire is visible rather than silent.
 *
 * ⛔ THIS SANDBOX SITS BEHIND AN EGRESS ALLOWLIST (confirmed live 2026-09-11, same wall
 * probe-statewide-parcels.mjs's own header names): `*.arcgis.com` is reachable; a county's own custom
 * GIS hostname (gis.cookcountyil.gov, gis.dupageco.org, gisdata.alleghenycounty.us, …) is NOT — the
 * proxy returns a policy 403 on the CONNECT tunnel itself (confirmed via curl AND via WebFetch, so this
 * is not a fetch()-specific quirk). Route 3 therefore reports every such host as BLOCKED-IN-SANDBOX —
 * a THIRD, distinct status from "not found" (nothing answered) and "does not exist" (see item 4) —
 * never silently folded into either. The route's CODE is fully implemented and correct; running it to
 * completion needs an environment with open egress (the owner's own browser / the Cowork thread /
 * a session with a different network policy), exactly the split this repo already documents for
 * `Blocker: auth` items in probe-statewide-parcels.mjs and docs/STATEWIDE-PARCELS.md.
 *
 * Run:
 *   node ui-audit/discover-county-parcels.mjs --county "Cook" --state IL
 *   node ui-audit/discover-county-parcels.mjs --tier1                 (the Hillwood-market roster below)
 *   node ui-audit/discover-county-parcels.mjs --list path/to/list.json  ([{ "county": "...", "state": "XX" }, …])
 *   node ui-audit/discover-county-parcels.mjs --county "Cook" --state IL --json   (machine-readable, no doc write)
 *
 * Writes ui-audit/discover-county-parcels-results.json (machine-readable) + a human summary to stdout,
 * for whatever county/counties were run. Never exits non-zero — an instrument, not a gate (same
 * convention as probe-statewide-parcels.mjs and parcel-source-health-sweep.mjs).
 */
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchJson, matchFields } from "./probe-statewide-parcels.mjs";
import { CANDIDATES as STATE_CANDIDATES } from "./probe-statewide-parcels.mjs";
import { isCommercialPublisher } from "./lib/agolParcelSearch.mjs";
import { hostnameOf, isHostOpen, recordHostOutcome, waitForHostSlot } from "./lib/hostThrottle.mjs";
import { ENVELOPE_QUERY_BUDGET_MS, ENVELOPE_HALF_MILES, MILES_PER_DEG_LAT } from "./lib/statewideCoverage.mjs";
import { buildIndex, pointInRing } from "../src/workspaces/site-planner/lib/countyPolygonsCore.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const RESULTS_PATH = join(HERE, "discover-county-parcels-results.json");
const COUNTY_POLYGONS_PATH = join(ROOT, "public", "geo", "county-polygons.json");

const JSON_OUT = process.argv.includes("--json");
const argVal = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};

/* ---------------------------------------------------------------------------------------------
 * TIER 1 — the roster from the dispatch brief, verbatim: Hillwood markets where coverage is thin
 * or missing, and the three items already known to need a REPLACEMENT (a stale/wrong-scope source
 * already on record) rather than a fresh wire — `replace` names what's wrong so the ranking's
 * rejection rules are the thing that actually keeps the bad one out, not a hand-maintained skip list.
 * -------------------------------------------------------------------------------------------- */
export const TIER1_COUNTIES = [
  { county: "Fulton", state: "GA", metro: "Atlanta", replace: "Tax_Parcels2018 — 2018 vintage, superseded candidates must be newer" },
  { county: "Henry", state: "GA", metro: "Atlanta" },
  { county: "Bartow", state: "GA", metro: "Atlanta" },
  { county: "Cobb", state: "GA", metro: "Atlanta" },
  { county: "Chatham", state: "GA", metro: "Savannah" },
  { county: "Maricopa", state: "AZ", metro: "Phoenix", replace: "parcels_maricnty_2007 — a 2007 snapshot alongside 2019/2021 vintages; must resolve the most recent" },
  { county: "Pinal", state: "AZ", metro: "Phoenix" },
  { county: "Wayne", state: "MI", metro: "Detroit", replace: "Detroit_MP_Parcel_Authoritative — the CITY of Detroit, not Wayne COUNTY" },
  { county: "Macomb", state: "MI", metro: "Detroit" },
  { county: "Johnson", state: "KS", metro: "Kansas City" },
  { county: "Jackson", state: "MO", metro: "Kansas City" },
  { county: "Clay", state: "MO", metro: "Kansas City" },
  { county: "Greenville", state: "SC", metro: "Greenville–Spartanburg", replace: "Parcel_Sizes_2018_WFL1 — 2018 vintage" },
  { county: "Spartanburg", state: "SC", metro: "Greenville–Spartanburg" },
  { county: "Polk", state: "IA", metro: "Des Moines" },
  { county: "Luzerne", state: "PA", metro: "Northeast PA" },
  { county: "Lackawanna", state: "PA", metro: "Northeast PA" },
  { county: "Lehigh", state: "PA", metro: "Northeast PA", replace: "ATestParcel — a test service by its own name" },
  { county: "Orleans", state: "LA", metro: "New Orleans", parishName: "Orleans Parish" },
  { county: "Bernalillo", state: "NM", metro: "Albuquerque" },
  { county: "Winnebago", state: "IL", metro: "Rockford" },
  { county: "Kane", state: "IL", metro: "Chicago" },
];

/* ---------------------------------------------------------------------------------------------
 * County geometry — the SAME nationwide, shipped asset the app's own offline county resolver uses
 * (public/geo/county-polygons.json, decoded by the app's own pure countyPolygonsCore.js — imported
 * directly rather than re-implemented, so this harness's notion of "inside the county" can never
 * disagree with the app's). Gives every county real ring geometry with no network call.
 * -------------------------------------------------------------------------------------------- */
let _index = null;
function countyIndex() {
  if (_index) return _index;
  const raw = JSON.parse(readFileSync(COUNTY_POLYGONS_PATH, "utf8"));
  _index = buildIndex(raw);
  return _index;
}

const norm = (s) => String(s || "").toLowerCase().replace(/\s+county$|\s+parish$|\s+borough$/i, "").trim();

function findCountyRecord(countyName, stateAbbr) {
  const idx = countyIndex();
  const target = norm(countyName);
  return idx.counties.find((c) => c.state === stateAbbr && norm(c.name) === target) || null;
}

/* Three geometry-VERIFIED spread points inside a county — never just the county seat/centroid.
 * Scans a coarse grid across the county's own bbox, keeps only points `pointInRing` confirms are
 * truly inside, and picks three that are maximally spread (by simple pairwise distance). Returns
 * points in the asset's quantised units AND in real lat/lng (divided by `scale`). */
export function spreadProbePoints(record, scale, gridN = 9) {
  if (!record) return [];
  const [xmin, ymin, xmax, ymax] = record.bbox;
  const inside = [];
  for (let i = 0; i <= gridN; i++) {
    for (let j = 0; j <= gridN; j++) {
      const x = xmin + ((xmax - xmin) * i) / gridN;
      const y = ymin + ((ymax - ymin) * j) / gridN;
      if (record.rings.some((ring) => pointInRing(ring, x, y))) inside.push([x, y]);
    }
  }
  if (!inside.length) return [];
  // Greedy farthest-point sampling: start from the first hit, then repeatedly add whichever
  // remaining point is farthest from every point already chosen — cheap, no libraries, good enough
  // spread for a handful of points.
  const chosen = [inside[0]];
  while (chosen.length < 3 && chosen.length < inside.length) {
    let best = null, bestDist = -1;
    for (const p of inside) {
      if (chosen.includes(p)) continue;
      const d = Math.min(...chosen.map((c) => Math.hypot(p[0] - c[0], p[1] - c[1])));
      if (d > bestDist) { bestDist = d; best = p; }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen.map(([x, y]) => ({ lng: x / scale, lat: y / scale }));
}

/* ---------------------------------------------------------------------------------------------
 * Field-shape check — reuses probe-statewide-parcels.mjs's own FIELD_PATTERNS/matchFields so a
 * "parcelId"/"owner"/"situsAddress"/"landArea"/"appraisedValue" hint can never disagree between the
 * state-level probe and this county-level one.
 * -------------------------------------------------------------------------------------------- */
function ownershipShaped(fieldNames) {
  const m = matchFields(fieldNames || []);
  return Object.values(m).some((v) => v != null);
}

/* ---------------------------------------------------------------------------------------------
 * ITEM 2 — rejection + ranking. Hard rejects apply to every candidate before ranking; ranking then
 * orders whatever survives.
 * -------------------------------------------------------------------------------------------- */
/* ⛔ A PLAIN SUBSTRING MATCH, DELIBERATELY — NOT `\btest\b`. `\b` is a boundary between a \w and a
 * non-\w character, and a service/dataset title glues words together with no separator at all
 * ("ATestParcel", Lehigh PA's own named example from the dispatch brief) or with digits directly
 * against letters ("Tax_Parcels2018") — `\btest\b` cannot fire inside "ATestParcel" because "A" and
 * "T" are both word characters, exactly the same class of bug B1551616 already fixed for the `apn`
 * field pattern in probe-statewide-parcels.mjs. A false positive here (a legitimate title that
 * happens to contain "test" as a substring, e.g. "Latest Parcels") costs one candidate falling
 * through to the next-ranked one, or to the next route — a false NEGATIVE ships a test service as
 * authoritative, which is the worse failure this rule exists to prevent. */
export const REJECT_TITLE_RE = /test|demo|sandbox|draft|archive|historical/i;
export const STALE_YEAR_THRESHOLD = 5; // "older than a threshold" — see header; a real vintage may still be years old, this only screens an EXPLICITLY year-stamped title against a moving line
export const DERIVED_NAME_RE = /\bpoints?\b|\baddress(?:es)?\b|\bsummary\b|\bsummaries\b|\broll\b|\bcentroid/i;

// Same word-boundary trap as above: a year glued onto a word ("Parcels2018") has no `\b` before it
// because a letter and a digit are both \w. Bounded on DIGITS only (never matches inside a longer
// run of digits, e.g. a parcel id), which is what a title-embedded year actually needs.
function extractYear(text) {
  const m = /(?<!\d)(19[89]\d|20[0-2]\d)(?!\d)/.exec(String(text || ""));
  return m ? Number(m[1]) : null;
}

/* Reject a candidate outright (never ranked, never wired), or return null (survives to ranking).
 * `now` is injectable for a stable unit test — a real "current year" moves the STALE line every
 * year, which is the whole point (never a hardcoded cutoff). */
export function rejectCandidate(candidate, { now = new Date() } = {}) {
  const label = `${candidate.title || ""} ${candidate.serviceName || ""}`;
  if (REJECT_TITLE_RE.test(label)) return `test/demo/sandbox/draft/archive/historical title: "${candidate.title}"`;
  if (isCommercialPublisher({ owner: candidate.owner, orgName: candidate.orgName })) return "commercial data vendor";
  // A title-embedded year is checked FIRST (an explicit claim the publisher made); when the title
  // carries none, fall back to the service's own editingInfo date — a candidate with no year in its
  // NAME can still be a genuinely stale wire (Wayne County MI's own winning candidate, caught only
  // this way: no year in "Parcels - MI - Wayne County", but dataLastEditDate 2018 — 8 years stale).
  const titleYear = extractYear(label);
  const editYear = candidate.editDate ? new Date(candidate.editDate).getFullYear() : null;
  const year = titleYear ?? editYear;
  const basis = titleYear != null ? "name" : "its own last-edit date";
  if (year != null && now.getFullYear() - year > STALE_YEAR_THRESHOLD)
    return `stale vintage — ${year} (${basis}) is more than ${STALE_YEAR_THRESHOLD} years old`;
  return null;
}

const GOV_WORD_RE = /\bcounty\b|\bcity\b|\bdept\b|\bdepartment\b|\boffice\b|\bassessor\b|\bauditor\b|\bappraisal\b|\bgis\b|\bgovernment\b|\bstate\b|\btreasurer\b|\brecorder\b|\bboard of/i;
const PERSONAL_OWNER_RE = /^[a-z]+[._][a-z]+\d*$/i; // "jsmith_someorg", "j.smith" style personal handles

/* A 0..~15 score used to pick the best candidate a SINGLE route returned; not comparable across
 * different candidates' routes (a route only records which one WON, per the "try in order" design). */
export function rankScore(candidate, { now = new Date() } = {}) {
  let score = 0;
  const label = `${candidate.title || ""} ${candidate.serviceName || ""}`;
  const year = extractYear(label) ?? (candidate.editDate ? new Date(candidate.editDate).getFullYear() : null);
  if (year != null) score += Math.max(0, 10 - Math.max(0, now.getFullYear() - year)); // more recent = higher, floors at 0
  const org = `${candidate.owner || ""} ${candidate.orgName || ""}`;
  if (GOV_WORD_RE.test(org)) score += 5; // organizational publisher
  else if (!PERSONAL_OWNER_RE.test(candidate.owner || "")) score += 2; // unclear, but not obviously personal
  if (candidate.geometryType === "esriGeometryPolygon") score += 3;
  if (DERIVED_NAME_RE.test(label)) score -= 3; // soft demotion, never a hard reject
  return score;
}

export function vintageOf(candidate) {
  const label = `${candidate.title || ""} ${candidate.serviceName || ""}`;
  const namedYear = extractYear(label);
  if (namedYear) return { year: namedYear, basis: "name" };
  if (candidate.editDate) return { year: new Date(candidate.editDate).getFullYear(), basis: "editingInfo" };
  return { year: null, basis: "unknown" };
}

/* ---------------------------------------------------------------------------------------------
 * Acceptance test — the four bullets from the header, run against ONE candidate layer URL.
 * -------------------------------------------------------------------------------------------- */
async function measureLayer(url) {
  const meta = await fetchJson(`${url}?f=json`);
  if (!meta.ok || !meta.json) return { ok: false, blocked: !!meta.blocked, status: meta.status, error: meta.error };
  if (meta.json.error) return { ok: false, arcgisError: true, error: meta.json.error.message || "ArcGIS error" };
  const fieldNames = Array.isArray(meta.json.fields) ? meta.json.fields.map((f) => f.name) : [];
  const geometryType = meta.json.geometryType || null;
  const editDate = meta.json.editingInfo && (meta.json.editingInfo.dataLastEditDate || meta.json.editingInfo.lastEditDate) || null;
  return { ok: true, fieldNames, geometryType, editDate: editDate ? new Date(editDate).toISOString() : null };
}

async function envelopeAttrQuery(url, lat, lng) {
  const dLat = ENVELOPE_HALF_MILES / MILES_PER_DEG_LAT;
  const milesPerDegLng = MILES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180) || MILES_PER_DEG_LAT;
  const dLng = ENVELOPE_HALF_MILES / milesPerDegLng;
  const geometry = JSON.stringify({
    xmin: lng - dLng, ymin: lat - dLat, xmax: lng + dLng, ymax: lat + dLat,
    spatialReference: { wkid: 4326 },
  });
  const qs = new URLSearchParams({
    f: "json", geometry, geometryType: "esriGeometryEnvelope", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects", outFields: "*", returnGeometry: "false", resultRecordCount: "5",
  });
  const res = await fetchJson(`${url}/query?${qs}`, { timeout: ENVELOPE_QUERY_BUDGET_MS });
  const arcgisError = !!(res.json && res.json.error);
  const overBudget = !res.ok || res.ms > ENVELOPE_QUERY_BUDGET_MS || arcgisError;
  const features = !arcgisError && res.json && Array.isArray(res.json.features) ? res.json.features : [];
  return { ok: !overBudget && features.length > 0, ms: res.ms, blocked: !!res.blocked, overBudget, features, error: arcgisError ? res.json.error.message : res.error };
}

/* Runs the full acceptance test against one candidate. Returns { accepted, reasons, vintage, probes }. */
export async function acceptCandidate(candidate, spreadPoints, { now = new Date() } = {}) {
  const rejected = rejectCandidate(candidate, { now });
  if (rejected) return { accepted: false, reasons: [rejected], probes: [] };
  if (!candidate.url) return { accepted: false, reasons: ["no usable service/layer URL"], probes: [] };

  const meta = await measureLayer(candidate.url);
  if (!meta.ok) {
    const reason = meta.blocked ? `host blocked by this sandbox's egress policy — ${hostnameOf(candidate.url)}` : (meta.error || "unreachable");
    return { accepted: false, reasons: [reason], blocked: !!meta.blocked, probes: [] };
  }
  if (meta.geometryType !== "esriGeometryPolygon")
    return { accepted: false, reasons: [`not a polygon layer (${meta.geometryType || "unknown geometry"})`], probes: [] };
  if (!ownershipShaped(meta.fieldNames))
    return { accepted: false, reasons: [`no ownership-shaped field in schema: ${meta.fieldNames.join(", ")}`], probes: [] };

  const full = { ...candidate, geometryType: meta.geometryType, editDate: meta.editDate };
  const reReject = rejectCandidate(full, { now }); // editDate can surface a year rejectCandidate's title pass missed
  if (reReject) return { accepted: false, reasons: [reReject], probes: [] };

  if (!spreadPoints.length)
    return { accepted: false, reasons: ["no geometry-verified spread points available for this county (not in county-polygons.json)"], probes: [] };

  const probes = [];
  const allFeatures = [];
  for (const p of spreadPoints) {
    const r = await envelopeAttrQuery(candidate.url, p.lat, p.lng);
    probes.push({ ...p, ok: r.ok, ms: r.ms, featureCount: r.features.length, error: r.error });
    if (!r.ok) {
      return { accepted: false, reasons: [`spread point ${p.lat.toFixed(4)},${p.lng.toFixed(4)} — ${r.error || (r.ms > ENVELOPE_QUERY_BUDGET_MS ? "over timing budget" : "zero features")}`], probes };
    }
    allFeatures.push(...r.features);
  }
  // Ownership-shaped with a REAL value, not just schema — a field merely EXISTING is exactly how a
  // PLSS survey grid or an address-point layer would otherwise pass (see the ruled-out fixtures in
  // the dispatch brief). Checked across every feature every spread-point probe actually returned.
  const fields = matchFields(meta.fieldNames);
  const matchedFieldNames = Object.values(fields).filter(Boolean);
  const hasRealValue = allFeatures.some((f) =>
    matchedFieldNames.some((fn) => {
      const v = f.attributes && f.attributes[fn];
      return v != null && String(v).trim() !== "";
    }));
  if (!hasRealValue)
    return { accepted: false, reasons: [`ownership-shaped fields (${matchedFieldNames.join(", ")}) exist in the schema but every sampled feature returned them empty`], probes };

  return { accepted: true, reasons: [], vintage: vintageOf(full), fields, probes, geometryType: meta.geometryType, editDate: meta.editDate };
}

/* ---------------------------------------------------------------------------------------------
 * ROUTE 1 — ArcGIS Hub dataset API.
 * -------------------------------------------------------------------------------------------- */
async function route1Hub(county, stateName) {
  const queries = [`${county} County parcels`, `${county} County tax parcels`, `${county} County cadastral`, `${county} parcels ${stateName}`];
  const seen = new Map();
  for (const q of queries) {
    const res = await fetchJson(`https://hub.arcgis.com/api/v3/datasets?q=${encodeURIComponent(q)}`);
    const rows = (res.json && Array.isArray(res.json.data)) ? res.json.data : [];
    for (const row of rows) {
      const a = row.attributes || {};
      if (!a.url || seen.has(a.url)) continue;
      if (!/parcel|cadastr|tax.?lot|taxlot/i.test(`${a.name || ""}`)) continue;
      seen.set(a.url, {
        url: normalizeServiceUrl(a.url), title: a.name, owner: a.owner, orgName: a.source, orgId: a.orgId,
        serviceName: serviceNameFromUrl(a.url), route: "hub-datasets",
      });
    }
  }
  return [...seen.values()];
}

/* ---------------------------------------------------------------------------------------------
 * ROUTE 2 — ArcGIS Online item search.
 * -------------------------------------------------------------------------------------------- */
async function agolSearch(query) {
  const url = `https://www.arcgis.com/sharing/rest/search?f=json&num=15&sortField=numviews&sortOrder=desc&q=${encodeURIComponent(query)}`;
  const res = await fetchJson(url);
  return (res.json && Array.isArray(res.json.results)) ? res.json.results : [];
}

async function route2Agol(county, stateName, stateAbbr) {
  const queries = [
    `${county} County ${stateAbbr} parcels`, `${county} County parcels tax`, `${county} County cadastral`,
    `${county} County GIS parcels`, `${county} County assessor parcels`,
  ];
  const seen = new Map();
  for (const q of queries) {
    const results = await agolSearch(`${q} AND (type:"Feature Service" OR type:"Map Service") AND access:public`);
    for (const r of results) {
      if (!r.url || seen.has(r.url)) continue;
      if (!/parcel|cadastr|tax.?lot|taxlot/i.test(`${r.title || ""}`)) continue;
      seen.set(r.url, {
        url: normalizeServiceUrl(r.url), title: r.title, owner: r.owner, orgId: r.orgId,
        serviceName: serviceNameFromUrl(r.url), route: "agol-search",
      });
    }
  }
  // Resolve org NAMEs for whatever survived (cheap: a handful of items, not the whole result set).
  for (const c of seen.values()) {
    if (!c.orgId) continue;
    const org = await fetchJson(`https://www.arcgis.com/sharing/rest/portals/${encodeURIComponent(c.orgId)}?f=json`);
    c.orgName = (org.json && org.json.name) || null;
  }
  return [...seen.values()];
}

/* ---------------------------------------------------------------------------------------------
 * ROUTE 3 — county GIS hostname patterns (untried before this) + a REST-directory walk for a
 * parcel-ish service. Two seed sources: pattern-generated hostnames, and hostnames HARVESTED from
 * routes 1/2's raw hits (any distinct host appearing in a result whose owner/source/title names the
 * county, even on an unrelated layer — a county's air-photo service still reveals its GIS host).
 * -------------------------------------------------------------------------------------------- */
function candidateHostnames(county, stateAbbr, stateName, harvested) {
  const slug = String(county).toLowerCase().replace(/[^a-z]/g, "");
  const stAbbr = String(stateAbbr).toLowerCase();
  const stSlug = String(stateName).toLowerCase().replace(/[^a-z]/g, "");
  const patterns = [
    `gis.${slug}county${stAbbr}.gov`, `gis.${slug}co${stAbbr}.gov`, `gis.${slug}co.org`,
    `gis.${slug}county.gov`, `gis.${slug}county.org`, `gisdata.${slug}county.us`,
    `gis.${slug}county${stSlug}.com`, `gis.${slug}county${stSlug}.gov`,
    `maps.${slug}county.gov`, `www.${slug}county${stAbbr}.gov`,
  ];
  return [...new Set([...patterns, ...harvested])];
}

const REST_ROOTS = ["/arcgis/rest/services", "/server/rest/services", "/ArcGIS/rest/services"];
const PARCEL_SERVICE_RE = /parcel|cadastr|tax.?lot|taxlot|land.?record|assess/i;

async function listArcgisDir(url) {
  const r = await fetchJson(`${url}?f=json`);
  if (!r.ok || !r.json || r.json.error) return null;
  return { folders: Array.isArray(r.json.folders) ? r.json.folders : [], services: Array.isArray(r.json.services) ? r.json.services : [] };
}

async function pickPolygonLayer(serviceUrl) {
  const r = await fetchJson(`${serviceUrl}?f=json`);
  if (!r.ok || !r.json || r.json.error) return null;
  const layers = Array.isArray(r.json.layers) ? r.json.layers : [];
  if (!layers.length) return null;
  const polys = layers.filter((l) => /polygon/i.test(l.geometryType || ""));
  const named = polys.find((l) => /parcel/i.test(l.name || "")) || polys[0];
  return named ? named.id : null;
}

// ArcGIS folder listings report a service's `name` either bare ("Foo") or folder-prefixed
// ("Folder/Foo") depending on server version — same convention already debugged in
// serviceNeighbourWalk.mjs's `serviceEntryUrl`, mirrored here rather than cross-imported (it's not
// exported there, and this is a handful of lines).
function serviceEntryUrl(restBase, folder, entry) {
  const name = entry.name || "";
  const alreadyPrefixed = folder && (name === folder || name.startsWith(`${folder}/`));
  const path = alreadyPrefixed ? name : (folder ? `${folder}/${name}` : name);
  return `${restBase}/${path}/${entry.type}`;
}

async function walkHostForParcels(host) {
  const found = [];
  for (const rootPath of REST_ROOTS) {
    const rootUrl = `https://${host}${rootPath}`;
    if (isHostOpen(rootUrl)) continue; // breaker open — a prior probe this run already found this host unresponsive
    await waitForHostSlot(rootUrl);
    const rootStart = Date.now();
    const res = await fetchJson(`${rootUrl}?f=json`, { timeout: 12000 });
    recordHostOutcome(rootUrl, res.ok, Date.now() - rootStart);
    if (!res.ok || !res.json) continue; // host down, or (in this sandbox) blocked — caller reports why
    const root = { folders: Array.isArray(res.json.folders) ? res.json.folders : [], services: Array.isArray(res.json.services) ? res.json.services : [] };
    const foldersToCheck = [{ folder: "", dir: root }];
    for (const f of root.folders.slice(0, 15)) {
      const sub = await listArcgisDir(`${rootUrl}/${f}`);
      if (sub) foldersToCheck.push({ folder: f, dir: sub });
    }
    for (const { folder, dir } of foldersToCheck) {
      for (const svc of dir.services) {
        if (svc.type !== "MapServer" && svc.type !== "FeatureServer") continue;
        if (!PARCEL_SERVICE_RE.test(svc.name || "")) continue;
        const svcUrl = serviceEntryUrl(rootUrl, folder, svc);
        const layerId = await pickPolygonLayer(svcUrl);
        if (layerId == null) continue;
        found.push({
          url: `${svcUrl}/${layerId}`, title: svc.name, owner: host, orgName: host,
          serviceName: svc.name, route: "county-hostname",
        });
      }
    }
    if (found.length) break; // this host answered — no need to also try the other REST root shapes
  }
  return found;
}

// A per-host attempt is 1-3 REST-root probes, each with its own timeout, so serialising every
// candidate hostname (most of which are pattern GUESSES that will simply not resolve) can run
// past ten minutes for one county. Hosts are independent, so they're walked with bounded
// concurrency; "in order until one passes" is honoured by picking the first host (by ORIGINAL
// array position, not completion order) that found something, once every attempt has settled.
async function route3Hostname(county, stateAbbr, stateName, harvestedHosts) {
  const hosts = candidateHostnames(county, stateAbbr, stateName, harvestedHosts);
  const results = await mapLimit(hosts, CANDIDATE_CONCURRENCY, (host) =>
    walkHostForParcels(host).then((found) => ({ host, found, error: null }), (e) => ({ host, found: [], error: String(e) })));
  const attempts = results.map((r) => (r.error ? { host: r.host, error: r.error } : { host: r.host, foundServices: r.found.length }));
  const winner = results.find((r) => r.found.length > 0);
  return { candidates: winner ? winner.found : [], attempts };
}

/* ---------------------------------------------------------------------------------------------
 * ROUTE 4 — the state's own open-data organization, filtered to the county. Implemented as an AGOL/
 * Hub search pass biased toward state-run open-data catalogs (query phrasing + a light publisher
 * check for a state-level org), rather than route 2's plain keyword search.
 * -------------------------------------------------------------------------------------------- */
async function route4StateOpenData(county, stateName, stateAbbr) {
  const queries = [
    `${stateName} GIS Open Data ${county} County parcels`,
    `${stateName} Geospatial Clearinghouse ${county} County parcels`,
    `${stateName} open data ${county} County cadastral`,
  ];
  const seen = new Map();
  for (const q of queries) {
    const results = await agolSearch(`${q} AND (type:"Feature Service" OR type:"Map Service") AND access:public`);
    for (const r of results) {
      if (!r.url || seen.has(r.url)) continue;
      if (!/parcel|cadastr|tax.?lot|taxlot/i.test(`${r.title || ""}`)) continue;
      seen.set(r.url, {
        url: normalizeServiceUrl(r.url), title: r.title, owner: r.owner, orgId: r.orgId,
        serviceName: serviceNameFromUrl(r.url), route: "state-open-data",
      });
    }
  }
  for (const c of seen.values()) {
    if (!c.orgId) continue;
    const org = await fetchJson(`https://www.arcgis.com/sharing/rest/portals/${encodeURIComponent(c.orgId)}?f=json`);
    c.orgName = (org.json && org.json.name) || null;
  }
  return [...seen.values()];
}

/* ---------------------------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------------------------- */
function serviceNameFromUrl(url) {
  const parts = String(url || "").replace(/\/+$/, "").split("/");
  return parts[parts.length - 2] || parts[parts.length - 1] || "";
}
// A search item's `url` is a SERVICE root (…/FeatureServer, …/MapServer); this probe wants a LAYER.
// Layer 0 is a guess, always MEASURED (never trusted) by acceptCandidate before being believed.
function normalizeServiceUrl(url) {
  const u = String(url || "").replace(/\/+$/, "");
  if (/\/(Feature|Map)Server\/\d+$/i.test(u)) return u;
  if (/\/(Feature|Map)Server$/i.test(u)) return `${u}/0`;
  return u;
}
function harvestHostnames(rows, county) {
  const target = norm(county);
  const hosts = new Set();
  for (const r of rows) {
    const hay = `${r.title || r.name || ""} ${r.owner || ""} ${r.source || ""} ${r.orgName || ""}`.toLowerCase();
    if (!hay.includes(target)) continue;
    const h = hostnameOf(r.url || "");
    if (h && !/\.arcgis\.com$/i.test(h)) hosts.add(h);
  }
  return [...hosts];
}

/* ---------------------------------------------------------------------------------------------
 * Per-county pipeline — try routes IN ORDER, stop at the first that produces an ACCEPTED candidate.
 * -------------------------------------------------------------------------------------------- */
export async function discoverCounty({ county, state, parishName, replace }) {
  const stateName = (STATE_CANDIDATES[state] && STATE_CANDIDATES[state].name) || state;
  const record = findCountyRecord(parishName || county, state);
  const idx = record ? countyIndex() : null;
  const spread = record ? spreadProbePoints(record, idx.scale) : [];

  const out = {
    county, state, stateName, replace: replace || null,
    spreadPointsUsed: spread.length,
    routesAttempted: [], chosen: null, rejected: [],
  };

  // Route 1 — always run first so its raw hits can seed route 3's hostname harvest even if route 1
  // itself doesn't win.
  const hub = await route1Hub(county, stateName);
  out.routesAttempted.push({ route: "hub-datasets", candidatesFound: hub.length });
  let winner = await pickWinner(hub, spread, "hub-datasets", out.rejected);
  if (winner) { out.chosen = winner; return out; }

  const agol = await route2Agol(county, stateName, state);
  out.routesAttempted.push({ route: "agol-search", candidatesFound: agol.length });
  winner = await pickWinner(agol, spread, "agol-search", out.rejected);
  if (winner) { out.chosen = winner; return out; }

  const harvested = harvestHostnames([...hub, ...agol], county);
  const r3 = await route3Hostname(county, state, stateName, harvested);
  out.routesAttempted.push({ route: "county-hostname", candidatesFound: r3.candidates.length, hostsAttempted: r3.attempts });
  winner = await pickWinner(r3.candidates, spread, "county-hostname", out.rejected);
  if (winner) { out.chosen = winner; return out; }

  const opendata = await route4StateOpenData(county, stateName, state);
  out.routesAttempted.push({ route: "state-open-data", candidatesFound: opendata.length });
  winner = await pickWinner(opendata, spread, "state-open-data", out.rejected);
  if (winner) { out.chosen = winner; return out; }

  return out;
}

// Bounded-concurrency map — candidates are independent (different hosts, mostly), so evaluating
// them one at a time serialises the SUM of every candidate's own timeout (a county with 15
// candidates, several genuinely slow/unreachable rather than a fast-fail 403, can serialise past
// ten minutes). A cap of 4 keeps this a reasonable network citizen while bounding wall-clock by the
// SLOWEST candidate in a batch rather than their sum.
const CANDIDATE_CONCURRENCY = 4;
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function pickWinner(candidates, spread, routeLabel, rejectedOut) {
  const verdicts = await mapLimit(candidates, CANDIDATE_CONCURRENCY, (c) => acceptCandidate(c, spread));
  const measured = [];
  candidates.forEach((c, i) => {
    const verdict = verdicts[i];
    if (verdict.accepted) measured.push({ ...c, ...verdict, score: rankScore({ ...c, ...verdict }) });
    else rejectedOut.push({ ...c, route: routeLabel, reasons: verdict.reasons, blocked: !!verdict.blocked });
  });
  if (!measured.length) return null;
  measured.sort((a, b) => b.score - a.score);
  return measured[0];
}

/* ---------------------------------------------------------------------------------------------
 * Output
 * -------------------------------------------------------------------------------------------- */
function humanSummary(results) {
  const lines = [];
  for (const r of results) {
    if (r.chosen) {
      const c = r.chosen;
      lines.push(`✅ ${r.county} County, ${r.state} — via ${c.route} — "${c.title}" (vintage: ${c.vintage.year || "unknown"}/${c.vintage.basis}) → ${c.url}`);
    } else {
      const blockedHosts = r.rejected.filter((x) => x.blocked).length;
      lines.push(`⛔ ${r.county} County, ${r.state} — not found by routes 1–4${blockedHosts ? ` (${blockedHosts} candidate host(s) blocked by this sandbox's egress policy — see rejected[])` : ""}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  let list;
  if (process.argv.includes("--tier1")) list = TIER1_COUNTIES;
  else if (argVal("--list")) list = JSON.parse(readFileSync(argVal("--list"), "utf8"));
  else if (argVal("--county") && argVal("--state")) list = [{ county: argVal("--county"), state: argVal("--state") }];
  else {
    console.error("Usage: node discover-county-parcels.mjs --county <name> --state <XX> | --tier1 | --list <file.json> [--json]");
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const entry of list) {
    console.error(`[discover] ${entry.county} County, ${entry.state}…`);
    const r = await discoverCounty(entry);
    results.push(r);
    // Written after EVERY county, not just at the end — a long `--tier1`/`--list` run against many
    // counties (each one several seconds of real network round trips) risks an interruption losing
    // every already-completed result if the write only happened once at the finish line.
    writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(humanSummary(results));
    console.log(`\nFull machine-readable results: ${RESULTS_PATH}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
