#!/usr/bin/env node
/* detect-view-recompute — THE DETECTOR. Find, mechanically, every computation this app redoes
 * because the VIEW moved (NEW-1).
 *
 * ⛔ WHY THIS EXISTS, in the owner's words: *"we didn't find it for this, so find it for all the
 * other times. or all the other scenarios."* The same defect has now been found TWICE by accident:
 *   1. #926 / B1440 — `f2p` was `worldToScreen(view, …)`, so every element's pixel geometry was a
 *      function of the live view and a pan re-derived all of it. Fixing it took DOM mutation
 *      records per gesture from 101,267 to 2,194.
 *   2. The pond LABEL FIT — re-solved every frame, with the fit question asked in FEET, so during
 *      a pan (constant px-per-foot, constant ring, constant text) it recomputed an identical
 *      answer sixty times.
 * One class: VIEW-INDEPENDENT WORK REDONE BECAUSE THE VIEW MOVED. Finding the third by intuition
 * is not a plan. This is the instrument.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE METHOD
 *
 * Drive a gesture that changes ONLY the view, on a plan whose MODEL AND SETTINGS DO NOT CHANGE,
 * and record every instrumented computation that executes during it: identity (`file:line:name`,
 * assigned at build time by scripts/vite-plugin-recompute-probe.mjs), call count, wall time, a
 * fingerprint of its INPUTS and a fingerprint of its RESULT. Any computation that runs more than
 * once and answers identically is a violation of the class. `lib/viewIndependence.mjs` states the
 * rule and the four verdicts; this file only drives and prints.
 *
 * ⛔ THE COMPARISON HAS TO BE STRUCTURAL, WHICH IS THE WHOLE REASON THE CLASS HID FOR A YEAR.
 * Every instance of the bug returns a FRESH object holding an IDENTICAL answer, so a reference
 * compare — which is all React's own memo does — reports "changed" on 100% of them.
 *
 * THE FOUR SCENARIOS, because the owner asked for all of them and not just the pan:
 *   pan    constant px-per-foot. NOTHING that is a function of model + settings may run twice.
 *   zoom   px-per-foot genuinely changes, so the correct answer is "recomputed once per ppf
 *          change, not once per frame" — and a wheel gesture delivers many frames per ppf step.
 *   edit   ONE building is dragged. The correct answer is "only what depends on that element
 *          re-derives" — the memo-invalidation question this program has asked twice and never
 *          measured.
 *   panel  a panel opens and closes; #925 measured this at +34.4% of an identical gesture before
 *          the pan anchor landed and INCONCLUSIVE after.
 *
 * AND THE INVERSE CHECK, reported separately and never "fixed": anything memoised so hard that it
 * fails to change when the view legitimately should change it. The cull rect, the scale bar, the
 * north arrow and the LOD gates are legitimately view-derived — see VIEW_DERIVED below.
 *
 * SCALING. `--scale 1,2,4` replays each gesture on plans of increasing size (the reference plan's
 * elements duplicated), so the report can say whether a violation costs more as the owner draws
 * more — which is the half of the ranking NEW-2 is fixed in.
 *
 * USAGE (needs the PROBE build, which `--build` will make for you):
 *   node ui-audit/detect-view-recompute.mjs --build
 *   node ui-audit/detect-view-recompute.mjs --gestures pan,zoom --scale 1,2,4 --json
 *
 * Never exits non-zero on a measurement. It is an instrument, not a gate — the gate that USES it
 * is ui-audit/verify-view-independent.mjs.
 */
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { perfScenarioSite } from "./lib/perf-scenario.mjs";
import { classifyGesture, rankViolations, inverseFindings, formatSite } from "./lib/viewIndependence.mjs";
import { assertForeground } from "./lib/tabTiming.mjs";

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const DO_BUILD = process.argv.includes("--build");
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const GESTURES = String(argOf("--gestures", "pan,zoom,edit,panel")).split(",").map((s) => s.trim()).filter(Boolean);
const SCALES = String(argOf("--scale", "1")).split(",").map(Number).filter((n) => n >= 1);
const OUT_DIR = argOf("--out", "");
/* THE NOISE FLOOR. A gesture touches hundreds of instrumented sites and most violations are worth
 * a fraction of a millisecond; printing all of them buries the ones that matter. The tail is
 * COUNTED AND REPORTED rather than dropped silently — a harness that quietly truncates reads as
 * "covered everything" when it did not. `--min-ms 0` prints the lot. */
