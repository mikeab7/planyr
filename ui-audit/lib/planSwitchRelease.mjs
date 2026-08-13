/* planSwitchRelease — the pure verdict for B1439's regression guard.
 *
 * WHAT THE GUARD HAS TO PROVE, and why the obvious version of it would be worthless.
 *
 * The obvious guard is "switch A→B→A, assert the detached-node count is small." It would pass
 * today. It would also pass if the scenario silently stopped switching plans, if the selector
 * stopped matching, if the snapshot came back empty, or if `detachedness` stopped being reported —
 * i.e. it would rot into a permanent green and nobody would know. That is the exact failure mode
 * VIEW-INDEPENDENT-ONCE §6 names ("fails if a registered one was never OBSERVED"), and B1439 is a
 * bad enough bug to deserve a guard that cannot do it.
 *
 * So the guard runs the cycle TWICE and requires BOTH halves:
 *   • the GUARDED arm — handles disposed — must leave essentially nothing detached. This is the
 *     assertion proper.
 *   • the CONTROL arm — one handle deliberately stranded per switch, which is precisely the defect
 *     — must leave a LOT. This is the instrument's positive control: it proves the measurement can
 *     still see retention at all. If the control comes back clean, the guard has gone blind and it
 *     fails saying so, rather than reporting a pass it did not earn.
 * Plus `switchProven`: plan B is half of plan A by construction, so if the drawn-feature count never
 * changed, the route change did not take and neither arm measured a plan switch.
 *
 * Keeping this pure means CI can test the decision table without a browser (test/planSwitchRelease.test.js).
 */

export const DEFAULTS = {
  /** Detached wrappers the guarded arm may leave. Zero is what a correct run measures; a small
   *  allowance absorbs an unrelated stray without letting a whole shell tree (~1,200 nodes per
   *  unmount) through. */
  maxDetached: 60,
  /** `rendererNodes` must come back to its pre-cycle value; the same allowance applies. */
  maxRendererDelta: 120,
  /** The control must strand at least this much, or the instrument is not observing. One shell
   *  tree per switch is ~1,200 nodes, so this is far below one arm's worth and still unmistakable. */
  minControlDetached: 300,
};

/**
 * @param {{detachedBefore:number, detachedAfter:number, rendererBefore:number, rendererAfter:number}} guarded
 * @param {{detachedBefore:number, detachedAfter:number}|null} control
 * @param {boolean} switchProven  did the drawn-feature count actually change across the switch?
 */
export function releaseVerdict(guarded, control, switchProven, opts = {}) {
  const t = { ...DEFAULTS, ...opts };
  const failures = [];

  if (!switchProven) {
    failures.push("the plan switch was never proven — the drawn-feature count did not change between plan A and plan B, so neither arm measured a plan switch and every number below is about one plan rendered twice");
  }

  if (!control) {
    failures.push("the positive control did not run — without it a clean guarded arm proves nothing, because an instrument that sees nothing also reports nothing");
  } else {
    const controlLeft = control.detachedAfter - control.detachedBefore;
    if (controlLeft < t.minControlDetached) {
      failures.push(`the positive control left only ${controlLeft} detached node(s), below the ${t.minControlDetached} it must strand — the instrument is NOT OBSERVING, so the guarded arm's result is not evidence of anything`);
    }
  }

  const left = guarded.detachedAfter - guarded.detachedBefore;
  if (left > t.maxDetached) {
    failures.push(`the plan switch left ${left} detached DOM node(s) (limit ${t.maxDetached}) — an A→B→A round trip must release the plan you left`);
  }
  const rendererDelta = guarded.rendererAfter - guarded.rendererBefore;
  if (rendererDelta > t.maxRendererDelta) {
    failures.push(`rendererNodes did not return: ${guarded.rendererBefore} → ${guarded.rendererAfter} (+${rendererDelta}, limit +${t.maxRendererDelta})`);
  }

  return {
    ok: failures.length === 0,
    failures,
    detachedLeft: left,
    rendererDelta,
    controlLeft: control ? control.detachedAfter - control.detachedBefore : null,
    thresholds: t,
  };
}
