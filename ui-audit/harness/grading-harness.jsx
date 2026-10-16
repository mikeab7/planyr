/* Grading harness (ui-audit) — mounts the REAL GradingController + GradingPanels in a browser against the real
 * Chehaw Rd parcel + USGS 3DEP lattice fixture, WITHOUT the is_admin gate (the gate is asserted separately by
 * test/gradingGate.test.js). It re-creates SitePlanner's wiring faithfully: gsInputs → buildProposedSurface →
 * gradeSurface → controller → panels/canvas, with the edit callbacks mutating a local element list exactly the way
 * setEls does. Driven by ui-audit/verify-grading-harness.mjs. */
import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import GradingController from "../../src/workspaces/site-planner/components/GradingController.jsx";
import { GroundSection, BuildingTab, GradingCanvas } from "../../src/workspaces/site-planner/components/GradingPanels.jsx";
import { buildProposedSurface } from "../../src/workspaces/site-planner/lib/proposedSurface.js";
import { decodeGrid } from "../../src/workspaces/site-planner/lib/lercGrid.js";
import { lngLatToFeet } from "../../src/workspaces/site-planner/lib/mapLock.js";
import { offsetPolygon } from "../../src/workspaces/site-planner/lib/parcelOffset.js";
import { gradingCfg, gradingSetback, gradingPack, demSampler, hostIdMap } from "../../src/workspaces/site-planner/lib/gradingBase.js";
import { shiftAssembly } from "../../src/workspaces/site-planner/lib/buildingGrade.js";

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
    return [
      { id: "b1", type: "building", ring: rect(bx, by, 520, 300) },
      { id: "c1", type: "paving", truckCourt: true, attachedTo: "b1", ring: rect(bx, by + 300, 520, 130), dockStack: { x: bx + 260, y: by + 150 } },
      { id: "p1", type: "parking", attachedTo: "b1", ring: rect(bx, by - 62, 520, 62) },
      { id: "p2", type: "parking", attachedTo: "p1", ring: rect(bx, by - 124, 520, 62) },
    ];
  });
  const [settings, setSettings] = useState({ grading: { layers: { buildable: true, cutfill: true } } });
  const [model, setModel] = useState(null);
  const [sel, setSel] = useState("b1");
  const parcels = useMemo(() => [{ id: "pc", points: ring, setbacks: sb, active: true }], [ring, sb]);
  const cfg = gradingCfg(settings.grading);
  const setback = useMemo(() => gradingSetback(parcels, 25), [parcels]);
  const existAt = useMemo(() => demSampler(dem, origin), [dem, origin]);
  const hosts = hostIdMap(els);
  const gsEls = els.map((e) => ({ id: e.id, type: e.type, ring: ringOf(e), dockStack: e.dockStack || null, accessible: false, slopeOverridePct: null,
    padElevFt: Number.isFinite(e.padElevFt) ? e.padElevFt : null, ...(e.type !== "building" ? { hostId: hosts.get(e.id) ?? null } : {}) }));
  const gsInputs = { els: gsEls, ffeFt: null, dockDropFt: 4, fieldT: 0, drainTarget: null, daylightAsap: false, existAt, parcelRings: setback.parcelRings, pondRings: [], easementRings: [], opts: { existKey: "h" }, grading: gradingPack(cfg, setback) };
  const gsSig = JSON.stringify(gsEls.map((e) => [e.id, e.padElevFt, e.ring[0]])) + settings.grading?.pavementSlopePct + cfg.slopeRatio + cfg.maxCutFillFt;
  const anyFfe = gsEls.some((e) => e.type === "building" && Number.isFinite(e.padElevFt));
  const gradeSurface = useMemo(() => (anyFfe ? buildProposedSurface(gsInputs) : null), [gsSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo(() => ({ on: true, cfg, setback, dem: { status: "ready", dem, error: null, retry() {} }, existAt, pack: gradingPack(cfg, setback), existKey: "h", sig: "h" }), [cfg.slopeRatio, cfg.maxCutFillFt, cfg.pavementSlopePct, cfg.layers.buildable, cfg.layers.cutfill, setback, dem, existAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const patchBuilding = (id, patch) => setEls((a) => a.map((e) => { if (e.id !== id) return e; const n = { ...e }; for (const [k, v] of Object.entries(patch)) { if (v == null) delete n[k]; else n[k] = v; } return n; }));
  const input = { base, origin, gsInputs, gsSig, gradeSurface, selBuildingId: sel, multiBuildings: sel ? 1 : 0, rawBuilding: els.find((e) => e.id === sel) || null,
    rawBuildings: new Map(els.filter((e) => e.type === "building").map((e) => [e.id, e])), buildingName: "Building 1", dockDropFt: 4, groundBasis: "grid", accent: "#0e7a52", isDragging: () => false,
    actions: { patchBuilding: (id, p) => patchBuilding(id, p) } };
  window.__harness = { els, model, setSel, applyMove: (dx, dy) => setEls((a) => shiftAssembly(a.map((e) => ({ ...e, ring: e.ring })), new Set(a.map((e) => e.id)), dx, dy)), setSettings, settings };
  const PAL = { ink: "#1b1e26", accent: "#0e7a52", danger: "#c62828", paper: "#fff", panelBg: "#fff", panelLine: "#999" };
  const ppf = 0.9;
  const f2p = (p) => ({ x: p.x * ppf + 1000, y: p.y * ppf + 1450 });
  return (
    <>
      <div id="panel">
        <React.Suspense fallback={null}><GradingController input={input} onModel={setModel} /></React.Suspense>
        {model && <GroundSection model={model} onShowBuildable={() => setSettings((s) => ({ grading: { ...s.grading, layers: { ...s.grading.layers, buildable: true } } }))} />}
        {model && model.building && (
          <BuildingTab model={model} dockDropFt={4} renderNumber={<b>1</b>} wallRows={[]}
            onCfg={(p) => setSettings((s) => ({ grading: { ...s.grading, ...p } }))} onDockDrop={() => {}}
            onApplyFfeFix={(fx) => patchBuilding("b1", { padElevFt: fx.ffe, ffeBasis: "typed" })}
            onApplyMoveFix={(mv) => setEls((a) => shiftAssembly(a, new Set(a.map((e) => e.id)), mv.dx, mv.dy).map((e) => (e.id === "b1" && e.ffeBasis ? { ...e, ffeBasis: "typed" } : e)))} />
        )}
      </div>
      <svg id="canvas" width="1400" height="1000" style={{ background: "#e8efe6" }}>
        {model && <GradingCanvas model={model} f2p={f2p} rppf={ppf} PAL={PAL} />}
        {els.map((e) => <polygon key={e.id} points={e.ring.map((p) => `${f2p(p).x},${f2p(p).y}`).join(" ")} fill="none" stroke="#333" strokeWidth="1" />)}
        <polygon points={ring.map((p) => `${f2p(p).x},${f2p(p).y}`).join(" ")} fill="none" stroke="#0a0" strokeWidth="1.5" />
      </svg>
    </>
  );
}
load().then((data) => { createRoot(document.getElementById("root")).render(<Harness data={data} />); window.__ready = true; });
