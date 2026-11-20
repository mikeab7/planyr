/* perf-grading-freeze — B2319137 ×2/×3: grading must neither FREEZE the page nor keep the owner WAITING for the picture.
 *
 * Round ×2 (the freeze): a limit-mode switch and a zoom step held the tab for ~30 s; perfcap recorded nothing and the telemetry
 * showed almost no long TASKS. Round ×3 (V1950033 FAILED, owner 2026-10-29 ~2:20 PM CT): the freeze was gone, but the RESULT took
 * ~65 s on a fresh load (8 s that morning), 20–40 s after a mode switch, and never arrived after three zoom steps — the fix had
 * made the build wait for a painted frame between slices, and on his screen frames come slowly. So this instrument measures BOTH:
 *   (1) the stall — long-animation-frame entries + the largest gap between requestAnimationFrame callbacks, every frame under a
 *       CDP screenshot excluded (a screenshot forces its own full raster, so those frames are the instrument's), and
 *   (2) the TIME TO PICTURE — wall clock from the action (the page load, the mode click, the zoom step) to the moment the panel
 *       shows the new graded area for the mode asked, no card still "Reading the ground…", the earthwork priced, the proposed
 *       contours traced off THIS surface (contours.key === surfaceKey) and the cut/fill bands painted. Polled on a plain timer,
 *       never on rAF, so the slow-frame arm cannot slow the poll.
 * Real GradingController + GradingCanvas on the owner's real cross-dock and the real Chehaw ground (the grading harness), at his
 * screen size and device pixel ratio, contours + cut/fill + paper on. Scenarios: a fresh load in each mode at the parcel zoom; a
 * mode switch each way at the parcel zoom; three zoom steps at the building zoom in each mode.
 * TWO FRAME ARMS, because the failure lived in how often frames come: `normal` (headless frames, ~60 Hz) and `slow-frames`
 * (every requestAnimationFrame callback held back SLOW_RAF_MS — a heavy picture at a high pixel ratio, or a browser that is
 * producing frames slowly; the shape of the owner's machine). The stall budget is judged on the normal arm; time to picture
 * on BOTH.
 * KNOWN-GOOD ARMS: a deliberate 250 ms block in a page task must be seen by (1), and the slow-frame arm must really slow frames
 * (measured), or the run is VOID.
 *   node ui-audit/perf-grading-freeze.mjs [--budget=<ms>] [--arm=normal|slow] [--json] [--profile]   (starts its own vite on :5199) */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5199, BASE = `http://localhost:${PORT}`;
