/* NEW-1 (2026-10-06) — THE SCHEDULE FILLS THE WINDOW. No dead band under the grid, Gantt or Task Report.
 *
 * Owner report (live build 6000483, ~2000px window): "the grid body stops well short of the bottom … a blank band
 * roughly two to three rows tall". CAUSE (measured): the embedded page ended `--fab-dock` (48px) above the window
 * bottom so the shell's floating Help "?" would never sit on a cell — a full-width strip of bare <body>.
 * FIX: the page fills the window; each scroll surface pads its END by --fab-dock instead (last row still clears the "?").
 *
 * WHAT THIS ASSERTS, per view × window size, against the REAL page embedded in a same-origin host iframe (the way the
 * shell embeds it): (1) the scroll surface's bottom edge reaches the iframe viewport's bottom (≤ 2px); (2) in Grid there
 * is no splitter handle; in Split the desktop divider is still there; Gantt still fills; (3) the scroller really scrolls
 * (a vacuity guard — a schedule too short to overflow proves nothing); (4) scrolled to the end, the last row's bottom sits
 * at least the dock height above the window bottom, so the "?" button covers no row.
 * KNOWN-BAD ARM (red-proof): the SAME harness on `origin/main`'s page MUST fail (1). The run is VOID if it does not.
 *
 * Run:  node ui-audit/verify-schedule-fill-height.mjs    [PW_CHROME=<chrome>]   (HEIGHTS=520,760,1080 WIDTHS=...)
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const fixedBody = await readFile(new URL("../public/sequence/index.html", import.meta.url), "utf8");
let mainBody = null;
try { mainBody = execFileSync("git", ["show", "origin/main:public/sequence/index.html"], { maxBuffer: 1 << 28, encoding: "utf8" }); } catch {}
const WIDTHS = (process.env.WIDTHS || "1280,2000").split(",").map(Number);
const HEIGHTS = (process.env.HEIGHTS || "520,760,1080").split(",").map(Number);
const HEADER_H = 96, TOL = 2;
await ensureVendored();
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
let pageBody = fixedBody;
const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/host.html") { res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><body style="margin:0;overflow:hidden"><div style="height:${HEADER_H}px;background:#eee"></div><div style="position:relative;height:calc(100vh - ${HEADER_H}px)"><iframe id="f" src="/sequence/" style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe></div>`); return; }
    if (p.endsWith("/")) p += "index.html";
    if (p.endsWith("sequence/index.html")) { res.writeHead(200, { "Content-Type": "text/html" }); res.end(Buffer.from(rewriteCdn(pageBody))); return; }
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(await readFile(fp));
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox"] });
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const SCROLLER = { grid: "[data-grid-scroll]", split: "[data-grid-scroll]", gantt: "[data-gantt-scroll]", reports: "[data-scroll-bounds]" };
async function run({ view, w, h }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/host.html`);
  const frame = await (await page.waitForSelector("#f")).contentFrame();
  await frame.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-schedule-fill-height");
  await pacedWait(page, 800);
  if (view === "reports") await frame.evaluate(() => { [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Dashboard").click(); });
  else await frame.evaluate(l => { [...document.querySelectorAll(".hdr-view button")].find(b => b.textContent.trim() === l).click(); }, { grid: "Grid", split: "Split", gantt: "Gantt" }[view]);
  await pacedWait(page, 900);
  const m = await frame.evaluate(async sel => {
    const sc = document.querySelector(sel); if (!sc) return { missing: true };
    const vis = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
    const r = sc.getBoundingClientRect();
    const out = { vh: innerHeight, bottom: r.bottom, overflows: sc.scrollHeight > sc.clientHeight + 4,
      divider: [...document.querySelectorAll('[data-split-divider], .rev-div')].some(vis),
      colDivider: [...document.querySelectorAll('div')].some(d => d.style.cursor === "col-resize" && d.style.width === "1px" && vis(d)) };
    out.scrollTo = () => 0;
    return out;
  }, SCROLLER[view]);
  await frame.evaluate(sel => { const sc = document.querySelector(sel); sc.scrollTop = sc.scrollHeight; }, SCROLLER[view]);
  await pacedWait(page, 600);
  const m2 = await frame.evaluate(SEL => {
    const out = {};
    // the scroller's own content end (its tallest child — the row spacer / SVG), NOT task rows: the grid pads with empty fill rows
    const sc = document.querySelector(SEL);
    out.contentBottom = Math.max(...[...sc.children].map(c => c.getBoundingClientRect().bottom));
    out.dock = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fab-dock")) || 0;
    return out;
  }, SCROLLER[view]);
  await ctx.close();
  delete m.scrollTo;
  return { ...m, ...m2 };
}
const VIEWS = ["grid", "split", "gantt", "reports"];
for (const view of VIEWS) for (const h of HEIGHTS) for (const w of WIDTHS) {
  const tag = `${view} ${w}×${h}`;
  const m = await run({ view, w, h });
  if (m.missing) { ok(`${tag} · scroll surface exists`, false); continue; }
  // Task Report is a framed card with a deliberate 14px page margin (same as its sides) — not a reserved strip.
  const gutter = view === "reports" ? 16 : TOL;
  ok(`${tag} · scroll surface reaches the window bottom${view === "reports" ? " (card margin ≤ 16)" : ""}`, m.vh - m.bottom >= -TOL && m.vh - m.bottom <= gutter, `bottom=${Math.round(m.bottom)} vh=${m.vh}`);
  if (view === "grid") ok(`${tag} · no splitter handle in Grid`, !m.divider && !m.colDivider);
  if (view === "split") ok(`${tag} · Split still shows its divider`, m.colDivider || m.divider);
  if (view !== "reports") ok(`${tag} · VACUITY: the surface really overflows (scrolls)`, m.overflows);
  if (view !== "reports") ok(`${tag} · scrolled to the end, the content ends ≥ dock above the window bottom (clears the Help button)`, m.dock > 0 && m.contentBottom <= m.vh - m.dock + TOL, `contentBottom=${Math.round(m.contentBottom)} vh=${m.vh} dock=${m.dock}`);
}
let armOk = false;
if (mainBody) {
  pageBody = mainBody;
  const bad = await run({ view: "grid", w: 2000, h: 1080 });
  armOk = Math.abs(bad.vh - bad.bottom) > TOL;
  console.log(`${armOk ? "PASS ✅" : "FAIL ❌"} — known-bad arm: origin/main's page is CAUGHT (bottom=${Math.round(bad.bottom)} vs vh=${bad.vh})`);
} else console.log("FAIL ❌ — known-bad arm unavailable (origin/main not fetched)");
await browser.close(); server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${armOk ? "" : " — RUN IS VOID (the known-bad arm was not caught)"}`);
process.exit(!armOk || failed.length ? 1 : 0);
