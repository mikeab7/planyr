/* tabTiming.mjs — ⛔ A WALL-CLOCK READING TAKEN FROM A BACKGROUND TAB IS NOT A MEASUREMENT.
 *
 * THE CASE THIS COMES FROM, recorded in full because the trap has now cost two sessions and the
 * second time it did NOT look like a failure. A probe driven against the owner's live planyr.io tab
 * reported **3,156 ms and 2,992 ms** for one double-click gesture — a plausible, alarming number
 * that reached the owner and was on its way onto two perf backlog items. The tab was
 * `document.visibilityState === "hidden"` for the whole run (it was being driven from another tab),
 * and the harness paced itself with `setTimeout`. Chrome CLAMPS `setTimeout` in a hidden tab, so
 * what was being timed was the clamp.
 *
 * THE CONTROL, same gesture, same build, same tab, same hidden state, ONE variable changed — the
 * pacing primitive: **`setTimeout` → 3,156 / 2,992 ms · MessageChannel yield → 138–182 ms** end to
 * end, 13–63 ms of synchronous handler time. Four elements on the owner's real plan measured the
 * honest way: 111 / 138 / 154 / 182 ms. There was never a multi-second interaction cost.
 *
 * WHY IT IS DANGEROUS RATHER THAN MERELY WRONG: the first appearance of this trap produced an
 * obvious failure and cost one round of probing. This one produced a NUMBER — self-consistent,
 * repeatable, in the right units, and off by a factor of twenty. Nothing downstream can tell those
 * apart, so the check has to happen at the source.
 *
 * THE RULE, and it sits beside CHROME-NEVER-EATS-A-PRESS in /CLAUDE.md: before ANY wall-clock
 * reading from a driven browser, either PROVE the tab is foreground (`assertForeground`) or pace
 * with a primitive the browser does not throttle (`pacedWait`). A harness that cannot prove it must
 * FAIL LOUDLY — never quietly report the throttled number.
 *
 * Pure half unit-tested in test/tabTiming.test.js; the browser half is one `page.evaluate` each.
 */

/* The verdict, separated from the browser so it can be tested without one. `state` is whatever
 * `document.visibilityState` said. Anything that is not literally "visible" is refused — including
 * `undefined`, which means the harness could not read it and therefore cannot vouch for it. */
export function visibilityVerdict(state, { harness = "this harness" } = {}) {
  if (state === "visible") return { ok: true, state };
  return {
    ok: false,
    state: state === undefined ? "unreadable" : state,
    message:
      `⛔ ${harness}: the page reports document.visibilityState = "${state === undefined ? "unreadable" : state}".\n` +
      "   Every wall-clock number this run produces is VOID: a background tab clamps setTimeout, so a\n" +
      "   setTimeout-paced probe times the clamp, not the app (measured: 3,156 ms for a 138-182 ms\n" +
      "   gesture). Bring the tab to the foreground, or pace with pacedWait() from ui-audit/lib/tabTiming.mjs\n" +
      "   and drop every setTimeout from the timed path.",
  };
}

/* Prove the tab is foreground, or throw. Call it once, right after the page is created and again
 * before a timing pass if the run can plausibly be backgrounded in between. Throwing is the point:
 * a guard that returns false and lets the caller decide is a guard that gets ignored on a busy day. */
export async function assertForeground(page, harness) {
  const state = await page.evaluate(() => (typeof document === "undefined" ? undefined : document.visibilityState));
  const v = visibilityVerdict(state, { harness });
  if (!v.ok) throw new Error(v.message);
  return v;
}

/* The same question without the throw, for a harness that wants to REPORT the state alongside its
 * numbers (which every timing harness should — see `timingProvenance`). */
export async function tabVisibility(page) {
  return page.evaluate(() => (typeof document === "undefined" ? undefined : document.visibilityState));
}

/* ⛔ THE UNTHROTTLED WAIT. `setTimeout` is clamped in a background tab (and `requestAnimationFrame`
 * stops entirely), so neither can pace a measurement that must survive being backgrounded. A
 * MessageChannel message is delivered as an ordinary task and is NOT clamped, so a loop of them
 * ticking until `performance.now()` has advanced far enough waits the real duration while still
 * yielding to the event loop between ticks — which is what makes it a pace rather than a spin.
 *
 * Use this anywhere a harness currently writes `page.waitForTimeout(ms)` INSIDE a timed section. It
 * is deliberately NOT a drop-in for every wait: an ordinary "let the app settle" pause outside the
 * measurement is fine as a plain timeout, and cheaper. */
export async function pacedWait(page, ms) {
  await page.evaluate((budget) => new Promise((resolve) => {
    const t0 = performance.now();
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      if (performance.now() - t0 >= budget) { ch.port1.close(); ch.port2.close(); resolve(); return; }
      ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
  }), ms);
}

/* One line every timing harness should print beside its numbers, so a reader can see what the
 * measurement is worth without going back to the source. */
export function timingProvenance(state, { paced = false } = {}) {
  return `timing provenance: visibilityState="${state}"${paced ? " · paced with a MessageChannel yield (unthrottled)" : ""}`;
}
