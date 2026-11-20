// NEW-1 (owner 2026-11-04) — the "Regrading…" banner. The owner's spec, as assertions:
//   • a rebuild that runs past ~300 ms mounts the banner, and its bar RISES with the real work;
//   • a rebuild that finishes inside ~300 ms NEVER mounts it (no flash); once shown it stays >= ~400 ms, then fades;
//   • the bar is the work's own fractions (the chunked generators' yields), never a timer; a step that cannot say is indeterminate;
//   • progress reaches the screen at most ~10 times a second; no rAF / interval of its own;
//   • owner-only: the banner is mounted only behind the grading gate (grOn), and the only code that reports into the store is the
//     off-render grading build — so grading off ⇒ nothing is ever reported ⇒ the banner can never show.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as R from "../src/workspaces/site-planner/lib/regradeProgress.js";
import { buildSurfaceOffRender } from "../src/workspaces/site-planner/lib/useGradeSurface.js";
import { runChunked } from "../src/workspaces/site-planner/lib/runChunked.js";
import { surfaceGrid, surfaceGridSteps, buildProposedSurface, buildProposedSurfaceSteps, drainSteps } from "../src/workspaces/site-planner/lib/proposedSurface.js";

let T = 0;
const at = (ms) => { T = ms; vi.setSystemTime(ms); };
const adv = (ms) => { T += ms; vi.advanceTimersByTime(ms); };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); T = 1_000_000; R.__setClockForTest(() => Date.now()); R.__resetForTest(); });
afterEach(() => { R.__resetForTest(); R.__setClockForTest(null); vi.useRealTimers(); });

/* a driver whose views we record, on the fake clock */
function watch() {
  const views = [];
  const d = R.createBannerDriver({ onView: (v) => views.push({ ...v, t: Date.now() }) });
  return { views, d, phases: () => [...new Set(views.map((v) => v.phase))] };
}

describe("bannerStep — the pure machine", () => {
  const S = R.IDLE;
  it("opens as pending, shows only once ACTIVE work has run SHOW_AFTER_MS", () => {
    let s = R.bannerStep(S, { active: true, open: true, now: 0 });
    expect(s.phase).toBe("pending");
    s = R.bannerStep(s, { active: true, open: true, now: R.SHOW_AFTER_MS - 1 });
    expect(s.phase).toBe("pending");
    s = R.bannerStep(s, { active: true, open: true, now: R.SHOW_AFTER_MS });
    expect(s.phase).toBe("shown");
  });
  it("a rebuild that ends under the threshold goes back to idle without ever being shown", () => {
    let s = R.bannerStep(S, { active: true, open: true, now: 0 });
    s = R.bannerStep(s, { active: false, open: false, now: 250 });
    expect(s.phase).toBe("idle");
  });
  it("once shown it stays at least MIN_VISIBLE_MS, then fades for FADE_MS, then is gone", () => {
    let s = R.bannerStep(S, { active: true, open: true, now: 0 });
    s = R.bannerStep(s, { active: true, open: true, now: 310 });           // shown at 310
    s = R.bannerStep(s, { active: false, open: false, now: 310 + R.MIN_VISIBLE_MS - 1 });
    expect(s.phase).toBe("shown");
    s = R.bannerStep(s, { active: false, open: false, now: 310 + R.MIN_VISIBLE_MS });
    expect(s.phase).toBe("leaving");
    s = R.bannerStep(s, { active: false, open: false, now: 310 + R.MIN_VISIBLE_MS + R.FADE_MS });
    expect(s.phase).toBe("idle");
  });
  it("a new rebuild while it fades brings it straight back", () => {
    let s = { phase: "leaving", since: 0, shownAt: 0, until: 5000 };
    s = R.bannerStep(s, { active: true, open: true, now: 4800 });
    expect(s.phase).toBe("shown");
  });
  it("the settle gap between two stages (open but not active) neither shows nor hides it", () => {
    let s = R.bannerStep(S, { active: true, open: true, now: 0 });
    s = R.bannerStep(s, { active: false, open: true, now: 400 });
    expect(s.phase).toBe("pending");                                        // old time, but nothing running: not shown yet
    s = R.bannerStep(s, { active: true, open: true, now: 420 });
    expect(s.phase).toBe("shown");
  });
});

