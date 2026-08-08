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
 *   canvasNodes            SVG element count inside the planner canvas, PER ZOOM LEVEL (NEW-1)
 *
 * WHY THIS IS NOT IN THE REQUIRED CI BUILD CHECK. Frame time and heap on a shared CI runner
 * are dominated by co-tenant CPU contention — gating merges on them produces flaky reds that
 * teach people to re-run until green, which is worse than no budget at all. The aerial budget
 * additionally needs live external tile hosts. So the DETERMINISTIC half (bundle weight, and
 * the route-chunk allowlist that catches the NEW-9 prefetch regression by name) is what gates
 * CI via ui-audit/perf-bundle-audit.mjs; this half runs on demand and before shipping anything
 * that touches render or load. docs/PERF-BUDGETS.md records the split and the reasoning.
 *
 * REFERENCE SCENARIO. ⚠ REPLACED 2026-07-31 (NEW-1). Until then this harness drove a HAND-
 * AUTHORED stand-in whose "road" was a rectangle with no `pts`/`vtx` and which contained no
 * ponds and no polygon elements at all — so lib/roadGeometry.js, lib/detentionRules.js and
 * lib/floodplainMitigation.js, the most expensive code in the app, executed ZERO TIMES in the
 * benchmark that certified them, and its perfect 16.7 ms median measured a scene with the work
 * taken out. The scenario is now DERIVED from ui-audit/fixtures/goose-creek-plan1copy.json —
 * the owner's real Goose Creek plan, pulled from production, with 6 centerline roads (arc
 * vertices), 2 ponds and 6 parcels. See the long note in ui-audit/lib/perf-scenario.mjs.
 * It is still a FLOOR, not a match, for the owner's heaviest signed-in plans (VERIFICATION.md).
 *
 *   node ui-audit/perf-harness.mjs                       # against http://localhost:4173
 *   BASE_URL=https://planyr.io node ui-audit/perf-harness.mjs
 *   node ui-audit/perf-harness.mjs --json
 *   node ui-audit/perf-harness.mjs --no-tiles            # skip the aerial metrics (offline)
 *   node ui-audit/perf-harness.mjs --cpu-throttle 4      # emulate a slower machine (NOT judged)
 *   node ui-audit/perf-harness.mjs --dpr 2               # emulate a retina display (NOT judged)
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

/* ---- --cpu-throttle N / --dpr N (NEW-1, 2026-07-31) -----------------------------------------
 * THE THIRD REASON THIS HARNESS COULDN'T SEE THE OWNER'S LAG, after the empty scene and the
 * no-op gesture. Even with the real plan and a real pan it reports a flat 16.7 ms median, and
 * that is not a lie — it is a true measurement of a machine that is not his. This container is
 * a fast headless CPU at deviceScaleFactor 1 with every tile host blocked; the owner is on a
 * laptop at dpr 2.15 with a live aerial basemap under the plan. A budget measured only at 1× is
 * a budget with no dynamic range: everything passes, so nothing is comparable, and an
 * optimisation that halves the work still reads 16.7 → 16.7.
 *
 * So the harness can now emulate a slower machine (CDP Emulation.setCPUThrottlingRate — the same
 * mechanism Lighthouse uses for its mobile profile) and a retina display. Under either, the frame
 * metrics are reported and compared run-to-run but NOT judged against the committed ceilings,
 * which were seeded at 1×: a throttled figure is a MEASUREMENT INSTRUMENT for A/B work, not a
 * budget, and quietly judging it would be the B1086 trap with a new coat of paint.
 *
 * ⚠ This is emulation, not the owner's machine. It is the only honest way to get discrimination
 * out of a box this fast; the production confirmation is still a signed-in live check. */
const numArg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : dflt;
};
const CPU_THROTTLE = numArg("--cpu-throttle", 1);
const DPR = numArg("--dpr", 1);
const EMULATED = CPU_THROTTLE > 1 || DPR !== 1;

/* ---- --boot-timeline (NEW-1, phase 3, 2026-07-31) --------------------------------------------
 * WHY THIS MODE EXISTS. This harness reports time-to-first-drag as ONE number — 4.4–7.9 s at 4×
 * throttle against a first-contentful-paint under a second — and that number, the largest single
 * figure in the whole speed program, has never had a breakdown behind it. `--boot-timeline`
 * attributes the whole navigation → first-drag window to NAMED phases with milliseconds against
 * each, and charges anything it cannot name to an explicit UNATTRIBUTED line rather than letting a
 * remainder hide inside a bucket. The protocol and its limits live in ui-audit/lib/bootTimeline.mjs.
 *
 *   node ui-audit/perf-harness.mjs --no-tiles --cpu-throttle 4 --boot-timeline
 *   node ui-audit/perf-harness.mjs --no-tiles --cpu-throttle 4 --boot-timeline --arms baseline,no-drainage --reps 3
 *
 * ⚠ FOR NAMED PHASES, BUILD WITH SOURCE MAPS FIRST: `npx vite build --sourcemap`. Without them a
 * production profile can only say "SitePlannerApp-BxMJopPJ.js:7", and the mode says so in its own
 * output instead of printing a chunk name where a phase name should be.
 */
