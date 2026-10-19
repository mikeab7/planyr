// The FFE is SUGGESTED, never asked (owner-only grading layer, round 2). Each rule on synthetic ground with a
// closed-form answer: balanced dirt, pond spoil as fill, rock, docks on the low side (both orientations), the
// soft depth limit, the flood floor — and the plain-words basis that explains whichever fired.
import { describe, it, expect } from "vitest";
import {
  suggestFfe, courtReport, cutFillCentroids, padDepths, padSpotWord, fourWay, rockDepthLookup, rockViolation,
  balanceClause, dockClause, rockClause, depthClause, floorClause, composeBasis, fmtCyShort, netWord, OPPOSITE,
  ROCK_CLEARANCE_FT, DOCK_UPHILL_MIN_FT,
} from "../src/workspaces/site-planner/lib/ffeSuggest.js";
import { runSync, assemblyIds, assemblyEarthwork, withFfe, BALANCE_TOL_CY } from "../src/workspaces/site-planner/lib/buildingGrade.js";
import { buildProposedSurface } from "../src/workspaces/site-planner/lib/proposedSurface.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const G = (setbackRings) => ({ pavementSlopePct: 1.5, lotDropFt: 0.5, slopeRatio: 2, shoulderFt: 5, setbackRings });
const SB = rect(-600, -600, 2400, 1800);
const PARCEL = [rect(-700, -700, 2600, 2000)];

// building 300 × 200 at (300, 300); a SOUTH court below it; optionally a NORTH court above (cross-dock)
const scene = ({ cross = false } = {}) => {
  const els = [
    { id: "b", type: "building", ring: rect(300, 300, 300, 200) },
    { id: "cs", type: "paving", ring: rect(300, 500, 300, 120), dockStack: { x: 450, y: 400 }, hostId: "b" },
  ];
  if (cross) els.push({ id: "cn", type: "paving", ring: rect(300, 180, 300, 120), dockStack: { x: 450, y: 400 }, hostId: "b" });
  return els;
};
const surf = (els, ground, ffe, extra = {}) => buildProposedSurface({
  els: withFfe(els, "b", ffe), ffeFt: null, dockDropFt: 4, existAt: ground, parcelRings: PARCEL, grading: G([SB]),
  opts: { maxCells: 6000, minCellFt: 3 }, ...extra,
});
const fns = (els, ground) => {
  const ids = assemblyIds(els, "b");
  const grid = (f) => { const s = surf(els, ground, f); return s ? s.grid : null; };
  return { ids, evalNet: (f) => { const g = grid(f); const t = g && assemblyEarthwork(g, ids); return t ? t.netCy : null; }, evalGrid: grid };
};
const RANGE = { lo: 60, hi: 140 };
// ground rising east at 2%: 80 at x = 0
const hill = (p) => 80 + 0.02 * p.x;

describe("balanced dirt — the suggestion's spine", () => {
  const els = scene();
  const { ids, evalNet, evalGrid } = fns(els, hill);
  const r = runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids }));
  it("lands within the 500 CY tolerance of a balanced assembly, to a tenth of a foot", () => {
    expect(r).not.toBeNull();
    expect(r.achieved).toBe(true);
    expect(Math.abs(evalNet(r.ffe))).toBeLessThan(BALANCE_TOL_CY);
    expect(r.ffe * 10).toBeCloseTo(Math.round(r.ffe * 10), 9);
    expect(r.floored).toBe(false); expect(r.rock).toBeNull();
  });
  it("sits where the ground does: the mean of 80 + 0.02x over the pad (x 300..600 → 89), give or take the court and slopes", () => {
    expect(r.ffe).toBeGreaterThan(87); expect(r.ffe).toBeLessThan(91);
  });
  it("returns null when the ground cannot be priced (never a guessed number)", () => {
    expect(runSync(suggestFfe({ evalNet: () => null, evalGrid: () => null, range: RANGE, ids }))).toBeNull();
  });
});

