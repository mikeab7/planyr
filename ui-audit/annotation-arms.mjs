#!/usr/bin/env node
/* annotation-arms — DO CALLOUTS, MARKUPS AND MEASUREMENTS COST ANYTHING? (NEW-3)
 *
 * ⛔ THIS INSTRUMENT FIXES NOTHING. The deliverable is a NUMBER, per arm, against a measured floor —
 * and a REFUTATION here is worth exactly as much as a finding.
 *
 * THE MISS IT ANSWERS, and it is the same shape as the raster one. Every plan this program has ever
 * measured reads **0 / 0 / 0 / 0** on markups, measures, callouts and cross-sections: Goose Creek
 * does, Bain does, and so every null result about annotation cost was structurally guaranteed
 * before the first gesture. `docs/PERF-BAIN.md` §0 made that admission about rasters; this is the
 * same admission about the other tier, and it is why the arms below could not exist until the real
 * Sylvestri plan landed (NEW-1).
 *
 * WHY SYLVESTRI IS THE RIGHT SUBJECT AND NOT JUST THE AVAILABLE ONE:
 *   1. It is the owner's own report — *"immediately loads super fast, and then literally three
 *      seconds later it's lagging again."*
 *   2. It carries **16 callouts, 6 markups (4 polygons + 2 easements) and 2 measures.**
 *   3. ⛔ It has **NO SHEET OVERLAY AT ALL.** That makes it a clean control: nothing it shows can be
 *      blamed on a raster, on blending, or on texture memory — the three things the sixty-run Bain
 *      battery was about. Its only raster is the `fromMap` underlay, and the app never paints that
 *      on a plan with an origin, so `decodeFault` expects nothing and every arm differs in
 *      annotations and in nothing else.
 *
 *   xvfb-run -a --server-args="-screen 0 1600x1000x24" \
 *     node ui-audit/annotation-arms.mjs --fake-tiles --dpr 2.15 --reps 6
 *   ... --arms sylvestri,no-annotations --reps 4     # the headline pair while iterating
 *   ... --json
 *
 * ⚠ HEADED, ON A REAL X SERVER — a hidden tab starves rAF and the frame numbers become a
 * measurement of the tab's visibility (the B1086 trap).
 *
 * ⛔ THE GUARD, and it is the analogue of `decodeFault` rather than a copy of it. A raster arm that
 * measures a page where the raster never decoded reads as a beautiful null; an ANNOTATION arm that
 * measures a page where the annotations never rendered does exactly the same thing. So every arm
 * must PROVE its own annotation count on the canvas — counted from the DOM, against what the arm's
 * fixture says should be there — and an arm that cannot is SUPPRESSED, never reported.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";
import { fixtureCensus, fixtureSeed, ANNOTATION_ARMS, annotationArmFixture, BAIN_PAIR_ARMS, bainPairArmFixture, paintedRasters, rasterIdbPlan, idbPutInPage } from "./lib/planFixture.mjs";
import { pngDataUrl } from "./lib/synthRaster.mjs";
import { cachedRaster } from "./lib/fixtureSeeding.mjs";
import { bucketTrace, layerCensus, median, noiseFloorPct, armVerdict, pairedComparison, annotationFault } from "./lib/rasterCost.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const num = (f, d) => { const v = Number(arg(f, NaN)); return Number.isFinite(v) ? v : d; };
const JSON_OUT = process.argv.includes("--json");
const FAKE_TILES = process.argv.includes("--fake-tiles");
const DPR = num("--dpr", 2.15);
const CPU = num("--cpu-throttle", 1);
const REPS = num("--reps", 4);

/* ---- WHICH EXPERIMENT (NEW-2) -----------------------------------------------------------------
 * `--plan sylvestri`  the annotation tier, decomposed per kind on the one plan that has one.
 * `--plan bain-pair`  THE OWNER'S OWN A/B: his fast Bain plan against his slow one, which share a
 *                     byte-identical sheet overlay, underlay, origin and settings. See the long
 *                     note on BAIN_PAIR_ARMS in lib/planFixture.mjs for why that identity is worth
 *                     more than the sixty-run raster battery it supersedes.
 */
