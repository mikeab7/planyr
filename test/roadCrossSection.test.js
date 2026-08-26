import { describe, it, expect } from "vitest";
import {
  BAND_TYPES, BAND_TYPE_BY_KEY, DEFAULT_BAND_TYPE, bandTypeOf, normalizeBands, makeXSection,
  xsectionFromRoad, hasXSection, curbToCurbWidth, pavedWidth, rowWidth, pavementArea, bandLayout,
  bandStripeMarks, BUILT_IN_XSECTION_PRESETS,
} from "../src/workspaces/site-planner/lib/roadCrossSection.js";

const OWNER_EXAMPLE = [
  { type: "travel", w: 12 }, { type: "travel", w: 12 }, { type: "median", w: 20 },
  { type: "travel", w: 12 }, { type: "travel", w: 12 },
];

describe("normalizeBands", () => {
  it("keeps valid bands as-is", () => {
    expect(normalizeBands(OWNER_EXAMPLE)).toEqual(OWNER_EXAMPLE);
  });
  it("falls back an unknown type to the default type", () => {
    expect(normalizeBands([{ type: "bogus", w: 10 }])).toEqual([{ type: DEFAULT_BAND_TYPE, w: 10 }]);
  });
  it("falls back a missing/invalid width to the type's default", () => {
    expect(normalizeBands([{ type: "median" }])).toEqual([{ type: "median", w: bandTypeOf("median").defaultFt }]);
    expect(normalizeBands([{ type: "median", w: -5 }])).toEqual([{ type: "median", w: bandTypeOf("median").defaultFt }]);
    expect(normalizeBands([{ type: "median", w: 0 }])).toEqual([{ type: "median", w: bandTypeOf("median").defaultFt }]);
  });
  it("drops null/undefined entries and non-array input", () => {
    expect(normalizeBands([null, { type: "travel", w: 12 }, undefined])).toEqual([{ type: "travel", w: 12 }]);
    expect(normalizeBands(null)).toEqual([]);
    expect(normalizeBands(undefined)).toEqual([]);
  });
});

describe("BAND_TYPES coverage — the brief's minimum list", () => {
  const required = ["travel", "median", "turnLane", "shoulder", "curbGutter", "parking", "bike", "sidewalk", "parkway", "ditch"];
  it("supports every band type named in the brief", () => {
    for (const key of required) expect(BAND_TYPE_BY_KEY[key]).toBeTruthy();
  });
});

describe("xsectionFromRoad — the dialog's starting point, never a stored migration", () => {
  it("a road with no xsection maps to a single travel-lane band of its travelW", () => {
    const x = xsectionFromRoad({ type: "road", travelW: 30 });
    expect(x.bands).toEqual([{ type: "travel", w: 30 }]);
  });
  it("a road with no xsection and no travelW defaults to 24'", () => {
    expect(xsectionFromRoad({ type: "road" }).bands).toEqual([{ type: "travel", w: 24 }]);
  });
  it("a road that already carries an xsection returns it untouched (normalized)", () => {
    const x = xsectionFromRoad({ type: "road", travelW: 999, xsection: { bands: OWNER_EXAMPLE } });
    expect(x.bands).toEqual(OWNER_EXAMPLE);
  });
});

describe("curbToCurbWidth / pavedWidth / rowWidth — the owner's worked example", () => {
  const x = makeXSection(OWNER_EXAMPLE);
  it("curb-to-curb sums every within-curb band (median included — it sits between the curbs)", () => {
    expect(curbToCurbWidth(x)).toBe(12 + 12 + 20 + 12 + 12); // 68
  });
  it("paved width excludes the median (grass/painted, not asphalt)", () => {
    expect(pavedWidth(x)).toBe(12 + 12 + 12 + 12); // 48
  });
  it("row width with no flank bands equals curb-to-curb", () => {
    expect(rowWidth(x)).toBe(curbToCurbWidth(x));
  });
  it("row width grows with a sidewalk/parkway flank on each side, curb-to-curb does not", () => {
    const flanked = makeXSection([{ type: "sidewalk", w: 5 }, { type: "parkway", w: 6 }, ...OWNER_EXAMPLE, { type: "parkway", w: 6 }, { type: "sidewalk", w: 5 }]);
    expect(curbToCurbWidth(flanked)).toBe(68);
    expect(rowWidth(flanked)).toBe(68 + 5 + 6 + 6 + 5);
  });
  it("a legacy single-travel-lane road (today's behavior) has curbToCurb === pavedWidth === travelW", () => {
    const x1 = xsectionFromRoad({ type: "road", travelW: 24 });
    expect(curbToCurbWidth(x1)).toBe(24);
    expect(pavedWidth(x1)).toBe(24);
  });
});

