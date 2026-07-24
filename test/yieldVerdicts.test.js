// v3 UI SPEC Part A — the Yield-panel verdict strip (A2) + number-format rule (G4).
// Pure tests over lib/yieldVerdicts.js (the repo's vitest config is DOM-free).
import { describe, it, expect } from "vitest";
import { fmtAcFt, fmtProvidedOfRequired, fmtSignedAcFt, yieldVerdictStrip } from "../src/workspaces/site-planner/lib/yieldVerdicts.js";

const EM_DASH = "—";

describe("G4 — ac-ft number format (1 decimal, no signed zero)", () => {
  it("formats to one decimal", () => {
    expect(fmtAcFt(15)).toBe("15.0");
    expect(fmtAcFt(33.84)).toBe("33.8");
    expect(fmtAcFt(0.2)).toBe("0.2");
  });
  it("never renders a signed zero (−0.00 / −0.0)", () => {
    expect(fmtAcFt(-0.02)).toBe("0.0");
    expect(fmtAcFt(0)).toBe("0.0");
    expect(fmtAcFt(-0.0)).toBe("0.0");
    expect(fmtAcFt(-15)).toBe("-15.0");
  });
  it("provided/required renders the '0.0 of 33.8 ac-ft' pair shape (A2)", () => {
    expect(fmtProvidedOfRequired(0, 33.8)).toBe("0.0 of 33.8 ac-ft");
    expect(fmtProvidedOfRequired(34, 33.8)).toBe("34.0 of 33.8 ac-ft");
  });
});

describe("G4 — fmtSignedAcFt (delta, never a signed zero)", () => {
  it("signs a real delta and drops the sign at a near-zero residue", () => {
    expect(fmtSignedAcFt(5)).toBe("+5.0");
    expect(fmtSignedAcFt(-15)).toBe("−15.0");
    expect(fmtSignedAcFt(0)).toBe("0.0");
    expect(fmtSignedAcFt(-0.03)).toBe("0.0");
    expect(fmtSignedAcFt(0.2)).toBe("+0.2");
  });
});

const AC_FT = 43560;
const detReqPoint = (acft) => ({ kind: "point", requiredAcFt: acft });
const detReqBand = (lo, hi) => ({ kind: "band", bandAcFt: [lo, hi] });

