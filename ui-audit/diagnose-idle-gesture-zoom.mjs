#!/usr/bin/env node
/* diagnose-idle-gesture-zoom — THE RIG FOR "IT ZOOMS ITSELF", BUILT BEFORE ANY FIX.
 *
 * ⛔ WHY A NEW INSTRUMENT RATHER THAN ANOTHER GUESS. The owner reported the planner zooming itself
 * on a cold start; B1448 guarded the one call site that could explain that (the 120 ms boot reframe)
 * and, on his own phone, the cold start then came back CLEAN. He then left the app sitting idle,
 * came back, pinched — and it misbehaved again. So there is a SECOND trigger that a boot-time guard
 * cannot cover by construction, and three earlier attempts to see it produced nothing usable:
 *
 *   · #1451's harness saw exactly ONE `setView` on a cold load and never reproduced the sequence, so
 *     its green was not evidence of anything;
 *   · a live probe polling `.leaflet-control-scale-line` read 20 mi on all 95 samples INCLUDING
 *     during a deliberate trusted wheel-scroll;
 *   · a live probe polling the first `img.leaflet-tile`'s `z` segment read z10 on all 110 samples.
 *
 * Both live probes were structurally blind, for the reason recorded in
 * `src/workspaces/site-planner/lib/viewChangeRecorder.js`: THE PLANNER'S ZOOM IS NOT LEAFLET'S ZOOM.
 * This rig binds to the object that decides — the app's own `setView` — and correlates every change
 * against a timeline of what arrived just before it.
 *
 * ── WHAT IT DRIVES (the owner's matrix, one cell per `--cell`, N iterations each) ────────────────
 *   cold        load, then gesture at 1s / 3s / 5s / 10s
 *   idle        load, sit untouched 30s / 60s / 2min / 5min, then gesture      ← the reported trigger
 *   background  load, background the tab 30s / 2min / 5min, foreground, gesture
 *   offline     load, go offline 30s, back online, gesture
 *   cpu         load under 4x / 20x CPU throttling, gesture
 *   overlay     the same plan with a sheet overlay visible and hidden, compared
 *   presence    a second client joins/leaves the same plan while the first sits idle, then gesture
 *
 * Each cell runs on BOTH input paths — a real touch PINCH (CDP `Input.dispatchTouchEvent`, under an
 * iPhone device profile) and a wheel — because his repro is a phone and the wheel is not the same
 * code path. It reports a RATE over N iterations, never a single pass: he says it is intermittent.
 *
 * ⛔ FOREGROUND-OR-VOID IS HONOURED AT THE POINT IT BITES. The background cell deliberately hides the
 * page — so every measurement is taken only AFTER it is foregrounded again and `assertMeasurable`
 * has passed. A reading taken while hidden would be a stale frame that agrees with itself.
 *
 * ⛔ AND THE KNOWN-GOOD ARM IS MANDATORY (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6). Every run includes a
 * `control` cell whose answer is known independently of the code under test: a real gesture MUST
 * produce view changes that the recorder attributes to that gesture. If the control reports zero
 * changes, the rig saw nothing and the run is VACUOUS — it says so and exits non-zero rather than
 * printing a clean score. That is precisely the failure mode of the two live probes above.
 *
 *   node ui-audit/diagnose-idle-gesture-zoom.mjs --build
 *   node ui-audit/diagnose-idle-gesture-zoom.mjs --cell=idle --iter=10 --json
 *   node ui-audit/diagnose-idle-gesture-zoom.mjs --quick        # short idle waits, for a smoke run
 */
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { perfScenarioSeed, SCENARIO_ID } from "./lib/perf-scenario.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const argOf = (f, d) => { const hit = process.argv.find((a) => a.startsWith(`${f}=`)); return hit ? hit.slice(f.length + 1) : d; };
const JSON_OUT = process.argv.includes("--json");
const DO_BUILD = process.argv.includes("--build");
const QUICK = process.argv.includes("--quick");
const ITER = Number(argOf("--iter", QUICK ? 3 : 10));
const CELLS = String(argOf("--cell", "all")).split(",");
const PORT = Number(argOf("--port", 4231));
const BASE = `http://localhost:${PORT}/`;
const OUTDIR = path.resolve(argOf("--out", "ui-audit/out/idle-gesture-zoom"));
const DIST = path.resolve("dist");

