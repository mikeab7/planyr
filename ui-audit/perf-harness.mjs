#!/usr/bin/env node
/* perf-harness — the browser-measured half of the standing performance budget (NEW-8).
 *
 * Loads a fixed heavy reference scenario and measures the metrics that only a real browser
 * can see, against the committed ceilings in ui-audit/perf-budgets.json:
 *
 *   timeToFirstDrag        navigation start → the canvas actually responds to a drag
 *   firstAerialCoverage    basemap mount → the map is no longer mostly bare backdrop
 *   frameMedian / frameP90 frame time during a scripted drag across the planner canvas
 *   peakHeap               peak JS heap across a scripted pan/zoom + overlay-toggle loop
 *   aerialTileRequests     basemap tile requests for the scenario load
 *   firstContentfulPaint   the browser's FCP entry
 *   siteRouteChunks        which JS chunks a plain Site route actually fetched (NEW-9 guard)
 *
 * WHY THIS IS NOT IN THE REQUIRED CI BUILD CHECK. Frame time and heap on a shared CI runner
 * are dominated by co-tenant CPU contention — gating merges on them produces flaky reds that
 * teach people to re-run until green, which is worse than no budget at all. The aerial budget
 * additionally needs live external tile hosts. So the DETERMINISTIC half (bundle weight, and
 * the route-chunk allowlist that catches the NEW-9 prefetch regression by name) is what gates
 * CI via ui-audit/perf-bundle-audit.mjs; this half runs on demand and before shipping anything
 * that touches render or load. docs/PERF-BUDGETS.md records the split and the reasoning.
 *
 * REFERENCE SCENARIO. The owner's baseline was measured on Sylvestri / "Concept C — Full 275'
 * Frontage", which is real project data behind a signed-in session — unreachable from this
 * sandbox (the proxy blocks Supabase sign-in). The harness therefore drives a fixed, committed
 * stand-in scenario, ui-audit/lib/perf-scenario.mjs. (The e2e dense-testfit fixture was tried
 * first and is the WRONG source: it carries the pure-engine geometry schema and crashes the live
 * render path — see the note in that module.) The stand-in is LIGHTER than Sylvestri, so its
 * numbers are a floor, not a match — confirming the ceilings against the real scenario is a
 * signed-in live check (see VERIFICATION.md).
 *
 *   node ui-audit/perf-harness.mjs                       # against http://localhost:4173
 *   BASE_URL=https://planyr.io node ui-audit/perf-harness.mjs
 *   node ui-audit/perf-harness.mjs --json
 *   node ui-audit/perf-harness.mjs --no-tiles            # skip the aerial metrics (offline)
 *
 * Exits 1 on a ceiling breach, naming the metric and its delta.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stemOf } from "./lib/bundleMetrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const NO_TILES = process.argv.includes("--no-tiles");
/* NEW-3(a) — WHICH GESTURE TO MEASURE. Until now this harness measured a scripted DRAG only, and
 * ui-audit/zoomout-frames.mjs measures dark-pixel coverage on a one-element scene — so the owner's
 * "I scroll out and it takes probably a whole second" had NO frame-time instrument anywhere. This
 * mode adds one, and it lands BEFORE the fixes so every change gets a real before/after.
 *   --gesture wheel   only the zoom gesture   ·   --gesture drag   only the drag (the old behaviour)
 * Default is BOTH, so an existing invocation keeps reporting everything it used to. */
const gestureArg = (() => {
  const i = process.argv.indexOf("--gesture");
  const v = i >= 0 ? String(process.argv[i + 1] || "").toLowerCase() : "both";
  return ["wheel", "drag", "both"].includes(v) ? v : "both";
})();
const DO_DRAG = gestureArg !== "wheel";
const DO_WHEEL = gestureArg !== "drag";

const budgets = JSON.parse(readFileSync(join(HERE, "perf-budgets.json"), "utf8"));

/* Set when the frame sampler cannot be trusted (see MEASUREMENT BLOCKER #4 below); non-null
 * suppresses the frame medians entirely rather than reporting a starved figure. */
