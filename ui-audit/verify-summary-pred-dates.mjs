// B443248 / B443249 / B443250 — drive the REAL Grid and read the dates off the screen.
//
// The owner report: Grand Port row "Mobilize" (0d) has two predecessors — 106 "ETJ Permit" and 108
// "CCID3 Approval" — and showed Start/Finish 08/10/26, which looked like the clock (it was roughly the
// day he made the edit). It was not the clock. 108 is a SUMMARY row whose children run to 2026-10-02,
// and cascadeDates resolved it as if it were a leaf (a parent carries `duration` from the rollup but
// leaves `durValue` at 0), collapsing it to a 0-day milestone on its own START — so the FS successor was
// scheduled off 2026-08-07, whose next working day is Monday 2026-08-10.
//
// The unit tests prove the engine. This proves the PAGE: the number a person actually reads in the Grid.
// Seeds the exact shape from his live data, renders the real sequence app, and asserts on real observables:
//   • the Mobilize row's Start cell reads 10/05/26 (not 08/10/26)
//   • the summary row 108 still reads its rolled-up finish 10/02/26
//   • the Predecessor cell VISIBLY marks 106 (the dateless one) and does not mark 108
//   • the drift banner names Mobilize, so an existing saved schedule self-corrects in the open
//   • (B463072) the SUMMARY row's Duration cell reads its ROLLED span, not the leftover typed value —
//     pre-fix this printed "0d" on a row visibly spanning 08/07/26 to 10/02/26
//
// Regression net: revert the `parentIds.has(t.id)` skip in cascadeDates and the Start cell reads 08/10/26.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const OUT = new URL("./screens/", import.meta.url).pathname;
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json" };

// The live Grand Port shape, reduced to the rows that matter. Dates are the STORED (wrong) ones, exactly
// as they sit in his saved document — so this also exercises the load-path recalculation, not just a
// fresh edit. 108 carries duration:40 / durValue:0, which is what a rolled-up parent really looks like.
const INJECT = `<script>(function(){try{
  var d=window.__PLANAR_DATA__; if(!d) return;
  d.view="grid"; d.section="projects";
  var pid=d.aPid!=null && d.projects[d.aPid] ? d.aPid : Object.keys(d.projects)[0];
  var p=d.projects[pid] || Object.values(d.projects)[0]; if(!p) return;
  var mk=function(o){return Object.assign({name:"",start:"",end:"",duration:0,durValue:0,durUnit:"d",
    predecessors:[],health:"gray",percentComplete:0,parentId:null,responsibleParty:"",cost:"",notes:[],
    isExpanded:true,meetingBound:false},o);};
  p.tasks=[
    mk({id:106,name:"ETJ Permit: Lift Station & Force Main"}),
    mk({id:107,name:"Submit Permit",parentId:106}),
    mk({id:108,name:"CCID3: Lift Station & Force Main Approval",start:"2026-08-07",end:"2026-10-02",duration:40,durValue:0}),
    mk({id:109,name:"Revise Force Main routing",start:"2026-08-07",end:"2026-08-13",duration:5,durValue:5,parentId:108}),
    mk({id:110,name:"CWA Approval",start:"2026-08-14",end:"2026-08-20",duration:5,durValue:5,parentId:108,predecessors:[{id:109,type:"FS",lag:0}]}),
    mk({id:111,name:"LONO Approvals",start:"2026-08-21",end:"2026-10-02",duration:30,durValue:30,parentId:108,predecessors:[{id:110,type:"FS",lag:0}]}),
    mk({id:228,name:"Mobilize",start:"2026-08-10",end:"2026-08-10",predecessors:[{id:106,type:"FS",lag:0},{id:108,type:"FS",lag:0}]})
  ];
  window.__PL_SCENARIO__={storedStart:"08/10/26", expectedStart:"10/05/26", expectedSummaryEnd:"10/02/26"};
}catch(e){console.error("INJECT_ERR",e);}})();</script>`;

// The browser has no egress here; without this the page renders an EMPTY body and every probe below
// would be measuring nothing. See ui-audit/lib/vendorCdn.mjs.
await ensureVendored();

const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (fp.endsWith("sequence/index.html")) {
      body = rewriteCdn(body.toString()).replace(/(<script id="planar-data">[\s\S]*?<\/script>)/, `$1${INJECT}`);
    }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;
console.log("serving", url);

const BENIGN = [/supabase\.co/i, /CORS policy/i, /ERR_FAILED/i, /WebSocket/i, /Failed to load resource/i, /Cloud unreachable/i, /realtime/i, /BABEL/i, /deoptimised/i];
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium", "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox","--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
/* ⛔ FOREGROUND-OR-VOID — a background tab cannot be measured: not its clock, and not its pixels. rAF is
   suspended there, so every geometry read agrees with every other and describes a view the app already
   left. One precondition, rAF liveness probe included; see ui-audit/lib/tabTiming.mjs. */
