// Headless, OFFLINE verification for the "rules always win over healthOverride" fix (owner report,
// 2026-08-25: "why is item 119 not red?"). This is a REAL BROWSER check against a self-hosted copy
// of public/sequence/index.html — no network, and CRUCIALLY no connection to the owner's live
// Supabase data (the investigation's own read-only rule forbids any write path near his production
// rows, and simply loading the live scheduler risks an autosave). Instead this seeds an inline
// __PLANAR_DATA__ boot payload shaped exactly like the measured production facts for task 119 on
// his Goose Creek plan (health "yellow", healthOverride true, start 2026-08-20, end 2026-08-24,
// percentComplete 0, one health rule: finishPastDays/days:1/red) plus a battery of adjacent cases
// from the brief. Pattern copied from ui-audit/verify-focus-overdue.mjs (self-hosted React/Babel,
// Supabase stub resolving "no rows" so boot falls back to the inline seed).
//
// ⛔ AMENDED (B785744, 2026-08-26) — the title claim "rules always win" was itself corrected one
// day later: the owner's own next words were "UNLESS I click task complete, ... I CAN OVERRIDE IN
// THAT SCENARIO." Complete (and Paused) is now the one deliberate, visible, editable exception —
// see the milestone-303 check below, whose expected color changed from RED to GREEN for exactly
// this reason. Every other case here (a task NOT marked Complete/Paused) is unaffected.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const NM = new URL("../node_modules/", import.meta.url).pathname;
const LIB = {
  "/_lib/react.js": NM + "react/umd/react.production.min.js",
  "/_lib/react-dom.js": NM + "react-dom/umd/react-dom.production.min.js",
  "/_lib/babel.js": NM + "@babel/standalone/babel.min.js",
};
const exists = async p => access(p).then(() => true).catch(() => false);
if (!(await exists(LIB["/_lib/babel.js"]))) {
  console.log("SKIP  @babel/standalone not installed — run `npm install --no-save @babel/standalone@7` to enable this headless check.");
  process.exit(0);
}

const ROOT = new URL("../public/", import.meta.url).pathname;
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json" };

// "Today" — computed at harness run time (not baked into the page), matching how the app itself
// derives NOW = fdLocal(new Date()) at boot. Every date below is expressed relative to it so the
// scenario holds no matter what day this runs.
const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
const isoOffset = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

const T = (o) => ({ start:"2020-01-01", end:"2020-01-02", duration:1, predecessors:[], percentComplete:0, responsibleParty:"x", notes:[], isExpanded:true, ...o });

// ⛔ NOTE (unrelated finding, NOT fixed here — out of scope for this task): a custom health status
// (settings.customHealth) defined from the very FIRST render of a fresh tab renders its BUILT-IN
// fallback color (gray) instead of its own, because the useEffect that registers it into the
// module-scope HEALTH map (rebuildHEALTH) deliberately skips its own forced re-render on the first
// invocation (prevHealthKey.current starts null — see index.html's own comment on it) even though
// HEALTH itself is correctly populated by the time that effect returns. Measured directly against
// this harness: HEALTH ends up holding the custom key, but the row painted before that still shows
// the stale gray dot until some OTHER settings-shaped change forces a re-render. This is why the
// scenario battery below only exercises a custom status on an OVERDUE row (where the rule engine
// itself supplies the color and this quirk never gets a chance to matter) — a "custom status
// survives when no rule fires" case is covered instead at the pure-function level in
// test/schedulerEngine.test.js (mutation-proven there), and by the built-in-color "Pinned green,
// not overdue" row below, which isn't touched by this quirk.

// The plan's real health-rule configuration, measured live via Supabase (read-only SELECT) on the
// owner's Goose Creek plan: a single rule, finishPastDays/days:1/red — nothing else.
const REAL_HEALTH_RULES = [{ id: "legacy-overdue", type: "finishPastDays", days: 1, color: "red" }];