let frameSamplingFault = null;

/* ---- Reference scenario ------------------------------------------------------------------
 * Owned by ui-audit/lib/perf-scenario.mjs — see the long note there for why this is a
 * purpose-built scenario rather than the e2e dense-testfit fixture (that fixture carries the
 * pure-engine geometry schema and crashes the live render path). */
const { ORIGIN, SCENARIO_ID, perfScenarioSite, perfScenarioSeed } = await import("./lib/perf-scenario.mjs");
const { frameSamplingFault: frameSamplingFaultFor, observedFps, MIN_PLAUSIBLE_FPS } = await import("./lib/frameSampling.mjs");
const site = perfScenarioSite();
const seed = perfScenarioSeed();

/* Aerial basemap hosts. Counted as REQUESTS, never summed as bytes — see the header note in
 * docs/PERF-BUDGETS.md: cross-origin tile responses carry no Timing-Allow-Origin, so their
 * transferSize reads 0 and a byte budget would silently never fire. */
const TILE_HOST = /(arcgisonline\.com|services\.arcgis\.com|server\.arcgisonline)/i;

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

/* ---- Drive the browser ------------------------------------------------------------------ */
const browser = await chromium.launch({
  executablePath: EXEC,
  // --enable-precise-memory-info makes performance.memory report real byte counts instead of
  // the coarse, deliberately-quantised values Chrome shows by default (an anti-fingerprinting
  // measure). Without it the heap budget is measuring rounded noise.
  args: ["--no-sandbox", "--ignore-certificate-errors", "--enable-precise-memory-info"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

/* MEASUREMENT BLOCKER #1 — the default resource-timing buffer holds 250 entries and FILLS
 * during a scenario load, after which the browser silently drops every later entry. That
 * under-reports tiles and JS with no error anywhere. Raise it BEFORE any navigation. */
await ctx.addInitScript(() => performance.setResourceTimingBufferSize(3000));
await ctx.addInitScript(seed);
/* Frame sampler: record inter-frame deltas continuously, so a scripted gesture can just read
 * the window it cares about rather than trying to install a sampler mid-gesture. */
await ctx.addInitScript(() => {
  window.__frames = [];
  let last = performance.now();
  const tick = (now) => { window.__frames.push({ t: now, d: now - last }); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

const page = await ctx.newPage();
const tiles = [];
const jsChunks = [];
const failedExternal = new Set();
page.on("request", (r) => {
  const u = r.url();
  if (TILE_HOST.test(u)) tiles.push(u);
  if (u.startsWith(BASE) && /\/assets\/.*\.js(\?|$)/.test(u)) jsChunks.push(u.split("/").pop());
});
/* Load-timing metrics are only meaningful if the page's render-blocking resources actually
 * resolved. index.html pulls the Inter webfont stylesheet from fonts.googleapis.com with a
 * plain <link rel=stylesheet>, which BLOCKS rendering — so in a network-restricted environment
 * that request hangs until it times out and drags first-contentful-paint from ~330ms to ~13s.
 * That is an artefact of the sandbox, not a regression, and reporting it as a breach would
 * train people to ignore the harness. Track what failed, and downgrade the affected metrics. */
page.on("requestfailed", (r) => {
  const u = r.url();
  if (!u.startsWith(BASE)) failedExternal.add(new URL(u).host);
});
if (NO_TILES) {
  /* Abort cross-origin requests IMMEDIATELY rather than letting them hang: a fast abort keeps
   * the load timings usable as a local baseline instead of burying them under timeout stalls. */
  await page.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
}

const results = {};
const notes = [];

await page.goto(BASE, { waitUntil: "load" });

/* ---- time-to-first-drag ------------------------------------------------------------------
 * DEFINED HERE, deliberately, because the owner's 2026-07-28 pass could not defend a TTFD
 * number and warned against reading first-contentful-paint (328ms) as one — FCP is the moment
 * the first pixel lands, which on this app is chrome, long before the canvas can be dragged.
 * TTFD is: navigation start → the planner canvas exists AND has demonstrably serviced a
 * pointer gesture (pointerdown → move → up, followed by a committed animation frame). That is
 * the first instant the owner could actually start working. */
await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
const box = await page.locator("svg[role=application]").boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 40, cy + 30, { steps: 4 });
await page.mouse.up();
results.timeToFirstDragMs = Math.round(await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => res(performance.now())))));

results.firstContentfulPaintMs = Math.round(
  await page.evaluate(() => {
    const e = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
    return e ? e.startTime : 0;
  })
);

/* ---- first aerial coverage ----------------------------------------------------------------
 * "Covered" = the visible map area is ≥90% filled by tiles that have actually LOADED.
 *
 * ui-audit/initial-load.mjs answers this by screenshotting and counting empty-canvas-gray
 * pixels. That needs a PNG decoder (pngjs), which is not a dependency of this repo, and it
 * mis-reads any scenario whose imagery happens to be gray. Measuring the tile layer's own
 * geometry instead is dependency-free and strictly more precise: sum the on-screen area of
 * each .leaflet-tile-loaded element clipped to the map container, per tile LAYER (a basemap
 * plus a labels overlay would otherwise double-count), and take the best-covered layer.
 *
 * Reported as SKIPPED, never as a pass, when tiles are unavailable — a budget that silently
 * passes offline is worse than no budget at all. */
const coverageFraction = () => page.evaluate(() => {
  const map = document.querySelector(".leaflet-container");
  if (!map) return 0;
  const mr = map.getBoundingClientRect();
  const area = mr.width * mr.height;
  if (!area) return 0;
  const byLayer = new Map();
  for (const t of document.querySelectorAll(".leaflet-tile-loaded")) {
    const r = t.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, mr.right) - Math.max(r.left, mr.left));
    const h = Math.max(0, Math.min(r.bottom, mr.bottom) - Math.max(r.top, mr.top));
    if (w <= 0 || h <= 0) continue;
    const layer = t.parentElement;
    byLayer.set(layer, (byLayer.get(layer) || 0) + w * h);
  }
  return Math.min(1, Math.max(0, ...byLayer.values(), 0) / area);
});
if (NO_TILES) {
  results.firstAerialCoverageMs = null;
  notes.push("firstAerialCoverage SKIPPED (--no-tiles)");
} else {
  const hasLayer = await page.waitForFunction(() => document.querySelectorAll(".leaflet-tile").length > 0, { timeout: 20_000 }).catch(() => null);
  if (!hasLayer) {
    results.firstAerialCoverageMs = null;
    notes.push("firstAerialCoverage SKIPPED — no basemap tiles were requested (host unreachable from this network?)");
  } else {
    const t0 = Date.now();
    let covered = null;
    for (let i = 0; i < 60 && covered === null; i++) {
      if (await coverageFraction() >= 0.9) covered = Date.now() - t0;
      else await page.waitForTimeout(250);
    }
    results.firstAerialCoverageMs = covered;
    if (covered === null) notes.push("firstAerialCoverage: never reached coverage within 15s");
  }
}

