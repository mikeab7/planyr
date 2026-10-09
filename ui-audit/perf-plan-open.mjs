#!/usr/bin/env node
/* perf-plan-open — SIGNED-IN plan open / switch: how long does the main thread stall while a plan finishes loading? (NEW-1, B2224000)
 *
 * The owner's own signed-in Chrome (build bae75b0, MessageChannel ping-gap heartbeat): Bolt-on → Concept A gaps of 908, 560, 118 ms within ~2 s
 * of the switch; Concept A → Bolt-on 226 + 253 ms; no GIS fetches fired, so the stall is the app's own plan-open work.
 *
 * WHAT IT DRIVES. A dist build served on localhost; the Supabase host answered by `lib/planOpenRig.mjs` from the owner's REAL plans
 * (ui-audit/fixtures/plan-load/*.json: slim `sites.data` header + live `site_elements` rows, owner records stripped). The app boots with a
 * resumable fake session, so the real signed-in path runs: cloud pull → row fetch → engine seed → reconcile → mount.
 *
 * INSTRUMENT. A MessageChannel ping-gap heartbeat (the gap between two consecutive port messages is the longest uninterrupted main-thread task;
 * it keeps firing in a hidden tab, where `longtask` entries do not) + long-animation-frame script attribution for WHO. Known-good arm: a
 * deliberate 200 ms busy loop must read as a ~200 ms gap before any score is trusted, else the run is VOID.
 *
 *   xvfb-run -a node ui-audit/perf-plan-open.mjs --dist <dir> [--runs 3] [--label x] [--only cold-bolt-on,switch] [--json] [--out f.json] [--assert]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { authSessionSeed, cloudCacheSeed, detectSupabase } from "./lib/authRemount.mjs";
import { loadPlans, planRouteHandler, padLibrary } from "./lib/planOpenRig.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { planOpenVerdict } from "./lib/planOpenVerdict.mjs";
import { resolveCallFrame } from "./lib/resolveOffset.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);
const DIST = argOf("--dist", join(HERE, "..", "dist"));
const RUNS = Number(argOf("--runs", 3)) || 3;
const LABEL = argOf("--label", "run"), OUT = argOf("--out", "");
const ONLY = (argOf("--only", "") || "").split(",").filter(Boolean);
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PROFILE = has("--profile");
/* --cpu <rate>: CDP CPU throttling (B2233521). A faster container reads every switch under the owner's bar while his Chrome reads 50–120 ms on the same
 * build, so the rig is calibrated to HIS reading on the baseline build before a fix is scored (stated in every run's output — a throttled number is not a
 * claim about his hardware, only a way to put the same work above the same bar). */
