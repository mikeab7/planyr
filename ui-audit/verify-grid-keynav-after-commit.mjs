/* NEW-1 (owner report 2026-10-19, B463922 lineage) — ONE ARROW PRESS MOVES THE CELL CURSOR ONE ROW.
 *
 * Owner, verbatim: "I'll be on one row, like typing in a task. Maybe I hit enter or something. And then I
 * just click the up or down arrow, and it will like take me all the way up to the top of the schedule or
 * all the way to the bottom."
 *
 * WHAT WAS MEASURED (pre-fix, main @ a85f799, the app's own baked-in demo schedule, real key input):
 *   · his literal sequence — click a row, type into Name, Enter, ↓/↑ — moved exactly one row 20/20, in
 *     every exit (Enter / Tab / Escape) × every text column (Name / Start / Finish / Duration). Not the case.
 *   · FOLD THE GROUP HOLDING THE SELECTION, then ↓ or ↑ → the cursor lands on ROW 1 and the view scrolls to
 *     the top (scrollTop 3351 → 0). The collapse toggle deliberately leaves the selection alone (B463922), so
 *     the selected row is no longer in the visible list, and the arrow handler's `findIndex === -1`
 *     fallback picked `tasks[0]` for both keys.
 *   · DELETE THE SELECTED ROW, then ↓ → row 1 (top); ↑ → the LAST row (bottom). Delete clears the selection
 *     to null, and ArrowUp's null fallback was `tasks.length − 1`.
 *   Both are the exact "top or bottom" signature in the report. The fix (`stepGridRow`,
 *   src/workspaces/scheduler/lib/gridRowNav.js, mirrored in public/sequence/index.html) re-anchors a lost
 *   selection at the gap it left and moves one row from there.
 *
 * ⛔ A KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): the plain sequence above worked before the fix.
 * If it does not report its known answer here the instrument is broken and the run is VOID, not scored.
 * ⛔ Real keys only (SYNTHETIC-KEYS-DONT-EDIT); clicks only on what is on screen (visibleClick); a hidden
 * tab cannot be measured (FOREGROUND-OR-VOID).
 *
 * Run:  node ui-audit/verify-grid-keynav-after-commit.mjs          [PW_CHROME=<chrome>]
 *       PLANYR_URL=https://planyr.io/sequence/ node ui-audit/verify-grid-keynav-after-commit.mjs   (deployed bytes)
 * Exit 0 = every press moved one row and the view held. Exit 1 = a jump, or a void run.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";
import { servedProvenance, provenanceReport } from "./lib/deployedTarget.mjs";
import { visibleClick, installScrollWitness } from "./lib/visibleClick.mjs";

const GRID = '[data-grid-scroll="1"]';
const ROOT = new URL("../public/", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const REPS = +(process.env.REPS || 20);

const DEPLOYED = process.env.PLANYR_URL || null;
let deployedBody = null;
await ensureVendored();
const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = (deployedBody && p.endsWith("sequence/index.html")) ? deployedBody : await readFile(fp);
    if (p.endsWith("sequence/index.html")) body = Buffer.from(rewriteCdn(body.toString("utf8")));
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
if (DEPLOYED) {
  const prov = await servedProvenance(DEPLOYED);
  console.log(provenanceReport(prov, DEPLOYED));
  if (!prov.ok) { console.log("FAIL — the deployed artifact could not be read, so nothing here is a measurement of it."); process.exit(1); }
  deployedBody = prov.body;
}
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
/* A fresh context per configuration: the app remembers grid zoom (and view) in the browser, so reusing one
   profile would silently carry the zoomed run's setting into the "zoom 1" ones. */
let ctx = null, page = null;
async function freshPage() {
  if (ctx) await ctx.close();
  ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  page = await ctx.newPage();
  await assertMeasurable(page, "verify-grid-keynav-after-commit");
  page.on("pageerror", e => console.log("  [pageerror]", e.message.slice(0, 160)));
}

const failures = [];
const line = s => console.log(s);

/* Read-only, per-keystroke probe: what the grid looked like at the instant each key began (capture phase,
   before any handler ran). Printed for every failing press. */
