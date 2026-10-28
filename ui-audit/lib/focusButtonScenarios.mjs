/* B2470832 — "every summary row has a Focus button" scenarios, shared by the local harness
 * (verify-schedule-focus-button.mjs) and the signed-in live one (verify-schedule-focus-button-live.mjs) so both drive
 * the same real fixture. Owner report 2026-10-28 (Grand Port › Master Schedule): the funnel button showed on some
 * summary rows and not on others — Testing Consultants (children all in progress), CMT (its one child in progress)
 * and Alternates (collapsed) had none, Construction/Contract/Bidding did. The fixture reproduces those shapes plus
 * the adjacent cases the owner asked to list. REAL input only (SYNTHETIC-KEYS-DONT-EDIT): clicks + page.keyboard.
 * Known-good arm: Platting has finished/not-started children — it has always had the button, and its click hides them.
 * The run is VOID if that arm is wrong. */
import { pacedWait } from "./tabTiming.mjs";

export const NAME = "Focus Button Fixture";
const task = o => ({ start: "2027-03-01", end: "2027-03-02", duration: 2, predecessors: [], health: "yellow", percentComplete: 0,
  parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 2, predUnresolved: [], ...o });
const ms = o => task({ duration: 0, durValue: 0, end: "2027-03-01", ...o });
export const FIXTURE_TASKS = [
  // Known-good: finished + not-started children -> something to hide (the only shape that ever had the button).
  task({ id: 1, name: "Platting" }),
  task({ id: 2, name: "Open step", parentId: 1 }),
  task({ id: 3, name: "Done step", parentId: 1, health: "green" }),
  task({ id: 4, name: "Not started step", parentId: 1, health: "gray" }),
  // The owner's three: expanded group whose children are all in progress / red (nothing hideable) ...
  task({ id: 10, name: "Testing Consultants" }),
  task({ id: 11, name: "Concrete", parentId: 10 }),
  task({ id: 12, name: "CMT", parentId: 10 }),            // ... a group inside the group, with ONE in-progress child ...
  task({ id: 13, name: "Requested proposal", parentId: 12 }),
  task({ id: 14, name: "Roofing", parentId: 10, health: "red" }),
  // ... and a COLLAPSED group, all complete.
  task({ id: 20, name: "Alternates", health: "green", isExpanded: false }),
  task({ id: 21, name: "Alt one", parentId: 20, health: "green" }),
  task({ id: 22, name: "Alt two", parentId: 20, health: "green" }),
  // Adjacent cases.
  task({ id: 30, name: "Milestones only" }),               // children are all 0-day milestones
  ms({ id: 31, name: "Milestone A", parentId: 30 }),
  ms({ id: 32, name: "Milestone B", parentId: 30 }),
  task({ id: 40, name: "One child group" }),               // exactly one child
  task({ id: 41, name: "Only child", parentId: 40 }),
  task({ id: 50, name: "Level one" }),                     // third-level (and deeper) nesting
  task({ id: 51, name: "Level two", parentId: 50 }),
  task({ id: 52, name: "Level three", parentId: 51 }),
  task({ id: 53, name: "Level four leaf", parentId: 52 }),
  task({ id: 60, name: "No status kids" }),                // children carry no status at all
  task({ id: 61, name: "Blank one", parentId: 60, health: undefined }),
  task({ id: 62, name: "Blank two", parentId: 60, health: undefined }),
  task({ id: 70, name: "Parked active", isExpanded: false }),   // collapsed AND nothing hideable
  task({ id: 71, name: "Hidden child", parentId: 70 }),
  task({ id: 80, name: "Plain top task" }),                // no children -> never a button
];
export const FIXTURE = view => ({ aPid: 1, nPid: 2, nTid: 1000, view, section: "projects", projects: { 1: { id: 1, name: NAME, tasks: FIXTURE_TASKS } } });
export const GROUPS = FIXTURE_TASKS.filter(t => FIXTURE_TASKS.some(c => c.parentId === t.id)).map(t => t.name);
export const LEAVES_VISIBLE = ["Open step", "Concrete", "Requested proposal", "Plain top task", "Milestone A", "Only child", "Level four leaf", "Blank one"];

export const rowsOf = page => page.evaluate(() => [...document.querySelectorAll("[data-task-row]")].map(r => {
  const cell = r.querySelector('[data-col-key="name"]');
  // By title prefix, not an attribute: the SAME detector must work on the pre-fix page, or the red proof proves nothing.
  const chip = r.querySelector('[title^="Focus: hide"], [title^="Show all tasks"]');
  const nameEl = [...r.querySelectorAll('[data-col-key="name"] span[title]')].find(e => !/^(Collapse|Expand|Focus: hide|Show all tasks)/.test(e.getAttribute("title")));
  const cr = cell?.getBoundingClientRect(), kr = chip?.getBoundingClientRect(), nr = nameEl?.getBoundingClientRect();
  return {
    id: Number(r.getAttribute("data-task-row")),
    sel: r.getAttribute("data-row-sel") === "1",
    name: (nameEl?.getAttribute("title") || "").trim(),
    chip: chip ? (chip.getAttribute("title").startsWith("Show all") ? "on" : "off") : null,
    chipTitle: chip ? chip.getAttribute("title") : null,
    // geometry: the chip must sit fully inside its cell and never on top of the task name
    inCell: !!(chip && cr && kr && kr.left >= cr.left - 0.5 && kr.right <= cr.right + 0.5),
    clearOfName: !!(chip && kr && nr && kr.left >= nr.right - 0.5),
  };
}));
const names = async page => (await rowsOf(page)).map(r => r.name);
const row = async (page, name) => (await rowsOf(page)).find(r => r.name === name);
const chipOf = async (page, name) => (await row(page, name))?.chip ?? null;
const pick = async (page, name, col = "id") => { const r = await row(page, name); await page.locator(`[data-task-row="${r.id}"] [data-col-key="${col}"]`).first().click(); await pacedWait(page, 200); };
const clickChip = async (page, name) => { const r = await row(page, name); await page.locator(`[data-task-row="${r.id}"] [title^="Focus: hide"], [data-task-row="${r.id}"] [title^="Show all tasks"]`).click(); await pacedWait(page, 450); };
const altF = async page => { await page.keyboard.press("Alt+f"); await pacedWait(page, 500); };
const undo = async page => { await page.keyboard.press("Control+z"); await pacedWait(page, 500); };

