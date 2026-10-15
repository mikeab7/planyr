/* NEW-1 (2026-10-15) — a junction's paved surface has no line between the road body and its curve.
 *
 * Pure half (the browser half is e2e/road-junction-deco-seam.spec.js, which asks the app's own geometry through `__plannerRoadNet`):
 *   • `junctionMouthCuts` — where each road's decoration (band fills, lane seams, texture) must END at a junction: the side road at the throat (where its
 *     returns leave its edges), the through road across the throat span. Everything left is strip ∖ cuts, so its only edges are the pavement's own
 *     outline, lateral cuts and the road's end caps.
 *   • `roadNetSteps(...).decoDomains` — those cuts applied to the strip rings, through the real dissolve.
 *   • the face-of-curb stripe CONTINUES around a tee's returns (`teeJunctionCurbStripes`) and, on a drive, sits a curb-width INSIDE the pavement
 *     (`insetArcTowardCorner`) — it was the shorter offset, which on a return is the one in the grass.
 * Runs the real functions (`teeJunctionsOf`, `driveJunctionsOf`, `roadNetSteps`) — no hand-copied math. */
import { describe, it, expect } from "vitest";
import { teeJunctionsOf, driveJunctionsOf } from "../src/workspaces/site-planner/lib/roadJunctions.js";
import { junctionMouthCuts } from "../src/workspaces/site-planner/lib/roadDeco.js";
import { roadNetInputs, roadNetSteps, driveSteps } from "../src/workspaces/site-planner/lib/roadNetBuild.js";
import { insetArcTowardCorner, insetArcTowardCenter, teeJunctionCurbStripes, driveJunctionCurbStripes } from "../src/workspaces/site-planner/lib/siteGeometry.js";

const road = (id, pts, w = 34) => ({ id, type: "road", pts, vtx: pts.map(() => ({})), travelW: w, curb: 0.5, roadClass: "local" });
const P = (x, y) => ({ x, y });
const pad = { id: "PAD", type: "parking", cx: 0, cy: 100, w: 400, h: 200, rot: 0 };
const net = async (els) => driveSteps(roadNetSteps(await roadNetInputs(els, {})));
const bbox = (ring) => ({ x0: Math.min(...ring.map((p) => p.x)), x1: Math.max(...ring.map((p) => p.x)), y0: Math.min(...ring.map((p) => p.y)), y1: Math.max(...ring.map((p) => p.y)) });

