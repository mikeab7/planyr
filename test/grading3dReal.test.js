// NEW-1 (2026-11-11) — the 3D viewer's model, built through the APP'S OWN PATH on the owner's REAL Chehaw Rd ground and Concept A:
// gradingCfg → gradingPack → buildProposedSurface (the engine) → buildModelSteps (the viewer's builders). No new grading math: the 3D colours and
// heights must AGREE with the numbers the 2D picture and the earthwork already show — measured against the engine's own cells, not against the
// builders' own idea of the answer.
import { describe, it, expect } from "vitest";
import { chehawInputs } from "../ui-audit/lib/chehawSurfaceNode.mjs";
import { buildProposedSurface, sampleProposedAt } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { gradingCfg, gradingPack } from "../src/workspaces/site-planner/lib/gradingBase.js";
import { buildModelSteps } from "../src/workspaces/site-planner/lib/grading3d/buildModel.js";
import { fieldAt, pointInRegions } from "../src/workspaces/site-planner/lib/grading3d/field.js";
import { buildSlice, lineIntervals } from "../src/workspaces/site-planner/lib/grading3d/meshBuild.js";
import { runChunked } from "../src/workspaces/site-planner/lib/runChunked.js";

const FFE = 793;
const { inputs, existAt } = chehawInputs({ owner: 2 });
const base = inputs(FFE, "layout", "g3d");
const cfg = gradingCfg({ enabled: true });
const setback = { parcelRings: base.parcelRings, holes: [], rings: base.parcelRings };
base.grading = gradingPack(cfg, setback);
const surface = buildProposedSurface(base);
const grid = surface.grid;
const run = (g) => { let r = g.next(); while (!r.done) r = g.next(); return r.value; };
const model = run(buildModelSteps({ grid, existAt, parcelRings: base.parcelRings, els: base.els }));

describe("the 3D model on the real Chehaw ground (Concept A through the app's own path)", () => {
  it("is built: the property as a solid, side faces, the ghost, ONE building outline", () => {
    expect(model).not.toBeNull();
    expect(model.top.triangleCount).toBeGreaterThan(30000);
    expect(model.walls.triangleCount).toBeGreaterThan(1000);
    expect(model.ghost.segmentCount).toBeGreaterThan(1000);
    expect(model.footprints.length).toBe(1);                         // Concept A is one building
    expect(model.outline.triangleCount).toBeGreaterThan(100);
  });
  it("has NO hole in the ground inside the property (every node the DEM and the engine know is a height)", () => {
    const f = model.field; let nan = 0, n = 0;
    for (let k = 0; k < f.prop.length; k++) if (f.inside[k]) { n++; if (!Number.isFinite(f.prop[k]) || !Number.isFinite(f.exist[k])) nan++; }
    expect(n).toBeGreaterThan(20000); expect(nan).toBe(0);
  });
  it("AGREES with the engine's own cut / fill cells: the lattice's depth equals the earthwork cell's, cell by cell (median), and the extremes match", () => {
    const f = model.field; const diffs = []; let maxFill = 0, maxCut = 0, cmpFill = 0, cmpCut = 0;
    for (const c of grid.cells) {
      if (c.dzFt == null || !Number.isFinite(c.dzFt) || c.x == null) continue;
      const d = fieldAt(f, "dz", c.x, c.y);
      if (!Number.isFinite(d)) continue;
      diffs.push(Math.abs(d - c.dzFt));
      if (c.dzFt > maxFill) maxFill = c.dzFt; if (-c.dzFt > maxCut) maxCut = -c.dzFt;
      if (d > cmpFill) cmpFill = d; if (-d > cmpCut) cmpCut = -d;
    }
    expect(diffs.length).toBeGreaterThan(500);
    diffs.sort((a, b) => a - b);
    expect(diffs[Math.floor(diffs.length / 2)]).toBeLessThan(0.6);          // the median cell: within 0.6 ft of what the 2D cell says
    expect(diffs[Math.floor(diffs.length * 0.9)]).toBeLessThan(3);
    expect(Math.abs(cmpFill - maxFill)).toBeLessThan(4); expect(Math.abs(cmpCut - maxCut)).toBeLessThan(4);
  });
  it("the pad is FLAT at the finish floor under the building, read through the planner's own sampler", () => {
    const c = model.footprints[0].centre;
    const r = sampleProposedAt(grid, c, existAt);
    expect(r.status).toBe("value"); expect(r.ft).toBeCloseTo(FFE, 1);
    expect(fieldAt(model.field, "prop", c.x, c.y)).toBeCloseTo(FFE, 1);
  });
  it("the default section lies in the property, through the building, and reads the SAME heights the sampler does (exact, not lattice)", () => {
    const f = model.field, line = model.defaultLine;
    expect(lineIntervals(line, model.regions).length).toBeGreaterThan(0);
    const s = buildSlice(f, model.regions, line, model.baseZ, { sample: model.sample });
    expect(s.faces.triangleCount).toBeGreaterThan(200);
    let checked = 0;
    for (let v = 0; v < s.proposed.positions.length; v += 60) {              // spot-check a sample of segments against the engine at the same plan point
      const x = s.proposed.positions[v], y = s.proposed.positions[v + 2], z = s.proposed.positions[v + 1];
      const r = sampleProposedAt(grid, { x, y: y }, existAt);
      const want = r && r.status === "value" ? r.ft : existAt({ x, y });
      expect(Math.abs(z - want)).toBeLessThan(0.01); checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });
  it("is built in slices a page can live with: the generator yields many times and finishes the SAME model as a drain", async () => {
    let yields = 0;
    const g = buildModelSteps({ grid, existAt, parcelRings: base.parcelRings, els: base.els });
    let r = g.next(); while (!r.done) { yields++; r = g.next(); }
    expect(yields).toBeGreaterThan(300);                                     // one per lattice row, many times over
    const viaChunked = await runChunked(buildModelSteps({ grid, existAt, parcelRings: base.parcelRings, els: base.els }));
    expect(viaChunked.top.triangleCount).toBe(model.top.triangleCount);
  });
  it("a plan with no ground (no DEM) builds nothing — never a made-up height", () => {
    const none = run(buildModelSteps({ grid, existAt: () => null, parcelRings: base.parcelRings, els: base.els }));
    expect(none).toBeNull();
  });
  it("property points are inside, ground past the property is not part of the model", () => {
    expect(pointInRegions(model.regions, model.footprints[0].centre.x, model.footprints[0].centre.y)).toBe(true);
    expect(pointInRegions(model.regions, 1e6, 1e6)).toBe(false);
  });
});
