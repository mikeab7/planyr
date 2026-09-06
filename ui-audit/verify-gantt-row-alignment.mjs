// B1241746 (NEW-3) — owner report, verbatim: "the row height for, in the schedule module, between
// tasks and the Gantt chart, it's not equal, and it should be equal so that it reads clean from
// left to right." Repro: open Split view — GridView (left) zooms its own subtree via the CSS
// `zoom` property (an ordinary Ctrl+scroll-while-hovering-the-grid interaction, `gridZoom` in
// public/sequence/index.html), which rescales GridView's rendered row height without touching the
// module-scope `ROW_H` GanttView (right) also reads. The two panes then disagree about how tall a
// row is, and the drift COMPOUNDS one row at a time down the list (row 20 is ~20x row 1's drift).
//
// FIX: GanttView now accepts a `rowZoom` prop; SplitView is its only caller that passes anything
// but the default 1, mirroring GridView's own live `gridZoom` onto the Gantt pane's scroll
// container. Both panes then scale by the SAME factor, which keeps every row's rendered top/height
// identical AND keeps the cross-pane scroll-sync numerically correct (scrollTop is copied 1:1
// between the two refs — only meaningful when both sides are scaled the same).
//
// This harness is RED-PROVEN: reverting the `rowZoom` prop/plumbing (see the fix's own comment in
// public/sequence/index.html) reproduces the "zoomed" scenario's failure — checked by hand this
// session, not asserted mechanically here (there is no clean single-line mutation to toggle).
//
// Same boot pattern as ui-audit/verify-gantt-arrow-virtualization.mjs (curl-cached CDN deps routed
// locally — this sandbox's Chromium cannot reach the public internet — real React/react-dom from
// node_modules). Logged-out, no external GIS/Supabase needed (ATTEMPT-BEFORE-YOU-PARK).
import { chromium } from "playwright";
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

// Fixture: Split view, a handful of chained tasks, and — the whole point — `gridZoom` pre-set to a
// realistic post-Ctrl-scroll value (never 1). A real desktop schedule with predecessor links, so
// the dependency-arrow check has something to land on.
const mkInject = (gridZoom) => `<script>(function(){try{
  var d=window.__PLANAR_DATA__; if(!d) return;
  d.view="split"; d.section="projects"; d.gridZoom=${JSON.stringify(gridZoom)};
  var pid=d.aPid!=null && d.projects[d.aPid] ? d.aPid : Object.keys(d.projects)[0];
  var p=d.projects[pid] || Object.values(d.projects)[0]; if(!p) return;
  var mk=function(id,name,start,end,dur,parentId,preds){return {id:id,name:name,start:start,end:end,
    duration:dur,parentId:parentId,predecessors:preds||[],health:"gray",percentComplete:0,
    responsibleParty:"",cost:"",notes:[],isExpanded:true};};
  var day=function(n){var mo=1+Math.floor(n/26), da=1+(n%26); return "2027-"+String(mo).padStart(2,"0")+"-"+String(da).padStart(2,"0");};
  var tasks=[];
  for (var i=1; i<=12; i++) tasks.push(mk(i, "Task "+i, day(i), day(i+2), 2, null, i>1?[{id:i-1,type:"FS"}]:[]));
  p.tasks=tasks;
  d.aPid=pid; window.__PL_TASK_COUNT__=tasks.length;
}catch(e){console.error("INJECT_ERR",e);}})();</script>`;

let currentGridZoom = 1;
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (fp.endsWith("sequence/index.html")) body = body.toString().replace(/(<script id="planar-data">[\s\S]*?<\/script>)/, `$1${mkInject(currentGridZoom)}`);
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

