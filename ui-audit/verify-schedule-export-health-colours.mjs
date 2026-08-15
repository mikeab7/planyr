// GUARD — measures, never reads the code. A prior session read buildGanttSVG's `HC[t.health]`
// line and reported (explicitly as a code-read, not a live measurement) that the export never
// shows automation-derived health. Live measurement here confirmed a real (but differently
// located) defect: buildPDFHtml's Status column and healthFilter read the raw stored `health`
// field instead of the computed display health (computeDisplayHealth for leaves, the rolled
// worst-of-children for a collapsed parent — #1073's rule engine never writes its answer back
// to `health`, it's display-only). Fixed by routing both through a shared `displayHealthOf`
// helper in buildPDFHtml, mirroring the grid Cell's own leaf/parent split exactly. This guard
// re-drives the real app and the real export on every run and DIFFS them — never re-reads source
// — so it cannot rot the way the original code-read claim did.
//
// Six scenarios, each with a KNOWN expected on-screen value (the known-good control arms —
// manualLeaf, noRuleLeaf — the harness's own verdict is checked against, per
// DRIVER-SCROLL-IS-NOT-APP-SCROLL §6):
//   - autoOverdueLeaf      — automatic, rule-matched red; raw stored health is still "gray"
//   - autoCompleteLeaf     — automatic, rule-matched green (100% complete); raw stored "gray"
//   - manualLeaf           — hand-set red (healthOverride) — screen and export MUST agree (control)
//   - noRuleLeaf           — automatic, no rule matches — screen and export MUST agree (control)
//   - autoOverdueMilestone — a duration-0 leaf; same automatic path as any other leaf
//   - groupHeader          — collapsed parent; screen rolls up children (red); the un-fixed
//     export read the parent's OWN raw field ("gray") with no rollup at all
//
// Mutation-proven: `git stash` the buildPDFHtml fix and re-run — the four automatic cases must
// go red while the two controls stay green (proves the guard is discriminating, not vacuous).
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json" };
const OUT = new URL("./screens/", import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

// Dates are computed RELATIVE to the page's own `new Date()` at load time (never a hardcoded
// calendar date), so the scenario stays valid regardless of when this runs.
const INJECT = `<script>(function(){try{
  var d=window.__PLANAR_DATA__; if(!d) return;
  d.view="grid"; d.section="projects";
  var pid=d.aPid!=null && d.projects[d.aPid] ? d.aPid : Object.keys(d.projects)[0];
  var p=d.projects[pid] || Object.values(d.projects)[0]; if(!p) return;
  var today=new Date(); var iso=function(n){var t=new Date(today); t.setDate(t.getDate()+n); return t.toISOString().slice(0,10);};
  var mk=function(o){return Object.assign({name:"",start:"",end:"",duration:1,durValue:1,durUnit:"d",
    predecessors:[],health:"gray",healthOverride:false,percentComplete:0,parentId:null,responsibleParty:"",
    cost:"",notes:[],isExpanded:true,meetingBound:false},o);};
  p.tasks=[
    mk({id:901,name:"Auto Overdue Leaf",start:iso(-30),end:iso(-10),duration:20,durValue:20,percentComplete:40,
        health:"gray",healthOverride:false}),
    mk({id:902,name:"Auto Complete Leaf",start:iso(-20),end:iso(-15),duration:5,durValue:5,percentComplete:100,
        health:"gray",healthOverride:false}),
    mk({id:903,name:"Manual Override Leaf",start:iso(-5),end:iso(5),duration:10,durValue:10,percentComplete:50,
        health:"red",healthOverride:true}),
    mk({id:904,name:"No Rule Match Leaf",start:iso(5),end:iso(15),duration:10,durValue:10,percentComplete:0,
        health:"gray",healthOverride:false}),
    mk({id:905,name:"Auto Overdue Milestone",start:iso(-10),end:iso(-10),duration:0,durValue:0,percentComplete:0,
        health:"gray",healthOverride:false}),
    mk({id:910,name:"Group Header Parent",start:iso(-20),end:iso(10),duration:30,durValue:30,percentComplete:0,
        health:"gray",healthOverride:false,isExpanded:false}),
    mk({id:911,name:"Group Header Child Red",start:iso(-20),end:iso(-15),duration:5,durValue:5,percentComplete:40,
        health:"red",healthOverride:true,parentId:910}),
    mk({id:912,name:"Group Header Child Green",start:iso(-10),end:iso(10),duration:20,durValue:20,percentComplete:100,
        health:"green",healthOverride:true,parentId:910}),
  ];
  d.settings = Object.assign({}, d.settings, { healthRules: [
    {id:"r-complete", type:"complete", color:"green"},
    {id:"r-overdue",  type:"finishPastDays", days:1, color:"red"},
    {id:"r-duesoon",  type:"finishWithinDays", days:3, color:"yellow"},
  ]});
}catch(e){console.error("INJECT_ERR",e);}})();</script>`;

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
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 2 });
await assertMeasurable(page, "verify-schedule-export-health-colours");
const real = [];
page.on("console", m => { if (m.type()==="error" && !BENIGN.some(r=>r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", e => { if (!BENIGN.some(r=>r.test(e.message))) real.push("PAGEERROR: " + e.message); });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: "+e.message));
const rendered = await page.waitForSelector("[data-task-row]", { timeout: 20000 }).then(()=>true).catch(()=>false);
await page.waitForTimeout(1500);

const TASKS = [
  { label: "autoOverdueLeaf",  name: "Auto Overdue Leaf",       expectAuto: "Needs Attn." },
  { label: "autoCompleteLeaf", name: "Auto Complete Leaf",      expectAuto: "Complete" },
  { label: "manualLeaf",       name: "Manual Override Leaf",    expectAuto: "Needs Attn." },
  { label: "noRuleLeaf",       name: "No Rule Match Leaf",      expectAuto: "Not Started" },
  { label: "autoOverdueMilestone", name: "Auto Overdue Milestone", expectAuto: "Needs Attn." },
  { label: "groupHeader",      name: "Group Header Parent",     expectAuto: "Needs Attn." },
];

// ── On-screen read: the StatusPicker's own text node, driven by dispHealth (computeDisplayHealth
// for leaves, rolledHealthMap for a collapsed parent) — exactly what a human reads in the grid.
// Looked up by NAME, not the id the fixture assigned: normalizeIds() renumbers every task on load
// (measured: my seeded 901–912 came back as 1–6), so a hardcoded id would silently match nothing.
const onScreen = await page.evaluate((names) => {
  const rows = [...document.querySelectorAll("[data-task-row]")];
  const out = {};
  for (const name of names) {
    const row = rows.find(r => (r.textContent || "").includes(name));
    const statusEl = row ? row.querySelector('[data-picker-cell^="status-"]') : null;
    out[name] = statusEl ? statusEl.textContent.trim() : null;
  }
  return out;
}, TASKS.map(t => t.name));
await page.screenshot({ path: OUT + "schedule-onscreen-grid.png", fullPage: false });

// ── Export read: drive the REAL openPrint() path — buildPDFHtml() called in-page, written into a
// popup exactly like the app's own "Save as PDF" button does. Never re-implement the renderer.
const popupPromise = page.waitForEvent("popup", { timeout: 20000 }).catch(() => null);
const opened = await page.evaluate(() => {
  if (typeof buildPDFHtml !== "function") return { ok: false, why: "buildPDFHtml not reachable in page scope" };
  const d = window.__PLANAR_DATA__;
  const pid = d.aPid != null ? String(d.aPid) : String(Object.keys(d.projects)[0]);
  const cfg = {
    exhibitLabel: "", projectTitle: "Health-colour diagnostic", preparedBy: "", preparedFor: "",
    docDate: "", orientation: "landscape", pageSize: "letter",
    margins: {top:"0.75", right:"0.75", bottom:"0.75", left:"0.75"},
    selProjects: [pid],
    columns: ["id","name","start","end","duration","health","percentComplete"],
    includeGantt: true, showToday: true, showArrows: true, barNames: true,
    labelAlign: "auto", healthFilter: "all", confidential: "",
    collapsedIds: [], detailLevel: "all", colWidths: {},
    timeUnit: null, zoomMul: 1, panFrac: 0,
  };
  const html = buildPDFHtml(cfg, d);
  const w = window.open("", "_blank", "width=1200,height=900");
  if (!w) return { ok: false, why: "popup blocked" };
  w.document.write(html); w.document.close();
  window.__EXPORT_HTML__ = html;
  return { ok: true, bytes: html.length };
});
const popup = await popupPromise;
if (popup) {
  await popup.waitForTimeout(400);
  await popup.screenshot({ path: OUT + "schedule-export-popup.png", fullPage: true }).catch(()=>{});
}
const emitted = await page.evaluate(() => window.__EXPORT_HTML__ || "");
console.log("EMITTED HTML:", emitted.length, "bytes | popup opened:", !!popup);

// Parse the export's own row for each task by NAME (never re-derive by regexing the whole doc),
// then pull the Status cell's dot color + label out of the exact markup buildPDFHtml emits:
//   <span class="c-health">…<span style="…background:#RRGGBB;…"></span>LABEL</span>
const rowFor = name => {
  const rows = emitted.split(/<tr\b/).filter(r => r.includes(name));
  return rows.length ? rows[0] : null;
};
const statusOf = rowHtml => {
  if (!rowHtml) return { label: null, color: null };
  const m = rowHtml.match(/<td class="c-health"[^>]*>([\s\S]*?)<\/td>/);
  if (!m) return { label: null, color: null };
  const cell = m[1];
  const color = (cell.match(/background:(#[0-9a-fA-F]{6})/) || [])[1] || null;
  const label = cell.replace(/<[^>]*>/g, "").trim();
  return { label, color };
};

const results = TASKS.map(t => {
  const exp = statusOf(rowFor(t.name));
  const screen = onScreen[t.name];
  return { ...t, screen, exportLabel: exp.label, exportColor: exp.color, agree: screen === exp.label };
});

console.log("\n=== SCREEN vs EXPORT, same data, same moment ===");
for (const r of results) {
  const tag = r.agree ? "  match " : "❌ DIFFER";
  console.log(`${tag}  ${r.name.padEnd(26)} screen="${r.screen}"  export="${r.exportLabel}" (${r.exportColor})`);
}

// Vacuity guard — every scenario must have actually been READ from both instruments (neither
// side null); a silent selector miss must not read as agreement (DRIVER-SCROLL §6).
const allFound = results.every(r => r.screen != null && r.exportLabel != null);

// The two control arms (manualLeaf, noRuleLeaf) MUST agree — if they don't, the harness itself is
// broken and the divergence findings below are not trustworthy (known-good arm, DRIVER-SCROLL §6).
const controls = results.filter(r => r.label === "manualLeaf" || r.label === "noRuleLeaf");
const controlsOk = controls.every(r => r.agree) && controls.length === 2;
const autoOnes = results.filter(r => ["autoOverdueLeaf","autoCompleteLeaf","autoOverdueMilestone","groupHeader"].includes(r.label));
const autoOk = autoOnes.every(r => r.agree) && autoOnes.length === 4;

console.log("\nAll scenarios found on both sides (no vacuous miss):", allFound);
console.log("Control arms agree (harness sanity):", controlsOk);
console.log("Every AUTOMATIC-health case matches screen vs export:", autoOk);
console.log("REAL ERRORS (" + real.length + "):"); real.slice(0,20).forEach(e=>console.log("  - "+e));
console.log("\nScreenshots: " + OUT + "schedule-onscreen-grid.png, " + OUT + "schedule-export-popup.png");

const pass = rendered && opened.ok && allFound && controlsOk && autoOk && real.length === 0;
console.log(pass ? "\n✅ PASS — export Status column matches the grid for every scenario" : "\n❌ FAIL");

await browser.close(); server.close();
process.exit(pass ? 0 : 1);
