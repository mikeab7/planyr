/* Floodplain mitigation engine (B707) — screening estimate of the COMPENSATING
 * STORAGE a jurisdiction requires when fill lands in the mapped floodplain, plus the
 * hard geometry flags (floodway, unstudied Zone A) that are not volume questions.
 *
 * Pure and Node-testable: NFHL features are PASSED IN (the caller fetches them via
 * vectorLayers.fetchCached over the B96 SWR cache, site-bbox keyed — see
 * SitePlanner's checkDrainage); every elevation is a pluggable input so a LiDAR /
 * MAAPnext grid later is a provider swap with ZERO engine rework. All elevations are
 * feet NAVD88. Mitigation is a SEPARATE ledger from detention — nothing here nets
 * the two (the same acre-foot can't count twice).
 *
 * ★ Honest states (LOUD-FAILURE, the silent-error principle): a missing elevation or
 * a failed source makes the affected volume read UNKNOWN (null) — NEVER zero — while
 * the pure-geometry outputs (intersect acreage, floodway/unstudied flags) still
 * compute and render. An unverified rule stamps every output.
 *
 * Screening exclusions (deliberate, surfaced as copy): perimeter tie-in slopes;
 * stage-band distribution ("hydraulically equivalent" — this checks TOTAL volume
 * only); hydrograph routing; conveyance hydraulics (Harris' offsetScope notes when
 * conveyance also governs).
 */
import { pointInRing } from "./pondGeom.js";
import { lngLatRingToFeet } from "./arcgis.js";
import { isSFHA } from "./siteAnalysis.js";
import { SQFT_PER_ACRE } from "../../../shared/coordinates/index.js";
import { triggerClasses } from "./floodplainRules.js";

// NFHL publishes -9999 for "no static BFE" / "no depth" (same sentinel detentionRules guards).
export const BFE_SENTINEL_MIN = -9000;
const CF_PER_CY = 27;

const num = (v) => (v == null || v === "" ? null : Number(v));
const realElev = (v) => { const n = num(v); return n != null && isFinite(n) && n > BFE_SENTINEL_MIN ? n : null; };

// Shaded Zone X = the 0.2%-annual-chance (500-yr) band (same regex family as siteAnalysis).
const isShadedX = (subtype) => /0\.2\s*pct|0\.2\s*%|\b500[-\s]?(?:yr|year)/i.test(String(subtype || ""));
const isFloodway = (subtype) => /floodway/i.test(String(subtype || ""));

/* Classify ONE NFHL S_Fld_Haz_Ar feature's attributes into a mitigation class.
 *   floodway — regulatory floodway: fill/structures are a HARD STOP (prohibit_fill),
 *              never a mitigable volume; kept out of the volume ledger by design.
 *   1pct     — the SFHA (A/AE/AH/AO/V…): AH is treated as AE (ponding with a BFE);
 *              AO is sheet flow — no BFE, carries a DEPTH attribute instead, so its
 *              WSE = existing grade + DEPTH; bare Zone A with no published BFE is
 *              flagged unstudied (WSE undeterminable from the map alone).
 *   02pct    — the shaded-X 0.2% (500-yr) band (COH's extended fill trigger).
 *   none     — unshaded X / D / open water etc. (no mitigation trigger). Zone D stays
 *              the Site-Analysis screen's "unknown" — it carries no WSE to price.
 * Pure. */
export function classifyNfhlFeature(attrs = {}) {
  const zone = String(attrs.FLD_ZONE == null ? "" : attrs.FLD_ZONE).trim().toUpperCase();
  const subtype = String(attrs.ZONE_SUBTY == null ? "" : attrs.ZONE_SUBTY).trim();
  const sfha = String(attrs.SFHA_TF == null ? "" : attrs.SFHA_TF).trim().toUpperCase() === "T" || isSFHA(zone);
  const staticBfeFt = realElev(attrs.STATIC_BFE);
  const aoDepthFt = zone === "AO" ? realElev(attrs.DEPTH) : null;
  const vdatum = attrs.V_DATUM != null && String(attrs.V_DATUM).trim() !== "" ? String(attrs.V_DATUM).trim() : null;
  let cls = "none";
  if (isFloodway(subtype)) cls = "floodway";
  else if (sfha) cls = "1pct";
  else if (isShadedX(subtype)) cls = "02pct";
  return {
    cls, zone, subtype, staticBfeFt, aoDepthFt, vdatum,
    // Bare Zone A (or AO with no depth) — in the SFHA but its water surface can't be
    // read off the map: "unstudied — BFE undetermined".
    unstudiedA: cls === "1pct" && staticBfeFt == null && (zone === "A" || (zone === "AO" && aoDepthFt == null)),
  };
}

