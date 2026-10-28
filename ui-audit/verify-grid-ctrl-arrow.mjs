/* NEW-1 (B2451776, owner request 2026-10-28) — Ctrl/Cmd+Arrow in the Schedule grid jumps across blank cells like
 * Excel. Real keys in a real grid, on a THROWAWAY fixture schedule (never a real plan).
 *
 *   node ui-audit/verify-grid-ctrl-arrow.mjs                                   local build (public/sequence/index.html)
 *   E2E_LOGIN_KEY=… node ui-audit/verify-grid-ctrl-arrow.mjs https://planyr.io [expectedBuildPrefix]
 *                                                                               signed in on the deployed site
 *
 * The signed-in run imports the fixture into one browser context (the import is local; step "cleanup" proves no
 * schedule row from this run stays live, the way verify-grid-keynav-live.mjs does) and reads /version.json IN THE
 * SAME CALL as every observation (a stale tab is a void measurement).
 *
 * THE FIXTURE (Owner / Cost / Notes columns visible; owner and cost are blank on most rows ON PURPOSE):
 *   1 Site (group)        owner –    cost 400 (rolled)        children 2 3 4 5
 *   2 Survey              owner Dana cost 100   note
 *   3 Grading             –          –
 *   4 Utilities           –          –
 *   5 Paving              owner Lee  cost 300
 *   6 Building (group)    owner –    cost 900 (rolled)        children 7 8 9
 *   7 Slab, 8 Frame       –          –
 *   9 Roof                owner Kim  cost 900
 *   10 … 70 Closeout N    –          –                        (top-level filler so the grid has to SCROLL)
 *
 * ⛔ A KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): a click lands on the cell it aimed at and a plain
 * ArrowDown moves exactly one row. If it does not, the run is VOID — the instrument cannot see the cursor.
 * ⛔ Real keys only (SYNTHETIC-KEYS-DONT-EDIT); clicks only on what is on screen (visibleClick); a hidden tab
 * cannot be measured (FOREGROUND-OR-VOID). The expected landings below are derived BY HAND from the fixture
 * picture, never from the code under test.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { visibleClick } from "./lib/visibleClick.mjs";

const base = process.argv[2] || null, want = process.argv[3] || "";
const GRID = '[data-grid-scroll="1"]';
const NAME = "Ctrl Arrow Check (throwaway)";
const LAST = 70;

const task = o => ({ start: "2027-03-01", end: "2027-03-05", duration: 5, predecessors: [], health: "yellow", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 5, predUnresolved: [], ...o });
const tasks = [
  task({ id: 1, name: "Site" }),
  task({ id: 2, name: "Survey", parentId: 1, responsibleParty: "Dana", cost: 100, notes: [{ date: "2026-10-01", text: "call county" }] }),
  task({ id: 3, name: "Grading", parentId: 1 }),
  task({ id: 4, name: "Utilities", parentId: 1 }),
  task({ id: 5, name: "Paving", parentId: 1, responsibleParty: "Lee", cost: 300 }),
  task({ id: 6, name: "Building" }),
  task({ id: 7, name: "Slab", parentId: 6 }),
  task({ id: 8, name: "Frame", parentId: 6 }),
  task({ id: 9, name: "Roof", parentId: 6, responsibleParty: "Kim", cost: 900 }),
];
for (let i = 10; i <= LAST; i++) tasks.push(task({ id: i, name: `Closeout ${i - 9}` }));
const VISIBLE = ["id", "name", "start", "end", "duration", "predecessors", "health", "status", "responsibleParty", "cost", "notes"];
const fixture = { aPid: 1, nPid: 2, nTid: 5000, view: "grid", section: "projects", projects: { 1: { id: 1, name: NAME, tasks, colConfig: { visible: VISIBLE, widths: {} } } } };

const results = [];
const ok = (n, c, x = "") => { results.push({ n, c: !!c }); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + x : ""}`); };

// ── open the page: local build, or signed in on the deployed site ─────────────────────────────────────────
let page, closeAll, signed = null, liveIds = null, before = null, server = null;
if (base) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  signed = await openSignedIn({ base, viewport: { width: 1600, height: 760 } });
  console.log("signed in as", signed.proof.email, "| fixture site visible", signed.proof.fixtureVisible);
  liveIds = () => signed.page.evaluate(async () => { const q = await window.pfSupabase.from("schedules").select("id").is("deleted_at", null); if (q.error) throw new Error(q.error.message); return q.data.map(r => r.id); });
  before = new Set(await liveIds());
  page = await signed.page.context().newPage();
  await page.setViewportSize({ width: 1600, height: 760 });
  closeAll = () => signed.close();
} else {
  const { ensureVendored, rewriteCdn, serveVendored } = await import("./lib/vendorCdn.mjs");
  await ensureVendored();
  const ROOT = new URL("../public/", import.meta.url).pathname;
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
  server = createServer(async (req, res) => {
    try {
      if (await serveVendored(req, res)) return;
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      let body = await readFile(fp);
      if (p.endsWith("sequence/index.html")) body = Buffer.from(rewriteCdn(body.toString("utf8")));
      res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 760 } });
  page = await ctx.newPage();
  closeAll = async () => { await browser.close(); server.close(); };
}
const errs = [];
page.on("pageerror", e => errs.push(String(e)));
page.on("dialog", d => d.accept());
const url = base ? base.replace(/\/$/, "") + "/sequence/" : `http://localhost:${server.address().port}/sequence/`;
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector('[data-testid="open-history-desktop"], button:has-text("New schedule")', { timeout: 40000 });
if (!(await page.locator('[data-testid="open-history-desktop"]').count())) {   // an empty account: make a throwaway schedule
  await page.getByRole("button", { name: "New schedule" }).click(); await pacedWait(page, 2500);
}
await assertMeasurable(page, "verify-grid-ctrl-arrow");
await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
await pacedWait(page, 700); await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1500);
await page.locator('.hdr-view button:has-text("Grid")').click(); await pacedWait(page, 800);

// ── instruments ───────────────────────────────────────────────────────────────────────────────────────────
const observe = () => page.evaluate(async () => {
  const build = await fetch("/version.json", { cache: "no-store" }).then(r => r.json()).catch(e => ({ error: String(e) }));
  const nt = document.querySelector('[data-new-task-row="sel"]');
  const c = document.querySelector('[data-cell-active="1"]');
  const r = c && c.closest("[data-task-row]");
  const g = document.querySelector('[data-grid-scroll="1"]');
  const gr = g.getBoundingClientRect();
  const inView = id => { const el = document.querySelector(`[data-task-row="${id}"]`); if (!el) return false; const b = el.getBoundingClientRect(); return b.top >= gr.top + 28 && b.bottom <= gr.bottom + 1; };
  const activeRow = nt ? "NEW" : (r ? r.getAttribute("data-task-row") : null);
  return {
    build, row: activeRow, col: c ? c.getAttribute("data-col-key") : null,
    range: [...document.querySelectorAll('[data-cell-in-range="1"]')].map(x => x.closest("[data-task-row]").getAttribute("data-task-row") + ":" + x.getAttribute("data-col-key")),
    activeInView: activeRow && activeRow !== "NEW" ? inView(activeRow) : null, st: Math.round(g.scrollTop),
    rowsInView: [...document.querySelectorAll("[data-task-row]")].map(x => x.getAttribute("data-task-row")).filter(inView),
  };
});
const cell = (rid, col) => page.locator(`[data-task-row="${rid}"] [data-col-key="${col}"]`);
const top = async () => { await page.evaluate(() => { document.querySelector('[data-grid-scroll="1"]').scrollTop = 0; }); await pacedWait(page, 300); };
const click = async (rid, col) => { await top(); await visibleClick(page, GRID, cell(rid, col), `${col} cell on row ${rid}`); await pacedWait(page, 200); };
const build = o => (o.build.commit || o.build.sha || JSON.stringify(o.build)).toString().slice(0, 9);

/** Press `key`, require the active cell to be (row, col). `col` omitted = unchanged. */
async function expectActive(label, key, row, col, known = false) {
  const b = await observe();
  await page.keyboard.press(key); await pacedWait(page, 350);
  const a = await observe();
  const wantCol = col === undefined ? b.col : col;
  ok(`${known ? "[known-good] " : ""}${label}: (${b.row},${b.col}) → (${a.row},${a.col}) expected (${row},${wantCol}) [build ${build(a)}]`,
    a.row === String(row) && (wantCol == null || a.col === wantCol) && a.range.length === 0);
  return a;
}

