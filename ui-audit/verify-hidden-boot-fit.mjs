#!/usr/bin/env node
/* verify-hidden-boot-fit — B1234400: THE BOOT FIT MUST NEVER COMMIT A VIEW WHILE THE DOCUMENT IS
 * HIDDEN OR THE CONTAINER IS UNMEASURED.
 *
 * ⛔ THE CAPTURED DEFECT, verbatim from the owner's own diagnostic recorder (armed with
 * `?planyrDiag=1`), production build 4e4bc10, his real Goose Creek plan: a `setView` fired 3,978 ms
 * after load, `gesture: null`, `visibility: "hidden"`, ppf 0.35 → 0.0424 (roughly an 8× zoom-out with
 * a large offset jump) — the 120 ms boot auto-frame committing a fit while the tab loaded
 * backgrounded. The stack ran through React's own commit internals (`Do`/`gr`), confirming it came
 * from the render path, exactly as he suspected ("it's something that's hitting the renderer").
 *
 * ⛔ WHY THE EARLIER GATE (`viewFramingGate.js`'s move-count check, #1478) DID NOT ALREADY STOP THIS.
 * It answers "has the user taken the view?" — a question with no opinion on whether the view can
 * honestly be MEASURED at all. A hidden cold boot has nobody at the wheel, so the ownership check
 * correctly says yes, and `fit()` divides by whatever `size` a never-laid-out container reported.
 * This harness proves the NEW second gate (`mayFrame`'s `{ visible, measured }` readiness, checked
 * against `document.visibilityState` and a visible-tab-confirmed container measurement) closes it:
 * the invariant under test is "no view mutation commits while `document.visibilityState` is not
 * 'visible'", read off the recorder's own `visibility` field on each row — the exact field the
 * captured production defect carried as `"hidden"`.
 *
 * ⛔ WHY THIS CANNOT BE A UNIT TEST. test/viewFramingGate.test.js proves the GATE decides correctly
 * given a readiness object; it cannot prove the app measures readiness honestly or wires it to the
 * right call site. Only driving a real browser can show that.
 *
 * ⛔ AN HONEST LIMIT OF THIS SANDBOX, stated rather than hidden (FOREGROUND-OR-VOID's own spirit).
 * This environment's headless Chromium does not model real tab occlusion: two pages in one context,
 * with `page.bringToFront()` called on the OTHER one, both still read `document.visibilityState ===
 * "visible"` — measured directly before writing this harness (every `page.bringToFront()` in this
 * repo's other rigs, e.g. `diagnose-idle-gesture-zoom.mjs`'s `bgSettle`, exercises the SAME headless
 * build, so this is not a one-off). A truly backgrounded tab also suspends its own frame loop
 * (FOREGROUND-OR-VOID clause 2), which would additionally corrupt the CONTAINER'S measured box —
 * that half of the real-world mechanism cannot be reproduced here at all. So this harness instead
 * overrides `document.visibilityState` directly (a well-precedented technique: define the accessor
 * on the `document` instance and dispatch a real `visibilitychange` event) — the exact property both
 * the fix and the recorder read. That proves the INVARIANT precisely ("nothing commits while this
 * property disagrees with 'visible'") using the real code path, but it does NOT reproduce the
 * garbage NUMBERS the owner saw, because the container is never actually mis-laid-out here — layout
 * keeps running normally underneath the spoofed flag. The pre-fix build still fails this: it never
 * once consults `document.visibilityState`, so it commits `fit()` regardless, and the row still
 * records `visibility: "hidden"` off the very same (spoofed) property the fixed build now refuses on.
 *
 * ── CELLS (each is a real trusted gesture via CDP, per SYNTHETIC-KEYS-DONT-EDIT)
 *   cold-visible   the whole boot happens with the document reporting "visible" — the control arm
 *   cold-hidden    the whole boot happens "hidden", flipped visible ~4s later, no gesture
 *   hidden-30s     boots "hidden", flipped visible after a REAL 30s wait, then a gesture at once
 *   hidden-120s    boots "hidden", flipped visible after a REAL 120s wait, then a gesture at once
 * Each cell runs on a desktop/wheel profile and an iPhone/pinch profile in both orientations (his
 * repro is a phone). The 30s/120s durations exercise byte-identical gate logic (there is no time
 * term in `mayFrame`'s readiness check — deliberately, same as the move-count check beside it), so
 * they run fewer iterations than the cheap cells (`--iter-long`, default 3) — a wall-clock economy,
 * not a coverage gap; recorded honestly rather than silently doing 10 everywhere.
 *
 * ⛔ THE KNOWN-GOOD ARM IS MANDATORY (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): `cold-visible` must show a
 * real gesture-attributed view change (the recorder is watching) and never itself read hidden at
 * commit time — if it does, the harness is broken, not the app.
 *
 * ⛔ TEETH: `--baseline=<dir>` points this at a build from BEFORE this fix and REQUIRES a violation
 * in `cold-hidden` there. `--selftest --baseline=dist-baseline` runs both and fails unless
 * fixed=clean and baseline=violates — the preferred form (aim at untouched code, don't plant a defect).
 *
 *   node ui-audit/verify-hidden-boot-fit.mjs --build
 *   node ui-audit/verify-hidden-boot-fit.mjs --selftest --baseline=dist-baseline --iter=10
 *
 * Exits non-zero on a violation, a vacuous run, or (with --selftest) a baseline that shows no teeth.
 */
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { perfScenarioSeed, SCENARIO_ID } from "./lib/perf-scenario.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const argOf = (f, d) => { const hit = process.argv.find((a) => a.startsWith(`${f}=`)); return hit ? hit.slice(f.length + 1) : d; };
const JSON_OUT = process.argv.includes("--json");
const DO_BUILD = process.argv.includes("--build");
const SELFTEST = process.argv.includes("--selftest");
const BASELINE = argOf("--baseline", null);
const ITER = Number(argOf("--iter", 10));
const ITER_LONG = Number(argOf("--iter-long", 3));
const CELLS = String(argOf("--cell", "all")).split(",");
const QUICK = process.argv.includes("--quick"); // shrinks the idle waits for a smoke run of the rig itself

