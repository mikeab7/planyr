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
//
// ⛔ EXTENDED AGAIN (schedule-export-pdf-parity session, B575904): TWO more PDF-PARITY violations
// in buildPDFHtml, live-measured (not code-read) before fixing, plus a verification gap closed.
//   1. EXPANDED PARENT PRINTED A COLOUR THE SCREEN NEVER SHOWS. The grid blanks an EXPANDED
//      parent's status/health cell (Cell(), case "status"/"health" — B222/B211: the rolled colour
//      only ever shows on a COLLAPSED row, since an expanded row's children are ALSO shown
//      separately right below it). buildPDFHtml had no such concept at all. Measured live
//      pre-fix: "Auto Rollup Expanded Parent" read screen="null" (blank, by design) but
//      export="Needs Attn." (#dc2626) — same task, same data, same moment. Fixed by blanking
//      buildPDFHtml's health cell whenever the task is a parent AND the EXHIBIT's own
//      `collapsedSet` treats it as expanded (children rendered as separate rows in THIS
//      document) — not `task.isExpanded` directly, because the exhibit has its OWN independent,
//      user-toggleable collapse state (seeded from `task.isExpanded` by PDFExportModal's
//      `seedCollapsed`, but freely divergeable via Expand/Collapse All or the preview's own ▾/▸
//      triangle — the same `collapsedSet` that already gates `visibleTasks()` and that triangle).
//      Proven discriminating below by an explicit override call that inverts collapsedIds against
//      what seedCollapsed would produce for both an expanded and a collapsed parent — if the fix
//      ever regressed to reading `task.isExpanded` directly, that override fails while the main
//      TASKS loop (whose default collapsedIds happens to agree with isExpanded) stays green. The
//      harness's own cfg-building was also fixed to seed collapsedIds from isExpanded the way the
//      real app does — it previously hardcoded `collapsedIds: []`, a state the real app never
//      produces, which would have hidden this defect from ever being caught here.
//   2. PERCENT COLUMN READ RAW STORED HEALTH. Both `percentComplete` cases (`cellVal` and its
//      `cellText` width-measurement twin) read raw `t.health==="green"` for the "green shows 100%"
//      convention — same shape as #1074's original Status-column bug, deliberately left untouched
//      by both #1074 and #1075. Measured live pre-fix on a rolled-green parent (all children
//      complete, parent's own raw health/percentComplete both stale defaults): the SAME exported
//      row read Status="Complete" (already fixed, rolled) next to Percent="0%" — self-contradictory
//      within the export's own output. Fixed by routing both through the same `displayHealthOf`
//      already used by the Status column.
//   3. VERIFICATION GAP: GanttView had NEVER been live-rendered by any guard here — every prior run
//      forced d.view="grid" and only read GridView's DOM, so the claim that GanttView also receives
//      the rule-computed rollup rested on a source-code read of one shared `rolledHealthMap`
//      useMemo, never on watching a bar/row actually turn red. Closed by switching to the real
//      Gantt view via the real view-switcher button and reading the real rendered row background
//      (B222 keeps a Gantt bar's own fill a neutral identity color always — the ROW background is
//      what actually carries health/rollup color) for the #1075 core repro scenario plus two leaf
//      cases and the expanded-parent neutral-row control.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const MUTATE_ROLLUP = process.argv.includes("--mutate-rollup");
const MUTATE_DROPDOWN = process.argv.includes("--mutate-dropdown");
// B603840 — owner decision, verbatim: "everything is always manually overridden... should this be
// a feature? I'm not sure that it really makes sense." Measured on his real production data before
// this session touched anything: 529 leaf tasks across 6 plans, 302 (57%) carry healthOverride while
// only 29 (5.5%) are actually colored by a rule — a marker on 57% of the schedule while automation
// decides 5.5% singles out nothing. The badge (OverrideBadge) is removed from all three surfaces it
// rendered on (HealthPicker, StatusPicker, HealthDropMenu's MasterView cell). The "Automatic" menu
// entry and the healthOverride-wins-over-rules behavior are UNCHANGED — only the visual marker is
// gone. Three independent mutation flags below, each proving one NEW guard is discriminating:
//   --mutate-badge        : reinstates OverrideBadge + its three render call-sites (the literal
//                            pre-fix code) — must flip badgeAbsenceOk to FAIL while everything else
//                            (controls, rollup, gantt, dropdown-dismiss, the two automatic-clear
//                            checks below) stays green.
//   --mutate-automatic-grid   : breaks GridView's AUTO_HEALTH branch (HealthPicker/StatusPicker's
//                            shared commit path) — must flip automaticClearGridOk + the grid half of
//                            persistPayloadOk to FAIL while badgeAbsenceOk and automaticClearMasterOk
//                            stay green (proves the two clear-paths are independently tested).
//   --mutate-automatic-master : same, for MasterView's own commit (the HealthDropMenu surface) —
//                            must flip automaticClearMasterOk + the master half of persistPayloadOk
//                            while automaticClearGridOk stays green.
const MUTATE_BADGE = process.argv.includes("--mutate-badge");
const MUTATE_AUTO_GRID = process.argv.includes("--mutate-automatic-grid");
const MUTATE_AUTO_MASTER = process.argv.includes("--mutate-automatic-master");

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
    // B575904 defect 2 — a collapsed parent whose ROLLED health is green (both children complete)
    // though the parent's OWN raw .health/.percentComplete are untouched stale defaults (gray/0).
    // The old buggy percentComplete read t.health==="green" (the parent's own raw field, never
    // "green") and fell through to the parent's own raw percentComplete (0) — printing "Complete
    // · 0%" in the SAME exported row, self-contradictory.
    mk({id:970,name:"Rolled Complete Parent",start:iso(-20),end:iso(-5),duration:15,durValue:15,percentComplete:0,
        health:"gray",healthOverride:false,isExpanded:false}),
    mk({id:971,name:"Rolled Complete Child A",start:iso(-20),end:iso(-15),duration:5,durValue:5,percentComplete:100,
        health:"gray",healthOverride:false,parentId:970}),
    mk({id:972,name:"Rolled Complete Child B",start:iso(-15),end:iso(-5),duration:10,durValue:10,percentComplete:100,
        health:"gray",healthOverride:false,parentId:970}),
    // B603840 — two purpose-built leaves for the Automatic-clear functional tests below, each on
    // its own never-touched-elsewhere task (touching "Manual Override Leaf" would corrupt the
    // pre-existing manualLeaf control's read, above). computeDisplayHealth falls back to the raw
    // STORED .health field whenever no rule matches (its final line, after the override check and
    // the rule-engine call, is simply: return task.health) — clearing healthOverride does NOT reset
    // that field, only lets a rule outrank it if one now fires. So a task with NO matching rule
    // shows the identical color before and after Automatic (proves nothing) — these two are
    // hand-set to a color a rule DISAGREES with once un-locked (overdue, so r-overdue fires red),
    // so the flip is real and visible: green "Complete" (hand-set, no rule can outrank it while
    // locked) becomes red "Needs Attn." (the rule wins once Automatic hands the field back to it).
    mk({id:981,name:"Grid Locked Task For Automatic Clear",start:iso(-20),end:iso(-15),duration:5,durValue:5,percentComplete:40,
        health:"green",healthOverride:true}),
    mk({id:980,name:"Master View Locked Leaf",start:iso(-20),end:iso(-15),duration:5,durValue:5,percentComplete:40,
        health:"green",healthOverride:true}),
  ];
  // MasterView's own default is "active only" (masterHealthFilter ?? true — red/yellow rows only),
  // which would hide "Master View Locked Leaf"'s BEFORE state (green "Complete"), "Group Header
  // Child Green", and "No Rule Match Leaf" (gray) — none of them a defect, just a filter this
  // diagnostic needs off to see every row it seeds.
  d.masterHealthFilter = false;
  // Pin the column set + order explicitly (DEFAULT_MASTER_COLS) rather than trust whatever this
  // seed's own d.masterCols happens to hold — measured live: the baked-in seed's masterCols omits
  // "id", which silently shifted every later column left by one and broke an index-based column
  // lookup below (td:nth-child(4) landed on "parent", not "name"). Fixing the layout at the source
  // is more robust than chasing indices against a seed this diagnostic doesn't control.
  d.masterCols = ["project","id","name","parent","start","end","duration","health","responsibleParty","notes"];
  // Same reasoning, same fix shape as masterCols above: the baked-in seed's own masterLevelFilter
  // was leaf-only, so EVERY parent/summary row (Group Header Parent, every *Rollup Parent) rendered
  // no <tr> of its own at all — 239 body rows, zero of them a parent, measured directly. Pin it to
  // MasterView's own stated default (DEFAULT_LVL) so parent rows are guaranteed present.
  d.masterLevelFilter = { leafOnly: false, depths: [0,1,2,3] };
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

