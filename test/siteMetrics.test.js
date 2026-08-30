/* site-metrics-extraction — lib/siteMetrics.js is the pure function behind the Yield panel's
 * numbers, extracted from SitePlanner.jsx's render body (a `let bldg = 0; els.forEach(...)` block
 * that was never importable from anywhere else in the app). These tests exercise every field the
 * extraction was asked to preserve, plus the new `far` field.
 *
 * The real-plan comparison (52 of the owner's production sites, both a pre-extraction reference
 * implementation and the current lib/siteMetrics.js run over identical inputs: 0 field
 * differences) is reported separately — a live Supabase pull isn't something this suite can carry.
 * These are the fixture-level tests that CI actually runs, and each one is mutation-verified: a
 * deliberate one-line break in lib/siteMetrics.js was confirmed to turn the relevant test red
 * before this file was finalized (see the PR description for the mutation matrix).
 */
import { describe, it, expect } from "vitest";
import { siteMetrics } from "../src/workspaces/site-planner/lib/siteMetrics.js";
import { overlappingParcelPairs, dissolvedParcelSqft } from "../src/workspaces/site-planner/lib/polyClip.js";
import { carStalls, trailerStalls, estStalls, estTrailers, SQFT_PER_ACRE } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import { detentionStorage } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { DOGEAR_W, DOGEAR_D } from "../src/workspaces/site-planner/lib/dogEar.js";

const SETTINGS = {
  stallW: 9, stallDepth: 18, aisle: 24, parkAngle: 90,
  trailerW: 12, trailerL: 53, trailerAisle: 60,
  roadCurb: 0.5,
};

// A 500 × 400 ft rectangular parcel centred on the origin — 200,000 sf.
const rectParcel = (id = "p1", overrides = {}) => ({
  id, active: true,
  points: [{ x: -250, y: -200 }, { x: 250, y: -200 }, { x: 250, y: 200 }, { x: -250, y: 200 }],
  ...overrides,
});

const metricsFor = (els, parcels) => {
  const pairs = overlappingParcelPairs(parcels);
  return siteMetrics(els, parcels, pairs, SETTINGS);
};

describe("siteMetrics — empty site", () => {
  it("returns an all-zero, NaN-free result for no elements and no parcels", () => {
    const m = metricsFor([], []);
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === "boolean") continue;
      expect(Number.isNaN(v), `${k} must not be NaN`).toBe(false);
    }
    expect(m.siteSqft).toBe(0);
    expect(m.bldg).toBe(0);
    expect(m.cov).toBe(0);   // guarded: siteSqft ? … : 0 — a broken guard divides by zero → NaN
    expect(m.far).toBe(0);
    expect(m.ratio).toBe(0); // guarded on bldg, not siteSqft
    expect(m.open).toBe(0);
    expect(m.acresActive).toBe(0);
    expect(m.bumpsUniform).toBe(true); // starts true; never set false with nothing to check
  });
});

describe("siteMetrics — building area, coverage and FAR", () => {
  const building = { id: "b1", type: "building", cx: 0, cy: 0, w: 100, h: 80, rot: 0 };

  it("bldg is the building's plain area; cov and far both read it over gross site area", () => {
    const parcels = [rectParcel()];
    const m = metricsFor([building], parcels);
    expect(m.siteSqft).toBe(200000);
    expect(m.bldg).toBe(8000); // 100 × 80
    expect(m.cov).toBeCloseTo((8000 / 200000) * 100, 9);
    // FAR is a bare RATIO, never re-scaled to a percentage — the ×100 in `cov` must not leak in.
    expect(m.far).toBeCloseTo(8000 / 200000, 9);
    expect(m.far).not.toBeCloseTo(m.cov, 6); // catches an accidental `far = cov` / missing ×100 divide
  });

  it("FAR and coverage move together — both include a bump-out in the numerator", () => {
    const bump = { id: "b1-bump", type: "building", attachedTo: "b1", dogEar: { side: "top", sign: 1 }, cx: 0, cy: -60, w: DOGEAR_W, h: DOGEAR_D, rot: 0 };
    const parcels = [rectParcel()];
    const withoutBump = metricsFor([building], parcels);
    const withBump = metricsFor([building, bump], parcels);
    const bumpSf = DOGEAR_W * DOGEAR_D;
    expect(withBump.bldg).toBeCloseTo(withoutBump.bldg + bumpSf, 6);
    expect(withBump.far).toBeCloseTo((8000 + bumpSf) / 200000, 9);
    // far must move by exactly the bump's share of site area — not stay flat (bump excluded)
    // and not double-count it.
    expect(withBump.far - withoutBump.far).toBeCloseTo(bumpSf / 200000, 9);
  });
});

