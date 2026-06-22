// B385 — dependency connectors must not draw phantom arrows to unscheduled (blank-date) tasks.
//
// Repro mirrors the Pappadoupolos report: a blank stub task has no bar/diamond (xOf("") is NaN),
// yet a dependency link still terminated at/from it, so the arrow landed in empty space ("purple
// pointing at nothing"). The PDF export already skipped blank-date endpoints; the live GanttView
// depLines was the one draw path missing that guard.
//
// Seeds the active project with a controlled scenario, renders the real sequence app, and asserts:
//   • exactly ONE dependency connector line is drawn (the only link whose BOTH ends are dated)
//   • NO svg <path> 'd' contains "NaN" (the phantom signature)
//   • each blank-date row shows an explicit, visible "Unscheduled" tag (legible, not a silent void)
//
// Regression net: run with the depLines guard reverted and depCount is 3 with 2 NaN paths + 0 chips.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../public/", import.meta.url).pathname;
const OUT = new URL("./screens/", import.meta.url).pathname;
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json" };

// Replace the active project's tasks with a controlled blank-vs-dated dependency scenario.
//   A (dated, no preds)              — a real bar
//   B (BLANK, no preds)              — unscheduled stub; stays blank (no pred to cascade from)
//   C (dated, pred = B/blank)        — link FROM a blank endpoint  → phantom pre-fix
//   D (dated, pred = A/dated)        — the legitimate control link  → MUST still render
//   B2 (BLANK, pred = B/blank)       — link with BOTH endpoints blank → phantom pre-fix
// A blank task with a *dated* predecessor would get dates filled by cascadeDates, so the blank
// stubs here deliberately have no pred (B) or a blank pred (B2) — matching the real report.
const INJECT = `<script>(function(){try{
  var d=window.__PLANAR_DATA__; if(!d) return;
  d.view="split"; d.section="projects";   // Split = grid + gantt, exactly as in the report
  var pid=d.aPid!=null && d.projects[d.aPid] ? d.aPid : Object.keys(d.projects)[0];
  var p=d.projects[pid] || Object.values(d.projects)[0]; if(!p) return;
  var mk=function(id,name,start,end,dur,preds){return {id:id,name:name,start:start,end:end,duration:dur,
    predecessors:preds||[],health:"gray",percentComplete:0,parentId:null,responsibleParty:"",cost:"",notes:[],isExpanded:true};};
  p.tasks=[
    mk(9001,"A Permit (dated)","2027-01-04","2027-01-15",10,[]),
    mk(9002,"B Wastewater Design (BLANK)","","",0,[]),
    mk(9003,"C Civil (dated, pred=blank B)","2027-02-01","2027-02-12",10,[{id:9002,type:"FS",lag:0}]),
    mk(9004,"D Review (dated, pred=A)","2027-01-18","2027-01-29",10,[{id:9001,type:"FS",lag:0}]),
    mk(9005,"B2 Begin Design (BLANK, pred=blank B)","","",0,[{id:9002,type:"FS",lag:0}])
  ];
  window.__PL_SCENARIO__={blankCount:2, expectedDepLines:1};
}catch(e){console.error("INJECT_ERR",e);}})();</script>`;

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (fp.endsWith("sequence/index.html")) {
      body = body.toString().replace(/(<script id="planar-data">[\s\S]*?<\/script>)/, `$1${INJECT}`);
    }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;
console.log("serving", url);

const BENIGN = [/supabase\.co/i, /CORS policy/i, /ERR_FAILED/i, /WebSocket/i, /Failed to load resource/i, /Cloud unreachable/i, /realtime/i, /BABEL/i, /deoptimised/i];
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1228/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox","--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const real = [];
page.on("console", m => { if (m.type()==="error" && !BENIGN.some(r=>r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", e => { if (!BENIGN.some(r=>r.test(e.message))) real.push("PAGEERROR: " + e.message); });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: "+e.message));
const rendered = await page.waitForSelector("[data-task-row]", { timeout: 20000 }).then(()=>true).catch(()=>false);
await page.waitForTimeout(1400);

const probe = await page.evaluate(() => {
  const norm = s => (s||"").replace(/\s+/g," ").trim();
  // Dependency CONNECTOR lines carry stroke-dasharray "4 3" (the arrowheads are filled triangles).
  const depLines = [...document.querySelectorAll("svg path")].filter(p => norm(p.getAttribute("stroke-dasharray")) === "4 3");
  const depCount = depLines.length;
  // Any svg <path> whose geometry contains NaN is a phantom drawn to a no-geometry endpoint.
  const nanPaths = [...document.querySelectorAll("svg path")].map(p => p.getAttribute("d")||"").filter(d => /NaN/i.test(d));
  // The explicit "Unscheduled" tag on each blank-date Gantt row.
  const chips = [...document.querySelectorAll("span")].filter(s => norm(s.textContent) === "Unscheduled");
  const chipBoxes = chips.map(c => { const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  const chipsVisible = chipBoxes.length > 0 && chipBoxes.every(b => b.w > 0 && b.h > 0);
  return {
    scenario: window.__PL_SCENARIO__ || null,
    depCount, nanPaths, chipCount: chips.length, chipBoxes, chipsVisible,
  };
});

await page.screenshot({ path: OUT + "unscheduled-deps.png" });

console.log("RENDERED:", rendered);
console.log("PROBE:", JSON.stringify(probe));
const pass = rendered
  && probe.depCount === 1                 // only the one fully-dated link (A→D) draws
  && probe.nanPaths.length === 0          // no phantom arrows into empty space
  && probe.chipCount >= 2                 // both blank rows tagged "Unscheduled"
  && probe.chipsVisible                   // and the tags are actually visible
  && real.length === 0;
console.log(pass
  ? "✅ PASS — no phantom connectors to blank-date tasks; valid links intact; blank rows tagged Unscheduled"
  : "❌ FAIL");
console.log("REAL ERRORS (" + real.length + "):"); real.slice(0,20).forEach(e=>console.log("  - "+e));
await browser.close(); server.close();
process.exit(pass ? 0 : 1);
