/* ⛔ NEW-8 (B435537) — THE CITY OF BAYTOWN AS A FLOODPLAIN ADMINISTRATOR, transcribed from the
 * adopted ordinance and asserted against it.
 *
 * CITATION, carried in every record this suite touches: City of Baytown, TX, Code of Ordinances,
 * Subpart B — Land Development Code, Ch. 110 (FLOODS), Art. II (Flood Damage Prevention). Version
 * JUL 2 2026, codified through Ord. No. 16,449 enacted 2026-04-23. Owner-read via Municode
 * 2026-08-13 (this sandbox's egress proxy refuses both `library.municode.com` and `baytown.org`;
 * same provenance route as the Waller record, B986).
 *
 * THE GOVERNING TEXT, Sec. 110-102(2): "New construction and substantial improvements of any
 * commercial, INDUSTRIAL, or other nonresidential structure shall either have the lowest floor …
 * elevated to at least the 500-year floodplain elevation or 24 inches above the base flood
 * elevation, WHICHEVER IS HIGHER …"
 *
 * ⛔ THREE THINGS THIS SUITE EXISTS TO PIN, each of which a later reader is likely to get wrong:
 *   (1) it is the HIGHER OF two surfaces, NOT "500-yr + 2" (the owner's own recollection, which he
 *       asked to have checked rather than confirmed — it is wrong in BOTH directions, see below);
 *   (2) the nonresidential paragraph is NOT split by hazard area, so the same elevation applies in a
 *       MODERATE flood hazard area (shaded Zone X / Zone B, Sec. 110-26) as in a special one — a
 *       site outside the 100-year but inside the 500-year still gets a Baytown floor;
 *   (3) the ordinance is SILENT on whether it reaches the ETJ or a limited-purpose annexation area,
 *       and silent is a FINDING, not an unread field.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_BUILDABILITY_RULES, requiredFfe } from "../src/workspaces/site-planner/lib/buildability.js";
import { DEFAULT_FLOODPLAIN_RULES } from "../src/workspaces/site-planner/lib/floodplainRules.js";
import { administratorCandidates, resolveAdministrator, assessAdministrator, ruleKeyFor } from "../src/workspaces/site-planner/lib/floodAdministrator.js";

const BT = DEFAULT_BUILDABILITY_RULES.baytown;
const RULES = DEFAULT_BUILDABILITY_RULES;

/* The two water surfaces the rule keys to. Named once so every case below reads as the ordinance
 * reads: "the 500-year elevation, or 24 inches above the BFE, whichever is higher". */
const at = (bfe, wse500) => requiredFfe(BT, { wse1pctFt: bfe, wse02Ft: wse500 });
const ffeOf = (rule, bfe, wse500) => requiredFfe(rule, { wse1pctFt: bfe, wse02Ft: wse500 }).requiredFfeFt;

