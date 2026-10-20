/* Grading harness (ui-audit) — mounts the REAL GradingController + GradingPanels in a browser against the real
 * Chehaw Rd parcel + USGS 3DEP lattice fixture, WITHOUT the is_admin gate (the gate is asserted separately by
 * test/gradingGate.test.js). It re-creates SitePlanner's wiring faithfully: gsInputs → buildProposedSurface →
 * gradeSurface → controller → panels/canvas, with the edit callbacks mutating a local element list exactly the way
 * setEls does. Driven by ui-audit/verify-grading-harness.mjs. */
import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import GradingController from "../../src/workspaces/site-planner/components/GradingController.jsx";
import { GradingPanel, GradingCanvas } from "../../src/workspaces/site-planner/components/GradingPanels.jsx";
import { useGradeSurface } from "../../src/workspaces/site-planner/lib/useGradeSurface.js";
import { decodeGrid } from "../../src/workspaces/site-planner/lib/lercGrid.js";
import { lngLatToFeet } from "../../src/workspaces/site-planner/lib/mapLock.js";
import { offsetPolygon } from "../../src/workspaces/site-planner/lib/parcelOffset.js";
import { gradingCfg, gradingSetback, gradingPack, demSampler, hostIdMap } from "../../src/workspaces/site-planner/lib/gradingBase.js";
import { shiftAssembly } from "../../src/workspaces/site-planner/lib/buildingGrade.js";
import { CHEHAW_CROSS_DOCK_ROWS, rowRing, OWNER_ORIGIN } from "../lib/chehawCrossDock.mjs";

const F = "/test/fixtures/chehaw-218-02007";
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

async function load() {
  const [buf, req, pj] = await Promise.all([fetch(F + ".lerc").then((r) => r.arrayBuffer()), fetch(F + ".req.json").then((r) => r.json()), fetch(F + ".parcel.json").then((r) => r.json())]);
  const grid = decodeGrid(buf, req);
  const ll = pj.ringLngLat.slice(0, -1);
  const lat0 = ll.reduce((a, p) => a + p[1], 0) / ll.length, lon0 = ll.reduce((a, p) => a + p[0], 0) / ll.length;
  const ring = ll.map(([lo, la]) => lngLatToFeet(lo, la, lon0, lat0));
  let minY = Infinity; for (const p of ring) minY = Math.min(minY, p.y);
  const sb = ring.map((a, i) => { const c = ring[(i + 1) % ring.length]; return (a.y + c.y) / 2 < minY + 400 ? 50 : 25; });
  return { dem: { grid, req }, origin: { lat: lat0, lon: lon0 }, ring, sb };
}