const PLAN = String(arg("--plan", "sylvestri")).toLowerCase();
const SYLVESTRI = JSON.parse(readFileSync(join(HERE, "fixtures", "sylvestri-concept-d-full.json"), "utf8"));
const QUIDDITY = JSON.parse(readFileSync(join(HERE, "fixtures", "bain-quiddity.json"), "utf8"));
const ORIGINAL = JSON.parse(readFileSync(join(HERE, "fixtures", "bain-concept-original.json"), "utf8"));

const BAIN_PAIR = PLAN === "bain-pair";
const ARM_TABLE = BAIN_PAIR ? BAIN_PAIR_ARMS : ANNOTATION_ARMS;
const BASELINE_ARM = BAIN_PAIR ? "quiddity" : "sylvestri";
const armFixtureFor = (arm) => (BAIN_PAIR ? bainPairArmFixture(QUIDDITY, ORIGINAL, arm) : annotationArmFixture(SYLVESTRI, arm));
const SUBJECT = BAIN_PAIR ? QUIDDITY : SYLVESTRI;

const ARMS = String(arg("--arms", BAIN_PAIR
  ? "quiddity,original,no-easements,one-pond,unrestricting,simple-ponds"
  : "sylvestri,no-callouts,no-markups,no-measures,no-annotations"))
  .split(",").map((s) => s.trim()).filter(Boolean);

const SITE_ID = "annotation-arms-site";
const CACHE = join(HERE, ".raster-cache");

/* The same neutral pan every other probe here uses: out and straight back, so the view is
 * unchanged across the gesture and a rung that ended somewhere else is suppressed rather than
 * reported. Keeping the gesture identical is what makes these numbers comparable to the raster
 * battery's at all. */
const PAN_PX = 260, PAN_STEPS = 20;
const READ_VIEW = `(() => { const s = document.querySelector('[data-testid="planner-canvas"]');
  return s ? { offX: s.getAttribute("data-view-offx"), offY: s.getAttribute("data-view-offy"), ppf: s.getAttribute("data-view-ppf") } : null; })()`;
const PRESS_POINT = `(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]'); if (!svg) return null;
  const r = svg.getBoundingClientRect();
  for (const fy of [0.5, 0.28, 0.72, 0.14, 0.86]) for (const fx of [0.28, 0.72, 0.14, 0.86, 0.5]) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (document.elementFromPoint(x, y) === svg) return { x: Math.round(x), y: Math.round(y) };
  } return null; })()`;

/* ⛔ THE ANNOTATION CENSUS, READ OFF THE RENDERED CANVAS — the whole reason this harness can be
 * trusted. Counted by the app's own `data-el-id` stamps, which every drawn object carries, matched
 * against the ids the arm's fixture holds. A count read from the fixture would prove nothing; a
 * count read from the DOM proves the arm actually took.
 *
 * ⛔ A REAL FUNCTION, NEVER A SOURCE STRING — and this is not a style preference, it is the trap
 * that already cost this program an hour once (see `idbPutInPage` in lib/planFixture.mjs).
 * Playwright evaluates a STRING as an EXPRESSION and does NOT call it with the argument, unlike
 * Puppeteer. Written as a template literal this evaluated to a function OBJECT, came back
 * `undefined`, and every arm faulted with "no canvas" — on a page that was rendering 1,307 nodes.
 * It was caught only because `annotationFault` refuses to report an arm it cannot prove, which is
 * the same reason `decodeFault` exists. Every other read in this file is argument-free and may stay
 * a string; this one takes an argument and must not. */
function readAnnotations(ids) {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  if (!svg) return null;
  /* ⚠ EACH TIER HAS ITS OWN STAMP, and `data-el-id` is NOT one of them — that attribute is on
   * ELEMENTS only. Reading all three through it counted 0 of 24 annotations on a canvas that was
   * rendering every one of them, which the fault guard correctly reported as a broken arm. */
  const present = (list, sel) => list.filter((id) => svg.querySelector(sel(id)));
  return {
    callouts: present(ids.callouts, (id) => `[data-testid="callout-${id}"]`).length,
    markups: present(ids.markups, (id) => `[data-markup="${id}"]`).length,
    measures: present(ids.measures, (id) => `[data-measure="${id}"]`).length,
    textNodes: svg.getElementsByTagName("text").length,
    canvasNodes: svg.getElementsByTagName("*").length,
    elementsDrawn: svg.querySelectorAll("[data-el-id]").length,
  };
}

