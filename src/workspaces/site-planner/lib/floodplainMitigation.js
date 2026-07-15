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
// NEW-1 (Waller floodway buffer): a zone carrying `bufferFt` also claims every point
// within that distance of ANY ring boundary — a true distance test, so islands inside
// the polygon and ground just outside it are both captured by the buffer band.
export const pointInZone = (pt, zone) => {
  let inside = false;
  for (const ring of zone.rings) if (pointInRing(pt, ring)) inside = !inside;
  if (inside || !(zone.bufferFt > 0)) return inside;
  for (const ring of zone.rings) {
    if (distToPolyline(pt, ring) <= zone.bufferFt) return true;
    // distToPolyline walks open segments — close the loop explicitly.
    const n = ring.length;
    if (n >= 2) {
      const a = ring[n - 1], b = ring[0];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 === 0 ? 0 : ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy)) <= zone.bufferFt) return true;
    }
  }
  return false;
};

/* NEW-1 (Waller) — wrap a floodway zone in its jurisdiction's prohibition buffer:
 * pointInZone/gridIntersect then screen the buffer band as floodway-class (the hard
 * stop extends `bufferFt` beyond the mapped boundary). The flood EXTENT semantics
 * (trigger bands, WSE sampling, ringInTrigger) deliberately do NOT buffer — §E is a
 * fill/encroachment setback, not a bigger flood. Pure. */
export const bufferedFloodway = (z, bufferFt) =>
  z.cls === "floodway" && bufferFt > 0
    ? { ...z, bufferFt, bbox: [z.bbox[0] - bufferFt, z.bbox[1] - bufferFt, z.bbox[2] + bufferFt, z.bbox[3] + bufferFt] }
    : z;

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
 * (screening tolerance), cell-center sampling. Returns
 *   { areaSf, sumDepthArea, pricedCells, voidCells, cells? } where sumDepthArea =
 * Σ cellArea × depthAt(cell). B808: a depthAt that returns null names a DEM VOID under
 * that cell — the cell is excluded from the volume and COUNTED (the caller flags >5%
 * loudly; a void priced as zero would silently under-price). B809: opts.retainCells
 * keeps the priced cells ([{x, y, wFt, hFt, depthFt}]) — the SAME cells that summed,
 * so the heat map can never diverge from the ledger; with no depthAt (floodway /
 * unpriced buckets) retained cells carry depthFt: null (area-only geography). Pure. */
export function gridIntersect(ring, zone, depthAt = null, opts = {}) {
  const maxCells = opts.maxCells || 1500;
  const minCellFt = opts.minCellFt || 2;
  const retain = !!opts.retainCells;
  const empty = { areaSf: 0, sumDepthArea: 0, pricedCells: 0, voidCells: 0, cells: retain ? [] : undefined };
  const fb = ringBBox(ring);
  if (!bboxOverlap(fb, zone.bbox)) return empty;
  const x0 = Math.max(fb[0], zone.bbox[0]), y0 = Math.max(fb[1], zone.bbox[1]);
  const x1 = Math.min(fb[2], zone.bbox[2]), y1 = Math.min(fb[3], zone.bbox[3]);
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0) || !(h > 0)) return empty;
  const cell = Math.max(minCellFt, Math.sqrt((w * h) / maxCells));
  const nx = Math.max(1, Math.ceil(w / cell)), ny = Math.max(1, Math.ceil(h / cell));
  const dx = w / nx, dy = h / ny, cellArea = dx * dy;
  const cells = retain ? [] : undefined;
  let areaSf = 0, sumDepthArea = 0, pricedCells = 0, voidCells = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const pt = { x: x0 + (i + 0.5) * dx, y: y0 + (j + 0.5) * dy };
      if (!pointInRing(pt, ring)) continue;
      if (!pointInZone(pt, zone)) continue;
      areaSf += cellArea;
      if (depthAt) {
        const d = depthAt(pt);
        if (d == null || !isFinite(d)) { voidCells++; continue; }
        pricedCells++;
        if (d > 0) {
          sumDepthArea += cellArea * d;
          if (retain) cells.push({ x: pt.x, y: pt.y, wFt: dx, hFt: dy, depthFt: d });
        }
      } else if (retain) {
        cells.push({ x: pt.x, y: pt.y, wFt: dx, hFt: dy, depthFt: null });
      }
    }
  }
  return { areaSf, sumDepthArea, pricedCells, voidCells, cells };
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