/* ---- scripted drag → frame timing ----------------------------------------------------------
 * MEASUREMENT BLOCKER #4 — rAF IS SUSPENDED IN A BACKGROUNDED TAB, AND SAYS NOTHING ABOUT IT.
 *
 * The frame budget was originally seeded from a browser session whose tab visibility could not
 * be guaranteed. Re-checked 2026-07-29: that surface reports document.visibilityState ===
 * "hidden", and Chrome suspends requestAnimationFrame entirely in that state — six real drag
 * gestures produced ZERO frames, and a 1500 ms idle sample produced zero as well. Taking a
 * screenshot does not foreground the tab. Sample counts wandering 1525 → 316 → 0 across
 * otherwise-identical runs is the signature of that throttling, not of a performance change.
 *
 * The failure mode that matters is not the zero — it is the MIDDLE of that range. A partly
 * throttled run still yields a perfectly plausible-looking median from a starved sample, and
 * that number is how a bad ceiling gets committed. So the harness now REFUSES to report a
 * frame figure it cannot stand behind: the tab must be visible, and the observed frame rate
 * across the gesture must be at least MIN_PLAUSIBLE_FPS. Anything less is reported as an
 * unreliable measurement (loudly, with the reason), never as a median. The rule itself lives
 * in ui-audit/lib/frameSampling.mjs so it is unit-tested and cannot drift from the docs. */
