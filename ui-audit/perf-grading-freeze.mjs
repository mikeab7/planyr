/* perf-grading-freeze — ROUND 8 perf (B2319137 ×2): the ~30 s freezes the owner hit on Concept A with grading on (a limit-mode
 * switch at the parcel zoom with cut/fill on; one zoom step at the building zoom in "To the boundary"). The app's perfcap did not
 * record them and the telemetry showed almost no long TASKS, so this instrument measures every way a frame can be late, not just
 * script: (1) long-animation-frame entries (script + style/layout/paint up to the render update), (2) the largest gap between two
 * requestAnimationFrame callbacks (a frame the browser never produced), and (3) how long a screenshot takes to come back — the
 * exact operation that timed out in the owner's Cowork session (it waits on the compositor / raster, which the first two cannot see).
 * Real GradingController + GradingCanvas on the owner's real cross-dock and the real Chehaw ground (the grading harness), at his
 * device pixel ratio, contours + cut/fill + paper on. Scenarios: mode switch ×2 at the parcel zoom; three zoom steps at the building
 * zoom in each mode. KNOWN-GOOD ARM: a deliberate 250 ms block in a page task must be seen by (1) and (2), or the run is VOID.
 *   node ui-audit/perf-grading-freeze.mjs [--budget=<ms>] [--json]          (starts its own vite on :5199) */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5199, BASE = `http://localhost:${PORT}`;
