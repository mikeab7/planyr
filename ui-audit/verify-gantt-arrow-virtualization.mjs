// B1113712 (NEW-1) / B1113713 (NEW-2) / AMENDMENT (2026-09-04, owner re-report "figure out why
// there are a bunch of arrows pointing to nothing... most orphan arrows are gone, at least one
// class survives") — owner report: dependency arrows in the Gantt terminating on rows with no
// rendered bar, seen live in Split view on the Pappadoupolos schedule.
//
// TWO INDEPENDENT MECHANISMS, both covered here:
//  (1) NEW-1/NEW-2 (already fixed): depLines' srcIdx/tgtIdx window-filtered against the SAME
//      [startIdx,endIdx) the bars slice use, and a link into a collapsed parent's hidden subtree
//      never reaches depLines at all.
//  (2) AMENDMENT (fixed this session): depLines' useMemo bakes ROW_H (a module-scope `let`, set
//      from an effect that runs AFTER the commit that reads it) into every x/y via glyphEdges, but
//      never listed ROW_H as a dependency — so on a project whose rowHeight differs from the
//      module's initial default, a re-render the memo doesn't otherwise recompute for (a plain
//      scroll) served STALE pixel geometry while the (unmemoized) bars re-rendered at the correct
//      row height. srcIdx/tgtIdx stay valid throughout, so (1)'s guard cannot see this class at
//      all — it needs its own coverage, hence the rowHeight:20 fixture and the settle-then-scroll
//      sequence below (mirrors the actual race: mount at the default, effect corrects ROW_H with
//      no render of its own, THEN something else — a scroll — triggers the render that exposes it).
//
// This is a logged-out, no-external-GIS UI check (ATTEMPT-BEFORE-YOU-PARK) — a synthetic schedule
// is injected before React mounts, exactly like ui-audit/verify-gantt-labels-deps.mjs does, so no
// Supabase auth or live GIS is needed. Live-drives the REAL app (not a copy), in BOTH view modes
// (Gantt, Split), at three scroll positions (top/mid/bottom) each — the report's own verification
// bar: "a screenshot of the top of the chart proves nothing," and Michael's report was specifically
// in Split view.
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

// A Pappadoupolos-shaped fixture: 33 flat tasks chained FS end-to-end (so several links span the
// scroll window's edge), one collapsed summary ("Detention & Mass Grading") hiding 4 descendants
// (one depended on by the LAST task, "Construction" — the exact reported shape), and — new this
// session — settings.rowHeight:20, differing from the module's own initial default (24), so the
// AMENDMENT's ROW_H-staleness race is exercised on every mount, not just the index-window class.
const mkInject = (viewMode) => `<script>(function(){try{
  var d=window.__PLANAR_DATA__; if(!d) return;
  d.view=${JSON.stringify(viewMode)}; d.section="projects";
  d.settings = d.settings || {}; d.settings.rowHeight = 20;
  var pid=d.aPid!=null && d.projects[d.aPid] ? d.aPid : Object.keys(d.projects)[0];
  var p=d.projects[pid] || Object.values(d.projects)[0]; if(!p) return;
  var mk=function(id,name,start,end,dur,parentId,preds,extra){return Object.assign({id:id,name:name,
    start:start,end:end,duration:dur,parentId:parentId,predecessors:preds||[],
    health:"gray",percentComplete:0,responsibleParty:"",cost:"",notes:[],isExpanded:true},extra||{});};
  var day=function(n){var mo=1+Math.floor(n/26), da=1+(n%26); return "2027-"+String(mo).padStart(2,"0")+"-"+String(da).padStart(2,"0");};
  var tasks=[];
  for (var i=1; i<=33; i++) tasks.push(mk(i, "Task "+i, day(i), day(i+2), 2, null, i>1?[{id:i-1,type:"FS"}]:[]));
  tasks.push(mk(900, "Detention & Mass Grading", day(70), day(80), 10, null, [], {isExpanded:false}));
  for (var j=0; j<4; j++) tasks.push(mk(901+j, "Hidden child "+j, day(70+j), day(71+j), 1, 900, j===0?[]:[{id:900+j,type:"FS"}]));
  tasks.push(mk(999, "Construction", day(85), day(90), 5, null, [{id:904,type:"FS"}]));   // depends on a HIDDEN descendant
  p.tasks=tasks;
  d.aPid=pid; window.__PL_PID__=pid; window.__PL_TASK_COUNT__=tasks.length;
}catch(e){console.error("INJECT_ERR",e);}})();</script>`;