/* GeoJSON FeatureCollection (vectorLayers.fetchCached output — Polygon per feature,
 * rings = outers AND holes, unsplit) → mitigation zones in the planner's site-feet
 * frame. Rings convert via the SAME lngLatRingToFeet the map render uses; point-in-
 * zone tests below run EVEN-ODD ACROSS ALL RINGS so an island inside a floodplain
 * polygon is correctly outside it (never billed for mitigation). Pure. */
export function zonesFromFeatureCollection(fc, origin) {
  const out = [];
  if (!fc || !Array.isArray(fc.features) || !origin) return out;
  for (const f of fc.features) {
    const c = classifyNfhlFeature(f.properties || {});
    if (c.cls === "none") continue;
    const coords = (f.geometry && f.geometry.coordinates) || [];
    const rings = coords
      .filter((r) => Array.isArray(r) && r.length >= 3)
      .map((r) => lngLatRingToFeet(r, origin.lon, origin.lat));
    if (!rings.length) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ring of rings) for (const p of ring) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    out.push({ ...c, rings, bbox: [minX, minY, maxX, maxY] });
  }
  return out;
}

// Even-odd containment across ALL of a zone's rings (outers + holes, unsplit).
export const pointInZone = (pt, zone) => {
  let inside = false;
  for (const ring of zone.rings) if (pointInRing(pt, ring)) inside = !inside;
  return inside;
};

const ringBBox = (ring) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return [minX, minY, maxX, maxY];
};
const bboxOverlap = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/* Grid-sampled intersection of one footprint ring with one zone (pondGeom idiom):
 * adaptive cell size targeting ≤ maxCells over the OVERLAP bbox, floored at minCellFt
 * (screening tolerance), cell-center sampling. Returns { areaSf, sumDepthArea } where
 * sumDepthArea = Σ cellArea × depthAt(cell) (0 when depthAt is null — callers price
 * volume separately from area). Pure. */
export function gridIntersect(ring, zone, depthAt = null, opts = {}) {
  const maxCells = opts.maxCells || 1500;
  const minCellFt = opts.minCellFt || 2;
  const fb = ringBBox(ring);
  if (!bboxOverlap(fb, zone.bbox)) return { areaSf: 0, sumDepthArea: 0 };
  const x0 = Math.max(fb[0], zone.bbox[0]), y0 = Math.max(fb[1], zone.bbox[1]);
  const x1 = Math.min(fb[2], zone.bbox[2]), y1 = Math.min(fb[3], zone.bbox[3]);
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0) || !(h > 0)) return { areaSf: 0, sumDepthArea: 0 };
  const cell = Math.max(minCellFt, Math.sqrt((w * h) / maxCells));
  const nx = Math.max(1, Math.ceil(w / cell)), ny = Math.max(1, Math.ceil(h / cell));
  const dx = w / nx, dy = h / ny, cellArea = dx * dy;
  let areaSf = 0, sumDepthArea = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const pt = { x: x0 + (i + 0.5) * dx, y: y0 + (j + 0.5) * dy };
      if (!pointInRing(pt, ring)) continue;
      if (!pointInZone(pt, zone)) continue;
      areaSf += cellArea;
      if (depthAt) {
        const d = depthAt(pt);
        if (d != null && isFinite(d) && d > 0) sumDepthArea += cellArea * d;
      }
    }
  }
  return { areaSf, sumDepthArea };
}

/* ---------------------------------------------------------------------------------
 * Derived BFE from FEMA Base Flood Elevation lines (S_BFE, B755).
 *
 * On most AE reaches FEMA leaves the zone polygon's STATIC_BFE at the -9999 "none"
 * sentinel — the BFE instead lives on the separate S_BFE line layer as whole-foot
 * water-surface CONTOURS drawn across the floodplain. deriveBfeFromLines reads a BFE
 * at a point the same way you'd read a spot elevation between two topo contours:
 * distance-weighted linear interpolation between the nearest line and the nearest line
 * of a DIFFERENT elevation. The result is an explicitly-labeled DERIVED screening
 * estimate (provider "bfe-line-interp"), never a published or surveyed BFE, and it
 * returns null (→ honest UNKNOWN) whenever the lines can't support a defensible value.
 * -------------------------------------------------------------------------------- */

// Perpendicular distance (feet) from an {x,y} point to a polyline: the min over its
// segments, clamped to each segment's endpoints. A degenerate 1-point line falls back
// to point-to-point (never NaN). Pure.
export function distToPolyline(point, pts) {
  if (!point || !Array.isArray(pts) || !pts.length) return Infinity;
  if (pts.length === 1) return Math.hypot(point.x - pts[0].x, point.y - pts[0].y);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
    if (d < best) best = d;
  }
  return best;
}

const isNavd88Datum = (v) => /navd\s*-?\s*88/i.test(String(v || ""));
const isMetersUnit = (v) => /met(er|re)/i.test(String(v || ""));