const EXEC = process.env.PW_CHROME || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const BUDGET = +((process.argv.find((a) => a.startsWith("--budget=")) || "").slice(9) || 50);   // PR #2375: nothing may block past ~50 ms
const SHOT_BUDGET = 2000;     // a screenshot must come back in this — the owner's hit timed out at ~30 s
const fails = [], notes = [];
const check = (name, ok, extra = "") => { (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore", detached: true });
const stopVite = () => { try { process.kill(-vite.pid); } catch { try { vite.kill(); } catch {} } };
try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await sleep(300); }
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const run = async (mode, zoom) => {
    const ctx = await browser.newContext({ viewport: { width: 1913, height: 1000 }, deviceScaleFactor: 2.15 });
    await ctx.addInitScript(() => {
      window.__lf = []; window.__gap = { max: 0, at: 0 };
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lf.push({ t: e.startTime, d: e.duration, render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0, style: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0, s: (e.scripts || []).map((x) => `${x.invoker}${x.sourceFunctionName ? "/" + x.sourceFunctionName : ""} ${Math.round(x.duration)}ms`).join(" | ") }); }).observe({ type: "long-animation-frame", buffered: true });
      window.__gaps = []; let last = 0; const tick = (t) => { if (last && t - last > 34) window.__gaps.push([last, t]); if (last && t - last > window.__gap.max) { window.__gap.max = t - last; window.__gap.at = t; } last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    });
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`${BASE}/ui-audit/harness/grading-harness.html?owner=1&buildable=0&contours=1&zoom=${zoom}&mode=${mode}`);
    await assertMeasurable(page, "perf-grading-freeze");
    await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    const settle = async () => {
      await page.waitForFunction(() => { const e = document.querySelector("[data-grading-earthwork]"); return e && e.getAttribute("data-grading-earthwork") !== "pending"; }, null, { timeout: 120000 });
      await page.waitForSelector('[data-layer="contours"] path', { state: "attached", timeout: 120000 }).catch(() => {});
      await page.waitForSelector("[data-band-tint]", { state: "attached", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2500);
    };
    await settle();
    return { ctx, page, errs, settle };
  };
  const PROFILE = process.argv.includes("--profile");
  const measure = async (page, label, act, settle) => {
    // LoAF entries arrive a little after their frame ends, so the previous step's screenshot frame can land after the reset:
    // everything before this measurement's own start is dropped by time, not by the reset alone
    const pStart = await page.evaluate(() => { window.__lf.length = 0; window.__gap.max = 0; window.__gaps.length = 0; return performance.now(); });
    let cdp = null;
    if (PROFILE) { cdp = await page.context().newCDPSession(page); await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start"); await page.waitForTimeout(1500); await page.evaluate(() => { window.__lf.length = 0; window.__gaps.length = 0; }); }
    const t0 = Date.now();
    await act();
    // the screenshot is the owner's own probe: how long until the browser can hand back a picture of the new state
    // A CDP screenshot forces a full-resolution raster of its own, so the frames it spans are the INSTRUMENT's, not the app's
    // (measured: ~70 ms frames with no script in them, every one under a screenshot). Each screenshot's window is recorded in
    // page time and every frame / rAF gap overlapping one is excluded from the verdict — the screenshot's own latency is the
    // separate, coarser probe (the owner's ~30 s timeout).
    const shots = [];
    const shoot = async () => {
      const p0 = await page.evaluate(() => performance.now());
      const s0 = Date.now();
      await page.screenshot({ timeout: 60000 }).catch(() => {});
      const ms = Date.now() - s0;
      shots.push([p0, await page.evaluate(() => performance.now())]);
      return ms;
    };
    const shotMs = await shoot();
    await settle();
    const shot2Ms = await shoot();
    if (cdp) {
      const { profile } = await cdp.send("Profiler.stop");
      const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n])), cnt = new Map();
      for (const id of profile.samples) cnt.set(id, (cnt.get(id) || 0) + 1);
      for (const [id, c] of cnt) { const n = byId.get(id); const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop().split("?")[0]}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + c); }
      notes.push(`  · PROFILE ${label}: ` + [...self].filter(([k]) => !/\(idle\)|\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, c]) => `${k}=${(c * 0.2).toFixed(0)}ms`).join(" · "));
    }
    const r0 = await page.evaluate(() => ({ lf: window.__lf.slice(), gaps: window.__gaps.slice() }));
    const overlapsShot = (a, b) => shots.some(([s, e]) => a < e + 20 && b > s - 20);
    const lf = r0.lf.filter((e) => e.t >= pStart && !overlapsShot(e.t, e.t + e.d));
    const gap = Math.max(0, ...r0.gaps.filter(([a, b]) => a >= pStart && !overlapsShot(a, b)).map(([a, b]) => b - a));
    const maxLf = lf.reduce((m, e) => (e.d > m.d ? e : m), { d: 0 });
    if (process.argv.includes("--debug")) notes.push(`  · DEBUG ${label}: frame at ${Math.round(maxLf.t || 0)}+${Math.round(maxLf.d)} style ${Math.round(maxLf.style || 0)} · shots ${shots.map(([a, b]) => `${Math.round(a)}–${Math.round(b)}`).join(", ")} · gaps ${r0.gaps.map(([a, b]) => `${Math.round(a)}–${Math.round(b)}`).join(", ")}`);
    return { label, wallMs: Date.now() - t0, shotMs, shot2Ms, maxFrameMs: Math.round(maxLf.d), maxFrame: maxLf, rafGapMs: Math.round(gap), longFrames: lf.filter((e) => e.d >= 50).length, excluded: r0.lf.length - lf.length };
  };
  const results = [];
  // ---- known-good arm
  {
    const { ctx, page } = await run("boundary", "site");
    await page.evaluate(() => { window.__lf.length = 0; window.__gap.max = 0; });
    await page.evaluate(() => { setTimeout(() => { const t = performance.now(); while (performance.now() - t < 250) { /* block */ } }, 0); });
    await page.waitForTimeout(1200);
    const kg = await page.evaluate(() => ({ lf: Math.max(0, ...window.__lf.map((e) => e.d)), gap: window.__gap.max }));
    if (!(kg.lf >= 240 && kg.gap >= 200)) { fails.push(`✗ VOID — the instrument did not see a known 250 ms block (frame ${Math.round(kg.lf)} ms, rAF gap ${Math.round(kg.gap)} ms)`); }
    else notes.push(`  · known-good arm: a 250 ms block reads frame ${Math.round(kg.lf)} ms / rAF gap ${Math.round(kg.gap)} ms`);
    await ctx.close();
  }
  if (!fails.length) {
    // ---- mode switch ×2 at the parcel zoom, cut/fill on
    {
      const { ctx, page, settle } = await run("boundary", "site");
      results.push(await measure(page, "parcel zoom: To the boundary → Around the layout", () => page.click('[data-testid="grading-limit-mode"] button:first-child'), settle));
      results.push(await measure(page, "parcel zoom: Around the layout → To the boundary", () => page.click('[data-testid="grading-limit-mode"] button:last-child'), settle));
      await ctx.close();
    }
    // ---- three zoom steps at the building zoom, each mode
    for (const mode of ["boundary", "layout"]) {
      const { ctx, page, settle } = await run(mode, "bldg");
      for (let k = 1; k <= 3; k++) results.push(await measure(page, `building zoom (${mode}): zoom step ${k}`, () => page.evaluate(() => window.__harness.zoomBy(1.4)), settle));
      await ctx.close();
    }
  }
  for (const r of results) {
    check(`${r.label}: longest frame ${r.maxFrameMs} ms (render part ${Math.round(r.maxFrame.render || 0)} ms), largest rAF gap ${r.rafGapMs} ms, screenshot back in ${r.shotMs} / ${r.shot2Ms} ms`,
      r.maxFrameMs < BUDGET && r.rafGapMs < Math.max(BUDGET * 2, 120) && r.shotMs < SHOT_BUDGET && r.shot2Ms < SHOT_BUDGET,
      r.maxFrameMs >= BUDGET ? `[${r.maxFrame.s || "no script attributed — render/paint"}]` : "");
  }
  await browser.close();
  if (process.argv.includes("--json")) console.log(JSON.stringify(results, null, 1));
} finally { stopVite(); }
console.log([...notes, ...fails].join("\n"));
process.exit(fails.length ? 1 : 0);
