/* perfBudgetPolicy — how a measured number is judged against the committed budget (NEW-1).
 *
 * THE PROBLEM THIS REPLACES. Every byte ceiling had been hand-pinned to within a rounding
 * error of the measurement it was seeded from: on 2026-07-30 `largestChunkBytes` measured
 * 1707.9 KB against a 1709.0 KB ceiling — 1.1 KB, 0.06% — and `totalJsBytes` sat 3 KB under
 * its own. Three consecutive pull requests (#858 ×4, #859 ×2, #860) failed the gate on
 * breaches of 0.8–0.9%, which is not a regression, it is a rounding error with a red X next
 * to it. That directly contradicts what perf-budgets.json says it does: "seeded from the
 * baseline PLUS headroom, so it is green on day one and only trips on a real regression."
 *
 * THE FIX IS A POLICY, NOT THREE BIGGER NUMBERS. Bumping the three ceilings by hand is the
 * exact failure mode the budget file forbids, and it would recur on the next feature. So:
 *
 *   1. A byte metric no longer stores a ceiling at all. It stores a `baseline` — the last
 *      DELIBERATELY recorded measurement — and the ceiling is DERIVED:
 *
 *          ceiling = baseline + max(baseline × pctOfBaseline, minBytes)
 *
 *      with the band committed once, in one place (`bundle.headroom`), rather than implied
 *      by 3 hand-typed numbers that each drift on their own.
 *
 *   2. Growth INSIDE the band is reported LOUDLY and does not fail: `⚠ ABOVE BASELINE`,
 *      naming the item that owns closing the gap. Growth BEYOND the band still fails hard,
 *      exactly as before. So an ordinary feature ships and is still visible in the log; a
 *      genuine regression is still red.
 *
 *   3. The baseline moves DOWN only through a named step that demands a reason
 *      (`scripts/perf-ratchet.mjs`, `npm run perf:ratchet`), which appends to
 *      `bundle.ratchetLog`. It never moves as a side effect of an ordinary merge, because
 *      nothing in the merge path writes it. `test/perfBudgetPolicy.test.js` asserts every
 *      baseline matches the latest logged entry for its metric — so a hand-edited baseline
 *      with no stated reason goes red in CI.
 *
 * Count metrics (siteRouteChunks) keep a hard `ceiling` and get no band: "4 chunks + 2%" is
 * not a meaningful sentence, and the chunk count is a structural guard, not a size.
 */

export const DEFAULT_HEADROOM = { pctOfBaseline: 0.02, minBytes: 32768 };

/** The headroom band above a baseline, in bytes. */
export function headroomFor(baseline, headroom = DEFAULT_HEADROOM) {
  const pct = headroom.pctOfBaseline ?? DEFAULT_HEADROOM.pctOfBaseline;
  const min = headroom.minBytes ?? DEFAULT_HEADROOM.minBytes;
  return Math.max(Math.round(baseline * pct), min);
}

/** The derived ceiling for a spec. Byte metrics derive it; count metrics state it outright. */
export function ceilingFor(spec, headroom = DEFAULT_HEADROOM) {
  if (typeof spec.baseline === "number") return spec.baseline + headroomFor(spec.baseline, headroom);
  return spec.ceiling;
}

/**
 * Classify a measured value. Four outcomes, only one of which fails:
 *   pass          — at or under target. Nothing to say.
 *   aboveTarget   — over the aspirational target but at or under the recorded baseline.
 *   aboveBaseline — over the baseline but inside the headroom band. LOUD, not fatal.
 *   breach        — over the derived ceiling. Fails the build.
 */