/* FEMA S_BFE FeatureCollection (featuresToGeoJson output — LineString /
 * MultiLineString per feature) → BFE lines in the planner's site-feet frame, filtered
 * to real feet-NAVD88 elevations. Each output line is { elevFt, pts:[{x,y}] }; a
 * MultiLineString contributes one entry per path (same ELEV). Lines whose ELEV is the
 * -9999 sentinel, whose datum isn't NAVD88, or whose unit is meters are EXCLUDED and
 * counted — never silently mixed (a mixed datum is a multi-foot silent error). `total`
 * counts real-elevation candidate lines so the UI can say "lines exist but non-NAVD88"
 * rather than a bare UNKNOWN. Pure. */
export function bfeLinesFromFeatureCollection(fc, origin) {
  const out = { lines: [], excludedDatum: 0, excludedUnit: 0, total: 0 };
  if (!fc || !Array.isArray(fc.features) || !origin) return out;
  for (const f of fc.features) {
    const p = (f && f.properties) || {};
    const elevFt = realElev(p.ELEV);
    if (elevFt == null) continue; // -9999 / missing — not a real elevation
    out.total += 1;
    if (!isNavd88Datum(p.V_DATUM)) { out.excludedDatum += 1; continue; }
    if (isMetersUnit(p.LEN_UNIT)) { out.excludedUnit += 1; continue; }
    const geom = (f && f.geometry) || {};
    const paths = geom.type === "MultiLineString" ? geom.coordinates
      : geom.type === "LineString" ? [geom.coordinates]
      : [];
    for (const path of paths) {
      if (!Array.isArray(path) || !path.length) continue;
      const pts = lngLatRingToFeet(path, origin.lon, origin.lat);
      if (pts && pts.length) out.lines.push({ elevFt, pts });
    }
  }
  return out;
}

/* FEMA S_XS (cross-section) FeatureCollection (featuresToGeoJson output — LineString /
 * MultiLineString per feature) → the modeled regulatory 1% water-surface elevations
 * (WSEL_REG) at each cross-section, in the planner's site-feet frame, filtered to
 * feet-NAVD88. Mirrors bfeLinesFromFeatureCollection: a WSEL_REG at the -9999 sentinel
 * is dropped as "no elevation"; a non-NAVD88 datum is EXCLUDED and counted (a mixed
 * datum is a multi-foot silent error). Each output section carries its REACH identity
 * (WTR_NM), station (STREAM_STN), letter (XS_LTR), and streambed elevation (STRMBED_EL)
 * so a consumer can pick the governing WSE per stream reach — never a globally-nearest
 * polyline across unrelated creeks. S_XS publishes no LEN_UNIT, so there is no meters
 * check. Missing/sentinel numeric attributes read as honest null, never a fabricated
 * value. `total` counts real-WSEL candidate sections. Pure. */
export function crossSectionWselFromFeatureCollection(fc, origin) {
  const out = { sections: [], excludedDatum: 0, total: 0 };
  if (!fc || !Array.isArray(fc.features) || !origin) return out;
  for (const f of fc.features) {
    const p = (f && f.properties) || {};
    const wselFt = realElev(p.WSEL_REG);
    if (wselFt == null) continue; // -9999 / missing — not a real elevation
    out.total += 1;
    if (!isNavd88Datum(p.V_DATUM)) { out.excludedDatum += 1; continue; }
    const wtrNm = p.WTR_NM == null ? "" : String(p.WTR_NM).trim();
    const streamStn = num(p.STREAM_STN);
    const xsLtr = p.XS_LTR == null || String(p.XS_LTR).trim() === "" ? null : String(p.XS_LTR).trim();
    const strmbedElFt = realElev(p.STRMBED_EL);
    const geom = (f && f.geometry) || {};
    const paths = geom.type === "MultiLineString" ? geom.coordinates
      : geom.type === "LineString" ? [geom.coordinates]
      : [];
    for (const path of paths) {
      if (!Array.isArray(path) || !path.length) continue;
      const pts = lngLatRingToFeet(path, origin.lon, origin.lat);
      if (pts && pts.length) out.sections.push({ wselFt, wtrNm, streamStn, xsLtr, strmbedElFt, pts });
    }
  }
  return out;
}

/* Interpolate a screening BFE (feet NAVD88) at a site-feet point from S_BFE lines.
 * Returns { bfeFt, provider:"bfe-line-interp", method, detail } or null.
 *   method "two-line-interp" — distance-weighted between the nearest line and the
 *          nearest line of a DIFFERENT elevation (the read-between-contours operation).
 *   method "nearest-line"    — only one contour is near, or the pair spans an
 *          implausible gap: snap to it (±~0.5 ft), flagged lower-confidence.
 * Returns null when no usable line sits within maxLineDistFt (honest UNKNOWN, never a
 * guess). detail carries loElev/hiElev (so the UI can show the conservative upper
 * bracket) and the distances used. Pure. */
