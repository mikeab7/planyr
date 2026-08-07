/* pondPan — the pure half of the "add one detention pond and the pan gets slow" probe (NEW-1).
 *
 * ⛔ WHY THIS IS A PAIRED INSTRUMENT AND NOT A LADDER, which is the one design decision everything
 * else here depends on.
 *
 * `session-axes.mjs` measures a LADDER: rung 0, rung 1, rung 2 … each rung probed as a median, the
 * noise floor measured on the same estimator, and a slope fitted through the rungs. That shape is
 * right when the axis has many rungs and the question is "how does cost grow with N".
 *
 * This question is not that. The owner named a SINGLE ACTION — *"I just added a detention pond, and
 * now it's running super slow again"* — so the measurement that answers it is one gesture measured
 * with the pond ABSENT and the same gesture measured with the pond PRESENT, on the same page, in the
 * same session, alternating. That is a PAIRED difference, and pairing is worth a great deal here:
 * every slow drift this sandbox has (V8 tiering up, tile decode settling, GC phase, the machine's
 * own thermal state) moves BOTH members of a pair in the same direction and cancels out of their
 * difference. An unpaired before-block-then-after-block design would fold all of that drift straight
 * into the answer, and on this machine the drift is the same order as the effect being hunted.
 *
 * So the estimator is: the MEDIAN OF THE PER-PAIR PERCENTAGE DIFFERENCES, and the noise floor is the
 * spread of the SAME estimator computed on NULL pairs — pairs where the "add a pond" step is
 * replaced by a step that adds nothing. A floor measured on single probes and applied to a median of
 * paired differences is wrong in two independent ways at once (the pairing and the median each
 * shrink it), and `session-axes.mjs`'s own header records that exact mistake costing a real finding.
 *
 * ⛔ INCONCLUSIVE IS A FIRST-CLASS OUTCOME. If the paired difference does not clear the floor
 * measured on null pairs, this file says so and says how big an effect the run COULD have seen.
 * It never rounds a sub-floor difference up into a finding.
 *
 * Pure — no Playwright, no DOM, no clock — so it unit-tests without a browser and the rule cannot
 * drift between what the harness checks and what the report claims.
 */