/* ---------------------------------------------------------------------------------
 * NEW-2 — estimated 1% WSE for UNSTUDIED Zone A, from grade along the zone boundary.
 *
 * FEMA's approximate-Zone-A method: the mapped flood extent is where the flood
 * surface daylights into grade, so ground elevation along the Zone A polygon's
 * boundary approximates the water surface (the contour-interpolation technique).
 * We sample the DEM (the B808 per-cell 3DEP grid sampler) along the zone's REAL
 * NFHL boundary segments near the site and take the MEDIAN, reporting the spread.
 *
 * Honesty rules:
 *   • plain Zone A only (z.unstudiedA && z.zone === "A") — an AO zone's published
 *     DEPTH is its own provider (ao-depth) and must never be overridden or mimicked.
 *   • gradeAt null/absent (DEM outage or manual flat grade) → null. An outage is
 *     never an estimate.
 *   • fmZone rings are FULL NFHL polygons (never clipped to the site), so every
 *     vertex is a real flood-boundary point; we filter samples to the site
 *     VICINITY (padded bbox of the caller's rings) — no site-clip-line artifacts.
 *   • too few valid samples → null (no defensible median).
 * The result is a SCREENING estimate the user must explicitly ACCEPT into the BFE
 * field (provider "est-boundary-grade") — never auto-committed. Pure. */
export function sampleRingGrades(ring, gradeAt, { stepFt = 50, within = null } = {}) {
  const vals = [];
  if (!Array.isArray(ring) || ring.length < 2 || typeof gradeAt !== "function") return vals;
  const inBox = (p) => !within || (p.x >= within[0] && p.y >= within[1] && p.x <= within[2] && p.y <= within[3]);
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(segLen / Math.max(1, stepFt)));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const pt = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (!inBox(pt)) continue;
      const g = gradeAt(pt);
      if (g != null && isFinite(g)) vals.push(g);
    }
  }
  return vals;
}

export function estimateZoneAWse({ zones = [], siteRings = [], gradeAt = null, padFt = 300, stepFt = 50, minSamples = 6 } = {}) {
  if (typeof gradeAt !== "function") return null;
  const targets = zones.filter((z) => z.unstudiedA && z.zone === "A" && Array.isArray(z.rings) && z.rings.length);
  if (!targets.length) return null;
  // The site vicinity: padded bbox over the caller's rings (parcels + fill elements).
  let within = null;
  if (Array.isArray(siteRings) && siteRings.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ring of siteRings) for (const p of ring || []) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    if (isFinite(minX)) within = [minX - padFt, minY - padFt, maxX + padFt, maxY + padFt];
  }
  const samples = [];
  let zonesSampled = 0;
  for (const z of targets) {
    let zoneVals = [];
    for (const ring of z.rings) zoneVals = zoneVals.concat(sampleRingGrades(ring, gradeAt, { stepFt, within }));
    if (zoneVals.length) zonesSampled++;
    for (const v of zoneVals) samples.push(v);
  }
  if (samples.length < minSamples) return null;
  samples.sort((a, b) => a - b);
  const mid = samples.length >> 1;
  const median = samples.length % 2 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2;
  const minFt = samples[0], maxFt = samples[samples.length - 1];
  return {
    wseFt: Math.round(median * 10) / 10,
    provider: "est-boundary-grade",
    detail: { samples: samples.length, zones: zonesSampled, minFt, maxFt, spreadFt: maxFt - minFt },
  };
}

/* NEW-3 — screening "highest adjacent grade" (HAG) for one building footprint:
 * the MAX DEM grade along the footprint's perimeter (Waller §D(5) measures the slab
 * from the highest adjacent grade; per-element, since HAG varies by building).
 * Returns { hagFt, samples } or null when the DEM can't support it. Pure. */
export function hagForRing(ring, gradeAt, { stepFt = 25 } = {}) {
  const vals = sampleRingGrades(ring, gradeAt, { stepFt });
  if (!vals.length) return null;
  let max = -Infinity;
  for (const v of vals) if (v > max) max = v;
  return { hagFt: max, samples: vals.length };
}

