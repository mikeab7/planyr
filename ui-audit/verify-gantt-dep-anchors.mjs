// B629 — Dependency-arrow directional anchors + low-zoom label de-collision (Scheduler / Gantt).
//
// NEW-1 (re-report of the B395→B396 anchor thread): dependency connectors must leave a bar's
//   TOP/BOTTOM edge by travel direction (down-links leave the underside, ≈4–6 o'clock; up-links
//   the top) and ENTER the target's top/bottom edge near its start — NEVER 9 o'clock, where the
//   start-date label sits — so an arrowhead never overprints a date label. Multiple links out of
//   one bar FAN across the arc instead of bundling on one pixel.
// NEW-2: at low (≈33%) zoom no task/summary/milestone label may touch a bar (its own or a
//   neighbor's) or another label; the summary caption must clear its own bracket ("Utilities").
//
// The routing is now ONE shared pure function (depAnchors) used by BOTH the on-screen GanttView
// and the print buildGanttSVG, so this drives the pure helper directly AND measures real DOM
// bounding boxes at a compressed zoom, plus checks the print SVG.
//
// Hermetic: the sequence app pulls React/ReactDOM/Babel from CDNs, which the sandbox network
// resets — so we route those URLs to local copies (react/react-dom from node_modules; Babel
// cached via curl through the agent proxy) and never touch the live network.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../public/", import.meta.url).pathname;
const NM = new URL("../node_modules/", import.meta.url).pathname;
const OUT = new URL("./screens/", import.meta.url).pathname;
const MIME = { ".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".json":"application/json" };

// ── Vendor the CDN libs locally (hermetic) ───────────────────────────────────────────────
const CA = "/root/.ccr/ca-bundle.crt";
const curlCache = (file, url) => {
  const fp = join(tmpdir(), file);
  if (!existsSync(fp)) {
    try { execFileSync("curl", ["-sSL", ...(existsSync(CA) ? ["--cacert", CA] : []), "-o", fp, url], { stdio: "ignore" }); }
    catch (e) { console.error(`Could not fetch ${url}:`, e.message); process.exit(2); }
  }
  return readFileSync(fp);
};
// Substring → local body. Order matters only for disambiguation; each request matches one.
const LIB = {
  "react-dom/18.2.0/umd/react-dom.production.min.js": readFileSync(join(NM, "react-dom/umd/react-dom.production.min.js")),
  "react/18.2.0/umd/react.production.min.js": readFileSync(join(NM, "react/umd/react.production.min.js")),
  "@babel/standalone": curlCache("planyr-babel-standalone-7.min.js", "https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"),
  "@supabase/supabase-js": curlCache("planyr-supabase-js-2.js", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"),
};

// ── Injected dataset (Pappadoupolos-like slice) ──────────────────────────────────────────
//  • 7002 "Submit LOI…" is WIDE with THREE FS successors (7003/7004/7005) → down-fan + entry
//    clearance of the successors' start-date labels.
//  • 7006 (milestone) → 7010 is an UP link (predecessor sits BELOW its successor in row order).
//  • start-date bar-labels ON (settings.barLabels.left="start") so the 9-o'clock exclusion is real.
const INJECT = `<script>(function(){try{
  var d=window.__PLANAR_DATA__; if(!d) return;
  d.view="gantt"; d.section="projects";
  d.settings=Object.assign({}, d.settings, {barLabels:{left:"start", right:"end", year:false}, rowHeight:24, holidays:{}});
  var pid=(d.aPid!=null && d.projects && d.projects[d.aPid]) ? d.aPid : (d.projects?Object.keys(d.projects)[0]:null);
  if(pid==null){ pid="pp"; d.projects={pp:{id:"pp",name:"Pappadoupolos",labelAlign:"right",tasks:[]}}; }
  var p=d.projects[pid]; p.labelAlign="right";
  var mk=function(id,name,start,end,dur,parentId,level,preds){return {id:id,name:name,start:start,end:end,
    duration:dur,parentId:parentId,level:level,predecessors:preds||[],health:"gray",percentComplete:0,
    responsibleParty:"",cost:"",notes:[],isExpanded:true,pinnedStart:true};};
  p.tasks=[
    mk(7001,"Utilities",                             "2027-01-04","2027-03-20",55, null,0,[]),
    mk(7002,"Submit LOI, Negotiate, & Execute PSA",  "2027-01-04","2027-02-12",30, 7001,1,[]),
    mk(7010,"Board Ratification",                    "2027-01-06","2027-01-09", 3, 7001,1,[{id:7006,type:"FS",lag:0}]),  // UP link
    mk(7003,"Negotiate PSA A",                       "2027-02-15","2027-02-19", 5, 7001,1,[{id:7002,type:"FS",lag:0}]),
    mk(7004,"Negotiate PSA B",                       "2027-02-22","2027-02-26", 5, 7001,1,[{id:7002,type:"FS",lag:0}]),
    mk(7005,"Negotiate PSA C",                       "2027-03-01","2027-03-05", 5, 7001,1,[{id:7002,type:"FS",lag:0}]),
    mk(7006,"TCEQ issues draft permit",              "2027-03-10","2027-03-10", 0, 7001,1,[{id:7005,type:"FS",lag:0}])
  ];
  d.aPid=pid; window.__PL_PID__=pid;
}catch(e){console.error("INJECT_ERR",e);}})();</script>`;

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (fp.endsWith("sequence/index.html"))
      body = body.toString().replace(/(<script id="planar-data">[\s\S]*?<\/script>)/, `$1${INJECT}`);
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/sequence/`;

const EXEC = process.env.PW_CHROME || ["/opt/pw-browsers/chromium-1228/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };
const overlap = (a, b, pad = 0) => a.left - pad < b.right && a.right + pad > b.left && a.top - pad < b.bottom && a.bottom + pad > b.top;

const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
// Route the CDN libs to local copies; the app needs nothing else off-network.
await page.route("**/*", route => {
  const u = route.request().url();
  for (const key of Object.keys(LIB)) if (u.includes(key)) return route.fulfill({ status: 200, contentType: "text/javascript", body: LIB[key] });
  if (u.startsWith(base) || u.startsWith(`http://localhost:${server.address().port}`)) return route.continue();
  return route.abort();   // supabase-js / tabler css / fonts — not needed
});
const perr = [];
page.on("pageerror", e => perr.push("PAGEERR: " + e.message));
page.on("console", m => { if (m.type() === "error" && /INJECT_ERR/.test(m.text())) perr.push(m.text()); });

