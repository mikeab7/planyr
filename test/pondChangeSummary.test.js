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
    expect(usable.from).toBe("0.0 ac-ft"); // E4 — ac-ft render at 1dp everywhere
    expect(usable.to).toBe("34.0 ac-ft");
    expect(usable.note).toBe("requirement met");
  });

  it("a shortfall that improves but doesn't fully close reports the remaining gap, never a false 'met'", () => {
    const before = { depthFt: 8, tobElevFt: 100, gradeFt: 100, usableCf: 0, mitCandidateCf: 0, landTakeSf: 5 * AF, excavationCf: 1000, bermFillCf: 0 };
    const after = { depthFt: 12, tobElevFt: 104, gradeFt: 100, usableCf: 20 * AF, mitCandidateCf: 0, landTakeSf: 5 * AF, excavationCf: 1000, bermFillCf: 500 };
    const rows = buildChangeSummaryRows({ before, after, siteDetReqAcFt: 34, siteDetProvidedOtherAcFt: 0 });
    const usable = rows.find((r) => r.key === "usable");
    expect(usable.note).toMatch(/still short by 14\.0 ac-ft/); // E4 — 1dp
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

describe("gapProposalNote — v3 A5: the atomic infeasibility proposal (exact concise form)", () => {
  it("matches the owner's exact v3 sentence: 'To close the gap: keep the {x}-ft berm and enlarge the pond by about {y} ac, or add a second basin.'", () => {
    const note = gapProposalNote({ bermFt: 4, extraAcres: 2.5 });
    expect(note).toBe("To close the gap: keep the 4.0-ft berm and enlarge the pond by about 2.50 ac, or add a second basin.");
  });

  it("no berm (a floor cap, e.g. mitigation) drops the berm clause", () => {
    const note = gapProposalNote({ bermFt: null, extraAcres: 0.3 });
    expect(note).toBe("To close the gap: enlarge the pond by about 0.30 ac, or add a second basin.");
  });

  it("no extraAcres estimate drops the acreage rather than fabricating one", () => {
    const note = gapProposalNote({ bermFt: 4, extraAcres: null });
    expect(note).toBe("To close the gap: keep the 4.0-ft berm and enlarge the pond, or add a second basin.");
    expect(note).not.toMatch(/about .* ac/);
  });

  it("neither berm nor acreage still reads as a complete sentence", () => {
    const note = gapProposalNote({});
    expect(note).toBe("To close the gap: enlarge the pond, or add a second basin.");
  });

  it("v3 C2 — capBound leads with raising the Max berm setting", () => {
    const note = gapProposalNote({ bermFt: 4, extraAcres: 2.5, capBound: true });
    expect(note).toBe("To close the gap: keep the 4.0-ft berm (your Max berm setting). Raise Max berm if your grading allows, or enlarge the pond by about 2.50 ac, or add a second basin.");
  });

  it("v3 C2 — capBound with no acreage drops the 'by about … ac' clause", () => {
    const note = gapProposalNote({ bermFt: 4, extraAcres: null, capBound: true });
    expect(note).toBe("To close the gap: keep the 4.0-ft berm (your Max berm setting). Raise Max berm if your grading allows, or enlarge the pond, or add a second basin.");
  });

  it("v3 C2 — capBound without a berm falls back to the plain A5 shape (no cap mention)", () => {
    const note = gapProposalNote({ bermFt: null, extraAcres: 0.3, capBound: true });
    expect(note).toBe("To close the gap: enlarge the pond by about 0.30 ac, or add a second basin.");
    expect(note).not.toMatch(/Max berm/);
  });
});
