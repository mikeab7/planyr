#!/usr/bin/env node
/* diagnose-silvestri-zoom-freeze — ONE ZOOM STEP, ON HIS REAL SILVESTRI PLAN, AT HIS REAL SCREEN. (NEW-1 / B2096832)
 *
 *   node ui-audit/diagnose-silvestri-zoom-freeze.mjs --base http://127.0.0.1:4173 [--dist <dir with .map files>]
 *        [--fixture sylvestri] [--steps 8] [--profile] [--json] [--label <text>]
 *
 * THE REPORT IT ANSWERS. The owner pressed the help button on Silvestri ("Concept D - Retail", plan
 * `sms4zs8unbkg`, build 49a80ab, 2026-09-28 20:05Z). The capture says: 24 worst long tasks all 283–307 ms,
 * clustered on his zoom gestures, 15 of 16 attributed to a function the minifier called `U`. That
 * attribution had survived four builds because nobody had ever turned `U` back into a function.
 * (Answer, from a sourcemapped rebuild of 49a80ab: `U` = the React scheduler's `performWorkUntilDeadline`,
 * the MessageChannel handler that runs EVERY scheduled React render; `Lv` = react-dom's
 * `dispatchContinuousEvent`. So the 300 ms blocks are React render+commit work scheduled by the zoom — the
 * question is WHICH components, which is what `--profile` answers.)
 *
 * WHAT IS HELD EQUAL TO HIS CAPTURE: the real fixture (no synthesised geometry) · dpr 2.125 · viewport 904×416
 * · four GIS layers mounted (`ly 4`) · ppf starting near his 0.375. WHAT CANNOT BE REPRODUCED HERE (said, not
 * hidden): GIS hosts are egress-blocked, so his layers MOUNT but never FETCH — a lower bound on the layer cost.
 *
 * ⛔ FOREGROUND-OR-VOID: `assertMeasurable` before anything is read. ⛔ ONE wheel event per task (a MessageChannel
 * pump), because React 18 batches a whole task's setStates and a burst in one task measures the wrong thing.
 * The per-step number is the LONG-ANIMATION-FRAME blocking time attributed to the step's own window.
 *
 * KNOWN-GOOD ARM: the harness refuses to print a verdict unless the view really moved on every step
 * (`data-view-ppf` changed), because a gesture that moved nothing samples a beautiful 60 fps.
 */
import { chromium } from "playwright";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";
import { readFixture, cachedRaster } from "./lib/fixtureSeeding.mjs";
import { withLayerArm, idbPutInPage, fixtureSeed, rasterIdbPlan } from "./lib/planFixture.mjs";
import { pngDataUrl } from "./lib/synthRaster.mjs";
import { makeSourceLocator } from "./lib/sourceMapIndex.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = (argOf("--base", "http://127.0.0.1:4173")).replace(/\/$/, "");
const DIST = argOf("--dist", join(HERE, "..", "dist"));
const FIXTURE = argOf("--fixture", "sylvestri");
const STEPS = Number(argOf("--steps", 8));
const DPR = Number(argOf("--dpr", 2.125));
const VW = Number(argOf("--vw", 904)), VH = Number(argOf("--vh", 416));
const PROFILE = process.argv.includes("--profile");
const JSON_OUT = process.argv.includes("--json");
const LABEL = argOf("--label", "");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SITE_ID = "sms4zs8unbkg";

const locators = new Map();
try {
  for (const f of readdirSync(join(DIST, "assets")).filter((n) => n.endsWith(".js.map"))) {
    try { locators.set(f.replace(/\.map$/, ""), makeSourceLocator(JSON.parse(readFileSync(join(DIST, "assets", f), "utf8")))); } catch (_) { /* leave that chunk minified */ }
  }
} catch (_) { /* no maps — profile stays minified and says so */ }
const frameName = (cf) => {
  const file = String(cf.url || "").split("/").pop().split("?")[0];
  const at = locators.get(file)?.(cf.lineNumber || 0, cf.columnNumber || 0);
  const fn = cf.functionName || "(anon)";
  return at ? `${fn} ${at.source.replace(/^.*?(src\/|node_modules\/)/, "$1")}:${at.line}` : `${fn} ${file}:${(cf.lineNumber || 0) + 1}`;
};

