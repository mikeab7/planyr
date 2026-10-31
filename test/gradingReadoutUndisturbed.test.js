// NEW-1 (B2585313 ×2, owner live check 2026-10-31, build c04ffbd, Concept A, "Around the layout", 50-ft NW view): the cursor chip read
// "Exist ≈800.7 · Prop —" (and 808.7, 795.7) at three points on the white paper with the grading picture fully painted, and NO
// `grading-readout-dash` row arrived. Measured here on the real Concept A fixture: the three points sit 150–530 ft PAST the layout
// limit — inside the property, beyond the daylight line, where the grading leaves the ground alone — so the surface answered "outside",
// and the instrument stayed silent because it only spoke for points inside the limit's regions. The round-10 guard sampled ONLY inside
// the limit (WRONG-CASE). Red on main: every owner point returned { status: "none", reason: "outside" }.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const events = [];
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: (kind, msg, extra) => { events.push({ kind, msg, extra }); } }));

const { decodeGrid } = await import("../src/workspaces/site-planner/lib/lercGrid.js");
const { lngLatToFeet, feetToLatLngPair } = await import("../src/workspaces/site-planner/lib/mapLock.js");
const { sampleAtLatLng } = await import("../src/workspaces/site-planner/lib/demGrid.js");
const { buildProposedSurface, sampleProposedAt } = await import("../src/workspaces/site-planner/lib/proposedSurface.js");
const { pointInRegions } = await import("../src/workspaces/site-planner/lib/gradingLimit.js");
const { gradingCfg, gradingSetback, gradingPack, hostIdMap } = await import("../src/workspaces/site-planner/lib/gradingBase.js");
const { groundReadout } = await import("../src/workspaces/site-planner/lib/groundReadout.js");
const RD = await import("../src/workspaces/site-planner/lib/readoutDash.js");
const { CHEHAW_CONCEPT_A_ROWS, rowRing, OWNER_ORIGIN } = await import("../ui-audit/lib/chehawCrossDock.mjs");

const F = new URL("./fixtures/chehaw-218-02007", import.meta.url).pathname;
const pj = JSON.parse(readFileSync(F + ".parcel.json", "utf8"));
const ll = pj.ringLngLat.slice(0, -1);
const lat0 = ll.reduce((a, p) => a + p[1], 0) / ll.length, lon0 = ll.reduce((a, p) => a + p[0], 0) / ll.length;
const ring = ll.map(([lo, la]) => lngLatToFeet(lo, la, lon0, lat0));
const req = JSON.parse(readFileSync(F + ".req.json", "utf8"));
const dem = decodeGrid(new Uint8Array(readFileSync(F + ".lerc")).buffer, req);
const existAt = (pt) => { const [la, lo] = feetToLatLngPair(pt, lat0, lon0); return sampleAtLatLng(dem, req, la, lo); };
const o = lngLatToFeet(OWNER_ORIGIN.lon, OWNER_ORIGIN.lat, lon0, lat0);
const host = CHEHAW_CONCEPT_A_ROWS[0]; const hc = { x: host.cx + o.x, y: host.cy + o.y };
const els = CHEHAW_CONCEPT_A_ROWS.filter((e) => ["building", "paving", "parking", "trailer"].includes(e.type)).map((e) => ({
  id: e.id, type: e.type, ring: rowRing(e).map((p) => ({ x: p.x + o.x, y: p.y + o.y })), ...(e.truckCourt || e.forCourt ? { dockStack: hc } : {}) }));
const hosts = hostIdMap(els);
const setback = gradingSetback([{ id: "pc", points: ring, active: true }], 25);
const cache = new Map();
const build = (FFE, mode) => {
  const k = `${FFE}|${mode}`; if (cache.has(k)) return cache.get(k);
  const cfg = gradingCfg({ enabled: true, limitMode: mode, layers: { cutfill: true, contours: true } });
  const sf = buildProposedSurface({ els: els.map((e) => ({ id: e.id, type: e.type, ring: e.ring, dockStack: e.dockStack || null, accessible: false, slopeOverridePct: null, padElevFt: e.type === "building" ? FFE : null, ...(e.type !== "building" ? { hostId: hosts.get(e.id) ?? null } : {}) })),
    ffeFt: null, dockDropFt: 4, existAt, parcelRings: setback.parcelRings, pondRings: [], easementRings: [], opts: { existKey: `u:${mode}:${FFE}` }, grading: gradingPack(cfg, setback) });
  cache.set(k, sf); return sf;
};
// the owner's three chip readings, verbatim (lat, lon, the chip's "Exist")
const OWNER = [[33.248806, -84.165625, 800.7], [33.248866, -84.166343, 808.7], [33.248566, -84.165123, 795.7]];
const ptOf = (la, lo) => lngLatToFeet(lo, la, lon0, lat0);

beforeEach(() => { events.length = 0; RD.clearReadoutDashMemo(); });

