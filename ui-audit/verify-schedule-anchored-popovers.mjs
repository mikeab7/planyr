/* NEW-1 / B2465520 (2026-10-28) — A POPOVER OPENED FROM A SCHEDULE CELL STAYS ATTACHED TO THAT CELL.
 *
 * Owner report (Schedule › Grid, a long schedule): click a row's traffic-light dot, scroll the wheel — the picker
 * stayed where it opened while the rows moved away under it (screenshot: a picker floating beside empty rows).
 * CAUSE: the rect was read ONCE in the click handler into a `position:fixed` portal. FIX: one shared hook,
 * `useAnchoredPopover` (public/sequence/index.html), re-reads the anchor every frame and closes (no commit) the
 * instant the anchor is no longer visible — out of the grid, under the sticky header, under a pinned column.
 *
 * THE REAL PAGE, driven by REAL input (page.mouse.wheel / clicks), embedded in a same-origin host iframe the way the
 * shell embeds it. Per surface: the popup's rect stays glued to its anchor's rect after a scroll (a vertical wheel,
 * a sideways scroll for header cells, a window resize); it is GONE — and nothing was committed — once the anchor
 * scrolls out of view, goes under the sticky header, or goes under a pinned column.
 *
 * GUARDS ON THE INSTRUMENT (FOREGROUND-OR-VOID, DRIVER-SCROLL-IS-NOT-APP-SCROLL, known-good arm):
 *  - assertMeasurable before measuring anything; geometry is read only after two real animation frames.
 *  - VACUITY: the grid really overflows both ways, and the popup really opened (a missing popup is a FAIL, never "ok").
 *  - KNOWN-BAD ARM: the SAME scenarios on the PRE-FIX page (commit 7beda29) MUST fail for the health, status and header-menu
 *    follow checks. The run is VOID if they do not.
 *
 * Run:  PW_CHROME=<chrome> node ui-audit/verify-schedule-anchored-popovers.mjs      (SEQ_PAGE=dist after `npm run build` for the compiled page)
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";
import { makeScenarios } from "./lib/anchoredPopoverScenarios.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
// SEQ_PAGE=dist runs the same scenarios against the page production actually serves (the Babel-precompiled build).
const fixedBody = await readFile(new URL(process.env.SEQ_PAGE === "dist" ? "../dist/sequence/index.html" : "../public/sequence/index.html", import.meta.url), "utf8");
let mainBody = null;
// The KNOWN-BAD page is pinned to the commit just BEFORE the fix (7beda29 = origin/main when B2465520 was cut), not to
// "origin/main": once the fix merges, main itself is correct and a moving ref would make the arm — and the whole run —
// void forever.
const PRE_FIX_REF = process.env.PRE_FIX_REF || "7beda29";
try { mainBody = execFileSync("git", ["show", `${PRE_FIX_REF}:public/sequence/index.html`], { maxBuffer: 1 << 28, encoding: "utf8" }); } catch {}
const HEADER_H = 96;
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

async function boot(w = 1400, h = 800, view = "Grid") {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/host.html`);
  const frame = await (await page.waitForSelector("#f")).contentFrame();
  await frame.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-schedule-anchored-popovers");
  await pacedWait(page, 800);
  if (view !== "Grid") { await frame.evaluate(l => { [...document.querySelectorAll(".hdr-view button")].find(b => b.textContent.trim() === l).click(); }, view); await pacedWait(page, 900); }
  return { ctx, page, frame };
}
const out = [];
const rec = (tag, name, pass, extra = "") => { out.push({ tag, name, pass: !!pass }); console.log(`${tag.startsWith("MAIN") ? (pass ? "ctrl ok" : "CONTROL (pre-fix page) fails, as it must") : pass ? "PASS ✅" : "FAIL ❌"} — [${tag}] ${name}${extra ? "  ::  " + extra : ""}`); };
const S = makeScenarios({ boot, rec, headerH: HEADER_H });

await S.runAll();

// ── known-bad arm ───────────────────────────────────────────────────────────────────────────────────────────────
let armOk = false;
if (mainBody) {
  const keep = out.length;
  pageBody = mainBody;
  await S.cellScenario("MAIN-health", { view: "Grid", anchorSel: "[data-health-dot]", open: S.openHealth, expectGap: 4, name: "Health dot" });
  await S.cellScenario("MAIN-status", { view: "Grid", anchorSel: '[data-col-key="status"] span[style*="cursor: pointer"]', open: S.openStatus, expectGap: 4, name: "Status" });
  await S.hdrMenuScenario("MAIN-hdr-menu");
  const bad = out.splice(keep);                                   // main's rows are the CONTROL, not part of the score
  const caught = (t) => bad.some(r => r.tag === t && /STAYS glued/.test(r.name) && !r.pass);
  const caughtHdr = bad.some(r => r.tag === "MAIN-hdr-menu" && /STAYS glued/.test(r.name) && !r.pass);
  armOk = caught("MAIN-health") && caught("MAIN-status") && caughtHdr;
  console.log(`${armOk ? "PASS ✅" : "FAIL ❌"} — known-bad arm: the pre-fix page (7beda29) is CAUGHT (failed on main — health: ${caught("MAIN-health")}, status: ${caught("MAIN-status")}, header menu: ${caughtHdr})`);
} else console.log("FAIL ❌ — known-bad arm unavailable (the pre-fix commit is not in this clone)");

await browser.close(); server.close();
const failed = out.filter(r => !r.pass);
console.log(`\n${out.length - failed.length}/${out.length} passed${armOk ? "" : " — RUN IS VOID (the known-bad arm was not caught)"}`);
process.exit(!armOk || failed.length ? 1 : 0);