/* The governing (highest) 1% water surface across the zones that touch a ring —
 * static BFE where published, else the manual BFE, else the derived estimates.
 * B708's pond split consumes this. Returns { wseFt, provider } — provider
 * "static-bfe" | "ao-depth" | "manual" | "xs-wsel" | "bfe-line-interp" |
 * the caller-named derivedWse1pctSrc (default "derived-wse100", B807) | null. Pure. */
export function wse1pctForRing(ring, zones, { bfeFt = null, bfeSrc = null, existGradeFt = null, derivedXsWselFt = null, derivedBfeFt = null, derivedWse1pctFt = null, derivedWse1pctSrc = null } = {}) {
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
    // NEW-2: an ACCEPTED boundary-grade estimate rides the manual rung but keeps its
    // own provider tag (bfeSrc "est-boundary-grade") so the ESTIMATED stamp survives.
    const fallback = (bfeFt != null && isFinite(bfeFt)) ? { v: bfeFt, p: bfeSrc || "manual" }
      : (derivedXsWselFt != null && isFinite(derivedXsWselFt)) ? { v: derivedXsWselFt, p: "xs-wsel" }
      : (derivedBfeFt != null && isFinite(derivedBfeFt)) ? { v: derivedBfeFt, p: "bfe-line-interp" }
      // LAST in precedence (B807): a DRAFT study raster never outranks effective-model
      // data — FBC Interim §9's mitigation basis is the PRE-Atlas-14 effective floodplain.
      : (derivedWse1pctFt != null && isFinite(derivedWse1pctFt)) ? { v: derivedWse1pctFt, p: derivedWse1pctSrc || "derived-wse100" }
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
 *                  derivedBfeFt, derivedXsWselFt,                    (B755/B763 derived 1%)
 *                  derivedWse02Ft, derivedWse02Src,                  (B763/B770 derived 0.2%)
 *                  derivedWse1pctFt, derivedWse1pctSrc,              (B807 derived 1%, LAST rung)
 *                  sources: { padElev?, existGrade? } }  (all optional; sources are
 *                  plain provenance labels the caller sets, e.g. "manual" | "3dep")
 * Pure. */
/* A zone's water surface (feet NAVD88), by provider precedence — the ONE chain both
 * computeMitigation and wedgeMitigation (B833) price against:
 *   1% zones: published static BFE → (AO) grade + its published DEPTH → manual BFE →
 *   derived XS WSEL (B763) → derived BFE-line interpolation (B755) → derived DRAFT
 *   1% raster (B807, caller-named source) → unknown. An AO zone's own DEPTH is that
 *   zone's published data — a manual BFE entered for a nearby AE reach must never
 *   override it (sheet-flow ponding isn't riverine backwater).
 *   0.2% band: manual WSE → derived 0.2% (B763 seam, caller-named source) → unknown.
 * env values are already realElev()-cleaned by the caller. Pure. */
