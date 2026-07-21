// B909 round 4 — the persistent "what changed" card's pure delta rows + cross-section marks.
import { describe, it, expect } from "vitest";
import { buildChangeSummaryRows, pondCrossSectionMarks, gapProposalNote } from "../src/workspaces/site-planner/lib/pondChangeSummary.js";

const AF = 43560;

describe("buildChangeSummaryRows", () => {
  it("a no-op (before === after) produces no rows", () => {
    const s = { depthFt: 8, tobElevFt: 100, gradeFt: 100, usableCf: 10 * AF, mitCandidateCf: 0, landTakeSf: 5 * AF, excavationCf: 1000, bermFillCf: 0 };
    expect(buildChangeSummaryRows({ before: s, after: s })).toEqual([]);
  });

  it("floor + rim + usable-detention deltas all read in plain before -> after terms", () => {
    const before = { depthFt: 8, tobElevFt: 100, gradeFt: 100, usableCf: 0, mitCandidateCf: 0, landTakeSf: 5 * AF, excavationCf: 1000, bermFillCf: 0 };
    const after = { depthFt: 12, tobElevFt: 104, gradeFt: 100, usableCf: 34 * AF, mitCandidateCf: 0, landTakeSf: 5 * AF, excavationCf: 1000, bermFillCf: 500 };
    const rows = buildChangeSummaryRows({ before, after, siteDetReqAcFt: 34, siteDetProvidedOtherAcFt: 0 });
    const floor = rows.find((r) => r.key === "floor");
    expect(floor.from).toBe("-8.0 ft");
    expect(floor.to).toBe("-12.0 ft");
    expect(floor.note).toMatch(/dug 4\.0 ft deeper/);
    const rim = rows.find((r) => r.key === "rim");
    expect(rim.from).toBe("at grade");
    expect(rim.to).toBe("+4.0 ft berm");
    const usable = rows.find((r) => r.key === "usable");
    expect(usable.from).toBe("0.00 ac-ft");
    expect(usable.to).toBe("34.00 ac-ft");
    expect(usable.note).toBe("requirement met");
  });

  it("a shortfall that improves but doesn't fully close reports the remaining gap, never a false 'met'", () => {
    const before = { depthFt: 8, tobElevFt: 100, gradeFt: 100, usableCf: 0, mitCandidateCf: 0, landTakeSf: 5 * AF, excavationCf: 1000, bermFillCf: 0 };
    const after = { depthFt: 12, tobElevFt: 104, gradeFt: 100, usableCf: 20 * AF, mitCandidateCf: 0, landTakeSf: 5 * AF, excavationCf: 1000, bermFillCf: 500 };
    const rows = buildChangeSummaryRows({ before, after, siteDetReqAcFt: 34, siteDetProvidedOtherAcFt: 0 });
    const usable = rows.find((r) => r.key === "usable");
    expect(usable.note).toMatch(/still short by 14\.00 ac-ft/);
  });

  it("land-take delta names the berm ring as the reason when a berm exists", () => {
    const before = { depthFt: 8, tobElevFt: 100, gradeFt: 100, usableCf: 0, mitCandidateCf: 0, landTakeSf: 5 * AF, excavationCf: 1000, bermFillCf: 0 };
    const after = { depthFt: 8, tobElevFt: 104, gradeFt: 100, usableCf: 10 * AF, mitCandidateCf: 0, landTakeSf: 5.6 * AF, excavationCf: 1000, bermFillCf: 800 };
    const rows = buildChangeSummaryRows({ before, after });
    const land = rows.find((r) => r.key === "land");
    expect(land.from).toBe("5.00 ac");
    expect(land.to).toBe("5.60 ac");
    expect(land.note).toBe("berm ring");
  });

  it("earthwork row shows cut delta and berm fill CY together", () => {
    const before = { depthFt: 8, tobElevFt: 100, gradeFt: 100, usableCf: 0, mitCandidateCf: 0, landTakeSf: 5 * AF, excavationCf: 27000, bermFillCf: 0 };
    const after = { depthFt: 12, tobElevFt: 104, gradeFt: 100, usableCf: 10 * AF, mitCandidateCf: 0, landTakeSf: 5.6 * AF, excavationCf: 40500, bermFillCf: 2700 };
    const rows = buildChangeSummaryRows({ before, after });
    const ew = rows.find((r) => r.key === "earthwork");
    expect(ew.to).toMatch(/\+500 CY cut/);
    expect(ew.to).toMatch(/100 CY berm fill/);
  });

  it("mitigation credit row reads the site-wide requirement, not just this pond's own number", () => {
    const before = { depthFt: 8, tobElevFt: 100, gradeFt: 100, usableCf: 10 * AF, mitCandidateCf: 0, landTakeSf: 5 * AF, excavationCf: 1000, bermFillCf: 0 };
    const after = { depthFt: 10, tobElevFt: 100, gradeFt: 100, usableCf: 10 * AF, mitCandidateCf: 6 * AF, landTakeSf: 5 * AF, excavationCf: 1500, bermFillCf: 0 };
    const rows = buildChangeSummaryRows({ before, after, siteMitReqAcFt: 5, siteMitProvidedOtherAcFt: 0 });
    const mit = rows.find((r) => r.key === "mit");
    expect(mit.note).toBe("requirement met");
  });

  it("missing before/after snapshots never throw — just no rows", () => {
    expect(buildChangeSummaryRows({})).toEqual([]);
    expect(buildChangeSummaryRows({ before: null, after: null })).toEqual([]);
  });
});