const visibility = await page.evaluate(() => document.visibilityState);
if (DO_DRAG) {
await page.evaluate(() => { window.__frames.length = 0; });
const dragT0 = Date.now();
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 0; i < 40; i++) {
  await page.mouse.move(cx + Math.sin(i / 5) * 260, cy + Math.cos(i / 7) * 160, { steps: 2 });
}
await page.mouse.up();
const dragMs = Date.now() - dragT0;
const drag = await page.evaluate(() => window.__frames.map((f) => f.d));
/* Drop the first sample: its delta spans the idle gap before the gesture, not a rendered frame. */
const dragFrames = drag.slice(1);
results.frameSamples = dragFrames.length;
results.frameGestureMs = dragMs;
results.frameObservedFps = observedFps(dragFrames.length, dragMs);
results.frameVisibility = visibility;
frameSamplingFault = frameSamplingFaultFor({ visibility, samples: dragFrames.length, gestureMs: dragMs });
if (frameSamplingFault) {
  results.frameMedianMs = null;
  results.frameP90Ms = null;
} else {
  results.frameMedianMs = dragFrames.length ? +pct(dragFrames, 50).toFixed(1) : null;
  results.frameP90Ms = dragFrames.length ? +pct(dragFrames, 90).toFixed(1) : null;
}
}

/* ---- scripted WHEEL ZOOM → frame timing + renders-per-wheel-event (NEW-3a) -------------------
 * The SAME trust rules as the drag above, deliberately reusing ui-audit/lib/frameSampling.mjs
 * rather than re-deriving them: the tab must be VISIBLE and the observed rate across the gesture
 * must clear the plausibility floor, or the medians are suppressed and the reason is reported. A
 * number from a backgrounded tab is worse than no number (the B1086 trap), and it is worse here
 * than anywhere, because this metric exists to justify a render-path change.
 *
 * THE SECOND NUMBER IS THE POINT. A frame median alone cannot distinguish "the wheel handler is
 * slow" from "the wheel handler fires too many times" — and the diagnosed defect was both: an
 * uncoalesced setView per raw wheel event, each of which then committed TWICE because the
 * registration-shift epsilon never held. So we count COMMITS THAT TOUCHED THE CANVAS, using the
 * planner's own published attributes (`data-view-*` / `data-reg-*` on the canvas svg) as the
 * signal — no React internals, no instrumentation build. One observer callback = one delivery
 * batch = one commit; dividing by the wheel events dispatched gives renders-per-wheel, which is
 * the number the NEW-3(b)+(c) work has to move. */
