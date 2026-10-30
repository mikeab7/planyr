/* B2530690 — Ctrl+click multi-select and drag edge-scroll in the SCHEDULE grid (the Spreadsheet got them in
 * B2530689 / B2452528; the Schedule grid shares the same selection model, inlined from src/shared/selection/*).
 * REAL Control-held clicks and real mouse drags in a real grid, on a THROWAWAY fixture schedule (never a real plan).
 *
 *   node ui-audit/verify-schedule-multirange.mjs                                  local build (public/sequence/index.html)
 *   E2E_LOGIN_KEY=… node ui-audit/verify-schedule-multirange.mjs https://planyr.io [expectedBuildPrefix]
 *                                                                                  signed in on the deployed site
 *
 * ⛔ A KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): a plain click lands on the cell it aimed at and a second
 * plain click COLLAPSES to one cell. If not, the run is VOID. Clicks use the driver's mouse at on-screen coordinates
 * (never an actionability scroll); Control is held with keyboard.down so the modifier reaches the real mouse events
 * (page.mouse.click alone drops it — NOTES-CARRY-FORWARD trap 8). Expected selections are written by hand.
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
const NAME = "Multi-range Check (throwaway)";
const LAST = 70;

const task = o => ({ start: "2027-03-01", end: "2027-03-05", duration: 5, predecessors: [], health: "yellow", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 5, predUnresolved: [], ...o });
const tasks = [
  task({ id: 1, name: "Site" }),
  task({ id: 2, name: "Survey", parentId: 1, responsibleParty: "Dana", cost: 100, notes: [{ date: "2026-10-01", text: "call county" }] }),
  task({ id: 3, name: "Grading", parentId: 1, responsibleParty: "Sam" }),
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
  // SEQ_ROOT=dist serves the COMPILED production page (npm run build first). ⛔ That is the build users get: it keeps `const`
  // block-scoping, so a render-time read of a const declared LATER (a TDZ error — "Cannot access 'x' before initialization")
  // only shows there; the in-browser-Babel page in public/ hides it. Run both.
  const ROOT = new URL(process.env.SEQ_ROOT === "dist" ? "../dist/" : "../public/", import.meta.url).pathname;
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
await assertMeasurable(page, "verify-schedule-multirange");
await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
await pacedWait(page, 700); await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1500);
await page.locator('.hdr-view button:has-text("Grid")').click(); await pacedWait(page, 800);

await page.waitForSelector(GRID, { timeout: 30000 }).catch(async (e) => { await page.screenshot({ path: "/tmp/sched-live-fail.png" }); console.log("grid never appeared; url", page.url()); throw e; });
// ── instruments ───────────────────────────────────────────────────────────────────────────────────────────
const build = o => (o.build.commit || o.build.sha || JSON.stringify(o.build)).toString().slice(0, 9);
const observe = () => page.evaluate(async () => {
  const build = await fetch("/version.json", { cache: "no-store" }).then(r => r.json()).catch(e => ({ error: String(e) }));
  const c = document.querySelector('[data-cell-active="1"]');
  const r = c && c.closest("[data-task-row]");
  const g = document.querySelector('[data-grid-scroll="1"]');
  return {
    build, row: r ? r.getAttribute("data-task-row") : null, col: c ? c.getAttribute("data-col-key") : null,
    // every highlighted cell (tinted or the active one), as "row:col", sorted
    range: [...document.querySelectorAll('[data-cell-in-range="1"], [data-cell-active="1"]')].map(x => x.closest("[data-task-row]").getAttribute("data-task-row") + ":" + x.getAttribute("data-col-key")).sort(),
    st: Math.round(g.scrollTop),
    rowIds: [...document.querySelectorAll("[data-task-row]")].map(x => x.getAttribute("data-task-row")),
    toast: [...document.querySelectorAll('[data-testid="schedule-toast"]')].map(x => x.innerText).join("|"),
  };
});
const cell = (rid, col) => page.locator(`[data-task-row="${rid}"] [data-col-key="${col}"]`);
const top = async () => { await page.evaluate(() => { document.querySelector('[data-grid-scroll="1"]').scrollTop = 0; }); await pacedWait(page, 300); };
const sorted = a => [...a].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
/** A real mouse press+release at the centre of an on-screen cell, with the given modifiers HELD on the keyboard. */
async function press(rid, col, mods = []) {
  const loc = cell(rid, col);
  const v = await (await import("./lib/visibleClick.mjs")).targetVisibility(page, GRID, loc);
  if (!v.visible) throw new Error(`press(${rid},${col}): target is ${v.reason} — refusing to let the driver scroll`);
  const b = await loc.boundingBox();
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await pacedWait(page, 40); await page.mouse.up();
  for (const m of mods.slice().reverse()) await page.keyboard.up(m);
  await pacedWait(page, 220);
}
const ctrl = (rid, col) => press(rid, col, ["Control"]);
const names = () => page.evaluate(() => [...document.querySelectorAll('[data-task-row]')].map(r => r.getAttribute("data-task-row")));
// task NAMES in row order (row ids are renumbered after a delete, so "row 3 is gone" must be read by name)
const titles = () => page.evaluate(() => [...document.querySelectorAll('[data-task-row] [data-col-key="name"]')].map(c => c.innerText.replace(/^[▾▸\s]+/, "").trim()));
const text = (rid, col) => cell(rid, col).innerText();

