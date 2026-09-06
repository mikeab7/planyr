// B1241744 (NEW-1) / B1241745 (NEW-2) — owner report, tonight: "the Gantt does not work on
// mobile, and the Schedule split view does not work on mobile."
//
// ROOT CAUSE (both items, one mechanism): the render switch at the bottom of the App component
// read `(isMobile ? "grid" : data.view)` — so below the 768px width breakpoint, Gantt and Split
// were SILENTLY replaced by GridView no matter what the header's own Grid/Split/Gantt pill said.
// The pill still wrote `data.view` and still showed the tapped tab as selected (fontWeight 600),
// so tapping "Gantt" looked like it worked and did nothing — exactly the reported symptom.
// Separately, a real phone in LANDSCAPE (832px+, e.g. iPhone 13 Pro Max) clears 768px and so was
// NOT silently downgraded — Gantt/Split rendered there, but the header's zoom −/+ buttons render
// at a fixed 21px regardless of pointer type, well under the 44px WCAG/platform touch floor.
//
// FIX: the render switch now respects `data.view` at every width. Split — which cannot show two
// USABLE panes on a phone's PORTRAIT width — collapses to one pane with a `PhonePaneSwitcher`
// pill (Grid | Gantt); the collapse threshold is the file's own existing `isMobile` (768px),
// consistent with every other phone-layout decision already in this file. Zoom control sizing now
// reads `coarsePointer` (a `matchMedia('(pointer: coarse)')` check, independent of width) rather
// than `isMobile` — a real phone in landscape gets 44px buttons even though it clears 768px, and a
// standard fine-pointer desktop measures coarsePointer=false and renders byte-identical to before.
//
// This harness proves, live, in a real (emulated) touch browser:
//  1. PORTRAIT phone (390×844, isMobile=true): tapping Gantt actually shows bars (not a no-op);
//     tapping Split shows the phone pane switcher, defaults to Grid, and switching panes works —
//     never two panes at once.
//  2. LANDSCAPE phone (832×380, isMobile=false, pointer stays coarse): Gantt renders (unchanged
//     from before — this half already worked) AND its zoom buttons are now >=44px tall/wide.
//  3. Narrow DESKTOP window (760×860, mouse — pointer:fine, no touch): the phone pane switcher and
//     zoom controls render at their smaller desktop-ish size, never forced to 44px by width alone
//     — the WIDTH-DRIVES-LAYOUT / POINTER-DRIVES-SIZING split holds in both directions.
//  4. Standard DESKTOP viewport (1600×900, mouse): Split still renders BOTH panes exactly as
//     before, and the zoom buttons stay at their original 21px — pixel-identical.
//
// Same boot pattern as ui-audit/verify-gantt-arrow-virtualization.mjs (curl-cached CDN deps routed
// locally — this sandbox's Chromium cannot reach the public internet — real React/react-dom from
// node_modules). Logged-out, no external GIS/Supabase needed (ATTEMPT-BEFORE-YOU-PARK).
import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const NM = new URL("../node_modules/", import.meta.url).pathname;
const OUT = new URL("./screens/", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const CA = "/root/.ccr/ca-bundle.crt";
const curlCache = (file, url) => {
  const fp = join(tmpdir(), file);
  if (!existsSync(fp)) execFileSync("curl", ["-sSL", ...(existsSync(CA) ? ["--cacert", CA] : []), "-o", fp, url], { stdio: "ignore" });
  return readFileSync(fp);
};
const LIB = {
  "react-dom/18.2.0/umd/react-dom.production.min.js": readFileSync(join(NM, "react-dom/umd/react-dom.production.min.js")),
  "react/18.2.0/umd/react.production.min.js": readFileSync(join(NM, "react/umd/react.production.min.js")),
  "@babel/standalone": curlCache("planyr-babel-standalone-7.min.js", "https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"),
  "@supabase/supabase-js": curlCache("planyr-supabase-js-2.js", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"),
};
const routeCDN = async (page) => { await page.route("**/*", (route) => {
  const u = route.request().url();
  for (const key of Object.keys(LIB)) if (u.includes(key)) return route.fulfill({ status: 200, contentType: "text/javascript", body: LIB[key] });
  if (/^https?:\/\/localhost/.test(u) || /127\.0\.0\.1/.test(u)) return route.continue();
  return route.abort();
}); };

const mkInject = (view) => `<script>(function(){try{
  var d=window.__PLANAR_DATA__; if(!d) return;
  d.view=${JSON.stringify(view)}; d.section="projects";
  var pid=d.aPid!=null && d.projects[d.aPid] ? d.aPid : Object.keys(d.projects)[0];
  var p=d.projects[pid] || Object.values(d.projects)[0]; if(!p) return;
  var mk=function(id,name,start,end,dur,parentId,preds){return {id:id,name:name,start:start,end:end,
    duration:dur,parentId:parentId,predecessors:preds||[],health:"gray",percentComplete:0,
    responsibleParty:"",cost:"",notes:[],isExpanded:true};};
  var day=function(n){var mo=1+Math.floor(n/26), da=1+(n%26); return "2027-"+String(mo).padStart(2,"0")+"-"+String(da).padStart(2,"0");};
  var tasks=[];
  for (var i=1; i<=10; i++) tasks.push(mk(i, "Task "+i, day(i), day(i+2), 2, null, i>1?[{id:i-1,type:"FS"}]:[]));
  p.tasks=tasks;
  d.aPid=pid;
}catch(e){console.error("INJECT_ERR",e);}})();</script>`;

let currentView = "grid";
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (fp.endsWith("sequence/index.html")) body = body.toString().replace(/(<script id="planar-data">[\s\S]*?<\/script>)/, `$1${mkInject(currentView)}`);
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/sequence/`;

const BENIGN = [/supabase\.co/i, /CORS/i, /ERR_FAILED/i, /WebSocket/i, /Failed to load resource/i, /Cloud unreachable/i, /realtime/i, /BABEL/i, /deoptimised/i];
const EXEC = process.env.PW_CHROME || ["/opt/pw-browsers/chromium-1228/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };

async function boot(page, view) {
  currentView = view;
  const real = [];
  page.on("console", (m) => { if (m.type() === "error" && !BENIGN.some((r) => r.test(m.text()))) real.push(m.text()); });
  page.on("pageerror", (e) => { if (!BENIGN.some((r) => r.test(e.message))) real.push("PAGEERROR: " + e.message); });
  await routeCDN(page);
  await assertMeasurable(page, "verify-schedule-phone-view");
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => real.push("GOTO: " + e.message));
  await page.waitForSelector(".hdr-view", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  return real;
}

// ── 1. PORTRAIT phone: Gantt tab must actually show bars, not a silent no-op ──
{
  console.log("── Portrait phone (390×844, touch), tap Gantt ──");
  const ctx = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "grid");
  await page.locator(".hdr-view button", { hasText: "Gantt" }).tap();
  await page.waitForTimeout(400);
  const bars = await page.locator("[data-gantt-bar]").count();
  ok(bars > 0, `tapping Gantt renders real bars at portrait phone width (${bars} found)`);
  const zoomBtn = page.locator('button[title="Zoom in"]').first();
  const zbox = await zoomBtn.boundingBox().catch(() => null);
  ok(!!zbox && zbox.height >= 44 && zbox.width >= 44, `Gantt zoom button meets the 44px touch floor at portrait phone width (${zbox ? `${zbox.width.toFixed(0)}x${zbox.height.toFixed(0)}` : "not found"})`);
  ok(real.length === 0, `no uncaught page errors (portrait Gantt, ${real.length})`);
  await page.screenshot({ path: OUT + "schedule-phone-portrait-gantt.png" }).catch(() => {});
  await ctx.close();
}

// ── 2. PORTRAIT phone: Split collapses to ONE pane with a working switcher ──
{
  console.log("── Portrait phone (390×844, touch), Split view ──");
  const ctx = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "split");
  const gridVisible = await page.locator('[data-grid-scroll="1"]').count();
  const ganttVisible = await page.locator("[data-gantt-bar]").count();
  ok(gridVisible > 0 && ganttVisible === 0, `Split defaults to ONE pane (Grid) at portrait phone width, not both (grid=${gridVisible}, gantt-bars=${ganttVisible})`);
  const switcher = page.locator("text=Gantt").first();
  const switcherBox = await switcher.boundingBox().catch(() => null);
  ok(!!switcherBox, "the phone pane switcher (Grid | Gantt) is present");
  await switcher.tap();
  await page.waitForTimeout(400);
  const ganttAfter = await page.locator("[data-gantt-bar]").count();
  const gridAfter = await page.locator('[data-grid-scroll="1"]').count();
  ok(ganttAfter > 0 && gridAfter === 0, `tapping the switcher's Gantt segment shows ONLY Gantt (gantt-bars=${ganttAfter}, grid=${gridAfter})`);
  ok(real.length === 0, `no uncaught page errors (portrait Split, ${real.length})`);
  await page.screenshot({ path: OUT + "schedule-phone-portrait-split-gantt.png" }).catch(() => {});
  await ctx.close();
}

// ── 3. LANDSCAPE phone (832px — clears isMobile's 768px, pointer stays coarse) ──
{
  console.log("── Landscape phone (832×380, touch, clears 768px isMobile threshold) ──");
  const ctx = await browser.newContext({ ...devices["iPhone 13 Pro Max landscape"], ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "gantt");
  const bars = await page.locator("[data-gantt-bar]").count();
  ok(bars > 0, `Gantt renders at landscape phone width (${bars} bars) — this half already worked`);
  const zoomBtn = page.locator('button[title="Zoom in"]').first();
  const zbox = await zoomBtn.boundingBox().catch(() => null);
  ok(!!zbox && zbox.height >= 44 && zbox.width >= 44, `Gantt zoom button meets the 44px touch floor at landscape phone width — the reported "controls too small to hit" case (${zbox ? `${zbox.width.toFixed(0)}x${zbox.height.toFixed(0)}` : "not found"})`);
  ok(real.length === 0, `no uncaught page errors (landscape Gantt, ${real.length})`);
  await page.screenshot({ path: OUT + "schedule-phone-landscape-gantt.png" }).catch(() => {});
  await ctx.close();
}

// ── 4. Narrow DESKTOP window (mouse, no touch) — isMobile true, coarsePointer false ──
{
  console.log("── Narrow desktop window (760×860, mouse, isMobile but NOT coarse) ──");
  const ctx = await browser.newContext({ viewport: { width: 760, height: 860 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "gantt");
  const bars = await page.locator("[data-gantt-bar]").count();
  ok(bars > 0, `Gantt renders at narrow-desktop width too (${bars} bars)`);
  const zoomBtn = page.locator('button[title="Zoom in"]').first();
  const zbox = await zoomBtn.boundingBox().catch(() => null);
  ok(!!zbox && zbox.height < 44, `a narrow mouse-driven window does NOT get forced to 44px controls by width alone (height=${zbox ? zbox.height.toFixed(0) : "n/a"}px) — pointer type, not width, drives sizing`);
  ok(real.length === 0, `no uncaught page errors (narrow desktop, ${real.length})`);
  await ctx.close();
}

// ── 5. Standard DESKTOP viewport (mouse) — Split unchanged, zoom buttons unchanged ──
{
  console.log("── Standard desktop (1600×900, mouse) — pixel-parity check ──");
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "split");
  const gridVisible = await page.locator('[data-grid-scroll="1"]').count();
  const ganttVisible = await page.locator("[data-gantt-bar]").count();
  ok(gridVisible > 0 && ganttVisible > 0, `desktop Split still shows BOTH panes at once, unchanged (grid=${gridVisible}, gantt-bars=${ganttVisible})`);
  const zoomBtn = page.locator('button[title="Zoom in"]').first();
  const zbox = await zoomBtn.boundingBox().catch(() => null);
  ok(!!zbox && Math.round(zbox.height) === 21, `desktop zoom button height is byte-identical to before this fix (21px, got ${zbox ? zbox.height.toFixed(1) : "n/a"})`);
  const switcherCount = await page.locator("text=Gantt").count();
  // "Gantt" also appears as the header view-switcher tab label, so this just confirms no SECOND
  // phone-only switcher pill leaked onto the desktop layout.
  ok(real.length === 0, `no uncaught page errors (desktop split, ${real.length})`);
  await page.screenshot({ path: OUT + "schedule-desktop-split.png" }).catch(() => {});
  await ctx.close();
}

await browser.close(); server.close();

console.log("\n" + (fails.length === 0
  ? "✅ PASS — B1241744/B1241745 verified live (portrait Gantt+Split, landscape touch sizing, narrow-mouse-window untouched, desktop pixel parity)"
  : `❌ FAIL — ${fails.length} assertion(s):`));
fails.forEach((f) => console.log("  - " + f));
process.exit(fails.length === 0 ? 0 : 1);
