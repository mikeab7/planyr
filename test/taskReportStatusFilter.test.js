/* NEW-1 — Task Report status filter. The report used to carry one lump chip ("In Progress + Needs Attn.", stored as
 * `masterHealthFilter: true`, cleared to "All Statuses" = `false`). It now has two independent options. This file is the
 * CI-runnable half (the browser half is ui-audit/verify-task-report-status-filter.mjs): the real pure functions are cut out of
 * public/sequence/index.html (never re-implemented here), plus source guards on the single-classification rule.
 * RED-PROOF: against the pre-change page the markers below do not exist, so every test here fails. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
const START = "// ── Task Report status filter (NEW-1)";
const END = "// ── end Task Report status filter";
const a = SRC.indexOf(START), b = SRC.indexOf(END);
const block = a > -1 && b > a ? SRC.slice(a, b) : "";
const lib = block
  ? new Function(`${block}\nreturn { REPORT_STATUS_OPTIONS, reportStatusKeys, reportStatusToggle, reportStatusPasses, reportStatusPhrase };`)()
  : null;

describe("Task Report status filter — the pure rules", () => {
  it("the block exists in the page", () => { expect(block.length).toBeGreaterThan(0); });

  it("a stored legacy `true` (the old default) is BOTH on; a legacy `false` (All Statuses) is neither; unset is the default", () => {
    expect(lib.reportStatusKeys(true)).toEqual(["yellow", "red"]);
    expect(lib.reportStatusKeys(undefined)).toEqual(["yellow", "red"]);
    expect(lib.reportStatusKeys(null)).toEqual(["yellow", "red"]);
    expect(lib.reportStatusKeys(false)).toEqual([]);
  });

  it("an array is read in canonical order; unknown keys are dropped; an unreadable value falls back to the default, never to 'nothing matches'", () => {
    expect(lib.reportStatusKeys(["red"])).toEqual(["red"]);
    expect(lib.reportStatusKeys(["red", "yellow"])).toEqual(["yellow", "red"]);
    expect(lib.reportStatusKeys(["green", "red"])).toEqual(["red"]);
    expect(lib.reportStatusKeys([])).toEqual([]);
    expect(lib.reportStatusKeys("garbage")).toEqual(["yellow", "red"]);
    expect(lib.reportStatusKeys({})).toEqual(["yellow", "red"]);
  });

  it("toggling flips ONE option and leaves the other; the last one off gives [] (= every status), so clearing never dead-ends", () => {
    expect(lib.reportStatusToggle(["yellow", "red"], "red")).toEqual(["yellow"]);
    expect(lib.reportStatusToggle(["yellow", "red"], "yellow")).toEqual(["red"]);
    expect(lib.reportStatusToggle(["yellow"], "yellow")).toEqual([]);
    expect(lib.reportStatusToggle([], "red")).toEqual(["red"]);
    expect(lib.reportStatusToggle(["red"], "yellow")).toEqual(["yellow", "red"]);
  });

  it("a row passes on its displayed status: a single selection narrows, both keeps today's rows, none keeps every status", () => {
    const all = ["gray", "yellow", "red", "green", "paused", "custom1"];
    const pass = (keys) => all.filter((d) => lib.reportStatusPasses(keys, d));
    expect(pass(["yellow"])).toEqual(["yellow"]);
    expect(pass(["red"])).toEqual(["red"]);
    expect(pass(["yellow", "red"])).toEqual(["yellow", "red"]);   // identical to the old `h==="red"||h==="yellow"`
    expect(pass([])).toEqual(all);                                // Not Started / Complete / Paused / custom stay reachable
  });

  it("the empty-state phrase names the selection in full words", () => {
    const nameOf = (o) => o.label;
    expect(lib.reportStatusPhrase(["yellow", "red"], nameOf)).toBe("In Progress or Needs Attention");
    expect(lib.reportStatusPhrase(["red"], nameOf)).toBe("Needs Attention");
    expect(lib.reportStatusPhrase([], nameOf)).toBe("");
  });

  it("the options are full words (the abbreviation only existed to fit the combined chip)", () => {
    expect(lib.REPORT_STATUS_OPTIONS.map((o) => o.label)).toEqual(["In Progress", "Needs Attention"]);
  });
});

describe("Task Report status filter — one classification, wired end to end (source guards)", () => {
  const mv = SRC.slice(SRC.indexOf("function MasterView("), SRC.indexOf("// ── PDF helpers"));
  it("rows are filtered by the SAME displayed status (dispOf → _disp) that paints the pill and drives the Status sort", () => {
    expect(mv).toMatch(/\.filter\(t => reportStatusPasses\(statusKeys, dispOf\(t, childIds\.has\(t\.id\), rolled, byId\)\)\)/);
    expect(mv).toMatch(/_disp: dispOf\(t, !isLeaf, rolled, byId\)/);
  });
  it("no second hand-written copy of the red/yellow classification is left in the report", () => {
    expect(mv).not.toMatch(/h==="red" \|\| h==="yellow"/);
    expect(mv).not.toMatch(/masterHealthFilter \?/);
  });
  it("the header pill and each group pill count the rows that are drawn (filteredRows / gRows) — never a separate tally", () => {
    expect(mv).toMatch(/\{filteredRows\.length\}<\/span>/);
    expect(mv).toMatch(/\{gRows\.length\}<\/span>/);
  });
  it("the old lump chip is gone and the control is the three-segment toggle", () => {
    expect(SRC).not.toMatch(/\? "In Progress \+ Needs Attn\."/);   // the old chip label ternary
    expect(mv).toMatch(/data-status-seg=\{seg\.k\} aria-pressed=\{seg\.on\}/);
    expect(mv).toMatch(/setStatusKeys\(reportStatusToggle\(statusKeys,o\.k\)\)/);
  });
  it("the saved key is unchanged (still one of the per-browser view prefs), so an account that held `true`/`false` keeps working", () => {
    expect(SRC).toMatch(/"masterGroupBy", "masterLevelFilter", "masterHealthFilter", "healthColStyle"\]/);
  });
});