describe("pond spoil counts as fill", () => {
  const els = scene();
  const { ids, evalNet, evalGrid } = fns(els, hill);
  const none = runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids }));
  it("with a pond, the pad is balanced AGAINST the pond's cut: pad import ≈ the pond's spoil", () => {
    const pond = 18000;
    const r = runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids, pondCy: pond }));
    expect(r.ffe).toBeGreaterThan(none.ffe);                       // dirt to spare → the pad rises to take it
    expect(Math.abs(evalNet(r.ffe) - pond)).toBeLessThan(BALANCE_TOL_CY);   // pad cut + pond cut ≈ pad fill
  });
  it("more spoil, higher floor; zero spoil is the plain balance", () => {
    const a = runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids, pondCy: 8000 })).ffe;
    const b = runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids, pondCy: 24000 })).ffe;
    expect(b).toBeGreaterThan(a); expect(a).toBeGreaterThan(none.ffe);
    expect(runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids, pondCy: 0 })).ffe).toBe(none.ffe);
  });
});

describe("rock — no cut deeper than depth-to-rock minus 2 ft", () => {
  const els = scene();
  const steep = (p) => 80 + 0.05 * p.x;                // 15 ft across the 300 ft pad → cuts of ~7 ft under the pad
  const { ids, evalNet, evalGrid } = fns(els, steep);
  const free = runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids }));
  const ROCK_FT = 6;                                    // bedrock 6 ft down everywhere → at most 4 ft of cut allowed
  const rockAt = () => ROCK_FT;
  const r = runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids, rockAt }));
  const worstCut = (f) => { const g = evalGrid(f); let m = 0; for (const c of g.cells) if (ids.has(c.elId) && !c.wedge && c.dzFt < 0) m = Math.max(m, -c.dzFt); return m; };
  it("the unconstrained balance really does cut past the rock (so the rule has something to do)", () => {
    expect(worstCut(free.ffe)).toBeGreaterThan(ROCK_FT - ROCK_CLEARANCE_FT + 0.5);
  });
  it("raises the FFE to the LOWEST value that clears it, and says by how much", () => {
    expect(r.ffe).toBeGreaterThan(free.ffe);
    expect(worstCut(r.ffe)).toBeLessThanOrEqual(ROCK_FT - ROCK_CLEARANCE_FT + 1e-6);
    expect(worstCut(r.ffe - 0.2)).toBeGreaterThan(ROCK_FT - ROCK_CLEARANCE_FT);       // a tenth or two lower breaks it again
    expect(r.rock.raisedFt).toBeCloseTo(r.ffe - free.ffe, 1);
    expect(r.rock.depthFt).toBe(ROCK_FT);
    expect(r.rock.at).toBeTruthy();
  });
  it("no rock data → nothing changes and nothing is said", () => {
    const n = runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids, rockAt: null }));
    expect(n.ffe).toBe(free.ffe); expect(n.rock).toBeNull();
    expect(runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids, rockAt: () => null })).rock).toBeNull();
  });
  it("rock deeper than any cut is not a constraint", () => {
    expect(runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids, rockAt: () => 60 })).rock).toBeNull();
  });
  it("rock only on the north end raises it for that end alone — the violation is located there", () => {
    const north = (p) => (p.y < 400 ? 5 : null);
    const g = evalGrid(free.ffe);
    const v = rockViolation(g, ids, north);
    expect(v.raiseFt).toBeGreaterThan(0); expect(v.at.y).toBeLessThan(400); expect(v.depthFt).toBe(5);
    expect(rockViolation(g, ids, () => null).raiseFt).toBe(0);
  });
  it("slopes are not 'under' anything: a wedge cell cutting past the rock raises nothing", () => {
    const fake = { cells: [{ elId: "b", wedge: true, dzFt: -9, x: 0, y: 0, wFt: 1, hFt: 1 }] };
    expect(rockViolation(fake, new Set(["b"]), () => 5).raiseFt).toBe(0);
  });
});