if (DO_WHEEL) {
  await page.mouse.move(cx, cy);
  await page.evaluate(() => {
    window.__frames.length = 0;
    window.__zoomCommits = 0;
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    const WATCH = ["data-view-ppf", "data-view-offx", "data-view-offy", "data-reg-dx", "data-reg-dy"];
    window.__zoomObs = new MutationObserver((recs) => {
      if (recs.some((r) => WATCH.includes(r.attributeName))) window.__zoomCommits++;
    });
    if (svg) window.__zoomObs.observe(svg, { attributes: true, attributeFilter: WATCH });
  });
  /* ⚠ THE DRIVER IS IN-PAGE AND BURSTED, AND THAT IS THE WHOLE POINT — MEASURED, NOT ASSUMED.
   * The first version of this block used `page.mouse.wheel()`, which awaits a CDP round-trip per
   * notch and so delivers them roughly one per animation frame. Against that input a coalescing
   * handler and an uncoalesced one are INDISTINGUISHABLE — there is never a second event inside a
   * frame to coalesce — and the harness duly reported an identical 1.00 commits/wheel on the
   * pre-fix and post-fix builds. That is a measurement artefact, not a finding, and reporting it
   * as one would have been the B1086 trap wearing different clothes.
   * A real trackpad flick (and Chrome's own coalesced delivery under load) puts SEVERAL wheel
   * events into one task. So the gesture is dispatched in-page in bursts: five events per task,
   * yielding between bursts. That is the input shape the owner's report describes, and it is the
   * only shape under which "renders per wheel event" means anything. */
  const WHEEL_EVENTS = 40, BURST = 5;
  const zoomT0 = Date.now();
  for (let b = 0; b < WHEEL_EVENTS / BURST; b++) {
    // Alternate direction every other burst so the view can't run into the ppf clamp, where the
    // handler short-circuits and the sample would flatter the very code we are measuring.
    await page.evaluate(([n, dy, x, y]) => new Promise((done) => {
      /* ⚠ ONE EVENT PER TASK — this is the load-bearing detail, and the second artefact this
       * block had to be corrected for. Dispatching the burst inside ONE task is useless: React 18
       * auto-batches every `setView` in a single task into a single commit, so the uncoalesced
       * handler measured identically to the coalesced one (16.7 ms median either way, across four
       * runs each). Real wheel input does not arrive that way. Chrome delivers each (possibly
       * coalesced) wheel event in its OWN task, and auto-batching does not span tasks — so N events
       * inside one frame become N separate full commits of the ~4,600-node tree. That is the defect,
       * and a MessageChannel port pump is the smallest faithful reproduction of it. */
      const el = document.querySelector('[data-testid="planner-canvas"]');
      const ch = new MessageChannel();
      let i = 0;
      ch.port1.onmessage = () => {
        el.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        if (++i < n) ch.port2.postMessage(0); else done();
      };
      ch.port2.postMessage(0);
    }), [BURST, b % 2 ? -120 : 120, cx, cy]);
    await page.waitForTimeout(40);
  }
  const zoomMs = Date.now() - zoomT0;
  await page.waitForTimeout(120);   // let the last coalesced frame commit before we read
  const zoom = await page.evaluate(() => {
    const out = { frames: window.__frames.map((f) => f.d), commits: window.__zoomCommits };
    if (window.__zoomObs) window.__zoomObs.disconnect();
    return out;
  });
  const zoomFrames = zoom.frames.slice(1);   // same first-sample drop as the drag
  results.zoomFrameSamples = zoomFrames.length;
  results.zoomGestureMs = zoomMs;
  results.zoomWheelEvents = WHEEL_EVENTS;
  results.zoomCanvasCommits = zoom.commits;
  results.zoomCommitsPerWheel = +(zoom.commits / WHEEL_EVENTS).toFixed(2);
  results.zoomObservedFps = observedFps(zoomFrames.length, zoomMs);
  const zoomFault = frameSamplingFaultFor({ visibility, samples: zoomFrames.length, gestureMs: zoomMs });
  if (zoomFault) {
    results.zoomFrameMedianMs = null;
    results.zoomFrameP90Ms = null;
    notes.push(`zoom frame timing UNRELIABLE — ${zoomFault}`);
  } else {
    results.zoomFrameMedianMs = zoomFrames.length ? +pct(zoomFrames, 50).toFixed(1) : null;
    results.zoomFrameP90Ms = zoomFrames.length ? +pct(zoomFrames, 90).toFixed(1) : null;
  }
}

/* ---- pan / zoom / overlay-toggle loop → peak heap -------------------------------------------
 * MEASUREMENT BLOCKER #3 — performance.measureUserAgentSpecificMemory() is unavailable on
 * planyr.io (it requires cross-origin isolation, which the app does not set), so full-TAB
 * memory cannot be measured here at all. This is performance.memory.usedJSHeapSize: the JS heap
 * ONLY. Decoded tile bitmaps and GPU memory sit outside it — the owner observed ~555 MB for the
 * tab while the JS heap peaked at 134.6 MB. Never present this number as tab memory. */
