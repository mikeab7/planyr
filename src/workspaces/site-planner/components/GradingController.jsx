/* GradingController (owner-only; loaded on demand — see lib/gradingGate.js) — the brain of the grading layer.
 *
 * Renders NOTHING. It owns the hooks the grading surfaces share and publishes ONE `model` object up to
 * SitePlanner through `onModel`, which hands it to the Site Analysis panel (Ground row + Grading group), the
 * canvas layers and the Layers rows. Heavy work never happens here on the main thread in one piece: the
 * buildable sweep runs in the terrain worker; the FFE solvers and fix searches are generators driven in
 * 10 ms slices (lib/buildingGrade.js runChunked) and superseded by a token the moment their inputs move.
 *
 * What it computes
 *   • ground    — the Ground row (best single level pad, relief, steepness) from the sweep.
 *   • autoFfe   — for every building without a TYPED finish elevation, the SUGGESTED one (lib/ffeSuggest.js:
 *                 balanced dirt, adjusted for pond spoil, rock and the flood floor), solved the moment the
 *                 building is seen and again when its ground truth moves (geometry, slope, depth, rock, pond).
 *                 SitePlanner merges it into the surface's inputs; it is NEVER written to the plan.
 *   • cards     — one per building: FFE (auto or typed), the basis in plain words, the earthwork line, the
 *                 setback flag; the focused one also carries the fixes and the level-ground alternative.
 *   • labels    — spot elevations / fall arrows on the courts and lots and the four pad-corner pills.
 *   • cutfill   — the Cut & Fill picture: the SLOPES only (never the pad, courts, rows, lots or walks); round 4 adds the
 *                 grading limit's own dashed line and the ONE daylight ring around it.
 *   • limit     — round 4 (B2349120): the graded area's mode, source (auto / edited), acreage, and which elements an
 *                 edited limit grew to include. The surface (SitePlanner's gradeSurface) carries the limit itself.
 *   • contours  — round 4 (B2349122): the proposed contours, traced in the terrain worker off the surface's own lattice.
 *   • buildable — the Level-pad limit: a dashed outline, an inside-edge hatch and one label.
 * The surface itself is NOT built here: it is SitePlanner's `gradeSurface` (the B826 engine with the
 * grading model on), passed in. Cards, picture and earthwork rows therefore cannot disagree. */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildProposedSurfaceSteps, contourLatticeSteps } from "../lib/proposedSurface.js";
import {
  assemblyIds, cardEarthwork, scopeIds, describeFlag, withFfe, shiftAssembly, findFfeFix, findMoveFix, runChunked,
  spotElevationsFor, courtDropReadout, padCornerSpots, padCorners, ringSf,
} from "../lib/buildingGrade.js";
import { loadTerrain } from "../lib/terrainLazy.js";
import { LIMIT_MODE_LABEL, unionRings, bufferRings, bandRegions, pointInRegions } from "../lib/gradingLimit.js";
import { limitSigOf, tracedOnLimit, publishedContours, publishedBand } from "../lib/gradingPicture.js";
import { suggestFfe, padDepths, padSpotWord, fourWay, rockDepthLookup, rockViolationSteps } from "../lib/ffeSuggest.js";
import { feetToLatLngPair } from "../lib/mapLock.js";
import {
  maskOutlinePath, maskHatchPixels, maskVisualCentre, maskTightBox, cellsPixels, cellsOutlinePath, slopeOnly, pixelsToDataUrl, hexToRgb,
  ringsPathD, contourLinesToFeet, ringsToLatticePx, GRADING_PAPER_RGB, GRADING_PAPER_OPACITY, bandField, bandRingsToFeet,
} from "../lib/gradingPaint.js";
import { plainDec1 as f1 } from "../../../shared/units/numberFormat.js";
import {
  gridDepthStats, floorStatsOf, haulTile, cutTile, fillTile, depthFlags, limitFlagSentence, seamFlags, rockFlag, sweepFloorStats, floorRows,
} from "../lib/gradingPanelModel.js";

const EMPTY = [];
// ROUND 7: the contours' own daylight line is usable as the band's outer edge only when it was traced off the SAME surface
const contoursResKeyOf = (bandRes, contoursRes) => (bandRes && contoursRes && !contoursRes.error && contoursRes.key === bandRes.key
  && contoursRes.daylight && Array.isArray(contoursRes.daylight.rings) && contoursRes.daylight.rings.length ? contoursRes.key : "");
export const PAPER_MARGIN_FT = 60;   // ROUND 5 (NEW-6): how far past the daylight line the paper reaches
const fmtE = (v) => f1(v).replace(/\.0$/, "");
const centreOf = (ring) => {
  let x = 0, y = 0;
  for (const p of ring) { x += p.x; y += p.y; }
  return { x: x / ring.length, y: y / ring.length };
};
const sumOut = (surface, ids) => {
  const o = surface && surface.grid && surface.grid.outside;
  if (!o) return 0;
  if (surface.grid.limit) return o.count;   // ROUND 4: the slope belongs to the graded area, not to an element
  let n = 0;
  for (const id of ids) if (o.perEl && o.perEl[id]) n += o.perEl[id].count;
  return n;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Soil-map rock polygons for the parcel's neighbourhood, once per session per box (soil is effectively static).
 * `rockPolys` in the input replaces the network read — the browser harness and tests supply known ground truth. */
const rockCache = new Map();
async function loadRockPolys(parcelRings, origin) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const r of parcelRings) for (const p of r) {
    const [la, lo] = feetToLatLngPair(p, origin.lat, origin.lon);
    if (lo < w) w = lo; if (lo > e) e = lo; if (la < s) s = la; if (la > n) n = la;
  }
  const bb = { s: s - 0.001, w: w - 0.001, n: n + 0.001, e: e + 0.001 };
  const key = [bb.s, bb.w, bb.n, bb.e].map((v) => v.toFixed(3)).join(",");
  if (rockCache.has(key)) return rockCache.get(key);
  const { fetchBedrockView } = await import("../lib/ssurgoBedrock.js");
  const res = await fetchBedrockView(bb);
  rockCache.set(key, res.polys || []);
  return rockCache.get(key);
}