if (DO_BUILD) execFileSync("npx", ["vite", "build"], { stdio: JSON_OUT ? "ignore" : "inherit" });

let portSeed = Number(argOf("--port", 4291));

async function serve(dir) {
  const port = portSeed++;
  const base = `http://localhost:${port}/`;
  const server = spawn("npx", ["vite", "preview", "--outDir", dir, "--port", String(port), "--strictPort"], { stdio: "ignore" });
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    try { const r = await fetch(base); if (r.ok) return { server, base }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  server.kill();
  throw new Error(`preview server never came up for ${dir}`);
}

const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" };
const IPHONE_LANDSCAPE = { ...IPHONE, viewport: { width: 844, height: 390 } };
const DESKTOP = { viewport: { width: 1440, height: 900 }, hasTouch: true };

/* Overrides `document.visibilityState`/`document.hidden` on the instance (the standard accessor is
 * configurable per spec) BEFORE any app script runs, and exposes `window.__setTestVisible(bool)` to
 * flip it later with a real `visibilitychange` dispatch — verified empirically to work in this
 * sandbox where multi-page `bringToFront()` does not (see the file header). */
const VISIBILITY_SPOOF = `(() => {
  let vis = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (vis ? 'visible' : 'hidden') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !vis });
  window.__setTestVisible = (v) => { vis = !!v; document.dispatchEvent(new Event('visibilitychange')); };
})();`;

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
  await pacedWait(page, 400);
}

async function wheelZoom(page) {
  const vp = page.viewportSize();
  await page.mouse.move(Math.round(vp.width / 2), Math.round(vp.height / 2));
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -120); await pacedWait(page, 24); }
  await pacedWait(page, 400);
}

const readLog = (page) => page.evaluate(() => (window.__plannerViewChanges ? window.__plannerViewChanges() : null));

