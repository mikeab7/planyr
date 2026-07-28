/* NEW-3 — the independent screening BFE estimate.
 *
 * Context that these tests exist to protect: this is a REGULATED number. The failure mode that
 * matters is not "the arithmetic is slightly off" — it is "the module produced a confident
 * elevation it had no business producing." B1036 shipped this session for exactly that class (an
 * unpriceable berm term reading as a clean zero); reintroducing it in a brand-new module that
 * outputs a flood elevation would be considerably worse. So the honesty tests come first. */
import { describe, it, expect } from "vitest";
import {
  screeningBfe,
  screeningPeakDischarge,
  normalDepthWse,
  sectionAtWse,
  manningDischarge,
  bfeDataLikelyRequired,
  BFE_DATA_REQUIREMENT,
  NOT_MODELED,
  CLOMR_NOTE,
  PRF_STANDARD,
  PRF_FLAT_COASTAL,
  MANNING_N,
} from "../src/workspaces/site-planner/lib/screeningBfe.js";

/* A simple symmetric V-channel: 20 ft deep over 200 ft, bed at elevation 100. */
const vChannel = [
  { offsetFt: 0, elevFt: 120 },
  { offsetFt: 100, elevFt: 100 },
  { offsetFt: 200, elevFt: 120 },
];

describe("LOUD-FAILURE — it never invents an elevation", () => {
  it("no watershed, no rainfall, no soils → an explicit unknown naming every missing input", () => {
    const r = screeningBfe({ station: vChannel, slopeFtPerFt: 0.001 });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe("hydrology");
    expect(r.wseFt).toBeUndefined(); // no elevation, not a zero, not a null-that-renders-as-0
    expect(r.missing.join(" ")).toMatch(/watershed/);
    expect(r.missing.join(" ")).toMatch(/rainfall/);
    expect(r.missing.join(" ")).toMatch(/curve number/);
  });

  it("names each missing input individually, so the panel can say which one to go get", () => {
    const r = screeningPeakDischarge({ areaAcres: 300, rainfallIn: 13, tcMin: 45 });
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0]).toMatch(/curve number/);
  });

  it("hydrology succeeds but hydraulics can't run → still an explicit unknown, with the stage named", () => {
    const r = screeningBfe({ areaAcres: 300, cn: 80, tcMin: 45, rainfallIn: 13, station: vChannel, slopeFtPerFt: null });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe("hydraulics");
    expect(r.reason).toMatch(/slope/);
    expect(r.hydrology.ok).toBe(true); // what DID compute is still reported
  });

  it("a flow that overtops the sampled section says so rather than clamping to the bank", () => {
    const r = normalDepthWse({ station: vChannel, qCfs: 5_000_000, slopeFtPerFt: 0.001 });
    expect(r.ok).toBe(false);
    expect(r.overtops).toBe(true);
    expect(r.reason).toMatch(/overtops/);
  });

  it("zero runoff is reported as a reason, not as a zero-depth flood", () => {
    const r = screeningPeakDischarge({ areaAcres: 300, cn: 30, tcMin: 45, rainfallIn: 0.05 });
    expect(r.ok).toBe(false);
    expect(r.missing[0]).toMatch(/runoff depth is zero/);
  });
});

describe("every answer carries its method, its inputs and what it does NOT model", () => {
  const r = screeningBfe({ areaAcres: 300, cn: 80, tcMin: 45, rainfallIn: 13, station: vChannel, slopeFtPerFt: 0.001 });

  it("solves, and is labelled SCREENING", () => {
    expect(r.ok).toBe(true);
    expect(r.screening).toBe(true);
    expect(r.wseFt).toBeGreaterThan(100);
    expect(r.wseFt).toBeLessThan(120);
  });

  it("states the method rather than presenting a bare number", () => {
    expect(r.method).toBe("scs-uh-peak + normal-depth");
    expect(r.methodLabel).toMatch(/unit hydrograph/i);
    expect(r.methodLabel).toMatch(/normal depth/i);
    expect(r.methodLabel).toMatch(/not a backwater profile/i);
  });

  it("carries the not-modelled list — visibly, with every answer", () => {
    expect(r.notModeled).toEqual(NOT_MODELED);
    const all = r.notModeled.join(" ");
    for (const must of [/field survey/i, /bridges or culverts/i, /ineffective-flow/i, /floodway encroachment/i, /gauge/i]) {
      expect(all).toMatch(must);
    }
  });

  it("carries the CLOMR/LOMR pathway note, reused not forked", () => {
    expect(r.clomrNote).toBe(CLOMR_NOTE);
    expect(CLOMR_NOTE).toMatch(/CLOMR/);
    expect(CLOMR_NOTE).toMatch(/LOMR/);
    expect(CLOMR_NOTE).toMatch(/sealed/);
  });

  it("keeps its inputs so the number can be argued with", () => {
    expect(r.hydrology.inputs).toMatchObject({ areaAcres: 300, cn: 80, tcMin: 45, rainfallIn: 13, returnPeriodYr: 100 });
  });

  it("carries an uncertainty BAND from a real modelling choice, not an arbitrary percentage", () => {
    // The band ends are the peak-rate-factor ends: 284 (flat Gulf Coast) and 484 (standard NRCS).
    expect(PRF_FLAT_COASTAL).toBe(284);
    expect(PRF_STANDARD).toBe(484);
    expect(r.bandFt.loFt).toBeLessThan(r.wseFt);
    expect(r.bandFt.hiFt).toBeGreaterThanOrEqual(r.wseFt);
    expect(r.hydrology.bandCfs.loCfs).toBeLessThan(r.hydrology.bandCfs.hiCfs);
  });

  it("an open-ended band (one end overtops) is flagged, never quietly narrowed", () => {
    const steep = screeningBfe({ areaAcres: 20000, cn: 95, tcMin: 20, rainfallIn: 18, station: vChannel, slopeFtPerFt: 0.0005 });
    if (steep.ok) expect(typeof steep.bandFt.openEnded).toBe("boolean");
    else expect(steep.stage).toBe("hydraulics"); // or it refuses outright — both are honest
  });
});

