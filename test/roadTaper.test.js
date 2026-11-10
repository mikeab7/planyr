/* NEW-1 (2026-11-10) — ROADS OF DIFFERENT WIDTHS JOIN WITH A SMOOTH TAPER (lib/roadTaper.js).
 *
 * Owner report: where a 50 ft road ends and a narrower drive begins, the two pavement shapes just overlapped — a notch / stepped edge, and at
 * a bend a wedge where the edges did not line up. Owner choice (2026-11-10): taper end to end.
 *
 * Every assertion below reads the REAL dissolved network (`roadNetSteps`, the thing the canvas, the print and the PDF paint), never the
 * helper in isolation, so this file is RED on a build without the taper (the pavement outline steps by the whole width difference at the
 * joint) and green with it. */
import { describe, it, expect } from "vitest";
import { roadNetInputs, roadNetSteps, driveSteps } from "../src/workspaces/site-planner/lib/roadNetBuild.js";
import { roadTapersOf, TAPER_RATIO, TAPER_MIN_FT } from "../src/workspaces/site-planner/lib/roadTaper.js";
import { roadStripRing, roadCurbLines, roadStripArea, roundaboutsForSite } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import { pointInRing } from "../src/workspaces/site-planner/lib/ringMath.js";
import ClipperLib from "clipper-lib";

const areaOf = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };
function unionArea(rings) {
  const C = new ClipperLib.Clipper();
  for (const r of rings) { const path = r.map((p) => ({ X: Math.round(p.x * 100), Y: Math.round(p.y * 100) })); C.AddPath(ClipperLib.Clipper.Orientation(path) ? path : path.reverse(), ClipperLib.PolyType.ptSubject, true); }
  const sol = new ClipperLib.Paths();
  C.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return sol.reduce((t, p) => t + Math.abs(ClipperLib.Clipper.Area(p)), 0) / 10000;
}

const SETTINGS = {};
const P = (x, y) => ({ x, y });
const road = (id, pts, travelW, o = {}) => ({ id, type: "road", z: 1, pts, vtx: pts.map(() => ({})), travelW, curb: 0.5, roadClass: "local", ...o });
const OUT = (w) => w / 2 + 0.5;                       // back-of-curb half width

async function net(els) {
  const inp = await roadNetInputs(els, SETTINGS);
  return { inp, n: driveSteps(roadNetSteps(inp)) };
}
const regionOuters = (n) => n.regions.map((r) => r.region.outer);

/* half-width (max |y − cy|) of a ring on the vertical line x = X, for an axis-aligned road along +x. */
function halfWidthAt(ring, X, cy = 0) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if ((a.x - X) * (b.x - X) > 0 || a.x === b.x) continue;
    const y = a.y + ((b.y - a.y) * (X - a.x)) / (b.x - a.x);
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  return Number.isFinite(lo) ? Math.max(hi - cy, cy - lo) : null;
}
const wideNarrow = () => [road("W", [P(0, 0), P(200, 0)], 50), road("N", [P(200, 0), P(400, 0)], 24)];

