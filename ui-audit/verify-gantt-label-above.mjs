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
// NEW-1 (2026-11-04, name RANK) adds a third invariant, measured off the real computed font sizes at
// the owner's row heights (rowHeight 20 / 24 / 34): the higher a task sits in the hierarchy the LARGER
// its name — at every row height, for every kind (summary / leaf / milestone) — and a milestone name is
// never smaller than a leaf name at its level. Also saves the before/after crops
// (ui-audit/screens/gantt-rank-*.png). SEQ_HTML=<path> serves an alternate sequence/index.html (the
// "before" build) from the same harness; RANK_ONLY=1 skips everything but the rank passes, RANK_TAG=before
// names the saved crops.
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
import { expandFixture, visibleTasks, depthOf } from "../e2e/fixtures/schedules/expand.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

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
  if(params.get("deps")){ var ts=proj.tasks; for(var i=2;i<ts.length;i++){ if(i%2===0) ts[i].predecessors=[{id:ts[i-1].id,type:"FS"}]; if(i%7===0) ts[i].predecessors=(ts[i].predecessors||[]).concat([{id:ts[i-2].id,type:"SS"}]); } }
  if(params.get("rowH")) d.settings=Object.assign({},d.settings,{rowHeight:+params.get("rowH")});
  d.projects={"2":proj}; d.aPid=2; d.nPid=3; d.nTid={"2":400};
  d.view=params.get("view")||"split"; d.section="projects";
  window.__PL_ALIGN__=proj.labelAlign;
}catch(e){console.error("INJECT_ERR",e);}})();</script>`;

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (fp.endsWith("sequence/index.html") && process.env.SEQ_HTML) body = await readFile(process.env.SEQ_HTML);
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
      fs: parseFloat(getComputedStyle(el).fontSize),
      barKind: bar ? bar.getAttribute("data-gantt-kind") : null, barH: br ? +br.height.toFixed(2) : null,
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
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "verify-gantt-label-above");
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
if (!process.env.RANK_ONLY) {
await pass(GRAND_PORT.labelAlign, { zoomPct: 33 });      // the reported case, verbatim
for (const a of ["left", "right"]) await pass(a, { zoomPct: 33 });
for (const z of [17, 50]) await pass(GRAND_PORT.labelAlign, { zoomPct: z });
await pass(GRAND_PORT.labelAlign, { zoomPct: 33, view: "gantt" });
}

// ── NEW-1 (name RANK): size follows the hierarchy at every row height ─────────────────────────────
// Kind/level come from the REAL fixture (the app derives level from the parent chain the same way).
const KIND_OF = new Map(), LEVEL_OF = new Map();
{
  const isP = t => GRAND_PORT.tasks.some(x => x.parentId === t.id);
  for (const t of GRAND_PORT.tasks) {
    KIND_OF.set(t.id, isP(t) ? "summary" : t.duration === 0 ? "milestone" : "leaf");
    LEVEL_OF.set(t.id, depthOf(GRAND_PORT.tasks, t.id));
  }
}
const RANKED = lv => [9.5, 8.5, 8.5, 8][Math.min(lv, 3)];
const SHOT_IDS = ["Permitting/Entitlements", "Platting", "Baytown Platting", "Submit Preliminary Plat", "Determine Bonding Amount"]
  .map(n => GRAND_PORT.tasks.find(t => t.name === n)?.id).filter(Boolean);

async function rankPass(rowH, tag = "after") {
  console.log(`\n── RANK · rowHeight ${rowH} · split view · 33% zoom (${tag}) ──────────────`);
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 3 });
  await assertMeasurable(page, "verify-gantt-label-above");
  await routeCDN(page);
  const real = [];
  page.on("pageerror", e => { if (!BENIGN.some(r => r.test(e.message))) real.push("PAGEERROR: " + e.message); });
  await page.goto(`${base}?align=${GRAND_PORT.labelAlign}&view=split&rowH=${rowH}&deps=1`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: " + e.message));
  await page.waitForSelector("[data-gantt-name]", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(900);
  await zoomTo(page, 33);
  await page.waitForTimeout(500);
  const names = await sweepAllRows(page);
  // known-good arm: the row height the app is really using must be the one asked for (else this run is VOID).
  const rhSeen = await page.evaluate(() => { const r = document.querySelector("[data-gantt-row]"); const q = [...document.querySelectorAll("[data-gantt-row]")].slice(0, 2).map(e => e.getBoundingClientRect().top); return q.length > 1 ? Math.round(q[1] - q[0]) : null; });
  ok(rhSeen === rowH, `the chart is really at row height ${rowH} (measured row pitch ${rhSeen})`);
  const rows = names.map(n => ({ ...n, kind: KIND_OF.get(n.id), level: Math.min(LEVEL_OF.get(n.id) ?? 0, 3) })).filter(n => n.kind);
  ok(rows.length >= 120, `${rows.length} names measured`);
  {
    const by = (k, lv) => rows.filter(n => n.kind === k && n.level === lv).map(n => n.fs);
    const uniform = (k, lv) => { const a = by(k, lv); return a.length ? Math.max(...a) - Math.min(...a) < 0.01 : true; };
    // (a) every name of a given kind+level is drawn at exactly its ranked size, at THIS row height
    const wrong = rows.filter(n => Math.abs(n.fs - RANKED(n.level)) > 0.01);
    ok(wrong.length === 0, `every name is drawn at its full ranked size (${wrong.length} are not)`);
    wrong.slice(0, 8).forEach(n => console.log(`      · ${n.kind} L${n.level} "${n.text}" fs ${n.fs} (ranked ${RANKED(n.level)})`));
    // (b) rank across the measured set: min size at level N >= max size at level N+1; level 0 strictly above level 1
    const minAt = lv => Math.min(...rows.filter(n => n.level === lv).map(n => n.fs)), maxAt = lv => Math.max(...rows.filter(n => n.level === lv).map(n => n.fs));
    for (const lv of [0, 1, 2]) if (rows.some(n => n.level === lv) && rows.some(n => n.level === lv + 1))
      ok(minAt(lv) >= maxAt(lv + 1) - 0.01, `level ${lv} names (min ${minAt(lv)}) are not smaller than level ${lv + 1} names (max ${maxAt(lv + 1)})`);
    ok(minAt(0) > maxAt(1), `level 0 (${minAt(0)}) is strictly larger than level 1 (${maxAt(1)})`);
    // (c) a milestone name is never smaller than a leaf name at its level
    for (const lv of [1, 2, 3]) { const m = by("milestone", lv), l = by("leaf", lv);
      if (m.length && l.length) ok(Math.min(...m) >= Math.max(...l) - 0.01, `milestone L${lv} name (${Math.min(...m)}) >= leaf L${lv} name (${Math.max(...l)})`); }
    // (d) bracket rank survives: a level's bracket is at least as tall as the level below it, and it still has legs
    const brH = lv => { const a = rows.filter(n => n.kind === "summary" && n.level === lv && n.barH != null).map(n => n.barH); return a.length ? Math.min(...a) : null; };
    for (const lv of [0, 1, 2]) if (brH(lv) != null && brH(lv + 1) != null) ok(brH(lv) >= brH(lv + 1) - 0.01, `bracket L${lv} (${brH(lv)}) >= bracket L${lv + 1} (${brH(lv + 1)})`);
    ok(brH(0) != null && brH(0) >= 4, `the top bracket still reads as a bracket, span + legs (${brH(0)} tall)`);
    // (e) nothing sits on its glyph
    const onBar = rows.filter(n => n.barTop != null && n.nameBottom > n.barTop + 0.5);
    ok(onBar.length === 0, `every name is above its glyph (${onBar.length} overlap)`);
    onBar.slice(0, 8).forEach(n => console.log(`      · ${n.kind} L${n.level} "${n.text}" bottom ${n.nameBottom} vs glyph top ${n.barTop}`));
    ok(uniform("summary", 0) && uniform("leaf", 3), "same kind + level = same size (no per-row variation)");
  }
  // (f) dependency arrows still LAND ON the glyphs: every connector endpoint sits on the top or bottom EDGE of a
  // rendered bar / bracket / diamond (the arrow code and the renderer read ONE shared geometry — this proves it
  // on the real DOM). Known-good arm: the fixture must actually produce arrows, else the run is VOID.
  {
    const scroller = await page.locator("[data-gantt-name]").first().evaluateHandle(el => { let n = el.parentElement; while (n && n.scrollHeight <= n.clientHeight + 4) n = n.parentElement; return n; });
    let total = 0, landed = 0; const missed = [];
    for (const frac of [0, 0.35, 0.7]) {
      await scroller.evaluate((el, f) => { el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) * f); }, frac);
      await page.waitForTimeout(220);
      const r = await page.evaluate(() => {
        const bars = [...document.querySelectorAll("[data-gantt-bar]")].map(e => e.getBoundingClientRect());
        const out = { total: 0, landed: 0, missed: [] };
        for (const svg of document.querySelectorAll("svg")) {
          const sr = svg.getBoundingClientRect();
          for (const path of svg.querySelectorAll('path[stroke-dasharray="4 3"]')) {
            const m = /M([-\d.]+),([-\d.]+) C[^L]*? ([-\d.]+),([-\d.]+)$/.exec(path.getAttribute("d").trim());
            if (!m) continue;
            for (const [x, y] of [[+m[1], +m[2]], [+m[3], +m[4]]]) {
              const cx = sr.left + x, cy = sr.top + y; out.total++;
              // x tolerance 4: every row carries a 3px transparent left border that offsets bars from the arrow layer (long-standing, not this item's); the VERTICAL landing is what the shared geometry owns, held to 0.7.
              const hit = bars.some(b => cx >= b.left - 4 && cx <= b.right + 4 && (Math.abs(cy - b.top) < 0.7 || Math.abs(cy - b.bottom) < 0.7));
              if (hit) out.landed++; else if (out.missed.length < 4) out.missed.push([+cx.toFixed(1), +cy.toFixed(1)]);
            }
          }
        }
        return out;
      });
      total += r.total; landed += r.landed; missed.push(...r.missed);
    }
    if (process.env.RANK_DEBUG) console.log('   debug', JSON.stringify(await page.evaluate(() => ({ svgs: document.querySelectorAll('svg').length, dashed: document.querySelectorAll('path[stroke-dasharray]').length, sample: [...document.querySelectorAll('path[stroke-dasharray]')].slice(0,2).map(p => [p.getAttribute('d'), p.getAttribute('stroke-dasharray')]) }))));
    ok(total >= 40, `arrow check is not vacuous (${total} connector endpoints inspected)`);
    ok(landed === total, `every arrow endpoint lands on a glyph's top/bottom edge (${landed}/${total})${missed.length ? " e.g. " + JSON.stringify(missed) : ""}`);
    await scroller.evaluate(el => { el.scrollTop = 0; });
  }
  // before / after crops for the owner's eye
  for (const id of SHOT_IDS) {
    const el = page.locator(`[data-gantt-name="${id}"]`).first();
    await el.evaluate(e => e.scrollIntoView({ block: "center" })).catch(() => {});
    await page.waitForTimeout(160);
    const b = await el.boundingBox().catch(() => null);
    if (b) await page.screenshot({ path: `${OUT}gantt-rank-${tag}-row${rowH}-t${id}.png`, clip: { x: Math.max(0, b.x - 120), y: Math.max(0, b.y - 36), width: 560, height: 110 } });
  }
  ok(real.length === 0, `no uncaught page errors (${real.length})`);
  await page.close();
  return rows;
}
const RANK_ROWS = (process.env.RANK_ROWS || "20,24,34").split(",").map(Number);
for (const rh of RANK_ROWS) await rankPass(rh, process.env.RANK_TAG || "after");