/* One iteration. `hiddenMs` (>0) means: boot with the spoofed visibility "hidden", wait that many
 * real ms (paced, not setTimeout), then flip to "visible". `hiddenMs === 0` means the control: never
 * spoof at all — the page's real visibilityState is used throughout (which this sandbox's headless
 * Chromium reports as "visible" for a single foregrounded tab). `gesture` runs right after the flip
 * — the "pinch immediately following the visibility change" case, folded into each hidden cell
 * rather than a fifth cell of its own. */
async function iteration(browser, base, { device, hiddenMs, gesture, label }) {
  const ctx = await browser.newContext(device);
  if (hiddenMs > 0) await ctx.addInitScript(VISIBILITY_SPOOF);
  await ctx.addInitScript(perfScenarioSeed());
  await ctx.route(/^https?:\/\//, (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}?planyrDiag=1#/project/${SCENARIO_ID}/site`, { waitUntil: "commit" });
    await page.waitForFunction(() => !!window.__plannerViewChanges, null, { timeout: 60_000, polling: hiddenMs > 0 ? 100 : "raf" });
    const visAtBoot = await page.evaluate(() => document.visibilityState);
    if (hiddenMs > 0) {
      await pacedWait(page, hiddenMs);
      await page.evaluate(() => window.__setTestVisible(true));
      await pacedWait(page, 250); // let the visibilitychange handlers + a retry frame or two land
    }
    const cdp = await ctx.newCDPSession(page);
    await assertMeasurable(page, `verify-hidden-boot-fit:${label}`);
    await pacedWait(page, 1000); // let the 120ms boot-fit (and any retry) settle before the gesture
    const beforeGesture = await readLog(page);
    if (gesture) await gesture(page, cdp);
    const after = await readLog(page);
    if (!after) return { error: "the diagnostic recorder never installed — nothing was observed" };
    const changes = after.changes || [];
    const fromSeq = beforeGesture ? (beforeGesture.changes.at(-1)?.seq ?? -1) : -1;
    const duringGesture = changes.filter((c) => c.seq > fromSeq);
    /* ⛔ THE VERDICT IS `visibility === "hidden"` ON THE ROW ITSELF — the bug's own recorded
     * signature (the captured production row carried it). The boot auto-frame is EXPECTED to read
     * `unrequested: true` regardless of the fix (nothing about it is gesture-driven) — the defect is
     * committing it while nobody could see it, not that it lacks a gesture. A `noop` moved nothing. */
    return {
      visAtBoot,
      committedWhileHidden: changes.filter((c) => c.kind !== "noop" && c.visibility === "hidden"),
      suppressedForReadiness: (after.events || []).filter((e) => e.kind === "frame:suppressed" && (e.detail === "document-hidden" || e.detail === "container-unmeasured")).length,
      gestureChanges: duringGesture.length,
      gestureAttributed: duringGesture.filter((c) => !c.unrequested).length,
      counts: after.counts,
    };
  } finally {
    await ctx.close();
  }
}

function buildCells() {
  const both = (name, opts) => ([
    { name: `${name}/wheel`, device: DESKTOP, ...opts, gesture: opts.gesture ? wheelZoom : null },
    { name: `${name}/pinch`, device: IPHONE, ...opts, gesture: opts.gesture ? (p, c) => pinch(p, c) : null },
    { name: `${name}/pinch-landscape`, device: IPHONE_LANDSCAPE, ...opts, gesture: opts.gesture ? (p, c) => pinch(p, c) : null },
  ]);
  const idleMs = QUICK ? { thirty: 3_000, oneTwenty: 8_000 } : { thirty: 30_000, oneTwenty: 120_000 };
  const out = [
    ...both("cold-visible", { hiddenMs: 0, gesture: true, iter: ITER }),
    ...both("cold-hidden", { hiddenMs: QUICK ? 2_000 : 4_000, gesture: false, iter: ITER }),
    ...both("hidden-30s", { hiddenMs: idleMs.thirty, gesture: true, iter: QUICK ? ITER : ITER_LONG }),
    ...both("hidden-120s", { hiddenMs: idleMs.oneTwenty, gesture: true, iter: QUICK ? ITER : ITER_LONG }),
  ];
  return out.filter((c) => CELLS.includes("all") || CELLS.some((k) => c.name.startsWith(k)));
}