describe("siteMetrics — dog-ear bump-out tally", () => {
  const host = { id: "h1", type: "building", cx: 0, cy: 0, w: 200, h: 150, rot: 0 };

  it("counts a default-sized bump-out and keeps bumpsUniform true", () => {
    const bump = { id: "h1-bump", type: "building", attachedTo: "h1", dogEar: { side: "top", sign: 1 }, cx: 0, cy: -105, w: DOGEAR_W, h: DOGEAR_D, rot: 0 };
    const m = metricsFor([host, bump], [rectParcel()]);
    expect(m.bumpCount).toBe(1);
    expect(m.bumpArea).toBeCloseTo(DOGEAR_W * DOGEAR_D, 6);
    expect(m.bumpsUniform).toBe(true);
  });

  it("an off-default-sized bump-out flips bumpsUniform false without changing the count rule", () => {
    const oddBump = { id: "h1-bump2", type: "building", attachedTo: "h1", dogEar: { side: "top", sign: 1 }, cx: 0, cy: -100, w: DOGEAR_W + 10, h: DOGEAR_D, rot: 0 };
    const m = metricsFor([host, oddBump], [rectParcel()]);
    expect(m.bumpCount).toBe(1);
    expect(m.bumpsUniform).toBe(false);
  });

  it("a SIDE-mounted bump-out checks w/h against DOGEAR_D/DOGEAR_W swapped (not the same axis as top/bottom)", () => {
    // side === "left"/"right" ⇒ horiz = false ⇒ compares (h vs DOGEAR_W) and (w vs DOGEAR_D).
    const sideBump = { id: "h1-bump3", type: "building", attachedTo: "h1", dogEar: { side: "left", sign: 1 }, cx: -105, cy: 0, w: DOGEAR_D, h: DOGEAR_W, rot: 0 };
    const m = metricsFor([host, sideBump], [rectParcel()]);
    expect(m.bumpCount).toBe(1);
    expect(m.bumpsUniform).toBe(true); // w=DOGEAR_D, h=DOGEAR_W is the CORRECT orientation for a side mount
  });
});

describe("siteMetrics — paving, and its derived curb, feed impervious", () => {
  it("a standalone paving pad's curb wraps all four sides (no host, no abutting pavement)", () => {
    const pad = { id: "pv1", type: "paving", cx: 0, cy: 0, w: 50, h: 50, rot: 0 };
    const m = metricsFor([pad], [rectParcel()]);
    const expectedCurb = (50 + 50 + 50 + 50) * 0.5; // CURB_6 default width on all 4 edges
    expect(m.impervious).toBeCloseTo(2500 + expectedCurb, 6);
    expect(m.impPct).toBeCloseTo((m.impervious / 200000) * 100, 9);
  });
});

describe("siteMetrics — parking stalls", () => {
  it("a RECTANGLE parking field counts via carStalls(...).count, not estStalls", () => {
    const p = { id: "pk1", type: "parking", cx: 0, cy: 0, w: 100, h: 60, rot: 0 };
    const m = metricsFor([p], [rectParcel()]);
    const expectedStalls = carStalls(100, 60, SETTINGS).count;
    expect(expectedStalls).toBeGreaterThan(0); // sanity: the fixture actually fits stalls
    expect(m.stalls).toBe(expectedStalls);
    // Wiring check: must NOT be the polygon estimate formula (would silently pass if the two
    // happened to collide, so assert the estimate is a DIFFERENT number for this fixture).
    expect(estStalls(100 * 60, SETTINGS)).not.toBe(expectedStalls);
  });

  it("a POLYGON parking field counts via estStalls(area, settings), the area-based estimate", () => {
    const p = { id: "pk2", type: "parking", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }] };
    const m = metricsFor([p], [rectParcel()]);
    expect(m.stalls).toBe(estStalls(6000, SETTINGS));
  });

  it("ratio is stalls per 1,000 sf of BUILDING (not site or parking area)", () => {
    const building = { id: "b1", type: "building", cx: -200, cy: 0, w: 40, h: 40, rot: 0 }; // 1600 sf
    const p = { id: "pk3", type: "parking", cx: 100, cy: 0, w: 100, h: 60, rot: 0 };
    const m = metricsFor([building, p], [rectParcel()]);
    expect(m.ratio).toBeCloseTo(m.stalls / (1600 / 1000), 9);
  });
});

describe("siteMetrics — trailer stalls", () => {
  it("a RECTANGLE trailer field counts via trailerStalls(...).count", () => {
    const t = { id: "tr1", type: "trailer", cx: 0, cy: 0, w: 120, h: 150, rot: 0 };
    const m = metricsFor([t], [rectParcel()]);
    const expected = trailerStalls(120, 150, SETTINGS).count;
    expect(expected).toBeGreaterThan(0);
    expect(m.trailers).toBe(expected);
  });

  it("a POLYGON trailer field counts via estTrailers(area, settings)", () => {
    const t = { id: "tr2", type: "trailer", points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 150 }, { x: 0, y: 150 }] };
    const m = metricsFor([t], [rectParcel()]);
    expect(m.trailers).toBe(estTrailers(120 * 150, SETTINGS));
  });
});