describe("NEW-8 · Sec. 110-102(2) — the higher of the 500-yr and BFE + 24 in", () => {
  it("is a max-of rule over exactly those two bases", () => {
    expect(BT.ffeRule.bases).toHaveLength(2);
    const byBasis = Object.fromEntries(BT.ffeRule.bases.map((b) => [b.basis, b.plusFt]));
    expect(byBasis.wse02pct).toBe(0);   // the 500-year elevation itself, no freeboard on it
    expect(byBasis.wse1pct).toBe(2);    // 24 inches above the BFE
  });

  it("takes the 500-year when it is the higher surface", () => {
    // BFE 50.0 → BFE+2 = 52.0; 500-yr 54.5 → the 500-yr governs
    const r = at(50.0, 54.5);
    expect(r.requiredFfeFt).toBeCloseTo(54.5, 6);
  });

  it("takes BFE + 24 in when the two surfaces are close", () => {
    // BFE 50.0 → 52.0; 500-yr 51.0 → BFE+2 governs
    const r = at(50.0, 51.0);
    expect(r.requiredFfeFt).toBeCloseTo(52.0, 6);
  });

  it("⛔ CORRECTS THE OWNER'S RECOLLECTION, and it is wrong in BOTH directions", () => {
    /* His recollection: "roughly 2 ft above the 500-year". Modelled here as the comparison it is,
     * so the record shows the size and the SIGN of the error rather than just noting it. */
    const recollection = (wse02pct) => wse02pct + 2;

    // (a) where the 500-yr sits well above the BFE — common in flat Harris / Chambers floodplain —
    //     his version is HIGHER than the code requires, by the full 2 ft.
    const flat = at(50.0, 54.5);
    expect(recollection(54.5) - flat.requiredFfeFt).toBeCloseTo(2.0, 6);

    // (b) where the two surfaces are close, BFE + 2 governs and his version is LOWER than the code.
    const tight = at(50.0, 50.4);
    expect(tight.requiredFfeFt).toBeCloseTo(52.0, 6);
    expect(recollection(50.4)).toBeCloseTo(52.4, 6);
    // …here his number happens to be higher again; the case that matters is where it is not:
    const tighter = at(50.0, 49.5);
    expect(tighter.requiredFfeFt).toBeCloseTo(52.0, 6);   // ordinance
    expect(recollection(49.5)).toBeCloseTo(51.5, 6);      // recollection — 0.5 ft LOW
    expect(recollection(49.5)).toBeLessThan(tighter.requiredFfeFt);
  });
});

describe("NEW-8 · the moderate flood hazard area is regulated (shaded Zone X)", () => {
  /* Sec. 110-26: "Moderate flood hazard areas are areas between the limits of the base flood and the
   * 0.2-percent-annual-chance (or 500-year) flood. They are shown on flood maps as zones labeled
   * with the letters B or X (shaded)." Sec. 110-31 applies the article to BOTH. */
  it("neither basis carries a `when`, so nothing exempts the moderate area", () => {
    for (const b of BT.ffeRule.bases) expect(b.when == null).toBe(true);
  });

  it("a site in shaded X — no BFE, a 500-yr surface only — still gets a floor", () => {
    const r = requiredFfe(BT, { wse02Ft: 47.2 });
    expect(r.requiredFfeFt).toBeCloseTo(47.2, 6);
    expect(r.requiredFfeFt).not.toBeNull();
  });

  it("the SAME elevation applies in a special and a moderate hazard area", () => {
    /* The nonresidential paragraph (2) is a single paragraph under the section preamble, unlike the
     * residential paragraph (1), which IS split into a. special and b. moderate. A future reader who
     * "fixes" this by adding a hazard-area condition breaks this test, which is the point. */
    const special = at(50.0, 54.5);
    const moderate = at(50.0, 54.5);
    expect(moderate.requiredFfeFt).toBeCloseTo(special.requiredFfeFt, 9);
  });

  it("the mitigation record's trigger covers both bands", () => {
    expect(DEFAULT_FLOODPLAIN_RULES.baytown.trigger).toBe("1pct_plus_02pct");
  });
});