const FIXTURE_FILE = argOf("--fixture-file", null); // an absolute path to a scratch fixture (e.g. a fresher pull) instead of a committed one
const CPU = Number(argOf("--cpu-throttle", 1));
const fixture = withLayerArm(FIXTURE_FILE ? JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) : readFixture(FIXTURE), "owner-4");

const installProbe = () => {
  window.__loaf = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__loaf.push({
          s: e.startTime, d: e.duration, b: e.blockingDuration || 0,
          rs: (e.renderStart || e.startTime) - e.startTime, sl: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
          fl: (e.scripts || []).reduce((a, x) => a + (x.forcedStyleAndLayoutDuration || 0), 0),
          sc: (e.scripts || []).map((x) => ({ fn: x.sourceFunctionName || "", inv: x.invoker || "", url: String(x.sourceURL || "").split("/").pop().split("?")[0], pos: x.sourceCharPosition, d: x.duration })),
        });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch (_) { window.__loafUnsupported = true; }
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--enable-precise-memory-info"] });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR });
await ctx.addInitScript(fixtureSeed(fixture, { id: SITE_ID }));
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; }); // arms the read-only view hook (centerOn) only
await ctx.addInitScript(installProbe);
await ctx.route(/^https?:\/\//, (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE)) return route.continue();
  const t = parseTileUrl(url);
  if (t) return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "no-store" }, body: fakeTilePng(t.z, t.x, t.y) });
  return route.abort();
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
for (const { key, spec } of rasterIdbPlan(fixture, SITE_ID)) {
  const r = cachedRaster(spec, join(HERE, ".raster-cache"));
  const wrote = await page.evaluate(idbPutInPage, { key, value: pngDataUrl(r.png) });
  if (wrote !== true) throw new Error(`IndexedDB write for ${key} did not confirm`);
}
await page.goto(`${BASE}/#/project/${SITE_ID}/site`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 60000 });
await assertMeasurable(page, "diagnose-silvestri-zoom-freeze");
await pacedWait(page, 3500);

const census = await page.evaluate(() => {
  const c = document.querySelector('[data-testid="planner-canvas"]');
  return {
    ppf: Number(c.getAttribute("data-view-ppf")),
    elementsInDom: new Set([...c.querySelectorAll("[data-feature]")].map((n) => n.getAttribute("data-feature"))).size,
    domNodes: document.getElementsByTagName("*").length,
    canvasNodes: c.getElementsByTagName("*").length,
    loafSupported: !window.__loafUnsupported,
  };
});
if (!census.loafSupported) throw new Error("long-animation-frame unsupported in this Chromium — cannot attribute blocks");
if (census.elementsInDom < 50) throw new Error(`only ${census.elementsInDom} features rendered — the real plan did not load (expected ~140); refusing to report`);

/* Start where HIS capture was (ppf 0.375). The plan opens framed far out in this sandbox; a zoom at the wrong
 * altitude measures a different scene. */
const START_PPF = Number(argOf("--start-ppf", 0.375));
await page.evaluate((p) => window.__plannerView?.centerOn(0, 0, p), START_PPF);
await pacedWait(page, 2500);
census.ppfAfterCenter = await page.evaluate(() => +document.querySelector('[data-testid="planner-canvas"]').getAttribute("data-view-ppf"));
if (Math.abs(census.ppfAfterCenter - START_PPF) > 0.02) throw new Error(`could not place the view at ppf ${START_PPF} (got ${census.ppfAfterCenter}) — window.__plannerView.centerOn unavailable`);

census.afterCenter = await page.evaluate(() => {
  const c = document.querySelector('[data-testid="planner-canvas"]');
  return { features: new Set([...c.querySelectorAll("[data-feature]")].map((n) => n.getAttribute("data-feature"))).size, canvasNodes: c.getElementsByTagName("*").length, domNodes: document.getElementsByTagName("*").length, tiles: document.querySelectorAll(".leaflet-tile").length };
});