const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" };
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: true };

/* The idle waits. `--quick` shrinks them so the rig itself can be smoke-tested in a minute; the real
 * run uses the owner's own numbers. A cell's wait is part of its identity and is reported. */
const IDLE_WAITS = QUICK ? [5_000, 15_000] : [30_000, 60_000, 120_000, 300_000];
const BG_WAITS = QUICK ? [5_000, 15_000] : [30_000, 120_000, 300_000];
const COLD_DELAYS = QUICK ? [1_000, 3_000] : [1_000, 3_000, 5_000, 10_000];

if (DO_BUILD) execFileSync("npx", ["vite", "build"], { stdio: JSON_OUT ? "ignore" : "inherit" });
if (!fs.existsSync(path.join(DIST, "index.html"))) { console.error(`⛔ No build at ${DIST}. Run with --build.`); process.exit(2); }

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
process.on("exit", () => { try { server.kill(); } catch { /* already gone */ } });
const up = await (async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    try { const r = await fetch(BASE); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
})();
if (!up) { server.kill(); console.error(`⛔ preview server never came up on ${BASE}`); process.exit(2); }

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

/* ---- the gestures ---------------------------------------------------------------------------
 * ⛔ REAL EVENTS ONLY. The recorder credits a gesture ONLY when `isTrusted` is true, so a synthetic
 * `dispatchEvent` would be recorded as `gesture:untrusted` and every change it caused would read as
 * UNREQUESTED — the rig would manufacture the exact finding it is hunting. CDP input is trusted.
 * (SYNTHETIC-KEYS-DONT-EDIT, applied to the input half rather than the mutation half.)
 */
async function pinch(page, cdp, { steps = 12, spread = 1.9 } = {}) {
  const vp = page.viewportSize();
  const cx = Math.round(vp.width / 2), cy = Math.round(vp.height / 2);
  const r0 = Math.round(Math.min(vp.width, vp.height) * 0.16);
  const pt = (r, id) => ({ x: id === 1 ? cx - r : cx + r, y: cy, id });
  const send = (type, touchPoints) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  await send("touchStart", [pt(r0, 1), pt(r0, 2)]);
  for (let i = 1; i <= steps; i++) {
    const r = Math.round(r0 * (1 + (spread - 1) * (i / steps)));
    await send("touchMove", [pt(r, 1), pt(r, 2)]);
    await pacedWait(page, 16);
  }
  await send("touchEnd", []);
  await pacedWait(page, 400);   // let the settle timer re-bake
}

async function wheelZoom(page) {
  const vp = page.viewportSize();
  await page.mouse.move(Math.round(vp.width / 2), Math.round(vp.height / 2));
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -120); await pacedWait(page, 24); }
  await pacedWait(page, 400);
}

/* ---- the read -------------------------------------------------------------------------------- */
const readLog = (page) => page.evaluate(() => (window.__plannerViewChanges ? window.__plannerViewChanges() : null));

async function boot(ctxOpts, { seedOpts, cpuRate, offline } = {}) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(perfScenarioSeed(seedOpts));
  /* Armed via the SHIPPED door, deliberately: `?planyrDiag=1` is the same way the owner arms it on
     his own phone, so the rig exercises the path he will use rather than a harness-only flag. */
  await ctx.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (cpuRate) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  /* ⛔ THE ROUTE IS EXPLICIT, NOT RESUMED. Landing on `/` shows the Dashboard ("No projects yet")
     — the seeded plan is in localStorage but nothing opens it — so a harness that waits for the
     canvas there waits sixty seconds and reports an error, which is how this rig's first run went.
     Address the plan by its own project route, and `?planyrDiag=1` arms the recorder through the
     shipped door (diagArm reads search+hash together, so the query may precede the hash). */
  await page.goto(`${BASE}?planyrDiag=1#/project/${SCENARIO_ID}/site`, { waitUntil: "load" });
  await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
  await page.waitForFunction(() => !!window.__plannerViewChanges && !!window.__plannerViewChanges(), null, { timeout: 30_000 });
  if (offline) await ctx.setOffline(true);
  return { ctx, page, cdp };
}

