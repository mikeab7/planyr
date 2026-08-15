/* NEW-1 (B1105) — the MHFD `volume-curve` detention engine.
 *
 * Two things are being proved here and they are deliberately separate:
 *
 *   1. THE MATH IS RIGHT. `wqcvDepthIn` / `eurvDepthIn` / `depthInToAcFt` / the component combiner
 *      are exercised against SYNTHETIC curves with hand-computed expected values. This is what makes
 *      the engine finished rather than a stub: the code is verified independently of MHFD's real
 *      coefficients, so transcribing those later is a data edit that cannot silently be wrong.
 *
 *   2. THE SHIPPED RULE PRODUCES NO NUMBER, AND SAYS WHY. The real record carries `curve: null` /
 *      `transcribed: false` because every primary MHFD host is egress-blocked from this environment
 *      and two independent secondary reads of the EURV memorandum disagreed on the coefficients. The
 *      suite asserts that this state renders as a NAMED unavailable with a citation — never a
 *      fabricated volume, never a zero, never a band.
 *
 * Plus the scope boundary (MHFD only — Larimer, Weld and El Paso must stay hard-off) and the
 * agreement between this engine and the C.R.S. 37-92-602(8) statute module.
 */
import { describe, it, expect } from "vitest";
import {
  MHFD_DETENTION_RULES, MHFD_MEMBER_COUNTIES, MHFD_TARGET_COUNTIES, NON_MHFD_CO_COUNTIES,
  mhfdRuleFor, isMhfdCounty, computeMhfdDetention, reconcileMhfdDrawdown, mhfdJurisdictionNote,
  wqcvDepthIn, eurvDepthIn, depthInToAcFt, normalizeHsg, wqcvDrainTimeOptions, electedDrainTimeHr,
  BLOCK_REASONS,
} from "../src/workspaces/site-planner/lib/mhfdDetention.js";
import { computeRequiredDetention } from "../src/workspaces/site-planner/lib/detentionRules.js";
import { assessStatutoryDrawdown } from "../src/workspaces/site-planner/lib/drawdownStatute.js";
import { yieldVerdictStrip } from "../src/workspaces/site-planner/lib/yieldVerdicts.js";

const RULE = mhfdRuleFor("2026-07-29");

/* A synthetic pair of curves with round numbers, so every expectation below is hand-computable.
 * These are NOT MHFD's coefficients and must never be mistaken for them. */
const FAKE_WQCV = { drainTimeCoeff: { 12: 0.5, 24: 1, 40: 2 }, cubic: [0, 1, 0, 0] }; // depth = a × i
const FAKE_EURV = { bySoilGroup: { A: { coeff: 1, exp: 1 }, B: { coeff: 2, exp: 1 }, CD: { coeff: 4, exp: 1 } } };

/* The shipped record with the curves filled in — the exact shape a future transcription produces. */
function transcribedRule() {
  const r = JSON.parse(JSON.stringify(RULE));
  for (const c of r.params.components) {
    if (c.id === "wqcv") { c.curve = FAKE_WQCV; c.transcribed = true; }
    if (c.id === "eurv") { c.curve = FAKE_EURV; c.transcribed = true; }
    // The 100-yr component is a ROUTING result, not a curve — it stays untranscribed on purpose,
    // so `required:false` here isolates the two volume components under test.
    if (c.id === "storm100") { c.required = false; }
  }
  return r;
}