await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => perr.push("GOTO " + e.message));
await page.waitForSelector("[data-gantt-name]", { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(1200);

const probe = await page.evaluate(() => {
  const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; };
  const names = [...document.querySelectorAll("[data-gantt-name]")].map(el => ({ id: el.getAttribute("data-gantt-name"), text: el.textContent, mode: el.getAttribute("data-gantt-mode"), ...rect(el) }));
  const bars  = [...document.querySelectorAll("[data-gantt-bar]")].map(el => ({ id: el.getAttribute("data-gantt-bar"), kind: el.getAttribute("data-gantt-kind") || "leaf", ...rect(el) }));
  // Date bar-labels: plain spans reading "M/D" (not name labels).
  const dateLabels = [...document.querySelectorAll("span")].filter(el => !el.hasAttribute("data-gantt-name") && /^\d{1,2}\/\d{1,2}$/.test((el.textContent || "").trim())).map(el => ({ text: el.textContent.trim(), ...rect(el) }));
  // Arrowheads = filled (color) svg paths with no dash; connectors = dashed strokes.
  const paths = [...document.querySelectorAll("svg path")];
  const arrowheads = paths.filter(el => /^#/.test(el.getAttribute("fill") || "") && !el.getAttribute("stroke-dasharray")).map(rect);
  const connectors = paths.filter(el => (el.getAttribute("stroke-dasharray") || "").replace(/\s+/g, " ").trim() === "4 3").map(el => el.getAttribute("d") || "");

  // ROW_H for the band check.
  const rowH = (typeof ROW_H !== "undefined") ? ROW_H : 24;

  // ── Pure-helper unit tests (globals reachable in standalone) ──
  const src = { startX: 100, endX: 200, topY: 10, botY: 16, rowTop: 0 };
  const tgtDown = { startX: 300, endX: 400, topY: 34, botY: 40, rowTop: 24 };
  const tgtUp   = { startX: 300, endX: 400, topY: -14, botY: -8, rowTop: -24 };
  const dFS = depAnchors({ type: "FS", src, tgt: tgtDown });
  const uFS = depAnchors({ type: "FS", src, tgt: tgtUp });
  const fan = [0, 1, 2].map(i => depAnchors({ type: "FS", src, tgt: tgtDown, fanIndex: i, fanCount: 3 }).x1);
  const pt = { startX: 100, endX: 100, topY: 10, botY: 16, rowTop: 0 };   // zero-width source (milestone)
  const ptFan = [0, 1, 2].map(i => depAnchors({ type: "FS", src: pt, tgt: tgtDown, fanIndex: i, fanCount: 3 }).x1);
  const excl = depAnchors({ type: "FS", src, tgt: tgtDown, tgtLabelRightX: 305 });   // label right edge past the corner
  const ARROW_HW = (typeof ARROW_REACH !== "undefined") ? ARROW_REACH : 7;
  const helper = {
    downExitBottom: dFS.y1 === src.botY, downEntryTop: dFS.y2 === tgtDown.topY, downFlag: dFS.down === true,
    downEntryX: dFS.x2, downStartX: tgtDown.startX,
    upExitTop: uFS.y1 === src.topY, upEntryBottom: uFS.y2 === tgtUp.botY, upFlag: uFS.down === false,
    fanDistinct: new Set(fan.map(v => v.toFixed(2))).size === 3, fan,
    ptFanDistinct: new Set(ptFan.map(v => v.toFixed(2))).size === 3,
    exclClear: excl.x2 - ARROW_HW >= 305,
  };

  // ── Print path ──
  const proj = window.__PLANAR_DATA__.projects[window.__PL_PID__];
  const svg = buildGanttSVG([proj], 900, "landscape", { barNames: true, barLabels: { left: "start", right: "end", year: false }, labelAlign: "right" });
  const depPaths = (svg.match(/<path class="dep" d="([^"]+)"/g) || []).map(m => (m.match(/d="([^"]+)"/) || [])[1]);
  const startPt = d => { const n = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number); return `${n[0]},${n[1]}`; };
  const bySrcPt = {}; depPaths.forEach(d => { const s = startPt(d); bySrcPt[s] = (bySrcPt[s] || 0) + 1; });
  const pdf = {
    count: depPaths.length,
    curvedNoNaN: depPaths.length > 0 && depPaths.every(d => /C/.test(d) && !/NaN/.test(d)),
    // fanning: the 3 links out of the LOI bar must NOT share one start point.
    distinctStarts: new Set(depPaths.map(startPt)).size,
    maxSameStart: Math.max(0, ...Object.values(bySrcPt)),
  };

  // Multi-project exhibit regression: an arrow inside the 2nd project must be anchored by its
  // GLOBAL row index, so its y lands in the 2nd project's band — not near the chart top (the
  // -base local-index bug). projA has 3 dep-free tasks; projB's only link is task→task inside it.
  const mk2 = (id, name, s, e, d, preds) => ({ id, name, start: s, end: e, duration: d, parentId: null, level: 0, predecessors: preds || [], health: "gray", percentComplete: 0, responsibleParty: "", cost: "", notes: [] });
  const pA = { id: "A", name: "A", labelAlign: "right", tasks: [mk2(1, "a1", "2027-01-04", "2027-01-08", 4), mk2(2, "a2", "2027-01-11", "2027-01-15", 4), mk2(3, "a3", "2027-01-18", "2027-01-22", 4)] };
  const pB = { id: "B", name: "B", labelAlign: "right", tasks: [mk2(11, "b1", "2027-02-01", "2027-02-05", 4), mk2(12, "b2", "2027-02-08", "2027-02-12", 4, [{ id: 11, type: "FS", lag: 0 }])] };
  const svg2 = buildGanttSVG([pA, pB], 900, "landscape", { barNames: false, showArrows: true });
  const dep2 = (svg2.match(/<path class="dep" d="([^"]+)"/g) || []).map(m => (m.match(/d="([^"]+)"/) || [])[1]);
  const ys2 = dep2.flatMap(d => (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number).filter((_, i) => i % 2 === 1));
  const multiProj = { count: dep2.length, minY: ys2.length ? Math.min(...ys2) : 0 };  // projB (rows 3-4) → y≈85+; the local-index bug would put it ≤~55 near the top

  return { names, bars, dateLabels, arrowheads, connectors, rowH, helper, pdf, multiProj };
}).catch(e => ({ evalErr: String(e) }));

