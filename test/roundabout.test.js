/* NEW-5 — roundabout geometry + the class→diameter derivation.
 *
 * The owner's one hard condition on this feature: "do not ship a decorative circle that the pavement
 * math and the curb engine do not know about." These tests are that condition, asserted:
 *   • the DERIVATION really does give an auto aisle, a fire lane and a WB-67 truck route different
 *     circles, and never sizes one off a number that isn't a turning radius;
 *   • the PAVED area is the annulus and never the disc, and the leg trim is what keeps the leg strip
 *     off the island;
 *   • the annulus really does dissolve to one region with the island as a genuine HOLE, through the
 *     same union the rest of the road network goes through;
 *   • a curb return is really tangent to both the leg edge and the circle — not a triangle.
 */
import { describe, it, expect } from "vitest";
import {
  ROUNDABOUT_BANDS, ROUNDABOUT_MIN_D, ROUNDABOUT_MAX_D,
  circulatoryWidthFt, roundaboutDiameterFor, roundaboutBandFor, normalizeRoundaboutD,
  legTrimFor, roundaboutArea, roundaboutIslandArea, circleRing, annulusSectors,
  legReturnWedges, roundaboutNodes, roundaboutGeometry, trimPolylineEnds,
} from "../src/workspaces/site-planner/lib/roundabout.js";
import { ROAD_CLASS_SEEDS, roadClassOf, classMinRadius } from "../src/workspaces/site-planner/lib/roadClasses.js";
import { dissolveRings } from "../src/workspaces/site-planner/lib/roadNetwork.js";

const cls = (key) => roadClassOf({}, key);
const ringArea = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2);

describe("the design vehicle decides the circle (roundaboutDiameterFor)", () => {
  it("gives an auto aisle, a fire lane and a WB-67 truck route three DIFFERENT diameters", () => {
    const aisle = roundaboutDiameterFor(cls("aisle"), 24);
    const fire = roundaboutDiameterFor(cls("fire"), 24);
    const truck = roundaboutDiameterFor(cls("truck"), 30);
    expect(new Set([aisle, fire, truck]).size).toBe(3);
    // …and they are ordered by how big the vehicle is, which is the whole claim.
    expect(aisle).toBeLessThan(fire);
    expect(fire).toBeLessThan(truck);
  });

  it("keeps every class inside its published FHWA band", () => {
    for (const seed of ROAD_CLASS_SEEDS) {
      const d = roundaboutDiameterFor(cls(seed.key), 24);
      const band = roundaboutBandFor(cls(seed.key));
      expect(d, seed.key).toBeGreaterThanOrEqual(band.min);
      expect(d, seed.key).toBeLessThanOrEqual(band.max);
    }
  });

  it("does NOT derive the public/collector circle from its speed-based curve radius", () => {
    // `public`'s minRadius is a horizontal CURVE radius (~185 ft at 25 mph), not a turning radius.
    // Feeding it to 2·Rt + W would give a ~390 ft circle on a site road — the exact category error
    // the band's `fixed` value exists to prevent.
    expect(classMinRadius(cls("public"))).toBeGreaterThan(150);
    expect(roundaboutDiameterFor(cls("public"), 24)).toBe(ROUNDABOUT_BANDS.public.fixed);
  });

  it("an unknown class still returns a usable diameter rather than 0", () => {
    const d = roundaboutDiameterFor({ key: "nope", minRadius: 0 }, 24);
    expect(d).toBeGreaterThanOrEqual(ROUNDABOUT_MIN_D);
  });

  it("normalizeRoundaboutD clamps a hand-typed value and falls back on nonsense", () => {
    expect(normalizeRoundaboutD(120, 90)).toBe(120);
    expect(normalizeRoundaboutD(1, 90)).toBe(ROUNDABOUT_MIN_D);
    expect(normalizeRoundaboutD(99999, 90)).toBe(ROUNDABOUT_MAX_D);
    for (const bad of [null, undefined, "", NaN, -5, 0]) expect(normalizeRoundaboutD(bad, 90)).toBe(90);
  });

  it("the circulatory width is one lane at minimum and never implies a multi-lane circle", () => {
    expect(circulatoryWidthFt(0)).toBe(20);      // no approach width known → a single lane
    expect(circulatoryWidthFt(12)).toBe(16);     // floored
    expect(circulatoryWidthFt(24)).toBe(24);
    expect(circulatoryWidthFt(80)).toBe(30);     // capped
  });
});

