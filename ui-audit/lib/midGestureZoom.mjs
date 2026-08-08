/* midGestureZoom — the PURE verdict layer for the mid-gesture zoom harness (B1449).
 *
 * ⛔ WHY THIS EXISTS AT ALL, stated once so it is not re-litigated. B1449 was called "dangerous"
 * for weeks, and the stated reason was that at rest `renderView.ppf === view.ppf`, so a CORRECT
 * anchored zoom and a BROKEN one produce identical output in every existing test, e2e spec and
 * pixel harness. That is not a property of the refactor — it is a hole in the harness
 * (/CLAUDE.md → DANGEROUS-MEANS-UNOBSERVABLE). This module is the missing observation.
 *
 * THE INVARIANT IT CHECKS, and why it is the right one. Under an anchored zoom the mid-gesture
 * frame is *the settled frame at the ANCHOR's zoom, uniformly scaled by k about the gesture's
 * screen anchor*. So for every drawn node:
 *
 *     midRect  ==  scaleAbout(restRect, k, anchorPoint)
 *
 * ⛔ THIS IS NOT A PIXEL COMPARISON, DELIBERATELY. Comparing mid-gesture pixels against the
 * settled frame at the same effective zoom would fail on a CORRECT build — mid-gesture the stroke
 * weights, type sizes and level-of-detail tier are the anchor's, scaled, which is exactly the
 * trade-off the owner accepted. Geometry is the part that must be exact, and it is the part a
 * pixel diff is worst at judging. (It is also why PERCEPTUAL-PARITY is not the tool here.)
 *
 * THE THREE FAILURE MODES IT SEPARATES, because collapsing them is how a report misleads:
 *   • `double-scaled`  — the error grows with k and the observed scale is ~k² (the group scales
 *                        geometry that was already emitted at the live zoom). B1449 named this one.
 *   • `unscaled`       — the observed scale is ~1: geometry moved but never scaled.
 *   • `drift`          — neither; something is off by a translation or per-node. Reported raw.
 *
 * ⛔ AND THE ONE THAT MATTERS MOST: `not-anchored`. If the anchor never armed, every check above
 * passes vacuously (k === 1, nothing moved, everything "agrees") and the guard is green on a build
 * where the feature does not exist. `armVerdict` treats that as a FAILURE, never a pass — the same
 * rot VIEW-INDEPENDENT-ONCE §6 names for a registration nobody observed.
 *
 * Pure: no Playwright, no DOM. Unit-tested in test/midGestureZoom.test.js.
 */

/** Where `rect` lands when the whole frame is scaled by `k` about screen point `a`. */
export function scaleAbout(rect, k, a) {
  return {
    x: a.x + (rect.x - a.x) * k,
    y: a.y + (rect.y - a.y) * k,
    w: rect.w * k,
    h: rect.h * k,
  };
}

/* A node has to be big enough on screen for a rect comparison to mean anything: a 1 px sliver's
 * bounds are dominated by antialiasing and stroke rounding, not by the transform. */
export const MIN_NODE_PX = 6;

/* Tolerance, in CSS px, on each edge. Chromium reports `getBoundingClientRect` on a transformed
 * SVG node through its own accumulated float matrix, and a STROKE's half-width rides the bounds —
 * so a scaled stroke legitimately moves the reported edge by a fraction of a pixel that the pure
 * geometry does not predict. Sized to swallow that and nothing else: a genuine double-scale at the
 * smallest gesture this harness drives (k = 1.12) displaces a node near the frame edge by tens of
 * px, three orders of magnitude clear of this floor. */
export const EDGE_TOL_PX = 1.5;

/** Compare one node's mid-gesture rect against the prediction. */
export function nodeVerdict(rest, mid, k, a, tol = EDGE_TOL_PX) {
  const want = scaleAbout(rest, k, a);
  const err = {
    x: mid.x - want.x, y: mid.y - want.y,
    w: mid.w - want.w, h: mid.h - want.h,
  };
  const worst = Math.max(Math.abs(err.x), Math.abs(err.y), Math.abs(err.w), Math.abs(err.h));
  return { want, err, worst, ok: worst <= tol };
}

/** The scale actually observed for a node, from its width and height. `null` when the resting node
 *  is too small to divide by. */
export function observedScale(rest, mid) {
  const s = [];
  if (rest.w >= MIN_NODE_PX) s.push(mid.w / rest.w);
  if (rest.h >= MIN_NODE_PX) s.push(mid.h / rest.h);
  if (!s.length) return null;
  return s.reduce((t, n) => t + n, 0) / s.length;
}

