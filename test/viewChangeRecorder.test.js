/* viewChangeRecorder — the instrument that answers "did a user ask for this view change?".
 *
 * ⛔ WHY THESE TESTS EXIST IN THE SHAPE THEY DO. This module's whole job is to attribute view
 * changes, and the two ways it can be WRONG are not symmetric. Missing a real unrequested change
 * loses the bug. Inventing one — by mis-crediting a replayed React updater as a second change, or
 * by refusing to credit a real gesture — manufactures the exact finding being hunted, which is the
 * more expensive error and the one two earlier live probes in this family actually made. So both
 * directions are pinned, and each block names the mutation it catches (a guard nobody has seen fail
 * is a guard that rots green).
 */
import { describe, it, expect } from "vitest";
import {
  createViewChangeRecorder, classifyChange, topAppFrame, GESTURE_WINDOW_MS,
} from "../src/workspaces/site-planner/lib/viewChangeRecorder.js";

const V = (ppf, offX = 0, offY = 0) => ({ ppf, offX, offY });

/* A clock the test drives, so "1500 ms later" is exact rather than slept for. */
function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe("classifyChange", () => {
  it("names a zoom, a pan and a no-op apart", () => {
    // Mutation: classifying every change as "zoom" would make every pan look like the reported bug.
    expect(classifyChange(V(1), V(2))).toBe("zoom");
    expect(classifyChange(V(1, 0, 0), V(1, 40, 0))).toBe("pan");
    expect(classifyChange(V(1, 5, 5), V(1, 5, 5))).toBe("noop");
    expect(classifyChange(null, V(1))).toBe("unknown");
  });
  it("counts a ppf change as a zoom even when the offsets moved too", () => {
    // A pinch moves all three; reporting it as a pan would hide every zoom this rig exists to find.
    expect(classifyChange(V(1, 0, 0), V(1.4, 90, 20))).toBe("zoom");
  });
});

describe("topAppFrame", () => {
  it("skips the recorder's own frame and React's internals to name the real caller", () => {
    const stack = [
      "Error: setView",
      "    at setView (viewChangeRecorder.js:1:1)",
      "    at commitHookEffectListMount (react-dom.production.min.js:9:1)",
      "    at fit (SitePlanner.jsx:5664:5)",
    ].join("\n");
    expect(topAppFrame(stack)).toBe("fit (SitePlanner.jsx:5664:5)");
  });
  it("answers null rather than throwing for a stack it cannot read", () => {
    expect(topAppFrame(undefined)).toBe(null);
    expect(topAppFrame("Error: setView")).toBe(null);
  });
});

describe("attribution — the column the whole hunt turns on", () => {
  it("credits a change that follows a trusted gesture inside the window", () => {
    const c = fakeClock();
    const rec = createViewChangeRecorder({ now: c.now });
    rec.noteGesture("touchmove", true);
    c.advance(40);
    const row = rec.recordChange({ from: V(1), to: V(1.2) });
    expect(row.unrequested).toBe(false);
    expect(row.gesture).toEqual({ type: "touchmove", agoMs: 40, blockedMs: 0 });
  });

  it("marks a change UNREQUESTED when the last gesture has aged out of the window", () => {
    // Mutation: an unbounded window would credit a gesture from ten minutes ago and report a clean
    // sheet on exactly the idle-then-automatic-reframe case being hunted.
    const c = fakeClock();
    const rec = createViewChangeRecorder({ now: c.now });
    rec.noteGesture("wheel", true);
    c.advance(GESTURE_WINDOW_MS + 1);
    expect(rec.recordChange({ from: V(1), to: V(2) }).unrequested).toBe(true);
  });

  it("marks a change UNREQUESTED when no gesture ever happened", () => {
    const rec = createViewChangeRecorder({ now: fakeClock().now });
    expect(rec.recordChange({ from: V(1), to: V(0.4) }).unrequested).toBe(true);
  });

  it("⛔ REFUSES to let a SYNTHETIC event launder a change into 'the user did it'", () => {
    /* SYNTHETIC-KEYS-DONT-EDIT, applied to the input half. A probe that dispatches its own
     * `WheelEvent` would otherwise authorise every change it caused, and the rig would report a
     * clean run on a broken build. `isTrusted` is the discriminator and it is not advisory. */
    const c = fakeClock();
    const rec = createViewChangeRecorder({ now: c.now });
    rec.noteGesture("wheel", false);
    c.advance(10);
    const row = rec.recordChange({ from: V(1), to: V(2) });
    expect(row.unrequested).toBe(true);
    expect(rec.snapshot().events.some((e) => e.kind === "gesture:untrusted")).toBe(true);
  });
});