let currentViewMode = "gantt"; // read at request time — set before each page.goto below
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (fp.endsWith("sequence/index.html")) body = body.toString().replace(/(<script id="planar-data">[\s\S]*?<\/script>)/, `$1${mkInject(currentViewMode)}`);
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

// Probe: read bar rows (row-top → present) + dependency-arrow endpoints from whichever Gantt
// instance is on screen (there is only one at a time even in Split view — the Grid pane draws no
// arrows of its own). `covered()` allows one row-height of tolerance for the small sub-row offset
// a leaf pill/milestone glyph has within its own row.
//
// rowH is derived EMPIRICALLY from the actually-painted bar spacing, not read from the live
// window.ROW_H — the two can legitimately differ for one specific instant (the very first paint,
// before ANY re-render has occurred, when bars and depLines are still both self-consistently
// rendered at whatever ROW_H was current AT MOUNT, even after the settings effect has since
// mutated the module variable to a new value with no render of its own). Comparing that
// self-consistent first paint against the live module value would report a false orphan even
// though bars and arrows agree with EACH OTHER — this probe cares only about that agreement.
const probeOrphans = async (page, fallbackRowH) => {
  const probe = await page.evaluate(() => {
    const barRows = new Set();
    document.querySelectorAll("[data-gantt-bar]").forEach((el) => {
      const rowEl = el.parentElement;
      const top = parseFloat((rowEl && rowEl.style && rowEl.style.top) || "");
      if (Number.isFinite(top)) barRows.add(Math.round(top));
    });
    const seg = (d) => {
      const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      return { y1: nums[1], y2: nums[nums.length - 1], nan: nums.some((n) => !Number.isFinite(n)) };
    };
    const arrows = [...document.querySelectorAll("svg path")]
      .filter((p) => (p.getAttribute("stroke-dasharray") || "").trim() === "4 3")
      .map((p) => seg(p.getAttribute("d") || ""));
    return { barRowCount: barRows.size, barRows: [...barRows].sort((a, b) => a - b), arrows };
  });
  let rowH = fallbackRowH;
  if (probe.barRows.length >= 2) {
    const diffs = probe.barRows.slice(1).map((t, i) => t - probe.barRows[i]).filter((d) => d > 0);
    if (diffs.length) rowH = Math.min(...diffs); // every row is ROW_H apart; consecutive-rendered rows give the tightest, truest reading
  }
  const rowOf = (y) => Math.round(y / rowH) * rowH;
  const covered = (y) => probe.barRows.some((t) => Math.abs(t - rowOf(y)) <= rowH);
  const orphans = probe.arrows.filter((a) => !a.nan && (!covered(a.y1) || !covered(a.y2)));
  return { barRowCount: probe.barRowCount, arrowCount: probe.arrows.length, orphanCount: orphans.length, orphans, rowH };
};

