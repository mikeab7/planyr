// v3 CRITERIA-TRUTH milestone, PR-R1 (truth-gates) — NEW-15 partial-dead detention explainer
// + NEW-16 trace-mitigation ⓘ. Behavior for NEW-16 lives in yieldVerdicts.test.js; this guards
// the SitePlanner render wiring by source scan (vitest is DOM-free).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

describe("NEW-15 — the detention explainer matches the numbers above it (partial vs total dead)", () => {
  // NEW-2 (2026-07-28, PANEL-BREVITY) — the explainer is no longer a SENTENCE with a partial /
  // total-dead branch. Both cases are now carried by one number pair ("0.0 of 63.4 ac-ft held"
  // says "none counts yet" without spending a clause on it), and the term-by-term account folds
  // into "Assumptions & method ▸". What NEW-15 and B1032 actually bought — that the gap is
  // accounted for TERM BY TERM and never blamed wholesale on the flood level — is unchanged and
  // is what these tests now guard.
  it("still computes the gap as holds-minus-counts (never 'dead', which was the wrong word)", () => {
    // NEW-1 (B1032) — the difference between what the outline could hold and what counts is NOT
    // all dead storage (berm ring, dedicated compensating storage); calling it "dead" is what
    // produced the wrong "17.4 sits below the flood level" sentence on Tsakiris.
    expect(src).toContain("const gapAcFt = siteCounts != null ? siteHolds - siteCounts : null;");
  });
  it("the visible line is the counted-of-held pair, which covers partial AND total dead alike", () => {
    expect(src).toContain("{f1(siteCounts)} of {f1(siteHolds)} ac-ft held");
    // the old prose branches are gone from the default view
    expect(src.includes("All of its storage sits below the flood level, so none counts yet.")).toBe(false);
    expect(src.includes("left to count for detention.")).toBe(false);
  });
  it("every term of the gap survives, folded — brevity is never bought with accuracy", () => {
    for (const term of ["berm ring", "permanent water", "floodplain compensation", "below flood level"]) {
      expect(src.includes(term), term).toBe(true);
    }
    expect(src).toContain('`Not counted: ${terms.join(" · ")} ac-ft.');
  });
  it("the 'raising the rim' clause is still gated on rimRaiseFeasible (never an empty promise)", () => {
    expect(src).toContain('${d.rimRaiseFeasible ? " Raising the rim adds storage above the flood level." : ""}');
    // rimRaiseFeasible is computed on the drainage object from dead-but-upland ponds
    expect(src).toContain("rimRaiseFeasible: pondLedgerEntries.some((p) => {");
    expect(src).toContain("return holds - counts > 0.05 * 43560 && !p.inTrigger;");
    // the old unconditional "Raising the rim fixes this." claim is gone
    expect(src.includes("so none counts yet. Raising the rim fixes this.")).toBe(false);
  });
});

describe("NEW-16 — a trace mitigation requirement carries its raw ac-ft in the ⓘ", () => {
  it("imports the materiality floor and renders a trace ⓘ with the raw value", () => {
    // NEW-7 added fmtMargin to the same import — assert the SYMBOLS, not the exact line, so a
    // later addition to this import can't fail a test about the trace ⓘ.
    expect(src).toMatch(/import \{[^}]*\byieldVerdictStrip\b[^}]*\bTRACE_ACFT\b[^}]*\} from "\.\/lib\/yieldVerdicts\.js";/);
    expect(src).toContain("{v.trace && v.traceAcFt != null && (");
    expect(src).toContain("about ${v.traceAcFt.toFixed(3)} ac-ft of storage");
    expect(src).toContain("below the ${TRACE_ACFT.toFixed(2)}-ac-ft materiality floor");
  });
});