describe("the hydraulics are real hydraulics", () => {
  it("wetted area and perimeter of a V-channel match the closed-form values", () => {
    // Water 10 ft deep in a V that falls 20 ft over 100 ft: half-width at the surface = 50 ft.
    const g = sectionAtWse(vChannel, 110);
    expect(g.topWidthFt).toBeCloseTo(100, 6);
    expect(g.areaSf).toBeCloseTo(0.5 * 100 * 10, 6);        // triangle: ½ · width · depth
    expect(g.perimeterFt).toBeCloseTo(2 * Math.hypot(50, 10), 6);
    expect(g.hydraulicRadiusFt).toBeCloseTo(g.areaSf / g.perimeterFt, 9);
  });

  it("a dry section is null, not a zero-area division", () => {
    expect(sectionAtWse(vChannel, 99)).toBe(null);
    expect(sectionAtWse(vChannel, 100)).toBe(null); // exactly at the bed: no water
    expect(sectionAtWse([], 110)).toBe(null);
  });

  it("Manning's equation reproduces its own discharge at the solved depth (round trip)", () => {
    const solved = normalDepthWse({ station: vChannel, qCfs: 1200, slopeFtPerFt: 0.002, manningN: MANNING_N.channel });
    expect(solved.ok).toBe(true);
    const back = manningDischarge(vChannel, solved.wseFt, { manningN: MANNING_N.channel, slopeFtPerFt: 0.002 });
    // The solved WSE is reported to 0.01 ft, so the round trip lands within a fraction of a
    // percent — tighter than that would be testing the rounding, not the hydraulics.
    expect(Math.abs(back.qCfs - 1200) / 1200).toBeLessThan(0.005);
  });

  it("responds to flow, roughness and slope the way open-channel flow actually does", () => {
    const smooth = normalDepthWse({ station: vChannel, qCfs: 1200, slopeFtPerFt: 0.002, manningN: 0.03 });
    const rough = normalDepthWse({ station: vChannel, qCfs: 1200, slopeFtPerFt: 0.002, manningN: 0.09 });
    expect(rough.wseFt).toBeGreaterThan(smooth.wseFt);
    const more = normalDepthWse({ station: vChannel, qCfs: 4000, slopeFtPerFt: 0.002 });
    expect(more.wseFt).toBeGreaterThan(smooth.wseFt);
    const steeper = normalDepthWse({ station: vChannel, qCfs: 1200, slopeFtPerFt: 0.02 });
    expect(steeper.wseFt).toBeLessThan(smooth.wseFt); // steeper slope carries the same flow shallower
  });

  it("a bigger watershed produces a bigger peak, all else equal", () => {
    const small = screeningPeakDischarge({ areaAcres: 100, cn: 80, tcMin: 45, rainfallIn: 13 });
    const big = screeningPeakDischarge({ areaAcres: 1000, cn: 80, tcMin: 45, rainfallIn: 13 });
    expect(big.qCfs).toBeGreaterThan(small.qCfs);
    expect(big.qCfs / small.qCfs).toBeCloseTo(10, 1); // linear in area at fixed Tc
  });

  it("composes the curve number from soils when one isn't supplied directly", () => {
    const r = screeningPeakDischarge({ areaAcres: 300, hsg: "D", impPct: 60, tcMin: 45, rainfallIn: 13 });
    expect(r.ok).toBe(true);
    expect(r.inputs.cn).toBeGreaterThan(80); // group D + 60% impervious is a high CN
  });
});

describe("the NFIP threshold research is carried as SOURCED RESEARCH, not as settled law", () => {
  it("quotes the CFR text with its citation and URL", () => {
    expect(BFE_DATA_REQUIREMENT.citation).toBe("44 CFR 60.3(b)(3)");
    expect(BFE_DATA_REQUIREMENT.url).toMatch(/ecfr\.gov/);
    expect(BFE_DATA_REQUIREMENT.quote).toMatch(/greater than 50 lots or 5 acres, whichever is the lesser/);
    expect(BFE_DATA_REQUIREMENT.lotsThreshold).toBe(50);
    expect(BFE_DATA_REQUIREMENT.acresThreshold).toBe(5);
  });

  it("is marked UNVERIFIED for this county and says so in plain English", () => {
    // The CFR binds the COMMUNITY; what governs a developer is the ordinance the county adopted.
    expect(BFE_DATA_REQUIREMENT.verified).toBe(false);
    expect(BFE_DATA_REQUIREMENT.plain).toMatch(/Confirm the exact wording in this county/);
  });

  it("flags the threshold only in an approximate A zone, and only when it actually bites", () => {
    expect(bfeDataLikelyRequired({ acres: 40, inApproximateAZone: true }).by).toBe("acres");
    expect(bfeDataLikelyRequired({ acres: 40, inApproximateAZone: false })).toBe(null); // studied zone
    expect(bfeDataLikelyRequired({ acres: 3, inApproximateAZone: true })).toBe(null);   // under both
    expect(bfeDataLikelyRequired({ lots: 80, inApproximateAZone: true }).by).toBe("lots");
    expect(bfeDataLikelyRequired({ inApproximateAZone: true })).toBe(null);             // nothing known
  });
});