export default function GradingController({ input, onModel }) {
  const inRef = useRef(input); inRef.current = input;
  const { base, origin, gradeSurface, selBuildingId, accent } = input;
  const cfg = base.cfg;
  const setback = base.setback;
  const demReady = base.dem && base.dem.status === "ready" ? base.dem.dem : null;
  const gsInputs = input.gsInputs;

  /* ---------------- Ground row: the sweep, in the worker ---------------- */
  const [ground, setGround] = useState({ status: "idle", summary: null, error: null });
  const gSeq = useRef(0);
  const [gRetry, setGRetry] = useState(0);
  const groundKey = demReady && setback ? `${demReady.req.key}|${setback.sig}|${cfg.slopeRatio}|${cfg.maxCutFillFt}` : "";
  useEffect(() => {
    if (!groundKey) { setGround({ status: base.dem && base.dem.status === "failed" ? "failed" : "idle", summary: null, error: base.dem && base.dem.error }); return undefined; }
    const my = ++gSeq.current;
    setGround((g) => ({ ...g, status: "computing", error: null }));
    const t = setTimeout(() => {
      import("../lib/buildableClient.js").then((c) => c.groundSummaryJob({
        origin, parcelRings: setback.parcelRings, setbackRings: setback.rings, holes: setback.holes,
        s: cfg.slopeRatio, D: cfg.maxCutFillFt, dem: demReady,
      })).then(
        (r) => { if (my === gSeq.current) setGround({ status: "ready", summary: r.summary, error: null }); },
        (e) => { if (my === gSeq.current) setGround({ status: "failed", summary: null, error: String((e && e.message) || e) }); },
      );
    }, 120);   // a typed depth/ratio settles before the worker is asked
    return () => clearTimeout(t);
  }, [groundKey, gRetry]); // eslint-disable-line react-hooks/exhaustive-deps
  const best = ground.summary && ground.summary.best ? ground.summary.best : null;
  const bestRef = useRef(best); bestRef.current = best;

  /* ---------------- the buildings ---------------- */
  // `gsInputs` is rebuilt every planner render; `input.gsSig` is its VALUE signature, so everything derived from
  // the prepared elements is memoised on that (a fresh Set per render would republish the model forever).
  const gsSig = input.gsSig;
  const els = gsInputs && gsInputs.els ? gsInputs.els : EMPTY;
  // `buildingOrder` / `buildingNames` arrive as fresh containers every planner render, so everything below keys on
  // their VALUES (a container in a dep list would republish the model forever).
  const orderKey = (input.buildingOrder || EMPTY).join("|");
  const namesKey = input.buildingNames ? [...input.buildingNames].map(([k, v]) => `${k}=${v}`).join("|") : "";
  const buildings = useMemo(() => {
    const order = inRef.current.buildingOrder || EMPTY;
    const byId = new Map(els.filter((e) => e.type === "building" && !e.hostId).map((e) => [e.id, e]));
    const ids = order.filter((id) => byId.has(id));
    for (const id of byId.keys()) if (!ids.includes(id)) ids.push(id);
    return ids.map((id) => byId.get(id));
  }, [gsSig, orderKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const assemblies = useMemo(() => new Map(buildings.map((b) => [b.id, assemblyIds(els, b.id)])), [buildings, gsSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusId = selBuildingId && assemblies.has(selBuildingId) ? selBuildingId : (buildings[0] ? buildings[0].id : null);
  const labelIds = selBuildingId && assemblies.has(selBuildingId) ? [selBuildingId] : buildings.map((b) => b.id);
  const grid = gradeSurface && gradeSurface.grid ? gradeSurface.grid : null;
  const typedOf = (id) => { const b = inRef.current.rawBuildings && inRef.current.rawBuildings.get(id); return b && Number.isFinite(b.padElevFt) ? b.padElevFt : null; };

  /* ---------------- rock (SSURGO depth to bedrock) ---------------- */
  const [rock, setRock] = useState({ status: "idle", polys: null, error: null });
  const [rockRetry, setRockRetry] = useState(0);
  const rockKeyIn = setback ? `${setback.sig}@${origin ? origin.lat.toFixed(4) : ""}` : "";
  useEffect(() => {
    if (!rockKeyIn || !origin || !setback) { setRock({ status: "idle", polys: null, error: null }); return undefined; }
    if (inRef.current.rockPolys) { setRock({ status: "ready", polys: inRef.current.rockPolys, error: null }); return undefined; }
    let live = true;
    setRock((r) => ({ ...r, status: "loading", error: null }));
    loadRockPolys(setback.parcelRings, origin).then(
      (polys) => { if (live) setRock({ status: "ready", polys, error: null }); },
      (e) => { if (live) setRock({ status: "failed", polys: null, error: String((e && e.message) || e) }); },
    );
    return () => { live = false; };
  }, [rockKeyIn, rockRetry]); // eslint-disable-line react-hooks/exhaustive-deps
  const rockAt = useMemo(() => (rock.status === "ready" ? rockDepthLookup(rock.polys, origin, feetToLatLngPair) : null), [rock]); // eslint-disable-line react-hooks/exhaustive-deps
  const rockRef = useRef(rockAt); rockRef.current = rockAt;
  const rockKey = rock.status === "ready" ? `r${rock.polys.length}` : rock.status;

  /* ---------------- the auto FFE: solved per building, never written to the plan ---------------- */
  const geoSig = useMemo(() => {
    const m = new Map();
    for (const b of buildings) {
      const aIds = assemblies.get(b.id);
      m.set(b.id, els.filter((x) => aIds.has(x.id)).map((x) => `${x.id}:${x.ring.map((p) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`).join(";")}`).join("|"));
    }
    return m;
  }, [buildings, assemblies, gsSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const padArea = useMemo(() => new Map(buildings.map((b) => [b.id, ringSf(b.ring) + els.reduce((s, x) => s + (x.type === "building" && x.hostId === b.id ? ringSf(x.ring) : 0), 0)])), [buildings, gsSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const pondTotal = Math.max(0, Math.round((input.pondCutCy || 0) / 100) * 100);
  const totalPad = [...padArea.values()].reduce((a, v) => a + v, 0) || 1;
  const pondShareOf = (id) => Math.round((pondTotal * (padArea.get(id) || 0) / totalPad) / 100) * 100;
  const floorFt = Number.isFinite(input.siteFloorFt) ? input.siteFloorFt : null;
  const cfgSig = `${cfg.pavementSlopePct}|${cfg.slopeRatio}|${cfg.maxCutFillFt}|${input.dockDropFt}|${base.existKey}|${setback ? setback.sig : ""}|${floorFt ?? ""}|${pondTotal}|${rockKey}`;

  const autoRef = useRef(new Map());           // id → { sig, ffe, info } | { sig, failed }
  // NEW-1: the balanced ("no haul") floor of the FOCUSED building while its floor is TYPED — the panel's floors table needs it, and
  // autoRef deliberately holds only buildings that take the suggestion. Never written to the plan, never merged into the surface.
  const balRef = useRef(new Map());
  const [autoVer, setAutoVer] = useState(0);
  const [solvingId, setSolvingId] = useState(null);
  const autoSeq = useRef(0);

  const groundRange = (aIds) => {
    const ex = inRef.current.gsInputs.existAt;
    if (typeof ex !== "function") return null;
    let lo = Infinity, hi = -Infinity;
    for (const id of aIds) {
      const el = inRef.current.gsInputs.els.find((e) => e.id === id);
      if (!el) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of el.ring) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
      for (let a = 0; a <= 6; a++) for (let b = 0; b <= 6; b++) {
        const g = ex({ x: x0 + ((x1 - x0) * a) / 6, y: y0 + ((y1 - y0) * b) / 6 });
        if (g != null && isFinite(g)) { if (g < lo) lo = g; if (g > hi) hi = g; }
      }
    }
    if (!isFinite(lo)) return null;
    return { lo: Math.floor(lo - 12), hi: Math.ceil(hi + 12) };
  };
  const solveAuto = async (id, my) => {
    const gi = inRef.current.gsInputs;
    const aIds = assemblyIds(gi.els, id);
    const stale = () => my !== autoSeq.current;
    const range = groundRange(aIds);
    if (!range) return null;
    // Generator evaluators: every surface build of the search yields per lattice column (problem report 6cea9895).
    const surf = (f) => buildProposedSurfaceSteps({ ...gi, els: withFfe(gi.els, id, f) });
    function* evalNet(f) { const s = yield* surf(f); const t = s && cardEarthwork(s.grid, aIds); return t ? t.netCy : null; }
    function* evalGrid(f) { const s = yield* surf(f); return s ? s.grid : null; }
    return runChunked(suggestFfe({ evalNet, evalGrid, range, ids: aIds, pondCy: pondShareOf(id), floorFt, rockAt: rockRef.current }), { isStale: stale });
  };
  const bump = () => setAutoVer((n) => n + 1);
  const ready = !!(demReady && gsInputs && typeof gsInputs.existAt === "function");
  const typedKey = buildings.map((b) => typedOf(b.id) ?? "").join(",");
  const geoKey = buildings.map((b) => `${b.id}=${geoSig.get(b.id)}`).join("¦");
  useEffect(() => {
    const my = ++autoSeq.current;
    const store = autoRef.current;
    // typing a floor hands the building's suggestion to balRef (the floors table keeps its no-haul row without a re-solve); resetting
    // to auto hands it back — neither re-runs the solver, because nothing the suggestion depends on moved
    for (const id of [...store.keys()]) if (!buildings.some((b) => b.id === id) || typedOf(id) != null) { const e0 = store.get(id); if (e0 && !e0.failed && id === focusId && typedOf(id) != null) balRef.current.set(id, e0); store.delete(id); bump(); }
    for (const id of [...balRef.current.keys()]) {
      if (!buildings.some((b) => b.id === id)) { balRef.current.delete(id); bump(); continue; }
      if (typedOf(id) == null) { const e1 = balRef.current.get(id); if (e1 && !store.has(id)) store.set(id, e1); balRef.current.delete(id); bump(); }
      else if (id !== focusId) { balRef.current.delete(id); bump(); }
    }
    if (!ready) { setSolvingId(null); return undefined; }
    const sigOf = (id) => `${geoSig.get(id)}#${cfgSig}#${pondShareOf(id)}`;
    const stale = () => my !== autoSeq.current;
    const run = async () => {
      for (const b of buildings) {
        if (stale()) return;
        const typedNow = typedOf(b.id) != null;
        if (typedNow && b.id !== focusId) continue;            // a typed floor needs no suggestion — except the focused one's (the floors table)
        const into = typedNow ? balRef.current : store;
        const sig = sigOf(b.id);
        const cur = into.get(b.id);
        if (cur && cur.sig === sig) continue;
        // a drag is in flight: the ground under the building is still moving — wait for the release
        for (let k = 0; k < 60 && inRef.current.isDragging && inRef.current.isDragging(); k++) { await sleep(150); if (stale()) return; }
        setSolvingId(b.id);
        let r = null, err = null;
        try { r = await solveAuto(b.id, my); } catch (e) { err = String((e && e.message) || e); }
        if (stale() || (r && r.stale)) return;
        into.set(b.id, r && Number.isFinite(r.ffe) ? { sig, ffe: r.ffe, info: r } : { sig, failed: true, error: err });
        bump();
      }
      if (!stale()) setSolvingId(null);
    };
    const t = setTimeout(run, 120);
    return () => clearTimeout(t);
  }, [ready, geoKey, cfgSig, typedKey, focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const autoFfe = useMemo(() => {
    const m = new Map();
    for (const [id, v] of autoRef.current) if (v.ffe != null) m.set(id, v.ffe);
    return m;
  }, [autoVer]); // eslint-disable-line react-hooks/exhaustive-deps
  const ffeOf = (id) => { const t = typedOf(id); if (t != null) return t; const a = autoRef.current.get(id); return a && a.ffe != null ? a.ffe : null; };
  // the balanced floor whether or not the owner typed one (NEW-1)
  const balancedOf = (id) => { const a = typedOf(id) != null ? balRef.current.get(id) : autoRef.current.get(id); return a && a.ffe != null ? a.ffe : null; };

  /* ---------------- per-building facts read off the live surface ---------------- */
  const facts = useMemo(() => {
    const out = new Map();
    for (const b of buildings) {
      const aIds = assemblies.get(b.id);
      const earthwork = grid ? cardEarthwork(grid, aIds) : null;   // ROUND 4: the whole graded area under a limit
      const centre = centreOf(b.ring);
      const flag = gradeSurface && earthwork ? describeFlag(gradeSurface, aIds, { buildingCentre: centre, elements: els, slopeRatio: cfg.slopeRatio }) : null;
      out.set(b.id, { aIds, earthwork, centre, flag });
    }
    return out;
  }, [buildings, assemblies, gradeSurface, grid, cfg.slopeRatio]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- the level-ground alternative, for the focused building ---------------- */
  const [alt, setAlt] = useState(null);
  const altSeq = useRef(0);
  const altE = best ? best.E : null;
  useEffect(() => {
    if (!ready || !focusId || altE == null || !best) { setAlt(null); return undefined; }
    const my = ++altSeq.current;
    const t = setTimeout(async () => {
      const gi = inRef.current.gsInputs;
      const aIds = assemblyIds(gi.els, focusId);
      const r = await runChunked((function* () { yield; const s = yield* buildProposedSurfaceSteps({ ...gi, els: withFfe(gi.els, focusId, altE) }); return s ? { ew: cardEarthwork(s.grid, aIds), depth: gridDepthStats(s.grid) } : null; })(), { isStale: () => my !== altSeq.current });
      if (my !== altSeq.current || !r || r.stale || !r.ew) return;
      setAlt({ id: focusId, E: altE, areaAc: best.areaAc, cutCy: r.ew.cutCy, fillCy: r.ew.fillCy, netCy: r.ew.netCy, depth: r.depth });
    }, 300);
    return () => clearTimeout(t);
  }, [ready, focusId, altE, geoSig.get(focusId), cfgSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const altForFocus = alt && alt.id === focusId ? alt : null;

  /* ---------------- NEW-1: the floors table + the haul-by-floor curve, for the focused building ---------------- */
  // Seven surface builds across ±6 ft of the balanced floor (every 2 ft; the curve is interpolated to every half foot), two more
  // around the smallest slope footprint, all in the chunked scheduler, superseded by a token and started only after the inputs settle and the picture is up —
  // never on the input path. "Least digging" is the level-ground alternative (`alt`), whose stats the alt effect already built.
  const [floorsRes, setFloorsRes] = useState(null);
  const fSeq = useRef(0);
  const balE = focusId ? balancedOf(focusId) : null;
  const floorsKey = ready && focusId && balE != null ? `${focusId}|${balE}|${geoSig.get(focusId)}|${cfgSig}|${pondShareOf(focusId)}` : "";
  useEffect(() => {
    if (!floorsKey) { fSeq.current++; setFloorsRes(null); return undefined; }
    const my = ++fSeq.current;
    const id = focusId, E0 = balE, pond = pondShareOf(focusId);
    const t = setTimeout(async () => {
      const gi = inRef.current.gsInputs;
      const aIds = assemblyIds(gi.els, id);
      function* statsAt(f) {
        const s = yield* buildProposedSurfaceSteps({ ...gi, els: withFfe(gi.els, id, f) });
        return s && s.grid ? floorStatsOf(cardEarthwork(s.grid, aIds), gridDepthStats(s.grid), pond) : null;
      }
      try {
        const r = await runChunked(sweepFloorStats(statsAt, E0), { isStale: () => my !== fSeq.current });
        if (my !== fSeq.current || !r || r.stale) return;
        setFloorsRes({ id, key: floorsKey, E0, samples: r.samples, nohaul: r.nohaul, slopes: r.slopes, curve: r.curve });
      } catch (e) {
        if (my === fSeq.current) setFloorsRes({ id, key: floorsKey, E0, samples: [], nohaul: null, slopes: null, curve: [], error: String((e && e.message) || e) });
      }
    }, 1500);   // after the picture's own work (band + contour traces start within ~100 ms of a surface landing) — the table is secondary to the picture
    return () => clearTimeout(t);
  }, [floorsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // the depth flags of the focused building (past the pad max / past the terrace depth anywhere) — needed by the move search below
  const anyDepth = useMemo(() => gridDepthStats(grid), [grid]);
  const focusDepth = useMemo(() => {
    const F = focusId ? facts.get(focusId) : null, b = focusId ? buildings.find((x) => x.id === focusId) : null;
    if (!F || !b || !grid || !F.earthwork) return { pad: null, flags: [] };
    const pad = padDepths(grid, focusId);
    const cs = padCorners(b.ring);
    const half = cs ? { x: Math.hypot(cs[1].x - cs[0].x, cs[1].y - cs[0].y) / 2, y: Math.hypot(cs[2].x - cs[1].x, cs[2].y - cs[1].y) / 2 } : { x: 100, y: 100 };
    const whereOf = (d, scope) => (scope === "pad" ? padSpotWord(d, F.centre, half) : fourWay(d.x - F.centre.x, d.y - F.centre.y, 30));
    return { pad, flags: depthFlags({ pad, anywhere: anyDepth, maxCutFillFt: cfg.maxCutFillFt, terraceDepthFt: cfg.terraceDepthFt, whereOf }) };
  }, [focusId, facts, grid, anyDepth, cfg.maxCutFillFt, cfg.terraceDepthFt, buildings]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- the flag's two fixes (background search, superseded by token) ---------------- */
  const [fixes, setFixes] = useState({ id: null, status: "idle", ffe: null, move: null });
  const fixSeq = useRef(0);
  const focusFacts = focusId ? facts.get(focusId) : null;
  const flagKey = focusFacts && focusFacts.flag && gradeSurface ? `${gradeSurface.surfaceKey}#${focusId}` : "";
  useEffect(() => {
    if (!flagKey) { setFixes({ id: null, status: "idle", ffe: null, move: null }); return undefined; }
    const my = ++fixSeq.current;
    setFixes({ id: focusId, status: "computing", ffe: null, move: null });
    const I = inRef.current;
    const gi = I.gsInputs;
    const aIds = assemblyIds(gi.els, focusId);
    const bPrepared = gi.els.find((e) => e.id === focusId);
    function* outAt(e2) { const s = yield* buildProposedSurfaceSteps({ ...gi, els: e2 }); return s ? sumOut(s, aIds) : null; }
    const cur = Number.isFinite(bPrepared.padElevFt) ? bPrepared.padElevFt : gi.ffeFt;
    const stale = () => my !== fixSeq.current;
    const flag = focusFacts.flag;
    const start = setTimeout(async () => {
      try {
        // the limit flag's fix: the nearest floor at which the slopes daylight inside the limit. (The old "Move building" search is
        // gone from here: the depth flags' "Second pad" runs its own move search ON CLICK — `findSecondPad` below — so a plan whose
        // ground is steep never pays for up to 48 surface builds just by being open.)
        const ffeFix = flag && Number.isFinite(cur)
          ? await runChunked(findFfeFix(function* (f) { const n = yield* outAt(withFfe(gi.els, focusId, f)); return n == null ? null : n === 0; }, cur), { isStale: stale })
          : null;
        if (stale() || (ffeFix && ffeFix.stale)) return;
        setFixes({ id: focusId, status: "done", ffe: ffeFix || null, move: null, limit: flag && flag.limit && flag.span ? { span: flag.span } : null });
      } catch (e) {
        if (!stale()) setFixes({ id: focusId, status: "failed", ffe: null, move: null, error: String((e && e.message) || e) });
      }
    }, 60);
    return () => clearTimeout(start);
  }, [flagKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- the live rock check, off the render path ---------------- */
  // rockViolation asks the soil polygons once per cut cell (tens of ms on the owner's cross-dock), so it never runs in a
  // render: a chunked scan per building, superseded by token, keyed on the surface it read.
  const [rockLive, setRockLive] = useState({ key: "", byId: new Map() });
  const rockLiveSeq = useRef(0);
  const rockLiveKey = rockAt && gradeSurface ? `${gradeSurface.surfaceKey}#${rockKey}` : "";
  useEffect(() => {
    if (!rockLiveKey) return undefined;
    const my = ++rockLiveSeq.current;
    const g = grid, at = rockAt, list = buildings.map((b) => [b.id, assemblies.get(b.id)]);
    runChunked((function* () {
      const byId = new Map();
      for (const [id, aIds] of list) { yield; byId.set(id, yield* rockViolationSteps(g, aIds, at)); }
      return byId;
    })(), { isStale: () => my !== rockLiveSeq.current }).then((byId) => {
      if (my === rockLiveSeq.current && byId && !byId.stale) setRockLive({ key: rockLiveKey, byId });
    });
    return () => { rockLiveSeq.current++; };
  }, [rockLiveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- the cards ---------------- */
  const cards = useMemo(() => buildings.map((b) => {
    const F = facts.get(b.id);
    const typed = typedOf(b.id);
    const ffe = ffeOf(b.id);
    const a = autoRef.current.get(b.id);
    const isAuto = typed == null;
    const focus = b.id === focusId;
    const card = {
      id: b.id, name: (input.buildingNames && input.buildingNames.get(b.id)) || "Building", sf: Math.round(padArea.get(b.id) || 0),
      ffe, isAuto, solving: isAuto && ffe == null && !(a && a.failed), failed: !!(isAuto && a && a.failed), focus,
      earthwork: F ? F.earthwork : null, flag: F ? F.flag : null,
    };
    // the selector's "!" (only drawn with several buildings): the focused one reuses focusDepth's numbers, the others scan the lattice ONCE
    card.flagged = buildings.length < 2 ? false : !!(F && F.flag) || (grid ? (() => { const pd = focus && focusDepth.pad ? focusDepth.pad : padDepths(grid, b.id); return (pd.cut && pd.cut.ft > cfg.maxCutFillFt) || (pd.fill && pd.fill.ft > cfg.maxCutFillFt); })() : false);
    if (focus && ffe != null) {
      card.fixes = fixes.id === b.id ? fixes : { id: b.id, status: "idle", ffe: null, move: null };
      // NEW-1 — the approved layout's numbers: HAUL first, then cut and fill with their deepest / tallest; threshold-only flags
      // (one sentence each, no ground descriptions); the three suggested floors and the haul-by-floor curve
      const e = F && F.earthwork;
      const pond = pondShareOf(b.id);
      card.haulCy = e ? e.netCy - pond : null;
      card.tiles = e ? { haul: haulTile(card.haulCy), cut: cutTile(e.cutCy, anyDepth.cut ? anyDepth.cut.ft : 0), fill: fillTile(e.fillCy, anyDepth.fill ? anyDepth.fill.ft : 0) } : null;
      const flags = [];
      if (F && F.flag) flags.push({ id: "limit", kind: "limit", text: limitFlagSentence(F.flag), span: F.flag.span, actions: ["ffe", "limit"] });
      flags.push(...focusDepth.flags);
      if (grid) flags.push(...seamFlags(grid.seams, gradeSurface && gradeSurface.planes, cfg.maxPavementSlopePct));
      const rv = rockLive.key === rockLiveKey ? rockLive.byId.get(b.id) : null;
      const rf = rockFlag(rv, rv && rv.at && F ? (() => { const sd = fourWay(rv.at.x - F.centre.x, rv.at.y - F.centre.y, 30); return sd ? `${sd} end` : null; })() : null);
      if (rf) flags.push(rf);
      card.flags = flags;
      const fr = floorsRes && floorsRes.id === b.id ? floorsRes : null;
      const al = altForFocus && altForFocus.id === b.id ? altForFocus : null;
      card.floors = {
        rows: floorRows({
          nohaul: balE != null ? { E: balE, stats: fr && fr.nohaul ? fr.nohaul : null } : null,
          digging: al ? { E: al.E, areaAc: al.areaAc, stats: floorStatsOf({ cutCy: al.cutCy, fillCy: al.fillCy, netCy: al.netCy }, al.depth, pond) } : null,
          slopes: fr && fr.slopes ? { E: fr.slopes.E, stats: fr.slopes } : null,
        }, ffe),
        curve: fr ? fr.curve : [], pending: !fr || fr.key !== floorsKey, balancedE: balE,
      };
      card.court = gradeSurface && F ? (() => {
        const aIds = F.aIds;
        for (const id of aIds) {
          const plane = gradeSurface.planes.get(id);
          if (!plane || plane.classId !== "dockApron" || !plane.wall) continue;
          const owner = grid.owners.find((o) => o.el.id === id), el = els.find((e) => e.id === id);
          if (!owner || !el) continue;
          const sp = spotElevationsFor(plane, el.ring, (pt) => grid.zOf(owner, pt));
          if (sp) return courtDropReadout(sp);
        }
        return null;
      })() : null;
    }
    return card;
  }), [buildings, facts, focusId, autoVer, fixes, altForFocus, gradeSurface, grid, solvingId, namesKey, typedKey_(input), rockLive, floorsRes, focusDepth, anyDepth, cfg.maxCutFillFt, cfg.maxPavementSlopePct]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- canvas labels: the court / lot spots and the four pad-corner pills ---------------- */
  const labels = useMemo(() => {
    if (!gradeSurface || !grid) return [];
    const out = [];
    for (const id of labelIds) {
      const b = buildings.find((x) => x.id === id);
      const F = facts.get(id);
      const ffe = ffeOf(id);
      if (!b || !F || ffe == null) continue;
      const spots = [];
      for (const eid of F.aIds) {
        const plane = gradeSurface.planes.get(eid);
        if (!plane || plane.classId === "buildingPad" || !plane.wall) continue;
        const owner = grid.owners.find((o) => o.el.id === eid);
        const el = els.find((e) => e.id === eid);
        if (!owner || !el) continue;
        const sp = spotElevationsFor(plane, el.ring, (pt) => grid.zOf(owner, pt));
        if (sp) spots.push(sp);
      }
      const cs = padCorners(b.ring);
      const minSideFt = cs ? Math.min(Math.hypot(cs[1].x - cs[0].x, cs[1].y - cs[0].y), Math.hypot(cs[2].x - cs[1].x, cs[2].y - cs[1].y)) : 0;
      out.push({
        id, centre: F.centre, minSideFt, spots,
        corners: padCornerSpots(b.ring, ffe, gsInputs.existAt),
        // NEW-2 (2026-10-30): the pad's four corners + whether this building is the SELECTED one (its edit buttons are on screen), so the
        // canvas can slide a corner tag clear of them (lib/padCornerTag.js)
        quad: cs, selected: selBuildingId === id,
        flagDot: F.flag ? { pt: F.flag.centroid, text: `${F.flag.over} ft past the setback` } : null,
      });
    }
    return out;
  // selBuildingId is a dep on purpose: the corner tags' `selected` flag — a one-building plan keeps the same labelIds across select / deselect
  }, [gradeSurface, grid, buildings, facts, labelIds.join(","), selBuildingId, autoVer, typedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Level-pad limit: the pad mask at the building's FFE (else the best finish) ---------------- */
  const [maskRes, setMaskRes] = useState(null);
  const mSeq = useRef(0);
  const focusFfe = selBuildingId ? ffeOf(selBuildingId) : null;
  const maskE = focusFfe != null ? focusFfe : best ? best.E : null;
  const maskSource = focusFfe != null ? "building" : "best";
  const wantMask = cfg.layers.buildable && !!demReady && maskE != null;
  useEffect(() => {
    if (!wantMask) { setMaskRes(null); return undefined; }
    const my = ++mSeq.current;     // supersession token: a superseded compute never paints
    import("../lib/buildableClient.js").then((c) => c.buildableMaskJob({
      origin, parcelRings: setback.parcelRings, setbackRings: setback.rings, holes: setback.holes,
      s: cfg.slopeRatio, D: cfg.maxCutFillFt, E: maskE, dem: demReady,
    })).then(
      (r) => { if (my === mSeq.current) setMaskRes({ E: maskE, source: maskSource, ...r }); },
      () => { if (my === mSeq.current) setMaskRes(null); },
    );
    const tok = mSeq;
    return () => { tok.current++; };
  }, [wantMask, maskE, groundKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const buildable = useMemo(() => {
    if (!maskRes || !cfg.layers.buildable) return null;
    const info = { mask: maskRes.mask, nx: maskRes.nx, ny: maskRes.ny, x0: maskRes.x0, y0: maskRes.y0, cell: maskRes.cell };
    const hatch = maskHatchPixels(info, hexToRgb(accent));
    const centre = maskVisualCentre(info);
    return {
      dataUrl: pixelsToDataUrl(hatch.pixels, hatch.w, hatch.h),
      bboxFt: { x: info.x0, y: info.y0, w: info.nx * info.cell, h: info.ny * info.cell },
      outlineD: maskOutlineD(info), E: maskRes.E, source: maskRes.source, areaAc: maskRes.areaAc,
      label: centre ? { pt: centre, text: `Level pad possible inside · ${Math.round(maskRes.areaAc)} AC at ${fmtE(maskRes.E)} ft` } : null,
      fitBoxFt: maskTightBox(info),
    };
  }, [maskRes, cfg.layers.buildable, accent]);

  /* ---------------- ROUND 4 (B2349122) / ROUND 5 — proposed contours, traced in the terrain worker ---------------- */
  // Never in a render: an effect SAMPLES the contour lattice off the finished surface (proposedSurface.contourLatticeSteps —
  // chunked, the pad exactly at the FFE, existing ground past the daylight line), ships it to the worker with the daylight
  // line and the pad rings in lattice px (clip / cut there, one clipper on both sides), superseded by a token; the previous
  // contours stay published while a trace is in flight (the surface build itself already keeps its previous picture).
  const [contoursRes, setContoursRes] = useState(null);
  const cSeq = useRef(0);
  const wantContours = cfg.layers.contours && !!grid && grid.cells.length > 0;
  const contourKey = wantContours && gradeSurface ? gradeSurface.surfaceKey : "";
  useEffect(() => {
    if (!contourKey) { if (!wantContours) setContoursRes(null); return undefined; }
    const my = ++cSeq.current;
    const g = grid;
    const existAt = inRef.current.gsInputs.existAt;
    const t = setTimeout(async () => {
      try {
        const L = await runChunked(contourLatticeSteps(g, { existAt }), { isStale: () => my !== cSeq.current });
        if (my !== cSeq.current) return;
        if (!L || L.stale) { if (!L) setContoursRes(null); return; }
        const terrain = await loadTerrain();
        // the existing Contour-lines rule: 1 ft, coarsening only when the range would drown the picture
        const r = await terrain.runProposedContoursJob({
          values: L.values, inside: L.inside, nx: L.nx, ny: L.ny, interval: L.interval,
          clipRings: L.clipRings ? ringsToLatticePx(L.clipRings, L) : null, clipHoles: L.clipHoles ? ringsToLatticePx(L.clipHoles, L) : null, cutRings: ringsToLatticePx(L.pads, L),
          labelMinCells: Math.max(8, Math.ceil(40 / L.cellFt)),
        });
        if (my !== cSeq.current) return;
        // the traced lines + the traced daylight line (feet). ROUND 9: tagged with the limit they were traced against — the
        // existing-contour cut and what the canvas may paint are decided by gradingPicture.publishedContours off the CURRENT limit
        const feet = contourLinesToFeet(r, L);
        // ROUND 9 (NEW-2): the slope band is an exact plane at the ratio, so its contours run every interval × ratio — the draw
        // plan thins the band with ONE multiple from this spacing (gradingPaint.planContourDraw), never piece by piece
        const bandSpacingFt = r.interval * ((g.grading && g.grading.slopeRatio) || 2);
        setContoursRes({ key: contourKey, limitSig: limitSigOf(g), interval: r.interval, bandSpacingFt, cellFt: L.cellFt, lattice: { x0: L.x0, y0: L.y0, dx: L.dx, dy: L.dy, nx: L.nx, ny: L.ny }, ...feet });
      } catch (e) {
        if (my === cSeq.current) setContoursRes({ key: contourKey, limitSig: limitSigOf(g), error: String((e && e.message) || e), levels: [], labels: [] });
      }
    }, 80);
    return () => { clearTimeout(t); };
  }, [contourKey, wantContours]); // eslint-disable-line react-hooks/exhaustive-deps
  // ROUND 9 (B2500224 ×2): ONE limit — the contours (and the existing-contour cut) are only ever those of the limit the surface
  // carries now; across a mode switch / an edited outline the old limit's lines are never painted under the new one's name
  const contours = useMemo(() => {
    if (!cfg.layers.contours || (!contoursRes && !(grid && grid.limit))) return null;
    const toLL = origin ? (ring) => ring.map((p) => feetToLatLngPair(p, origin.lat, origin.lon)) : null;
    return publishedContours(contoursRes, grid, toLL);
  }, [cfg.layers.contours, contoursRes, grid, origin && origin.lat, origin && origin.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- ROUND 7 (NEW-1) — the slope band's OUTLINE, traced like a contour ---------------- */
  // The band's edges (the daylight line where |cut/fill| → 0, and in boundary mode the toe / top of slope inside the limit)
  // used to be the cell lattice's own edges — a staircase. Now an effect builds the band field off the finished surface
  // (gradingPaint.bandField: + inside the band, − past the daylight line, linear in the depth so its zero IS where the slope
  // meets the ground), the terrain worker traces its zero with the contours' interpolated marching squares + Chaikin
  // (contourTrace.traceBandOutline), and gradingLimit.bandRegions composes the closed band polygon with the limit. In layout
  // mode, while the proposed contours are traced, their own daylight line (the finer lattice the contours are clipped to) is
  // the band's outer edge, so the hatch and the contours end on ONE line. Never in a render; superseded by a token; the
  // previous outline stays published while a trace is in flight.
  const [bandRes, setBandRes] = useState(null);
  const [bandShapes, setBandShapes] = useState(null);
  const bSeq = useRef(0);
  const bandKey = cfg.layers.cutfill && grid && grid.limit && grid.cells.length > 0 && gradeSurface ? gradeSurface.surfaceKey : "";
  useEffect(() => {
    if (!bandKey) { if (!cfg.layers.cutfill) { setBandRes(null); setBandShapes(null); } return undefined; }
    const my = ++bSeq.current;
    const g = grid;
    const t = setTimeout(async () => {
      try {
        const F = bandField(g, { pointInRegions });
        if (!F) { if (my === bSeq.current) setBandRes(null); return; }
        const terrain = await loadTerrain();
        if (my !== bSeq.current) return;
        const r = await terrain.runBandOutlineJob({ values: F.values, nx: F.nx, ny: F.ny });
        if (my !== bSeq.current) return;
        setBandRes({ key: bandKey, limitSig: limitSigOf(g), mode: F.mode, traced: bandRingsToFeet(r, F) });
      } catch (e) {
        if (my === bSeq.current) setBandRes({ key: bandKey, error: String((e && e.message) || e) });
      }
    }, 60);
    return () => { clearTimeout(t); };
  }, [bandKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const contourDaylightKey = contoursResKeyOf(bandRes, contoursRes);
  const curLimitSig = limitSigOf(grid);
  useEffect(() => {
    if (!bandRes || !bandRes.traced) { if (!bandRes) setBandShapes(null); return; }
    // ROUND 9: composed only against the limit the surface carries NOW (the one the panel names), never one captured earlier
    if (!tracedOnLimit(bandRes, grid)) return;
    const gl0 = grid.limit, mode = gl0.mode === "boundary" ? "boundary" : "layout";
    const fromContours = mode === "layout" && !!contourDaylightKey;
    const traced = fromContours ? contoursRes.daylight : bandRes.traced;
    try {
      const sh = bandRegions({ traced, limitRegions: mode === "boundary" ? gl0.limitRegions || gl0.regions : gl0.regions, mode });
      setBandShapes({ key: bandRes.key, limitSig: bandRes.limitSig, mode, source: fromContours ? "contours" : "band", ...sh });
    } catch (e) {
      setBandShapes({ key: bandRes.key, limitSig: bandRes.limitSig, mode, error: String((e && e.message) || e), band: [], daylight: [], inner: [] });
    }
  }, [bandRes, contourDaylightKey, curLimitSig]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Cut & Fill picture: the SLOPES of the focused assembly (all buildings when none selected) ---------------- */
  const cutfill = useMemo(() => {
    if (!cfg.layers.cutfill || !grid || !grid.cells.length) return null;
    const set = new Set();
    for (const id of labelIds) { const F = facts.get(id); if (F) for (const x of F.aIds) set.add(x); }
    // ROUND 4: under a grading limit the slopes belong to the graded area as a whole — always the whole picture
    const cells = grid.limit ? grid.cells : selBuildingId ? grid.cells.filter((c) => set.has(c.elId)) : grid.cells;
    if (!cells.length) return null;
    // ROUND 7: the tint reaches past the last painted cell (two rings of dilation) and is CLIPPED to the traced band polygon,
    // so its edge is the smooth outline, never the lattice; without a limit (legacy) the old per-cell picture stands
    const cp = cellsPixels(cells, slopeOnly, grid.limit ? { dilate: 2 } : undefined);
    if (!cp) return null;
    const limitD = grid.limit ? ringsPathD(grid.limit.regions.flatMap((r) => [r.outer, ...r.holes])) : null;
    const base = { dataUrl: pixelsToDataUrl(cp.pixels, cp.nx, cp.ny), bboxFt: { x: cp.x0, y: cp.y0, w: cp.nx * cp.dx, h: cp.ny * cp.dy }, limitD };
    if (!grid.limit) return { ...base, outlineD: cellsOutlinePath(cp), clipD: null, daylightD: null, innerD: null, bandReady: true };
    const sh = publishedBand(bandShapes, grid);   // ROUND 9: only a band composed against THIS limit
    return {
      ...base,
      outlineD: null,
      // the band polygon (evenodd: outers and holes) — the tint paints only inside it; nothing until the first trace lands
      clipD: sh ? ringsPathD(sh.band.flatMap((r) => [r.outer, ...r.holes])) : null,
      daylightD: sh && sh.daylight.length ? ringsPathD(sh.daylight) : null,      // one thin solid contour-brown line on top
      innerD: sh && sh.inner.length ? ringsPathD(sh.inner) : null,               // boundary mode: the toe / top of slope
      daylightRings: sh ? sh.daylight : [], innerRings: sh ? sh.inner : [], bandMode: sh ? sh.mode : null, bandSource: sh ? sh.source : null, bandStale: !!(sh && gradeSurface && sh.key !== gradeSurface.surfaceKey),
      bandReady: !!sh, bandLimitSig: sh ? sh.limitSig : "",
    };
  }, [cfg.layers.cutfill, grid, gradeSurface, selBuildingId, facts, labelIds.join(","), bandShapes]); // eslint-disable-line react-hooks/exhaustive-deps


  /* ---------------- ROUND 5 (NEW-6) — the paper background: the parcel, out to the daylight line plus a margin ---------------- */
  // One feet-space path (the active parcel rings ∪ the daylight rings pushed out by the margin) the planner paints at the very
  // bottom of the drawing in the sheet's white, so the aerial drops out under the grading picture. Only while a map layer is on.
  const paperWanted = cfg.layers.paper && (cfg.layers.cutfill || cfg.layers.contours);
  const paperDaylight = grid ? grid.daylight : null;
  const paper = useMemo(() => {
    if (!paperWanted || !setback) return null;
    const rings = [...(setback.parcelRings || [])];
    const dl = (paperDaylight || []).filter((d) => d && !d.hole && Array.isArray(d.ring) && d.ring.length >= 3).map((d) => d.ring);
    let regions = [];
    try { regions = unionRings([...rings, ...bufferRings(dl, PAPER_MARGIN_FT).map((r) => r.outer)]); } catch (_) { regions = unionRings(rings); }
    if (!regions.length) return null;
    return { d: ringsPathD(regions.flatMap((r) => [r.outer, ...r.holes])), fill: GRADING_PAPER_RGB, opacity: GRADING_PAPER_OPACITY, marginFt: PAPER_MARGIN_FT };
  }, [paperWanted, setback, paperDaylight]);

  /* ---------------- actions ---------------- */
  const typeFfe = (id, v) => {
    if (!Number.isFinite(v)) inRef.current.actions.patchBuilding(id, { padElevFt: null, ffeBasis: null }, { history: true });
    else inRef.current.actions.patchBuilding(id, { padElevFt: v, ffeBasis: "typed" }, { history: true });
  };
  const resetFfe = (id) => inRef.current.actions.patchBuilding(id, { padElevFt: null, ffeBasis: null }, { history: true });
  // "Move building n ft <direction>" was proven at THIS finish elevation. A live suggestion would re-solve for the new
  // spot and could walk the slope back across the line, so applying the move freezes the suggestion to a typed number.
  const applyMoveFix = (id, mv) => inRef.current.actions.moveAssembly(id, mv.dx, mv.dy, typedOf(id) == null ? ffeOf(id) : null);
  // NEW-1 — "Second pad" (a depth flag's link): move the assembly away from the deepest spot, in 5-ft steps up to 240 ft, until that
  // depth is back under the flag's threshold. Searched ON CLICK in the chunked scheduler — never on open (up to 48 surface builds, each
  // re-resolving the limit). Resolves { dx, dy, distFt, direction } or null.
  const secondPadSeq = useRef(0);
  const findSecondPad = async (id, flag) => {
    const I = inRef.current, gi = I.gsInputs;
    const aIds = assemblyIds(gi.els, id), b = gi.els.find((e) => e.id === id);
    if (!b || !flag) return null;
    const my = ++secondPadSeq.current;
    const depthOk = (g2) => {
      if (!g2) return false;
      if (flag.scope === "pad") { const pd = padDepths(g2, id)[flag.depthKind]; return !pd || pd.ft <= flag.thresholdFt; }
      const st = gridDepthStats(g2)[flag.depthKind]; return !st || st.ft <= flag.thresholdFt;
    };
    const r = await runChunked(findMoveFix(
      function* (dx, dy) { const s2 = yield* buildProposedSurfaceSteps({ ...gi, els: shiftAssembly(gi.els, aIds, dx, dy) }); return depthOk(s2 && s2.grid); },
      { buildingCentre: centreOf(b.ring), offendCentroid: flag.at },
    ), { isStale: () => my !== secondPadSeq.current });
    return r && !r.stale ? r : null;
  };

  /* ---------------- publish ---------------- */
  const buildingName = (id) => (input.buildingNames && input.buildingNames.get(id)) || "the building";
  // ROUND 4 — the graded area line: the limit's mode, source, acreage and the elements an edited limit grew to include
  const gl = grid && grid.limit ? grid.limit : null;
  const limitInfo = useMemo(() => (gl ? {
    sig: gl.sig || "", mode: gl.mode, modeLabel: LIMIT_MODE_LABEL[gl.mode] || gl.mode, source: gl.source, areaAc: gl.areaAc, areaSf: gl.areaSf,
    grew: (gl.grewIds || []).map((id) => (input.buildingNames && input.buildingNames.get(id)) || null).filter(Boolean),
    grewIds: gl.grewIds || [], regions: gl.regions.length, plateaus: gl.plateaus || [], reachFt: gl.reachFt, basis: gl.basis || null,
    editing: !!input.limitEditing, highlight: input.limitHighlight || null, ring: gl.limitRegions && gl.limitRegions[0] ? gl.limitRegions[0].outer : null,
  } : { mode: cfg.limitMode, modeLabel: LIMIT_MODE_LABEL[cfg.limitMode] || cfg.limitMode, source: cfg.limitRing ? "edited" : "auto", areaAc: null, grew: [], grewIds: [], regions: 0, plateaus: [], editing: !!input.limitEditing, highlight: input.limitHighlight || null, ring: null, basis: { kind: "property", marginFt: cfg.gradingMarginFt, bufferFt: cfg.undisturbedBufferFt } }), [gl, cfg.limitMode, cfg.limitRing, cfg.gradingMarginFt, cfg.undisturbedBufferFt, input.limitEditing, input.limitHighlight, namesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const model = useMemo(() => ({
    on: true, cfg, setback, groundBasis: input.groundBasis, demStatus: base.dem.status, demError: base.dem.error, retryDem: base.dem.retry,
    ground: { ...ground, retry: () => setGRetry((n) => n + 1) },
    bestFinish: best ? best.E : null,
    autoFfe, buildable, cutfill, labels, cards, focusId, limit: limitInfo, contours, paper, seams: gradeSurface && gradeSurface.grid ? gradeSurface.grid.seams || [] : [],
    rock: { status: rock.status, error: rock.error, retry: () => setRockRetry((n) => n + 1), count: rock.polys ? rock.polys.length : 0 },
    solving: solvingId,
    layerRows: [
      { id: "buildable", label: `Level-Pad Limit at ${cfg.slopeRatio}:1`, on: cfg.layers.buildable,
        sub: cfg.layers.buildable && maskE != null
          ? `where a single level pad can sit without walls · ${maskSource === "building" ? `at ${buildingName(selBuildingId)}'s finish, ${fmtE(maskE)} ft` : `at the best finish, ${fmtE(maskE)} ft`}`
          : "where a single level pad can sit without walls",
        info: `The line around the part of the parcel that can be ONE level pad with no retaining walls: inside the setback, no more than ${cfg.maxCutFillFt} ft of cut or fill, and the ${cfg.slopeRatio}:1 slope off the pad daylights before the setback line. Follows the selected building's finish elevation; with none selected, the best finish.` },
      { id: "cutfill", label: "Cut & Fill", on: cfg.layers.cutfill,
        sub: gl ? `the slopes outside the grading limit (${limitInfo.modeLabel.toLowerCase()})` : selBuildingId ? `${buildingName(selBuildingId)}'s slopes` : "all buildings' slopes",
        info: "The slopes outside the grading limit: the grading run from the limit to existing ground, around the whole graded area as one ring. Rust is cut, blue is fill, stronger colour is deeper. The thin dashed line is the limit the slope is thrown from; the dotted line is where the slopes meet existing ground; red is slope outside the setback. Nothing inside the limit is tinted." },
      // ROUND 4 (B2349122) — the proposed contours, off the stitched surface
      { id: "contours", label: "Proposed Contours", on: cfg.layers.contours,
        sub: contours && !contours.pending ? (contours.error ? "couldn't trace the surface" : `${contours.interval} ft, index every ${contours.interval * 5} ft`) : "traced off the proposed surface",
        info: "Contours of the PROPOSED surface — the pad, the pavement, the open ground inside the limit and the slopes to daylight — at the existing Contour-lines interval, bold in the contour brown with index lines labelled along the line, clipped to the daylight line. The existing Contour-lines layer is drawn outside that line automatically, dashed, and meets the proposed lines on it." },
      // ROUND 5 (NEW-6) — the paper background under the grading picture
      { id: "paper", label: "Paper Background", on: cfg.layers.paper,
        sub: cfg.layers.cutfill || cfg.layers.contours ? "the parcel, out past the slopes" : "shows while cut and fill or contours are on",
        info: "Fills the parcel — out to the daylight line plus a margin — with the sheet's flat white while cut and fill or the proposed contours are on, so the aerial drops out under the grading picture. Everything drawn (existing and proposed contours, the bands, the limit, the daylight line, the setback, the elements) paints on top of it; the aerial stays outside it. Turn it off to see the imagery again." },
    ],
    actions: { typeFfe, resetFfe, applyMoveFix, findSecondPad,
      setLimitMode: (m) => inRef.current.actions.setLimitMode && inRef.current.actions.setLimitMode(m),
      editLimit: (span) => inRef.current.actions.editLimit && inRef.current.actions.editLimit(span || null),
      doneEditLimit: () => inRef.current.actions.doneEditLimit && inRef.current.actions.doneEditLimit(),
      resetLimit: () => inRef.current.actions.resetLimit && inRef.current.actions.resetLimit() },
  }), [cfg, setback, input.groundBasis, base.dem, ground, best, autoFfe, buildable, cutfill, labels, cards, focusId, rock, solvingId, maskE, maskSource, selBuildingId, namesKey, limitInfo, contours, paper, gl, gradeSurface]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onModel(model); }, [model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onModel(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/* The mask outline path (kept at module scope so the memo above reads one name). */
function maskOutlineD(info) { return maskOutlinePath(info); }

/* A value signature of every building's typed finish, so the cards memo moves when a number is typed. */
function typedKey_(input) {
  const m = input.rawBuildings;
  if (!m) return "";
  let s = "";
  for (const [id, b] of m) s += `${id}:${Number.isFinite(b.padElevFt) ? b.padElevFt : ""},`;
  return s;
}
