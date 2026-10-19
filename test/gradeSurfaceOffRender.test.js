// Problem report 6cea9895 (2026-10-19) — the grading layer (owner-only) built the whole proposed surface SYNCHRONOUSLY IN
// RENDER (~100 ms per build in Node on the owner's 636,916 SF cross-dock; per pointer step while dragging). The planner now
// asks lib/useGradeSurface.js, which builds it off the render path when grading is on and keeps the old render-path memo,
// byte for byte, for every other account (constraint #25). A spy on the engine module proves which is which, through a
// real React render (react-dom/server runs the render body and never an effect).
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";

const calls = { sync: 0, steps: 0 };
vi.mock("../src/workspaces/site-planner/lib/proposedSurface.js", async (orig) => {
  const real = await orig();
  return {
    ...real,
    buildProposedSurface: (a) => { calls.sync++; return real.buildProposedSurface(a); },
    buildProposedSurfaceSteps: function* (a) { calls.steps++; return yield* real.buildProposedSurfaceSteps(a); },
  };
});
const { useGradeSurface, buildSurfaceOffRender } = await import("../src/workspaces/site-planner/lib/useGradeSurface.js");
const { buildProposedSurface } = await import("../src/workspaces/site-planner/lib/proposedSurface.js");

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const inputs = {
  els: [{ id: "b", type: "building", ring: rect(0, 0, 400, 200), padElevFt: 100 }, { id: "c", type: "paving", ring: rect(0, 200, 400, 120), dockStack: { x: 200, y: 100 }, hostId: "b" }],
  ffeFt: null, dockDropFt: 4, existAt: (p) => 98 + 0.01 * p.x, parcelRings: [rect(-300, -300, 1000, 900)], pondRings: [], easementRings: [],
  opts: { existKey: "t", maxCells: 4000 }, grading: { pavementSlopePct: 1.5, slopeRatio: 2, shoulderFt: 5, setbackRings: [rect(-250, -250, 900, 800)] },
};
let seen = null;
function Probe({ offRender }) { seen = useGradeSurface({ inputs, sig: "s1", enabled: true, offRender, isDragging: () => false }); return null; }
beforeEach(() => { calls.sync = 0; calls.steps = 0; seen = null; });

describe("the planner's render path", () => {
  it("grading ON: a render never builds the surface", () => {
    renderToString(React.createElement(Probe, { offRender: true }));
    expect(calls.sync).toBe(0);
    expect(calls.steps).toBe(0);
    expect(seen).toBeNull();               // nothing yet: the build is the effect's job
  });
  it("grading OFF: exactly the old memo — one synchronous build, in render (constraint #25)", () => {
    renderToString(React.createElement(Probe, { offRender: false }));
    expect(calls.sync).toBe(1);
    expect(seen && seen.grid && seen.grid.cells.length).toBeGreaterThan(0);
  });
});

describe("the off-render build", () => {
  it("is the SAME surface the synchronous engine builds", async () => {
    const s = await buildSurfaceOffRender(inputs, {});
    const t = buildProposedSurface(inputs);
    expect(s.surfaceKey).toBe(t.surfaceKey);
    expect(s.grid.cutCf).toBe(t.grid.cutCf);
    expect(s.grid.fillCf).toBe(t.grid.fillCf);
    expect(s.grid.cells.length).toBe(t.grid.cells.length);
  });
  it("waits while a drag is in flight and builds once on release", async () => {
    let dragging = true, sleeps = 0;
    const p = buildSurfaceOffRender(inputs, { isDragging: () => dragging, sleep: async () => { sleeps++; if (sleeps === 3) dragging = false; } });
    const s = await p;
    expect(sleeps).toBe(3);
    expect(calls.steps).toBe(1);
    expect(s && s.grid).toBeTruthy();
  });
  it("a superseded build never publishes", async () => {
    const s = await buildSurfaceOffRender(inputs, { isStale: () => true });
    expect(s).toEqual({ stale: true });
  });
});

describe("source guards", () => {
  const sp = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  it("SitePlanner takes gradeSurface from useGradeSurface, with grading as the off-render switch", () => {
    expect(sp).toMatch(/const gradeSurface = useGradeSurface\(\{[\s\S]{0,300}offRender: grOn/);
    expect(sp).not.toMatch(/useMemo\(\(\) => \{[^}]*buildProposedSurface\(gsInputs\)/);
  });
  it("the FFE bisection is stepped (its surface builds are not one task)", () => {
    const bg = readFileSync(new URL("../src/workspaces/site-planner/lib/buildingGrade.js", import.meta.url), "utf8");
    expect(bg).toMatch(/const sol = yield\* solveBalanceFfeSteps\(/);
    const gc = readFileSync(new URL("../src/workspaces/site-planner/components/GradingController.jsx", import.meta.url), "utf8");
    expect(gc).not.toMatch(/\bbuildProposedSurface\(/);
    expect(gc).not.toMatch(/\brockViolation\(/);
  });
});
