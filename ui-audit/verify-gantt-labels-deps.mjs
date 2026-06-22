// B393/B394/B395 — Gantt label alignment + uniform-ink/weight hierarchy + orthogonal
// dependency connectors. Verifies all three (they share one label/render pass):
//   B393 — Left/Center/Right name alignment, uniform near-black ink, weight hierarchy,
//          never-on-the-fill auto-fit (summary caption ALWAYS above the span — the
//          reported "Utilities/Electric Transmission overlap their span" bug).
//   B394 — buildGanttSVG (the PDF/print path) now emits in-chart names, same helper +
//          alignment + ink + weights as on-screen; uniform black (no B210 depth-navy).
//   B395/B396 — dependency links are CURVED béziers (owner preference, reverting B395's
//          orthogonal elbow) and BOUND to each bar's vertical center, so they no longer
//          float at the row mid-line (the real defect).
//
// The babel-scope helpers (placeGanttLabel/depElbow/ganttNameWeight/buildGanttSVG) are
// reachable as globals in the standalone app, so the pure geometry is unit-tested directly
// AND the live on-screen DOM + the generated print SVG are probed.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../public/", import.meta.url).pathname;
const OUT = new URL("./screens/", import.meta.url).pathname;
const MIME = { ".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".json":"application/json" };

// A summary tree + milestone + an FS chain + a BACKWARD link (T7 pinned before its pred ends).
const INJECT = `<script>(function(){try{
  var d=window.__PLANAR_DATA__; if(!d) return;
  var params=new URLSearchParams(location.search); var align=params.get("align")||"right";
  d.view="gantt"; d.section="projects";
  var pid=d.aPid!=null && d.projects[d.aPid] ? d.aPid : Object.keys(d.projects)[0];
  var p=d.projects[pid] || Object.values(d.projects)[0]; if(!p) return;
  p.labelAlign=align;                                    // per-project view setting (B393)
  var mk=function(id,name,start,end,dur,parentId,level,preds,extra){return Object.assign({id:id,name:name,
    start:start,end:end,duration:dur,parentId:parentId,level:level,predecessors:preds||[],
    health:"gray",percentComplete:0,responsibleParty:"",cost:"",notes:[],isExpanded:true,pinnedStart:true},extra||{});};
  p.tasks=[
    mk(7001,"Utilities",                "2027-01-04","2027-02-12",30, null,0,[]),
    mk(7002,"Electric Transmission",    "2027-01-04","2027-01-22",15, 7001,1,[]),
    mk(7003,"Submit TIA",               "2027-01-04","2027-01-08", 5, 7002,2,[]),
    mk(7004,"TIA Review #1",            "2027-01-11","2027-01-22",10, 7002,2,[{id:7003,type:"FS",lag:0}]),
    mk(7005,"Civil TIA Revisions",      "2027-01-25","2027-02-05",10, 7001,1,[{id:7004,type:"FS",lag:0}]),
    mk(7006,"Substantial Completion",   "2027-02-10","2027-02-10", 0, 7001,1,[{id:7005,type:"FS",lag:0}]),
    mk(7007,"Early Coordination",       "2027-01-18","2027-01-21", 3, 7001,1,[{id:7005,type:"FS",lag:0}])  // BACKWARD: starts before its pred (7005) ends
  ];
  d.aPid=pid; window.__PL_PID__=pid; window.__PL_ALIGN__=align;
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

const BENIGN = [/supabase\.co/i, /CORS/i, /ERR_FAILED/i, /WebSocket/i, /Failed to load resource/i, /Cloud unreachable/i, /realtime/i, /BABEL/i, /deoptimised/i];
const EXEC = process.env.PW_CHROME || ["/opt/pw-browsers/chromium-1228/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };
// Parse a dependency connector path: it must be a CURVE (cubic bézier, contains "C"), and
// we pull its start (M) and end points to check they're bound to the bars. (B396)
const seg = d => {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const nan = nums.some(n => !Number.isFinite(n)) || /NaN/.test(d);
  const start = [nums[0], nums[1]];
  const end = [nums[nums.length - 2], nums[nums.length - 1]];
  return { curved: /C/.test(d), start, end, nan };
};

async function pass(align) {
  console.log(`\n── align="${align}" ──────────────────────────────`);
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  const real = [];
  page.on("console", m => { if (m.type() === "error" && !BENIGN.some(r => r.test(m.text()))) real.push(m.text()); });
  page.on("pageerror", e => { if (!BENIGN.some(r => r.test(e.message))) real.push("PAGEERROR: " + e.message); });
  await page.goto(base + (align === "right" ? "" : `?align=${align}`), { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: " + e.message));
  await page.waitForSelector("[data-gantt-name]", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const probe = await page.evaluate((align) => {
    const norm = s => (s || "").replace(/\s+/g, " ").trim();
    const names = [...document.querySelectorAll("[data-gantt-name]")].map(el => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      const row = el.closest("div[style*='position: absolute']"); // the row band
      const rr = row ? row.getBoundingClientRect() : null;
      return { text: norm(el.textContent), color: cs.color, weight: +cs.fontWeight,
        mode: el.getAttribute("data-gantt-mode"),
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        rowTop: rr ? Math.round(rr.top) : null, rowH: rr ? Math.round(rr.height) : null };
    });
    // Dependency connector lines (dashed "4 3"); arrowheads are filled, no dash.
    const deps = [...document.querySelectorAll("svg path")]
      .filter(p => norm(p.getAttribute("stroke-dasharray")) === "4 3")
      .map(p => p.getAttribute("d") || "");

    // ---- direct pure-helper unit tests (globals reachable in standalone) ----
    const W = (depth, kind, bold) => ganttNameWeight(depth, kind, bold);
    const P = a => placeGanttLabel(a);
    const geomR = { kind:"leaf", align:"right", bx:100, bw:60, rowTop:0, barMidY:18, barTopY:14, labelW:50, chartL:0, chartR:1000 };
    const helper = {
      wSummaryRamp: [W(0,"summary"), W(1,"summary"), W(2,"summary")],
      wLeaf: W(2,"leaf"), wMile: W(0,"milestone"), wBold: W(2,"leaf",true),
      sumAlways: ["left","center","right"].map(a => P({kind:"summary",align:a,bx:50,bw:400,rowTop:0,barMidY:10,barTopY:8,labelW:80,chartL:0,chartR:1000}).mode),
      sumAnchors: { left:P({kind:"summary",align:"left",bx:50,bw:400,rowTop:0,barMidY:10,barTopY:8,labelW:80,chartL:0,chartR:1000}).anchor,
                    center:P({kind:"summary",align:"center",bx:50,bw:400,rowTop:0,barMidY:10,barTopY:8,labelW:80,chartL:0,chartR:1000}).anchor,
                    right:P({kind:"summary",align:"right",bx:50,bw:400,rowTop:0,barMidY:10,barTopY:8,labelW:80,chartL:0,chartR:1000}).anchor },
      leafRightAfter: P(geomR).mode,
      leafRightFlip: P({...geomR, bx:980, bw:15}).mode,            // bar jammed at right clip → not "after"
      leafCenterPlate: P({...geomR, align:"center", labelW:20}).mode,   // fits → plate
      leafCenterOverflow: P({...geomR, align:"center", labelW:200}).mode, // wider than bar → above
      mileLeft: P({kind:"milestone",align:"left",bx:200,bw:0,rowTop:0,barMidY:18,barTopY:8,labelW:40,chartL:0,chartR:1000}).mode,
      mileRight: P({kind:"milestone",align:"right",bx:200,bw:0,rowTop:0,barMidY:18,barTopY:8,labelW:40,chartL:0,chartR:1000}).mode,
      mileCenter: P({kind:"milestone",align:"center",bx:200,bw:0,rowTop:0,barMidY:18,barTopY:8,labelW:40,chartL:0,chartR:1000}).mode,
    };

    // ---- B394: call buildGanttSVG directly (the print path) ----
    const proj = window.__PLANAR_DATA__.projects[window.__PL_PID__];
    const svgOn  = buildGanttSVG([proj], 900, "landscape", { barNames:true,  labelAlign:align });
    const svgOff = buildGanttSVG([proj], 900, "landscape", { barNames:false, labelAlign:align });
    const textTags = (svgOn.match(/<text[^>]*>/g) || []);
    const textFills = textTags.map(t => (t.match(/fill="([^"]+)"/) || [])[1]);
    const NAVY = ["#2B3340","#46506A","#6E7790","#8A93A8"];
    const pdf = {
      hasInk: (svgOn.match(/<text[^>]*fill="#1a1a1a"/g) || []).length,
      navyText: textFills.filter(f => NAVY.includes(f)).length,         // navy on TEXT must be 0
      hasUtilities: svgOn.includes("Utilities"),
      hasMilestone: svgOn.includes("Substantial Completion"),
      namesOnDrop: (svgOn.match(/<text/g)||[]).length - (svgOff.match(/<text/g)||[]).length, // names disappear when off
      depPaths: (svgOn.match(/<path class="dep" d="([^"]+)"/g) || []).map(m => (m.match(/d="([^"]+)"/)||[])[1]),
      svgLen: svgOn.length,
    };
    return { names, deps, helper, pdf, rowH: ROW_H };
  }, align);

  await page.screenshot({ path: OUT + `gantt-labels-${align}.png` });

  // ---- assertions ----
  // Pure helpers
  const h = probe.helper;
  ok(h.wSummaryRamp[0] > h.wSummaryRamp[1] && h.wSummaryRamp[1] >= h.wSummaryRamp[2] && h.wSummaryRamp[0] >= 800,
     `weight ramp: summary depth0 boldest (${h.wSummaryRamp.join(">")})`);
  ok(h.wLeaf < h.wSummaryRamp[0] && h.wLeaf <= 500, `leaf weight regular (${h.wLeaf}) < summary`);
  ok(h.wBold >= 700, `explicit bold lifts weight (${h.wBold})`);
  ok(h.sumAlways.every(m => m === "above"), `summary caption ALWAYS above (modes ${h.sumAlways.join(",")})`);
  ok(h.sumAnchors.left === "start" && h.sumAnchors.center === "middle" && h.sumAnchors.right === "end",
     `summary align anchors L=start/C=middle/R=end (${JSON.stringify(h.sumAnchors)})`);
  ok(h.leafRightAfter === "after", `leaf Right default = after the bar (${h.leafRightAfter})`);
  ok(h.leafRightFlip !== "after", `leaf at right clip flips/lifts (not "after": ${h.leafRightFlip})`);
  ok(h.leafCenterPlate === "plate", `leaf Center (fits) = plate (${h.leafCenterPlate})`);
  ok(h.leafCenterOverflow === "above", `leaf Center (too wide) = caption above (${h.leafCenterOverflow})`);
  ok(h.mileLeft === "before" && h.mileRight === "after" && h.mileCenter === "above",
     `milestone L=before/R=after/C=above (${h.mileLeft}/${h.mileRight}/${h.mileCenter})`);

  // On-screen uniform ink + weight + summary-above
  ok(probe.names.length >= 6, `rendered ${probe.names.length} in-chart names`);
  ok(probe.names.every(n => n.color === "rgb(26, 26, 26)"), `every name is uniform near-black ink (#1a1a1a)`);
  const util = probe.names.find(n => n.text === "Utilities");
  const leaf = probe.names.find(n => n.text === "Submit TIA");
  ok(util && util.mode === "above", `top summary "Utilities" caption mode = above (was the overlap bug)`);
  // caption sits in the UPPER part of its row band (clear of the lower bar/span area)
  ok(util && util.rowTop != null && util.bottom <= util.rowTop + util.rowH * 0.7,
     `"Utilities" caption stays above the bar band (bottom ${util?.bottom} ≤ rowTop+0.7·H)`);
  ok(util && leaf && util.weight > leaf.weight, `summary "Utilities" (${util?.weight}) bolder than leaf "Submit TIA" (${leaf?.weight})`);

  // On-screen deps: CURVED (owner preference) AND bound to the bar centers (the real fix, B396)
  const segs = probe.deps.map(seg);
  const inBand = y => { const off = ((y % probe.rowH) + probe.rowH) % probe.rowH; return off > probe.rowH * 0.52; };
  ok(probe.deps.length === 4, `4 dependency connectors drawn (got ${probe.deps.length})`);
  ok(segs.every(s => s.curved), `every connector is a curve (cubic bézier), not an elbow`);
  ok(segs.every(s => !s.nan), `no NaN in any on-screen connector path`);
  ok(segs.every(s => inBand(s.start[1]) && inBand(s.end[1])),
     `every connector endpoint binds to the bar band (below the row mid-line) — not floating`);

  // B394 PDF/print path
  ok(probe.pdf.hasInk >= 6, `print SVG emits in-chart names in #1a1a1a (${probe.pdf.hasInk})`);
  ok(probe.pdf.navyText === 0, `print SVG has NO navy on name TEXT (${probe.pdf.navyText})`);
  ok(probe.pdf.hasUtilities && probe.pdf.hasMilestone, `print SVG includes summary + milestone names`);
  ok(probe.pdf.namesOnDrop >= 6, `print "Bar names" off drops the in-chart names (Δ${probe.pdf.namesOnDrop})`);
  const psegs = probe.pdf.depPaths.map(seg);
  ok(psegs.length > 0 && psegs.every(s => s.curved && !s.nan), `print connectors are curves, no NaN (${psegs.length})`);

  ok(real.length === 0, `no uncaught page errors (${real.length})`);
  if (real.length) real.slice(0, 8).forEach(e => console.log("    - " + e));
  await page.close();
}

await pass("right");
await pass("center");
await pass("left");

await browser.close(); server.close();
console.log("\n" + (fails.length === 0 ? "✅ PASS — B393/B394/B395 all verified" : `❌ FAIL — ${fails.length} assertion(s):`));
fails.forEach(f => console.log("  - " + f));
process.exit(fails.length === 0 ? 0 : 1);
