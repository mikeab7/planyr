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
    T({ id:303, name:"Milestone 0d overdue, overridden", health:"green", healthOverride:true, parentId:200,
        start:isoOffset(-1), end:isoOffset(-1), duration:0, percentComplete:0 }),
    T({ id:304, name:"Due TODAY not yet past, overridden", health:"yellow", healthOverride:true, parentId:200,
        start:isoOffset(-2), end:todayIso, duration:3, percentComplete:0 }),
    T({ id:306, name:"Pinned green, not overdue — override survives when rules are silent", health:"green", healthOverride:true, parentId:200,
        start:isoOffset(5), end:isoOffset(10), duration:3, percentComplete:0 }),
    T({ id:307, name:"Custom status Blocked OVERDUE, rule wins anyway", health:"blocked", healthOverride:true, parentId:200,
        start:isoOffset(-5), end:isoOffset(-1), duration:3, percentComplete:0 }),
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
const milestoneOverdue = await dotColorForName("Milestone 0d overdue");
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

const checks = [
  ["board booted with seeded project", booted],
  ["item 119 (overdue + In Progress + healthOverride:true) is RED — the reported bug, fixed", item119 === RED],
  ["overdue + Not Started + override:true is also RED (rules win regardless of prior status label)", notStartedOverdue === RED],
  ["overdue + Complete (100%) stays GREEN — must NOT go red", completeOverdue === GREEN],
  ["0d milestone (start===end) past due, overridden, still turns RED", milestoneOverdue === RED],
  ["due TODAY (not yet past) stays its overridden YELLOW — rule is silent, override survives", dueToday === YELLOW],
  ["an OVERDUE custom 'Blocked' status is repainted RED by the firing rule, just like a named color", customBlockedOverdue === RED],
  ["a pin that ISN'T overdue keeps its overridden GREEN — override survives when no rule fires", pinnedGreenNotOverdue === GREEN],
  ["GROUP HEADER rolls up to RED because its child (119) is now correctly red", groupHeaderRolled === RED],
  ["no real console/page errors", real.length === 0],
];

console.log(`seed url: ${url}`);
console.log(`item119=${item119} notStartedOverdue=${notStartedOverdue} completeOverdue=${completeOverdue} milestoneOverdue=${milestoneOverdue} dueToday=${dueToday} customBlockedOverdue=${customBlockedOverdue} pinnedGreenNotOverdue=${pinnedGreenNotOverdue} groupHeaderRolled=${groupHeaderRolled}`);
console.log("");
let pass = true;
for (const [label, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) pass = false; }
if (real.length) console.log("\nunexpected errors:\n" + real.join("\n"));
console.log(`\n${pass ? "RULES-ALWAYS-WIN PASS" : "RULES-ALWAYS-WIN FAIL"}`);
process.exit(pass ? 0 : 1);