const BOOT_TIMELINE = process.argv.includes("--boot-timeline");
const argOfBoot = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : dflt; };

/* The boot-timeline report. Deliberately verbose in one specific way: every table states what it
 * CANNOT say (unresolved chunks, a suppressed cross-tab, an absent external network) next to what
 * it can, because a boot breakdown that reads as complete when it is not is how four seconds get
 * "explained" twice. */
function printBootTimeline(out, MARK_LABELS) {
  console.log(`Boot timeline — navigation → first drag  [cpu ${out.cpuThrottle}x, dpr ${out.deviceScaleFactor}, ${out.sampleUs} µs sampling]`);
  console.log(`  target: ${out.base}  ·  scenario: ${out.scenario} (${out.shape.elements} elements · ${out.shape.parcels} parcels · ${out.shape.ponds} ponds)`);
  console.log(`  arms: ${out.arms.join(" · ")} × ${out.reps} rep(s), INTERLEAVED\n`);
  for (const a of out.byArm) {
    console.log(`  ${a.arm.padEnd(14)} time-to-first-drag: median ${a.ttfdMedianMs} ms  (${a.n} run(s), ${a.ttfdMinMs}–${a.ttfdMaxMs} ms)`);
  }
  if (out.noiseFloorPct != null) console.log(`\n  NOISE FLOOR, measured here: ±${out.noiseFloorPct}% across the "${out.byArm[0].arm}" repeats. Nothing inside it is a finding.`);
  if (out.byArm.length > 1 && out.byArm[0].ttfdMedianMs) {
    for (const a of out.byArm.slice(1)) {
      const pct = +(((a.ttfdMedianMs - out.byArm[0].ttfdMedianMs) / out.byArm[0].ttfdMedianMs) * 100).toFixed(1);
      const verdict = out.noiseFloorPct == null ? "NO FLOOR MEASURED (single rep) — not a finding"
        : Math.abs(pct) <= out.noiseFloorPct ? `INCONCLUSIVE — inside the ±${out.noiseFloorPct}% floor`
        : `${pct < 0 ? "FASTER" : "SLOWER"} by ${Math.abs(pct)}%, which clears the floor`;
      console.log(`  arm "${a.arm}" vs "${out.byArm[0].arm}": ${pct > 0 ? "+" : ""}${pct}% — ${verdict}`);
    }
  }
  for (const r of out.runs) {
    console.log(`\n──── rep ${r.rep} · arm "${r.arm}" · time-to-first-drag ${r.ttfdMs} ms · canvas ${r.canvasNodes} nodes · tab "${r.visibility}"`);
    if (!r.sourceMaps.mapped) {
      console.log(`  ⚠ NO SOURCE MAPS in dist/assets — script phases below are CHUNK-level only. Rebuild with \`npx vite build --sourcemap\` for named phases.`);
    }
    console.log(`\n  WALL SPINE (consecutive measured marks — these sum EXACTLY to time-to-first-drag):`);
    for (const s of r.segments) console.log(`     ${String(s.ms).padStart(7)} ms   ${s.from} → ${s.to}`);
    if (r.missingMarks.length) console.log(`     (marks that never fired: ${r.missingMarks.map((m) => MARK_LABELS[m] || m).join(", ")})`);
    console.log(`\n  WHAT THE MAIN THREAD DID across the whole window (${r.attribution.totalMs} ms of samples):`);
    for (const p of r.attribution.phases) console.log(`     ${String(p.ms).padStart(7)} ms  ${String(p.pct).padStart(5)}%  ${p.phase}`);
    if (r.attribution.unattributed.length) {
      console.log(`     ── the UNATTRIBUTED line above, by name:`);
      for (const u of r.attribution.unattributed) console.log(`        ${String(u.ms).padStart(7)} ms  ${u.fn}`);
    }
    if (r.crossTab.rows) {
      console.log(`\n  THE SAME TIME, SEGMENT BY SEGMENT (clock alignment ±${r.alignment.uncertaintyMs} ms via an in-profile burn marker):`);
      for (const row of r.crossTab.rows) {
        if (!row.phases || row.ms < 1) continue;
        /* BUSY vs IDLE FIRST, then the names. The single most important question about any boot
         * segment is whether the thread was WORKING or WAITING — they have completely different
         * fixes — and a top-N list of phases can hide the answer when idle is not in the top N. */
        const idle = row.phases.find((p) => p.phase.startsWith("idle"));
        const idlePct = idle ? idle.pct : 0;
        const top = row.phases.filter((p) => !p.phase.startsWith("idle")).slice(0, 4).map((p) => `${p.phase} ${p.ms}ms`).join(" · ");
        console.log(`     ${String(row.ms).padStart(7)} ms  ${row.from} → ${row.to}`);
        console.log(`               busy ${(100 - idlePct).toFixed(0)}% · idle ${idlePct.toFixed(0)}%  │  ${top}`);
      }
    } else {
      console.log(`\n  ⚠ per-segment attribution SUPPRESSED — ${r.crossTab.why}`);
    }
    console.log(`\n  NETWORK during boot:`);
    for (const n of r.network) console.log(`     ${String(n.count).padStart(4)} req  ${n.failed ? `${n.failed} blocked/failed  ` : ""}${(n.bytes / 1024).toFixed(0).padStart(6)} KB  ${n.firstMs ?? "—"}–${n.lastMs} ms  ${n.category}`);
    const lt = r.longTasks.filter((t) => t.dur >= 50);
    if (lt.length) {
      const worst = [...lt].sort((a, b) => b.dur - a.dur).slice(0, 5);
      console.log(`\n  LONG TASKS (≥50 ms): ${lt.length}, totalling ${Math.round(lt.reduce((a, b) => a + b.dur, 0))} ms. Worst: ${worst.map((t) => `${t.dur} ms @ ${t.start}`).join(" · ")}`);
    }
  }
  console.log(`\n  ⚠ This sandbox blocks every external host, so basemap tiles / GIS / Supabase are ABSENT, not slow. Every number above is a LOWER BOUND on a machine with a live network.`);
}