export function zoneWaterSurface(z, { grade = null, wse02 = null, manualBfe = null, manualBfeSrc = null, derivedXsWsel = null, derivedBfe = null, derived1pct = null, derived02 = null, derivedWse1pctSrc = null, derivedWse02Src = null } = {}) {
  let wse = null, wseSrc = null;
  if (z.cls === "1pct") {
    if (z.staticBfeFt != null) { wse = z.staticBfeFt; wseSrc = "static-bfe"; }
    else if (z.aoDepthFt != null && grade != null) { wse = grade + z.aoDepthFt; wseSrc = "ao-depth"; }
    // NEW-2: an accepted boundary-grade estimate rides the manual rung, own tag.
    else if (manualBfe != null) { wse = manualBfe; wseSrc = manualBfeSrc || "manual"; }
    else if (derivedXsWsel != null) { wse = derivedXsWsel; wseSrc = "xs-wsel"; }
    else if (derivedBfe != null) { wse = derivedBfe; wseSrc = "bfe-line-interp"; }
    else if (derived1pct != null) { wse = derived1pct; wseSrc = derivedWse1pctSrc || "derived-wse100"; }
  } else if (z.cls === "02pct") {
    if (wse02 != null) { wse = wse02; wseSrc = "manual"; }
    else if (derived02 != null) { wse = derived02; wseSrc = derivedWse02Src || "xs-wsel-02"; }
  }
  return { wse, wseSrc };
}

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
  // B808 — the per-cell existing-grade sampler (site-feet pt → ft NAVD88 | null on a DEM
  // void). Precedence: a MANUAL grade always wins (flat mode, unchanged — the caller tags
  // sources.existGrade "manual"); else the grid prices per cell; else the flat median.
  const gradeAt = typeof elev.gradeAt === "function" && !(elev.sources && elev.sources.existGrade === "manual")
    ? elev.gradeAt : null;
  const gradeBasis = gradeAt ? "grid"
    : grade != null ? ((elev.sources && elev.sources.existGrade === "manual") ? "manual" : "median")
    : null;
  const retainCells = !!opts.retainCells;
  const allCells = retainCells ? [] : undefined;
  let voidCellsTotal = 0, pricedCellsTotal = 0, flatSumCf = 0, flatKnown = gradeAt != null && grade != null;
  // B826 — did any footprint price off a PROPOSED SURFACE (fp.surfaceAt)? Drives the
  // padBasis label + suppresses the grid-vs-flat delta flag (surface vs flat-pad is an
  // EXPECTED difference — dock courts price at their real planes — not a data warning).
  let surfacePriced = false;
  const wse02 = realElev(elev.wse02Ft);
  const manualBfe = realElev(elev.bfeFt);
  const derivedBfe = realElev(elev.derivedBfeFt); // DERIVED from FEMA BFE lines (B755)
  const derivedXsWsel = realElev(elev.derivedXsWselFt); // DERIVED 1% WSE from FEMA S_XS WSEL_REG (B763)
  const derived02 = realElev(elev.derivedWse02Ft); // DERIVED 0.2% WSE — engine seam (B763)
  const derived1pct = realElev(elev.derivedWse1pctFt); // DERIVED 1% WSE — engine seam (B807, e.g. the FBCDD Atlas-14 DRAFT rasters)
  const wseProviders = new Set();
  const wse02Providers = new Set(); // tracked SEPARATELY so the 0.2% "manual" never collides with the 1% "manual"

  for (const z of zones) {
    const bucket = perClass[z.cls];
    if (!bucket) continue; // a class outside this rule's trigger (e.g. 02pct under a 1pct-only rule)

    // The zone's water surface — the shared provider chain (extracted for B833's
    // wedgeMitigation so the wedge cells price against the SAME precedence).
    const { wse, wseSrc } = zoneWaterSurface(z, { grade, wse02, manualBfe, manualBfeSrc: elev.bfeSrc || null, derivedXsWsel, derivedBfe, derived1pct, derived02, derivedWse1pctSrc: elev.derivedWse1pctSrc, derivedWse02Src: elev.derivedWse02Src });

    for (const fp of footprints) {
      const ring = fp.ring;
      if (!Array.isArray(ring) || ring.length < 3) continue;

      if (z.cls === "floodway") {
        // Geometry + hard flag only — fill in the floodway is prohibited, not priced.
        // NEW-1 (Waller): a rule with floodwayBufferFt extends the prohibition band
        // that far past the mapped boundary; buffer-only acreage flags separately so
        // the copy can name the setback (still the same hard stop, never a price).
        const bufFt = rule && rule.floodwayBufferFt > 0 ? rule.floodwayBufferFt : 0;
        const zEff = bufFt ? bufferedFloodway(z, bufFt) : z;
        const fw = gridIntersect(ring, zEff, null, { ...opts, retainCells });
        if (fw.areaSf > 0) {
          bucket.acres += fw.areaSf / SQFT_PER_ACRE;
          flags.add("floodway_intersect");
          if (bufFt && gridIntersect(ring, z, null, opts).areaSf < fw.areaSf - 1e-6) flags.add("floodway_buffer");
          if (retainCells && fw.cells) for (const c of fw.cells) allCells.push({ cls: "floodway", fpId: fp.id, ...c });
        }
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

      // B826 — a per-footprint PROPOSED SURFACE (the proposedSurface.js plane) replaces
      // the flat pad in the depth math when present: fill = min(WSE, surface(pt)) −
      // grade(pt) per cell, so a dock court 4′ below slab prices its REAL plane, not a
      // scalar. The flat-pad path below stays intact as the labeled pre-grading fallback.
      const surfAt = typeof fp.surfaceAt === "function" ? fp.surfaceAt : null;
      const topAt = surfAt ? (pt) => { const s = surfAt(pt); return s != null && isFinite(s) ? s : pad; } : null;
      const priceable = wse != null && (pad != null || surfAt != null) && (gradeAt != null || grade != null);
      // B808 — per-cell depth when the grid grade is active. AO zones (published sheet-
      // ponding DEPTH, wseSrc "ao-depth") price that depth riding the ground PER CELL,
      // capped by the pad — the close-out decision: AO's water surface is grade-relative
      // by definition, so a per-cell grade means a per-cell surface, not the median plane.
      const aoPerCell = gradeAt != null && wseSrc === "ao-depth" && z.aoDepthFt != null;
      const depthAt = !priceable ? null
        : gradeAt != null
          ? (aoPerCell
              ? (pt) => { const g = gradeAt(pt); if (g == null) return null; const p = topAt ? topAt(pt) : pad; return p == null ? null : Math.max(0, Math.min(z.aoDepthFt, p - g)); }
              : (pt) => { const g = gradeAt(pt); if (g == null) return null; const p = topAt ? topAt(pt) : pad; return p == null ? null : Math.max(0, Math.min(wse, p) - g); })
          : (topAt
              ? (pt) => { const p = topAt(pt); return p == null ? null : Math.max(0, Math.min(wse, p) - grade); }
              : () => Math.max(0, Math.min(wse, pad) - grade));
      const { areaSf, sumDepthArea, pricedCells, voidCells, cells } = gridIntersect(ring, z, depthAt, { ...opts, retainCells });
      if (!(areaSf > 0)) continue;
      bucket.acres += areaSf / SQFT_PER_ACRE;
      if (priceable) {
        bucket.volumeCf = (bucket.volumeCf || 0) + sumDepthArea;
        if (surfAt) surfacePriced = true;
        if (wseSrc) (z.cls === "02pct" ? wse02Providers : wseProviders).add(wseSrc);
        voidCellsTotal += voidCells; pricedCellsTotal += pricedCells;
        // B808 — the flat-median comparison, accumulated in the SAME intersect (the flat
        // depth is constant per zone×footprint, so no second pass): surfaces the sites
        // where the old single-number grade was silently wrong (the >15% delta flag).
        // B826: with a surface it reads "what the flat-pad estimate would have said" —
        // still needs the scalar pad (a surface-only footprint drops the comparison).
        if (gradeAt != null && grade != null && pad != null) flatSumCf += areaSf * Math.max(0, Math.min(wse, pad) - grade);
        else flatKnown = false;
        if (retainCells && cells) for (const c of cells) allCells.push({ cls: z.cls, fpId: fp.id, ...c });
      } else if (retainCells && cells) {
        // Unpriced bucket: the geography still renders (grey hatch + reason on the map).
        for (const c of cells) allCells.push({ cls: z.cls, fpId: fp.id, ...c });
      }
      if (!priceable && !bucket.unknown) {
        bucket.unknown =
          wse == null
            ? (z.cls === "02pct"
                ? "no 0.2% (500-yr) WSE — enter it from the EFFECTIVE FIS profile (not an NFHL attribute; no derived value was available this check)"
                : z.unstudiedA
                  ? "unstudied Zone A — BFE undetermined from the map"
                  : "no published BFE on this reach — enter the BFE (the common case on AE polygons)")
            : pad == null
              ? "pad / finished-floor elevation not entered"
              : "existing-grade elevation unavailable";
      }
    }
  }

  // B794 — sanity guard: a 0.2% (500-yr) water surface can never sit BELOW the 1% (100-yr)
  // surface on the same reach. A DERIVED 0.2% reading lower than the best-known 1% WSE is a
  // study/vintage mismatch (e.g. an Atlas-14 draft grid against an older effective profile) —
  // FLAG it loudly, never clamp: the value still shows, labeled, and the user decides.
  if (derived02 != null) {
    const ref1 = Math.max(
      ...zones.filter((z) => z.cls === "1pct" && z.staticBfeFt != null).map((z) => z.staticBfeFt),
      manualBfe ?? -Infinity, derivedXsWsel ?? -Infinity, derivedBfe ?? -Infinity,
      // B807: the derived 1% joins the reference — on a pure Zone-A site it is the ONLY
      // 1% surface, and without it this guard could never fire there.
      derived1pct ?? -Infinity,
    );
    if (Number.isFinite(ref1) && derived02 < ref1 - 0.05) flags.add("wse02-below-1pct");
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

  // B808 — grid honesty rollups. Voids: cells the DEM couldn't price (excluded, counted);
  // >5% of the intersect is LOUD — the volume still stands on the valid cells, but the
  // reader must know a slice of the footprint priced blind. Delta: grid vs flat-median
  // volume >15% apart names the sites the old single-number grade silently mis-priced.
  const totalGridCells = voidCellsTotal + pricedCellsTotal;
  if (gradeAt != null && totalGridCells > 0 && voidCellsTotal > 0.05 * totalGridCells) flags.add("grid-voids");
  const volumeFlatCf = gradeAt != null && flatKnown && volumeKnown ? flatSumCf * ratio : null;
  // B826 — no delta flag on a surface basis: surface-vs-flat-pad differing is the POINT
  // (the courts price their real planes); the padBasis label carries that story instead.
  if (volumeKnown && volumeFlatCf != null && volumeFlatCf > 0 && !surfacePriced && Math.abs(totalVolumeCf - volumeFlatCf) / volumeFlatCf > 0.15) {
    flags.add("grid-median-delta");
  }

  return {
    gradeBasis,
    padBasis: surfacePriced ? "surface" : "flat", // B826 — what the fill's TOP was priced at
    volumeFlatCf,
    voidCells: voidCellsTotal,
    pricedCells: pricedCellsTotal,
    ...(retainCells ? { cells: allCells } : {}),
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
      // B826 — a surface-priced result names its basis; the flat path keeps its labels.
      padElev: surfacePriced ? "proposed-surface"
        : (elev.sources && elev.sources.padElev) || (padDefault != null ? "manual" : null),
      // B808 — the grid basis names itself; the caller's label covers manual/median.
      existGrade: gradeBasis === "grid" ? "3dep-grid"
        : (elev.sources && elev.sources.existGrade) || (grade != null ? "manual" : null),
      wse1pct: wseProviders.has("static-bfe") && wseProviders.size > 1 ? "mixed"
        : wseProviders.has("static-bfe") ? "static-bfe"
        : wseProviders.has("ao-depth") ? "ao-depth"
        : wseProviders.has("manual") ? "manual"
        : wseProviders.has("xs-wsel") ? "xs-wsel"
        : wseProviders.has("bfe-line-interp") ? "bfe-line-interp"
        // B807: the derived-1% rung is caller-named (fbcdd-wse100-draft / derived-wse100)
        // — surface whatever tag actually priced it so the DRAFT label is never lost.
        : [...wseProviders][0] || null,
      // 0.2% provider is mixed-aware but its own tier, tracked apart from the 1% chain
      // so a priced 0.2% zone never reads as a 1% "manual". Manual wins the label; else
      // surface whichever derived source priced it (xs-wsel-02 / fbcdd-wse02-draft).
      wse02pct: wse02Providers.has("manual") ? "manual"
        : [...wse02Providers].find((s) => s !== "manual") || null,
      expert: expert ? "avg-fill-depth" : null,
    },
  };
}

