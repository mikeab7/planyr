#!/usr/bin/env node
/* diagnose-zoom-cost — WHERE does a wheel-zoom frame's time actually go? (B1352/B1354)
 *
 * The harness reports ONE number for the zoom gesture (a frame median). That number cannot
 * distinguish the three things it could be, and they have three different fixes:
 *
 *   ScriptDuration        React render + our geometry math          → memoisation / LOD
 *   RecalcStyle+Layout    the browser re-resolving the SVG tree     → fewer / stabler nodes
 *   the remainder         paint + raster + compositing              → filters, opacity, blurs
 *
 * Attributing the frame is the whole point: B1352 assumes the cost is SCRIPT (so a React.memo
 * pays), B1354 assumes it is PAINT (so the drop-shadow filters pay). Both cannot be the main
 * cost, and shipping either on a guess is exactly what this program exists to stop.
 *
 * HOW. CDP `Performance.getMetrics` exposes Chrome's own cumulative renderer accounting
 * (ScriptDuration / LayoutDuration / RecalcStyleDuration / TaskDuration, all in seconds).
 * Sampling it either side of the SAME scripted wheel gesture the harness drives gives a
 * per-gesture attribution with no instrumented build and no trace parsing. `TaskDuration`
 * minus the three named buckets is paint/raster/other — reported as a residual, never as a
 * precise "paint" figure, because it is a subtraction and should read like one.
 *
 * A/B MODE. `--mutate <name>` applies a page-side DOM mutation before the gesture, so the same
 * instrument answers "what would removing X cost/save?" WITHOUT shipping X. The mutations are
 * deliberately reversible page-side edits, not builds:
 *   --mutate none            (default) measure the app as it is
 *   --mutate nofilter        strip every `filter` attribute in the canvas (B1354's A/B)
 *   --mutate noshadowdefs    keep the filter attributes, empty the feDropShadow primitives
 * A mutation is REPORTED in the output, always, so a mutated run can never be mistaken for a
 * baseline one.
 *
 *   node ui-audit/diagnose-zoom-cost.mjs --cpu-throttle 4
 *   node ui-audit/diagnose-zoom-cost.mjs --cpu-throttle 4 --mutate nofilter --json
 *   node ui-audit/diagnose-zoom-cost.mjs --cpu-throttle 4 --gesture drag
 */
import { chromium } from "playwright";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const argOf = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : dflt; };
const numArg = (flag, dflt) => { const v = Number(argOf(flag, NaN)); return Number.isFinite(v) && v > 0 ? v : dflt; };
const CPU = numArg("--cpu-throttle", 1);
const MUTATE = String(argOf("--mutate", "none"));
const GESTURE = String(argOf("--gesture", "wheel"));
const REPEATS = numArg("--repeats", 1);

