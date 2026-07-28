/* NEW-5 — PANEL-BREVITY, enforced in CI.
 *
 * Owner rule, 2026-07-28: "you keep adding words to the yield panel. So make a rule somewhere in
 * the repo that that's not what we want to do. Less is better. I just want the information
 * literally as brief as it can be."
 *
 * The rule is written in /CLAUDE.md. This is what stops it rotting. Three sessions in a row added
 * copy that was individually CORRECT and collectively a wall of text, because no reviewer was
 * counting. Now the build counts.
 *
 * The budgets carry ZERO headroom (ui-audit/panel-copy-budget.json), so a new visible sentence
 * fails here rather than shipping. The sanctioned fixes are all collapses — "Assumptions &
 * method", a title= hover, a <Collapse> — never deleting a fact. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { measurePanels, checkBudgets, loadBudgets, REGIONS } from "../ui-audit/panel-copy-budget.mjs";

describe("every panel region stays inside its visible-copy budget", () => {
  const { ok, rows } = checkBudgets();

  for (const r of rows) {
    it(`${r.label}: ${r.lines}/${r.maxLines} lines · ${r.chars}/${r.maxChars} chars`, () => {
      expect(
        r.ok,
        `${r.label} is over its PANEL-BREVITY budget (${r.why}).\n` +
        "New copy REPLACES, it does not ACCUMULATE. Fold the explanation into the group's\n" +
        '"Assumptions & method" disclosure (keyedNote), a title= hover, or a <Collapse> — all three\n' +
        "are budget-exempt because all three keep the fact reachable. Do NOT delete a fact to fit.\n" +
        "If the sentence genuinely must be visible by default, raise the number in\n" +
        "ui-audit/panel-copy-budget.json AND justify it on the BACKLOG item.",
      ).toBe(true);
    });
  }

  it("all regions pass together", () => {
    expect(ok).toBe(true);
  });
});

describe("the guard itself cannot silently measure nothing", () => {
  it("every region has a committed budget", () => {
    const budgets = loadBudgets();
    for (const r of REGIONS) expect(budgets.regions[r.key], r.key).toBeDefined();
  });

  it("a moved anchor throws rather than reporting a comfortable zero", () => {
    // The failure mode that would quietly disable this: someone renames the surface, the region
    // slice comes back empty, every budget passes, and the rule dies without a red test.
    expect(() => measurePanels("// a source file with none of the anchors in it")).toThrow(/anchor not found/);
  });

  it("progressive disclosure is genuinely exempt — that is the escape valve the rule wants used", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
    const before = measurePanels(src)["yield-detention-detail"].chars;
    // Wrapping a sentence in a Collapse must reduce the count; leaving it inline must not.
    const inline = src.replace(
      "const detVisible = (() => {",
      'const detVisible = (() => { const x = <div>a brand new visible sentence added to this group</div>;',
    );
    const collapsed = src.replace(
      "const detVisible = (() => {",
      'const detVisible = (() => { const x = <Collapse><div>a brand new visible sentence added to this group</div></Collapse>;',
    );
    expect(measurePanels(inline)["yield-detention-detail"].chars).toBeGreaterThan(before);
    expect(measurePanels(collapsed)["yield-detention-detail"].chars).toBe(before);
  });

  it("hover-only and method-note copy is exempt, so moving detail there is rewarded", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
    const before = measurePanels(src)["yield-detention-detail"].chars;
    const asMethod = src.replace(
      "const detVisible = (() => {",
      'const detVisible = (() => { const x = keyedNote("a brand new explanatory sentence for this group", "k");',
    );
    const asHover = src.replace(
      "const detVisible = (() => {",
      'const detVisible = (() => { const x = <div title="a brand new explanatory sentence for this group" />;',
    );
    expect(measurePanels(asMethod)["yield-detention-detail"].chars).toBe(before);
    expect(measurePanels(asHover)["yield-detention-detail"].chars).toBe(before);
  });
});
