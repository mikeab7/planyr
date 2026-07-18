// V207 — B278/B280/B281 fixture harness (zoom-/data-density rendering + PDF/export parity):
// drives the REAL ~119-task dense-Gantt fixture (e2e/fixtures/schedules/dense-project.fixture.json,
// the same one test/scheduleDensityFixture.test.js and e2e/gantt-density.spec.js reference) through
// the served Schedule app at its natural ~33% zoom (a 1600px viewport puts pxPerDay at 2, which is
// exactly 33% per the app's own zoomPct = ppd/6*100 formula) and asserts:
//   1. every dependency connector has finite (non-NaN) endpoints, on-screen AND in the print SVG
//   2. no task/summary/milestone name label overlaps its OWN bar/bracket span (the "plate" mode,
//      which deliberately centers a short leaf label ON its own bar with a contrast plate, is the
//      one intentional exception and is excluded)
//   3. PDF/export parity: the on-screen GanttView and the REAL Export → "PDF / Print Exhibit" UI
//      resolve the SAME number of dependency connectors — neither drops/NaNs a link the other
//      keeps (the fixture's one deliberately-unscheduled row must be silently skipped by BOTH,
//      never rendered as a NaN-anchored arrow).
//
// Note: the app renumbers task ids to match visual/tree order on every load (index.html:5068,
// "runs automatically on every load") — the fixture's one out-of-tree-position row (id 118 is a
// child of phase 1 but sits last in the array) gets relocated + the whole set renumbered by +1
// from that point on. That's the app's documented data-integrity migration working as intended,
// not a defect, so this harness asserts against post-renumber DOM state (ids visible in the
// browser), never against the fixture's original id numbering.
//
// Hermetic: same CDN-vendoring trick as verify-gantt-dep-anchors.mjs (V202) — the sequence app pulls
// React/Babel from CDNs the sandbox network resets, so those URLs are routed to local copies.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import * as E from "./stress/scheduler-engine.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const NM = new URL("../node_modules/", import.meta.url).pathname;
const OUT = new URL("./screens/", import.meta.url).pathname;
const MIME = { ".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".json":"application/json" };

// ── Load + resolve the real dense fixture (same cascade+rollup as the vitest golden) ──────
const fx = JSON.parse(readFileSync(new URL("../e2e/fixtures/schedules/dense-project.fixture.json", import.meta.url)));
const golden = JSON.parse(readFileSync(new URL("../e2e/fixtures/schedules/dense-project.golden.json", import.meta.url)));
// The fixture omits UI-only fields the real sample data always carries; without isExpanded:true
// every child row is treated as collapsed under its parent, so only the 8 phase rows would render.
const resolvedTasks = E.rollupParentDates(E.cascadeDates(fx.project.tasks))
  .map(t => ({ isExpanded: true, health: "gray", percentComplete: 0, responsibleParty: "", cost: "", notes: [], ...t }));

// ── Vendor the CDN libs locally (hermetic) ───────────────────────────────────────────────
const CA = "/root/.ccr/ca-bundle.crt";
const curlCache = (file, url) => {
  const fp = join(tmpdir(), file);
  if (!existsSync(fp)) {
    try { execFileSync("curl", ["-sSL", ...(existsSync(CA) ? ["--cacert", CA] : []), "-o", fp, url], { stdio: "ignore" }); }
    catch (e) { console.error(`Could not fetch ${url}:`, e.message); process.exit(2); }
  }
  return readFileSync(fp);
};
const LIB = {
  "react-dom/18.2.0/umd/react-dom.production.min.js": readFileSync(join(NM, "react-dom/umd/react-dom.production.min.js")),
  "react/18.2.0/umd/react.production.min.js": readFileSync(join(NM, "react/umd/react.production.min.js")),
  "@babel/standalone": curlCache("planyr-babel-standalone-7.min.js", "https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"),
  "@supabase/supabase-js": curlCache("planyr-supabase-js-2.js", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"),
};

const INJECT = `<script>(function(){try{
  var d=window.__PLANAR_DATA__; if(!d) return;
  d.view="gantt"; d.section="projects";
  d.settings=Object.assign({}, d.settings, {barLabels:{left:"start", right:"end", year:false}, holidays:{}});
  var proj=${JSON.stringify({ id: "e2e-dense", name: fx.project.name, labelAlign: "right", tasks: resolvedTasks })};
  d.projects={"e2e-dense":proj}; d.aPid="e2e-dense"; window.__PL_PID__="e2e-dense";
}catch(e){console.error("INJECT_ERR",e);}})();</script>`;

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (fp.endsWith("sequence/index.html"))
      body = body.toString().replace(/(<script id="planar-data">[\s\S]*?<\/script>)/, `$1${INJECT}`);
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/sequence/`;

const EXEC = process.env.PW_CHROME || ["/opt/pw-browsers/chromium-1228/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };
const overlap = (a, b, pad = 0) => a.left - pad < b.right && a.right + pad > b.left && a.top - pad < b.bottom && a.bottom + pad > b.top;

// 1600px viewport -> ganttW = 1600*0.46 = 736 -> pxPerDay = floor(736/365) = 2 -> zoomPct = 2/6*100 = 33%,
// matching the fixture's own "~33% zoom" spec without needing to drive the zoom control. Height is
// generously oversized so all 119 rows mount at once (no virtualization cutoff to work around).
const page = await browser.newPage({ viewport: { width: 1600, height: 3400 }, deviceScaleFactor: 1 });
await page.route("**/*", route => {
  const u = route.request().url();
  for (const key of Object.keys(LIB)) if (u.includes(key)) return route.fulfill({ status: 200, contentType: "text/javascript", body: LIB[key] });
  if (u.startsWith(base) || u.startsWith(`http://localhost:${server.address().port}`)) return route.continue();
  return route.abort();
});
const perr = [];
page.on("pageerror", e => perr.push("PAGEERR: " + e.message));
page.on("console", m => { if (m.type() === "error" && /INJECT_ERR/.test(m.text())) perr.push(m.text()); });