const first = await observe();
console.log("build", JSON.stringify(first.build));
if (want) ok(`served build matches ${want}`, JSON.stringify(first.build).includes(want), JSON.stringify(first.build));
ok("the fixture schedule is the one on screen", await page.evaluate(() => (document.querySelector('[data-task-row="1"] [data-col-key="name"]')?.innerText || "").includes("Site")));

// ── 0. known-good arm ────────────────────────────────────────────────────────────────────────────────────
await click(2, "responsibleParty");
{
  const a = await observe();
  ok("[known-good] a click lands on the cell it aimed at (row 2, Owner)", a.row === "2" && a.col === "responsibleParty", JSON.stringify([a.row, a.col]));
}
await expectActive("plain ArrowDown moves exactly one row", "ArrowDown", 3, "responsibleParty", true);
if (results.some(r => r.n.startsWith("[known-good]") && !r.c)) { console.log("VOID — the known-good arm failed, so this instrument cannot vouch for the rest."); await closeAll(); process.exit(1); }

// ── A. Owner column, expanded — blank-skipping, both directions, edge is the last TASK row ───────────────
console.log("\nA. Owner column (Dana row 2, Lee row 5, Kim row 9; everything else blank)");
await click(2, "responsibleParty");
await expectActive("Ctrl+Down from Dana (next cell blank) → next filled: Lee", "Control+ArrowDown", 5);
await expectActive("Ctrl+Down from Lee → Kim (past the Building group row)", "Control+ArrowDown", 9);
{
  const a = await expectActive(`Ctrl+Down from Kim (nothing filled below) → the last TASK row ${LAST}`, "Control+ArrowDown", LAST);
  ok(`  … and the view scrolled the target into sight`, a.activeInView === true, JSON.stringify({ st: a.st, rowsInView: a.rowsInView.slice(-3) }));
  ok(`  … and it is the last task row, not "+ New task"`, a.row !== "NEW");
}
await expectActive("Ctrl+Down on the last task row stays put", "Control+ArrowDown", LAST);
await expectActive("Ctrl+Up from a blank row → the nearest filled cell above: Kim", "Control+ArrowUp", 9);
await expectActive("Ctrl+Up from Kim → Lee", "Control+ArrowUp", 5);
await expectActive("Ctrl+Up from Lee → Dana", "Control+ArrowUp", 2);
{
  const a = await expectActive("Ctrl+Up from Dana (nothing filled above) → the first row", "Control+ArrowUp", 1);
  ok("  … and the view is back at the top", a.activeInView === true && a.st === 0, JSON.stringify({ st: a.st }));
}

