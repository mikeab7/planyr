// v3 UI SPEC Part A — the Yield-panel verdict strip (A2) + number-format rule (G4).
// Pure tests over lib/yieldVerdicts.js (the repo's vitest config is DOM-free).
import { describe, it, expect } from "vitest";
import { fmtAcFt, fmtProvidedOfRequired, fmtSignedAcFt, fmtMargin, marginFor, yieldVerdictStrip, DEFAULT_MARGIN_PCT_FLOOR_ACFT } from "../src/workspaces/site-planner/lib/yieldVerdicts.js";

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
  // NEW-7 (Cowork yield review) — a covered check is no longer a flat green OK: the chip is BANDED
  // by signed margin, so 34.0 of 33.8 (+0.6% headroom) reads THIN, not OK. A margin that thin is
  // erased by a side-slope change or an as-built survey, and the reader has to be able to see that.
  // The sentence, label and no-action behaviour are unchanged.
  it("detention COVERED but THIN → THIN pill, '{label}: 34.0 of 33.8 ac-ft', no action button", () => {
    const [det] = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: 34.0 * AC_FT });
    expect(det.pill).toBe("THIN");
    expect(det.tone).toBe("warn");
    expect(det.thin).toBe(true);
    expect(det.marginText).toBe("+0.2 ac-ft (+0.6%)");
    expect(det.label).toBe("Detention");
    expect(det.sentence).toBe("34.0 of 33.8 ac-ft");
    expect(det.text).toBe("Detention: 34.0 of 33.8 ac-ft");
    expect(det.short).toBeFalsy();
    expect(det.action).toBeFalsy();
  });

  it("detention COVERED with real headroom → green OK", () => {
    const [det] = yieldVerdictStrip({ req: detReqPoint(33.8), providedUsableCf: 60 * AC_FT });
    expect(det.pill).toBe("OK");
    expect(det.tone).toBe("good");
    expect(det.thin).toBe(false);
    expect(det.margin.band).toBe("ok");
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
    // NEW-7: 34.0 against 33.8 is covered but THIN (+0.6%) — the banded chip, not a flat OK.
    const covered = yieldVerdictStrip({ req: detReqBand(28.6, 33.8), providedUsableCf: 34 * AC_FT })[0];
    expect(covered.pill).toBe("THIN");
    expect(covered.short).toBeFalsy();
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

/* ── The Tsakiris / Concept A panel batch (owner report 2026-07-28) ─────────────────────────── */

// The reported panel: ONE pond, detention 63.4 of 33.8, mitigation 29.6 of 0.2, reconciliation
// FAIL naming 12.2 ac-ft counted twice.
const tsakiris = (over = {}) => ({
  req: { kind: "point", requiredAcFt: 33.8 },
  providedUsableCf: 63.4 * AC_FT,
  mitigation: { intersectAcres: 1.12, volumeCf: 0.16 * AC_FT, volumeAcFt: 0.16 },
  mitProvided: { creditedCf: 29.6 * AC_FT },
  reconcile: { state: "fail", overlapCf: 12.24 * AC_FT, physicalCf: 80.8 * AC_FT, claimedCf: 93.06 * AC_FT,
    offenders: [{ name: "Detention Pond" }], undeclared: [],
    message: "Detention and mitigation together claim 93.1 ac-ft of storage, but only 80.8 ac-ft physically exists. 12.2 ac-ft is counted twice — Detention Pond." },
  ...over,
});

describe("NEW-2 (B1033) — the verdict headline never truncates mid-word", () => {
  it("the reconciliation clause is a separate wrappable SUFFIX, not glued into the nowrap pair", () => {
    const rows = yieldVerdictStrip(tsakiris());
    const det = rows.find((r) => r.key === "det");
    // The bold nowrap element is ONLY the provided/required pair (G1); the clause that used to be
    // clipped at the panel edge ("…12.2 ac-ft counted twi") rides its own wrappable span.
    expect(det.pairText).toBe("63.4 of 33.8 ac-ft");
    expect(det.suffix).toBe("12.2 ac-ft counted twice");
    expect(det.pairText.includes("counted")).toBe(false);
    // The one-line sentence stays intact for legacy readers + the title attribute.
    expect(det.sentence).toBe("63.4 of 33.8 ac-ft — 12.2 ac-ft counted twice");
    expect(det.text.endsWith("twice")).toBe(true);
  });
  it("an elevation-band shortfall carries the same wrappable suffix", () => {
    const rows = yieldVerdictStrip(tsakiris({
      reconcile: null,
      mitigation: { intersectAcres: 2, volumeCf: 20 * AC_FT, volumeAcFt: 20 },
      mitProvided: { creditedCf: 21 * AC_FT },
      mitBands: { known: true, overallPass: false, totalWouldPass: true, shortBands: [1, 2], totals: { shortCf: 100 } },
    }));
    const mit = rows.find((r) => r.key === "mit");
    expect(mit.pairText).toBe("21.0 of 20.0 ac-ft");
    expect(mit.suffix).toBe("2 elevation bands short");
  });
});

describe("NEW-3 (B1034) — a percentage of a near-zero requirement is suppressed", () => {
  it("below the floor the margin drops the percentage and states the requirement", () => {
    const m = marginFor(29.6, 0.16, { key: "mit" });
    expect(m.pct).toBeNull();
    expect(fmtMargin(m)).toBe("+29.4 ac-ft over a 0.2 ac-ft requirement");
    expect(fmtMargin(m).includes("%")).toBe(false);
  });
  it("the pre-fix five-digit percentage can no longer render on the strip", () => {
    const rows = yieldVerdictStrip(tsakiris({ reconcile: null }));
    const mit = rows.find((r) => r.key === "mit");
    expect(mit.marginText.includes("%")).toBe(false);
    expect(mit.marginText).toContain("0.2 ac-ft requirement");
  });
  it("at or above the floor the percentage returns", () => {
    const m = marginFor(34, 33.8, { key: "det" });
    expect(m.pct).toBeCloseTo(0.2 / 33.8, 6);
    expect(fmtMargin(m)).toContain("%");
  });
  it("the floor is CRITERIA-CONFIGURABLE, not an inline constant", () => {
    expect(DEFAULT_MARGIN_PCT_FLOOR_ACFT).toBe(1.0);
    // A jurisdiction that wants percentages down to a tenth of an acre-foot passes its own floor.
    expect(marginFor(29.6, 0.16, { key: "mit", pctFloorAcFt: 0.1 }).pct).not.toBeNull();
    // …and one that wants them only above 50 ac-ft suppresses a normally-shown percentage.
    expect(marginFor(34, 33.8, { key: "det", pctFloorAcFt: 50 }).pct).toBeNull();
  });
  it("the same rule governs the DETENTION group, not just mitigation", () => {
    const rows = yieldVerdictStrip({ req: { kind: "point", requiredAcFt: 0.3 }, providedUsableCf: 12 * AC_FT });
    const det = rows.find((r) => r.key === "det");
    expect(det.margin.pct).toBeNull();
    expect(det.marginText).toContain("0.3 ac-ft requirement");
  });
});

describe("NEW-4 (B1035) — the reconciliation paragraph is stated ONCE", () => {
  it("only the first affected row carries the sentence; the other points at it", () => {
    const rows = yieldVerdictStrip(tsakiris());
    const affected = rows.filter((r) => r.reconcileFail);
    expect(affected.length).toBe(2);
    expect(affected[0].reconcileFail.primary).toBe(true);
    expect(affected[0].reconcileFail.message).toContain("counted twice");
    expect(affected[1].reconcileFail.primary).toBe(false);
    expect(affected[1].reconcileFail.message).toBe("Same storage reconciliation as Detention above.");
    // The full text stays reachable for a tooltip / a11y, just not rendered twice.
    expect(affected[1].reconcileFail.fullMessage).toBe(affected[0].reconcileFail.message);
  });
  it("the offending pond is named the way the map names it", () => {
    const rows = yieldVerdictStrip(tsakiris());
    expect(rows.find((r) => r.reconcileFail).reconcileFail.ponds).toEqual(["Detention Pond"]);
  });
});

describe("NEW-5 (B1036) — an unpriceable pond-berm contribution never reads as a clean pass", () => {
  it("the berm-unknown flag demotes an OK mitigation verdict and marks it understated", () => {
    const rows = yieldVerdictStrip({
      req: { kind: "point", requiredAcFt: 33.8 }, providedUsableCf: 63.4 * AC_FT,
      mitigation: { intersectAcres: 2, volumeCf: 20 * AC_FT, volumeAcFt: 20, flags: ["berm-contribution-unknown"], bermState: "unknown-grade" },
      mitProvided: { creditedCf: 25 * AC_FT },
    });
    const mit = rows.find((r) => r.key === "mit");
    expect(mit.understated).toBe(true);
    expect(mit.bermUnknown).toBe("unknown-grade");
    expect(mit.pill).toBe("THIN");
  });
  it("a priced berm contribution leaves the verdict alone", () => {
    const rows = yieldVerdictStrip({
      req: { kind: "point", requiredAcFt: 33.8 }, providedUsableCf: 63.4 * AC_FT,
      mitigation: { intersectAcres: 2, volumeCf: 20 * AC_FT, volumeAcFt: 20, flags: [], bermState: "counted", bermAcFt: 0.16 },
      mitProvided: { creditedCf: 25 * AC_FT },
    });
    const mit = rows.find((r) => r.key === "mit");
    expect(mit.understated).toBeUndefined();
    expect(mit.pill).toBe("OK");
  });
});

/* ═══ B209508 — a finished-floor elevation may not be stated while its authority is unknown ═══
 *
 * The owner named the exact pattern: "pads assumed at 144.8' FFE" with no named authority. That
 * number comes from whichever floodplain rule survived, and a FAILED jurisdiction lookup removes
 * candidates silently — so the surviving rule can be the LAXER one. At Bain that is the difference
 * between City of Houston Ch. 19's 500-yr basis and Fort Bend County's, which is 1–2 ft of finished
 * floor on a site with two detention ponds. */
describe("B209508 — the Buildability row refuses to state an FFE on an unresolved jurisdiction", () => {
  const bb = (status, ffeFt) => ({ buildability: { ffe: { status, requiredFfeFt: ffeFt } } });
  const rowFor = (d) => yieldVerdictStrip(d).find((r) => r.key === "ffe");

  it("states the number when the jurisdiction IS resolved", () => {
    const r = rowFor({ ...bb("assumed", 144.8), administrator: { unresolved: false } });
    expect(r.sentence).toBe("pads assumed at 144.8′ FFE");
  });

  it("states the GAP, not the number, when a jurisdiction role failed", () => {
    const r = rowFor({ ...bb("assumed", 144.8), administrator: { unresolved: true, unresolvedRoles: ["etj"] } });
    expect(r.sentence).toBe("FFE rule not settled — jurisdiction unknown");
    expect(r.sentence).not.toMatch(/144\.8/);   // the specific pattern the owner asked to eliminate
    expect(r.tone).toBe("warn");
    expect(r.ffeUnsettled).toBe(true);
  });

  it("holds for a PASSING pad too — passing off an incomplete rule set is the same false comfort", () => {
    const r = rowFor({ ...bb("pass", 144.8), administrator: { unresolved: true, unresolvedRoles: ["etj"] } });
    expect(r.sentence).not.toMatch(/144\.8/);
    expect(r.pill).toBe("?");
  });

  it("is inert when no administrator is present at all (unchanged legacy behaviour)", () => {
    const r = rowFor(bb("assumed", 144.8));
    expect(r.sentence).toBe("pads assumed at 144.8′ FFE");
  });
});