const runScenario = async (gridZoom) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await assertMeasurable(page, "verify-gantt-row-alignment");
  await routeCDN(page);
  const real = [];
  page.on("console", (m) => { if (m.type() === "error" && !BENIGN.some((r) => r.test(m.text()))) real.push(m.text()); });
  page.on("pageerror", (e) => { if (!BENIGN.some((r) => r.test(e.message))) real.push("PAGEERROR: " + e.message); });
  currentGridZoom = gridZoom;
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => real.push("GOTO: " + e.message));
  await page.waitForSelector("[data-gantt-bar]", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);

  // 1) Per-row alignment: for every task, the grid's row (left pane) and the Gantt's row (right
  // pane, the bar's own parent) must occupy the identical vertical band.
  const rows = await page.evaluate(() => {
    const seen = new Set();
    const out = [];
    document.querySelectorAll("[data-gantt-bar]").forEach((bar) => {
      const id = bar.getAttribute("data-gantt-bar");
      if (seen.has(id)) return; seen.add(id);
      const gridRow = document.querySelector(`[data-task-row="${id}"]`);
      if (!gridRow) return;
      const g = gridRow.getBoundingClientRect(), t = bar.parentElement.getBoundingClientRect();
      out.push({ id, gridTop: g.top, gridHeight: g.height, ganttTop: t.top, ganttHeight: t.height });
    });
    return out;
  });
  ok(rows.length >= 8, `at least 8 rows measured (gridZoom=${gridZoom}, got ${rows.length})`);
  let worstTop = 0, worstHeight = 0;
  for (const r of rows) {
    worstTop = Math.max(worstTop, Math.abs(r.gridTop - r.ganttTop));
    worstHeight = Math.max(worstHeight, Math.abs(r.gridHeight - r.ganttHeight));
  }
  ok(worstTop < 0.5, `every row's top matches within 0.5px (gridZoom=${gridZoom}, worst=${worstTop.toFixed(2)}px)`);
  ok(worstHeight < 0.5, `every row's height matches within 0.5px (gridZoom=${gridZoom}, worst=${worstHeight.toFixed(2)}px)`);

  // 2) Dependency arrows still land on a bar (real pixel measurement — the arrow SVG scales with
  // the same rowZoom, so its paths must still terminate inside a bar's bounding box, not drift).
  const arrowCheck = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll("svg")].filter((s) => getComputedStyle(s).pointerEvents === "none" && s.querySelector("path"));
    const svg = svgs[0];
    if (!svg) return { arrowCount: 0, orphanCount: 0 };
    const bars = [...document.querySelectorAll("[data-gantt-bar]")].map((b) => b.getBoundingClientRect());
    const paths = [...svg.querySelectorAll("path")].filter((p) => (p.getAttribute("stroke-dasharray") || "").trim() === "4 3");
    let orphanCount = 0;
    for (const p of paths) {
      const box = p.getBoundingClientRect();
      const cx1 = box.left, cy1 = box.top, cx2 = box.right, cy2 = box.bottom;
      const nearBar = (x, y) => bars.some((b) => x >= b.left - 6 && x <= b.right + 6 && y >= b.top - 6 && y <= b.bottom + 6);
      if (!(nearBar(cx1, cy1) || nearBar(cx1, cy2)) || !(nearBar(cx2, cy1) || nearBar(cx2, cy2))) orphanCount++;
    }
    return { arrowCount: paths.length, orphanCount };
  });
  ok(arrowCheck.arrowCount > 0, `at least one dependency arrow drawn (gridZoom=${gridZoom}, ${arrowCheck.arrowCount})`);
  ok(arrowCheck.orphanCount === 0, `every dependency arrow's endpoint box overlaps a bar (gridZoom=${gridZoom}, ${arrowCheck.orphanCount} orphan(s) of ${arrowCheck.arrowCount})`);

  // 3) GridView's own frozen header still sits directly above its body columns (untouched by this
  // fix, kept here as the standing regression net the ROW_H tripwire calls for).
  const headerAlign = await page.evaluate(() => {
    const grid = document.querySelector('[data-grid-scroll="1"]');
    const header = grid ? grid.closest("div")?.parentElement?.querySelector('[style*="sticky"]') : null;
    if (!header) return null;
    const firstRow = document.querySelector("[data-task-row]");
    if (!firstRow) return null;
    return { headerLeft: header.getBoundingClientRect().left, rowLeft: firstRow.getBoundingClientRect().left };
  });
  if (headerAlign) ok(Math.abs(headerAlign.headerLeft - headerAlign.rowLeft) < 0.5, `grid header left edge matches body left edge (gridZoom=${gridZoom})`);

  await page.screenshot({ path: OUT + `gantt-row-alignment-zoom${String(gridZoom).replace(".", "_")}.png` }).catch(() => {});
  ok(real.length === 0, `no uncaught page errors (gridZoom=${gridZoom}, ${real.length})`);
  if (real.length) real.slice(0, 8).forEach((e) => console.log("    - " + e));
  await page.close();
};

for (const gz of [1, 1.6]) {
  console.log(`── gridZoom = ${gz} ──`);
  await runScenario(gz);
}

await browser.close(); server.close();

console.log("\n" + (fails.length === 0
  ? "✅ PASS — B1241746 verified live (row alignment holds at gridZoom=1 and gridZoom=1.6, arrows land, header unaffected)"
  : `❌ FAIL — ${fails.length} assertion(s):`));
fails.forEach((f) => console.log("  - " + f));
process.exit(fails.length === 0 ? 0 : 1);