const SEED = {
  nPid:2, nTid:{"1":900}, aPid:1, view:"grid", section:"projects", editProjId:null, healthColStyle:"stoplight",
  settings:{ defaultSplit:60, snapDefault:true,
    holidays:{newYearsDay:true,memorialDay:true,independence:true,laborDay:true,thanksgiving:true,christmasEve:true,christmas:true},
    customHealth:[{k:"blocked",label:"Blocked",dot:"#7c3aed",bar:"#ede9fe"}], healthLabelOverrides:{}, healthRules: REAL_HEALTH_RULES },
  projects:{ "1":{ id:1, name:"Goose Creek", tasks:[
    T({ id:200, name:"Group", health:"gray", parentId:null, start:isoOffset(-10), end:isoOffset(10), duration:1 }),
    // ── The reported case itself: item 119's exact measured shape ──
    T({ id:119, name:"Surveyor to revise plat & resubmit", health:"yellow", healthOverride:true, parentId:200,
        start:isoOffset(-5), end:isoOffset(-1), duration:3, percentComplete:0 }),
    // ── Adjacent cases from the brief ──
    T({ id:301, name:"Overdue + Not Started, overridden", health:"gray", healthOverride:true, parentId:200,
        start:isoOffset(-5), end:isoOffset(-1), duration:3, percentComplete:0 }),
    T({ id:302, name:"Overdue + Complete — must stay green", health:"green", healthOverride:true, parentId:200,
        start:isoOffset(-5), end:isoOffset(-1), duration:3, percentComplete:100 }),
    // ⛔ B785744 (2026-08-26) reclassified this row's expected color. It's overdue, marked Complete
    // (health:"green"), with percentComplete still 0 — that's the exact live-measured shape of the
    // owner's real regression (212/557 real tasks), and the fix is that Complete now beats overdue
    // (an explicit, editable "unless Status is Complete" clause on the rule) REGARDLESS of
    // percentComplete. So this row now stays GREEN, not RED — see the check below.
    T({ id:303, name:"Milestone 0d overdue, marked Complete", health:"green", healthOverride:true, parentId:200,
        start:isoOffset(-1), end:isoOffset(-1), duration:0, percentComplete:0 }),
    T({ id:304, name:"Due TODAY not yet past, overridden", health:"yellow", healthOverride:true, parentId:200,
        start:isoOffset(-2), end:todayIso, duration:3, percentComplete:0 }),
    T({ id:306, name:"Pinned green, not overdue — override survives when rules are silent", health:"green", healthOverride:true, parentId:200,
        start:isoOffset(5), end:isoOffset(10), duration:3, percentComplete:0 }),
    T({ id:307, name:"Custom status Blocked OVERDUE, rule wins anyway", health:"blocked", healthOverride:true, parentId:200,
        start:isoOffset(-5), end:isoOffset(-1), duration:3, percentComplete:0 }),
    // ⛔ TRIED AND ABANDONED, recorded so it isn't tried again: a "meeting-infeasible pin, not
    // overdue, override still beats the meeting-risk block" row was seeded here to discriminate
    // against MUTATION-2 (deleting the healthOverride fallback branch entirely, not just reordering
    // it) — the ONE case where deleting that branch produces a DIFFERENT color than keeping it
    // (every other silence-case row's raw `task.health` happens to equal what the override branch
    // would have returned anyway, so removing the branch is invisible to them). It does not work as
    // a hand-seeded browser fixture: `meetingInfeasible`/`meetingDeadline` are DERIVED-for-display
    // fields, "recomputed every cascade" (index.html:2114 comment; the reset logic is
    // index.html:2124-2158/2270-2272) from a REAL `meetingBodies` recurrence definition — this boot
    // seed has none, so `recomputeSchedule` on load silently overwrites a hand-seeded
    // `meetingInfeasible:true` back to `false` before first paint, and the row painted its plain
    // override color regardless of whether the override branch existed. Confirmed empirically:
    // deleting the override branch and rerunning left this row unchanged. Building a real recurring
    // meeting body just to reach this one field was judged not worth it — the exact same claim is
    // already covered, correctly, and MUTATION-2-proven, at the pure-function level in
    // test/schedulerEngine.test.js ("a rule beats the meeting-bound risk block too" / "when no rule
    // matches, override still wins over the meeting-bound / deadline risk blocks"), which calls
    // computeDisplayHealth directly and isn't subject to the cascade's derivation at all.
  ]}},
};
const SEED_TAG = `<script id="planar-data">window.__PLANAR_DATA__=${JSON.stringify(SEED)};<\/script>`;