if (process.argv.includes("--leaflet-probe")) {
  await page.evaluate(() => {
    const m = window.__geoMap; if (!m) throw new Error("window.__geoMap missing");
    window.__lp = { inval: [], setView: 0, reset: 0, overscan: new Set() };
    const wrap = (name, fn) => { const o = m[name].bind(m); m[name] = (...a) => { const t = performance.now(); const r = o(...a); fn(performance.now() - t, a); return r; }; };
    wrap("invalidateSize", (d) => { window.__lp.inval.push(+d.toFixed(1)); window.__lp.overscan.add(m.getContainer().style.inset); });
    wrap("setView", () => { window.__lp.setView++; });
  });
}
const box = await page.locator('[data-testid="planner-canvas"]').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const view = () => page.evaluate(() => { const c = document.querySelector('[data-testid="planner-canvas"]'); return +c.getAttribute("data-view-ppf"); });

/* One wheel event in its own task, then wait for the browser to actually paint (2 rAFs) — the step's window
 * is [dispatch, second rAF]. */
const stepWheel = (dy) => page.evaluate(([delta, x, y]) => new Promise((done) => {
  const el = document.querySelector('[data-testid="planner-canvas"]');
  const ch = new MessageChannel();
  ch.port1.onmessage = () => {
    const t0 = performance.now();
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    requestAnimationFrame(() => requestAnimationFrame(() => done({ t0, t1: performance.now() })));
  };
  ch.port2.postMessage(0);
}), [dy, cx, cy]);

await page.mouse.move(cx, cy);
await pacedWait(page, 300);
if (PROFILE) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 250 }); await cdp.send("Profiler.start"); }

const GESTURE = argOf("--gesture", "steps");
const gestureT0 = await page.evaluate(() => performance.now()); // boot / centerOn frames are NOT the gesture
const steps = [];
const burstFrames = [];
if (GESTURE === "burst") {
  /* A trackpad / free-wheel gesture: one wheel event per FRAME for ~1.3 s in, then the same out. */
  const run = (dy, n) => page.evaluate(([delta, count, x, y]) => new Promise((done) => {
    const el = document.querySelector('[data-testid="planner-canvas"]');
    let i = 0, last = performance.now();
    const out = [];
    const tick = (now) => {
      out.push(now - last); last = now;
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      if (++i < count) requestAnimationFrame(tick); else requestAnimationFrame((t2) => { out.push(t2 - last); done(out); });
    };
    requestAnimationFrame(tick);
  }), [dy, n, cx, cy]);
  for (let r = 0; r < Math.max(1, Math.floor(STEPS / 4)); r++) {
    const before = await view();
    const a = await run(-45, 24); await pacedWait(page, 600);
    const mid = await view();
    const b = await run(45, 24); await pacedWait(page, 600);
    const after = await view();
    burstFrames.push(...a, ...b);
    steps.push({ i: r * 2, dir: "in", ppfBefore: before, ppfAfter: mid, moved: Math.abs(mid - before) > 1e-9, t0: 0, t1: 0 }, { i: r * 2 + 1, dir: "out", ppfBefore: mid, ppfAfter: after, moved: Math.abs(after - mid) > 1e-9, t0: 0, t1: 0 });
  }
}
for (let i = 0; GESTURE === "steps" && i < STEPS * 2; i++) {
  const dy = i < STEPS ? -100 : 100;
  const before = await view();
  const w = await stepWheel(dy);
  await pacedWait(page, 450); // settle: any debounced re-raster / layer refresh lands outside the NEXT step
  const after = await view();
  steps.push({ i, dir: dy < 0 ? "in" : "out", ppfBefore: before, ppfAfter: after, moved: Math.abs(after - before) > 1e-9, ...w });
}
/* Registration (drawing ↔ aerial weld) must survive the fix: read the planner's own measured shift once the gesture has SETTLED. */
await pacedWait(page, 1800);
census.registrationAfter = await page.evaluate(() => (window.__plannerView && window.__plannerView.registration ? window.__plannerView.registration() : null));
let profile = null;
if (PROFILE) profile = (await cdp.send("Profiler.stop")).profile;
await assertMeasurable(page, "diagnose-silvestri-zoom-freeze/post");

