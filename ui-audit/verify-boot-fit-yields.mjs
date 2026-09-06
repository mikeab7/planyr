#!/usr/bin/env node
/* verify-boot-fit-yields — THE APP NEVER REFRAMES ON TOP OF A GESTURE THE USER HAS ALREADY MADE.
 *
 * ⛔ THE PROPERTY, which is the owner's own sentence: "no programmatic view change ever executes
 * without a user action somewhere in its chain, at ANY point in the session … if some late-arriving
 * thing legitimately needs to fit the view, it must never do so after the user has moved the view
 * themselves, no matter how long ago that was."
 *
 * ⛔ WHY THIS CANNOT BE A UNIT TEST, and why it is the check that matters. The unit tests
 * (test/viewFramingGate.test.js) prove the GATE decides correctly. They cannot prove the app ASKS
 * it — a framing path that never consults the gate passes every one of them. Only driving the real
 * app under the conditions that make the race happen can show that, and those conditions are not
 * subtle to arrange once you know what they are: the 120 ms become-active reframe fires LATE under
 * main-thread load, so throttle the CPU hard and gesture before it lands.
 *
 * ⛔ AND IT IS PROVEN TO GO RED ON THE CODE IT REPLACES. `--baseline <dir>` points it at a build of
 * the PREVIOUS implementation (the per-mount `useRef` guard) and REQUIRES a violation there. That is
 * the preferred form of the teeth proof: aim the new check at untouched code and watch it fail,
 * rather than plant a synthetic defect that only proves the check can see what it was built to see.
 * A run of `--selftest` does both halves and fails unless fixed=green and baseline=red.
 *
 *   node ui-audit/verify-boot-fit-yields.mjs --build
 *   node ui-audit/verify-boot-fit-yields.mjs --selftest --baseline=dist-baseline
 *
 * Exits non-zero on a violation. This one IS a gate.
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
const SELFTEST = process.argv.includes("--selftest");
const BASELINE = argOf("--baseline", null);
const ITER = Number(argOf("--iter", 5));
const CPU = Number(argOf("--cpu", 40));
/* ⛔ WHEN the gesture lands decides WHICH implementation is on trial, so it is a swept parameter and
 * not a constant. Wheel BEFORE the 120 ms reframe timer fires and both the old guard and the new one
 * suppress — the old one at the timer, the new one at the execution — and the run proves nothing.
 * The window where they differ is narrow and is the whole point: the gesture landing AFTER the timer
 * has already granted permission but BEFORE the React effect actually runs `fit()`. Under load that
 * gap is long; at rest it is one tick. `--delay` sweeps for it, and a sweep that never finds it says
 * so rather than reporting a pass. */
const DELAYS = String(argOf("--delay", "0,80,120,160,200,260")).split(",").map(Number);   // the load that stretches the 120 ms timer into the race

if (DO_BUILD) execFileSync("npx", ["vite", "build"], { stdio: JSON_OUT ? "ignore" : "inherit" });

let portSeed = Number(argOf("--port", 4271));

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

/* ONE ITERATION. Boot heavily throttled, and take the wheel the instant the canvas exists — before
 * the become-active reframe has had its 120 ms (which under this load is far more than 120 ms of
 * wall clock). Then ask the recorder one question: did anything move the view afterwards that it
 * could not attribute to a gesture? */
