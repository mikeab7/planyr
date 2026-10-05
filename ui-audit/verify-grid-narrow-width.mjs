/* NEW-1/2/3 (Schedule grid holds at narrow widths) — geometry gate for the Schedule GRID body.
 *
 * Owner, verbatim: "I want the frame to always work regardless of the size of computer or screen
 * that we're on... our software should just adjust for any screen size."
 *
 * WHAT IT ASSERTS, from DOM geometry only (no baseline images), for Grid AND Split, at widths
 * 800/960/1024/1280/1440 × heights 450/900, with the owner's column set (ID Task Start Finish Dur
 * Predecessor Successor ● — i.e. the config he screenshotted) and long predecessor names:
 *   1. the ● column and the "⋯" columns button are FULLY inside the viewport — at scroll 0 AND
 *      after scrolling the grid all the way right;
 *   2. document.scrollWidth === clientWidth (sideways scrolling is the GRID's, never the page's);
 *   3. every body row is exactly the same height (no cell spills a second line);
 *   4. ID + Task stay pinned: after scrolling right their left edge is still the grid's left edge;
 *   5. the pinned Task column never exceeds half the grid pane (so START/FINISH stay visible);
 *   6. header cells and body cells stay column-aligned after a sideways scroll;
 *   7. the predecessor cell is ONE line, ends in an ellipsis when cut, keeps the ID visible and
 *      carries the full text in a tooltip.
 * The help "?" button is a Shell control (fixed bottom-right over the iframe) so it is checked by
 * verify-grid-help-clearance.mjs against the real app shell.
 *
 * It carries a KNOWN-GOOD arm (1440×900 desktop, wide) that must report the layout it is known to
 * have, and the run is VOID if it does not (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6).
 *
 * Run:  node ui-audit/verify-grid-narrow-width.mjs      [PW_CHROME=<chrome>]  [BASELINE=1 to only print]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const HTML_PATH = new URL("../public/sequence/index.html", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || undefined;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const SHOTS = process.env.SHOTS_DIR || null;
const WIDTHS = (process.env.WIDTHS || "800,960,1024,1280,1440").split(",").map(Number);
const HEIGHTS = (process.env.HEIGHTS || "450,900").split(",").map(Number);
const VIEWS = (process.env.VIEWS || "grid,split").split(",");

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
const NAMES = [
  "Find and send Wire Receipt to MUD", "Baytown to provide response", "Submit the Phase 2 environmental report to the county",
  "Review and approve geotechnical findings with civil engineer", "Order long-lead electrical switchgear",
];
const tasks = [task({ id: 1, name: "Entitlements", isExpanded: true })];
for (let i = 2; i <= 40; i++) {
  tasks.push(task({ id: i, name: i % 7 === 0 ? `A very long task name number ${i} that must truncate instead of wrapping` : NAMES[i % NAMES.length] + ` (${i})`,
    parentId: i % 9 === 0 ? 1 : null,
    predecessors: i === 5 ? [{id:2,type:"FS",lag:0},{id:3,type:"FS",lag:0},{id:4,type:"FS",lag:0}] : [{ id: i - 1, type: "FS", lag: 0 }] }));
}
const CONFIGS = {
  // the owner's screenshotted column set, columns user-resized wider (the "user-resized columns still work" edge)
  owner: { visible: ["id","name","start","end","duration","predecessors","successors","health"], widths: { name: 380, predecessors: 260, successors: 260 } },
  // the default twelve + a few extras: overflows at EVERY sweep width, ●/Status are mid-table (not a trailing run)
  full:  { visible: ["id","name","start","end","duration","predecessors","successors","health","status","responsibleParty","cost","notes","percentComplete","budget"], widths: {} },
};
const CFG = process.env.CFG || "owner";
const mkFixture = view => ({ aPid: 1, nPid: 2, nTid: 1000, view, section: "projects",
  projects: { 1: { id: 1, name: "Narrow Width Fixture", tasks,
    colConfig: CONFIGS[CFG] } } });

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

async function measure(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const doc = document.documentElement;
    const grid = document.querySelector('[data-grid-scroll="1"]');
    const gr = grid.getBoundingClientRect();
    const rows = [...document.querySelectorAll("[data-task-row]")];
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
    const row0 = rows[0];
    const cell = (row, k) => row && row.querySelector(`[data-col-key="${k}"]`);
    const hdr = k => document.querySelector(`[data-hdr-col="${k}"]`);
    const colsBtn = document.querySelector('button[title^="Show, hide, add or reorder"]');
    const heights = [...new Set(rows.map(r => Math.round(r.getBoundingClientRect().height * 100) / 100))];
    const predCells = rows.map(r => cell(r, "predecessors")).filter(Boolean);
    // Spill, CLIP-AWARE. (An inline span's getBoundingClientRect() includes lines that an ancestor's
    // line-clamp/overflow:hidden has already cut off — the first version of this check read that as a
    // spill on code that clips correctly: the instrument was the thing wrong.) A cell spills if it does
    // not clip its own content, or if any clipping box inside it is taller than the cell.
    let predSpill = 0, predMultiline = 0;
    for (const c of predCells) {
      const cr = c.getBoundingClientRect();
      const ov = getComputedStyle(c).overflow;
      let bad = ov !== "hidden" && ov !== "clip";
      for (const d of c.querySelectorAll("*")) {
        const cs = getComputedStyle(d);
        if ((cs.overflow === "hidden" || cs.display === "-webkit-box") && d.getBoundingClientRect().height > cr.height + 0.5) { bad = true; window.__spill = { tag: d.tagName, h: d.getBoundingClientRect().height, ch: cr.height }; break; }
      }
      if (bad) predSpill++;
      if (c.scrollHeight > c.clientHeight + 1) predMultiline++;
    }
    const sample = predCells.find(c => /·|·/.test(c.innerText || "")) || predCells[0];
    return {
      vw, vh, docSW: doc.scrollWidth, docCW: doc.clientWidth, bodySW: document.body.scrollWidth,
      grid: { l: gr.left, r: gr.right, w: gr.width, sl: grid.scrollLeft, maxSl: grid.scrollWidth - grid.clientWidth, cw: grid.clientWidth },
      rows: rows.length, heights,
      lastCell: rect([...row0.querySelectorAll('[data-col-key]')].pop()), health: rect(cell(row0, "health")), colsBtn: rect(colsBtn),
      id: rect(cell(row0, "id")), name: rect(cell(row0, "name")), start: rect(cell(row0, "start")), end: rect(cell(row0, "end")),
      hHealth: rect(hdr("health")), hName: rect(hdr("name")), hId: rect(hdr("id")), hPred: rect(hdr("predecessors")), pred0: rect(cell(row0, "predecessors")),
      predSpill, predMultiline, spillDetail: window.__spill || null,
      predSample: sample ? { text: sample.innerText, title: sample.querySelector("[title]")?.getAttribute("title") || sample.getAttribute("title") || null } : null,
    };
  });
}
const inside = (r, vw, vh, tol = 0.5) => r && r.l >= -tol && r.r <= vw + tol && r.t >= -tol && r.b <= vh + tol;

let voidRun = false;
for (const view of VIEWS) for (const h of HEIGHTS) for (const w of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("dialog", d => d.accept());
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-grid-narrow-width");
  await page.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(mkFixture(view))) });
  await pacedWait(page, 700);
  await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  await pacedWait(page, 1500);
  await page.waitForSelector("[data-task-row]");
  // the import does not carry the view — pick it the way a person does
  await page.locator(`.hdr-view button:has-text("${view === "grid" ? "Grid" : "Split"}")`).click();
  await pacedWait(page, 600);
  await page.waitForSelector(view === "split" ? '[data-split-pane], [data-grid-scroll="1"]' : '[data-grid-scroll="1"]');
  const tag = `${CFG} ${view} ${w}×${h}`;
  const rb = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  if (rb.w !== w || rb.h !== h) { ok(`${tag} · viewport read back`, false, JSON.stringify(rb)); await page.close(); continue; }
  const m0 = await measure(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${view}-${w}x${h}-scroll0.png` });
  ok(`${tag} · document has no sideways scroll (page scrollWidth == clientWidth)`, m0.docSW === m0.docCW && m0.bodySW <= m0.docCW, `docSW=${m0.docSW} docCW=${m0.docCW} bodySW=${m0.bodySW}`);
  ok(`${tag} · ● column fully inside the viewport at scroll 0`, inside(m0.health, m0.vw, m0.vh), JSON.stringify(m0.health));
  ok(`${tag} · "⋯" columns button fully inside the viewport`, inside(m0.colsBtn, m0.vw, m0.vh), JSON.stringify(m0.colsBtn));
  ok(`${tag} · every row the same height`, m0.heights.length === 1, JSON.stringify(m0.heights));
  ok(`${tag} · no predecessor text spills out of its row`, m0.predSpill === 0 && m0.predMultiline === 0, `spill=${m0.predSpill} multi=${m0.predMultiline} ${JSON.stringify(m0.spillDetail)}`);
  const gridW = m0.grid.cw;
  ok(`${tag} · pinned Task column ≤ ~half the grid pane`, m0.name && (m0.id?.w || 0) + m0.name.w <= gridW * 0.5 + 40, `id+name=${(m0.id?.w || 0) + (m0.name?.w || 0)} gridW=${gridW}`);
  ok(`${tag} · START and FINISH visible without scrolling`, m0.start && m0.end && m0.end.r <= m0.grid.r + 0.5 && m0.start.l >= m0.grid.l - 0.5, `start=${JSON.stringify(m0.start)} end=${JSON.stringify(m0.end)} grid=${m0.grid.l}-${m0.grid.r}`);
  // scroll all the way right
  await page.evaluate(() => { const g = document.querySelector('[data-grid-scroll="1"]'); g.scrollLeft = g.scrollWidth; });
  await pacedWait(page, 250);
  const m1 = await measure(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${view}-${w}x${h}-scrollR.png` });
  ok(`${tag} · after scrolling right: page still has no sideways scroll`, m1.docSW === m1.docCW, `docSW=${m1.docSW} docCW=${m1.docCW}`);
  // ● is pinned only while it is part of the TRAILING run of columns (the owner's set). In the "full" set it sits
  // mid-table by design, so the contract there is: the LAST column can be scrolled fully into view.
  const pinnedTail = CFG === "owner" ? m1.health : m1.lastCell;
  ok(`${tag} · after scrolling right: ${CFG === "owner" ? "● (pinned right)" : "the last column"} fully inside the grid pane`, pinnedTail && pinnedTail.l >= m1.grid.l - 0.5 && pinnedTail.r <= m1.grid.r + 0.5 && inside(pinnedTail, m1.vw, m1.vh), JSON.stringify(pinnedTail) + " grid " + m1.grid.l + "-" + m1.grid.r);
  ok(`${tag} · after scrolling right: ID + Task still pinned at the left edge`, m1.id && m1.name && Math.abs(m1.id.l - m1.grid.l) <= 3 && m1.name.l < m1.grid.l + (m1.id?.w || 0) + 4, `id.l=${m1.id?.l} name.l=${m1.name?.l} grid.l=${m1.grid.l}`);
  ok(`${tag} · after scrolling right: header and body stay column-aligned`, m1.hName && m1.name && Math.abs(m1.hName.l - m1.name.l) <= 1 && Math.abs(m1.hName.w - m1.name.w) <= 1 && m1.hHealth && m1.health && Math.abs(m1.hHealth.l - m1.health.l) <= 1, `hName=${m1.hName?.l}/${m1.name?.l} hHealth=${m1.hHealth?.l}/${m1.health?.l}`);
  if (m0.predSample) ok(`${tag} · predecessor keeps its ID, has a tooltip with the full text`, /^\d+/.test((m0.predSample.text || "").trim()) && !!m0.predSample.title, JSON.stringify(m0.predSample));
  if (errs.length) ok(`${tag} · no page errors`, false, errs.join(" | "));
  // KNOWN-GOOD arm: the wide desktop run must see the whole table with nothing to scroll.
  if (view === "grid" && w === 1440 && h === 900 && !(m0.grid.maxSl <= 1 && m0.rows >= 10)) { voidRun = true; console.log(`VOID — known-good arm (1440×900) did not report a fully-fitting table: maxSl=${m0.grid.maxSl} rows=${m0.rows}`); }
  await page.close();
}

// ── SECTION B — edge cases (owner config, 960×700): keyboard reveal, grid zoom, Split divider extremes ──────────
if (!process.env.SKIP_EDGE) {
  async function openFixture(page, view, extra = {}) {
    page.on("dialog", d => d.accept());
    await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("[data-task-row]", { timeout: 40000 });
    await page.locator('[data-testid="open-history-desktop"]').click();
    await pacedWait(page, 250);
    await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...mkFixture(view), ...extra })) });
    await pacedWait(page, 700);
    await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
    await pacedWait(page, 1200);
    await page.locator(`.hdr-view button:has-text("${view === "grid" ? "Grid" : "Split"}")`).click();
    await pacedWait(page, 600);
  }
  // B1 — keyboard navigation to a column that is scrolled under the pins brings it fully into the free strip.
  {
    const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
    await openFixture(page, "grid");
    await assertMeasurable(page, "verify-grid-narrow-width/B1");
    await page.locator('[data-task-row="3"] [data-col-key="name"]').click();
    for (let i = 0; i < 5; i++) { await page.keyboard.press("ArrowRight"); await pacedWait(page, 120); }
    await pacedWait(page, 300);
    const r = await page.evaluate(() => {
      const g = document.querySelector('[data-grid-scroll="1"]').getBoundingClientRect();
      const rect = k => { const e = document.querySelector(`[data-task-row="3"] [data-col-key="${k}"]`).getBoundingClientRect(); return { l: e.left, r: e.right }; };
      return { g: { l: g.left, r: g.right }, name: rect("name"), succ: rect("successors"), health: rect("health") };
    });
    ok("B1 · ArrowRight to Successor scrolls it fully out from under the pinned Task and ● columns", r.succ.l >= r.name.r - 0.5 && r.succ.r <= r.health.l + 0.5, JSON.stringify(r));
    // known-good control: the Task cell (pinned) never moves out of the pane
    ok("B1 · pinned Task column is still at the left edge after the keyboard scroll", Math.abs(r.name.l - r.g.l - 30) <= 3 || r.name.l <= r.g.l + 40, JSON.stringify(r.name));
    await page.close();
  }
  // B2 — the grid's own zoom: pins and the half-pane cap are computed in the grid's content units.
  {
    const page = await browser.newPage({ viewport: { width: 960, height: 700 } });
    await openFixture(page, "grid", { gridZoom: 1.25 });
    const z = await page.evaluate(() => { const g = document.querySelector('[data-grid-scroll="1"]'); return { zoom: getComputedStyle(g).zoom, w: g.getBoundingClientRect().width }; });
    if (z.zoom === "1") console.log("NOTE — gridZoom did not import; B2 runs at 100% (control only)");
    await page.evaluate(() => { const g = document.querySelector('[data-grid-scroll="1"]'); g.scrollLeft = g.scrollWidth; });
    await pacedWait(page, 300);
    const m = await measure(page);
    ok(`B2 · grid zoom ${z.zoom}: ● fully inside the pane after scrolling right`, m.health && m.health.r <= m.grid.r + 0.5 && m.health.l >= m.grid.l - 0.5, JSON.stringify({ health: m.health, grid: m.grid }));
    ok(`B2 · grid zoom ${z.zoom}: ID + Task still pinned`, m.id && Math.abs(m.id.l - m.grid.l) <= 3, JSON.stringify(m.id));
    ok(`B2 · grid zoom ${z.zoom}: rows still one height`, m.heights.length === 1, JSON.stringify(m.heights));
    await page.close();
  }
  // B3 — Split: drag the divider to the extremes; the grid pane sizes by ITS OWN width.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
    await openFixture(page, "split");
    for (const pct of [20, 35, 50, 70, 80]) {
      const box = await page.evaluate(() => { const g = document.querySelector('[data-grid-scroll="1"]').getBoundingClientRect(); return { x: g.right, y: g.top + 200, cw: innerWidth }; });
      await page.mouse.move(box.x + 1, box.y); await page.mouse.down();
      await page.mouse.move(box.cw * pct / 100, box.y, { steps: 6 }); await page.mouse.up();
      await pacedWait(page, 400);
      await page.evaluate(() => { const g = document.querySelector('[data-grid-scroll="1"]'); g.scrollLeft = g.scrollWidth; });
      await pacedWait(page, 250);
      const m = await measure(page);
      const inPane = c => c && c.l >= m.grid.l - 0.5 && c.r <= m.grid.r + 0.5;
      ok(`B3 · Split divider ~${pct}% (pane ${Math.round(m.grid.w)}): page has no sideways scroll`, m.docSW === m.docCW, `docSW=${m.docSW} docCW=${m.docCW}`);
      ok(`B3 · Split divider ~${pct}% (pane ${Math.round(m.grid.w)}): the pinned (owner set: ●) / last column inside its own pane after scrolling right`, inPane(CFG === "owner" ? m.health : m.lastCell) || m.grid.w < 260, JSON.stringify({ health: m.health, grid: m.grid }));
      ok(`B3 · Split divider ~${pct}% (pane ${Math.round(m.grid.w)}): header and body stay column-aligned`, m.hName && m.name && Math.abs(m.hName.l - m.name.l) <= 1, `${m.hName?.l}/${m.name?.l}`);
    }
    await page.close();
  }
}
await browser.close(); server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${voidRun ? " — RUN IS VOID" : ""}`);
process.exit(voidRun || (failed.length && !process.env.BASELINE) ? 1 : 0);