let peakHeap = 0;
const sampleHeap = async () => {
  const h = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
  if (h > peakHeap) peakHeap = h;
};
await sampleHeap();
for (let i = 0; i < 6; i++) {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 200, cy + 120, { steps: 6 });
  await page.mouse.up();
  await page.mouse.wheel(0, i % 2 ? -420 : 420);
  await page.keyboard.press("l").catch(() => {}); // layer-panel toggle, best-effort
  await page.waitForTimeout(180);
  await sampleHeap();
}
results.peakHeapMB = peakHeap ? +(peakHeap / 1048576).toFixed(1) : null;
if (!peakHeap) notes.push("peakHeap unavailable — performance.memory not exposed (needs --enable-precise-memory-info)");

results.aerialTileRequests = NO_TILES ? null : tiles.length;
results.siteRouteChunks = [...new Set(jsChunks)];

await browser.close();

/* ---- Evaluate ------------------------------------------------------------------------------ */
const failures = [], aboveTarget = [], passes = [], skipped = [], unreliable = [];
const r = budgets.runtime;
const METRICS = ["timeToFirstDragMs", "firstAerialCoverageMs", "frameMedianMs", "frameP90Ms", "peakHeapMB", "aerialTileRequests", "firstContentfulPaintMs"];

/* Metrics whose value depends on the page's external, render-blocking resources resolving.
 * Frame time and heap are measured long after load and are unaffected, so they still count. */
const LOAD_SENSITIVE = new Set(["timeToFirstDragMs", "firstContentfulPaintMs", "firstAerialCoverageMs"]);
const loadTimingsTrustworthy = failedExternal.size === 0 && !NO_TILES;

for (const m of METRICS) {
  const spec = r[m];
  const value = results[m];
  if (!spec) continue;
  if (value == null) {
    // A frame metric suppressed by the sampling guard is NOT the same as "not measurable here" —
    // say which, and say why, so nobody re-seeds a ceiling from a throttled run again.
    const why = (m === "frameMedianMs" || m === "frameP90Ms") && frameSamplingFault ? frameSamplingFault : null;
    skipped.push({ metric: `runtime.${m}`, why });
    continue;
  }
  const row = { metric: `runtime.${m}`, value, ceiling: spec.ceiling, target: spec.target, unit: spec.unit };
  if (LOAD_SENSITIVE.has(m) && !loadTimingsTrustworthy) { unreliable.push(row); continue; }
  if (value > spec.ceiling) failures.push({ ...row, delta: +(value - spec.ceiling).toFixed(1), pct: (value / spec.ceiling - 1) * 100 });
  else if (spec.target != null && value > spec.target) aboveTarget.push({ ...row, gap: +(value - spec.target).toFixed(1), owner: budgets.targetOwner?.[`runtime.${m}`] || null });
  else passes.push(row);
}
if (unreliable.length) {
  notes.push(NO_TILES
    ? "load timings NOT judged: --no-tiles blocks every cross-origin request, including the render-blocking webfont stylesheet, so they are a local-only figure."
    : `load timings NOT judged: external resources failed to load (${[...failedExternal].join(", ")}), which delays render-blocking CSS and inflates paint timings.`);
}

/* Route-chunk guard, runtime edition. The static audit (perf-bundle-audit.mjs) can only see
 * STATIC import edges; the NEW-9 regression was a boot-time runtime import(), which is invisible
 * to it. This assertion is the one that would actually have caught it in the act. */
const allow = new Set(budgets.bundle.siteRouteAllowlist?.allow || []);
/* Shared with the bundle audit so the two instruments name a chunk identically. The loose
 * inline copy this replaced matched "8 OR MORE" hash characters and so ate the tail of any
 * hyphenated chunk name — it reported `map-vendor` as "map" and `cjs-interop` as "cjs", which
 * then failed to match the committed allowlist and turned two expected chunks into phantom
 * intruders. */