// ── PDF-PARITY: the print path must agree ─────────────────────────────────────────
console.log(`\n── print path (buildGanttSVG) ────────────────────────────────`);
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "verify-gantt-label-above");
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
  // NEW-1 (name RANK) on the PRINT sheet: each caption's real font size is its ranked print size (9 / 8.5 / 8 / 7.5
  // by level), the top level is larger than the next, milestones are not at the 6.5 floor, and the sheet is saved as
  // a before/after crop (tag via RANK_TAG).
  {
    const host = await page.evaluate((proj) => {
      const svg = String(window.buildGanttSVG([proj], 1100, "landscape", { barNames: true, labelAlign: proj.labelAlign, zoomMul: 1 }) || "");
      const el = document.createElement("div"); el.id = "printHost"; el.style.cssText = "position:absolute;left:0;top:0;width:1100px;background:#fff;z-index:99999";
      el.innerHTML = svg; document.body.appendChild(el);
      const caps = [...el.querySelectorAll('text[dominant-baseline="central"]')].map(t => ({ s: t.textContent, fs: parseFloat(t.getAttribute("font-size")) }));
      return { caps };
    }, GRAND_PORT);
    const RANKED_PRINT = lv => [9, 8.5, 8, 7.5][Math.min(lv, 3)];
    const levelsByName = new Map();
    for (const t of GRAND_PORT.tasks) { const a = levelsByName.get(t.name) || new Set(); a.add(Math.min(depthOf(GRAND_PORT.tasks, t.id), 3)); levelsByName.set(t.name, a); }
    const bad = [], seenLv = {};
    for (const c of host.caps) {
      const raw = c.s.replace(/&amp;/g, "&"); const lv = levelsByName.get(raw);
      if (!lv || lv.size !== 1) continue; const L = [...lv][0];
      (seenLv[L] ||= new Set()).add(c.fs);
      if (Math.abs(c.fs - RANKED_PRINT(L)) > 0.01) bad.push(`${raw} L${L} fs ${c.fs} (ranked ${RANKED_PRINT(L)})`);
    }
    ok(host.caps.length > 100 && Object.keys(seenLv).length >= 4, `print rank check is not vacuous (${host.caps.length} captions, levels seen ${Object.keys(seenLv).join(",")})`);
    ok(bad.length === 0, `every print caption is drawn at its full ranked size (${bad.length} are not)${bad.length ? " e.g. " + bad.slice(0, 4).join(" | ") : ""}`);
    ok(Math.min(...seenLv[0]) > Math.max(...seenLv[1]), `print: level 0 (${[...seenLv[0]]}) is larger than level 1 (${[...seenLv[1]]})`);
    const tag = process.env.RANK_TAG || "after";
    const row = id => GRAND_PORT.tasks.findIndex(t => t.id === id);
    for (const id of SHOT_IDS) {
      const y0 = 30 + row(id) * 18 - 22;           // HEADER_H 30 + row pitch 18, a row of air above
      await page.screenshot({ path: `${OUT}gantt-rank-print-${tag}-t${id}.png`, fullPage: true, clip: { x: 360, y: Math.max(0, y0), width: 740, height: 76 } }).catch(e => console.log("   (print crop failed: " + e.message.split("\n")[0] + ")"));
    }
    await page.locator("#printHost").evaluate(e => e.remove());
  }
  await page.close();
}

await browser.close(); server.close();
console.log("\n" + (fails.length === 0 ? "✅ PASS — every Gantt name renders above its bar" : `❌ FAIL — ${fails.length} assertion(s):`));
fails.forEach(f => console.log("  - " + f));
process.exit(fails.length === 0 ? 0 : 1);
