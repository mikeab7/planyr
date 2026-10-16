/* GradingController (owner-only; loaded on demand — see lib/gradingGate.js) — the brain of the grading layer.
 *
 * Renders NOTHING. It owns the hooks the grading surfaces share and publishes ONE `model` object up to
 * SitePlanner through `onModel`, which hands it to the Site Analysis panel (Ground row, Building tab), the
 * canvas layers and the Layers rows. Heavy work never happens here on the main thread in one piece: the
 * buildable sweep runs in the terrain worker; the FFE solvers and fix searches are generators driven in
 * 10 ms slices (lib/buildingGrade.js runChunked) and superseded by a token the moment their inputs move.
 *
 * What it computes
 *   • ground    — the Ground row (best single level pad, relief, steepness) from the sweep.
 *   • mask      — the pad mask the "Buildable at <s>" layer paints (the SELECTED building's FFE, else the
 *                 best finish).
 *   • building  — the selected building's FFE + basis, earthwork tiles (read from the SAME lattice the
 *                 earthwork rows use), the setback flag in words, the two fixes, the spot elevations.
 *   • cutfill   — the Cut & Fill picture for the selected assembly (all buildings when none is selected).
 * The surface itself is NOT built here: it is SitePlanner's `gradeSurface` (the B826 engine with the
 * grading model on), passed in. Tiles, picture and rows therefore cannot disagree. */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildProposedSurface } from "../lib/proposedSurface.js";
import {
  assemblyIds, assemblyEarthwork, describeFlag, withFfe, shiftAssembly, solveBalanced, solveLeastDirt,
  findFfeFix, findMoveFix, runChunked, spotElevationsFor, courtDropReadout, snapFfe, FFE_STEP_FT,
} from "../lib/buildingGrade.js";
import { maskPixels, maskOutlinePath, cellsPixels, cellsOutlinePath, pixelsToDataUrl, hexToRgb } from "../lib/gradingPaint.js";

const EMPTY = [];
const fmtE = (v) => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "");
const sumOut = (surface, ids) => {
  const o = surface && surface.grid && surface.grid.outside;
  if (!o) return 0;
  let n = 0;
  for (const id of ids) if (o.perEl && o.perEl[id]) n += o.perEl[id].count;
  return n;
};
const centreOf = (ring) => {
  let x = 0, y = 0;
  for (const p of ring) { x += p.x; y += p.y; }
  return { x: x / ring.length, y: y / ring.length };
};

