#!/usr/bin/env node
/* verify-perf-recorder — THE TWO GUARDS THE ALWAYS-ON PERFORMANCE RECORDER SHIPS WITH (NEW-1).
 *
 * ⛔ GUARD 1 — OVERHEAD, MEASURED RATHER THAN CLAIMED. The recorder exists to explain a session
 * that gets slower the longer it runs. An instrument that allocates per frame would be a garbage-
 * collection schedule, and a GC pause is indistinguishable from the jank being hunted. So the cost
 * of its hot path is MEASURED, in a real browser, two ways:
 *   (a) TIME, DIRECTLY — `window.pfRec.__benchFrame(n)` drives the REAL per-frame function over
 *       synthetic timestamps and reports µs/frame. This is the strong timing measurement: an A/B on
 *       a noisy page can hide a small constant, a direct microbenchmark cannot.
 *   ⛔ (a) DOES NOT COVER ALLOCATION, AND THIS FILE DELIBERATELY DOES NOT PRETEND TO. Planting a
 *       real per-frame object plus a per-frame string in the hot path moved (a) from 0.05 to
 *       0.07 µs/frame — nowhere near its 2 µs bound — because a young-generation bump allocation
 *       in a tight loop costs about twenty nanoseconds. The cost was never the point: the GC
 *       schedule it creates an hour later is, and that is exactly the jank being hunted.
 *       A heap-delta arm over `performance.memory` WAS built for this and then REMOVED, because it
 *       could not discriminate and a guard that cannot fail on its own defect is decoration:
 *         · without `--enable-precise-memory-info` the value is quantised to 100 KB and cached for
 *           twenty minutes, so the planted defect read exactly 0 on every run;
 *         · with the flag, ambient growth (a timer tick, V8 taking a page, the evaluate call
 *           itself) only ADDS and a scavenge only SUBTRACTS, so the MAX read 33.6 bytes/frame on a
 *           hot path that allocates nothing and the MIN read −21.5 on one that allocates ~48. Both
 *           statistics were measured, both were wrong, and no third one rescues a signal that noisy
 *           at this granularity.
 *       The allocation property is guarded DETERMINISTICALLY instead, by a source rule over the hot
 *       path in `test/perfRecorder.test.js` — which fails on that same planted object immediately.
 *   (b) A/B — the same scripted gesture with the recorder ON and with it OFF (`?perfrec=off`,
 *       which is also the field kill switch), interleaved, comparing median frame time. This is the
 *       weaker but more honest end-to-end read: it includes the observers, the counter timer and
 *       the input listeners, none of which the microbenchmark touches.
 *
 * ⛔ GUARD 2 — ANTI-ROT. A recorder that never fires is indistinguishable from a healthy app. That
 * is exactly the failure mode `count-pond-invocations --assert` and the decode/annotation fault
 * arms exist to close, and it is the one this file must not repeat. So a deliberate stall is
 * INDUCED and a capture is asserted to FIRE. **If the induced-stall arm comes back clean, this
 * exits 1 as NOT OBSERVING** — a green from an instrument that saw nothing is worse than a red.
 * A CONTROL arm drives the identical gesture with no stall and asserts NOTHING fires, so the guard
 * proves the trigger discriminates rather than merely that it is loud.
 *
 *   node ui-audit/verify-perf-recorder.mjs --build
 *   ... --json
 *
 * It needs NO external host, NO sign-in and NO plan fixture: the recorder is installed from
 * main.jsx and works on any route, so this runs hermetically here — which is the whole point of
 * putting it in CI's reach rather than filing it as a live check.
 */
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const JSON_OUT = process.argv.includes("--json");
const PORT = Number(arg("--port", 4187));

/* ── the stated bounds ──────────────────────────────────────────────────────────────────────
 * Chosen BEFORE the measurement, and stated here so a later run cannot quietly move them.
 *   SELF_US_MAX 2.0   — two microseconds per frame is 0.012% of a 16.7 ms frame budget and 0.01%
 *                       of the owner's 20 ms one. Anything with a per-frame allocation or an
 *                       accidental O(window) scan lands orders of magnitude above it.
 *   AB_MS_MAX 0.6     — the end-to-end median frame-time difference between ON and OFF. Bigger
 *                       than the microbenchmark bound because it also carries the observers and
 *                       the counter timer, and because a browser's own run-to-run frame noise is
 *                       of this order (this repo's measured harness floor is ±6.3%).
 */
const SELF_US_MAX = 2.0;
const AB_MS_MAX = 0.6;

/* Compress the trigger's 50-second calibration so the guard runs in seconds. This drives the REAL
 * trigger — nothing is stubbed; only its clock constants move. */
const FAST = {
  counterMs: 500,
  idleStopMs: 1200,
  trigger: {
    baselineSkipMs: 300,
    baselineWindowMs: 2500,
    baselineMinFrames: 60,
    baselineMaxFrames: 300,
    sustainMs: 1200,
    sustainMinFrames: 6,
    cooldownMs: 2000,
    maxAuto: 3,
  },
};