const MIN_MS = Number(argOf("--min-ms", "1.5"));
const PORT = Number(argOf("--port", 4188));
const BASE = `http://localhost:${PORT}/`;
const DIST = path.resolve("dist-probe");

/* ── The computations that are LEGITIMATELY a function of the view ───────────────────────────
 * Named here so the report can say "this one is supposed to move" rather than leaving a reader to
 * guess, and so the inverse check has something to assert against. Matched on `file:name`. */
export const VIEW_DERIVED = [
  "src/workspaces/site-planner/SitePlanner.jsx:labelFrame",   // the px-per-foot label decisions are made at
  "src/workspaces/site-planner/SitePlanner.jsx:renderView",   // the view a coordinate is baked at
  "src/workspaces/site-planner/SitePlanner.jsx:cursorLL",     // the cursor's lat/lng — a function of where the view is
];
/* ⛔ `cullRect` is NOT in that list any more and its absence is deliberate: as of NEW-2 it is a
 * LATCHED ref rather than a memo (lib/viewCull.js `cullRectFor`), so there is no memo site for the
 * probe to observe. Its view-derivedness is asserted instead by `test/panAnchor.test.js` (it reads
 * the LIVE view, never the anchor) and by `test/pureCache.test.js` (it re-arms on a zoom and on a
 * far enough pan, and always contains the true visible rect). */

/* ── Seeding: the reference plan, optionally multiplied ──────────────────────────────────────
 * Duplicating the committed fixture's own elements is the only honest scaling axis available in a
 * sandbox that cannot open the owner's heaviest signed-in plans. Copies are translated along X by
 * the plan's own width so they neither overlap (which would change junction/dissolve work) nor sit
 * off in empty space (which would fall out of the cull rect and be measured as free). */
function scaledSite(mult) {
  const base = perfScenarioSite();
  if (mult <= 1) return base;
  const xs = [];
  for (const e of base.els) {
    if (Array.isArray(e.pts)) for (const p of e.pts) xs.push(p.x);
    else if (Array.isArray(e.points)) for (const p of e.points) xs.push(p.x);
    else if (Number.isFinite(e.cx)) { xs.push(e.cx - e.w / 2, e.cx + e.w / 2); }
  }
  const span = (Math.max(...xs) - Math.min(...xs)) * 1.1 || 2000;
  const shift = (e, dx, k) => {
    const c = JSON.parse(JSON.stringify(e));
    c.id = `${e.id}-x${k}`;
    if (Array.isArray(c.pts)) c.pts = c.pts.map((p) => ({ ...p, x: p.x + dx }));
    if (Array.isArray(c.points)) c.points = c.points.map((p) => ({ ...p, x: p.x + dx }));
    if (Number.isFinite(c.cx)) c.cx += dx;
    return c;
  };
  const els = [...base.els];
  for (let k = 1; k < mult; k++) for (const e of base.els) els.push(shift(e, span * k, k));
  return { ...base, els };
}

function seedScript(mult) {
  const site = scaledSite(mult);
  return `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
  } catch (e) {} })();`;
}

/* ── The probe build ─────────────────────────────────────────────────────────────────────── */
function buildProbe() {
  execFileSync("npx", ["vite", "build", "--outDir", "dist-probe", "--emptyOutDir"], {
    stdio: JSON_OUT ? "ignore" : "inherit",
    env: { ...process.env, PLANYR_PROBE: "1" },
  });
}

function serve() {
  const p = spawn("npx", ["vite", "preview", "--outDir", "dist-probe", "--port", String(PORT), "--strictPort"], {
    stdio: "ignore", env: process.env, detached: false,
  });
  return p;
}

async function waitForServer(url, ms = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/* ── Gesture drivers ──────────────────────────────────────────────────────────────────────── */

/** A press point on BARE canvas — a centre press lands on an element and drags it instead of
 *  panning, which would make the "pure view gesture" control silently false. */
async function bareCanvasPoint(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    for (const fy of [0.5, 0.3, 0.7, 0.85]) for (const fx of [0.25, 0.5, 0.75, 0.12, 0.9]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (hit && svg.contains(hit) && !hit.closest("[data-el-id]")) return { x, y };
    }
    return { x: r.left + r.width * 0.15, y: r.top + r.height * 0.85 };
  });
}