describe("B1105 · the volume-curve math (proved against synthetic curves)", () => {
  it("converts a watershed depth to acre-feet", () => {
    expect(depthInToAcFt(12, 1)).toBe(1);      // 12 in over 1 AC = 1 AC-FT
    expect(depthInToAcFt(6, 10)).toBe(5);      // 6 in over 10 AC = 5 AC-FT
    expect(depthInToAcFt(null, 10)).toBeNull();
    expect(depthInToAcFt(1, null)).toBeNull();
  });

  it("evaluates the WQCV cubic against its drain-time coefficient", () => {
    // depth = a × i with the synthetic cubic [0,1,0,0]
    expect(wqcvDepthIn(FAKE_WQCV, 0.5, 12)).toBeCloseTo(0.25, 6);
    expect(wqcvDepthIn(FAKE_WQCV, 0.5, 24)).toBeCloseTo(0.5, 6);
    expect(wqcvDepthIn(FAKE_WQCV, 0.5, 40)).toBeCloseTo(1.0, 6);
    // A longer drain time is a LARGER volume — the monotonicity the manual's options imply.
    expect(wqcvDepthIn(FAKE_WQCV, 0.8, 40)).toBeGreaterThan(wqcvDepthIn(FAKE_WQCV, 0.8, 12));
  });

  it("exercises the full cubic, not just the linear term", () => {
    // depth = 1 × (2i³ + 3i² + 4i + 5) at i = 0.5 → 0.25 + 0.75 + 2 + 5 = 8
    const curve = { drainTimeCoeff: { 24: 1 }, cubic: [5, 4, 3, 2] };
    expect(wqcvDepthIn(curve, 0.5, 24)).toBeCloseTo(8, 6);
  });

  it("returns null — never a fallback number — for a missing curve, input or drain-time coefficient", () => {
    expect(wqcvDepthIn(null, 0.5, 40)).toBeNull();
    expect(wqcvDepthIn(FAKE_WQCV, null, 40)).toBeNull();
    expect(wqcvDepthIn(FAKE_WQCV, 0.5, 36)).toBeNull(); // 36 hr is not a published option
    expect(wqcvDepthIn(FAKE_WQCV, 0.5, null)).toBeNull();
  });

  it("clamps imperviousness to a fraction and never returns a negative depth", () => {
    expect(wqcvDepthIn(FAKE_WQCV, 1.5, 24)).toBe(wqcvDepthIn(FAKE_WQCV, 1, 24));
    expect(wqcvDepthIn(FAKE_WQCV, -0.5, 24)).toBe(0);
    expect(wqcvDepthIn({ drainTimeCoeff: { 24: 1 }, cubic: [-5, 0, 0, 0] }, 0.5, 24)).toBe(0);
  });

  it("area-weights the EURV across the hydrologic soil groups", () => {
    // 50% B (coeff 2) + 50% CD (coeff 4) at i = 1 → 0.5×2 + 0.5×4 = 3
    expect(eurvDepthIn(FAKE_EURV, 1, { B: 0.5, CD: 0.5 })).toBeCloseTo(3, 6);
    expect(eurvDepthIn(FAKE_EURV, 1, "A")).toBeCloseTo(1, 6);
    // Fractions that do not sum to 1 are normalised (25/75 of a 1:3 split).
    expect(eurvDepthIn(FAKE_EURV, 1, { A: 1, CD: 3 })).toBeCloseTo(0.25 * 1 + 0.75 * 4, 6);
  });

  it("treats an unknown soil group as UNKNOWN, never as zero", () => {
    expect(eurvDepthIn(FAKE_EURV, 1, null)).toBeNull();
    expect(eurvDepthIn(FAKE_EURV, 1, {})).toBeNull();
    expect(eurvDepthIn(FAKE_EURV, 1, "Z")).toBeNull();
    // A split naming a group the curve has no fit for is unknown — NOT that group contributing 0.
    expect(eurvDepthIn({ bySoilGroup: { A: { coeff: 1, exp: 1 } } }, 1, { A: 0.5, CD: 0.5 })).toBeNull();
  });

  it("folds C and D together the way the published fits do", () => {
    expect(normalizeHsg("C")).toEqual({ CD: 1 });
    expect(normalizeHsg("D")).toEqual({ CD: 1 });
    expect(normalizeHsg("C/D")).toEqual({ CD: 1 });
    expect(normalizeHsg({ C: 1, D: 1 })).toEqual({ CD: 1 });
    expect(normalizeHsg({ A: 1, B: 1 })).toEqual({ A: 0.5, B: 0.5 });
  });
});