const budgets = JSON.parse(readFileSync(join(HERE, "perf-budgets.json"), "utf8"));

/* Set when the frame sampler cannot be trusted (see MEASUREMENT BLOCKER #4 below); non-null
 * suppresses the frame medians entirely rather than reporting a starved figure. */
let frameSamplingFault = null;

/* ---- Reference scenario ------------------------------------------------------------------
 * Owned by ui-audit/lib/perf-scenario.mjs — see the long note there for why this is a
 * purpose-built scenario rather than the e2e dense-testfit fixture (that fixture carries the
 * pure-engine geometry schema and crashes the live render path). */
const { ORIGIN, SCENARIO_ID, perfScenarioSite, perfScenarioSeed, scenarioShape } = await import("./lib/perf-scenario.mjs");
const shape = scenarioShape();
const { frameSamplingFault: frameSamplingFaultFor, idleGestureFault, observedFps, plausibilityFloor } = await import("./lib/frameSampling.mjs");
const MIN_FPS = plausibilityFloor(CPU_THROTTLE);
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
/* ---- BOOT TIMELINE MODE ----------------------------------------------------------------------
 * Runs and exits before the budget metrics below, deliberately: every one of them describes a
 * settled page, and this mode is only about the window before there is one. It drives its own
 * browser CONTEXTS (one per boot — a reused context carries a warm HTTP cache, a warm V8 code cache
 * and a populated IndexedDB, and would answer a different question on every rep after the first).
 */
if (BOOT_TIMELINE) {
  const { runBootTimeline, MARK_LABELS } = await import("./lib/bootTimeline.mjs");
  const { scenarioArm } = await import("./lib/perf-scenario.mjs");
  const arms = String(argOfBoot("--arms", "baseline")).split(",").map((s) => s.trim()).filter(Boolean);
  const reps = numArg("--reps", 1);
  const sampleUs = numArg("--sample-us", 250);
  const runs = [];
  /* INTERLEAVED, rep by rep — arm A, arm B, arm A, arm B — never all of A then all of B. This
   * container's warm-up drift across a few minutes is larger than most of the effects being looked
   * for, and a blocked A/B would hand the whole drift to whichever arm ran second. */
  for (let rep = 0; rep < reps; rep++) {
    for (const arm of arms) {
      const out = await runBootTimeline(browser, {
        base: BASE, seed: perfScenarioSeed(scenarioArm(arm)), sampleUs,
        cpuThrottle: CPU_THROTTLE, dpr: DPR, noTiles: NO_TILES, distDir: join(ROOT, "dist"), arm,
      });
      runs.push({ rep: rep + 1, ...out });
    }
  }
  await browser.close();
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const byArm = arms.map((arm) => {
    const rs = runs.filter((r) => r.arm === arm);
    const ttfds = rs.map((r) => r.ttfdMs);
    return { arm, n: rs.length, ttfdMedianMs: med(ttfds), ttfdMinMs: Math.min(...ttfds), ttfdMaxMs: Math.max(...ttfds) };
  });
  /* THE NOISE FLOOR IS MEASURED, NOT ASSUMED — the spread of the baseline arm's own repeats. A
   * difference between arms that does not clear it is reported INCONCLUSIVE, never as a finding. */
  const baseArm = byArm[0];
  const floorPct = baseArm && baseArm.n > 1 && baseArm.ttfdMedianMs
    ? +(((baseArm.ttfdMaxMs - baseArm.ttfdMinMs) / baseArm.ttfdMedianMs) * 100).toFixed(1) : null;
  const out = { base: BASE, scenario: site.id, shape, cpuThrottle: CPU_THROTTLE, deviceScaleFactor: DPR, sampleUs, arms, reps, noiseFloorPct: floorPct, byArm, runs };
  if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
  else printBootTimeline(out, MARK_LABELS);
  process.exit(0);
}