const GESTURE_DRIVERS = {
  /* PAN — 60 pointermoves at constant px-per-foot. The control the whole detector rests on. */
  async pan(page) {
    const at = await bareCanvasPoint(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 0; i < 60; i++) await page.mouse.move(at.x + Math.sin(i / 6) * 300, at.y + Math.cos(i / 8) * 180);
    await page.mouse.up();
    await page.waitForTimeout(250);
  },

  /* ZOOM — a wheel gesture. px-per-foot genuinely changes, so a computation that is a function of
   * ppf SHOULD run; the question is whether it runs once per ppf STEP or once per FRAME. */
  async zoom(page) {
    const at = await bareCanvasPoint(page);
    await page.mouse.move(at.x, at.y);
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, i % 2 ? 120 : -120); await page.waitForTimeout(40); }
    await page.waitForTimeout(400);
  },

  /* EDIT — drag ONE building. The correct answer is "only what depends on that element
   * re-derives"; anything else that runs is the plan re-deriving itself for one moved box. */
  async edit(page) {
    const box = await page.evaluate(() => {
      const n = document.querySelector('[data-el-id]');
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!box) return { fault: "no element on canvas to drag" };
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(150);
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + i * 2, box.y + i);
    await page.mouse.up();
    await page.waitForTimeout(300);
    return null;
  },

  /* PANEL — open and close the yield panel, content unchanged. */
  async panel(page) {
    const tab = page.locator('[data-rail-tab="yield"]');
    if (!(await tab.count())) return { fault: "no yield rail tab" };
    await tab.first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    await tab.first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    return null;
  },
};

/* ── The run ──────────────────────────────────────────────────────────────────────────────── */

if (DO_BUILD) buildProbe();
if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(`No probe build at ${DIST}. Run with --build (or: PLANYR_PROBE=1 npx vite build --outDir dist-probe).`);
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, ".vite/probe-sites.json"), "utf8"));

const server = serve();
process.on("exit", () => { try { server.kill(); } catch { /* already gone */ } });
if (!(await waitForServer(BASE))) { server.kill(); console.error(`preview server never came up on ${BASE}`); process.exit(2); }

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const runs = [];

for (const mult of SCALES) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(seedScript(mult));
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  /* ⛔ A wall-clock reading from a BACKGROUND tab is void — a hidden tab clamps setTimeout, and a
     setTimeout-paced probe then times the clamp (measured: 3,156 ms for a 138-182 ms gesture).
     See ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting a throttled number. */
  await assertForeground(page, "detect-view-recompute");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
  await page.waitForTimeout(3000);

  const probeOk = await page.evaluate(() => !!window.__VPROBE__);
  if (!probeOk) {
    await browser.close(); server.kill();
    console.error("⛔ window.__VPROBE__ is absent — this is not a probe build. Re-run with --build.");
    process.exit(2);
  }
  const shape = await page.evaluate(() => ({
    els: document.querySelectorAll("[data-el-id]").length,
    canvasNodes: document.querySelector('[data-testid="planner-canvas"]')?.querySelectorAll("*").length || 0,
  }));
  const home = await page.evaluate(() => window.__plannerView?.get() || null);

  for (const g of GESTURES) {
    const drive = GESTURE_DRIVERS[g];
    if (!drive) { runs.push({ mult, gesture: g, fault: "unknown gesture" }); continue; }
    // Every arm starts from the same view, so rung N is not measured at a different scene.
    if (home) {
      await page.evaluate((h) => {
        const v = window.__plannerView;
        if (!v?.centerOn) return;
        const { w, h: hh } = v.get();
        v.centerOn((w / 2 - h.offX) / h.ppf, (hh / 2 - h.offY) / h.ppf, h.ppf);
      }, home);
      await page.waitForTimeout(300);
    }
    await page.evaluate((name) => window.__VPROBE__.begin(name), g);
    const t0 = Date.now();
    const fault = await drive(page);
    const wallMs = Date.now() - t0;
    const rep = await page.evaluate(() => window.__VPROBE__.end());
    const after = await page.evaluate(() => window.__plannerView?.get() || null);
    runs.push({
      mult, gesture: g, wallMs, fault: fault?.fault || null,
      elsOnCanvas: shape.els, canvasNodes: shape.canvasNodes,
      viewBefore: home, viewAfter: after,
      overheadMs: rep.overheadMs,
      sites: classifyGesture(rep.sites),
    });
  }
  await ctx.close();
}