/* One iteration. `settle` is whatever the cell does between boot and the gesture; it returns a label
 * describing what it did, which lands on the row. */
async function iteration({ device, settle, gesture, cpuRate, seedOpts, label }) {
  const { ctx, page, cdp } = await boot(device, { cpuRate, seedOpts });
  try {
    await assertMeasurable(page, "diagnose-idle-gesture-zoom");
    await pacedWait(page, 2500);                       // let boot finish and the 120ms reframe land
    const afterBoot = await readLog(page);
    await page.evaluate(() => window.__plannerViewChanges() && null);
    const settleNote = settle ? await settle({ page, cdp, ctx }) : "none";
    /* ⛔ MEASURE ONLY WHEN THE PAGE CAN BE MEASURED. The background cell has just un-hidden the tab;
       a reading taken a moment earlier would be a suspended-rAF frame agreeing with itself. */
    await assertMeasurable(page, "diagnose-idle-gesture-zoom (post-settle)");
    const beforeGesture = await readLog(page);
    await gesture(page, cdp);
    const after = await readLog(page);

    /* The rows this iteration is judged on: view changes recorded AFTER boot settled. `seq` is a
       monotonic counter inside the recorder, so "new since" is exact and needs no time arithmetic. */
    const fromSeq = beforeGesture ? (beforeGesture.changes.at(-1)?.seq ?? -1) : -1;
    const bootSeq = afterBoot ? (afterBoot.changes.at(-1)?.seq ?? -1) : -1;
    const duringGesture = (after?.changes || []).filter((c) => c.seq > fromSeq);
    const duringSettle = (after?.changes || []).filter((c) => c.seq > bootSeq && c.seq <= fromSeq);
    return {
      label, settleNote,
      bootChanges: (afterBoot?.changes || []).length,
      bootUnrequested: (afterBoot?.changes || []).filter((c) => c.unrequested && c.kind !== "noop").length,
      /* THE VERDICT COLUMNS. An unrequested change DURING THE IDLE/SETTLE PHASE is the app moving the
         view with nobody touching it. An unrequested change during the gesture phase is a change the
         recorder could not attribute to the gesture that was actually performed. */
      idleUnrequested: duringSettle.filter((c) => c.unrequested && c.kind !== "noop"),
      gestureChanges: duringGesture.length,
      gestureUnrequested: duringGesture.filter((c) => c.unrequested && c.kind !== "noop"),
      /* The zoom SEQUENCE the owner describes — in, out, in — read off the ppf direction changes. */
      zoomReversals: countReversals(duringGesture.filter((c) => c.kind === "zoom")),
      events: (after?.events || []).slice(-40),
      allChanges: duringSettle.concat(duringGesture),
    };
  } finally { await ctx.close(); }
}

/** How many times the zoom direction flipped across a run of zoom changes. A clean pinch-in is 0. */
function countReversals(zooms) {
  let dir = 0, flips = 0;
  for (const z of zooms) {
    const d = Math.sign((z.to?.ppf ?? 0) - (z.from?.ppf ?? 0));
    if (d === 0) continue;
    if (dir !== 0 && d !== dir) flips++;
    dir = d;
  }
  return flips;
}

/* ---- the cells ------------------------------------------------------------------------------- */
const idleSettle = (ms) => async ({ page }) => { await pacedWait(page, ms); return `idle ${ms}ms`; };
const bgSettle = (ms) => async ({ page, ctx }) => {
  const other = await ctx.newPage();          // a genuinely foregrounded sibling backgrounds `page`
  await other.goto("about:blank");
  await other.bringToFront();
  await new Promise((r) => setTimeout(r, ms));  // `page` is hidden — its own clock is clamped, so pace from Node
  await page.bringToFront();
  await other.close();
  await new Promise((r) => setTimeout(r, 600));
  return `backgrounded ${ms}ms`;
};
const offlineSettle = (ms) => async ({ page, ctx }) => {
  await ctx.setOffline(true);
  await pacedWait(page, ms);
  await ctx.setOffline(false);
  await pacedWait(page, 1500);
  return `offline ${ms}ms then online`;
};