describe("the flood floor is a hard minimum", () => {
  const els = scene();
  const { ids, evalNet, evalGrid } = fns(els, hill);
  it("a floor above the balance wins and is reported; a floor below it changes nothing", () => {
    const free = runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids }));
    const up = runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids, floorFt: free.ffe + 3 }));
    expect(up.ffe).toBeCloseTo(free.ffe + 3, 1); expect(up.floored).toBe(true);
    const down = runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids, floorFt: free.ffe - 3 }));
    expect(down.ffe).toBe(free.ffe); expect(down.floored).toBe(false);
  });
  it("rock raise cannot push the answer under the floor either", () => {
    const r = runSync(suggestFfe({ evalNet, evalGrid, range: RANGE, ids, floorFt: 120, rockAt: () => 6 }));
    expect(r.ffe).toBeGreaterThanOrEqual(120);
  });
});

describe("docks on the low side — the uphill court is named correctly in BOTH orientations", () => {
  const centre = { x: 450, y: 400 };
  const report = (els, ground, ffe) => {
    const s = surf(els, ground, ffe);
    return courtReport({ grid: s.grid, planes: s.planes, els, buildingId: "b", ids: assemblyIds(els, "b"), existAt: ground, centre });
  };
  const risesNorth = (p) => 100 - 0.03 * p.y;      // north = smaller y = higher
  const risesSouth = (p) => 60 + 0.03 * p.y;
  it("cross-dock, ground rising NORTH → the north court is the uphill one, the south court is not", () => {
    const els = scene({ cross: true });
    const ffe = runSync(suggestFfe({ ...fns(els, risesNorth), range: RANGE })).ffe;
    const courts = report(els, risesNorth, ffe);
    expect(courts).toHaveLength(2);
    const n = courts.find((c) => c.id === "cn"), s = courts.find((c) => c.id === "cs");
    expect(n.side).toBe("north"); expect(s.side).toBe("south");
    expect(n.uphill).toBe(true); expect(s.uphill).toBe(false);
    expect(n.kind).toBe("cut"); expect(s.kind).toBe("fill");
    expect(n.groundAbovePadFt).toBeGreaterThanOrEqual(DOCK_UPHILL_MIN_FT);
  });
  it("cross-dock, ground rising SOUTH → the south court is the uphill one", () => {
    const els = scene({ cross: true });
    const ffe = runSync(suggestFfe({ ...fns(els, risesSouth), range: RANGE })).ffe;
    const courts = report(els, risesSouth, ffe);
    expect(courts.find((c) => c.id === "cs").uphill).toBe(true);
    expect(courts.find((c) => c.id === "cn").uphill).toBe(false);
    expect(dockClause(courts)).toMatch(/^The south court faces uphill, so its cut runs \d+ ft deep\.$/);
  });
  it("a one-sided building facing uphill says what flipping the docks would buy", () => {
    const els = scene();
    const ffe = runSync(suggestFfe({ ...fns(els, risesSouth), range: RANGE })).ffe;
    const courts = report(els, risesSouth, ffe);
    expect(courts).toHaveLength(1);
    expect(courts[0].uphill).toBe(true);
    expect(courts[0].flipDepthFt).toBeLessThan(courts[0].depthFt);
    const t = dockClause(courts);
    expect(t).toMatch(/^The south court faces uphill, so its cut runs \d+ ft deep; flipping the docks north would cut that to \d+ ft\.$/);
  });
  it("courts on the low side say so, and the FFE is never changed by any of this", () => {
    const els = scene();
    const ffe = runSync(suggestFfe({ ...fns(els, risesNorth), range: RANGE })).ffe;
    const courts = report(els, risesNorth, ffe);
    expect(courts[0].uphill).toBe(false);
    expect(dockClause(courts)).toBe("Docks sit on the low side, so the courts drain away from the building.");
    expect(dockClause([])).toBeNull();
  });
  it("flat ground: no court is uphill (a foot of margin, not noise)", () => {
    const els = scene({ cross: true });
    const flat = () => 90;
    expect(report(els, flat, 90).every((c) => !c.uphill)).toBe(true);
  });
  it("OPPOSITE maps each side to the other", () => {
    expect(OPPOSITE).toEqual({ north: "south", south: "north", east: "west", west: "east" });
  });
});