const CPU_RATE = Number(argOf("--cpu", 1)) || 1;
const TRACE = argOf("--trace", "");   // --trace <prefix>: a Chromium performance trace per switch hop (devtools.timeline + v8), for the non-script half of a long frame
let traceN = 0;
async function traceStart(page) { if (!TRACE) return false; await browser.startTracing(page, { path: `${TRACE}.${++traceN}.json`, categories: (process.env.TRACE_CATS || "devtools.timeline,toplevel,v8,disabled-by-default-v8.gc").split(",") }); return true; }
async function traceStop(on) { if (on) await browser.stopTracing(); }
const SETTLE_MS = Number(argOf("--settle", 6000)) || 6000;     // the window each action is scored over: 6 s, so the rows seed (the rig has no websocket; its 4 s fallback lands ~4.1–4.6 s after a switch) and its render are inside it
if (!existsSync(join(DIST, "index.html"))) { console.error(`perf-plan-open: no build at ${DIST}`); process.exit(2); }

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".map": "application/json" };
const server = createServer((req, res) => {
  const u = (req.url || "/").split("?")[0].split("#")[0];
  let p = join(DIST, u === "/" ? "index.html" : u.replace(/^\/+/, ""));
  if (!existsSync(p) || p.endsWith("/")) p = join(DIST, "index.html");
  try { res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream", "cache-control": "no-store" }); res.end(readFileSync(p)); } catch (_) { res.writeHead(404); res.end("nope"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const SB = detectSupabase(DIST);
if (!SB) { console.error("perf-plan-open: the build carries no Supabase host (build with VITE_SUPABASE_URL=https://bootauth.supabase.co VITE_SUPABASE_ANON_KEY=dummy)"); process.exit(2); }

/* ---- in-page instrument (a FUNCTION, injected before any app code) ---- */
const INSTRUMENT = () => {
  window.__PLANYR_LEGACY_MIRROR = "idle";   // measure the PRODUCTION policy: the legacy whole-library mirror refresh is off the save path (the automation default is "sync")
  window.__gaps = []; window.__loaf = []; window.__hb = { last: performance.now(), n: 0 };
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { const t = performance.now(), g = t - window.__hb.last; window.__hb.n++; if (g > 30) window.__gaps.push([Math.round(window.__hb.last), Math.round(t), Math.round(g)]); window.__hb.last = t; ch.port2.postMessage(0); };
  ch.port2.postMessage(0);
  window.__lt = []; window.__tiles = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { const m = /\/tile\/(\d+)\/(\d+)\/(\d+)/.exec(e.name); if (m) window.__tiles.push([Math.round(e.startTime), +m[1]]); } }).observe({ type: "resource", buffered: true }); } catch (_) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true }); } catch (_) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__loaf.push({ t: Math.round(e.startTime), d: Math.round(e.duration), rs: Math.round((e.renderStart || 0) - e.startTime), sl: Math.round((e.styleAndLayoutStart || 0) - e.startTime), sd: Math.round((e.scripts || []).reduce((a, s) => a + s.duration, 0)), fsl: Math.round((e.scripts || []).reduce((a, s) => a + (s.forcedStyleAndLayoutDuration || 0), 0)), s: (e.scripts || []).map((s) => ({ inv: s.invoker || "", fn: s.sourceFunctionName || "", u: String(s.sourceURL || "").split("/").pop(), p: s.sourceCharPosition, d: Math.round(s.duration) })) }); }).observe({ type: "long-animation-frame", buffered: true }); } catch (_) {}
  let reqs = 0; window.__rows = 0; window.__commits = 0;
  const F = window.fetch; window.fetch = function (...a) { try { const u = String((a[0] && a[0].url) || a[0]); if (/site_elements\?select=id/.test(u)) window.__rows++; if (/rpc\/commit_elements/.test(u)) window.__commits++; } catch (_) {} return F.apply(this, a); };
  void reqs;
};

const LIBRARY = Number(argOf("--library", 0)) || 0;     // extra plans on the account (the owner has 143)
const fixturePlans = loadPlans(["concept-a", "bolt-on", "richfield"]);
const plans = padLibrary(fixturePlans, LIBRARY);
/* Bolt-on is the newest row so a cold boot lands on it; the others follow. */
plans.find((p) => p.key === "bolt-on").header.updatedAt = Date.now();
const browser = await chromium.launch({ executablePath: EXEC, headless: false, args: ["--no-sandbox", "--enable-precise-memory-info"] });

async function newRun(startPlan) {
  const ctx = await browser.newContext({ viewport: { width: 1722, height: 700 }, deviceScaleFactor: 2.15 });
  await ctx.route("**", planRouteHandler({ base: BASE, supabaseUrl: SB.url, plans }));
  await ctx.addInitScript(authSessionSeed({ ref: SB.ref, url: SB.url }));
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();
  await assertMeasurable(page, "perf-plan-open");
  if (CPU_RATE > 1) { const c = await ctx.newCDPSession(page); await c.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE }); }
  return { ctx, page };
}
const reading = (page) => page.evaluate(() => ({ now: performance.now(), gaps: window.__gaps.slice(), lt: window.__lt.slice(), tiles: window.__tiles.slice(), loaf: window.__loaf.slice(), rows: window.__rows, commits: window.__commits, road: window.__roadNetStats ? (() => { const n = window.__roadNetStats(), b = window.__rb || {}; const o = {}; for (const k in n) o[k] = n[k] - (b[k] || 0); return o; })() : null }));
const named = (page, n) => page.waitForFunction((x) => (document.body.innerText || "").includes(x), n, { timeout: 60000 });
const chip = (page, text) => page.locator("span:visible", { hasText: new RegExp(`^${text}$`) }).first();
const pick = (page, text) => page.locator("*:visible", { hasText: new RegExp(`^${text}$`) }).last();
/* THE CLICK THAT IS SCORED MUST BE THE APP'S, NOT THE DRIVER'S: a locator like `*:visible` + hasText walks every element of the page (a 48-59 ms task in the CPU
 * profile of a switch) and would run inside the window. So the chip is clicked and the menu settles FIRST, the target is resolved to a handle, and the window opens in
 * the same page task that dispatches the click (page-JS .click() — no actionability polling, no driver scroll). */