describe("junctionMouthCuts", () => {
  const els = [road("G", [P(-300, 0), P(0, 0), P(300, 0)]), road("S", [P(0, -250), P(0, 0)])];
  const tees = teeJunctionsOf(els, {});
  const cuts = junctionMouthCuts({ teeJunctions: tees, driveJunctions: [], byId: new Map(els.map((e) => [e.id, e])) });

  it("cuts the SIDE road's stripes at the throat: ONE half-width bar per return, each ending exactly at ITS OWN tangent", () => {
    const sides = cuts.side.get("S");
    expect(sides.length).toBe(2);                                          // one per return — not one bar ending at the farther of the two
    const tangentDist = tees[0].geom.gaps.filter((g) => g.a === 2 || g.b === 2).map((g) => Math.abs((g.a === 2 ? g.tanA : g.tanB).y));
    sides.forEach((cut) => {
      const b = bbox(cut);
      expect(tangentDist.some((d) => Math.abs(Math.abs(b.y0) - d) < 1e-6), "the bar reaches its own tangent point, no further").toBe(true);
    });
    // each bar covers ONE side of the road (its own return's), so it can never cut the other side's stripe
    expect(sides.map((c) => Math.sign(bbox(c).x0 + bbox(c).x1)).sort()).toEqual([-1, 1]);
    // the full-width cut the band fills honour is unchanged: wider than the strip both ways, reaching the farther tangent
    const [whole] = cuts.all.get("S");
    expect(bbox(whole).x0).toBeLessThan(-17.5); expect(bbox(whole).x1).toBeGreaterThan(17.5);
    expect(Math.abs(bbox(whole).y0)).toBeGreaterThanOrEqual(Math.max(...tangentDist) - 1e-6);
  });
  it("cuts the THROUGH road across the throat span only, full width", () => {
    const [cut] = cuts.all.get("G");
    const b = bbox(cut), [t1, t2] = tees[0].geom.throughTangents;
    expect(b.x0).toBeCloseTo(Math.min(t1.x, t2.x), 3); expect(b.x1).toBeCloseTo(Math.max(t1.x, t2.x), 3);
    expect(b.y1).toBeGreaterThan(17.5 - 1e-6); expect(b.y0).toBeLessThan(-17.5);   // from past the near edge to past the far edge
    expect(cuts.side.get("G")).toBeUndefined();                           // only the side road's own cut trims ITS stripes — a through road's far stripe runs on
  });
  it("a drive cuts its road from the pad face to the return tangents", () => {
    const els2 = [pad, road("S", [P(0, -300), P(0, 10)])];
    const dj = driveJunctionsOf(els2, {});
    const c = junctionMouthCuts({ teeJunctions: [], driveJunctions: dj, byId: new Map(els2.map((e) => [e.id, e])) });
    const b = bbox(c.all.get("S")[0]);
    expect(b.y1).toBeGreaterThanOrEqual(0); expect(b.y0).toBeLessThanOrEqual(-24 + 1e-6);   // the return leaves the edge 24 ft up
  });
  it("ignores a junction whose road is not in the network (hidden)", () => {
    const c = junctionMouthCuts({ teeJunctions: tees, driveJunctions: [], byId: new Map([["G", els[0]]]) });
    expect(c.all.has("S")).toBe(false);
  });
});

describe("decoDomains — the cuts applied to the strip rings", () => {
  it("a tee gives BOTH roads a domain; the side road's ends at the throat, the through road's has a gap across the throat", async () => {
    const n = await net([road("G", [P(-300, 0), P(0, 0), P(300, 0)]), road("S", [P(0, -250), P(0, 0)])]);
    expect([...n.decoDomains.keys()].sort()).toEqual(["G", "S"]);
    const s = bbox(n.decoDomains.get("S")[0]);
    const tanY = Math.max(...teeJunctionsOf([road("G", [P(-300, 0), P(0, 0), P(300, 0)]), road("S", [P(0, -250), P(0, 0)])], {})[0].geom.gaps.filter((g) => g.a === 2 || g.b === 2).map((g) => Math.abs((g.a === 2 ? g.tanA : g.tanB).y)));
    expect(s.y1).toBeCloseTo(-tanY, 0);                                   // ends at the throat — where the returns leave its edges — nowhere near the node
    const g = n.decoDomains.get("G");
    expect(g.length).toBe(2);                                             // two pieces — the through road's decoration opens across the mouth
  });
  it("a drive's domain stops short of the pad; a road with no junction has none", async () => {
    const n = await net([pad, road("S", [P(0, -300), P(0, 10)]), road("L", [P(500, -300), P(500, -100)])]);
    expect(bbox(n.decoDomains.get("S")[0]).y1).toBeLessThan(-20);
    expect(n.decoDomains.has("L")).toBe(false);
  });
  it("a lone road and a weld have no throat to cut", async () => {
    const n = await net([road("A", [P(-300, 0), P(0, 0)]), road("B", [P(0, 0), P(300, 0)])]);
    expect(n.decoDomains.size).toBe(0);
  });
});

