#!/usr/bin/env node
/* raster-arms — IS THE BAIN PLAN SLOW BECAUSE OF ITS RASTERS? (NEW-1)
 *
 * ⛔ THIS INSTRUMENT FIXES NOTHING. The deliverable is a NUMBER, per arm, against a measured floor.
 *
 * THE MISS IT ANSWERS. Every performance number in this program came from Goose Creek or a scene
 * derived from it. The owner reports that BAIN is slow. Goose Creek has NO raster overlay at all;
 * Bain composites a 1728 × 2592 sheet overlay at OPACITY 0.55 over a 1800 × 1167 aerial underlay —
 * ~26 MB of decoded texture, one layer of it semi-transparent. That is the single largest untested
 * structural difference between the site he says is slow and the site the harness has been
 * measuring all program, and it is invisible to every metric the program owns (see the header of
 * lib/rasterCost.mjs: script + layout + style cannot see blending).
 *
 * THE ARMS, each changing exactly one thing:
 *   bain         both rasters, exactly as he has them                     ← the baseline
 *   opaque       the overlay forced to opacity 1.0                        ← isolates BLENDING
 *   no-overlay   the 4.5 MP semi-transparent overlay hidden               ← removes it entirely
 *   quarter      both rasters at ¼ the pixels, SAME on-map footprint      ← isolates SIZE
 *   unrotated    the overlay's 1.5° rotation taken to 0                   ← isolates ROTATION (NEW-2)
 *   no-rasters   both hidden                                              ← isolates Bain's geometry
 *   goose        the Goose Creek control, same regime                     ← what we have measured
 *
 * ⛔ `unrotated` EXISTS BECAUSE THE REAL PLAN ARRIVED AND CONTRADICTED THE FIXTURE. The owner's
 * overlay is rotated **1.5°**; the synthesised fixture said 0, so every arm ever run here — all six,
 * both batteries, sixty runs — composited it AXIS-ALIGNED, and a rotated raster cannot take an
 * axis-aligned fast path. See the long note on the arm in lib/planFixture.mjs, including what the
 * arm can and cannot hold constant.
 *
 * THE REGIME IS THE OWNER'S: 1× CPU (his complaint is at 1× on a 28-core machine), dpr 2.15 (his
 * measured display), --fake-tiles so aerial decode and texture upload are real work.
 *
 *   xvfb-run -a --server-args="-screen 0 1600x1000x24" node ui-audit/raster-arms.mjs --fake-tiles --dpr 2.15
 *   ... --arms bain,opaque --reps 4      # a subset while iterating
 *   ... --json
 *
 * ⚠ HEADED, ON A REAL X SERVER — same reason as every other probe here: a hidden tab starves rAF
 * and the frame numbers become a measurement of the tab's visibility (the B1086 trap).
 *
 * Never exits non-zero on a measurement. It is an instrument, not a gate. It DOES exit non-zero
 * when an arm could not be established — a raster that never decoded is not a fast arm, it is a
 * broken one, and reporting its beautiful null result is the exact failure this file exists to
 * prevent.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";
import { pngDataUrl, megapixels } from "./lib/synthRaster.mjs";
import { cachedRaster } from "./lib/fixtureSeeding.mjs";
import {
  redactPlan, fixtureCensus, armFixture, fixtureSeed, rasterIdbPlan,
  idbPutInPage, RASTER_ARMS, specDecodedBytes, paintedRasters, heldButUnpaintedRasters,
} from "./lib/planFixture.mjs";
import { bucketTrace, layerCensus, median, noiseFloorPct, armVerdict, pairedComparison, decodeFault, renderedDecodedBytes } from "./lib/rasterCost.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { FEATURE_COUNT_FIELD } from "./lib/featureCensus.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const num = (f, d) => { const v = Number(arg(f, NaN)); return Number.isFinite(v) ? v : d; };
const JSON_OUT = process.argv.includes("--json");
const FAKE_TILES = process.argv.includes("--fake-tiles");
const DPR = num("--dpr", 2.15);
const CPU = num("--cpu-throttle", 1);
const REPS = num("--reps", 3);
const ARMS = String(arg("--arms", "bain,opaque,no-overlay,quarter,unrotated,no-rasters,goose")).split(",").map((s) => s.trim()).filter(Boolean);
const CACHE = join(HERE, ".raster-cache");

/* ⛔ THE REAL PLAN, NOT THE SYNTHESISED ONE. Until 2026-08-07 this read `bain-concept-a.json`,
 * whose element COUNTS were the owner's and whose COORDINATES were invented — the bound
 * docs/PERF-BAIN.md §6 put on its own largest claim. That file and its generator are gone; this is
 * `public.sites` JOINED to `public.site_elements` for site `smr9olizi5ue`, verbatim. Two of its
 * facts were absent from the synthesis and both are load-bearing: the overlay is rotated **1.5°**
 * (every arm here had run it axis-aligned — see the `rot-0` / `rot-1.5` pair below), and the
 * underlay is `fromMap` with a live ArcGIS URL rather than an IndexedDB string. */
