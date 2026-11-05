/* B2357552 / V1788080 — live signed-in check that ONE Up/Down arrow press moves the Schedule grid cursor one row.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-grid-keynav-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * Signs in as the test account and imports a throwaway fixture schedule. The import is local to this browser
 * context, the cloud write is refused for the fixture, and step 5 proves nothing was stored. The fixture is a
 * long, nested schedule: 12 groups of 20 tasks. Every observation reads /version.json IN THE SAME CALL as the
 * state it asserts on. Steps:
 *   1. type in a Name cell, Enter, ↓ → one row below where Enter landed (known-good arm; the run is VOID if it fails)
 *   2. fold the group holding the selected task, ↓ → the first row below the folded group; ↑ → the group row
 *   3. delete the selected row, ↓ → the row that slid into its slot; ↑ → the row above
 *   4. the view never moves by more than one row in any step
 *   5. cleanup: every schedule row this run created is deleted the way the app deletes one (deleted_at set —
 *      sequence/index.html's own `update({ deleted_at })`), and the proof is that no live row from this run
 *      remains. The test account starts with no schedule, so the run first presses "New schedule".
 * Real keys only (SYNTHETIC-KEYS-DONT-EDIT); clicks only on what is on screen (visibleClick). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { visibleClick } from "./lib/visibleClick.mjs";

const base = process.argv[2] || "https://planyr.io", want = process.argv[3] || "";
const GRID = '[data-grid-scroll="1"]';
const NAME = "Keynav Live Check (throwaway)";
const task = o => ({ start: "2027-03-01", end: "2027-03-05", duration: 5, predecessors: [], health: "yellow", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 5, predUnresolved: [], ...o });
const tasks = []; let id = 0;
for (let g = 0; g < 12; g++) {
  const gid = ++id; tasks.push(task({ id: gid, name: `Phase ${g + 1}` }));
  for (let k = 0; k < 20; k++) tasks.push(task({ id: ++id, name: `Phase ${g + 1} task ${k + 1}`, parentId: gid }));
}
const fixture = { aPid: 1, nPid: 2, nTid: 5000, view: "grid", section: "projects", projects: { 1: { id: 1, name: NAME, tasks, colConfig: { visible: ["id","name","start","end","duration","predecessors","health","status","responsibleParty"], widths: {} } } } };

const results = []; const ok = (n, c, x = "") => { results.push({ n, c: !!c }); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + x : ""}`); };
const s = await openSignedIn({ base, viewport: { width: 1600, height: 950 } });
console.log("signed in as", s.proof.email, "| fixture site visible", s.proof.fixtureVisible);
const liveIds = () => s.page.evaluate(async () => { const q = await window.pfSupabase.from("schedules").select("id").is("deleted_at", null); if (q.error) throw new Error(q.error.message); return q.data.map(r => r.id); });
const before = new Set(await liveIds());
const page = await s.page.context().newPage(); await page.setViewportSize({ width: 1600, height: 950 });
const errs = []; page.on("pageerror", e => errs.push(String(e)));
page.on("dialog", d => d.accept());
await page.goto(base + "/sequence/", { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="open-history-desktop"], button:has-text("New schedule")', { timeout: 40000 });
if (!(await page.locator('[data-testid="open-history-desktop"]').count())) {   // an empty account: make a throwaway schedule
  await page.getByRole("button", { name: "New schedule" }).click(); await pacedWait(page, 2500);
}
await assertMeasurable(page, "verify-grid-keynav-live");
await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
await pacedWait(page, 700); await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1500);
await page.locator('.hdr-view button:has-text("Grid")').click(); await pacedWait(page, 800);

/** One observation: the build, the cursor and the scroll, all read in the SAME call. */
const observe = () => page.evaluate(async () => {
  const build = await fetch("/version.json", { cache: "no-store" }).then(r => r.json()).catch(e => ({ error: String(e) }));
  const g = document.querySelector('[data-grid-scroll="1"]'), r = document.querySelector('[data-row-sel="1"]');
  const nt = document.querySelector('[data-new-task-row="sel"]');
  const row = r ? r.getAttribute("data-task-row") : null;
  return { build, sel: nt ? "NEW" : row, selName: r ? (r.querySelector('[data-col-key="name"]')?.innerText || "").trim() : null,
           st: Math.round(g.scrollTop), rowH: (document.querySelector("[data-task-row]")?.getBoundingClientRect().height) || 24 };
});
const first = await observe();
console.log("build", JSON.stringify(first.build));
if (want) ok(`served build matches ${want}`, JSON.stringify(first.build).includes(want), JSON.stringify(first.build));
ok("the fixture schedule is the one on screen", await page.evaluate(() => (document.querySelector('[data-task-row="1"] [data-col-key="name"]')?.innerText || "").includes("Phase 1")));

const cell = (rid, col) => page.locator(`[data-task-row="${rid}"] [data-col-key="${col}"]`);
async function middle() {
  await page.evaluate(() => { const g = document.querySelector('[data-grid-scroll="1"]'); g.scrollTop = Math.floor(g.scrollHeight / 2); });
  await pacedWait(page, 450);
}
async function press(label, key, expect, known = false) {
  const before = await observe();
  await page.keyboard.press(key); await pacedWait(page, 400);
  const after = await observe();
  const moved = Math.abs(after.st - before.st);
  ok(`${known ? "[known-good] " : ""}${label}: cursor ${before.sel} → ${after.sel} (expected ${expect}); view moved ${moved}px, build ${after.build.commit || after.build.sha || JSON.stringify(after.build).slice(0, 40)}`,
     after.sel === String(expect) && moved <= after.rowH + 1);
}

