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
 *   • cutfill   — the Cut & Fill picture: the SLOPES only (never the pad, courts, rows, lots or walks).
 *   • buildable — the Level-pad limit: a dashed outline, an inside-edge hatch and one label.
 * The surface itself is NOT built here: it is SitePlanner's `gradeSurface` (the B826 engine with the
 * grading model on), passed in. Cards, picture and earthwork rows therefore cannot disagree. */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildProposedSurfaceSteps } from "../lib/proposedSurface.js";
import {
  assemblyIds, assemblyEarthwork, describeFlag, withFfe, shiftAssembly, findFfeFix, findMoveFix, runChunked,
  spotElevationsFor, courtDropReadout, padCornerSpots, padCorners, ringSf,
} from "../lib/buildingGrade.js";
import {
  suggestFfe, courtReport, cutFillCentroids, padDepths, padSpotWord, fourWay, rockDepthLookup, rockViolationSteps,
  balanceClause, dockClause, rockClause, depthClause, floorClause, composeBasis,
} from "../lib/ffeSuggest.js";
import { feetToLatLngPair } from "../lib/mapLock.js";
import {
  maskOutlinePath, maskHatchPixels, maskVisualCentre, maskTightBox, cellsPixels, cellsOutlinePath, slopeOnly, pixelsToDataUrl, hexToRgb,
} from "../lib/gradingPaint.js";