const stem = (f) => stemOf(f);
const intruders = results.siteRouteChunks.filter((f) => !allow.has(stem(f)));
if (intruders.length) {
  failures.push({ metric: "runtime.siteRouteChunks", value: intruders.map(stem).join(", "), ceiling: [...allow].join(", "), named: true });
}

if (JSON_OUT) {
  console.log(JSON.stringify({ base: BASE, scenario: site.id, results, frameSamplingFault, failures, aboveTarget, passes, skipped, unreliable, notes }, null, 2));
} else {
  console.log(`Planyr runtime performance harness (NEW-8)\n  target: ${BASE}\n  scenario: ${site.id} @ ${ORIGIN.lat},${ORIGIN.lon} (stands in for Sylvestri / Concept C)\n`);
  console.log(`  site-route chunks fetched: ${results.siteRouteChunks.length} — ${results.siteRouteChunks.map(stem).join(", ")}`);
  if (DO_DRAG) console.log(`  frame samples during drag: ${results.frameSamples} over ${results.frameGestureMs} ms (${results.frameObservedFps} fps, tab "${results.frameVisibility}")`);
  if (DO_WHEEL) {
    // NEW-3(a) — the ZOOM gesture, reported alongside the drag. `commits/wheel` is the number the
    // coalescing + epsilon work has to move; the medians are suppressed rather than guessed when
    // the sample cannot be trusted, exactly as the drag's are.
    const med = results.zoomFrameMedianMs == null ? "NOT REPORTED (starved sample)" : `${results.zoomFrameMedianMs} ms median · ${results.zoomFrameP90Ms} ms p90`;
    console.log(`  zoom (wheel): ${med}`);
    console.log(`      ${results.zoomFrameSamples} frames over ${results.zoomGestureMs} ms (${results.zoomObservedFps} fps, tab "${visibility}") · ${results.zoomCanvasCommits} canvas commits across ${results.zoomWheelEvents} wheel events = ${results.zoomCommitsPerWheel} per wheel`);
  }
  console.log();
  for (const p of passes) console.log(`  ✓ ${p.metric} — ${p.value} ${p.unit} (ceiling ${p.ceiling})`);
  for (const a of aboveTarget) {
    console.log(`  ⚠ ${a.metric} — ${a.value} ${a.unit} is within its ${a.ceiling} ceiling but ABOVE the ${a.target} target (gap ${a.gap})`);
    if (a.owner) console.log(`      tracked by: ${a.owner}`);
  }
  for (const s of skipped) {
    console.log(`  – ${s.metric} — ${s.why ? "NOT REPORTED (measurement invalid)" : "SKIPPED (not measurable in this run)"}`);
    if (s.why) console.log(`      ${s.why}`);
  }
  for (const u of unreliable) console.log(`  – ${u.metric} — ${u.value} ${u.unit} MEASURED BUT NOT JUDGED (see note below; ceiling ${u.ceiling})`);
  for (const f of failures) {
    if (f.named) {
      console.log(`\n  ✗ ${f.metric} — UNEXPECTED CHUNK(S) FETCHED ON A SITE ROUTE: ${f.value}`);
      console.log(`      allowed: ${f.ceiling}`);
      console.log("      Something is warming a route-irrelevant workspace at boot again (the NEW-9 regression).");
    } else {
      console.log(`\n  ✗ ${f.metric} — ${f.value} ${f.unit} exceeds the ${f.ceiling} ceiling by ${f.delta} (+${f.pct.toFixed(1)}%)`);
    }
  }
  for (const n of notes) console.log(`  · ${n}`);
  console.log();
  console.log(failures.length
    ? `✗ ${failures.length} performance budget breach(es). See docs/PERF-BUDGETS.md.`
    : `✓ All measurable runtime budgets within ceiling${aboveTarget.length ? ` (${aboveTarget.length} above target — tracked)` : ""}.`);
}
process.exit(failures.length ? 1 : 0);