export function classify(value, spec, headroom = DEFAULT_HEADROOM) {
  const ceiling = ceilingFor(spec, headroom);
  const baseline = typeof spec.baseline === "number" ? spec.baseline : null;
  const band = baseline == null ? null : headroomFor(baseline, headroom);
  const row = { value, spec, ceiling, baseline, band, target: spec.target ?? null, unit: spec.unit || "bytes" };
  if (value > ceiling) {
    return { ...row, status: "breach", delta: value - ceiling, pct: (value / ceiling - 1) * 100 };
  }
  if (baseline != null && value > baseline) {
    return { ...row, status: "aboveBaseline", overBaseline: value - baseline, bandLeft: ceiling - value };
  }
  if (row.target != null && value > row.target) {
    return { ...row, status: "aboveTarget", gap: value - row.target };
  }
  return { ...row, status: "pass" };
}

/** True when this metric's ceiling is derived from a baseline rather than hand-pinned. */
export const isBanded = (spec) => typeof spec?.baseline === "number";

/* ---- B266084 — WHOSE BYTES ARE THESE? ---------------------------------------------------
 *
 * THE DEFECT THIS CLOSES, measured rather than argued. Growth that stays INSIDE the band is
 * annotated and passes, and — by design — writes NOTHING. So `main` accumulates real, honest
 * feature weight above its own recorded baseline, invisibly, one in-band merge at a time,
 * until some later branch adds its first kilobyte and trips a ceiling that was already ~90%
 * consumed before it existed. That branch is then told to "pay it back with an optimization"
 * for bytes it did not add, and its only way out is to RAISE the baseline by everyone else's
 * drift. That happened FIVE times in the nine days after B1178 was filed — B1401, B1405,
 * B1414, B209502 and B255200 each carry a ratchet reason that says some version of "main was
 * already N KB above this stale baseline before this branch", the largest of them 73.6 KB.
 * Every one of those entries is honest and every one of them launders drift into the record.
 *
 * THE FIX IS TO CHARGE EACH SIDE ITS OWN BYTES, and the measurement to do it is already being
 * taken: `scripts/perf-base-stats.mjs` builds the base ref on every CI run for the NEW-3 byte
 * attribution. It was only ever used to NAME movers, never to judge. Now:
 *
 *   inherited = base − baseline   what main already carried above its own record
 *   branch    = value − base      what THIS branch actually added
 *
 *   • A branch FAILS for its own growth: `branch > band`, or an over-ceiling value when main
 *     was clean (`inherited <= 0`) so every byte of the overage is its own.
 *   • A branch does NOT fail for `inherited`. It cannot fix it and must not be extorted for it.
 *   • `main` gets NO such relief — see the caller: attribution applies to a pull request only.
 *     A push to main is judged on what main IS, so the drift surfaces on main, where a real
 *     ratchet with a real reason is the right answer, instead of on a stranger's branch.
 *
 * `inherited` is REPORTED ON EVERY RUN, breach or not, so the accumulation can never again be
 * invisible until it is 73.6 KB deep.
 *
 * Returns null when there is no base measurement or the metric is not banded — callers then
 * keep the un-attributed verdict, so this can only ever make the gate FAIRER, never blinder.
 */
export function attribute(value, base, spec, headroom = DEFAULT_HEADROOM) {
  if (typeof base !== "number" || !Number.isFinite(base) || !isBanded(spec)) return null;
  const baseline = spec.baseline;
  const ceiling = ceilingFor(spec, headroom);
  const band = headroomFor(baseline, headroom);
  const branch = value - base;
  const inherited = base - baseline;
  const overCeiling = value - ceiling;
  const branchOverBand = branch - band;

  let charged = null;
  if (branchOverBand > 0) charged = "branch";            // this branch alone consumes the whole band
  else if (overCeiling > 0) charged = inherited > 0 ? "base" : "branch";

  return { base, baseline, ceiling, band, branch, inherited, overCeiling, branchOverBand, charged };
}

/** Metrics in perf-budgets.json `bundle` that are real metrics (not config/comment keys). */
export const METRIC_KEYS = (bundle) =>
  Object.keys(bundle).filter((k) => !k.startsWith("$") && k !== "headroom" && k !== "ratchetLog" && k !== "siteRouteAllowlist");