export function deriveBfeFromLines({ point, lines, maxLineDistFt = 2500, maxGapFt = 6000 } = {}) {
  if (!point || !Array.isArray(lines) || !lines.length) return null;
  // Distance to each line, keeping the NEAREST occurrence per DISTINCT elevation (a
  // meander can put the same contour on both banks — that's not a bracketing pair).
  const byElev = new Map();
  for (const ln of lines) {
    if (ln == null || !isFinite(ln.elevFt)) continue;
    const d = distToPolyline(point, ln.pts);
    if (!isFinite(d)) continue;
    const prev = byElev.get(ln.elevFt);
    if (prev == null || d < prev) byElev.set(ln.elevFt, d);
  }
  if (!byElev.size) return null;
  const ranked = [...byElev.entries()].map(([elevFt, d]) => ({ elevFt, d })).sort((a, b) => a.d - b.d);
  const near = ranked[0];
  if (near.d > maxLineDistFt) return null; // nothing close enough to defend
  const other = ranked.find((r) => r.elevFt !== near.elevFt) || null;
  const loElev = other ? Math.min(near.elevFt, other.elevFt) : near.elevFt;
  const hiElev = other ? Math.max(near.elevFt, other.elevFt) : near.elevFt;
  if (other && (near.d + other.d) <= maxGapFt) {
    // frac = 0 at the near line → E_near; → 1 at the other line → E_other. Always
    // inside [loElev, hiElev]; biased toward the nearer contour.
    const frac = near.d / (near.d + other.d);
    return {
      bfeFt: near.elevFt + (other.elevFt - near.elevFt) * frac,
      provider: "bfe-line-interp",
      method: "two-line-interp",
      detail: { loElev, hiElev, dNearFt: near.d, dOtherFt: other.d, nearestFt: near.d, usedLines: ranked.length },
    };
  }
  // A single usable contour (or an implausibly wide pair) — snap to the nearest line.
  return {
    bfeFt: near.elevFt,
    provider: "bfe-line-interp",
    method: "nearest-line",
    detail: { loElev, hiElev, dNearFt: near.d, dOtherFt: other ? other.d : null, nearestFt: near.d, usedLines: ranked.length },
  };
}

/* The governing (highest) regulatory 1% WSE (WSEL_REG) at a site-feet point from FEMA
 * S_XS cross-sections. Cross-sections belong to a STREAM: a section on an unrelated
 * creek next door carries a water surface that has nothing to do with THIS reach, so
 * pricing off a globally-nearest polyline across creeks is wrong. We therefore GROUP by
 * reach (WTR_NM), snap to the NEAREST reach (its closest section to the point), and among
 * THAT reach's sections within maxDistFt take the HIGHEST WSEL_REG (the conservative
 * screening pick along a reach). Returns { wselFt, provider:"xs-wsel",
 * method:"nearest-reach", detail } or null (honest UNKNOWN) when no reach has a section
 * within maxDistFt. Pure. */
export function governingCrossSectionWsel({ point, sections, maxDistFt = 2500 } = {}) {
  if (!point || !Array.isArray(sections) || !sections.length) return null;
  // Group sections by reach (WTR_NM), keeping each section's distance to the point.
  // A BLANK/missing WTR_NM can't be assumed to be the same reach as another blank one, so
  // each unnamed section is its OWN isolated reach (unique key) — never merge two unnamed
  // sections, which would re-open the cross-creek multi-foot silent-error this function
  // exists to prevent (a named reach still groups all its sections).
  const byReach = new Map();
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (sec == null || !isFinite(sec.wselFt) || !Array.isArray(sec.pts) || !sec.pts.length) continue;
    const d = distToPolyline(point, sec.pts);
    if (!isFinite(d)) continue;
    const named = sec.wtrNm && String(sec.wtrNm).trim();
    const key = named ? sec.wtrNm : `__unnamed__${i}`;
    if (!byReach.has(key)) byReach.set(key, []);
    byReach.get(key).push({ wselFt: sec.wselFt, d });
  }
  if (!byReach.size) return null;
  // The nearest reach = the WTR_NM group whose closest section sits closest to the point.
  let nearestKey = null, nearestD = Infinity;
  for (const [key, list] of byReach) {
    let dMin = Infinity;
    for (const s of list) if (s.d < dMin) dMin = s.d;
    if (dMin < nearestD) { nearestD = dMin; nearestKey = key; }
  }
  if (nearestD > maxDistFt) return null; // nearest reach is out of range — honest UNKNOWN
  // Within that reach only, among sections in range, take the highest regulatory WSE.
  const inRange = byReach.get(nearestKey).filter((s) => s.d <= maxDistFt);
  if (!inRange.length) return null;
  let wselFt = -Infinity;
  for (const s of inRange) if (s.wselFt > wselFt) wselFt = s.wselFt;
  return {
    wselFt,
    provider: "xs-wsel",
    method: "nearest-reach",
    // Don't surface the synthetic __unnamed__ key as a stream name in the UI.
    detail: { wtrNm: String(nearestKey).startsWith("__unnamed__") ? null : nearestKey, dNearFt: nearestD, usedSections: inRange.length },
  };
}

