import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installPerfRecorder, __resetPerfRecorder, capture } from "../src/shared/telemetry/perfRecorder.js";
import { perfCaptureRefusal, __resetPerfHandle } from "../src/shared/telemetry/perfRecorderHandle.js";
import { limitLabel } from "../src/app/HelpReportControl.jsx";

/* NEW-4 (2026-10-22) — the manual-capture budget is a ROLLING window, not a page-load lifetime. Opening the ? panel arms a manual
 * capture; six openings used to spend all six for good, after which "Something was slow just now" said "try again in a moment" and
 * never recovered without a reload. */
function fakeWin() {
  let clock = 1000;
  const win = {
    document: { visibilityState: "visible", addEventListener() {}, hasFocus: () => true, querySelectorAll: () => [], elementFromPoint: () => null },
    location: { search: "" }, devicePixelRatio: 2.68, innerWidth: 1913, innerHeight: 641,
    performance: { now: () => clock }, navigator: { hardwareConcurrency: 16, deviceMemory: 32 },
    addEventListener() {}, removeEventListener() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setInterval: () => 0, clearInterval() {},
  };
  return { win, advance: (ms) => { clock += ms; } };
}

describe("manual capture budget", () => {
  let w;
  beforeEach(() => { __resetPerfRecorder(); __resetPerfHandle(); w = fakeWin(); installPerfRecorder(w.win, { bootRunMs: 0 }); });
  afterEach(() => { __resetPerfRecorder(); __resetPerfHandle(); });

  it("allows six, refuses the seventh with a stated reason and a wait", () => {
    for (let i = 0; i < 6; i++) { expect(capture("manual")).toBe(true); w.advance(1000); }
    expect(capture("manual")).toBe(false);
    const r = perfCaptureRefusal();
    expect(r.reason).toBe("budget");
    expect(r.retryInMs).toBeGreaterThan(500_000);
    expect(r.retryInMs).toBeLessThanOrEqual(600_000);
  });

  it("refills one slot at a time once the window passes — no reload needed", () => {
    for (let i = 0; i < 6; i++) { capture("manual"); w.advance(1000); }
    expect(capture("manual")).toBe(false);
    w.advance(600_000);
    expect(capture("manual")).toBe(true);
    expect(perfCaptureRefusal()).toBeNull();               // a taken capture clears the refusal
  });

  it("the total ceiling (9 rows) is rolling too", () => {
    for (let i = 0; i < 9; i++) { w.advance(700_000); capture("auto"); }   // each older than the window by the next
    expect(capture("auto")).toBe(true);
    for (let i = 0; i < 9; i++) capture("auto");
    expect(capture("auto")).toBe(false);
  });

  it("the wording is the limit, never 'try again in a moment'", () => {
    const t = limitLabel({ reason: "budget", retryInMs: 240_000 });
    expect(t).toMatch(/limit/i);
    expect(t).toMatch(/4 min/);
    expect(t).not.toMatch(/moment/i);
  });
});
