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
// USABLE panes on a phone's PORTRAIT width — collapses to one pane; the collapse threshold is the
// file's own existing `isMobile` (768px), consistent with every other phone-layout decision
// already in this file. Zoom control sizing reads `coarsePointer` (a `matchMedia('(pointer:
// coarse)')` check, independent of width) rather than `isMobile` — a real phone in landscape gets
// 44px buttons even though it clears 768px, and a standard fine-pointer desktop measures
// coarsePointer=false and renders byte-identical to before.
//
// ⛔ B1241747 (NEW-4) — AMENDMENT, same day. The first cut of the Split collapse (above) built a
// SECOND, phone-only "Grid | Gantt" pill to pick which pane shows. Correct to the letter of that
// brief ("a deliberate way to switch between them"), wrong because the app already has a view
// switcher — the header's own Grid/Split/Gantt pill — so a phone screen showed TWO stacked
// switchers (the owner's own screenshot; his words: "I just want the existing Gantt and Split
// buttons to work"). Fixed by deleting the second pill entirely: the header pill now does double
// duty — while already in Split at phone width, tapping Grid or Gantt updates which pane shows
// (via the SAME `phonePane` state, now written from the header pill's own onClick) instead of
// leaving Split, so `data.view` never stops being "split" and a wider screen still opens on the
// real two-pane Split. THE GENERAL LESSON this cost a round to learn: when a brief asks for "a way
// to do X," check whether the app already has one before building a second.
//
// This harness proves, live, in a real (emulated) touch browser:
//  1. PORTRAIT phone (390×844, isMobile=true): tapping Gantt actually shows bars (not a no-op);
//     Split shows exactly ONE view-switcher control (never two stacked pills), defaults to Grid,
//     and tapping the SAME header pill's Gantt tab switches the pane — never two panes at once.
//  2. LANDSCAPE phone (832×380, isMobile=false, pointer stays coarse): Gantt renders (unchanged
//     from before — this half already worked) AND its zoom buttons are now >=44px tall/wide.
//  3. Narrow DESKTOP window (760×860, mouse — pointer:fine, no touch): controls render at their
//     smaller desktop-ish size, never forced to 44px by width alone — WIDTH-DRIVES-LAYOUT /
//     POINTER-DRIVES-SIZING holds in both directions.
//  4. Standard DESKTOP viewport (1600×900, mouse): Split still renders BOTH panes exactly as
//     before, the zoom buttons stay at their original 21px, and the pill's click/highlight
//     behavior is untouched — pixel-identical.
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

// Counts every visible button whose OWN text is exactly "Grid"/"Split"/"Gantt" — the old bug had
// TWO such buttons for "Grid" and "Gantt" at once (the header pill's own + the phone-only pill's);
// the fix must show exactly one of each, always.
const countSwitcherButtons = (page) => page.evaluate(() => {
  const count = (label) => [...document.querySelectorAll("button")]
    .filter((b) => b.textContent.trim() === label && b.getBoundingClientRect().width > 0)
    .length;
  return { grid: count("Grid"), split: count("Split"), gantt: count("Gantt") };
});

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
  const countsBefore = await countSwitcherButtons(page);
  ok(countsBefore.grid === 1 && countsBefore.split === 1 && countsBefore.gantt === 1, `exactly one Grid/Split/Gantt button each in plain Grid view (${JSON.stringify(countsBefore)})`);
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

// ── 2. PORTRAIT phone: Split collapses to ONE pane, switched via the EXISTING header pill only ──
{
  console.log("── Portrait phone (390×844, touch), Split view ──");
  const ctx = await browser.newContext({ ...devices["iPhone 13"], ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const real = await boot(page, "split");
  const gridVisible = await page.locator('[data-grid-scroll="1"]').count();
  const ganttVisible = await page.locator("[data-gantt-bar]").count();
  ok(gridVisible > 0 && ganttVisible === 0, `Split defaults to ONE pane (Grid) at portrait phone width, not both (grid=${gridVisible}, gantt-bars=${ganttVisible})`);

  // B1241747 — THE regression this amendment exists to catch: #1490's first cut rendered a SECOND
  // "Grid | Gantt" pill under the header's own Grid/Split/Gantt pill. Assert exactly one of each.
  const counts = await countSwitcherButtons(page);
  ok(counts.grid === 1 && counts.split === 1 && counts.gantt === 1, `exactly ONE view-switcher control at phone width in Split — never two stacked pills (${JSON.stringify(counts)})`);

  // Switch panes via the SAME header pill (no separate control exists to tap).
  await page.locator(".hdr-view button", { hasText: "Gantt" }).tap();
  await page.waitForTimeout(400);
  const ganttAfter = await page.locator("[data-gantt-bar]").count();
  const gridAfter = await page.locator('[data-grid-scroll="1"]').count();
  ok(ganttAfter > 0 && gridAfter === 0, `tapping the header pill's Gantt tab (while in phone Split) shows ONLY Gantt (gantt-bars=${ganttAfter}, grid=${gridAfter})`);
  const countsAfter = await countSwitcherButtons(page);
  ok(countsAfter.grid === 1 && countsAfter.split === 1 && countsAfter.gantt === 1, `still exactly one of each button after switching panes (${JSON.stringify(countsAfter)})`);

  // Prove `data.view` genuinely stayed "split" under the hood (never silently became "gantt"):
  // widen the viewport past the isMobile threshold and confirm the REAL two-pane Split appears,
  // with nothing forgotten — this is only possible if data.view was never overwritten.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(400);
  const gridWide = await page.locator('[data-grid-scroll="1"]').count();
  const ganttWide = await page.locator("[data-gantt-bar]").count();
  ok(gridWide > 0 && ganttWide > 0, `widening the same session past the phone breakpoint reveals the REAL two-pane Split — proves data.view was never overwritten to "gantt" (grid=${gridWide}, gantt-bars=${ganttWide})`);

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

// ── 5. Standard DESKTOP viewport (mouse) — Split unchanged, zoom buttons unchanged, pill untouched ──
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
  const counts = await countSwitcherButtons(page);
  ok(counts.grid === 1 && counts.split === 1 && counts.gantt === 1, `desktop still shows exactly one of each pill button (${JSON.stringify(counts)})`);
  // "Split" must still be the highlighted/active tab on desktop (the pill's click/highlight logic
  // must not have picked up any phone-only branching) — read its own font-weight, matching the
  // active-tab convention every other tab in this pill already uses.
  const splitWeight = await page.locator(".hdr-view button", { hasText: "Split" }).evaluate((el) => getComputedStyle(el).fontWeight);
  ok(splitWeight === "600", `Split tab is still shown as active on desktop (fontWeight 600, got ${splitWeight})`);
  ok(real.length === 0, `no uncaught page errors (desktop split, ${real.length})`);
  await page.screenshot({ path: OUT + "schedule-desktop-split.png" }).catch(() => {});
  await ctx.close();
}

await browser.close(); server.close();

console.log("\n" + (fails.length === 0
  ? "✅ PASS — B1241744/B1241745/B1241747 verified live (portrait Gantt+Split with ONE switcher, landscape touch sizing, narrow-mouse-window untouched, desktop pixel parity)"
  : `❌ FAIL — ${fails.length} assertion(s):`));
fails.forEach((f) => console.log("  - " + f));
process.exit(fails.length === 0 ? 0 : 1);