const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: DPR });

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

/* CPU throttling is applied AFTER the page exists but BEFORE navigation, so the load timings and
 * the frame timings are measured on the same emulated machine rather than one each. */
if (CPU_THROTTLE > 1) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
}
results.cpuThrottle = CPU_THROTTLE;
results.deviceScaleFactor = DPR;

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

/* ---- LONG-SESSION DEGRADATION MODE (B1357) ---------------------------------------------------
 * "Does zoom degrade the longer I stay on a site?" — the owner's question, and one nothing in this
 * repo could answer, because every instrument here measures a FRESH page. This mode runs the same
 * reference gestures at t=0 and again after each round of a realistic session workload, records
 * every counter that could explain a move, states a noise floor measured on this machine in this
 * run, and refuses to call anything real that does not clear it.
 *
 * It short-circuits the rest of the harness deliberately: the budget metrics below all describe a
 * fresh load and mean nothing after twenty minutes of driving. The protocol lives in
 * ui-audit/lib/longSession.mjs so it is unit-testable; everything it needs — the seeded Goose Creek
 * scenario, the rAF frame sampler, the CPU/DPR emulation, the frame-sampling trust rules — is
 * inherited from the setup above rather than re-derived.
 *
 *   node ui-audit/perf-harness.mjs --no-tiles --cpu-throttle 4 --long-session
 *   node ui-audit/perf-harness.mjs --no-tiles --cpu-throttle 4 --long-session --arm grow --rounds 6
 */
