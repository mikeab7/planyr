// NEW-1 — every task name in the Gantt CHART renders ABOVE its bar, never centered on or inside it.
//
// Owner report (2026-07-31, Grand Port → Schedule → Split view, 33% zoom): "on the bar in the Gantt
// chart, the task name is IN THE MIDDLE of the Gantt chart bar … I don't want it in the middle. I
// just want it ABOVE the bar just like every other bar."
//
// This drives the REAL Schedule app against the owner's REAL Grand Port program (213 tasks pulled
// from planyr_production, e2e/fixtures/schedules/grand-port.fixture.json — NOT a synthetic fixture)
// in SPLIT view at 33% zoom, and measures every rendered name against its own bar's rect.
//
// The invariant, asserted on the live DOM and on the print SVG (PDF-PARITY):
//   (1) every name's box sits ENTIRELY ABOVE its bar/diamond/bracket — name.bottom <= bar.top;
//   (2) no name renders in an on-bar "plate" mode, and no contrast plate is painted behind one;
//   (3) every visible row still HAS a name (a fit failure may never blank a label — the B1188 rule);
//   (4) it holds at every zoom step and for all three alignment settings, so there is no per-row
//       variation and no zoom at which the rule changes.
//
// Hermetic: the sequence app pulls React/Babel/Supabase off CDNs, so those are routed to local
// copies exactly as ui-audit/verify-gantt-labels-deps.mjs does.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { expandFixture, visibleTasks } from "../e2e/fixtures/schedules/expand.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const NM = new URL("../node_modules/", import.meta.url).pathname;
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const FIXTURE = JSON.parse(readFileSync(new URL("../e2e/fixtures/schedules/grand-port.fixture.json", import.meta.url), "utf8"));
const GRAND_PORT = expandFixture(FIXTURE);
const VISIBLE = visibleTasks(GRAND_PORT.tasks);