// --mutate-dropdown: exact string swap of RuleColorPicker's outside-click listener back to the
// bubble-phase form (drops the `true` capture-phase argument on both add/removeEventListener).
// This alone reproduces the reported stuck-open dropdown even with the portal still in place,
// because AutomationPanel's own onMouseDown={stopPropagation} eats a bubble-phase mousedown
// before it ever reaches `document` for any click inside the panel that isn't on the menu itself
// — exactly the defect this guard exists to catch. Same exact-string-swap discipline as
// --mutate-rollup: throws rather than silently no-op-ing if the harness's copy has drifted.
const FIXED_DROPDOWN_LISTENER = `    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);`;
const MUTATED_DROPDOWN_LISTENER = `    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);`;

// --mutate-badge: exact string swap that puts the removed OverrideBadge component AND all three
// of its render call-sites back — literally the pre-B603840 code. Proves badgeAbsenceOk actually
// discriminates: the check must go red the instant the badge exists anywhere, not just report
// "pass" vacuously because nothing was ever looked for.
const FIXED_BADGE_DEF_ANCHOR = `// ── HealthPicker ──────────────────────────────────────────
// One picker open at a time — any picker dispatches this when opening; others listen and close
const PICKER_EVENT = "planar-picker-open";

function HealthPicker({value, onChange, overridden=false}) {`;
const MUTATED_BADGE_DEF_ANCHOR = `// ── HealthPicker ──────────────────────────────────────────
// One picker open at a time — any picker dispatches this when opening; others listen and close
const PICKER_EVENT = "planar-picker-open";

function OverrideBadge({size=8}) {
  return (
    <span title="Manually set — not automatic"
      style={{position:"absolute",right:-3,bottom:-3,width:size,height:size,borderRadius:"50%",
        background:"var(--mut)",border:"1.5px solid #fff",boxShadow:"0 0 0 0.5px rgba(0,0,0,.15)",
        pointerEvents:"none",display:"block"}} />
  );
}

function HealthPicker({value, onChange, overridden=false}) {`;
const FIXED_BADGE_HP = `          <DotSpan hk={value} active={open} noPointer />
        </span>`;
const MUTATED_BADGE_HP = `          <DotSpan hk={value} active={open} noPointer />
          {overridden && <OverrideBadge />}
        </span>`;
const FIXED_BADGE_SP = `        {(HEALTH[value]||HEALTH.gray).label}
      </span>`;
const MUTATED_BADGE_SP = `        {(HEALTH[value]||HEALTH.gray).label}
        {overridden && <span style={{position:"relative",width:7,height:7,display:"inline-block"}}><OverrideBadge size={7} /></span>}
      </span>`;
const FIXED_BADGE_MV = `            <span style={{width:6,height:6,borderRadius:"50%",background:h.dot==="#ffffff"?"#d1d5db":h.dot,flexShrink:0}} />{h.label}
          </span>`;
const MUTATED_BADGE_MV = `            <span style={{width:6,height:6,borderRadius:"50%",background:h.dot==="#ffffff"?"#d1d5db":h.dot,flexShrink:0}} />{h.label}
            {t.healthOverride && <span style={{position:"relative",width:7,height:7,display:"inline-block"}}><OverrideBadge size={7} /></span>}
          </span>`;

// --mutate-automatic-grid: exact string swap of GridView's own commit() — the shared handler
// behind BOTH HealthPicker's dot and StatusPicker's pill (col "health" or "status") — dropping the
// AUTO_HEALTH branch so picking "Automatic" is a no-op (healthOverride never clears). Proves
// automaticClearGridOk (and the grid half of persistPayloadOk) actually discriminates. A no-op,
// not "write the literal sentinel into .health" (tried first) — that variant writes the string
// "__auto__" into a real task's stored health, which MasterView's health-cell renderer reads via
// `const h = HEALTH[dispHealth]` with NO `|| HEALTH.gray` fallback (unlike every other HEALTH
// lookup in this file) and crashes on — a real latent gap, but a pre-existing, unrelated one this
// item didn't touch and isn't the one being verified here, so the mutation is written to not
// trip over it.
const FIXED_AUTO_GRID = `    else if (col==="health"||col==="status") { if (val === AUTO_HEALTH) updateTask(id,{healthOverride:false}); else updateTask(id,{health:val}); }`;
const MUTATED_AUTO_GRID = `    else if (col==="health"||col==="status") { if (val === AUTO_HEALTH) { /* mutated: no-op, healthOverride never clears */ } else updateTask(id,{health:val}); }`;