const loaf = (await page.evaluate(() => window.__loaf)).filter((e) => e.s >= gestureT0);
if (process.argv.includes("--why")) { const w = await page.evaluate(() => window.__why || []); const c = {}; for (const x of w) c[x] = (c[x] || 0) + 1; console.log("WHY", JSON.stringify(c, null, 1)); }
const lp = process.argv.includes("--leaflet-probe") ? await page.evaluate(() => ({ invalidateSizeCalls: window.__lp.inval.length, invalidateSizeMs: +window.__lp.inval.reduce((a, b) => a + b, 0).toFixed(0), worst: Math.max(0, ...window.__lp.inval), setViewCalls: window.__lp.setView, containerInsets: [...window.__lp.overscan] })) : null;
const stuck = steps.filter((s) => !s.moved);
if (stuck.length > STEPS) throw new Error(`${stuck.length}/${steps.length} steps did not move the view — instrument could not zoom; refusing to report a score`);

/* KNOWN-GOOD ARM for the leaflet probe: a REAL container resize must still re-sync Leaflet's size. A probe that
 * reads 0 `invalidateSize` calls proves nothing unless it is shown able to read a non-zero count on the same
 * page — and the fix that removed the per-wheel-event call must not have removed the resize re-sync with it. */
let resizeControl = null;
if (lp) {
  await page.evaluate(() => { window.__lp.inval.length = 0; });
  await page.setViewportSize({ width: VW - 120, height: VH });
  await pacedWait(page, 900);
  resizeControl = await page.evaluate(() => ({ invalidateSizeCalls: window.__lp.inval.length }));
}
for (const s of GESTURE === "steps" ? steps : []) {
  /* A LoAF belongs to a step if it STARTS inside [t0, t1+500ms] — a frame that began before dispatch is not ours. */
  const mine = loaf.filter((e) => e.s >= s.t0 - 2 && e.s <= s.t1 + 450);
  s.blockMs = +mine.reduce((a, e) => a + e.b, 0).toFixed(1);
  s.frameMs = +mine.reduce((a, e) => a + e.d, 0).toFixed(1);
  s.maxFrameMs = mine.length ? +Math.max(...mine.map((e) => e.d)).toFixed(1) : 0;
  s.attr = [...new Set(mine.flatMap((e) => e.sc.sort((p, q) => q.d - p.d).slice(0, 1).map((x) => x.fn || `${x.inv}:${x.url}:${x.pos}`)))];
}
const med = (xs) => { const a = xs.slice().sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : 0; };
const loafAll = loaf.filter((e) => e.d >= 50);
const summary = {
  leafletProbe: lp,
  resizeControl,
  gesture: GESTURE,
  burst: GESTURE === "burst" ? { frames: burstFrames.length, p50: +med(burstFrames).toFixed(1), p95: +burstFrames.slice().sort((a, b) => a - b)[Math.floor(burstFrames.length * 0.95)].toFixed(1), max: +Math.max(...burstFrames).toFixed(1), over100: burstFrames.filter((x) => x > 100).length } : null,
  loafOver50: loafAll.length,
  loafOver200: loafAll.filter((e) => e.d >= 200).length,
  loafBlockingTotalMs: Math.round(loaf.reduce((a, e) => a + e.b, 0)),
  loafMaxMs: Math.round(Math.max(0, ...loaf.map((e) => e.d))), loafWorst: loafAll.slice().sort((a, b) => b.d - a.d).slice(0, 6).map((e) => ({ dur: +e.d.toFixed(0), block: +e.b.toFixed(0), scriptPhase: +e.rs.toFixed(0), styleLayoutPhase: +e.sl.toFixed(0), forcedLayoutInScripts: +e.fl.toFixed(0), top: e.sc[0] && (e.sc[0].fn || e.sc[0].inv) })),
  label: LABEL, base: BASE, fixture: FIXTURE, dpr: DPR, viewport: `${VW}x${VH}`, census,
  steps: steps.length, movedSteps: steps.filter((s) => s.moved).length,
  perStepMaxFrameMs: steps.map((s) => s.maxFrameMs), perStepBlockMs: steps.map((s) => s.blockMs),
  medianStepBlockMs: med(steps.map((s) => s.blockMs)), medianStepMaxFrameMs: med(steps.map((s) => s.maxFrameMs)),
  worstStepMaxFrameMs: Math.max(...steps.map((s) => s.maxFrameMs)),
  stepsOver200ms: steps.filter((s) => s.maxFrameMs >= 200).length,
  attrNames: [...new Set(steps.flatMap((s) => s.attr))].slice(0, 8),
};