describe("which ends taper", () => {
  it("a wide road meeting a narrow one end to end tapers the WIDE road's end, to the narrow road's widths", () => {
    const { byRoad, joints } = roadTapersOf(wideNarrow());
    expect([...byRoad.keys()]).toEqual(["W"]);
    const t = byRoad.get("W").e;
    expect(t.outerHalf).toBeCloseTo(OUT(24)); expect(t.travelHalf).toBeCloseTo(12);
    expect(t.otherId).toBe("N");
    expect(joints).toHaveLength(1);
  });
  it("default length = TAPER_RATIO ft per foot each edge steps in (never under TAPER_MIN_FT), clamped to the wide road's last segment", () => {
    expect(roadTapersOf(wideNarrow()).byRoad.get("W").e.lenFt).toBeCloseTo(TAPER_RATIO * (OUT(50) - OUT(24)));
    const tiny = [road("W", [P(0, 0), P(200, 0)], 26), road("N", [P(200, 0), P(400, 0)], 24)];
    expect(roadTapersOf(tiny).byRoad.get("W").e.lenFt).toBe(TAPER_MIN_FT);
    const short = [road("W", [P(0, 0), P(160, 0), P(200, 0)], 50), road("N", [P(200, 0), P(400, 0)], 24)];
    expect(roadTapersOf(short).byRoad.get("W").e.lenFt).toBeCloseTo(40);          // the last segment is 40 ft long
  });
  it("the owner's typed length wins (road.taper.e), and is the only stored fact", () => {
    const els = wideNarrow(); els[0].taper = { e: 60 };
    const t = roadTapersOf(els).byRoad.get("W").e;
    expect(t.lenFt).toBe(60); expect(t.auto).toBe(false);
  });
  it("equal widths, a tee, a three-arm node and a lone end are NOT tapers", () => {
    expect(roadTapersOf([road("A", [P(0, 0), P(200, 0)], 30), road("B", [P(200, 0), P(400, 0)], 30)]).byRoad.size).toBe(0);
    expect(roadTapersOf([road("A", [P(0, 0), P(200, 0)], 50), road("B", [P(100, 0), P(100, 100)], 24)]).byRoad.size).toBe(0);
    expect(roadTapersOf([...wideNarrow(), road("C", [P(200, 0), P(200, 90)], 20)]).byRoad.size).toBe(0);
    expect(roadTapersOf([road("A", [P(0, 0), P(200, 0)], 50)]).byRoad.size).toBe(0);
  });
  it("all four orientations (which road is drawn first, which ends meet) find the same taper on the wide road's joined end", () => {
    const W = [P(0, 0), P(200, 0)], N = [P(200, 0), P(400, 0)];
    const cases = [
      [road("W", W, 50), road("N", N, 24), "e"],
      [road("N", N, 24), road("W", W, 50), "e"],
      [road("W", W.slice().reverse(), 50), road("N", N, 24), "s"],           // wide drawn toward the joint's far side: its START meets
      [road("W", W, 50), road("N", N.slice().reverse(), 24), "e"],           // narrow drawn into the joint
    ];
    for (const [a, b, end] of cases) {
      const t = roadTapersOf([a, b]).byRoad.get("W");
      expect(t && t[end], `${a.id}/${b.id}`).toBeTruthy();
      expect(Object.keys(t)).toEqual([end]);
    }
  });
  it("it is derived: survives a save + reload, and a disconnect / deletion / width change removes it", () => {
    const els = wideNarrow();
    expect(roadTapersOf(JSON.parse(JSON.stringify(els))).byRoad.get("W").e.outerHalf).toBeCloseTo(OUT(24));
    expect(roadTapersOf(els.slice(0, 1)).byRoad.size).toBe(0);                                 // delete the narrow road
    expect(roadTapersOf([els[0], { ...els[1], pts: [P(260, 0), P(400, 0)] }]).byRoad.size).toBe(0);   // pull it away
    expect(roadTapersOf([els[0], { ...els[1], travelW: 50 }]).byRoad.size).toBe(0);            // make the widths equal
  });
  it("a road with a taper at BOTH ends (narrow — wide — narrow)", () => {
    const els = [road("N1", [P(-200, 0), P(0, 0)], 24), road("W", [P(0, 0), P(300, 0)], 50), road("N2", [P(300, 0), P(500, 0)], 24)];
    const t = roadTapersOf(els).byRoad.get("W");
    expect(Object.keys(t).sort()).toEqual(["e", "s"]);
  });
});

