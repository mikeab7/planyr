// NEW-2 (2026-10-15) — the crop dialog's self-capturing diagnostics. Pure verdicts + the watchdog wiring with fake timers.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { openVerdict, describeTarget, isDeadRun, armCropWatchdog, DEAD_RUN } from "../src/shared/sitePlans/lib/cropDiag.js";

const GOOD = { imgW: 1000, imgH: 800, view: { scale: 0.2, tx: 10, ty: 20 }, viewW: 900, viewH: 600, srcReady: true };

describe("openVerdict", () => {
  it("a normal open reports nothing (known-good arm)", () => { expect(openVerdict(GOOD)).toEqual([]); });
  it("names each way an open can be unusable", () => {
    expect(openVerdict({ ...GOOD, imgW: undefined })).toContain("image-size-unknown");
    expect(openVerdict({ ...GOOD, imgH: 0 })).toContain("image-size-unknown");
    expect(openVerdict({ ...GOOD, view: { scale: NaN, tx: 0, ty: 0 } })).toContain("view-not-finite");
    expect(openVerdict({ ...GOOD, view: null })).toContain("view-not-finite");
    expect(openVerdict({ ...GOOD, view: { scale: 0, tx: 0, ty: 0 } })).toContain("view-scale-zero");
    expect(openVerdict({ ...GOOD, viewW: 0 })).toContain("viewport-empty");
    expect(openVerdict({ ...GOOD, srcReady: false })).toContain("image-not-decoded");
    expect(openVerdict({ ...GOOD, srcReady: null })).toEqual([]); // unknown is not a verdict
  });
});

describe("isDeadRun", () => {
  it("needs DEAD_RUN unanswered presses at the END of the list", () => {
    expect(isDeadRun([false, false])).toBe(false);
    expect(isDeadRun([false, false, false])).toBe(true);
    expect(isDeadRun([false, false, false, true])).toBe(false);
    expect(isDeadRun([true, false, false, false])).toBe(true);
    expect(DEAD_RUN).toBe(3);
  });
});

describe("describeTarget", () => {
  it("is content-free: tag, testid, role, first class, z-index", () => {
    const el = { tagName: "DIV", getAttribute: (k) => ({ "data-testid": "x", role: "dialog", class: "a b" }[k] || null) };
    expect(describeTarget(el)).toBe("div#x[dialog].a");
    expect(describeTarget(null)).toBe("none");
  });
});

function fakeEnv() {
  const listeners = {}; const rootL = {}; const sent = [];
  const win = { innerWidth: 1000, innerHeight: 700, addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; } };
  const root = { contains: (t) => t && t.inTool, addEventListener: (t, f) => { rootL[t] = f; }, removeEventListener: (t) => { delete rootL[t]; } };
  const doc = { visibilityState: "visible" };
  return { win, root, doc, listeners, rootL, sent, report: (k, m, x) => sent.push({ k, m, x }) };
}

describe("armCropWatchdog", () => {
  it("reports every open, flagging a bad one", () => {
    const e = fakeEnv();
    armCropWatchdog({ root: e.root, get: () => ({ ...GOOD, imgW: 0, rev: 0, renders: 1 }), env: { window: e.win, document: e.doc, report: e.report } })();
    expect(e.sent[0].k).toBe("crop-dialog-open");
    expect(e.sent[0].x.bad).toContain("image-size-unknown");
  });
  it("three unanswered button presses in a row = crop-pointer-dead; a click or a state change answers a press", () => {
    vi.useFakeTimers();
    const e = fakeEnv(); let rev = 0;
    const off = armCropWatchdog({ root: e.root, get: () => ({ ...GOOD, rev, renders: 1 }), env: { window: e.win, document: e.doc, report: e.report } });
    const btn = { inTool: true, tagName: "BUTTON", closest: (s) => (s === "button" ? btn : null), getAttribute: () => null };
    const press = (answer) => { e.listeners.pointerdown({ target: btn }); if (answer) { vi.advanceTimersByTime(100); rev++; } vi.advanceTimersByTime(700); };
    press(false); press(true);           // the second is answered by a state change
    press(false); press(false);          // only two unanswered since — not three in a row
    expect(e.sent.some((s) => s.k === "crop-pointer-dead")).toBe(false);
    press(false);
    expect(e.sent.some((s) => s.k === "crop-pointer-dead")).toBe(true);
    off(); vi.useRealTimers();
  });
  it("a press that lands OUTSIDE the open modal is reported with what it hit", () => {
    const e = fakeEnv();
    armCropWatchdog({ root: e.root, get: () => ({ ...GOOD, rev: 0, renders: 1 }), env: { window: e.win, document: e.doc, report: e.report } });
    const other = { tagName: "DIV", inTool: false, closest: () => null, getAttribute: (k) => (k === "data-testid" ? "some-overlay" : null) };
    e.listeners.pointerdown({ target: other });
    const row = e.sent.find((s) => s.k === "crop-pointer-blocked");
    expect(row.x.hit).toBe("div#some-overlay");
  });
});

describe("wiring", () => {
  it("ImageCropTool arms the watchdog once, on mount", () => {
    const tool = readFileSync("src/shared/sitePlans/components/ImageCropTool.jsx", "utf8");
    expect(tool).toMatch(/useEffect\(\(\) => armCropWatchdog\(\{ root: rootRef\.current,[^\n]*\}\), \[\]\)/);
  });
});