/* How close an observed scale has to sit to a candidate before the diagnosis is named rather than
 * left as generic drift. Loose on purpose — the point is to name the mechanism, and a
 * near-miss reported as `drift` with its numbers is more honest than a confident wrong label. */
const NEAR = 0.06;
const near = (a, b) => Math.abs(a - b) <= NEAR * Math.max(1, Math.abs(b));

/** Name the failure mechanism from the observed scales. */
export function diagnose(k, scales) {
  const usable = scales.filter((s) => Number.isFinite(s));
  if (!usable.length) return { mechanism: "unknown", observedScale: null };
  const s = usable.reduce((t, n) => t + n, 0) / usable.length;
  if (near(s, k)) return { mechanism: "ok", observedScale: s };
  if (near(s, k * k)) return { mechanism: "double-scaled", observedScale: s };
  if (near(s, 1)) return { mechanism: "unscaled", observedScale: s };
  return { mechanism: "drift", observedScale: s };
}

/** Did the anchor actually arm? A run where it did not proves nothing and must never read green. */
export function armVerdict({ viewPpf, renderPpf, k } = {}) {
  const problems = [];
  if (!(viewPpf > 0) || !(renderPpf > 0)) problems.push("the canvas reported no usable ppf — the harness read nothing");
  else if (Math.abs(renderPpf - viewPpf) / viewPpf < 1e-6) {
    problems.push(`render ppf (${renderPpf}) equals the live ppf (${viewPpf}) MID-GESTURE — no zoom anchor armed, so every geometry check below would pass vacuously`);
  }
  if (!(k > 0)) problems.push("no group scale reported");
  else if (Math.abs(k - 1) < 1e-6) problems.push("the group scale is 1 mid-gesture — nothing is being carried by the transform");
  return { armed: problems.length === 0, problems };
}

/** The whole run's verdict. `nodes` is `[{ id, rest, mid }]`. */
export function runVerdict({ nodes = [], k, anchor, arm, settle, tol = EDGE_TOL_PX } = {}) {
  const armed = armVerdict(arm || {});
  const usable = nodes.filter((n) => n.rest && n.mid && n.rest.w >= MIN_NODE_PX && n.rest.h >= MIN_NODE_PX);
  const checked = usable.map((n) => ({ id: n.id, ...nodeVerdict(n.rest, n.mid, k, anchor, tol), observed: observedScale(n.rest, n.mid) }));
  const failed = checked.filter((c) => !c.ok);
  const dx = diagnose(k, checked.map((c) => c.observed));
  const problems = [...armed.problems];
  if (!usable.length) problems.push("no node was big enough on screen to check — the harness observed nothing (this is a FAILURE, not a pass)");
  if (failed.length) {
    problems.push(`${failed.length}/${checked.length} nodes are not where an anchored zoom would put them (worst ${failed.reduce((m, f) => Math.max(m, f.worst), 0).toFixed(2)} px) — mechanism: ${dx.mechanism}, observed scale ${dx.observedScale?.toFixed(4)} against k ${k.toFixed(4)}`);
  }
  /* SETTLE PARITY. Dropping the anchor must not MOVE anything: the anchored frame and the re-baked
     frame are the same picture geometrically (VIEWPORT-STABLE — no jump). This is the half that
     catches an anchor whose composition is self-consistent but disagrees with the settled render. */
  let settleFailed = [];
  if (settle && settle.length) {
    settleFailed = settle.filter((s) => s.mid && s.settled
      && Math.max(Math.abs(s.mid.x - s.settled.x), Math.abs(s.mid.y - s.settled.y),
        Math.abs(s.mid.w - s.settled.w), Math.abs(s.mid.h - s.settled.h)) > tol);
    if (settleFailed.length) problems.push(`${settleFailed.length}/${settle.length} nodes JUMPED when the gesture settled — the anchored frame and the re-baked frame disagree`);
  }
  return {
    ok: problems.length === 0,
    problems,
    armed: armed.armed,
    k,
    mechanism: dx.mechanism,
    observedScale: dx.observedScale,
    checkedCount: checked.length,
    failedCount: failed.length,
    settleJumped: settleFailed.length,
    worstPx: checked.reduce((m, c) => Math.max(m, c.worst), 0),
    failures: failed.slice(0, 8),
    jumps: settleFailed.slice(0, 8),
  };
}
