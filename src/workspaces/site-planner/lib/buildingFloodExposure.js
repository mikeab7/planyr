/* NEW-3 — "Is my building in the floodplain?" answered as a NUMBER, not a picture.
 *
 * The owner's real question when he stacks a flood layer over his plan is a computation. The
 * app already does the geometry — the B707/B712 floodplain-mitigation engine intersects each
 * fill footprint with each mapped NFHL zone — so this reads that SAME geometry and reports it
 * per building instead of only as a site-wide storage volume. Nothing here re-derives an
 * intersection: `gridIntersect` and the zone classification come from floodplainMitigation.js.
 *
 * HONEST-UNKNOWN, the house discipline: a failed flood query and an unstudied site are NOT
 * zero. Each non-answer is its own named state carrying its own sentence, and only a query
 * that actually came back with zones may report "clear".
 *
 * Areas are SCREENING figures: gridIntersect samples the overlap on a cell lattice rather than
 * clipping polygons, so a percentage is good to about a percent, not to a survey. Said once,
 * by the caller, where the numbers are shown.
 *
 * Pure — no DOM, no network. */
import { gridIntersect, zoneWaterSurface, BFE_SENTINEL_MIN } from "./floodplainMitigation.js";

/* The same sentinel-aware elevation clean the engine applies (NFHL publishes -9999 for
 * "no published value", which must never be read as an elevation). */
const realElev = (v) => { const n = Number(v); return Number.isFinite(n) && n > BFE_SENTINEL_MIN ? n : null; };

/* The water-surface ENV, built from the planner's fmElev record exactly as computeMitigation
 * builds it — so the BFE this panel reports and the BFE the mitigation ledger prices against
 * are the same number from the same provider chain, never two derivations that can disagree. */
export function wseEnvFromElev(elev) {
  if (!elev) return {};
  return {
    grade: realElev(elev.existGradeFt),
    wse02: realElev(elev.wse02Ft),
    manualBfe: realElev(elev.bfeFt),
    manualBfeSrc: elev.bfeSrc || null,
    derivedBfe: realElev(elev.derivedBfeFt),
    derivedXsWsel: realElev(elev.derivedXsWselFt),
    derived02: realElev(elev.derivedWse02Ft),
    derived1pct: realElev(elev.derivedWse1pctFt),
    derivedWse1pctSrc: elev.derivedWse1pctSrc || null,
    derivedWse02Src: elev.derivedWse02Src || null,
  };
}

/* Worst-first. A floodway is inside the 1% but is a different KIND of answer — fill there is
 * prohibited, not priced — so it outranks. */
export const FLOOD_CLASS_ORDER = ["floodway", "1pct", "02pct"];

export const FLOOD_CLASS_LABEL = {
  floodway: "Regulatory floodway",
  "1pct": "1% chance (SFHA)",
  "02pct": "0.2% chance (shaded X)",
};

/* SFHA = the 1% floodplain, floodway included. Zone X (0.2%) is NOT an SFHA — it carries no
 * federal insurance mandate — so it is reported separately and never folded in. */
export const isSfhaClass = (cls) => cls === "floodway" || cls === "1pct";

const worseOf = (a, b) => (FLOOD_CLASS_ORDER.indexOf(a) <= FLOOD_CLASS_ORDER.indexOf(b) ? a : b);

// Shoelace area (absolute, ft²) of a ring of {x,y} in planner feet.
export function footprintArea(ring) {
  if (!ring || ring.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    a += ring[i].x * ring[j].y - ring[j].x * ring[i].y;
  }
  return Math.abs(a) / 2;
}

/* The states this can be in, and the ONE sentence each is allowed. `clear` is the only one
 * that may read as good news, and it is reachable only from a query that answered. */
export const EXPOSURE_NOTE = {
  "not-checked": "Flood zones not pulled yet for this site — run the drainage check to screen the buildings.",
  unavailable: "The FEMA flood-zone service didn't answer, so this is UNKNOWN — not clear.",
  "none-mapped": "FEMA maps no flood hazard zone reaching this site (screening only — an unmapped area is not a studied one).",
  "no-buildings": "No buildings placed yet.",
};

/**
 * @param {object}   o
 * @param {Array}    o.buildings  [{ id, label, ring }] — rings in planner feet
 * @param {Array}    o.zones      zonesFromFeatureCollection() output (planner feet)
 * @param {string}   o.floodState "loaded" | "failed" | "empty" | null/undefined (never run)
 * @param {object}   o.elev       the fmElev record — passed straight to zoneWaterSurface, so
 *                                the BFE reported here is the SAME one the mitigation ledger
 *                                prices against (never a second, disagreeing derivation)
 * @param {number}   o.maxCells   sampling density for the intersect (screening)
 */