/* ⛔ `leafletTiles` IS REPORTED HERE BECAUSE IT IS THE ANSWER TO SOMETHING ELSE. docs/PERF-BAIN.md
 * §7.3 left the compositor-layer count as the largest unexplained difference between two plans and
 * called it "the next thing to measure". It is not a property of the plan at all — measured across
 * three real plans, **layers = leafletTiles + 4, exactly**. A layer census reported without the tile
 * count beside it invites the scene-size reading all over again, so the two travel together.
 * (⚠ Keep comments OUT of the template literal below — a backtick inside it is a syntax error, and
 * this one shipped as exactly that for one run.) */
const READ_COUNTERS = `(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  return {
    canvasNodes: svg ? svg.getElementsByTagName("*").length : null,
    textNodes: svg ? svg.getElementsByTagName("text").length : null,
    elementsDrawn: svg ? svg.querySelectorAll("[data-el-id]").length : null,
    leafletTiles: document.querySelectorAll(".leaflet-tile").length,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(2) : null,
  };
})()`;

async function workCounters(cdp) {
  try {
    const m = await cdp.send("Performance.getMetrics");
    const g = {}; for (const { name, value } of m.metrics || []) g[name] = value;
    return { script: (g.ScriptDuration || 0) * 1000, layout: (g.LayoutDuration || 0) * 1000, recalc: (g.RecalcStyleDuration || 0) * 1000 };
  } catch (_) { return null; }
}

async function neutralPan(page, press) {
  const before = await page.evaluate(READ_VIEW);
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  await page.mouse.move(press.x + PAN_PX, press.y + PAN_PX / 2, { steps: PAN_STEPS });
  await page.mouse.move(press.x, press.y, { steps: PAN_STEPS });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await page.evaluate(READ_VIEW);
  const neutral = before && after && before.ppf === after.ppf
    && Math.abs(Number(before.offX) - Number(after.offX)) <= 1 && Math.abs(Number(before.offY) - Number(after.offY)) <= 1;
  return { neutral, before, after };
}