// ── B. Cost column — a summary's rolled-up value counts as FILLED ─────────────────────────────────────────
console.log("\nB. Cost column (group 1 rolled 400, Survey 100, Paving 300, group 6 rolled 900, Roof 900)");
await click(1, "cost");
await expectActive("Ctrl+Down from the Site group (rolled cost) with Survey filled below → end of that run: Survey", "Control+ArrowDown", 2);
await expectActive("Ctrl+Down from Survey (Grading blank) → Paving", "Control+ArrowDown", 5);
await expectActive("Ctrl+Down from Paving; the Building group's rolled cost is filled → end of run: the Building group", "Control+ArrowDown", 6);
await expectActive("Ctrl+Down from the Building group (Slab blank) → Roof", "Control+ArrowDown", 9);
await expectActive(`Ctrl+Down from Roof → the last task row ${LAST}`, "Control+ArrowDown", LAST);

// ── C. A fully filled column rides to the end ─────────────────────────────────────────────────────────────
console.log("\nC. Start column (every row dated)");
await click(1, "start");
await expectActive(`Ctrl+Down on an unbroken run → the last task row ${LAST}`, "Control+ArrowDown", LAST);
await expectActive("Ctrl+Up on an unbroken run → the first row", "Control+ArrowUp", 1);

// ── D. Collapsed rows are skipped ─────────────────────────────────────────────────────────────────────────
console.log("\nD. A collapsed group is skipped (Excel skips hidden rows)");
await click(2, "responsibleParty");
await visibleClick(page, GRID, page.locator('[data-task-row="6"] span[title="Collapse"]'), "Collapse on the Building group"); await pacedWait(page, 400);
{
  const hidden = await page.evaluate(() => !document.querySelector('[data-task-row="9"]'));
  ok("the Building group is folded: Roof (row 9) is not on screen (not vacuous)", hidden);
}
await expectActive("Ctrl+Down from Dana → Lee", "Control+ArrowDown", 5);
await expectActive(`Ctrl+Down from Lee: Kim is hidden inside the folded group, so nothing is filled below → last task row ${LAST}`, "Control+ArrowDown", LAST);
await top();
await visibleClick(page, GRID, page.locator('[data-task-row="6"] span[title="Expand"]'), "Expand on the Building group"); await pacedWait(page, 400);
ok("the Building group is expanded again: Roof (row 9) is on screen", await page.evaluate(() => !!document.querySelector('[data-task-row="9"]')));
await click(5, "responsibleParty");
await expectActive("expanded again: Ctrl+Down from Lee reaches Kim", "Control+ArrowDown", 9);