// --mutate-automatic-master: same idea, MasterView's own commit() (the HealthDropMenu surface).
const FIXED_AUTO_MASTER = `      if (val === AUTO_HEALTH) { if (t.healthOverride) updateTask(t.id, {healthOverride:false}, t.projId); }`;
const MUTATED_AUTO_MASTER = `      if (val === AUTO_HEALTH) { /* mutated: no-op, healthOverride never clears */ }`;

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
      if (MUTATE_DROPDOWN) {
        if (!body.includes(FIXED_DROPDOWN_LISTENER)) throw new Error("--mutate-dropdown: FIXED_DROPDOWN_LISTENER text not found in served source — the harness's copy has drifted from index.html, fix the harness before trusting this run");
        body = body.replace(FIXED_DROPDOWN_LISTENER, MUTATED_DROPDOWN_LISTENER);
      }
      if (MUTATE_BADGE) {
        for (const [name, fixed, mutated] of [
          ["FIXED_BADGE_DEF_ANCHOR", FIXED_BADGE_DEF_ANCHOR, MUTATED_BADGE_DEF_ANCHOR],
          ["FIXED_BADGE_HP", FIXED_BADGE_HP, MUTATED_BADGE_HP],
          ["FIXED_BADGE_SP", FIXED_BADGE_SP, MUTATED_BADGE_SP],
          ["FIXED_BADGE_MV", FIXED_BADGE_MV, MUTATED_BADGE_MV],
        ]) {
          if (!body.includes(fixed)) throw new Error(`--mutate-badge: ${name} text not found in served source — the harness's copy has drifted from index.html, fix the harness before trusting this run`);
          body = body.replace(fixed, mutated);
        }
      }
      if (MUTATE_AUTO_GRID) {
        if (!body.includes(FIXED_AUTO_GRID)) throw new Error("--mutate-automatic-grid: FIXED_AUTO_GRID text not found in served source — the harness's copy has drifted from index.html, fix the harness before trusting this run");
        body = body.replace(FIXED_AUTO_GRID, MUTATED_AUTO_GRID);
      }
      if (MUTATE_AUTO_MASTER) {
        if (!body.includes(FIXED_AUTO_MASTER)) throw new Error("--mutate-automatic-master: FIXED_AUTO_MASTER text not found in served source — the harness's copy has drifted from index.html, fix the harness before trusting this run");
        body = body.replace(FIXED_AUTO_MASTER, MUTATED_AUTO_MASTER);
      }
    }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch (e) { console.error("SERVER ERROR:", e.message); res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;
console.log("serving", url,
  MUTATE_ROLLUP ? "(ROLLUP MUTATED — expect the rollup-fix scenarios to FAIL)" : "",
  MUTATE_BADGE ? "(BADGE MUTATED BACK IN — expect badgeAbsenceOk to FAIL)" : "",
  MUTATE_AUTO_GRID ? "(GRID AUTOMATIC-CLEAR MUTATED — expect automaticClearGridOk to FAIL)" : "",
  MUTATE_AUTO_MASTER ? "(MASTER AUTOMATIC-CLEAR MUTATED — expect automaticClearMasterOk to FAIL)" : "");

// B1449(schedule) — "Supabase set error" joins this list here: the new RuleColorPicker dismiss
// checks below are the first scenarios in this file that mutate state through REAL clicks on the
// live UI (picking a rule color) rather than only pre-seeding window.__PLANAR_DATA__ before the
// app boots, so this is the first run to trigger the app's own autosave — which fails with this
// message in this network-sandboxed harness (no egress to Supabase), same root cause as the
// already-benign "Cloud unreachable" banner text, just a different code path's own console.error.
const BENIGN = [/supabase\.co/i, /CORS policy/i, /ERR_FAILED/i, /WebSocket/i, /Failed to load resource/i, /Cloud unreachable/i, /realtime/i, /BABEL/i, /deoptimised/i, /Supabase set error/i];
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
  // The grid deliberately blanks the status cell for an EXPANDED parent (pre-existing B222/B211
  // design — see the "collapsed vs expanded" test in test/schedulerEngine.test.js for the
  // data-layer proof that the rolled value itself doesn't depend on isExpanded).
  // ⛔ B575904: buildPDFHtml had NO such concept at all and printed a colour here the screen never
  // shows for the same task at the same moment — a PDF-PARITY violation. Fixed by blanking the
  // export's health cell whenever the EXHIBIT's own collapsedSet treats this parent as expanded
  // (children shown as separate rows in this document) — the harness now seeds cfg.collapsedIds
  // from task.isExpanded exactly like the real PDFExportModal's seedCollapsed does, so this
  // scenario's un-collapsed task.isExpanded:true genuinely produces an expanded exhibit row.
  // Both surfaces must now be blank together.
  { label: "autoRollupExpanded",      name: "Auto Rollup Expanded Parent",    expectAuto: "Needs Attn.",  rollupFix: true, expectBothBlank: true },
  { label: "nestedRollupGrandparent", name: "Nested Rollup Grandparent",      expectAuto: "Needs Attn.",  rollupFix: true },
  { label: "mixedDatesRollup",        name: "Mixed Dates Rollup Parent",      expectAuto: "Needs Attn.",  rollupFix: true },
  { label: "milestoneRollup",         name: "Milestone Rollup Parent",        expectAuto: "Needs Attn.",  rollupFix: true },
  { label: "rolledCompleteParent",    name: "Rolled Complete Parent",         expectAuto: "Complete",     rollupFix: true },
];

// ── On-screen read: the StatusPicker's own text node, driven by dispHealth (computeDisplayHealth
// for leaves, rolledHealthMap for a collapsed parent) — exactly what a human reads in the grid.
// Looked up by NAME, not the id the fixture assigned: normalizeIds() renumbers every task on load
// (measured: my seeded 901–912 came back as 1–6), so a hardcoded id would silently match nothing.
const onScreenRead = await page.evaluate((names) => {
  const rows = [...document.querySelectorAll("[data-task-row]")];
  const out = {}, found = {};
  for (const name of names) {
    const row = rows.find(r => (r.textContent || "").includes(name));
    found[name] = !!row;
    const statusEl = row ? row.querySelector('[data-picker-cell^="status-"]') : null;
    out[name] = statusEl ? statusEl.textContent.trim() : null;
  }
  return { out, found };
}, TASKS.map(t => t.name));
const onScreen = onScreenRead.out, onScreenFound = onScreenRead.found;
await page.screenshot({ path: OUT + "schedule-onscreen-grid.png", fullPage: false });

