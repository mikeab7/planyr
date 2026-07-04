/* Detention-pond regression against the versioned fixture (B278/B280 harness — real-project-data
 * LIVE-VERIFY class, made deterministic in the sandbox). Runs the pond engine on synthetic
 * known-geometry basins and asserts the contour areas + storage volume match the committed golden,
 * so an offset-engine or interval-selection change surfaces as a diff, not a silent number shift. */
import { describe, it, expect } from "vitest";
import { loadFixture, loadGolden } from "../e2e/fixtures/index.js";
import { pondContours, detentionStorage } from "../src/workspaces/site-planner/lib/pondGeom.js";

const ring = (W, H) => [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const fx = loadFixture("ponds/detention-regression.fixture.json");
const golden = loadGolden("ponds/detention-regression.golden.json");

describe("detention-pond regression fixture", () => {
  for (let i = 0; i < fx.cases.length; i++) {
    const c = fx.cases[i];
    const g = golden.cases[i];
    it(`${c.name}: contour areas + storage volume match the golden`, () => {
      const r = pondContours(ring(c.W, c.H), c.det);
      expect(r.feasible).toBe(g.feasible);
      expect(r.levels.length).toBe(g.levelCount);
      expect(r.levels.some((l) => l.isBottom)).toBe(g.hasBottom);
      expect(r.levels.map((l) => Math.round((l.area + Number.EPSILON) * 100) / 100)).toEqual(g.areas);
      const s = detentionStorage(ring(c.W, c.H), c.det.depth, c.det.freeboard, c.det.slope);
      expect(Math.round((s.vol + Number.EPSILON) * 100) / 100).toBe(g.storageVolumeCuFt);
    });
  }

  it("the infeasible case is loud-but-not-garbage (feasible:false, no bottom, all areas >= 0)", () => {
    const c = fx.cases.find((x) => x.name.startsWith("infeasible"));
    const r = pondContours(ring(c.W, c.H), c.det);
    expect(r.feasible).toBe(false);
    expect(r.levels.some((l) => l.isBottom)).toBe(false);
    expect(r.levels.every((l) => l.area >= 0)).toBe(true);
  });
});