describe("the owner's three points (auto FFE 792.8 and typed 793), 'Around the layout'", () => {
  it("the fixture is the owner's ground: Exist agrees with his chip to half a foot at all three", () => {
    for (const [la, lo, ex] of OWNER) expect(Math.abs(existAt(ptOf(la, lo)) - ex)).toBeLessThan(0.5);
  });
  it("each reads a proposed value — the existing grade, undisturbed — and the chip says 'Prop NNN.N · On grade'", () => {
    for (const FFE of [792.8, 793]) {
      const sf = build(FFE, "layout");
      for (const [la, lo] of OWNER) {
        const pt = ptOf(la, lo);
        expect(pointInRegions(pt, sf.grid.limit.limitRegions)).toBe(false);   // the measured fact: past the layout limit
        const r = sampleProposedAt(sf.grid, pt, existAt);
        expect(r.status).toBe("value");
        expect(r.undisturbed).toBe(true);
        expect(r.ft).toBe(existAt(pt));
        const t = groundReadout({ el: { status: "value", ft: existAt(pt) }, prop: r });
        expect(t.text).toMatch(/Prop \d+\.\d ft · On grade/);
        expect(t.title).toMatch(/proposed grade is the existing grade/);
      }
    }
  });
  it("'To the boundary' at the same points is unchanged: the graded surface, never 'undisturbed'", () => {
    for (const [la, lo] of OWNER) {
      const r = sampleProposedAt(build(792.8, "boundary").grid, ptOf(la, lo), existAt);
      expect(r.status).toBe("value");
      expect(r.undisturbed).toBeFalsy();
    }
  });
});

describe("where '—' is still the honest answer, and where nothing changed", () => {
  it("off the property it still says '—'", () => {
    const sf = build(792.8, "layout");
    const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
    const far = { x: Math.min(...xs) - 600, y: Math.min(...ys) - 600 };
    expect(sampleProposedAt(sf.grid, far, existAt).status).toBe("none");
  });
  it("with no ground there (a DEM void) it still says '—'", () => {
    const sf = build(792.8, "layout");
    const pt = ptOf(OWNER[0][0], OWNER[0][1]);
    expect(sampleProposedAt(sf.grid, pt, () => null).status).toBe("none");
  });
  it("inside the limit every point is the graded surface (never relabelled undisturbed), both modes", () => {
    for (const mode of ["layout", "boundary"]) {
      const sf = build(792.8, mode), regs = sf.grid.limit.limitRegions, all = regs.flatMap((r) => r.outer);
      const x0 = Math.min(...all.map((p) => p.x)), x1 = Math.max(...all.map((p) => p.x)), y0 = Math.min(...all.map((p) => p.y)), y1 = Math.max(...all.map((p) => p.y));
      let seed = 5, n = 0, tries = 0; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      while (n < 80 && tries++ < 20000) {
        const pt = { x: x0 + rnd() * (x1 - x0), y: y0 + rnd() * (y1 - y0) };
        if (!pointInRegions(pt, regs)) continue;
        n++;
        const r = sampleProposedAt(sf.grid, pt, existAt);
        expect(r.status).toBe("value"); expect(r.undisturbed).toBeFalsy();
      }
      expect(n).toBe(80);
    }
  });
  it("(d) units: the cursor shape the planner passes ({x,y} plan feet) lands INSIDE the limit regions at the building's own centre", () => {
    const sf = build(792.8, "layout"), b = els.find((e) => e.type === "building");
    const c = { x: b.ring.reduce((a, p) => a + p.x, 0) / b.ring.length, y: b.ring.reduce((a, p) => a + p.y, 0) / b.ring.length };
    expect(pointInRegions(c, sf.grid.limit.limitRegions)).toBe(true);
    const f = RD.readoutDashFacts(sf.grid, c, { status: "value" }, false);
    expect(f.inLimit && f.inBbox).toBe(true);
    expect(f.limitRegionCount).toBeGreaterThan(0);
  });
});

describe("the instrument (readoutDash) — every '—' that could surprise reports itself", () => {
  const sq = (x, y, w) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + w }, { x, y: y + w }];
  // an L-shaped limit: its bbox holds a corner the regions do not
  const L = { limit: { mode: "layout", limitRegions: [{ outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }], holes: [] }] } };
  it("a '—' inside the limit's bounding box but outside its regions is reported (the units check), once per page load", () => {
    const f = RD.noteReadoutDash(L, { x: 80, y: 80 }, { status: "none", reason: "outside" }, false);
    expect(f && f.inLimit).toBe(false); expect(f.inBbox).toBe(true);
    expect(events.length).toBe(1); expect(events[0].kind).toBe("grading-readout-dash"); expect(events[0].msg).toMatch(/BOUNDING BOX/);
    expect(events[0].extra.limitBbox).toEqual([0, 0, 100, 100]); expect(events[0].extra.cursor).toEqual({ x: 80, y: 80 });
    RD.noteReadoutDash(L, { x: 70, y: 70 }, { status: "none", reason: "outside" }, false);
    expect(events.length).toBe(1);
  });
  it("a '—' well outside the bbox (and off a current surface) stays quiet", () => {
    expect(RD.noteReadoutDash(L, { x: 500, y: 500 }, { status: "none", reason: "outside" }, false)).toBeNull();
    expect(events.length).toBe(0);
    expect(RD.regionsBbox([{ outer: sq(5, 5, 10), holes: [] }])).toEqual([5, 5, 15, 15]);
  });
  it("the NO-SURFACE path reports once per page load with the build's state; with grading off it is silent", () => {
    expect(RD.noteReadoutNoSurface({ grOn: false }, { x: 1, y: 2 })).toBeNull();
    const f = RD.noteReadoutNoSurface({ grOn: true, enabled: true, hasBuilt: false, hasKept: false, lastBuildOutcome: "stale", buildSeq: 7, isDragging: false }, { x: 1, y: 2 });
    expect(f.reason).toBe("nosurface"); expect(f.lastBuildOutcome).toBe("stale");
    expect(events.length).toBe(1); expect(events[0].msg).toMatch(/no proposed surface \(build stale\)/);
    RD.noteReadoutNoSurface({ grOn: true }, { x: 3, y: 4 });
    expect(events.length).toBe(1);
  });
});