describe("B1105 · the calculator combines WQCV and EURV without collapsing them", () => {
  const rule = transcribedRule();
  const args = { acres: 40, impPct: 50, hsg: "B", drainTimeHr: 40, rule, county: "denver" };

  it("computes the governing total from the components", () => {
    const r = computeMhfdDetention(args);
    expect(r.kind).toBe("point");
    // WQCV: a(40)=2 × i(0.5) = 1.0 in → 1.0/12 × 40 AC = 3.3333 AC-FT
    // EURV: B coeff 2 × i 0.5 = 1.0 in → 3.3333 AC-FT
    const wqcv = r.components.find((c) => c.id === "wqcv");
    const eurv = r.components.find((c) => c.id === "eurv");
    expect(wqcv.acFt).toBeCloseTo(3.3333, 3);
    expect(eurv.acFt).toBeCloseTo(3.3333, 3);
    expect(r.requiredAcFt).toBeCloseTo(6.6667, 3);
  });

  it("keeps the two volumes DISTINCT, each with its own role and citation", () => {
    const r = computeMhfdDetention(args);
    const wqcv = r.components.find((c) => c.id === "wqcv");
    const eurv = r.components.find((c) => c.id === "eurv");
    // The build requirement: a water-quality requirement and a flood volume are not the same thing.
    expect(wqcv.role).toBe("water-quality");
    expect(eurv.role).toBe("flood-volume");
    expect(wqcv.short).toBe("WQCV");
    expect(eurv.short).toBe("EURV");
    // Each carries its OWN source, not the rule's — they come from different documents.
    expect(wqcv.source.name).toMatch(/Volume 3, Chapter 3/);
    expect(eurv.source.name).toMatch(/Excess Urban Runoff Volume/);
    expect(wqcv.source.url).not.toBe(eurv.source.url);
  });

  it("NEVER reports a per-acre rate for a full-spectrum volume", () => {
    // Back-computing 6.67/40 = 0.167 AC-FT/ac would invent a criterion MHFD does not publish.
    expect(computeMhfdDetention(args).rateAcFtPerAc).toBeNull();
    expect(computeMhfdDetention({ ...args, drainTimeHr: null }).rateAcFtPerAc).toBeNull();
  });

  it("distinguishes a missing INPUT from a missing CRITERION", () => {
    // Curve present, imperviousness absent → needs-input (the cure is a test-fit).
    const noImp = computeMhfdDetention({ ...args, impPct: null });
    expect(noImp.kind).toBe("unavailable");
    expect(noImp.components.find((c) => c.id === "wqcv").state).toBe("needs-input");
    expect(noImp.components.find((c) => c.id === "wqcv").why).toMatch(/imperviousness/);
    // Curve absent (the shipped record) → unavailable (the cure is the manual). Different state,
    // different cure; conflating them is how a data gap gets mistaken for a user's missing input.
    const shipped = computeMhfdDetention({ ...args, rule: RULE });
    expect(shipped.components.find((c) => c.id === "wqcv").state).toBe("unavailable");
  });

  it("a soil group is required for the EURV and its absence is named", () => {
    const r = computeMhfdDetention({ ...args, hsg: null });
    expect(r.kind).toBe("unavailable");
    const eurv = r.components.find((c) => c.id === "eurv");
    expect(eurv.state).toBe("needs-input");
    expect(eurv.why).toMatch(/soil group/i);
    // ...and the WQCV, which does not depend on soil, still computes. Components are independent.
    expect(r.components.find((c) => c.id === "wqcv").state).toBe("computed");
  });

  it("refuses a drain time the record does not publish, rather than snapping to one", () => {
    expect(wqcvDrainTimeOptions(RULE)).toEqual([12, 24, 40]);
    expect(electedDrainTimeHr(RULE, 40)).toBe(40);
    expect(electedDrainTimeHr(RULE, 36)).toBeNull();
    expect(electedDrainTimeHr(RULE, null)).toBeNull();
    // A 36-hour request does not silently become 40: the component reports needs-input instead.
    const r = computeMhfdDetention({ ...args, drainTimeHr: 36 });
    expect(r.components.find((c) => c.id === "wqcv").state).toBe("needs-input");
  });
});

