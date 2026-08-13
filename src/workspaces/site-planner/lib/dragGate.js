/* THE CLICK-VS-DRAG GATE — one shared answer to "did this press become a drag?" (NEW-1).
 *
 * Owner, 2026-08-09: "sometimes when I intend to just click on something to select it, it actually
 * also moves it, like, a couple feet or, like, a pixel or two just because my click is too slow …
 * Maybe I hold it for a couple milliseconds, and it accidentally moves the element."
 *
 * The planner's move path had NO slop gate: the FIRST pointermove wrote new positions, so one pixel
 * of hand tremor during a click was a committed move — and with snap on, the ambient flush-snap
 * (tolerance up to 20 ft) could then yank the element onto a neighbour's edge. That is the "couple
 * of feet", and it is why it was intermittent.
 *
 * THREE PROPERTIES, and each one is a trap the obvious implementation falls into:
 *
 * 1. TRAVEL ONLY — NEVER DURATION. The pan path's tap test (`PARCEL_CLICK_SLOP_PX` +
 *    `PARCEL_CLICK_MS`) is right for "was this a tap or a pan", and WRONG here. A deliberate, slow,
 *    careful press that never moves is still a click and must move nothing; a fast flick that
 *    travels far is a drag however brief. Copying the pan test verbatim introduces the
 *    mirror-image bug — a slow click that starts dragging — which is the very complaint. So this
 *    module has no clock in it at all, and `test/dragGate.test.js` asserts that it cannot acquire
 *    one (a gate held for an hour without moving is still a click).
 *
 * 2. NO JUMP WHEN THE GATE OPENS. A gate that keeps computing from the original grab point makes
 *    every real drag begin by leaping the whole accumulated delta — one nudge traded for another.
 *    So arming records the feet-space delta the pointer travelled to get here (`off`) and every
 *    later position is rebased through it: at the arming instant the rebased point IS the
 *    pointer-down point, so the first armed frame writes a zero delta, and motion from there
 *    tracks the pointer one-for-one.
 *
 * 3. ⛔ THE REBASE IS RIGHT FOR A DRAG THAT CARRIES A GRAB OFFSET AND WRONG FOR ONE THAT AIMS AT A
 *    POINT — so it is opt-out (`rebase: false`), and getting this wrong is not cosmetic. A MOVE
 *    keeps the object at a fixed offset from the pointer, so rebasing simply sets that offset and
 *    nothing downstream can tell. A VERTEX drag writes the pointer's own position (`snapPt(fp)`):
 *    rebasing leaves the vertex trailing the cursor by the travel the gate swallowed, for the whole
 *    gesture — and a road endpoint released onto another road's endpoint then lands outside the
 *    snap-and-connect magnet's tolerance and never welds. (Caught by `road-connect-radius`, not by
 *    reasoning.) A point drag therefore takes the pointer straight, and the only "jump" is the one
 *    its own design has always had: it goes where the pointer is, five pixels of travel later than
 *    it used to. Resize / rotate / scale KEEP the rebase — they aim at a dimension, not a target,
 *    so starting from the current size is what reads as no jump there.
 *
 * The gate is deliberately a plain mutable record living on `drag.current` (a ref), not state:
 * a pointermove must not re-render to decide whether it is allowed to write.
 */

/* Max pointer travel, in CSS px, that still counts as a click rather than a drag. Shared with the
 * pan path's `PARCEL_CLICK_SLOP_PX` so the whole app agrees on what a click is. */
export const DRAG_SLOP_PX = 5;

/**
 * Open a gate for a press. `clientPt` is the pointer-down point in CSS px (the travel is measured
 * in screen space, so the threshold means the same thing at every zoom); `feetPt` is that same
 * point in world feet (what the rebase is expressed in, so a mid-drag zoom can't distort it).
 */
export function makeDragGate(clientPt, feetPt, { slop = DRAG_SLOP_PX, rebase = true } = {}) {
  return {
    sx: clientPt.x, sy: clientPt.y,   // press point, CSS px
    fx: feetPt.x, fy: feetPt.y,       // press point, world feet
    slop,
    rebase,                           // false for a POINT drag that must land where the pointer is (see 3 above)
    armed: false,
    off: null,                        // feet travelled before arming; subtracted from every later point
  };
}

/** Pointer travel since the press, in CSS px. */
export function dragTravelPx(gate, clientPt) {
  return Math.hypot(clientPt.x - gate.sx, clientPt.y - gate.sy);
}

/**
 * Rebase a live pointer position through an armed gate. Before arming (or with no gate) the point
 * passes through untouched — callers must not be writing geometry then anyway.
 */
export function gatedPoint(gate, feetPt) {
  return gate && gate.off ? { x: feetPt.x - gate.off.x, y: feetPt.y - gate.off.y } : feetPt;
}

/**
 * Advance the gate with one pointermove.
 *
 * @returns {{armed: boolean, justArmed: boolean, pt: {x: number, y: number}}}
 *   `armed:false` → the gesture is still a CLICK: write nothing at all, not geometry, not history.
 *   `justArmed:true` → this is the frame the drag begins on (push the ONE undo frame here).
 *   `pt` → the pointer in feet, rebased so the first armed frame is a zero-delta no-op.
 */
export function stepDragGate(gate, clientPt, feetPt) {
  if (!gate) return { armed: true, justArmed: false, pt: feetPt };           // ungated gesture (draw / pan / marquee)
  if (gate.armed) return { armed: true, justArmed: false, pt: gatedPoint(gate, feetPt) };
  if (dragTravelPx(gate, clientPt) <= gate.slop) return { armed: false, justArmed: false, pt: feetPt };
  gate.armed = true;
  // The rebase, in feet: at this instant `gatedPoint` returns exactly the press point, so whatever
  // the branch computes from it (a delta, an angle, a scale ratio) is identical to what an un-gated
  // first move would have produced. No leap. A point drag opts out — it must stay under the pointer.
  if (gate.rebase !== false) gate.off = { x: feetPt.x - gate.fx, y: feetPt.y - gate.fy };
  return { armed: true, justArmed: true, pt: gatedPoint(gate, feetPt) };
}

/** True once this gesture has become a real drag (an ungated gesture always counts as one). */
export function dragArmed(d) {
  return !d || !d.gate || d.gate.armed;
}