describe("A2 — verdict-strip grammar: label + pill + sentence", () => {
  it("detention COVERED → OK pill, '{label}: 34.0 of 33.8 ac-ft', no action button", () => {
    const [det] = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: 34.0 * AC_FT });
    expect(det.pill).toBe("OK");
    expect(det.tone).toBe("good");
    expect(det.label).toBe("Detention");
    expect(det.sentence).toBe("34.0 of 33.8 ac-ft");
    expect(det.text).toBe("Detention: 34.0 of 33.8 ac-ft");
    expect(det.short).toBeFalsy();
    expect(det.action).toBeFalsy();
  });

  it("detention SHORT → SHORT pill, '0.0 of 33.8 ac-ft', action button", () => {
    const [det] = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: 0 });
    expect(det.pill).toBe("SHORT");
    expect(det.tone).toBe("danger");
    expect(det.short).toBe(true);
    expect(det.action).toBe(true);
    expect(det.sentence).toBe("0.0 of 33.8 ac-ft");
  });

  it("a screening BAND uses its conservative (upper) end as the single required number", () => {
    const covered = yieldVerdictStrip({ req: detReqBand(28.6, 33.8), providedUsableCf: 34 * AC_FT })[0];
    expect(covered.pill).toBe("OK");
    expect(covered.sentence).toBe("34.0 of 33.8 ac-ft");
    const short = yieldVerdictStrip({ req: detReqBand(28.6, 33.8), providedUsableCf: 30 * AC_FT })[0];
    expect(short.pill).toBe("SHORT");
    expect(short.sentence).toBe("30.0 of 33.8 ac-ft");
  });

  it("detention LOADING → '…' pill, 'checking flood data', loading flag", () => {
    const [det] = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: null });
    expect(det.pill).toBe("…");
    expect(det.loading).toBe(true);
    expect(det.sentence).toBe("checking flood data");
  });

  it("mitigation NOT REQUIRED → OK pill, 'not required' (requirement rounds to zero / no fill)", () => {
    const [, mit] = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: 34 * AC_FT, mitigation: { intersectAcres: 0 } });
    expect(mit.pill).toBe("OK");
    expect(mit.label).toBe("Mitigation");
    expect(mit.sentence).toBe("not required");
    expect(mit.pair).toBeUndefined();
  });

  it("mitigation COVERED / SHORT use the same pair grammar as detention", () => {
    const base = { req: detReqPoint(33.8), providedUsableCf: 34 * AC_FT };
    const covered = yieldVerdictStrip({ ...base, mitigation: { intersectAcres: 2, volumeCf: 5 * AC_FT, volumeAcFt: 5 }, mitProvided: { creditedCf: 6 * AC_FT } })[1];
    expect(covered.pill).toBe("OK");
    expect(covered.sentence).toBe("6.0 of 5.0 ac-ft");
    const short = yieldVerdictStrip({ ...base, mitigation: { intersectAcres: 2, volumeCf: 20 * AC_FT, volumeAcFt: 20 }, mitProvided: { creditedCf: 12.4 * AC_FT } })[0];
    expect(short.pill).toBe("SHORT");
    expect(short.sentence).toBe("12.4 of 20.0 ac-ft");
  });

  // NEW-16 — a TRACE mitigation requirement (grid-cell crumbs at a zone edge) must never
  // render as a red SHORT over two identical zeros; it reads "not required (trace)" and
  // carries the raw ac-ft for the ⓘ.
  it("a trace mitigation requirement (< 0.05 ac-ft) reads 'not required (trace)', never a SHORT", () => {
    const base = { req: detReqPoint(33.8), providedUsableCf: 34 * AC_FT };
    const [, mit] = yieldVerdictStrip({ ...base, mitigation: { intersectAcres: 0.3, volumeCf: 0.01 * AC_FT, volumeAcFt: 0.01 }, mitProvided: { creditedCf: 0 } });
    expect(mit.pill).toBe("OK");
    expect(mit.tone).toBe("good");
    expect(mit.sentence).toBe("not required (trace)");
    expect(mit.pair).toBeUndefined();
    expect(mit.short).toBeFalsy();
    expect(mit.trace).toBe(true);
    expect(mit.traceAcFt).toBeCloseTo(0.01, 5); // the raw value survives for the ⓘ
  });
  it("an exact-zero requirement stays plain 'not required' (no trace tag)", () => {
    const base = { req: detReqPoint(33.8), providedUsableCf: 34 * AC_FT };
    const [, mit] = yieldVerdictStrip({ ...base, mitigation: { intersectAcres: 0.3, volumeCf: 0, volumeAcFt: 0 }, mitProvided: { creditedCf: 0 } });
    expect(mit.sentence).toBe("not required");
    expect(mit.trace).toBeFalsy();
  });
  it("a real requirement just above the floor still reads SHORT with distinct numbers", () => {
    const base = { req: detReqPoint(33.8), providedUsableCf: 34 * AC_FT };
    const short = yieldVerdictStrip({ ...base, mitigation: { intersectAcres: 2, volumeCf: 0.4 * AC_FT, volumeAcFt: 0.4 }, mitProvided: { creditedCf: 0 } })[0];
    expect(short.pill).toBe("SHORT");
    expect(short.sentence).toBe("0.0 of 0.4 ac-ft");
  });
  it("DISPLAY INVARIANT — a SHORT pair never shows two identical numbers (1-dp collision bumps to 2 dp)", () => {
    const base = { req: detReqPoint(33.8), providedUsableCf: 34 * AC_FT };
    // provided 10.41 vs required 10.44 both round to "10.4" at 1 dp but differ by > EPS → real SHORT.
    const short = yieldVerdictStrip({ ...base, mitigation: { intersectAcres: 2, volumeCf: 10.44 * AC_FT, volumeAcFt: 10.44 }, mitProvided: { creditedCf: 10.41 * AC_FT } })[0];
    expect(short.pill).toBe("SHORT");
    expect(short.sentence).toBe("10.41 of 10.44 ac-ft");
    // the two sides are never string-identical on a SHORT
    const [p, q] = short.sentence.replace(" ac-ft", "").split(" of ");
    expect(p).not.toBe(q);
  });

  it("buildability: pads outside floodplain → OK pill", () => {
    const strip = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: 34 * AC_FT, buildability: { ffe: { status: "no_rule", outsideFloodplain: true } } });
    const ffe = strip.find((v) => v.key === "ffe");
    expect(ffe.pill).toBe("OK");
    expect(ffe.label).toBe("Buildability");
    expect(ffe.sentence).toBe("pads outside floodplain");
    expect(ffe.text).toBe("Buildability: pads outside floodplain");
  });
});