const EXEC = process.env.PW_CHROME || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const BUDGET = +arg("budget", 50);          // PR #2375: nothing may block past ~50 ms
const SHOT_BUDGET = 2000;                    // a screenshot must come back in this — the owner's hit timed out at ~30 s
const LOAD_BUDGET = 10000, STEP_BUDGET = 5000;   // the owner's bar: the picture back in ~10 s on a load, ~5 s after a switch / zoom
const SLOW_RAF_MS = 150;                     // the slow-frame arm: every frame held back this long (≈ 6 fps)
const ARMS = arg("arm", "") ? [arg("arm", "")] : ["normal", "slow"];
const fails = [], notes = [];
const check = (name, ok, extra = "") => { (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore", detached: true });
const stopVite = () => { try { process.kill(-vite.pid); } catch { try { vite.kill(); } catch {} } };

// "the picture is back" — evaluated in the page on a plain timer (never rAF)
const READY = (want) => {
  const H = window.__harness; const s = H && H.gradeSurface, m = H && H.model;
  if (!s || !s.grid || !s.grid.limit || !m) return false;
  if (s.grid.limit.mode !== want || !m.limit || m.limit.mode !== want || m.limit.areaAc == null) return false;
  const line = document.querySelector("[data-graded-area-line]");
  if (!line || !(want === "boundary" ? /property line/.test(line.textContent) : /limit (auto|edited)/.test(line.textContent))) return false;
  const ew = document.querySelector("[data-grading-earthwork]");
  if (!ew || ew.getAttribute("data-grading-earthwork") === "pending") return false;
  if (/Reading the ground/.test((document.getElementById("panel") || document.body).textContent)) return false;
  if (!m.contours || m.contours.key !== s.surfaceKey || !document.querySelector('[data-layer="contours"] path')) return false;
  if (!document.querySelector("[data-band-tint]")) return false;
  return true;
};
const waitReady = async (page, want, timeout = 180000) => {
  const ok = await page.waitForFunction(READY, want, { timeout, polling: 50 }).then(() => true, () => false);
  return ok;
};

try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await sleep(300); }
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const open = async (arm, mode, zoom) => {
    const ctx = await browser.newContext({ viewport: { width: 1913, height: 1000 }, deviceScaleFactor: 2.15 });
    await ctx.addInitScript((slowMs) => {
      if (slowMs > 0) {
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (cb) => raf(() => setTimeout(() => raf(cb), slowMs));
      }
      window.__lf = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lf.push({ t: e.startTime, d: e.duration, s: (e.scripts || []).map((x) => `${x.invoker}${x.sourceFunctionName ? "/" + x.sourceFunctionName : ""} ${Math.round(x.duration)}ms`).join(" | ") }); }).observe({ type: "long-animation-frame", buffered: true });
      window.__gaps = []; let last = 0; const tick = (t) => { if (last && t - last > 34) window.__gaps.push([last, t]); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    }, arm === "slow" ? SLOW_RAF_MS : 0);
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    const t0 = Date.now();
    await page.goto(`${BASE}/ui-audit/harness/grading-harness.html?owner=1&buildable=0&contours=1&zoom=${zoom}&mode=${mode}`);
    await assertMeasurable(page, "perf-grading-freeze");
    await page.waitForFunction(() => window.__ready, null, { timeout: 60000, polling: 50 });
    const ok = await waitReady(page, mode);
    return { ctx, page, errs, loadMs: ok ? Date.now() - t0 : null };
  };
  const PROFILE = process.argv.includes("--profile");
  const measure = async (page, label, act, want, budgetMs) => {
    const pStart = await page.evaluate(() => { window.__lf.length = 0; window.__gaps.length = 0; return performance.now(); });
    let cdp = null;
    if (PROFILE) { cdp = await page.context().newCDPSession(page); await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start"); }
    const t0 = Date.now();
    await act();
    const ok = await waitReady(page, want);
    const ttp = ok ? Date.now() - t0 : null;
    // the owner's own probe, AFTER the picture is timed (a screenshot's raster would slow what it measures)
    const shots = [];
    const p0 = await page.evaluate(() => performance.now());
    const s0 = Date.now();
    await page.screenshot({ timeout: 60000 }).catch(() => {});
    const shotMs = Date.now() - s0;
    shots.push([p0, await page.evaluate(() => performance.now())]);
    if (cdp) {
      const { profile } = await cdp.send("Profiler.stop");
      const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n])), cnt = new Map();
      for (const id of profile.samples) cnt.set(id, (cnt.get(id) || 0) + 1);
      for (const [id, c] of cnt) { const n = byId.get(id); const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop().split("?")[0]}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + c); }
      notes.push(`  · PROFILE ${label}: ` + [...self].filter(([k]) => !/\(idle\)|\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, c]) => `${k}=${(c * 0.2).toFixed(0)}ms`).join(" · "));
    }
    const r0 = await page.evaluate(() => ({ lf: window.__lf.slice(), gaps: window.__gaps.slice() }));
    const overlapsShot = (a, b) => shots.some(([s, e]) => a < e + 20 && b > s - 20);
    const lf = r0.lf.filter((e) => e.t >= pStart && !overlapsShot(e.t, e.t + e.d));
    const gap = Math.max(0, ...r0.gaps.filter(([a, b]) => a >= pStart && !overlapsShot(a, b)).map(([a, b]) => b - a));
    const maxLf = lf.reduce((m, e) => (e.d > m.d ? e : m), { d: 0 });
    return { label, ttp, budgetMs, shotMs, maxFrameMs: Math.round(maxLf.d), maxFrame: maxLf, rafGapMs: Math.round(gap) };
  };
  const results = [];
  for (const arm of ARMS) {
    // ---- known-good arms: the frame instrument sees a block; the slow arm really slows frames
    {
      const { ctx, page } = await open(arm, "layout", "site");
      await page.evaluate(() => { window.__lf.length = 0; window.__gaps.length = 0; });
      await page.evaluate(() => { setTimeout(() => { const t = performance.now(); while (performance.now() - t < 250) { /* block */ } }, 0); });
      await page.waitForTimeout(1500);
      const kg = await page.evaluate(() => ({ lf: Math.max(0, ...window.__lf.map((e) => e.d)) }));
      const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
      if (!(kg.lf >= 240)) fails.push(`✗ VOID (${arm}) — the instrument did not see a known 250 ms block (frame ${Math.round(kg.lf)} ms)`);
      else if (arm === "slow" && !(fps < 10)) fails.push(`✗ VOID (slow) — the slow-frame arm did not slow frames (${fps.toFixed(1)} fps)`);
      else if (arm === "normal" && !(fps > 30)) fails.push(`✗ VOID (normal) — headless frames are not at full rate (${fps.toFixed(1)} fps)`);
      else notes.push(`  · known-good (${arm}): a 250 ms block reads ${Math.round(kg.lf)} ms · frames at ${fps.toFixed(1)} fps`);
      await ctx.close();
    }
    if (fails.length) break;
    // ---- fresh load in each mode at the parcel zoom
    for (const mode of ["layout", "boundary"]) {
      const { ctx, loadMs } = await open(arm, mode, "site");
      results.push({ arm, label: `fresh load, ${mode === "layout" ? "Around the layout" : "To the boundary"}, parcel zoom`, ttp: loadMs, budgetMs: LOAD_BUDGET, load: true });
      await ctx.close();
    }
    // ---- mode switch each way at the parcel zoom
    {
      const { ctx, page } = await open(arm, "layout", "site");
      results.push({ arm, ...await measure(page, "parcel zoom: Around the layout → To the boundary", () => page.evaluate(() => window.__harness.setLimitMode("boundary")), "boundary", STEP_BUDGET) });
      results.push({ arm, ...await measure(page, "parcel zoom: To the boundary → Around the layout", () => page.evaluate(() => window.__harness.setLimitMode("layout")), "layout", STEP_BUDGET) });
      await ctx.close();
    }
    // ---- three zoom steps at the building zoom, each mode
    for (const mode of ["boundary", "layout"]) {
      const { ctx, page } = await open(arm, mode, "bldg");
      for (let k = 1; k <= 3; k++) results.push({ arm, ...await measure(page, `building zoom (${mode}): zoom step ${k}`, () => page.evaluate(() => window.__harness.zoomBy(1.4)), mode, STEP_BUDGET) });
      await ctx.close();
    }
  }
  for (const r of results) {
    const ttpOk = r.ttp != null && r.ttp <= r.budgetMs;
    if (r.load) { check(`[${r.arm}] ${r.label}: picture back in ${r.ttp == null ? "NEVER (180 s)" : (r.ttp / 1000).toFixed(1) + " s"} (≤ ${r.budgetMs / 1000} s)`, ttpOk); continue; }
    const stallOk = r.arm !== "normal" || (r.maxFrameMs < BUDGET && r.rafGapMs < Math.max(BUDGET * 2, 120));
    check(`[${r.arm}] ${r.label}: picture back in ${r.ttp == null ? "NEVER (180 s)" : (r.ttp / 1000).toFixed(1) + " s"} (≤ ${r.budgetMs / 1000} s) · longest frame ${r.maxFrameMs} ms · largest rAF gap ${r.rafGapMs} ms · screenshot ${r.shotMs} ms`,
      ttpOk && stallOk && r.shotMs < SHOT_BUDGET,
      r.arm === "normal" && r.maxFrameMs >= BUDGET ? `[${r.maxFrame.s || "no script attributed — render/paint"}]` : "");
  }
  await browser.close();
  if (process.argv.includes("--json")) console.log(JSON.stringify(results, null, 1));
} finally { stopVite(); }
console.log([...notes, ...fails].join("\n"));
process.exit(fails.length ? 1 : 0);