if (process.argv.includes("--long-session")) {
  const { runLongSession, DEFAULT_ROUNDS, DEFAULT_REPS } = await import("./lib/longSession.mjs");
  const arm = (() => { const i = process.argv.indexOf("--arm"); const v = i >= 0 ? String(process.argv[i + 1]) : "hold"; return ["hold", "grow"].includes(v) ? v : "hold"; })();
  const out = await runLongSession(page, {
    cx, cy,
    visibility: await page.evaluate(() => document.visibilityState),
    minFps: MIN_FPS,
    faultFor: frameSamplingFaultFor,
    rounds: numArg("--rounds", DEFAULT_ROUNDS),
    reps: numArg("--reps", DEFAULT_REPS),
    arm,
  });
  await browser.close();
  const res = { base: BASE, scenario: site.id, cpuThrottle: CPU_THROTTLE, deviceScaleFactor: DPR, ...out };
  if (JSON_OUT) console.log(JSON.stringify(res, null, 2));
  else {
    console.log(`Long-session degradation — arm "${out.arm}" (${out.arm === "hold" ? "THE PLAN NEVER CHANGES — anything that moves is retention" : "elements are ADDED — this arm sizes load, not retention"})`);
    console.log(`  target: ${BASE}  ·  scenario: ${site.id}  ·  cpu ${CPU_THROTTLE}x, dpr ${DPR}  ·  ${out.rounds} rounds after ${out.reps} baseline repeats\n`);
    console.log(`  NOISE FLOOR, measured here: wheel ±${out.noiseFloor.floorPct ?? "—"}% (${out.noiseFloor.min}–${out.noiseFloor.max} ms across ${out.reps} repeats${out.noiseFloor.quantumFloored ? ", floored at one frame quantum — the repeats were identical" : ""}) · pan ±${out.panNoiseFloor.floorPct ?? "—"}%`);
    console.log(`  Nothing below the floor is reported as a finding.\n`);
    console.log(`  round │ wheel med │ pan med │ pan commits/move │  heap │ canvas nodes │ doc nodes │ tiles │ drawn els │ added`);
    for (const c of out.series) {
      console.log(`  ${String(c.round).padStart(5)} │ ${String(c.wheelMedianMs ?? "—").padStart(9)} │ ${String(c.panMedianMs ?? "—").padStart(7)} │ ${String(c.panCommitsPerMove).padStart(16)} │ ${String(c.counters.heapMB ?? "—").padStart(5)} │ ${String(c.counters.canvasNodes).padStart(12)} │ ${String(c.counters.documentNodes).padStart(9)} │ ${String(c.counters.tiles).padStart(5)} │ ${String(c.counters.elementsDrawn).padStart(9)} │ ${String(c.added).padStart(5)}`);
      if (c.wheelFault) console.log(`        ⚠ wheel median SUPPRESSED — ${c.wheelFault}`);
      if (c.panFault) console.log(`        ⚠ pan median SUPPRESSED — ${c.panFault}`);
      if (c.round > 0 && !c.wheelMoved) console.log(`        ⚠ the wheel gesture did not move the view — this checkpoint measured an idle page`);
      if (c.round > 0 && !c.panMoved) console.log(`        ⚠ the pan gesture did not move the view — this checkpoint measured an idle page`);
    }
    const totalAdded = out.series.reduce((n, c) => n + (c.added || 0), 0);
    if (out.arm === "grow" && totalAdded === 0) {
      console.log(`\n  ⛔ THE "grow" ARM ADDED NOTHING — it could not reach the draw tool, so this run is a second copy of the "hold" arm and says NOTHING about load. Do not read it as one.`);
    }
    const v = out.verdict;
    console.log(`\n  VERDICT — wheel: ${v.wheel.verdict}${v.wheel.changePct == null ? "" : ` (${v.wheel.changePct > 0 ? "+" : ""}${v.wheel.changePct}% vs the ±${out.noiseFloor.floorPct}% floor)`}`);
    console.log(`           pan:   ${v.pan.verdict}${v.pan.changePct == null ? "" : ` (${v.pan.changePct > 0 ? "+" : ""}${v.pan.changePct}% vs the ±${out.panNoiseFloor.floorPct}% floor)`}`);
    console.log(`  counters start → end: heap ${v.heapMB.from} → ${v.heapMB.to} MB · canvas nodes ${v.canvasNodes.from} → ${v.canvasNodes.to} · document nodes ${v.documentNodes.from} → ${v.documentNodes.to} · tile <img> ${v.tiles.from} → ${v.tiles.to} (DECODED ${v.tilesLoaded.from} → ${v.tilesLoaded.to}) · drawn elements ${v.elementsDrawn.from} → ${v.elementsDrawn.to}`);
    if (out.correlations.length) {
      console.log(`\n  Which counter moved WITH the wheel cost (weak evidence over ${out.series.length} points — a name for a suspect, never a proof):`);
      for (const c of out.correlations.slice(0, 5)) console.log(`      r=${String(c.r).padStart(5)}  ${c.counter}  (${c.from} → ${c.to})`);
    }
    if (out.tileCaveat) console.log(`\n  ⚠ ${out.tileCaveat}`);
  }
  process.exit(0);
}

await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 40, cy + 30, { steps: 4 });
await page.mouse.up();
results.timeToFirstDragMs = Math.round(await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => res(performance.now())))));

/* SNAPSHOT THE ROUTE-CHUNK SET HERE, not at the end of the run (NEW-1).
 * The guard's own definition is "which JS chunks a PLAIN SITE ROUTE fetched" — the boot path —
 * but it was read after the scripted gesture loops, which press "l" six times and could
 * legitimately pull lazily-imported modules. Splitting boot from post-boot makes the metric
 * mean what it says.
 * ⚠ AND IT REFUTED THE HYPOTHESIS THAT MOTIVATED IT, which is worth recording rather than
 * quietly deleting: the five chunks this metric is currently red on (floodZoneCopy,
 * rasterIdentifyMap, rasterIdentify, featureHover, terrainLayers) turn out to be fetched at
 * BOOT, before any gesture — `lazyChunksAfterBoot` measures empty. So the red is real, not an
 * artefact of when the list was read, and the guard is doing its job. Owned by its own item. */
/* ⚠ AND IT MUST SETTLE FIRST (B1349, 2026-07-31) — THIS GUARD COULD SILENTLY PASS.
 * The snapshot was taken the instant the time-to-first-drag gesture returned, which made the
 * metric a RACE against React's own mount effects: a boot-path `import()` fired from an effect is
 * only in `jsChunks` if it has been REQUESTED by that moment, and whether it has depends on how
 * fast the machine is. Measured on this container within one session: the same build reported all
 * five intruders when time-to-first-drag was 7.1 s and NONE of them when the box warmed up and the
 * same figure fell to 4.4 s. A guard that reports "clean" because the machine got faster is worse
 * than no guard — it is the B1086 trap in a new place, and it nearly certified an unverified fix.
 * B1349's own definition of the defect is "in flight on an idle page, no gesture, four seconds of
 * idle", so the metric now waits for exactly that: a settle window with no gesture in it. */
const BOOT_SETTLE_MS = 4000;
await page.waitForTimeout(BOOT_SETTLE_MS);
const bootChunks = [...new Set(jsChunks)];