/* B833 — price the proposed-surface TRANSITION WEDGES against the same trigger zones
 * and WSE provider chain as computeMitigation. Wedge cells come from the surface
 * engine's grid (cells with wedge:true carry their own proposed/existing elevations,
 * propFt/gFt — no footprint ring or pad needed). Fill wedges only (dzFt > 0): the cut
 * fringe stores nothing to displace. Floodway wedge fill is geometry + the hard flag
 * (prohibited, not priced) — same discipline as footprint fill. Depth per cell =
 * max(0, min(WSE, proposed) − existing); an AO zone prices its published depth riding
 * the cell's own ground, capped by the proposed surface (the B808 close-out rule).
 * Ratio applies at the end. Retained cells match the heat-map fill-depth shape
 * ({ cls, fpId, x, y, wFt, hFt, depthFt|null }) so the exhibit paints the fringe.
 * Pure. */
export function wedgeMitigation({ cells = [], zones = [], rule = null, elev = {} } = {}) {
  const classes = rule ? triggerClasses(rule) : ["1pct"];
  const ratio = rule && isFinite(rule.ratio) ? rule.ratio : 1;
  const env = {
    grade: realElev(elev.existGradeFt),
    wse02: realElev(elev.wse02Ft),
    manualBfe: realElev(elev.bfeFt),
    manualBfeSrc: elev.bfeSrc || null,
    derivedXsWsel: realElev(elev.derivedXsWselFt),
    derivedBfe: realElev(elev.derivedBfeFt),
    derived1pct: realElev(elev.derivedWse1pctFt),
    derived02: realElev(elev.derivedWse02Ft),
    derivedWse1pctSrc: elev.derivedWse1pctSrc || null,
    derivedWse02Src: elev.derivedWse02Src || null,
  };
  let volumeCf = 0, intersectSf = 0, unknownSf = 0, floodwaySf = 0;
  const out = [];
  // NEW-1 (Waller): the wedge screen honors the same floodway prohibition buffer as
  // the footprint screen — wrap floodway zones once, outside the cell loop.
  const bufFt = rule && rule.floodwayBufferFt > 0 ? rule.floodwayBufferFt : 0;
  const zonesEff = bufFt ? zones.map((z) => bufferedFloodway(z, bufFt)) : zones;
  for (const c of cells) {
    if (!c || c.wedge !== true || !(c.dzFt > 0)) continue;
    const pt = { x: c.x, y: c.y };
    const A = (c.wFt || 0) * (c.hFt || 0);
    if (!(A > 0)) continue;
    const fw = zonesEff.find((z) => z.cls === "floodway" && pointInZone(pt, z));
    if (fw) {
      floodwaySf += A;
      out.push({ cls: "floodway", fpId: `${c.elId}:wedge`, x: c.x, y: c.y, wFt: c.wFt, hFt: c.hFt, depthFt: null });
      continue;
    }
    const z = zones.find((zz) => classes.includes(zz.cls) && pointInZone(pt, zz));
    if (!z) continue;
    intersectSf += A;
    const { wse, wseSrc } = zoneWaterSurface(z, env);
    const g = Number.isFinite(c.gFt) ? c.gFt : null;
    const top = Number.isFinite(c.propFt) ? c.propFt : null;
    if (wse == null || g == null || top == null) {
      unknownSf += A;
      out.push({ cls: z.cls, fpId: `${c.elId}:wedge`, x: c.x, y: c.y, wFt: c.wFt, hFt: c.hFt, depthFt: null });
      continue;
    }
    const depth = wseSrc === "ao-depth" && z.aoDepthFt != null
      ? Math.max(0, Math.min(z.aoDepthFt, top - g))
      : Math.max(0, Math.min(wse, top) - g);
    volumeCf += A * depth;
    out.push({ cls: z.cls, fpId: `${c.elId}:wedge`, x: c.x, y: c.y, wFt: c.wFt, hFt: c.hFt, depthFt: depth });
  }
  volumeCf *= ratio;
  return {
    volumeCf,
    volumeAcFt: volumeCf / SQFT_PER_ACRE,
    cutCy: volumeCf / CF_PER_CY,
    intersectSf,
    unknownSf,
    floodwaySf,
    ratio,
    cells: out,
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
  // B808/B809 — retained heat-map cells are big flat arrays: concat them OUTSIDE the
  // JSON deep copy (stringifying tens of thousands of cells per render would jank;
  // the copy only needs the scalars) and reattach at the end.
  const allCells = [];
  let anyCells = false;
  const stripped = list.map((r) => {
    if (r.cells) {
      anyCells = true;
      if (r.cells.length) allCells.push(...r.cells);
      const { cells, ...rest } = r;
      return rest;
    }
    return r;
  });
  const out = JSON.parse(JSON.stringify(stripped[0]));
  for (const r of stripped.slice(1)) {
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
    // B808 — grid rollups across footprints: sum the counters, keep the flat comparison
    // only while EVERY priced footprint carried one, and let "grid" outrank "median" in
    // the basis label (a mixed set means the grid did price somewhere).
    out.voidCells = (out.voidCells || 0) + (r.voidCells || 0);
    out.pricedCells = (out.pricedCells || 0) + (r.pricedCells || 0);
    out.volumeFlatCf = out.volumeFlatCf != null && r.volumeFlatCf != null ? out.volumeFlatCf + r.volumeFlatCf : null;
    if (r.gradeBasis && (!out.gradeBasis || (out.gradeBasis === "median" && r.gradeBasis === "grid"))) out.gradeBasis = r.gradeBasis;
    // B826 — surface outranks flat in the combined label (any surface-priced part means
    // the proposed-surface engine shaped the total).
    if (r.padBasis === "surface") out.padBasis = "surface";
  }
  if (out.unknownReason) out.volumeCf = null;
  out.volumeAcFt = out.volumeCf != null ? out.volumeCf / SQFT_PER_ACRE : null;
  out.cutCy = out.volumeCf != null ? out.volumeCf / CF_PER_CY : null;
  // B808 — re-judge the site-wide honesty flags on the SUMMED counters (a per-footprint
  // 4% void rate can still be a 7% site rate, and vice versa).
  const cellsTotal = (out.voidCells || 0) + (out.pricedCells || 0);
  out.flags = (out.flags || []).filter((f) => f !== "grid-voids" && f !== "grid-median-delta");
  if (out.gradeBasis === "grid" && cellsTotal > 0 && out.voidCells > 0.05 * cellsTotal) out.flags.push("grid-voids");
  // B826 — same suppression as computeMitigation: a surface basis makes the flat-pad
  // comparison an expected difference, not a data warning.
  if (out.padBasis !== "surface" && out.volumeCf != null && out.volumeFlatCf != null && out.volumeFlatCf > 0 && Math.abs(out.volumeCf - out.volumeFlatCf) / out.volumeFlatCf > 0.15) out.flags.push("grid-median-delta");
  if (anyCells) out.cells = allCells;
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
export const DERIVED_WSE02_DRAFT_NOTE =
  "This 0.2% (500-yr) water surface was read from Fort Bend County's Atlas-14 watershed-study rasters — DRAFT study results, a screening value only, never an effective or published elevation. Note the basis: FBCDD's Interim §9 mitigation trigger references the PRE-Atlas-14 0.2% (the effective 2014 FIS profile) — the Atlas-14 value is a labeled stand-in for that basis, not the same number. Confirm before design; type a 0.2% WSE from the effective FIS to override.";
export const EST_BOUNDARY_WSE_NOTE =
  "This 1% water surface is ESTIMATED from ground elevation along the mapped Zone A boundary (FEMA's approximate-Zone-A contour method) — screening only. Waller Art. 5 §C(3) requires an Atlas-14 study for developments >50 lots or >5 ac; the County Engineer administers best-available data (Art. 4 §B(8)). Type a BFE to override.";
export const DERIVED_WSE100_DRAFT_NOTE =
  "This 1% (100-yr) water surface was read from Fort Bend County's Atlas-14 watershed-study rasters — DRAFT study results, a screening value only, never an effective or published elevation. Note the basis: Fort Bend's mitigation and FFE rules reference the EFFECTIVE (pre-Atlas-14) floodplain — the Atlas-14 value is a labeled stand-in for that basis, not the same number. Confirm before design; type a BFE to override.";

/* B824 — presentation labels for the drainage readout (moved here from the deleted
 * FloodMitigationCard so the Yield surface and print path share one source). */
export const WSE_PROVIDER_LABEL = {
  "static-bfe": "published BFE", "ao-depth": "AO depth + grade", "manual": "manual",
  "bfe-line-interp": "derived (BFE lines)", "xs-wsel": "derived (cross-sections)",
  "xs-wsel-02": "derived (cross-sections)", "fbcdd-wse02-draft": "derived (FBCDD study — DRAFT)",
  "fbcdd-wse100-draft": "derived (FBCDD study — DRAFT)", "derived-wse100": "derived (100-yr raster)",
  "est-boundary-grade": "ESTIMATED (grade @ Zone A boundary)",
  "mixed": "mixed",
};
export const wseProvLabel = (p) => WSE_PROVIDER_LABEL[p] || p || "—";
export const FFE_BASIS_LABEL = {
  "wse02pct": "0.2% (500-yr) WSE", "wse1pct": "FEMA BFE", "atlas14_100yr": "Atlas-14 100-yr WSE",
  "pre_atlas14_100yr": "pre-Atlas-14 100-yr WSE", "zone_a_est_bfe": "Zone A estimated BFE",
  "site": "outside-SFHA site basis", "hag": "highest adjacent grade",
};
export const ffeBasisText = (ffe) => {
  const g = ffe.governingBasis;
  if (g) return `${g.label || FFE_BASIS_LABEL[g.basis] || g.basis} + ${g.plusFt}′`;
  return `${FFE_BASIS_LABEL[ffe.basis] || (ffe.basis === "wse02pct" ? "0.2% WSE" : "BFE")} + ${ffe.plusFt}′`;
};