describe("pavementArea", () => {
  it("matches costTakeoff's SF_PER_SY convention (9 sf = 1 sy)", () => {
    const x = makeXSection([{ type: "travel", w: 24 }]);
    const a = pavementArea(x, 100);
    expect(a.sf).toBe(2400);
    expect(a.sy).toBeCloseTo(2400 / 9, 6);
  });
  it("excludes median from the priced area", () => {
    const x = makeXSection(OWNER_EXAMPLE);
    const a = pavementArea(x, 100);
    expect(a.sf).toBe(4800); // 48' paved * 100'
  });
});

describe("bandLayout — offsets from the real drawn centerline", () => {
  it("a single travel-lane band spans ±half its width, centerline at 0", () => {
    const x = makeXSection([{ type: "travel", w: 24 }]);
    const { edges, curbToCurb, rowW } = bandLayout(x);
    expect(curbToCurb).toBe(24);
    expect(rowW).toBe(24);
    expect(edges).toHaveLength(1);
    expect(edges[0].from).toBeCloseTo(12, 9);
    expect(edges[0].to).toBeCloseTo(-12, 9);
  });
  it("the owner's example: each band's offsets are contiguous and span the full 68'", () => {
    const x = makeXSection(OWNER_EXAMPLE);
    const { edges } = bandLayout(x);
    expect(edges[0].from).toBeCloseTo(34, 9);   // left curb face
    expect(edges[edges.length - 1].to).toBeCloseTo(-34, 9); // right curb face
    for (let i = 1; i < edges.length; i++) expect(edges[i].from).toBeCloseTo(edges[i - 1].to, 9);
  });
  it("a leading flank band (sidewalk) pushes the assembly's start further out, but offset 0 stays the road's real centerline", () => {
    const x = makeXSection([{ type: "sidewalk", w: 5 }, { type: "travel", w: 12 }, { type: "travel", w: 12 }]);
    const { edges, curbToCurb } = bandLayout(x);
    expect(curbToCurb).toBe(24); // sidewalk excluded
    // within-curb run is still centered on 0: its own edges are at +12 and -12
    const travelEdges = edges.filter((e) => e.band.type === "travel");
    expect(travelEdges[0].from).toBeCloseTo(12, 9);
    expect(travelEdges[travelEdges.length - 1].to).toBeCloseTo(-12, 9);
    // the sidewalk sits entirely beyond the curb face, further from center
    expect(edges[0].from).toBeCloseTo(17, 9);
    expect(edges[0].to).toBeCloseTo(12, 9);
  });
  it("a trailing flank band extends the far side without disturbing the within-curb centering", () => {
    const x = makeXSection([{ type: "travel", w: 12 }, { type: "travel", w: 12 }, { type: "ditch", w: 10 }]);
    const { edges } = bandLayout(x);
    const ditch = edges[edges.length - 1];
    expect(ditch.from).toBeCloseTo(-12, 9);
    expect(ditch.to).toBeCloseTo(-22, 9);
  });
});