/* The governing (highest) 1% water surface across the zones that touch a ring —
 * static BFE where published, else the manual BFE, else the derived BFE-line estimate.
 * B708's pond split consumes this. Returns { wseFt, provider } — provider
 * "static-bfe" | "ao-depth" | "manual" | "bfe-line-interp" | null. Pure. */
export function wse1pctForRing(ring, zones, { bfeFt = null, existGradeFt = null, derivedXsWselFt = null, derivedBfeFt = null } = {}) {
  const fb = ringBBox(ring);
  let best = null, provider = null;
  for (const z of zones) {
    if (z.cls !== "1pct" && z.cls !== "floodway") continue;
    if (!bboxOverlap(fb, z.bbox)) continue;
    const { areaSf } = gridIntersect(ring, z, null, { maxCells: 400 });
    if (!(areaSf > 0)) continue;
    if (z.staticBfeFt != null && (best == null || z.staticBfeFt > best)) { best = z.staticBfeFt; provider = "static-bfe"; }
    // Sheet-flow (AO) zones publish a DEPTH instead of a BFE — with a grade in hand
    // that IS this zone's water surface (a pond in an AO zone must not keep gross
    // credit just because no riverine BFE exists here).
    else if (z.aoDepthFt != null && existGradeFt != null && (best == null || existGradeFt + z.aoDepthFt > best)) {
      best = existGradeFt + z.aoDepthFt; provider = "ao-depth";
    }
  }
  if (best == null) {
    // Fallbacks, manual before derived: a value the user typed wins over the auto
    // BFE-line estimate. Only meaningful when the ring actually touches a 1% zone.
    const fallback = (bfeFt != null && isFinite(bfeFt)) ? { v: bfeFt, p: "manual" }
      : (derivedXsWselFt != null && isFinite(derivedXsWselFt)) ? { v: derivedXsWselFt, p: "xs-wsel" }
      : (derivedBfeFt != null && isFinite(derivedBfeFt)) ? { v: derivedBfeFt, p: "bfe-line-interp" }
      : null;
    if (fallback) {
      const touches = zones.some((z) => (z.cls === "1pct" || z.cls === "floodway") && bboxOverlap(fb, z.bbox) && gridIntersect(ring, z, null, { maxCells: 400 }).areaSf > 0);
      if (touches) { best = fallback.v; provider = fallback.p; }
    }
  }
  return { wseFt: best, provider };
}

/* Does a ring intersect any trigger-class zone for this rule? (B708/B712 helper.) */
export function ringInTrigger(ring, zones, rule) {
  const classes = new Set(triggerClasses(rule));
  classes.add("floodway"); // the floodway is inside the 1% — always a trigger-relevant touch
  const fb = ringBBox(ring);
  for (const z of zones) {
    if (!classes.has(z.cls)) continue;
    if (!bboxOverlap(fb, z.bbox)) continue;
    if (gridIntersect(ring, z, null, { maxCells: 400 }).areaSf > 0) return true;
  }
  return false;
}

/* ---------------------------------------------------------------------------------
 * computeMitigation — the volume core.
 *   V = ratio × Σ cellArea × max(0, min(WSE, padElev) − existGrade)
 * over every fill-footprint cell inside a TRIGGER-class zone. The floodway is
 * deliberately EXCLUDED from the volume ledger: fill there is prohibited
 * (floodwayPolicy), so its intersect reads as acres + a hard flag, never a
 * mitigation price. Zones of one class never overlap (NFHL S_Fld_Haz_Ar is a planar
 * partition), so per-zone sums don't double-count. Overlapping FOOTPRINTS would —
 * the caller passes the same non-overlapping element set the yield math uses.
 *
 *   footprints — [{ id, label, ring, padElevFt? }] in site feet
 *   zones      — zonesFromFeatureCollection output
 *   rule       — one floodplainRules record
 *   elev       — { padElevFt, existGradeFt, bfeFt, wse02Ft, avgFillDepthFt,
 *                  sources: { padElev?, existGrade? } }  (all optional; sources are
 *                  plain provenance labels the caller sets, e.g. "manual" | "3dep")
 * Pure. */