describe("the pavement math knows about it", () => {
  it("PAVED area is the annulus, never the disc — the island is landscaped, not impervious", () => {
    const d = 130, W = circulatoryWidthFt(30);
    const R = d / 2, ri = R - W;
    expect(roundaboutArea(d, 30)).toBeCloseTo(Math.PI * (R * R - ri * ri), 6);
    expect(roundaboutArea(d, 30)).toBeLessThan(Math.PI * R * R);
    expect(roundaboutIslandArea(d, 30)).toBeCloseTo(Math.PI * ri * ri, 6);
    // The two together are the whole disc — no area is lost or double-counted.
    expect(roundaboutArea(d, 30) + roundaboutIslandArea(d, 30)).toBeCloseTo(Math.PI * R * R, 6);
  });

  it("a circle narrower than one circulatory width is solid pavement, with no island", () => {
    expect(roundaboutIslandArea(30, 24)).toBe(0);
    expect(roundaboutArea(30, 24)).toBeCloseTo(Math.PI * 15 * 15, 6);
  });

  it("the leg trim is the HALF-CHORD, not the radius — so the strip meets the circle flush", () => {
    // A zero-width leg degenerates to the radius; a real one is trimmed slightly less so its square
    // end face lands ON the arc across its full width instead of poking past it at the corners.
    expect(legTrimFor(130, 0, 30)).toBe(65);
    expect(legTrimFor(130, 15.5, 30)).toBeCloseTo(Math.sqrt(65 * 65 - 15.5 * 15.5), 9);
    expect(legTrimFor(130, 15.5, 30)).toBeLessThan(65);
    expect(legTrimFor(0, 15.5, 30)).toBe(0);
    expect(legTrimFor(null, 15.5, 30)).toBe(0);
  });

  it("the trim can never be pulled in far enough to reach the central island", () => {
    // An absurdly wide leg would drive √(R²−half²) toward 0; the island radius is the floor.
    expect(legTrimFor(130, 200, 30)).toBe(35);   // islandR = 65 − 30
  });

  it("area is 0 for a degenerate diameter rather than NaN", () => {
    for (const bad of [0, -1, null, undefined, NaN]) expect(roundaboutArea(bad, 24)).toBe(0);
  });
});

describe("the curb engine knows about it — the annulus dissolves to one region with a real hole", () => {
  it("the sectors union to an annulus: one region, one hole, right areas", () => {
    const c = { x: 0, y: 0 }, R = 65, ri = 65 - 24;
    const regions = dissolveRings(annulusSectors(c, R, ri, { tessDeg: 4 }));
    expect(regions.length).toBe(1);
    expect(regions[0].holes.length).toBe(1);
    // Within tessellation error of the true annulus (a polygon inscribed in a circle is smaller).
    const outerA = ringArea(regions[0].outer), holeA = ringArea(regions[0].holes[0]);
    expect(outerA).toBeGreaterThan(Math.PI * R * R * 0.97);
    expect(outerA).toBeLessThanOrEqual(Math.PI * R * R * 1.02);
    expect(holeA).toBeGreaterThan(Math.PI * ri * ri * 0.93);
  });

  it("a leg strip running into the circle dissolves to ONE region — still with its island", () => {
    const c = { x: 0, y: 0 }, R = 65, ri = 41;
    // A leg approaching from the east, trimmed at the circle exactly as legTrimFor prescribes.
    const half = 20;
    const leg = [
      { x: R, y: -half }, { x: R + 300, y: -half }, { x: R + 300, y: half }, { x: R, y: half },
    ];
    const regions = dissolveRings([...annulusSectors(c, R, ri, { tessDeg: 4 }), leg]);
    expect(regions.length).toBe(1);
    expect(regions[0].holes.length).toBe(1);
    expect(ringArea(regions[0].holes[0])).toBeGreaterThan(Math.PI * ri * ri * 0.9);
  });

  it("a leg that ran to the CENTRE would pave the island — which is what the trim prevents", () => {
    const c = { x: 0, y: 0 }, R = 65, ri = 41, half = 20;
    const sectors = annulusSectors(c, R, ri, { tessDeg: 4 });
    const trimmed = [{ x: R, y: -half }, { x: R + 300, y: -half }, { x: R + 300, y: half }, { x: R, y: half }];
    const untrimmed = [{ x: -5, y: -half }, { x: R + 300, y: -half }, { x: R + 300, y: half }, { x: -5, y: half }];
    const holeArea = (rings) => {
      const rs = dissolveRings(rings);
      return rs.reduce((s, r) => s + r.holes.reduce((t, h) => t + ringArea(h), 0), 0);
    };
    const kept = holeArea([...sectors, trimmed]);
    const paved = holeArea([...sectors, untrimmed]);
    // The trimmed leg leaves the island whole; the untrimmed one eats a third of it and counts that
    // land as impervious pavement — "a circle pasted over the road end", measured.
    expect(kept).toBeGreaterThan(Math.PI * ri * ri * 0.9);
    expect(paved).toBeLessThan(kept * 0.75);
  });

  it("circleRing closes a real circle at the requested radius", () => {
    const r = circleRing({ x: 10, y: -4 }, 50, 6);
    expect(r.length).toBeGreaterThanOrEqual(60);
    for (const p of r) expect(Math.hypot(p.x - 10, p.y + 4)).toBeCloseTo(50, 6);
  });

  it("annulusSectors refuses a degenerate ring instead of emitting junk", () => {
    expect(annulusSectors({ x: 0, y: 0 }, 10, 10)).toEqual([]);
    expect(annulusSectors({ x: 0, y: 0 }, 10, 20)).toEqual([]);
    expect(annulusSectors({ x: 0, y: 0 }, 0, 0)).toEqual([]);
  });
});

