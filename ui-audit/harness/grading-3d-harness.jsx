/* 3D grading viewer harness (ui-audit) — mounts the REAL Grading3DViewer on a plan whose proposed surface is built by the REAL engine
 * (buildProposedSurface through the app's own grading config), WITHOUT the is_admin gate (test/gradingGate.test.js owns that).
 *   ?site=synthetic (default) — a hand-made sloped site: ~90 ft of fall + rolling hills under a 700 x 300 building, its court and parking.
 *   ?site=chehaw              — the owner's real Chehaw Rd ground (USGS 3DEP lattice fixture) and Concept A, ~72 acres.
 * The page exposes window.__h = { ready, open(), close(), stats() } for ui-audit/verify-grading-3d-viewer.mjs, and arms the viewer's read-only
 * window.__grading3d (the diag arm) itself. */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Grading3DViewer from "../../src/workspaces/site-planner/components/Grading3DViewer.jsx";
import View3dMount from "../../src/workspaces/site-planner/components/View3dMount.jsx";
import { liveStats } from "../../src/workspaces/site-planner/lib/grading3d/threeScene.js";
import { buildProposedSurface } from "../../src/workspaces/site-planner/lib/proposedSurface.js";
import { gradingCfg, gradingSetback, gradingPack, hostIdMap } from "../../src/workspaces/site-planner/lib/gradingBase.js";
import { decodeGrid } from "../../src/workspaces/site-planner/lib/lercGrid.js";
import { lngLatToFeet, feetToLatLngPair } from "../../src/workspaces/site-planner/lib/mapLock.js";
import { sampleAtLatLng } from "../../src/workspaces/site-planner/lib/demGrid.js";
import { CHEHAW_CONCEPT_A_ROWS, rowRing, OWNER_ORIGIN } from "../lib/chehawCrossDock.mjs";

try { sessionStorage.setItem("planyr:diag", "1"); } catch (_) { /* unarmed — the harness reads state through __h instead */ }
const QS = new URLSearchParams(location.search);
const F = "/test/fixtures/chehaw-218-02007";
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

function prepare(parcel, sb, existAt, rows, ffe) {
  const hosts = hostIdMap(rows);
  const els = rows.map((e) => ({ id: e.id, type: e.type, ring: e.ring, dockStack: e.dockStack || null, accessible: false, slopeOverridePct: null, padElevFt: e.type === "building" ? ffe : null, ...(e.type !== "building" ? { hostId: hosts.get(e.id) ?? null } : {}) }));
  const setback = gradingSetback([{ id: "pc", points: parcel, setbacks: sb, active: true }], 25);
  const cfg = gradingCfg({ enabled: true, layers: { cutfill: true } });
  const inputs = { els, ffeFt: null, dockDropFt: 4, existAt, parcelRings: setback.parcelRings, pondRings: [], easementRings: [], opts: { existKey: `h3d:${QS.get("site")}:${ffe}` }, grading: gradingPack(cfg, setback) };
  const surface = buildProposedSurface(inputs);
  return { grid: surface.grid, existAt, parcelRings: setback.parcelRings, els };
}