async function runArm(browser, arm, rep) {
  const fixture = armFixtureFor(arm);
  const census = fixtureCensus(fixture);
  const wantIds = {
    callouts: (fixture.callouts || []).map((c) => c.id),
    markups: (fixture.markups || []).map((m) => m.id),
    measures: (fixture.measures || []).map((m) => m.id),
  };
  const wantCounts = { callouts: wantIds.callouts.length, markups: wantIds.markups.length, measures: wantIds.measures.length };

  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: DPR });
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE_ID }));

  let tilesServed = 0;
  await ctx.route(/^https?:\/\//, (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    if (FAKE_TILES) {
      const t = parseTileUrl(url);
      if (t) { tilesServed++; return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "no-store" }, body: fakeTilePng(t.z, t.x, t.y) }); }
    }
    return route.abort();
  });

  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "annotation-arms");
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable").catch(() => {});
  const layerState = { layers: null };
  cdp.on("LayerTree.layerTreeDidChange", ({ layers }) => { layerState.layers = layers || []; });
  await cdp.send("LayerTree.enable").catch(() => {});
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU }).catch(() => {});

  /* ⚠ ONE NAVIGATION FOR SYLVESTRI, TWO FOR THE BAIN PAIR, and the difference is not an
   * optimisation — it is the difference between measuring the plan and measuring a plan with its
   * drawing missing.
   *
   * Sylvestri's only raster is the `fromMap` underlay the app never paints, so there is nothing to
   * put in IndexedDB and the extra reload would only measure a warm boot.
   *
   * ⛔ BOTH BAIN PLANS COMPOSITE A REAL 1728 × 2592 SHEET OVERLAY, and IndexedDB is origin-scoped —
   * it cannot be written before a document from this origin exists. Skipping the seed would run
   * every Bain arm with its overlay stuck on the "Loading drawing…" placeholder, which is both a
   * false null AND a destroyed experiment: the whole force of this pair is that the overlay is
   * IDENTICAL in both halves, and an absent raster is identical in neither. */
  await page.goto(BASE, { waitUntil: BAIN_PAIR ? "domcontentloaded" : "load" });
  const rasterFacts = [];
  if (BAIN_PAIR) {
    for (const { key, spec } of rasterIdbPlan(fixture, SITE_ID)) {
      const r = cachedRaster(spec, CACHE);
      const wrote = await page.evaluate(idbPutInPage, { key, value: pngDataUrl(r.png) });
      if (wrote !== true) throw new Error(`IndexedDB write for ${key} did not confirm — the arm cannot be established`);
      rasterFacts.push(`${spec.role} ${spec.imgW}×${spec.imgH} @${spec.opacity} rot ${spec.rotation}`);
    }
    await page.reload({ waitUntil: "load" });
  }
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  await page.waitForTimeout(2500); // let the boot's own deferred work land, off the gesture's books

  /* ⛔ AND THE OVERLAY MUST BE PROVEN ON THE PAGE, for exactly the reason `decodeFault` exists: an
   * arm whose raster never decoded looks precisely like an arm that is fast. */
  let rasterFault = null;
  if (BAIN_PAIR) {
    const want = paintedRasters(fixture).length;
    const got = await page.evaluate(() => [...document.querySelectorAll('[data-testid="planner-canvas"] image')]
      .filter((im) => ((im.href && im.href.baseVal) || "").length > 1000).length);
    if (got < want) rasterFault = `SHEET OVERLAY NEVER REACHED THE CANVAS — expected ${want} painted raster(s), found ${got}. This arm did not measure what it claims to, and the pair's shared-overlay control is void.`;
  }

  const seen = await page.evaluate(readAnnotations, wantIds);
  const fault = rasterFault || annotationFault(seen, wantCounts);
  const settled = await page.evaluate(READ_COUNTERS);
  const layers = layerCensus(layerState.layers);
  const press = (await page.evaluate(PRESS_POINT)) || { x: 500, y: 450 };

  /* PASS 1 — UNTRACED: the headline work figure, on the metric every other instrument here reports. */
  const w0 = await workCounters(cdp);
  const pan1 = await neutralPan(page, press);
  const w1 = await workCounters(cdp);

  /* PASS 2 — TRACED: paint / raster / decode / composite / layerize, which the work figure is blind to. */
  const traceEvents = [];
  cdp.on("Tracing.dataCollected", ({ value }) => { if (value) traceEvents.push(...value); });
  await cdp.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "blink", "cc"] },
  }).catch(() => {});
  const pan2 = await neutralPan(page, press);
  const traced = await new Promise((res) => {
    cdp.once("Tracing.tracingComplete", () => res(true));
    cdp.send("Tracing.end").catch(() => res(false));
    setTimeout(() => res(false), 20000);
  });
  const paint = traced ? bucketTrace(traceEvents) : null;
  await ctx.close();

  const workMs = w0 && w1 ? +((w1.script - w0.script) + (w1.layout - w0.layout) + (w1.recalc - w0.recalc)).toFixed(2) : null;
  return {
    arm, rep,
    fault: fault || (!pan1.neutral ? `the view was not neutral across the untraced pan — this rep looked at a different scene and is SUPPRESSED` : null),
    census, tilesServed, annotationsOnCanvas: seen, expected: wantCounts, rasterFacts,
    paintedRasters: paintedRasters(fixture).map((r) => `${r.role} ${r.imgW}×${r.imgH}`),
    canvasNodes: settled.canvasNodes, textNodes: settled.textNodes, elementsDrawn: settled.elementsDrawn,
    leafletTiles: settled.leafletTiles,
    heapSettledMB: settled.heapMB, layers,
    workMs, tracedNeutral: pan2.neutral, paint,
  };
}

/* ---- Drive ------------------------------------------------------------------------------------- */
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors", "--enable-precise-memory-info"] });
const runs = [];
/* INTERLEAVED, rep by rep — this container's warm-up drift across a few minutes is larger than
 * several of the effects being looked for, and a blocked A/B hands the whole drift to whichever arm
 * ran last. Interleaving is also what makes the PAIRED sign test below legitimate. */
for (let rep = 1; rep <= REPS; rep++) {
  for (const arm of ARMS) {
    if (!ARM_TABLE[arm]) { console.error(`unknown arm "${arm}"`); process.exit(2); }
    process.stderr.write(`  · rep ${rep} arm ${arm}\n`);
    runs.push(await runArm(browser, arm, rep));
  }
}
await browser.close();