await page.screenshot({ path: OUT + "gantt-dep-anchors.png" });

if (probe.evalErr) { console.log("EVAL ERROR:", probe.evalErr); fails.push(probe.evalErr); }
else {
  const h = probe.helper;
  console.log("\n── depAnchors pure helper ──");
  ok(h.downExitBottom && h.downEntryTop && h.downFlag, `down-link exits BOTTOM edge, enters TOP edge (down=${h.downFlag})`);
  ok(h.upExitTop && h.upEntryBottom && h.upFlag, `up-link exits TOP edge, enters BOTTOM edge (up detected=${h.upFlag})`);
  ok(h.downEntryX <= h.downStartX + 0.6, `entry x sits at the target START corner, not 9 o'clock (${h.downEntryX})`);
  ok(h.fanDistinct, `three links out of one bar FAN to distinct exit x (${h.fan.map(v=>v.toFixed(1)).join(", ")})`);
  ok(h.ptFanDistinct, `three links out of a zero-width source (milestone) also fan to distinct exit x`);
  ok(h.exclClear, `entry is nudged clear of a start-date label exclusion zone`);

  console.log("\n── on-screen DOM (≈33% zoom) ──");
  console.log(`    names=${probe.names.length} bars=${probe.bars.length} dateLabels=${probe.dateLabels.length} arrowheads=${probe.arrowheads.length} connectors=${probe.connectors.length} rowH=${probe.rowH}`);
  ok(probe.names.length >= 6, `rendered ${probe.names.length} in-chart names`);
  ok(probe.arrowheads.length >= 4 && probe.connectors.length >= 4, `dependency connectors + arrowheads drawn (${probe.connectors.length}/${probe.arrowheads.length})`);
  ok(probe.dateLabels.length >= 4, `start/end date labels present as exclusion zones (${probe.dateLabels.length})`);

  // NEW-1: no arrowhead touches any date label.
  let ahHits = 0;
  probe.arrowheads.forEach(a => probe.dateLabels.forEach(dl => { if (overlap(a, dl)) ahHits++; }));
  ok(ahHits === 0, `NEW-1: no arrowhead overprints a date label (${ahHits} collisions)`);

  // NEW-1: connectors are curved, no NaN, and endpoints fan (multi-out source has distinct exits).
  const cnan = probe.connectors.some(d => /NaN/.test(d));
  const ccurved = probe.connectors.every(d => /C/.test(d));
  ok(ccurved && !cnan, `every connector is a curve with no NaN`);
  const startXs = probe.connectors.map(d => { const n = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number); return Math.round(n[0]); });
  const startYs = probe.connectors.map(d => { const n = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number); return Math.round(n[1]); });
  // Group by exit-y (same source row); a group with ≥2 members must have distinct exit x (fanned).
  const byY = {}; startXs.forEach((x, i) => { const y = startYs[i]; (byY[y] = byY[y] || []).push(x); });
  const fannedGroups = Object.values(byY).filter(g => g.length >= 2);
  const allFanned = fannedGroups.every(g => new Set(g).size === g.length);
  ok(fannedGroups.length >= 1 && allFanned, `multi-out bars FAN their exits (groups: ${JSON.stringify(byY)})`);

  // NEW-2: zero label↔bar overlaps (cross-glyph — a label may sit beside its own bar but never on
  // another row's bar). Summary caption vs its own bracket checked separately below.
  let nbHits = 0, nbEx = [];
  probe.names.forEach(n => probe.bars.forEach(b => { if (b.id !== n.id && overlap(n, b)) { nbHits++; if (nbEx.length < 5) nbEx.push(`${n.text}↔bar#${b.id}`); } }));
  ok(nbHits === 0, `NEW-2: no label overlaps another row's bar (${nbHits} — ${nbEx.join(", ")})`);

  // NEW-2: zero label↔label overlaps.
  let nnHits = 0, nnEx = [];
  for (let i = 0; i < probe.names.length; i++) for (let j = i + 1; j < probe.names.length; j++)
    if (overlap(probe.names[i], probe.names[j])) { nnHits++; if (nnEx.length < 5) nnEx.push(`${probe.names[i].text}↔${probe.names[j].text}`); }
  ok(nnHits === 0, `NEW-2: no label overlaps another label (${nnHits} — ${nnEx.join(", ")})`);

  // NEW-2: the "Utilities" summary caption clears its OWN bracket (name bottom ≤ bracket top).
  const util = probe.names.find(n => n.text === "Utilities");
  const utilBar = probe.bars.find(b => b.id === (util && util.id) && b.kind === "summary");
  ok(util && utilBar && util.bottom <= utilBar.top + 0.5,
     `NEW-2: "Utilities" caption clears its bracket (name.bottom ${util?.bottom?.toFixed(1)} ≤ bracket.top ${utilBar?.top?.toFixed(1)})`);

  // NEW-2: every name box stays within its own row band (the mechanism that makes cross-row
  // collisions impossible). Allow a small AA fudge.
  const bandOverflow = probe.names.filter(n => n.h > probe.rowH + 3).length;
  ok(bandOverflow === 0, `no name is taller than a row band (${bandOverflow})`);

  console.log("\n── print path (buildGanttSVG) ──");
  ok(probe.pdf.count >= 4, `print emits the dependency connectors (${probe.pdf.count})`);
  ok(probe.pdf.curvedNoNaN, `print connectors curved, no NaN`);
  ok(probe.pdf.maxSameStart === 1, `print exits FAN — no two links share one start point (max same=${probe.pdf.maxSameStart})`);
  ok(probe.multiProj.count >= 1 && probe.multiProj.minY > 70,
     `multi-project exhibit: 2nd project's arrow anchors to its GLOBAL row band (minY ${probe.multiProj.minY.toFixed(1)} > 70; local-index bug → ≤~55)`);
}

ok(perr.length === 0, `no page/inject errors (${perr.length})`);
perr.slice(0, 6).forEach(e => console.log("    - " + e));

await page.close();
await browser.close(); server.close();
console.log("\n" + (fails.length === 0 ? "✅ PASS — B629 dep-anchor + label de-collision verified" : `❌ FAIL — ${fails.length} assertion(s):`));
fails.forEach(f => console.log("  - " + f));
process.exit(fails.length === 0 ? 0 : 1);
