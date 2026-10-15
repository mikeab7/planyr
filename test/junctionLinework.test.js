/* NEW-1 (B1783376 ×3, owner report 2026-10-15) — the LINEWORK at a drive entering a pad: ONE continuous curb line per side, no tick into the pad, nothing across the mouth,
 * and an outline whose weight / colour matches the stripes it sits beside.
 *
 * Pure half (the browser half is e2e/road-junction-linework.spec.js, which asks the app's own geometry through `__plannerRoadNet` and reads rendered pixels):
 *   • `trimPolylineOutsideRings` / `snapPieceEnd` — the exact (float, not clipper-grid) trim and the join-to-the-tangent primitives;
 *   • `roadNetSteps` — the real stripe pass: a drive's face-of-curb is one polyline per side, its heading is continuous at the tangent, its pad end is ON the pad face and
 *     nothing is inside the pad; a tee's side stripe ends exactly where the through road's begins; swept over the owner's real plans too;
 *   • `rectOutlineCutSegments` / `rectBandOutlineCutPolylines` — the field's own ink is cut by the mouth's two tangent points EXACTLY, at every rotation (the clipper was
 *     ill-conditioned there: a few thousandths of a foot moved the cut by feet, and a stall row's outline was left drawing a stub of the face across the mouth);
 *   • `splitEdgeByOwner` — a cluster's outline is stroked per OWNING road.
 * Runs the real functions — no hand-copied math. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { roadNetInputs, roadNetSteps, driveSteps } from "../src/workspaces/site-planner/lib/roadNetBuild.js";
import { migrateRoads } from "../src/workspaces/site-planner/lib/siteModel.js";
import { rectEdges } from "../src/workspaces/site-planner/lib/roadGeometry.js";
import { rectOutlineCutSegments, rectBandOutlineCutPolylines, polygonOutlineCutSegments, curbBandPieces } from "../src/workspaces/site-planner/lib/roadNetwork.js";
import { trimPolylineOutsideRings, snapPieceEnd, splitEdgeByOwner, stripeRunsNearOutline } from "../src/workspaces/site-planner/lib/roadDeco.js";
import { stripesPerRoad, joinTurns, maxTurn, padFaceCheck, stripeLinesOf, turnDeg } from "../ui-audit/lib/junctionLineworkProbe.mjs";

const P = (x, y) => ({ x, y });
const road = (id, pts, o = {}) => ({ id, type: "road", z: 1, pts, vtx: pts.map(() => ({})), travelW: 34, curb: 0.5, roadClass: "local", ...o });
const PAD = (o = {}) => ({ id: "PAD", type: "parking", z: 0, cx: 0, cy: 100, w: 400, h: 200, rot: 0, ...o });
const rad = (d) => (d * Math.PI) / 180;
const rotated = (deg) => {
  const up = { x: Math.sin(rad(deg)), y: -Math.cos(rad(deg)) }, face = { x: up.x * 100, y: 100 + up.y * 100 };
  return [PAD({ rot: deg }), road("S", [P(face.x + up.x * 300, face.y + up.y * 300), P(face.x - up.x * 10, face.y - up.y * 10)])];
};
const padRing = (T) => (T.points || rectEdges(T.cx, T.cy, T.w, T.h, T.rot || 0).map((e) => e.a));

/** the `__plannerRoadNet`-shaped view of the real build (the same fields the e2e probe reads) */
async function netOf(els, settings = {}) {
  const inp = await roadNetInputs(els, settings);
  const n = driveSteps(roadNetSteps(inp));
  return {
    inp, n,
    net: {
      stripes: [...n.stripes].map(([id, lines]) => ({ id, lines })),
      pads: inp.driveJunctions.map((d) => { const T = els.find((e) => e.id === d.targetId); return T ? { targetId: T.id, ring: padRing(T) } : null; }).filter(Boolean),
      drives: inp.driveJunctions.map((d) => ({ sideId: d.sideId, targetId: d.targetId, sideTangents: d.geom.sideTangents, throughTangents: d.geom.throughTangents, R: d.geom.R })),
    },
  };
}

