/* Site Analysis (B147) — environmental / regulatory / infrastructure screening run
 * against the DISSOLVED FOOTPRINT of the active parcels (B100's `activeParcelsOf`).
 *
 * This is ONE registry-driven surface, not a parallel system: it rides the same
 * generic ArcGIS-REST connector pattern as the jurisdiction identify (jurisdiction.js),
 * the same browser-local SWR cache (gisCache.js, B96), the same honest per-source
 * status + visible data-age, and the same EPSG:4326 lon/lat boundary as the parcel
 * identify. Adding a category source = adding a ROW to ANALYSIS_SOURCES, never new code.
 *
 * ★ Silent-error principle (HIGH severity, from the backlog + KEY DECISIONS):
 *   "Unknown / source unavailable" is a DISTINCT state from "not present." A failed or
 *   timed-out source must NEVER render as "no constraint," and a source we have not
 *   verified must never assert a confident "none found" off an empty response (that
 *   would be a fabricated all-clear). So a finding's status is:
 *     present  — features intersect the site (the constraint IS there)
 *     absent   — query succeeded, returned nothing, AND the source is `verified` (safe
 *                to read as a real "none found")
 *     unknown  — the query errored, OR returned empty from a NOT-yet-verified source,
 *                OR the source has no endpoint wired yet (pending)
 *     info     — non presence/absence facts (jurisdiction, road authority, zoning)
 *
 * Screening only — every finding carries its own source + data-age + a category-specific
 * caveat. Never a legal determination; a wrong "all clear" on a live deal is liability.
 */

import { gisCache as defaultCache } from "./gisCache.js";
import { identifyJurisdiction, identifyRoadAuthority } from "./jurisdiction.js";
import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import { fetchArcgisJson, gisErrorMessage, pLimit, GIS_MAX_GET_URL } from "./gisFetch.js";
import { classifyCcn } from "./ccnClassify.js";
import { screenProximity, fmtDistFt } from "./proximityScreen.js";
import { summarizeWells } from "./wellStatus.js";

const DAY = 24 * 3600 * 1000;

// Map a registry row (the ONE source of truth for endpoints, B369) → the endpoint-
// bearing fields analyzeSource consumes. The screen's *interpretation* (summarize /
// detail / caveat / absentLabel) stays local; the URL / layer / fields / provider come
// from the registry, so NO service URL is ever inline in this file. Pure.
function reg(key) {
  const s = GIS_SOURCES[key];
  const layerField = Array.isArray(s.layerId)
    ? { layers: s.layerId }
    : s.layerId != null ? { layer: s.layerId } : { layer: null };
  return {
    url: s.serviceUrl,
    ...layerField,
    fields: s.fields,
    ...(s.outFields ? { outFields: s.outFields.join(",") } : {}),
    // NEW-2/B789: an optional per-source screening-fetch timeout override (e.g. flood → 20 s),
    // forwarded to fetchArcgisJson so a slow-but-healthy national source (FEMA answered in ~9.5 s
    // during the 2026-07-11 slowdown) isn't aborted by the 9 s default a hair too early.
    ...(s.timeoutMs ? { timeoutMs: s.timeoutMs } : {}),
    sourceName: s.provider,
    tier: s.tier,
  };
}