async function runAgainst(dir, label) {
  const { server, base } = await serve(dir);
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const cells = buildCells();
  const rows = [];
  try {
    for (const cell of cells) {
      const n = cell.iter;
      const runs = [];
      for (let i = 0; i < n; i++) {
        try { runs.push(await iteration(browser, base, { ...cell, label: `${label}:${cell.name}#${i + 1}` })); }
        catch (e) { runs.push({ error: String(e && e.message || e) }); }
      }
      const ok = runs.filter((r) => !r.error);
      const preBootViolations = ok.filter((r) => r.committedWhileHidden.length);
      const row = {
        cell: cell.name, dir, iterations: n, usable: ok.length, errors: runs.length - ok.length,
        preBootViolationRuns: preBootViolations.length,
        sample: preBootViolations[0] || ok[0] || runs[0],
      };
      rows.push(row);
      if (!JSON_OUT) {
        console.log(`${row.preBootViolationRuns ? "⚠" : "✅"} ${label}/${row.cell.padEnd(24)} committed-while-hidden ${row.preBootViolationRuns}/${ok.length} (n=${n}, errors ${row.errors})`);
        if (row.sample?.committedWhileHidden?.length) {
          const v = row.sample.committedWhileHidden[0];
          console.log(`     ↳ visAtBoot=${row.sample.visAtBoot} ${v.kind} ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)} visibility=${v.visibility}`);
        }
      }
    }
  } finally { await browser.close(); server.kill(); }
  return rows;
}

const out = { fixed: await runAgainst(path.resolve("dist"), "fixed") };
if (BASELINE) out.baseline = await runAgainst(path.resolve(BASELINE), "baseline");
fs.mkdirSync("ui-audit/out", { recursive: true });
fs.writeFileSync("ui-audit/out/hidden-boot-fit.json", JSON.stringify(out, null, 2));
if (JSON_OUT) console.log(JSON.stringify(out, null, 2));

/* ⛔ VACUITY — the control arm (cold-visible) must show a real gesture-attributed change; if it
 * doesn't, the recorder saw nothing and every other row here is noise. */
const controls = out.fixed.filter((r) => r.cell.startsWith("cold-visible"));
const vacuousControls = controls.filter((r) => !(r.usable > 0) || !(r.sample && r.sample.gestureAttributed));
if (controls.length === 0 || vacuousControls.length === controls.length) {
  console.error("⛔ VACUOUS — the known-good control arm (cold-visible) never attributed a gesture. The rig saw nothing.");
  process.exit(3);
}
if (controls.some((r) => r.preBootViolationRuns > 0)) {
  console.error("⛔ THE CONTROL ARM ITSELF FLAGGED A VIOLATION — the harness or the app is broken independent of the hidden-boot question.");
  process.exit(3);
}

let bad = false;
const fixedBad = out.fixed.filter((r) => !r.cell.startsWith("cold-visible") && r.preBootViolationRuns > 0);
if (fixedBad.length) {
  console.error(`⛔ VIOLATION — ${fixedBad.map((r) => `${r.cell} ${r.preBootViolationRuns}/${r.usable}`).join(", ")}`);
  bad = true;
}
if (SELFTEST) {
  if (!out.baseline) { console.error("⛔ --selftest needs --baseline=<dir> — the teeth proof is the point."); bad = true; }
  else {
    const baselineHidden = out.baseline.filter((r) => r.cell.startsWith("cold-hidden"));
    const teeth = baselineHidden.filter((r) => r.preBootViolationRuns > 0);
    if (teeth.length === 0) {
      console.error("⛔ NO TEETH — the baseline build (before this fix) showed no cold-hidden violation, so this check has not been proven able to see the bug it exists for.");
      bad = true;
    } else if (!JSON_OUT) {
      console.log(`\n✅ teeth proven: baseline cold-hidden violates ${teeth.map((r) => `${r.preBootViolationRuns}/${r.usable}`).join(", ")}; fixed build is clean.`);
    }
  }
}
process.exit(bad ? 1 : 0);