describe("the soft depth limit — keeps the balance, warns, never blocks", () => {
  it("padDepths finds the deepest cut and fill UNDER THE PAD and where", () => {
    const els = scene();
    const ground = (p) => 80 + 0.08 * (p.x - 300);          // 24 ft across the pad
    const s = surf(els, ground, 92);
    const d = padDepths(s.grid, "b");
    expect(d.cut.ft).toBeGreaterThan(8); expect(d.fill.ft).toBeGreaterThan(8);
    expect(d.cut.x).toBeGreaterThan(450);                    // the ground is high on the east side → the deepest cut is east
    expect(d.fill.x).toBeLessThan(450);
  });
  it("names a corner when the spot is out toward one, a side otherwise", () => {
    const half = { x: 150, y: 100 };
    expect(padSpotWord({ x: 20, y: 310 }, { x: 450, y: 400 }, half)).toBe("NW corner");
    expect(padSpotWord({ x: 880, y: 490 }, { x: 450, y: 400 }, half)).toBe("SE corner");
    expect(padSpotWord({ x: 450, y: 310 }, { x: 450, y: 400 }, half)).toBe("north side");
    expect(padSpotWord({ x: 450, y: 400 }, { x: 450, y: 400 }, half)).toBe("middle");
  });
  it("the sentence", () => {
    expect(depthClause({ ft: 15.2, word: "NW corner", kind: "cut", limitFt: 12 }))
      .toBe("Cut reaches 15 ft at the NW corner; past 12 ft most Georgia sites terrace or wall. Consider a second pad.");
  });
});

describe("reading a surface: where the cut and the fill sit", () => {
  it("volume-weighted centroids put the cut on the high side and the fill on the low side", () => {
    const els = scene();
    const ffe = runSync(suggestFfe({ ...fns(els, hill), range: RANGE })).ffe;
    const s = surf(els, hill, ffe);
    const c = cutFillCentroids(s.grid, assemblyIds(els, "b"));
    expect(c.cut.x).toBeGreaterThan(c.fill.x);                // ground rises east → cut east, fill west
    expect(c.cut.x - 450).toBeGreaterThan(30); expect(c.fill.x - 450).toBeLessThan(-30);   // east of the building / west of it
    expect(cutFillCentroids(null, new Set())).toEqual({ cut: null, fill: null });
  });
  it("fourWay: dominant axis, y is south, too-small offsets name nothing", () => {
    expect(fourWay(0, -50)).toBe("north"); expect(fourWay(0, 50)).toBe("south");
    expect(fourWay(50, 10)).toBe("east"); expect(fourWay(-50, 10)).toBe("west");
    expect(fourWay(2, 2)).toBeNull();
  });
});

describe("rockDepthLookup", () => {
  // SSURGO polygons are lng/lat rings; feetToLatLng here is a flat test projection
  const toLL = (p, lat0, lon0) => [lat0 + p.y / 364000, lon0 + p.x / 364000];
  const origin = { lat: 33, lon: -84 };
  const ring = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => [origin.lon + x / 364000, origin.lat + y / 364000]);
  const polys = [
    { depthCm: 152.4, polygons: [[ring(0, 0, 500, 500)]] },                               // 60 in = 5 ft, the whole square
    { depthCm: 76.2, polygons: [[ring(200, 200, 300, 300)]] },                              // 30 in = 2.5 ft, a shallower unit inside it
    { depthCm: 30.48, polygons: [[ring(0, 0, 500, 500), ring(400, 400, 450, 450)]] },        // 12 in = 1 ft with a HOLE
  ];
  const at = rockDepthLookup(polys, origin, toLL);
  it("the shallowest covering unit wins", () => {
    expect(at({ x: 250, y: 250 })).toBeCloseTo(1, 6);       // the 1-ft unit covers it too
    expect(at({ x: 100, y: 100 })).toBeCloseTo(1, 6);
  });
  it("a hole is not covered by that unit, and open ground has no answer", () => {
    expect(at({ x: 425, y: 425 })).toBeCloseTo(5, 6);       // inside the hole → only the 5-ft unit
    expect(at({ x: 900, y: 900 })).toBeNull();
  });
  it("no polygons / no origin → no lookup at all", () => {
    expect(rockDepthLookup([], origin, toLL)).toBeNull(); expect(rockDepthLookup(null, origin, toLL)).toBeNull();
    expect(rockDepthLookup(polys, null, toLL)).toBeNull();
  });
});