describe("curb returns are tangent to BOTH the leg edge and the circle", () => {
  const c = { x: 0, y: 0 }, R = 65, Rr = 25, half = 20;
  const leg = { u: { x: 1, y: 0 }, half };

  it("emits one return per leg edge", () => {
    expect(legReturnWedges(c, R, leg, Rr).length).toBe(2);
  });

  it("every arc point is exactly Rr from a centre that is (R+Rr) out and (half+Rr) off the axis", () => {
    for (const poly of legReturnWedges(c, R, leg, Rr, 3)) {
      // The arc is the leading run of the polygon (the two closing points are interior by design).
      const arc = poly.slice(0, poly.length - 2);
      // Recover the fillet centre from three arc points and check both tangency conditions.
      const [a, b] = [arc[0], arc[arc.length - 1]];
      const mid = arc[Math.floor(arc.length / 2)];
      const F = circumcentre(a, mid, b);
      expect(Math.hypot(F.x - c.x, F.y - c.y)).toBeCloseTo(R + Rr, 4);   // tangent to the circle
      expect(Math.abs(F.y)).toBeCloseTo(half + Rr, 4);                    // tangent to the leg edge
      for (const p of arc) expect(Math.hypot(p.x - F.x, p.y - F.y)).toBeCloseTo(Rr, 3);
    }
  });

  it("omits a return it cannot solve rather than faking one (a leg wider than the circle)", () => {
    expect(legReturnWedges(c, 20, { u: { x: 1, y: 0 }, half: 200 }, 25)).toEqual([]);
    expect(legReturnWedges(c, 0, leg, 25)).toEqual([]);
    expect(legReturnWedges(c, R, leg, 0)).toEqual([]);
    expect(legReturnWedges(c, R, null, 25)).toEqual([]);
  });
});

describe("bonding: the node owns the circle, and a second road joins it as a LEG", () => {
  const road = (id, pts, extra = {}) => ({ id, pts, travelW: 24, curbW: 0.5, ...extra });

  it("one declared roundabout gives one node with one leg pointing back down the road", () => {
    const r = road("a", [{ x: 0, y: 0 }, { x: 300, y: 0 }], { roundabout: { end: "end", d: 130 } });
    const nodes = roundaboutNodes([r]);
    expect(nodes.length).toBe(1);
    expect(nodes[0].center).toEqual({ x: 300, y: 0 });
    expect(nodes[0].d).toBe(130);
    expect(nodes[0].legs.length).toBe(1);
    // `u` points AWAY from the circle, back along the approach.
    expect(nodes[0].legs[0].u.x).toBeCloseTo(-1, 9);
    expect(nodes[0].legs[0].half).toBeCloseTo(12.5, 9);
  });

  it("a SECOND road ending at the same node joins as another leg — never a second circle", () => {
    const a = road("a", [{ x: 0, y: 0 }, { x: 300, y: 0 }], { roundabout: { end: "end", d: 130 } });
    const b = road("b", [{ x: 300, y: 400 }, { x: 300, y: 0.4 }], { roundabout: { end: "end", d: 90 } });
    const nodes = roundaboutNodes([a, b], { nodeTolFt: 2 });
    expect(nodes.length).toBe(1);
    expect(nodes[0].legs.length).toBe(2);
    expect(nodes[0].roadIds.sort()).toEqual(["a", "b"]);
    // The LARGER circle wins: a truck leg and an aisle leg at one node must get the truck's circle.
    expect(nodes[0].d).toBe(130);
  });

  it("two roundabouts far apart stay two nodes", () => {
    const a = road("a", [{ x: 0, y: 0 }, { x: 300, y: 0 }], { roundabout: { end: "end", d: 130 } });
    const b = road("b", [{ x: 900, y: 0 }, { x: 1200, y: 0 }], { roundabout: { end: "end", d: 90 } });
    expect(roundaboutNodes([a, b]).length).toBe(2);
  });

  it("`end: start` reads the other terminus", () => {
    const a = road("a", [{ x: 0, y: 0 }, { x: 300, y: 0 }], { roundabout: { end: "start", d: 130 } });
    const n = roundaboutNodes([a])[0];
    expect(n.center).toEqual({ x: 0, y: 0 });
    expect(n.legs[0].u.x).toBeCloseTo(1, 9);
  });

  it("the roundabout MOVES with its road — the geometry is derived, never a second copy", () => {
    const at = (x) => roundaboutNodes([road("a", [{ x: 0, y: 0 }, { x, y: 0 }], { roundabout: { end: "end", d: 130 } })])[0];
    expect(at(300).center.x).toBe(300);
    expect(at(555).center.x).toBe(555);
  });

  it("falls back to the class-derived diameter when the road stores none", () => {
    const a = road("a", [{ x: 0, y: 0 }, { x: 300, y: 0 }], { roundabout: { end: "end" } });
    expect(roundaboutNodes([a]).length).toBe(0);                         // no diameter, no derivation → nothing
    const n = roundaboutNodes([a], { diameterFor: () => 120 })[0];
    expect(n.d).toBe(120);
  });

  it("ignores a declaration on a degenerate or too-short road", () => {
    expect(roundaboutNodes([{ id: "x", pts: [{ x: 0, y: 0 }], roundabout: { end: "end", d: 130 } }])).toEqual([]);
    expect(roundaboutNodes([{ id: "x", pts: null, roundabout: { end: "end", d: 130 } }])).toEqual([]);
    expect(roundaboutNodes([{ id: "x", pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }], roundabout: { end: "end", d: 10 } }])).toEqual([]);
    expect(roundaboutNodes(null)).toEqual([]);
  });
});