describe("⛔ the window measures AVAILABLE time, not wall clock", () => {
  it("still credits a gesture whose flush landed on the far side of a long task", () => {
    /* THE FALSE POSITIVE THIS CLOSES, and it was produced by this very instrument on its own first
     * teeth run: at 20x CPU throttling one wheel gesture's frame-coalesced flush landed after a
     * 912 ms long task, aged out of the window, and was filed as an UNREQUESTED zoom — a clean,
     * plausible, entirely false violation against a build that did not have the bug. Mutation:
     * comparing wall clock alone fails this test and reinstates that reading. */
    const c = fakeClock();
    const rec = createViewChangeRecorder({ now: c.now });
    rec.noteGesture("wheel", true);
    rec.noteBlocked(5, 1800);          // the thread was unavailable for nearly all of the gap
    c.advance(1900);
    const row = rec.recordChange({ from: V(1), to: V(1.12) });
    expect(row.unrequested).toBe(false);
    expect(row.blockedSinceGestureMs).toBeGreaterThan(1500);
  });

  it("does NOT credit a gesture that is genuinely old on an unblocked thread", () => {
    // The discount must not become a licence: with no blocking, the window is the window.
    const c = fakeClock();
    const rec = createViewChangeRecorder({ now: c.now });
    rec.noteGesture("wheel", true);
    c.advance(1900);
    expect(rec.recordChange({ from: V(1), to: V(1.12) }).unrequested).toBe(true);
  });

  it("reports the near-miss numbers even on an unrequested row, so a verdict can be audited", () => {
    const c = fakeClock();
    const rec = createViewChangeRecorder({ now: c.now });
    rec.noteGesture("touchmove", true);
    c.advance(1600);
    const row = rec.recordChange({ from: V(1), to: V(2) });
    expect(row.unrequested).toBe(true);
    expect(row.sinceGestureMs).toBe(1600);
  });
});

describe("replay de-duplication", () => {
  it("counts a re-run React updater ONCE", () => {
    /* A functional setState updater is re-invoked when React re-renders the pending update, so one
     * notch can reach the recorder twice with an identical (stack, from, to). Counting both would
     * inflate every rate this instrument reports — and an over-count reads exactly like the bug. */
    const c = fakeClock();
    const rec = createViewChangeRecorder({ now: c.now });
    const args = { from: V(1), to: V(1.12), stack: "at flushWheel" };
    expect(rec.recordChange(args)).not.toBe(null);
    c.advance(3);
    expect(rec.recordChange(args)).toBe(null);
    expect(rec.snapshot().counts.changes).toBe(1);
  });

  it("does NOT swallow two genuinely different notches that share a stack", () => {
    // Mutation: deduping on the stack (or on time) alone would eat every frame of a real pinch and
    // report a 12-change gesture as a 1-change one — the instrument going blind, quietly.
    const c = fakeClock();
    const rec = createViewChangeRecorder({ now: c.now });
    rec.recordChange({ from: V(1), to: V(1.12), stack: "at flushWheel" });
    c.advance(16);
    rec.recordChange({ from: V(1.12), to: V(1.25), stack: "at flushWheel" });
    expect(rec.snapshot().counts.changes).toBe(2);
  });
});

describe("the timeline and the correlation window", () => {
  it("carries what arrived just before a change, and drops what is too old to be relevant", () => {
    const c = fakeClock();
    const rec = createViewChangeRecorder({ now: c.now });
    rec.noteEvent("visibilitychange", "hidden");
    c.advance(GESTURE_WINDOW_MS + 500);
    rec.noteEvent("pageshow", "bfcache-restore");
    c.advance(50);
    const row = rec.recordChange({ from: V(1), to: V(0.5) });
    const kinds = row.precededBy.map((p) => p.kind);
    expect(kinds).toContain("pageshow");
    expect(kinds).not.toContain("visibilitychange");
  });

  it("bounds both rings so a long session cannot leak memory", () => {
    const rec = createViewChangeRecorder({ now: fakeClock().now, maxChanges: 3, maxEvents: 4 });
    for (let i = 0; i < 20; i++) rec.recordChange({ from: V(i + 1), to: V(i + 2), stack: `s${i}` });
    for (let i = 0; i < 20; i++) rec.noteEvent("longtask", String(i));
    const snap = rec.snapshot();
    expect(snap.changes.length).toBe(3);
    expect(snap.events.length).toBe(4);
  });

  it("does not count a no-op as an unrequested change", () => {
    // A settle that re-commits the same view is not the app moving the picture on its own.
    const rec = createViewChangeRecorder({ now: fakeClock().now });
    rec.recordChange({ from: V(1, 5, 5), to: V(1, 5, 5), stack: "settle" });
    expect(rec.snapshot().counts.unrequested).toBe(0);
  });
});
