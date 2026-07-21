// FINAL UI SPEC Part B — the Yield-panel verdict strip (B1.1) + number-format rule (B2/B3).
// Pure tests over lib/yieldVerdicts.js (the repo's vitest config is DOM-free).
import { describe, it, expect } from "vitest";
import { fmtAcFt, fmtProvidedOfRequired, yieldVerdictStrip } from "../src/workspaces/site-planner/lib/yieldVerdicts.js";

describe("B2/B3 — ac-ft number format (1 decimal, no signed zero)", () => {
  it("formats to one decimal", () => {
    expect(fmtAcFt(15)).toBe("15.0");
    expect(fmtAcFt(33.84)).toBe("33.8");
    expect(fmtAcFt(0.2)).toBe("0.2");
  });
  it("never renders a signed zero (−0.00 / −0.0)", () => {
    expect(fmtAcFt(-0.02)).toBe("0.0");
    expect(fmtAcFt(-0.049)).toBe("0.0");
    expect(fmtAcFt(0)).toBe("0.0");
    expect(fmtAcFt(-0.0)).toBe("0.0");
    // a genuine shortfall past the threshold still shows its magnitude
    expect(fmtAcFt(-15)).toBe("-15.0");
  });
  it("provided / required renders the 15.0 / 33.8 shape", () => {
    expect(fmtProvidedOfRequired(15, 33.8)).toBe("15.0 / 33.8");
  });
});

const AC_FT = 43560;
const detReqPoint = (acft) => ({ kind: "point", requiredAcFt: acft });

describe("B1.1 — verdict-strip templates", () => {
  it("detention COVERED → green, +delta ac-ft", () => {
    const [det] = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: 34.0 * AC_FT });
    expect(det.tone).toBe("good");
    expect(det.text).toBe("Detention covered ✓ +0.2 ac-ft");
    expect(det.short).toBeFalsy();
  });

  it("detention SHORT → red, provided-of-required, marked short", () => {
    const [det] = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: 15.0 * AC_FT });
    expect(det.tone).toBe("danger");
    expect(det.short).toBe(true);
    expect(det.text).toBe("Detention SHORT — 15.0 of 33.8 ac-ft");
  });

  it("detention CHECKING → neutral when the usable split is unknown", () => {
    const [det] = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: null });
    expect(det.tone).toBe(null);
    expect(det.text).toContain("checking flood data");
  });

  it("a residue inside the met-epsilon reads as covered, +0.0 (never −0.0)", () => {
    // A shortfall smaller than the covered/short epsilon (0.005 ac-ft, matching the groups)
    // reads as MET, and its delta formats to a clean +0.0 — never a signed "−0.0".
    const [det] = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: (33.8 - 0.001) * AC_FT });
    expect(det.tone).toBe("good");
    expect(det.text).toBe("Detention covered ✓ +0.0 ac-ft");
  });

  it("mitigation NOT REQUIRED → neutral (requirement rounds to zero / no fill)", () => {
    const [, mit] = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: 34 * AC_FT, mitigation: { intersectAcres: 0 } });
    expect(mit.tone).toBe(null);
    expect(mit.text).toBe("Mitigation not required");
  });

  it("mitigation COVERED / SHORT use the same shape as detention", () => {
    const base = { req: detReqPoint(33.8), providedUsableCf: 34 * AC_FT };
    const covered = yieldVerdictStrip({ ...base, mitigation: { intersectAcres: 2, volumeCf: 5 * AC_FT, volumeAcFt: 5 }, mitProvided: { creditedCf: 6 * AC_FT } })[1];
    expect(covered.text).toBe("Mitigation covered ✓");
    const short = yieldVerdictStrip({ ...base, mitigation: { intersectAcres: 2, volumeCf: 5 * AC_FT, volumeAcFt: 5 }, mitProvided: { creditedCf: 2 * AC_FT } })[1];
    expect(short.tone).toBe("danger");
    expect(short.text).toBe("Mitigation SHORT — 2.0 of 5.0 ac-ft");
  });

  it("buildability: pads outside floodplain → green", () => {
    const strip = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: 34 * AC_FT, buildability: { ffe: { status: "no_rule", outsideFloodplain: true } } });
    const ffe = strip.find((v) => v.key === "ffe");
    expect(ffe.tone).toBe("good");
    expect(ffe.text).toBe("Building pads outside floodplain");
  });

  it("caps at four lines, detention-first order", () => {
    const strip = yieldVerdictStrip({
      req: detReqPoint(33.8), providedUsableCf: 15 * AC_FT,
      mitigation: { intersectAcres: 2, volumeCf: 5 * AC_FT, volumeAcFt: 5 }, mitProvided: { creditedCf: 2 * AC_FT },
      buildability: { ffe: { status: "pass", requiredFfeFt: 101.2 } },
    });
    expect(strip.length).toBeLessThanOrEqual(4);
    expect(strip[0].key).toBe("det");
    expect(strip.map((v) => v.key)).toEqual(["det", "mit", "ffe"]);
  });
});
