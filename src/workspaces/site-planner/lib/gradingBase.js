/* Grading layer — the small ALWAYS-LOADED glue (owner-only; see gradingGate.js).
 *
 * SitePlanner builds its proposed surface (`gradeSurface`, the B826 earthwork rows' single source) from
 * `gsInputs`; for an enabled account those inputs gain the grading model, the setback polygon and a ground
 * sampler that does not depend on a drainage check having run. That glue has to be in the planner's own
 * chunk — it runs inside render — so it is kept tiny and pure-ish here. Everything heavier (the sweep client,
 * the solvers, the painters, the panels) lives behind a dynamic import (GradingController / GradingPanels)
 * and is never fetched by an account the gate refuses.
 *
 * Feet everywhere; the planner's frame is x east, y SOUTH about the plan's geographic origin. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadTerrain } from "./terrainLazy.js";
import { sampleAtLatLng } from "./demGrid.js";
import { feetToLatLngPair } from "./mapLock.js";
import { offsetPolygon } from "./parcelOffset.js";
import { hostBuildingIdOf } from "./gradingMembership.js";

export const GRADING_DEFAULTS = Object.freeze({
  pavementSlopePct: 1.5, minPavementSlopePct: 0.5, maxCutFillFt: 12, slopeRatio: 2, lotDropFt: 0.5, shoulderFt: 5,
});
export const SLOPE_RATIOS = Object.freeze([2, 3, 4]);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/* The owner's grading settings, normalised. Stored sparsely on `settings.grading` (additive keys beside the
 * existing B826 ones): pavement slope %, max cut-or-fill under a pad (ft), grading slope ratio (H:V), and
 * whether grading is on for the plan (default OFF) and which of the two map layers are shown (both default OFF). Pavement
 * slope is never below 0.5%. */
export function gradingCfg(g) {
  const src = g || {};
  const p = num(src.pavementSlopePct);
  const d = num(src.maxCutFillFt);
  const r = num(src.slopeRatio);
  return {
    pavementSlopePct: p == null ? GRADING_DEFAULTS.pavementSlopePct : Math.max(GRADING_DEFAULTS.minPavementSlopePct, p),
    maxCutFillFt: d == null || d <= 0 ? GRADING_DEFAULTS.maxCutFillFt : d,
    slopeRatio: SLOPE_RATIOS.includes(r) ? r : GRADING_DEFAULTS.slopeRatio,
    // Per-plan switch (NEW-1, amends B2315856): grading is OFF for a plan until the owner turns it on in the Grading panel.
    enabled: src.enabled === true,
    // Level-pad limit and Cut & Fill (the "Show cut and fill on the map" checkbox, NEW-2): both OFF until asked for.
    layers: { buildable: !!(src.layers && src.layers.buildable), cutfill: !!(src.layers && src.layers.cutfill) },
  };
}

const ringSig = (ring) => {
  let h = 0;
  for (let i = 0; i < ring.length; i++) h += (ring[i].x * 7.13 + ring[i].y * 3.71) * (i + 1);
  return `${ring.length}:${Math.round(h)}`;
};

/* The setback polygon(s) the sweep and the flag measure against: each active parcel's own setback ring from
 * the existing setback feature when it has one (per-edge values, else the plan default), otherwise its
 * property line. `usingPropertyLine` is true when NO active parcel carries a setback, so the panel can say
 * "no setback drawn, using the property line". Holes = save-and-except carve-outs (feet rings). */
export function gradingSetback(parcels, baseSetback = 0) {
  const rings = [], parcelRings = [], holes = [];
  let any = false;
  for (const p of parcels || []) {
    const pts = p && p.points;
    if (!pts || pts.length < 3) continue;
    parcelRings.push(pts);
    const n = pts.length, base = +baseSetback || 0;
    const sb = Array.isArray(p.setbacks) && p.setbacks.length === n ? p.setbacks : Array.from({ length: n }, () => base);
    if (sb.some((v) => v > 0)) {
      let o = null;
      try { o = offsetPolygon(pts, sb); } catch (_) { o = null; }
      if (o && o.length >= 3) { rings.push(o); any = true; } else rings.push(pts);
    } else rings.push(pts);
    for (const h of Array.isArray(p.exceptions) ? p.exceptions : []) {
      const hp = h && Array.isArray(h.pts) ? h.pts : Array.isArray(h) ? h : null;
      if (hp && hp.length >= 3) holes.push(hp);
    }
  }
  return { rings, parcelRings, holes, usingPropertyLine: !any, sig: `${rings.map(ringSig).join(",")}|${holes.map(ringSig).join(",")}|${any ? 1 : 0}` };
}

/* The `grading` argument buildProposedSurface takes. */
export function gradingPack(cfg, setback) {
  return {
    pavementSlopePct: cfg.pavementSlopePct, lotDropFt: GRADING_DEFAULTS.lotDropFt,
    slopeRatio: cfg.slopeRatio, shoulderFt: GRADING_DEFAULTS.shoulderFt, setbackRings: setback.rings,
  };
}

/* id → hosting building id, for the prepared (graded) elements only. */
export function hostIdMap(els) {
  const byId = new Map(els.map((e) => [e.id, e]));
  const out = new Map();
  for (const e of els) { const h = hostBuildingIdOf(e, byId); if (h && h !== e.id) out.set(e.id, h); }
  return out;
}