/** Median of a numeric array (lower median on an even count, so it is always an observed value). */
export const median = (a) => {
  const s = (a || []).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

/** Percentage change from `a` to `b`, or null when `a` is not a usable base. */
export const pctDelta = (a, b) =>
  Number.isFinite(a) && Number.isFinite(b) && a > 0 ? +(((b - a) / a) * 100).toFixed(2) : null;

/**
 * One arm's paired result.
 *
 * `pairs` are `{ before, after }` in whatever cost unit the harness measured (here: script + layout
 * + style ms per identical gesture). Returns the per-pair deltas, their median, and the observed
 * spread — the ingredients of a verdict, with the verdict itself left to `armVerdict` so a caller
 * can compute an arm without yet knowing the floor.
 */
export function pairedDelta(pairs = []) {
  const rows = [];
  for (const p of pairs) {
    const d = pctDelta(p?.before, p?.after);
    if (d == null) continue;
    rows.push({ before: p.before, after: p.after, deltaPct: d, deltaMs: +(p.after - p.before).toFixed(2) });
  }
  if (!rows.length) return { n: 0, deltaPct: null, deltaMs: null, spreadPct: null, rows: [] };
  const deltas = rows.map((r) => r.deltaPct);
  return {
    n: rows.length,
    deltaPct: median(deltas),
    deltaMs: median(rows.map((r) => r.deltaMs)),
    spreadPct: +(Math.max(...deltas) - Math.min(...deltas)).toFixed(2),
    beforeMs: median(rows.map((r) => r.before)),
    afterMs: median(rows.map((r) => r.after)),
    rows,
  };
}

/**
 * The noise floor for a paired estimator: the spread of the SAME statistic over NULL pairs.
 *
 * A null pair probes the identical scene twice with nothing done in between, so its "delta" is pure
 * measurement noise. The floor is the half-range of those null deltas about zero — i.e. the largest
 * apparent effect this instrument produces when there is provably no effect at all. Deliberately a
 * RANGE and not a standard deviation: with a handful of pairs an sd is an over-confident number, and
 * a floor that is too small is the failure mode that manufactures findings.
 */
export function nullFloor(nullDeltas = []) {
  const d = (nullDeltas || []).filter(Number.isFinite);
  if (d.length < 2) return { floorPct: null, n: d.length, why: "fewer than two null pairs — no floor can be stated, so no difference can be called real" };
  const lo = Math.min(...d), hi = Math.max(...d);
  return {
    floorPct: +Math.max(Math.abs(lo), Math.abs(hi)).toFixed(2),
    n: d.length, min: +lo.toFixed(2), max: +hi.toFixed(2),
    why: `${d.length} null pairs (the same scene probed twice, nothing added in between) spanned ${lo.toFixed(1)}% … ${hi.toFixed(1)}%`,
  };
}

/**
 * Does this arm's paired difference clear the floor?
 *
 * Three outcomes and no fourth: COSTS MORE, COSTS LESS, INCONCLUSIVE. An INCONCLUSIVE arm reports
 * the smallest effect the run could have detected, because "we saw nothing" and "we could not have
 * seen it" are different results and conflating them is how a hypothesis gets falsely killed.
 */
export function armVerdict({ deltaPct, floorPct, label = "the arm" } = {}) {
  if (!Number.isFinite(deltaPct)) return { verdict: "unmeasured", why: `${label} produced no reportable paired difference` };
  if (!Number.isFinite(floorPct)) return { verdict: "inconclusive", why: "no null-pair floor could be stated, so no difference can be called real", deltaPct };
  if (deltaPct > floorPct) {
    return { verdict: "COSTS MORE", deltaPct, floorPct, why: `${label} makes the identical gesture ${deltaPct.toFixed(1)}% dearer, clearing the ±${floorPct}% null-pair floor` };
  }
  if (deltaPct < -floorPct) {
    return { verdict: "COSTS LESS", deltaPct, floorPct, why: `${label} makes the identical gesture ${(-deltaPct).toFixed(1)}% CHEAPER, clearing the ±${floorPct}% null-pair floor — which is a result, not a rounding error` };
  }
  return {
    verdict: "INCONCLUSIVE", deltaPct, floorPct,
    why: `${label} moved the identical gesture by ${deltaPct.toFixed(1)}%, inside the ±${floorPct}% null-pair floor — this run could only have detected an effect larger than ±${floorPct}%`,
  };
}

/**
 * Fixed-per-pond, linear-in-ponds, or superlinear?
 *
 * `rungs` are `{ n, deltaPct }` — the paired difference against the SAME baseline for n = 1, 2, 3…
 * ponds added. The distinction decides the fix, which is the whole reason the item asks for it:
 *
 *   FIXED       the first pond costs and the rest are ~free → a one-off per-scene cost (a memo that
 *               invalidates once, a gate that flips) — fix the gate.
 *   LINEAR      each pond costs about the same again → a per-pond per-frame cost — fix the per-pond
 *               work (memoise it, or move it off the frame).
 *   SUPERLINEAR each pond costs more than the last → a pairwise interaction (collision, declutter,
 *               a dissolve over all of them) — fix the algorithm, not the caching.
 *
 * The classification is stated against the floor: rungs whose difference from the linear prediction
 * is inside the floor cannot be told apart, and this returns UNRESOLVED rather than guessing.
 */
export function scalingShape(rungs = [], floorPct = null) {
  const pts = (rungs || [])
    .filter((r) => r && Number.isFinite(r.n) && r.n > 0 && Number.isFinite(r.deltaPct))
    .sort((a, b) => a.n - b.n);
  if (pts.length < 2) return { shape: "unresolved", why: "fewer than two pond counts were measured, so no shape can be told from another" };
  const first = pts[0], last = pts[pts.length - 1];
  if (!Number.isFinite(floorPct)) return { shape: "unresolved", why: "no floor could be stated, so a shape cannot be distinguished from noise", points: pts.length };

  // What LINEAR would predict at the last rung, from the first rung's own cost per pond.
  const perPond = first.deltaPct / first.n;
  const linearAtLast = perPond * last.n;
  const fixedAtLast = first.deltaPct;
  const dLinear = Math.abs(last.deltaPct - linearAtLast);
  const dFixed = Math.abs(last.deltaPct - fixedAtLast);

  // If the whole span is inside the floor there is nothing to shape at all.
  if (Math.abs(last.deltaPct) <= floorPct && Math.abs(first.deltaPct) <= floorPct) {
    return { shape: "no effect", why: `every pond count moved the gesture by less than the ±${floorPct}% floor`, points: pts.length, perPondPct: +perPond.toFixed(2) };
  }
  if (dFixed <= floorPct && dLinear > floorPct) {
    return { shape: "FIXED", why: `${last.n} ponds cost ${last.deltaPct.toFixed(1)}%, indistinguishable from one pond's ${first.deltaPct.toFixed(1)}% (linear would predict ${linearAtLast.toFixed(1)}%) — the cost is per-SCENE, not per-pond`, points: pts.length, perPondPct: +perPond.toFixed(2), linearAtLast: +linearAtLast.toFixed(2) };
  }
  if (dLinear <= floorPct && dFixed > floorPct) {
    return { shape: "LINEAR", why: `${last.n} ponds cost ${last.deltaPct.toFixed(1)}%, matching the ${linearAtLast.toFixed(1)}% a per-pond cost predicts from one pond's ${first.deltaPct.toFixed(1)}%`, points: pts.length, perPondPct: +perPond.toFixed(2), linearAtLast: +linearAtLast.toFixed(2) };
  }
  if (last.deltaPct > linearAtLast + floorPct) {
    return { shape: "SUPERLINEAR", why: `${last.n} ponds cost ${last.deltaPct.toFixed(1)}%, more than the ${linearAtLast.toFixed(1)}% a per-pond cost predicts — suspect an interaction between ponds, not a per-pond cost`, points: pts.length, perPondPct: +perPond.toFixed(2), linearAtLast: +linearAtLast.toFixed(2) };
  }
  return { shape: "unresolved", why: `${last.n} ponds cost ${last.deltaPct.toFixed(1)}%; fixed predicts ${fixedAtLast.toFixed(1)}% and linear predicts ${linearAtLast.toFixed(1)}%, and the ±${floorPct}% floor cannot separate them`, points: pts.length, perPondPct: +perPond.toFixed(2), linearAtLast: +linearAtLast.toFixed(2) };
}

/**
 * The attribution ledger's completeness, in the shape B1431/B1448 fixed as the standard: how much of
 * the profiled window landed outside every named rule. B1448 held UNATTRIBUTED at 0.0% and that is
 * the bar; a table with a large unattributed remainder is a table that has not found the cost yet.
 */
export function attributionQuality(attribution, { standardPct = 0.8 } = {}) {
  const total = attribution?.totalMs;
  if (!Number.isFinite(total) || total <= 0) return { unattributedMs: null, unattributedPct: null, meetsStandard: null, standardPct };
  const un = (attribution.phases || []).find((p) => p.phase === "UNATTRIBUTED");
  const ms = un ? un.ms : 0;
  const pctv = +((ms / total) * 100).toFixed(2);
  return { unattributedMs: +ms.toFixed(2), unattributedPct: pctv, meetsStandard: pctv <= standardPct, standardPct };
}

/**
 * Self-time per FUNCTION, biggest first — the row a phase table cannot give you.
 *
 * A phase table answers "which module got dearer"; it cannot answer "which function", and on a
 * hypothesis as specific as *"`pondContours` is being re-run inside the render body on every
 * frame"* the function name IS the finding. This aggregates the CDP profile's own self-time
 * (`timeDeltas` against the sampled leaf node) by resolved source location, so a name here is a
 * line of code and not a minified symbol.
 *
 * `resolve(frame)` is the same injected source-map resolver `attributeProfile` takes, kept
 * injected for the same reason: this file stays pure and the IO lives in the caller.
 */
export function topFunctions(profile, resolve, n = 15) {
  const byId = new Map((profile?.nodes || []).map((f) => [f.id, f]));
  const acc = new Map();
  const samples = profile?.samples || [];
  const deltas = profile?.timeDeltas || [];
  let totalUs = 0;
  for (let i = 0; i < samples.length; i++) {
    const dt = deltas[i] || 0;
    const node = byId.get(samples[i]);
    if (!node) continue;
    const frame = node.callFrame || {};
    const src = resolve ? resolve(frame) : null;
    const where = src ? `${src}:${(frame.lineNumber || 0) + 1}` : (frame.url || "(native)").split("/").pop();
    const key = `${frame.functionName || "(anonymous)"} — ${where}`;
    acc.set(key, (acc.get(key) || 0) + dt);
    totalUs += dt;
  }
  return [...acc.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([fn, us]) => ({ fn, ms: +(us / 1000).toFixed(2), pct: totalUs ? +((us / totalUs) * 100).toFixed(2) : 0 }));
}

/**
 * Which named phases MOVED between two attributions of the same gesture?
 *
 * Two profiles of the same probe — one without the pond, one with — differ in total, so a phase's
 * share can rise while its cost falls. This compares ABSOLUTE ms per phase and returns the movers
 * biggest-first, which is what turns "the pan got dearer" into "and here is the code that got
 * dearer". Phases present in only one profile are reported at zero on the missing side rather than
 * dropped, because a phase that appears ONLY with the pond present is the most interesting row
 * there is.
 */
export function phaseDelta(beforeAttribution, afterAttribution) {
  const idx = (a) => {
    const m = new Map();
    for (const p of a?.phases || []) m.set(p.phase, p.ms);
    return m;
  };
  const b = idx(beforeAttribution), a = idx(afterAttribution);
  const names = new Set([...b.keys(), ...a.keys()]);
  const rows = [];
  for (const name of names) {
    const bv = b.get(name) || 0, av = a.get(name) || 0;
    rows.push({ phase: name, beforeMs: +bv.toFixed(2), afterMs: +av.toFixed(2), deltaMs: +(av - bv).toFixed(2) });
  }
  rows.sort((x, y) => y.deltaMs - x.deltaMs);
  return rows;
}
