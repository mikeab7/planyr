/* interactionAxis — the pure half of the INTERACTION-COUNT degradation probe (NEW-1).
 *
 * WHY A THIRD AXIS EXISTS AT ALL, and why nothing in the speed program could see it.
 *
 * Every degradation instrument this repo has built varies one of two things:
 *   • ui-audit/lib/longSession.mjs (B1357) varies HOW MUCH IS DRAWN — its `grow` arm adds
 *     elements, and its finding was that cost tracks the model (r = 0.93 against document
 *     nodes). Its `hold` arm ran FIVE rounds and came back within noise.
 *   • ui-audit/lib/bootTimeline.mjs (B1431) varies nothing at all — it attributes one window.
 * The owner's actual complaint fits NEITHER. "Reload, it's quick; pan and zoom for a minute or
 * two, it's lagging just to go side to side" holds the drawing CONSTANT — same plan, same
 * elements, same layers — and varies only how many times the view has been moved. A pan does
 * not change what is drawn, so the r = 0.93 finding cannot explain it; and it is not wall-clock
 * either, because an idle tab does not develop the symptom. The axis is INTERACTION COUNT ON
 * CONSTANT CONTENT, and it has never been varied by any instrument here.
 *
 * THE TWO GUARDS BELOW ARE WHAT MAKE THAT AXIS MEASURABLE, and they pull in opposite directions:
 *   1. the probe must MOVE the view, or it is sampling an idle page (frameSampling.mjs's
 *      idleGestureFault — the trap that shipped a 16.7 ms "pan");
 *   2. the probe must RETURN the view exactly where it started, or checkpoint N and checkpoint 0
 *      are looking at different amounts of scene and the whole control collapses back into the
 *      already-known "how much is drawn" axis.
 * Nothing else in the repo asserts (2), because nothing else in the repo needed the content to be
 * constant. A probe that drifts is not a slower probe — it is a different probe, and its trend is
 * uninterpretable.
 *
 * Pure → unit-tested, and shared with ui-audit/interaction-degradation.mjs so the rule cannot
 * drift between what the harness checks and what the report claims.
 */

/* ── The probe's own validity ──────────────────────────────────────────────────────────────── */

/* The view transform, as one comparable string. Whatever the harness reads off the canvas, both
 * ends of a probe must read it the same way — so the formatting lives here, once. */
export const viewKey = (v) =>
  v == null ? null : `${v.offX}|${v.offY}|${v.ppf}`;

/* THE PROBE IS ONLY COMPARABLE IF IT IS VIEWPORT-NEUTRAL. Returns the reason this probe's numbers
 * may NOT be placed on a trend line, or null when they may. `mid` is the view sampled part-way
 * through (after the outbound half); `after` is the view once the probe has finished.
 *
 * Deliberately TWO separate messages: "it never moved" and "it moved and did not come back" are
 * different bugs in the harness with different fixes, and collapsing them into "invalid probe"
 * is how a measurement gets quietly re-run until it passes. */
export function probeValidityFault({ before, mid, after, tolerance = 0 }) {
  const b = viewKey(before), m = viewKey(mid), a = viewKey(after);
  if (b == null || a == null) return "the canvas published no view transform — there is nothing to compare, so this probe measures an unknown scene";
  if (m != null && m === b) {
    return "the view did not move during the probe — the press did not land where it could drive one, so the sample describes an IDLE page (see idleGestureFault in lib/frameSampling.mjs)";
  }
  if (a === b) return null;
  const drift = viewDrift(before, after);
  if (drift != null && tolerance > 0 && drift <= tolerance) return null;
  return `the view did not return to where the probe started (${b} → ${a}) — checkpoint N is therefore looking at a DIFFERENT amount of scene than checkpoint 0, which is the "how much is drawn" axis this probe exists to hold constant`;
}

/* How far off neutral a probe finished, as a single scalar the caller can compare against a
 * tolerance. Offsets are in canvas pixels and ppf is a scale, so the scale term is expressed as
 * the pixel error it would cause across a nominal 1000 px viewport rather than summed raw. */