async function synthetic() {
  // an irregular six-sided parcel, 1,800 x 1,300 ft, on ground that falls ~72 ft west -> east with rolling hills on top
  const parcel = [{ x: 0, y: 40 }, { x: 900, y: 0 }, { x: 1800, y: 120 }, { x: 1740, y: 1180 }, { x: 760, y: 1300 }, { x: 60, y: 1010 }];
  const existAt = (p) => 700 + 0.04 * p.x + 0.014 * p.y + 11 * Math.sin(p.x / 240) * Math.cos(p.y / 290) + 6 * Math.sin((p.x + p.y) / 140);
  const bx = 420, by = 420;
  const rows = [
    { id: "b1", type: "building", ring: rect(bx, by, 700, 300) },
    { id: "c1", type: "paving", truckCourt: true, attachedTo: "b1", ring: rect(bx, by + 300, 700, 140), dockStack: { x: bx + 350, y: by + 150 } },
    { id: "p1", type: "parking", attachedTo: "b1", ring: rect(bx, by - 70, 700, 70) },
  ];
  return prepare(parcel, parcel.map(() => 25), existAt, rows, 738);
}
async function chehaw() {
  const [buf, req, pj] = await Promise.all([fetch(F + ".lerc").then((r) => r.arrayBuffer()), fetch(F + ".req.json").then((r) => r.json()), fetch(F + ".parcel.json").then((r) => r.json())]);
  const grid = decodeGrid(buf, req);
  const ll = pj.ringLngLat.slice(0, -1);
  const lat0 = ll.reduce((a, p) => a + p[1], 0) / ll.length, lon0 = ll.reduce((a, p) => a + p[0], 0) / ll.length;
  const ring = ll.map(([lo, la]) => lngLatToFeet(lo, la, lon0, lat0));
  const existAt = (pt) => { const [la, lo] = feetToLatLngPair(pt, lat0, lon0); return sampleAtLatLng(grid, req, la, lo); };
  const o = lngLatToFeet(OWNER_ORIGIN.lon, OWNER_ORIGIN.lat, lon0, lat0);
  const rows = CHEHAW_CONCEPT_A_ROWS.filter((e) => ["building", "paving", "parking", "trailer"].includes(e.type)).map((e) => ({
    id: e.id, type: e.type, attachedTo: e.attachedTo, truckCourt: !!e.truckCourt, ring: rowRing(e).map((p) => ({ x: p.x + o.x, y: p.y + o.y })),
    ...(e.truckCourt || e.forCourt ? { dockStack: { x: CHEHAW_CONCEPT_A_ROWS[0].cx + o.x, y: CHEHAW_CONCEPT_A_ROWS[0].cy + o.y } } : {}),
  }));
  let minY = Infinity; for (const p of ring) minY = Math.min(minY, p.y);
  return prepare(ring, ring.map((a, i) => { const c = ring[(i + 1) % ring.length]; return (a.y + c.y) / 2 < minY + 400 ? 50 : 25; }), existAt, rows, 793);
}

function App({ data }) {
  const [open, setOpen] = useState(false);
  const [gridKey, setGridKey] = useState(0);
  const [d, setD] = useState(data);
  React.useEffect(() => {
    window.__h = {
      ready: true, open: () => setOpen(true), close: () => setOpen(false), stats: liveStats, isOpen: () => open,
      // swap in a re-graded surface (a different finish floor), as the planner does when the plan recalculates
      regrade: (ffe) => { setD((cur) => ({ ...cur, grid: regradeGrid(cur, ffe) })); setGridKey((k) => k + 1); },
    };
  });
  if (!open) return <button data-testid="harness-open" onClick={() => setOpen(true)} style={{ margin: 12 }}>View in 3D</button>;
  return (
    <View3dMount onClose={() => setOpen(false)}>
      <Grading3DViewer key="v" grid={d.grid} existAt={d.existAt} parcelRings={d.parcelRings} els={d.els} onClose={() => setOpen(false)} />
    </View3dMount>
  );
}
let REG = null;
function regradeGrid(cur, ffe) {
  const els = cur.els.map((e) => (e.type === "building" ? { ...e, padElevFt: ffe } : e));
  const setback = gradingSetback([{ id: "pc", points: cur.parcelRings[0], setbacks: cur.parcelRings[0].map(() => 25), active: true }], 25);
  const cfg = gradingCfg({ enabled: true, layers: { cutfill: true } });
  const s = buildProposedSurface({ els, ffeFt: null, dockDropFt: 4, existAt: cur.existAt, parcelRings: setback.parcelRings, pondRings: [], easementRings: [], opts: { existKey: `h3d:regrade:${ffe}` }, grading: gradingPack(cfg, setback) });
  return s.grid;
}
(async () => {
  const data = QS.get("site") === "chehaw" ? await chehaw() : await synthetic();
  REG = data;
  createRoot(document.getElementById("root")).render(<App data={data} />);
  window.__ready = true;
  if (QS.get("open") === "1") setTimeout(() => window.__h && window.__h.open(), 50);
})();