const features = (page) => page.evaluate(() => new Set([...document.querySelectorAll("[data-feature]")].map((n) => n.getAttribute("data-feature"))).size);

/* the known-good arm: a deliberate 200 ms busy loop MUST read as ~200 ms, or nothing below is trusted */
async function selfTest(page) {
  const before = await reading(page);
  await page.evaluate(() => new Promise((r) => setTimeout(() => { const t = performance.now(); while (performance.now() - t < 200); r(); }, 50)));
  await pacedWait(page, 300);
  const after = await reading(page);
  const g = after.gaps.filter((x) => x[0] >= before.now - 5).map((x) => x[2]);
  return Math.max(0, ...g);
}

/* score one action: everything the heartbeat/LoAF saw from `t0` for SETTLE_MS */
async function score(page, t0, label, planKey, extra = {}) {
  await pacedWait(page, SETTLE_MS);
  const r = await reading(page);
  const gaps = r.gaps.filter((g) => g[0] >= t0 - 2 && g[0] <= t0 + SETTLE_MS);
  const loaf = r.loaf.filter((f) => f.t >= t0 - 2 && f.t <= t0 + SETTLE_MS && f.d >= 50);
  /* Every main-thread gap the heartbeat saw, CLASSED (B2225425 round 3): "task" = one long task covers most of it (the longtask
   * entry, which a visible tab reports); "queue" = no single long task — the heartbeat's message waited behind a run of short tasks
   * (measured: ~125 aerial-tile responses arriving together, ~550 sub-6 ms tasks in 130 ms). Both are main-thread time the owner's
   * heartbeat counts; only "task" blocks input outright (input is scheduled ahead of a posted message). Nothing is dropped. */
  const cls = (g) => { const cov = (r.lt || []).reduce((m, [ls, ld]) => Math.max(m, Math.min(g[1], ls + ld) - Math.max(g[0], ls)), 0); return cov >= 0.7 * g[2] ? "task" : "queue"; };
  const classed = gaps.map((g) => [g[0] - Math.round(t0), g[2], cls(g)]);
  const over = (k) => classed.filter((g) => g[1] > 50 && (!k || g[2] === k));
  return { label, plan: planKey, feat: await features(page), maxMs: Math.max(0, ...gaps.map((g) => g[2])), gaps: classed,
    maxTaskMs: Math.max(0, ...classed.filter((g) => g[2] === "task").map((g) => g[1])), maxQueueMs: Math.max(0, ...classed.filter((g) => g[2] === "queue").map((g) => g[1])),
    over50Task: over("task").length, over50Queue: over("queue").length,
    tileReqs: (() => { const t = (r.tiles || []).filter((x) => x[0] >= t0 - 2 && x[0] <= t0 + SETTLE_MS); const by = {}; for (const [, z] of t) by[z] = (by[z] || 0) + 1; return { n: t.length, byZoom: by, firstMs: t.length ? Math.round(t[0][0] - t0) : null, lastMs: t.length ? Math.round(t[t.length - 1][0] - t0) : null }; })(), over50: gaps.filter((g) => g[2] > 50).length, sumOver50: gaps.filter((g) => g[2] > 50).reduce((s, g) => s + g[2], 0),
    frames: loaf.map((f) => ({ at: f.t - Math.round(t0), d: f.d, script: f.sd, forcedLayout: f.fsl, renderStart: f.rs, styleLayoutStart: f.sl, scripts: f.s.filter((s) => s.d >= 20).map((s) => `${s.inv || s.fn}:${s.u}:${s.p}=${s.d}`) })), rowFetches: r.rows, commits: r.commits, roadCaches: r.road, ...extra };
}

/* Chromium's own accounting of where main-thread time went (Performance.getMetrics, deltas over an action): script vs style-recalc vs layout, and how many of each.
 * A frame whose LoAF entry lists no script is rendering-pipeline work, which a CPU profile of JS cannot see. */
const METRIC_KEYS = ["ScriptDuration", "RecalcStyleDuration", "LayoutDuration", "TaskDuration", "RecalcStyleCount", "LayoutCount", "Nodes"];
async function metricsStart(page) { const c = await page.context().newCDPSession(page); await c.send("Performance.enable"); const get = async () => Object.fromEntries((await c.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value])); return { c, m0: await get(), get }; }
async function metricsStop(h) { const m1 = await h.get(); const out = {}; for (const k of METRIC_KEYS) out[k] = k.endsWith("Duration") ? Math.round((m1[k] - h.m0[k]) * 1000) : k === "Nodes" ? m1[k] : m1[k] - h.m0[k]; await h.c.detach().catch(() => {}); return out; }

