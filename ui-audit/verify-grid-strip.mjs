/* NEW-1 / NEW-2 / NEW-3 (Schedule grid: right-edge strip, the "14 × 18" pill, the stuck hover row).
 *
 * THE THREE REPORTS (Michael, live, Grand Port > Master Schedule, Grid view, wide monitor):
 *   NEW-1  past the last column the strip looked broken — dashed lines, tint / borders / selection highlight stopped
 *          at the last column's edge, a click there selected nothing.
 *   NEW-2  an unexplained "14 × 18" label floated in that strip while rows were selected.
 *   NEW-3  after resting the mouse on a row and arrowing through the grid, the row under the parked mouse kept its
 *          hover outline, so two rows read as current.
 *
 * WHAT IT ASSERTS (real app, throwaway fixture imported through the history panel — never a real schedule):
 *   N1a  every rendered row carries a filler strip; strip.left == the last cell's right edge and strip.right == the
 *        row's right edge (so it can never be a different width from its row), at a wide window.
 *   N1b  PIXELS: the strip's colour equals the row's own colour on plain / red / yellow / green rows;
 *   N1c  PIXELS: the row's bottom line across the whole strip is ONE colour (no dashes) and the same colour as the
 *        line under the last cell;
 *   N1d  a multi-row selection's highlight and outline run to the pane's right edge (and only on the selected rows);
 *   N1e  a press in the strip selects that row exactly as a press on its last cell does; shift-press extends;
 *   N1f  no horizontal scrollbar appears at a wide window; at a narrow one the strip is zero-width and adds no scroll;
 *   N1g  holds after a column is resized, a group is collapsed, the drag-row indicator line spans to the edge, and
 *        in Split view's grid pane;
 *   N2   no "<n> × <m>" readout exists in ANY state: row range, cell range, a row drag in flight, a column resize
 *        in flight;
 *   N3   a navigation key (arrows, shift+arrows, Tab, Home/End, PageUp/PageDown, Enter-after-edit) drops the hover
 *        outline of the row under a PARKED pointer; a real pointer move gives it back; a pointermove at the SAME
 *        coordinates (what a scroll / re-render under a still mouse synthesises) does not; a key-scrolled row that
 *        slides under the pointer is not lit.
 * Known-good arm: there must BE leftover width to the right of the last column at the wide window (else the run is VOID,
 * not green — nothing below could be a measurement of it) and the hover outline
 * must be lit on a plain pointer rest before any key is pressed.
 *
 * LIVE MODE (V1888160): `E2E_LOGIN_KEY=… PLANYR_URL=https://planyr.io [EXPECT_BUILD=<sha>] node ui-audit/verify-grid-strip.mjs` signs in
 * as the test account (ui-audit/lib/signedInSession.mjs), seeds ONE throwaway cloud schedule from the same fixture, drives the
 * DEPLOYED /sequence/ page with the same checks (reading /version.json in the same call), saves the Grid and Split screenshots
 * when SHOTS_DIR is set, and soft-deletes every row it created (owner constraint 15). Never touches a real schedule.
 *
 * Run: node ui-audit/verify-grid-strip.mjs   [HTML=<path to an index.html to drive instead>] [SHOTS_DIR=<dir>] [PW_CHROME=<chrome>]
 *      (red-proof: HTML=<a copy of main's public/sequence/index.html> — the checks below must go red on it.)
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const HTML_PATH = process.env.HTML || new URL("../public/sequence/index.html", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || undefined;
const SHOTS = process.env.SHOTS_DIR || null;
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

const task = over => ({ start: "2026-01-05", end: "2026-01-09", duration: 5, predecessors: [], health: "gray",
  percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 5,
  predUnresolved: [], meetingBodyMissing: false, finishConflict: false, startConflict: false, ...over });
const tasks = [task({ id: 1, name: "Summary group" })];
const HEALTHS = ["gray", "red", "yellow", "green"];
for (let i = 2; i <= 60; i++) tasks.push(task({ id: i, name: `Leaf ${i}`, parentId: i <= 30 ? 1 : null, health: HEALTHS[i % 4] }));
const COLS = ["id","name","start","end","duration","predecessors","successors","health","status","responsibleParty","cost","notes"];
const fixture = { aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Grid Strip Fixture", tasks, colConfig: { visible: COLS, widths: {} } } } };

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const void_ = why => { console.log(`VOID ⚠ — ${why}`); process.exit(2); };

const LIVE = process.env.PLANYR_URL || null;
let browser = null, page, liveSession = null, liveBefore = null, liveBuild = null;
const liveIds = () => liveSession.page.evaluate(async () => { const q = await window.pfSupabase.from("schedules").select("id").is("deleted_at", null); if (q.error) throw new Error(q.error.message); return q.data.map(r => r.id); });
if (LIVE) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  liveSession = await openSignedIn({ base: LIVE, viewport: { width: 2400, height: 900 } });
  ok("[known-good] signed in as the test account", liveSession.proof.email === "e2e@planyr.test", liveSession.proof.email);
  liveBefore = new Set(await liveIds());
  // seed ONE throwaway cloud schedule (a first visit to /sequence/ creates the row), then overwrite it with the fixture
  let ids = [];
  const seedPage = await liveSession.page.context().newPage(); await seedPage.setViewportSize({ width: 1600, height: 950 });
  await seedPage.goto(LIVE + "/sequence/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await seedPage.waitForSelector('[data-testid="open-history-desktop"], button:has-text("New schedule")', { timeout: 40000 });
  if (!(await seedPage.locator('[data-testid="open-history-desktop"]').count())) { await seedPage.getByRole("button", { name: "New schedule" }).click(); await pacedWait(seedPage, 3000); }
  await pacedWait(seedPage, 3000); await seedPage.close();
  ids = (await liveIds()).filter(i => !liveBefore.has(i));
  if (ids.length !== 1) { console.log("expected exactly one throwaway schedule row, found " + JSON.stringify(ids)); process.exit(1); }
  const seedErr = await liveSession.page.evaluate(async ({ id, fx }) => {
    const r = await window.pfSupabase.from("schedules").select("rev").eq("id", id).single();
    if (r.error) return r.error.message;
    const u = await window.pfSupabase.from("schedules").update({ name: fx.name, data: { ...fx, id }, rev: (r.data.rev || 0) + 1 }).eq("id", id).select("id");
    return u.error ? u.error.message : (u.data && u.data.length ? null : "update matched no row"); }, { id: ids[0], fx: fixture.projects[1] });
  if (seedErr) { console.log("could not seed the throwaway row: " + seedErr); process.exit(1); }
  page = await liveSession.page.context().newPage(); await page.setViewportSize({ width: 2400, height: 900 });
  page.on("dialog", d => d.accept());
  page.on("pageerror", e => console.log("  [pageerror]", e.message.slice(0, 160)));
  await page.goto(LIVE + "/sequence/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await pacedWait(page, 1800);
  await assertMeasurable(page, "verify-grid-strip");
  liveBuild = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then(r => r.json()).then(j => j.build).catch(() => "unreadable"));
  console.log("served build", liveBuild);
  if (process.env.EXPECT_BUILD) ok("served build matches the build under test", String(liveBuild).startsWith(process.env.EXPECT_BUILD.slice(0, 7)), liveBuild);
  await page.locator('.hdr-view button:has-text("Grid")').click();
  await pacedWait(page, 900);
} else {
  browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 2400, height: 900 } });
  page.on("dialog", d => d.accept());
  page.on("pageerror", e => console.log("  [pageerror]", e.message.slice(0, 160)));
  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-grid-strip");
  await page.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
  await pacedWait(page, 700);
  await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  await pacedWait(page, 1500);
  await page.locator('.hdr-view button:has-text("Grid")').click();
  await pacedWait(page, 700);
}
await page.waitForSelector('[data-grid-scroll="1"]');

const G = '[data-grid-scroll="1"]';
const rowBox = id => page.evaluate(i => { const r = document.querySelector(`[data-task-row="${i}"]`); if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, id);
const cellBox = (id, k) => page.evaluate(({ i, k }) => { const c = document.querySelector(`[data-task-row="${i}"] [data-col-key="${k}"]`); if (!c) return null; const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right }; }, { i: id, k });
// The strip's box. Where no filler element exists (a grid without one) it is the GEOMETRIC strip — from the last cell's
// right edge to the row's right edge — so every pixel check below still measures the same region and goes red there,
// rather than hiding behind a missing element. `el` says which one it was (N1a asserts the element itself).
const stripBox = id => page.evaluate(i => { const row = document.querySelector(`[data-task-row="${i}"]`); if (!row) return null;
  const s = row.querySelector("[data-grid-strip]"); const rb = row.getBoundingClientRect();
  if (s) { const b = s.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, el: true }; }
  const cs = [...row.querySelectorAll("[data-col-key]")]; const lr = cs[cs.length - 1].getBoundingClientRect().right;
  return { x: lr, y: rb.top, w: rb.right - lr, h: rb.height, r: rb.right, el: false }; }, id);
const shot = async () => { const png = decodePng(await page.screenshot()); return { px: (x, y) => { x = Math.round(x); y = Math.round(y); const i = (y * png.width + x) * png.channels; return `${png.data[i]},${png.data[i+1]},${png.data[i+2]}`; } }; };
// React renders `{n} × {m}` as THREE adjacent text nodes, so read each leaf ELEMENT's whole text, not text nodes.
const badgeText = () => page.evaluate(sel => { const g = document.querySelector(sel); if (!g) return "no-grid";
  const hits = []; for (const el of document.body.querySelectorAll("*")) { if (el.children.length) continue;
    const t = (el.textContent || "").trim(); if (/^\d+\s*[×x]\s*\d+$/.test(t)) hits.push(t); }
  return hits.join("|"); }, G);
const allIds = () => page.evaluate(() => [...document.querySelectorAll("[data-task-row]")].map(r => r.getAttribute("data-task-row")));

// ── N1a — the strip exists and is exactly the row's leftover width ──────────────────────────────────────────
const ids = await allIds();
const stripCount = await page.evaluate(() => document.querySelectorAll("[data-task-row] [data-grid-strip]").length);
if (!ids.length) void_("no rows rendered");
{ const g0 = await stripBox(ids[0]); if (!g0 || g0.w < 100) void_("no leftover width right of the last column at 2400 wide — the strip cannot be measured"); }
ok("N1a every rendered row carries a filler strip", stripCount === ids.length, `${stripCount}/${ids.length}`);
{
  let bad = [];
  for (const id of ids) {
    const rb = await rowBox(id), sb = await stripBox(id);
    const last = await page.evaluate(i => { const cs = [...document.querySelectorAll(`[data-task-row="${i}"] [data-col-key]`)]; return cs.length ? cs[cs.length - 1].getBoundingClientRect().right : null; }, id);
    if (!sb || !sb.el || Math.abs(sb.x - last) > 0.6 || Math.abs(sb.r - (rb.x + rb.w)) > 0.6 || sb.w < 100) bad.push(id);
  }
  ok("N1a strip.left == last cell's right edge and strip.right == row's right edge (wide window)", bad.length === 0, bad.length ? `rows ${bad.slice(0, 5)}` : "");
  const sw = await page.evaluate(sel => { const g = document.querySelector(sel); return { sw: g.scrollWidth, cw: g.clientWidth }; }, G);
  ok("N1f no horizontal scrollbar appears at a wide window", sw.sw <= sw.cw, `${sw.sw} vs ${sw.cw}`);

  // ── N1b/N1c — pixels: the strip is the row's own colour, with one unbroken bottom line ─────────────────
  const s1 = await shot();
  const colourOf = async id => {
    const rb = await rowBox(id), sb = await stripBox(id), cost = await cellBox(id, "cost");
    return { strip: s1.px(sb.x + sb.w / 2, rb.y + rb.h / 2), cell: s1.px(cost.x + cost.w * 0.8, rb.y + rb.h / 2) };
  };
  const probe = [];
  for (const h of HEALTHS) { const id = tasks.find(t => t.id > 1 && t.id < 20 && t.health === h)?.id; if (id && ids.includes(String(id))) probe.push({ h, id }); }
  const tintBad = [];
  for (const p of probe) { const c = await colourOf(p.id); if (c.strip !== c.cell) tintBad.push(`${p.h} row ${p.id}: strip ${c.strip} vs cell ${c.cell}`); }
  ok("N1b the strip carries the row's tint (plain / red / yellow / green)", probe.length >= 4 && tintBad.length === 0, tintBad.join(" ; ") || `${probe.length} rows`);
  const dashBad = [];
  for (const p of probe) {
    const rb = await rowBox(p.id), sb = await stripBox(p.id), nb = await cellBox(p.id, "duration");
    const y = rb.y + rb.h - 1;
    const ref = s1.px(nb.x + nb.w * 0.5, y);
    const xs = []; for (let i = 0; i < 14; i++) xs.push(sb.x + 20 + i * ((sb.w - 40) / 13));
    const seen = new Set(xs.map(x => s1.px(x, y)));
    if (seen.size !== 1 || ![...seen][0] || [...seen][0] !== ref) dashBad.push(`row ${p.id}: ${[...seen].join(" / ")} vs cell line ${ref}`);
  }
  ok("N1c the strip's row line is ONE solid colour (no dashes) and equals the line under the cells", dashBad.length === 0, dashBad.join(" ; "));

  // ── N1d/N1e — selection: highlight + outline run to the edge; a press in the strip selects the row ─────
  const idCell = id => page.locator(`[data-task-row="${id}"] [data-col-key="id"]`);
  await idCell(3).click(); await pacedWait(page, 200);
  await page.keyboard.down("Shift"); await idCell(9).click(); await page.keyboard.up("Shift"); await pacedWait(page, 400);
  await page.mouse.move(1200, 880); await pacedWait(page, 200);   // park the pointer off the grid so no hover outline overpaints the pixels
  const s2 = await shot();
  const rb3 = await rowBox(3), rb9 = await rowBox(9), rb10 = await rowBox(10), sb3 = await stripBox(3), nb3 = await cellBox(3, "notes"), sb5 = await stripBox(5), rb5 = await rowBox(5), nb5 = await cellBox(5, "notes");
  const selBlue = s2.px(nb5.x + nb5.w - 12, rb5.y + rb5.h / 2);
  ok("N1d the strip of a selected row takes the selection fill (same as the cells)", s2.px(sb5.x + sb5.w / 2, rb5.y + rb5.h / 2) === selBlue, `${s2.px(sb5.x + sb5.w / 2, rb5.y + rb5.h / 2)} vs ${selBlue}`);
  const sb10 = await stripBox(10);
  ok("N1d an unselected row's strip is NOT filled", s2.px(sb10.x + sb10.w / 2, rb10.y + rb10.h / 2) !== selBlue);
  const edgeBlue = s2.px(sb5.r - 1, rb5.y + rb5.h / 2);
  ok("N1d the outline's right edge sits at the pane's right edge", edgeBlue === "37,99,235", edgeBlue);
  ok("N1d the outline's top and bottom run across the strip", s2.px(sb3.x + sb3.w / 2, rb3.y + 0.5) === "37,99,235" && s2.px(sb3.x + sb3.w / 2, rb9.y + rb9.h - 2) === "37,99,235", `${s2.px(sb3.x + sb3.w / 2, rb3.y + 0.5)} / ${s2.px(sb3.x + sb3.w / 2, rb9.y + rb9.h - 2)}`);
  ok("N2 no size readout with rows selected", (await badgeText()) === "", await badgeText());
  if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, LIVE ? "live-grid-range.png" : "grid-wide-range.png"), clip: { x: 900, y: 60, width: 1500, height: 440 } }); await page.screenshot({ path: join(SHOTS, LIVE ? "live-grid-full.png" : "grid-full.png") }); }

  // a press in the strip → that row (single selection)
  const click = async (id, dx = 0.5, shift = false) => { const sb = await stripBox(id), rb = await rowBox(id);
    if (shift) await page.keyboard.down("Shift"); await page.mouse.click(sb.x + sb.w * dx, rb.y + rb.h / 2); if (shift) await page.keyboard.up("Shift"); await pacedWait(page, 300); };
  const selRowId = () => page.evaluate(() => document.querySelector("[data-row-sel]")?.getAttribute("data-task-row") ?? null);
  await click(14);
  ok("N1e a press in the strip selects that row (like its last cell)", (await selRowId()) === "14", `selected: ${await selRowId()}`);
  const lastCellClick = async id => { const nb = await cellBox(id, "notes"), rb = await rowBox(id); await page.mouse.click(nb.x + nb.w - 6, rb.y + rb.h / 2); await pacedWait(page, 300); return selRowId(); };
  ok("N1e …and a press on the last cell does the same (the reference)", (await lastCellClick(16)) === "16");
  await click(14);
  await click(18, 0.5, true);
  const s3 = await shot();
  const sb16 = await stripBox(16), rb16 = await rowBox(16);
  ok("N1e shift-press in the strip extends the range through that row", s3.px(sb16.x + sb16.w / 2, rb16.y + rb16.h / 2) === selBlue && (await selRowId()) === null, `row 16 strip ${s3.px(sb16.x + sb16.w / 2, rb16.y + rb16.h / 2)}`);
  ok("N2 no size readout with a cell range", (await badgeText()) === "", await badgeText());

  // cell-range drag
  { const a = await cellBox(22, "start"), b = await cellBox(26, "cost");
    await page.mouse.move(a.x + 20, a.y + 10); await page.mouse.down(); await page.mouse.move(b.x + 10, b.y + 10, { steps: 6 });
    ok("N2 no size readout DURING a cell-range drag", (await badgeText()) === "", await badgeText());
    await page.mouse.up(); await pacedWait(page, 200); }
  // row drag in flight, with a range held
  { await idCell(30).click(); await page.keyboard.down("Shift"); await idCell(33).click(); await page.keyboard.up("Shift"); await pacedWait(page, 200);
    const grip = page.locator(`[data-task-row="31"] [data-row-drag-handle]`); const gb = await grip.boundingBox();
    await page.mouse.move(gb.x + 3, gb.y + 6); await page.mouse.down(); await page.mouse.move(gb.x + 40, gb.y + 90, { steps: 8 }); await pacedWait(page, 250);
    // aim at a row's TOP edge: the centre of a row now shows the "Nest inside" box instead of the insertion line (B2445008)
    let dragY = gb.y + 90;
    { const t = await rowBox(36); if (t) { dragY = t.y + 1.5; await page.mouse.move(gb.x + 40, dragY, { steps: 4 }); await pacedWait(page, 300); } }
    ok("N2 no size readout DURING a row drag", (await badgeText()) === "", await badgeText());
    const readDrag = () => page.evaluate(sel => { const l = document.querySelector("[data-drag-insert-line]"); const n = document.querySelector("[data-drag-nest]"); const r = document.querySelector("[data-task-row]");
      const vis = e => !!e && getComputedStyle(e).display !== "none";
      return { line: vis(l) ? { r: l.getBoundingClientRect().right, rowR: r.getBoundingClientRect().right } : null, nest: vis(n) ? n.getAttribute("data-drag-nest-kind") : null, dimmed: [...document.querySelectorAll("[data-task-row]")].filter(x => x.style.opacity === "0.45").map(x => x.getAttribute("data-task-row")) }; }, G);
    let lineState = await readDrag();
    // the pointer can rest on a row's CENTRE (autoscroll shifts the list under it) — that shows the nest box instead of the line, so step to the top edge of whatever row is under it
    for (let k = 0; k < 5 && !lineState.line; k++) {
      const top = await page.evaluate(({ x, y }) => { const r = document.elementFromPoint(x, y)?.closest?.("[data-task-row]"); return r ? r.getBoundingClientRect().top : null; }, { x: gb.x + 40, y: dragY });
      if (top == null) break;
      dragY = top + 1.5; await page.mouse.move(gb.x + 40, dragY, { steps: 2 }); await pacedWait(page, 300);
      lineState = await readDrag();
    }
    const line = lineState.line;
    ok("N1g the drag-row indicator line spans to the pane's right edge", !!line && Math.abs(line.r - line.rowR) < 1, line ? `${line.r} vs ${line.rowR}` : `line not shown (nest box: ${lineState.nest}; rows dimmed = drag started: ${lineState.dimmed.join(",") || "none"})`);
    await page.mouse.up(); await pacedWait(page, 300); }

  // column resize in flight
  { const h = await page.evaluate(() => { const c = document.querySelector('[data-hdr-col="notes"]'); const b = c.getBoundingClientRect(); return { x: b.right - 3, y: b.top + 10, w: b.width }; });
    await page.mouse.move(h.x, h.y); await page.mouse.down(); await page.mouse.move(h.x - 120, h.y, { steps: 6 });
    ok("N2 no size readout DURING a column resize", (await badgeText()) === "", await badgeText());
    await page.mouse.up(); await pacedWait(page, 400);
    const ids2 = await allIds(); let bad2 = [];
    for (const id of ids2.slice(0, 20)) { const rb = await rowBox(id), sb = await stripBox(id); const last = await page.evaluate(i => { const cs = [...document.querySelectorAll(`[data-task-row="${i}"] [data-col-key]`)]; return cs[cs.length - 1].getBoundingClientRect().right; }, id);
      if (!sb || !sb.el || Math.abs(sb.x - last) > 0.6 || Math.abs(sb.r - (rb.x + rb.w)) > 0.6) bad2.push(id); }
    ok("N1g after a column is resized the strip still starts at the last cell and ends at the row edge", bad2.length === 0, bad2.join(","));
    const sw2 = await page.evaluate(sel => { const g = document.querySelector(sel); return g.scrollWidth <= g.clientWidth; }, G);
    ok("N1g …and still no horizontal scrollbar", sw2); }

  // collapsed group
  await page.evaluate(sel => { document.querySelector(sel).scrollTop = 0; }, G); await pacedWait(page, 300);
  { const tog = page.locator(`${G} [data-task-row] span[title="Collapse"]`);
    if (await tog.count()) { await tog.first().click(); await pacedWait(page, 500);
      const ids3 = await allIds(); let bad3 = [];
      for (const id of ids3.slice(0, 20)) { const rb = await rowBox(id), sb = await stripBox(id); if (!sb || !sb.el || Math.abs(sb.r - (rb.x + rb.w)) > 0.6) bad3.push(id); }
      ok("N1g after a group is collapsed every row still has its strip to the edge", ids3.length > 0 && bad3.length === 0, bad3.join(","));
      await page.locator(`${G} [data-task-row] span[title="Expand"]`).first().click(); await pacedWait(page, 400);
    } else ok("N1g collapse toggle reachable (precondition)", false, "no Collapse control on the summary row"); }
}

// ── N3 — keyboard navigation drops the hover outline of a parked pointer ────────────────────────────────────
await page.evaluate(sel => { document.querySelector(sel).scrollTop = 0; }, G);
await pacedWait(page, 300);
const lit = id => page.evaluate(i => { const r = document.querySelector(`[data-task-row="${i}"]`); if (!r) return null; const c = r.querySelector('[data-col-key="name"]'); const ct = getComputedStyle(c, "::before").content; return ct && ct !== "none" && ct !== "normal"; }, id);
const litRows = () => page.evaluate(() => [...document.querySelectorAll("[data-task-row]")].filter(r => { const ct = getComputedStyle(r.querySelector('[data-col-key="name"]'), "::before").content; return ct && ct !== "none" && ct !== "normal"; }).map(r => r.getAttribute("data-task-row")));
const centre = async id => { const nb = await cellBox(id, "cost"); return { x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 }; };
{
  const c12 = await centre(12);
  await page.mouse.click(c12.x, c12.y); await pacedWait(page, 250);      // active cell on row 12
  const c20 = await centre(20);
  await page.mouse.move(c20.x, c20.y); await pacedWait(page, 250);       // park the pointer on row 20
  ok("N3 (known-good arm) a pointer at rest lights its row's hover outline before any key is pressed", (await lit(20)) === true, `lit: ${(await litRows()).join(",")}`);
  const after = async key => { await page.keyboard.press(key); await pacedWait(page, 300); return litRows(); };
  const one = async (label, key, expectNo20 = true) => { const l = await after(key); ok(`N3 ${label}: the parked row 20 is not left lit`, !l.includes("20"), `lit: ${l.join(",")}`); return l; };
  const l1 = await one("ArrowDown", "ArrowDown");
  ok("N3 …and exactly ONE row reads as current (the keyboard's)", l1.length === 1 && l1[0] === "13", `lit: ${l1.join(",")}`);
  // a real pointer move gives it back
  await page.mouse.move(c20.x + 6, c20.y + 2); await pacedWait(page, 250);
  ok("N3 a real pointer move brings the hover back", (await lit(20)) === true);
  await one("ArrowUp", "ArrowUp");
  // a pointermove at the SAME coordinates (what a scroll / re-render under a still pointer synthesises) must not re-light it
  await page.evaluate(({ x, y }) => { document.elementFromPoint(x, y).dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true })); }, { x: c20.x + 6, y: c20.y + 2 });
  await pacedWait(page, 200);
  ok("N3 a pointermove at the same coordinates does not re-light it", (await lit(20)) !== true);
  await one("Tab", "Tab"); await one("Shift+Tab", "Shift+Tab");
  await one("Shift+ArrowDown (range extension)", "Shift+ArrowDown");
  await one("Home", "Home"); await one("End", "End");
  await page.mouse.move(c20.x, c20.y); await pacedWait(page, 200); await page.mouse.move(c20.x + 1, c20.y); await pacedWait(page, 200);
  await one("PageDown", "PageDown");
  // keyboard scroll slides a different row under the still pointer: it must not be lit
  const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-task-row]")?.getAttribute("data-task-row") ?? null, { x: c20.x + 1, y: c20.y });
  const lAfter = await litRows();
  ok("N3 a row slid under the still pointer by keyboard scrolling is not lit", under === null || !lAfter.includes(under), `row under pointer: ${under}; lit: ${lAfter.join(",")}`);
  await page.keyboard.press("PageUp"); await pacedWait(page, 300);
  // Enter-to-move-down after editing
  await page.mouse.move(c20.x, c20.y); await pacedWait(page, 150); await page.mouse.move(c20.x + 2, c20.y); await pacedWait(page, 200);
  await page.evaluate(sel => { document.querySelector(sel).scrollTop = 0; }, G); await pacedWait(page, 300);
  const c8 = await cellBox(8, "name"); await page.mouse.click(c8.x + 40, c8.y + 8); await pacedWait(page, 250);
  await page.mouse.move(c20.x, c20.y); await pacedWait(page, 150); await page.mouse.move(c20.x + 3, c20.y); await pacedWait(page, 250);
  await page.keyboard.press("Enter"); await pacedWait(page, 250);              // open the editor
  await page.keyboard.press("Enter"); await pacedWait(page, 350);              // commit + move down
  const lEnter = await litRows();
  ok("N3 Enter-to-move-down after editing: the parked row 20 is not left lit", !lEnter.includes("20"), `lit: ${lEnter.join(",")}`);
  await page.keyboard.press("Escape");
}

// ── N1g — the grid pane in Split view, and a narrow window ──────────────────────────────────────────────────
await page.locator('.hdr-view button:has-text("Split")').click();
await pacedWait(page, 900);
if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, LIVE ? "live-split.png" : "split.png") }); }
await page.waitForSelector('[data-grid-scroll="1"] [data-grid-strip]', { timeout: 8000 }).catch(() => {});
{ const ids4 = await allIds(); let bad4 = [];
  for (const id of ids4.slice(0, 15)) { const rb = await rowBox(id), sb = await stripBox(id); if (!sb || !sb.el || Math.abs(sb.r - (rb.x + rb.w)) > 0.6) bad4.push(id); }
  ok("N1g in Split view every grid row still has its strip to the pane edge", ids4.length > 0 && bad4.length === 0, bad4.join(","));
  ok("N2 no size readout in Split view", (await badgeText()) === "", await badgeText()); }
await page.locator('.hdr-view button:has-text("Grid")').click(); await pacedWait(page, 700);
await page.setViewportSize({ width: 760, height: 900 }); await pacedWait(page, 800);
{ const r = await page.evaluate(sel => { const g = document.querySelector(sel); const row = document.querySelector("[data-task-row]"); const s = row.querySelector("[data-grid-strip]"); const sw = s ? s.getBoundingClientRect().width : -1;
    const colsW = [...row.querySelectorAll("[data-col-key]")].reduce((a, c) => a + c.getBoundingClientRect().width, 0); return { sw, scrollW: g.scrollWidth, colsW }; }, G);
  ok("N1f narrow window: the strip is zero-width and adds no scroll width (scroll width is the columns' own, +2 for the row's accent edge)", r.sw === 0 && r.scrollW - r.colsW <= 3, JSON.stringify(r));
  await page.evaluate(sel => { const g = document.querySelector(sel); g.scrollLeft = g.scrollWidth; }, G); await pacedWait(page, 250);
  const e = await page.evaluate(sel => { const g = document.querySelector(sel); const row = document.querySelector("[data-task-row]"); const cells = [...row.querySelectorAll("[data-col-key]")]; return { rowR: row.getBoundingClientRect().right, gR: g.getBoundingClientRect().right, lastR: cells[cells.length - 1].getBoundingClientRect().right }; }, G);
  ok("N1f scrolled fully right: the last cell meets the pane's edge, nothing blank beyond it", Math.abs(e.lastR - e.gR) <= 1.5, JSON.stringify(e)); }

if (LIVE) {
  // Cleanup (owner constraint 15): soft-delete every schedule row this run created, then prove none remains live.
  const created = (await liveIds()).filter(i => !liveBefore.has(i));
  const err = await liveSession.page.evaluate(async (ids) => { for (const i of ids) { const u = await window.pfSupabase.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", i); if (u.error) return u.error.message; } return null; }, created);
  const left = (await liveIds()).filter(i => !liveBefore.has(i));
  ok(`cleanup: the ${created.length} throwaway schedule row(s) this run created are deleted and none remains live`, !err && left.length === 0, JSON.stringify({ created, err, left }));
  console.log("build at the end of the run", await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then(r => r.json()).then(j => j.build).catch(() => "unreadable")));
  await liveSession.close();
} else { await browser.close(); server.close(); }
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("FAILED:\n - " + failed.map(f => f.name).join("\n - ")); process.exit(1); }
process.exit(0);