const MUTATIONS = {
  none: () => ({ applied: "none", touched: 0 }),
  /* B1354's A/B. Strips the `filter` attribute wherever it is set on a canvas node, and re-strips
   * after every React commit (React re-applies it, so a one-shot strip would silently undo itself
   * on the first frame of the gesture — which would report the baseline and call it the A/B). */
  nofilter: () => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    let touched = 0;
    const strip = () => {
      for (const n of svg.querySelectorAll("[filter]")) { n.removeAttribute("filter"); touched++; }
    };
    strip();
    window.__mutObs = new MutationObserver(strip);
    window.__mutObs.observe(svg, { attributes: true, subtree: true, childList: true, attributeFilter: ["filter"] });
    return { applied: "nofilter", touched };
  },
  /* Keeps every `filter` reference intact — so the filter region is still established and the
   * offscreen buffer still allocated — but empties the blur itself. Separates "the filter exists"
   * from "the gaussian blur runs", which are different costs with different fixes. */
  noshadowdefs: () => {
    let touched = 0;
    for (const f of document.querySelectorAll("filter")) {
      for (const p of f.querySelectorAll("feDropShadow")) { p.setAttribute("stdDeviation", "0"); p.setAttribute("flood-opacity", "0"); touched++; }
    }
    return { applied: "noshadowdefs", touched };
  },
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors", "--enable-precise-memory-info"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(perfScenarioSeed());
await ctx.addInitScript(() => {
  window.__frames = [];
  let last = performance.now();
  const tick = (now) => { window.__frames.push(now - last); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await ctx.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");
if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
await page.waitForTimeout(2500);

const box = await page.locator("svg[role=application]").boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

/* --open-panel <rail tab id> — measure the SAME gesture with an inspector panel DOCKED (B1351).
 * The whole left-rail block renders behind `{(leftPanel || companionOpen) && …}`, so with nothing
 * docked its markup is never evaluated and a closed-panel measurement says nothing at all about
 * whether hoisting it behind memoised children would pay. Opening one is the only honest way to
 * ask. Reported in the output so a panel-open run can never be read as a default-view one. */
const OPEN_PANEL = argOf("--open-panel", null);
let panelOpened = null;
if (OPEN_PANEL) {
  const tab = page.locator(`[data-rail-tab="${OPEN_PANEL}"]`);
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(1200);
    panelOpened = await page.evaluate(() => {
      const p = document.querySelector('[data-testid="left-menu-panel"]');
      return p ? { tags: p.getElementsByTagName("*").length } : null;
    });
  }
  if (!panelOpened) throw new Error(`--open-panel ${OPEN_PANEL}: the rail tab did not open a panel — refusing to report a run that measured the closed state`);
}

const mutation = await page.evaluate(([name, srcs]) => {
  const fn = new Function(`return (${srcs[name] || srcs.none})`)();
  return fn();
}, [MUTATE, Object.fromEntries(Object.entries(MUTATIONS).map(([k, v]) => [k, v.toString()]))]);

const metrics = async () => {
  const { metrics: m } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(m.map((x) => [x.name, x.value]));
};
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

/* The gesture. Deliberately IDENTICAL in shape to ui-audit/perf-harness.mjs's — one wheel event
 * per task via a MessageChannel pump, bursts of five, alternating direction — so a number here
 * and a number there describe the same thing. See the long note in the harness for why one event
 * per task is load-bearing (React 18 auto-batches a whole task's worth of setState). */
const wheelBurst = (n, dy) => page.evaluate(([count, delta, x, y]) => new Promise((done) => {
  const el = document.querySelector('[data-testid="planner-canvas"]');
  const ch = new MessageChannel();
  let i = 0;
  ch.port1.onmessage = () => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    if (++i < count) ch.port2.postMessage(0); else done();
  };
  ch.port2.postMessage(0);
}), [n, dy, cx, cy]);

/* --profile: a CPU sample profile across the SAME gesture, aggregated by SELF time.
 * "Script is 75% of the frame" is a bucket, not an answer — the fix for React reconciliation and
 * the fix for our own geometry math are different fixes. This names the functions. */
const PROFILE = process.argv.includes("--profile");
let profileTop = null;

const runs = [];
for (let rep = 0; rep < REPEATS; rep++) {
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(250);
  await page.evaluate(() => { window.__frames.length = 0; });
  /* DOM mutation records + delivery batches, the same signal ui-audit/diagnose-pan-commits.mjs
   * counts — carried here so ONE instrument reports the cost AND the reconciliation volume it
   * comes from. A batch is one delivery = one commit's worth of DOM work; `records` is how many
   * individual attribute/child writes React actually made. */
  await page.evaluate(() => {
    window.__batches = [];
    window.__mo = new MutationObserver((recs) => window.__batches.push(recs.length));
    window.__mo.observe(document.body, { attributes: true, childList: true, characterData: true, subtree: true });
  });
  if (PROFILE && rep === REPEATS - 1) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start"); }
  const before = await metrics();
  /* MEASUREMENT BLOCKER #5, inherited deliberately from ui-audit/perf-harness.mjs: a gesture that
   * moved NOTHING samples a beautiful 60 fps and reports it as a result. The view transform is read
   * either side and a run that did not move the view is marked, never quietly reported. */
  const viewNow = () => page.evaluate(() => {
    const s = document.querySelector('[data-testid="planner-canvas"]');
    return s ? `${s.getAttribute("data-view-offx")}|${s.getAttribute("data-view-offy")}|${s.getAttribute("data-view-ppf")}` : null;
  });
  const viewBefore = await viewNow();
  let midMoved = false;
  const t0 = Date.now();
  if (GESTURE === "hover") {
    /* THE GESTURE NOBODY WAS MEASURING (B1352). Sweeping the mouse across the canvas with no
     * button down changes NOTHING on screen but one coordinate readout — and re-rendered the whole
     * element tree at frame rate, because `scheduleFrameJob("cursor", …)` fires on every
     * pointermove and every element was reconciled against fresh props. It is also, by a wide
     * margin, the most frequent thing a pointer does over a plan. The `moved` guard below is
     * expected to say the view did NOT move here — that is the POINT of this gesture, not a fault,
     * so read `domRecords` rather than the frame median. */
    for (let i = 0; i < 60; i++) await page.mouse.move(cx + Math.sin(i / 6) * 300, cy + Math.cos(i / 8) * 180);
  } else if (GESTURE === "drag") {
    /* THE PRESS POINT MUST BE THE CANVAS ITSELF, not merely "not an element".
     * Measured 2026-07-31: at the canvas centre of the Goose Creek scenario the top hit is a
     * building's <rect>, and one rung out it is a parcel ring — a press on either DRAGS THAT
     * THING and never pans, which samples a serene 60 fps and reports it as a pan result. Rather
     * than enumerate everything that is grabbable, require the hit to BE the <svg>: that is the
     * only node for which a press is unambiguously a pan. The `moved` guard below still checks. */
    const at = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const r = svg.getBoundingClientRect();
      for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) for (const fx of [0.25, 0.75, 0.12, 0.88, 0.5]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        if (document.elementFromPoint(x, y) === svg) return { x, y };
      }
      return null;
    });
    const px = at ? at.x : cx, py = at ? at.y : cy;
    await page.mouse.move(px, py);
    await page.mouse.down();
    for (let i = 0; i < 40; i++) await page.mouse.move(px + Math.sin(i / 5) * 260, py + Math.cos(i / 7) * 160, { steps: 2 });
    await page.mouse.up();
  } else {
    /* ⚠ THE `moved` GUARD HAS TO SAMPLE MID-GESTURE HERE, and finding that out was worth the note.
     * The bursts alternate direction so the view cannot run into the ppf clamp (where the handler
     * short-circuits and the sample would flatter the code under test) — but an even number of
     * equal-and-opposite bursts lands the view EXACTLY where it started, so an endpoint-only
     * comparison reports a perfectly good gesture as "never moved". Sample after the first burst,
     * where the view is unambiguously somewhere else. */
    for (let b = 0; b < 8; b++) {
      await wheelBurst(5, b % 2 ? -120 : 120);
      await page.waitForTimeout(40);
      if (b === 0) midMoved = (await viewNow()) !== viewBefore;
    }
  }
  const gestureMs = Date.now() - t0;
  await page.waitForTimeout(150);
  const moved = midMoved || (await viewNow()) !== viewBefore;
  const after = await metrics();
  if (PROFILE && rep === REPEATS - 1) {
    const { profile } = await cdp.send("Profiler.stop");
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = new Map();
    for (const [i, id] of (profile.samples || []).entries()) {
      const dt = (profile.timeDeltas || [])[i] || 0;
      const n = byId.get(id);
      if (!n) continue;
      const cf = n.callFrame;
      const key = `${cf.functionName || "(anonymous)"}  ${(cf.url || "").split("/").pop()}:${cf.lineNumber + 1}`;
      self.set(key, (self.get(key) || 0) + dt);
    }
    const total = [...self.values()].reduce((a, b) => a + b, 0) || 1;
    profileTop = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
      .map(([fn, us]) => ({ fn, ms: +(us / 1000).toFixed(1), pct: +((us / total) * 100).toFixed(1) }));
  }
  const frames = (await page.evaluate(() => window.__frames.slice())).slice(1);
  const dom = await page.evaluate(() => {
    window.__mo.disconnect();
    return { batches: window.__batches.length, records: window.__batches.reduce((a, b) => a + b, 0) };
  });
  const d = (k) => +(((after[k] || 0) - (before[k] || 0)) * 1000).toFixed(1);   // seconds → ms
  const script = d("ScriptDuration"), layout = d("LayoutDuration"), style = d("RecalcStyleDuration"), task = d("TaskDuration");
  runs.push({
    gestureMs, moved,
    frames: frames.length,
    frameMedianMs: frames.length ? +pct(frames, 50).toFixed(1) : null,
    frameP90Ms: frames.length ? +pct(frames, 90).toFixed(1) : null,
    domBatches: dom.batches, domRecords: dom.records,
    scriptMs: script, layoutMs: layout, recalcStyleMs: style, taskMs: task,
    residualMs: +(task - script - layout - style).toFixed(1),
    layoutCount: (after.LayoutCount || 0) - (before.LayoutCount || 0),
    recalcStyleCount: (after.RecalcStyleCount || 0) - (before.RecalcStyleCount || 0),
    nodes: after.Nodes,
    layoutObjects: after.LayoutObjects,
  });
}
await browser.close();