describe("the face-of-curb stripe around a return", () => {
  const arc = [P(10, 0), P(9.2, 3), P(7.6, 5.7), P(5.3, 7.9), P(2.5, 9.4), P(0, 10)];   // a quarter-circle-ish fillet; the corner (pavement side) is at (10,10)?
  it("insetArcTowardCorner picks the offset on the PAVEMENT side (nearer the corner); insetArcTowardCenter picked the other", () => {
    // fillet circle centre (0,0) radius 10 — the grass side; the corner where the two straight edges meet is at (10,10), outside the circle
    const circle = Array.from({ length: 13 }, (_, k) => { const a = (k / 12) * (Math.PI / 2); return P(10 * Math.cos(a), 10 * Math.sin(a)); });
    const corner = P(10, 10);
    const toCorner = insetArcTowardCorner(circle, corner, 0.5), toCenter = insetArcTowardCenter(circle, 0.5);
    const r = (l) => Math.hypot(l[6].x, l[6].y);
    expect(r(toCorner)).toBeCloseTo(10.5, 1);   // away from the centre = INSIDE the pavement
    expect(r(toCenter)).toBeCloseTo(9.5, 1);    // the old choice, in the grass
    expect(insetArcTowardCorner([P(0, 0)], corner, 0.5)).toBeNull();
    expect(insetArcTowardCorner(circle, null, 0.5)).toBeNull();
    expect(arc.length).toBeGreaterThan(1);
  });
  it("a tee gives the SIDE road one stripe per return, a curb-width inside the pavement, oriented side-road end first and starting EXACTLY on the straight stripe", () => {
    const els = [road("G", [P(-300, 0), P(0, 0), P(300, 0)]), road("S", [P(0, -250), P(0, 0)])];
    const tees = teeJunctionsOf(els, {});
    const stripes = teeJunctionCurbStripes(tees, 0.5);
    expect(stripes.length).toBe(2);
    for (const l of stripes) {
      const mid = l[Math.floor(l.length / 2)];
      const g = tees[0].geom.gaps.find((x) => x.arc.some((p) => Math.hypot(p.x - mid.x, p.y - mid.y) < 1.5));
      const toCorner = (p) => Math.hypot(p.x - g.corner.x, p.y - g.corner.y);
      const arcMid = g.arc[Math.floor(g.arc.length / 2)];
      expect(toCorner(mid)).toBeLessThan(toCorner(arcMid));                 // nearer the corner than the arc itself = inside the pavement
      // no overlap lengthening any more: the first point is the side tangent pushed a curb-width inside the side road's edge (x = ±17.5 → stripe x = ±17)
      const sideTan = g.a === 2 ? g.tanA : g.tanB;
      expect(Math.hypot(l[0].x - sideTan.x, l[0].y - sideTan.y)).toBeCloseTo(0.5, 6);
      expect(Math.abs(l[0].x)).toBeCloseTo(17, 6);
      // and the far end is the through road's stripe line (y = -17) at the through tangent's own x
      const thruTan = g.a === 2 ? g.tanB : g.tanA, last = l[l.length - 1];
      expect(last.y).toBeCloseTo(-17, 6); expect(last.x).toBeCloseTo(thruTan.x, 6);
    }
  });
  it("a tee with no return (R = 0) or an empty list yields nothing", () => {
    expect(teeJunctionCurbStripes([], 0.5)).toEqual([]);
    expect(teeJunctionCurbStripes([{ geom: { gaps: [{ a: 0, b: 2, R: 0, arc: [P(0, 0)], corner: P(0, 0) }] } }], 0.5)).toEqual([]);
  });
  it("a drive's stripes sit on the pavement side when the junction carries its corners, and keep the old choice when it does not", () => {
    const dj = driveJunctionsOf([pad, road("S", [P(0, -300), P(0, 10)])], {});
    const st = driveJunctionCurbStripes(dj, 0.5);
    dj[0].geom.returns.forEach((arc, k) => {
      const c = dj[0].geom.corners[k], m = arc[Math.floor(arc.length / 2)], sm = st[k][Math.floor(st[k].length / 2)];
      expect(Math.hypot(sm.x - c.x, sm.y - c.y)).toBeLessThan(Math.hypot(m.x - c.x, m.y - c.y));
    });
  });
});