const ringOf = (e) => e.ring;
function Harness({ data }) {
  const { dem, origin, ring, sb } = data;
  const [els, setEls] = useState(() => {
    const bx = +(new URLSearchParams(location.search).get("bx") ?? -560), by = +(new URLSearchParams(location.search).get("by") ?? -1326);
    // ?owner=1 — the owner's real 636,916 SF cross-dock (problem report 6cea9895), moved from his plan's origin into this frame
    if (new URLSearchParams(location.search).get("owner") === "1") {
      const o = lngLatToFeet(OWNER_ORIGIN.lon, OWNER_ORIGIN.lat, data.origin.lon, data.origin.lat);
      const host = CHEHAW_CROSS_DOCK_ROWS[0];
      const hc = { x: host.cx + o.x, y: host.cy + o.y };
      return CHEHAW_CROSS_DOCK_ROWS.filter((e) => ["building", "paving", "parking", "trailer"].includes(e.type)).map((e) => ({
        id: e.id, type: e.type, attachedTo: e.attachedTo, truckCourt: !!e.truckCourt, ring: rowRing(e).map((p) => ({ x: p.x + o.x, y: p.y + o.y })),
        ...(e.truckCourt || e.forCourt ? { dockStack: hc } : {}),
      }));
    }
    if (new URLSearchParams(location.search).get("none") === "1") return [];     // no building on the plan: the panel's empty state
    const one = [
      { id: "b1", type: "building", ring: rect(bx, by, 520, 300) },
      { id: "c1", type: "paving", truckCourt: true, attachedTo: "b1", ring: rect(bx, by + 300, 520, 130), dockStack: { x: bx + 260, y: by + 150 } },
      { id: "p1", type: "parking", attachedTo: "b1", ring: rect(bx, by - 62, 520, 62) },
      { id: "p2", type: "parking", attachedTo: "p1", ring: rect(bx, by - 124, 520, 62) },
    ];
    // ?bump=1 — two corner bump-outs (dog-ears) on b1, exactly the shape makeDogEar stamps: a building element
    // attached to its host, dogEar set. They must grade as part of b1's pad, never as buildings of their own.
    if (new URLSearchParams(location.search).get("bump") === "1") {
      one.push({ id: "d1", type: "building", attachedTo: "b1", noFit: true, noLabel: true, dock: "none", dogEar: { side: "s", sign: -1 }, padElevFt: 1, ring: rect(bx, by + 300, 55, 60) });
      one.push({ id: "d2", type: "building", attachedTo: "b1", noFit: true, noLabel: true, dock: "none", dogEar: { side: "s", sign: 1 }, ring: rect(bx + 465, by + 300, 55, 60) });
    }
    if (new URLSearchParams(location.search).get("two") !== "1") return one;
    // a second, smaller building well to the east, with its own court
    const x2 = bx + 900;
    return one.concat([
      { id: "b2", type: "building", ring: rect(x2, by, 300, 200) },
      { id: "c2", type: "paving", truckCourt: true, attachedTo: "b2", ring: rect(x2, by + 200, 300, 110), dockStack: { x: x2 + 150, y: by + 100 } },
    ]);
  });
  const [settings, setSettings] = useState({ grading: { enabled: new URLSearchParams(location.search).get("off") !== "1",
    // round 4: the limit MODE (?mode=boundary), the proposed contours (?contours=1)
    limitMode: new URLSearchParams(location.search).get("mode") === "boundary" ? "boundary" : "layout",
    layers: { buildable: new URLSearchParams(location.search).get("buildable") !== "0", cutfill: new URLSearchParams(location.search).get("cutfill") !== "0", contours: new URLSearchParams(location.search).get("contours") === "1" } } });
  const [limitEdit, setLimitEdit] = useState(null);
  const [model, setModel] = useState(null);
  const [headEl, setHeadEl] = useState(null);
  const [sel, setSel] = useState(new URLSearchParams(location.search).get("owner") === "1" ? CHEHAW_CROSS_DOCK_ROWS[0].id : "b1");
  const parcels = useMemo(() => [{ id: "pc", points: ring, setbacks: sb, active: true }], [ring, sb]);
  const cfg = gradingCfg(settings.grading);
  const planOn = cfg.enabled;
  const setback = useMemo(() => gradingSetback(parcels, 25), [parcels]);
  const existAt = useMemo(() => demSampler(dem, origin), [dem, origin]);
  const hosts = hostIdMap(els);
  // SitePlanner's wiring: a building with no TYPED finish elevation takes the SUGGESTED one the controller published
  const gsEls = els.map((e) => {
    const fs = e.type === "building" && hosts.get(e.id) ? (els.find((x) => x.id === hosts.get(e.id)) || e) : e;   // a bump-out takes its HOST's finish
    return { id: e.id, type: e.type, ring: ringOf(e), dockStack: e.dockStack || null, accessible: false, slopeOverridePct: null,
      padElevFt: Number.isFinite(fs.padElevFt) ? fs.padElevFt : (e.type === "building" && model && model.autoFfe && model.autoFfe.has(fs.id) ? model.autoFfe.get(fs.id) : null),
      ...(e.type !== "building" ? { hostId: hosts.get(e.id) ?? null } : {}),
      ...(e.type === "building" && hosts.get(e.id) ? { hostId: hosts.get(e.id) } : {}) };
  });
  const hostBuildings = els.filter((e) => e.type === "building" && !hosts.has(e.id));
  const gsInputs = { els: gsEls, ffeFt: null, dockDropFt: 4, fieldT: 0, drainTarget: null, daylightAsap: false, existAt, parcelRings: setback.parcelRings, pondRings: [], easementRings: [], opts: { existKey: "h" }, grading: gradingPack(cfg, setback) };
  const gsSig = JSON.stringify(gsEls.map((e) => [e.id, e.padElevFt, e.ring[0]])) + settings.grading?.pavementSlopePct + cfg.slopeRatio + cfg.maxCutFillFt + cfg.limitMode + cfg.shoulderFt + cfg.cornerRadiusFt + cfg.maxPavementSlopePct + JSON.stringify(cfg.limitRing || null);
  const anyFfe = gsEls.some((e) => e.type === "building" && Number.isFinite(e.padElevFt));
  // SitePlanner's wiring: the grading layer builds the surface OFF the render path and holds it while a drag is in flight.
  const dragRef = React.useRef(false);
  const gradeSurface = useGradeSurface({ inputs: gsInputs, sig: gsSig, enabled: anyFfe, offRender: true, isDragging: () => dragRef.current });
  const base = useMemo(() => ({ on: true, cfg, setback, dem: { status: "ready", dem, error: null, retry() {} }, existAt, pack: gradingPack(cfg, setback), existKey: "h", sig: "h" }), [cfg.slopeRatio, cfg.maxCutFillFt, cfg.pavementSlopePct, cfg.layers.buildable, cfg.layers.cutfill, cfg.layers.contours, cfg.limitMode, cfg.shoulderFt, cfg.cornerRadiusFt, cfg.maxPavementSlopePct, cfg.limitRing, setback, dem, existAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const patchBuilding = (id, patch) => setEls((a) => a.map((e) => { if (e.id !== id) return e; const n = { ...e }; for (const [k, v] of Object.entries(patch)) { if (v == null) delete n[k]; else n[k] = v; } return n; }));
  const qs = new URLSearchParams(location.search);
  const rockFt = qs.get("rock") ? +qs.get("rock") : null, pondCy = +(qs.get("pond") || 0);
  const rockPolys = useMemo(() => {
    if (rockFt == null) return null;
    const ll = ring.map((p) => { const k = 364000; return [origin.lon + p.x / k, origin.lat - p.y / k]; });
    let w = Infinity, s2 = Infinity, e2 = -Infinity, n2 = -Infinity;
    for (const [lo, la] of ll) { w = Math.min(w, lo); e2 = Math.max(e2, lo); s2 = Math.min(s2, la); n2 = Math.max(n2, la); }
    const box = [[w - 0.01, s2 - 0.01], [e2 + 0.01, s2 - 0.01], [e2 + 0.01, n2 + 0.01], [w - 0.01, n2 + 0.01], [w - 0.01, s2 - 0.01]];
    return [{ depthCm: rockFt * 30.48, polygons: [[box]] }];
  }, [rockFt, ring, origin]);
  const grCfg = (patch) => setSettings((s2) => ({ grading: { ...s2.grading, ...patch } }));
  const limitActions = {
    setLimitMode: (m) => { if (m !== "layout") setLimitEdit(null); grCfg({ limitMode: m }); },
    editLimit: (span) => {
      const g = settings.grading;
      if (!Array.isArray(g.limitRing)) { const L = gradeSurface && gradeSurface.grid && gradeSurface.grid.limit; const r = L && L.limitRegions[0] ? L.limitRegions[0].outer : null; if (!r) return; grCfg({ limitRing: r, limitMode: "layout" }); }
      setLimitEdit({ highlight: span || null });
    },
    doneEditLimit: () => setLimitEdit(null),
    resetLimit: () => { setLimitEdit(null); grCfg({ limitRing: null }); },
  };
  const input = { base, origin, gsInputs, gsSig, gradeSurface, selBuildingId: sel, multiBuildings: sel ? 1 : 0, rawBuilding: els.find((e) => e.id === sel) || null,
    limitEditing: !!limitEdit, limitHighlight: limitEdit ? limitEdit.highlight : null,
    rawBuildings: new Map(hostBuildings.map((e) => [e.id, e])), buildingNames: new Map(hostBuildings.map((e, i) => [e.id, `Building ${i + 1}`])), buildingOrder: hostBuildings.map((e) => e.id),
    pondCutCy: pondCy, siteFloorFt: null, rockPolys, dockDropFt: 4, groundBasis: "grid", accent: "#0e7a52", isDragging: () => dragRef.current,
    actions: { patchBuilding: (id, p) => patchBuilding(id, p), ...limitActions,
      moveAssembly: (id, dx, dy, freeze) => setEls((a) => shiftAssembly(a, new Set(a.map((e) => e.id)), dx, dy).map((e) => (e.id === id && !Number.isFinite(e.padElevFt) && Number.isFinite(freeze) ? { ...e, padElevFt: freeze, ffeBasis: "typed" } : e))) } };
  window.__harness = { els, model, setSel, gradeSurface, limitEdit, setLimitEdit,
    // a real gesture's shape: dragging=true, one assembly move per pointer step, then release (dragging=false + a final commit)
    dragStart: () => { dragRef.current = true; }, dragEnd: () => { dragRef.current = false; setEls((a) => a.map((e) => ({ ...e }))); }, applyMove: (dx, dy) => setEls((a) => shiftAssembly(a.map((e) => ({ ...e, ring: e.ring })), new Set(a.map((e) => e.id)), dx, dy)), setSettings, settings };
  const PAL = { ink: "#1b1e26", accent: "#0e7a52", danger: "#c62828", paper: "#fff", panelBg: "#fff", panelLine: "#999" };
  const ppf = +(qs.get("ppf") || 0.9);
  const f2p = (p) => ({ x: p.x * ppf + 1000, y: p.y * ppf + 1450 });
  return (
    <>
      <div id="panel" style={{ fontSize: 18, width: 300 }}>
        {planOn && <React.Suspense fallback={null}><GradingController input={input} onModel={setModel} /></React.Suspense>}
        {/* the SitePlanner dock: the panel chrome's header slot (the gear + info portal there), then the panel body */}
        <div id="panel-header" data-testid="panel-chrome-grading"><span>GRADING</span><span ref={setHeadEl} id="panel-header-actions" /></div>
        <GradingPanel planOn={planOn} showOnMap={!!settings.grading.layers.cutfill} showContours={!!settings.grading.layers.contours}
          onPlanOn={(v) => setSettings((s) => ({ grading: { ...s.grading, enabled: v } }))}
          onShowOnMap={(v) => setSettings((s) => ({ grading: { ...s.grading, layers: { ...s.grading.layers, cutfill: v } } }))}
          onShowContours={(v) => setSettings((s) => ({ grading: { ...s.grading, layers: { ...s.grading.layers, contours: v } } }))}
          onPullLimit={(id, span) => limitActions.editLimit(span)}
          model={planOn ? model : null} headerSlot={headEl} dockDropFt={4} buildableOn={!!(model && model.cfg.layers.buildable)}
          onToggleBuildable={() => setSettings((s) => ({ grading: { ...s.grading, layers: { ...s.grading.layers, buildable: !s.grading.layers.buildable } } }))}
          onCfg={(p) => setSettings((s) => ({ grading: { ...s.grading, ...p } }))} onDockDrop={() => {}}
          onSelectBuilding={(id) => setSel(id)}
          onApplyFfeFix={(id, fx) => patchBuilding(id, { padElevFt: fx.ffe, ffeBasis: "typed" })}
          onApplyMoveFix={(id, mv) => model.actions.applyMoveFix(id, mv)} />
      </div>
      <svg id="canvas" width="1400" height="1000" style={{ background: "#e8efe6" }}>
        {planOn && model && <GradingCanvas model={model} f2p={f2p} rppf={ppf} PAL={PAL} />}
        {els.map((e) => <polygon key={e.id} points={e.ring.map((p) => `${f2p(p).x},${f2p(p).y}`).join(" ")} fill="none" stroke="#333" strokeWidth="1" />)}
        {limitEdit && Array.isArray(settings.grading.limitRing) && <polygon data-grading-limit-edit="1" points={settings.grading.limitRing.map((p) => `${f2p(p).x},${f2p(p).y}`).join(" ")} fill="none" stroke="#1d4ed8" strokeWidth="1.5" strokeDasharray="6 4" />}
        <polygon points={ring.map((p) => `${f2p(p).x},${f2p(p).y}`).join(" ")} fill="none" stroke="#0a0" strokeWidth="1.5" />
      </svg>
    </>
  );
}
load().then((data) => { window.__origin = data.origin; window.__dem = data.dem; createRoot(document.getElementById("root")).render(<Harness data={data} />); window.__ready = true; });