export function computeMitigation({ footprints = [], zones = [], rule = null, elev = {}, opts = {} } = {}) {
  const classes = rule ? triggerClasses(rule) : ["1pct"];
  const ratio = rule && isFinite(rule.ratio) ? rule.ratio : 1;
  const expert = elev.avgFillDepthFt != null && isFinite(elev.avgFillDepthFt) && elev.avgFillDepthFt >= 0;

  const flags = new Set();
  if (rule && rule.verified === false) flags.add("rule_unverified");
  if (zones.some((z) => z.unstudiedA)) flags.add("unstudied_a");
  if (zones.some((z) => z.vdatum && z.vdatum.toUpperCase() !== "NAVD88" && z.vdatum.toUpperCase() !== "NAVD 88")) flags.add("datum_mismatch");

  // Per-class accumulators. Volume stays null (UNKNOWN) until it is actually priceable.
  const perClass = {};
  for (const cls of [...classes, "floodway"]) perClass[cls] = { acres: 0, volumeCf: null, unknown: null };

  const padDefault = realElev(elev.padElevFt);
  const grade = realElev(elev.existGradeFt);
  const wse02 = realElev(elev.wse02Ft);
  const manualBfe = realElev(elev.bfeFt);
  const derivedBfe = realElev(elev.derivedBfeFt); // DERIVED from FEMA BFE lines (B755)
  const derivedXsWsel = realElev(elev.derivedXsWselFt); // DERIVED 1% WSE from FEMA S_XS WSEL_REG (B763)
  const derived02 = realElev(elev.derivedWse02Ft); // DERIVED 0.2% WSE — engine seam (B763)
  const wseProviders = new Set();
  const wse02Providers = new Set(); // tracked SEPARATELY so the 0.2% "manual" never collides with the 1% "manual"

  for (const z of zones) {
    const bucket = perClass[z.cls];
    if (!bucket) continue; // a class outside this rule's trigger (e.g. 02pct under a 1pct-only rule)

    // The zone's water surface (feet NAVD88), by provider precedence:
    //   1% zones: published static BFE → (AO) grade + its published DEPTH → manual
    //   BFE → unknown. An AO zone's own DEPTH is that zone's published data — a
    //   manual BFE entered for a nearby AE reach must never override it (sheet-flow
    //   ponding isn't riverine backwater; pricing it off the AE BFE mis-prices both
    //   ways). 0.2% band: manual WSE only in v1 (not an NFHL attribute; named hook
    //   for HCFCD/MAAPnext grids later).
    let wse = null, wseSrc = null;
    if (z.cls === "1pct") {
      if (z.staticBfeFt != null) { wse = z.staticBfeFt; wseSrc = "static-bfe"; }
      else if (z.aoDepthFt != null && grade != null) { wse = grade + z.aoDepthFt; wseSrc = "ao-depth"; }
      else if (manualBfe != null) { wse = manualBfe; wseSrc = "manual"; }
      // Derived screening 1% WSE from FEMA's S_XS cross-sections (WSEL_REG on the nearest
      // reach, B763) — ranks below manual entry but ABOVE the S_BFE-line interpolation
      // (a modeled regulatory WSE beats a read-between-contours estimate).
      else if (derivedXsWsel != null) { wse = derivedXsWsel; wseSrc = "xs-wsel"; }
      // Last resort before UNKNOWN: a BFE DERIVED by interpolating FEMA's S_BFE lines
      // (B755). Manual entry above still wins; a zone's own published data (static BFE,
      // AO depth) always wins — the derived value only fills a genuine gap.
      else if (derivedBfe != null) { wse = derivedBfe; wseSrc = "bfe-line-interp"; }
    } else if (z.cls === "02pct") {
      // 0.2% band: a manually-entered WSE wins; else a derived 0.2% WSE (B763 engine
      // seam — a named hook for an HCFCD/MAAPnext or S_XS 500-yr model later).
      if (wse02 != null) { wse = wse02; wseSrc = "manual"; }
      else if (derived02 != null) { wse = derived02; wseSrc = "xs-wsel-02"; }
    }

    for (const fp of footprints) {
      const ring = fp.ring;
      if (!Array.isArray(ring) || ring.length < 3) continue;

      if (z.cls === "floodway") {
        // Geometry + hard flag only — fill in the floodway is prohibited, not priced.
        const { areaSf } = gridIntersect(ring, z, null, opts);
        if (areaSf > 0) { bucket.acres += areaSf / SQFT_PER_ACRE; flags.add("floodway_intersect"); }
        continue;
      }

      const pad = realElev(fp.padElevFt) ?? padDefault;

      if (expert) {
        // Expert bypass: "average depth of fill below the flood elevation (ft)" —
        // volume = ratio × intersect area × that constant depth. Geometry unchanged.
        const { areaSf } = gridIntersect(ring, z, null, opts);
        if (areaSf > 0) {
          bucket.acres += areaSf / SQFT_PER_ACRE;
          bucket.volumeCf = (bucket.volumeCf || 0) + areaSf * elev.avgFillDepthFt;
        }
        continue;
      }

      const priceable = wse != null && pad != null && grade != null;
      const depthAt = priceable ? () => Math.max(0, Math.min(wse, pad) - grade) : null;
      const { areaSf, sumDepthArea } = gridIntersect(ring, z, depthAt, opts);
      if (!(areaSf > 0)) continue;
      bucket.acres += areaSf / SQFT_PER_ACRE;
      if (priceable) {
        bucket.volumeCf = (bucket.volumeCf || 0) + sumDepthArea;
        if (wseSrc) (z.cls === "02pct" ? wse02Providers : wseProviders).add(wseSrc);
      } else if (!bucket.unknown) {
        bucket.unknown =
          wse == null
            ? (z.cls === "02pct"
                ? "0.2% water-surface elevation not entered (not an NFHL attribute — FEMA FIS profile / HCFCD model data)"
                : z.unstudiedA
                  ? "unstudied Zone A — BFE undetermined from the map"
                  : "no published BFE on this reach — enter the BFE (the common case on AE polygons)")
            : pad == null
              ? "pad / finished-floor elevation not entered"
              : "existing-grade elevation unavailable";
      }
    }
  }

  // Apply the mitigation ratio to the priced classes; roll up totals honestly:
  // any trigger class with intersect acreage but an unknown volume makes the TOTAL
  // volume unknown too (a partial sum would read as smaller-than-real — the silent-
  // error class this engine exists to prevent). A genuinely-zero intersect is a real
  // 0, not an UNKNOWN — UNKNOWN is reserved for missing elevations / failed sources.
  // The floodway ledger stays separate: its acres never price and never poison the
  // trigger-volume total (fill there is prohibited outright, not mitigable).
  let triggerAcres = 0, totalVolumeCf = 0, anyUnknown = null;
  for (const cls of classes) {
    const b = perClass[cls];
    if (b.volumeCf != null) { b.volumeCf *= ratio; totalVolumeCf += b.volumeCf; }
    if (b.acres > 0 && b.volumeCf == null) anyUnknown = b.unknown || "elevation inputs missing";
    triggerAcres += b.acres;
  }
  const floodwayAcres = perClass.floodway ? perClass.floodway.acres : 0;
  const totalAcres = triggerAcres + floodwayAcres;
  const volumeKnown = !anyUnknown; // zero trigger acres → a real 0, not UNKNOWN

  return {
    trigger: rule ? rule.trigger : "1pct",
    ratio,
    perClass,
    intersectAcres: totalAcres,
    triggerAcres,
    floodwayAcres,
    volumeCf: volumeKnown ? totalVolumeCf : null,
    volumeAcFt: volumeKnown ? totalVolumeCf / SQFT_PER_ACRE : null,
    cutCy: volumeKnown ? totalVolumeCf / CF_PER_CY : null,
    unknownReason: anyUnknown,
    expertBypass: expert,
    flags: [...flags],
    providers: {
      padElev: (elev.sources && elev.sources.padElev) || (padDefault != null ? "manual" : null),
      existGrade: (elev.sources && elev.sources.existGrade) || (grade != null ? "manual" : null),
      wse1pct: wseProviders.has("static-bfe") && wseProviders.size > 1 ? "mixed"
        : wseProviders.has("static-bfe") ? "static-bfe"
        : wseProviders.has("ao-depth") ? "ao-depth"
        : wseProviders.has("manual") ? "manual"
        : wseProviders.has("xs-wsel") ? "xs-wsel"
        : wseProviders.has("bfe-line-interp") ? "bfe-line-interp" : null,
      // 0.2% provider is mixed-aware but its own tier ("xs-wsel-02"), tracked apart from
      // the 1% chain so a priced 0.2% zone never reads as a 1% "manual".
      wse02pct: wse02Providers.has("manual") ? "manual"
        : wse02Providers.has("xs-wsel-02") ? "xs-wsel-02" : null,
      expert: expert ? "avg-fill-depth" : null,
    },
  };
}