describe("the pavement outline is ONE continuous piece (the pre-fix notch)", () => {
  it("straight-on: the dissolved outline narrows monotonically from the wide width to the narrow width, with no step at the joint", async () => {
    const { n } = await net(wideNarrow());
    expect(n.regions).toHaveLength(1);
    const ring = n.regions[0].region.outer;
    // full width before the taper starts (200 − 130 = 70), the narrow width after the joint
    expect(halfWidthAt(ring, 40)).toBeCloseTo(OUT(50), 1);
    expect(halfWidthAt(ring, 300)).toBeCloseTo(OUT(24), 1);
    // monotone non-increasing through the whole run, and never a jump bigger than the taper's own slope allows
    let prev = Infinity, worst = 0;
    for (let x = 1; x < 399; x += 1) {
      const h = halfWidthAt(ring, x);
      expect(h, `x=${x}`).not.toBeNull();
      expect(h).toBeLessThanOrEqual(prev + 0.02);
      if (prev !== Infinity) worst = Math.max(worst, prev - h);
      prev = h;
    }
    const slope = (OUT(50) - OUT(24)) / (TAPER_RATIO * (OUT(50) - OUT(24)));        // ft of edge per ft along
    expect(worst).toBeLessThan(slope * 1 + 0.35);                                     // pre-fix: one 13 ft step at x = 200
    // both edges meet the narrow road's edges AT the joint
    expect(halfWidthAt(ring, 199.5)).toBeCloseTo(OUT(24), 0);
    expect(halfWidthAt(ring, 200.5)).toBeCloseTo(OUT(24), 0);
  });
  it("the face-of-curb lines taper to the narrow road's, and the dissolved stripes meet it", async () => {
    const els = wideNarrow();
    const trims = roundaboutsForSite(els, SETTINGS).trims;
    const lines = roadCurbLines(els[0], SETTINGS, undefined, trims.get("W"));
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(Math.abs(l[0].y)).toBeCloseTo(25, 5);                    // full face-of-curb width at the start
      const last = l[l.length - 1];
      expect(last.x).toBeCloseTo(200); expect(Math.abs(last.y)).toBeCloseTo(12, 5);   // the narrow road's face of curb at the joint
    }
  });
  it("opposite orientation (the wide road to the RIGHT of the joint) tapers the other way", async () => {
    const els = [road("N", [P(0, 0), P(200, 0)], 24), road("W", [P(200, 0), P(400, 0)], 50)];
    const { n } = await net(els);
    const ring = n.regions[0].region.outer;
    expect(halfWidthAt(ring, 100)).toBeCloseTo(OUT(24), 1);
    expect(halfWidthAt(ring, 360)).toBeCloseTo(OUT(50), 1);
    expect(halfWidthAt(ring, 199.5)).toBeCloseTo(OUT(24), 0);
    expect(halfWidthAt(ring, 270)).toBeCloseTo((OUT(24) + OUT(50)) / 2, 0);   // halfway along the 130 ft taper
  });
  it("a road with a taper at both ends is one outline narrowing at each", async () => {
    const els = [road("N1", [P(-200, 0), P(0, 0)], 24), road("W", [P(0, 0), P(400, 0)], 50), road("N2", [P(400, 0), P(600, 0)], 24)];
    const { n } = await net(els);
    expect(n.regions).toHaveLength(1);
    const ring = n.regions[0].region.outer;
    expect(halfWidthAt(ring, 200)).toBeCloseTo(OUT(50), 1);
    expect(halfWidthAt(ring, -0.5)).toBeCloseTo(OUT(24), 0);
    expect(halfWidthAt(ring, 400.5)).toBeCloseTo(OUT(24), 0);
    expect(halfWidthAt(ring, 65)).toBeCloseTo((OUT(24) + OUT(50)) / 2, 0);
  });
  it("a taper longer than the wide road's last segment is clamped, never drawn broken", async () => {
    const els = [road("W", [P(0, 0), P(160, 0), P(200, 0)], 50), road("N", [P(200, 0), P(400, 0)], 24)];
    const { n } = await net(els);
    expect(n.regions).toHaveLength(1);
    const ring = n.regions[0].region.outer;
    expect(ring.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(halfWidthAt(ring, 150)).toBeCloseTo(OUT(50), 1);              // the taper starts at the last segment's start (x = 160), no earlier
    expect(halfWidthAt(ring, 199.5)).toBeCloseTo(OUT(24), 0);
  });
  it("a typed length changes the run of the taper", async () => {
    const els = wideNarrow(); els[0].taper = { e: 40 };
    const { n } = await net(els);
    const ring = n.regions[0].region.outer;
    expect(halfWidthAt(ring, 150)).toBeCloseTo(OUT(50), 1);              // full width until x = 160
    expect(halfWidthAt(ring, 180)).toBeCloseTo((OUT(50) + OUT(24)) / 2, 0);
  });
  it("a HIDDEN partner is not on the drawing, so the wide road keeps its width at that end", async () => {
    const els = wideNarrow();
    const inp = await roadNetInputs(els, SETTINGS);                       // junctions / tapers resolved over the WHOLE plan, as the planner does
    const withN = driveSteps(roadNetSteps(inp));
    expect(halfWidthAt(withN.regions[0].region.outer, 199)).toBeCloseTo(OUT(24), 0);
    // hiding N leaves only W in the network's roads (roadNetSteps filters hidden roads out of `els`)
    const hiddenN = driveSteps(roadNetSteps({ ...inp, els: els.filter((e) => e.id === "W") }));
    expect(hiddenN.regions).toHaveLength(1);
    expect(halfWidthAt(hiddenN.regions[0].region.outer, 199)).toBeCloseTo(OUT(50), 1);   // not narrowed toward a road that is not there
  });
  it("equal widths are untouched: no taper entry, the same ring the plain road builds", async () => {
    const els = [road("A", [P(0, 0), P(200, 0)], 30), road("B", [P(200, 0), P(400, 0)], 30)];
    expect(roundaboutsForSite(els, SETTINGS).trims.size).toBe(0);
    const a = roadStripRing(els[0], SETTINGS, undefined, undefined), b = roadStripRing(els[0], SETTINGS, undefined, roundaboutsForSite(els, SETTINGS).trims.get("A"));
    expect(b).toEqual(a);
  });
  it("the paved-area figure follows the taper (a tapered strip is smaller than the constant-width one)", () => {
    const els = wideNarrow();
    const trim = roundaboutsForSite(els, SETTINGS).trims.get("W");
    const full = roadStripArea(els[0], SETTINGS, undefined, undefined), tapered = roadStripArea(els[0], SETTINGS, undefined, trim);
    const saved = 130 * (OUT(50) - OUT(24));                              // triangle: ½ · 130 · (2 · 13)
    expect(full - tapered).toBeCloseTo(saved, 0);
  });
});