const CA = "/root/.ccr/ca-bundle.crt";
const curlCache = (file, url) => {
  const fp = join(tmpdir(), file);
  if (!existsSync(fp)) execFileSync("curl", ["-sSL", ...(existsSync(CA) ? ["--cacert", CA] : []), "-o", fp, url], { stdio: "ignore" });
  return readFileSync(fp);
};
const LIB = {
  "react-dom/18.2.0/umd/react-dom.production.min.js": readFileSync(join(NM, "react-dom/umd/react-dom.production.min.js")),
  "react/18.2.0/umd/react.production.min.js": readFileSync(join(NM, "react/umd/react.production.min.js")),
  "@babel/standalone": curlCache("planyr-babel-standalone-7.min.js", "https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"),
  "@supabase/supabase-js": curlCache("planyr-supabase-js-2.js", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"),
};
const routeCDN = async page => {
  await page.route("**/*", route => {
    const u = route.request().url();
    for (const key of Object.keys(LIB)) if (u.includes(key)) return route.fulfill({ status: 200, contentType: "text/javascript", body: LIB[key] });
    if (/^https?:\/\/localhost/.test(u) || /127\.0\.0\.1/.test(u)) return route.continue();
    return route.abort();
  });
};

// Seed the owner's REAL Grand Port program as the only/active project, in SPLIT view.
const INJECT = `<script>(function(){try{
  var d=window.__PLANAR_DATA__; if(!d) return;
  var params=new URLSearchParams(location.search);
  var proj=${JSON.stringify(GRAND_PORT)};
  if(params.get("align")) proj.labelAlign=params.get("align");
  d.projects={"2":proj}; d.aPid=2; d.nPid=3; d.nTid={"2":400};
  d.view=params.get("view")||"split"; d.section="projects";
  window.__PL_ALIGN__=proj.labelAlign;
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

const BENIGN = [/supabase\.co/i, /CORS/i, /ERR_FAILED/i, /WebSocket/i, /Failed to load resource/i, /Cloud unreachable/i, /realtime/i, /BABEL/i, /deoptimised/i];
const EXEC = process.env.PW_CHROME || ["/opt/pw-browsers/chromium-1228/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync)
  || ["/opt/pw-browsers/chromium/chrome", "/opt/pw-browsers/chromium-1187/chrome-linux/chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };

// Measure every rendered name against the bar of its own row.
const measure = async page => page.evaluate(() => {
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  const out = [];
  for (const el of document.querySelectorAll("[data-gantt-name]")) {
    const id = el.getAttribute("data-gantt-name");
    const bar = document.querySelector(`[data-gantt-bar="${id}"]`);
    const r = el.getBoundingClientRect();
    const br = bar ? bar.getBoundingClientRect() : null;
    out.push({
      id: +id, text: norm(el.textContent), mode: el.getAttribute("data-gantt-mode"),
      nameTop: +r.top.toFixed(2), nameBottom: +r.bottom.toFixed(2), nameW: +r.width.toFixed(2),
      barTop: br ? +br.top.toFixed(2) : null, barBottom: br ? +br.bottom.toFixed(2) : null,
      plated: getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)",
    });
  }
  return { names: out, zoomLabel: (() => {
    for (const s of document.querySelectorAll("span")) if (/^\d+%$/.test(norm(s.textContent))) return norm(s.textContent);
    return null;
  })() };
});

const zoomTo = async (page, targetPct) => {
  // The "+" zoom control steps ppd by ×1.35 (ceil): 1 → 2 → 3 → 5 …, i.e. 17% → 33% → 50% → 83%.
  // Click until the readout reaches the target, and STOP once it has passed it (the readout is the
  // ground truth — never keep clicking, which is how a 45% target once ran away to 1333%).
  for (let i = 0; i < 10; i++) {
    const cur = (await measure(page)).zoomLabel;
    if (cur === `${targetPct}%` || parseInt(cur, 10) >= targetPct) return cur;
    const btn = page.locator("button", { hasText: "+" }).first();
    if (!(await btn.count())) break;
    await btn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(120);
  }
  return (await measure(page)).zoomLabel;
};

// The chart is VERTICALLY VIRTUALIZED — only ~45 of the program's 168 visible rows are in the DOM
// at once. Measuring one screenful proves nothing about the rest (the first sampling of this
// harness saw zero defects at the reported zoom purely because the offending rows were 90 rows
// down), so sweep the whole pane and merge every row we ever see.
const sweepAllRows = async (page) => {
  const seen = new Map();
  const pane = page.locator("[data-gantt-name]").first();
  const scroller = await pane.evaluateHandle(el => {
    let n = el.parentElement;
    while (n && n.scrollHeight <= n.clientHeight + 4) n = n.parentElement;
    return n || document.scrollingElement;
  });
  const maxScroll = await scroller.evaluate(el => Math.max(0, el.scrollHeight - el.clientHeight));
  const step = Math.max(160, Math.floor((await scroller.evaluate(el => el.clientHeight)) * 0.7));
  for (let top = 0; top <= maxScroll + step; top += step) {
    await scroller.evaluate((el, t) => { el.scrollTop = t; }, Math.min(top, maxScroll));
    await page.waitForTimeout(90);
    const probe = await measure(page);
    probe.names.forEach(n => { if (!seen.has(n.id) || n.barTop != null) seen.set(n.id, n); });
    if (top >= maxScroll) break;
  }
  await scroller.evaluate(el => { el.scrollTop = 0; });
  await page.waitForTimeout(120);
  return [...seen.values()];
};

async function pass(align, { zoomPct = 33, view = "split" } = {}) {
  console.log(`\n── align="${align}" · ${view} view · ${zoomPct}% zoom ─────────────`);
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  await routeCDN(page);
  const real = [];
  page.on("console", m => { if (m.type() === "error" && !BENIGN.some(r => r.test(m.text()))) real.push(m.text()); });
  page.on("pageerror", e => { if (!BENIGN.some(r => r.test(e.message))) real.push("PAGEERROR: " + e.message); });
  await page.goto(`${base}?align=${align}&view=${view}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: " + e.message));
  await page.waitForSelector("[data-gantt-name]", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(900);
  const reached = await zoomTo(page, zoomPct);
  await page.waitForTimeout(500);

  await page.screenshot({ path: `${OUT}gantt-label-above-${align}-${zoomPct}.png` });
  const names = await sweepAllRows(page);
  const probe = { names };

  ok(names.length >= 120, `${names.length} in-chart names swept across the whole real Grand Port program (zoom readout ${reached})`);

  // (1) EVERY name sits entirely above its own bar.
  const withBar = probe.names.filter(n => n.barTop != null);
  const onBar = withBar.filter(n => n.nameBottom > n.barTop + 0.5);
  ok(onBar.length === 0, `every name is ABOVE its bar (${onBar.length} of ${withBar.length} overlap their bar)`);
  if (onBar.length) onBar.slice(0, 12).forEach(n => console.log(`      · "${n.text}" mode=${n.mode} name ${n.nameTop}–${n.nameBottom} vs bar top ${n.barTop}`));

  // (2) no on-bar "plate" mode and no contrast plate painted behind a name.
  const modes = [...new Set(probe.names.map(n => n.mode))].sort();
  ok(modes.length === 1 && modes[0] === "above", `every name reports mode="above" (saw ${JSON.stringify(modes)})`);
  const plated = probe.names.filter(n => n.plated);
  ok(plated.length === 0, `no name paints a contrast plate behind itself (${plated.length})`);

  // (3) nothing vanished — every rendered row still carries its name text.
  const blank = probe.names.filter(n => !n.text);
  ok(blank.length === 0, `no rendered name is blank (${blank.length})`);

  ok(real.length === 0, `no uncaught page errors (${real.length})`);
  real.slice(0, 6).forEach(e => console.log("    - " + e));
  await page.close();
  return probe;
}

// ── the owner's exact repro, then the other two alignments and a zoom sweep ────────
console.log(`Grand Port fixture: ${GRAND_PORT.tasks.length} tasks, ${VISIBLE.length} visible with the saved collapse state; labelAlign="${GRAND_PORT.labelAlign}"`);
await pass(GRAND_PORT.labelAlign, { zoomPct: 33 });      // the reported case, verbatim
for (const a of ["left", "right"]) await pass(a, { zoomPct: 33 });
for (const z of [17, 50]) await pass(GRAND_PORT.labelAlign, { zoomPct: z });
await pass(GRAND_PORT.labelAlign, { zoomPct: 33, view: "gantt" });

// ── PDF-PARITY: the print path must agree ─────────────────────────────────────────
console.log(`\n── print path (buildGanttSVG) ────────────────────────────────`);
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await routeCDN(page);
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await page.waitForSelector("[data-gantt-name]", { timeout: 25000 }).catch(() => {});
  const svgProbe = await page.evaluate((proj) => {
    const res = {};
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-99999px;top:0;width:1200px";
    document.body.appendChild(host);
    for (const align of ["left", "center", "right"]) {
      const svg = String(window.buildGanttSVG([proj], 1100, "landscape", { barNames: true, labelAlign: align, zoomMul: 0.33 }) || "");
      // MEASURED, not string-matched: render the exhibit SVG and compare each name caption's real
      // box against the real glyph boxes sharing its row band. Name captions are the only <text>
      // the sheet emits with dominant-baseline="central" (the grid-column names and the date bar
      // labels use the baseline default), which is how they're told apart.
      host.innerHTML = svg;
      const root = host.querySelector("svg");
      const ROW_H = 18, HEADER_H = 30, W = 1100;
      const bandOf = y => Math.floor((y - HEADER_H) / ROW_H);
      const capsByRow = new Map(), glyphsByRow = new Map();
      for (const t of root.querySelectorAll('text[dominant-baseline="central"]')) {
        const b = t.getBBox(), row = bandOf(b.y + b.height / 2);
        (capsByRow.get(row) || capsByRow.set(row, []).get(row)).push(b.y + b.height);
      }
      for (const g of root.querySelectorAll("rect, polygon")) {
        const b = g.getBBox();
        if (b.width >= W - 1) continue;               // the row band / page background, not a glyph
        if (b.height >= ROW_H) continue;              // header bands, gridlines spanning the chart
        const row = bandOf(b.y + b.height / 2);
        (glyphsByRow.get(row) || glyphsByRow.set(row, []).get(row)).push(b.y);
      }
      let rows = 0, onGlyph = 0, worst = 0;
      for (const [row, bottoms] of capsByRow) {
        const tops = glyphsByRow.get(row);
        if (!tops || !tops.length) continue;
        rows++;
        const over = Math.max(...bottoms) - Math.min(...tops);
        if (over > 0.5) { onGlyph++; worst = Math.max(worst, over); }
      }
      res[align] = {
        texts: (svg.match(/<text/g) || []).length,
        plates: (svg.match(/<rect[^>]*fill="#fff"[^>]*opacity="0\.85"/g) || []).length,
        nan: /NaN/.test(svg), rows, onGlyph, worst: +worst.toFixed(2),
      };
    }
    host.remove();
    return res;
  }, GRAND_PORT);
  for (const align of ["left", "center", "right"]) {
    const r = svgProbe[align];
    ok(r.texts > 50, `print SVG (${align}) emits the names (${r.texts} <text>)`);
    ok(r.plates === 0, `print SVG (${align}) paints NO on-bar contrast plate (${r.plates})`);
    ok(!r.nan, `print SVG (${align}) has no NaN geometry`);
    ok(r.rows > 100, `print SVG (${align}) measured ${r.rows} rows with both a caption and a glyph`);
    ok(r.onGlyph === 0, `print SVG (${align}) — every caption is ABOVE its glyph (${r.onGlyph} overlap, worst ${r.worst}px)`);
  }
  await page.close();
}

await browser.close(); server.close();
console.log("\n" + (fails.length === 0 ? "✅ PASS — every Gantt name renders above its bar" : `❌ FAIL — ${fails.length} assertion(s):`));
fails.forEach(f => console.log("  - " + f));
process.exit(fails.length === 0 ? 0 : 1);
