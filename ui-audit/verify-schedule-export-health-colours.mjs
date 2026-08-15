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
// ⛔ EXTENDED (group-header-rule-rollup session, branch claude/group-header-rule-rollup-84yspo):
// a SECOND, DIFFERENTLY-LOCATED bug in the same family was found and fixed here —
// computeRolledHealth (the worst-of-children function BOTH the grid and buildPDFHtml call) read
// each LEAF child's RAW stored `.health`, never its rule-computed display health. A child that
// was automatically red by rule but still "gray" in storage could not turn its parent red on
// EITHER surface — screen and export agreed with each other and were both wrong, which is
// exactly why the original "screen === export" check below never caught it: agreement between
// two consumers of the same bad rollup input is not evidence of correctness. So this guard now
// also asserts every scenario's on-screen value against a KNOWN-CORRECT expected label
// (`expectAuto`, previously computed but never actually checked against anything — dead
// scaffolding from the original write-up), not merely cross-surface agreement. See the new
// "autoRollup*" / "nestedRollup" / "mixedDatesRollup" / "milestoneRollup" scenarios below.
//
// Eleven scenarios, each with a KNOWN expected on-screen value (the known-good control arms —
// manualLeaf, noRuleLeaf, groupHeader (all-overridden) — per DRIVER-SCROLL-IS-NOT-APP-SCROLL §6):
//   - autoOverdueLeaf       — automatic, rule-matched red; raw stored health is still "gray"
//   - autoCompleteLeaf      — automatic, rule-matched green (100% complete); raw stored "gray"
//   - manualLeaf            — hand-set red (healthOverride) — screen and export MUST agree (control)
//   - noRuleLeaf            — automatic, no rule matches — screen and export MUST agree (control)
//   - autoOverdueMilestone  — a duration-0 leaf; same automatic path as any other leaf
//   - groupHeader           — collapsed parent, BOTH children hand-overridden (control: raw ==
//     rule-computed for an overridden child, so this scenario is unaffected by the rollup fix
//     and must still read red on both surfaces, same as before)
//   - autoRollupCollapsed   — collapsed parent, BOTH children un-overridden ("gray" stored) —
//     one is genuinely overdue (rule → red), one is genuinely complete (rule → green). Parent
//     must roll up to red. Pre-fix: raw-health rollup saw {gray, gray} and stayed gray/"Not
//     Started" on BOTH surfaces — the core repro for this session's defect.
//   - autoRollupExpanded    — the identical scenario, but the parent is EXPANDED, not collapsed
//     — proves the branch is keyed on hasChildren/isSummary, not the expand/collapse flag.
//   - nestedRollupGrandparent — grandparent → middle parent → leaf, all un-overridden; the
//     leaf's rule-computed red must bubble through the middle parent's OWN rolled value (never
//     the middle parent's raw stored health) up to the grandparent.
//   - mixedDatesRollup      — a collapsed parent with one DATED (overdue → red) and one
//     UNDATED (no rule can match → stays raw gray) child. Only the dated child needs to be
//     rule-computed for the parent to flip red.
//   - milestoneRollup       — a collapsed parent whose only child is a duration-0 milestone,
//     overdue and un-overridden. The rule engine doesn't care about duration; rolls up the same.
//
// Mutation-proven, two independent axes:
//   1. `git stash` the buildPDFHtml `displayHealthOf` fix (#1074) and re-run — the four ORIGINAL
//      automatic leaf/milestone cases must go red while manualLeaf/noRuleLeaf stay green.
//   2. `node ui-audit/verify-schedule-export-health-colours.mjs --mutate-rollup` — an EXACT
//      source-text swap (done server-side, before the page ever parses the script; throws if the
//      text it's replacing has drifted, so a silent no-op can't pass as a real mutation) puts
//      back the pre-fix raw-health rollup body. autoRollupCollapsed/Expanded, nestedRollup,
//      mixedDatesRollup and milestoneRollup must all go red while every other scenario —
//      including the all-overridden groupHeader control — stays green. This proves the new
//      checks are discriminating, not vacuous, without a second git worktree. (An in-page
//      monkey-patch of `computeRolledHealth` was tried first and doesn't work: it's a `const`
//      closed over by every real caller's lexical scope, not a `window` property, so
//      `window.computeRolledHealth = …` shadows nothing.)
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const MUTATE_ROLLUP = process.argv.includes("--mutate-rollup");

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
    // ── group-header-rule-rollup (this session): un-overridden children, "gray" in storage,
    // genuinely red/green only by RULE. The parent must roll up the RULE result, not the raw one.
    mk({id:920,name:"Auto Rollup Collapsed Parent",start:iso(-40),end:iso(10),duration:50,durValue:50,percentComplete:0,
        health:"gray",healthOverride:false,isExpanded:false}),
    mk({id:921,name:"Auto Rollup Collapsed Red Child",start:iso(-40),end:iso(-20),duration:20,durValue:20,percentComplete:40,
        health:"gray",healthOverride:false,parentId:920}),
    mk({id:922,name:"Auto Rollup Collapsed Green Child",start:iso(-30),end:iso(-25),duration:5,durValue:5,percentComplete:100,
        health:"gray",healthOverride:false,parentId:920}),
    // Identical shape, parent EXPANDED — proves collapsed vs expanded doesn't change the result.
    mk({id:930,name:"Auto Rollup Expanded Parent",start:iso(-40),end:iso(10),duration:50,durValue:50,percentComplete:0,
        health:"gray",healthOverride:false,isExpanded:true}),
    mk({id:931,name:"Auto Rollup Expanded Red Child",start:iso(-40),end:iso(-20),duration:20,durValue:20,percentComplete:40,
        health:"gray",healthOverride:false,parentId:930}),
    mk({id:932,name:"Auto Rollup Expanded Green Child",start:iso(-30),end:iso(-25),duration:5,durValue:5,percentComplete:100,
        health:"gray",healthOverride:false,parentId:930}),
    // Nested: grandparent -> middle parent -> leaf. The leaf's rule-computed red must bubble
    // through the middle parent's OWN rolled value, not the middle parent's raw stored health.
    mk({id:940,name:"Nested Rollup Grandparent",start:iso(-40),end:iso(10),duration:50,durValue:50,percentComplete:0,
        health:"gray",healthOverride:false,isExpanded:false}),
    mk({id:941,name:"Nested Rollup Middle Parent",start:iso(-40),end:iso(-15),duration:25,durValue:25,percentComplete:0,
        health:"gray",healthOverride:false,parentId:940,isExpanded:false}),
    mk({id:942,name:"Nested Rollup Leaf",start:iso(-40),end:iso(-20),duration:20,durValue:20,percentComplete:40,
        health:"gray",healthOverride:false,parentId:941}),
    // One dated (overdue) + one undated child — only the dated one is rule-eligible.
    mk({id:950,name:"Mixed Dates Rollup Parent",start:iso(-40),end:iso(10),duration:50,durValue:50,percentComplete:0,
        health:"gray",healthOverride:false,isExpanded:false}),
    mk({id:951,name:"Mixed Dates Dated Child",start:iso(-40),end:iso(-20),duration:20,durValue:20,percentComplete:40,
        health:"gray",healthOverride:false,parentId:950}),
    mk({id:952,name:"Mixed Dates Undated Child",start:"",end:"",duration:1,durValue:1,percentComplete:0,
        health:"gray",healthOverride:false,parentId:950}),
    // A milestone (duration 0) as the only child — the rule engine doesn't care about duration.
    mk({id:960,name:"Milestone Rollup Parent",start:iso(-10),end:iso(-10),duration:10,durValue:10,percentComplete:0,
        health:"gray",healthOverride:false,isExpanded:false}),
    mk({id:961,name:"Milestone Rollup Child",start:iso(-10),end:iso(-10),duration:0,durValue:0,percentComplete:0,
        health:"gray",healthOverride:false,parentId:960}),
  ];
  d.settings = Object.assign({}, d.settings, { healthRules: [
    {id:"r-complete", type:"complete", color:"green"},
    {id:"r-overdue",  type:"finishPastDays", days:1, color:"red"},
    {id:"r-duesoon",  type:"finishWithinDays", days:3, color:"yellow"},
  ]});
}catch(e){console.error("INJECT_ERR",e);}})();</script>`;

// --mutate-rollup: rewrite the SERVED source text back to the pre-fix raw-health rollup body,
// exact string swap (not a regex heuristic) so a silent no-op is detectable rather than passing
// vacuously. (An in-page monkey-patch of `computeRolledHealth` cannot work here: it's declared
// `const` at the top of a classic <script>, and closures inside it — GridView, GanttView,
// MasterView, buildPDFHtml — all close over that lexical binding, not over `window`, so
// reassigning `window.computeRolledHealth` shadows nothing real. A `const` also cannot be
// reassigned by identifier from outside its own script evaluation. Source-text substitution
// before the page ever parses the script is the only way to actually swap the implementation.)
const FIXED_ROLLUP = `const computeRolledHealth = (all, settings) => {
  const byId = {}; all.forEach(t => { byId[t.id] = t; });
  const rollup = (id, stack) => {
    if (stack.has(id)) return byId[id]?.health || "";
    const children = all.filter(t => t.parentId === id);
    if (!children.length) { const t = byId[id]; return t ? (computeDisplayHealth(t, settings, byId) || "") : ""; }
    stack.add(id);
    let best = "", bestP = 0;
    for (const c of children) { const h = rollup(c.id, stack); const p = HEALTH_PRIO[h] || 0; if (p > bestP) { bestP = p; best = h; } }
    stack.delete(id);
    return best;
  };
  const map = {};
  all.forEach(t => { if (all.some(c => c.parentId === t.id)) map[t.id] = rollup(t.id, new Set()); });
  return map;
};`;
// Signature kept as (all, settings) — real call sites already pass settings as a 2nd arg; the
// mutated body just never reads it, exactly reproducing the pre-fix raw-health behaviour.
const MUTATED_ROLLUP = `const computeRolledHealth = (all, settings) => {
  const rollup = (id, stack) => {
    const children = all.filter(t => t.parentId === id);
    if (!children.length || stack.has(id)) return all.find(t => t.id === id)?.health || "";
    stack.add(id);
    let best = "", bestP = 0;
    for (const c of children) { const h = rollup(c.id, stack); const p = HEALTH_PRIO[h] || 0; if (p > bestP) { bestP = p; best = h; } }
    stack.delete(id);
    return best;
  };
  const map = {};
  all.forEach(t => { if (all.some(c => c.parentId === t.id)) map[t.id] = rollup(t.id, new Set()); });
  return map;
};`;

await ensureVendored();

const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (fp.endsWith("sequence/index.html")) {
      body = rewriteCdn(body.toString()).replace(/(<script id="planar-data">[\s\S]*?<\/script>)/, `$1${INJECT}`);
      if (MUTATE_ROLLUP) {
        if (!body.includes(FIXED_ROLLUP)) throw new Error("--mutate-rollup: FIXED_ROLLUP text not found in served source — the harness's copy has drifted from index.html, fix the harness before trusting this run");
        body = body.replace(FIXED_ROLLUP, MUTATED_ROLLUP);
      }
    }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;
console.log("serving", url, MUTATE_ROLLUP ? "(ROLLUP MUTATED — expect the rollup-fix scenarios to FAIL)" : "");

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
  { label: "autoOverdueLeaf",         name: "Auto Overdue Leaf",              expectAuto: "Needs Attn." },
  { label: "autoCompleteLeaf",        name: "Auto Complete Leaf",             expectAuto: "Complete" },
  { label: "manualLeaf",              name: "Manual Override Leaf",           expectAuto: "Needs Attn.",  control: true },
  { label: "noRuleLeaf",              name: "No Rule Match Leaf",             expectAuto: "Not Started",  control: true },
  { label: "autoOverdueMilestone",    name: "Auto Overdue Milestone",         expectAuto: "Needs Attn." },
  { label: "groupHeader",             name: "Group Header Parent",            expectAuto: "Needs Attn.",  control: true },
  { label: "autoRollupCollapsed",     name: "Auto Rollup Collapsed Parent",   expectAuto: "Needs Attn.",  rollupFix: true },
  // The grid/Gantt deliberately blank the status cell for an EXPANDED parent (pre-existing
  // B222/B211 design, unrelated to this fix — see the "collapsed vs expanded" test in
  // test/schedulerEngine.test.js for the full explanation and the data-layer proof that the
  // rolled value itself doesn't depend on isExpanded). So this scenario's on-screen read is
  // expected to be BLANK, not a color — only the export is checked against expectAuto.
  { label: "autoRollupExpanded",      name: "Auto Rollup Expanded Parent",    expectAuto: "Needs Attn.",  rollupFix: true, expectScreenBlank: true },
  { label: "nestedRollupGrandparent", name: "Nested Rollup Grandparent",      expectAuto: "Needs Attn.",  rollupFix: true },
  { label: "mixedDatesRollup",        name: "Mixed Dates Rollup Parent",      expectAuto: "Needs Attn.",  rollupFix: true },
  { label: "milestoneRollup",         name: "Milestone Rollup Parent",        expectAuto: "Needs Attn.",  rollupFix: true },
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
  // expectScreenBlank (only "autoRollupExpanded"): the grid intentionally shows no status text
  // for an expanded parent, so "correct" here means genuinely blank, not a color; "agree" with
  // the export is meaningless for this one row (the export never blanks) and isn't required.
  const screenCorrect = t.expectScreenBlank ? screen == null : screen === t.expectAuto;
  return {
    ...t, screen, exportLabel: exp.label, exportColor: exp.color,
    agree: screen === exp.label,
    screenCorrect,
    exportCorrect: exp.label === t.expectAuto,
  };
});

console.log("\n=== SCREEN vs EXPORT vs KNOWN-CORRECT, same data, same moment ===");
for (const r of results) {
  const need = r.expectScreenBlank ? (r.screenCorrect && r.exportCorrect) : (r.agree && r.screenCorrect);
  const tag = need ? "  pass  " : "❌ FAIL ";
  console.log(`${tag}  ${r.name.padEnd(30)} screen="${r.screen}" export="${r.exportLabel}" (${r.exportColor})  expected="${r.expectAuto}"${r.expectScreenBlank ? " (screen expected BLANK by design)" : ""}`);
}

// Vacuity guard — every scenario must have actually been READ from both instruments. A silent
// selector miss must not read as agreement (DRIVER-SCROLL §6) — but for "autoRollupExpanded" a
// null screen IS the correct reading (see screenCorrect above), so it's checked there instead.
const allFound = results.every(r => (r.expectScreenBlank || r.screen != null) && r.exportLabel != null);

// The known-good control arms (manualLeaf, noRuleLeaf, groupHeader — all-overridden, so
// unaffected by the rollup fix) MUST match their known-correct expected value AND agree with
// each other — if they don't, the harness itself is broken and every other finding here is not
// trustworthy (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6's known-good-arm discipline).
const controls = results.filter(r => r.control);
const controlsOk = controls.every(r => r.agree && r.screenCorrect) && controls.length === 3;

const autoOnes = results.filter(r => ["autoOverdueLeaf","autoCompleteLeaf","autoOverdueMilestone"].includes(r.label));
const autoOk = autoOnes.every(r => r.agree && r.screenCorrect) && autoOnes.length === 3;

// The group-header-rule-rollup scenarios: must be CORRECT (not merely self-consistent) on BOTH
// surfaces. This is the check that catches this session's specific defect — agreement alone
// (the `agree` field) would have passed on the pre-fix code too, since screen and export shared
// the same buggy rollup input and were both wrong together.
const rollupOnes = results.filter(r => r.rollupFix);
const rollupOk = rollupOnes.every(r => r.screenCorrect && r.exportCorrect && (r.expectScreenBlank || r.agree)) && rollupOnes.length === 5;

console.log("\nAll scenarios found on both sides (no vacuous miss):", allFound);
console.log("Control arms correct + agree (harness sanity):", controlsOk);
console.log("Every ORIGINAL automatic-health case (leaf/milestone) matches screen vs export:", autoOk);
console.log("Every group-header-rule-rollup scenario is CORRECT on both surfaces (not just self-consistent):", rollupOk);
console.log("REAL ERRORS (" + real.length + "):"); real.slice(0,20).forEach(e=>console.log("  - "+e));
console.log("\nScreenshots: " + OUT + "schedule-onscreen-grid.png, " + OUT + "schedule-export-popup.png");

const pass = rendered && opened.ok && allFound && controlsOk && autoOk && rollupOk && real.length === 0;
console.log(pass ? "\n✅ PASS — every scenario's health colour is correct and matches on screen and in the export"
                 : "\n❌ FAIL" + (MUTATE_ROLLUP ? " (expected under --mutate-rollup if only rollupOk flipped and controls/autoOk stayed green — that's the discriminating proof)" : ""));

await browser.close(); server.close();
process.exit(pass ? 0 : 1);