async function installProbe() {
  await page.waitForSelector(GRID, { timeout: 20000 });
  await installScrollWitness(page, GRID);
  await page.evaluate(sel => {
    window.__g = document.querySelector(sel);
    window.__state = () => {
      const g = window.__g, r = document.querySelector('[data-row-sel="1"]');
      const nt = document.querySelector('[data-new-task-row="sel"]');
      return { sel: nt ? "NEW" : (r ? r.getAttribute("data-task-row") : null), st: Math.round(g.scrollTop),
               active: document.activeElement.tagName, editor: !!document.querySelector("input.ei") };
    };
    window.__keyLog = [];
    if (!window.__probeArmed) {
      window.__probeArmed = true;
      window.addEventListener("keydown", e => { window.__keyLog.push({ key: e.key, ...window.__state() }); }, true);
    }
  }, GRID);
}
const st = () => page.evaluate(() => window.__state());
const rowH = () => page.evaluate(() => { const r = document.querySelector("[data-task-row]"); return r ? r.getBoundingClientRect().height : 24; });

async function boot({ view = "split", zoomSteps = 0 } = {}) {
  await freshPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  if (view !== "split") {
    await page.getByRole("button", { name: view === "grid" ? "Grid" : "Split", exact: true }).first().click();
    await pacedWait(page, 500);
  }
  await installProbe();
  if (zoomSteps) {
    const box = await page.locator(GRID).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Control");
    for (let i = 0; i < zoomSteps; i++) { await page.mouse.wheel(0, -100); await pacedWait(page, 90); }
    await page.keyboard.up("Control");
    await pacedWait(page, 400);
  }
  const zoom = await page.evaluate(() => getComputedStyle(window.__g).zoom);
  if (zoomSteps && zoom === "1") { failures.push(`could not zoom the grid (zoom reads ${zoom})`); }
  return zoom;
}

/** Scroll to the middle and return a visible LEAF row id (leaf: it carries a health dot). */
async function midLeaf(offset = 0) {
  await page.evaluate(() => { window.__g.scrollTop = Math.floor(window.__g.scrollHeight / 2); });
  await pacedWait(page, 400);
  return page.evaluate(off => {
    const g = window.__g, gr = g.getBoundingClientRect();
    const rows = [...document.querySelectorAll("[data-task-row]")].filter(r => { const b = r.getBoundingClientRect();
      return b.top > gr.top + 150 && b.bottom < gr.bottom - 150 && r.querySelector("[data-health-dot]"); });
    return rows.length ? rows[Math.min(rows.length - 1, Math.floor(rows.length / 2) + off)].getAttribute("data-task-row") : null;
  }, offset);
}
const cell = (id, col) => page.locator(`[data-task-row="${id}"] [data-col-key="${col}"]`);
const visibleIds = () => page.evaluate(() => [...document.querySelectorAll("[data-task-row]")].map(r => r.getAttribute("data-task-row")));

/** Press `key` and judge: the cursor must land on `expect`, and the view must hold (≤ one row of motion). */
async function judge(label, key, expect, { known = false } = {}) {
  const before = await st();
  await page.evaluate(() => { window.__keyLog.length = 0; window.__scrollWitness.writes.length = 0; });
  await page.keyboard.press(key);
  await pacedWait(page, 350);
  const after = await st();
  const rh = await rowH();
  const moved = Math.abs(after.st - before.st);
  const ok = after.sel === String(expect) && moved <= rh + 1;
  line(`  ${ok ? "✓" : "✗"} ${label}: cursor ${before.sel} → ${after.sel} (expected ${expect}); view moved ${moved}px (budget ${Math.round(rh)}px)`);
  if (!ok) {
    const log = await page.evaluate(() => window.__keyLog.slice());
    line(`      probe at keydown: ${JSON.stringify(log)}`);
    failures.push(`${known ? "[KNOWN-GOOD ARM] " : ""}${label}: cursor ${before.sel} → ${after.sel}, expected ${expect}; view moved ${moved}px`);
  }
  return ok;
}

const EDIT_VALUE = { name: "Edited", start: "10/24/26", end: "11/20/26", duration: "4d" };
/** Click a cell, open its editor (type-to-edit for name, Enter for the rest), type, leave by `exit`. */
async function editAndExit(id, col, exit) {
  await visibleClick(page, GRID, cell(id, col), `${col} cell on row ${id}`);
  await pacedWait(page, 200);
  if (col === "name") await page.keyboard.type("Q");
  else { await page.keyboard.press("Enter"); await pacedWait(page, 120); await page.keyboard.press("Control+A"); }
  await page.keyboard.type(EDIT_VALUE[col] || "x");
  await pacedWait(page, 80);
  if (exit === "click-away") {
    const other = String(+id - 2);                              // a plain click on another row's cell
    await visibleClick(page, GRID, cell(other, "name"), `name cell on row ${other}`);
  } else await page.keyboard.press(exit);
  await pacedWait(page, 250);
}

line("\nNEW-1 — does one arrow press move the cursor exactly one row?\n");