/* Effective pad elevation for one fill element (B713 — the dock-high pattern):
 * industrial buildings are dock-high, so the truck court (and its dock-stack
 * trailer strip) sits ~4 ft BELOW the slab finished floor. Pricing the court at
 * slab FF overstates its fill by dockDropFt × its whole area. Precedence:
 *   el.padElevFt (explicit per-element override)
 *   → slab FF − dockDropFt for dock-stack elements (truckCourt / forCourt tags)
 *   → slab FF for everything else
 *   → null (UNKNOWN downstream) when no plan FFE is entered.
 * The buffer strip (forTrailer) is landscape — pervious, never fill. Pure. */
export function effectivePadElev(el, { padFfeFt = null, dockDropFt = 4 } = {}) {
  if (el && el.padElevFt != null && isFinite(el.padElevFt)) return el.padElevFt;
  if (padFfeFt == null || !isFinite(padFfeFt)) return null;
  const drop = dockDropFt != null && isFinite(dockDropFt) ? dockDropFt : 4;
  return el && (el.truckCourt || el.forCourt) ? padFfeFt - drop : padFfeFt;
}

/* Combine per-footprint computeMitigation results into one ledger (B712's
 * per-element memoization: during a drag only the dragged element recomputes, so
 * results merge here). Sums are additive (NFHL classes are a planar partition);
 * an UNKNOWN volume in ANY part keeps the combined volume UNKNOWN (a partial sum
 * would read smaller-than-real); flags union; providers keep the first real label.
 * Pure. */