if (process.argv.includes("--build")) {
  process.stderr.write("  · building…\n");
  const r = spawnSync("npx", ["vite", "build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) { console.error("build failed"); process.exit(2); }
}
if (!existsSync(join(DIST, "index.html"))) {
  console.error(`No build at ${DIST}. Re-run with --build.`);
  process.exit(2);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(DIST, p);
  if (!f.startsWith(DIST) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  const ext = p.slice(p.lastIndexOf("."));
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}/`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function openPage({ recorder = true, fast = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  if (fast) await ctx.addInitScript((cfg) => { window.__PLANYR_PERFREC = cfg; }, FAST);
  /* Everything external is blocked — this harness must be hermetic. */
  await ctx.route(/^https?:\/\//, (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await page.goto(recorder ? BASE : `${BASE}?perfrec=off`, { waitUntil: "load" });
  /* The recorder is armed in an idle gap after boot, so it is not there the instant load fires. */
  if (recorder) await page.waitForFunction(() => !!window.pfRec, null, { timeout: 30000 });
  else await page.waitForTimeout(6000);
  return { ctx, page };
}

/* Drive real input for `ms`, recording per-frame deltas from an INDEPENDENT rAF loop (never the
 * recorder's own — a measurement that reads the thing it is measuring proves nothing). */
async function driveAndMeasure(page, ms, { burn = 0 } = {}) {
  await page.evaluate((burnMs) => {
    window.__probe = { d: [], prev: 0, stop: false };
    const tick = (t) => {
      if (window.__probe.prev) window.__probe.d.push(t - window.__probe.prev);
      window.__probe.prev = t;
      if (burnMs > 0) { const end = performance.now() + burnMs; while (performance.now() < end) { /* deliberate stall */ } }
      if (!window.__probe.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, burn);

  const t0 = Date.now();
  let x = 400, y = 400, dir = 1;
  while (Date.now() - t0 < ms) {
    x += 9 * dir;
    if (x > 900 || x < 300) dir = -dir;
    y = 400 + Math.round(Math.sin(x / 40) * 60);
    await page.mouse.move(x, y);
  }
  const deltas = await page.evaluate(() => { window.__probe.stop = true; return window.__probe.d.slice(); });
  const v = deltas.filter((d) => d > 0 && d < 2000).sort((a, b) => a - b);
  return { frames: v.length, medianMs: v.length ? v[Math.floor(v.length / 2)] : null };
}

const out = { bounds: { selfUsMax: SELF_US_MAX, abMsMax: AB_MS_MAX }, overhead: {}, antiRot: {} };
let failures = [];

/* ── GUARD 1a — the hot path, measured directly ─────────────────────────────────────────────── */
{
  const { ctx, page } = await openPage({ recorder: true });
  // Warm the JIT, then take the median of five runs — a first run measures compilation.
  await page.evaluate(() => window.pfRec.__benchFrame(20000));
  const runs = [];
  for (let i = 0; i < 5; i++) runs.push(await page.evaluate(() => window.pfRec.__benchFrame(50000)));
  runs.sort((a, b) => a - b);
  out.overhead.selfUsPerFrame = runs[2];
  out.overhead.selfRuns = runs;

  await ctx.close();

  if (!(out.overhead.selfUsPerFrame >= 0)) failures.push("the per-frame microbenchmark did not run — pfRec.__benchFrame is missing");
  else if (out.overhead.selfUsPerFrame > SELF_US_MAX) failures.push(`per-frame cost ${out.overhead.selfUsPerFrame} µs exceeds the stated ${SELF_US_MAX} µs bound`);
}

/* ── GUARD 1b — end to end, recorder ON vs OFF, interleaved ──────────────────────────────────── */
{
  const on = [], off = [];
  for (let rep = 0; rep < 3; rep++) {
    for (const recorder of [true, false]) {
      const { ctx, page } = await openPage({ recorder });
      if (recorder && !(await page.evaluate(() => !!window.pfRec))) { await ctx.close(); failures.push("the ON arm had no recorder — the A/B would have compared two OFF arms"); continue; }
      if (!recorder && (await page.evaluate(() => !!window.pfRec))) { await ctx.close(); failures.push("?perfrec=off did NOT disable the recorder — the A/B is vacuous"); continue; }
      const r = await driveAndMeasure(page, 3000);
      (recorder ? on : off).push(r.medianMs);
      await ctx.close();
    }
  }
  const med = (a) => { const v = a.filter((x) => x != null).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
  out.overhead.onMedianMs = med(on);
  out.overhead.offMedianMs = med(off);
  out.overhead.deltaMs = out.overhead.onMedianMs != null && out.overhead.offMedianMs != null
    ? Math.round((out.overhead.onMedianMs - out.overhead.offMedianMs) * 100) / 100 : null;
  out.overhead.onRuns = on; out.overhead.offRuns = off;
  if (out.overhead.deltaMs == null) failures.push("the A/B produced no comparable medians");
  else if (out.overhead.deltaMs > AB_MS_MAX) failures.push(`the recorder added ${out.overhead.deltaMs} ms to the median frame, past the stated ${AB_MS_MAX} ms bound`);
}

/* ── GUARD 2 — ANTI-ROT: induce a stall, assert a capture FIRES ──────────────────────────────── */
{
  // CONTROL: the same driving with no induced stall must NOT fire.
  const { ctx: c1, page: p1 } = await openPage({ recorder: true });
  await driveAndMeasure(p1, 4000);                       // calibrate the baseline on smooth frames
  await driveAndMeasure(p1, 4000);                       // …and keep going, still smooth
  out.antiRot.control = await p1.evaluate(() => ({ ...window.pfRec.state(), captures: window.pfRec.captures() }));
  await c1.close();

  // STALL: calibrate on smooth frames, then burn the main thread for several seconds.
  const { ctx: c2, page: p2 } = await openPage({ recorder: true });
  await driveAndMeasure(p2, 4000);
  const baseline = await p2.evaluate(() => window.pfRec.state().baselineMs);
  await driveAndMeasure(p2, 5000, { burn: 70 });
  out.antiRot.stall = await p2.evaluate(() => ({ ...window.pfRec.state(), captures: window.pfRec.captures() }));
  out.antiRot.baselineMs = baseline;
  await c2.close();

  const fired = (out.antiRot.stall.captures || []).filter((c) => c.kind === "auto").length;
  const controlFired = (out.antiRot.control.captures || []).filter((c) => c.kind === "auto").length;
  out.antiRot.firedOnStall = fired;
  out.antiRot.firedOnControl = controlFired;

  if (out.antiRot.stall.baselineMs == null) failures.push("NOT OBSERVING: the trigger never sealed a baseline, so it could not have fired for any reason");
  else if (fired === 0) failures.push(`NOT OBSERVING: a deliberate stall produced NO capture (baseline ${out.antiRot.stall.baselineMs} ms, window mean ${out.antiRot.stall.windowMeanMs} ms) — a recorder that cannot fire is indistinguishable from a healthy app`);
  if (controlFired > 0) failures.push(`the CONTROL arm fired ${controlFired} time(s) with no induced stall — the trigger is not discriminating, it is just loud`);
}

/* ── the MANUAL control, which no auto-trigger test can exercise ─────────────────────────────── */
{
  const { ctx, page } = await openPage({ recorder: true });
  await driveAndMeasure(page, 2500);
  const before = await page.evaluate(() => window.pfRec.captures().length);
  const took = await page.evaluate(() => window.pfRec.capture("manual"));
  const after = await page.evaluate(() => window.pfRec.captures());
  await ctx.close();
  out.manual = { took, added: after.length - before, kind: after.length ? after[after.length - 1].kind : null };
  if (!took || out.manual.added !== 1) failures.push("the manual capture path did not produce a capture");
  if (out.manual.kind !== "manual") failures.push("a manual capture is not marked as owner-reported — his perception must stay distinguishable from the threshold's");
}

await browser.close();
server.close();

if (JSON_OUT) { console.log(JSON.stringify({ ...out, failures }, null, 2)); process.exit(failures.length ? 1 : 0); }

console.log("\nPERFORMANCE RECORDER — overhead + anti-rot\n");
console.log("  OVERHEAD (guard 1)");
console.log(`    hot path, TIME                ${out.overhead.selfUsPerFrame} µs/frame   (bound ${SELF_US_MAX})   runs: ${(out.overhead.selfRuns || []).join(", ")}`);
console.log("    hot path, ALLOCATION          guarded deterministically in test/perfRecorder.test.js — see this file's header");
console.log(`    median frame, recorder ON     ${out.overhead.onMedianMs} ms   (${(out.overhead.onRuns || []).join(", ")})`);
console.log(`    median frame, recorder OFF    ${out.overhead.offMedianMs} ms   (${(out.overhead.offRuns || []).join(", ")})`);
console.log(`    difference                    ${out.overhead.deltaMs} ms   (bound ${AB_MS_MAX})`);
console.log("\n  ANTI-ROT (guard 2)");
console.log(`    baseline sealed at            ${out.antiRot.baselineMs} ms`);
console.log(`    captures on an INDUCED STALL  ${out.antiRot.firedOnStall}   ← must be ≥ 1, or this guard is not observing`);
console.log(`    captures on the CONTROL       ${out.antiRot.firedOnControl}   ← must be 0`);
console.log(`    stall window mean             ${out.antiRot.stall?.windowMeanMs} ms over ${out.antiRot.stall?.windowFrames} frames`);
console.log("\n  MANUAL CONTROL");
console.log(`    a press produced a capture    ${out.manual?.took ? "yes" : "NO"}, marked "${out.manual?.kind}"`);

if (failures.length) {
  console.error(`\n⛔ ${failures.length} failure(s):`);
  for (const f of failures) console.error(`   · ${f}`);
  process.exit(1);
}
console.log("\n✅ the recorder costs less than the stated bound, fires on a real stall, stays silent without one, and records an owner-reported capture.");
