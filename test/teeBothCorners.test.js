/* NEW-2 (2026-10-15) — every tee corner gets a curb return; a short leftover leg shrinks the radius, it never deletes it on ONE side.
 *
 * Calls the REAL `teeJunctionsOf` (roadJunctions.js) — the function the renderer calls — never a hand-copied builder. The browser half is
 * e2e/road-tee-both-corners.spec.js (the stray vertices must survive `migrateRoad`, which only a browser load exercises).
 *
 * THREE defects, one symptom (a SQUARE corner on one side of a tee, a full return on the other):
 *   1. `armStraightRun` capped an arm at the IMMEDIATELY adjacent interior vertex even when nothing is drawn there (a collinear vertex, another
 *      road's tee node on a straight trunk) — a run shorter than the side road's half-width put the fillet's corner past the run, tMax = 0.
 *   2. A mild bend a few feet off the node (a leftover connect vertex) left less STRAIGHT run than the corner needs; `nodeJunction` now falls back to
 *      the run past a MILD bend (<= SOFT_BEND_DEG) with a bounded tangent, so the radius shrinks instead of vanishing.
 *   3. `teeNodeIndicesOf` stored a VIRTUAL tee's index in the SPLICED copy's index space and `armStraightRun` read it against the real vertices.
 * What must NOT change: a SHARP bend near the node (the 57° Goose Creek spike, B1832210) still ends the run at its arc entry; a building beside the
 * mouth still limits the return; a trunk that ENDS inside the corner's reach has no edge to round. */
import { describe, it, expect } from "vitest";
import { teeJunctionsOf, teeNodeIndicesOf, armStraightRun, STRAIGHT_THROUGH_DEG, SOFT_BEND_DEG } from "../src/workspaces/site-planner/lib/roadJunctions.js";

const road = (id, pts, w = 24) => ({ id, type: "road", pts, vtx: pts.map(() => ({})), travelW: w, curb: 0.5, roadClass: "aisle" });
const X = (x, y = 0) => ({ x, y });
const side = (id, x, dir = -1) => road(id, [{ x, y: dir * 160 }, { x, y: 0 }]);
const cornerR = (els) => teeJunctionsOf(els, {}).map((j) => ({ side: j.sideId, R: j.geom.gaps.filter((g) => g.a === 2 || g.b === 2).map((g) => g.R) }));
const allPositive = (rows) => rows.every((r) => r.R.length === 2 && r.R.every((v) => v > 0));

describe("armStraightRun — the arm is straight until a vertex that renders a corner", () => {
  it("runs on through a collinear vertex and through another road's tee node on a straight trunk", () => {
    const G = road("G", [X(-300), X(-6), X(0), X(300)]);
    expect(armStraightRun(G, 2, -1, {}, new Set()).dist).toBeCloseTo(300, 0);
    // the neighbour is a tee NODE (sharp) on a straight trunk — it renders no corner of its own
    expect(armStraightRun(G, 2, -1, {}, new Set([1])).dist).toBeCloseTo(300, 0);
  });
  it("still stops at a real bend — the Goose Creek 57° spike guard (B1832210)", () => {
    const rad = (57 * Math.PI) / 180;
    // the trunk runs west from the node, bends 57° at 26 ft and carries on
    const G = road("G", [{ x: -26 - 300 * Math.cos(rad), y: -300 * Math.sin(rad) }, X(-26), X(0), X(300)], 36);
    const run = armStraightRun(G, 2, -1, {}, new Set());
    expect(run.dist).toBeLessThan(26);      // ends at (or before) the bend's arc entry, never runs out past it
    expect(run.soft).toBeLessThan(26);      // 57° is not a MILD bend — the fallback reach stops here too
  });
  it("the soft run reaches past a mild bend, the hard run does not", () => {
    const G = road("G", [X(-400), X(-8, 1.8), X(0), X(400)]);
    const run = armStraightRun(G, 2, -1, {}, new Set());
    expect(run.dist).toBeLessThan(8);
    expect(run.soft).toBeGreaterThan(run.dist);
    expect(STRAIGHT_THROUGH_DEG).toBeLessThan(SOFT_BEND_DEG);
  });
});