await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => perr.push("GOTO " + e.message));
await page.waitForSelector("[data-gantt-name]", { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(1200);

const probe = await page.evaluate(() => {
  const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; };
  const names = [...document.querySelectorAll("[data-gantt-name]")].map(el => ({ id: String(el.getAttribute("data-gantt-name")), text: el.textContent, mode: el.getAttribute("data-gantt-mode"), ...rect(el) }));
  const bars  = [...document.querySelectorAll("[data-gantt-bar]")].map(el => ({ id: String(el.getAttribute("data-gantt-bar")), kind: el.getAttribute("data-gantt-kind") || "leaf", ...rect(el) }));
  const paths = [...document.querySelectorAll("svg path")];
  const arrowheads = paths.filter(el => /^#/.test(el.getAttribute("fill") || "") && !el.getAttribute("stroke-dasharray")).map(rect);
  const connectors = paths.filter(el => (el.getAttribute("stroke-dasharray") || "").replace(/\s+/g, " ").trim() === "4 3").map(el => el.getAttribute("d") || "");

  const proj = window.__PLANAR_DATA__.projects[window.__PL_PID__];
  const zoomPctSpan = [...document.querySelectorAll("span")].find(el => /^\d{1,3}%$/.test((el.textContent || "").trim()));

  return { names, bars, arrowheads, connectors, taskCount: proj.tasks.length, zoomPctText: zoomPctSpan ? zoomPctSpan.textContent : null };
}).catch(e => ({ evalErr: String(e) }));

await page.screenshot({ path: OUT + "b629-dense-gantt-207.png" });

// ── Drive the REAL Export → "PDF / Print Exhibit" UI (not a manual buildGanttSVG call on the
// stale boot-time window.__PLANAR_DATA__ snapshot, which never gets updated after React mounts) so
// the print half reads from the SAME live React state the screen half rendered from — a true
// parity check, not a comparison against a stale copy. ──
let printProbe = { count: -1, nan: 0 };
try {
  await page.click('button[title="Export — PDF exhibit or web snapshot"]', { timeout: 10000 });
  await page.click('text=PDF / Print Exhibit', { timeout: 10000 });
  const iframeHandle = await page.waitForSelector('iframe[title="PDF Preview"]', { timeout: 15000 });
  const frame = await iframeHandle.contentFrame();
  await frame.waitForSelector('svg', { timeout: 20000 });
  await page.waitForTimeout(500);
  printProbe = await frame.evaluate(() => {
    // Pagination clones the whole absolutely-positioned exhibit content once per printed page
    // (each clone visually clipped to its slice), so querying the whole document double-counts
    // by the page count. The Gantt SVG itself is never data-sliced per page — scope to ONE
    // instance (the first svg carrying dep paths) for a true per-render connector count.
    const svgs = [...document.querySelectorAll("svg")].filter(s => s.querySelector("path.dep"));
    const paths = svgs.length ? [...svgs[0].querySelectorAll("path.dep")] : [];
    return { count: paths.length, nan: paths.filter(p => /NaN/.test(p.getAttribute('d') || "")).length };
  });
  await page.screenshot({ path: OUT + "b629-dense-gantt-207-export.png" });
} catch (e) {
  perr.push("EXPORT_UI: " + e.message);
}

if (probe.evalErr) { console.log("EVAL ERROR:", probe.evalErr); fails.push(probe.evalErr); }
else {
  console.log(`\nfixture: ${golden.taskCount} tasks (${golden.leafCount} leaf / ${golden.phaseCount} phase / ${golden.milestoneCount} milestone), predLinkCount=${golden.predLinkCount}`);
  console.log(`on-screen: names=${probe.names.length} bars=${probe.bars.length}/${golden.taskCount} connectors=${probe.connectors.length} arrowheads=${probe.arrowheads.length}  |  print: dep paths=${printProbe.count}  |  zoom label=${probe.zoomPctText}`);

  ok(probe.taskCount === golden.taskCount, `injected task count matches golden (${probe.taskCount} === ${golden.taskCount})`);
  ok(probe.bars.length >= golden.taskCount - golden.unscheduledCount, `every schedulable task rendered a bar/bracket/diamond on screen (${probe.bars.length}/${golden.taskCount}, only the ${golden.unscheduledCount} deliberately-blank row(s) may show the "Unscheduled" chip instead)`);
  ok(probe.names.length === probe.bars.length, `every rendered bar has a matching name label (${probe.names.length} names / ${probe.bars.length} bars)`);

  console.log("\n── 1. finite (no-NaN) dependency endpoints ──");
  const screenNan = probe.connectors.filter(d => /NaN/.test(d));
  ok(probe.connectors.length > golden.predLinkCount * 0.6, `a substantial, non-trivial number of dependency connectors rendered (${probe.connectors.length}, golden predLinkCount=${golden.predLinkCount})`);
  ok(screenNan.length === 0, `on-screen: 0 NaN connector paths (${screenNan.length} of ${probe.connectors.length})`);
  ok(printProbe.count >= 0, `print export UI produced a Gantt SVG (${printProbe.count} dep paths)`);
  ok(printProbe.nan === 0, `print: 0 NaN connector paths (${printProbe.nan} of ${printProbe.count})`);
  ok(probe.connectors.every(d => /C/.test(d)), `on-screen connectors are curved beziers, not degenerate/empty paths`);

  console.log("\n── 2. no label overlaps its OWN bar/bracket span ──");
  const barById = new Map(probe.bars.map(b => [b.id, b]));
  let selfHits = [], plateSkipped = 0;
  probe.names.forEach(n => {
    if (n.mode === "plate") { plateSkipped++; return; }   // intentional own-bar overlay w/ contrast plate
    const b = barById.get(n.id);
    if (b && overlap(n, b)) selfHits.push(`${n.text} (mode=${n.mode})`);
  });
  ok(selfHits.length === 0, `0 labels overlap their own span outside "plate" mode (${selfHits.length}; ${plateSkipped} plate-mode skipped) ${selfHits.slice(0,5).join(", ")}`);

  console.log("\n── 3. PDF/export parity (screen ↔ the real Export→PDF/Print Exhibit UI resolve the same links) ──");
  ok(probe.connectors.length === printProbe.count, `screen and the real print/export UI agree on connector count (${probe.connectors.length} === ${printProbe.count}) — unschedulable rows are silently skipped by BOTH, never a NaN arrow`);
}

ok(perr.length === 0, `no page/inject errors (${perr.length})`);
perr.slice(0, 6).forEach(e => console.log("    - " + e));

await page.close();
await browser.close(); server.close();
console.log("\n" + (fails.length === 0 ? "✅ PASS — V207 dense-Gantt ~33% zoom + PDF/export parity verified" : `❌ FAIL — ${fails.length} assertion(s):`));
fails.forEach(f => console.log("  - " + f));
process.exit(fails.length === 0 ? 0 : 1);