const median = (k) => { const v = runs.map((r) => r[k]).filter((x) => typeof x === "number"); return v.length ? +pct(v, 50).toFixed(1) : null; };
const res = {
  base: BASE, gesture: GESTURE, cpuThrottle: CPU, mutation, repeats: REPEATS, openPanel: OPEN_PANEL, panelOpened,
  runs, profileTop,
  median: {
    frameMedianMs: median("frameMedianMs"), frameP90Ms: median("frameP90Ms"),
    scriptMs: median("scriptMs"), layoutMs: median("layoutMs"), recalcStyleMs: median("recalcStyleMs"),
    residualMs: median("residualMs"), taskMs: median("taskMs"),
  },
};
if (JSON_OUT) console.log(JSON.stringify(res, null, 2));
else {
  console.log(`Zoom/pan cost attribution\n  target: ${BASE}  ·  gesture: ${GESTURE}  ·  cpu ${CPU}x  ·  mutation: ${mutation.applied}${mutation.touched ? ` (${mutation.touched} nodes)` : ""}${panelOpened ? `  ·  panel "${OPEN_PANEL}" DOCKED (${panelOpened.tags} DOM nodes in the rail)` : ""}\n`);
  for (const [i, r] of runs.entries()) {
    const idle = !r.moved && GESTURE !== "hover" ? "   ⚠ THE VIEW NEVER MOVED — this run measured an idle page, do not read it" : "";
    console.log(`  run ${i + 1}: ${r.frames} frames over ${r.gestureMs} ms · median ${r.frameMedianMs} ms · p90 ${r.frameP90Ms} ms${idle}`);
    console.log(`      script ${r.scriptMs} ms · recalc-style ${r.recalcStyleMs} ms (${r.recalcStyleCount}x) · layout ${r.layoutMs} ms (${r.layoutCount}x) · paint/raster residual ${r.residualMs} ms  [of ${r.taskMs} ms total task time]`);
    console.log(`      DOM: ${r.domRecords} mutation records across ${r.domBatches} delivery batches (${(r.domRecords / Math.max(1, r.domBatches)).toFixed(0)} per commit)`);
  }
  if (REPEATS > 1) console.log(`\n  MEDIAN of ${REPEATS}: frame ${res.median.frameMedianMs} ms · script ${res.median.scriptMs} · style ${res.median.recalcStyleMs} · layout ${res.median.layoutMs} · residual ${res.median.residualMs}`);
  if (profileTop) {
    console.log(`\n  CPU profile — top self time across the last gesture:`);
    for (const p of profileTop) console.log(`      ${String(p.pct).padStart(5)}%  ${String(p.ms).padStart(8)} ms  ${p.fn}`);
  }
  console.log(`\n  ⚠ "residual" is task time MINUS script/style/layout — paint, raster, compositing and anything Chrome does not attribute. It is a subtraction, not a measurement.`);
}