results.firstContentfulPaintMs = Math.round(
  await page.evaluate(() => {
    const e = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
    return e ? e.startTime : 0;
  })
);

/* B276576 — ASK THE QUESTION THAT ACTUALLY GATES PAINT TIMINGS, instead of "did any external
 * host fail". Those are not the same question, and conflating them is what kept these metrics
 * muted long after they became measurable: an aerial TILE host failing does not delay first
 * paint by one millisecond (tiles are images fetched after boot), but it used to mute FCP all
 * the same. The thing that genuinely inflates paint is a cross-origin RENDER-BLOCKING resource
 * — a stylesheet, or a synchronous script — because a script cannot execute until every
 * preceding stylesheet resolves. index.html had exactly one (fonts.googleapis.com) until
 * B276576 self-hosted Inter; now it has none, so these timings can be judged again.
 * Measured from the live document rather than assumed, so the mute RETURNS AUTOMATICALLY,
 * naming the culprit, if anyone reintroduces a third-party blocker. */
const crossOriginBlocking = await page.evaluate(() =>
  [...document.querySelectorAll('link[rel="stylesheet"], script[src]:not([defer]):not([async]):not([type="module"])')]
    .map((el) => el.href || el.src)
    .filter((u) => { try { return new URL(u, location.href).origin !== location.origin; } catch { return false; } })
);
results.crossOriginBlocking = crossOriginBlocking;

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
 * in ui-audit/lib/frameSampling.mjs so it is unit-tested and cannot drift from the docs.
 *
 * MEASUREMENT BLOCKER #5 — THE GESTURE WAS A NO-OP (NEW-1, 2026-07-31). Both guards above ask
 * whether enough frames arrived. Neither asked whether the drag DID anything. This block pressed
 * at the exact canvas CENTRE, and on any plan with something in the middle of it that press lands
 * on an ELEMENT — so it never panned. Measured on the real Goose Creek plan: 604 DOM mutations
 * for the centre-press gesture, 641,730 for the identical gesture started on bare canvas. The
 * sampler saw a clean 60 fps for both and reported the first as a 16.7 ms median. So: the press
 * point is now CHOSEN (the first candidate that is bare canvas, not an element), and the view
 * transform is read before and after — a gesture that moved nothing is REFUSED, not reported. */
const visibility = await page.evaluate(() => document.visibilityState);
const viewNow = () => page.evaluate(() => {
  const s = document.querySelector('[data-testid="planner-canvas"]');
  return s ? `${s.getAttribute("data-view-offx")}|${s.getAttribute("data-view-offy")}|${s.getAttribute("data-view-ppf")}` : null;
});
/* A press point that is BARE CANVAS. Candidates are fixed fractions of the canvas, tried in a
 * fixed order, so the choice is deterministic for a given scene + viewport; the chosen point is
 * reported, because a harness that silently drags somewhere else run to run is not an instrument. */
const pressPoint = await page.evaluate(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  const r = svg.getBoundingClientRect();
  for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) {
    for (const fx of [0.5, 0.25, 0.75, 0.12, 0.88]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !svg.contains(hit)) continue;
      if (hit.closest("[data-el-id]")) continue;          // an element — a press here MOVES it
      return { x, y, fx, fy };
    }
  }
  return null;
});
const px = pressPoint ? pressPoint.x : cx, py = pressPoint ? pressPoint.y : cy;
results.dragPressAt = pressPoint ? `${pressPoint.fx}×${pressPoint.fy} of the canvas` : "canvas centre (no bare spot found)";
if (DO_DRAG) {
await page.evaluate(() => { window.__frames.length = 0; });
const viewBefore = await viewNow();
const dragT0 = Date.now();
await page.mouse.move(px, py);
await page.mouse.down();
for (let i = 0; i < 40; i++) {
  await page.mouse.move(px + Math.sin(i / 5) * 260, py + Math.cos(i / 7) * 160, { steps: 2 });
}
await page.mouse.up();
const dragMs = Date.now() - dragT0;
const viewAfter = await viewNow();
const drag = await page.evaluate(() => window.__frames.map((f) => f.d));
/* Drop the first sample: its delta spans the idle gap before the gesture, not a rendered frame. */
const dragFrames = drag.slice(1);
results.frameSamples = dragFrames.length;
results.frameGestureMs = dragMs;
results.frameObservedFps = observedFps(dragFrames.length, dragMs);
results.frameVisibility = visibility;
results.dragPanned = viewBefore !== viewAfter;
frameSamplingFault = frameSamplingFaultFor({ visibility, samples: dragFrames.length, gestureMs: dragMs, minFps: MIN_FPS })
  || idleGestureFault({ before: viewBefore, after: viewAfter });
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
  const zoomFault = frameSamplingFaultFor({ visibility, samples: zoomFrames.length, gestureMs: zoomMs, minFps: MIN_FPS });
  if (zoomFault) {
    results.zoomFrameMedianMs = null;
    results.zoomFrameP90Ms = null;
    notes.push(`zoom frame timing UNRELIABLE — ${zoomFault}`);
  } else {
    results.zoomFrameMedianMs = zoomFrames.length ? +pct(zoomFrames, 50).toFixed(1) : null;
    results.zoomFrameP90Ms = zoomFrames.length ? +pct(zoomFrames, 90).toFixed(1) : null;
  }
}

