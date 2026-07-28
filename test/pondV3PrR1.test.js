// v3 CRITERIA-TRUTH milestone, PR-R1 (truth-gates) — NEW-15 partial-dead detention explainer
// + NEW-16 trace-mitigation ⓘ. Behavior for NEW-16 lives in yieldVerdicts.test.js; this guards
// the SitePlanner render wiring by source scan (vitest is DOM-free).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

describe("NEW-15 — the detention explainer matches the numbers above it (partial vs total dead)", () => {
  it("computes the dead share and branches on total-vs-partial dead", () => {
    // NEW-1 (B1032) — renamed `gapAcFt`: the difference between what the outline could hold and
    // what counts is NOT all dead storage (berm ring, dedicated compensating storage), and calling
    // it "dead" is what produced the wrong "17.4 sits below the flood level" sentence.
    expect(src).toContain("const gapAcFt = siteCounts != null ? siteHolds - siteCounts : null;");
    expect(src).toContain("const totalDead = siteCounts < ACFT_EPS;");
  });
  it("the PARTIAL sentence names the dead share and its holds total (no more 'none counts' lie)", () => {
    // NEW-1 (B1032) — the partial sentence now names each term of the gap and closes on what is
    // left to count, so it can never claim volume is "below the flood level" when it isn't.
    expect(src).toContain("Of the ${f1(siteHolds)} ac-ft the outline could hold, ${terms.join(\", \")}");
    expect(src).toContain("left to count for detention.${rimClause}");
  });
  it("the TOTAL-dead sentence keeps the original 'none counts yet' wording", () => {
    expect(src).toContain("`All of its storage sits below the flood level, so none counts yet.${rimClause}`");
  });
  it("the 'raising the rim' clause is gated on rimRaiseFeasible (never an empty promise)", () => {
    expect(src).toContain('const rimClause = d.rimRaiseFeasible ? " Raising the rim adds storage above the flood level." : "";');
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