export default function GradingController({ input, onModel }) {
  const inRef = useRef(input); inRef.current = input;
  const { base, origin, gradeSurface, gsInputs, selBuildingId, accent } = input;
  const cfg = base.cfg;
  const setback = base.setback;
  const demReady = base.dem && base.dem.status === "ready" ? base.dem.dem : null;

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

  /* ---------------- the selected building ---------------- */
  // `gsInputs` is rebuilt every planner render; `input.gsSig` is its VALUE signature, so everything derived from
  // the prepared elements is memoised on that (a fresh Set per render would republish the model forever).
  const gsSig = input.gsSig;
  const els = gsInputs && gsInputs.els ? gsInputs.els : EMPTY;
  const bPrepared = useMemo(() => (selBuildingId ? els.find((e) => e.id === selBuildingId) || null : null), [selBuildingId, gsSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = useMemo(() => (selBuildingId ? assemblyIds(els, selBuildingId) : null), [selBuildingId, gsSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const grid = gradeSurface && gradeSurface.grid ? gradeSurface.grid : null;
  const ffe = bPrepared && Number.isFinite(bPrepared.padElevFt) ? bPrepared.padElevFt : (gsInputs && Number.isFinite(gsInputs.ffeFt) ? gsInputs.ffeFt : null);
  const rawBuilding = selBuildingId ? input.rawBuilding : null;
  const basis = rawBuilding ? (rawBuilding.ffeBasis || (Number.isFinite(rawBuilding.padElevFt) ? "typed" : null)) : null;

  const earthwork = useMemo(() => (grid && ids ? assemblyEarthwork(grid, ids) : null), [grid, ids]);
  const bCentre = useMemo(() => (bPrepared ? centreOf(bPrepared.ring) : null), [bPrepared]);
  const flag = useMemo(() => (gradeSurface && ids && bCentre
    ? describeFlag(gradeSurface, ids, { buildingCentre: bCentre, elements: els, slopeRatio: cfg.slopeRatio }) : null),
  [gradeSurface, ids, cfg.slopeRatio]); // eslint-disable-line react-hooks/exhaustive-deps

  // Spot elevations + fall arrows for the selected assembly's court / lots (the tiles' own elevation function).
  const spots = useMemo(() => {
    if (!gradeSurface || !grid || !ids) return [];
    const out = [];
    for (const id of ids) {
      const plane = gradeSurface.planes.get(id);
      if (!plane || plane.classId === "buildingPad" || !plane.wall) continue;
      const owner = grid.owners.find((o) => o.el.id === id);
      const el = els.find((e) => e.id === id);
      if (!owner || !el) continue;
      const sp = spotElevationsFor(plane, el.ring, (pt) => grid.zOf(owner, pt));
      if (sp) out.push(sp);
    }
    return out;
  }, [gradeSurface, grid, ids, gsSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const court = spots.find((s) => s.kind === "court") || null;

  /* ---------------- the two fixes (background search, superseded by token) ---------------- */
  const [fixes, setFixes] = useState({ status: "idle", ffe: null, move: null });
  const fixSeq = useRef(0);
  const flagKey = flag && gradeSurface ? `${gradeSurface.surfaceKey}#${selBuildingId}` : "";
  useEffect(() => {
    if (!flagKey) { setFixes({ status: "idle", ffe: null, move: null }); return undefined; }
    const my = ++fixSeq.current;
    setFixes({ status: "computing", ffe: null, move: null });
    const I = inRef.current;
    const gi = I.gsInputs;
    const aIds = assemblyIds(gi.els, selBuildingId);
    const outAt = (e2) => { const s = buildProposedSurface({ ...gi, els: e2 }); return s ? sumOut(s, aIds) : null; };
    const cur = Number.isFinite(bPrepared.padElevFt) ? bPrepared.padElevFt : gi.ffeFt;
    const stale = () => my !== fixSeq.current;
    const start = setTimeout(async () => {
      try {
        const ffeFix = Number.isFinite(cur)
          ? await runChunked(findFfeFix((f) => { const n = outAt(withFfe(gi.els, selBuildingId, f)); return n == null ? null : n === 0; }, cur), { isStale: stale })
          : null;
        if (stale() || (ffeFix && ffeFix.stale)) return;
        const moveFix = await runChunked(findMoveFix(
          (dx, dy) => { const n = outAt(shiftAssembly(gi.els, aIds, dx, dy)); return n === 0; },
          { buildingCentre: centreOf(bPrepared.ring), offendCentroid: flag.centroid },
        ), { isStale: stale });
        if (stale() || (moveFix && moveFix.stale)) return;
        setFixes({ status: "done", ffe: ffeFix || null, move: moveFix || null });
      } catch (e) {
        if (!stale()) setFixes({ status: "failed", ffe: null, move: null, error: String((e && e.message) || e) });
      }
    }, 60);
    return () => clearTimeout(start);
  }, [flagKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- FFE bases ---------------- */
  const [solving, setSolving] = useState(null);       // basis id while a solve runs
  const solveSeq = useRef(0);
  const groundRange = (aIds) => {
    const I = inRef.current, gi = I.gsInputs;
    const ex = gi.existAt;
    if (typeof ex !== "function") return null;
    let lo = Infinity, hi = -Infinity;
    for (const id of aIds) {
      const el = gi.els.find((e) => e.id === id);
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
  /* Solve a basis for building `id` → { ffe } | null. Never throws; resolves { stale } if superseded. */
  const solveBasis = async (id, which, my) => {
    const I = inRef.current, gi = I.gsInputs;
    const aIds = assemblyIds(gi.els, id);
    const stale = () => my !== solveSeq.current;
    if (which === "room") {
      const e = bestRef.current ? bestRef.current.E : null;
      return e == null ? null : { ffe: snapFfe(e) };
    }
    const range = groundRange(aIds);
    if (!range) return null;
    const surf = (f) => buildProposedSurface({ ...gi, els: withFfe(gi.els, id, f), ffeFt: gi.ffeFt });
    const net = (f) => { const s = surf(f); const t = s && assemblyEarthwork(s.grid, aIds); return t ? t.netCy : null; };
    const dirt = (f) => { const s = surf(f); const t = s && assemblyEarthwork(s.grid, aIds); return t ? t.dirtCy : null; };
    const r = await runChunked(which === "balanced" ? solveBalanced(net, range) : solveLeastDirt(dirt, range), { isStale: stale });
    return r && r.stale ? { stale: true } : r;
  };
  const pickBasis = async (which) => {
    if (!selBuildingId) return;
    const my = ++solveSeq.current;
    setSolving(which);
    try {
      const r = await solveBasis(selBuildingId, which, my);
      if (my !== solveSeq.current || (r && r.stale)) return;
      if (r && Number.isFinite(r.ffe)) inRef.current.actions.patchBuilding(selBuildingId, { padElevFt: r.ffe, ffeBasis: which }, { history: true });
    } finally { if (my === solveSeq.current) setSolving(null); }
  };
  const typeFfe = (v) => {
    if (!selBuildingId) return;
    if (!Number.isFinite(v)) inRef.current.actions.patchBuilding(selBuildingId, { padElevFt: null, ffeBasis: null }, { history: true });
    else inRef.current.actions.patchBuilding(selBuildingId, { padElevFt: v, ffeBasis: "typed" }, { history: true });
  };

  // Re-solve an active chip when the ground truth under it moved: geometry (move / resize / rotate / wall layers),
  // slope, depth. On pointer RELEASE only, never per frame. First sight of a building records its signature and
  // solves nothing — opening a plan must not rewrite it.
  const lastSig = useRef(new Map());
  const ffeSig = useMemo(() => {
    const m = [];
    for (const e of els) {
      if (e.type !== "building") continue;
      const aIds = assemblyIds(els, e.id);
      const geo = els.filter((x) => aIds.has(x.id)).map((x) => `${x.id}:${x.ring.map((p) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`).join(";")}`).join("|");
      m.push([e.id, geo]);
    }
    return m;
  }, [gsSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const cfgSig = `${cfg.pavementSlopePct}|${cfg.slopeRatio}|${cfg.maxCutFillFt}|${input.dockDropFt}|${base.existKey}|${setback ? setback.sig : ""}`;
  useEffect(() => {
    const I = inRef.current;
    if (!I.rawBuildings) return undefined;
    const timers = [];
    for (const [id, geo] of ffeSig) {
      const sig = `${geo}#${cfgSig}`;
      const prev = lastSig.current.get(id);
      lastSig.current.set(id, sig);
      if (prev == null || prev === sig) continue;
      const raw = I.rawBuildings.get(id);
      const bs = raw && raw.ffeBasis;
      if (!(bs === "balanced" || bs === "least" || bs === "room")) continue;
      const run = (tries) => {
        const J = inRef.current;
        if (J.isDragging && J.isDragging() && tries < 40) { timers.push(setTimeout(() => run(tries + 1), 150)); return; }
        const my = ++solveSeq.current;
        solveBasis(id, bs, my).then((r) => {
          if (my !== solveSeq.current || !r || r.stale || !Number.isFinite(r.ffe)) return;
          const cur = inRef.current.rawBuildings.get(id);
          if (cur && cur.padElevFt === r.ffe) return;
          inRef.current.actions.patchBuilding(id, { padElevFt: r.ffe }, { history: false });
        });
      };
      timers.push(setTimeout(() => run(0), 250));
    }
    return () => timers.forEach(clearTimeout);
  }, [ffeSig, cfgSig, best && best.E]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Buildable layer: the pad mask at the building's FFE (else the best finish) ---------------- */
  const [maskRes, setMaskRes] = useState(null);
  const mSeq = useRef(0);
  const maskE = selBuildingId && ffe != null ? ffe : best ? best.E : null;
  const maskSource = selBuildingId && ffe != null ? "building" : "best";
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
    const px = maskPixels(info, hexToRgb(accent));
    return {
      dataUrl: pixelsToDataUrl(px, info.nx, info.ny),
      bboxFt: { x: info.x0, y: info.y0, w: info.nx * info.cell, h: info.ny * info.cell },
      outlineD: maskOutlinePath(info), E: maskRes.E, source: maskRes.source, areaAc: maskRes.areaAc,
    };
  }, [maskRes, cfg.layers.buildable, accent]);

  /* ---------------- Cut & Fill picture ---------------- */
  const cutfill = useMemo(() => {
    if (!cfg.layers.cutfill || !grid || !grid.cells.length) return null;
    const cells = ids ? grid.cells.filter((c) => ids.has(c.elId)) : grid.cells;
    if (!cells.length) return null;
    const cp = cellsPixels(cells);
    if (!cp) return null;
    return {
      dataUrl: pixelsToDataUrl(cp.pixels, cp.nx, cp.ny),
      bboxFt: { x: cp.x0, y: cp.y0, w: cp.nx * cp.dx, h: cp.ny * cp.dy },
      outlineD: cellsOutlinePath(cp),
    };
  }, [cfg.layers.cutfill, grid, ids]);

  /* ---------------- publish ---------------- */
  const model = useMemo(() => ({
    on: true, cfg, setback, groundBasis: input.groundBasis, demStatus: base.dem.status, demError: base.dem.error, retryDem: base.dem.retry,
    ground: { ...ground, retry: () => setGRetry((n) => n + 1) },
    bestFinish: best ? best.E : null,
    buildable, cutfill,
    building: selBuildingId && bPrepared ? {
      id: selBuildingId, ffe, basis, solving, extra: input.multiBuildings > 1 ? input.multiBuildings - 1 : 0,
      earthwork, flag, fixes, spots, court, courtDrop: courtDropReadout(court), noSurface: !gradeSurface,
      flagDot: flag ? { pt: flag.centroid, text: `${flag.over} ft past the setback` } : null,
    } : null,
    layerRows: [
      { id: "buildable", label: `Buildable at ${cfg.slopeRatio}:1`, on: cfg.layers.buildable,
        sub: maskE == null ? (ground.status === "computing" ? "reading the ground…" : "needs the ground model")
          : maskSource === "building" ? `at ${input.buildingName || "the building"}'s finish, ${fmtE(maskE)} ft` : `at the best finish, ${fmtE(maskE)} ft`,
        info: `The part of the parcel that can be ONE level pad with no retaining walls: inside the setback, no more than ${cfg.maxCutFillFt} ft of cut or fill, and the ${cfg.slopeRatio}:1 slope off the pad daylights before the setback line. Follows the selected building's finish elevation; with none selected, the best finish.` },
      { id: "cutfill", label: "Cut & Fill", on: cfg.layers.cutfill,
        sub: selBuildingId ? `${input.buildingName || "selected building"}` : "all buildings",
        info: "The proposed grade against existing ground for the selected building (all buildings when none is selected). Rust is cut, blue is fill, stronger colour is deeper. The dotted line is where the slopes meet existing ground; red cells are graded ground outside the setback." },
    ],
    actions: { pickBasis, typeFfe },
  }), [cfg, setback, input.groundBasis, base.dem, ground, best, buildable, cutfill, selBuildingId, bPrepared, ffe, basis, solving, earthwork, flag, fixes, spots, court, gradeSurface, input.multiBuildings, maskE, maskSource, input.buildingName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onModel(model); }, [model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onModel(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  void FFE_STEP_FT;
  return null;
}