describe("roundaboutGeometry composes the whole thing", () => {
  it("returns the rings the dissolve needs plus the areas the panel reads", () => {
    const node = roundaboutNodes([{ id: "a", pts: [{ x: 0, y: 0 }, { x: 300, y: 0 }], travelW: 30, curbW: 0.5, roundabout: { end: "end", d: 130 } }])[0];
    const g = roundaboutGeometry(node, { travelWFt: 30, returnR: 25, tessDeg: 6 });
    expect(g.R).toBe(65);
    expect(g.islandR).toBe(65 - 30);
    expect(g.sectors.length).toBeGreaterThan(3);
    expect(g.island).toBeTruthy();
    expect(g.returns.length).toBe(2);
    expect(g.area).toBeCloseTo(roundaboutArea(130, 30), 6);
    expect(g.islandArea).toBeCloseTo(roundaboutIslandArea(130, 30), 6);
    // And the whole thing — circle, returns AND the leg strip trimmed at `legTrimFor` — dissolves to
    // ONE region with the island still a hole. That is claim (2): one continuous curb outline.
    // The circle is centred on the road's TERMINUS (300, 0) and the leg approaches from the west,
    // so the leg strip runs from x = 0 up to the trim point — the circle's edge, not the centre.
    const half = 15.5, stop = 300 - legTrimFor(130, half, 30);
    const legStrip = [{ x: 0, y: -half }, { x: stop, y: -half }, { x: stop, y: half }, { x: 0, y: half }];
    const regions = dissolveRings([...g.sectors, ...g.returns, legStrip]);
    expect(regions.length).toBe(1);
    expect(regions[0].holes.length).toBe(1);
    expect(ringArea(regions[0].holes[0])).toBeGreaterThan(Math.PI * g.islandR * g.islandR * 0.9);
  });

  it("refuses a node it cannot build rather than returning a broken shape", () => {
    expect(roundaboutGeometry(null, {})).toBeNull();
    expect(roundaboutGeometry({ center: { x: 0, y: 0 }, d: 5, legs: [] }, {})).toBeNull();
  });
});

/* Circumcentre of three points — used only to RECOVER a fillet centre in the tangency test, so the
 * assertion is about the emitted geometry rather than about the code that produced it. */
function circumcentre(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const ux = ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d;
  const uy = ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d;
  return { x: ux, y: uy };
}

describe("trimPolylineEnds — one decision, taken by the strip, the stripes and the area", () => {
  it("shortens from either end and keeps the interior", () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
    const t = trimPolylineEnds(line, 0, 65);
    expect(t[t.length - 1].x).toBeCloseTo(135, 9);
    expect(t[0]).toEqual({ x: 0, y: 0 });
    const s = trimPolylineEnds(line, 30, 0);
    expect(s[0].x).toBeCloseTo(30, 9);
    expect(s[s.length - 1].x).toBe(200);
  });
  it("is identity when there is nothing to trim, and never returns nothing", () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(trimPolylineEnds(line, 0, 0)).toBe(line);
    expect(trimPolylineEnds(line, 0, 9999).length).toBeGreaterThanOrEqual(2);
    expect(trimPolylineEnds([{ x: 0, y: 0 }], 5, 5).length).toBe(1);
  });
});
