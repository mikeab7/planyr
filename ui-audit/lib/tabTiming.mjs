/* tabTiming.mjs — ⛔ A BACKGROUND TAB CANNOT BE MEASURED. NOT ITS CLOCK, AND NOT ITS PIXELS.
 *
 * TWO CLAUSES, ONE PRECONDITION (`assertMeasurable`). They are separate failures with separate
 * mechanisms, and the second is the more dangerous of the two.
 *
 * ⛔ CLAUSE 2 — GEOMETRY. **ANY DOM MEASUREMENT TAKEN AFTER A VIEW CHANGE ON A BACKGROUND TAB IS
 * VOID, BECAUSE rAF IS SUSPENDED AND THE DRAWING NEVER REPAINTS.** Measured on the owner's live tab
 * at `visibilityState === "hidden"`: `requestAnimationFrame` **did not fire at all** — raced against
 * a MessageChannel loop for two full seconds, it never ran once. A CDP wheel over the canvas then
 * updated the app's STATE correctly (`data-view-ppf` and `data-render-ppf` both 0.0501 → 0.1062, a
 * clean 2× zoom in) while the pond's actual DOM geometry **did not move**: centre (892.9, 248),
 * width 143.4 px — identical to three wheel gestures earlier, to one decimal place.
 *
 * **THAT IS WHY IT IS WORSE THAN THE TIMING CLAUSE.** A throttled timer gives you a wrong NUMBER. A
 * suspended rAF gives you a wrong PICTURE THAT IS INTERNALLY CONSISTENT — boxes, positions, sizes
 * and hit tests all agree with each other, they simply describe a view the app has already left.
 * Everything built on `elementFromPoint`, `getBoundingClientRect` or a screenshot inherits it
 * silently, and the app's own state attributes will confirm the view you asked for, so the two
 * halves of the evidence agree while the picture is stale.
 *
 * **IT ALREADY COST A FALSE LEAD, recorded so nobody chases it again:** an apparent anchored-zoom
 * defect (after a wheel-out at pointer x=900 the drawing sat at x=104, moving AWAY from the pointer)
 * was flagged against B1449 / B258992 / V56000 and is **REFUTED** — it was a stale frame from a
 * previous view, not a broken anchor. The anchored-zoom work is not implicated.
 *
 * **AND THE rAF LIVENESS PROBE IS PART OF THE ASSERTION, not an extra**, because it catches the case
 * `visibilityState` cannot: a tab that claims to be visible while its frame loop is wedged anyway.
 * Race one rAF against a MessageChannel loop; if the rAF never runs, nothing measured from the DOM
 * after a view change means anything.
 *
 * ── CLAUSE 1 — TIMING. A WALL-CLOCK READING TAKEN FROM A BACKGROUND TAB IS NOT A MEASUREMENT.
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
 * THE RULE, and it sits beside CHROME-NEVER-EATS-A-PRESS in /CLAUDE.md: **A BROWSER-DRIVING HARNESS
 * MUST ASSERT `document.visibilityState === "visible"` BEFORE IT MEASURES ANYTHING — TIME OR
 * GEOMETRY — AND FAIL LOUDLY IF IT IS NOT.** One precondition rather than two rules, because one
 * cause produces both failures. `pacedWait` is the additional tool clause 1 needs when a timed
 * section must survive being backgrounded at all.
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

/* The rAF verdict, separated from the browser like the one above. `fired` is whether a single
 * `requestAnimationFrame` callback ran inside the probe window. */
export function rafVerdict(fired, { harness = "this harness", windowMs = 0 } = {}) {
  if (fired) return { ok: true, fired: true };
  return {
    ok: false,
    fired: false,
    message:
      `⛔ ${harness}: requestAnimationFrame did not fire once in ${windowMs} ms — THE FRAME LOOP IS NOT RUNNING.\n` +
      "   Every DOM measurement this run takes after a view change is VOID. The app's state attributes\n" +
      "   will still update (data-view-ppf moved a clean 2x on the run that produced this rule) while the\n" +
      "   drawing never repaints, so boxes, positions, hit tests and screenshots all AGREE WITH EACH OTHER\n" +
      "   and all describe a view the app already left. See ui-audit/lib/tabTiming.mjs.",
  };
}

/* Race ONE rAF against a MessageChannel loop (which a background tab does not throttle) for
 * `windowMs`. Returns whether the frame callback ran. This is the positive control `visibilityState`
 * cannot give: a tab can claim to be visible while its frame loop is wedged anyway. */
export async function probeRafLiveness(page, windowMs = 1200) {
  return page.evaluate((budget) => new Promise((resolve) => {
    let fired = false;
    requestAnimationFrame(() => { fired = true; });
    const t0 = performance.now();
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      if (fired || performance.now() - t0 >= budget) { ch.port1.close(); ch.port2.close(); resolve(fired); return; }
      ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
  }), windowMs);
}

/* ⛔ THE ONE PRECONDITION, and it covers TIME AND GEOMETRY ALIKE — that is deliberate: one cause
 * (a background tab) produces both failures, so it is one assertion rather than two rules a harness
 * can satisfy by halves. Call it once, right after the page is created, and again before a
 * measurement pass if the run can plausibly be backgrounded in between.
 *
 * Throwing is the point: a guard that returns false and lets the caller decide is a guard that gets
 * ignored on a busy day, and both failure modes here produce output that looks entirely reasonable.
 *
 * `raf: false` opts out of the frame-loop probe for a harness that measures neither time nor
 * post-view-change geometry (it costs a frame, and a fixture-only harness needs no positive control). */
export async function assertMeasurable(page, harness, { raf = true, rafWindowMs = 1200 } = {}) {
  const state = await page.evaluate(() => (typeof document === "undefined" ? undefined : document.visibilityState));
  const v = visibilityVerdict(state, { harness });
  if (!v.ok) throw new Error(v.message);
  if (!raf) return { ...v, raf: "not probed" };
  const fired = await probeRafLiveness(page, rafWindowMs);
  const r = rafVerdict(fired, { harness, windowMs: rafWindowMs });
  if (!r.ok) throw new Error(r.message);
  return { ...v, raf: "live" };
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