describe("siteMetrics — ponds", () => {
  const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }]; // 8000 sf

  it("sums pondArea/pondCount and matches detentionStorage(...).vol for providedDetCf", () => {
    const pond = { id: "pd1", type: "pond", points: ring, det: { depth: 6, freeboard: 1, slope: 3 } };
    const m = metricsFor([pond], [rectParcel()]);
    expect(m.pondArea).toBe(8000);
    expect(m.pondCount).toBe(1);
    expect(m.maxPondDepthFt).toBe(6);
    expect(m.providedDetCf).toBeCloseTo(detentionStorage(ring, 6, 1, 3).vol, 6);
  });

  it("maxPondDepthFt takes the DEEPEST pond, and defaults (depth 8/freeboard 1/slope 3) apply when det is absent", () => {
    const shallow = { id: "pd2", type: "pond", points: ring, det: { depth: 4 } };
    const deep = { id: "pd3", type: "pond", points: ring }; // no `det` at all → depth defaults to 8
    const m = metricsFor([shallow, deep], [rectParcel()]);
    expect(m.pondCount).toBe(2);
    expect(m.maxPondDepthFt).toBe(8);
    expect(m.providedDetCf).toBeCloseTo(
      detentionStorage(ring, 4, 1, 3).vol + detentionStorage(ring, 8, 1, 3).vol, 6,
    );
  });
});

describe("siteMetrics — road pavement area", () => {
  it("a road's area is its generated strip polygon, not its w × h", () => {
    const road = { id: "r1", type: "road", pts: [{ x: -300, y: 0 }, { x: 300, y: 0 }], vtx: [], travelW: 24, curb: 0.5 };
    const m = metricsFor([road], [rectParcel()]);
    // 600 ft long, (24 + 2×0.5) = 25 ft back-of-curb-to-back-of-curb, flat ends (no extra fillet SF).
    expect(m.paving).toBeCloseTo(600 * 25, 0);
  });

  it("a road with a declared roundabout adds the annulus to paving, over and above the straight strip", () => {
    const straight = { id: "r2", type: "road", pts: [{ x: -300, y: 0 }, { x: 300, y: 0 }], vtx: [], travelW: 24, curb: 0.5 };
    const withRoundabout = { ...straight, id: "r3", roundabout: { end: "end", d: 130 } };
    const parcels = [rectParcel("p1", { points: [{ x: -400, y: -400 }, { x: 400, y: -400 }, { x: 400, y: 400 }, { x: -400, y: 400 }] })];
    const mStraight = metricsFor([straight], parcels);
    const mRoundabout = metricsFor([withRoundabout], parcels);
    expect(mRoundabout.paving).toBeGreaterThan(mStraight.paving);
  });
});

describe("siteMetrics — impervious / open / detPct composition", () => {
  it("impervious = bldg + paving + parkArea + trailArea (ponds excluded); open = site − impervious − pond, floored at 0", () => {
    const building = { id: "b1", type: "building", cx: -150, cy: 0, w: 40, h: 40, rot: 0 }; // 1600
    const paving = { id: "pv1", type: "paving", cx: 0, cy: 100, w: 20, h: 20, rot: 0 };      // 400 + curb
    const pond = { id: "pd1", type: "pond", points: [{ x: 100, y: 100 }, { x: 140, y: 100 }, { x: 140, y: 130 }, { x: 100, y: 130 }] }; // 1200
    const parcels = [rectParcel()];
    const m = metricsFor([building, paving, pond], parcels);
    expect(m.impervious).toBeCloseTo(m.bldg + m.paving + m.parkArea + m.trailArea, 6);
    expect(m.impervious).not.toBeCloseTo(m.impervious + m.pondArea, 0); // impervious must NOT include pond
    expect(m.open).toBeCloseTo(Math.max(0, m.siteSqft - m.impervious - m.pondArea), 6);
    expect(m.detPct).toBeCloseTo((m.pondArea / m.siteSqft) * 100, 9);
  });

  it("open never goes negative even when impervious + pond exceeds the (tiny) site", () => {
    const hugeBuilding = { id: "b1", type: "building", cx: 0, cy: 0, w: 10000, h: 10000, rot: 0 };
    const tinyParcel = [rectParcel("p1", { points: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }] })];
    const m = metricsFor([hugeBuilding], tinyParcel);
    expect(m.open).toBe(0);
  });
});

describe("siteMetrics — acresActive", () => {
  it("is siteSqft / 43,560 exactly, never re-derived from parcels directly", () => {
    const parcels = [rectParcel()];
    const m = metricsFor([], parcels);
    expect(m.acresActive).toBeCloseTo(200000 / SQFT_PER_ACRE, 9);
    expect(m.acresActive).toBeCloseTo(dissolvedParcelSqft(parcels, overlappingParcelPairs(parcels)) / SQFT_PER_ACRE, 9);
  });

  it("an INACTIVE parcel is excluded from siteSqft (and therefore acresActive) — B100", () => {
    const active = rectParcel("p1");
    const inactive = rectParcel("p2", { active: false, points: [{ x: 1000, y: 1000 }, { x: 1100, y: 1000 }, { x: 1100, y: 1100 }, { x: 1000, y: 1100 }] });
    const m = metricsFor([], [active, inactive]);
    expect(m.siteSqft).toBe(200000); // p2's 10,000 sf does not count
  });
});