describe("the basis, in plain words", () => {
  const e = { cutCy: 53633, fillCy: 54248, netCy: 615 };
  it("fmtCyShort / netWord", () => {
    expect([54248, 53633, 4310, 615, 80, 18000, 9999].map(fmtCyShort)).toEqual(["54k", "54k", "4,300", "600", "80", "18k", "10,000"]);
    expect(netWord(615)).toBe("import"); expect(netWord(-4000)).toBe("export"); expect(netWord(120)).toBe("balanced");
  });
  it("the balance clause, the way the owner wrote it", () => {
    expect(balanceClause({ e, cutSide: "north", fillSide: "south" })).toBe("Balances the dirt: 54k CY cut on the north, 54k CY fill on the south; 600 CY import.");
    expect(balanceClause({ e: { ...e, netCy: 100 } })).toBe("Balances the dirt: 54k CY cut, 54k CY fill; nothing to haul.");
  });
  it("the pond is named, with the side it fills; the net is what is LEFT after the pond", () => {
    const t = balanceClause({ e: { cutCy: 20000, fillCy: 38000, netCy: 18000 }, cutSide: "north", fillSide: "south", pondCy: 18000 });
    expect(t).toBe("Balances the dirt: 20k CY cut on the north, 38k CY fill on the south; the pond digs 18k CY that fills the south side; nothing to haul.");
    expect(balanceClause({ e: { cutCy: 20000, fillCy: 38000, netCy: 18000 }, pondCy: 9000, pondWhole: 18000 })).toContain("the pond digs 18k CY that goes into the fill");
  });
  it("a balance the ground cannot reach says so", () => {
    expect(balanceClause({ e, achieved: false })).toMatch(/^Closest the ground gets to balanced:/);
  });
  it("rock, floor", () => {
    expect(rockClause({ raisedFt: 3, sideWord: "north", depthFt: 11.2 })).toBe("Raised 3 ft to stay out of rock on the north end (bedrock about 11 ft down there).");
    expect(rockClause({ raisedFt: 2.4, sideWord: null, depthFt: 6 })).toBe("Raised 2.4 ft to stay out of rock (bedrock about 6 ft down there).");
    expect(floorClause(801.25)).toBe("Held at the site's required finished floor, 801.3 ft.");
  });
  it("composeBasis: the balance clause leads, at most three sentences, a fixed priority", () => {
    const all = [
      { id: "docks", text: "D." }, { id: "depth", text: "X." }, { id: "rock", text: "R." }, { id: "floor", text: "F." }, { id: "balance", text: "B." },
    ];
    expect(composeBasis(all)).toBe("B. F. R.");
    expect(composeBasis([{ id: "docks", text: "D." }, { id: "balance", text: "B." }])).toBe("B. D.");
    expect(composeBasis([null, undefined])).toBe("");
  });
  it("no number the owner cannot act on: no per-cell figures, no slope ratios, in any clause", () => {
    const text = [balanceClause({ e, cutSide: "north", fillSide: "south", pondCy: 5000 }), rockClause({ raisedFt: 1, sideWord: "east", depthFt: 5 }), depthClause({ ft: 14, word: "north side", kind: "fill", limitFt: 12 }), dockClause([{ side: "north", uphill: true, depthFt: 7, kind: "cut", flipDepthFt: 2 }])].join(" ");
    expect(text).not.toMatch(/per cell|\d:1|2:1|3:1|4:1|cell/i);
  });
});