/* --profile: a CDP sampling profile over each action, folded to SELF time per function and mapped through the build's sourcemaps.
 * Samples are also bucketed by time since the action so "the click handler" and "the render 4 s later" are separable. */
async function profStart(page) { if (!PROFILE) return null; const c = await page.context().newCDPSession(page); await c.send("Profiler.enable"); await c.send("Profiler.setSamplingInterval", { interval: 250 }); await c.send("Profiler.start"); return c; }
async function profStop(c) {
  if (!c) return undefined;
  const { profile } = await c.send("Profiler.stop"); await c.detach().catch(() => {});
  if (process.env.PROFILE_DUMP) writeFileSync(`${process.env.PROFILE_DUMP}.${Date.now()}.cpuprofile`, JSON.stringify(profile));
  const byId = new Map(profile.nodes.map((n) => [n.id, n])); const self = new Map(); let t = 0;
  profile.samples.forEach((sid, i) => { const dt = profile.timeDeltas[i] / 1000; t += dt; const cf = byId.get(sid).callFrame;
    if (cf.functionName === "(idle)" || cf.functionName === "(program)" || cf.functionName === "(root)") return;
    const k = `${cf.functionName || "(anon)"} ${String(cf.url).split("/").pop()}:${cf.lineNumber}:${cf.columnNumber}`;
    const e = self.get(k) || { ms: 0, cf }; e.ms += dt; self.set(k, e); });
  return [...self.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 18).map(([k, e]) => ({ ms: +e.ms.toFixed(1), fn: k, src: resolveCallFrame(DIST, e.cf.url, e.cf.lineNumber, e.cf.columnNumber) }));
}
async function coldOpen(key, name, label) {
  const target = plans.find((p) => p.key === key), was = plans.map((p) => p.header.updatedAt);
  target.header.updatedAt = Date.now() + 1000;
  try {
    const { ctx, page } = await newRun();
    const t0 = 0; const pc = await profStart(page); const tr = await traceStart(page);
    await page.goto(`${BASE}#/project/smqfy2r7pdec/site`, { waitUntil: "load" });
    await page.locator('[data-testid="planner-canvas"]').waitFor({ timeout: 60000 }); await named(page, name);
    const sc = await score(page, t0, label, key); await traceStop(tr); sc.profile = await profStop(pc);
    const st = await selfTest(page); await ctx.close(); return [{ ...sc, selfTestMs: st }];
  } finally { plans.forEach((p, i) => { p.header.updatedAt = was[i]; }); }
}
/* one plan switch through the header's own chips, scored from the page task that dispatches the click (shared by `switch` and `first-open`) */
async function hopTo(page, out, from, to, label, key) {
  await chip(page, from).click(); await pacedWait(page, 700);
  const h = await pick(page, to).elementHandle();
  const pc = await profStart(page);
  const tr = await traceStart(page);
  const mh = await metricsStart(page);
  const t0 = await h.evaluate((el) => { window.__rb = window.__roadNetStats ? window.__roadNetStats() : null; const t = performance.now(); el.click(); return t; });
  await named(page, to);
  const sc = await score(page, t0, label, key); await traceStop(tr); sc.profile = await profStop(pc); sc.chromium = await metricsStop(mh);
  out.push(sc);
}
const SCEN = {
  /* B2233521 round 5 — THE FIRST OPEN OF A PLAN THIS DEVICE HAS NEVER DRAWN, by a switch in a fresh profile: land on Concept A (cold), then open Bolt-on. Bolt-on has no
   * device copy, so its rows seed draws it in ONE render that computes its road network, metrics and parcel work for the first time (the "switch" scenario's first hop is
   * Concept A, which is smaller and has no roads — it under-reads this). */
  async "first-open"() {
    const target = plans.find((p) => p.key === "concept-a"), was = plans.map((p) => p.header.updatedAt);
    target.header.updatedAt = Date.now() + 1000;
    try {
      const { ctx, page } = await newRun();
      await page.goto(`${BASE}#/project/smqfy2r7pdec/site`, { waitUntil: "load" });
      await page.locator('[data-testid="planner-canvas"]').waitFor({ timeout: 60000 }); await named(page, "Concept A");
      await pacedWait(page, 6000);
      const out = [];
      await hopTo(page, out, "Concept A", "Bolt-on", "Concept A → Bolt-on (first open, fresh profile)", "bolt-on");
      out[0].selfTestMs = await selfTest(page); await ctx.close(); return out;
    } finally { plans.forEach((p, i) => { p.header.updatedAt = was[i]; }); }
  },
  /* straight onto a plan from a cold start (the route a pasted link / reload takes) */
  async "cold-bolt-on"() { return coldOpen("bolt-on", "Bolt-on", "cold open Bolt-on"); },
  /* B2233521 round 5 — OPENING THE APP FRESH THE WAY THE OWNER DOES: not a first-ever visit but a RELOAD of a page that has been open on a plan (the device copy, the active-plan
   * marker and the cloud index are all in storage; every JS chunk, Leaflet, the map and the React tree are cold). The page lands on the plan directly, so this is the cold
   * load without the map-first detour the empty-profile "cold open" rows take. */
  async "reload-onto-plan"() {
    const { ctx, page } = await newRun();
    await page.goto(`${BASE}#/project/smqfy2r7pdec/site`, { waitUntil: "load" });
    await page.locator('[data-testid="planner-canvas"]').waitFor({ timeout: 60000 }); await named(page, "Bolt-on");
    await pacedWait(page, 9000);   // let the rows seed land, the autosave write the device copy and the mirror settle
    const pc = await profStart(page); const tr = await traceStart(page);
    await page.reload({ waitUntil: "load" });
    await page.locator('[data-testid="planner-canvas"]').waitFor({ timeout: 60000 }); await named(page, "Bolt-on");
    const sc = await score(page, 0, "reload onto a plan (app opened fresh)", "bolt-on"); await traceStop(tr); sc.profile = await profStop(pc);
    sc.selfTestMs = await selfTest(page); await ctx.close(); return [sc];
  },
  /* B2233521 round 5 — THE PRICE OF BUILDING THE MAP WHEN IT IS FIRST SHOWN: the app opened fresh on a plan (reload), then the Map crumb is clicked. Before round 5 the map was built
   * hidden at boot, so this click was instant and the cost sat in the cold load; now the cost sits here, once. Scored from the page task that dispatches the click. */
  async "open-map-after-reload"() {
    const { ctx, page } = await newRun();
    await page.goto(`${BASE}#/project/smqfy2r7pdec/site`, { waitUntil: "load" });
    await page.locator('[data-testid="planner-canvas"]').waitFor({ timeout: 60000 }); await named(page, "Bolt-on");
    await pacedWait(page, 9000);
    await page.reload({ waitUntil: "load" });
    await page.locator('[data-testid="planner-canvas"]').waitFor({ timeout: 60000 }); await named(page, "Bolt-on");
    await pacedWait(page, 7000);
    const h = await page.locator('[data-mode-active="true"] [data-testid="dashboard-crumb"]').first().elementHandle();
    const t0 = await h.evaluate((el) => { const t = performance.now(); el.click(); return t; });
    await page.locator('[data-mode="map"][data-mode-active="true"] .leaflet-container').first().waitFor({ timeout: 60000 });
    const sc = await score(page, t0, "plan → Map (first time after the app opened on a plan)", "bolt-on");
    sc.feat = sc.feat || 1;   // the map has no planner features to census — the Leaflet container above is the proof it opened
    sc.selfTestMs = await selfTest(page); await ctx.close(); return [sc];
  },
  /* B2225425 round 3 — the other plan of the pair, cold (the group route lands on the group's most recently updated plan) */
  async "cold-concept-a"() { return coldOpen("concept-a", "Concept A", "cold open Concept A"); },
  /* Bolt-on → Concept A → Bolt-on → Concept A (the last is a plan already opened this session) */
  async "switch"() {
    const { ctx, page } = await newRun();
    await page.goto(`${BASE}#/project/smqfy2r7pdec/site`, { waitUntil: "load" });
    await page.locator('[data-testid="planner-canvas"]').waitFor({ timeout: 60000 }); await named(page, "Bolt-on");
    await pacedWait(page, 6000);
    const out = [];
    const hop = (from, to, label, key) => hopTo(page, out, from, to, label, key);
    await hop("Bolt-on", "Concept A", "Bolt-on → Concept A (first visit)", "concept-a");
    await hop("Concept A", "Bolt-on", "Concept A → Bolt-on (back)", "bolt-on");
    await hop("Bolt-on", "Concept A", "Bolt-on → Concept A (revisit)", "concept-a");
    /* B2233521 — a SECOND round trip. The owner switches back and forth between two plans his device already holds; the first three hops
     * above each carry a first-time cost of the rig (no device copy → the rows seed draws the plan ~4 s in). These two are the steady state
     * he measured: both plans already open once this session. */
    await hop("Concept A", "Bolt-on", "Concept A → Bolt-on (back, 2nd)", "bolt-on");
    await hop("Bolt-on", "Concept A", "Bolt-on → Concept A (revisit, 2nd)", "concept-a");
    /* B2233521 — THE CONTROL: the same window, the same page, NO switch. Under `--cpu` throttling the browser's own throttler pauses the
     * main thread in slices, and a heartbeat task that straddles a pause reads as a gap with nothing behind it (measured: a 58 ms
     * `onmessage` with no other event inside it, at ×3). This row is that floor, so no switch row is read below it. */
    { await pacedWait(page, 700); const t0 = await page.evaluate(() => performance.now()); out.push(await score(page, t0, "control: no switch (instrument floor)", "concept-a")); }
    out[0].selfTestMs = await selfTest(page); await ctx.close(); return out;
  },
  /* a different PROJECT: Grand Port → Richfield (the larger plan) and back */
  async "switch-project"() {
    const { ctx, page } = await newRun();
    await page.goto(`${BASE}#/project/smqfy2r7pdec/site`, { waitUntil: "load" });
    await page.locator('[data-testid="planner-canvas"]').waitFor({ timeout: 60000 }); await named(page, "Bolt-on");
    await pacedWait(page, 6000);
    const out = [];
    await chip(page, "Grand Port").click(); await pacedWait(page, 700);
    let h = await pick(page, "Richfield").elementHandle();
    let pc = await profStart(page);
    let t0 = await h.evaluate((el) => { window.__rb = window.__roadNetStats ? window.__roadNetStats() : null; const t = performance.now(); el.click(); return t; });
    await chip(page, "Richfield").waitFor({ timeout: 60000 });
    let sc = await score(page, t0, "Grand Port → Richfield (larger plan)", "richfield"); sc.profile = await profStop(pc); out.push(sc);
    await chip(page, "Richfield").click(); await pacedWait(page, 700);
    h = await pick(page, "Grand Port").elementHandle();
    pc = await profStart(page);
    t0 = await h.evaluate((el) => { window.__rb = window.__roadNetStats ? window.__roadNetStats() : null; const t = performance.now(); el.click(); return t; });
    await chip(page, "Grand Port").waitFor({ timeout: 60000 });
    sc = await score(page, t0, "Richfield → Grand Port (back)", "bolt-on"); sc.profile = await profStop(pc); out.push(sc);
    out[0].selfTestMs = await selfTest(page); await ctx.close(); return out;
  },
};

