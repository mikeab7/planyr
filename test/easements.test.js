import { describe, it, expect } from "vitest";
import { offsetPolyline, bufferPolyline } from "../src/workspaces/site-planner/lib/metesAndBounds.js";
import {
  EASEMENT_TYPES, easementType, easementColor, easementLabel, DEFAULT_EASEMENT_ATTRS,
  ringArea, deriveEasementRing, easementArea, buildParcelEdgeStrip,
} from "../src/workspaces/site-planner/lib/easements.js";
import {
  createSiteModel, EASEMENT_KINDS, easementsOf, exclusionZonesOf,
  constraintsOf, developableArea,
} from "../src/workspaces/site-planner/lib/siteModel.js";

// A unit square parcel (clockwise in the planner frame: +y is south).
const SQUARE = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

describe("offset engine (metesAndBounds offsetPolyline / bufferPolyline)", () => {
  it("offsetPolyline shifts a straight line by the signed distance along its left normal", () => {
    // a west→east line; in the planner frame (+y south) its left normal is (0,+1)
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const left = offsetPolyline(line, 10);
    expect(left.map((p) => p.y)).toEqual([10, 10]);     // +dist → one side
    const right = offsetPolyline(line, -10);
    expect(right.map((p) => p.y)).toEqual([-10, -10]);  // −dist → the other side
    expect(offsetPolyline([{ x: 0, y: 0 }], 5)).toBeNull(); // needs ≥ 2 points
  });

  it("bufferPolyline (symmetric, unchanged default) makes a strip of total width w", () => {
    const ring = bufferPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 20);
    expect(ring).toHaveLength(4);
    // straight run: area = length × width
    expect(ringArea(ring)).toBeCloseTo(100 * 20, 4);
  });

  it("bufferPolyline accepts ASYMMETRIC half-widths without changing the symmetric default (NEW-1 engine note)", () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const asym = bufferPolyline(line, 0, { leftW: 5, rightW: 15 });
    expect(ringArea(asym)).toBeCloseTo(100 * 20, 4); // total width still 20
    // the two sides sit 5 and 15 ft off the centerline (orientation-independent)
    const mags = [...new Set(asym.map((p) => Math.abs(Math.round(p.y))))].sort((a, b) => a - b);
    expect(mags).toEqual([5, 15]);
  });
});