export function viewDrift(before, after) {
  if (!before || !after) return null;
  const dx = Number(after.offX) - Number(before.offX);
  const dy = Number(after.offY) - Number(before.offY);
  const p0 = Number(before.ppf), p1 = Number(after.ppf);
  if (![dx, dy, p0, p1].every(Number.isFinite) || !p0) return null;
  const scaleErrPx = Math.abs(p1 / p0 - 1) * 1000;
  return +Math.sqrt(dx * dx + dy * dy + scaleErrPx * scaleErrPx).toFixed(3);
}

/* ── Growth, per interaction ──────────────────────────────────────────────────────────────── */

/* Least-squares slope of v against n, plus the correlation. The DELIVERABLE this whole item asks
 * for is "a named growth rate", and a named growth rate is a slope — not a from/to pair, which
 * cannot tell a step at load from a per-interaction cost. Returns null rather than NaN for a
 * degenerate series, so a counter that never varied reads as "flat", never as a number. */
export function linearGrowth(points) {
  const pts = (points || []).filter((p) => p && Number.isFinite(p.n) && Number.isFinite(p.v));
  if (pts.length < 2) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.n, 0) / n;
  const my = pts.reduce((s, p) => s + p.v, 0) / n;
  let num = 0, dxx = 0, dyy = 0;
  for (const p of pts) { const a = p.n - mx, b = p.v - my; num += a * b; dxx += a * a; dyy += b * b; }
  if (!dxx) return null;
  const slope = num / dxx;
  const r = dyy ? num / Math.sqrt(dxx * dyy) : null;
  return { slope, r: r == null ? null : +r.toFixed(3), intercept: my - slope * mx, n };
}

/* One row of the growth table: what this counter did across the run, and what it costs PER
 * INTERACTION. `perInteraction` is the slope; `total` is the honest endpoint delta beside it,
 * because a counter that steps once at load and then sits flat has a real delta and a
 * meaningless slope, and the reader must be able to tell those apart. */
export function growthRow(counter, points, { unit = "", decimals = 2 } = {}) {
  const pts = (points || []).filter((p) => p && Number.isFinite(p.n) && Number.isFinite(p.v));
  if (!pts.length) return { counter, unit, from: null, to: null, total: null, perInteraction: null, r: null, verdict: "unmeasured" };
  const from = pts[0].v, to = pts[pts.length - 1].v;
  const g = linearGrowth(pts);
  const span = pts[pts.length - 1].n - pts[0].n;
  const round = (x) => (x == null ? null : +x.toFixed(decimals));
  const flat = from === to && pts.every((p) => p.v === from);
  return {
    counter, unit, from, to,
    total: round(to - from),
    perInteraction: g && span > 0 ? +g.slope.toFixed(decimals + 3) : null,
    r: g ? g.r : null,
    verdict: flat ? "FLAT" : to > from ? "grows" : "shrinks",
  };
}

/* The whole table, in a fixed order so two runs print comparably. `keys` is
 * [{ counter, unit, decimals }] and `checkpoints` is [{ n, counters }]. */
export function buildGrowthTable(checkpoints, keys) {
  return (keys || []).map((k) =>
    growthRow(k.counter, (checkpoints || []).map((c) => ({ n: c.n, v: c.counters?.[k.counter] })), k),
  );
}

/* ── The verdict ──────────────────────────────────────────────────────────────────────────── */

/* WHICH AXIS DID THE COST TRACK? The `interact` arm drives real gestures between checkpoints; the
 * `idle` arm waits the SAME wall-clock and takes the SAME probes, so it holds interaction count
 * near zero while holding everything else — time since load, probe count, GC opportunity — equal.
 *
 * Four outcomes, and INCONCLUSIVE is a real one. The failure this shape exists to prevent is
 * reporting "it degrades" from an arm that would have degraded sitting still.
 */