// ── 1. KNOWN-GOOD ARM + the owner's literal sequence, repeated ────────────────────────────────────────────
for (const cfg of [{ view: "split", zoomSteps: 0 }, { view: "grid", zoomSteps: 0 }, { view: "split", zoomSteps: 3 }]) {
  const zoom = await boot(cfg);
  line(`${cfg.view} view, grid zoom ${zoom} — type into Name, Enter, then ↓ / ↑`);
  let pass = 0;
  const reps = cfg.zoomSteps || cfg.view === "grid" ? 4 : REPS;
  for (let i = 0; i < reps; i++) {
    const id = await midLeaf(i % 3);
    await editAndExit(id, "name", "Enter");
    const landed = (await st()).sel;
    const arrow = i % 2 ? "ArrowUp" : "ArrowDown";
    const exp = arrow === "ArrowDown" ? String(+landed + 1) : String(+landed - 1);
    if (await judge(`#${i + 1} Enter → ${arrow}`, arrow, exp, { known: true })) pass++;
    await page.keyboard.press("Control+z"); await pacedWait(page, 200);
  }
  line(`  ${pass}/${reps} presses moved exactly one row\n`);
}

// ── 2. Every exit × every text column × both arrows ───────────────────────────────────────────────────────
await boot({ view: "split" });
line("every exit × column (split, zoom 1)");
for (const col of ["name", "start", "end", "duration"]) for (const exit of ["Enter", "Tab", "Escape", "click-away"]) for (const arrow of ["ArrowDown", "ArrowUp"]) {
  const id = await midLeaf();
  await editAndExit(id, col, exit);
  const landed = (await st()).sel;
  await judge(`${col} / ${exit} / ${arrow}`, arrow, String(+landed + (arrow === "ArrowDown" ? 1 : -1)));
  await page.keyboard.press("Escape"); await page.keyboard.press("Control+z"); await pacedWait(page, 200);
}
// Owner cell (tokens-class editor): open, leave by Escape, then arrow. No owner is added (constraint 1).
for (const arrow of ["ArrowDown", "ArrowUp"]) {
  const id = await midLeaf();
  await visibleClick(page, GRID, cell(id, "responsibleParty").first(), `owner cell on row ${id}`).catch(() => {});
  if (!(await cell(id, "responsibleParty").count())) { line("  · owner column not visible in this layout — skipped"); break; }
  await pacedWait(page, 150); await page.keyboard.press("Enter"); await pacedWait(page, 200);
  await page.keyboard.press("Escape"); await pacedWait(page, 200);
  await judge(`owner / Escape / ${arrow}`, arrow, String(+id + (arrow === "ArrowDown" ? 1 : -1)));
}

// ── 3. THE MEASURED FAILURE — fold the group that holds the selection, then one arrow ────────────────────
line("\nfold the group holding the selection, then one arrow");
for (const arrow of ["ArrowDown", "ArrowUp"]) {
  await midLeaf();
  const pair = await page.evaluate(() => {
    const g = window.__g, gr = g.getBoundingClientRect();
    for (const t of document.querySelectorAll('[data-task-row] span[title="Collapse"]')) {
      const b = t.getBoundingClientRect(); if (b.top < gr.top + 60 || b.bottom > gr.bottom - 300) continue;
      const pid = +t.closest("[data-task-row]").getAttribute("data-task-row");
      const child = document.querySelector(`[data-task-row="${pid + 1}"]`);
      if (child && child.querySelector("[data-health-dot]")) return { parent: pid, child: pid + 1 };
    }
    return null; });
  if (!pair) { failures.push(`fold/${arrow}: no visible group with a leaf first child to drive`); continue; }
  await visibleClick(page, GRID, cell(pair.child, "name"), `name cell on row ${pair.child}`); await pacedWait(page, 200);
  await editAndExit(pair.child, "name", "Tab");                // typed + committed, cursor still on the child
  await visibleClick(page, GRID, page.locator(`[data-task-row="${pair.parent}"] span[title="Collapse"]`), `Collapse toggle on row ${pair.parent}`);
  await pacedWait(page, 350);
  const vis = await visibleIds();
  if (vis.includes(String(pair.child))) { failures.push(`fold/${arrow}: the child row is still visible — the fold did not happen (vacuous)`); continue; }
  const after = vis[vis.indexOf(String(pair.parent)) + 1];
  // ↓: the first row below the folded group. ↑: the group row itself (the row just above where the cursor sat).
  await judge(`fold group ${pair.parent} (cursor on hidden ${pair.child}) → ${arrow}`, arrow, arrow === "ArrowDown" ? after : String(pair.parent));
  await visibleClick(page, GRID, page.locator(`[data-task-row="${pair.parent}"] span[title="Expand"]`), `Expand toggle on row ${pair.parent}`).catch(() => {});
  await page.keyboard.press("Control+z"); await pacedWait(page, 250);
}

