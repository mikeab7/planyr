/* NEW-1 / NEW-2 — the pond inspector's detention + mitigation verdict rows.
 *
 * NEW-1: the detention row must NAME its own ledger in the headline (it used to headline the
 * BUILDABILITY answer — "Buildable" — over a VOLUME sub-line, so nothing on the row said
 * "detention" and one row answered two different questions).
 * NEW-2: an over-provided detention ledger must not render as a clean green pass. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  detentionVerdict,
  mitigationVerdict,
  overdugAcFt,
  overProvision,
  OVERDUG_SLACK_FALLBACK,
} from "../src/workspaces/site-planner/lib/pondVerdict.js";
import { criteriaFor, CRITERIA_JUR_KEYS } from "../src/workspaces/site-planner/lib/detentionCriteria.js";

const src = fs.readFileSync(path.join(process.cwd(), "src/workspaces/site-planner/SitePlanner.jsx"), "utf8");

describe("NEW-1 — the detention heading names its ledger and its verdict", () => {
  it("reads 'Detention covered' when the requirement is met (never a bare 'Buildable')", () => {
    const v = detentionVerdict({ providedAcFt: 80, requiredAcFt: 76.7 });
    expect(v.heading).toBe("Detention covered");
    expect(v.heading).not.toMatch(/buildable/i);
    expect(v.subline).toBe("80.0 of 76.7 ac-ft");
    expect(v.tone).toBe("ok");
  });

  it("names the shortfall in the headline: 'Detention short 4.6 ac-ft'", () => {
    const v = detentionVerdict({ providedAcFt: 72.1, requiredAcFt: 76.7 });
    expect(v.heading).toBe("Detention short 4.6 ac-ft");
    expect(v.tone).toBe("short");
    expect(v.short).toBe(true);
  });

  it("hard-blocked + short reads 'Detention not achievable here' and keeps the 'achievable' qualifier on the sub-line", () => {
    const v = detentionVerdict({ providedAcFt: 40, requiredAcFt: 76.7, hardBlocked: true });
    expect(v.heading).toBe("Detention not achievable here");
    expect(v.subline).toBe("40.0 of 76.7 ac-ft achievable");
    expect(v.tone).toBe("amber");
  });

  it("hard-blocked but volume met still names the ledger, and keeps the buildability fact", () => {
    const v = detentionVerdict({ providedAcFt: 90, requiredAcFt: 76.7, hardBlocked: true });
    expect(v.heading).toBe("Detention volume met — not buildable as drawn");
    expect(v.qualifier.text).toMatch(/not buildable as drawn/i);
    expect(v.tone).toBe("amber");
  });

  it("DEMOTES the no-rise certification to the qualifier line, tone preserved (amber)", () => {
    const v = detentionVerdict({ providedAcFt: 80, requiredAcFt: 76.7, needsNoRise: true });
    expect(v.heading).toBe("Detention covered");
    expect(v.qualifier).toEqual(expect.objectContaining({ text: "Buildable — no-rise certification required", tone: "amber" }));
    // the plain-English gloss is preserved on the hover, per the brief
    expect(v.qualifier.title).toMatch(/adds zero rise to the 100-yr flood level/);
    expect(v.tone).toBe("amber");
  });

  it("says the pair is the SITE-WIDE ledger, so the row is never misread as this pond alone", () => {
    expect(detentionVerdict({ providedAcFt: 80, requiredAcFt: 76.7 }).basisNote).toMatch(/Site-wide/);
  });

  it("the mitigation row's shipped wording is unchanged (the brief holds it up as correct)", () => {
    expect(mitigationVerdict({ providedAcFt: 98.2, requiredAcFt: 97.7 }).heading).toBe("Mitigation covered");
    expect(mitigationVerdict({ providedAcFt: 90, requiredAcFt: 97.7 }).heading).toBe("Mitigation short");
    expect(mitigationVerdict({ providedAcFt: 98.2, requiredAcFt: 97.7 }).subline).toBe("98.2 of 97.7 ac-ft");
  });
});

describe("NEW-2 — the over-provision (over-dug) state", () => {
  it("the owner's repro (150.9 provided vs 76.7 required) is no longer a clean green pass", () => {
    const v = detentionVerdict({ providedAcFt: 150.9, requiredAcFt: 76.7 });
    expect(v.over).toBe(true);
    expect(Math.round(v.overAcFt)).toBe(67); // 150.9 − 76.7 − max(1, 7.67) slack
    expect(v.qualifier.tone).toBe("warn");
    expect(v.qualifier.text).toMatch(/Over by ~66\.5 ac-ft/);
    expect(v.qualifier.text).toMatch(/buys no detention credit/);
  });

  it("a pond a few percent over is NOT flagged (freeboard-and-rounding slack, not waste)", () => {
    expect(detentionVerdict({ providedAcFt: 80, requiredAcFt: 76.7 }).over).toBe(false);
    expect(overdugAcFt(80, 76.7)).toBe(0);
  });

  it("the threshold is CRITERIA-CONFIGURABLE, not an inline constant", () => {
    // a stricter jurisdiction slack flags the same pond
    expect(overdugAcFt(80, 76.7, { slackAcFt: 0, slackPct: 0 })).toBeCloseTo(3.3, 6);
    // and every jurisdiction row publishes the pair, so criteriaFor can always supply it
    for (const k of CRITERIA_JUR_KEYS) {
      const c = criteriaFor(k);
      expect(Number.isFinite(c.overdugSlackAcFt.value)).toBe(true);
      expect(Number.isFinite(c.overdugSlackPct.value)).toBe(true);
    }
    expect(OVERDUG_SLACK_FALLBACK).toEqual({ slackAcFt: 1, slackPct: 10 });
  });

  it("prices the excess through the earthwork $/CY when one is set — and NEVER fabricates a cost (LOUD-FAILURE)", () => {
    const priced = overProvision(66.53, { earthPerCy: 8 });
    expect(priced.cy).toBeCloseTo((66.53 * 43560) / 27, 3);
    expect(priced.costUsd).toBeCloseTo(priced.cy * 8, 3);
    expect(priced.text).toMatch(/\$/);
    const unpriced = overProvision(66.53, { earthPerCy: null });
    expect(unpriced.costUsd).toBe(null);
    expect(unpriced.text).not.toMatch(/\$/);
    expect(unpriced.basis).toMatch(/Enter a \$\/CY unit price/);
    expect(detentionVerdict({ providedAcFt: 150.9, requiredAcFt: 76.7 }).qualifier.text).not.toMatch(/\$/);
  });

  it("BASIS: the pair is site-wide, so one big basin on a multi-pond site can't false-flag", () => {
    // site requires 76.7; this pond holds 60, the others 20 → site provides 80, no over-dig.
    const v = detentionVerdict({ providedAcFt: 60 + 20, requiredAcFt: 76.7 });
    expect(v.over).toBe(false);
    expect(v.heading).toBe("Detention covered");
  });

  it("never claims an over-provision on a SHORT or hard-blocked ledger", () => {
    expect(detentionVerdict({ providedAcFt: 10, requiredAcFt: 76.7 }).over).toBe(false);
    expect(detentionVerdict({ providedAcFt: 150.9, requiredAcFt: 76.7, hardBlocked: true }).over).toBe(false);
  });

  it("an over-provision never changes the card tone (a surplus must not out-shout a shortfall)", () => {
    const v = detentionVerdict({ providedAcFt: 150.9, requiredAcFt: 76.7 });
    // NEW-1 (2026-07-28): this used to read "…the ⚡ Optimize button must not ride it" — the
    // optimizer WAS hung on the first non-ok card, so keeping this green here is precisely what
    // made the optimizer vanish. The tone rule stands; the affordance no longer depends on it.
    expect(v.tone).toBe("ok");
  });

  it("unknown provided/required is honest: no verdict numbers invented", () => {
    const v = detentionVerdict({ providedAcFt: null, requiredAcFt: 76.7 });
    expect(v.subline).toBe(null);
    expect(v.over).toBe(false);
    expect(overProvision(0)).toBe(null);
    expect(overProvision(NaN)).toBe(null);
  });
});

describe("NEW-1/NEW-2 — the panel and the print sheet read ONE source (PDF-PARITY)", () => {
  it("the status card is built by the pure module, not by inline strings", () => {
    expect(src).toContain('import { detentionVerdict, mitigationVerdict, overdugAcFt, overProvision } from "./lib/pondVerdict.js";');
    expect(src).toContain("const dv = detentionVerdict({");
    expect(src).toContain("out.push({ ...dv, body });");
    expect(src).toContain("out.push({ ...mitigationVerdict({ providedAcFt: provMitAcFt, requiredAcFt: mitReqAcFt }), body: \"\" });");
    // the old buildability-as-headline strings are gone
    expect(src.includes('  : "Buildable",')).toBe(false);
    expect(src.includes('"Buildable, needs a no-rise certification"')).toBe(false);
  });

  it("the card renders the demoted qualifier line", () => {
    expect(src).toContain("{c.qualifier ? (");
    expect(src).toContain("{c.qualifier.text}</div>");
  });

  it("the print sheet prints the same over-provision off the same helper + the same criteria slack", () => {
    expect(src).toContain("const detOverText = (() => {");
    expect(src).toContain("const over = overdugAcFt(d.providedUsableCf / 43560, reqAcFt, { slackAcFt: cx.overdugSlackAcFt?.value, slackPct: cx.overdugSlackPct?.value });");
    expect(src).toContain("${caution}${detOverText}");
  });

  it("the over-dug threshold has exactly ONE derivation (ledgerBalancer re-exports it)", () => {
    const lb = fs.readFileSync(path.join(process.cwd(), "src/workspaces/site-planner/lib/ledgerBalancer.js"), "utf8");
    expect(lb).toContain('import { overdugAcFt } from "./pondVerdict.js";');
    expect(lb).toContain("export { overdugAcFt };");
    expect(lb.includes("Math.max(0, providedAcFt - requiredAcFt - Math.max(1, requiredAcFt * 0.1))")).toBe(false);
  });
});