const ok = runs.filter((r) => !r.fault);
const byArm = ARMS.map((arm) => {
  const rs = ok.filter((r) => r.arm === arm);
  const first = rs[0] || runs.find((r) => r.arm === arm) || {};
  return {
    arm, n: rs.length,
    title: ARM_TABLE[arm].title, changes: ARM_TABLE[arm].changes,
    workMs: median(rs.map((r) => r.workMs)),
    paintMs: median(rs.map((r) => r.paint?.paintMs)),
    rasterMs: median(rs.map((r) => r.paint?.rasterMs)),
    compositeMs: median(rs.map((r) => r.paint?.compositeMs)),
    layerizeMs: median(rs.map((r) => r.paint?.layerizeMs)),
    renderTotalMs: median(rs.map((r) => r.paint?.totalMs)),
    layerCount: median(rs.map((r) => r.layers?.count)),
    heapSettledMB: median(rs.map((r) => r.heapSettledMB)),
    canvasNodes: first.canvasNodes, textNodes: first.textNodes, elementsDrawn: first.elementsDrawn,
  };
});

const baseline = byArm.find((a) => a.arm === BASELINE_ARM) || byArm[0];
const pairFor = (arm, pick) => {
  const reps = [...new Set(runs.map((r) => r.rep))].sort((a, b) => a - b);
  return reps.map((rep) => {
    const b = ok.find((r) => r.arm === baseline.arm && r.rep === rep);
    const a = ok.find((r) => r.arm === arm && r.rep === rep);
    return b && a ? [pick(b), pick(a)] : null;
  }).filter(Boolean);
};
const floorWork = noiseFloorPct(ok.filter((r) => r.arm === baseline.arm).map((r) => r.workMs));
const floorRender = noiseFloorPct(ok.filter((r) => r.arm === baseline.arm).map((r) => r.paint?.totalMs));

const out = {
  base: BASE, dpr: DPR, cpu: CPU, fakeTiles: FAKE_TILES, reps: REPS, arms: ARMS,
  plan: PLAN, subject: { site: SUBJECT.site, name: SUBJECT.name, siteId: SUBJECT._source?.siteId },
  noiseFloorWorkPct: floorWork, noiseFloorRenderPct: floorRender,
  byArm: byArm.map((a) => ({
    ...a,
    vsBaselineWork: a.arm === baseline.arm ? null : armVerdict(baseline.workMs, a.workMs, floorWork),
    vsBaselineRender: a.arm === baseline.arm ? null : armVerdict(baseline.renderTotalMs, a.renderTotalMs, floorRender),
    pairedWork: a.arm === baseline.arm ? null : pairedComparison(pairFor(a.arm, (r) => r.workMs)),
    pairedRender: a.arm === baseline.arm ? null : pairedComparison(pairFor(a.arm, (r) => (r.paint ? r.paint.totalMs : null))),
  })),
  faults: runs.filter((r) => r.fault).map((r) => ({ arm: r.arm, rep: r.rep, fault: r.fault })),
  runs,
};

