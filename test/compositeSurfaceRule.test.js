/* B505664 — the guard on the NO-ONE-OWNS-A-COMPOSITE entry itself.
 *
 * ⛔ WHAT THIS CAN AND CANNOT DO, stated up front so the entry is never read as more enforced than it is.
 *
 * "Is this surface a composite?" is not decidable from source, so there is NO generic detector for this
 * rule and this suite does not pretend to be one. Enforcement is behavioural and lives with each
 * instance (the seam sweep, the declaration table, the ink censuses, the pixel counts).
 *
 * What IS checkable is the entry's own integrity, and it is worth checking for one specific reason: this
 * rule's whole value is that it carries its evidence — three named instances, each with a guard. A rule
 * that cites guards which have since been deleted is worse than no rule, because it reads as covered.
 * So: the rule must still be stated, its operative line must still be there, and every guard it names
 * must still exist and still be non-trivial.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RULES = readFileSync(resolve(ROOT, "CLAUDE.md"), "utf8");

/** The rule's own block, from its heading to the start of the next named rule. */
const ruleBlock = () => {
  const i = RULES.indexOf("- **NO-ONE-OWNS-A-COMPOSITE**");
  if (i < 0) return null;
  const j = RULES.indexOf("\n- **", i + 10);
  return RULES.slice(i, j < 0 ? undefined : j);
};

describe("NO-ONE-OWNS-A-COMPOSITE is still stated, with the parts that make it usable", () => {
  it("the rule exists as a named entry", () => {
    expect(ruleBlock(), "the named rule is gone from CLAUDE.md").toBeTruthy();
  });

  it("⛔ the operative line survives — it is the one thing a reader must leave with", () => {
    expect(ruleBlock()).toMatch(/THE GUARD IS INK OR PIXELS, NEVER REGISTRATIONS/);
  });

  it("it still says what a composite IS, and what the obligation is", () => {
    const b = ruleBlock();
    expect(b, "the definition").toMatch(/dissolved region|merged outline|cached raster/i);
    expect(b, "the obligation").toMatch(/invalidate them EXPLICITLY/i);
  });

  it("⛔ it still names where COUNT-EVERY-KIND stops — without that, the next reader believes they are covered", () => {
    const b = ruleBlock();
    expect(b).toMatch(/COUNT-EVERY-KIND/);
    expect(b, "the reason it is not enough").toMatch(/instrument half|says nothing about ink/i);
  });

  it("it still carries its three instances by number, not as theory", () => {
    const b = ruleBlock();
    for (const id of ["B3296", "B494050", "B503184"]) expect(b, id).toContain(id);
  });

  it("…and the shape they share, which is why each survived review", () => {
    expect(ruleBlock()).toMatch(/THE PER-OBJECT SIDE WAS\s*\n?\s*CORRECT AND LOOKED CORRECT/i);
  });

  it("it does NOT imply a generic detector", () => {
    expect(ruleBlock(), "the entry must say plainly that it is prose with per-instance guards")
      .toMatch(/no generic detector/i);
  });
});

describe("⛔ every guard the rule cites still exists — a rule whose evidence was deleted reads as covered", () => {
  /* Named here rather than parsed out of the prose: a parser would silently pass on a typo'd name,
   * and the point is to notice when a guard is gone. */
  const CITED = [
    "test/contentVisibility.test.js",
    "test/hiddenContentReads.test.js",
    "test/docReviewLayerVisibility.test.js",
    "ui-audit/verify-content-visibility.mjs",
    "ui-audit/verify-hidden-content-behaviour.mjs",
    "ui-audit/verify-pdf-layer-hiding.mjs",
    "ui-audit/lib/inkCensus.mjs",
  ];

  it.each(CITED)("%s exists and is non-trivial", (rel) => {
    const p = resolve(ROOT, rel);
    expect(existsSync(p), `${rel} is cited by the rule but is gone`).toBe(true);
    expect(statSync(p).size, `${rel} is a stub`).toBeGreaterThan(500);
  });

  it("the rule's block actually names them (so this list cannot drift from the prose)", () => {
    const b = ruleBlock();
    for (const rel of CITED) {
      const stem = rel.split("/").pop().replace(/\.(test\.js|mjs)$/, "");
      expect(b, `${stem} is in the cited list but not named in the rule`).toContain(stem);
    }
  });
});