// ── B603840 — no manual-override badge anywhere in GridView (HealthPicker's dot cell AND
// StatusPicker's pill cell), on the owner's own report that the marker sits on the large majority
// of his real schedule and tells him nothing useful. The badge's own title text — "Manually set —
// not automatic" — is a stable, literal marker: it existed on nothing else in this app, so its
// absence is a clean, discriminating signal (see --mutate-badge above, which puts the exact
// pre-fix component back and must flip this to FAIL).
// GridView-visible names only: a COLLAPSED parent's children (Group Header Child Red/Green) get no
// row of their own in GridView at all (pre-existing B222/B211 behavior, same rule the rollup checks
// above already rely on) — checking for a badge on a row that doesn't exist would be vacuous, so
// those two are checked in MasterView below instead, where they DO render as their own rows.
const GRID_LOCKED_NAMES = ["Manual Override Leaf"];
// Unlocked controls (badge was never shown here either way — confirms the check isn't just blind):
// a rule-matched leaf, a no-rule-match leaf, and the (never-overridden) group header parent itself.
const GRID_UNLOCKED_NAMES = ["Auto Overdue Leaf", "No Rule Match Leaf", "Group Header Parent"];
// exactNameCell: MasterView's "parent" column prints the PARENT's own name (getParentName), so a
// whole-row substring match for e.g. "Group Header Parent" also matches ITS CHILD's row (whose
// parent-column cell reads the same text) — ambiguous, and the DOM order between the two isn't
// something to rely on. MasterView's td order is fixed (jump, project, id, name, parent, ...) for
// this harness (it never reorders/hides masterCols), so td:nth-child(4) is the name column
// specifically — exact match there, never a substring anywhere in the row.
const badgeReadOnRows = (rowSelector, names, exactNameCell = false) => page.evaluate(({ names, rowSelector, exactNameCell }) => {
  const rows = [...document.querySelectorAll(rowSelector)];
  const out = {};
  for (const name of names) {
    const row = exactNameCell
      ? rows.find(r => { const tds = r.querySelectorAll("td"); return tds.length > 3 && tds[3].textContent.trim() === name; })
      : rows.find(r => (r.textContent || "").includes(name));
    out[name] = row ? row.querySelectorAll('[title="Manually set — not automatic"]').length : null; // null = row not found (vacuous)
  }
  return out;
}, { names, rowSelector, exactNameCell });
const badgeRead = await badgeReadOnRows("[data-task-row]", [...GRID_LOCKED_NAMES, ...GRID_UNLOCKED_NAMES]);
console.log("\n=== GridView: no manual-override badge on any surface (B603840) ===");
for (const name of GRID_LOCKED_NAMES) console.log(`${badgeRead[name] === 0 ? "  pass  " : "❌ FAIL "}  ${name.padEnd(28)} badge count=${badgeRead[name]} (locked task — badge must be 0, previously wasn't)`);
for (const name of GRID_UNLOCKED_NAMES) console.log(`${badgeRead[name] === 0 ? "  pass  " : "❌ FAIL "}  ${name.padEnd(28)} badge count=${badgeRead[name]} (unlocked control — badge was always 0)`);
const badgeAbsenceGridOk = [...GRID_LOCKED_NAMES, ...GRID_UNLOCKED_NAMES].every(n => badgeRead[n] === 0);
console.log("GridView badge fully removed (HealthPicker + StatusPicker):", badgeAbsenceGridOk);