// ---------------------------------------------------------------------------
// Source registry — one row per category source. `kind:"polygon"` = a parcel
// intersect (returns the intersecting features). `layer`/`layers` pick the
// MapServer sublayer(s) to query. `verified:true` means an empty result is a
// trustworthy "none found" (else empty → honest unknown). `pending:true` (no url)
// = a category we want surfaced but have not wired a confirmed source for yet, so
// it reads "source not connected" (NOT "none"). `summarize`/`detail` are pure.
// ---------------------------------------------------------------------------
export const ANALYSIS_SOURCES = [
  {
    id: "flood", category: "Floodplain", label: "FEMA flood zones", kind: "polygon",
    mapLayer: "fema", // overlay id in lib/layers.js (B190 "show on map")
    // Endpoint (NFHL layer 28 = Flood Hazard Zones / S_Fld_Haz_Ar) comes from the registry.
    ...reg("flood"),
    ttl: 7 * DAY, verified: true,
    absentLabel: "No mapped Special Flood Hazard Area (typically Zone X / minimal risk)",
    caveat: "FEMA's digital flood maps (NFHL). Screening only — confirm against the current effective FIRM / any LOMA and a survey before finished-floor design.",
    // Flood is the ONE screening layer whose source also returns the ALL-CLEAR zones
    // (Zone X) as polygons — so "a feature intersects" is NOT "a flood constraint." Classify
    // by ZONE, not mere presence (B147 false-positive fix): only a Special Flood Hazard Area
    // (A*/V*) is a present constraint; Zone X is none-found / (0.2% shaded) info; D is unknown.
    classify: (rows, src) => classifyFlood(rows, src),
    summarize: (rows) => zoneSummary(rows),
    detail: (rows) => zoneDetail(rows),
  },
  {
    id: "wetlands", category: "Wetlands", label: "USFWS NWI wetlands", kind: "polygon",
    mapLayer: "wetlands",
    // NWI split layers (1 = CONUS East, 2 = CONUS West; Texas is West). JOINED layers
    // (Wetlands ⋈ NWI_Wetland_Codes), so the server reports fields TABLE-QUALIFIED (e.g.
    // "Wetlands_CONUS_West.WETLAND_TYPE"); the registry pins outFields:"*" and we strip the
    // table prefix in normalizeAttrs(). The endpoint is a MONITORED EXCEPTION in the
    // registry (USFWS only publishes polygon-query on its "Test" folder — see B369).
    ...reg("wetlands"),
    ttl: 7 * DAY, verified: true,
    absentLabel: "No NWI-mapped wetlands on the site (screening only — not a delineation)",
    caveat: "NWI is a desktop screen — NOT a jurisdictional delineation. A consultant delineation + USACE verification is required for any real determination.",
    summarize: (rows) => wetlandSummary(rows),
    detail: (rows) => wetlandDetail(rows),
  },
  {
    id: "oilgas", category: "Oil & gas wells", label: "Oil & gas well surface locations", kind: "polygon",
    mapLayer: "txrrc_wells",
    // AUTHORITATIVE statewide Railroad Commission service (registry key "oilgas"). Replaces
    // the Harris-County GIS republication that was ~99.8% incomplete outside Harris — a
    // silent false-clean on Chambers-County sites like Mont Belvieu (B368). Fields: the
    // RRC layer-1 columns (API / SYMNUM / GIS_SYMBOL_DESCRIPTION / GIS_WELL_NUMBER).
    // PHASE 4: proximity screen (wells on/near the site) with a STATUS BREAKDOWN + an
    // offset/replug RISK flag when a well sits on the footprint. `classifyProx` (wellStatus.js)
    // reads SYMNUM / GIS_SYMBOL_DESCRIPTION → producing / plugged / dry / injection, and flags
    // on-site wells. Replaces the old count-only "N wells on/adjacent" summary.
    ...reg("oilgas"),
    screenMode: "proximity", bufferMi: 0.25, ttl: 30 * DAY, verified: true,
    plural: "well(s)",
    absentLabel: "No mapped oil & gas wells within a quarter-mile",
    classifyProx: (scr, ctx) => summarizeWells(scr, ctx),
    caveat: "RRC well points are schematic and historic locations can be inaccurate or unmapped (orphaned wells). A well on the pad is an offset/replug risk — an old plug may not meet modern standards, and a producing well forces setbacks. An RRC records search — possibly a survey — is the real check.",
  },
  {
    id: "pipelines", category: "Pipelines", label: "Pipelines (RRC T-4)", kind: "polygon",
    mapLayer: "txrrc_pipe",
    // AUTHORITATIVE statewide RRC pipelines (registry key "pipelines", layer 13). Replaces
    // the Harris-clipped republication (B368). Fields: OPERATOR / COMMODITY_DESCRIPTION /
    // DIAMETER / STATUS / SYSTEM_NAME / COUNTY_NAME.
    ...reg("pipelines"),
    ttl: 30 * DAY, verified: true, countMode: true,
    absentLabel: "No mapped RRC pipelines crossing the site",
    caveat: "RRC T-4 permit routes are SCHEMATIC, not surveyed alignments — and public pipeline data is deliberately low-resolution. Trigger 811 / one-call + operator outreach; never treat as a precise location.",
    summarize: (rows, total) => pipelineSummary(rows, total),
    detail: (rows) => uniq(rows.map((r) => [r.OPERATOR, r.COMMODITY_DESCRIPTION].filter(Boolean).join(" · "))).slice(0, 6),
  },
  {
    // Environmental contamination pre-screen (PHASE 2) — TCEQ leaking-tank sites near the
    // parcel, by PROXIMITY (count + nearest distance + names within a 1-mi buffer). Registry
    // `lpst`. Labeled a Phase I ESA PRE-SCREEN, never a substitute.
    id: "lpst", category: "Leaking petroleum tanks (TCEQ LPST)", label: "TCEQ LPST sites", kind: "point",
    mapLayer: "env_lpst",
    ...reg("lpst"),
    screenMode: "proximity", bufferMi: 1, ttl: 30 * DAY, verified: true,
    plural: "LPST site(s)",
    absentLabel: "No mapped TCEQ LPST (leaking-tank) sites within 1 mi",
    caveat: "Phase I ESA PRE-SCREEN only — NOT a substitute for a Phase I ESA. TCEQ Leaking Petroleum Storage Tank sites are documented petroleum-UST releases; a records review / environmental consultant is the authoritative check. Historic/closed cases can be inaccurate or unmapped.",
  },
  {
    // Environmental contamination pre-screen (PHASE 2) — EPA Superfund (NPL) + RCRA cleanup
    // sites near the parcel, by PROXIMITY. Registry `epaCleanups`; MAP_SYMBOL_CODE → program tag.
    id: "epaCleanups", category: "EPA Superfund / RCRA cleanups", label: "EPA cleanup sites", kind: "point",
    mapLayer: "env_cleanups",
    ...reg("epaCleanups"),
    screenMode: "proximity", bufferMi: 1, ttl: 30 * DAY, verified: true,
    plural: "EPA cleanup site(s)",
    absentLabel: "No mapped EPA Superfund/RCRA cleanup sites within 1 mi",
    proxTag: (a) => epaProgram(a && a.MAP_SYMBOL_CODE),
    caveat: "Phase I ESA PRE-SCREEN only — NOT a substitute for a Phase I ESA. EPA Superfund (NPL/non-NPL) + RCRA corrective-action sites; a records review / environmental consultant is the authoritative check.",
  },
  {
    // Active surface faults (PHASE 3) — Houston growth-fault traces crossing or near the parcel,
    // by PROXIMITY to the fault LINES (the proximity engine handles line geometry). onSiteLabel
    // makes a 0-ft nearest read "crosses the site" (a fault through the footprint is a real flag).
    id: "growthFaults", category: "Active surface faults", label: "Houston-area growth faults", kind: "line",
    mapLayer: "faults",
    ...reg("growthFaults"),
    screenMode: "proximity", bufferMi: 0.25, ttl: 30 * DAY, verified: true,
    plural: "fault trace(s)", onSiteLabel: "crosses the site",
    absentLabel: "No mapped growth-fault traces within a quarter-mile",
    caveat: "Houston-area active growth faults (aseismic slow-slip faults that crack foundations, slabs, and pavement over time). A trace crossing or near the site is a real design constraint — set structures/ponds off the trace and get a geotechnical/fault study. Screening only; a community-hosted republication of the USGS Houston fault map (SIM 2874).",
  },
  {
    // Zoning / entitlement — derived from the jurisdiction result rather than a single
    // statewide layer (zoning is per-city, and City of Houston has NONE). Filled in by
    // deriveZoning() from the jurisdiction finding; left here so it always appears.
    id: "zoning", category: "Zoning / entitlement",
    label: "Zoning & entitlement context", derived: true,
    sourceName: "Derived from jurisdiction",
    caveat: "Zoning is jurisdiction-specific (City of Houston has no zoning; ETJ and other cities vary). Confirm platting/entitlement requirements with the jurisdiction.",
  },
  {
    // Water CCN (public-data screening PHASE 1) — WHO holds the PUC certificate to serve
    // the site with water (a city, MUD, WSC, private utility …), or NONE (well / new CCN).
    // Statewide authoritative source (TWDB-hosted PUCT CCN) via the registry. CCN is a
    // FACT not a good/bad constraint, so classifyCcn returns `info` for both outcomes.
    id: "ccnWater", category: "Water service (CCN)", label: "Water CCN service area", kind: "polygon",
    mapLayer: "ccn_service", // both CCN cards drive the one Water/sewer CCN overlay (B190 "◍ Map")
    ...reg("ccnWater"),
    ttl: 30 * DAY, verified: true,
    classify: (rows) => classifyCcn(rows, { service: "water" }),
    caveat: "PUC water CCN — the certificated retail provider for the site (or none → likely city-served / a well). STATUS separates an approved certificate from a pending docket. Screening only; confirm service, capacity, and tap availability with the utility and the PUC.",
  },
  {
    // Sewer CCN (PHASE 1). No statewide sewer-CCN REST endpoint exists, so this rides the
    // Harris County GIS re-serve (registry `ccnSewer`, EPSG:2278) — REGIONAL (Houston MSA)
    // coverage, so the empty message is hedged (regional:true), never a green all-clear.
    id: "ccnSewer", category: "Sewer service (CCN)", label: "Sewer CCN service area", kind: "polygon",
    mapLayer: "ccn_service",
    ...reg("ccnSewer"),
    ttl: 30 * DAY, verified: true,
    classify: (rows) => classifyCcn(rows, { service: "sewer", regional: true }),
    caveat: "PUC sewer CCN, Houston-region coverage (no statewide sewer-CCN service exists yet). A site with no sewer CCN likely needs septic / on-site treatment or a new CCN. Screening only — confirm with the utility and the PUC.",
  },
];