/* Fetch (or reuse, via fetchSiteGrid's own request-keyed cache) the site DEM for the active parcels —
 * independent of whether a drainage check has run. LOUD: a failure is `status: "failed"` with the message,
 * never a silent flat price. */
export function useGradingDem({ enabled, origin, parcelRings }) {
  const [st, setSt] = useState({ key: "", dem: null, status: "idle", error: null });
  const bb = useMemo(() => {
    if (!enabled || !origin || !parcelRings || !parcelRings.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of parcelRings) for (const p of r) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    if (!isFinite(x0)) return null;
    const M = 260;
    return { x0: x0 - M, y0: y0 - M, x1: x1 + M, y1: y1 + M };
  }, [enabled, origin, parcelRings]);
  // Re-key on a ~100 ft grid so a small boundary nudge does not refetch.
  const key = bb ? [bb.x0, bb.y0, bb.x1, bb.y1].map((v) => Math.round(v / 100)).join(",") + `@${origin.lat.toFixed(5)},${origin.lon.toFixed(5)}` : "";
  const bbRef = useRef(bb); bbRef.current = bb;
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!key || !bbRef.current) { setSt({ key: "", dem: null, status: "idle", error: null }); return undefined; }
    let live = true;
    const b = bbRef.current;
    const nw = feetToLatLngPair({ x: b.x0, y: b.y0 }, origin.lat, origin.lon), se = feetToLatLngPair({ x: b.x1, y: b.y1 }, origin.lat, origin.lon);
    const bounds = { west: Math.min(nw[1], se[1]), east: Math.max(nw[1], se[1]), south: Math.min(nw[0], se[0]), north: Math.max(nw[0], se[0]) };
    setSt((s) => ({ ...s, key, status: "loading", error: null }));
    loadTerrain().then((t) => t.fetchSiteGrid(bounds)).then(
      (dem) => { if (live) setSt({ key, dem, status: "ready", error: null }); },
      (e) => { if (live) setSt({ key, dem: null, status: "failed", error: String((e && e.message) || e) }); },
    );
    return () => { live = false; };
  }, [key, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  const retryFn = useCallback(() => setRetry((n) => n + 1), []);
  return useMemo(() => ({ ...st, retry: retryFn }), [st, retryFn]);
}

/* The ground sampler off that DEM: ft NAVD88 at a feet point, null off-grid / over a void. */
export function demSampler(dem, origin) {
  if (!dem || !dem.grid || !origin) return null;
  return (pt) => {
    const [la, lo] = feetToLatLngPair(pt, origin.lat, origin.lon);
    return sampleAtLatLng(dem.grid, dem.req, la, lo);
  };
}

/* ONE call for SitePlanner: everything the always-loaded side needs. Memoised on its inputs' VALUES. */
/* A cheap VALUE signature of the active parcels' geometry + setbacks. `parcels` is a fresh array every planner
 * render, so the setback polygon is memoised on this string — never on the array — or every render would mint a
 * new setback object and the whole grading model would republish forever. */
export function parcelsSig(parcels, baseSetback) {
  return `${+baseSetback || 0}#` + (parcels || []).map((p) => `${p.id}:${p.points ? ringSig(p.points) : ""}:${Array.isArray(p.setbacks) ? p.setbacks.join(",") : ""}:${(Array.isArray(p.exceptions) ? p.exceptions : []).map((h) => ringSig(h && h.pts ? h.pts : Array.isArray(h) ? h : [])).join("/")}`).join("|");
}

export function useGradingBase({ enabled, origin, parcels, gradingSettings, baseSetback }) {
  const g = gradingSettings || null;
  const cfgKey = JSON.stringify([g && g.enabled, g && g.pavementSlopePct, g && g.maxCutFillFt, g && g.slopeRatio, g && g.layers && g.layers.buildable, g && g.layers && g.layers.cutfill]);
  const cfg = useMemo(() => gradingCfg(g), [cfgKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const psig = enabled ? parcelsSig(parcels, baseSetback) : "";
  const parcelsRef = useRef(parcels); parcelsRef.current = parcels;
  const setback = useMemo(() => (enabled ? gradingSetback(parcelsRef.current, baseSetback) : null), [enabled, psig]); // eslint-disable-line react-hooks/exhaustive-deps
  const dem = useGradingDem({ enabled, origin, parcelRings: setback ? setback.parcelRings : null });
  const oLat = origin ? origin.lat : null, oLon = origin ? origin.lon : null;
  const existAt = useMemo(() => (enabled ? demSampler(dem.dem, { lat: oLat, lon: oLon }) : null), [enabled, dem.dem, oLat, oLon]);
  const pack = useMemo(() => (enabled && setback ? gradingPack(cfg, setback) : null), [enabled, cfg, setback]);
  return useMemo(() => ({
    on: !!enabled, cfg, setback, dem, existAt, pack,
    existKey: dem.dem ? `grid:${dem.dem.req.key}` : "",
    sig: enabled && setback ? [cfg.pavementSlopePct, cfg.slopeRatio, setback.sig, dem.dem ? dem.dem.req.key : ""].join("~") : "",
  }), [enabled, cfg, setback, dem, existAt, pack]);
}