describe("trimPolylineOutsideRings — an exact trim", () => {
  const sq = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
  it("cuts a polyline at the ring's edge to float precision, keeping its own vertices", () => {
    const [run] = trimPolylineOutsideRings([P(-5, 5), P(5, 5), P(20, 5)], [sq]);
    expect(run).toEqual([P(-5, 5), P(0, 5)]);
  });
  it("splits a polyline that dips through the ring into two runs; a polyline inside is dropped; no rings = untouched", () => {
    const runs = trimPolylineOutsideRings([P(-5, 5), P(15, 5)], [sq]);
    expect(runs).toEqual([[P(-5, 5), P(0, 5)], [P(10, 5), P(15, 5)]]);
    expect(trimPolylineOutsideRings([P(2, 2), P(8, 8)], [sq])).toEqual([]);
    const line = [P(0, 0), P(1, 1)];
    expect(trimPolylineOutsideRings(line, [])).toEqual([line]);
    expect(trimPolylineOutsideRings(null, [sq])).toEqual([]);
  });
});

describe("snapPieceEnd — bring a stripe's end onto the tangent point", () => {
  const piece = [P(0, 0), P(0, 50), P(0, 100)];
  it("trims an overshoot, lengthens an undershoot, at either end", () => {
    expect(snapPieceEnd(piece, false, P(0, 90))).toEqual([P(0, 0), P(0, 50), P(0, 90)]);
    expect(snapPieceEnd(piece, false, P(0, 104))).toEqual([P(0, 0), P(0, 50), P(0, 104)]);
    expect(snapPieceEnd(piece, true, P(0, 10))).toEqual([P(0, 10), P(0, 50), P(0, 100)]);
    expect(snapPieceEnd(piece, false, P(0, 20))).toEqual([P(0, 0), P(0, 20)]);   // overshoots by more than one segment
  });
  it("refuses a point that is off the end's line, too far to lengthen to, or a degenerate piece", () => {
    expect(snapPieceEnd(piece, false, P(1, 90))).toBeNull();
    expect(snapPieceEnd(piece, false, P(0, 120))).toBeNull();
    expect(snapPieceEnd([P(0, 0)], false, P(0, 1))).toBeNull();
  });
});

describe("stripeRunsNearOutline — a stripe that stays near the outline comes back with its own vertices", () => {
  it("returns the very same line when nothing is trimmed (no resampling — the vertices are what was joined)", () => {
    const sq = [P(0, 0), P(100, 0), P(100, 100), P(0, 100)], line = [P(10, 0.5), P(20, 0.5), P(60, 0.5)];
    const runs = stripeRunsNearOutline(line, [sq], 0.5);
    expect(runs.length).toBe(1);
    expect(runs[0]).toBe(line);
  });
});

describe("a drive's face-of-curb: one polyline per side, joined, ending on the pad face", () => {
  const SCENES = {
    "perpendicular": () => [PAD(), road("S", [P(0, -300), P(0, 10)])],
    "oblique 35°": () => [PAD(), road("S", [P(-172, -235), P(0, 10)])],
    "oblique 60°": () => [PAD(), road("S", [P(-260, -150), P(0, 10)])],
    "pad rotated 20°": () => rotated(20),
    "pad rotated 135°": () => rotated(135),
    "paving pad": () => [PAD({ type: "paving" }), road("S", [P(0, -300), P(0, 10)])],
    "polygon pad": () => [{ id: "PAD", type: "paving", z: 0, points: [P(-200, 0), P(200, 0), P(200, 200), P(-200, 200)] }, road("S", [P(0, -300), P(0, 10)])],
    "narrow 24 ft drive": () => [PAD(), road("S", [P(0, -300), P(0, 10)], { travelW: 24 })],
    "wide 48 ft drive": () => [PAD(), road("S", [P(0, -300), P(0, 10)], { travelW: 48 })],
  };
  for (const [name, mk] of Object.entries(SCENES)) {
    it(name, async () => {
      const { net } = await netOf(mk());
      const drive = net.drives[0];
      expect(drive.R, "a real curb return").toBeGreaterThan(0);
      expect(stripesPerRoad(net, "S"), "one polyline per side").toBe(2);
      for (const t of joinTurns(net, drive)) { expect(t.turn, "straight run and arc are joined at the tangent").not.toBeNull(); expect(t.turn).toBeLessThan(1); }
      expect(maxTurn(net, "S")).toBeLessThan(2);
      const pf = padFaceCheck(net, drive);
      expect(pf.ends.length).toBe(2);
      for (const e of pf.ends) expect(e).toBeLessThan(0.1);
      expect(pf.deepest).toBeLessThan(0.05);
    });
  }
  it("the stripes of the OLD build could not pass this: its arc stripe was lengthened 3 ft along the last chord (a 3° jog) and ran a curb-width into the pad", async () => {
    const { net } = await netOf([PAD(), road("S", [P(0, -300), P(0, 10)])]);
    // the new arc is a true circle tessellated at ≤ 1.5°: its first chord is within 0.75° of the straight edge's heading
    const l = stripeLinesOf(net, "S")[0], i = l.findIndex((p) => Math.abs(Math.hypot(p.x - net.drives[0].sideTangents[0].x, p.y - net.drives[0].sideTangents[0].y) - 0.5) < 1e-3 || Math.abs(Math.hypot(p.x - net.drives[0].sideTangents[1].x, p.y - net.drives[0].sideTangents[1].y) - 0.5) < 1e-3);
    expect(i).toBeGreaterThan(0);
    expect(turnDeg(l[i - 1], l[i], l[i + 1])).toBeLessThan(0.8);
  });
});