const first = await observe();
console.log("build", JSON.stringify(first.build));
if (want) ok(`served build matches ${want}`, JSON.stringify(first.build).includes(want), JSON.stringify(first.build));
ok("the fixture schedule is the one on screen", await page.evaluate(() => (document.querySelector('[data-task-row="1"] [data-col-key="name"]')?.innerText || "").includes("Site")));

// ── 0. known-good arm ────────────────────────────────────────────────────────────────────────────────────
await top();
await press(2, "responsibleParty");
{ const a = await observe(); ok("[known-good] a plain click lands on the cell it aimed at (row 2, Owner)", a.row === "2" && a.col === "responsibleParty", JSON.stringify([a.row, a.col])); }
await press(5, "responsibleParty");
{ const a = await observe(); ok("[known-good] a second PLAIN click collapses to exactly that one cell", a.row === "5" && same(a.range, ["5:responsibleParty"]), JSON.stringify(a.range)); }
if (results.some(r => r.n.startsWith("[known-good]") && !r.c)) { console.log("VOID — the known-good arm failed, so this instrument cannot vouch for the rest."); await closeAll(); process.exit(1); }

// ── A. Ctrl+click adds ranges; earlier ones stay; active moves ────────────────────────────────────────────
console.log("\nA. Ctrl+click adds cells");
await press(2, "responsibleParty");
await ctrl(5, "responsibleParty");
await ctrl(8, "name");
{
  const a = await observe();
  ok("three separate cells stay highlighted (Owner row 2, Owner row 5, Name row 8)", same(a.range, ["2:responsibleParty", "5:responsibleParty", "8:name"]), JSON.stringify(a.range));
  ok("the active cell moved to the LAST Ctrl+click (row 8, Name)", a.row === "8" && a.col === "name", JSON.stringify([a.row, a.col]));
}
await ctrl(5, "responsibleParty");
{
  const a = await observe();
  ok("Ctrl+click on a selected cell DESELECTS just that cell", same(a.range, ["2:responsibleParty", "8:name"]), JSON.stringify(a.range));
}
await press(3, "cost");
{ const a = await observe(); ok("a plain click collapses everything to one cell", same(a.range, ["3:cost"]), JSON.stringify(a.range)); }

// ── B. Shift extends only the newest range ────────────────────────────────────────────────────────────────
console.log("\nB. Shift+click after Ctrl+click extends only the newest range");
await press(2, "responsibleParty");
await ctrl(5, "responsibleParty");
await press(7, "responsibleParty", ["Shift"]);
{
  const a = await observe();
  ok("Owner row 2 stays; the newest range grew from row 5 to row 7", same(a.range, ["2:responsibleParty", "5:responsibleParty", "6:responsibleParty", "7:responsibleParty"]), JSON.stringify(a.range));
}