const results = {};
try {
  for (const name of Object.keys(SCEN)) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    results[name] = [];
    for (let i = 0; i < RUNS; i++) {
      try { results[name].push(await SCEN[name]()); } catch (e) { results[name].push([{ label: `${name} run ${i}`, error: e.message.split("\n").slice(0, 4).join(" | ") }]); }
      process.stderr.write(`· ${name} run ${i + 1}/${RUNS}\n`);
    }
  }
} finally { await browser.close(); server.close(); }

const budgetFile = existsSync(join(HERE, "perf-plan-open.budget.json")) ? JSON.parse(readFileSync(join(HERE, "perf-plan-open.budget.json"), "utf8")) : {};
/* a throttled run is scored against the 2x budget (byLabelCpu2, B2236000): the 1x budgets are not a statement about a throttled CPU */
const budget = CPU_RATE >= 2 && budgetFile.byLabelCpu2 ? { ...budgetFile, byLabel: { ...(budgetFile.byLabel || {}), ...budgetFile.byLabelCpu2 } } : budgetFile;
const verdict = planOpenVerdict(results, budget);
const doc = { label: LABEL, dist: DIST, runs: RUNS, cpuRate: CPU_RATE, results, verdict };
if (OUT) writeFileSync(OUT, JSON.stringify(doc, null, 1));
if (has("--json")) console.log(JSON.stringify(doc, null, 1)); else console.log(`\n${LABEL}${CPU_RATE > 1 ? ` (CPU throttled ×${CPU_RATE})` : ""}\n` + verdict.lines.join("\n"));
if (has("--assert") && !verdict.pass) process.exit(1);