describe("the store + driver — red-proof of the owner's spec", () => {
  it("OVER the threshold: mounts, with progress RISING, stays >= MIN_VISIBLE, fades out", () => {
    const { views, phases, d } = watch();
    const tok = R.begin("surface");
    for (let i = 1; i <= 10; i++) { adv(60); R.progress("surface", tok, i / 10); }   // 600 ms of real work
    expect(phases()).toContain("shown");
    const shown = views.filter((v) => v.phase === "shown");
    expect(shown.length).toBeGreaterThan(1);
    for (let i = 1; i < shown.length; i++) expect(shown[i].frac).toBeGreaterThanOrEqual(shown[i - 1].frac);   // rising, never back
    expect(shown[shown.length - 1].frac).toBeGreaterThan(shown[0].frac);
    const shownAt = views.find((v) => v.phase === "shown").t;
    R.end("surface", tok);
    adv(R.SETTLE_MS + 5);
    const stillShown = views[views.length - 1];
    expect(["shown", "leaving"]).toContain(stillShown.phase);
    adv(R.MIN_VISIBLE_MS + R.FADE_MS + 50);
    expect(views.find((v) => v.phase === "leaving").t - shownAt).toBeGreaterThanOrEqual(R.MIN_VISIBLE_MS);
    expect(views[views.length - 1].phase).toBe("idle");
    d.stop();
  });
  it("work finished but the banner still inside its minimum time: the bar reads FULL, never back to empty", () => {
    const { views, d } = watch();
    const tok = R.begin("surface");
    for (let i = 1; i <= 8; i++) { adv(60); R.progress("surface", tok, i / 8); }
    R.end("surface", tok);
    adv(R.SETTLE_MS + 20);                                                   // the session has closed; the banner is held for MIN_VISIBLE
    const held = views.filter((v) => v.phase === "shown");
    expect(held[held.length - 1].frac).toBe(1);
    for (const v of held.slice(-3)) expect(v.frac).toBeGreaterThanOrEqual(0.5);
    for (let i = 1; i < held.length; i++) expect(held[i].frac).toBeGreaterThanOrEqual(held[i - 1].frac);
    d.stop();
  });
  it("UNDER the threshold: the banner is never mounted (no flash), even with a stage gap", () => {
    const { phases, d } = watch();
    const t1 = R.begin("surface"); adv(120); R.progress("surface", t1, 1); R.end("surface", t1);
    adv(30);                                                                 // the next stage starts a frame later
    const t2 = R.begin("contours"); adv(100); R.end("contours", t2);
    adv(2000);
    expect(phases()).not.toContain("shown");
    expect(phases()).not.toContain("leaving");
    d.stop();
  });
  it("two stages that TOGETHER run past the threshold show it once, and the bar never drops when the second stage begins", () => {
    R.expectStages({ contours: true });
    const { views, d } = watch();
    const t1 = R.begin("surface");
    for (let i = 1; i <= 5; i++) { adv(60); R.progress("surface", t1, i / 5); }
    R.end("surface", t1);
    adv(40);
    const t2 = R.begin("contours"); R.progress("contours", t2, null);       // a worker trace: cannot say how far along
    adv(300);
    const shown = views.filter((v) => v.phase === "shown");
    expect(shown.length).toBeGreaterThan(0);
    for (let i = 1; i < shown.length; i++) expect(shown[i].frac).toBeGreaterThanOrEqual(shown[i - 1].frac);
    expect(shown[shown.length - 1].indeterminate).toBe(true);                // only indeterminate while every running step is
    expect(shown[shown.length - 1].frac).toBeGreaterThanOrEqual(0.5);        // surface (3 of 5 expected weight) already counted
    d.stop();
  });
  it("the fraction is the work's own: weights over the EXPECTED stages, finished = 1, nothing invented", () => {
    R.expectStages({ contours: true, band: true });          // 3 + 2 + 1
    const a = R.begin("surface"); R.progress("surface", a, 0.5);
    expect(R.getProgress().frac).toBeCloseTo((3 * 0.5) / 6, 5);
    R.end("surface", a);
    expect(R.getProgress().frac).toBeCloseTo(3 / 6, 5);
    const b = R.begin("contours"); R.progress("contours", b, null);
    expect(R.getProgress()).toEqual({ frac: 0.5, indeterminate: true });
  });
  it("the bar never goes backwards inside one rebuild — even when the build is restarted by a newer edit", () => {
    const a = R.begin("surface"); R.progress("surface", a, 0.8);
    const before = R.getProgress().frac;
    expect(before).toBeCloseTo(0.8, 5);
    R.begin("surface");                                                      // an edit supersedes it: the new build starts from 0
    expect(R.getProgress().frac).toBeGreaterThanOrEqual(before);
  });
  it("a superseded run's late progress / end is ignored (only the newest token counts)", () => {
    const old = R.begin("surface");
    const cur = R.begin("surface");
    R.progress("surface", old, 0.9);
    expect(R.getProgress().frac).toBe(0);
    R.end("surface", old);
    expect(R.isActive()).toBe(true);
    R.end("surface", cur);
    expect(R.isActive()).toBe(false);
  });
  it("progress reaches subscribers at most every PROGRESS_THROTTLE_MS (~10 a second) — and the LAST value always lands", () => {
    const tok = R.begin("surface");
    let n = 0; const un = R.subscribe(() => { n++; });
    for (let i = 1; i <= 1000; i++) { adv(1); R.progress("surface", tok, i / 1000); }   // 1000 reports in 1 s
    expect(n).toBeLessThanOrEqual(11);
    adv(R.PROGRESS_THROTTLE_MS + 5);
    expect(R.getProgress().frac).toBeCloseTo(1 * 3 / 3, 5);
    un();
  });
  it("uses no rAF and no interval — only one-shot timers", () => {
    const src = readFileSync("src/workspaces/site-planner/lib/regradeProgress.js", "utf8") + readFileSync("src/workspaces/site-planner/components/RegradeBanner.jsx", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/requestAnimationFrame|setInterval/);
  });
});

