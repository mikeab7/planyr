import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  installPerfRecorder, __resetPerfRecorder, ENV_HIDDEN, ENV_VISIBLE, ENV_RESIZE, ENV_TIMER_LATE,
} from "../src/shared/telemetry/perfRecorder.js";
import { buildCapture, encodeCapture, assertCaptureClean, CAPTURE_NUMERIC_KEYS } from "../src/shared/telemetry/perfCapture.js";

/* NEW-1 / NEW-3 (2026-10-22, work-laptop report) — the recorder must be able to tell "the PAGE was not running" from "the APP
 * stalled". A real capture carried a 22.5 s frame hole and NO counter sample for 24 s with no long task over it, and the recorder
 * had no way to say which. These guards pin the marks that now answer it: visibility changes, window/pixel-ratio changes, the
 * counter timer firing late (visible vs hidden), and the DOM's own answer to "is the header there and on top?". */

function fakeWin({ visible = true } = {}) {
  const listeners = {};
  const docListeners = {};
  let clock = 1000;
  const doc = {
    visibilityState: visible ? "visible" : "hidden",
    addEventListener: (t, f) => { (docListeners[t] ||= []).push(f); },
    hasFocus: () => true,
    querySelectorAll: () => [],
    elementFromPoint: () => null,
    body: {},
  };
  const win = {
    document: doc, location: { search: "" }, devicePixelRatio: 2.68, innerWidth: 1913, innerHeight: 641,
    performance: { now: () => clock },
    navigator: { hardwareConcurrency: 16, deviceMemory: 32 },
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
    removeEventListener: () => {},
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    setInterval: (f, ms) => setInterval(f, ms), clearInterval,
  };
  return { win, doc, advance: (ms) => { clock += ms; }, emitDoc: (t) => (docListeners[t] || []).forEach((f) => f()), emitWin: (t) => (listeners[t] || []).forEach((f) => f()) };
}

describe("environment marks", () => {
  let w;
  beforeEach(() => { vi.useFakeTimers(); __resetPerfRecorder(); w = fakeWin(); installPerfRecorder(w.win, { counterMs: 2000, bootRunMs: 0 }); });
  afterEach(() => { __resetPerfRecorder(); vi.useRealTimers(); });

  it("records the page going hidden and visible again", () => {
    w.doc.visibilityState = "hidden"; w.emitDoc("visibilitychange");
    w.doc.visibilityState = "visible"; w.emitDoc("visibilitychange");
    expect(w.win.pfRec.env().map((m) => m[1])).toEqual([ENV_HIDDEN, ENV_VISIBLE]);
  });

  it("records a window / pixel-ratio change once, never the unchanged size", () => {
    vi.advanceTimersByTime(2000); w.advance(2000);               // first tick seeds the size silently
    expect(w.win.pfRec.env()).toEqual([]);
    w.emitWin("resize");                                          // same size → nothing
    expect(w.win.pfRec.env()).toEqual([]);
    w.win.devicePixelRatio = 2.15; w.win.innerWidth = 1600; w.emitWin("resize");
    const m = w.win.pfRec.env();
    expect(m).toHaveLength(1);
    expect(m[0].slice(1)).toEqual([ENV_RESIZE, 215, 1600]);
    w.emitWin("resize");                                          // a repeat of the same size is not a new event
    expect(w.win.pfRec.env()).toHaveLength(1);
  });

  it("flags the counter timer firing more than three periods late, and says whether the page was visible", () => {
    vi.advanceTimersByTime(2000); w.advance(2000);               // first fire: no previous fire, no mark
    w.advance(24250); vi.advanceTimersByTime(2000);              // the next fire arrives 24 s of clock later (a frozen / throttled page)
    const late = w.win.pfRec.env().filter((m) => m[1] === ENV_TIMER_LATE);
    expect(late).toHaveLength(1);
    expect(late[0][2]).toBeGreaterThan(6000);
    expect(late[0][3]).toBe(1);                                   // visible at fire — the page itself was not running
    w.doc.visibilityState = "hidden"; w.advance(24250); vi.advanceTimersByTime(2000);
    expect(w.win.pfRec.env().filter((m) => m[1] === ENV_TIMER_LATE)[1][3]).toBe(0); // a hidden tab's throttled timer
  });

  it("an on-schedule timer marks nothing (a positive control for the check above)", () => {
    for (let i = 0; i < 5; i++) { w.advance(2000); vi.advanceTimersByTime(2000); }
    expect(w.win.pfRec.env()).toEqual([]);
  });
});

describe("the capture carries them without widening the privacy surface", () => {
  const base = { kind: "manual", atMs: 1, atWall: 2, route: "site", build: "x", visibility: "visible", frameDeltas: [16.7], gaps: [], tasks: [], taskNames: [], counters: [], counterColumns: [] };
  it("keeps hdrH / hdrHit / hasFocus and the em series, and passes the allowlist", () => {
    const cap = buildCapture({ ...base, hdrH: 81, hdrHit: 1, hasFocus: 1, envMarks: [[884.2, ENV_HIDDEN, 0, 0], [22539.7, ENV_VISIBLE, 0, 0]] });
    expect(cap.hdrH).toBe(81); expect(cap.hdrHit).toBe(1); expect(cap.hasFocus).toBe(1);
    expect(cap.em).toEqual([[884, 1, 0, 0], [22540, 2, 0, 0]]);
    expect(assertCaptureClean(cap)).toEqual([]);
    for (const k of ["hdrH", "hdrHit", "hasFocus"]) expect(CAPTURE_NUMERIC_KEYS).toContain(k);
    expect(JSON.parse(encodeCapture(cap, { maxChars: 1750 }).text).em).toEqual(cap.em);
  });
  it("a quiet window carries no em key at all", () => {
    expect("em" in buildCapture({ ...base, envMarks: [] })).toBe(false);
  });
  it("a string smuggled into the marks is refused", () => {
    expect(assertCaptureClean({ v: 1, em: [[1, "https://example.com/plan/abc", 0, 0]] }).length).toBeGreaterThan(0);
  });
  it("the recorder reads the header through the DOM, not through app state", () => {
    const src = readFileSync(new URL("../src/shared/telemetry/perfRecorder.js", import.meta.url), "utf8");
    expect(src).toMatch(/querySelectorAll\("header"\)/);
    expect(src).toMatch(/elementFromPoint/);
  });
});
