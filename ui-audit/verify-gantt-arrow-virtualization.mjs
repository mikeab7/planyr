// B1113712 (NEW-1) / B1113713 (NEW-2) — owner report: "a bunch of arrows pointing to nothing" on
// the Pappadoupolos schedule. Dependency arrows used to be drawn from a fully-computed `depLines`
// array while the BARS were windowed to `tasks.slice(startIdx, endIdx)` — a link whose target row
// fell outside the current scroll window (or inside a collapsed parent's hidden subtree) still
// rendered a full arrowhead, landing in an empty row with no bar under it.
//
// This is a logged-out, no-external-GIS UI check (ATTEMPT-BEFORE-YOU-PARK) — a synthetic schedule
// is injected before React mounts, exactly like ui-audit/verify-gantt-labels-deps.mjs does, so no
// Supabase auth or live GIS is needed. Live-drives the REAL app (not a copy) and screenshots the
// Gantt scrolled to a MIDDLE position with a collapsed group in view, per the report's own
// verification bar: "a screenshot of the top of the chart proves nothing."
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

// A Pappadoupolos-shaped fixture: 42 tasks total, chained FS links end to end (so several spans
// the scroll window's edge), plus one collapsed summary ("Detention & Mass Grading") hiding 4
// descendants, one of which is depended on by the LAST task ("Construction") — the exact reported
// shape. ROW_H is left at the app's own default (24px) — the fixture doesn't need the owner's
// custom row-height setting to reproduce the mechanism.
const INJECT = `<script>(function(){try{
  var d=window.__PLANAR_DATA__; if(!d) return;
  d.view="gantt"; d.section="projects";
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
  d.aPid=pid; window.__PL_PID__=pid;
}catch(e){console.error("INJECT_ERR",e);}})();</script>`;

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (fp.endsWith("sequence/index.html")) body = body.toString().replace(/(<script id="planar-data">[\s\S]*?<\/script>)/, `$1${INJECT}`);
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

const page = await browser.newPage({ viewport: { width: 1400, height: 500 }, deviceScaleFactor: 2 }); // short viewport forces a small window vs. 42 rows
await assertMeasurable(page, "verify-gantt-arrow-virtualization");
await routeCDN(page);
const real = [];
page.on("console", (m) => { if (m.type() === "error" && !BENIGN.some((r) => r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", (e) => { if (!BENIGN.some((r) => r.test(e.message))) real.push("PAGEERROR: " + e.message); });
await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => real.push("GOTO: " + e.message));
await page.waitForSelector("[data-gantt-bar]", { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(600);

// Scroll to a MIDDLE position (not the top) so both the virtualization window (NEW-1) and the
// collapsed group (NEW-2, further down the list) are exercised together — the report's own bar.
const rowH = await page.evaluate(() => window.ROW_H || 24);
await page.evaluate(() => {
  const scroller = document.querySelector('[data-gantt-bar]')?.closest('div[style*="overflow: auto"]')
    || [...document.querySelectorAll("div")].find((d) => getComputedStyle(d).overflow === "auto" && d.scrollHeight > d.clientHeight);
  if (scroller) scroller.scrollTop = 260; // mid-list: past the top few rows, well before the bottom
});
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "gantt-arrow-virtualization-midscroll.png" });

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
  return { barRowCount: barRows.size, barRows: [...barRows].sort((a, b) => a - b), arrowCount: arrows.length, arrows };
});

await page.screenshot({ path: OUT + "gantt-arrow-virtualization-midscroll-annotated.png" }).catch(() => {});

console.log(`rendered bar rows: ${probe.barRowCount} (${probe.barRows.slice(0, 6).join(",")}${probe.barRowCount > 6 ? "…" : ""})`);
console.log(`dependency arrows drawn: ${probe.arrowCount}`);
ok(probe.barRowCount > 0 && probe.barRowCount < 42, `bars are windowed (${probe.barRowCount} of 38 visible rows rendered, not all — proves virtualization is active in this fixture)`);
ok(probe.arrowCount > 0, `at least one dependency arrow is drawn (${probe.arrowCount})`);

// The invariant: every arrow endpoint's row-top must be a row that HAS a rendered bar. A tolerance
// of one row height covers sub-pixel glyph offsets (a leaf's topY sits a few px inside its row).
const rowOf = (y) => Math.round(y / rowH) * rowH;
const covered = (y) => probe.barRows.some((t) => Math.abs(t - rowOf(y)) <= rowH);
const orphans = probe.arrows.filter((a) => !a.nan && (!covered(a.y1) || !covered(a.y2)));
ok(orphans.length === 0, `every dependency arrow endpoint lands on a row with a rendered bar (${orphans.length} orphan(s) of ${probe.arrows.length})`);
if (orphans.length) console.log("  orphans:", JSON.stringify(orphans.slice(0, 5)));

ok(real.length === 0, `no uncaught page errors (${real.length})`);
if (real.length) real.slice(0, 8).forEach((e) => console.log("    - " + e));

await page.close();
await browser.close(); server.close();

console.log("\n" + (fails.length === 0 ? "✅ PASS — B1113712/B1113713 verified live (mid-scroll, collapsed group in view)" : `❌ FAIL — ${fails.length} assertion(s):`));
fails.forEach((f) => console.log("  - " + f));
process.exit(fails.length === 0 ? 0 : 1);