// ── E. Left / Right across a row ──────────────────────────────────────────────────────────────────────────
console.log("\nE. Left / Right on the Grading row (filled: id name start end dur · health status; blank: pred owner cost notes)");
await click(3, "name");
await expectActive("Ctrl+Right from Name rides the run → Duration", "Control+ArrowRight", 3, "duration");
await expectActive("Ctrl+Right from Duration (Predecessor blank) → Health", "Control+ArrowRight", 3, "health");
await expectActive("Ctrl+Right from Health rides to the end of the filled pair → Status", "Control+ArrowRight", 3, "status");
await expectActive("Ctrl+Right from Status (nothing filled right of it) → the last column: Notes", "Control+ArrowRight", 3, "notes");
await expectActive("Ctrl+Left from Notes (blank) → the nearest filled to the left: Status", "Control+ArrowLeft", 3, "status");
await expectActive("Ctrl+Left from Status → end of that run: Health", "Control+ArrowLeft", 3, "health");
await expectActive("Ctrl+Left from Health (Predecessor blank) → Duration", "Control+ArrowLeft", 3, "duration");
await expectActive("Ctrl+Left from Duration rides the run → the first column: ID", "Control+ArrowLeft", 3, "id");

// ── F. Shift extends the range, and scrolls its far end into view ────────────────────────────────────────
console.log("\nF. Ctrl+Shift+Arrow extends the selection the same way");
await click(2, "responsibleParty");
{
  await page.keyboard.press("Control+Shift+ArrowDown"); await pacedWait(page, 350);
  const a = await observe();
  const want = ["2", "3", "4", "5"].map(r => `${r}:responsibleParty`);
  ok("Ctrl+Shift+Down from Dana → range Dana…Lee (rows 2–5, Owner)", JSON.stringify(a.range) === JSON.stringify(want), JSON.stringify(a.range));
  await page.keyboard.press("Control+Shift+ArrowDown"); await pacedWait(page, 350);
  const b = await observe();
  ok("Ctrl+Shift+Down again → range grows to Kim (rows 2–9)", b.range.length === 8 && b.range.includes("9:responsibleParty") && b.range.includes("2:responsibleParty"), JSON.stringify(b.range));
  await page.keyboard.press("Control+Shift+ArrowUp"); await pacedWait(page, 350);
  const c = await observe();
  ok("Ctrl+Shift+Up retracts the far end to Lee (rows 2–5)", JSON.stringify(c.range) === JSON.stringify(want), JSON.stringify(c.range));
  await page.keyboard.press("Control+ArrowDown"); await pacedWait(page, 350);
  const d = await observe();
  ok("a plain Ctrl+Down afterwards collapses the range and jumps the ANCHOR cell (Dana → Lee)", d.range.length === 0 && d.row === "5" && d.col === "responsibleParty", JSON.stringify([d.row, d.col, d.range.length]));
}
await click(9, "responsibleParty");
{
  await page.keyboard.press("Control+Shift+ArrowDown"); await pacedWait(page, 450);
  const a = await observe();
  ok(`Ctrl+Shift+Down from Kim extends to the last row and scrolls ${LAST} into view`, a.range.includes(`${LAST}:responsibleParty`) && a.rowsInView.includes(String(LAST)), JSON.stringify({ st: a.st, rowsInView: a.rowsInView.slice(-3), n: a.range.length }));
  await page.keyboard.press("Escape"); await pacedWait(page, 150);
}