// ---------------------------------------------------------------------------
// Pure geometry helpers
// ---------------------------------------------------------------------------
const trimUrl = (s) => String(s).replace(/\/+$/, "");
const closeRing = (r) => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);

// Decimate a dense ring so the GET /query URL stays within length limits (endpoints
// always kept). A parcel boundary is normally tiny; a heavily-digitized one decimates.
export function simplifyRing(ring, max = 60) {
  if (!ring || ring.length <= max) return ring || [];
  const step = (ring.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(ring[Math.round(i * step)]);
  return out;
}

// Lon/lat bounding box of one or many rings → [minLng, minLat, maxLng, maxLat].
export function ringsBBox(rings) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y;
  }
  return [minx, miny, maxx, maxy];
}

// Centroid of a single ring's bbox — a representative point for the point-based
// jurisdiction/road lookups (those also receive the ring for the whole-parcel test).
export function ringCentroid(ring) {
  const [minx, miny, maxx, maxy] = ringsBBox([ring]);
  return { lng: (minx + maxx) / 2, lat: (miny + maxy) / 2 };
}

// The largest-area ring of the set — used as the single representative ring for the
// jurisdiction/road connectors (which take one ring). Pure.
export function representativeRing(rings) {
  if (!rings || !rings.length) return null;
  let best = rings[0], bestA = -1;
  for (const r of rings) {
    let a = 0;
    for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; }
    a = Math.abs(a) / 2;
    if (a > bestA) { bestA = a; best = r; }
  }
  return best;
}

// Short, stable cache signature for a parcel set (ring count + rounded bbox).
export function ringsSignature(rings) {
  const [a, b, c, d] = ringsBBox(rings);
  return rings.length + "_" + [a, b, c, d].map((n) => (Number.isFinite(n) ? n.toFixed(4) : "x")).join(",");
}