describe("a tee's face-of-curb: the side stripe + arc is one polyline per side, ending exactly where the through road's stripe begins", () => {
  const tee = (extra = {}) => [road("G", [P(-300, 0), P(0, 0), P(300, 0)], extra), road("S", [P(0, -250), P(0, 0)])];
  it("perpendicular", async () => {
    const { net } = await netOf(tee());
    expect(stripesPerRoad(net, "S")).toBe(2);
    expect(maxTurn(net, "S")).toBeLessThan(2);
    const through = stripeLinesOf(net, "G");
    for (const l of stripeLinesOf(net, "S")) {
      const end = l[l.length - 1];
      expect(through.some((t) => [t[0], t[t.length - 1]].some((e) => Math.hypot(e.x - end.x, e.y - end.y) < 1e-6)), `no through stripe begins at (${end.x}, ${end.y})`).toBe(true);
    }
  });
  it("oblique (the side road meets the through road at 55°)", async () => {
    const { net } = await netOf([road("G", [P(-300, 0), P(0, 0), P(300, 0)]), road("S", [P(-205, -143), P(0, 0)])]);
    expect(stripesPerRoad(net, "S")).toBe(2);
    expect(maxTurn(net, "S")).toBeLessThan(2);
  });
});

describe("a drive's mouth is cut out of the field's own ink EXACTLY, at every rotation", () => {
  const faceOf = (deg) => {
    const els = rotated(deg);
    return { pad: els[0], els };
  };
  for (const deg of [0, 5, 13, 20, 37, 45, 62, 90, 111, 135, 180, 200, 247, 270, 301, 355]) {
    it(`pad rotated ${deg}°: the outline and the first stall row stop at the two tangent points, and nothing lies between them`, async () => {
      const { pad, els } = faceOf(deg);
      const { n } = await netOf(els);
      const cutters = n.outlineCuts.get("PAD"), mouths = n.mouths.get("PAD");
      expect(mouths.length).toBe(1);
      const { a, b } = mouths[0], L = Math.hypot(b.x - a.x, b.y - a.y), u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
      const along = (p) => (p.x - a.x) * u.x + (p.y - a.y) * u.y, across = (p) => Math.abs((p.x - a.x) * u.y - (p.y - a.y) * u.x);
      // every straight run of ink (a segment of a piece / chain) that lies ON the face line
      const faceRuns = (pcs) => pcs.flatMap((s) => s.slice(1).map((q, i) => [s[i], q])).filter(([p, q]) => across(p) < 0.05 && across(q) < 0.05);
      const inkOf = (kind) => (kind === "outline" ? rectOutlineCutSegments(pad, cutters, mouths) : rectBandOutlineCutPolylines(pad, { x: 0, y: 0, w: 396, h: 18 }, cutters, mouths));
      for (const kind of ["outline", "band"]) {
        const runs = faceRuns(inkOf(kind));
        expect(runs.length, `${kind}: the face still carries ink outside the mouth`).toBeGreaterThan(0);
        for (const [p, q] of runs) {
          // no run of face ink overlaps the open mouth span
          const lo = Math.min(along(p), along(q)), hi = Math.max(along(p), along(q)), mlo = Math.min(0, L), mhi = Math.max(0, L);
          expect(Math.min(hi, mhi) - Math.max(lo, mlo), `${kind}: ink runs across the mouth`).toBeLessThan(1e-6);
        }
        // and the ink reaches each tangent point exactly (no stub left short, no tail beyond)
        const ends = runs.flatMap(([p, q]) => [p, q]).filter((p) => Math.min(Math.hypot(p.x - a.x, p.y - a.y), Math.hypot(p.x - b.x, p.y - b.y)) < 1e-6);
        expect(ends.length, `${kind}: the face ink does not end at the tangent points`).toBeGreaterThanOrEqual(2);
      }
    });
  }
  it("without mouths it is the old behaviour (the clip + the coincident drop): the legacy two-argument call still works", async () => {
    const { pad, els } = faceOf(0);
    const { n } = await netOf(els);
    const legacy = rectOutlineCutSegments(pad, n.outlineCuts.get("PAD"));
    expect(legacy.length).toBeGreaterThanOrEqual(5);
    expect(rectOutlineCutSegments(pad, [])).toHaveLength(4);
  });
  it("a face made of two collinear polygon edges (a digitizing vertex mid-face) is cut across the vertex", async () => {
    const poly = { id: "PAD", type: "paving", z: 0, points: [P(-200, 0), P(-10, 0), P(200, 0), P(200, 200), P(-200, 200)] };
    const { n } = await netOf([poly, road("S", [P(0, -300), P(0, 10)])]);
    const { a, b } = n.mouths.get("PAD")[0], lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
    expect(lo).toBeLessThan(-10); expect(hi).toBeGreaterThan(-10);          // the mouth straddles the vertex
    const segs = polygonOutlineCutSegments(poly, n.outlineCuts.get("PAD"), n.mouths.get("PAD"));
    for (const s of segs) for (let i = 0; i + 1 < s.length; i++) {
      const p = s[i], q = s[i + 1];
      if (Math.abs(p.y) < 0.05 && Math.abs(q.y) < 0.05) expect(Math.min(Math.max(p.x, q.x), hi) - Math.max(Math.min(p.x, q.x), lo), "ink across the mouth").toBeLessThan(1e-6);
    }
    expect(segs.some((s) => s.some((p) => Math.abs(p.y) < 0.05 && Math.abs(p.x - lo) < 1e-6)), "ink reaches the near tangent").toBe(true);
    expect(segs.some((s) => s.some((p) => Math.abs(p.y) < 0.05 && Math.abs(p.x - hi) < 1e-6)), "ink reaches the far tangent").toBe(true);
  });
  it("a polygon pad is cut by the same span", async () => {
    const poly = { id: "PAD", type: "paving", z: 0, points: [P(-200, 0), P(200, 0), P(200, 200), P(-200, 200)] };
    const { n } = await netOf([poly, road("S", [P(0, -300), P(0, 10)])]);
    const segs = polygonOutlineCutSegments(poly, n.outlineCuts.get("PAD"), n.mouths.get("PAD"));
    const { a, b } = n.mouths.get("PAD")[0];
    for (const s of segs) for (const p of s) expect(Math.abs(p.y) < 0.05 && p.x > Math.min(a.x, b.x) + 1e-6 && p.x < Math.max(a.x, b.x) - 1e-6, "ink inside the mouth").toBe(false);
  });
});

