import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installPerfRecorder, __resetPerfRecorder } from "../src/shared/telemetry/perfRecorder.js";
import { createTrigger, feedFrame, feedFreeze, TRIGGER_DEFAULTS } from "../src/shared/telemetry/perfTrigger.js";
import { buildCapture, assertCaptureClean, FREEZE_VIA_VOCAB } from "../src/shared/telemetry/perfCapture.js";

/* B2319137 ×2 — the owner's tab froze for ~30 s on a grading mode switch (2026-10-29, tab 5abb4ba7: an interaction that
 * waited 31 s for its next paint, 135 ms of long tasks in total) and the always-on recorder wrote NOTHING. Two reasons, both
 * reproduced here before the fix: the steady-state trigger drops any frame delta past `maxFrameMs` as "not a frame", and the
 * boot judgment only looks at the first ten seconds. The freeze judgment fires on ONE frame that never came, or ONE long
 * frame entry, of a second or more — at any time. */

describe("feedFreeze — the pure judgment", () => {
  it("THE RED ARM: the steady-state trigger alone never fires on a 30 s frame, at any point in the session", () => {
    const s = createTrigger({ baselineMinFrames: 10, baselineMaxFrames: 300 });
    let t = 6_000;
    for (let i = 0; i < 400; i++) { t += 16; feedFrame(s, t, 16); }   // a sealed, healthy baseline
    expect(s.baseline).not.toBeNull();
    t += 30_000;
    expect(feedFrame(s, t, 30_000)).toBe(false);
    expect(s.fires).toBe(0);
  });

  it("fires on one freeze at the bar, not a hair under it, before or after the baseline", () => {
    const s = createTrigger();
    expect(feedFreeze(s, 20_000, TRIGGER_DEFAULTS.freezeMs - 1, "frame")).toBe(false);
    expect(feedFreeze(s, 20_000, TRIGGER_DEFAULTS.freezeMs, "frame")).toBe(true);
    expect(s.lastVerdict).toEqual({ source: "freeze", via: "frame", freezeMs: TRIGGER_DEFAULTS.freezeMs });
  });

  it("shares the page's auto-capture budget and cooldown", () => {
    const s = createTrigger();
    expect(feedFreeze(s, 10_000, 30_000, "task")).toBe(true);
    expect(feedFreeze(s, 20_000, 30_000, "task")).toBe(false);            // inside the cooldown
    let t = 10_000;
    for (let i = 1; i < TRIGGER_DEFAULTS.maxAuto; i++) { t += TRIGGER_DEFAULTS.cooldownMs; expect(feedFreeze(s, t, 5_000, "task")).toBe(true); }
    t += TRIGGER_DEFAULTS.cooldownMs;
    expect(feedFreeze(s, t, 5_000, "task")).toBe(false);                   // the allowance is spent
  });

  it("the verdict's `via` is on the capture's fixed vocabulary, and a freeze capture passes the allowlist", () => {
    for (const via of ["frame", "task"]) {
      const s = createTrigger(); feedFreeze(s, 1, 2_000, via);
      expect(FREEZE_VIA_VOCAB).toContain(s.lastVerdict.via);
    }
    const cap = buildCapture({ kind: "auto", atMs: 1, atWall: 2, route: "site", build: "x", visibility: "visible", frameDeltas: [16.7], gaps: [], tasks: [], taskNames: [], counters: [], counterColumns: [], freezeMs: 30_000, freezeVia: "frame" });
    expect(cap.freezeMs).toBe(30_000);
    expect(cap.freezeVia).toBe("frame");
    expect(assertCaptureClean(cap)).toEqual([]);
    expect(assertCaptureClean({ ...cap, freezeVia: "anything" })).not.toEqual([]);
  });
});

/* The whole recorder, on a fake window whose clock, animation frames and long-frame observer the test drives. */
function fakeWin() {
  let clock = 1000;
  const listeners = {}, docListeners = {};
  let raf = null, observer = null;
  const doc = { visibilityState: "visible", addEventListener: (t, f) => { (docListeners[t] ||= []).push(f); }, hasFocus: () => true, querySelectorAll: () => [], elementFromPoint: () => null };
  class PO { constructor(cb) { this.cb = cb; } observe(o) { if (o.type === "long-animation-frame") observer = this; } }
  const win = {
    document: doc, location: { search: "" }, devicePixelRatio: 2.15, innerWidth: 1913, innerHeight: 1000,
    performance: { now: () => clock }, navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, removeEventListener() {},
    requestAnimationFrame: (cb) => { raf = cb; return 1; }, cancelAnimationFrame() { raf = null; },
    setInterval: () => 0, clearInterval() {},
    PerformanceObserver: PO,
  };
  return {
    win, doc,
    advance: (ms) => { clock += ms; },
    input: () => (listeners.pointermove || []).forEach((f) => f()),
    frame: () => { const cb = raf; raf = null; if (cb) cb(clock); },
    loaf: (startTime, duration) => observer && observer.cb({ getEntries: () => [{ startTime, duration, blockingDuration: 0, scripts: [] }] }),
    hide: () => { doc.visibilityState = "hidden"; (docListeners.visibilitychange || []).forEach((f) => f()); },
    show: () => { doc.visibilityState = "visible"; (docListeners.visibilitychange || []).forEach((f) => f()); },
  };
}

