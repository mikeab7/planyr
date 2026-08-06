/* NEW-1 — the reconstructed double-tap is budgeted on the GESTURE's clock, not the app's.
 *
 * The defect, measured on the owner's Bain plan ("Concept A — Quiddity Hydrologic"), 2026-08-06:
 * pointerdown #2 fired at e.timeStamp 330662 and its handler began running at 330969 — 307 ms of
 * main-thread queueing against a 350 ms budget — so a perfectly ordinary 150 ms double-click
 * measured ~450 ms and was discarded. The double-click silently did nothing, and the busier the
 * plan, the more often. (Yesterday's separate measurement had the main thread 24–80% busy on JS
 * whenever the pointer was over the drawing; that is what supplies the 307 ms. Shared amplifier,
 * different defect — the clock is wrong even on an idle machine.)
 *
 * These cases are written in terms of the two clocks so the failure is stated, not just detected:
 * every "handler ran LATE" case passes on the event clock and fails on a wall clock read inside the
 * handler. The live half — a real double-click on a deliberately-jammed main thread — is
 * e2e/dblclick-properties.spec.js.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DBLTAP_MS, DBLTAP_PX, EMPTY_TAP, tapTime, pairsWithLastTap, tapRecord, stepDoubleTap } from "../src/workspaces/site-planner/lib/doubleTap.js";

const press = (id, t, x = 100, y = 100, wasSel = false) => ({ id, t, x, y, wasSel });

describe("the gesture's own clock", () => {
  it("reads the event's timeStamp, not a wall clock", () => {
    expect(tapTime({ timeStamp: 330662 })).toBe(330662);
    expect(tapTime({ timeStamp: 330662 }, 999999)).toBe(330662);
  });

  it("falls back to the caller's monotonic reading when an event carries no usable timeStamp", () => {
    // A hand-built event (or a harness-synthesised one) can arrive with 0 / undefined / NaN. The
    // fallback must stay on the SAME timeline a real timeStamp uses — mixing epochs would make
    // every comparison nonsense, which is the whole bug in miniature.
    for (const bad of [undefined, null, 0, NaN, Infinity, "330662"]) {
      expect(tapTime({ timeStamp: bad }, 12345)).toBe(12345);
    }
    expect(tapTime(null, 12345)).toBe(12345);
  });
});

describe("the owner's measured case", () => {
  /* His two presses, verbatim: 150 ms apart, but the second handler ran 307 ms after its own event.
   * `handlerT` is what `Date.now()` inside the handler would have returned. */
  const DOWN_1 = 330512, DOWN_2 = 330662, HANDLER_2 = 330969;

  it("a 150 ms double-click PAIRS when measured on the event clock", () => {
    const after1 = stepDoubleTap({ ...EMPTY_TAP }, press("easement-1", DOWN_1));
    expect(after1.double).toBe(false);
    expect(stepDoubleTap(after1.record, press("easement-1", DOWN_2)).double).toBe(true);
  });

  it("…and is DISCARDED when measured on a wall clock read inside the handler — the shipped bug", () => {
    // Reproducing the old code exactly: both readings taken when the handler ran. Press 1's handler
    // was prompt, press 2's was 307 ms late, so the recorded interval is 457 ms.
    const after1 = stepDoubleTap({ ...EMPTY_TAP }, press("easement-1", DOWN_1));
    expect(HANDLER_2 - DOWN_1).toBeGreaterThan(DBLTAP_MS);
    expect(stepDoubleTap(after1.record, press("easement-1", HANDLER_2)).double).toBe(false);
  });

  it("the queueing delay alone nearly spends the whole budget", () => {
    expect(HANDLER_2 - DOWN_2).toBe(307);
    expect(HANDLER_2 - DOWN_2).toBeLessThan(DBLTAP_MS);      // it does not exceed it on its own…
    expect(HANDLER_2 - DOWN_2 + 150).toBeGreaterThan(DBLTAP_MS); // …but any real gesture on top does
  });

  /* ⛔ The tempting non-fix, pinned so nobody ships it. Raising the budget past the observed delay
   * "works" on this trace and takes a deliberate click-pause-click with it: a 500 ms pair — two
   * separate decisions by the user — would start firing as an edit. */
  it("raising DBLTAP_MS would NOT have been the fix", () => {
    const wide = { ms: 800 };
    const a = stepDoubleTap({ ...EMPTY_TAP }, press("x", 1000));
    expect(pairsWithLastTap(a.record, tapRecord("x", 1500, 100, 100), wide)).toBe(true); // a 500 ms pause misfires
    expect(pairsWithLastTap(a.record, tapRecord("x", 1500, 100, 100))).toBe(false);      // …and does not, at the native budget
    expect(DBLTAP_MS).toBe(350);
  });
});