describe("easement type catalog + derived label", () => {
  it("every type has a key/label/short/color and easementType falls back to 'other'", () => {
    for (const t of EASEMENT_TYPES) {
      expect(t.key && t.label && t.short && /^#/.test(t.color)).toBeTruthy();
    }
    expect(easementType("nope").key).toBe("other");
    expect(easementColor({ easeType: "sanitary" })).toBe(easementType("sanitary").color);
  });

  it("label is derived from width + type for strips, type-only for boundaries", () => {
    expect(easementLabel({ mode: "centerline", easeType: "sanitary", width: 16 })).toBe("16′ Sanitary Sewer Esmt");
    expect(easementLabel({ mode: "boundary", easeType: "sanitary", width: 16 })).toBe("Sanitary Sewer Esmt");
    expect(easementLabel({ mode: "centerline", easeType: "utility", width: 10 })).toBe("10′ Utility Esmt");
  });

  it("a labelOverride (the relabel affordance) always wins", () => {
    expect(easementLabel({ mode: "centerline", easeType: "utility", width: 10, labelOverride: "WL-A" })).toBe("WL-A");
    expect(easementLabel({ easeType: "utility", labelOverride: "   " })).toBe("Utility Esmt"); // blank override ignored
  });

  it("DEFAULT_EASEMENT_ATTRS restricts buildings but not paving by default", () => {
    expect(DEFAULT_EASEMENT_ATTRS.restrictsBuildings).toBe(true);
    expect(DEFAULT_EASEMENT_ATTRS.restrictsPaving).toBe(false);
    expect(DEFAULT_EASEMENT_ATTRS.status).toBe("existing");
  });
});

describe("ring geometry + per-mode derivation", () => {
  it("ringArea is the shoelace area (0 for degenerate rings)", () => {
    expect(ringArea(SQUARE)).toBeCloseTo(10000, 6);
    expect(ringArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });

  it("deriveEasementRing: boundary returns the polygon; centerline returns the strip", () => {
    expect(deriveEasementRing({ mode: "boundary", pts: SQUARE })).toBe(SQUARE);
    const strip = deriveEasementRing({ mode: "centerline", centerline: [{ x: 0, y: 0 }, { x: 50, y: 0 }], width: 10 });
    expect(ringArea(strip)).toBeCloseTo(500, 4);
    expect(easementArea({ mode: "boundary", pts: SQUARE })).toBeCloseTo(10000, 6);
  });
});

describe("NEW-3 parcel-edge strip", () => {
  it("insets a one-sided strip from a single chosen edge, INTO the parcel", () => {
    // edge 0 = points[0]→points[1] = the north (y=0) edge of the square
    const res = buildParcelEdgeStrip(SQUARE, [0], 10);
    expect(res).not.toBeNull();
    expect(ringArea(res.ring)).toBeCloseTo(100 * 10, 3); // 100-ft edge × 10-ft inset
    // the inner offset must land inside the parcel (offsetSide chosen toward interior)
    const innerMidY = res.ring[2].y; // a vertex on the offset side
    expect(innerMidY).toBeGreaterThan(0); // inset moved south, into the square
  });

  it("mitres a two-edge corner run and rejects a non-contiguous or whole-boundary selection", () => {
    const corner = buildParcelEdgeStrip(SQUARE, [0, 1], 10); // north + east edges (a turn)
    expect(corner).not.toBeNull();
    expect(corner.run).toHaveLength(3); // 3 vertices across the 2-edge run
    expect(buildParcelEdgeStrip(SQUARE, [0, 2], 10)).toBeNull();   // not contiguous
    expect(buildParcelEdgeStrip(SQUARE, [0, 1, 2, 3], 10)).toBeNull(); // whole boundary, not a run
    expect(buildParcelEdgeStrip(SQUARE, [0], 0)).toBeNull();       // no width
  });
});

describe("siteModel easement selectors + NEW-4 exclusion hook", () => {
  const ease = {
    id: "x1", kind: "easement", mode: "boundary", pts: SQUARE,
    easeType: "sanitary", restrictsBuildings: true, restrictsPaving: false, status: "proposed",
  };
  const pave = { id: "x2", kind: "easement", mode: "boundary", pts: SQUARE, easeType: "access", restrictsBuildings: false, restrictsPaving: true };
  const m = createSiteModel({ markups: [ease, pave, { id: "n", kind: "polygon", pts: SQUARE }] });

  it("'easement' is a constraint kind and easementsOf filters to the first-class objects", () => {
    expect(EASEMENT_KINDS).toContain("easement");
    expect(easementsOf(m).map((e) => e.id)).toEqual(["x1", "x2"]);
    expect(constraintsOf(m).easements.map((e) => e.id)).toEqual(["x1", "x2"]); // both flow into constraints
  });

  it("exclusionZonesOf exposes ring + restriction flags for the buildable-area engine", () => {
    const zones = exclusionZonesOf(m);
    expect(zones).toHaveLength(2);
    const z1 = zones.find((z) => z.id === "x1");
    expect(z1.restrictsBuildings).toBe(true);
    expect(z1.restrictsPaving).toBe(false);
    expect(z1.ring).toHaveLength(4);
    const z2 = zones.find((z) => z.id === "x2");
    expect(z2.restrictsBuildings).toBe(false);
    expect(z2.restrictsPaving).toBe(true);
  });

  it("a missing flag falls back to the defaults (blocks buildings, allows paving)", () => {
    const bare = createSiteModel({ markups: [{ id: "b", kind: "easement", mode: "boundary", pts: SQUARE }] });
    const [z] = exclusionZonesOf(bare);
    expect(z.restrictsBuildings).toBe(true);
    expect(z.restrictsPaving).toBe(false);
  });

  it("developableArea now surfaces the exclusion zones (hook in place, envelope still reserved)", () => {
    const d = developableArea(m);
    expect(d.available).toBeNull();
    expect(d.exclusions).toHaveLength(2);
  });

  it("an easement with too-few points is dropped from exclusion zones (no garbage geometry)", () => {
    const bad = createSiteModel({ markups: [{ id: "z", kind: "easement", mode: "boundary", pts: [{ x: 0, y: 0 }] }] });
    expect(exclusionZonesOf(bad)).toEqual([]);
  });
});