describe("the recorder writes a capture when a synthetic 30 s stall is injected", () => {
  let w;
  beforeEach(() => { __resetPerfRecorder(); w = fakeWin(); installPerfRecorder(w.win, { bootRunMs: 0 }); w.advance(60_000); });
  afterEach(() => { __resetPerfRecorder(); });

  const interactThenStall = (stallMs) => {
    w.input(); w.frame();                                       // a gesture starts the frame loop
    for (let i = 0; i < 5; i++) { w.advance(16); w.input(); w.frame(); }
    w.advance(stallMs); w.input(); w.frame();                   // the next frame comes `stallMs` later: a starved render
  };

  it("a frame that never came for 30 s while the user was interacting → one auto capture, via 'frame'", () => {
    interactThenStall(30_000);
    const caps = w.win.pfRec.captures();
    expect(caps).toHaveLength(1);
    expect(caps[0].kind).toBe("auto");
    expect(w.win.pfRec.state().fires).toBe(1);
  });

  it("a positive control: the same gesture with no stall writes nothing", () => {
    interactThenStall(16);
    expect(w.win.pfRec.captures()).toHaveLength(0);
  });

  it("one 30 s long-animation-frame entry → one auto capture, via 'task' (a starved render grouped into one frame)", () => {
    w.loaf(61_000, 30_000);
    expect(w.win.pfRec.captures()).toHaveLength(1);
  });

  it("a hidden tab is not a freeze: the page going hidden ends the run, so the frame back starts a new one", () => {
    w.input(); w.frame(); w.advance(16); w.input(); w.frame();
    w.hide(); w.advance(30_000); w.show(); w.input(); w.frame();
    expect(w.win.pfRec.captures()).toHaveLength(0);
  });
});

/* B2319137 ×4 — the owner's tab (2026-10-30, Concept A, "To the boundary"): after one zoom click the page ran at ONE frame per
 * second — a requestAnimationFrame gap monitor read 15 consecutive gaps of ~1000 ms — and no capture was written. Two holes, both
 * reproduced here: the recorder stopped watching `idleStopMs` after the click (two slow frames in), and no judgment fires on a
 * RUN of slow frames (the sustain window needs 8 frames in 2 s; the freeze needs one frame of a full second). */
describe("B2319137 ×4 — a sustained run of ~1 s frames after ONE click writes a capture", () => {
  let w;
  beforeEach(() => { __resetPerfRecorder(); w = fakeWin(); installPerfRecorder(w.win, { bootRunMs: 0 }); w.advance(60_000); });
  afterEach(() => { __resetPerfRecorder(); });
  const clickThenSlow = (gapMs, n) => {
    w.input(); w.frame();                                       // ONE click starts the frame loop…
    for (let i = 0; i < n; i++) { w.advance(gapMs); w.frame(); }  // …and no further input: the page just crawls
  };
  it("15 gaps of 990 ms after one click → one auto capture, via 'sustained', carrying the run's length", () => {
    clickThenSlow(990, 15);
    const caps = w.win.pfRec.captures();
    expect(caps).toHaveLength(1);
    expect(caps[0].freezeVia).toBe("sustained");
    expect(caps[0].freezeMs).toBeGreaterThanOrEqual(3_000);
  });
  it("positive control: the same click with frames at 60 Hz writes nothing", () => {
    clickThenSlow(16, 15);
    expect(w.win.pfRec.captures()).toHaveLength(0);
  });
  it("two slow frames then fast ones is not a run (a hitch, not a crawl)", () => {
    w.input(); w.frame(); w.advance(600); w.frame(); w.advance(600); w.frame();
    for (let i = 0; i < 10; i++) { w.advance(16); w.input(); w.frame(); }
    expect(w.win.pfRec.captures()).toHaveLength(0);
  });
  it("the pure judgment: 'sustained' is in the capture vocabulary and the run resets on a fast frame", async () => {
    const { feedSlowRun } = await import("../src/shared/telemetry/perfTrigger.js");
    const s = createTrigger();
    expect(feedSlowRun(s, 1000, 990)).toBe(false); expect(feedSlowRun(s, 2000, 990)).toBe(false);
    expect(feedSlowRun(s, 2016, 16)).toBe(false); expect(s.slowRunN).toBe(0);
    feedSlowRun(s, 3000, 990); feedSlowRun(s, 4000, 990);
    expect(feedSlowRun(s, 5000, 1100)).toBe(true);
    expect(FREEZE_VIA_VOCAB).toContain(s.lastVerdict.via);
    expect(s.lastVerdict.via).toBe("sustained");
  });
});