describe("the pairing rules themselves", () => {
  it("needs the SAME feature", () => {
    const a = stepDoubleTap({ ...EMPTY_TAP }, press("a", 1000));
    expect(stepDoubleTap(a.record, press("b", 1100)).double).toBe(false);
  });

  it("never pairs against the empty record", () => {
    expect(stepDoubleTap({ ...EMPTY_TAP }, press("a", 1000)).double).toBe(false);
    expect(pairsWithLastTap(EMPTY_TAP, tapRecord(null, 10, 0, 0))).toBe(false);
  });

  it("honours the time budget at its edges", () => {
    const a = stepDoubleTap({ ...EMPTY_TAP }, press("a", 1000));
    expect(pairsWithLastTap(a.record, tapRecord("a", 1000 + DBLTAP_MS - 1, 100, 100))).toBe(true);
    expect(pairsWithLastTap(a.record, tapRecord("a", 1000 + DBLTAP_MS, 100, 100))).toBe(false);
  });

  it("honours the distance budget — 'select here, then drag from over THERE' is not an edit", () => {
    const a = stepDoubleTap({ ...EMPTY_TAP }, press("a", 1000, 100, 100));
    expect(pairsWithLastTap(a.record, tapRecord("a", 1100, 100 + DBLTAP_PX, 100 + DBLTAP_PX))).toBe(true);
    expect(pairsWithLastTap(a.record, tapRecord("a", 1100, 100 + DBLTAP_PX + 1, 100))).toBe(false);
    expect(pairsWithLastTap(a.record, tapRecord("a", 1100, 100, 100 - DBLTAP_PX - 1))).toBe(false);
  });

  it("refuses a press that reads as EARLIER than the one before it, rather than treating it as a huge gap", () => {
    const a = stepDoubleTap({ ...EMPTY_TAP }, press("a", 1000));
    expect(pairsWithLastTap(a.record, tapRecord("a", 900, 100, 100))).toBe(false);
  });

  /* B1174's rule, kept: a matched pair RE-ARMS to press 2 instead of wiping the record, so a real
   * "click to select, then immediately double-click" — three presses inside one window — still
   * registers rather than leaving press 3 dangling with nothing to pair with. */
  it("a matched pair re-arms, so a third rapid press still pairs", () => {
    const p1 = stepDoubleTap({ ...EMPTY_TAP }, press("a", 1000));
    const p2 = stepDoubleTap(p1.record, press("a", 1100));
    expect(p2.double).toBe(true);
    expect(p2.record.wasSel).toBe(true);
    expect(stepDoubleTap(p2.record, press("a", 1200)).double).toBe(true);
  });

  it("carries wasSel through an UNpaired press verbatim", () => {
    expect(stepDoubleTap({ ...EMPTY_TAP }, press("a", 1000, 1, 2, true)).record).toEqual({ id: "a", t: 1000, x: 1, y: 2, wasSel: true });
    expect(stepDoubleTap({ ...EMPTY_TAP }, press("a", 1000, 1, 2, false)).record.wasSel).toBe(false);
  });
});

describe("source guard — the wall clock may not come back", () => {
  const SP = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
  const LIB = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/lib/doubleTap.js", import.meta.url)), "utf8");

  it("the planner's isDoubleTap reads the EVENT's clock", () => {
    expect(SP).toMatch(/const isDoubleTap = \(e, id, wasSel\) => \{[\s\S]{0,300}tapTime\(e\)/);
  });

  it("neither the gesture module nor the planner's isDoubleTap reads Date.now()", () => {
    /* Assert about CODE, not prose: both files DOCUMENT the wall clock they removed — naming it is
       how the next reader learns what not to reintroduce — so strip comments before looking. */
    const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    expect(code(LIB), "lib/doubleTap.js must never read a wall clock").not.toMatch(/Date\.now\(\)/);
    const body = code(SP);
    const at = body.indexOf("const isDoubleTap = (e, id, wasSel) =>");
    expect(at).toBeGreaterThan(-1);
    expect(body.slice(at, body.indexOf("};", at))).not.toMatch(/Date\.now\(\)/);
  });

  it("the native thresholds are unchanged", () => {
    expect(LIB).toMatch(/export const DBLTAP_MS = 350;/);
    expect(LIB).toMatch(/export const DBLTAP_PX = 14;/);
  });
});