describe("an ANGLED joint: the outside corner fills, the inside corner does not overshoot", () => {
  const bend = (deg, side = 1) => {
    const a = (side * deg * Math.PI) / 180;
    return [road("W", [P(0, 0), P(200, 0)], 50), road("N", [P(200, 0), P(200 + 150 * Math.cos(a), 150 * Math.sin(a))], 24)];
  };
  for (const deg of [20, 45, 75, 100]) for (const side of [1, -1]) {
    it(`${deg}° turn, ${side > 0 ? "one way" : "the other"}`, async () => {
      const els = bend(deg, side);
      const { n } = await net(els);
      expect(n.regions).toHaveLength(1);
      const ring = n.regions[0].region.outer, h = OUT(24);
      const a = (side * deg * Math.PI) / 180;
      const tA = { x: 1, y: 0 }, tB = { x: Math.cos(a), y: Math.sin(a) };
      const nA = { x: -tA.y, y: tA.x }, nB = { x: -tB.y, y: tB.x };
      const s = side > 0 ? -1 : 1;                                        // outside of the bend (left turn → right-hand side)
      const bis = { x: nA.x + nB.x, y: nA.y + nB.y }, bl = Math.hypot(bis.x, bis.y);
      const u = { x: bis.x / bl, y: bis.y / bl };
      const J = P(200, 0);
      // OUTSIDE: points on both butt-end corners and just inside the miter / bevel edge are paved — no wedge gap
      for (const f of [0.97]) {
        expect(pointInRing({ x: J.x + s * nA.x * h * f, y: J.y + s * nA.y * h * f }, ring), "outer corner A").toBe(true);
        expect(pointInRing({ x: J.x + s * nB.x * h * f, y: J.y + s * nB.y * h * f }, ring), "outer corner B").toBe(true);
      }
      const mid = { x: (nA.x + nB.x) / 2, y: (nA.y + nB.y) / 2 };         // the chord's midpoint, between the two butt corners
      expect(pointInRing({ x: J.x + s * mid.x * h * 0.98, y: J.y + s * mid.y * h * 0.98 }, ring), "wedge middle").toBe(true);
      // EXCESS: everything the cover adds beyond the two strips themselves is the outside wedge and NOTHING else — so the inside corner
      // (where the strips already overlap) can neither overshoot nor gain a fill, however sharp the turn.
      const ringA = roadStripRing(els[0], SETTINGS, undefined, roundaboutsForSite(els, SETTINGS).trims.get("W"));
      const ringB = roadStripRing(els[1], SETTINGS, undefined, undefined);
      const stripsArea = unionArea([ringA, ringB]);
      const regionArea = Math.abs(areaOf(ring));
      const k = 1 + (nA.x * nB.x + nA.y * nB.y);
      const nBo = { x: -tB.y, y: tB.x };
      const poly = [J, { x: J.x + s * nA.x * h, y: J.y + s * nA.y * h }];
      const tip = { x: J.x + (s * h * (nA.x + nBo.x)) / k, y: J.y + (s * h * (nA.y + nBo.y)) / k };
      if (Math.hypot(tip.x - J.x, tip.y - J.y) <= 2 * h + 1e-6) poly.push(tip);
      poly.push({ x: J.x + s * nBo.x * h, y: J.y + s * nBo.y * h });
      const wedge = Math.abs(areaOf(poly));
      expect(regionArea - stripsArea).toBeGreaterThan(wedge * 0.85 - 1);          // the outside corner IS filled…
      expect(regionArea - stripsArea).toBeLessThan(wedge * 1.1 + 4);              // …and nothing more is (no inside overshoot, no spike)
      // a clean outline: no vertex near the joint reaches past the miter limit
      expect(Math.max(...ring.filter((p) => Math.hypot(p.x - J.x, p.y - J.y) < 60).map((p) => Math.hypot(p.x - J.x, p.y - J.y)))).toBeLessThanOrEqual(2 * h + 1e-6);
      expect(ring.every((p) => Number.isFinite(p.x))).toBe(true);
    });
  }
});