describe("pondCrossSectionMarks — the schematic (not-to-scale) cross-section", () => {
  it("draws grade, WSE, old (dashed) + new (solid) profiles, and shades the usable band", () => {
    const before = { depthFt: 8, tobElevFt: 100 };
    const after = { depthFt: 12, tobElevFt: 104 };
    const { marks } = pondCrossSectionMarks({ gradeFt: 100, wseFt: 103, before, after });
    expect(marks.some((m) => m.role === "grade")).toBe(true);
    expect(marks.some((m) => m.role === "wse")).toBe(true);
    const profiles = marks.filter((m) => m.t === "profile");
    expect(profiles).toHaveLength(2);
    expect(profiles.some((p) => p.dashed === true)).toBe(true);
    expect(profiles.some((p) => p.dashed === false)).toBe(true);
    expect(marks.some((m) => m.role === "usable")).toBe(true);
    expect(marks.some((m) => m.role === "label" && /schematic/.test(m.s))).toBe(true);
  });

  it("no WSE (upland pond) shades the usable band against grade instead", () => {
    const before = { depthFt: 8, tobElevFt: 100 };
    const after = { depthFt: 12, tobElevFt: 100 };
    const { marks } = pondCrossSectionMarks({ gradeFt: 100, wseFt: null, before, after });
    expect(marks.some((m) => m.role === "wse")).toBe(false);
    // rim at grade -> no usable band above grade (a plain-dug pond doesn't berm above grade)
    expect(marks.some((m) => m.role === "usable")).toBe(false);
  });

  it("no usable data at all -> empty marks, never a throw", () => {
    expect(pondCrossSectionMarks({})).toEqual({ marks: [], w: 320, h: 160 });
    expect(pondCrossSectionMarks({ after: null })).toEqual({ marks: [], w: 320, h: 160 });
  });

  it("a brand-new pond (no before snapshot) still draws just the new profile", () => {
    const after = { depthFt: 8, tobElevFt: 100 };
    const { marks } = pondCrossSectionMarks({ gradeFt: 100, wseFt: null, before: null, after });
    const profiles = marks.filter((m) => m.t === "profile");
    expect(profiles).toHaveLength(1);
    expect(profiles[0].dashed).toBe(false);
  });
});

describe("gapProposalNote — B909 round 3/4: the atomic infeasibility proposal", () => {
  it("matches the owner's exact spec shape: 'Your pond can hold X of Y required ac-ft with a Z-ft berm. To close the gap, enlarge...'", () => {
    const note = gapProposalNote({ achievedAcFt: 20, targetAcFt: 34, reqLabel: "detention", capLabel: "with a 4.0-ft berm", extraAcres: 2.5 });
    expect(note).toBe("Your pond can hold 20.00 of the 34.00 ac-ft required detention with a 4.0-ft berm. To close the gap, enlarge the pond by about 2.50 ac or add a second basin.");
  });

  it("no extraAcres estimate falls back to the generic close, never a fabricated acreage", () => {
    const note = gapProposalNote({ achievedAcFt: 5, targetAcFt: 8, reqLabel: "floodplain mitigation", capLabel: "at a 6.0-ft floor", extraAcres: null });
    expect(note).toMatch(/^Your pond can hold 5\.00 of the 8\.00 ac-ft required floodplain mitigation at a 6\.0-ft floor\./);
    expect(note).toMatch(/Enlarge the pond or add a second basin to close the gap\.$/);
    expect(note).not.toMatch(/about .* ac/);
  });

  it("omitting reqLabel/capLabel still reads as a complete, grammatical sentence", () => {
    const note = gapProposalNote({ achievedAcFt: 1, targetAcFt: 2 });
    expect(note).toBe("Your pond can hold 1.00 of the 2.00 ac-ft required. Enlarge the pond or add a second basin to close the gap.");
  });
});
