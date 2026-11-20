// PERF (the Site Planner speed round, NEW-2): the drain-lattice GEOMETRY cache in proposedSurface.js must not change one number.
// The FFE search builds ONE geometry ~20 times at different finish elevations; the first build records which region each drain
// node is in, the nearest point on every graded outline, the limit's nearest edge + the ground there, and each outlet's height,
// and later builds read them back. This test builds the owner's real Chehaw layouts (the cross-dock and Concept A) in both limit
// modes, over a run of FFEs that reuses the cache, and requires every cell, every drain-lattice value, the limit and the totals to
// be IDENTICAL to builds with the cache switched off — and requires that the cache was really HIT (a run that never read the
// cache would compare the slow path against itself and prove nothing).
import { describe, it, expect, afterAll } from "vitest";
import { buildProposedSurface, __setDrainGeometryCache, __drainGeometryStats, __clearDrainGeometry } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { chehawInputs } from "../ui-audit/lib/chehawSurfaceNode.mjs";

afterAll(() => __setDrainGeometryCache(true));

const snap = (s) => {
  const g = s.grid, L = g.limit;
  return {
    cells: g.cells.map((c) => [c.x, c.y, c.elId, c.propFt ?? null, c.dzFt ?? null, c.clampFt ?? null]),
    cutCf: g.cutCf, fillCf: g.fillCf, area: L.areaAc, reach: L.reachFt, pit: [L.pitFill.nodes, L.pitFill.maxFt, L.pitFill.unreached],
    filled: Array.from(L.drain.filled), bare: Array.from(L.drain.bare), region: Array.from(L.drain.region),
    daylight: g.daylight.map((d) => d.ring.map((p) => [p.x, p.y])),
    probe: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const c = g.cells[Math.floor((g.cells.length * k) / 8)]; const p = g.probe({ x: c.x + 1.3, y: c.y - 0.7 }); return [p.status, p.ft ?? null]; }),
  };
};

describe("the drain-geometry cache changes no number (owner's Chehaw ground)", () => {
  for (const owner of [1, 2]) for (const mode of ["layout", "boundary"]) {
    it(`owner=${owner} ${mode}: every build of an FFE run is identical with the cache on and off, and the cache is really read`, () => {
      const C = chehawInputs({ owner });
      const ffes = [785, 790.3, 796.1, 790.3, 788.7];
      __setDrainGeometryCache(false);
      const off = ffes.map((f, i) => snap(buildProposedSurface(C.inputs(f, mode, `off${i}`))));
      __setDrainGeometryCache(true); __clearDrainGeometry();
      // the same existKey for the whole run — exactly how the FFE search builds (one ground, one geometry, many elevations)
      const on = ffes.map((f) => snap(buildProposedSurface(C.inputs(f, mode, "run"))));
      const st = __drainGeometryStats();
      expect(st.hits).toBeGreaterThanOrEqual(ffes.length - 1);   // the known-good arm: the fast path really ran
      for (let i = 0; i < ffes.length; i++) expect(on[i]).toEqual(off[i]);
    }, 120000);
  }
  it("a different geometry is a different entry (moving one element misses the cache)", () => {
    const C = chehawInputs({ owner: 2 });
    __setDrainGeometryCache(true); __clearDrainGeometry();
    buildProposedSurface(C.inputs(790, "layout", "k"));
    const a = __drainGeometryStats();
    const inp = C.inputs(790, "layout", "k");
    inp.els = inp.els.map((e, i) => (i === 1 ? { ...e, ring: e.ring.map((p) => ({ x: p.x + 5, y: p.y })) } : e));
    buildProposedSurface(inp);
    expect(__drainGeometryStats().misses).toBe(a.misses + 1);
  }, 60000);
});