function buildCells() {
  const out = [];
  const both = (name, opts) => {
    out.push({ name: `${name}/pinch`, device: IPHONE, gesture: (p, c) => pinch(p, c), ...opts });
    out.push({ name: `${name}/wheel`, device: DESKTOP, gesture: (p) => wheelZoom(p), ...opts });
  };
  /* THE KNOWN-GOOD ARM. Its answer does not depend on the code under test: a real gesture on a page
     that has been sitting quietly must produce view changes ATTRIBUTED to that gesture. */
  both("control", { settle: idleSettle(1000) });
  for (const d of COLD_DELAYS) both(`cold-${d / 1000}s`, { settle: idleSettle(d) });
  for (const w of IDLE_WAITS) both(`idle-${w / 1000}s`, { settle: idleSettle(w) });
  for (const w of BG_WAITS) both(`background-${w / 1000}s`, { settle: bgSettle(w) });
  both("offline-30s", { settle: offlineSettle(QUICK ? 5_000 : 30_000) });
  both("cpu-4x", { settle: idleSettle(3000), cpuRate: 4 });
  both("cpu-20x", { settle: idleSettle(3000), cpuRate: 20 });
  return out.filter((c) => CELLS.includes("all") || CELLS.some((k) => c.name.startsWith(k)));
}

const cells = buildCells();
if (!cells.length) { console.error(`⛔ no cells matched --cell=${CELLS.join(",")}`); process.exit(2); }

fs.mkdirSync(OUTDIR, { recursive: true });
const results = [];
for (const cell of cells) {
  const runs = [];
  for (let i = 0; i < ITER; i++) {
    try { runs.push(await iteration({ ...cell, label: `${cell.name}#${i + 1}` })); }
    catch (e) { runs.push({ label: `${cell.name}#${i + 1}`, error: String(e && e.message || e) }); }
  }
  const ok = runs.filter((r) => !r.error);
  const hits = ok.filter((r) => r.idleUnrequested.length || r.gestureUnrequested.length || r.zoomReversals > 0);
  const row = {
    cell: cell.name,
    iterations: ITER,
    errors: runs.filter((r) => r.error).length,
    rate: ok.length ? hits.length / ok.length : null,
    idleUnrequestedRuns: ok.filter((r) => r.idleUnrequested.length).length,
    gestureUnrequestedRuns: ok.filter((r) => r.gestureUnrequested.length).length,
    reversalRuns: ok.filter((r) => r.zoomReversals > 0).length,
    medianGestureChanges: median(ok.map((r) => r.gestureChanges)),
    sample: hits[0] || ok[0] || runs[0],
  };
  results.push(row);
  if (!JSON_OUT) console.log(`${row.rate ? "⚠" : "✅"} ${row.cell.padEnd(24)} rate ${fmtRate(row.rate)}  idle-unreq ${row.idleUnrequestedRuns}/${ok.length}  gesture-unreq ${row.gestureUnrequestedRuns}/${ok.length}  reversals ${row.reversalRuns}/${ok.length}  errors ${row.errors}`);
}

function median(xs) { const a = xs.filter(Number.isFinite).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : null; }
function fmtRate(r) { return r == null ? "n/a" : `${Math.round(r * 100)}%`; }

/* ⛔ VACUITY. The control arm's expected value is known independently of the app's correctness, so a
 * control that recorded NO view changes means the rig observed nothing and every other row is noise. */
const controls = results.filter((r) => r.cell.startsWith("control"));
const vacuous = controls.filter((r) => !(r.medianGestureChanges > 0));
fs.writeFileSync(path.join(OUTDIR, "results.json"), JSON.stringify({ iter: ITER, quick: QUICK, results }, null, 2));
if (JSON_OUT) console.log(JSON.stringify({ vacuous: vacuous.map((v) => v.cell), results }, null, 2));

await browser.close();
server.kill();

if (vacuous.length) {
  console.error(`⛔ VACUOUS RUN — the control arm recorded no view changes for: ${vacuous.map((v) => v.cell).join(", ")}.`);
  console.error("   A real gesture must move the view. The instrument saw nothing, so no other row here means anything.");
  process.exit(3);
}
if (!JSON_OUT) console.log(`\nfull log → ${path.join(OUTDIR, "results.json")}`);
process.exit(0);