import { stripeRunsNearOutline, distToRings } from "../src/workspaces/site-planner/lib/roadDeco.js";
import { readFileSync } from "node:fs";
import { migrateRoads } from "../src/workspaces/site-planner/lib/siteModel.js";
describe("stripeRunsNearOutline — a face-of-curb stripe belongs a curb-width inside the pavement's outline", () => {
  const square = [P(0, 0), P(100, 0), P(100, 100), P(0, 100)];
  it("keeps a stripe hugging the outline whole; drops the part that runs through the interior; splits a stripe that leaves and returns", () => {
    expect(distToRings(P(50, 0.5), [square])).toBeCloseTo(0.5, 6);
    const whole = stripeRunsNearOutline([P(10, 0.5), P(90, 0.5)], [square], 0.5);
    expect(whole.length).toBe(1);
    expect(whole[0][0]).toEqual(P(10, 0.5)); expect(whole[0][whole[0].length - 1]).toEqual(P(90, 0.5));
    expect(stripeRunsNearOutline([P(10, 40), P(90, 40)], [square], 0.5)).toEqual([]);
    const runs = stripeRunsNearOutline([P(10, 0.5), P(50, 0.5), P(50, 40), P(60, 40), P(60, 0.5), P(90, 0.5)], [square], 0.5);
    expect(runs.length).toBe(2);
  });
  it("trims a straight lengthening that leaves a curving road's pavement", () => {
    const strip = [P(0, 0), P(100, 0), P(100, 30), P(0, 30)];
    // an arc end at (100, 0.5) lengthened straight along +x would stay inside only while the outline does: here the outline turns up at x = 100
    const runs = stripeRunsNearOutline([P(80, 0.5), P(100, 0.5), P(106.5, 0.5)], [strip], 0.5);
    expect(runs.length).toBe(1);
    expect(runs[0][runs[0].length - 1].x).toBeLessThanOrEqual(101.1);   // stops where the outline's own turn leaves it more than a curb-width + tolerance away
  });
  it("returns the line untouched when there is no outline to measure against", () => {
    expect(stripeRunsNearOutline([P(0, 0), P(1, 1)], [], 0.5)).toEqual([[P(0, 0), P(1, 1)]]);
    expect(stripeRunsNearOutline(null, [square], 0.5)).toEqual([]);
  });
});

describe("real plans — the face-of-curb stripes stay at the pavement's edge", () => {
  const interior = async (f, tolFt = 1.5) => {
    const j = JSON.parse(readFileSync(new URL(`../ui-audit/fixtures/${f}`, import.meta.url), "utf8"));
    const els = migrateRoads(j.els);
    const n = driveSteps(roadNetSteps(await roadNetInputs(els, j.settings || {})));
    const rings = n.regions.flatMap((q) => [q.region.outer, ...q.region.holes]);
    let bad = 0;
    for (const [, lines] of n.stripes) for (const l of lines) for (let i = 0; i + 1 < l.length; i++) {
      const a = l[i], b = l[i + 1], m = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
      for (let k = 0; k <= m; k++) if (distToRings(P(a.x + ((b.x - a.x) * k) / m, a.y + ((b.y - a.y) * k) / m), rings) > tolFt) bad++;
    }
    return bad;
  };
  // measured on the untouched build: goose-creek-phase2 74 · plan1copy 26 · richfield 50 · sylvestri 7 · tsakiris 16 · turner 75 (sample points off the outline)
  it.each(["goose-creek-phase2-1-2m.json", "goose-creek-plan1copy.json", "sylvestri-concept-d-full.json", "tsakiris-concept-a-live.json", "tsakiris-concept-a.json"])("%s: no stripe point runs through the interior", async (f) => {
    expect(await interior(f)).toBe(0);
  });
  it("richfield: at most the one degenerate point it ends with (was 50); turner: only its out-and-back loop road remains (was 75)", async () => {
    expect(await interior("richfield-concept-a.json")).toBeLessThanOrEqual(2);
    expect(await interior("turner-jv-concept-a.json")).toBeLessThanOrEqual(25);
  });
});