const EMPTY = [];
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const fmtE = (v) => f1(v).replace(/\.0$/, "");
const centreOf = (ring) => {
  let x = 0, y = 0;
  for (const p of ring) { x += p.x; y += p.y; }
  return { x: x / ring.length, y: y / ring.length };
};
const sumOut = (surface, ids) => {
  const o = surface && surface.grid && surface.grid.outside;
  if (!o) return 0;
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
    const byId = new Map(els.filter((e) => e.type === "building").map((e) => [e.id, e]));
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
  const padArea = useMemo(() => new Map(buildings.map((b) => [b.id, ringSf(b.ring)])), [buildings]);
  const pondTotal = Math.max(0, Math.round((input.pondCutCy || 0) / 100) * 100);
  const totalPad = [...padArea.values()].reduce((a, v) => a + v, 0) || 1;
  const pondShareOf = (id) => Math.round((pondTotal * (padArea.get(id) || 0) / totalPad) / 100) * 100;
  const floorFt = Number.isFinite(input.siteFloorFt) ? input.siteFloorFt : null;
  const cfgSig = `${cfg.pavementSlopePct}|${cfg.slopeRatio}|${cfg.maxCutFillFt}|${input.dockDropFt}|${base.existKey}|${setback ? setback.sig : ""}|${floorFt ?? ""}|${pondTotal}|${rockKey}`;

  const autoRef = useRef(new Map());           // id → { sig, ffe, info } | { sig, failed }
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
    function* evalNet(f) { const s = yield* surf(f); const t = s && assemblyEarthwork(s.grid, aIds); return t ? t.netCy : null; }
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
    for (const id of [...store.keys()]) if (!buildings.some((b) => b.id === id) || typedOf(id) != null) { store.delete(id); bump(); }
    if (!ready) { setSolvingId(null); return undefined; }
    const sigOf = (id) => `${geoSig.get(id)}#${cfgSig}#${pondShareOf(id)}`;
    const stale = () => my !== autoSeq.current;
    const run = async () => {
      for (const b of buildings) {
        if (stale()) return;
        if (typedOf(b.id) != null) continue;
        const sig = sigOf(b.id);
        const cur = store.get(b.id);
        if (cur && cur.sig === sig) continue;
        // a drag is in flight: the ground under the building is still moving — wait for the release
        for (let k = 0; k < 60 && inRef.current.isDragging && inRef.current.isDragging(); k++) { await sleep(150); if (stale()) return; }
        setSolvingId(b.id);
        let r = null, err = null;
        try { r = await solveAuto(b.id, my); } catch (e) { err = String((e && e.message) || e); }
        if (stale() || (r && r.stale)) return;
        store.set(b.id, r && Number.isFinite(r.ffe) ? { sig, ffe: r.ffe, info: r } : { sig, failed: true, error: err });
        bump();
      }
      if (!stale()) setSolvingId(null);
    };
    const t = setTimeout(run, 120);
    return () => clearTimeout(t);
  }, [ready, geoKey, cfgSig, typedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const autoFfe = useMemo(() => {
    const m = new Map();
    for (const [id, v] of autoRef.current) if (v.ffe != null) m.set(id, v.ffe);
    return m;
  }, [autoVer]); // eslint-disable-line react-hooks/exhaustive-deps
  const ffeOf = (id) => { const t = typedOf(id); if (t != null) return t; const a = autoRef.current.get(id); return a && a.ffe != null ? a.ffe : null; };

  /* ---------------- per-building facts read off the live surface ---------------- */
  const facts = useMemo(() => {
    const out = new Map();
    for (const b of buildings) {
      const aIds = assemblies.get(b.id);
      const earthwork = grid ? assemblyEarthwork(grid, aIds) : null;
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
      const r = await runChunked((function* () { yield; const s = yield* buildProposedSurfaceSteps({ ...gi, els: withFfe(gi.els, focusId, altE) }); return s ? assemblyEarthwork(s.grid, aIds) : null; })(), { isStale: () => my !== altSeq.current });
      if (my !== altSeq.current || !r || r.stale) return;
      setAlt({ id: focusId, E: altE, areaAc: best.areaAc, cutCy: r.cutCy, fillCy: r.fillCy, netCy: r.netCy });
    }, 300);
    return () => clearTimeout(t);
  }, [ready, focusId, altE, geoSig.get(focusId), cfgSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const altForFocus = alt && alt.id === focusId ? alt : null;

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
        const ffeFix = Number.isFinite(cur)
          ? await runChunked(findFfeFix(function* (f) { const n = yield* outAt(withFfe(gi.els, focusId, f)); return n == null ? null : n === 0; }, cur), { isStale: stale })
          : null;
        if (stale() || (ffeFix && ffeFix.stale)) return;
        const moveFix = await runChunked(findMoveFix(
          function* (dx, dy) { const n = yield* outAt(shiftAssembly(gi.els, aIds, dx, dy)); return n === 0; },
          { buildingCentre: centreOf(bPrepared.ring), offendCentroid: flag.centroid },
        ), { isStale: stale });
        if (stale() || (moveFix && moveFix.stale)) return;
        setFixes({ id: focusId, status: "done", ffe: ffeFix || null, move: moveFix || null });
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

  /* ---------------- the basis, in plain words ---------------- */
  const basisFor = (b, ffe, isAuto) => {
    const F = facts.get(b.id);
    if (!F || !F.earthwork || ffe == null) return { text: "", clauses: [] };
    const clauses = [];
    const e = F.earthwork;
    const info = isAuto ? (autoRef.current.get(b.id) || {}).info : null;
    const cents = cutFillCentroids(grid, F.aIds);
    const sideOf = (c) => (c ? fourWay(c.x - F.centre.x, c.y - F.centre.y, 30) : null);
    const aliveInfo = info && Math.abs(info.ffe - ffe) < 0.05 ? info : null;
    if (isAuto && aliveInfo) {
      clauses.push({ id: "balance", text: balanceClause({ e, cutSide: sideOf(cents.cut), fillSide: sideOf(cents.fill), pondCy: pondShareOf(b.id), pondWhole: pondTotal > 0 && buildings.length > 1 ? pondTotal : null, achieved: aliveInfo.achieved }) });
      if (aliveInfo.floored) clauses.push({ id: "floor", text: floorClause(floorFt) });
      if (aliveInfo.rock) {
        const sd = aliveInfo.rock.at ? fourWay(aliveInfo.rock.at.x - F.centre.x, aliveInfo.rock.at.y - F.centre.y, 30) : null;
        clauses.push({ id: "rock", text: rockClause({ raisedFt: aliveInfo.rock.raisedFt, sideWord: sd, depthFt: aliveInfo.rock.depthFt }) });
      }
    } else if (!isAuto) {
      const a = altForFocus && b.id === focusId ? altForFocus : null;
      if (a && Math.abs(a.E - ffe) < 0.05) clauses.push({ id: "balance", text: `Sitting it on the most level ground: ${Math.round(a.areaAc)} AC stays level at this finish.` });
      else clauses.push({ id: "balance", text: "Your number. Reset to auto for the balanced finish." });
    }
    // live checks on the surface the cards and the map both show
    // The live rock scan runs off the render path (rockLive, below); a scan for an older surface is ignored.
    const v = rockLive.key === rockLiveKey ? rockLive.byId.get(b.id) : null;
    if (v && !(isAuto && aliveInfo && aliveInfo.rock)) {
      if (v.raiseFt > 0.04 && v.at) {
        const sd = fourWay(v.at.x - F.centre.x, v.at.y - F.centre.y, 30);
        clauses.push({ id: "rock", text: `Cut runs into rock${sd ? ` on the ${sd} end` : ""} (bedrock about ${Math.max(1, Math.round(v.depthFt))} ft down there); ${f1(Math.ceil(v.raiseFt * 10) / 10).replace(/\.0$/, "")} ft more FFE would clear it.` });
      }
    }
    const courts = gradeSurface ? courtReport({ grid, planes: gradeSurface.planes, els, buildingId: b.id, ids: F.aIds, existAt: gsInputs.existAt, centre: F.centre }) : [];
    const dk = dockClause(courts);
    if (dk) clauses.push({ id: "docks", text: dk });
    const pd = padDepths(grid, b.id);
    const limit = cfg.maxCutFillFt;
    const worst = [pd.cut && { ...pd.cut, kind: "cut" }, pd.fill && { ...pd.fill, kind: "fill" }].filter(Boolean).filter((d) => d.ft > limit).sort((a, c) => c.ft - a.ft)[0];
    if (worst) {
      const cs = padCorners(b.ring);
      const half = cs ? { x: Math.hypot(cs[1].x - cs[0].x, cs[1].y - cs[0].y) / 2, y: Math.hypot(cs[2].x - cs[1].x, cs[2].y - cs[1].y) / 2 } : { x: 100, y: 100 };
      clauses.push({ id: "depth", text: depthClause({ ft: worst.ft, word: padSpotWord(worst, F.centre, half), kind: worst.kind, limitFt: limit }) });
    }
    return { text: composeBasis(clauses), clauses, courts };
  };

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
    if (focus && ffe != null) {
      const bs = basisFor(b, ffe, isAuto);
      card.basis = bs.text;
      card.fixes = fixes.id === b.id ? fixes : { id: b.id, status: "idle", ffe: null, move: null };
      card.alt = altForFocus && Math.abs(altForFocus.E - ffe) >= 0.25 ? altForFocus : null;
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
  }), [buildings, facts, focusId, autoVer, fixes, altForFocus, gradeSurface, grid, solvingId, namesKey, typedKey_(input), rockLive]); // eslint-disable-line react-hooks/exhaustive-deps

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
        flagDot: F.flag ? { pt: F.flag.centroid, text: `${F.flag.over} ft past the setback` } : null,
      });
    }
    return out;
  }, [gradeSurface, grid, buildings, facts, labelIds.join(","), autoVer, typedKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /* ---------------- Cut & Fill picture: the SLOPES of the focused assembly (all buildings when none selected) ---------------- */
  const cutfill = useMemo(() => {
    if (!cfg.layers.cutfill || !grid || !grid.cells.length) return null;
    const set = new Set();
    for (const id of labelIds) { const F = facts.get(id); if (F) for (const x of F.aIds) set.add(x); }
    const cells = selBuildingId ? grid.cells.filter((c) => set.has(c.elId)) : grid.cells;
    if (!cells.length) return null;
    const cp = cellsPixels(cells, slopeOnly);
    if (!cp) return null;
    return {
      dataUrl: pixelsToDataUrl(cp.pixels, cp.nx, cp.ny),
      bboxFt: { x: cp.x0, y: cp.y0, w: cp.nx * cp.dx, h: cp.ny * cp.dy },
      outlineD: cellsOutlinePath(cp),
    };
  }, [cfg.layers.cutfill, grid, selBuildingId, facts, labelIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- actions ---------------- */
  const typeFfe = (id, v) => {
    if (!Number.isFinite(v)) inRef.current.actions.patchBuilding(id, { padElevFt: null, ffeBasis: null }, { history: true });
    else inRef.current.actions.patchBuilding(id, { padElevFt: v, ffeBasis: "typed" }, { history: true });
  };
  const resetFfe = (id) => inRef.current.actions.patchBuilding(id, { padElevFt: null, ffeBasis: null }, { history: true });
  // "Move building n ft <direction>" was proven at THIS finish elevation. A live suggestion would re-solve for the new
  // spot and could walk the slope back across the line, so applying the move freezes the suggestion to a typed number.
  const applyMoveFix = (id, mv) => inRef.current.actions.moveAssembly(id, mv.dx, mv.dy, typedOf(id) == null ? ffeOf(id) : null);

  /* ---------------- publish ---------------- */
  const buildingName = (id) => (input.buildingNames && input.buildingNames.get(id)) || "the building";
  const model = useMemo(() => ({
    on: true, cfg, setback, groundBasis: input.groundBasis, demStatus: base.dem.status, demError: base.dem.error, retryDem: base.dem.retry,
    ground: { ...ground, retry: () => setGRetry((n) => n + 1) },
    bestFinish: best ? best.E : null,
    autoFfe, buildable, cutfill, labels, cards, focusId,
    rock: { status: rock.status, error: rock.error, retry: () => setRockRetry((n) => n + 1), count: rock.polys ? rock.polys.length : 0 },
    solving: solvingId,
    layerRows: [
      { id: "buildable", label: `Level-pad limit at ${cfg.slopeRatio}:1`, on: cfg.layers.buildable,
        sub: cfg.layers.buildable && maskE != null
          ? `where a single level pad can sit without walls · ${maskSource === "building" ? `at ${buildingName(selBuildingId)}'s finish, ${fmtE(maskE)} ft` : `at the best finish, ${fmtE(maskE)} ft`}`
          : "where a single level pad can sit without walls",
        info: `The line around the part of the parcel that can be ONE level pad with no retaining walls: inside the setback, no more than ${cfg.maxCutFillFt} ft of cut or fill, and the ${cfg.slopeRatio}:1 slope off the pad daylights before the setback line. Follows the selected building's finish elevation; with none selected, the best finish.` },
      { id: "cutfill", label: "Cut & Fill", on: cfg.layers.cutfill,
        sub: selBuildingId ? `${buildingName(selBuildingId)}'s slopes` : "all buildings' slopes",
        info: "The slopes outside the pavement edge: the grading run from the pavement to existing ground. Rust is cut, blue is fill, stronger colour is deeper. The dotted line is where the slopes meet existing ground; red is slope outside the setback. The pad, courts, parking and walks are not tinted." },
    ],
    actions: { typeFfe, resetFfe, applyMoveFix },
  }), [cfg, setback, input.groundBasis, base.dem, ground, best, autoFfe, buildable, cutfill, labels, cards, focusId, rock, solvingId, maskE, maskSource, selBuildingId, namesKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
