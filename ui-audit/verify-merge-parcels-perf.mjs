#!/usr/bin/env node
/* verify-merge-parcels-perf — the owner's report: "when I merge parcels it lags for a second, fix
 * that." His standing rule: MEASURE FIRST, don't optimise something that was never slow.
 *
 * ⛔ THE FINDING (NEW-1, this session) — MEASURED, NOT REPRODUCED, AND SAY SO PLAINLY. Merging the
 * three most vertex-dense adjacent parcels on "Turner JV Site / Concept A" — the highest real
 * parcel-count plan on production (14 parcels / 72 elements, queried directly from
 * `planyr_production`) — produced **zero** long tasks (>50ms) and ~31-47ms of total script+task
 * work on this environment's CPU. Every suspect the brief named was instrumented directly with
 * `performance.mark`/`measure` around the real call sites and REMOVED after measuring (temporary,
 * not shipped): `canUndoNow`'s `JSON.stringify` — ~0.1-0.3ms; `pushHistory` — ~0.2ms; the
 * `mergeRings` O(n²) loop — ~0.6ms; the debounced save effect's `reconcileElems` — ~0.1ms. All four
 * TOGETHER cost about 2ms, roughly 1/500th of the reported one-second hitch. CPU-throttling the
 * page (Emulation.setCPUThrottlingRate 4x/6x) scaled the total work up near-linearly (126ms / 218ms
 * long tasks appeared), confirming the residual cost is genuine CPU-bound work — almost certainly
 * React's reconciliation of the ~70-element scene reacting to a real model change (removing 2
 * parcels, adding 1) — not the four named suspects, and still nowhere near "a second" on this
 * fixture. **Conclusion: this does not reproduce the reported hitch on the best available
 * real-world case, and none of the four suspects the brief named are it.**
 *
 * WHY THIS SCRIPT STILL EXISTS RATHER THAN CLOSING THE ITEM ON A NULL (STANDING RULE #2): the app
 * already has a live, always-on capture instrument for exactly this shape of report
 * (`src/shared/telemetry/perfRecorder.js`, built for the B1121 "lags a minute after reload" case,
 * which ALSO failed to reproduce under a purpose-built sandbox battery and a live signed-in drive).
 * It watches every `long-animation-frame`/`longtask` continuously, WITH ATTRIBUTION (which script
 * was responsible), and the owner's own "that felt slow just now" button forces a capture. If a real
 * merge on his own machine — a bigger plan than this one, more GIS layers loaded, a slower device —
 * ever produces a genuine long task, the recorder already has it, attributed, without a fresh
 * investigation. Since NEW-1 (this session) wires `mergeParcels`'s `pushHistory("merge")` (a real
 * OP_KINDS member, was the bare "edit" default), a future capture during a merge is also
 * distinguishable in the write-path telemetry from an ordinary edit.
 *
 * THIS SCRIPT'S JOB NOW: a PERMANENT regression budget, so a future change that makes a merge
 * genuinely slow (an accidental O(n²) over a much larger n, a new effect keyed on `parcels` that
 * does real synchronous work) is caught here rather than waiting for a second owner report.
 * `--assert` fails (exit 1) if any single long task exceeds `BUDGET_MS` (100ms — the threshold the
 * brief itself set as "this is not the defect"), or if the merge doesn't actually happen (mutation
 * check: reverting `mergeRings`/`mergeParcels` so the merge silently no-ops would otherwise let this
 * pass vacuously).
 *
 * REAL DATA, NOT SYNTHETIC. `ui-audit/fixtures/turner-jv-concept-a.json` is "Turner JV Site /
 * Concept A" pulled read-only from `planyr_production` (Supabase project `lyeqzkuiwngunutlkkmi`) —
 * 14 parcels / 58 other elements (72 total), matching the counts in the brief (Turner JV 14, 8 South
 * (copy) 13/97, 8 South 12/88, Richfield B 10, Schiel 9/147). County-appraisal owner PII
 * (`acct`/`addr`/`attrs`) and the plan's display name are redacted; geometry, ids and settings are
 * byte-for-byte the production values. Three of its parcels — `psmsdnm2utytb_4/_5/_6` — verified
 * (offline, against the app's own `mergeRings` algorithm) to genuinely share boundaries and fuse
 * into one ring, so this drives a REAL successful 3-parcel merge, never a "don't touch" no-op.
 *
 * USAGE
 *   npm run build && npx vite preview --host   (on :4173), then
 *   node ui-audit/verify-merge-parcels-perf.mjs           # report only, exit 0
 *   node ui-audit/verify-merge-parcels-perf.mjs --assert  # fail if the budget is exceeded
 *   ... --json
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const ASSERT = process.argv.includes("--assert");
const BUDGET_MS = 100; // the threshold the brief itself named as "this is not the defect"

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/turner-jv-concept-a.json", import.meta.url)), "utf8"));
const MERGE_IDS = ["psmsdnm2utytb_4", "psmsdnm2utytb_5", "psmsdnm2utytb_6"]; // verified adjacent — see module header

// Longtask observer armed BEFORE React ever mounts, so the very first task after the click can't
// be missed. Buffered on `window.__longtasks`; PerformanceObserver's own spec floor is 50ms.
const ARM_LONGTASK_OBSERVER = () => {
  window.__longtasks = [];
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longtasks.push({ name: e.name, startTime: e.startTime, duration: e.duration });
    });
    po.observe({ entryTypes: ["longtask"] });
    window.__longtaskObserver = po;
  } catch (e) { window.__longtaskObserverError = String(e); }
};

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(ARM_LONGTASK_OBSERVER);
  await ctx.addInitScript((site) => {
    try {
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [site.id]: site }));
      localStorage.setItem("planarfit:currentSite:v1", site.id);
    } catch (_) { /* ignore */ }
  }, FIXTURE);
  const page = await ctx.newPage();

  await page.goto(BASE, { waitUntil: "load" });
  const svg = page.locator('svg[aria-label="Site plan canvas"]');
  await svg.waitFor({ timeout: 15000 });
  await page.waitForTimeout(2500); // let boot/GIS/initial layer settle before the timed gesture
  await assertMeasurable(page, "verify-merge-parcels-perf");

  // Interior screen point of the parcel with this id that is NOT covered by anything painted on
  // top of it. A parcel here isn't bare ground — each of the three chosen parcels hosts a real
  // building + parking + paving assembly, and those elements paint ABOVE the parcel in z-order
  // (drawEls after drawParcels), so a plain centroid frequently lands on a building/paving rect
  // instead of the parcel's own hit-stroke polygon (measured: 2 of 3 candidate parcels here). This
  // scans a grid inside the parcel ring (nearest-to-centroid first) and returns the first point
  // where `elementFromPoint` resolves to the parcel's own hit polygon — i.e. a point a real click
  // could actually land on. Recomputed per call: selecting a parcel opens the Properties panel and
  // can resize the canvas, moving every later parcel's screen position.
  const interiorPointFor = (id) => page.evaluate((pid) => {
    const svgEl = document.querySelector('svg[aria-label="Site plan canvas"]');
    const g = svgEl.querySelector(`g[data-feature="parcel:${pid}"]`);
    if (!g) return null;
    const poly = [...g.querySelectorAll("polygon")].find((p) => (p.getAttribute("stroke") || "").includes("0.001"));
    if (!poly) return null;
    const raw = poly.getAttribute("points").trim().split(/\s+/).map((s) => { const [x, y] = s.split(",").map(Number); return { x, y }; });
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of raw) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
    const inside = (x, y) => {
      let c = false;
      for (let i = 0, j = raw.length - 1; i < raw.length; j = i++) {
        const xi = raw[i].x, yi = raw[i].y, xj = raw[j].x, yj = raw[j].y;
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const m = svgEl.getScreenCTM();
    const toScreen = (x, y) => { const pt = svgEl.createSVGPoint(); pt.x = x; pt.y = y; const sp = pt.matrixTransform(m); return { x: sp.x, y: sp.y }; };
    const N = 25;
    const candidates = [];
    for (let iy = 1; iy < N; iy++) for (let ix = 1; ix < N; ix++) {
      const x = minX + ((maxX - minX) * ix) / N, y = minY + ((maxY - minY) * iy) / N;
      if (inside(x, y)) candidates.push({ x, y });
    }
    const ccx = raw.reduce((a, p) => a + p.x, 0) / raw.length, ccy = raw.reduce((a, p) => a + p.y, 0) / raw.length;
    candidates.sort((a, b) => Math.hypot(a.x - ccx, a.y - ccy) - Math.hypot(b.x - ccx, b.y - ccy));
    for (const c of candidates) {
      const sp = toScreen(c.x, c.y);
      if (document.elementFromPoint(sp.x, sp.y) === poly) return sp;
    }
    return null;
  }, id);

  const selCount = async () => {
    const t = await page.locator("text=/selected/").first().innerText().catch(() => "");
    const m = t.match(/(\d+)\s+(?:parcels? selected|selected)/) || t.match(/(\d+)\s+selected/);
    return m ? Number(m[1]) : 0;
  };

  const svgBox = await svg.boundingBox();
  for (let i = 0; i < MERGE_IDS.length; i++) {
    let ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      const p = await interiorPointFor(MERGE_IDS[i]);
      if (!p) { await page.waitForTimeout(300); continue; }
      await svg.click({ modifiers: ["Shift"], position: { x: p.x - svgBox.x, y: p.y - svgBox.y }, force: true });
      await page.waitForTimeout(350);
      ok = (await selCount()) >= i + 1;
    }
  }
  await page.waitForTimeout(300);
  const picked = await selCount();
  if (picked !== MERGE_IDS.length) {
    console.error(`FAIL: expected ${MERGE_IDS.length} parcels selected for merge, got ${picked} — refusing to score a run that never set up the reported scenario.`);
    await ctx.close(); await browser.close();
    process.exit(1);
  }

  // Clear anything queued before the gesture, mark the true start, click via a real Playwright
  // click (native input dispatch — not a synthetic in-page event; see SYNTHETIC-KEYS-DONT-EDIT for
  // why a hand-rolled dispatch is untrustworthy, though that rule is specifically about keyboard
  // events — a real pointer click here matches every other harness in this repo).
  await page.evaluate(() => { window.__longtasks.length = 0; performance.mark("planyr-merge-click-start"); });
  const mergeBtn = page.getByRole("button", { name: /Merge parcels/ }).first();
  await mergeBtn.click({ timeout: 3000 });
  // Two rAFs: one for React's commit, one for the browser's own paint — matches the "settle" idiom
  // used elsewhere in this repo (e.g. diagnose-contour-pan-perf.mjs's post-pan wait), scaled down
  // because this is a single click, not a continuous gesture.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(500); // catch a longtask from a slightly-delayed effect (debounced save, etc.)
  await page.evaluate(() => performance.mark("planyr-merge-click-end"));

  const result = await page.evaluate(() => {
    performance.measure("planyr-merge-parcels", "planyr-merge-click-start", "planyr-merge-click-end");
    const measure = performance.getEntriesByName("planyr-merge-parcels")[0];
    const start = performance.getEntriesByName("planyr-merge-click-start")[0].startTime;
    const end = performance.getEntriesByName("planyr-merge-click-end")[0].startTime;
    const longtasks = (window.__longtasks || []).filter((t) => t.startTime >= start - 5 && t.startTime <= end + 5);
    return {
      wallClockMs: +(measure.duration.toFixed(2)),
      longtaskCount: longtasks.length,
      longtaskDurationsMs: longtasks.map((t) => +t.duration.toFixed(2)),
      totalBlockedMs: +longtasks.reduce((a, t) => a + t.duration, 0).toFixed(2),
      maxLongtaskMs: longtasks.reduce((a, t) => Math.max(a, t.duration), 0),
      observerArmed: !window.__longtaskObserverError,
      observerError: window.__longtaskObserverError || null,
    };
  });

  const stored = await page.evaluate(() => {
    try {
      const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const s = all.perf_merge_fixture;
      return s ? { parcelCount: (s.parcels || []).length, deletedCount: (s.deletedIds || []).length } : null;
    } catch (e) { return null; }
  });

  await ctx.close();
  await browser.close();

  const mergedOk = stored && stored.parcelCount === 12 && stored.deletedCount === 3; // 14 - 3 + 1
  const withinBudget = result.observerArmed && result.maxLongtaskMs <= BUDGET_MS;
  const report = { fixture: "turner-jv-concept-a.json (14 parcels / 72 elements, real production)", mergeIds: MERGE_IDS, mergedOk, budgetMs: BUDGET_MS, withinBudget, stored, ...result };

  if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); }
  else {
    console.log("");
    console.log("MERGE PARCELS — LONGTASK / WALL-CLOCK BUDGET (real production geometry)");
    console.log(`  fixture: Turner JV Site / Concept A — 14 parcels, 72 elements (highest real parcel count on production)`);
    console.log(`  merged: ${MERGE_IDS.join(", ")} → ${mergedOk ? "1 parcel, 3 tombstoned (confirmed via localStorage)" : "⚠ merge did not persist as expected — " + JSON.stringify(stored)}`);
    console.log("");
    console.log(`  wall-clock (click → +2 rAF settle): ${result.wallClockMs} ms`);
    console.log(`  long tasks (>50ms) in that window: ${result.longtaskCount}`);
    if (result.longtaskCount) console.log(`    durations: ${result.longtaskDurationsMs.join(", ")} ms`);
    console.log(`  total blocked time: ${result.totalBlockedMs} ms · budget: ${BUDGET_MS} ms per task`);
    console.log("");
    if (!result.observerArmed) console.log(`  ⚠ PerformanceObserver failed to arm: ${result.observerError} — this run proves nothing.`);
    else console.log(withinBudget ? "  PASS — within budget." : `  FAIL — a long task exceeded ${BUDGET_MS}ms.`);
  }

  if (ASSERT && (!mergedOk || !withinBudget)) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