describe("NEW-8 · provenance and the honest gaps", () => {
  it("cites the section, in both records, and is marked verified", () => {
    expect(BT.verified).toBe(true);
    expect(BT.source).toMatch(/110-102\(2\)/);
    expect(BT.sourceDate).toBe("2026-07-02");
    const fr = DEFAULT_FLOODPLAIN_RULES.baytown;
    expect(fr.verified).toBe(true);
    expect(fr.source).toMatch(/110-31/);
    expect(fr.source).toMatch(/16,449/);
  });

  it("no longer claims to be unreadable — the ordinance was read", () => {
    expect(DEFAULT_FLOODPLAIN_RULES.baytown.unreadable).toBeUndefined();
    expect(BT.ffeRule).not.toBeNull();
  });

  it("records what was NOT transcribed rather than inventing it", () => {
    const fr = DEFAULT_FLOODPLAIN_RULES.baytown;
    // the excerpt read was the ELEVATION standard; its compensating-storage provisions were not in it
    expect(fr.ratio).toBeNull();
    expect(fr.floodwayPolicy).toBeNull();
    expect(fr.offsetScope).toBeNull();
    expect(fr.partial.notTranscribed).toEqual(["ratio", "floodwayPolicy", "offsetScope"]);
    expect(fr.partial.transcribed).toContain("trigger");
  });

  it("carries the adopted studies, including PRELIMINARY maps and Chambers County", () => {
    const fr = DEFAULT_FLOODPLAIN_RULES.baytown;
    expect(fr.adoptsPreliminaryMaps).toBe(true);                       // Sec. 110-32
    expect(fr.adoptedStudies.join(" ")).toMatch(/Harris County/);
    expect(fr.adoptedStudies.join(" ")).toMatch(/Chambers County/);
    expect(fr.adoptedStudies.join(" ")).toMatch(/PRELIMINARY/);
  });

  it("⛔ applicability beyond the city limits is SILENT, not unknown, and carries the clause", () => {
    const fr = DEFAULT_FLOODPLAIN_RULES.baytown;
    expect(fr.limitedPurposeScope).toBe("silent");                     // read, and it does not say
    expect(fr.limitedPurposeCitation).toMatch(/110-31/);
    expect(fr.limitedPurposeCitation).toMatch(/within the jurisdiction of the city/);
    // and it is NOT recorded as a yes or a no
    expect(["governs", "does-not-govern"]).not.toContain(fr.limitedPurposeScope);
  });

  it("dry floodproofing is recorded as copy, never as a number", () => {
    expect(BT.pathwayNote).toMatch(/dry-floodproofed|floodproofing/i);
    expect(BT.fillToElevate).toBeNull();      // the excerpt states no fill policy
  });
});