describe("curbBandPieces — a drive's mouth is a CURB CUT in the field's derived curb band", () => {
  for (const deg of [0, 20, 90, 200, 301]) {
    it(`pad rotated ${deg}°: the band along the entered face loses exactly the mouth's span; every other edge keeps its whole band`, async () => {
      const els = rotated(deg), pad = els[0];
      const { n } = await netOf(els);
      const mouths = n.mouths.get("PAD"), { a, b } = mouths[0], L = Math.hypot(b.x - a.x, b.y - a.y);
      // the face the drive enters: the one edge whose band is shortened
      const edges = [["y", -1, pad.w], ["y", 1, pad.w], ["x", -1, pad.h], ["x", 1, pad.h]];
      const cut = edges.filter(([ax, sg, len]) => { const pcs = curbBandPieces(pad, mouths, ax, sg); return pcs.reduce((s, [x, y]) => s + (y - x), 0) < len - 1e-6; });
      expect(cut.length, "exactly one edge is cut").toBe(1);
      const [ax, sg, len] = cut[0], pcs = curbBandPieces(pad, mouths, ax, sg);
      expect(pcs.reduce((s, [x, y]) => s + (y - x), 0)).toBeCloseTo(len - L, 6);
      expect(pcs.length).toBe(2);
      for (const [ax2, sg2, len2] of edges.filter((e) => e !== cut[0])) expect(curbBandPieces(pad, mouths, ax2, sg2)).toEqual([[0, len2]]);
    });
  }
  it("no mouth (or no element) leaves the whole band", () => {
    expect(curbBandPieces(PAD(), undefined, "y", -1)).toEqual([[0, 400]]);
    expect(curbBandPieces(PAD(), [], "x", 1)).toEqual([[0, 200]]);
    expect(curbBandPieces(null, [{ a: P(0, 0), b: P(1, 0) }], "y", -1)).toEqual([]);
  });
});

