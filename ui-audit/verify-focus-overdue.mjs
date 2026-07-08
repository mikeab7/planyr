// Headless verification for B717 — Focus must not hide an overdue task that displays red
// "Needs Attn.". Seeds a project (via the inline __PLANAR_DATA__ boot seed) with a parent group
// "PUD" holding three leaves under it:
//   • "Submit to Baytown P&Z" — Not Started (gray), end in the past → overdue → displays RED via
//     cfRules.overdueRed. THIS is the row that must SURVIVE Focus (the bug hid it).
//   • "Kickoff complete"      — Complete (green)  → a genuine hideable-done child.
//   • "Future survey"         — Not Started (gray), end far future → a genuine hideable not-started.
// It clicks the group's Focus funnel and asserts the overdue-red row stays while the other two hide,
// and that the funnel's count is 2 (done + upcoming), NOT 3 — i.e. the overdue leaf is no longer
// miscounted as "not started".
//
// The scheduler (public/sequence/index.html) normally pulls React / ReactDOM / Babel-standalone from
// CDNs, which the build sandbox resets. This harness SELF-HOSTS those from node_modules so it boots
// fully offline. React/ReactDOM UMD ship with the project; @babel/standalone does NOT — if it is
// absent the harness SKIPS cleanly (exit 0) with a one-line install hint, so it never breaks CI.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

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

// Crafted boot seed. Dates 2020 (past) vs 2098 (future) so overdue/future hold for any plausible
// real clock — NOW = fdLocal(new Date()) at runtime.
const T = (o) => ({ start:"2020-01-01", end:"2020-01-02", duration:1, predecessors:[], percentComplete:0, responsibleParty:"", notes:[], isExpanded:true, ...o });
const SEED = {
  nPid:2, nTid:{"1":5}, aPid:1, view:"grid", section:"projects", editProjId:null, healthColStyle:"stoplight",
  settings:{ defaultSplit:60, snapDefault:true,
    holidays:{newYearsDay:true,memorialDay:true,independence:true,laborDay:true,thanksgiving:true,christmasEve:true,christmas:true},
    customHealth:[], healthLabelOverrides:{}, cfRules:{ overdueRed:true } },
  projects:{ "1":{ id:1, name:"Baytown PUD", tasks:[
    T({ id:100, name:"PUD", health:"gray", parentId:null, start:"2020-01-01", end:"2099-01-01", duration:1 }),
    T({ id:101, name:"Submit to Baytown P&Z", health:"gray", parentId:100, start:"2020-06-10", end:"2020-06-17", duration:5 }),
    T({ id:102, name:"Kickoff complete", health:"green", percentComplete:100, parentId:100, start:"2020-01-01", end:"2020-01-05", duration:3 }),
    T({ id:103, name:"Future survey", health:"gray", parentId:100, start:"2098-01-01", end:"2099-01-01", duration:5 }),
  ]}},
};
const SEED_TAG = `<script id="planar-data">window.__PLANAR_DATA__=${JSON.stringify(SEED)};<\/script>`;

// Minimal offline stub for the supabase client the page expects as a global. The query builder is
// chainable AND awaitable; `get()` resolves to "no rows" (PGRST116) so boot cleanly falls back to
// the inline seed, exactly like a signed-out first load against an empty cloud.
const SUPA_STUB = `<script>window.supabase={createClient:function(){var q={};["select","eq","neq","lt","gt","gte","lte","order","range","insert","update","upsert","delete","in","is","limit","match","filter"].forEach(function(m){q[m]=function(){return q;};});q.single=function(){return Promise.resolve({data:null,error:{code:"PGRST116"}});};q.maybeSingle=function(){return Promise.resolve({data:null,error:null});};q.then=function(res,rej){return Promise.resolve({data:[],error:null}).then(res,rej);};var chan={on:function(){return chan;},subscribe:function(){return chan;},unsubscribe:function(){return Promise.resolve();}};return{from:function(){return q;},channel:function(){return chan;},removeChannel:function(){return Promise.resolve();},auth:{getSession:function(){return Promise.resolve({data:{session:null},error:null});},getUser:function(){return Promise.resolve({data:{user:null},error:null});},onAuthStateChange:function(){return{data:{subscription:{unsubscribe:function(){}}}};},signOut:function(){return Promise.resolve({error:null});}},storage:{from:function(){return{upload:function(){return Promise.resolve({data:null,error:{message:"stub"}});},download:function(){return Promise.resolve({data:null,error:{message:"stub"}});}};}}};}};<\/script>`;