await assertMeasurable(page, "verify-summary-pred-dates");
const real = [];
page.on("console", m => { if (m.type()==="error" && !BENIGN.some(r=>r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", e => { if (!BENIGN.some(r=>r.test(e.message))) real.push("PAGEERROR: " + e.message); });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: "+e.message));
const rendered = await page.waitForSelector("[data-task-row]", { timeout: 20000 }).then(()=>true).catch(()=>false);
await page.waitForTimeout(1600);

const probe = await page.evaluate(() => {
  const norm = s => (s||"").replace(/\s+/g," ").trim();
  // The grid RENUMBERS ids for display (renumberTasks), so a row is addressed by the name it renders,
  // never by a stored id. Match on the NAME COLUMN — a naive "row containing 'Mobilize'" also matches the
  // predecessor's SUCCESSORS cell, and would then read that row's dates instead.
  const rows = [...document.querySelectorAll("[data-task-row]")];
  const rowFor = name => rows.find(r => new RegExp("^\\d+\\s*▾?\\s*" + name).test(norm(r.textContent))) || null;
  // No \b anchors: the grid paints cells with no separators, so the row text runs "Mobilize10/05/2610/05/26".
  const datesIn = row => row ? norm(row.textContent).match(/\d{2}\/\d{2}\/\d{2}/g) || [] : [];
  const mob = rowFor("Mobilize"), sum = rowFor("CCID3"), kid = rowFor("LONO");
  // B463072 — read the Duration CELL by column position rather than by regex over the row text: the row
  // renders its cells with no separators, so "10/02/2640d" would defeat a text match.
  const cellsOf = r => r ? [...r.children].map(c => norm(c.textContent)) : [];
  const durCell = r => { const c = cellsOf(r); const i = c.findIndex(x => /^\d{2}\/\d{2}\/\d{2}$/.test(x)); return i >= 0 ? c[i+2] : null; };
  const summaryDur = durCell(sum), childDur = durCell(kid);
  // A predecessor that drives NOTHING renders with a ⚠ before its id. Read the marked entries and the
  // unmarked ones separately: the point is that they look DIFFERENT, not merely that a ⚠ exists.
  const predEntries = mob ? [...mob.querySelectorAll("span")]
    // A predecessor ENTRY is an id span whose sibling renders "· <name>" — this excludes the row-number
    // cell and every other bare integer in the row.
    .filter(s => /^⚠?\s*\d+$/.test(norm(s.textContent)) && /·/.test(norm(s.parentElement ? s.parentElement.textContent : "")))
    .map(s => ({ marked: norm(s.textContent).startsWith("⚠"),
                 name: norm(s.parentElement ? s.parentElement.textContent : "").replace(/^⚠?\s*\d+\s*·\s*/, ""),
                 box: (r => ({ w: Math.round(r.width), h: Math.round(r.height) }))(s.getBoundingClientRect()) })) : [];
  return {
    scenario: window.__PL_SCENARIO__ || null,
    mobilizeText: mob ? norm(mob.textContent).slice(0, 90) : null,
    mobilizeDates: datesIn(mob), summaryDates: datesIn(sum),
    summaryDur, childDur,
    predEntries,
  };
});

await page.screenshot({ path: OUT + "summary-pred-dates.png" });

console.log("RENDERED:", rendered);
console.log("PROBE:", JSON.stringify(probe));
const mobStart = probe.mobilizeDates[0];
const marked = probe.predEntries.filter(e => e.marked);
const unmarked = probe.predEntries.filter(e => !e.marked);
const pass = rendered
  && mobStart === "10/05/26"                                   // the date a person reads, off the summary's REAL finish
  && !probe.mobilizeDates.includes("08/10/26")                 // and provably not the stored clock-looking one
  && probe.mobilizeDates[1] === "10/05/26"                     // 0d milestone: finish = start
  && probe.summaryDates.includes("10/02/26")                   // the summary keeps its rolled-up finish
  && marked.length === 1 && /^ETJ Permit/.test(marked[0].name) // exactly the dateless predecessor is marked…
  && marked[0].box.w > 0 && marked[0].box.h > 0                // …visibly, with real box area on screen
  && unmarked.length === 1 && /^CCID3/.test(unmarked[0].name)  // …and the satisfied one is left alone
  && probe.summaryDur === "40d"                                // B463072: the summary prints its ROLLED span…
  && probe.summaryDur !== "0d"                                 // …never the leftover typed value it still carries
  && probe.childDur === "30d"                                  // …and a LEAF still prints what was typed on it
  && real.length === 0;
console.log(pass
  ? "✅ PASS — Mobilize reads 10/05/26 (next working day after its summary predecessor's real finish); the dateless predecessor is visibly marked and the satisfied one is not; the summary's Duration cell reads 40d, not 0d"
  : "❌ FAIL");
// NOT asserted here: the B836 drift banner that NAMES this correction on an existing saved schedule. It
// fires on the CLOUD load path (recascadeWithDrift), which this sandbox cannot reach — the harness
// necessarily exercises the seed path, where "drift" against saved dates is meaningless by construction.
// The naming itself is pinned by test/schedulerEngine.test.js ("detectCascadeDrift NAMES the correction");
// the on-screen banner is the signed-in step logged in VERIFICATION.md.
console.log("REAL ERRORS (" + real.length + "):"); real.slice(0,20).forEach(e=>console.log("  - "+e));
await browser.close(); server.close();
process.exit(pass ? 0 : 1);