export function axisVerdict({ interactCosts = [], idleCosts = [], floorPct = null, checkpointNs = [] } = {}) {
  const clean = (a) => a.filter((x) => typeof x === "number" && x > 0);
  const iv = clean(interactCosts), dv = clean(idleCosts);
  if (iv.length < 3) return { verdict: "unmeasured", why: "the interact arm produced fewer than three reportable checkpoints" };
  if (floorPct == null) return { verdict: "inconclusive", why: "no noise floor could be stated, so no move can be called real" };

  const rise = (a) => +(((a[a.length - 1] - a[0]) / a[0]) * 100).toFixed(1);
  const iPct = rise(iv);
  const dPct = dv.length >= 3 ? rise(dv) : null;
  // A trend, not an endpoint: the last TWO checkpoints must both clear the floor upward, the same
  // rule sustainedVerdict applies in longSession.mjs, for the same reason (one point is a fluke).
  const over = (x) => ((x - iv[0]) / iv[0]) * 100 > floorPct;
  const sustained = iv.length >= 3 && over(iv[iv.length - 1]) && over(iv[iv.length - 2]);

  if (!sustained) {
    return {
      verdict: iPct > floorPct ? "unsustained" : "INCONCLUSIVE",
      interactRisePct: iPct, idleRisePct: dPct, floorPct,
      why: iPct > floorPct
        ? "only the final checkpoint cleared the floor — one point is not a trend"
        : `the identical probe did NOT get slower as interactions accumulated (+${iPct}% across ${checkpointNs[0] ?? 0}→${checkpointNs[checkpointNs.length - 1] ?? "N"} interactions, inside the ±${floorPct}% floor). On this axis, in this environment, the r=0.93 "how much is drawn" finding is NOT refuted.`,
    };
  }
  if (dPct != null && dPct > floorPct) {
    return {
      verdict: "TIME-OR-PROBE-BOUND", interactRisePct: iPct, idleRisePct: dPct, floorPct,
      why: `both arms degraded (+${iPct}% interacting vs +${dPct}% idling for the same wall clock), so the cost is NOT bound to interaction count — something that runs regardless of input is responsible.`,
    };
  }
  return {
    verdict: "INTERACTION-BOUND", interactRisePct: iPct, idleRisePct: dPct, floorPct,
    why: `the IDENTICAL probe on UNCHANGED content got ${iPct}% slower across ${checkpointNs[checkpointNs.length - 1] ?? "N"} interactions while the idle arm moved ${dPct == null ? "not measurably" : `${dPct}%`} over the same wall clock. The owner is right, and the r=0.93 "cost tracks how much is drawn" finding does not cover this axis.`,
  };
}

/* Pearson r. Same formula as longSession.mjs's, duplicated deliberately rather than imported:
 * that module owns a whole protocol and importing it here would drag a browser harness's worth of
 * dependencies into a pure file the unit tests load directly. */
export function pearson(a, b) {
  const n = a.length;
  if (n < 3 || b.length !== n) return null;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  if (!da || !db) return null;
  return num / Math.sqrt(da * db);
}

/* Which growth rows are candidate mechanisms: the ones that grow AND track the measured cost.
 * Correlation over five checkpoints is weak evidence and is labelled as such — this names
 * suspects, it never convicts one, and a counter that stayed FLAT is exonerated outright. */
export function suspects(table, checkpoints, costKey = "probeMedianMs") {
  const cost = (checkpoints || []).map((c) => c[costKey]).filter((x) => typeof x === "number");
  return (table || [])
    .filter((row) => row.verdict === "grows" && row.perInteraction)
    .map((row) => {
      const v = (checkpoints || []).map((c) => c.counters?.[row.counter]).filter((x) => typeof x === "number");
      const r = v.length === cost.length ? pearson(cost, v) : null;
      return { ...row, rVsCost: r == null ? null : +r.toFixed(2) };
    })
    .sort((a, b) => Math.abs(b.rVsCost ?? 0) - Math.abs(a.rVsCost ?? 0));
}