if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); }
else {
  const n = (v, w = 8, d = 1) => (v == null ? "—".padStart(w) : v.toFixed(d).padStart(w));
  console.log(BAIN_PAIR
    ? `\nBAIN PAIR — the owner's own A/B: "${ORIGINAL.name}" (he calls it FAST) vs "${QUIDDITY.name}" (he calls it SLOW)`
    : `\nANNOTATION ARMS — do callouts, markups and measures cost anything?  [${SYLVESTRI.site} / ${SYLVESTRI.name}]`);
  console.log(`  regime: cpu ${CPU}×, dpr ${DPR}, ${FAKE_TILES ? "fake tiles ON" : "NO tiles"}, ${REPS} rep(s), interleaved`);
  console.log(BAIN_PAIR
    ? `  ⛔ THE TWO PLANS SHARE ONE PHYSICAL SHEET OVERLAY (same id, same storageKey, 1728×2592 @0.55 rot 1.5°),\n     the same aerial underlay, the same origin and byte-identical settings. A SHARED CAUSE CANNOT EXPLAIN\n     A DIFFERENCE — so the raster, its alpha, its rotation and its PDF re-raster path are all eliminated\n     for this pair BY IDENTITY, with no statistics involved at all.\n`
    : `  ⛔ NO SHEET OVERLAY ON THIS PLAN — nothing below can be charged to a raster.\n`);
  console.log(`  ${"arm".padEnd(16)} ${"work".padStart(8)} ${"paint".padStart(8)} ${"raster".padStart(8)} ${"compos".padStart(8)} ${"layeriz".padStart(8)} ${"render".padStart(8)} ${"nodes".padStart(7)} ${"text".padStart(6)} ${"layers".padStart(7)}`);
  for (const a of out.byArm) {
    console.log(`  ${a.arm.padEnd(16)} ${n(a.workMs)} ${n(a.paintMs)} ${n(a.rasterMs)} ${n(a.compositeMs)} ${n(a.layerizeMs)} ${n(a.renderTotalMs)} ${n(a.canvasNodes, 7, 0)} ${n(a.textNodes, 6, 0)} ${n(a.layerCount, 7, 0)}`);
  }
  console.log(`\n  NOISE FLOOR, measured on the "${baseline.arm}" repeats: work ±${floorWork ?? "—"}%  ·  render ±${floorRender ?? "—"}%. Nothing inside it is a finding.`);
  /* ⛔ MAIN-THREAD WORK GETS ITS OWN LINE, because a null on it is NOT a null. `Script + Layout +
   * RecalcStyle` could not tell Bain from Goose Creek (5/10 paired reps, p = 1.000) — it is
   * structurally blind to paint, raster, decode and compositing. So it is reported EXPLICITLY and
   * separately, and a difference that appears HERE is a different kind of finding from one that
   * appears in render: this metric sees script and layout, which is where a per-element or
   * per-relation computation would live. */
  console.log(`\n  MAIN-THREAD WORK (Script + Layout + RecalcStyle), reported separately because a null on it is NOT a null:`);
  for (const a of out.byArm) {
    const d = a.arm === baseline.arm ? "" : `   ${a.vsBaselineWork.pct > 0 ? "+" : ""}${a.vsBaselineWork.pct}% vs ${baseline.arm}`;
    console.log(`     ${a.arm.padEnd(16)} ${a.workMs == null ? "—" : a.workMs.toFixed(1).padStart(9)} ms/pan${d}`);
  }
  console.log(`\n  EVERY REP (render total, ms) — so a wide floor can be told from a genuinely noisy arm:`);
  for (const arm of ARMS) {
    const v = runs.filter((r) => r.arm === arm).map((r) => (r.paint ? r.paint.totalMs.toFixed(0) : "—").padStart(6));
    console.log(`     ${arm.padEnd(16)} ${v.join(" ")}`);
  }
  for (const a of out.byArm) {
    if (a.arm === baseline.arm) continue;
    console.log(`  ${a.arm.padEnd(16)} — ${a.changes}`);
    console.log(`                   work:   ${a.vsBaselineWork.pct == null ? "—" : `${a.vsBaselineWork.pct > 0 ? "+" : ""}${a.vsBaselineWork.pct}%`}  ${a.vsBaselineWork.verdict}`);
    console.log(`                   render: ${a.vsBaselineRender.pct == null ? "—" : `${a.vsBaselineRender.pct > 0 ? "+" : ""}${a.vsBaselineRender.pct}%`}  ${a.vsBaselineRender.verdict}`);
    console.log(`                   PAIRED rep-for-rep: render ${a.pairedRender.verdict}`);
    console.log(`                                       work   ${a.pairedWork.verdict}`);
  }
  if (out.faults.length) {
    console.log(`\n  ⛔ ${out.faults.length} rep(s) SUPPRESSED — an arm whose annotations never rendered is not a fast arm:`);
    for (const f of out.faults) console.log(`     rep ${f.rep} arm ${f.arm}: ${f.fault}`);
  }
  console.log(`\n  ⚠ Tracing inflates absolute paint/raster/composite figures; only the BETWEEN-ARM comparison is claimed.`);
  console.log(`  ⚠ Callout TEXT is shape-redacted (exact line count, per-line length, whitespace positions; glyph widths approximate).`);
  console.log(`  ⚠ This sandbox blocks every external host, so GIS and Supabase are ABSENT, not slow. Every number is a LOWER BOUND.\n`);
}
process.exit(out.faults.length && out.faults.length === runs.length ? 1 : 0);