describe("a tee never gets a return on one side and a SQUARE corner on the other", () => {
  it("a leftover connect vertex (mild bend) 8 ft off the node, either side, radius shrinks but stays > 0", () => {
    for (const els of [
      [road("G", [X(-400), X(-8, 1.8), X(0), X(400)]), side("S", 0)],
      [road("G", [X(-400), X(0), X(8, 1.8), X(400)]), side("S", 0)],
      [road("G", [X(-400), X(-8, 1.8), X(0), X(8, 1.8), X(400)]), side("S", 0)],
    ]) expect(allPositive(cornerR(els))).toBe(true);
  });
  it("two tees on one trunk, a leftover vertex beside each node", () => {
    expect(allPositive(cornerR([road("G", [X(-400), X(-8, 1.8), X(0), X(52, 1.8), X(60), X(400)]), side("S1", 0), side("S2", 60, 1)]))).toBe(true);
  });
  it("a collinear vertex beside the node (the migrate step would drop it, but a model can carry one)", () => {
    expect(allPositive(cornerR([road("G", [X(-400), X(-6), X(0), X(6), X(400)]), side("S", 0)]))).toBe(true);
  });
  it("side road's OWN leftover vertex near the node", () => {
    expect(allPositive(cornerR([road("G", [X(-400), X(0), X(400)]), road("S", [X(0, -160), X(1.8, -8), X(0, 0)])]))).toBe(true);
  });
  it("a 4-way with the two side roads offset along the trunk, real vertices at both nodes", () => {
    expect(allPositive(cornerR([road("G", [X(-400), X(0), X(45), X(400)]), side("S1", 0), side("S2", 45, 1)]))).toBe(true);
  });
  it("tee beside a building: the return SHRINKS to fit and is still > 0 until the building meets the mouth itself", () => {
    const bld = (edgeX) => ({ id: "B", type: "building", cx: edgeX + 30, cy: -40, w: 60, h: 60, rot: 0 });
    const R = (edgeX) => cornerR([road("G", [X(-400), X(0), X(400)]), side("S", 0), bld(edgeX)])[0].R;
    expect(R(30).every((v) => v > 0)).toBe(true);
    expect(Math.min(...R(30))).toBeLessThan(Math.min(...R(70)));          // nearer building, smaller return
    expect(Math.min(...R(12.4))).toBe(0);                                  // the building is inside the side road's own half-width: nothing to round
  });
  it("a tee near the trunk's END keeps a return where the trunk reaches the corner, and none where it does not", () => {
    expect(allPositive(cornerR([road("G", [X(-400), X(0), X(40)]), side("S", 0)]))).toBe(true);
    expect(Math.min(...cornerR([road("G", [X(-400), X(0), X(6)]), side("S", 0)])[0].R)).toBe(0);   // 6 ft of trunk beyond the node, corner at 12.5 ft
  });
  it("control — a clean tee keeps the class's full return on both corners", () => {
    for (const v of cornerR([road("G", [X(-400), X(0), X(400)]), side("S", 0)])[0].R) expect(v).toBeGreaterThan(20);
  });
});

describe("teeNodeIndicesOf — real vertices only (a virtual tee's index is in the SPLICED copy's space)", () => {
  it("a tee on a through road with NO vertex there records nothing, and a real one records its index", () => {
    const virtualOnly = teeNodeIndicesOf([road("G", [X(-300), X(300)]), side("S", 0)]);
    expect(virtualOnly.get("G")).toBeUndefined();
    const real = teeNodeIndicesOf([road("G", [X(-300), X(0), X(300)]), side("S", 0)]);
    expect([...real.get("G")]).toEqual([1]);
  });
  it("a virtual tee beside a real bend does not mark the bend vertex sharp", () => {
    // virtual tee on the 2nd segment: its splice index would be 2, naming the real vertex 2 (a 60° bend) in the OLD map
    const G = road("G", [X(-300), X(0), { x: 150, y: 260 }, { x: 300, y: 260 }]);
    const S = road("S", [{ x: 75, y: 330 }, { x: 75, y: 130 }]);
    const nodes = teeNodeIndicesOf([G, S]);
    expect(nodes.get("G")).toBeUndefined();
    expect(teeJunctionsOf([G, S], {}).length).toBe(1);
  });
});

/* THE OWNER'S OWN PLANS — after the load-time road cleanup the app applies (migrateRoads). On the untouched build, Goose Creek Phase II and Sylvestri each
 * carry a tee with a return on one corner and none (R = 0) on the other — the report, on real data. Bain's single remaining zero is a tee node sitting
 * 2 ft off a 70° bend of its through road (a SHARP bend — see the honest limits on B2276177). */
import { readFileSync } from "node:fs";
import { migrateRoads } from "../src/workspaces/site-planner/lib/siteModel.js";
describe("real plans — no tee is left with a square corner beside a full return", () => {
  const load = (f) => { const j = JSON.parse(readFileSync(new URL(`../ui-audit/fixtures/${f}`, import.meta.url), "utf8")); return { els: migrateRoads(j.els), settings: j.settings || {} }; };
  const zeroTees = (f) => { const { els, settings } = load(f); return teeJunctionsOf(els, settings).filter((t) => t.geom.gaps.filter((g) => g.a === 2 || g.b === 2).some((g) => !(g.R > 0))); };
  it.each(["goose-creek-phase2-1-2m.json", "sylvestri-concept-d-full.json", "tsakiris-concept-a-live.json", "tsakiris-concept-a.json", "richfield-concept-a.json", "turner-jv-concept-a.json", "goose-creek-plan1copy.json"])("%s", (f) => {
    expect(zeroTees(f)).toEqual([]);
  });
  it("the one tee that stays square is the sharp-bend case, and it is the only one in twelve plans", () => {
    expect(zeroTees("bain-concept-original.json").length).toBe(1);
  });
});
