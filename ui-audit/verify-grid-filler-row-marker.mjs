/* NEW-1 (Schedule grid) — the hovered / selected ROW MARKER (the two thin lines top and bottom) runs the full width of
 * the row on EVERY kind of row, including the ID and Task cells, unbroken across the frozen-column boundary.
 *
 * Owner report (Goose Creek / PI, Grid, planyr.io, screenshot): the two lines started at the left edge of the START
 * column and ran right; the frozen ID and Task cells showed no marker at all — on the blank filler rows below
 * "+ New task". (A first attempt, B2618896, fixed a DIFFERENT thing: the row FILL under the frozen cells.)
 *
 * ROOT CAUSE (measured): the marker is a ::before drawn INSIDE each cell, but the filler row's cells carried no hook for
 * that rule and the row's trailing strip was not `position: relative`, so its ::before was boxed by the WHOLE ROW —
 * painted over the ordinary cells and UNDER the opaque, sticky ID / Task cells (z-index 5). Task rows were already
 * correct (B2279024), which is why it only shows below the last task.
 *
 * WHAT IT ASSERTS — by sampling PAINTED PIXELS (a computed style cannot see paint order). For each case the top and
 * bottom edge pixel under the ID, Task, Start and Finish cells must all be the marker colour (148,163,184):
 *   · a blank filler row: hovered; hovered after a click on it; scrolled sideways; scrolled down under the sticky header
 *   · the "+ New task" row: hovered
 *   · task rows (plain / needs-attn / complete / indented child / summary): hovered, and selected with the mouse away
 *   · the multi-selected state (shift-click a second row) with a blank row hovered
 *   · the grid side of Split view
 *   · the page's own `data-theme="dark"` switch (the Schedule page defines ONE light palette, so the pass is identical
 *     — it is run so a future dark palette cannot silently regress the marker).
 * KNOWN-GOOD arm: a hovered TASK row already painted the marker on every cell before the fix, and an idle row paints none
 * (negative arm). If either does not report that, the run is VOID — not scored (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6).
 *
 *   node ui-audit/verify-grid-filler-row-marker.mjs                    [SHOTS_DIR=<dir>] [HTML=<older index.html>]
 *   E2E_LOGIN_KEY=… PLANYR_URL=https://planyr.io EXPECT_BUILD=<sha> node ui-audit/verify-grid-filler-row-marker.mjs
 *      LIVE: signs in as the test account, seeds ONE throwaway cloud schedule, drives the deployed /sequence/, reads
 *      /version.json in the same run, deletes the row it created (owner constraint 15). Never a real schedule.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const HTML_PATH = process.env.HTML || new URL("../public/sequence/index.html", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium";
const SHOTS = process.env.SHOTS_DIR || null;
const LIVE = process.env.PLANYR_URL || null;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const realBody = await readFile(HTML_PATH, "utf8");
await ensureVendored();
const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    if (p.endsWith("sequence/index.html")) { res.writeHead(200, { "Content-Type": "text/html" }); res.end(Buffer.from(rewriteCdn(realBody))); return; }
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(await readFile(fp));
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const URL_ = `http://localhost:${server.address().port}/sequence/`;

const task = over => ({ start: "2026-01-01", end: "2026-01-01", duration: 1, predecessors: [], health: "gray",
  percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 1,
  predUnresolved: [], meetingBodyMissing: false, finishConflict: false, startConflict: false, ...over });
// 0 summary · 1 indented plain child · 2 indented red child · 3 plain · 4 green · then a few more; blank rows + "+ New task" follow below
const tasks = [
  task({ id: 1, name: "Summary parent" }),
  task({ id: 2, name: "child plain", parentId: 1 }),
  task({ id: 3, name: "child red", health: "red", parentId: 1 }),
  task({ id: 4, name: "plain" }),
  task({ id: 5, name: "green", health: "green" }),
  ...Array.from({ length: 7 }, (_, i) => task({ id: 6 + i, name: "filler task " + (i + 1) })),
];
const COLS = ["id", "name", "start", "end", "duration", "predecessors", "successors", "health", "status", "responsibleParty", "cost", "notes", "percentComplete", "budget"];
const fixture = view => ({ aPid: 1, nPid: 2, nTid: 1000, view, section: "projects", projects: { 1: { id: 1, name: "Marker Fixture", tasks, colConfig: { visible: COLS, widths: {} } } } });

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const void_ = async why => { console.log(`VOID ⚠ — ${why} (no score printed)`); await finish(); process.exit(2); };

let browser = null, liveSession = null, liveBefore = null, liveBuild = null;
const liveIds = () => liveSession.page.evaluate(async () => { const q = await window.pfSupabase.from("schedules").select("id").is("deleted_at", null); if (q.error) throw new Error(q.error.message); return q.data.map(r => r.id); });
if (LIVE) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  liveSession = await openSignedIn({ base: LIVE, viewport: { width: 1280, height: 900 } });
  ok("[known-good] signed in as the test account", liveSession.proof.email === "e2e@planyr.test", liveSession.proof.email);
  liveBefore = new Set(await liveIds());
  const seedPage = await liveSession.page.context().newPage(); await seedPage.setViewportSize({ width: 1600, height: 950 });
  await seedPage.goto(LIVE + "/sequence/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await seedPage.waitForSelector('[data-testid="open-history-desktop"], button:has-text("New schedule")', { timeout: 40000 });
  if (!(await seedPage.locator('[data-testid="open-history-desktop"]').count())) { await seedPage.getByRole("button", { name: "New schedule" }).click(); await pacedWait(seedPage, 3000); }
  await pacedWait(seedPage, 3000); await seedPage.close();
  const ids = (await liveIds()).filter(i => !liveBefore.has(i));
  if (ids.length !== 1) { console.log("expected exactly one throwaway schedule row, found " + JSON.stringify(ids)); process.exit(1); }
  const seedErr = await liveSession.page.evaluate(async ({ id, fx }) => {
    const r = await window.pfSupabase.from("schedules").select("rev").eq("id", id).single();
    if (r.error) return r.error.message;
    const u = await window.pfSupabase.from("schedules").update({ name: fx.name, data: { ...fx, id }, rev: (r.data.rev || 0) + 1 }).eq("id", id).select("id");
    return u.error ? u.error.message : (u.data && u.data.length ? null : "update matched no row"); }, { id: ids[0], fx: fixture("grid").projects[1] });
  if (seedErr) { console.log("could not seed the throwaway row: " + seedErr); process.exit(1); }
} else {
  browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
}
async function finish() {
  if (LIVE) {
    const created = (await liveIds()).filter(i => !liveBefore.has(i));
    const err = await liveSession.page.evaluate(async (ids) => { for (const i of ids) { const u = await window.pfSupabase.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", i); if (u.error) return u.error.message; } return null; }, created);
    const left = (await liveIds()).filter(i => !liveBefore.has(i));
    ok(`cleanup: the ${created.length} throwaway schedule row(s) this run created are deleted and none remains live`, !err && left.length === 0, JSON.stringify({ created, err, left }));
    await liveSession.close();
  } else { await browser.close(); server.close(); }
}

async function openGrid(view, w, h) {
  const page = LIVE ? await liveSession.page.context().newPage() : await browser.newPage({ viewport: { width: w, height: h } });
  if (LIVE) await page.setViewportSize({ width: w, height: h });
  page.on("dialog", d => d.accept());
  page.on("pageerror", e => console.log("  [pageerror]", e.message.slice(0, 160)));
  await page.goto(LIVE ? LIVE + "/sequence/" : URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-grid-filler-row-marker");
  if (LIVE) {
    await pacedWait(page, 1800);
    liveBuild = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then(r => r.json()).then(j => j.build).catch(() => "unreadable"));
    if (process.env.EXPECT_BUILD && !String(liveBuild).startsWith(process.env.EXPECT_BUILD.slice(0, 7))) throw new Error(`served build ${liveBuild} is not the expected ${process.env.EXPECT_BUILD} — void, not scored`);
  } else {
    await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
    await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture(view))) });
    await pacedWait(page, 700);
    await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1500);
  }
  await page.locator(`.hdr-view button:has-text("${view === "grid" ? "Grid" : "Split"}")`).click(); await pacedWait(page, 700);
  await page.waitForSelector('[data-grid-scroll="1"]');
  const names = await page.evaluate(() => [...document.querySelectorAll("[data-task-row] [data-col-key=name]")].map(n => n.innerText));
  if (!names.some(n => n.includes("child red"))) throw new Error("fixture did not load (starter project is showing)");
  return page;
}

const LINE = "148,163,184";
const px = (p, x, y) => { const i = (y * p.width + x) * p.channels; return `${p.data[i]},${p.data[i + 1]},${p.data[i + 2]}`; };
// geometry of one row's first four children, by selector + index among the matching rows. Each cell also reports the
// part of it that is actually VISIBLE (inside the grid pane and not under the frozen cells), so a cell scrolled out of
// view in a narrow pane is never sampled (that would measure whatever is painted there instead).
const geo = (page, sel, n) => page.evaluate(({ sel, n }) => {
  const row = [...document.querySelectorAll(sel)][n]; if (!row) return null;
  const rr = row.getBoundingClientRect(), kids = [...row.children].filter(c => !c.hasAttribute("data-grid-strip"));
  const gr = document.querySelector('[data-grid-scroll="1"]').getBoundingClientRect();
  const rects = kids.map(c => ({ c, r: c.getBoundingClientRect(), sticky: getComputedStyle(c).position === "sticky" }));
  const pinR = Math.max(gr.left, ...rects.filter(x => x.sticky).map(x => x.r.right));
  return { top: rr.top, bottom: rr.bottom, left: rr.left, kind: row.getAttribute("data-task-row") ? "task" : row.hasAttribute("data-new-task-row") ? "new" : "blank",
    cells: rects.map(({ r, sticky }) => { const l = sticky ? r.left : Math.max(r.left, pinR), rt = Math.min(r.right, gr.right); return { l: r.left, w: r.width, t: r.top, b: r.bottom, sticky, vl: l, vw: Math.max(0, rt - l) }; }) };
}, { sel, n });
// the first row of this kind sitting fully on screen BELOW the sticky header (virtualised lists render a buffer above the fold)
const visibleIdx = (page, sel) => page.evaluate((sel) => {
  const g = document.querySelector('[data-grid-scroll="1"]').getBoundingClientRect();
  const hdr = Math.max(0, ...[...document.querySelectorAll("[data-hdr-col]")].map(h => h.getBoundingClientRect().bottom));
  const rows = [...document.querySelectorAll(sel)];
  return rows.findIndex(r => { const b = r.getBoundingClientRect(); return b.top >= Math.max(g.top, hdr) + 1 && b.bottom <= Math.min(g.bottom, innerHeight) - 1; });
}, sel);
// sample ID + Task (the frozen cells) and the first two ordinary cells that are really visible (the date cells, or whatever
// has scrolled in beside the frozen pair)
const sampled = g => { const vis = g.cells.map((c, i) => ({ c, i })).filter(x => x.c.vw >= 6); return [...vis.filter(x => x.c.sticky), ...vis.filter(x => !x.c.sticky).slice(0, 2)]; };
const reads = (p, g) => sampled(g).map(({ c, i }) => { const x = Math.round(c.vl + Math.min(c.vw, 60) * 0.5); return { name: i < 2 && c.sticky ? ["ID", "Task"][i] : "cell" + (i + 1), top: px(p, x, Math.round(c.t)), bottom: px(p, x, Math.round(c.b) - 2) }; });
const png = async page => decodePng(await page.screenshot());
const away = async page => { await page.mouse.move(2, 2); await pacedWait(page, 250); };
const hoverRow = async (page, sel, n) => { const g = await geo(page, sel, n); const c = g.cells.find(x => !x.sticky && x.vw >= 6); await page.mouse.move(Math.round(c.vl + Math.min(c.vw, 60) * 0.5), Math.round((g.top + g.bottom) / 2)); await pacedWait(page, 250); return geo(page, sel, n); };
const clickRow = async (page, g, mod) => { const c = g.cells.find(x => !x.sticky && x.vw >= 6); if (mod) await page.keyboard.down(mod); await page.mouse.click(Math.round(c.vl + 12), Math.round((g.top + g.bottom) / 2)); if (mod) await page.keyboard.up(mod); await pacedWait(page, 250); };
const markerOnAll = (page, tag, r) => {
  const bad = []; r.forEach(c => { if (c.top !== LINE) bad.push(`${c.name}.top=${c.top}`); if (c.bottom !== LINE) bad.push(`${c.name}.bottom=${c.bottom}`); });
  const seen = r.length;
  ok(`${tag} · marker lines are on every visible cell: ID, Task and the date cells (top and bottom)`, bad.length === 0 && seen >= 3 && r[0].name === "ID" && r[1].name === "Task", bad.join(" ") + ` (${seen} cells sampled)`);
};
const BLANK = ".drow:not([data-task-row]):not([data-new-task-row])", TASKROW = "[data-task-row]", NEWROW = "[data-new-task-row]";

async function run(view, theme) {
  const page = await openGrid(view, 1280, 760);
  await page.evaluate(t => { if (t === "dark") document.documentElement.setAttribute("data-theme", "dark"); }, theme);
  await pacedWait(page, 300);
  const T = n => `${view} · ${theme} · ${n}`;
  const sc = async (l, t) => { await page.evaluate(({ l, t }) => { const g = document.querySelector('[data-grid-scroll="1"]'); g.scrollLeft = l; g.scrollTop = t; }, { l, t }); await pacedWait(page, 300); };

  // ---- KNOWN-GOOD + NEGATIVE arms: a hovered task row paints the marker everywhere (it did before the fix); an idle row none.
  await sc(0, 0);
  { const g = await hoverRow(page, TASKROW, 3); const r = reads(await png(page), g);
    if (!r.every(c => c.top === LINE && c.bottom === LINE)) await void_("known-good arm: a hovered TASK row does not paint the marker on every cell — the instrument cannot see it: " + JSON.stringify(r));
    await away(page); const g2 = await geo(page, TASKROW, 3); const r2 = reads(await png(page), g2);
    if (r2.some(c => c.top === LINE)) await void_("negative arm: an idle row paints the marker colour — the instrument cannot tell on from off");
    ok(T("known-good: a hovered task row paints the marker on every cell; an idle row paints none (instrument can tell on from off)"), true); }

  for (const l of [0, 300]) {
    await sc(l, 0);
    const where = `scrollLeft ${l}`;
    // blank filler row — hover
    { const sa = await page.evaluate(() => { const g = document.querySelector('[data-grid-scroll="1"]'); return { sw: g.scrollWidth - g.clientWidth }; });
      if (l > 0 && sa.sw < 50) await void_("precondition: the grid does not overflow sideways at this size — " + JSON.stringify(sa));
      const nBlank = await page.locator(BLANK).count();
      if (nBlank < 3) await void_("precondition: fewer than 3 blank filler rows are rendered (" + nBlank + ")");
      const g = await hoverRow(page, BLANK, 2);
      markerOnAll(page, T(`BLANK row hovered (${where})`), reads(await png(page), g));
      ok(T(`the frozen ID and Task cells really are sticky here (${where})`), g.cells[0].sticky && g.cells[1].sticky);
      if (SHOTS && l === 300) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${LIVE ? "live-" : ""}${view}-blank-hover-300.png` }); }
      // a click on a blank row, cursor left resting on it
      await clickRow(page, g);
      const g2 = await geo(page, BLANK, 2); markerOnAll(page, T(`BLANK row after a click on it (${where})`), reads(await png(page), g2)); }
    // + New task row — hover
    { await sc(l, 0); const g = await hoverRow(page, NEWROW, 0);
      markerOnAll(page, T(`"+ New task" row hovered (${where})`), reads(await png(page), g)); }
    await away(page);
  }

  // ---- scrolled DOWN under the sticky header (a short window, so the last rows sit below the fold): sideways too
  await page.setViewportSize({ width: 1280, height: 330 }); await pacedWait(page, 600);
  await sc(300, 100000);
  { const sa = await page.evaluate(() => { const g = document.querySelector('[data-grid-scroll="1"]'); return { st: g.scrollTop, sh: g.scrollHeight - g.clientHeight }; });
    if (sa.st < 20) await void_("precondition: the grid did not scroll vertically in a short window — " + JSON.stringify(sa));
    const bi = await visibleIdx(page, BLANK); const ni = bi < 0 ? await visibleIdx(page, NEWROW) : -1;
    if (bi < 0 && ni < 0) await void_("precondition: no blank or + New task row is fully on screen under the sticky header after scrolling down");
    const g = await hoverRow(page, bi >= 0 ? BLANK : NEWROW, bi >= 0 ? bi : ni);
    markerOnAll(page, T(`${bi >= 0 ? "BLANK" : "+ New task"} row hovered, scrolled down ${sa.st} under the sticky header and sideways 300`), reads(await png(page), g));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${LIVE ? "live-" : ""}${view}-scrolled-down.png` }); }
  await page.setViewportSize({ width: 1280, height: 760 }); await pacedWait(page, 500);
  await away(page);

  // ---- task rows, every kind: hover, and selected (mouse away)
  await sc(300, 0);
  const KINDS = [["summary", 0], ["indented plain", 1], ["indented needs-attn", 2], ["plain", 3], ["complete", 4]];
  for (const [name, n] of KINDS) {
    const g = await hoverRow(page, TASKROW, n); markerOnAll(page, T(`task row ${name} hovered (scrollLeft 300)`), reads(await png(page), g));
    await clickRow(page, g); await away(page);
    const g2 = await geo(page, TASKROW, n); markerOnAll(page, T(`task row ${name} selected, mouse away (scrollLeft 300)`), reads(await png(page), g2));
  }

  // ---- multi-select: shift-click a second row, then hover a blank row — the blank row's marker is unaffected
  await sc(0, 0);
  { await clickRow(page, await geo(page, TASKROW, 1)); await clickRow(page, await geo(page, TASKROW, 3), "Shift");
    const g = await hoverRow(page, BLANK, 2); markerOnAll(page, T("BLANK row hovered while several rows are selected"), reads(await png(page), g));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${LIVE ? "live-" : ""}${view}-multi-blank.png` }); }
  await page.close();
}

for (const theme of ["light", "dark"]) await run("grid", theme);
await run("split", "light");

if (LIVE) console.log("served build", liveBuild);
await finish();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("FAILED:\n - " + failed.map(f => f.name).join("\n - ")); process.exit(1); }