describe("B2 — buildability is a PERMANENT strip row; unassessed reads 'not checked yet' + ↻", () => {
  it("no buildability data → a neutral 'not checked yet' row carrying the recheck flag", () => {
    const strip = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: 34 * AC_FT });
    const ffe = strip.find((v) => v.key === "ffe");
    expect(ffe).toBeTruthy();
    expect(ffe.pill).toBe("…");
    expect(ffe.text).toBe("Buildability: not checked yet");
    expect(ffe.recheck).toBe(true);
  });
  it("the 'not checked yet' row sorts LAST, below a passing detention verdict", () => {
    const strip = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: 34 * AC_FT });
    expect(strip.map((v) => v.key)).toEqual(["det", "ffe"]);
  });
  it("an assessed buildability carries NO recheck flag", () => {
    const strip = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: 34 * AC_FT, buildability: { ffe: { status: "pass", requiredFfeFt: 101.2 } } });
    const ffe = strip.find((v) => v.key === "ffe");
    expect(ffe.recheck).toBeFalsy();
    expect(ffe.pill).toBe("OK");
  });
});

describe("A2 — sort: SHORT first, then loading, then OK", () => {
  it("orders a mixed strip shortfalls-first, preserving det/mit/ffe order within a rank", () => {
    const strip = yieldVerdictStrip({
      req: detReqPoint(33.8), providedUsableCf: 34 * AC_FT, // detention OK
      mitigation: { intersectAcres: 2, volumeCf: 20 * AC_FT, volumeAcFt: 20 }, mitProvided: { creditedCf: 12.4 * AC_FT }, // mitigation SHORT
      buildability: { ffe: { status: "pass", requiredFfeFt: 101.2 } }, // buildability OK
    });
    expect(strip[0].key).toBe("mit"); // the only SHORT leads
    expect(strip[0].pill).toBe("SHORT");
    expect(strip.map((v) => v.key)).toEqual(["mit", "det", "ffe"]);
    expect(strip.length).toBeLessThanOrEqual(3);
  });
});

describe("G2 — no em dash anywhere in the verdict copy", () => {
  it("no sentence or text contains U+2014", () => {
    const strip = yieldVerdictStrip({
      req: detReqBand(28.6, 33.8), providedUsableCf: 0,
      mitigation: { intersectAcres: 2, volumeCf: 20 * AC_FT, volumeAcFt: 20 }, mitProvided: { creditedCf: 12.4 * AC_FT },
      buildability: { ffe: { status: "short", shortByFt: 1.2 } },
    });
    for (const v of strip) {
      expect(v.text.includes(EM_DASH), v.text).toBe(false);
      expect(v.sentence.includes(EM_DASH), v.sentence).toBe(false);
    }
  });
});