/* ---- DOM node count, PER ZOOM LEVEL (NEW-1) -------------------------------------------------
 * The harness counted leaflet TILE REQUESTS and nothing else, so the size of the thing React
 * reconciles and the browser lays out on every frame — the SVG element count inside the planner
 * canvas — was invisible to every budget. It is the number that most directly explains the
 * owner's "slow and bloated", and it is the number a level-of-detail gate has to move.
 *
 * Counted at several zooms because that is the whole question: geometry that is worth drawing at
 * a detail zoom (stall stripes, dock leaves, column grids) is still being emitted, node for node,
 * at a site-overview zoom where it resolves to unreadable grey. Rungs are labelled by their
 * MEASURED ppf (read from the canvas's own published `data-view-ppf`), never by an assumed one. */
const countNodes = () => page.evaluate(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  return {
    ppf: svg ? +Number(svg.getAttribute("data-view-ppf")).toFixed(4) : null,
    canvasNodes: svg ? svg.getElementsByTagName("*").length : 0,
    documentNodes: document.getElementsByTagName("*").length,
  };
});
/* One wheel event per task, for the reason spelled out in the zoom block above: React 18
 * auto-batches a whole task's worth of setState, so a burst in one task would zoom once. */
const zoomBy = (notches, dy) => page.evaluate(([n, delta, x, y]) => new Promise((done) => {
  const el = document.querySelector('[data-testid="planner-canvas"]');
  const ch = new MessageChannel();
  let i = 0;
  ch.port1.onmessage = () => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    if (++i < n) ch.port2.postMessage(0); else done();
  };
  ch.port2.postMessage(0);
}), [notches, dy, cx, cy]);

await page.mouse.move(cx, cy);
await page.waitForTimeout(200);
const zoomLadder = [];
zoomLadder.push(await countNodes());                                  // wherever the gestures left it
for (const [n, dy] of [[8, 120], [8, 120], [16, -120], [8, -120]]) {   // out · further out · in · further in
  await zoomBy(n, dy);
  await page.waitForTimeout(350);   // let the coalesced commit + label/declutter pass settle
  zoomLadder.push(await countNodes());
}
zoomLadder.sort((a, b) => (a.ppf || 0) - (b.ppf || 0));
results.canvasNodesByZoom = zoomLadder;
results.canvasNodesMax = Math.max(...zoomLadder.map((r) => r.canvasNodes));

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
results.siteRouteChunks = bootChunks;
results.lazyChunksAfterBoot = [...new Set(jsChunks)].filter((f) => !bootChunks.includes(f));

await browser.close();

/* ---- Evaluate ------------------------------------------------------------------------------ */
const failures = [], aboveTarget = [], passes = [], skipped = [], unreliable = [];
const r = budgets.runtime;
const METRICS = ["timeToFirstDragMs", "firstAerialCoverageMs", "frameMedianMs", "frameP90Ms", "peakHeapMB", "aerialTileRequests", "firstContentfulPaintMs"];

/* B276576 — TWO DIFFERENT GATES, because these metrics depend on two different things. The old
 * single gate (`failedExternal.size === 0 && !NO_TILES`) muted all three whenever ANY external
 * host failed, which in a sandbox is always. That was right while index.html pulled a
 * render-blocking stylesheet from fonts.googleapis.com — the sandbox blocked it and FCP went
 * from ~330 ms to ~13 s, so refusing to judge was the honest call. It is no longer right: Inter
 * is self-hosted, the boot path has no cross-origin blocker, and leaving the mute in place would
 * be inertia rather than caution. A budget muted for a bug we have now fixed is a budget nobody
 * is enforcing.
 *
 *  · PAINT-SENSITIVE  — inflated only by a cross-origin RENDER-BLOCKING resource. Judged
 *                       whenever the document has none. Tile hosts are irrelevant here.
 *  · TILE-SENSITIVE   — first aerial coverage genuinely cannot complete without the tile hosts,
 *                       so it keeps the original gate. This one is not un-muted and must not be.
 *
 * Frame time and heap are measured long after load and were never gated. */
