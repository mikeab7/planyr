/* NEW-1 — Task Report: ONE standard Filter dropdown (Status + Project checkboxes with counts) beside Group by / Show / Columns.
 * It amends B2631584 (#2800), whose Status segmented control (All | In Progress | Needs Attention) it replaces. This file is the
 * CI-runnable half (the browser half is ui-audit/verify-task-report-status-filter.mjs): the real pure functions are cut out of
 * public/sequence/index.html (never re-implemented here), plus source guards on the single-classification rule and the toolbar.
 * RED-PROOF: against the pre-change page the markers below do not exist, so every test here fails. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
const START = "// ── Task Report filter (NEW-1)";
const END = "// ── end Task Report filter";
const a = SRC.indexOf(START), b = SRC.indexOf(END);
const block = a > -1 && b > a ? SRC.slice(a, b) : "";
const lib = block
  ? new Function(`${block}\nreturn { REPORT_STATUS_BASE, reportStatusOptions, reportStatusKeys, reportStatusToggle, reportStatusPasses, reportProjectKeys, reportProjectToggle, reportProjectPasses, reportFilterCount, reportFacetCounts, reportFilterPhrase };`)()
  : null;

describe("Task Report filter — status rules", () => {
  it("the block exists in the page", () => { expect(block.length).toBeGreaterThan(0); });

  it("every status is a checkbox, in the approved order, full words; custom statuses follow as extra checkboxes", () => {
    expect(lib.reportStatusOptions([]).map((o) => o.label)).toEqual(["Not Started", "In Progress", "Needs Attention", "Paused", "Complete"]);
    const opts = lib.reportStatusOptions([{ k: "c1", label: "Blocked" }, null, { k: "red", label: "dup of a built-in" }, { k: "c2" }]);
    expect(opts.map((o) => o.k)).toEqual(["gray", "yellow", "red", "paused", "green", "c1", "c2"]);
    expect(opts[5].label).toBe("Blocked");
    expect(lib.reportStatusOptions(undefined).length).toBe(5);       // corrupt settings never throw
    expect(lib.reportStatusOptions("garbage").length).toBe(5);
  });

  it("MIGRATION: a stored legacy `true` (the old chip's default) is In Progress + Needs Attention; `false` ('All') is nothing checked; unset is the default", () => {
    expect(lib.reportStatusKeys(true)).toEqual(["yellow", "red"]);
    expect(lib.reportStatusKeys(undefined)).toEqual(["yellow", "red"]);
    expect(lib.reportStatusKeys(null)).toEqual(["yellow", "red"]);
    expect(lib.reportStatusKeys(false)).toEqual([]);
  });

  it("MIGRATION: what #2800 saved (an array of 'yellow' / 'red', [] for All) maps to the same checkboxes", () => {
    expect(lib.reportStatusKeys(["red"])).toEqual(["red"]);
    expect(lib.reportStatusKeys(["yellow"])).toEqual(["yellow"]);
    expect(lib.reportStatusKeys(["red", "yellow"])).toEqual(["yellow", "red"]);
    expect(lib.reportStatusKeys([])).toEqual([]);                    // All → nothing checked
  });

  it("an array is read in canonical order across ALL statuses; a deleted custom status is dropped; garbage falls back to the default, never to 'nothing matches'", () => {
    const opts = lib.reportStatusOptions([{ k: "c1", label: "Blocked" }]);
    expect(lib.reportStatusKeys(["green", "red", "c1", "gray"], opts)).toEqual(["gray", "red", "green", "c1"]);
    expect(lib.reportStatusKeys(["c9", "red"], opts)).toEqual(["red"]);
    expect(lib.reportStatusKeys(["c9"], opts)).toEqual([]);
    expect(lib.reportStatusKeys("garbage")).toEqual(["yellow", "red"]);
    expect(lib.reportStatusKeys({})).toEqual(["yellow", "red"]);
  });

  it("ticking flips ONE box and leaves the others; unticking the last gives [] (no narrowing)", () => {
    expect(lib.reportStatusToggle(["yellow", "red"], "red")).toEqual(["yellow"]);
    expect(lib.reportStatusToggle(["yellow"], "yellow")).toEqual([]);
    expect(lib.reportStatusToggle([], "green")).toEqual(["green"]);
    expect(lib.reportStatusToggle(["red"], "gray")).toEqual(["gray", "red"]);
  });

  it("a row passes on its displayed status: several boxes = any of them, none = every status (Paused, Complete, custom stay reachable)", () => {
    const all = ["gray", "yellow", "red", "green", "paused", "custom1"];
    const pass = (keys) => all.filter((d) => lib.reportStatusPasses(keys, d));
    expect(pass(["yellow"])).toEqual(["yellow"]);
    expect(pass(["green", "paused"])).toEqual(["green", "paused"]);
    expect(pass(["custom1"])).toEqual(["custom1"]);
    expect(pass([])).toEqual(all);
  });
});

describe("Task Report filter — project rules", () => {
  const IDS = ["1", "2", "3"];
  it("reads the saved ids in the report's order; a stale (deleted) id is dropped; non-arrays mean nothing checked", () => {
    expect(lib.reportProjectKeys(["3", 1], IDS)).toEqual(["1", "3"]);
    expect(lib.reportProjectKeys(["9"], IDS)).toEqual([]);
    expect(lib.reportProjectKeys(undefined, IDS)).toEqual([]);
    expect(lib.reportProjectKeys("x", IDS)).toEqual([]);
  });
  it("toggling flips one project; none checked passes every project, some checked passes only those", () => {
    expect(lib.reportProjectToggle([], 2, IDS)).toEqual(["2"]);
    expect(lib.reportProjectToggle(["2"], 2, IDS)).toEqual([]);
    expect(lib.reportProjectToggle(["3"], 1, IDS)).toEqual(["1", "3"]);
    expect(lib.reportProjectPasses([], 7)).toBe(true);
    expect(lib.reportProjectPasses(["1", "3"], 3)).toBe(true);
    expect(lib.reportProjectPasses(["1", "3"], 2)).toBe(false);
  });
});

describe("Task Report filter — badge, counts, empty wording", () => {
  it("the badge counts filter TYPES in use: Status alone = 1, Project alone = 1, both = 2, neither = 0", () => {
    expect(lib.reportFilterCount(["yellow", "red", "green"], [])).toBe(1);
    expect(lib.reportFilterCount([], ["1"])).toBe(1);
    expect(lib.reportFilterCount(["red"], ["1", "2"])).toBe(2);
    expect(lib.reportFilterCount([], [])).toBe(0);
  });

  const rows = [
    { projId: 1, _disp: "red" }, { projId: 1, _disp: "yellow" }, { projId: 1, _disp: "green" },
    { projId: 2, _disp: "yellow" }, { projId: 2, _disp: "yellow" },
    { projId: 3, _disp: "green" },
  ];
  it("each count is the rows that box would show, given what the OTHER section narrows to", () => {
    // default: In Progress + Needs Attention checked, no project
    let f = lib.reportFacetCounts(rows, ["yellow", "red"], []);
    expect(f.status).toEqual({ red: 1, yellow: 3, green: 2 });          // status counts ignore the status selection itself
    expect(f.project).toEqual({ 1: 2, 2: 2 });                          // project counts follow the status selection (project 3 has none → absent = 0)
    // project 1 only
    f = lib.reportFacetCounts(rows, ["yellow", "red"], ["1"]);
    expect(f.status).toEqual({ red: 1, yellow: 1, green: 1 });
    // nothing checked at all → every row
    f = lib.reportFacetCounts(rows, [], []);
    expect(f.project).toEqual({ 1: 3, 2: 2, 3: 1 });
  });
  it("a count equals the rows shown with only that box ticked (the property the dropdown promises)", () => {
    const shown = (sk, pk) => rows.filter((r) => lib.reportStatusPasses(sk, r._disp) && lib.reportProjectPasses(pk, r.projId)).length;
    const f = lib.reportFacetCounts(rows, ["green"], ["1", "2"]);
    for (const k of ["red", "yellow", "green"]) expect(f.status[k] || 0).toBe(shown([k], ["1", "2"]));
    for (const id of ["1", "2", "3"]) expect(f.project[id] || 0).toBe(shown(["green"], [id]));
  });
  it("the empty-state phrase names the checked statuses and projects, and stays short for many", () => {
    expect(lib.reportFilterPhrase(["Needs Attention"], ["Alpha"])).toBe("Needs Attention · Alpha");
    expect(lib.reportFilterPhrase(["In Progress", "Needs Attention"], [])).toBe("In Progress or Needs Attention");
    expect(lib.reportFilterPhrase([], ["A", "B", "C", "D"])).toBe("A, B, +2 more");
    expect(lib.reportFilterPhrase([], [])).toBe("");
  });
});

describe("Task Report filter — one classification, wired end to end (source guards)", () => {
  const mv = SRC.slice(SRC.indexOf("function MasterView("), SRC.indexOf("// ── PDF helpers"));
  it("rows are classified by the SAME displayed status (dispOf → _disp) that paints the pill and drives the Status sort; the filter reads _disp", () => {
    expect(mv).toMatch(/_disp: dispOf\(t, !isLeaf, rolled, byId\)/);
    expect(mv).toMatch(/levelRows\.filter\(r => reportStatusPasses\(statusKeys, r\._disp\) && reportProjectPasses\(projectKeys, r\.projId\)\)/);
  });
  it("no second hand-written copy of the red/yellow classification is left in the report", () => {
    expect(mv).not.toMatch(/h==="red" \|\| h==="yellow"/);
    expect(mv).not.toMatch(/masterHealthFilter \?/);
  });
  it("the header pill and each group pill count the rows that are drawn (filteredRows / gRows) — never a separate tally", () => {
    expect(mv).toMatch(/\{filteredRows\.length\}<\/span>/);
    expect(mv).toMatch(/\{gRows\.length\}<\/span>/);
  });
  it("the Status segmented control and its label are gone; the toolbar is Filter · Group by · Show · Columns in that order", () => {
    expect(SRC).not.toMatch(/data-status-seg/);
    expect(SRC).not.toMatch(/data-status-filter/);
    expect(SRC).not.toMatch(/\? "In Progress \+ Needs Attn\."/);
    const t = mv.slice(mv.indexOf("data-report-toolbar"));
    const order = ['id="filter"', 'id="group"', 'id="show"', 'id="columns"'].map((s) => t.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });
  it("Filter carries the funnel, the count badge, Clear all, and a checkbox per status and per project", () => {
    expect(mv).toMatch(/data-filter-badge/);
    expect(mv).toMatch(/data-filter-clear/);
    expect(mv).toMatch(/data-filter-status=\{o\.k\}/);
    expect(mv).toMatch(/data-filter-project=\{g\.projId\}/);
    expect(mv).toMatch(/statusOptions\.map\(/);                      // custom statuses ride in statusOptions
  });
  it("Group by is a dropdown reading 'Group by: None|Project' with a single-choice list", () => {
    expect(mv).toMatch(/Group by: <span data-group-current>/);
    expect(mv).toMatch(/role="menuitemradio"/);
  });
  it("the four dropdowns share ONE open slot, close on outside press / Esc, and the menu is a module-scope fixed-position component", () => {
    expect(mv).toMatch(/const \[openMenu, setOpenMenu\] = useState\(null\)/);
    expect(mv).toMatch(/e\.key === "Escape"/);
    expect(SRC).toMatch(/\nfunction ReportMenu\(/);                   // module scope, never inside MasterView
    expect(mv).not.toMatch(/function ReportMenu\(/);
    expect(SRC).toMatch(/position:"fixed",left:pos\?pos\.left:0/);
    expect(SRC).toMatch(/overflowY:"auto"/);
  });
  it("the saved keys are per-browser view prefs; `masterHealthFilter` is unchanged so an account holding `true`/`false`/an array keeps its view", () => {
    expect(SRC).toMatch(/"masterGroupBy", "masterLevelFilter", "masterHealthFilter", "masterProjectFilter", "healthColStyle"\]/);
  });
  it("the empty state is worded for the Filter (not the old 'No tasks are Needs Attention' / 'Show all statuses') and has a way back", () => {
    expect(mv).toMatch(/data-filter-empty/);
    expect(mv).toMatch(/Clear filter<\/button>/);
    expect(mv).not.toMatch(/Show all statuses/);
  });
});