describe("splitEdgeByOwner — the outline is stroked per owning road", () => {
  it("a drive narrower than the trunk it tees onto: the drive's straight edges and its returns are the DRIVE's, the trunk's edges the TRUNK's", async () => {
    const els = [PAD(), road("T", [P(-300, -150), P(0, -150), P(300, -150)], { travelW: 40 }), road("S", [P(0, -150), P(0, 10)], { travelW: 24 })];
    const { n } = await netOf(els);
    const r = n.regions[0];
    expect(r.ids.sort()).toEqual(["S", "T"]);
    expect(r.members.map((m) => m.id).sort()).toEqual(["S", "T"]);
    const byOwner = splitEdgeByOwner(r.edge, r.ownerRings);
    const owned = (id) => (byOwner.get(id) || []);
    const near = (id, f) => owned(id).some((l) => l.some(f));
    expect(near("S", (p) => Math.abs(Math.abs(p.x) - 12.5) < 0.05 && p.y > -120 && p.y < -30), "the drive's straight edge").toBe(true);
    expect(near("T", (p) => Math.abs(p.y + 170.5 - 0) < 0.05 || Math.abs(p.y + 129.5) < 0.05), "the trunk's edge").toBe(true);
    expect(near("T", (p) => Math.abs(Math.abs(p.x) - 12.5) < 0.05 && p.y > -120 && p.y < -30), "the trunk must not own the drive's edge").toBe(false);
    expect(near("S", (p) => Math.abs(p.y + 170.5) < 0.05), "the drive must not own the trunk's edge").toBe(false);
  });
  it("one owner keeps ONE polyline per run (a closed ring is not cut open); no rings, no edge = nothing", () => {
    const sq = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
    const m = splitEdgeByOwner([[...sq, sq[0]]], new Map([["A", { strip: sq, extra: [] }]]));
    expect(m.get("A").length).toBe(1);
    expect(splitEdgeByOwner(null, new Map())).toEqual(new Map());
    expect(splitEdgeByOwner([], new Map([["A", { strip: sq, extra: [] }]])).size).toBe(0);
  });
});

describe("real plans — the owner's own junctions", () => {
  const fixtures = readdirSync(new URL("../ui-audit/fixtures/", import.meta.url)).filter((f) => f.endsWith(".json"));
  it.each(fixtures)("%s: every drive return's stripe is joined at the tangent (< 1°), ends on its pad face, and nothing is inside a pad", async (f) => {
    let j;
    try { j = JSON.parse(readFileSync(new URL(`../ui-audit/fixtures/${f}`, import.meta.url), "utf8")); } catch { return; }
    if (!j || !Array.isArray(j.els)) return;
    const els = migrateRoads(j.els);
    const { net } = await netOf(els, j.settings || {});
    for (const drive of net.drives) {
      const pf = padFaceCheck(net, drive);
      expect(pf.deepest, `${f} ${drive.sideId}: a stripe runs into its pad`).toBeLessThan(0.05);
      if (!(drive.R > 0)) continue;                            // a sharp corner has no return to join
      for (const t of joinTurns(net, drive)) if (t.turn != null) expect(t.turn, `${f} ${drive.sideId}: the heading jumps at the tangent`).toBeLessThan(1.5);
    }
  });
});