// ── 4. THE MEASURED FAILURE — delete the selected row, then one arrow ────────────────────────────────────
line("\ndelete the selected row, then one arrow");
for (const arrow of ["ArrowDown", "ArrowUp"]) {
  const id = await midLeaf();
  await visibleClick(page, GRID, cell(id, "id"), `id cell on row ${id}`); await pacedWait(page, 200);
  const nBefore = (await visibleIds()).length;
  await page.keyboard.press("Delete"); await pacedWait(page, 350);
  if ((await st()).sel !== null) { failures.push(`delete/${arrow}: the row was not deleted (vacuous)`); continue; }
  // Ids renumber on a delete, so the row that slid up into the slot now carries the deleted row's id.
  await judge(`delete row ${id} → ${arrow}`, arrow, arrow === "ArrowDown" ? id : String(+id - 1));
  await page.keyboard.press("Control+z"); await pacedWait(page, 300);
  void nBefore;
}

// ── 5. Edges: last task, "+ New task", first row ─────────────────────────────────────────────────────────
line("\nedges");
try {
  // Scroll so the last task row sits mid-screen. (The grid pads past the last task with blank rows, so
  // "scrolled to the bottom" shows no task at all — walk back up until task rows are drawn.)
  const lastId = await page.evaluate(async () => {
    const g = window.__g, wait = ms => new Promise(r => setTimeout(r, ms));
    g.scrollTop = g.scrollHeight; await wait(250);
    for (let i = 0; i < 60 && !document.querySelector("[data-task-row]"); i++) { g.scrollTop -= 240; await wait(80); }
    await wait(200);
    const ids = [...document.querySelectorAll("[data-task-row]")].map(r => +r.getAttribute("data-task-row"));
    const last = Math.max(...ids);
    const r = document.querySelector(`[data-task-row="${last}"]`), gr = g.getBoundingClientRect();
    g.scrollTop += r.getBoundingClientRect().top - gr.top - g.clientHeight / 2; await wait(300);
    return String(last);
  });
  await pacedWait(page, 300);
  await editAndExit(lastId, "name", "Enter");                  // no row below → the cursor stays on the last task
  await judge(`last task, Enter → ArrowDown (to "+ New task")`, "ArrowDown", "NEW");
  await judge(`"+ New task" → ArrowUp`, "ArrowUp", lastId);
  await page.keyboard.press("ArrowDown"); await pacedWait(page, 200);
  await page.keyboard.press("Enter"); await pacedWait(page, 500);   // creates a task and opens its name editor
  const created = (await st());
  if (!created.editor) failures.push(`"+ New task" Enter did not open a name editor (vacuous)`);
  await page.keyboard.type("Brand new"); await page.keyboard.press("Enter"); await pacedWait(page, 300);
  const landed = (await st()).sel;
  await judge(`new task named, Enter → ArrowUp`, "ArrowUp", String(+landed - 1));
  await page.keyboard.press("Control+z"); await pacedWait(page, 300);
} catch (e) { failures.push(`edges (last task / "+ New task"): could not drive — ${e.message.split("\n")[0]}`); line(`  ✗ edges could not be driven: ${e.message.split("\n")[0]}`); }
{
  await page.evaluate(() => { window.__g.scrollTop = 0; }); await pacedWait(page, 350);
  await visibleClick(page, GRID, cell("1", "name"), "name cell on row 1"); await pacedWait(page, 200);
  await judge(`first row → ArrowUp (stays)`, "ArrowUp", "1");
  await judge(`first row → ArrowDown`, "ArrowDown", "2");
  await judge(`then ArrowDown again`, "ArrowDown", "3");
}

await browser.close(); server.close();
const known = failures.filter(f => f.startsWith("[KNOWN-GOOD ARM]"));
if (known.length) {
  line(`\nVOID — the known-good arm (plain Enter → arrow, which worked before the fix) did not report its known answer, so this instrument cannot be trusted on the rest:\n  ${known.join("\n  ")}`);
  process.exit(1);
}
if (failures.length) { line(`\nFAIL — ${failures.length} press(es) did not move exactly one row:\n  ${failures.join("\n  ")}`); process.exit(1); }
line("\nPASS — every arrow press moved the cursor exactly one row and the view held.");