const SUPA_STUB = `<script>window.supabase={createClient:function(){var q={};["select","eq","neq","lt","gt","gte","lte","order","range","insert","update","upsert","delete","in","is","limit","match","filter"].forEach(function(m){q[m]=function(){return q;};});q.single=function(){return Promise.resolve({data:null,error:{code:"PGRST116"}});};q.maybeSingle=function(){return Promise.resolve({data:null,error:null});};q.then=function(res,rej){return Promise.resolve({data:[],error:null}).then(res,rej);};var chan={on:function(){return chan;},subscribe:function(){return chan;},unsubscribe:function(){return Promise.resolve();}};return{from:function(){return q;},channel:function(){return chan;},removeChannel:function(){return Promise.resolve();},auth:{getSession:function(){return Promise.resolve({data:{session:null},error:null});},getUser:function(){return Promise.resolve({data:{user:null},error:null});},onAuthStateChange:function(){return{data:{subscription:{unsubscribe:function(){}}}};},signOut:function(){return Promise.resolve({error:null});}},storage:{from:function(){return{upload:function(){return Promise.resolve({data:null,error:{message:"stub"}});},download:function(){return Promise.resolve({data:null,error:{message:"stub"}});}};}}};}};<\/script>`;

const rewriteHtml = (html) => html
  .replace(/<script id="planar-data">[\s\S]*?<\/script>/, SEED_TAG)
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react\/[^"]*react\.production\.min\.js/, "/_lib/react.js")
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react-dom\/[^"]*react-dom\.production\.min\.js/, "/_lib/react-dom.js")
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@babel\/standalone[^"]*/, "/_lib/babel.js")
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^"]*"><\/script>/, SUPA_STUB)
  .replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/g, "")
  .replace(/<link[^>]*tabler-icons[^>]*>/g, "");

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(req.url.split("?")[0]);
    if (LIB[path]) { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(await readFile(LIB[path])); }
    let p = path; if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (fp.endsWith("index.html")) body = Buffer.from(rewriteHtml(body.toString("utf8")), "utf8");
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;

const BENIGN = [/supabase/i, /\[BABEL\]/i, /CORS/i, /ERR_FAILED/i, /WebSocket/i, /Failed to load resource/i, /Cloud unreachable/i, /realtime/i, /net::/i, /storage/i];
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox","--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await assertMeasurable(page, "verify-overdue-rules-win");
const real = [];
page.on("console", m => { if (m.type()==="error" && !BENIGN.some(r=>r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", e => { if (!BENIGN.some(r=>r.test(e.message))) real.push("PAGEERROR: " + e.message); });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: "+e.message));
const booted = await page.waitForSelector('[data-task-row]', { timeout: 30000 }).then(()=>true).catch(()=>false);
await page.waitForTimeout(800);

// Read the actual painted dot color for a row's health picker — the innermost <span> under
// [data-health-dot="true"], whose inline `background` is HEALTH[value].dot. Rows are looked up by
// NAME, not seed id: normalizeIds/renumberTasks unconditionally COMPACTS every task's id to 1..n by
// visual position on every load (public/sequence/index.html's own load pipeline), so a seeded id
// like 119 never survives to the DOM — the row is found by its (unique) task name instead, exactly
// how ui-audit/verify-focus-overdue.mjs does it.
const dotColorForName = async (namePart) => page.evaluate((needle) => {
  const rows = Array.from(document.querySelectorAll('[data-task-row]'));
  const row = rows.find(r => (r.textContent || "").includes(needle));
  if (!row) return null;
  const trigger = row.querySelector('[data-health-dot="true"]');
  if (!trigger) return null;
  // trigger > outline-wrapper span > DotSpan — take the innermost (deepest, leaf) span, not the
  // first "span > span" match (that's the outline wrapper, which has no background of its own).
  const spans = trigger.querySelectorAll('span');
  const dot = spans[spans.length - 1] || null;
  if (!dot) return null;
  const bg = getComputedStyle(dot).backgroundColor;
  // normalize rgb(...) to #hex for comparison against the known HEALTH palette
  const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return bg;
  return "#" + m.slice(1,4).map(n => Number(n).toString(16).padStart(2,'0')).join('');
}, namePart);

const RED = "#dc2626", YELLOW = "#c47b00", GREEN = "#16a34a";

const item119 = await dotColorForName("Surveyor to revise plat");
const notStartedOverdue = await dotColorForName("Overdue + Not Started");
const completeOverdue = await dotColorForName("Overdue + Complete");
const milestoneOverdue = await dotColorForName("Milestone 0d overdue, marked Complete");
const dueToday = await dotColorForName("Due TODAY not yet past");
const customBlockedOverdue = await dotColorForName("Custom status Blocked OVERDUE");
const pinnedGreenNotOverdue = await dotColorForName("Pinned green, not overdue");

// GROUP HEADER: the health cell renders blank while a parent is EXPANDED (pre-existing, unrelated
// design — the rolled color lives in the row background instead), so collapse it first to read the
// rolled dot the same way an operator would.
await page.locator('[title="Collapse"]').first().click().catch(() => {});
await page.waitForTimeout(200);
const groupHeaderRolled = await dotColorForName("Group"); // parent — rolled worst-of-children, must be red (119 is a descendant)

await browser.close(); server.close();

// ── MUTATION TRANSPARENCY (owner requirement, 2026-08-25) ───────────────────────────────────────
// "A check that cannot fail is not a check, it is defensive code, and it must be labelled that."
// Every check below carries an honest `discriminates` verdict, measured, not asserted, against
// THREE separate mutations (exact commands + full before/after output in BACKLOG.md B752848 and the
// PR body — not wired into this file, since MUTATION-2/3 edit index.html in place and are one-off,
// not something CI should run every time):
//   MUTATION-1 — revert public/sequence/index.html to the pre-fix ordering (`git checkout HEAD~1 --
//     public/sequence/index.html`, i.e. the actual parent commit, then rerun this file unchanged).
//     Flips 5 of 8 scenario checks to FAIL: item119, notStartedOverdue, milestoneOverdue,
//     customBlockedOverdue, groupHeaderRolled. That is the fix's own discriminating proof.
//   MUTATION-2 — delete `if (task.healthOverride) return task.health;` OUTRIGHT (not reorder it,
//     REMOVE it) from the fixed file. Flips NOTHING in this harness — tried, measured, and the
//     result is explained below (not glossed over as 0 discriminating checks for free).
//   MUTATION-3 — drop the `pct >= 100` guard from the `finishPastDays` case in
//     evalHealthCondition (`if (!task.end || pct >= 100) return false;` → `if (!task.end) return
//     false;`). Flips completeOverdue from GREEN to RED. Confirms that check IS discriminating —
//     just for a different, real defect class (an unrelated regression in the pre-existing
//     completion guard) than the one this PR fixes.
// THE THREE THAT NEVER FLIP UNDER ANY OF THE THREE (completeOverdue only survives MUTATION-1/2,
// NOT MUTATION-3 — see above): dueToday and pinnedGreenNotOverdue stay green under all three,
// and here is the honest reason, stated plainly rather than left as a ratio: both tasks are
// genuinely NOT overdue, so no rule ever matches in ANY version of the code, which makes
// MUTATION-1 (reordering rule-check vs override-check) provably a no-op for them. Under MUTATION-2
// (deleting the override branch), computeDisplayHealth falls through to the FINAL fallback,
// `return task.health;` — which returns the EXACT SAME LITERAL VALUE the deleted override branch
// would have returned, because neither task has `meetingBound` or `deadlineForTaskId` set, so no
// intervening block can produce a different answer. The override branch and the final fallback are
// mathematically identical whenever no rule matches and no meeting/deadline block applies — that is
// not a weakness of these two checks, it is a real structural fact about computeDisplayHealth, and
// the ONLY way to make the distinction observable is to engage a meeting/deadline risk block. That
// was ATTEMPTED (see the abandoned seed comment above) and failed for an unrelated, itself-honest
// reason: `meetingInfeasible`/`meetingDeadline` are fields DERIVED by the schedule cascade from a
// real `meetingBodies` recurrence definition, not literal fields that survive a hand-seeded boot —
// this harness has no meeting body, so the cascade silently resets them before first paint. The
// exact same "override beats the meeting/deadline block when no rule matches" claim IS proven,
// correctly and MUTATION-2-provably, at the pure-function level (`test/schedulerEngine.test.js` —
// "a rule beats the meeting-bound risk block too" / "when no rule matches, override still wins over
// the meeting-bound / deadline risk blocks"), which calls computeDisplayHealth directly and is not
// subject to the cascade's derivation at all.
// "board booted" and "no real console/page errors" are infrastructure/sanity gates, not behavior
// assertions — they check the harness itself works and the page didn't crash, and are categorically
// unable to discriminate a computeDisplayHealth color defect under any of the three mutations.
const checks = [
  { label: "board booted with seeded project", ok: booted, discriminates: "no — infra/sanity gate, not a behavior assertion" },
  { label: "item 119 (overdue + In Progress + healthOverride:true) is RED — the reported bug, fixed", ok: item119 === RED, discriminates: "yes — MUTATION-1 flips this to amber (#c47b00)" },
  { label: "overdue + Not Started + override:true is also RED (rules win regardless of prior status label)", ok: notStartedOverdue === RED, discriminates: "yes — MUTATION-1 flips this to white (#ffffff)" },
  { label: "overdue + Complete (100%) stays GREEN — must NOT go red", ok: completeOverdue === GREEN, discriminates: "no for MUTATION-1/2 (pct>=100 guard is untouched by this fix, so no rule matches in either version) — YES for MUTATION-3, measured: flips to red (#dc2626) when that guard is removed" },
  { label: "0d milestone (start===end) past due, marked Complete, stays GREEN (B785744 — Complete beats overdue regardless of percentComplete)", ok: milestoneOverdue === GREEN, discriminates: "yes for B785744's own fix (a pre-B785744 checkout paints this RED, since only percentComplete>=100 protected a task then); no for MUTATION-1 (reordering rule-check vs override-check is orthogonal to the Complete-status exception)" },
  { label: "due TODAY (not yet past) stays its overridden YELLOW — rule is silent, override survives", ok: dueToday === YELLOW, discriminates: "NO, under any of the three mutations tried — genuinely not overdue in either version (no rule ever matches) AND its raw task.health equals what the deleted override branch would return, so MUTATION-2 is also invisible to it. See the note above." },
  { label: "an OVERDUE custom 'Blocked' status is repainted RED by the firing rule, just like a named color", ok: customBlockedOverdue === RED, discriminates: "yes — MUTATION-1 flips this to white (#ffffff, the unregistered-custom-status fallback)" },
  { label: "a pin that ISN'T overdue keeps its overridden GREEN — override survives when no rule fires", ok: pinnedGreenNotOverdue === GREEN, discriminates: "NO, under any of the three mutations tried — same reasoning as dueToday. The equivalent claim (override beats a meeting/deadline block, which WOULD make this distinction observable) is proven instead at the pure-function level — see the note above." },
  { label: "GROUP HEADER rolls up to RED because its child (119) is now correctly red", ok: groupHeaderRolled === RED, discriminates: "yes — MUTATION-1 flips this to amber (#c47b00)" },
  { label: "no real console/page errors", ok: real.length === 0, discriminates: "no — infra/sanity gate, detects a crash, not a color defect" },
];

console.log(`seed url: ${url}`);
console.log(`item119=${item119} notStartedOverdue=${notStartedOverdue} completeOverdue=${completeOverdue} milestoneOverdue=${milestoneOverdue} dueToday=${dueToday} customBlockedOverdue=${customBlockedOverdue} pinnedGreenNotOverdue=${pinnedGreenNotOverdue} groupHeaderRolled=${groupHeaderRolled}`);
console.log("");
let pass = true;
for (const { label, ok, discriminates } of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n        discriminates (MUTATION-1)? ${discriminates}`); if (!ok) pass = false; }
if (real.length) console.log("\nunexpected errors:\n" + real.join("\n"));
console.log(`\n${pass ? "RULES-WIN-EXCEPT-COMPLETE PASS" : "RULES-WIN-EXCEPT-COMPLETE FAIL"}`);
process.exit(pass ? 0 : 1);