const BAIN = JSON.parse(readFileSync(join(HERE, "fixtures", "bain-concept-original.json"), "utf8"));
/* The control, put through the SAME redaction path as any real plan, so the two fixtures reach the
 * browser by one code path and a difference between them cannot be an artefact of two loaders. */
const GOOSE = redactPlan(JSON.parse(readFileSync(join(HERE, "fixtures", "goose-creek-plan1copy.json"), "utf8")), { keepNames: true }).fixture;

const SITE_ID = "raster-arms-site";

/* Raster synthesis and the per-raster seed both live in lib/fixtureSeeding.mjs, so this harness and
 * every other consumer of a fixture generate byte-identical pictures. (The rule they encode is worth
 * repeating: EVERY RASTER IN A RUN GETS DISTINCT BYTES, because Chromium caches decoded images by
 * content and two identical rasters would share ONE bitmap — an arm that should cost two textures
 * would quietly cost one.) */

/* ---- The gesture -------------------------------------------------------------------------------
 * session-axes.mjs's pan, unchanged in shape: out and straight back, so the view is NEUTRAL across
 * the gesture and a rung that ended somewhere else is suppressed rather than reported.
 */
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

/* Read back EVERY <image> the planner actually rendered, PROVE it decoded, and measure its
 * intrinsic size from the bytes the DOM is holding. See `decodeFault` in lib/rasterCost.mjs for why
 * a run without this is worthless — and for why `naturalWidth` is not available here. */
const READ_IMAGES = `(async () => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  if (!svg) return [];
  /* Intrinsic dimensions straight out of the PNG's own IHDR chunk: bytes 16..23 of the file, big
   * endian. Read from the element's href rather than from anything the harness believes, so a
   * mismatch between what was seeded and what is on screen is visible instead of assumed away. */
  const ihdr = (href) => {
    const i = String(href || "").indexOf("base64,");
    if (i < 0) return { w: 0, h: 0 };
    try {
      const b = atob(String(href).slice(i + 7, i + 7 + 64));
      const be = (o) => (b.charCodeAt(o) << 24 | b.charCodeAt(o + 1) << 16 | b.charCodeAt(o + 2) << 8 | b.charCodeAt(o + 3)) >>> 0;
      return { w: be(16), h: be(20) };
    } catch (e) { return { w: 0, h: 0 }; }
  };
  const out = [];
  for (const im of [...svg.querySelectorAll("image")]) {
    const href = im.href && im.href.baseVal;
    const { w, h } = ihdr(href);
    let decoded = false;
    try { await im.decode(); decoded = true; } catch (e) { decoded = false; }
    out.push({
      decoded, intrinsicW: w, intrinsicH: h,
      srcLen: (href || "").length,
      opacity: Number(im.getAttribute("opacity") ?? 1),
      overlayId: im.getAttribute("data-overlay-id") || null,
      widthPx: Math.round(Number(im.getAttribute("width")) || 0),
      heightPx: Math.round(Number(im.getAttribute("height")) || 0),
    });
  }
  return out;
})()`;

