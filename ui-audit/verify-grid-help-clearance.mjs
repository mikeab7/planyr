/* NEW-3 (Schedule grid, narrow widths) — the floating Help "?" never covers a grid cell.
 *
 * The "?" is the SHELL's `position:fixed` control (src/app/HelpReportControl.jsx); on the Schedule route the
 * grid lives in a same-origin <iframe src="/sequence/">. This harness embeds the real page in a same-origin
 * host iframe under a stand-in header, runs the shell's REAL placement function (src/shared/ui/cornerClearance.js,
 * imported fresh off disk) to decide where the button goes, draws a button of the real size there, and asserts
 * from DOM geometry that its box intersects NO grid cell (and no Gantt bar / task row) — in Grid, Split and
 * Gantt, at widths 800/960/1024/1280/1440 × heights 450/900, fine and coarse pointer.
 *
 * KNOWN-GOOD arm: with the page's `--fab-dock` reservation removed (the pre-fix page) the SAME harness must report an
 * intersection — a check that cannot fail is not a check. The run is VOID if that arm comes back clean.
 *
 * Run:  node ui-audit/verify-grid-help-clearance.mjs    [PW_CHROME=<chrome>]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const CC = await readFile(new URL("../src/shared/ui/cornerClearance.js", import.meta.url), "utf8");
const realBody = await readFile(new URL("../public/sequence/index.html", import.meta.url), "utf8");
const WIDTHS = (process.env.WIDTHS || "800,960,1024,1280,1440").split(",").map(Number);
const HEIGHTS = (process.env.HEIGHTS || "450,900").split(",").map(Number);
const VIEWS = (process.env.VIEWS || "grid,split,gantt").split(",");
const HEADER_H = 96;                        // stand-in for the shell's header + tab rows
await ensureVendored();
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
let pageBody = realBody;
const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/host.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><body style="margin:0;overflow:hidden"><div style="height:${HEADER_H}px;background:#eee"></div><div style="position:relative;height:calc(100vh - ${HEADER_H}px)"><iframe id="f" src="/sequence/" style="position:absolute;inset:0;border:0;width:100%;height:100%"></iframe></div></body>`);
      return;
    }
    if (p === "/cc.mjs") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(CC); return; }
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

async function run({ view, w, h, coarse, label }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: coarse, isMobile: false });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/host.html`);
  const fh = await page.waitForSelector("#f");
  const frame = await fh.contentFrame();
  await frame.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-grid-help-clearance");
  await pacedWait(page, 800);
  const label_ = view === "grid" ? "Grid" : view === "split" ? "Split" : "Gantt";
  await frame.evaluate(l => { [...document.querySelectorAll(".hdr-view button")].find(b => b.textContent.trim() === l).click(); }, label_);
  await pacedWait(page, 800);
  /* NEW-1 (empty band): the page now FILLS the window and each scroll surface pads its END by --fab-dock, so the
     contract is "scrolled to the end, the button covers no row" — measured at the end of every scroller. */
  await frame.evaluate(() => { for (const g of document.querySelectorAll("[data-grid-scroll], [data-gantt-scroll]")) g.scrollTop = g.scrollHeight; });
  await pacedWait(page, 400);
  const m = await page.evaluate(async ({ coarsePx }) => {
    const { cornerClearanceFromBottom } = await import("/cc.mjs");
    const size = coarsePx ? 44 : 30, right = 14;
    const bottom = cornerClearanceFromBottom({ right, width: size, base: 14 });
    const vw = innerWidth, vh = innerHeight;
    const fab = { l: vw - right - size, r: vw - right, t: vh - bottom - size, b: vh - bottom };
    const f = document.getElementById("f"), fr = f.getBoundingClientRect(), d = f.contentDocument;
    const hit = [];
    const targets = [...d.querySelectorAll('[data-task-row] > [data-col-key], [data-task-row], .drow > div')];
    // the rect a person can actually SEE: the element's box clipped by every scrolling/clipping ancestor
    // (virtualised rows are rendered below the fold but clipped — they are not under the button)
    const visible = (el) => {
      let r = el.getBoundingClientRect(); let l = r.left, t = r.top, rr = r.right, b = r.bottom;
      for (let a = el.parentElement; a && a !== d.documentElement; a = a.parentElement) {
        const o = d.defaultView.getComputedStyle(a).overflow; if (o === "visible") continue;
        const ar = a.getBoundingClientRect(); l = Math.max(l, ar.left); t = Math.max(t, ar.top); rr = Math.min(rr, ar.right); b = Math.min(b, ar.bottom);
      }
      return { left: l, top: t, right: rr, bottom: b };
    };
    for (const el of targets) {
      const r = visible(el);
      if (r.right <= r.left || r.bottom <= r.top) continue;
      const L = r.left + fr.left, R = r.right + fr.left, T = r.top + fr.top, B = r.bottom + fr.top;
      if (R > fab.l && L < fab.r && B > fab.t && T < fab.b) hit.push(el.getAttribute("data-col-key") || el.getAttribute("data-task-row") || "cell");
    }
    // anything else painted in the iframe under the button (Gantt bars, svg, canvas)
    const probe = [[fab.l + 2, fab.t + 2], [fab.r - 2, fab.t + 2], [fab.l + 2, fab.b - 2], [fab.r - 2, fab.b - 2], [(fab.l + fab.r) / 2, (fab.t + fab.b) / 2]];
    const under = probe.map(([x, y]) => { const e = d.elementFromPoint(x - fr.left, y - fr.top); return e && !e.hasAttribute("data-grid-scroll") && !e.hasAttribute("data-gantt-scroll") && e.tagName !== "HTML" && e.tagName !== "BODY" ? e.tagName + (e.className && e.className.baseVal === undefined ? "." + String(e.className).slice(0, 30) : "") : null; }).filter(Boolean);
    return { fab, bottom, hit: [...new Set(hit)].slice(0, 6), under: [...new Set(under)] };
  }, { coarsePx: coarse });
  await ctx.close();
  return m;
}

for (const coarse of [false, true]) for (const view of VIEWS) for (const h of HEIGHTS) for (const w of WIDTHS) {
  if (coarse && (w !== 960 && w !== 1280)) continue;     // coarse is a pointer type, not a width: sample, don't sweep
  const tag = `${coarse ? "coarse" : "fine"} ${view} ${w}×${h}`;
  const m = await run({ view, w, h, coarse });
  ok(`${tag} · Help button intersects no grid cell / row`, m.hit.length === 0, JSON.stringify(m.hit));
  ok(`${tag} · nothing painted by the page sits under the Help button`, m.under.length === 0, JSON.stringify(m.under));
}
// known-good arm: the pre-fix page (no .fab-dock strip) MUST be caught
pageBody = realBody.replace('html.in-iframe { --fab-dock: 48px; }', 'html.in-iframe { --fab-dock: 0px; }').replace('@media (pointer: coarse) { html.in-iframe { --fab-dock: 64px; } }', '');
const bad = await run({ view: "grid", w: 960, h: 450, coarse: false });
const armOk = bad.hit.length > 0;
console.log(`${armOk ? "PASS ✅" : "FAIL ❌"} — known-good arm: the page WITHOUT the reserved strip is caught (intersects ${JSON.stringify(bad.hit)})`);
await browser.close(); server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${armOk ? "" : " — RUN IS VOID (the known-bad arm was not caught)"}`);
process.exit(!armOk || failed.length ? 1 : 0);