// ── C. Ctrl+click on row numbers adds whole rows ─────────────────────────────────────────────────────────
console.log("\nC. Ctrl+click on row numbers");
await press(3, "id");
await ctrl(7, "id");
{
  const a = await observe();
  const rows = new Set(a.range.map(x => x.split(":")[0]));
  ok("rows 3 and 7 (and only those) are selected", same([...rows], ["3", "7"]), JSON.stringify([...rows]));
  const cols3 = a.range.filter(x => x.startsWith("3:")).length, cols7 = a.range.filter(x => x.startsWith("7:")).length;
  ok("each is a WHOLE row (every visible column highlighted)", cols3 === VISIBLE.length && cols7 === VISIBLE.length, JSON.stringify([cols3, cols7]));
}

// ── D. Bulk commands: Delete clears every range, one undo step ───────────────────────────────────────────
console.log("\nD. Delete clears contents across ranges — ONE undo step");
await press(2, "responsibleParty");
await ctrl(5, "responsibleParty");
await ctrl(3, "responsibleParty");
{
  const before = [await text(2, "responsibleParty"), await text(5, "responsibleParty"), await text(3, "responsibleParty"), await text(9, "responsibleParty")];
  ok("[precondition] the three owners are filled (Dana, Lee, Sam) and the untouched Kim is too", before.join(",") === "Dana,Lee,Sam,Kim", before.join(","));
  await page.keyboard.press("Delete"); await pacedWait(page, 400);
  const after = [await text(2, "responsibleParty"), await text(5, "responsibleParty"), await text(3, "responsibleParty"), await text(9, "responsibleParty")];
  ok("Delete blanked all three selected cells and left the unselected one alone", after.join(",") === ",,,Kim", after.join(","));
  await page.keyboard.press("Control+z"); await pacedWait(page, 450);
  const undone = [await text(2, "responsibleParty"), await text(5, "responsibleParty"), await text(3, "responsibleParty"), await text(9, "responsibleParty")];
  ok("ONE Ctrl+Z restores all three", undone.join(",") === "Dana,Lee,Sam,Kim", undone.join(","));
}

// ── E. Delete rows across non-contiguous rows, one undo step ─────────────────────────────────────────────
console.log("\nE. Delete removes every selected row (non-contiguous) — ONE undo step");
await press(3, "id");
await ctrl(7, "id");
await ctrl(9, "id");
{
  const beforeT = await titles();
  // sample the rendered titles every frame so a delete the app reverts a moment later (a local page with no cloud
  // row to save into — identical on origin/main) is still SEEN: what the keypress asked for is what appears first
  await page.evaluate(() => { window.__tSamples = []; window.__delToast = ""; const t0 = performance.now(); const f = () => { window.__delToast = window.__delToast || (document.getElementById("planar-delete-toast")?.innerText || ""); window.__tSamples.push([...document.querySelectorAll('[data-task-row] [data-col-key="name"]')].map(c => c.innerText.replace(/^[▾▸\s]+/, "").trim())); if (performance.now() - t0 < 1500) requestAnimationFrame(f); }; f(); });
  await page.keyboard.press("Delete"); await pacedWait(page, 1600);
  const samples = await page.evaluate(() => window.__tSamples);
  const toast = await page.evaluate(() => window.__delToast);
  const soon = samples.find(r => !r.includes("Grading")) || [];
  ok("[precondition] Grading, Slab and Roof were on screen", ["Grading", "Slab", "Roof"].every(n => beforeT.includes(n)), beforeT.slice(0, 9).join(","));
  ok("Grading, Slab and Roof vanish together and nothing else is removed", ["Grading", "Slab", "Roof"].every(n => !soon.includes(n)) && ["Site", "Survey", "Utilities", "Paving", "Building", "Frame"].every(n => soon.includes(n)), soon.slice(0, 9).join(",") || "never");
  ok("the app announces exactly 3 rows deleted", /3 rows deleted/.test(toast), toast.replace(/\n/g, " / "));
  if (signed) {
    // a signed-in run owns its throwaway schedule, so the delete persists
    const settled = await titles();
    ok("the delete persisted (still gone after the save settled)", ["Grading", "Slab", "Roof"].every(n => !settled.includes(n)), settled.slice(0, 9).join(","));
  }
  await page.keyboard.press("Control+z"); await pacedWait(page, 600);
  const undone = await titles();
  ok("ONE Ctrl+Z brings all three back", ["Grading", "Slab", "Roof"].every(n => undone.includes(n)), undone.slice(0, 9).join(","));
}