describe("bandStripeMarks — the simplified striping convention", () => {
  it("a single-lane road has no internal seams", () => {
    expect(bandStripeMarks(makeXSection([{ type: "travel", w: 24 }]))).toEqual([]);
  });
  it("an undivided 2-lane road gets ONE double-yellow seam at the true centerline", () => {
    const marks = bandStripeMarks(makeXSection([{ type: "travel", w: 12 }, { type: "travel", w: 12 }]));
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ style: "yellow-double" });
    expect(marks[0].atOffset).toBeCloseTo(0, 9);
  });
  it("an undivided 4-lane road (no median) gets exactly ONE double-yellow, at the centermost seam", () => {
    const marks = bandStripeMarks(makeXSection([
      { type: "travel", w: 12 }, { type: "travel", w: 12 }, { type: "travel", w: 12 }, { type: "travel", w: 12 },
    ]));
    expect(marks).toHaveLength(3);
    const yellows = marks.filter((m) => m.style === "yellow-double");
    expect(yellows).toHaveLength(1);
    expect(yellows[0].atOffset).toBeCloseTo(0, 9);
    expect(marks.filter((m) => m.style === "white-dash")).toHaveLength(2);
  });
  it("the owner's 4-lane divided example: yellow-solid both sides of the median, dashed within each pair", () => {
    const marks = bandStripeMarks(makeXSection(OWNER_EXAMPLE));
    // seams: travel|travel, travel|median, median|travel, travel|travel = 4 seams
    expect(marks).toHaveLength(4);
    expect(marks[0].style).toBe("white-dash");
    expect(marks[1].style).toBe("yellow-solid");
    expect(marks[2].style).toBe("yellow-solid");
    expect(marks[3].style).toBe("white-dash");
  });
  it("a centre-turn-lane road gets solid yellow on both its edges, not double-yellow", () => {
    const marks = bandStripeMarks(makeXSection([{ type: "travel", w: 12 }, { type: "turnLane", w: 12 }, { type: "travel", w: 12 }]));
    expect(marks).toHaveLength(2);
    expect(marks.every((m) => m.style === "yellow-solid")).toBe(true);
  });
  it("a shoulder or parking-lane edge is solid white, never yellow", () => {
    const marks = bandStripeMarks(makeXSection([{ type: "travel", w: 12 }, { type: "shoulder", w: 8 }]));
    expect(marks).toEqual([{ atOffset: expect.any(Number), style: "white-solid" }]);
  });
  it("flank (outside-curb) bands never contribute a seam", () => {
    const marks = bandStripeMarks(makeXSection([{ type: "sidewalk", w: 5 }, { type: "travel", w: 12 }, { type: "travel", w: 12 }, { type: "sidewalk", w: 5 }]));
    expect(marks).toHaveLength(1); // only the travel/travel seam
    expect(marks[0].style).toBe("yellow-double");
  });
});

describe("hasXSection — the one gate the Properties panel, cost rollup and canvas renderer all share", () => {
  it("false for a road with no xsection at all (every road drawn before this shipped)", () => {
    expect(hasXSection({ type: "road", travelW: 24 })).toBe(false);
  });
  it("false for the dialog's own single-band wrapper (xsectionFromRoad's starting point)", () => {
    expect(hasXSection({ type: "road", xsection: xsectionFromRoad({ travelW: 24 }) })).toBe(false);
  });
  it("true only for a REAL multi-band designed section", () => {
    expect(hasXSection({ type: "road", xsection: makeXSection(OWNER_EXAMPLE) })).toBe(true);
  });
  it("false for null/undefined/malformed input", () => {
    expect(hasXSection(null)).toBe(false);
    expect(hasXSection({})).toBe(false);
    expect(hasXSection({ xsection: {} })).toBe(false);
    expect(hasXSection({ xsection: { bands: "nope" } })).toBe(false);
  });
});

describe("BUILT_IN_XSECTION_PRESETS", () => {
  it("ships at least three presets", () => {
    expect(BUILT_IN_XSECTION_PRESETS.length).toBeGreaterThanOrEqual(3);
  });
  it("includes one matching the owner's own worked example verbatim", () => {
    const match = BUILT_IN_XSECTION_PRESETS.find((p) => JSON.stringify(normalizeBands(p.bands)) === JSON.stringify(OWNER_EXAMPLE));
    expect(match).toBeTruthy();
  });
  it("every preset normalizes cleanly (no unknown types, no non-positive widths)", () => {
    for (const p of BUILT_IN_XSECTION_PRESETS) {
      const n = normalizeBands(p.bands);
      expect(n.length).toBe(p.bands.length);
      for (const b of n) expect(BAND_TYPE_BY_KEY[b.type]).toBeTruthy();
    }
  });
});
