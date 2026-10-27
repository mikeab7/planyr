/* NEW-1 (B2455200) — the Alt+F "toggle Focus" scenarios, shared by the local harness (verify-schedule-focus-key.mjs)
 * and the signed-in live one (verify-schedule-focus-key-live.mjs) so both press the same real keys against the same
 * fixture. REAL keys only (SYNTHETIC-KEYS-DONT-EDIT): page.keyboard.press. Known-good arm: the chip click path and
 * the "before" state of each scenario (nothing Focused, every row visible) — the run is VOID if either is wrong. */
import { pacedWait } from "./tabTiming.mjs";

export const NAME = "Focus Key Fixture";
const task = o => ({ start: "2027-03-01", end: "2027-03-01", duration: 1, predecessors: [], health: "yellow", percentComplete: 0,
  parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 1, predUnresolved: [], ...o });
export const FIXTURE_TASKS = [
  task({ id: 1, name: "Kickoff" }),
  task({ id: 2, name: "Platting" }),
  task({ id: 3, name: "Open step A", parentId: 2 }),
  task({ id: 4, name: "Open step B", parentId: 2 }),
  task({ id: 5, name: "Done step 5", parentId: 2, health: "green" }),
  task({ id: 6, name: "Done step 6", parentId: 2, health: "green" }),
  task({ id: 7, name: "Not started step", parentId: 2, health: "gray" }),
  task({ id: 8, name: "TIA" }),
  task({ id: 9, name: "TIA scoping", parentId: 8 }),
  task({ id: 10, name: "TIA done", parentId: 8, health: "green" }),
  task({ id: 11, name: "Closing" }),
];
export const FIXTURE = { aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects", projects: { 1: { id: 1, name: NAME, tasks: FIXTURE_TASKS } } };
export const ALL = FIXTURE_TASKS.map(t => t.name);
const PLAT_HIDDEN = ["Done step 5", "Done step 6", "Not started step"];
const without = (names, drop) => names.filter(n => !drop.includes(n));

export const rowsOf = page => page.evaluate(() => [...document.querySelectorAll("[data-task-row]")].map(r => ({
  id: Number(r.getAttribute("data-task-row")),
  sel: r.getAttribute("data-row-sel") === "1",
  name: ([...r.querySelectorAll('[data-col-key="name"] span[title]')].map(e => e.getAttribute("title")).find(t => !/^(Collapse|Expand|Focus: hide|Show all tasks)/.test(t)) || "").trim(),
  chip: (() => { const c = r.querySelector('[title^="Focus: hide"], [title^="Show all tasks"]'); return c ? (c.getAttribute("title").startsWith("Show all") ? "on" : "off") : null; })(),
})));
const idsOf = async page => (await rowsOf(page)).map(r => r.id).join(",");
const names = async page => (await rowsOf(page)).map(r => r.name);
const idOf = async (page, name) => (await rowsOf(page)).find(r => r.name === name)?.id;
const chipOf = async (page, name) => (await rowsOf(page)).find(r => r.name === name)?.chip;
const selOf = async page => (await rowsOf(page)).filter(r => r.sel).map(r => r.name);
const pick = async (page, name, col = "id") => { const id = await idOf(page, name); await page.locator(`[data-task-row="${id}"] [data-col-key="${col}"]`).first().click(); await pacedWait(page, 200); };
const watchKeys = page => page.evaluate(() => { window.__keyLog = []; window.addEventListener("keydown", e => { if (e.code === "KeyF" && e.altKey) window.__keyLog.push({ prevented: e.defaultPrevented }); }); });
const keyLog = page => page.evaluate(() => window.__keyLog);
const altF = async page => { await page.keyboard.press("Alt+f"); await pacedWait(page, 450); };
const undo = async page => { await page.keyboard.press("Control+z"); await pacedWait(page, 500); };

/* newPage(): a fresh page, booted, fixture loaded, no Focus set anywhere. */
export async function runFocusKeyScenarios({ newPage, ok, tag = "" }) {
  const L = s => `${tag}${s}`;
  const fresh = async () => { const page = await newPage(); await watchKeys(page); return page; };   // newPage() has already proved the tab measurable

  // ── Known-good arm: the chip click works on this fixture (Platting's three finished/not-started rows hide)
  { const page = await fresh();
    ok(L("[known-good] precondition — every row visible, no Focus on"), (await names(page)).join("|") === ALL.join("|") && (await chipOf(page, "Platting")) === "off", (await names(page)).join(" | "));
    const id = await idOf(page, "Platting");
    await page.locator(`[data-task-row="${id}"] [title^="Focus: hide"]`).click(); await pacedWait(page, 400);
    ok(L("[known-good] the chip click hides the finished/not-started rows and shows the pressed chip"), (await names(page)).join("|") === without(ALL, PLAT_HIDDEN).join("|") && (await chipOf(page, "Platting")) === "on", (await names(page)).join(" | "));
    await undo(page);
    ok(L("[known-good] Ctrl+Z reverses a chip click (the contract Alt+F must match)"), (await names(page)).join("|") === ALL.join("|") && (await chipOf(page, "Platting")) === "off", (await names(page)).join(" | "));
    await page.close(); }

  // ── 1. Alt+F on a SUMMARY row toggles that row's Focus, both ways
  { const page = await fresh();
    await pick(page, "Platting"); await altF(page);
    ok(L("summary: Alt+F hides its finished / not-started children"), (await names(page)).join("|") === without(ALL, PLAT_HIDDEN).join("|"), (await names(page)).join(" | "));
    ok(L("summary: the chip reads Focus-on (same state a chip click makes)"), (await chipOf(page, "Platting")) === "on");
    ok(L("summary: the summary row stays selected"), (await selOf(page)).join("|") === "Platting", (await selOf(page)).join("|"));
    ok(L("summary: the other group's Focus is untouched"), (await chipOf(page, "TIA")) === "off");
    await altF(page);
    ok(L("summary: Alt+F again shows them all and the chip returns to off"), (await names(page)).join("|") === ALL.join("|") && (await chipOf(page, "Platting")) === "off", (await names(page)).join(" | "));
    ok(L("summary: preventDefault ran on both presses (Chrome's File menu is not opened)"), (await keyLog(page)).length === 2 && (await keyLog(page)).every(k => k.prevented), JSON.stringify(await keyLog(page)));
    await page.close(); }

  // ── 2. Alt+F on a CHILD task toggles its PARENT group; a selection Focus hides moves to the parent summary
  { const page = await fresh();
    await pick(page, "Open step A"); await altF(page);
    ok(L("child: Alt+F on a still-visible child toggles its parent group's Focus"), (await names(page)).join("|") === without(ALL, PLAT_HIDDEN).join("|") && (await chipOf(page, "Platting")) === "on", (await names(page)).join(" | "));
    ok(L("child: a selection that stays visible stays where it was"), (await selOf(page)).join("|") === "Open step A", (await selOf(page)).join("|"));
    await altF(page);
    await pick(page, "Done step 5"); await altF(page);
    ok(L("child: Alt+F on a FINISHED child hides it (and its finished siblings)"), (await names(page)).join("|") === without(ALL, PLAT_HIDDEN).join("|"), (await names(page)).join(" | "));
    ok(L("child: the selection moved to the parent summary row, not left on the hidden row"), (await selOf(page)).join("|") === "Platting", `selected: ${(await selOf(page)).join("|") || "(none)"}`);
    await page.keyboard.press("ArrowDown"); await pacedWait(page, 200);
    ok(L("child: the arrow keys continue from the parent (next visible row)"), (await selOf(page)).join("|") === "Open step A", (await selOf(page)).join("|"));
    await page.close(); }

  // ── 3. A top-level plain task has no group: nothing happens, no error
  { const page = await fresh(); const errs = []; page.on("pageerror", e => errs.push(String(e)));
    await pick(page, "Kickoff", "name");
    ok(L("[known-good] top-level task: Kickoff is selected before the key"), (await selOf(page)).join("|") === "Kickoff", (await selOf(page)).join("|") || "(none)");
    await altF(page);
    ok(L("top-level task: Alt+F changes nothing"), (await names(page)).join("|") === ALL.join("|") && (await chipOf(page, "Platting")) === "off" && (await chipOf(page, "TIA")) === "off", (await names(page)).join(" | "));
    ok(L("top-level task: still selected, no page error"), (await selOf(page)).join("|") === "Kickoff" && errs.length === 0, `selected: ${(await selOf(page)).join("|") || "(none)"} errors: ${errs.join("|") || "none"}`);
    ok(L("top-level task: Chrome's menu is still suppressed (preventDefault ran) — the key is ours on the grid"), (await keyLog(page)).length === 1 && (await keyLog(page))[0].prevented, JSON.stringify(await keyLog(page)));
    await page.close(); }

  // ── 4. While editing a cell the key is left alone (nothing toggles, the editor stays, no preventDefault)
  { const page = await fresh();
    await pick(page, "Open step A", "name"); await page.keyboard.press("Enter"); await pacedWait(page, 350);
    const editing = await page.evaluate(() => document.activeElement && document.activeElement.tagName === "INPUT");
    ok(L("[known-good] editing: a cell editor (input) is open and focused"), editing);
    await altF(page);
    ok(L("editing: Alt+F toggles nothing"), (await idsOf(page)) === FIXTURE_TASKS.map(t => t.id).join(",") && (await chipOf(page, "Platting")) === "off", (await names(page)).join(" | "));
    ok(L("editing: the editor is still open"), await page.evaluate(() => document.activeElement && document.activeElement.tagName === "INPUT"));
    ok(L("editing: the key was not hijacked (no preventDefault)"), (await keyLog(page)).length === 1 && (await keyLog(page))[0].prevented === false, JSON.stringify(await keyLog(page)));
    await page.keyboard.press("Escape"); await pacedWait(page, 250);
    await altF(page);
    ok(L("editing: after Escape Alt+F works again"), (await chipOf(page, "Platting")) === "on", String(await chipOf(page, "Platting")));
    await page.close(); }

  // ── 5. Undo (Ctrl+Z) reverses an Alt+F toggle exactly as it reverses a chip click
  { const page = await fresh();
    await pick(page, "Platting"); await altF(page);
    ok(L("undo: Alt+F applied (precondition)"), (await chipOf(page, "Platting")) === "on");
    await undo(page);
    ok(L("undo: Ctrl+Z reverses the Alt+F toggle — rows back, chip off"), (await names(page)).join("|") === ALL.join("|") && (await chipOf(page, "Platting")) === "off", (await names(page)).join(" | "));
    await page.keyboard.press("Control+y"); await pacedWait(page, 400);
    ok(L("undo: redo (Ctrl+Y) re-applies it"), (await chipOf(page, "Platting")) === "on");
    await page.close(); }

  // ── 6. Multi-row selection: the group of the TOP selected row
  { const page = await fresh();
    await pick(page, "Platting");
    for (let k = 0; k < 3; k++) await page.keyboard.press("Shift+ArrowDown");
    await pacedWait(page, 250); await altF(page);
    ok(L("multi-row (top row = a summary): toggles that summary's Focus only"), (await chipOf(page, "Platting")) === "on" && (await chipOf(page, "TIA")) === "off", `${await chipOf(page, "Platting")}/${await chipOf(page, "TIA")}`);
    await page.close(); }
  { const page = await fresh();
    await pick(page, "Kickoff");
    for (let k = 0; k < 3; k++) await page.keyboard.press("Shift+ArrowDown");
    await pacedWait(page, 250); await altF(page);
    ok(L("multi-row (top row = a top-level task): does nothing, even though the range touches groups"), (await chipOf(page, "Platting")) === "off" && (await chipOf(page, "TIA")) === "off");
    await page.close(); }
}