export function combineMitigation(results) {
  const list = (results || []).filter(Boolean);
  if (!list.length) return null;
  const out = JSON.parse(JSON.stringify(list[0]));
  for (const r of list.slice(1)) {
    for (const [cls, b] of Object.entries(r.perClass)) {
      const t = out.perClass[cls] || (out.perClass[cls] = { acres: 0, volumeCf: null, unknown: null });
      t.acres += b.acres;
      if (b.unknown && !t.unknown) t.unknown = b.unknown;
      // A bucket that never intersected (acres 0, volume null, no unknown) adds 0.
      if (t.unknown) t.volumeCf = null;
      else if (b.volumeCf != null || t.volumeCf != null) t.volumeCf = (t.volumeCf || 0) + (b.volumeCf || 0);
    }
    out.intersectAcres += r.intersectAcres;
    out.triggerAcres += r.triggerAcres;
    out.floodwayAcres += r.floodwayAcres;
    if (r.unknownReason && !out.unknownReason) out.unknownReason = r.unknownReason;
    // A no-unknown result always carries a NUMBER (a real 0 for zero intersect), so
    // outside the unknown case the sum is plain addition.
    out.volumeCf = out.unknownReason ? null : (out.volumeCf || 0) + (r.volumeCf || 0);
    for (const f of r.flags) if (!out.flags.includes(f)) out.flags.push(f);
    for (const [k, v] of Object.entries(r.providers)) if (v && !out.providers[k]) out.providers[k] = v;
    out.expertBypass = out.expertBypass || r.expertBypass;
  }
  if (out.unknownReason) out.volumeCf = null;
  out.volumeAcFt = out.volumeCf != null ? out.volumeCf / SQFT_PER_ACRE : null;
  out.cutCy = out.volumeCf != null ? out.volumeCf / CF_PER_CY : null;
  return out;
}

/* Straddle helper: worst case across per-candidate results (highest known volume;
 * any candidate with an UNKNOWN volume keeps the whole answer flagged). Pure. */
export function pickWorstCase(results) {
  if (!results || !results.length) return null;
  let best = results[0];
  for (const r of results) {
    if (r.result.volumeCf != null && (best.result.volumeCf == null || r.result.volumeCf > best.result.volumeCf)) best = r;
  }
  const anyUnknown = results.some((r) => r.result.volumeCf == null && r.result.intersectAcres > 0);
  return { ...best, straddle: true, anyUnknown };
}

/* Lon/lat envelope for the NFHL pull: the active-parcel rings PLUS the drawn
 * elements' extent (fill can sit outside a parcel), padded so edge-touching zones
 * aren't clipped. Site-scoped — never the map view. Pure. */
export function floodGeoBbox(lonLatRings, padDeg = 0.001) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of lonLatRings || []) for (const [lng, lat] of ring) {
    if (lng < w) w = lng; if (lng > e) e = lng;
    if (lat < s) s = lat; if (lat > n) n = lat;
  }
  if (!isFinite(w)) return null;
  return { w: w - padDeg, s: s - padDeg, e: e + padDeg, n: n + padDeg };
}

/* Standing copy (single source so panel/print never drift). */
export const NAVD88_NOTE =
  "All elevations are feet NAVD88. Older documents may cite NGVD29 — Houston-area subsidence makes mixed datums a multi-foot silent error; convert before entering.";
export const NEWER_MODEL_NOTE =
  "Jurisdictions may enforce newer model elevations (e.g. MAAPnext) HIGHER than the effective FIRM — when in doubt, enter the higher water surface.";
export const EXCLUSIONS_NOTE =
  "Screening checks total volume only. Not modeled: perimeter tie-in slopes; stage-band distribution (“hydraulically equivalent” placement); hydrograph routing; conveyance hydraulics.";
export const OFFSITE_NOTE =
  "Floodplain sites often pass OFFSITE flow — upstream contributing area and conveyance through the site are your engineer's check, not modeled here.";
export const EXPERT_BYPASS_LABEL = "average depth of fill below the flood elevation (ft)";
export const DERIVED_BFE_NOTE =
  "This BFE was DERIVED by interpolating FEMA's published Base Flood Elevation lines at your fill — a screening estimate, not a published or surveyed value. Confirm before design; type a BFE to override.";
export const DERIVED_XS_WSEL_NOTE =
  "This 1% water surface was DERIVED from FEMA's published S_XS cross-section regulatory water-surface elevation (WSEL_REG) on the nearest modeled stream reach — a screening estimate, not a surveyed value, and never a cross-creek pick. Confirm before design; type a BFE to override.";
export const DERIVED_WSE02_NOTE =
  "This 0.2% (500-yr) water surface was DERIVED from a cross-section / regional model at your fill — a screening estimate, not a published or surveyed value. Confirm before design; type a 0.2% WSE to override.";
