/* chehawSurfaceNode — the owner's Chehaw ground + a Chehaw layout as buildProposedSurface inputs, in Node (no browser).
 * Shared by the perf round's node bench (ui-audit/bench-grading-surface.mjs) and its exactness guard (test/gradingSurfaceExact).
 * `owner`: 1 = the 636,916 SF cross-dock, 2 = Concept A as of 2026-10-30 — the same rows the grading harness mounts. */
import { readFileSync } from "node:fs";
import { decodeGrid } from "../../src/workspaces/site-planner/lib/lercGrid.js";
import { lngLatToFeet, feetToLatLngPair } from "../../src/workspaces/site-planner/lib/mapLock.js";
import { sampleAtLatLng } from "../../src/workspaces/site-planner/lib/demGrid.js";
import { gradingCfg, gradingSetback, gradingPack, hostIdMap } from "../../src/workspaces/site-planner/lib/gradingBase.js";
import { CHEHAW_CROSS_DOCK_ROWS, CHEHAW_CONCEPT_A_ROWS, rowRing, OWNER_ORIGIN } from "./chehawCrossDock.mjs";

export function chehawInputs({ owner = 2 } = {}) {
  const F = new URL("../../test/fixtures/chehaw-218-02007", import.meta.url).pathname;
  const pj = JSON.parse(readFileSync(F + ".parcel.json", "utf8"));
  const ll = pj.ringLngLat.slice(0, -1);
  const lat0 = ll.reduce((a, p) => a + p[1], 0) / ll.length, lon0 = ll.reduce((a, p) => a + p[0], 0) / ll.length;
  const ring = ll.map(([lo, la]) => lngLatToFeet(lo, la, lon0, lat0));
  let minY = Infinity; for (const p of ring) minY = Math.min(minY, p.y);
  const sb = ring.map((a, i) => { const c = ring[(i + 1) % ring.length]; return (a.y + c.y) / 2 < minY + 400 ? 50 : 25; });
  const req = JSON.parse(readFileSync(F + ".req.json", "utf8"));
  const grid = decodeGrid(new Uint8Array(readFileSync(F + ".lerc")).buffer, req);
  const existAt = (pt) => { const [la, lo] = feetToLatLngPair(pt, lat0, lon0); return sampleAtLatLng(grid, req, la, lo); };
  const ROWS = owner === 2 ? CHEHAW_CONCEPT_A_ROWS : CHEHAW_CROSS_DOCK_ROWS;
  const o = lngLatToFeet(OWNER_ORIGIN.lon, OWNER_ORIGIN.lat, lon0, lat0);
  const host = ROWS[0]; const hc = { x: host.cx + o.x, y: host.cy + o.y };
  const els = ROWS.filter((e) => ["building", "paving", "parking", "trailer"].includes(e.type)).map((e) => ({
    id: e.id, type: e.type, attachedTo: e.attachedTo, truckCourt: !!e.truckCourt, ring: rowRing(e).map((p) => ({ x: p.x + o.x, y: p.y + o.y })), ...(e.truckCourt || e.forCourt ? { dockStack: hc } : {}) }));
  const hosts = hostIdMap(els);
  const setback = gradingSetback([{ id: "pc", points: ring, setbacks: sb, active: true }], 25);
  const inputs = (FFE, mode, tag = "x") => {
    const cfg = gradingCfg({ enabled: true, limitMode: mode, layers: { cutfill: true, contours: true } });
    return {
      els: els.map((e) => ({ id: e.id, type: e.type, ring: e.ring, dockStack: e.dockStack || null, accessible: false, slopeOverridePct: null, padElevFt: e.type === "building" ? FFE : null, ...(e.type !== "building" ? { hostId: hosts.get(e.id) ?? null } : {}) })),
      ffeFt: null, dockDropFt: 4, existAt, parcelRings: setback.parcelRings, pondRings: [], easementRings: [],
      opts: { existKey: `bench:${tag}:${mode}` }, grading: gradingPack(cfg, setback) };
  };
  return { inputs, existAt, els };
}