// ── G. "+ New task" is passed through, never landed on ───────────────────────────────────────────────────
console.log("\nG. The '+ New task' row");
await click(2, "responsibleParty");
await page.keyboard.press("Control+ArrowDown"); await pacedWait(page, 250);   // Lee
await page.keyboard.press("Control+ArrowDown"); await pacedWait(page, 250);   // Kim
await page.keyboard.press("Control+ArrowDown"); await pacedWait(page, 350);   // last task row
await page.keyboard.press("ArrowDown"); await pacedWait(page, 350);          // plain ArrowDown reaches "+ New task"
{
  const a = await observe();
  ok("[known-good] a plain ArrowDown from the last task row reaches '+ New task'", a.row === "NEW");
}
await expectActive("Ctrl+Down on '+ New task' does nothing", "Control+ArrowDown", "NEW");
await expectActive("Ctrl+Up from '+ New task' (blank) → the nearest filled cell above: Kim", "Control+ArrowUp", 9, "responsibleParty");

// ── H. Meta (Mac) does the same ───────────────────────────────────────────────────────────────────────────
console.log("\nH. Cmd (Meta)");
await click(2, "responsibleParty");
await expectActive("Meta+Down from Dana → Lee", "Meta+ArrowDown", 5);

// ── I. Editing mode is left alone — Ctrl+Arrow moves by word in the text ─────────────────────────────────
console.log("\nI. While a cell is being edited");
await click(3, "name");
await page.keyboard.press("Enter"); await pacedWait(page, 250);
await page.keyboard.press("Control+A"); await page.keyboard.type("abc def"); await pacedWait(page, 100);
await page.evaluate(() => { window.__dp = []; window.addEventListener("keydown", e => { if (e.ctrlKey && e.key === "ArrowLeft") window.__dp.push(e.defaultPrevented); }); });
await page.keyboard.press("Control+ArrowLeft"); await pacedWait(page, 200);
{
  const st = await page.evaluate(() => { const i = document.querySelector("input.ei"); return i ? { caret: i.selectionStart, value: i.value, dp: window.__dp.slice() } : null; });
  ok("the editor is open and Ctrl+Left moved the caret by WORD (end of 'abc def' → start of 'def')", st && st.value === "abc def" && st.caret === 4, JSON.stringify(st));
  ok("  … and the grid did not call preventDefault (the browser's own word-jump ran)", st && st.dp.length === 1 && st.dp[0] === false, JSON.stringify(st && st.dp));
  const a = await observe();
  ok("  … and the active cell did not move (still the Grading row)", a.row === "3");
}
await page.keyboard.press("Escape"); await pacedWait(page, 250);
await page.keyboard.press("Control+ArrowRight"); await pacedWait(page, 250);
{
  const a = await observe();
  ok("after Escape the grid is in navigation mode again: Ctrl+Right jumps (Name → Duration)", a.row === "3" && a.col === "duration", JSON.stringify([a.row, a.col]));
}

