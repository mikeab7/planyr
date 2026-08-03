/* NEW-1 / NEW-2 — a road tee SLIDES along its host, and the tee position IS the road's bearing.
 *
 * Owner report (Goose Creek, verbatim): "when I try connecting roads, it doesn't let me slide the
 * connection point along the road. It's kind of stuck. So for example if you look at Goose Creek, my
 * road between buildings is slightly angled and I don't want it to be, but it won't let me adjust the
 * tee to the correct spot."
 *
 * The mechanism, measured on his REAL rows (fixture goose-creek-tee-slide.json, pulled from production
 * Supabase 2026-08-03) and not inferred: a tee is stored as a control point SPLICED into the host road's
 * alignment, and `planRoadConnect` routed EVERY tee — including one that already existed — through
 * `insertRoadVertex`'s reuse rule. That rule's tolerance scales with the host's width (travelW/4), which
 * on his 100 ft host is 25 FT. So the drag showed a live ghost the whole way and then, on release, the
 * endpoint was welded straight back onto the node it started on. The correction he wants is a ~22 ft
 * slide south — inside the dead zone, so his adjustment did nothing at all, every time. Past 25 ft it moved
 * but spliced a SECOND node in and left the original behind.
 *
 * NEW-2 was RE-SCOPED by the owner mid-session: "not square to the host road, it's just more angled with
 * respect to N/S than I'd like." So it is a CARDINAL bearing he is aiming at, a property of the road
 * alone — not a relationship to the host. The perpendicular snap first designed for it was discarded
 * unbuilt. What is asserted here instead is the geometric fact behind the re-scope: the tee end is the
 * free end, so its position along the host is exactly what sets the connecting road's absolute bearing —
 * and the cardinal it wants is 18.4 ft away, INSIDE the dead zone NEW-1 removes. The Shift lock that
 * already exists for road vertices (45 deg increments, true cardinals because the feet frame is
 * north-aligned) is made to survive a junction drag rather than being overwritten by the connect magnet.
 *
 * Every assertion below was proven RED against the pre-fix code (`planRoadConnect` without `fromPt`,
 * `findRoadConnect` without the saturation tie-break, no `cardinalTeePoint`). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  findRoadConnect, planRoadConnect, slideTeeNode, teeNodeIndex, cardinalTeePoint, roadBearingDeg,
  ROAD_VERTEX_COLLAPSE_FT,
} from "../src/workspaces/site-planner/lib/roadGeometry.js";

const FIX = JSON.parse(readFileSync(fileURLToPath(new URL("../ui-audit/fixtures/goose-creek-tee-slide.json", import.meta.url)), "utf8"));
const el = (id) => FIX.els.find((e) => e.id === id);
const HOST = el("e1454717dshobp");            // the 100 ft aisle the tee lands on
const SIDE = el("e1454743ykduhm");            // "my road between buildings" — the 40 ft aisle
const TEE_IDX = SIDE.pts.length - 1;          // its tee endpoint
const FROM = SIDE.pts[TEE_IDX];
const TOL_FT = 10;                            // ROAD_CONNECT_MAX_FT — the cap at any working zoom
const roads = [HOST, SIDE].map((r) => ({ id: r.id, pts: r.pts, halfW: (+r.travelW) / 2 + (+r.curb || 0) }));

const angDeg = (u, v) => (Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))))) * 180) / Math.PI;
// Drive one full gesture: cursor lands `slide` ft SOUTH of the tee (+y is south in this frame),
// release, report where it ends up. South is the way his correction goes — the tee sits near the
// host road's north end and has to come back down it to square the connecting leg up.
function dragTee(slide, opts = {}) {
  const cursor = { x: FROM.x, y: FROM.y + slide };
  const cand = findRoadConnect(cursor, { id: SIDE.id, index: TEE_IDX }, roads, { tolFt: TOL_FT, allowInterior: true });
  if (!cand) return null;
  const ghost = cand.pt;                                            // what the ghost shows mid-drag
  const moved = { ...SIDE, pts: SIDE.pts.map((p, i) => (i === TEE_IDX ? ghost : p)) };
  const plan = planRoadConnect(moved, TEE_IDX, HOST, cand, 25, opts.legacy ? {} : { fromPt: FROM });
  return { cand, ghost, plan, landed: plan && plan.moving.pts[TEE_IDX], host: plan && plan.target ? plan.target : { pts: HOST.pts, vtx: HOST.vtx } };
}

describe("the owner's tee, on his real Goose Creek rows", () => {
  it("is stored as a control point on the host road — index 7, exactly coincident", () => {
    expect(FROM).toEqual(HOST.pts[7]);
    expect(teeNodeIndex(HOST.pts, FROM)).toBe(7);
  });

  it("meets the host at 77.6 deg, which is the 'slightly angled' he is complaining about", () => {
    const pivot = SIDE.pts[TEE_IDX - 1];
    const approach = { x: FROM.x - pivot.x, y: FROM.y - pivot.y };
    const host = { x: HOST.pts[7].x - HOST.pts[6].x, y: HOST.pts[7].y - HOST.pts[6].y };
    expect(angDeg(approach, host)).toBeCloseTo(77.62, 1);
  });

  it("PRE-FIX: every slide up to the host's 25 ft collapse radius reverted to zero on release", () => {
    for (const slide of [5, 10, 15, 20, 22, 25]) {
      const r = dragTee(slide, { legacy: true });
      expect(r.ghost.y).toBeGreaterThan(FROM.y + slide - 1);        // the ghost followed the cursor…
      expect(r.landed.y).toBeCloseTo(FROM.y, 6);                    // …and the release threw it away
    }
  });

  it("PRE-FIX: a slide past the dead zone moved it but left the old node behind (9 pts -> 10)", () => {
    const r = dragTee(40, { legacy: true });
    expect(r.host.pts).toHaveLength(HOST.pts.length + 1);
    expect(teeNodeIndex(r.host.pts, FROM)).toBeGreaterThan(0);      // the original node is still there
  });

  it("slides CONTINUOUSLY and stays where it is dropped — including the ~22 ft he needs", () => {
    for (const slide of [1, 3, 5, 10, 15, 20, 22, 25, 40, 80]) {
      const r = dragTee(slide);
      expect(r.plan.action).toBe("tee");
      expect(r.landed.y - FROM.y).toBeCloseTo(r.ghost.y - FROM.y, 6);   // dropped == released
      expect(r.landed.y - FROM.y).toBeGreaterThan(slide * 0.9);
    }
  });

  it("moves the junction rather than adding one: the host keeps its control-point count", () => {
    for (const slide of [5, 22, 40, 80]) {
      const r = dragTee(slide);
      expect(r.host.pts).toHaveLength(HOST.pts.length);
      expect(r.host.vtx).toHaveLength(HOST.vtx.length);
      expect(teeNodeIndex(r.host.pts, FROM)).toBe(-1);               // nothing left at the old spot
      expect(teeNodeIndex(r.host.pts, r.landed)).toBeGreaterThan(0); // the node came WITH it
    }
  });

  it("keeps both roads meeting at one exact point — the tee never detaches", () => {
    for (const slide of [4, 12, 30]) {
      const r = dragTee(slide);
      const k = teeNodeIndex(r.host.pts, r.landed);
      expect(r.host.pts[k]).toEqual({ x: r.landed.x, y: r.landed.y });
    }
  });

  it("sliding the other way (north) works the same (the dead zone was symmetric)", () => {
    const r = dragTee(-15);
    expect(r.landed.y).toBeLessThan(FROM.y - 13);
    expect(r.host.pts).toHaveLength(HOST.pts.length);
  });

  it("a slide PAST a neighbouring control point re-sequences instead of folding the host back on itself", () => {
    const r = dragTee(230);                                          // past host vertex 6 (y = 201.4)
    const k = teeNodeIndex(r.host.pts, r.landed);
    expect(k).toBeGreaterThan(0);
    // y decreases monotonically along this host; the moved node must respect that ordering.
    const ys = r.host.pts.map((p) => p.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1]);
  });
});

describe("slideTeeNode — the pure primitive", () => {
  const pts = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 300 }];
  const vtx = [{}, { treatment: "arc", radius: 25 }, {}];

  it("moves the held interior node and keeps pts/vtx index-aligned", () => {
    const r = slideTeeNode(pts, vtx, 1, { x: 0, y: 180 });
    expect(r.pts).toHaveLength(3);
    expect(r.vtx).toHaveLength(3);
    expect(r.pts[r.index]).toEqual({ x: 0, y: 180 });
  });

  it("refuses an ENDPOINT — that meet is a weld, and moving it would change the host's extent", () => {
    expect(slideTeeNode(pts, vtx, 0, { x: 0, y: 50 })).toBeNull();
    expect(slideTeeNode(pts, vtx, 2, { x: 0, y: 250 })).toBeNull();
  });

  it("collapses only on a TRUE coincidence, never on the width-scaled dead zone", () => {
    const near = slideTeeNode(pts, vtx, 1, { x: 0, y: 100 + ROAD_VERTEX_COLLAPSE_FT * 4 });
    expect(near.pts[near.index].y).toBeCloseTo(100 + ROAD_VERTEX_COLLAPSE_FT * 4, 6);
  });

  it("returns null on a road with no interior to hold a junction", () => {
    expect(slideTeeNode([{ x: 0, y: 0 }, { x: 0, y: 10 }], [{}, {}], 1, { x: 0, y: 5 })).toBeNull();
  });

  it("is a no-op in effect when the node is dropped exactly where it already sat", () => {
    const r = slideTeeNode(pts, vtx, 1, { x: 0, y: 100 });
    expect(r.pts).toEqual(pts);
    expect(r.index).toBe(1);
  });
});

describe("teeNodeIndex", () => {
  const pts = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 300 }];
  it("finds an interior node within tolerance and ignores endpoints", () => {
    expect(teeNodeIndex(pts, { x: 0.4, y: 100.2 })).toBe(1);
    expect(teeNodeIndex(pts, { x: 0, y: 0 })).toBe(-1);
    expect(teeNodeIndex(pts, { x: 0, y: 300 })).toBe(-1);
  });
  it("rejects a point that is merely nearby, so a fresh connect still splices its own node", () => {
    expect(teeNodeIndex(pts, { x: 0, y: 108 })).toBe(-1);
  });
  it("handles missing / unusable input without throwing", () => {
    expect(teeNodeIndex(null, { x: 0, y: 0 })).toBe(-1);
    expect(teeNodeIndex(pts, undefined)).toBe(-1);
    expect(teeNodeIndex(pts, { x: NaN, y: 1 })).toBe(-1);
  });
});

describe("NEW-2 — the tee position IS the road's bearing, and the cardinal lock aims it", () => {
  const pivot = SIDE.pts[TEE_IDX - 1];
  const a = HOST.pts[6], b = HOST.pts[7];
  // Bearings are TRUE: the planner's feet frame is axis-aligned to north (mapLock.feetToLatLngPair —
  // minus-y is north, plus-x is east, no rotation), so a page angle here is a compass angle.
  const offCardinal = (deg) => Math.abs(deg - Math.round(deg / 90) * 90);

  it("reads a true compass bearing: north 0, east 90, south 180, west 270", () => {
    expect(roadBearingDeg({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(0, 6);
    expect(roadBearingDeg({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90, 6);
    expect(roadBearingDeg({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(180, 6);
    expect(roadBearingDeg({ x: 0, y: 0 }, { x: -10, y: 0 })).toBeCloseTo(270, 6);
    expect(roadBearingDeg({ x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
  });

  it("the leg the tee governs sits 9.4 deg off the cardinal axis today — his 'slightly angled'", () => {
    expect(offCardinal(roadBearingDeg(pivot, FROM))).toBeCloseTo(9.38, 1);
  });

  it("CONFIRMS the amendment: sliding the tee is what changes that bearing", () => {
    const seen = [-20, -10, 0, 10, 20, 30].map((s) => roadBearingDeg(pivot, { x: FROM.x, y: FROM.y + s }));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBeCloseTo(seen[i - 1], 2);
    // and the direction of travel is monotonic — slide one way and it swings toward the axis
    const off = seen.map(offCardinal);
    expect(off[off.length - 1]).toBeLessThan(off[0]);
  });

  it("names the slide that brings the leg to a true cardinal — 18.4 ft SOUTH, INSIDE the old 25 ft dead zone", () => {
    let best = null;
    for (let s = -40; s <= 60; s += 0.01) {
      const o = offCardinal(roadBearingDeg(pivot, { x: FROM.x, y: FROM.y + s }));
      if (!best || o < best.off) best = { s, off: o };
    }
    expect(best.off).toBeLessThan(0.01);
    expect(best.s).toBeCloseTo(18.4, 1);
    expect(best.s).toBeLessThan(25);          // the whole point: unreachable before the NEW-1 fix
  });

  it("the cardinal lock lands the leg on an exact 45 deg increment, still ON the host", () => {
    const cd = cardinalTeePoint(HOST.pts, pivot, { x: FROM.x, y: FROM.y + 14 });
    expect(cd).not.toBeNull();
    expect(offCardinal(cd.bearing)).toBeCloseTo(0, 6);
    // still on the host: the point lies on the leg it reports
    const p = HOST.pts[cd.index], q = HOST.pts[cd.index + 1];
    const s = ((cd.pt.x - p.x) * (q.x - p.x) + (cd.pt.y - p.y) * (q.y - p.y)) / ((q.x - p.x) ** 2 + (q.y - p.y) ** 2);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it("finds the crossing on ANOTHER leg of the host — the case a single-segment solve refused", () => {
    // The cursor sits 14 ft north of the tee, on host leg 7; the cardinal crossing is on leg 6.
    const cd = cardinalTeePoint(HOST.pts, pivot, { x: FROM.x, y: FROM.y + 14 });
    expect(cd.index).toBe(6);
    expect(cd.pt.y).toBeGreaterThan(FROM.y + 15);
  });

  it("locks to whichever increment the drag is nearest, not always the same one", () => {
    const wall = [{ x: 0, y: -500 }, { x: 0, y: 500 }];
    expect(cardinalTeePoint(wall, { x: -100, y: 0 }, { x: 0, y: 6 }).bearing).toBeCloseTo(90, 6);
    expect(cardinalTeePoint(wall, { x: -100, y: 0 }, { x: 0, y: 90 }).bearing).toBeCloseTo(135, 6);
  });

  it("refuses rather than inventing a point when the locked ray cannot reach the host", () => {
    // parallel: the locked leg runs along the host, never crossing it
    expect(cardinalTeePoint([{ x: 0, y: -100 }, { x: 0, y: 100 }], { x: 0, y: -300 }, { x: 0, y: -95 })).toBeNull();
    // the crossing lies BEHIND the pivot
    expect(cardinalTeePoint([{ x: 0, y: -10 }, { x: 0, y: 10 }], { x: 100, y: 0 }, { x: 160, y: 2 })).toBeNull();
    // the host does not extend to where the locked ray would cross
    expect(cardinalTeePoint([{ x: 0, y: 400 }, { x: 0, y: 500 }], { x: -100, y: 0 }, { x: 0, y: 3 })).toBeNull();
    expect(cardinalTeePoint(null, pivot, FROM)).toBeNull();
    expect(cardinalTeePoint(HOST.pts, FROM, FROM)).toBeNull();
  });

  it("a finer step can be asked for, so the lock is not hard-wired to 45 deg", () => {
    const cd = cardinalTeePoint([{ x: 0, y: -500 }, { x: 0, y: 500 }], { x: -100, y: 0 }, { x: 0, y: 20 }, { stepDeg: 10 });
    expect(Math.abs(cd.bearing - Math.round(cd.bearing / 10) * 10)).toBeCloseTo(0, 6);
  });
});

describe("nothing else about connecting roads changed", () => {
  it("a FRESH tee (no fromPt) still splices its own node, and still reuses a near one", () => {
    const cursor = { x: -1233, y: 330 };                              // mid-segment, clear of every host vertex
    const cand = findRoadConnect(cursor, { id: SIDE.id, index: 0 }, roads, { tolFt: TOL_FT, allowInterior: true });
    const plan = planRoadConnect(SIDE, 0, HOST, cand, 25, { fromPt: SIDE.pts[0] });
    expect(plan.action).toBe("tee");
    expect(plan.target.pts.length).toBe(HOST.pts.length + 1);         // a genuinely new junction
    expect(plan.slid).toBeUndefined();
  });

  it("an endpoint-to-endpoint meet is still a weld/merge, never a slide", () => {
    const other = { id: "z", pts: [{ x: -1274.69, y: -87.89 }, { x: -1400, y: -400 }], halfW: 20 };
    const cand = findRoadConnect({ x: -1274.69, y: -87.89 }, { id: "z", index: 0 }, [...roads, other], { tolFt: TOL_FT, allowInterior: true });
    expect(cand.kind).toBe("endpoint");
    const moving = { id: "z", pts: other.pts, vtx: [{}, {}], roadClass: "aisle", travelW: 40, curb: 0.5 };
    const plan = planRoadConnect(moving, 0, HOST, cand, 25, { fromPt: other.pts[0] });
    expect(["weld", "merge"]).toContain(plan.action);
  });
});