if (profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const self = new Map(), total = new Map();
  const samples = profile.samples, deltas = profile.timeDeltas;
  for (let i = 0; i < samples.length; i++) {
    const us = Math.max(0, deltas[i] || 0) / 1000;
    const seen = new Set();
    for (let id = samples[i]; id != null; id = parent.get(id)) {
      const k = frameName(byId.get(id).callFrame);
      if (id === samples[i]) self.set(k, (self.get(k) || 0) + us);
      if (!seen.has(k)) { seen.add(k); total.set(k, (total.get(k) || 0) + us); }
    }
  }
  const CALLERS = argOf("--callers", null);
  if (CALLERS) {
    const chains = new Map();
    for (let i = 0; i < samples.length; i++) {
      const us = Math.max(0, deltas[i] || 0) / 1000;
      let id = samples[i], hit = false; const chain = [];
      for (; id != null; id = parent.get(id)) { const cf = byId.get(id).callFrame; if (!hit && cf.functionName === CALLERS) hit = true; if (hit) chain.push(frameName(cf)); }
      if (hit) { const k = chain.slice(1, 9).join("  <-  "); chains.set(k, (chains.get(k) || 0) + us); }
    }
    summary.callerChains = [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${v.toFixed(0)} ms  ${k}`);
  }
  const MATCH = argOf("--frames-matching", null);
  if (MATCH) { const re = new RegExp(MATCH, "i"); summary.framesMatching = [...total.entries()].filter(([k]) => re.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${v.toFixed(1)} ms  ${k}`); }
  const top = (m, n) => [...m.entries()].filter(([k]) => !k.startsWith("(")).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`);
  summary.profileSelfTop = top(self, 25);
  summary.profileTotalTop = top(total, 45);
}

if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`\n${LABEL || "run"} — ${BASE}  fixture=${FIXTURE}  dpr=${DPR}  viewport=${VW}x${VH}`);
  console.log(`  rendered: ${census.elementsInDom} features · ${census.domNodes} DOM nodes · ${census.canvasNodes} canvas nodes · start ppf ${census.ppf}`);
  console.log(`  per-step worst frame (ms): ${summary.perStepMaxFrameMs.join(" ")}`);
  console.log(`  per-step blocking (ms):    ${summary.perStepBlockMs.join(" ")}`);
  console.log(`  median step worst frame ${summary.medianStepMaxFrameMs} ms · worst ${summary.worstStepMaxFrameMs} ms · steps ≥200 ms: ${summary.stepsOver200ms}/${steps.length}`);
  console.log(`  SUMMARY loaf≥200ms: ${summary.loafOver200} · loaf max ${summary.loafMaxMs} ms · total blocking ${summary.loafBlockingTotalMs} ms`);
  if (lp) console.log(`  leaflet probe: ${JSON.stringify(lp)}  resize control: ${JSON.stringify(resizeControl)}`);
  if (summary.burst) console.log(`  burst frames: ${JSON.stringify(summary.burst)}`);
  console.log(`  registration shift after settle: ${JSON.stringify(census.registrationAfter)}`);
  console.log(`  after centering: ${JSON.stringify(census.afterCenter)}`);
  console.log(`  LoAF ≥50ms: ${summary.loafOver50}; worst: ${JSON.stringify(summary.loafWorst)}`);
  console.log(`  LoAF attributions: ${summary.attrNames.join(", ")}`);
  if (summary.framesMatching) { console.log(`\n  FRAMES matching /${argOf("--frames-matching")}/ (inclusive, whole gesture): ${summary.framesMatching.length ? "" : "NONE"}`); summary.framesMatching.forEach((l) => console.log("   ", l)); }
  if (summary.callerChains) { console.log(`\n  CALLERS of ${argOf("--callers")}:`); summary.callerChains.forEach((l) => console.log("   ", l)); }
  if (summary.profileSelfTop) { console.log("\n  SELF time (profile, whole gesture):"); summary.profileSelfTop.forEach((l) => console.log("   ", l)); console.log("\n  INCLUSIVE time:"); summary.profileTotalTop.forEach((l) => console.log("   ", l)); }
}
await browser.close();
