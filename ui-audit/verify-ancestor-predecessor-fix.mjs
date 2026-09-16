// NEW-1/NEW-2/NEW-3 (B1696640/B1696641/B1696642) — live-browser proof for the Master Schedule ancestor-predecessor
// loop and the two banner/toast wording fixes shipped alongside it.
//
// NEW-1 repro mirrors the owner's exact live Master Schedule shape (project '2', __rev 4710, build
// 9b52e1a): summary row 259 "Contract" has children 260 "Begin Drafting Contract" and 261 "HW
// Review"; both 260 and 261 name their OWN PARENT (259) as an explicit FS predecessor — an edge that
// can never converge, because a summary row's dates are the ROLLUP of its children (rollupParentDates)
// while cascadeDates skips computing a parent's own date from predecessors entirely (B443248). This
// asserts, against the REAL React app (not the pure-function mirror — that's covered by
// test/schedulerEngine.test.js):
//   • the ancestor-predecessor notice renders once, names both affected rows by ID, and dismisses
//   • the grid's own predecessor cells for 260/261 no longer show 259 (the repair reached the DOM)
//   • clicking a named row in the notice actually scrolls/selects that row (NEW-2's click-to-scroll)
//   • the locked-finish (B616) banner also carries a row ID and jumps to it on click (NEW-2)
//   • the `planar:merged` toast says "saved elsewhere" + a row count, never "another tab" (NEW-3)
//
// Uses the SAME window.__PLANAR_DATA__ seed mechanism as ui-audit/verify-unscheduled-deps.mjs — no
// network, no Supabase, nothing signed in. (The forced cloud-save the fix issues after a REAL stored
// doc's repair only fires on the primary Supabase-load path, which this harness's seed-load branch
// doesn't exercise — that persistence property is proven directly against the real engine in
// test/schedulerEngine.test.js's "THE ACCEPTANCE TEST" case, which calls the exact same
// recascadeWithDrift function twice in sequence.)
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const OUT = new URL("./screens/", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const INJECT = `<script>(function(){try{
  var d=window.__PLANAR_DATA__; if(!d) return;
  d.view="split"; d.section="projects";
  var pid=d.aPid!=null && d.projects[d.aPid] ? d.aPid : Object.keys(d.projects)[0];
  var p=d.projects[pid] || Object.values(d.projects)[0]; if(!p) return;
  var mk=function(id,name,o){return Object.assign({id:id,name:name,start:"",end:"",duration:0,
    predecessors:[],health:"gray",percentComplete:0,parentId:null,responsibleParty:"",cost:"",notes:[],isExpanded:true,
    durValue:0,durUnit:"d"}, o||{});};
  p.tasks=[
    // The owner's exact reported shape (ids/names/parentId/preds/pinnedStart match ALREADY MEASURED).
    mk(259,"Contract",{parentId:null,pinnedStart:true,start:"2026-08-12",end:"2027-09-13",durValue:0,durUnit:"d"}),
    mk(260,"Begin Drafting Contract",{parentId:259,pinnedStart:true,start:"2026-08-12",end:"2026-08-12",durValue:1,durUnit:"d",
      predecessors:[{id:259,type:"FS",lag:0}]}),
    mk(261,"HW Review",{parentId:259,pinnedStart:false,start:"2027-09-07",end:"2027-09-13",durValue:5,durUnit:"d",
      predecessors:[{id:259,type:"FS",lag:0},{id:260,type:"FS",lag:0}]}),
    mk(262,"Other Contract Task",{parentId:259,start:"2026-08-13",end:"2026-08-13",durValue:1,durUnit:"d"}),
    // A locked-finish (B616) conflict, unrelated to the ancestor bug, for the NEW-2 cft-banner check.
    mk(501,"Site Work",{start:"2027-01-04",end:"2027-01-15",durValue:10,durUnit:"d"}),
    mk(502,"Locked Milestone",{pinnedEnd:true,end:"2027-01-10",durValue:5,durUnit:"d",
      predecessors:[{id:501,type:"FS",lag:0}]}),
  ];
  window.__PL_SCENARIO__={ancestorIds:[260,261], lockedConflictId:502};
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
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await assertMeasurable(page, "verify-ancestor-predecessor-fix");
const real = [];
page.on("console", m => { if (m.type() === "error" && !BENIGN.some(r => r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", e => { if (!BENIGN.some(r => r.test(e.message))) real.push("PAGEERROR: " + e.message); });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: " + e.message));
const rendered = await page.waitForSelector("[data-task-row]", { timeout: 20000 }).then(() => true).catch(() => false);
await page.waitForTimeout(1400);

// The app auto-renumbers every project's tasks to sequential 1..N on load (normalizeIds), so the
// seed's own 259/260/261/502 do NOT survive — resolve the LIVE ids by task name instead, exactly as
// a human would read them off the ID column (NEW-2's own point: the ID column is authoritative).
// The Task column is always the SECOND thing a row shows (ID, then name — a parent row also carries
// a collapse caret in between); a cross-reference from another row's Predecessor/Successor cell
// (DepCell) never starts a row's own innerText, so anchoring the match to "right after this row's own
// ID" reliably picks each task's own row rather than a row that merely mentions it.
const liveIds = await page.evaluate((names) => {
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out = {};
  document.querySelectorAll("[data-task-row]").forEach(row => {
    const id = row.getAttribute("data-task-row");
    const text = norm(row.innerText);
    const re = new RegExp("^" + esc(id) + "\\D{0,3}(" + names.map(esc).join("|") + ")");
    const m = text.match(re);
    if (m && !out[m[1]]) out[m[1]] = id;
  });
  return out;
}, ["Begin Drafting Contract", "HW Review", "Locked Milestone"]);
console.log("LIVE IDS:", JSON.stringify(liveIds));
const id260 = liveIds["Begin Drafting Contract"], id261 = liveIds["HW Review"], id502 = liveIds["Locked Milestone"];

// ── NEW-1: the ancestor-predecessor notice ──────────────────────────────────────────────────
const notice = await page.evaluate(({ id260, id261 }) => {
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  // querySelectorAll("div") matches every ANCESTOR wrapper too (its textContent also "contains" the
  // banner's text) — keep only the innermost match, so a count of 1 really means one banner, not one
  // banner plus however many containers happen to wrap it.
  const candidates = [...document.querySelectorAll("div")].filter(d => norm(d.textContent).includes("named") && norm(d.textContent).includes("parent summary row"));
  const banners = candidates.filter(d => !candidates.some(o => o !== d && d.contains(o)));
  const banner = banners[0];
  const row260 = document.querySelector(`[data-task-row="${id260}"]`);
  const row261 = document.querySelector(`[data-task-row="${id261}"]`);
  return {
    bannerCount: banners.length,
    bannerText: banner ? norm(banner.textContent) : null,
    row260Text: row260 ? norm(row260.innerText) : null,
    row261Text: row261 ? norm(row261.innerText) : null,
  };
}, { id260, id261 });
console.log("NOTICE:", JSON.stringify(notice));

// Click the named-row link inside the ancestor-predecessor banner for the first affected row.
// NEW-1 (owner follow-on, 2026-09-16) — the wrapping `<span style={{flex:1}}>` around the WHOLE
// banner message also matches "#<id>" in its aggregate textContent (it contains every row link) and
// comes FIRST in querySelectorAll's document-order result, so a plain `.find` grabbed that outer,
// onClick-less span instead of the specific inner row link — caught while building
// verify-cross-schedule-notice-labels.mjs, where clicking a row in a NON-active schedule made the
// no-op observable (here it went unnoticed because id260/id261 are already in the active project, so
// the target row was already on screen with or without the click actually doing anything). Keep only
// the INNERMOST matching span, same dedup already used for the banner lookup above.
const clickResult = await page.evaluate((id260) => {
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  const banner = [...document.querySelectorAll("div")].find(d => norm(d.textContent).includes("named") && norm(d.textContent).includes("parent summary row"));
  if (!banner) return { clicked: false };
  const candidates = [...banner.querySelectorAll("span")].filter(s => new RegExp("#" + id260 + "\\b").test(s.textContent || ""));
  const link = candidates.find(s => !candidates.some(o => o !== s && s.contains(o)));
  if (!link) return { clicked: false };
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  return { clicked: true };
}, id260);
await page.waitForTimeout(500);
const scrollProbe = await page.evaluate((id260) => {
  const el = document.querySelector(`[data-task-row="${id260}"]`);
  if (!el) return { visible: false };
  const r = el.getBoundingClientRect();
  return { visible: r.top >= 0 && r.top < window.innerHeight && r.width > 0 && r.height > 0 };
}, id260);
console.log("CLICK:", JSON.stringify(clickResult), "SCROLL:", JSON.stringify(scrollProbe));

// ── NEW-2: locked-finish (B616) banner carries a row ID and jumps to it ────────────────────
const cft = await page.evaluate((id502) => {
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  const banner = [...document.querySelectorAll("div")].find(d => norm(d.textContent).includes("can’t meet") && norm(d.textContent).includes("locked finish"));
  return { bannerText: banner ? norm(banner.textContent) : null, hasRowId: banner ? new RegExp("#" + id502 + "\\b").test(banner.textContent) : false };
}, id502);
console.log("CFT:", JSON.stringify(cft));

// ── NEW-3: the merge toast never claims "another tab", and reports a row count ─────────────
const mergedToast = await page.evaluate(async () => {
  window.dispatchEvent(new CustomEvent("planar:merged", { detail: {
    key: "hs-v1",
    base: { projects: { "1": { tasks: [{ id: 1, name: "x" }] } } },
    value: { projects: { "1": { tasks: [{ id: 1, name: "x-edited" }, { id: 2, name: "y" }] } } },
  } }));
  await new Promise(r => setTimeout(r, 150));
  const t = document.querySelector('[data-testid="schedule-toast-text"]');
  return t ? t.textContent : null;
});
console.log("MERGED TOAST:", JSON.stringify(mergedToast));

await page.screenshot({ path: OUT + "ancestor-predecessor-fix.png" });

// DepCell prefixes every cross-reference with "· " ("· Contract"), so this string appearing
// anywhere in a row is unambiguously a live PREDECESSOR/SUCCESSOR link to the "Contract" task —
// never that row's own name cell (which holds "Contract"/"Begin Drafting Contract" with no prefix).
const pass = rendered
  && !!id260 && !!id261 && !!id502
  && notice.bannerCount === 1
  && notice.bannerText && /2 tasks? named/.test(notice.bannerText)
  && new RegExp("#" + id260 + "\\b").test(notice.bannerText) && new RegExp("#" + id261 + "\\b").test(notice.bannerText)
  && notice.row260Text && !notice.row260Text.includes("· Contract")   // the ancestor link no longer shows in row 260's own predecessor cell
  && notice.row261Text && !notice.row261Text.includes("· Contract")   // …nor row 261's
  && clickResult.clicked && scrollProbe.visible
  && cft.bannerText && cft.hasRowId
  && mergedToast && mergedToast.includes("saved elsewhere") && mergedToast.includes("2 tasks updated") && !mergedToast.includes("another tab")
  && real.length === 0;

if (!pass) console.log("DEBUG:", JSON.stringify({
  rendered, id260, id261, id502,
  bannerCount: notice.bannerCount,
  reNamed: notice.bannerText && /2 tasks? named/.test(notice.bannerText),
  re260: notice.bannerText && new RegExp("#" + id260 + "\\b").test(notice.bannerText),
  re261: notice.bannerText && new RegExp("#" + id261 + "\\b").test(notice.bannerText),
  row260Clean: notice.row260Text && !notice.row260Text.includes("· Contract"),
  row261Clean: notice.row261Text && !notice.row261Text.includes("· Contract"),
  clicked: clickResult.clicked, scrollVisible: scrollProbe.visible,
  cftHasRowId: cft.hasRowId,
  mergedOk: mergedToast && mergedToast.includes("saved elsewhere") && mergedToast.includes("2 tasks updated") && !mergedToast.includes("another tab"),
  realErrs: real.length,
}));
console.log(pass
  ? "✅ PASS — ancestor-predecessor notice + row-id/click-to-scroll banners + merge-toast wording all correct live"
  : "❌ FAIL");
console.log("REAL ERRORS (" + real.length + "):"); real.slice(0, 20).forEach(e => console.log("  - " + e));
await browser.close(); server.close();
process.exit(pass ? 0 : 1);