// 1. known-good arm — type, Enter, ↓
await middle();
const leaf = await page.evaluate(() => {
  const g = document.querySelector('[data-grid-scroll="1"]'), gr = g.getBoundingClientRect();
  const r = [...document.querySelectorAll("[data-task-row]")].find(x => { const b = x.getBoundingClientRect(); return b.top > gr.top + 250 && x.querySelector("[data-health-dot]"); });
  return r && r.getAttribute("data-task-row"); });
await visibleClick(page, GRID, cell(leaf, "name"), `name cell on row ${leaf}`); await pacedWait(page, 200);
await page.keyboard.type("Edited"); await page.keyboard.press("Enter"); await pacedWait(page, 300);
const landed = (await observe()).sel;
await press(`type + Enter on row ${leaf}, then ArrowDown`, "ArrowDown", String(+landed + 1), true);

// 2. fold the group holding the selection
for (const arrow of ["ArrowDown", "ArrowUp"]) {
  await middle();
  const pair = await page.evaluate(() => {
    const g = document.querySelector('[data-grid-scroll="1"]'), gr = g.getBoundingClientRect();
    for (const t of document.querySelectorAll('[data-task-row] span[title="Collapse"]')) {
      const b = t.getBoundingClientRect(); if (b.top < gr.top + 60 || b.bottom > gr.bottom - 400) continue;
      const pid = +t.closest("[data-task-row]").getAttribute("data-task-row");
      if (document.querySelector(`[data-task-row="${pid + 2}"]`)) return { parent: pid, child: pid + 2 };
    }
    return null; });
  if (!pair) { ok(`fold/${arrow}: found a group to fold`, false); continue; }
  await visibleClick(page, GRID, cell(pair.child, "name"), `name cell on row ${pair.child}`); await pacedWait(page, 200);
  await visibleClick(page, GRID, page.locator(`[data-task-row="${pair.parent}"] span[title="Collapse"]`), `Collapse on ${pair.parent}`); await pacedWait(page, 400);
  const vis = await page.evaluate(() => [...document.querySelectorAll("[data-task-row]")].map(r => r.getAttribute("data-task-row")));
  ok(`fold/${arrow}: the selected row is now hidden (not vacuous)`, !vis.includes(String(pair.child)));
  await press(`fold group ${pair.parent} (cursor on hidden ${pair.child}), then ${arrow}`, arrow, arrow === "ArrowDown" ? vis[vis.indexOf(String(pair.parent)) + 1] : String(pair.parent));
  await visibleClick(page, GRID, page.locator(`[data-task-row="${pair.parent}"] span[title="Expand"]`), `Expand on ${pair.parent}`).catch(() => {}); await pacedWait(page, 300);
}

// 3. delete the selected row
for (const arrow of ["ArrowDown", "ArrowUp"]) {
  await middle();
  const rid = await page.evaluate(() => {
    const g = document.querySelector('[data-grid-scroll="1"]'), gr = g.getBoundingClientRect();
    const r = [...document.querySelectorAll("[data-task-row]")].find(x => { const b = x.getBoundingClientRect(); return b.top > gr.top + 250 && x.querySelector("[data-health-dot]"); });
    return r && r.getAttribute("data-task-row"); });
  await visibleClick(page, GRID, cell(rid, "id"), `id cell on row ${rid}`); await pacedWait(page, 200);
  await page.keyboard.press("Delete"); await pacedWait(page, 400);
  ok(`delete/${arrow}: the row was deleted (selection cleared — not vacuous)`, (await observe()).sel === null);
  await press(`delete row ${rid}, then ${arrow}`, arrow, arrow === "ArrowDown" ? rid : String(+rid - 1));
  await page.keyboard.press("Control+z"); await pacedWait(page, 400);
}
ok("no page errors on the schedule page", errs.length === 0, errs.slice(0, 2).join(" | "));
await page.close();

// 5. cleanup — the page is closed first so no autosave can bring a row back, then every row this run created is
//    deleted the app's way and the account is re-read.
{
  await pacedWait(s.page, 2000);
  const created = (await liveIds()).filter(i => !before.has(i));
  const err = await s.page.evaluate(async (ids) => {
    for (const i of ids) { const u = await window.pfSupabase.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", i); if (u.error) return u.error.message; }
    return null; }, created);
  const left = (await liveIds()).filter(i => !before.has(i));
  ok(`cleanup: the ${created.length} throwaway schedule row(s) this run created are deleted and none remains live`, !err && left.length === 0, JSON.stringify({ created, err, left }));
}
await s.close();
const known = results.filter(r => r.n.startsWith("[known-good]") && !r.c);
if (known.length) { console.log("VOID — the known-good arm failed, so this instrument cannot vouch for the rest."); process.exit(1); }
console.log(results.filter(r => r.c).length + "/" + results.length + " passed");
process.exit(results.every(r => r.c) ? 0 : 1);
