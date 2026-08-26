// Headless, OFFLINE, REAL-BROWSER verification of the rebuilt Automation panel (B785744) — the
// IF/THEN/UNLESS rule builder that replaces the seven-canned-condition list from #1073, which the
// owner rejected twice ("you've got like two variables here" / "this is bullshit"). This drives
// the ACTUAL PANEL — clicking "+ Add rule", "+ Add exception", reading the live-computed grid dot
// color — not just the pure engine (that's test/schedulerEngine.test.js's job). Self-hosted copy of
// public/sequence/index.html, no network, no Supabase — same pattern as
// ui-audit/verify-overdue-rules-win.mjs.
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

const isoOffset = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const T = (o) => ({ start:"2020-01-01", end:"2020-01-02", duration:1, predecessors:[], percentComplete:0, responsibleParty:"", notes:[], isExpanded:true, ...o });

// His Goose Creek settings.rowHeight is 20 (measured, read-only SELECT against planar_data) — the
// smallest real value on any of his 6 plans, and the brief's own stated floor to test at.
const SEED = {
  nPid:2, nTid:{"1":900}, aPid:1, view:"grid", section:"projects", editProjId:null, healthColStyle:"stoplight",
  settings:{ defaultSplit:60, snapDefault:true, rowHeight:20,
    holidays:{newYearsDay:true,memorialDay:true,independence:true,laborDay:true,thanksgiving:true,christmasEve:true,christmas:true},
    customHealth:[], healthLabelOverrides:{}, healthRules: [] }, // no rules yet — built live via the panel
  projects:{ "1":{ id:1, name:"Goose Creek", tasks:[
    // The exact live-measured regression shape: marked Complete, percentComplete never bumped, overdue.
    T({ id:119, name:"Surveyor to revise plat, marked Complete", health:"green", parentId:null,
        start:isoOffset(-10), end:isoOffset(-5), duration:5, percentComplete:0 }),
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
await assertMeasurable(page, "verify-automation-rule-language");
const real = [];
page.on("console", m => { if (m.type()==="error" && !BENIGN.some(r=>r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", e => { if (!BENIGN.some(r=>r.test(e.message))) real.push("PAGEERROR: " + e.message); });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: "+e.message));
const booted = await page.waitForSelector('[data-task-row]', { timeout: 30000 }).then(()=>true).catch(()=>false);
await page.waitForTimeout(600);

const dotColorForName = async (namePart) => page.evaluate((needle) => {
  const rows = Array.from(document.querySelectorAll('[data-task-row]'));
  const row = rows.find(r => (r.textContent || "").includes(needle));
  if (!row) return null;
  const trigger = row.querySelector('[data-health-dot="true"]');
  if (!trigger) return null;
  const spans = trigger.querySelectorAll('span');
  const dot = spans[spans.length - 1] || null;
  if (!dot) return null;
  const bg = getComputedStyle(dot).backgroundColor;
  const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return bg;
  return "#" + m.slice(1,4).map(n => Number(n).toString(16).padStart(2,'0')).join('');
}, namePart);
const RED = "#dc2626", GREEN = "#16a34a";

const TASK_NAME = "Surveyor to revise plat, marked Complete";
const beforeAnyRule = await dotColorForName(TASK_NAME);

// ── Open the Automation panel and build a rule live, exactly as an owner would ──────────────
await page.click('button:has-text("Automation")');
await page.waitForTimeout(200);
const panelOpen = await page.evaluate(() => [...document.querySelectorAll('span')].some(s => s.textContent === "Automation" && s.style.fontWeight));

await page.click('text=+ Add rule');
await page.waitForTimeout(150);

// Default new rule: IF Finish date is N+ days past due (1) THEN red, no exception yet — should
// immediately paint the Complete-but-overdue task RED (proving the panel writes a real, live rule).
const afterRuleNoException = await dotColorForName(TASK_NAME);

// Structural read of the rule card: field/op selects present, THEN color swatch present.
const ruleCardShape = await page.evaluate(() => {
  const selects = [...document.querySelectorAll('select')];
  const fieldSelect = selects.find(s => [...s.options].some(o => o.value === "finish"));
  const opSelect = selects.find(s => [...s.options].some(o => o.value === "pastDueAtLeast"));
  return {
    hasFieldSelect: !!fieldSelect,
    fieldSelectValue: fieldSelect?.value,
    hasOpSelect: !!opSelect,
    opSelectValue: opSelect?.value,
    hasIfLabel: document.body.textContent.includes("IF"),
    hasThenLabel: document.body.textContent.includes("THEN set status to"),
    hasUnlessLabel: document.body.textContent.includes("UNLESS"),
  };
});

// ── Add the exception (the whole point of the rebuild) — click "+ Add exception" ──────────────
await page.click('text=+ Add exception');
await page.waitForTimeout(150);
const afterException = await dotColorForName(TASK_NAME);

// The exception's own condition row should now read Status / is / Complete.
const exceptionRowShape = await page.evaluate(() => {
  const selects = [...document.querySelectorAll('select')];
  const statusFieldSelects = selects.filter(s => [...s.options].some(o => o.value === "status"));
  // The UNLESS group's field select is the second one carrying a "status" option (the first is the
  // THEN-color RuleColorPicker's swatch menu, which isn't a <select> — so any status-typed <select>
  // here belongs to a condition row).
  const unlessFieldSelect = statusFieldSelects.find(s => s.value === "status");
  return { found: !!unlessFieldSelect, value: unlessFieldSelect?.value };
});

// ── Multi-condition AND/OR: add a second IF condition and confirm the combinator toggle appears ──
const ifAddConditionLocator = page.locator('text=+ Add condition').first();
await ifAddConditionLocator.click();
await page.waitForTimeout(150);
const andOrPresent = await page.evaluate(() => [...document.querySelectorAll('span')].some(s => s.textContent === "AND") &&
                                                  [...document.querySelectorAll('span')].some(s => s.textContent === "OR"));

// ── Panel geometry: no horizontal overflow, real measured pixels, at the owner's row height ──
const panelBox = await page.evaluate(() => {
  const header = [...document.querySelectorAll('span')].find(s => s.textContent === "Automation" && s.style.fontWeight);
  const panel = header?.closest('div[style*="position: fixed"]') || header?.closest('div[style*="position:fixed"]');
  if (!panel) return null;
  const r = panel.getBoundingClientRect();
  const hasHorizontalOverflow = panel.scrollWidth > panel.clientWidth + 1;
  return { left: r.left, right: r.right, width: r.width, viewportWidth: window.innerWidth, hasHorizontalOverflow };
});

await page.screenshot({ path: new URL("./screens/schedule-automation-panel.png", import.meta.url).pathname }).catch(()=>{});
await browser.close(); server.close();

const checks = [
  { label: "board booted with seeded project", ok: booted },
  { label: `before any rule: raw stored health shows through (${GREEN})`, ok: beforeAnyRule === GREEN },
  { label: "Automation panel opens on click", ok: panelOpen },
  { label: "+ Add rule creates a real rule that immediately paints the task RED (no exception yet)", ok: afterRuleNoException === RED },
  { label: "rule card exposes field/op <select>s defaulting to Finish date / is N+ days past due, and IF/THEN/UNLESS labels", ok: ruleCardShape.hasFieldSelect && ruleCardShape.fieldSelectValue === "finish" && ruleCardShape.hasOpSelect && ruleCardShape.opSelectValue === "pastDueAtLeast" && ruleCardShape.hasIfLabel && ruleCardShape.hasThenLabel && ruleCardShape.hasUnlessLabel },
  { label: "+ Add exception defaults to Status is Complete, and the task goes back to GREEN with no further clicks", ok: afterException === GREEN },
  { label: "the UNLESS condition row is a real Status field select", ok: exceptionRowShape.found && exceptionRowShape.value === "status" },
  { label: "+ Add condition on the IF group surfaces an AND/OR combinator toggle", ok: andOrPresent },
  { label: `Automation panel fits the viewport with no horizontal overflow (measured: width=${panelBox?.width}, right=${panelBox?.right} vs viewport=${panelBox?.viewportWidth})`, ok: !!panelBox && !panelBox.hasHorizontalOverflow && panelBox.right <= panelBox.viewportWidth },
  { label: "no real console/page errors", ok: real.length === 0 },
];

console.log(`seed url: ${url}`);
console.log(`beforeAnyRule=${beforeAnyRule} afterRuleNoException=${afterRuleNoException} afterException=${afterException}`);
console.log("");
let pass = true;
for (const { label, ok } of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) pass = false; }
if (real.length) console.log("\nunexpected errors:\n" + real.join("\n"));
console.log(`\n${pass ? "AUTOMATION-RULE-LANGUAGE PASS" : "AUTOMATION-RULE-LANGUAGE FAIL"}`);
if (!pass) process.exit(1);
