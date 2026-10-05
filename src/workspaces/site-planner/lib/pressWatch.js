/* pressWatch.js — NEW-1 (map-finder): "the FIRST click on Select parcels after the Map loads does
 * nothing; the second works."
 *
 * ⛔ WHY THIS EXISTS INSTEAD OF A ONE-LINE FIX. The report (owner, five of six fresh loads, build
 * 6df9a60 → ccaca0c) does NOT reproduce here: a real mouse press on the button engages the mode on a
 * plain load AND on the signed-in test account's fresh load at 1.5–8 s, with and without a 6× CPU
 * throttle and a programmatic `map.setView` 100 ms before the press (ui-audit
 * `diagnose-select-parcels-first-click.mjs`, 10/10 engaged). Per CLAUDE.md STANDING RULE #2 a null is a
 * FINDING, never a disposition — the instrument or the fixture is on trial, not his report — so the
 * disposition taken is "INSTRUMENT IT SO IT CAPTURES ITSELF", plus a recovery for the one mechanism
 * the report names that this CAN safely repair:
 *
 *   A browser only fires `click` when pointerdown and pointerup land on the SAME node. If a re-render
 *   replaces the button between the two halves of a press (a lazy chunk or the sites list finishing
 *   under a 100–280 ms blocking frame), the press is complete — down AND up both seen, up inside the
 *   button's own box — and no `click` ever arrives. The user sees nothing happen; their second press
 *   works because the DOM is quiet. `createPressWatch` notices exactly that signature and calls
 *   `onLost`, which the caller turns into the action the press asked for. The action it recovers
 *   (`setSelectMode(true)`) is IDEMPOTENT, so a late genuine `click` after a recovery is harmless.
 *
 * It deliberately does NOT recover when: the pointer was released outside the button's box (a drag
 * off a control cancels a click on purpose), the press was cancelled, or a real click arrived.
 *
 * The second half of the instrument is `createModeTrace`: a short ring of mode transitions with the
 * REASON each exit was taken, so "it engaged and then something reset it" (the other mechanism the
 * report names) is distinguishable from "the press never registered" in the telemetry row.
 *
 * Pure: timers and the clock are injected, so every branch is unit-tested in Node (test/pressWatch).
 */

export const PRESS_CLICK_GRACE_MS = 80; // a genuine click is dispatched in the same input task as the pointerup

/** Pure: is the point inside the rect? (edges inclusive) */
export function pointInRect(x, y, r) {
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** Create a press watcher. `onLost(info)` fires when a press completed over the target with no click. */
export function createPressWatch({ onLost, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, graceMs = PRESS_CLICK_GRACE_MS } = {}) {
  let press = null; // { id, t0, clicked, timer }
  const cancelTimer = () => { if (press && press.timer != null) { clearTimer(press.timer); press.timer = null; } };
  return {
    down(pointerId) { cancelTimer(); press = { id: pointerId, t0: now(), clicked: false, timer: null, tUp: null }; },
    /** `inside`: was the release within the target's own box (the caller measures it). */
    up(pointerId, inside) {
      if (!press || press.id !== pointerId || !inside) { cancelTimer(); if (press && press.id === pointerId) press = null; return; }
      press.tUp = now();
      const mine = press;
      mine.timer = setTimer(() => {
        mine.timer = null;
        if (press !== mine || mine.clicked) return;
        press = null;
        try { onLost && onLost({ downToUpMs: mine.tUp - mine.t0 }); } catch (_) { /* an instrument must never throw into the app */ }
      }, graceMs);
    },
    cancel() { cancelTimer(); press = null; },
    click() { if (press) { press.clicked = true; cancelTimer(); } },
    /** Test/diagnostic read. */
    pending() { return !!(press && press.timer != null); },
  };
}

/** Exits the user (or a finished verb) asked for — never reported as a reset. */
const BENIGN_EXITS = new Set(["user", "verb"]);

/** A bounded ring of select-mode transitions, with the reason an EXIT was taken. */
export function createModeTrace({ now = () => Date.now(), max = 24, resetWindowMs = 3000 } = {}) {
  const events = [];
  let enteredAt = null;
  let exitReason = null;
  const push = (e) => { events.push({ t: now(), ...e }); if (events.length > max) events.shift(); };
  return {
    /** Declare WHY the next true→false transition is about to happen ("user" = a Cancel / mode switch, "verb" = a decide-bar action finishing). */
    willExit(reason) { exitReason = reason; },
    note(kind, extra) { push({ kind, ...(extra || {}) }); },
    /** Feed every committed `selectMode` value. Returns a reset descriptor when an unexplained, early exit is seen. */
    transition(selectMode) {
      push({ kind: selectMode ? "mode-on" : "mode-off" });
      if (selectMode) { enteredAt = now(); exitReason = null; return null; }
      if (enteredAt == null) return null; // initial false / repeat false
      const heldMs = now() - enteredAt;
      const reason = exitReason || "unexplained";
      enteredAt = null; exitReason = null;
      return BENIGN_EXITS.has(reason) || heldMs > resetWindowMs ? null : { reason, heldMs };
    },
    snapshot() { return events.slice(); },
  };
}