const READ_COUNTERS = `(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  const f = window.__frames || [];
  return {
    canvasNodes: svg ? svg.getElementsByTagName("*").length : null,
    documentNodes: document.getElementsByTagName("*").length,
    ${FEATURE_COUNT_FIELD},
    /* el-tier: tier detail beside the census. */
    elementsDrawn: svg ? svg.querySelectorAll("[data-el-id]").length : null,
    leafletTiles: document.querySelectorAll(".leaflet-tile").length,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(2) : null,
    frames: f.length,
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

/* ---- One arm, one rep --------------------------------------------------------------------------- */
async function runArm(browser, arm, rep) {
  const base = arm === "goose" ? GOOSE : BAIN;
  const fixture = arm === "goose" ? base : armFixture(base, arm);
  const census = fixtureCensus(fixture);

  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: DPR });
  await ctx.addInitScript(() => performance.setResourceTimingBufferSize(3000));
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE_ID }));
  await ctx.addInitScript(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (now) => { window.__frames.push(now - last); last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });

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
  await assertMeasurable(page, "raster-arms");
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable").catch(() => {});
  const layerState = { layers: null };
  cdp.on("LayerTree.layerTreeDidChange", ({ layers }) => { layerState.layers = layers || []; });
  await cdp.send("LayerTree.enable").catch(() => {});
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU }).catch(() => {});

  /* ⚠ TWO NAVIGATIONS, ON PURPOSE. IndexedDB is origin-scoped, so the raster strings cannot be
   * written until a document from this origin exists. The first load is a throwaway whose only job
   * is to give us that origin; the rasters go in; the reload is the run that gets measured. Seeding
   * the src INLINE instead would avoid the dance and measure a different program — the app's real
   * path is `src: null` + `idbKey` + an IndexedDB read, and that path is one of the things under
   * test ("are those 10 MB strings re-read on a view change, or held once?"). */
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const idbPlan = rasterIdbPlan(fixture, SITE_ID);
  const rasterFacts = [];
  for (const { key, spec } of idbPlan) {
    const r = cachedRaster(spec, CACHE);
    const dataUrl = pngDataUrl(r.png);
    const wrote = await page.evaluate(idbPutInPage, { key, value: dataUrl });
    if (wrote !== true) throw new Error(`IndexedDB write for ${key} did not confirm — the arm cannot be established`);
    rasterFacts.push({
      role: spec.role, imgW: spec.imgW, imgH: spec.imgH, opacity: spec.opacity, visible: spec.visible,
      megapixels: megapixels(spec.imgW, spec.imgH),
      decodedBytes: specDecodedBytes(spec),
      encodedTargetBytes: spec.encodedBytes, encodedActualBytes: dataUrl.length,
      cachedPng: !!r.cached,
    });
  }

  await page.reload({ waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  /* Give the IndexedDB read + decode time to land, then ASSERT it did. A fixed wait alone would be
   * the thing that lets a never-decoded arm through. */
  /* ⚠ EXPECT WHAT THE APP WILL ACTUALLY PAINT, NOT WHAT THE FIXTURE HOLDS. With an origin present
   * the basemap is on and the underlay is never drawn — see `paintedRasters`. Waiting for it, or
   * faulting the arm over it, would fail every run for a reason that is the product working as
   * designed. Its bytes are still loaded and still held, and that is reported separately. */
  const wantVisible = paintedRasters(fixture);
  const heldUnpainted = heldButUnpaintedRasters(fixture);
  if (wantVisible.length) {
    await page.waitForFunction(
      (n) => {
        const svg = document.querySelector('[data-testid="planner-canvas"]');
        if (!svg) return false;
        return [...svg.querySelectorAll("image")].filter((im) => (im.href && im.href.baseVal || "").length > 1000).length >= n;
      },
      wantVisible.length, { timeout: 45000 },
    ).catch(() => {});
  }
  await page.waitForTimeout(2500); // let the boot's own deferred work land, so it isn't charged to the gesture

  const images = await page.evaluate(READ_IMAGES);
  const decoded = images.filter((i) => i.decoded);
  const fault = decodeFault(decoded, wantVisible);
  const settled = await page.evaluate(READ_COUNTERS);
  const layers = layerCensus(layerState.layers);

  const press = (await page.evaluate(PRESS_POINT)) || { x: 500, y: 450 };

  /* PASS 1 — UNTRACED. The headline work figure, on the same metric every other instrument in this
   * program reports, so Bain's number and Goose Creek's number are directly comparable to every
   * number already on record. */
  await page.evaluate(() => { window.__frames.length = 0; });
  const w0 = await workCounters(cdp);
  const pan1 = await neutralPan(page, press);
  const w1 = await workCounters(cdp);
  const frames = await page.evaluate(() => window.__frames.slice());
  const gestureFrames = frames.filter((d) => d > 0 && d < 500);

  /* PASS 2 — TRACED. The half the un-quantised metric is structurally blind to: paint, raster,
   * image decode and compositing, on whichever thread did them. Absolute values are inflated by
   * tracing overhead; only the BETWEEN-ARM comparison is claimed. */
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

  const after = await page.evaluate(READ_COUNTERS);
  await ctx.close();

  const workMs = w0 && w1 ? +((w1.script - w0.script) + (w1.layout - w0.layout) + (w1.recalc - w0.recalc)).toFixed(2) : null;
  return {
    arm, rep,
    fault: fault || (!pan1.neutral ? `the view was not neutral across the untraced pan (${JSON.stringify(pan1.before)} → ${JSON.stringify(pan1.after)}) — this rep looked at a different scene and is SUPPRESSED` : null),
    census, rasterFacts, tilesServed,
    paintedRasters: wantVisible.map((r) => `${r.role} ${r.imgW}×${r.imgH} @${r.opacity}`),
    heldButNeverPainted: heldUnpainted.map((r) => `${r.role} ${r.imgW}×${r.imgH} (~${Math.round((r.encodedBytes || 0) / 1024)} KB of string held, never composited)`),
    canvasNodes: settled.canvasNodes, documentNodes: settled.documentNodes, elementsDrawn: settled.elementsDrawn,
    leafletTiles: settled.leafletTiles,
    heapSettledMB: settled.heapMB, heapAfterMB: after.heapMB,
    layers,
    decodedRasterBytes: renderedDecodedBytes(decoded),
    decodedImages: decoded.map((d) => ({ w: d.intrinsicW, h: d.intrinsicH, opacity: d.opacity, srcLen: d.srcLen })),
    workMs,
    scriptMs: w0 && w1 ? +(w1.script - w0.script).toFixed(2) : null,
    layoutMs: w0 && w1 ? +(w1.layout - w0.layout).toFixed(2) : null,
    recalcMs: w0 && w1 ? +(w1.recalc - w0.recalc).toFixed(2) : null,
    frameMedianMs: median(gestureFrames), frameP90Ms: (() => { const s = [...gestureFrames].sort((a, b) => a - b); return s.length ? +s[Math.floor(0.9 * s.length)].toFixed(2) : null; })(),
    paint, tracedNeutral: pan2.neutral,
  };
}

/* ---- Drive ------------------------------------------------------------------------------------- */
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors", "--enable-precise-memory-info"] });
const runs = [];
/* INTERLEAVED, rep by rep — never all of one arm then all of the next. This container's warm-up
 * drift across a few minutes is larger than several of the effects being looked for, and a blocked
 * A/B hands the whole drift to whichever arm ran last. */
for (let rep = 1; rep <= REPS; rep++) {
  for (const arm of ARMS) {
    if (arm !== "goose" && !RASTER_ARMS[arm]) { console.error(`unknown arm "${arm}"`); process.exit(2); }
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
    title: arm === "goose" ? "the Goose Creek control — the plan every prior number came from" : RASTER_ARMS[arm].title,
    changes: arm === "goose" ? "a different plan entirely" : RASTER_ARMS[arm].changes,
    workMs: median(rs.map((r) => r.workMs)),
    scriptMs: median(rs.map((r) => r.scriptMs)),
    frameMedianMs: median(rs.map((r) => r.frameMedianMs)),
    frameP90Ms: median(rs.map((r) => r.frameP90Ms)),
    paintMs: median(rs.map((r) => r.paint?.paintMs)),
    rasterMs: median(rs.map((r) => r.paint?.rasterMs)),
    decodeMs: median(rs.map((r) => r.paint?.decodeMs)),
    compositeMs: median(rs.map((r) => r.paint?.compositeMs)),
    layerizeMs: median(rs.map((r) => r.paint?.layerizeMs)),
    renderTotalMs: median(rs.map((r) => r.paint?.totalMs)),
    layerCount: median(rs.map((r) => r.layers?.count)),
    rasterProxyMB: median(rs.map((r) => r.layers?.rasterProxyMB)),
    decodedRasterMB: first.decodedRasterBytes != null ? +(median(rs.map((r) => r.decodedRasterBytes)) / 1048576).toFixed(2) : null,
    heapSettledMB: median(rs.map((r) => r.heapSettledMB)),
    canvasNodes: first.canvasNodes, elementsDrawn: first.elementsDrawn,
    census: first.census, rasterFacts: first.rasterFacts,
  };
});

const baseline = byArm.find((a) => a.arm === "bain") || byArm[0];

/* Rep-for-rep against the baseline. The arms are interleaved, so rep i of every arm ran within
 * seconds of rep i of every other — a slow machine-minute hits both together and pairing cancels it.
 * See the long note on `pairedComparison`: this ADDS an analysis the design already supported, it
 * does not replace the range floor, which continues to be reported verbatim. */
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
  console.log(`\nRASTER ARMS — is Bain slow because of its rasters?  [cpu ${CPU}×, dpr ${DPR}, ${FAKE_TILES ? "fake tiles ON" : "NO tiles"}, ${REPS} rep(s), interleaved]`);
  console.log(`  target: ${BASE}\n`);
  console.log(`  ${"arm".padEnd(12)} ${"work".padStart(8)} ${"frame".padStart(8)} ${"paint".padStart(8)} ${"raster".padStart(8)} ${"decode".padStart(8)} ${"compos".padStart(8)} ${"layeriz".padStart(8)} ${"render".padStart(8)} ${"layers".padStart(7)} ${"texMB".padStart(7)}`);
  console.log(`  ${"".padEnd(12)} ${"ms/pan".padStart(8)} ${"med ms".padStart(8)} ${"ms".padStart(8)} ${"ms".padStart(8)} ${"ms".padStart(8)} ${"ms".padStart(8)} ${"ms".padStart(8)} ${"total".padStart(8)} ${"".padStart(7)} ${"".padStart(7)}`);
  for (const a of out.byArm) {
    console.log(`  ${a.arm.padEnd(12)} ${n(a.workMs)} ${n(a.frameMedianMs)} ${n(a.paintMs)} ${n(a.rasterMs)} ${n(a.decodeMs)} ${n(a.compositeMs)} ${n(a.layerizeMs)} ${n(a.renderTotalMs)} ${n(a.layerCount, 7, 0)} ${n(a.decodedRasterMB, 7, 1)}`);
  }
  console.log(`\n  NOISE FLOOR, measured on the "${baseline.arm}" repeats: work ±${floorWork ?? "—"}%  ·  render ±${floorRender ?? "—"}%. Nothing inside it is a finding.`);
  /* ⚠ PRINT EVERY REP, NOT ONLY THE MEDIAN. The floor above is a RANGE — (max − min) / median — and a
   * range is a monotonically increasing function of the sample size, so ONE contaminated rep sets it
   * for the whole run and more data makes it WIDER rather than tighter. That is a real defect in the
   * estimator this repo uses everywhere, and it is named in docs/PERF-BAIN.md rather than quietly
   * swapped for a kinder one after the fact. Printing the reps lets a reader see whether a wide floor
   * is genuine spread or one bad run, which is a judgement the median alone hides. */
  console.log(`\n  EVERY REP (render total, ms) — so a wide floor can be told from a genuinely noisy arm:`);
  for (const arm of ARMS) {
    const v = runs.filter((r) => r.arm === arm).map((r) => (r.paint ? r.paint.totalMs.toFixed(0) : "—").padStart(6));
    console.log(`     ${arm.padEnd(12)} ${v.join(" ")}`);
  }
  for (const a of out.byArm) {
    if (a.arm === baseline.arm) continue;
    console.log(`  ${a.arm.padEnd(12)} — ${a.changes}`);
    console.log(`               work:   ${a.vsBaselineWork.pct == null ? "—" : `${a.vsBaselineWork.pct > 0 ? "+" : ""}${a.vsBaselineWork.pct}%`}  ${a.vsBaselineWork.verdict}`);
    console.log(`               render: ${a.vsBaselineRender.pct == null ? "—" : `${a.vsBaselineRender.pct > 0 ? "+" : ""}${a.vsBaselineRender.pct}%`}  ${a.vsBaselineRender.verdict}`);
    console.log(`               PAIRED rep-for-rep (cancels a slow machine-minute, which the range floor cannot):`);
    console.log(`                 render  ${a.pairedRender.verdict}`);
    console.log(`                 work    ${a.pairedWork.verdict}`);
  }
  if (out.faults.length) {
    console.log(`\n  ⛔ ${out.faults.length} rep(s) SUPPRESSED — an arm that did not take is not a fast arm:`);
    for (const f of out.faults) console.log(`     rep ${f.rep} arm ${f.arm}: ${f.fault}`);
  }
  console.log(`\n  ⚠ Tracing inflates absolute paint/raster/composite figures; only the BETWEEN-ARM comparison is claimed.`);
  console.log(`  ⚠ Raster CONTENT is synthetic (dimensions, opacity, footprint and the IndexedDB-string path are the owner's measured facts).`);
  console.log(`  ⚠ This sandbox blocks every external host, so GIS and Supabase are ABSENT, not slow. Every number is a LOWER BOUND.\n`);
}
process.exit(out.faults.length && out.faults.length === runs.length ? 1 : 0);