const PAINT_SENSITIVE = new Set(["timeToFirstDragMs", "firstContentfulPaintMs"]);
const TILE_SENSITIVE = new Set(["firstAerialCoverageMs"]);
const paintTimingsTrustworthy = crossOriginBlocking.length === 0;
const tileTimingsTrustworthy = !NO_TILES && failedExternal.size === 0;

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
  if (PAINT_SENSITIVE.has(m) && !paintTimingsTrustworthy) { unreliable.push(row); continue; }
  if (TILE_SENSITIVE.has(m) && !tileTimingsTrustworthy) { unreliable.push(row); continue; }
  /* An emulated run measures a DIFFERENT MACHINE from the one every ceiling here was seeded on.
   * Report the numbers — they are the whole point of the mode — but never judge them, and never
   * let a green under emulation read as a budget pass. */
  if (EMULATED) { unreliable.push(row); continue; }
  if (value > spec.ceiling) failures.push({ ...row, delta: +(value - spec.ceiling).toFixed(1), pct: (value / spec.ceiling - 1) * 100 });
  else if (spec.target != null && value > spec.target) aboveTarget.push({ ...row, gap: +(value - spec.target).toFixed(1), owner: budgets.targetOwner?.[`runtime.${m}`] || null });
  else passes.push(row);
}
if (EMULATED) {
  notes.push(`EMULATED MACHINE — CPU throttled ${CPU_THROTTLE}× at deviceScaleFactor ${DPR}. Every metric above is MEASURED but NOT JUDGED: the committed ceilings were seeded at 1×, and a throttled number is an A/B instrument, not a budget. Compare it only against another run at the same settings.`);
}
if (unreliable.length) {
  /* Say WHICH gate muted WHAT. The old single note claimed "load timings" wholesale even when
   * only the aerial metric was actually affected, which is how a reader concluded that paint was
   * unmeasurable here in general. */
  if (!paintTimingsTrustworthy) {
    notes.push(`paint timings NOT judged: the document loads ${crossOriginBlocking.length} cross-origin render-blocking resource(s) — ${crossOriginBlocking.join(", ")} — and a script cannot execute until every preceding stylesheet resolves, so this host's latency lands directly in first paint. Self-host it (B276576) or make it non-blocking (B1384).`);
  }
  if (!tileTimingsTrustworthy) {
    notes.push(NO_TILES
      ? "first-aerial-coverage NOT judged: --no-tiles blocks every cross-origin request, so the map can never reach coverage. Paint timings are unaffected by this and are judged on their own merits."
      : `first-aerial-coverage NOT judged: tile hosts failed to load (${[...failedExternal].join(", ")}), so coverage cannot complete.`);
  }
}
if (paintTimingsTrustworthy) {
  notes.push("paint timings JUDGED: the boot path carries no cross-origin render-blocking resource (B276576 self-hosted Inter). These were muted for months because it did.");
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
  console.log(JSON.stringify({ base: BASE, scenario: site.id, shape, results, frameSamplingFault, failures, aboveTarget, passes, skipped, unreliable, notes }, null, 2));
} else {
  console.log(`Planyr runtime performance harness (NEW-8)${EMULATED ? `  [EMULATED: cpu ${CPU_THROTTLE}x, dpr ${DPR} — reported, NOT judged]` : ""}\n  target: ${BASE}\n  scenario: ${site.id} @ ${ORIGIN.lat},${ORIGIN.lon} (the owner's real Goose Creek plan — a FLOOR, not a match, for his heaviest)\n`);
  console.log(`  scene: ${shape.elements} elements (${Object.entries(shape.byType).map(([t, n]) => `${n} ${t}`).join(" · ")}) · ${shape.parcels} parcels · ${shape.centerlineRoads} centerline roads (${shape.arcVertices} arc vertices) · ${shape.ponds} ponds · ${shape.drawnVertices + shape.parcelVertices} drawn vertices`);
  console.log(`  site-route chunks fetched at boot: ${results.siteRouteChunks.length} — ${results.siteRouteChunks.map(stem).join(", ")}`);
  if (results.lazyChunksAfterBoot.length) console.log(`      + lazily, during the scripted gestures (by design, not judged): ${results.lazyChunksAfterBoot.map(stem).join(", ")}`);
  console.log(`  canvas DOM nodes by zoom: ${results.canvasNodesByZoom.map((r) => `${r.canvasNodes} @ ppf ${r.ppf}`).join("  ·  ")}`);
  console.log(`      peak ${results.canvasNodesMax} nodes in the canvas · ${results.canvasNodesByZoom[results.canvasNodesByZoom.length - 1].documentNodes} in the whole document at the innermost rung`);
  if (DO_DRAG) console.log(`  frame samples during drag: ${results.frameSamples} over ${results.frameGestureMs} ms (${results.frameObservedFps} fps, tab "${results.frameVisibility}") · pressed at ${results.dragPressAt} · view ${results.dragPanned ? "PANNED" : "DID NOT MOVE"}`);
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