const rewriteHtml = (html) => html
  .replace(/<script id="planar-data">[\s\S]*?<\/script>/, SEED_TAG)
  // point the three engine scripts at local UMD copies (offline)
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react\/[^"]*react\.production\.min\.js/, "/_lib/react.js")
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react-dom\/[^"]*react-dom\.production\.min\.js/, "/_lib/react-dom.js")
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@babel\/standalone[^"]*/, "/_lib/babel.js")
  // swap the CDN supabase lib for the offline stub; drop the CDN fonts / icon font (they only reset
  // the connection in the sandbox and are irrelevant to the funnel logic).
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
const real = [];
page.on("console", m => { if (m.type()==="error" && !BENIGN.some(r=>r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", e => { if (!BENIGN.some(r=>r.test(e.message))) real.push("PAGEERROR: " + e.message); });

const names = () => page.$$eval('[data-task-row]', rows => rows.map(r => r.textContent || ""));
const has = (arr, s) => arr.some(x => x.includes(s));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: "+e.message));
const booted = await page.waitForSelector('[data-task-row]', { timeout: 30000 }).then(()=>true).catch(()=>false);
await page.waitForTimeout(800);

const before = await names();
const overdueVisibleBefore = has(before, "Submit to Baytown P&Z");
const doneVisibleBefore     = has(before, "Kickoff complete");
const upcomingVisibleBefore = has(before, "Future survey");

// Before focus the funnel title reads "Focus: hide N completed / paused / not-started task(s)".
let beforeTitle = "", afterTitle = "", clicked = false;
try {
  const funnel = page.locator('[title^="Focus: hide"]');
  await funnel.waitFor({ timeout: 8000 });
  beforeTitle = await funnel.getAttribute("title");
  await funnel.click();
  clicked = true;
  await page.waitForTimeout(500);
  afterTitle = await page.locator('[title^="Show all tasks in this group"]').getAttribute("title").catch(()=> "");
} catch (e) { real.push("FUNNEL: " + e.message); }

const after = await names();
const overdueVisibleAfter  = has(after, "Submit to Baytown P&Z");   // MUST stay
const doneVisibleAfter      = has(after, "Kickoff complete");        // MUST hide
const upcomingVisibleAfter  = has(after, "Future survey");           // MUST hide

await browser.close(); server.close();

// The count fix: 2 hideable (done + upcoming), NOT 3 — the overdue leaf is excluded.
const countIs2   = /hide 2 /.test(beforeTitle);
const tipCorrect = /1 completed/.test(afterTitle) && /1 not started/.test(afterTitle);

const checks = [
  ["board booted with seeded project", booted],
  ["overdue-red row visible before focus", overdueVisibleBefore],
  ["done row visible before focus", doneVisibleBefore],
  ["not-started row visible before focus", upcomingVisibleBefore],
  ["funnel appeared + clicked", clicked],
  ["funnel count is 2 (overdue NOT counted as hideable)", countIs2],
  ["overdue-red row STILL VISIBLE after focus  <- the fix", overdueVisibleAfter],
  ["completed row hidden after focus", !doneVisibleAfter],
  ["future not-started row hidden after focus", !upcomingVisibleAfter],
  ["focused tooltip: 1 completed / 1 not started", tipCorrect],
  ["no real console/page errors", real.length === 0],
];

console.log(`seed url: ${url}`);
console.log(`before-focus funnel title: ${JSON.stringify(beforeTitle)}`);
console.log(`after-focus  funnel title: ${JSON.stringify(afterTitle)}`);
console.log("");
let pass = true;
for (const [label, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) pass = false; }
if (real.length) console.log("\nunexpected errors:\n" + real.join("\n"));
console.log(`\n${pass ? "B717 PASS" : "B717 FAIL"}`);
process.exit(pass ? 0 : 1);