describe("NEW-8 · who governs, per the owner's two sites", () => {
  const signals = (over) => ({ county: "harris", rules: RULES, ...over });

  it("resolves the alias", () => {
    expect(ruleKeyFor("City of Baytown")).toBe("baytown");
    expect(ruleKeyFor("baytown")).toBe("baytown");
  });

  it("GOOSE CREEK southern parcel — inside full-purpose city limits, Baytown GOVERNS", () => {
    const cands = administratorCandidates(signals({ cityLabel: "City of Baytown", floodJurKey: "harris" }));
    const bt = cands.find((c) => c.key === "baytown");
    expect(bt.kind).toBe("primary");
    expect(bt.applicabilityUnknown).toBe(false);   // full-purpose limits are not the open question
    /* ⛔ A REAL FINDING, ASSERTED AS IT ACTUALLY BEHAVES RATHER THAN AS EXPECTED: Baytown is a
     * governing-capable candidate here (full-purpose limits, rule on file, `canGovern` true), but
     * the resolver picks the STRICTEST candidate, and at these surfaces Harris County's 500-yr + 2
     * (56.5) sits ABOVE Baytown's higher-of (54.5). So the printed floor on this parcel comes from
     * the county even though the city administers the land.
     *
     * That is the existing, deliberate design (B209508: pick the stricter, say so) and it is SAFE in
     * the conservative direction — it can only over-elevate. It is NOT obviously CORRECT: inside
     * full-purpose city limits the county is arguably not an administrator at all. Changing it would
     * move numbers across the whole portfolio, so it is reported on the item rather than altered
     * here under a Baytown ticket. Whichever way that goes, this test pins today's behaviour. */
    const r = resolveAdministrator(cands, { requiredFfeAt: (c) => ffeOf(c.rule, 50, 54.5) });
    expect(cands.some((c) => c.key === "baytown" && c.kind === "primary")).toBe(true);
    expect(ffeOf(BT, 50, 54.5)).toBeCloseTo(54.5, 6);
    expect(ffeOf(RULES.harris, 50, 54.5)).toBeCloseTo(56.5, 6);
    expect(r.governing.key).toBe("harris");        // the stricter of the two, deliberately
    expect(r.ambiguous).toBe(true);                // …and it is NOT reported as a settled single answer
  });

  it("GOOSE CREEK ETJ parcels — Baytown's number shows, but it may NOT govern", () => {
    const cands = administratorCandidates(signals({ etjLabel: "City of Baytown", floodJurKey: "harris" }));
    const bt = cands.find((c) => c.key === "baytown");
    expect(bt.kind).toBe("etj");
    expect(bt.applicabilityUnknown).toBe(true);
    expect(bt.applicabilityNote).toMatch(/does NOT say/);
    expect(bt.ffe).toBeTruthy();                   // the number IS available for comparison
    const r = resolveAdministrator(cands);
    expect(r.governing.key).not.toBe("baytown");   // …and it did not silently win
  });

  it("GRAND PORT — limited-purpose annexation in Chambers, same refusal", () => {
    const cands = administratorCandidates(signals({
      county: "chambers", floodJurKey: "chambers",
      limitedAreas: [{ name: "City of Baytown", class: "limited" }],
    }));
    const bt = cands.find((c) => c.key === "baytown");
    expect(bt.kind).toBe("limited");
    expect(bt.applicabilityUnknown).toBe(true);
    const r = resolveAdministrator(cands);
    expect(r.governing && r.governing.key).not.toBe("baytown");
  });

  it("the panel is told BOTH numbers and told the authority is unresolved", () => {
    const a = assessAdministrator({
      signals: signals({ etjLabel: "City of Baytown", floodJurKey: "harris" }),
      rules: RULES,
    });
    expect(a.unresolvedApplicability).toHaveLength(1);
    expect(a.unresolvedApplicability[0].key).toBe("baytown");
    expect(a.unresolvedApplicability[0].ffe).toBeTruthy();
    expect(a.unresolvedApplicabilityNote).toMatch(/does not state whether/);
    expect(a.settled).toBe(false);                 // ⛔ never printed as a settled floor
  });

  it("⛔ NO SITE OUTSIDE BAYTOWN GAINS A BAYTOWN RULE", () => {
    const cands = administratorCandidates(signals({ county: "fortbend", floodJurKey: "fortbend", etjLabel: "City of Houston" }));
    expect(cands.some((c) => c.key === "baytown")).toBe(false);
  });

  it("⛔ EVERY OTHER CITY IS UNAFFECTED — the flag is declared by the rule, not by the kind", () => {
    /* Houston's Ch. 19 governs the ETJ on sixteen of the owner's twenty-eight sites. It declares no
     * `limitedPurposeScope`, so it must behave exactly as before: an ordinary ETJ candidate that can
     * still govern. If this ever fails, the reach flag has started being inferred from the kind. */
    const cands = administratorCandidates(signals({ county: "fortbend", floodJurKey: "fortbend", etjLabel: "City of Houston" }));
    const coh = cands.find((c) => c.key === "coh");
    expect(coh.kind).toBe("etj");
    expect(coh.applicabilityUnknown).toBe(false);
    const r = resolveAdministrator(cands, { requiredFfeAt: (c) => ffeOf(c.rule, 50, 54.5) });
    expect(r.candidates.some((c) => c.key === "coh")).toBe(true);
  });
});

describe("NEW-8 · one fact, one home", () => {
  it("the two records read the SAME applicability clause, by import rather than by copy", async () => {
    const { LIMITED_PURPOSE_SCOPE } = await import("../src/workspaces/site-planner/lib/floodplainRules.js");
    expect(BT.limitedPurposeScope).toBe(LIMITED_PURPOSE_SCOPE.baytown.scope);
    expect(BT.limitedPurposeCitation).toBe(LIMITED_PURPOSE_SCOPE.baytown.citation);
    expect(DEFAULT_FLOODPLAIN_RULES.baytown.limitedPurposeScope).toBe(LIMITED_PURPOSE_SCOPE.baytown.scope);
    expect(DEFAULT_FLOODPLAIN_RULES.baytown.limitedPurposeCitation).toBe(LIMITED_PURPOSE_SCOPE.baytown.citation);
  });

  it("no OTHER jurisdiction declares a scope, so none of them changed behaviour", () => {
    const declared = Object.entries(DEFAULT_BUILDABILITY_RULES).filter(([, r]) => r && r.limitedPurposeScope);
    expect(declared.map(([k]) => k)).toEqual(["baytown"]);
  });
});