// ── J. The neighbours still work ─────────────────────────────────────────────────────────────────────────
console.log("\nJ. Plain arrows, Tab, Enter, Home/End, Ctrl+Home/End keep working (or stay exactly as they were)");
await click(3, "start");
await expectActive("ArrowDown", "ArrowDown", 4, "start");
await expectActive("ArrowUp", "ArrowUp", 3, "start");
await expectActive("ArrowRight", "ArrowRight", 3, "end");
await expectActive("ArrowLeft", "ArrowLeft", 3, "start");
await expectActive("Tab moves one column right", "Tab", 3, "end");
await page.keyboard.press("Enter"); await pacedWait(page, 250);
ok("Enter opens the cell editor", await page.evaluate(() => !!document.querySelector("input.ei")));
await page.keyboard.press("Escape"); await pacedWait(page, 250);
for (const k of ["Home", "End", "Control+Home", "Control+End"]) {
  const b = await observe();
  await page.keyboard.press(k); await pacedWait(page, 250);
  const scrolled = await page.evaluate(() => Math.round(document.querySelector('[data-grid-scroll="1"]').scrollTop));
  await top();                                       // End / Ctrl+End only scroll the page natively; bring the row back to read it
  const a = await observe();
  console.log(`  NOTE — ${k} is not implemented in this grid (the browser's own scroll runs, scrollTop ${scrolled}): (${b.row},${b.col}) → (${a.row},${a.col}); deliberately not built here`);
  ok(`${k} leaves the selection exactly as it was (unchanged behaviour)`, a.row === b.row && a.col === b.col);
}

// ── K. Split view uses the same grid ─────────────────────────────────────────────────────────────────────
console.log("\nK. Split view");
await page.locator('.hdr-view button:has-text("Split")').click(); await pacedWait(page, 900);
await click(2, "responsibleParty");
await expectActive("Split: Ctrl+Down from Dana → Lee", "Control+ArrowDown", 5);
await expectActive("Split: Ctrl+Up from Lee → Dana", "Control+ArrowUp", 2);
await click(3, "name");
await expectActive("Split: Ctrl+Right from Name → Duration", "Control+ArrowRight", 3, "duration");

ok("no page errors on the schedule page", errs.length === 0, errs.slice(0, 2).join(" | "));
await page.close().catch(() => {});

// ── cleanup (signed-in run) — every throwaway row this run created is deleted the app's way, then re-read ──
if (signed) {
  await pacedWait(signed.page, 2000);
  const created = (await liveIds()).filter(i => !before.has(i));
  const err = await signed.page.evaluate(async (ids) => {
    for (const i of ids) { const u = await window.pfSupabase.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", i); if (u.error) return u.error.message; }
    return null; }, created);
  const left = (await liveIds()).filter(i => !before.has(i));
  ok(`cleanup: the ${created.length} throwaway schedule row(s) this run created are deleted and none remains live`, !err && left.length === 0, JSON.stringify({ created, err, left }));
}
await closeAll();
const known = results.filter(r => r.n.startsWith("[known-good]") && !r.c);
if (known.length) { console.log("VOID — the known-good arm failed, so this instrument cannot vouch for the rest."); process.exit(1); }
console.log(results.filter(r => r.c).length + "/" + results.length + " passed");
process.exit(results.every(r => r.c) ? 0 : 1);