describe("live: moving a road end or a control point recomputes the taper", () => {
  it("drag the narrow road's start away and the taper disappears; drag it back and it returns", () => {
    const els = wideNarrow();
    expect(roundaboutsForSite(els, SETTINGS).trims.get("W").taper.e).toBeTruthy();
    const apart = [els[0], { ...els[1], pts: [P(230, 0), P(400, 0)] }];
    expect(roundaboutsForSite(apart, SETTINGS).trims.get("W")).toBeUndefined();
    const back = [els[0], { ...els[1], pts: [P(200, 0), P(400, 0)] }];
    expect(roundaboutsForSite(back, SETTINGS).trims.get("W").taper.e).toBeTruthy();
  });
  it("changing either width recomputes the taper target", () => {
    const els = wideNarrow();
    const t1 = roundaboutsForSite([els[0], { ...els[1], travelW: 30 }], SETTINGS).trims.get("W").taper.e;
    expect(t1.outerHalf).toBeCloseTo(OUT(30));
    const t2 = roundaboutsForSite([{ ...els[0], travelW: 80 }, els[1]], SETTINGS).trims.get("W").taper.e;
    expect(t2.reqFt).toBeCloseTo(TAPER_RATIO * (OUT(80) - OUT(24)));
    expect(t2.lenFt).toBe(200);                                          // clamped to the wide road's 200 ft last segment
  });
});

describe("right-of-way lines follow the taper when both roads designate a ROW", () => {
  it("the wide road's ROW line narrows to the narrow road's ROW; with no ROW on the narrow road it is left alone", () => {
    const xs = (row) => ({ bands: [{ type: "travel", w: 24 }], rowDesignFt: row });
    const els = [road("W", [P(0, 0), P(200, 0)], 50, { xsection: xs(100) }), road("N", [P(200, 0), P(400, 0)], 24, { xsection: xs(60) })];
    const t = roadTapersOf(els).byRoad.get("W").e;
    expect(t.rowHalf).toBeCloseTo(30);
    const bare = roadTapersOf([els[0], { ...els[1], xsection: undefined }]).byRoad.get("W").e;
    expect(bare.rowHalf).toBeNull();
  });
});