async function once(browser, base, delayMs) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  await ctx.addInitScript(perfScenarioSeed());
  await ctx.route(/^https?:\/\//, (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  try {
    await page.goto(`${base}?planyrDiag=1#/project/${SCENARIO_ID}/site`, { waitUntil: "commit" });
    /* ⛔ WAIT ON THE MOUNT, NOT ON THE SETTLED CANVAS — and this is the difference between a check
       that reproduces the race and one that reports a clean sheet on both builds (which is what the
       first version of this harness did). `window.__plannerViewChanges` is installed by an effect in
       `SitePlanner`'s own mount, which is the same moment the become-active effect arms its 120 ms
       reframe. Waiting for the canvas to be VISIBLE is later — often late enough that the reframe
       has already landed, at which point there is no race left to observe and every build passes. */
    await page.waitForFunction(() => !!window.__plannerViewChanges, null, { timeout: 120_000, polling: "raf" });
    /* ⛔ REAL wheel input (CDP), never a synthetic event: the recorder credits a gesture only when
       `isTrusted` is true, so a dispatched event would read as UNREQUESTED and this harness would
       manufacture the very violation it is looking for. No awaits between the notches — the whole
       point is to get the user's gesture in before the reframe fires. */
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, -120);
    await page.mouse.wheel(0, -120);
    /* Now wait out the reframe, generously — the whole question is whether it lands on top of us. */
    await pacedWait(page, 4000);
    await assertMeasurable(page, "verify-boot-fit-yields");
    const log = await page.evaluate(() => (window.__plannerViewChanges ? window.__plannerViewChanges() : null));
    if (!log) return { error: "the diagnostic recorder never installed — nothing was observed" };
    const changes = log.changes || [];
    /* ⛔ THE PROPERTY IS "AFTER THE **FIRST** GESTURE", NOT "AFTER THE LAST ONE", and this harness
       got it wrong on its first pass — which is worth recording, because the wrong version reported
       a clean 0/10 on a build the fixed one was demonstrably suppressing 8 framings on. Once the
       user has moved the view, nothing unrequested may move it again; a reframe landing BETWEEN two
       wheel notches is exactly the reported symptom (in, out, in) and is invisible to a check that
       only looks past the last notch. */
    const firstGestureSeq = changes.find((c) => !c.unrequested)?.seq ?? -1;
    if (firstGestureSeq < 0) return { error: "no gesture-attributed view change — the wheel never reached the app, so this run observed nothing" };
    const after = changes.filter((c) => c.seq > firstGestureSeq && c.unrequested && c.kind !== "noop");
    return {
      violations: after.map((c) => ({ kind: c.kind, from: c.from, to: c.to, site: c.site, precededBy: c.precededBy })),
      suppressed: (log.events || []).filter((e) => e.kind === "frame:suppressed").length,
      totalChanges: changes.length,
    };
  } finally { await ctx.close(); }
}

async function runAgainst(dir, label) {
  const { server, base } = await serve(dir);
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const runs = [];
  try {
    for (let i = 0; i < ITER; i++) {
      const delay = DELAYS[i % DELAYS.length];   // interleaved, so a slow machine cannot bias one arm
      runs.push({ delay, ...(await once(browser, base, delay)) });
    }
  } finally { await browser.close(); server.kill(); }
  const usable = runs.filter((r) => !r.error);
  const bad = usable.filter((r) => r.violations.length);
  const byDelay = {};
  for (const d of DELAYS) {
    const arm = usable.filter((r) => r.delay === d);
    byDelay[d] = { runs: arm.length, violations: arm.filter((r) => r.violations.length).length };
  }
  const row = { label, dir, iterations: ITER, usable: usable.length, vacuous: runs.length - usable.length,
    violationRuns: bad.length, suppressedTotal: usable.reduce((s, r) => s + r.suppressed, 0), byDelay, sample: bad[0] || usable[0] || runs[0] };
  if (!JSON_OUT) {
    console.log(`${bad.length ? "⚠" : "✅"} ${label.padEnd(10)} reframe-on-top-of-gesture in ${bad.length}/${usable.length} runs` +
      `  (framings suppressed by the gate: ${row.suppressedTotal}${row.vacuous ? `, VACUOUS runs: ${row.vacuous}` : ""})`);
    console.log(`     by gesture delay: ${DELAYS.map((d) => `${d}ms ${byDelay[d].violations}/${byDelay[d].runs}`).join("  ")}`);
    for (const v of (row.sample?.violations || []).slice(0, 2)) console.log(`     ↳ ${v.kind} ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`);
  }
  return row;
}

const out = { fixed: await runAgainst(path.resolve("dist"), "fixed") };
if (BASELINE) out.baseline = await runAgainst(path.resolve(BASELINE), "baseline");
fs.mkdirSync("ui-audit/out", { recursive: true });
fs.writeFileSync("ui-audit/out/boot-fit-yields.json", JSON.stringify(out, null, 2));
if (JSON_OUT) console.log(JSON.stringify(out, null, 2));

/* ⛔ VACUITY. A run in which the wheel never produced an attributed view change observed nothing,
 * and a score printed over it would be the exact failure of the two earlier live probes. */
if (out.fixed.usable === 0) { console.error("⛔ VACUOUS — no usable run against the fixed build."); process.exit(3); }

let bad = false;
if (out.fixed.violationRuns > 0) { console.error(`⛔ VIOLATION — the fixed build reframed on top of a gesture in ${out.fixed.violationRuns} run(s).`); bad = true; }
if (SELFTEST) {
  if (!out.baseline) { console.error("⛔ --selftest needs --baseline=<dir> — the teeth proof is the point."); bad = true; }
  else if (out.baseline.violationRuns === 0) {
    console.error("⛔ NO TEETH — the baseline build (the implementation this replaces) showed no violation, so this check has not been proven able to see the bug it exists for.");
    bad = true;
  } else if (!JSON_OUT) console.log(`\n✅ teeth proven: the baseline build violates in ${out.baseline.violationRuns}/${out.baseline.usable} runs, the fixed build in ${out.fixed.violationRuns}/${out.fixed.usable}.`);
}
process.exit(bad ? 1 : 0);