describe("REAL progress — the engine's own column fractions drive the bar (not a timer)", () => {
  const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const inputs = {
    els: [{ id: "b", type: "building", ring: rect(0, 0, 400, 200), padElevFt: 100 }, { id: "c", type: "paving", ring: rect(0, 200, 400, 120), dockStack: { x: 200, y: 100 }, hostId: "b" }],
    ffeFt: null, dockDropFt: 4, existAt: (p) => 98 + 0.01 * p.x, parcelRings: [rect(-300, -300, 1000, 900)], pondRings: [], easementRings: [],
    opts: { existKey: "t", maxCells: 4000 }, grading: { pavementSlopePct: 1.5, slopeRatio: 2, shoulderFt: 5, setbackRings: [rect(-250, -250, 900, 800)] },
  };
  const limitInputs = { ...inputs, grading: { ...inputs.grading, limit: { mode: "layout", shoulderFt: 5, cornerRadiusFt: 30, aisleFt: 24, maxPavementSlopePct: 5, maxCutFillFt: 12 } } };
  for (const [name, inp] of [["the lattice (round-2 engine)", inputs], ["inside a grading limit (round 4+)", limitInputs]]) {
    it(`${name}: buildSurfaceOffRender reports rising fractions in [0,1] and starts once`, async () => {
      vi.useRealTimers();
      const fr = []; let starts = 0;
      const s = await buildSurfaceOffRender(inp, { onStart: () => { starts++; }, onProgress: (f) => fr.push(f) });
      expect(s && s.grid && s.grid.cells.length).toBeGreaterThan(0);
      expect(starts).toBe(1);
      expect(fr.length).toBeGreaterThan(5);
      expect(fr.every((f) => f >= 0 && f <= 1)).toBe(true);
      expect(Math.max(...fr)).toBeGreaterThan(0.5);
      // within one phase the fractions only rise; the store keeps the bar from ever going back across phases
      const tok = R.begin("surface"); let prev = 0;
      for (const f of fr) { R.progress("surface", tok, f); const g = R.getProgress().frac; expect(g).toBeGreaterThanOrEqual(prev); prev = g; }
    });
    it(`${name}: yielding a fraction changes nothing about the surface (synchronous drain is byte-identical)`, () => {
      const sync = buildProposedSurface(inp);
      const stepped = drainSteps(buildProposedSurfaceSteps(inp));
      expect(JSON.stringify(stepped.grid.cells)).toBe(JSON.stringify(sync.grid.cells));
    });
  }
  it("a build held by a drag in flight is NOT a rebuild: onStart waits for the release", async () => {
    vi.useRealTimers();
    let dragging = true, starts = 0;
    const p = buildSurfaceOffRender(inputs, { isDragging: () => dragging, sleep: (ms) => new Promise((r) => setTimeout(r, 1)), onStart: () => { starts++; } });
    await new Promise((r) => setTimeout(r, 30));
    expect(starts).toBe(0);
    dragging = false;
    await p;
    expect(starts).toBe(1);
  });
  it("runChunked: a bare yield (every other generator in the app) reports nothing", async () => {
    const seen = [];
    await runChunked((function* () { yield; yield; yield 0.5; return 1; })(), { onProgress: (f) => seen.push(f), sliceMs: 0, frameGapMs: 0 });
    expect(seen).toEqual([0.5]);
  });
});

describe("wiring — owner-only, and every stage reports", () => {
  const sp = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");
  const gc = readFileSync("src/workspaces/site-planner/components/GradingController.jsx", "utf8");
  const ug = readFileSync("src/workspaces/site-planner/lib/useGradeSurface.js", "utf8");
  it("the banner is mounted only behind the grading gate, and takes no presses", () => {
    expect(sp).toMatch(/\{grOn && <RegradeBanner /);
    const bn = readFileSync("src/workspaces/site-planner/components/RegradeBanner.jsx", "utf8");
    expect(bn.match(/pointerEvents: "none"/g).length).toBeGreaterThanOrEqual(2);
    expect(bn).not.toMatch(/onClick|onPointer|onMouse/);
  });
  it("only the off-render grading build, the contour / band traces and the floor search report into the store", () => {
    expect(ug).toMatch(/regrade\.begin\("surface"\)/);
    for (const j of ["contours", "band", "ffe"]) expect(gc).toContain(`regrade.begin("${j}")`);
    // every begin has a matching end on the success and failure paths
    for (const j of ["contours", "band"]) expect((gc.match(new RegExp(`regrade\\.end\\("${j}"`, "g")) || []).length).toBeGreaterThanOrEqual(2);
    expect(gc).toMatch(/regrade\.end\("ffe", rgTok, \{ ok: !stale\(\) && !err \}\)/);   // one end for both outcomes (ok says which)
    expect(ug).toMatch(/regrade\.end\("surface"/);
    expect(ug).toMatch(/regrade\.cancel\("surface"/);
  });
  it("the contour lattice hands its own fraction to the bar", () => {
    expect(gc).toMatch(/onProgress: \(f\) => regrade\.progress\("contours"/);
  });
});