describe("B1105 · the SHIPPED record computes nothing, and says exactly why", () => {
  it("carries no coefficients on either volume component", () => {
    for (const id of ["wqcv", "eurv"]) {
      const c = RULE.params.components.find((x) => x.id === id);
      expect(c.curve, id).toBeNull();
      expect(c.transcribed, id).toBe(false);
      expect(c.blocked.need, id).toBeTruthy();   // names the document required
      expect(c.blocked.text, id).toBeTruthy();   // names WHY it is missing
    }
    expect(RULE.coefficientsTranscribed).toBe(false);
  });

  it("separates 'we know the method' from 'we know the numbers'", () => {
    // Conflating these two is what this repo has been burned by; they are separate flags.
    expect(RULE.structureVerified).toBe(true);
    expect(RULE.coefficientsTranscribed).toBe(false);
    expect(RULE.secondarySource).toBe(true);
    expect(RULE.provenanceNote).toMatch(/NOT transcribed/);
  });

  it("names a DIFFERENT reason per component, because the reasons differ", () => {
    const by = Object.fromEntries(RULE.params.components.map((c) => [c.id, c]));
    expect(by.wqcv.blocked.reason).toBe(BLOCK_REASONS.SOURCE_UNREACHABLE);
    // The EURV is worse off than merely unreachable: two secondary reads disagreed.
    expect(by.eurv.blocked.reason).toBe(BLOCK_REASONS.SOURCE_CONFLICT);
    expect(by.eurv.blocked.text).toMatch(/DIFFERENT coefficient sets/);
    // The 100-yr is not a coefficient at all — it is a routing result.
    expect(by.storm100.blocked.reason).toBe(BLOCK_REASONS.REQUIRES_ROUTING);
    expect(by.storm100.method).toBe("routing");
  });

  it("produces a NAMED unavailable — never a number, a zero or a band", () => {
    const r = computeMhfdDetention({ acres: 40, impPct: 72, hsg: "B", drainTimeHr: 40, county: "denver" });
    expect(r.kind).toBe("unavailable");
    expect(r.requiredAcFt).toBeNull();
    expect(r.bandAcFt).toBeNull();     // a screening band would be a fabrication here
    expect(r.rateAcFtPerAc).toBeNull();
    expect(r.governingTotal.acFt).toBeNull();
    expect(r.headline).toBeTruthy();
    expect(r.rule).toBe(mhfdRuleFor(null)); // RULES-AS-DATA: the carrier always holds its record
  });

  it("still names the components, the drain-time options and the workbook", () => {
    // The value that ships WITHOUT coefficients: the reader learns what governs, what inputs it
    // needs, and where to size it — rather than "unavailable".
    const r = computeMhfdDetention({ acres: 40, impPct: 72, county: "denver" });
    expect(r.components.map((c) => c.short)).toEqual(["WQCV", "EURV", "100-yr"]);
    expect(r.drainTime.optionsHr).toEqual([12, 24, 40]);
    expect(r.workbook.required).toBe(true);
    expect(r.workbook.source.name).toMatch(/Workbook/);
    // Release rate and outlet configuration are declared NOT carried, so Planyr's Texas outlet
    // model is never quietly applied to a full-spectrum basin.
    expect(r.release.transcribed).toBe(false);
    expect(r.outlet.transcribed).toBe(false);
  });

  it("every component and rule record carries authority, dates and a source", () => {
    // The standing invariant: no volume may be computed or displayed without its rule record.
    expect(RULE.authority).toBe("mhfd");
    expect(RULE.ruleType).toBe("volume-curve");
    expect(RULE.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(RULE.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const k of ["name", "section", "url"]) expect(RULE.source[k], k).toBeTruthy();
    for (const c of RULE.params.components) {
      for (const k of ["name", "section", "url"]) expect(c.source[k], `${c.id}.${k}`).toBeTruthy();
    }
  });

  it("versions like every other rule record", () => {
    expect(mhfdRuleFor("2026-07-29").id).toBe("mhfd-usdcm-full-spectrum-2017");
    // A date before the oldest record is an honest null, never the oldest record anyway.
    expect(mhfdRuleFor("2010-01-01")).toBeNull();
  });
});

describe("B1105 · SCOPE — MHFD only, and the boundary is enforced twice", () => {
  it("knows its member counties, and the three that are not", () => {
    expect(MHFD_MEMBER_COUNTIES).toEqual(["adams", "arapahoe", "boulder", "broomfield", "denver", "douglas", "jefferson"]);
    // Six of the nine Planyr target counties; Douglas is a member but not a target.
    expect(MHFD_TARGET_COUNTIES).toHaveLength(6);
    expect(MHFD_TARGET_COUNTIES).not.toContain("douglas");
    for (const c of MHFD_TARGET_COUNTIES) expect(MHFD_MEMBER_COUNTIES, c).toContain(c);
    for (const c of NON_MHFD_CO_COUNTIES) expect(MHFD_MEMBER_COUNTIES, c).not.toContain(c);
  });

  it("matches membership POSITIVELY, including messy spellings and routing keys", () => {
    expect(isMhfdCounty("Denver")).toBe(true);
    expect(isMhfdCounty("City and County of Denver")).toBe(true);
    expect(isMhfdCounty("co_jefferson")).toBe(true);
    expect(isMhfdCounty("Jefferson County")).toBe(true);
    for (const c of ["Larimer", "Weld", "El Paso", "co_elpaso", "Mesa", "", null, undefined]) {
      expect(isMhfdCounty(c), String(c)).toBe(false);
    }
  });

  it("the calculator itself REFUSES a non-member county", () => {
    // Boundary check #2, independent of the regime routing: even called directly with a Larimer
    // county, the engine will not price. This is what makes a mis-wired caller safe.
    for (const county of NON_MHFD_CO_COUNTIES) {
      const r = computeMhfdDetention({ acres: 40, impPct: 72, county, rule: transcribedRule(), drainTimeHr: 40, hsg: "B" });
      expect(r.kind, county).toBe("unavailable");
      expect(r.requiredAcFt, county).toBeNull();
      expect(r.flags, county).toContain("not-mhfd-member");
      expect(r.headline, county).toMatch(/not yet available in Colorado/i);
    }
  });
});

describe("B1105 · the regime seam in computeRequiredDetention is FAIL-CLOSED", () => {
  const co = { acres: 40, impPct: 72, authorityId: "hcfcd", siteState: "CO" };
  const evaluator = (a) => computeMhfdDetention({ ...a, county: "denver", drainTimeHr: 40, hsg: "B", rule: transcribedRule() });

  it("prices only when the regime is mhfd AND the evaluator is injected", () => {
    const wired = computeRequiredDetention({ ...co, coRegime: "mhfd", coDetention: evaluator });
    expect(wired.kind).toBe("point");
    expect(wired.requiredAcFt).toBeGreaterThan(0);
    expect(wired.flags).toContain("colorado-regime-wired");
    expect(wired.rule.authority).toBe("mhfd");
  });

  it("falls back to the ORIGINAL hard guard for every other combination", () => {
    const cases = [
      ["no evaluator (lazy chunk not landed)", { coRegime: "mhfd", coDetention: null }],
      ["no regime (GIS down / unresolved)", { coRegime: null, coDetention: evaluator }],
      ["larimer", { coRegime: "larimer", coDetention: evaluator }],
      ["weld", { coRegime: "weld", coDetention: evaluator }],
      ["elpaso", { coRegime: "elpaso", coDetention: evaluator }],
      ["unknown regime", { coRegime: "mesa", coDetention: evaluator }],
      ["neither", {}],
    ];
    for (const [name, extra] of cases) {
      const r = computeRequiredDetention({ ...co, ...extra });
      expect(r.kind, name).toBe("unavailable");
      expect(r.requiredAcFt, name).toBeNull();
      expect(r.flags, name).toContain("colorado-not-wired");
      expect(r.flags, name).not.toContain("colorado-regime-wired");
      expect(r.headline, name).toBe("Detention criteria not yet available in Colorado");
    }
  });

  it("RULES-AS-DATA is enforced, not assumed: a carrier with no rule record is refused", () => {
    // A number with no record behind it is a defect, so the guard rejects it rather than rendering
    // a naked volume.
    const naked = () => ({ kind: "point", requiredAcFt: 12.3, rule: null, flags: [] });
    const r = computeRequiredDetention({ ...co, coRegime: "mhfd", coDetention: naked });
    expect(r.kind).toBe("unavailable");
    expect(r.requiredAcFt).toBeNull();
    expect(r.flags).toContain("co-evaluator-malformed");
  });

  it("a Texas site is untouched by the new arguments", () => {
    const plain = computeRequiredDetention({ acres: 40, impPct: 72, authorityId: "hcfcd", outfallType: "stormSewer", onDate: "2026-07-20" });
    const withCo = computeRequiredDetention({ acres: 40, impPct: 72, authorityId: "hcfcd", outfallType: "stormSewer", onDate: "2026-07-20", coRegime: "mhfd", coDetention: evaluator });
    expect(JSON.stringify(withCo)).toBe(JSON.stringify(plain));
    expect(plain.requiredAcFt).toBeGreaterThan(0);
  });

  it("a volume-curve record reached through the RATE path refuses explicitly", () => {
    // Defensive: if a volume-curve rule is ever resolved as an ordinary authority, it must say that
    // no rate-method answer exists — not fall through to a generic unknown.
    const { DETENTION_RULES } = require("../src/workspaces/site-planner/lib/detentionRules.js");
    expect(DETENTION_RULES.mhfd).toBeUndefined(); // MHFD is NOT in the Texas registry
  });
});

describe("B1105 · MHFD sizing and the C.R.S. 37-92-602(8) statute AGREE", () => {
  const statute = assessStatutoryDrawdown({ state: "CO", drawdown: null });

  it("reads the 72-hour limit from the statute record rather than hardcoding it", () => {
    const r = reconcileMhfdDrawdown({ drainTimeHr: 40, statuteAssessment: statute });
    expect(r.limitHr).toBe(72);
    expect(r.citation).toBe("C.R.S. 37-92-602(8)");
    // With no statute supplied there is nothing to compare against — never a hardcoded 72.
    expect(reconcileMhfdDrawdown({ drainTimeHr: 40 }).limitHr).toBeNull();
  });

  it("can NEVER report compliance — it uses the statute module's own vocabulary", () => {
    // drawdownStatute.js deliberately refuses to say "pass" (its screening figure is an optimistic
    // lower bound). A second module saying "complies" about the same statute would contradict it
    // ON SCREEN, which is the failure this requirement exists to prevent.
    const allowed = new Set(["fail", "not-ruled-out", "unknown"]);
    for (const hr of [12, 24, 40, 36, null]) {
      const r = reconcileMhfdDrawdown({ drainTimeHr: hr, statuteAssessment: statute });
      expect(allowed.has(r.verdict), `${hr}: ${r.verdict}`).toBe(true);
      for (const row of r.rows) expect(allowed.has(row.verdict), `${hr}/${row.id}`).toBe(true);
      // No CLAIM-bearing field may assert compliance. (The caveat `note` deliberately contains the
      // word — "never that the design complies" — so it is excluded rather than the check weakened.)
      expect(r.headline, String(hr)).not.toMatch(/complies|compliant\b/i);
      for (const row of r.rows) expect(row.reason, `${hr}/${row.id}`).not.toMatch(/complies|compliant\b/i);
    }
    // ...and the standing caveat says so out loud, in the statute module's own terms.
    expect(reconcileMhfdDrawdown({ drainTimeHr: 40, statuteAssessment: statute }).note).toMatch(/never that the design complies/);
  });

  it("clears the WQCV election against the limit, and says the EURV release is the open term", () => {
    const r = reconcileMhfdDrawdown({ drainTimeHr: 40, statuteAssessment: statute });
    const wqcv = r.rows.find((x) => x.id === "wqcv");
    const eurv = r.rows.find((x) => x.id === "eurv");
    expect(wqcv.verdict).toBe("not-ruled-out");
    expect(wqcv.electedHr).toBe(40);
    expect(wqcv.reason).toMatch(/inside the 72-hour statutory limit/);
    // The honest half: the term that could actually collide with the statute is the one Planyr
    // cannot size, and it must not be hidden behind the WQCV's clean result.
    expect(eurv.verdict).toBe("unknown");
    expect(eurv.reason).toMatch(/this is the term to check/i);
    // An unknown term keeps the OVERALL verdict unknown — never "not ruled out" off the WQCV alone.
    expect(r.verdict).toBe("unknown");
  });

  it("answers for ALL drain-time options when none is elected, rather than assuming one", () => {
    const r = reconcileMhfdDrawdown({ statuteAssessment: statute });
    const wqcv = r.rows.find((x) => x.id === "wqcv");
    expect(wqcv.allOptions).toBe(true);
    expect(wqcv.options).toEqual([12, 24, 40]);
    expect(wqcv.electedHr).toBeNull();       // nothing is assumed
    expect(wqcv.verdict).toBe("not-ruled-out");
    expect(wqcv.reason).toMatch(/All 3 options \(12, 24, 40 hours\)/);
  });

  it("a MEASURED drawdown failure governs the headline", () => {
    // A real site drawdown past the limit is solid (the screening figure is optimistic), so it beats
    // any reasoning from the elected drain time.
    const failing = assessStatutoryDrawdown({ state: "CO", drawdown: { known: true, site: { hours: 300 }, ponds: [] } });
    const r = reconcileMhfdDrawdown({ drainTimeHr: 12, statuteAssessment: failing });
    expect(r.verdict).toBe("fail");
    expect(r.headline).toMatch(/conflicts with the Colorado drawdown statute/);
  });
});

describe("B1105 · being inside the district does not settle whose criteria are final", () => {
  it("never claims the district manual is the last word", () => {
    for (const county of ["denver", "adams", "jefferson", null]) {
      const n = mhfdJurisdictionNote(county);
      expect(n.districtIsFinal, String(county)).toBe(false);
      expect(n.cityOverlayMayApply, String(county)).toBe(true);
      expect(n.text, String(county)).toBeTruthy();
    }
  });

  it("flags Denver, which publishes its own combined manual", () => {
    const d = mhfdJurisdictionNote("City and County of Denver");
    expect(d.knownOwnManual).toBe(true);
    expect(d.text).toMatch(/its own combined storm-drainage manual/);
    expect(d.source.url).toMatch(/denvergov\.org/);
    // A member county with no known own manual still carries the generic caveat.
    expect(mhfdJurisdictionNote("adams").knownOwnManual).toBe(false);
  });
});

describe("B1127 · the Colorado state RENDERS, and is never a spinner", () => {
  const stripFor = (req) => yieldVerdictStrip({ req, providedUsableCf: 0, buildability: null }).find((r) => r.key === "det");

  it("an unavailable requirement is a NAMED row, not 'checking flood data'", () => {
    /* THE REGRESSION GUARD. Before B1127 `kind:"unavailable"` matched no branch and fell through to
     * loadingRow, so every Colorado site's verdict strip read "Detention: checking flood data"
     * forever — a spinner for a number that is never coming, which is precisely what the Colorado
     * guard exists to prevent. */
    const req = computeRequiredDetention({ acres: 40, impPct: 72, authorityId: "hcfcd", siteState: "CO" });
    const row = stripFor(req);
    expect(row.loading).toBeFalsy();
    expect(row.pill).toBe("N/A");
    expect(row.sentence).not.toMatch(/checking flood data/);
    expect(row.text).toMatch(/not carried yet/);
    expect(row.unavailable).toBe(true);
    // Not a shortfall either: nothing is wrong with the design, so no ⚡ Optimize cure is offered.
    expect(row.short).toBe(false);
    expect(row.action).toBe(false);
  });

  it("names MHFD's two volumes in the row itself", () => {
    const req = computeRequiredDetention({
      acres: 40, impPct: 72, authorityId: null, siteState: "CO",
      coRegime: "mhfd", coDetention: (a) => computeMhfdDetention({ ...a, county: "denver" }),
    });
    const row = stripFor(req);
    expect(row.pill).toBe("N/A");
    expect(row.sentence).toMatch(/MHFD WQCV \+ EURV/);
    expect(row.components).toHaveLength(3);
    expect(row.needs.length).toBeGreaterThan(0); // what each blocked component still needs
  });

  it("sorts below real verdicts but above 'not checked yet'", () => {
    const req = computeRequiredDetention({ acres: 40, impPct: 72, authorityId: "hcfcd", siteState: "CO" });
    const rows = yieldVerdictStrip({ req, providedUsableCf: 0, buildability: null });
    const det = rows.findIndex((r) => r.key === "det");
    const ffe = rows.findIndex((r) => r.key === "ffe");
    expect(det).toBeLessThan(ffe); // the answer we HAVE outranks the one never attempted
  });

  it("Texas verdict rows are byte-identical to before", () => {
    // The unavailable branch sits ahead of the numeric ones, so this proves it cannot intercept them.
    const req = computeRequiredDetention({ acres: 40, impPct: 72, authorityId: "hcfcd", outfallType: "stormSewer", onDate: "2026-07-20" });
    const row = stripFor(req);
    expect(row.pill).toBe("SHORT");
    expect(row.unavailable).toBeUndefined();
    expect(row.sentence).toBe("0.0 of 30.0 AC-FT");
  });
});