// ── Export read: drive the REAL openPrint() path — buildPDFHtml() called in-page, written into a
// popup exactly like the app's own "Save as PDF" button does. Never re-implement the renderer.
const popupPromise = page.waitForEvent("popup", { timeout: 20000 }).catch(() => null);
const opened = await page.evaluate(() => {
  if (typeof buildPDFHtml !== "function") return { ok: false, why: "buildPDFHtml not reachable in page scope" };
  const d = window.__PLANAR_DATA__;
  const pid = d.aPid != null ? String(d.aPid) : String(Object.keys(d.projects)[0]);
  // Seed collapsedIds exactly the way PDFExportModal's own seedCollapsed does (a parent whose
  // task.isExpanded===false starts collapsed in the exhibit too) — never hardcode [] here. The
  // exhibit's OWN collapsedSet (not task.isExpanded) is what buildPDFHtml actually renders
  // children-visible-or-not from, so a harness that always passes [] tests a state the real app
  // never produces and would hide the B575904 expanded-parent-blanking defect entirely.
  const seedCollapsed = [];
  Object.values(d.projects).forEach(p => p.tasks.forEach(t => {
    if (p.tasks.some(x => x.parentId === t.id) && t.isExpanded === false) seedCollapsed.push(p.id + ":" + t.id);
  }));
  const cfg = {
    exhibitLabel: "", projectTitle: "Health-colour diagnostic", preparedBy: "", preparedFor: "",
    docDate: "", orientation: "landscape", pageSize: "letter",
    margins: {top:"0.75", right:"0.75", bottom:"0.75", left:"0.75"},
    selProjects: [pid],
    columns: ["id","name","start","end","duration","health","percentComplete"],
    includeGantt: true, showToday: true, showArrows: true, barNames: true,
    labelAlign: "auto", healthFilter: "all", confidential: "",
    collapsedIds: seedCollapsed, detailLevel: seedCollapsed.length ? "custom" : "all", colWidths: {},
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

// ── Discriminating proof that the fix keys off the EXHIBIT's own collapsedSet, not task.isExpanded
// (B575904). buildPDFHtml has its OWN collapse state (cfg.collapsedIds — seeded from isExpanded by
// PDFExportModal, but freely re-toggled inside the export preview via Expand/Collapse All or the
// ▾/▸ triangle, independent of the live grid). Calling buildPDFHtml a second time with collapsedIds
// DELIBERATELY INVERTED from what seedCollapsed would produce proves the export's blank/show
// decision tracks the exhibit's actual rendered structure (children shown as separate rows or not
// in THIS document) — not merely a copy of the live task flag. If this ever regressed to reading
// task.isExpanded directly, this override would fail while the main TASKS loop above stays green
// (their default collapsedIds already happens to agree with task.isExpanded).
const overrideResult = await page.evaluate(() => {
  const d = window.__PLANAR_DATA__;
  const pid = d.aPid != null ? String(d.aPid) : String(Object.keys(d.projects)[0]);
  const proj = Object.values(d.projects).find(p => String(p.id) === pid) || Object.values(d.projects)[0];
  const findId = name => { const t = proj.tasks.find(x => x.name === name); return t ? t.id : null; };
  const expandedParentId = findId("Auto Rollup Expanded Parent");   // task.isExpanded: true
  const collapsedParentId = findId("Auto Rollup Collapsed Parent"); // task.isExpanded: false
  const cfg = {
    exhibitLabel: "", projectTitle: "collapsedSet override diagnostic", preparedBy: "", preparedFor: "",
    docDate: "", orientation: "landscape", pageSize: "letter",
    margins: {top:"0.75", right:"0.75", bottom:"0.75", left:"0.75"},
    selProjects: [pid],
    columns: ["id","name","health"],
    includeGantt: false, showToday: true, showArrows: true, barNames: true,
    labelAlign: "auto", healthFilter: "all", confidential: "",
    // Inverted from seedCollapsed: force the LIVE-expanded parent INTO the exhibit's collapsed set,
    // and leave the LIVE-collapsed parent OUT of it — the opposite of what task.isExpanded implies.
    collapsedIds: expandedParentId != null ? [pid + ":" + expandedParentId] : [],
    detailLevel: "custom", colWidths: {}, timeUnit: null, zoomMul: 1, panFrac: 0,
  };
  return { html: buildPDFHtml(cfg, d), foundExpanded: expandedParentId != null, foundCollapsed: collapsedParentId != null };
});
const overrideRowFor = name => { const rows = overrideResult.html.split(/<tr\b/).filter(r => r.includes(name)); return rows.length ? rows[0] : null; };
const overrideStatusOf = rowHtml => {
  if (!rowHtml) return { label: null };
  const m = rowHtml.match(/<td class="c-health"[^>]*>([\s\S]*?)<\/td>/);
  return { label: m ? m[1].replace(/<[^>]*>/g, "").trim() : null };
};
// Forced INTO collapsedSet despite isExpanded:true → must now show the ROLLED colour, not blank.
const overrideExpandedNowShows = overrideStatusOf(overrideRowFor("Auto Rollup Expanded Parent")).label;
// Left OUT of collapsedSet despite isExpanded:false → must now be BLANK, not the rolled colour.
const overrideCollapsedNowBlank = overrideStatusOf(overrideRowFor("Auto Rollup Collapsed Parent")).label;
const collapsedSetOverrideOk = overrideResult.foundExpanded && overrideResult.foundCollapsed
  && overrideExpandedNowShows === "Needs Attn." && overrideCollapsedNowBlank === "";
console.log("\ncollapsedSet-override proof (inverted vs task.isExpanded):");
console.log(`  Auto Rollup Expanded Parent forced INTO collapsedSet → export now shows "${overrideExpandedNowShows}" (expect "Needs Attn.")`);
console.log(`  Auto Rollup Collapsed Parent forced OUT of collapsedSet → export now shows "${JSON.stringify(overrideCollapsedNowBlank)}" (expect "")`);
console.log("collapsedSet-override proof passes (fix keys off the exhibit's own state, not task.isExpanded):", collapsedSetOverrideOk);

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

// ── B575904 defect 2 — buildPDFHtml's percentComplete column ("green shows 100%") must read the
// SAME computed health as the (already-fixed) Status column, never the parent's own raw stored
// `.health`. "Rolled Complete Parent" is rolled green purely by rule (both children complete,
// parent's own raw health/percentComplete are stale defaults) — pre-fix this printed
// Status="Complete" next to Percent="0%" in the SAME row, self-contradictory. "Auto Rollup
// Collapsed Parent" is the control: its rolled health is red, not green, so its percent must stay
// the parent's own raw percentComplete (0%) — proving the fix isn't just "always print 100%".
const percentOf = rowHtml => {
  if (!rowHtml) return null;
  const m = rowHtml.match(/<td class="c-percentComplete"[^>]*>([\s\S]*?)<\/td>/);
  return m ? m[1].replace(/<[^>]*>/g, "").trim() : null;
};
const PERCENT_TASKS = [
  { name: "Rolled Complete Parent",       expectPercent: "100%" },
  { name: "Auto Rollup Collapsed Parent", expectPercent: "0%",  control: true },
];
const percentResults = PERCENT_TASKS.map(t => {
  const pct = percentOf(rowFor(t.name));
  return { ...t, pct, correct: pct === t.expectPercent };
});
console.log("\n=== EXPORT percentComplete column (green→100% convention, computed health not raw) ===");
for (const r of percentResults) {
  console.log(`${r.correct ? "  pass  " : "❌ FAIL "}  ${r.name.padEnd(30)} percent="${r.pct}"  expected="${r.expectPercent}"${r.control ? " (control: must NOT be forced to 100%)" : ""}`);
}
const percentOk = percentResults.every(r => r.correct) && percentResults.length === 2;
console.log("percentComplete matches the computed (not raw) health:", percentOk);

const results = TASKS.map(t => {
  const rowHtml = rowFor(t.name);
  const exp = statusOf(rowHtml);
  const screen = onScreen[t.name];
  const rowFoundInExport = rowHtml != null;
  const rowFoundOnScreen = !!onScreenFound[t.name];
  // expectBothBlank (only "autoRollupExpanded", B575904): the grid intentionally shows no status
  // text for an expanded parent, and the export must now match — genuinely blank on BOTH sides,
  // not a color. A blank export cell renders as `label === ""` (the row itself still exists,
  // `<td class="c-health"></td>`), which is distinct from `label === null` (the row was never
  // found at all — a vacuous miss, not a pass).
  const screenCorrect = t.expectBothBlank ? screen == null : screen === t.expectAuto;
  const exportCorrect = t.expectBothBlank ? (rowFoundInExport && exp.label === "") : exp.label === t.expectAuto;
  const agree = t.expectBothBlank ? (screenCorrect && exportCorrect) : screen === exp.label;
  return {
    ...t, screen, exportLabel: exp.label, exportColor: exp.color, rowFoundInExport, rowFoundOnScreen,
    agree, screenCorrect, exportCorrect,
  };
});

console.log("\n=== SCREEN vs EXPORT vs KNOWN-CORRECT, same data, same moment ===");
for (const r of results) {
  const need = r.screenCorrect && r.exportCorrect && r.agree;
  const tag = need ? "  pass  " : "❌ FAIL ";
  console.log(`${tag}  ${r.name.padEnd(30)} screen="${r.screen}" export="${r.exportLabel}" (${r.exportColor})  expected="${r.expectBothBlank ? "BLANK on both surfaces" : r.expectAuto}"`);
}

// Vacuity guard — every scenario must have actually been READ from both instruments, the row
// genuinely found on BOTH sides. A silent selector miss must not read as agreement or as a
// correct blank (DRIVER-SCROLL §6) — a missing row and a genuinely blank cell are NOT the same
// reading, so a missing row fails this even when expectBothBlank made screenCorrect/exportCorrect
// look satisfied.
const allFound = results.every(r => r.rowFoundInExport && r.rowFoundOnScreen && (r.expectBothBlank || (r.screen != null && r.exportLabel != null)));

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
const rollupOk = rollupOnes.every(r => r.screenCorrect && r.exportCorrect && r.agree) && rollupOnes.length === 6;

// ── VERIFICATION GAP CLOSED: GanttView has NEVER been live-rendered by this (or any) guard — every
// prior pass here forced d.view="grid" and only ever read GridView's DOM. The claim that GanttView
// also gets the rule-computed rollup (not just GridView) rested entirely on a source-code read (one
// shared `rolledHealthMap` useMemo feeds both), never on observation — exactly the gap
// VIEW-INDEPENDENT-ONCE and DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 warn about. Switch to the REAL Gantt
// view via the REAL view-switcher button (never simulate it by writing to __PLANAR_DATA__) and read
// the REAL rendered row. B222 keeps a Gantt bar's own fill a neutral identity color always (0→100%
// complete reads as hollow→solid, not health) — the row BACKGROUND is what actually carries health/
// rollup color (GanttView's `rowBg`), so that's the one true signal to read here.
await page.click('.hdr-view button:has-text("Gantt")');
await page.waitForSelector("[data-gantt-bar]", { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "schedule-onscreen-gantt.png", fullPage: false });

const GANTT_TASKS = [
  { name: "Auto Overdue Leaf",            expect: "red" },      // leaf: computeDisplayHealth, rule-matched overdue
  { name: "Auto Complete Leaf",           expect: "green" },    // leaf: computeDisplayHealth, rule-matched complete
  // The #1075 core repro, now watched as PIXELS: both children raw-stored "gray"; only rule-computed
  // health rolls this collapsed parent red. Pre-#1075 (raw-health rollup) this row rendered
  // INDISTINGUISHABLE from a neutral/expanded row — the exact invisible-regression class this check
  // exists to close.
  { name: "Auto Rollup Collapsed Parent", expect: "red" },
  // isExpandedParent: GanttView's OWN blank-the-tint rule (same B222/B211 family as the grid/export
  // fix above, but pre-existing and screen-only) — must stay neutral, never health-tinted.
  { name: "Auto Rollup Expanded Parent",  expect: "neutral" },
];
const HEALTH_RGB = { red: "rgb(255, 223, 223)", yellow: "rgb(255, 247, 185)", green: "rgb(214, 250, 226)", paused: "rgb(243, 244, 246)" };
const ganttRows = await page.evaluate((names) => {
  const out = {};
  for (const name of names) {
    const nameEl = [...document.querySelectorAll("[data-gantt-name]")].find(e => e.textContent === name);
    const row = nameEl ? nameEl.parentElement : null;
    out[name] = row ? getComputedStyle(row).backgroundColor : null;
  }
  return out;
}, GANTT_TASKS.map(t => t.name));
const ganttResults = GANTT_TASKS.map(t => {
  const rgb = ganttRows[t.name];
  const found = rgb != null;
  const correct = !found ? false : (t.expect === "neutral" ? !Object.values(HEALTH_RGB).includes(rgb) : rgb === HEALTH_RGB[t.expect]);
  return { ...t, rgb, found, correct };
});
console.log("\n=== GANTT (live-rendered, real view-switcher button, real DOM) ===");
for (const r of ganttResults) {
  console.log(`${r.correct ? "  pass  " : "❌ FAIL "}  ${r.name.padEnd(30)} row-bg="${r.rgb}"  expected=${r.expect}`);
}
const ganttOk = ganttResults.every(r => r.found && r.correct) && ganttResults.length === 4;
console.log("Gantt rows correct (no scenario ever watched turning red before this guard):", ganttOk);

// ── B1449(schedule) — RuleColorPicker dismiss behavior. Owner report: click the red swatch in a
// rule row, a dropdown opens, click elsewhere and "it just closed off that drop down" (rough,
// inconsistent). Live diagnosis (before any fix) found the real defect: AutomationPanel's own
// onMouseDown={stopPropagation} — the same pattern every side panel here uses — ate every mousedown
// inside the panel before it could reach the picker's own outside-click listener, so a click on the
// panel's blank space or on a DIFFERENT rule row's own <select> left the dropdown stuck open,
// floating over that control; only a click that landed outside the whole panel closed it. Three
// scenarios below reproduce exactly that and must all now close it — plus a functional check that
// picking a color still works and a click on another row's control still reaches it (the fix must
// not trade a stuck-open menu for an eaten click).
console.log("\n=== RuleColorPicker dismiss behavior (Automation panel) ===");
await page.click('.hdr-view button:has-text("Grid")').catch(()=>{});
await page.click('button:has-text("Automation")');
await page.waitForTimeout(300);
const rcpDropdownOpen = () => page.evaluate(() => !!document.querySelector('[data-rule-color-menu]'));
const rcpPanelOpen = () => page.evaluate(() => [...document.querySelectorAll('span')].some(s => s.textContent === "Automation" && s.style.fontWeight));
const rcpSwatchBox = await page.evaluate(() => {
  const swatch = document.querySelectorAll('[data-rule-color-swatch]')[0];
  if (!swatch) return null;
  const r = swatch.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const rcpResults = {};
if (!rcpSwatchBox) {
  console.log("❌ FAIL  could not find a rule row's color swatch — the Automation panel didn't render the injected rules");
} else {
  await page.mouse.click(rcpSwatchBox.x, rcpSwatchBox.y);
  await page.waitForTimeout(150);
  rcpResults.opensOnClick = await rcpDropdownOpen();

  // Scenario A — click blank panel space (not the picker, not any other control).
  const blankPoint = await page.evaluate(() => {
    const addRule = [...document.querySelectorAll('span')].find(s => s.textContent === "+ Add rule");
    const r = addRule.getBoundingClientRect();
    return { x: r.left + 5, y: r.top - 15 };
  });
  await page.mouse.click(blankPoint.x, blankPoint.y);
  await page.waitForTimeout(150);
  rcpResults.closesOnBlankPanelClick = !(await rcpDropdownOpen());
  rcpResults.panelSurvivesBlankClick = await rcpPanelOpen();

  // Scenario B — click a DIFFERENT rule row's own <select>; must both dismiss AND let the click
  // through (the select must actually receive focus, not just eat the click as a dismiss).
  if (!(await rcpDropdownOpen())) { await page.mouse.click(rcpSwatchBox.x, rcpSwatchBox.y); await page.waitForTimeout(150); }
  const otherSelectBox = await page.evaluate(() => {
    const sel = document.querySelectorAll('select')[1];
    if (!sel) return null;
    const r = sel.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (otherSelectBox) {
    await page.mouse.click(otherSelectBox.x, otherSelectBox.y);
    await page.waitForTimeout(150);
    rcpResults.closesOnOtherRowClick = !(await rcpDropdownOpen());
    rcpResults.otherRowClickReachesSelect = await page.evaluate(() => document.activeElement?.tagName === "SELECT");
  } else {
    rcpResults.closesOnOtherRowClick = false;
    rcpResults.otherRowClickReachesSelect = false;
  }

  // Scenario C — click fully outside the panel (the grid behind it): must close the dropdown
  // WITHOUT closing the panel itself (panel has no outside-click-to-close of its own).
  if (!(await rcpDropdownOpen())) { await page.mouse.click(rcpSwatchBox.x, rcpSwatchBox.y); await page.waitForTimeout(150); }
  await page.mouse.click(400, 400);
  await page.waitForTimeout(150);
  rcpResults.closesOnOutsidePanelClick = !(await rcpDropdownOpen());
  rcpResults.panelSurvivesOutsideClick = await rcpPanelOpen();

  // Scenario D — functional: picking a color from the dropdown still updates the rule and closes it.
  if (!(await rcpDropdownOpen())) { await page.mouse.click(rcpSwatchBox.x, rcpSwatchBox.y); await page.waitForTimeout(150); }
  const greenOptionBox = await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[data-rule-color-menu] span[style]')].find(s => s.textContent === "Complete");
    if (!opt) return null;
    const r = opt.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (greenOptionBox) {
    await page.mouse.click(greenOptionBox.x, greenOptionBox.y);
    await page.waitForTimeout(150);
    rcpResults.pickApplies = (await page.evaluate(() => document.querySelectorAll('[data-rule-color-swatch]')[0]?.title)) === "Complete";
    rcpResults.closesOnPick = !(await rcpDropdownOpen());
  } else {
    rcpResults.pickApplies = false;
    rcpResults.closesOnPick = false;
  }
}
await page.screenshot({ path: OUT + "schedule-automation-panel.png" });
for (const [k, v] of Object.entries(rcpResults)) console.log(`${v ? "  pass  " : "❌ FAIL "}  ${k}`);
const dropdownDismissOk = !!rcpSwatchBox && Object.values(rcpResults).every(Boolean) && Object.keys(rcpResults).length === 9;
console.log("RuleColorPicker dismiss behavior matches every other menu in the app:", dropdownDismissOk);
await page.click('button:has-text("Automation")').catch(()=>{}); // close the panel again, tidy state

// ── B603840 — MasterView's own health cell (the surface HealthDropMenu opens on) is the THIRD
// place the badge rendered. Switch to Dashboard (section:"reports" → MasterView) and read the same
// task set there — PLUS the two collapsed-parent children GridView never renders a row for at all,
// since MasterView shows every task flat regardless of the live grid's expand/collapse state (its
// masterHealthFilter is turned off above so green/gray rows aren't hidden by the "active only"
// default). Same title-text marker, same technique as GridView above.
await page.click('button:has-text("Dashboard")');
await page.waitForTimeout(400);
const MASTER_LOCKED_NAMES = ["Manual Override Leaf", "Group Header Child Red", "Group Header Child Green", "Master View Locked Leaf"];
const MASTER_UNLOCKED_NAMES = GRID_UNLOCKED_NAMES;
const badgeReadMaster = await badgeReadOnRows("tbody tr", [...MASTER_LOCKED_NAMES, ...MASTER_UNLOCKED_NAMES], true);
console.log("\n=== MasterView/Dashboard: no manual-override badge on the HealthDropMenu cell (B603840) ===");
for (const name of MASTER_LOCKED_NAMES) console.log(`${badgeReadMaster[name] === 0 ? "  pass  " : "❌ FAIL "}  ${name.padEnd(28)} badge count=${badgeReadMaster[name]} (locked — badge must be 0, previously wasn't)`);
for (const name of MASTER_UNLOCKED_NAMES) console.log(`${badgeReadMaster[name] === 0 ? "  pass  " : "❌ FAIL "}  ${name.padEnd(28)} badge count=${badgeReadMaster[name]} (unlocked control)`);
const badgeAbsenceMasterOk = [...MASTER_LOCKED_NAMES, ...MASTER_UNLOCKED_NAMES].every(n => badgeReadMaster[n] === 0);
console.log("MasterView badge fully removed (the HealthDropMenu surface):", badgeAbsenceMasterOk);

// ── B603840 — the constraint that matters most: removing the badge must NOT remove the route back
// to Automatic, and a hand-picked colour must still always beat automation (unchanged). Two live
// functional passes below, one per surface (Grid's StatusPicker, MasterView's HealthDropMenu), each
// on its OWN never-before-touched locked task so a prior scenario's read can't be corrupted.
//
// "Survives a reload" can't be taken literally in this sandbox — there is no egress to Supabase
// here (see the BENIGN filter above; every real save already fails silently and is filtered as
// noise), so a genuine page reload would just re-run this same INJECT fixture, not read anything
// back from the cloud. The honest proxy: monkey-patch window.storage.set (the ONE function every
// save funnels through — attemptCloudSave calls it with JSON.stringify(currentData)) to capture the
// EXACT bytes the app hands to the persistence layer. That's the same string that would reach
// Supabase's planar_data row in production and be read back on a real reload — this proves the
// commit reaches the save path with the field cleared, not merely that a screen re-rendered.
// Genuinely untested here: the real Supabase round-trip landing and surviving an actual browser
// reload — that needs live network egress this sandbox doesn't have. Filed as V311488 (Blocker:
// auth — same network-egress restriction the existing auth blocker class names) for a live check.
await page.evaluate(() => {
  window.__capturedSaves = [];
  const orig = window.storage.set;
  window.storage.set = (k, v, opts) => { window.__capturedSaves.push(v); return orig(k, v, opts); };
});

// ── Surface 1: Grid — StatusPicker's own "Automatic" menu entry, on "Grid Locked Task For
// Automatic Clear" (a task purpose-built above, never touched by any earlier scenario — the
// pre-existing `manualLeaf` control stays pristine). Overdue + hand-set green, so clearing to
// Automatic must visibly flip the label (green "Complete" → red "Needs Attn.", the rule winning
// once it's handed the field back), proving the change is real, not merely a re-render.
// The badge check above left the app on Dashboard (section:"reports"), where .hdr-view isn't
// rendered at all (it's gated on section==="projects") — switch back to Projects first, or the
// Grid-view click below is a silent no-op and every read after it finds nothing.
await page.click('button:has-text("Projects")');
await page.waitForTimeout(200);
await page.click('.hdr-view button:has-text("Grid")').catch(()=>{});
await page.waitForTimeout(200);
const GRID_AUTO_TASK = "Grid Locked Task For Automatic Clear";
const gridBefore = await page.evaluate((name) => {
  const rows = [...document.querySelectorAll("[data-task-row]")];
  const row = rows.find(r => (r.textContent || "").includes(name));
  if (!row) return null;
  const dot = row.querySelector('[data-health-dot]');
  const statusCell = row.querySelector('[data-picker-cell^="status-"]');
  const r = statusCell.getBoundingClientRect();
  return {
    found: true,
    overrideAttr: dot ? dot.getAttribute('data-health-override') : null,
    label: statusCell.textContent.trim(),
    clickX: r.left + r.width / 2, clickY: r.top + r.height / 2,
  };
}, GRID_AUTO_TASK);
let gridAfter = { found: false };
if (gridBefore && gridBefore.found) {
  await page.mouse.click(gridBefore.clickX, gridBefore.clickY); // open StatusPicker
  await page.waitForTimeout(150);
  const autoBox = await page.evaluate(() => {
    const opt = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === "Automatic" && s.getBoundingClientRect().width > 0);
    if (!opt) return null;
    const r = opt.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (autoBox) {
    await page.mouse.click(autoBox.x, autoBox.y); // pick Automatic
    await page.waitForTimeout(250);
    gridAfter = await page.evaluate((name) => {
      const rows = [...document.querySelectorAll("[data-task-row]")];
      const row = rows.find(r => (r.textContent || "").includes(name));
      if (!row) return { found: false };
      const dot = row.querySelector('[data-health-dot]');
      const statusCell = row.querySelector('[data-picker-cell^="status-"]');
      return { found: true, overrideAttr: dot ? dot.getAttribute('data-health-override') : null, label: statusCell.textContent.trim() };
    }, GRID_AUTO_TASK);
  }
}
const automaticClearGridOk = !!(gridBefore?.found && gridBefore.overrideAttr === "true" && gridBefore.label === "Complete"
  && gridAfter.found && gridAfter.overrideAttr === "false" && gridAfter.label === "Needs Attn.");
console.log("\n=== Grid: 'Automatic' still clears healthOverride and hands the task back to the rule engine (B603840) ===");
console.log(`  before: found=${gridBefore?.found} override=${gridBefore?.overrideAttr} label="${gridBefore?.label}"  (expect override=true label="Complete")`);
console.log(`  after:  found=${gridAfter.found} override=${gridAfter.overrideAttr} label="${gridAfter.label}"  (expect override=false label="Needs Attn.")`);
console.log(`${automaticClearGridOk ? "  pass  " : "❌ FAIL "}  automaticClearGridOk`);

// ── Surface 2: MasterView — HealthDropMenu, on "Master View Locked Leaf" (same shape as the Grid
// task above, never touched elsewhere). MasterView lists every task across every project, sorted —
// this row can land far below the fold (measured: 7000+ CSS px down), so raw mouse coordinates miss
// it entirely. MasterView is NOT virtualized (plain `sortedRows.map(...)`, no windowing — confirmed
// by reading the source), so unlike a virtualized list (DRIVER-SCROLL-IS-NOT-APP-SCROLL), letting
// the driver scroll it into view is safe: every row already exists in the DOM regardless of scroll
// position, scrolling only changes what's on screen, not what's rendered.
await page.click('button:has-text("Dashboard")');
await page.waitForTimeout(300);
const MASTER_AUTO_TASK = "Master View Locked Leaf";
const masterRow = page.locator("tbody tr", { hasText: MASTER_AUTO_TASK }).first();
const masterHealthCell = masterRow.locator('td[data-hmenu="1"]'); // the health cell — the only <td> carrying this attribute
const masterRowCount = await masterRow.count();
let masterBefore = { found: false }, masterAfter = { found: false };
if (masterRowCount > 0) {
  await masterHealthCell.scrollIntoViewIfNeeded();
  masterBefore = { found: true, label: (await masterHealthCell.textContent()).trim() };
  await masterHealthCell.dblclick(); // opens HealthDropMenu
  await page.waitForTimeout(200);
  const autoOpt = page.locator('[data-hmenu="1"] span', { hasText: "Automatic" }).first();
  if (await autoOpt.count() > 0) {
    await autoOpt.click();
    await page.waitForTimeout(250);
    const afterCount = await masterRow.count();
    masterAfter = afterCount > 0 ? { found: true, label: (await masterHealthCell.textContent()).trim() } : { found: false };
  }
}
const automaticClearMasterOk = !!(masterBefore.found && masterBefore.label === "Complete"
  && masterAfter.found && masterAfter.label === "Needs Attn.");
console.log("\n=== MasterView: 'Automatic' still clears healthOverride via HealthDropMenu (B603840) ===");
console.log(`  before: found=${masterBefore.found} label="${masterBefore.label}"  (expect "Complete")`);
console.log(`  after:  found=${masterAfter.found} label="${masterAfter.label}"  (expect "Needs Attn.")`);
console.log(`${automaticClearMasterOk ? "  pass  " : "❌ FAIL "}  automaticClearMasterOk`);

// ── Persistence proxy: the captured save payload(s) must carry healthOverride:false for BOTH
// cleared tasks — the bytes that would reach Supabase and be read back on a real reload.
const capturedSaves = await page.evaluate(() => window.__capturedSaves || []);
const findClearedInSaves = (name) => capturedSaves.some(v => {
  try {
    const parsed = JSON.parse(v);
    return Object.values(parsed.projects || {}).some(p => (p.tasks || []).some(t => t.name === name && t.healthOverride === false));
  } catch { return false; }
});
const persistGridOk = findClearedInSaves(GRID_AUTO_TASK);
const persistMasterOk = findClearedInSaves(MASTER_AUTO_TASK);
const persistPayloadOk = capturedSaves.length > 0 && persistGridOk && persistMasterOk;
console.log("\n=== Persistence proxy: the save-path payload carries healthOverride:false (proxy for 'survives a reload') ===");
console.log(`  captured save attempts: ${capturedSaves.length}`);
console.log(`${persistGridOk ? "  pass  " : "❌ FAIL "}  Grid-cleared task's payload has healthOverride:false`);
console.log(`${persistMasterOk ? "  pass  " : "❌ FAIL "}  MasterView-cleared task's payload has healthOverride:false`);
console.log("NOT verified here (needs live Supabase egress this sandbox lacks) — the real cloud round-trip surviving an actual page reload. Filed V311488, Blocker: auth.");

console.log("\nAll scenarios found on both sides (no vacuous miss):", allFound);
console.log("Control arms correct + agree (harness sanity):", controlsOk);
console.log("Every ORIGINAL automatic-health case (leaf/milestone) matches screen vs export:", autoOk);
console.log("Every group-header-rule-rollup scenario is CORRECT on both surfaces (not just self-consistent):", rollupOk);
console.log("percentComplete matches computed health, not raw (B575904 defect 2):", percentOk);
console.log("Manual-override badge fully removed, Grid + MasterView (B603840):", badgeAbsenceGridOk && badgeAbsenceMasterOk);
console.log("'Automatic' still clears healthOverride, both surfaces (B603840):", automaticClearGridOk && automaticClearMasterOk);
console.log("Cleared task's save payload carries healthOverride:false (reload-persistence proxy):", persistPayloadOk);
console.log("REAL ERRORS (" + real.length + "):"); real.slice(0,20).forEach(e=>console.log("  - "+e));
console.log("\nScreenshots: " + OUT + "schedule-onscreen-grid.png, " + OUT + "schedule-onscreen-gantt.png, " + OUT + "schedule-export-popup.png");

const pass = rendered && opened.ok && allFound && controlsOk && autoOk && rollupOk && collapsedSetOverrideOk && ganttOk && percentOk && dropdownDismissOk
  && badgeAbsenceGridOk && badgeAbsenceMasterOk && automaticClearGridOk && automaticClearMasterOk && persistPayloadOk && real.length === 0;
console.log(pass ? "\n✅ PASS — every scenario's health colour is correct and matches on screen, in the export, and in the Gantt; RuleColorPicker dismiss behavior matches the rest of the app; the manual-override badge is gone from Grid and MasterView and 'Automatic' still clears it on both surfaces"
                 : "\n❌ FAIL"
                   + (MUTATE_ROLLUP ? " (expected under --mutate-rollup if rollupOk/ganttOk flip and controls/autoOk stay green — that's the discriminating proof)" : "")
                   + (MUTATE_DROPDOWN ? " (expected under --mutate-dropdown if dropdownDismissOk flips and every other check stays green — that's the discriminating proof)" : "")
                   + (MUTATE_BADGE ? " (expected under --mutate-badge if badgeAbsenceGridOk/badgeAbsenceMasterOk flip and everything else stays green — that's the discriminating proof)" : "")
                   + (MUTATE_AUTO_GRID ? " (expected under --mutate-automatic-grid if automaticClearGridOk/persistPayloadOk flip and automaticClearMasterOk stays green — that's the discriminating proof)" : "")
                   + (MUTATE_AUTO_MASTER ? " (expected under --mutate-automatic-master if automaticClearMasterOk/persistPayloadOk flip and automaticClearGridOk stays green — that's the discriminating proof)" : ""));

await browser.close(); server.close();
process.exit(pass ? 0 : 1);