/* newPage(view): a fresh page, booted, the fixture loaded in that view ("grid" | "split"), no Focus set anywhere. */
export async function runFocusButtonScenarios({ newPage, ok, tag = "" }) {
  const L = s => `${tag}${s}`;

  for (const view of ["grid", "split"]) {
    const V = s => L(`[${view}] ${s}`);
    const page = await newPage(view);

    // ── Known-good arm: the shape that always had the button still has it, and it still hides the finished rows.
    const before = await names(page);
    ok(V("[known-good] precondition — fixture loaded, Platting shows its button and its 3 children"), (await chipOf(page, "Platting")) === "off" && before.includes("Done step") && before.includes("Not started step"), before.join(" | "));
    await clickChip(page, "Platting");
    const after = await names(page);
    ok(V("[known-good] clicking Platting's button hides its finished + not-started children"), (await chipOf(page, "Platting")) === "on" && !after.includes("Done step") && !after.includes("Not started step") && after.includes("Open step"), after.join(" | "));
    await undo(page);
    ok(V("[known-good] Ctrl+Z puts them back"), (await chipOf(page, "Platting")) === "off" && (await names(page)).includes("Done step"));

    // ── The point: EVERY row with children has the button — collapsed or expanded, nothing to hide or not.
    const rows = await rowsOf(page);
    for (const g of GROUPS) {
      const r = rows.find(x => x.name === g);
      ok(V(`summary row "${g}" has a Focus button`), r && r.chip === "off", r ? `chip=${r.chip}` : "row not rendered");
    }
    // ── A row with no children never gets one.
    for (const l of LEAVES_VISIBLE) {
      const r = rows.find(x => x.name === l);
      ok(V(`leaf "${l}" has NO Focus button`), r && r.chip === null, r ? `chip=${r.chip}` : "row not rendered");
    }
    // ── Layout: the button sits inside the Task cell and never over the task name.
    const bad = rows.filter(r => r.chip && !(r.inCell && r.clearOfName)).map(r => r.name);
    ok(V("every button sits inside its Task cell, clear of the name"), bad.length === 0, bad.join(", "));
    // ── Tooltip is honest when there is nothing to hide, and keeps the established prefix.
    const tc = await row(page, "Testing Consultants");
    ok(V("nothing-to-hide tooltip says so and keeps the \"Focus: hide\" prefix"), /^Focus: hide .*none right now.*\(Alt\+F\)$/.test(tc?.chipTitle || ""), tc?.chipTitle);
    const pl = await row(page, "Platting");
    ok(V("a group with hideable rows keeps its counted tooltip"), /^Focus: hide 2 completed \/ paused \/ not-started tasks \(Alt\+F\)$/.test(pl?.chipTitle || ""), pl?.chipTitle);

    // ── The button WORKS where nothing is hideable: it flips, nothing else moves, and it is one undo step.
    const allBefore = (await names(page)).join("|");
    await clickChip(page, "Testing Consultants");
    ok(V("clicking Testing Consultants' button turns it on and hides nothing"), (await chipOf(page, "Testing Consultants")) === "on" && (await names(page)).join("|") === allBefore, (await names(page)).join("|"));
    await undo(page);
    ok(V("Ctrl+Z turns it back off"), (await chipOf(page, "Testing Consultants")) === "off");

    // ── Alt+F works on each of the owner's rows (summary selected) and from a child of CMT.
    for (const g of ["Testing Consultants", "CMT", "Alternates", "Parked active"]) {
      await pick(page, g);
      await altF(page);
      const on = await chipOf(page, g);
      await altF(page);
      const off = await chipOf(page, g);
      ok(V(`Alt+F on "${g}" toggles its button on, then off`), on === "on" && off === "off", `${on} -> ${off}`);
    }
    await pick(page, "Requested proposal");
    await altF(page);
    ok(V("Alt+F on CMT's only child toggles CMT's button"), (await chipOf(page, "CMT")) === "on" && (await chipOf(page, "Testing Consultants")) === "off", `${await chipOf(page, "CMT")}/${await chipOf(page, "Testing Consultants")}`);
    await altF(page);

    // ── Pill layout: a COLLAPSED group, focused, with its status counts showing next to the button.
    await clickChip(page, "Alternates");
    const alt = await row(page, "Alternates");
    ok(V("collapsed + focused group: button (with its count pills) stays inside the cell, clear of the name"), alt && alt.chip === "on" && alt.inCell && alt.clearOfName, JSON.stringify(alt));
    await clickChip(page, "Alternates");

    await page.close();
  }
}