// ── F. Unsupported commands say so, out loud ─────────────────────────────────────────────────────────────
console.log("\nF. Indent on several ranges shows a message and changes nothing");
await press(3, "id");
await ctrl(7, "id");
{
  const beforeRows = await names();
  const lvl = () => page.evaluate(() => [...document.querySelectorAll('[data-task-row="3"],[data-task-row="7"]')].map(r => r.querySelector('[data-col-key="name"]').firstElementChild?.style.paddingLeft || r.querySelector('[data-col-key="name"]').innerHTML.length).join("|"));
  const l0 = await lvl();
  await page.evaluate(() => { window.__tSeen = ""; const t0 = performance.now(); const f = () => { for (const x of document.querySelectorAll('[data-testid="schedule-toast"]')) if (!window.__tSeen.includes(x.innerText)) window.__tSeen += "|" + x.innerText; if (performance.now() - t0 < 900) requestAnimationFrame(f); }; f(); });
  await page.keyboard.press("Alt+Shift+ArrowRight"); await pacedWait(page, 1000);
  const a = await observe();
  const seen = await page.evaluate(() => window.__tSeen);
  ok("a visible message appears", /multiple selections/i.test(seen), seen.replace(/\n/g, " / "));
  ok("and nothing was indented or moved", (await lvl()) === l0 && JSON.stringify(await names()) === JSON.stringify(beforeRows));
}

// ── G. Drag-select autoscroll ────────────────────────────────────────────────────────────────────────────
console.log("\nG. Drag past the bottom edge scrolls the grid and extends the range");
await top();
await press(2, "name");
{
  const g = await page.evaluate(() => { const r = document.querySelector('[data-grid-scroll="1"]').getBoundingClientRect(); return { x: r.left + 200, bottom: r.bottom }; });
  const b = await cell(2, "name").boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x, g.bottom - 120, { steps: 6 });
  await page.mouse.move(g.x, g.bottom - 1, { steps: 4 });
  await pacedWait(page, 1200);                       // held perfectly still at the edge
  const mid = await observe();
  await page.mouse.up(); await pacedWait(page, 250);
  const end = await observe();
  ok("[known-good-ish] the grid scrolled while the pointer sat at the bottom edge", mid.st > 100, "scrollTop " + mid.st);
  const maxRow = Math.max(...end.range.map(x => +x.split(":")[0]));
  ok("the range reached rows that were never on screen at the press", maxRow > 25, "furthest row " + maxRow);
  const rowsInRange = new Set(end.range.map(x => x.split(":")[0]));
  const rendered = end.rowIds.map(Number).filter(n => n >= 2);
  const lo = Math.min(...[...rowsInRange].map(Number));
  ok("…and it is one continuous block (every rendered row from the anchor down to the end is in it)", rendered.filter(n => n >= lo && n <= maxRow).every(n => rowsInRange.has(String(n))), rowsInRange.size + " rows");
}
await top();
await press(2, "name");

// ── H. Split view uses the same grid ─────────────────────────────────────────────────────────────────────
console.log("\nH. Split view");
await page.locator('.hdr-view button:has-text("Split")').click(); await pacedWait(page, 900);
await top();
await press(2, "responsibleParty");
await ctrl(5, "responsibleParty");
{
  const a = await observe();
  ok("Split: Ctrl+click adds a second range there too", same(a.range, ["2:responsibleParty", "5:responsibleParty"]), JSON.stringify(a.range));
}

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
