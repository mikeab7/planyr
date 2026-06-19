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

const DAY = 24 * 3600 * 1000;

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
    // NFHL layer 28 = Flood Hazard Zones (S_Fld_Haz_Ar) — the canonical queryable SFHA
    // polygons; the app already uses this MapServer for the flood overlay.
    url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer",
    layer: 28,
    fields: { zone: "FLD_ZONE", subtype: "ZONE_SUBTY", elev: "STATIC_BFE" },
    ttl: 7 * DAY, verified: true,
    sourceName: "FEMA NFHL",
    absentLabel: "No mapped Special Flood Hazard Area (typically Zone X / minimal risk)",
    caveat: "FEMA's digital flood maps (NFHL). Screening only — confirm against the current effective FIRM / any LOMA and a survey before finished-floor design.",
    summarize: (rows) => zoneSummary(rows),
    detail: (rows) => zoneDetail(rows),
  },
  {
    id: "wetlands", category: "Wetlands", label: "USFWS NWI wetlands", kind: "polygon",
    // NWI staging split layers (B135): 1 = CONUS East, 2 = CONUS West (Texas is West).
    // Query both. NOT marked verified — the staging host's /query reliability is
    // unconfirmed (B133/B135), so an empty answer stays honest "unknown", never a
    // fabricated "no wetlands" on a real site.
    url: "https://fwsprimary.wim.usgs.gov/server/rest/services/Test/Wetlands_gdb_split/MapServer",
    layers: [1, 2],
    fields: { type: "WETLAND_TYPE", attr: "ATTRIBUTE", acres: "ACRES" },
    ttl: 7 * DAY, verified: false,
    sourceName: "USFWS National Wetlands Inventory",
    caveat: "NWI is a desktop screen — NOT a jurisdictional delineation. A consultant delineation + USACE verification is required for any real determination.",
    summarize: (rows) => wetlandSummary(rows),
    detail: (rows) => wetlandDetail(rows),
  },
  {
    id: "oilgas", category: "Oil & gas wells", label: "TxRRC well surface locations", kind: "polygon",
    // Texas Railroad Commission wells, mirrored on the Harris County GIS host the app
    // already uses. Not verified (sublayer/coverage unconfirmed) → empty = unknown.
    url: "https://www.gis.hctx.net/arcgishcpid/rest/services/TXRRC/Wells/MapServer",
    layer: 0,
    fields: { status: "SYMNUM", api: "API", lease: "LEASE_NAME" },
    ttl: 30 * DAY, verified: false, countMode: true,
    sourceName: "Texas Railroad Commission (via Harris County GIS)",
    caveat: "RRC well points are schematic and historic locations can be inaccurate or unmapped (orphaned wells). An RRC records search — possibly a survey — is the real check.",
    summarize: (rows) => `${rows.length} well${rows.length === 1 ? "" : "s"} on or adjacent to the site`,
    detail: (rows) => rows.slice(0, 8).map((r) => [r.LEASE_NAME, r.API].filter(Boolean).join(" · ")).filter(Boolean),
  },
  {
    id: "pipelines", category: "Pipelines", label: "TxRRC T-4 pipelines", kind: "polygon",
    url: "https://www.gis.hctx.net/arcgishcpid/rest/services/TXRRC/Pipelines/MapServer",
    layer: 0,
    fields: { operator: "OPERATOR", commodity: "COMMODITY", diameter: "DIAMETER" },
    ttl: 30 * DAY, verified: false,
    sourceName: "Texas Railroad Commission (via Harris County GIS)",
    caveat: "RRC T-4 permit routes are SCHEMATIC, not surveyed alignments — and public pipeline data is deliberately low-resolution. Trigger 811 / one-call + operator outreach; never treat as a precise location.",
    summarize: (rows) => pipelineSummary(rows),
    detail: (rows) => rows.slice(0, 6).map((r) => [r.OPERATOR, r.COMMODITY].filter(Boolean).join(" · ")).filter(Boolean),
  },
  {
    // Environmental contamination — TCEQ LPST + EPA. No confirmed CORS-clean REST
    // endpoint wired yet, so this is surfaced honestly as "source not connected"
    // (the registry seam is in place; wiring a verified source later flips this row).
    id: "contamination", category: "Environmental contamination",
    label: "TCEQ LPST / EPA contaminated sites", pending: true,
    sourceName: "TCEQ LPST / EPA (not yet connected)",
    caveat: "Leaking petroleum storage tanks (TCEQ LPST) + EPA-listed sites. Source not yet wired — a Phase I ESA is the authoritative screen.",
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
  const outFields = Object.values(source.fields || {}).filter(Boolean).join(",") || "*";
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

export function wetlandSummary(rows) {
  const types = uniq(rows.map((r) => r.WETLAND_TYPE));
  if (!types.length) return "Mapped wetlands present";
  return types.join(", ");
}
function wetlandDetail(rows) {
  return uniq(rows.map((r) => [r.WETLAND_TYPE, r.ATTRIBUTE].filter(Boolean).join(" · "))).slice(0, 8);
}

export function pipelineSummary(rows) {
  const ops = uniq(rows.map((r) => r.OPERATOR));
  const n = rows.length;
  const head = `${n} pipeline segment${n === 1 ? "" : "s"}`;
  return ops.length ? `${head} — ${ops.slice(0, 3).join(", ")}${ops.length > 3 ? "…" : ""}` : head;
}

// Classify a fetched result into a finding status (pure). `attrs` is the feature
// attribute list (or null on a cache/fetch error).
export function classifyStatus(attrs, { error, verified }) {
  if (error || attrs == null) return "unknown";
  if (attrs.length > 0) return "present";
  return verified ? "absent" : "unknown";
}

// ---------------------------------------------------------------------------
// Connector — one source against the parcel rings, riding the SWR cache.
// ---------------------------------------------------------------------------
async function defaultFetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Server returned HTTP ${res.status}.`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "ArcGIS query error.");
  return j;
}

function humanize(e) {
  const m = String(e?.message || e || "");
  if (/failed to fetch|networkerror|load failed|cors/i.test(m)) return "Couldn't reach the GIS server (network or CORS).";
  return m || "Request failed.";
}

function pendingFinding(source) {
  return {
    id: source.id, category: source.category, label: source.label,
    status: source.derived ? "info" : "pending", summary: null, detail: [], rows: null,
    sourceName: source.sourceName, ageMs: null, ts: null, error: null,
    caveat: source.caveat, verified: false,
  };
}

/* Analyze ONE registry source against the parcel rings. Rides gisCache.swr so a
 * repeat / just-reloaded lookup is instant and survives a source outage (last-good
 * copy is shown with its age; an error is surfaced, never thrown). Returns a finding. */
export function analyzeSource(source, rings, opts = {}) {
  if (source.pending || source.derived) return Promise.resolve(pendingFinding(source));
  const cache = opts.cache || defaultCache;
  const fetchJson = opts.fetchJson || defaultFetchJson;
  const layers = source.layers || (source.layer != null ? [source.layer] : [null]);
  const key = "analysis:" + source.id + ":" + ringsSignature(rings);
  const fetcher = async () => {
    const all = [];
    for (const L of layers) {
      const j = await fetchJson(buildQueryUrl(source.url, L, buildAnalysisParams(source, rings)));
      for (const f of j.features || []) all.push(f.attributes || {});
    }
    return all;
  };
  const { fresh } = cache.swr(key, fetcher, { ttl: source.ttl || 0 });
  return fresh.then((r) => {
    const attrs = r.error ? null : (r.data || []);
    const error = r.error ? humanize(r.error) : null;
    const status = classifyStatus(attrs, { error, verified: source.verified });
    return {
      id: source.id, category: source.category, label: source.label,
      status,
      summary: status === "present" ? source.summarize(attrs) : status === "absent" ? source.absentLabel || "None found" : null,
      detail: status === "present" && source.detail ? source.detail(attrs) : [],
      rows: null,
      sourceName: source.sourceName, ageMs: r.ageMs ?? null, ts: r.ts ?? null,
      error, caveat: source.caveat, verified: !!source.verified,
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
  return {
    id: "jurisdiction", category: "Jurisdiction", label: "City / ETJ / county",
    status: "info", summary: null, detail: [], rows,
    straddle: j.straddle,
    sourceName: "TxDOT / TxGIO / H-GAC", ageMs: j.ages.county ?? j.ages.city ?? null, ts: null,
    error: null, caveat: "Screening only — boundaries (especially ETJ) change. Verify with the jurisdiction.", verified: true,
  };
}

export function buildRoadFinding(road) {
  return {
    id: "road", category: "Road authority", label: "Who maintains the fronting road(s)",
    status: road.authorities && road.authorities.length ? "info" : "unknown",
    summary: null, detail: [],
    rows: [["Maintained by", road.authorities && road.authorities.length ? road.authorities.join(" · ") + (road.nearest?.route ? ` (${road.nearest.route})` : "") : "unknown", road.ageMs]],
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
const CATEGORY_ORDER = ["flood", "wetlands", "pipelines", "oilgas", "contamination", "jurisdiction", "road", "zoning"];

/* Run the full screen against the active-parcel rings ([[ [lng,lat], ... ], ...]).
 * Returns { findings, generatedAt }. Findings are presence-first and each carries its
 * own source + age + caveat. Network calls are injectable for tests. */
export async function runSiteAnalysis(rings, opts = {}) {
  if (!rings || !rings.length) return { findings: [], generatedAt: Date.now(), empty: true };
  const rep = representativeRing(rings);
  const c = ringCentroid(rep);
  const idJur = opts.identifyJurisdiction || identifyJurisdiction;
  const idRoad = opts.identifyRoadAuthority || identifyRoadAuthority;

  const arcPromises = ANALYSIS_SOURCES.map((s) => analyzeSource(s, rings, opts));
  const jurP = Promise.resolve().then(() => idJur(c.lng, c.lat, { ring: rep, cache: opts.cache, fetchJson: opts.jurFetchJson })).catch((e) => ({ __error: e }));
  const roadP = Promise.resolve().then(() => idRoad(c.lng, c.lat, { ring: rep, cache: opts.cache, fetchJson: opts.jurFetchJson })).catch((e) => ({ __error: e }));

  const [arc, j, road] = await Promise.all([Promise.all(arcPromises), jurP, roadP]);

  // Replace the placeholder zoning/derived rows with the jurisdiction-derived ones.
  const byId = new Map(arc.map((f) => [f.id, f]));
  // Honest fallbacks if the jurisdiction engine is unreachable — an "unknown" finding
  // (never silently dropped, never a fabricated answer).
  const unknownInfo = (id, category, label) => ({
    id, category, label, status: "unknown", summary: null, detail: [], rows: null,
    sourceName: null, ageMs: null, ts: null, error: "Couldn't reach the GIS server.", caveat: null, verified: false,
  });
  byId.set("jurisdiction", j && !j.__error ? buildJurisdictionFinding(j) : unknownInfo("jurisdiction", "Jurisdiction", "City / ETJ / county"));
  byId.set("zoning", j && !j.__error ? deriveZoning(j) : byId.get("zoning") || unknownInfo("zoning", "Zoning / entitlement", "Zoning & entitlement context"));
  byId.set("road", road && !road.__error ? buildRoadFinding(road) : unknownInfo("road", "Road authority", "Who maintains the fronting road(s)"));

  const findings = CATEGORY_ORDER.map((id) => byId.get(id)).filter(Boolean);
  return { findings, generatedAt: Date.now(), site: { centroid: c } };
}