export function buildingFloodExposure({ buildings = [], zones = [], floodState = null, elev = null, maxCells = 1500 } = {}) {
  const rows = (buildings || []).filter((b) => b && b.ring && b.ring.length >= 3);
  if (!rows.length) return { state: "no-buildings", note: EXPOSURE_NOTE["no-buildings"], buildings: [], total: null };
  if (floodState === "failed") return { state: "unavailable", note: EXPOSURE_NOTE.unavailable, buildings: [], total: null };
  if (!floodState || floodState === "empty") {
    // "empty" here means the pull was never made for this site (no bbox), not that FEMA
    // answered with nothing — that case arrives as "loaded" with zero zones.
    return { state: "not-checked", note: EXPOSURE_NOTE["not-checked"], buildings: [], total: null };
  }
  if (!zones.length) return { state: "none-mapped", note: EXPOSURE_NOTE["none-mapped"], buildings: [], total: null };

  const env = wseEnvFromElev(elev);
  // Deliberately NOT gated on `elev`: a zone's PUBLISHED static BFE is the zone's own data and
  // must be reported whether or not the planner has resolved any site elevations yet.
  const wseOf = (z) => {
    try {
      const r = zoneWaterSurface(z, env) || {};
      return { wseFt: Number.isFinite(r.wse) ? r.wse : null, wseSrc: r.wseSrc || null };
    } catch (_) { return { wseFt: null, wseSrc: null }; }
  };

  const out = [];
  let totalFootprintSf = 0, totalInSf = 0, touched = 0, worstCls = null, anyUnstudied = false;
  for (const b of rows) {
    const footprintSf = footprintArea(b.ring);
    totalFootprintSf += footprintSf;
    const hits = [];
    for (const z of zones) {
      const { areaSf } = gridIntersect(b.ring, z, null, { maxCells });
      if (!(areaSf > 0)) continue;
      const { wseFt, wseSrc } = wseOf(z);
      hits.push({
        cls: z.cls,
        zone: z.zone || null,
        subtype: z.subtype || null,
        areaSf,
        pct: footprintSf > 0 ? (areaSf / footprintSf) * 100 : 0,
        bfeFt: wseFt,
        bfeSrc: wseSrc,
        // Bare Zone A: inside the SFHA, but the map publishes no water surface for it.
        unstudied: !!z.unstudiedA,
      });
    }
    hits.sort((p, q) => FLOOD_CLASS_ORDER.indexOf(p.cls) - FLOOD_CLASS_ORDER.indexOf(q.cls) || q.areaSf - p.areaSf);
    const governing = hits[0] || null;
    // A footprint can straddle several zones of DIFFERENT classes (never two of the same —
    // NFHL S_Fld_Haz_Ar is a planar partition), so the exposed area is the sum of the hits.
    const areaSf = hits.reduce((n, h) => n + h.areaSf, 0);
    const sfhaSf = hits.filter((h) => isSfhaClass(h.cls)).reduce((n, h) => n + h.areaSf, 0);
    if (governing) {
      touched++;
      worstCls = worstCls ? worseOf(worstCls, governing.cls) : governing.cls;
      if (hits.some((h) => h.unstudied)) anyUnstudied = true;
    }
    totalInSf += areaSf;
    out.push({
      id: b.id,
      label: b.label || null,
      footprintSf,
      hits,
      governing,
      areaSf,
      sfhaSf,
      pct: footprintSf > 0 ? (areaSf / footprintSf) * 100 : 0,
      sfhaPct: footprintSf > 0 ? (sfhaSf / footprintSf) * 100 : 0,
      inSfha: sfhaSf > 0,
      inFloodway: hits.some((h) => h.cls === "floodway"),
    });
  }
  return {
    state: "ok",
    note: null,
    buildings: out,
    total: {
      count: out.length,
      touched,
      clear: out.length - touched,
      footprintSf: totalFootprintSf,
      areaSf: totalInSf,
      pct: totalFootprintSf > 0 ? (totalInSf / totalFootprintSf) * 100 : 0,
      worstCls,
      anyUnstudied,
    },
  };
}

/* PANEL-BREVITY — a NAMED STATE, not a sentence explaining the state. `text` is the short
 * chip that goes in the value slot; `detail` is the subordinate line beside it. Never a bare
 * percentage: "0%" and "we couldn't ask" must not read the same, which is why every
 * non-answer keeps a name of its own. */
export const EXPOSURE_STATE_LABEL = {
  "not-checked": "not checked",
  unavailable: "UNKNOWN",
  "none-mapped": "none mapped",
};

export function exposureHeadline(res) {
  if (!res) return null;
  if (res.state !== "ok") {
    return {
      tone: res.state === "none-mapped" ? "ok" : "unknown",
      text: EXPOSURE_STATE_LABEL[res.state] || res.state,
      detail: res.note,
    };
  }
  const t = res.total;
  if (!t.touched) return { tone: "ok", text: `all ${t.count} clear`, detail: null };
  const where = FLOOD_CLASS_LABEL[t.worstCls] || "mapped flood zone";
  const which = t.touched === t.count ? `all ${t.count}` : `${t.touched} of ${t.count}`;
  return {
    tone: t.worstCls === "floodway" ? "alert" : "warn",
    text: `${which} · ${t.pct.toFixed(t.pct < 10 ? 1 : 0)}%`,
    detail: where,
  };
}