const runScenario = async (viewMode) => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 500 }, deviceScaleFactor: 2 });
  await assertMeasurable(page, "verify-gantt-arrow-virtualization");
  await routeCDN(page);
  const real = [];
  page.on("console", (m) => { if (m.type() === "error" && !BENIGN.some((r) => r.test(m.text()))) real.push(m.text()); });
  page.on("pageerror", (e) => { if (!BENIGN.some((r) => r.test(e.message))) real.push("PAGEERROR: " + e.message); });
  currentViewMode = viewMode; // read by the server's request handler above
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => real.push("GOTO: " + e.message));
  await page.waitForSelector("[data-gantt-bar]", { timeout: 20000 }).catch(() => {});
  // Settle BEFORE the first scroll — this is the actual race window: the settings effect (which
  // corrects the module-scope ROW_H from its 24-default to this fixture's 20) fires here, with no
  // render of its own. Only the scroll below is what exposes a memo that didn't list ROW_H.
  await page.waitForTimeout(500);

  const rowH = await page.evaluate(() => window.ROW_H || 24);
  const gridEl = () => page.locator('[data-grid-scroll="1"]');
  const hasGrid = viewMode === "split" && await gridEl().count() > 0;

  // Scroll fractions are computed against the REAL task rows only (task count * ROW_H), never the
  // DOM's full scrollHeight — the chart body pads well past the last task with ~100+ phantom rows
  // (`emptyPad`, so a short viewport can still overscroll), and a naive scrollHeight-relative
  // "bottom" lands entirely inside that empty pad, showing zero bars/arrows and testing nothing.
  const taskCount = await page.evaluate(() => window.__PL_TASK_COUNT__ || 38);
  const scrollTo = async (frac) => {
    await page.evaluate(({ f, rowH, taskCount, useGrid }) => {
      const contentBottom = taskCount * rowH; // bottom edge of the LAST real task row
      const setOn = (el) => {
        if (!el) return;
        const maxUseful = Math.max(0, contentBottom - el.clientHeight); // scrollTop that just fits the last row at the viewport's bottom edge
        el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, Math.round(maxUseful * f)));
      };
      // Drives the GRID pane in Split view — mirrors how a user actually scrolls it; the app's own
      // cross-pane sync (SplitView's `sync`) is what's supposed to keep the Gantt pane's internal
      // React state (and therefore its startIdx/endIdx) correctly following along.
      if (useGrid) setOn(document.querySelector('[data-grid-scroll="1"]'));
      else {
        const scroller = document.querySelector('[data-gantt-bar]')?.closest('div[style*="overflow: auto"]')
          || [...document.querySelectorAll("div")].find((d) => getComputedStyle(d).overflow === "auto" && d.scrollHeight > d.clientHeight);
        setOn(scroller);
      }
    }, { f: frac, rowH, taskCount, useGrid: hasGrid });
    await page.waitForTimeout(400);
  };

  const results = {};
  for (const [label, frac] of [["top", 0], ["mid", 0.5], ["bottom", 1]]) {
    await scrollTo(frac);
    const r = await probeOrphans(page, rowH);
    results[label] = r;
    console.log(`  [${viewMode} / ${label}] bars=${r.barRowCount} arrows=${r.arrowCount} orphans=${r.orphanCount}`);
    ok(r.arrowCount > 0, `[${viewMode}/${label}] at least one dependency arrow is drawn (${r.arrowCount})`);
    ok(r.orphanCount === 0, `[${viewMode}/${label}] every dependency arrow endpoint lands on a row with a rendered bar (${r.orphanCount} orphan(s) of ${r.arrowCount})`);
    if (r.orphanCount) console.log("    orphans:", JSON.stringify(r.orphans.slice(0, 5)));
  }
  await page.screenshot({ path: OUT + `gantt-arrow-virtualization-${viewMode}-bottom.png` }).catch(() => {});
  ok(real.length === 0, `[${viewMode}] no uncaught page errors (${real.length})`);
  if (real.length) real.slice(0, 8).forEach((e) => console.log("    - " + e));
  await page.close();
  return results;
};

console.log(`ROW_H fixture: rowHeight:20 (differs from the module's initial default of 24 — exercises the AMENDMENT's stale-memo race on every mount)\n`);
for (const mode of ["gantt", "split"]) {
  console.log(`── ${mode.toUpperCase()} VIEW ──`);
  await runScenario(mode);
}

await browser.close(); server.close();

console.log("\n" + (fails.length === 0
  ? "✅ PASS — B1113712/B1113713 + AMENDMENT verified live (top/mid/bottom, Gantt + Split, rowHeight≠default)"
  : `❌ FAIL — ${fails.length} assertion(s):`));
fails.forEach((f) => console.log("  - " + f));
process.exit(fails.length === 0 ? 0 : 1);