await browser.close();
server.kill();

/* ── Report ───────────────────────────────────────────────────────────────────────────────── */

const ladders = {};
for (const r of runs) for (const s of r.sites || []) {
  (ladders[s.id] ||= []).push({ n: r.elsOnCanvas || r.mult, ms: s.ms, calls: s.calls, gesture: r.gesture });
}
const planSpan = Math.max(...runs.map((r) => r.elsOnCanvas || 0)) || 1;

const out = { base: BASE, instrumentedSites: manifest.length, scales: SCALES, gestures: GESTURES, runs: [] };
for (const r of runs) {
  const ladder = {};
  for (const [id, pts] of Object.entries(ladders)) ladder[id] = pts.filter((p) => p.gesture === r.gesture);
  const violations = rankViolations(r.sites || [], { ladders: ladder, planSpan });
  const instrumentedMs = (r.sites || []).reduce((a, s) => a + s.selfMs, 0);
  out.runs.push({
    gesture: r.gesture, mult: r.mult, elsOnCanvas: r.elsOnCanvas, canvasNodes: r.canvasNodes,
    wallMs: r.wallMs, probeOverheadMs: r.overheadMs, fault: r.fault,
    ranAtAll: (r.sites || []).length,
    instrumentedSelfMs: +instrumentedMs.toFixed(1),
    coveragePct: r.wallMs ? +((instrumentedMs / r.wallMs) * 100).toFixed(1) : null,
    violations,
    inverse: r.gesture === "zoom" ? inverseFindings(r.sites || [], VIEW_DERIVED) : [],
    productive: (r.sites || []).filter((s) => s.verdict === "productive").map((s) => `${s.file}:${s.line} ${s.name} ×${s.calls}`),
  });
}

if (OUT_DIR) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "view-recompute.json"), JSON.stringify(out, null, 2));
}
if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

console.log(`\nVIEW-INDEPENDENT WORK DETECTOR (NEW-1)`);
console.log(`  probe build: ${DIST}  ·  ${manifest.length} instrumented sites  ·  ${manifest.filter((m) => m.kind === "memo").length} memos / ${manifest.filter((m) => m.kind === "fn").length} exported functions`);
for (const r of out.runs) {
  console.log(`\n── ${r.gesture.toUpperCase()}  ×${r.mult} (${r.elsOnCanvas} elements on canvas, ${r.canvasNodes} canvas nodes) ──`);
  if (r.fault) console.log(`  ⚠ ${r.fault}`);
  console.log(`  gesture ${r.wallMs} ms · ${r.ranAtAll} sites executed · instrumented self-time ${r.instrumentedSelfMs} ms (${r.coveragePct}% of the gesture) · probe overhead ${r.probeOverheadMs} ms`);
  if (!r.violations.length) console.log(`  ✅ no computation ran more than once with an identical answer`);
  const shown = r.violations.filter((v) => v.wasteMs >= MIN_MS);
  const tail = r.violations.length - shown.length;
  for (const v of shown) {
    console.log(`  ${formatSite(v)}  (${v.renders} renders reached it)`);
    console.log(`        priority ${v.priority}  waste ${v.wasteMs} ms  scaling: ${v.scale.shape}${v.scale.slope != null ? ` (${v.scale.slope} ms/element)` : ""}${v.truncated ? "  ⚠ sampled" : ""}`);
  }
  if (tail) console.log(`  … and ${tail} more below the ${MIN_MS} ms floor (${r.violations.reduce((a, v) => a + (v.wasteMs < MIN_MS ? v.wasteMs : 0), 0).toFixed(1)} ms between them) — --min-ms 0 prints them`);
  if (r.inverse.length) {
    console.log(`  INVERSE CHECK (declared view-derived but did not move under zoom):`);
    for (const f of r.inverse) console.log(`    ${f.id} — ${f.finding}: ${f.note}`);
  }
}
console.log("");