// Build the ArcGIS /query params: the active parcels as a single multipolygon,
// intersect test, attributes only (no geometry — we only need presence + fields).
export function buildAnalysisParams(source, rings) {
  // `outFields:"*"` is required for JOINED layers whose field names are table-qualified
  // and differ per sublayer (NWI East/West) — see the wetlands source. Otherwise we ask
  // for just the fields we summarize (smaller response). A bad/renamed field name is what
  // 400'd three sources (B189), so this stays driven off the verified registry.
  const outFields = source.outFields || Object.values(source.fields || {}).filter(Boolean).join(",") || "*";
  return {
    f: "json",
    where: "1=1",
    geometry: JSON.stringify({ rings: rings.map((r) => closeRing(simplifyRing(r))), spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPolygon",
    spatialRel: "esriSpatialRelIntersects",
    inSR: 4326, outSR: 4326,
    outFields,
    returnGeometry: "false",
    resultRecordCount: source.countMode ? 200 : 30,
  };
}

export function buildQueryUrl(base, layer, params) {
  const u = new URL(trimUrl(base) + (layer != null ? "/" + layer : "") + "/query");
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  return u.toString();
}

// ArcGIS JOINED / related layers prefix each field with its source table
// ("Wetlands_CONUS_West.WETLAND_TYPE"). Strip that qualifier so the summarizers can read
// plain names (`r.WETLAND_TYPE`); on a collision keep the first non-empty value. A field
// name never contains a dot otherwise, so this is a no-op for unjoined layers. Pure.
export function normalizeAttrs(attrs) {
  if (!attrs) return {};
  const out = {};
  for (const [k, v] of Object.entries(attrs)) {
    const short = k.includes(".") ? k.slice(k.lastIndexOf(".") + 1) : k;
    if (!(short in out) || out[short] == null || out[short] === "") out[short] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-category summarizers (pure)
// ---------------------------------------------------------------------------
const uniq = (a) => Array.from(new Set(a.filter((v) => v != null && v !== "")));

export function zoneSummary(rows) {
  const zones = uniq(rows.map((r) => r.FLD_ZONE).map((z) => String(z).trim()));
  if (!zones.length) return "Flood hazard area present";
  return "Zone " + zones.join(", ");
}
function zoneDetail(rows) {
  const seen = new Map();
  for (const r of rows) {
    const z = String(r.FLD_ZONE ?? "").trim();
    if (!z) continue;
    const sub = String(r.ZONE_SUBTY ?? "").trim();
    const bfe = r.STATIC_BFE != null && Number(r.STATIC_BFE) > -9000 ? `BFE ${r.STATIC_BFE}′` : "";
    const label = ["Zone " + z, sub, bfe].filter(Boolean).join(" — ");
    seen.set(label, true);
  }
  return Array.from(seen.keys());
}

// FEMA Special Flood Hazard Area (SFHA) zone codes — the regulatory 1%-annual-chance
// (100-yr) floodplain that triggers flood-insurance + floodplain-development rules.
// Everything ELSE the NFHL returns (X, D, OPEN WATER, AREA NOT INCLUDED) is NOT an SFHA;
// Zone X in particular is the MINIMAL-risk zone — the all-clear, never a constraint.
const SFHA_ZONES = new Set(["A", "AE", "AH", "AO", "AR", "A99", "V", "VE", "VO",
  "AR/AE", "AR/AH", "AR/AO", "AR/A", "AR/A99"]);
export function isSFHA(zone) {
  const z = String(zone == null ? "" : zone).trim().toUpperCase();
  if (!z) return false;
  if (SFHA_ZONES.has(z)) return true;
  return /^(A|V)([1-9]|[12][0-9]|30)$/.test(z); // legacy numbered zones A1-A30 / V1-V30
}
// Shaded Zone X = the 0.2%-annual-chance (500-yr) area: moderate, but NOT an SFHA.
const isShadedX = (r) => /0\.2\s*pct|0\.2\s*%|\b500[-\s]?(?:yr|year)/i.test(String(r && r.ZONE_SUBTY != null ? r.ZONE_SUBTY : ""));

/* Flood status, zone-aware (B147 false-positive fix). The generic classifier marks ANY
 * returned feature "present," but the FEMA NFHL returns Zone X (the minimal-risk all-clear)
 * as polygons too — which wrongly flagged "constraint present" on the majority of sites.
 * Decide by zone instead:
 *   present — any Special Flood Hazard Area (A / AE / V / VE …): the regulatory 100-yr floodplain
 *   info    — no SFHA, but the 0.2% (500-yr) shaded Zone X touches the site (moderate)
 *   unknown — Zone D (flood hazard undetermined; FEMA hasn't studied the area — not clear)
 *   absent  — empty, or only unshaded Zone X / open water (outside any mapped SFHA)
 * Pure. */
export function classifyFlood(rows, source = {}) {
  const none = source.absentLabel || "No mapped Special Flood Hazard Area (Zone X / minimal risk)";
  if (!rows || !rows.length) return { status: "absent", summary: none, detail: [] };
  const sfha = rows.filter((r) => isSFHA(r.FLD_ZONE));
  if (sfha.length) return { status: "present", summary: zoneSummary(sfha), detail: zoneDetail(sfha) };
  if (rows.some(isShadedX)) {
    return { status: "info", detail: zoneDetail(rows),
      summary: "Outside the SFHA, but within the 0.2%-annual-chance (500-yr) shaded Zone X — moderate flood risk, not the regulatory floodplain." };
  }
  if (rows.some((r) => String(r && r.FLD_ZONE != null ? r.FLD_ZONE : "").trim().toUpperCase() === "D")) {
    return { status: "unknown", detail: [],
      summary: "Zone D — flood hazard undetermined; FEMA has not studied this area (not an all-clear)." };
  }
  return { status: "absent", summary: none, detail: zoneDetail(rows) };
}

export function wetlandSummary(rows) {
  const types = uniq(rows.map((r) => r.WETLAND_TYPE));
  if (!types.length) return "Mapped wetlands present";
  return types.join(", ");
}
function wetlandDetail(rows) {
  return uniq(rows.map((r) => [r.WETLAND_TYPE, r.ATTRIBUTE].filter(Boolean).join(" · "))).slice(0, 8);
}

export function pipelineSummary(rows, total) {
  const ops = uniq(rows.map((r) => r.OPERATOR));
  const n = total != null ? total : rows.length;
  const head = `${n} pipeline segment${n === 1 ? "" : "s"}`;
  return ops.length ? `${head} — ${ops.slice(0, 3).join(", ")}${ops.length > 3 ? "…" : ""}` : head;
}

// Classify a fetched result into a finding status (pure). `attrs` is the feature
// attribute list (or null on a hard fetch error with no last-good copy).
//   present     — features intersect the site
//   absent      — empty AND the source is verified (a trustworthy "none found")
//   unavailable — a hard error with no cached copy (RETRYABLE; amber + a Retry control).
//                 Distinct from "absent": NEVER read as clear (the silent-error guard).
//   unknown     — empty from a not-yet-verified source (screened, but can't be trusted clear)
export function classifyStatus(attrs, { error, verified }) {
  if (error || attrs == null) return "unavailable";
  if (attrs.length > 0) return "present";
  return verified ? "absent" : "unknown";
}

// ---------------------------------------------------------------------------
// Connector — one source against the parcel rings, riding the SWR cache.
// ---------------------------------------------------------------------------
// The real browser fetch is the shared resilient one (B366): AbortController timeout +
// jittered-backoff retry on a transient 5xx/network blip + automatic GET→POST for a long
// geometry URL. Tests inject their own `fetchJson` and bypass this.
const defaultFetchJson = (url, opts) => fetchArcgisJson(url, opts);

// Query one MapServer sublayer for a source. Builds the GET /query URL; if a dense
// parcel polygon makes it over-long, POSTs the params instead (dodges server URL caps).
function queryLayer(source, layer, rings, fetchJson) {
  const params = buildAnalysisParams(source, rings);
  const getUrl = buildQueryUrl(source.url, layer, params);
  // NEW-2/B789: forward the source's per-source timeout override (if any) to the fetch layer.
  const t = source.timeoutMs ? { timeoutMs: source.timeoutMs } : null;
  if (getUrl.length > GIS_MAX_GET_URL) {
    return fetchJson(buildQueryUrl(source.url, layer, {}), { body: params, ...(t || {}) });
  }
  return fetchJson(getUrl, t || undefined);
}

// Exact intersecting-feature COUNT for a count-mode source (wells / pipelines). Uses
// returnCountOnly so the number is the true total, NOT the page-size cap (resultRecordCount)
// — a dense RRC corridor has thousands of segments, far past any single page. Pure.
function countLayer(source, layer, rings, fetchJson) {
  const params = { ...buildAnalysisParams(source, rings), returnCountOnly: true };
  delete params.outFields; delete params.resultRecordCount; delete params.returnGeometry;
  const getUrl = buildQueryUrl(source.url, layer, params);
  const t = source.timeoutMs ? { timeoutMs: source.timeoutMs } : null; // NEW-2/B789 per-source override
  const p = getUrl.length > GIS_MAX_GET_URL
    ? fetchJson(buildQueryUrl(source.url, layer, {}), { body: params, ...(t || {}) })
    : fetchJson(getUrl, t || undefined);
  return Promise.resolve(p).then((j) => (j && typeof j.count === "number" ? j.count : (j && j.features ? j.features.length : 0)));
}

// Log the REAL failure (status / url / ArcGIS code) so an opaque failure is debuggable
// from the console; the UI still shows a clean message. Only fires for real endpoint
// errors (a `diag` was attached) — test fakes throw plain Errors.
function logQueryFailure(sourceId, err) {
  const diag = err && err.diag;
  if (!diag || typeof console === "undefined" || !console.warn) return;
  console.warn(
    `[siteAnalysis] "${sourceId}" query failed: ${err.message}` +
    (diag.httpStatus ? `\n  http: ${diag.httpStatus}` : "") +
    (diag.arcgisCode != null ? `\n  arcgis code: ${diag.arcgisCode}` : "") +
    (diag.url ? `\n  url: ${diag.url}` : "")
  );
}

function pendingFinding(source) {
  return {
    id: source.id, category: source.category, label: source.label,
    status: source.derived ? "info" : "pending", summary: null, detail: [], rows: null,
    sourceName: source.sourceName, ageMs: null, ts: null, error: null,
    caveat: source.caveat, verified: false, mapLayer: source.mapLayer || null,
  };
}

// ---------------------------------------------------------------------------
// Proximity screen (PHASE 2) — count + nearest-distance + names within a buffer.
// A distinct query shape (server-side `distance` buffer + returned geometry so the exact
// nearest distance is measured in EPSG:2278 feet, not degrees) and a distinct finding
// (present with a count/nearest summary, or a verified "none within N mi"). Used by the
// contamination pre-screen; the same seam serves later power/rail distance sources.
// ---------------------------------------------------------------------------

// EPA "Cleanups in My Community" MAP_SYMBOL_CODE → a plain program label. Pure.
export function epaProgram(code) {
  const c = String(code == null ? "" : code).trim().toUpperCase();
  if (!c) return "";
  if (c === "S") return "Superfund (NPL)";
  if (c === "SN") return "Superfund (non-NPL)";
  if (c === "R") return "RCRA cleanup";
  if (c === "E") return "enforcement";
  if (c.includes("S") && c.includes("R")) return "Superfund + RCRA";
  return "";
}

/* Build a proximity /query: features within `bufferFt` of the parcel footprint. Server-side
 * buffer (`distance`+`units`) so the count is accurate, plus geometry so we measure the exact
 * nearest distance client-side. Pure. */
export function buildProximityParams(source, rings, bufferFt) {
  const outFields = source.outFields || Object.values(source.fields || {}).filter(Boolean).join(",") || "*";
  return {
    f: "json",
    where: source.where || "1=1",
    geometry: JSON.stringify({ rings: rings.map((r) => closeRing(simplifyRing(r))), spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPolygon",
    spatialRel: "esriSpatialRelIntersects",
    distance: bufferFt, units: "esriSRUnit_Foot",
    inSR: 4326, outSR: 4326,
    outFields, returnGeometry: "true",
    resultRecordCount: source.proxCap || 100,
  };
}

function queryProximity(source, layer, rings, bufferFt, fetchJson) {
  const params = buildProximityParams(source, rings, bufferFt);
  const getUrl = buildQueryUrl(source.url, layer, params);
  const t = source.timeoutMs ? { timeoutMs: source.timeoutMs } : null;
  if (getUrl.length > GIS_MAX_GET_URL) return fetchJson(buildQueryUrl(source.url, layer, {}), { body: params, ...(t || {}) });
  return fetchJson(getUrl, t || undefined);
}

function countProximity(source, layer, rings, bufferFt, fetchJson) {
  const params = { ...buildProximityParams(source, rings, bufferFt), returnCountOnly: true };
  delete params.outFields; delete params.resultRecordCount; delete params.returnGeometry;
  const getUrl = buildQueryUrl(source.url, layer, params);
  const t = source.timeoutMs ? { timeoutMs: source.timeoutMs } : null;
  const p = getUrl.length > GIS_MAX_GET_URL
    ? fetchJson(buildQueryUrl(source.url, layer, {}), { body: params, ...(t || {}) })
    : fetchJson(getUrl, t || undefined);
  return Promise.resolve(p).then((j) => (j && typeof j.count === "number" ? j.count : (j && j.features ? j.features.length : 0)));
}

/* Analyze a PROXIMITY source: features within `bufferMi` of the parcel, reported as count +
 * nearest distance + names. Rides the SWR cache like analyzeSource; the exact total is a
 * separate returnCountOnly fetch (the returned features are capped for the nearest/names).
 * Honest states: present / absent(verified) / unknown / unavailable / stale. Returns a finding. */
export function analyzeProximitySource(source, rings, opts = {}) {
  const cache = opts.cache || defaultCache;
  const fetchJson = opts.fetchJson || defaultFetchJson;
  const bufferMi = source.bufferMi || 1;
  const bufferFt = Math.round(bufferMi * 5280);
  const layer = source.layer != null ? source.layer : (Array.isArray(source.layers) ? source.layers[0] : null);
  const sig = ringsSignature(rings);
  const cap = source.proxCap || 100;
  const nameKey = (source.fields && source.fields.name) || "NAME";

  const featFetcher = async () => {
    const j = await queryProximity(source, layer, rings, bufferFt, fetchJson);
    return (j.features || []).map((f) => {
      const g = f.geometry || {};
      const rec = { attrs: normalizeAttrs(f.attributes) };
      if (Array.isArray(g.paths)) rec.paths = g.paths;                        // polyline (faults, rail)
      else if (Number.isFinite(g.x) && Number.isFinite(g.y)) rec.lngLat = [g.x, g.y]; // point
      return rec;
    });
  };
  const { fresh } = cache.swr("proximity:" + source.id + ":" + sig, featFetcher, { ttl: source.ttl || 0 });
  const countFresh = cache.swr("proximitycount:" + source.id + ":" + sig,
    async () => countProximity(source, layer, rings, bufferFt, fetchJson), { ttl: source.ttl || 0 }).fresh;

  return Promise.all([fresh, countFresh]).then(([r, rc]) => {
    if (r.error) logQueryFailure(source.id, r.error);
    const haveStale = !!(r.error && r.data != null);
    const hardError = r.error && !haveStale ? gisErrorMessage(r.error) : null;
    const feats = hardError ? null : (r.data || []);
    let status, summary = null, detail = [];
    if (hardError) {
      status = "unavailable";
    } else {
      const scr = screenProximity(rings, feats);
      const total = (rc && !rc.error && typeof rc.data === "number") ? rc.data : scr.count;
      // On a line source (faults, rail), a 0-ft nearest means the trace CROSSES the site — a
      // source may override the "on/under the site" wording (e.g. "crosses the site").
      const fmtD = (ft) => (ft != null && ft <= 25 && source.onSiteLabel ? source.onSiteLabel : fmtDistFt(ft));
      if (typeof source.classifyProx === "function") {
        // A proximity source may supply its own classifier over the screened result (e.g. the
        // well status breakdown + on-site replug/offset flag). It owns status/summary/detail.
        const c = source.classifyProx(scr, { total, bufferMi }) || {};
        status = c.status || (total > 0 ? "present" : source.verified ? "absent" : "unknown");
        summary = c.summary != null ? c.summary
          : (status === "absent" ? (source.absentLabel || `No mapped ${source.plural || "sites"} within ${bufferMi} mi`) : null);
        detail = c.detail || [];
      } else if (total > 0) {
        status = "present";
        const near = scr.nearest;
        const nearName = near ? (near.attrs[nameKey] || "unnamed") : "";
        const nStr = `${total}${total >= cap ? "+" : ""}`;
        summary = `${nStr} ${source.plural || "site(s)"} within ${bufferMi} mi` +
          (near ? ` — nearest ${fmtD(near.distFt)}: ${nearName}` : "");
        detail = scr.ranked.slice(0, 6).map((f) => {
          const tag = source.proxTag ? source.proxTag(f.attrs) : "";
          return `${f.attrs[nameKey] || "unnamed"}${tag ? " (" + tag + ")" : ""} · ${fmtD(f.distFt)}`;
        });
      } else {
        status = source.verified ? "absent" : "unknown";
        summary = status === "absent" ? (source.absentLabel || `No mapped ${source.plural || "sites"} within ${bufferMi} mi`) : null;
      }
    }
    return {
      id: source.id, category: source.category, label: source.label,
      status, summary, detail, rows: null,
      sourceName: source.sourceName, ageMs: r.ageMs ?? null, ts: r.ts ?? null,
      error: hardError, stale: haveStale, refreshError: haveStale ? gisErrorMessage(r.error) : null,
      caveat: source.caveat, verified: !!source.verified, mapLayer: source.mapLayer || null,
    };
  });
}

/* Analyze ONE registry source against the parcel rings. Rides gisCache.swr so a
 * repeat / just-reloaded lookup is instant and survives a source outage. Resilience:
 *   • a registry `fallbacks` mirror is tried if the primary endpoint errors (B369 #6);
 *   • a failed REFRESH that still has a last-good copy KEEPS showing it, flagged
 *     `stale` + `refreshError` (never downgraded to UNAVAILABLE) — the SWR contract
 *     the brief's NEW-2 asks for (show last-good "as of <date>", mark "couldn't
 *     refresh", don't blank the layer);
 *   • a failure with NO cached copy is an honest UNAVAILABLE (retryable, never "clear").
 * The error is surfaced, never thrown. Returns a finding. */
export function analyzeSource(source, rings, opts = {}) {
  if (source.pending || source.derived) return Promise.resolve(pendingFinding(source));
  if (source.screenMode === "proximity") return analyzeProximitySource(source, rings, opts); // PHASE 2
  const cache = opts.cache || defaultCache;
  const fetchJson = opts.fetchJson || defaultFetchJson;
  const endpoints = [source, ...(source.fallbacks || [])]; // primary then any same-data mirrors
  const key = "analysis:" + source.id + ":" + ringsSignature(rings);
  const fetcher = async () => {
    let lastErr = null;
    for (const ep of endpoints) {
      try {
        const layers = ep.layers || (ep.layer != null ? [ep.layer] : [null]);
        const all = [];
        for (const L of layers) {
          const j = await queryLayer(ep, L, rings, fetchJson);
          for (const f of j.features || []) all.push(normalizeAttrs(f.attributes));
        }
        return all;
      } catch (e) { lastErr = e; /* fall through to the next mirror */ }
    }
    throw lastErr;
  };
  const { fresh } = cache.swr(key, fetcher, { ttl: source.ttl || 0 });
  // Count-mode sources (wells, pipelines) DISPLAY a count, so they need the exact number,
  // not "however many features fit in one page." Fetch it via returnCountOnly in a SEPARATE
  // cache entry — the feature cache stays a plain attrs array (untouched), the detail still
  // rides the fetched sample, and the count rides the same throttled fetch pool.
  let countFresh = null;
  if (source.countMode) {
    const countFetcher = async () => {
      let lastErr = null;
      for (const ep of endpoints) {
        try {
          const layers = ep.layers || (ep.layer != null ? [ep.layer] : [null]);
          let total = 0;
          for (const L of layers) total += await countLayer(ep, L, rings, fetchJson);
          return total;
        } catch (e) { lastErr = e; /* try the next mirror */ }
      }
      throw lastErr;
    };
    countFresh = cache.swr("analysiscount:" + source.id + ":" + ringsSignature(rings), countFetcher, { ttl: source.ttl || 0 }).fresh;
  }
  return Promise.all([fresh, countFresh]).then(([r, rc]) => {
    if (r.error) logQueryFailure(source.id, r.error);
    // A failed refresh that still carries last-good data → keep showing it (stale), not
    // a hard error. A failure with no cached copy → a hard UNAVAILABLE.
    const haveStale = !!(r.error && r.data != null);
    const hardError = r.error && !haveStale ? gisErrorMessage(r.error) : null;
    const attrs = hardError ? null : (r.data || []);
    // A source MAY supply its own classifier for when "a feature intersects" is not the
    // same as "a constraint" (flood: the NFHL returns the all-clear Zone X as polygons too).
    // Otherwise fall back to the generic presence/verified classifier (the silent-error guard).
    let status, summary, detail;
    if (hardError) {
      status = "unavailable"; summary = null; detail = [];
    } else if (typeof source.classify === "function") {
      const c = source.classify(attrs, source) || {};
      status = c.status || "unknown";
      summary = c.summary != null ? c.summary : null;
      detail = c.detail || [];
    } else {
      status = classifyStatus(attrs, { error: hardError, verified: source.verified });
      // Exact total for count-mode sources (returnCountOnly); falls back to the fetched
      // sample size if the count query failed. Non-count sources ignore it.
      const total = source.countMode
        ? ((rc && !rc.error && typeof rc.data === "number") ? rc.data : (attrs ? attrs.length : null))
        : (attrs ? attrs.length : null);
      summary = status === "present" ? source.summarize(attrs, total) : status === "absent" ? source.absentLabel || "None found" : null;
      detail = status === "present" && source.detail ? source.detail(attrs) : [];
    }
    return {
      id: source.id, category: source.category, label: source.label,
      status, summary, detail,
      rows: null,
      sourceName: source.sourceName, ageMs: r.ageMs ?? null, ts: r.ts ?? null,
      error: hardError,
      stale: haveStale, refreshError: haveStale ? gisErrorMessage(r.error) : null,
      caveat: source.caveat, verified: !!source.verified, mapLayer: source.mapLayer || null,
    };
  });
}

// ---------------------------------------------------------------------------
// Jurisdiction / road / zoning findings (reuse the verified jurisdiction.js engine)
// ---------------------------------------------------------------------------
export function buildJurisdictionFinding(j) {
  const rows = [];
  rows.push(["County", j.county.length ? j.county.join(" + ") : "—", j.ages.county]);
  rows.push(["City", j.unincorporated ? "Unincorporated" : j.city.join(" + "), j.ages.city]);
  const etjState = (j.sources.find((s) => s.id === "etj") || {}).state;
  rows.push(["ETJ", j.etj.length ? j.etj.map((n) => `${n} ETJ`).join(" + ") : (etjState === "unavailable" ? "no ETJ layer for this area" : "not in a city ETJ"), j.ages.etj]);
  // B764: the school district (ISD) — the biggest single line on most Texas tax bills. Only
  // rows out when the identify actually ran ISD (j.isd present), so older callers are unchanged.
  if (Array.isArray(j.isd)) rows.push(["School district", j.isd.length ? j.isd.join(" + ") : "—", j.ages.isd]);
  return {
    id: "jurisdiction", category: "Jurisdiction", label: "City / ETJ / county",
    status: "info", summary: null, detail: [], rows,
    straddle: j.straddle,
    sourceName: "TxDOT / TxGIO / H-GAC", ageMs: j.ages.county ?? j.ages.city ?? null, ts: null,
    error: null, caveat: "Screening only — boundaries (especially ETJ) change. Verify with the jurisdiction.", verified: true,
  };
}

// FHWA functional class (F_SYSTEM) → a plain label for the per-road detail line.
const ROAD_FUNC_CLASS = { 1: "Interstate", 2: "Freeway/expressway", 3: "Principal arterial", 4: "Minor arterial", 5: "Major collector", 6: "Minor collector", 7: "Local" };
const funcClassLabel = (c) => ROAD_FUNC_CLASS[Number(c)] || null;

// A fronting road's display name: its real name, else its (internal) route id, else
// "Unnamed road" — never a blank cell.
const roadRowName = (r) => r.name || (r.route ? `Route ${r.route}` : "Unnamed road");

/* Road authority finding (B94, per-road). A site usually fronts several roads, each
 * possibly maintained by a different desk (City / County / State-TxDOT / toll / private /
 * unknown), so this is a PER-ROAD list, not one collapsed value:
 *   • a header roll-up — "Maintained by <X> (all roads)" when every road shares one
 *     authority, else "Mixed — N roads";
 *   • one row per fronting road — "<road name> → <authority>" (route + class in the
 *     expandable detail; a bare numeric inventory id isn't shown as the row's value).
 * Rows arrive already ordered longest-frontage-first from identifyRoadAuthority. Any
 * road that can't be classified shows an explicit "Unknown" (never a guess). With no
 * roads matched it reads the honest zero-match note, not a blank. Carries `mapLayer` so
 * the card gets a "◍ Map" toggle (B190) → the color-coded road overlay (NEW-2/B571). */
export function buildRoadFinding(road) {
  const roads = Array.isArray(road.roads) ? road.roads : [];
  const haveRoads = roads.length > 0;
  const authorities = uniq(roads.map((r) => (r.authority && r.authority.label) || "Unknown"));
  const rollup = !haveRoads ? null
    : authorities.length === 1 ? `${authorities[0]} (all roads)` : `Mixed — ${roads.length} roads`;
  const rows = haveRoads
    ? [["Maintained by", rollup, road.ageMs ?? null],
       ...roads.map((r) => [roadRowName(r), (r.authority && r.authority.label) || "Unknown", null])]
    : null;
  const detail = haveRoads
    ? roads.map((r) => [roadRowName(r), "— " + ((r.authority && r.authority.label) || "Unknown"),
        funcClassLabel(r.funcClass) ? `· ${funcClassLabel(r.funcClass)}` : "",
        r.route ? `· route ${r.route}` : ""].filter(Boolean).join(" "))
    : [];
  return {
    id: "road", category: "Road authority", label: "Who maintains the fronting road(s)",
    status: haveRoads ? "info" : "unknown",
    summary: haveRoads ? null : (road.error || road.note || "No roads matched — screening only."),
    detail, rows,
    mapLayer: "jur_road_authority", // NEW-2/B571: lifts the B190 suppression — the card gets a "◍ Map" toggle
    sourceName: "TxDOT Roadway Inventory", ageMs: road.ageMs ?? null, ts: road.ts ?? null,
    error: road.error || null, caveat: road.note || "Local-road coverage is patchy — an honest \"unknown\" beats a wrong guess.", verified: true,
  };
}

// Zoning is DERIVED from the jurisdiction: Houston (city or its ETJ) = no zoning;
// any other incorporated city = "city zoning applies — confirm"; unincorporated =
// "no county zoning in Texas." Pure.
export function deriveZoning(j) {
  const src = ANALYSIS_SOURCES.find((s) => s.id === "zoning");
  const cities = (j.city || []).map((c) => String(c).toLowerCase());
  const etj = (j.etj || []).map((c) => String(c).toLowerCase());
  let summary;
  if (j.unincorporated) summary = "Unincorporated — Texas counties have no zoning; subdivision platting still applies.";
  else if (cities.includes("houston")) summary = "City of Houston — NO zoning (deed restrictions + Ch. 42 development code apply instead).";
  else if (cities.length) summary = `Within ${j.city.join(", ")} — city zoning likely applies; confirm the district + entitlement path.`;
  else if (etj.includes("houston")) summary = "Houston ETJ — no zoning, but city subdivision/platting authority applies in the ETJ.";
  else summary = "Confirm zoning with the jurisdiction.";
  return {
    id: "zoning", category: "Zoning / entitlement", label: "Zoning & entitlement context",
    status: "info", summary, detail: [], rows: null,
    sourceName: "Derived from jurisdiction", ageMs: null, ts: null,
    error: null, caveat: src.caveat, verified: false,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
// Display order for the assembled findings.
const CATEGORY_ORDER = ["flood", "wetlands", "pipelines", "oilgas", "lpst", "epaCleanups", "growthFaults", "jurisdiction", "road", "zoning", "ccnWater", "ccnSewer"];

/* Run the full screen against the active-parcel rings ([[ [lng,lat], ... ], ...]).
 * Returns { findings, generatedAt }. Findings are presence-first and each carries its
 * own source + age + caveat. Network calls are injectable for tests. */
export async function runSiteAnalysis(rings, opts = {}) {
  if (!rings || !rings.length) return { findings: [], generatedAt: Date.now(), empty: true };
  const rep = representativeRing(rings);
  const c = ringCentroid(rep);
  const idJur = opts.identifyJurisdiction || identifyJurisdiction;
  const idRoad = opts.identifyRoadAuthority || identifyRoadAuthority;

  // THROTTLE the whole fan-out (B366): the ~8–10 layer queries — environmental AND
  // jurisdiction/road — share ONE small pool so they don't burst the source servers all
  // at once (the burst was what provoked the transient 503s, even on Esri-hosted layers).
  const baseFetch = opts.fetchJson || defaultFetchJson;
  const limit = pLimit(opts.poolSize || 3);
  const pooledFetch = (url, o) => limit(() => baseFetch(url, o));
  const arcOpts = { ...opts, fetchJson: pooledFetch };
  const jurFetch = opts.jurFetchJson || pooledFetch;

  const arcPromises = ANALYSIS_SOURCES.map((s) => analyzeSource(s, rings, arcOpts));
  const jurP = Promise.resolve().then(() => idJur(c.lng, c.lat, { ring: rep, cache: opts.cache, fetchJson: jurFetch })).catch((e) => ({ __error: e }));
  const roadP = Promise.resolve().then(() => idRoad(c.lng, c.lat, { ring: rep, cache: opts.cache, fetchJson: jurFetch })).catch((e) => ({ __error: e }));

  const [arc, j, road] = await Promise.all([Promise.all(arcPromises), jurP, roadP]);

  // Replace the placeholder zoning/derived rows with the jurisdiction-derived ones.
  const byId = new Map(arc.map((f) => [f.id, f]));
  // Honest fallback if the jurisdiction engine is unreachable — an UNAVAILABLE finding
  // (retryable; never silently dropped, never a fabricated answer).
  const unknownInfo = (id, category, label) => ({
    id, category, label, status: "unavailable", summary: null, detail: [], rows: null,
    sourceName: null, ageMs: null, ts: null, error: "Couldn't reach the GIS source — temporarily unavailable.", caveat: null, verified: false,
  });
  byId.set("jurisdiction", j && !j.__error ? buildJurisdictionFinding(j) : unknownInfo("jurisdiction", "Jurisdiction", "City / ETJ / county"));
  byId.set("zoning", j && !j.__error ? deriveZoning(j) : byId.get("zoning") || unknownInfo("zoning", "Zoning / entitlement", "Zoning & entitlement context"));
  byId.set("road", road && !road.__error ? buildRoadFinding(road) : unknownInfo("road", "Road authority", "Who maintains the fronting road(s)"));

  const findings = CATEGORY_ORDER.map((id) => byId.get(id)).filter(Boolean);
  return { findings, generatedAt: Date.now(), site: { centroid: c } };
}
