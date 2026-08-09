/* viewIndependence — the CLASSIFIER: given what the probe recorded during one gesture, decide
 * which computations broke the VIEW-INDEPENDENT-ONCE rule, and rank them.
 *
 * WHY THIS IS ITS OWN PURE MODULE (NEW-1).
 * The detector's verdict has to be reproducible and arguable. If "is this a violation?" lived
 * inside the browser probe or inside the harness's print loop, the only way to check the rule
 * would be to re-run the whole instrument — and the two defects this program has already found
 * BY ACCIDENT (#926's `f2p = worldToScreen(view, …)`, and the pond label fit re-solved every
 * frame) would each have been a judgement call rather than a measurement. The rule is stated
 * here, once, in pure functions with unit tests (test/recomputeProbe.test.js).
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────
 * THE RULE, AND THE FOUR VERDICTS IT PRODUCES
 *
 * A gesture that changes ONLY the view (a pan at constant px-per-foot; a wheel zoom, which
 * changes exactly one scalar) is driven while the MODEL AND SETTINGS ARE FROZEN. Under that
 * control, every recorded computation falls into exactly one of:
 *
 *   `once`          ran 0 or 1 times across the whole gesture. Correct, and the target state
 *                   for anything whose inputs are model + settings.
 *
 *   `redundant`     ran N > 1 times, and at least one INPUT fingerprint repeats with the SAME
 *                   result. Pure waste: the same question was asked twice and answered twice.
 *                   This is a missing memo, not a mis-keyed one.
 *
 *   `view-churned`  ran N > 1 times, every run produced an IDENTICAL RESULT, and the inputs
 *                   DID differ. ⛔ THIS IS THE CLASS THE OWNER NAMED. The inputs differ only
 *                   because a view term (offX/offY/ppf/zoom/a live `view` object) is inside the
 *                   memo key; the answer does not depend on it, so the computation re-derives a
 *                   value it already had, once per frame, forever. Both known instances are
 *                   this verdict.
 *
 *   `productive`    ran N > 1 times and produced more than one distinct result. The view moved
 *                   and the answer genuinely moved with it. NOT a violation — the cull rect,
 *                   the scale bar, the north arrow and the LOD gates all live here and must.
 *
 * ⛔ AND THE INVERSE CHECK, which is a separate question and is NOT a violation of this rule.
 * A computation that is genuinely view-derived but is memoised so aggressively that it does NOT
 * recompute when the view legitimately changes is a CORRECTNESS bug in the other direction.
 * `inverseFindings` reports any site the caller declares view-derived (`expectViewDerived`)
 * whose result never changed across a ZOOM — the gesture under which a real px-per-foot
 * consumer must change. It is reported separately and never merged into the violation list,
 * because "fixing" it means the opposite edit.
 * ───────────────────────────────────────────────────────────────────────────────────────────
 */

/** One recorded site, as the browser probe emits it. Shape documented here so the tests and the
 *  runtime cannot drift:
 *    { id, kind:'memo'|'fn', file, line, col, name,
 *      calls, renders, ms, inputs:string[], results:string[], truncated:boolean } */

export const VERDICTS = ["view-churned", "redundant", "productive", "once"];

/** Is this verdict a violation of VIEW-INDEPENDENT-ONCE? */
export const isViolation = (verdict) => verdict === "view-churned" || verdict === "redundant";

/**
 * Classify one site's record from a single gesture.
 * `inputs[i]` / `results[i]` are the fingerprints of call i. They may be SHORTER than `calls`
 * when the probe stopped fingerprinting a very hot site (`truncated`); the classifier then
 * reasons only about the calls it actually saw, and says so via `sampled`.
 */
export function classifySite(rec) {
  const calls = rec.calls | 0;
  const inputs = rec.inputs || [];
  const results = rec.results || [];
  const sampled = Math.min(inputs.length, results.length);
  const distinctInputs = new Set(inputs.slice(0, sampled)).size;
  const distinctResults = new Set(results.slice(0, sampled)).size;

  // Repeated (input → same result) pairs: the same question asked twice.
  const pairs = new Map();
  let repeatedPairs = 0;
  for (let i = 0; i < sampled; i++) {
    const k = `${inputs[i]}→${results[i]}`;
    const n = (pairs.get(k) || 0) + 1;
    pairs.set(k, n);
    if (n > 1) repeatedPairs++;
  }

  let verdict;
  if (calls <= 1) verdict = "once";
  else if (sampled === 0) verdict = "productive";           // ran hot, never fingerprinted — cannot accuse
  else if (repeatedPairs > 0) verdict = "redundant";
  else if (distinctResults === 1) verdict = "view-churned";
  else verdict = "productive";

  return {
    ...rec,
    verdict,
    violation: isViolation(verdict),
    calls,
    sampled,
    distinctInputs,
    distinctResults,
    repeatedPairs,
    msPerCall: calls ? +(rec.ms / calls).toFixed(4) : 0,
    /* What a fix is worth: everything after the first call is waste. Reported rather than the raw
     * `ms`, because a site that legitimately runs once should never appear to have a saving. */
    wasteMs: calls > 1 ? +(rec.ms * ((calls - 1) / calls)).toFixed(2) : 0,
  };
}

/** Classify a whole gesture's records. */
export function classifyGesture(records) {
  return (records || []).map(classifySite);
}

/**
 * How hard does this violation scale with the plan?
 * `ladder` is [{ n, ms, calls }, …] — the SAME site measured at rungs of increasing plan size.
 * Returns the least-squares slope of ms against n plus a plain-language shape, because the
 * owner's question is "does this get worse as I draw more?", not "what is the gradient".
 */
export function scaleSlope(ladder) {
  const pts = (ladder || []).filter((p) => Number.isFinite(p.n) && Number.isFinite(p.ms));
  if (pts.length < 2) return { slope: null, shape: "unmeasured", perUnitMs: null };
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p.n, 0);
  const sy = pts.reduce((a, p) => a + p.ms, 0);
  const sxx = pts.reduce((a, p) => a + p.n * p.n, 0);
  const sxy = pts.reduce((a, p) => a + p.n * p.ms, 0);
  const denom = n * sxx - sx * sx;
  if (!denom) return { slope: null, shape: "unmeasured", perUnitMs: null };
  const slope = (n * sxy - sx * sy) / denom;
  const mean = sy / n;
  // "Flat" means the growth across the whole ladder is small relative to the site's own cost —
  // an absolute ms threshold would call a cheap site steep and an expensive one flat.
  const span = Math.max(...pts.map((p) => p.n)) - Math.min(...pts.map((p) => p.n));
  const growth = Math.abs(slope * span);
  const shape = mean <= 0 ? "unmeasured" : growth < 0.15 * mean ? "flat" : "scales-with-plan";
  return { slope: +slope.toFixed(5), shape, perUnitMs: +slope.toFixed(5) };
}

/**
 * THE RANKING NEW-2 IS FIXED IN. The owner's instruction is literal: rank by
 * (ms per gesture × how much it scales with the plan) and fix downward.
 * A site that scales gets its slope folded in; a flat one is ranked on its cost alone, so a
 * genuinely expensive constant-cost violation is never sorted below a trivial scaling one.
 */
export function rankViolations(sites, { ladders = {}, planSpan = 1 } = {}) {
  return sites
    .filter((s) => s.violation)
    .map((s) => {
      const scale = scaleSlope(ladders[s.id]);
      const growthMs = scale.slope == null ? 0 : Math.max(0, scale.slope * planSpan);
      return { ...s, scale, priority: +(s.wasteMs + growthMs).toFixed(2) };
    })
    .sort((a, b) => b.priority - a.priority || b.calls - a.calls);
}

/**
 * The inverse check. `expectViewDerived` is the set of site ids the caller asserts MUST track the
 * view (cull rect, scale bar, north arrow, LOD gates). Under a ZOOM their result has to move.
 * A member whose result never moved is over-memoised — reported, never "fixed" by this program.
 */
export function inverseFindings(zoomSites, expectViewDerived = []) {
  // Matched on `file:NAME`, the same stable key the standing guard's registry uses — never the
  // probe's `file:line:col#memo` id, which moves on every unrelated edit above it.
  const want = new Set(expectViewDerived);
  const byId = new Map(zoomSites.map((s) => [`${s.file}:${s.name}`, s]));
  const out = [];
  for (const id of want) {
    const s = byId.get(id);
    if (!s) { out.push({ id, finding: "never-ran", note: "declared view-derived but did not execute during the zoom" }); continue; }
    if (s.distinctResults <= 1 && s.calls > 0) {
      out.push({ id, finding: "frozen-through-zoom", calls: s.calls, note: "declared view-derived but produced one result across the whole zoom" });
    }
  }
  return out;
}

/** A one-line-per-site table body, so the harness and the standing guard print identically. */
export function formatSite(s) {
  const where = `${s.file}:${s.line}`;
  const name = s.name ? ` ${s.name}` : "";
  return `${s.verdict.padEnd(13)} ${String(s.calls).padStart(5)}×  ${String(s.ms.toFixed(1)).padStart(7)} ms  ` +
    `in:${String(s.distinctInputs).padStart(3)} out:${String(s.distinctResults).padStart(3)}  ${where}${name}`;
}

/**
 * THE STANDING GUARD'S VERDICT (NEW-3). Given a pure-pan gesture's classified sites and the
 * registry of computations declared view-independent, fail if any of them ran more than once.
 *
 * ⛔ The registry is matched on `file:name`, NOT on `file:line`, deliberately: a line number
 * changes every time anything above it is edited, so a line-keyed registry would either go stale
 * silently or fail on every unrelated commit. A named computation keeps its identity across edits
 * and is renamed only by someone who is looking straight at it.
 */
export function guardVerdict(panSites, registry) {
  const wanted = new Map(registry.map((r) => [`${r.file}:${r.name}`, r]));
  const seen = new Set();
  const failures = [];
  for (const s of panSites) {
    const key = `${s.file}:${s.name}`;
    if (!wanted.has(key)) continue;
    seen.add(key);
    /* `max` defaults to 1 and is the number of DISTINCT QUESTIONS the computation is asked per
     * frame — for a component `useMemo` that is always one. A shared pure-library leaf can be
     * asked more: `layoutLabelsSolve` is called once for the measurement chips and once for the
     * element labels, so a perfectly memoised pass still solves twice per gesture and "≤ 1" would
     * assert something false (B217539).
     *
     * ⛔ THIS IS NOT A TOLERANCE DIAL, and it must never be raised to silence a regression. It is
     * a structural count, and it is PINNED TO THE SOURCE: `test/labelLayoutMemo.test.js` asserts
     * SitePlanner has exactly two `layoutLabels(` call sites, so adding a third turns CI red and
     * forces a deliberate decision here rather than a quiet bump. The property being asserted is
     * still "once per distinct question", which is the whole rule. */
    const limit = wanted.get(key).max ?? 1;
    if (s.calls > limit) {
      failures.push({
        key, calls: s.calls, ms: s.ms, verdict: s.verdict, max: limit,
        why: `${wanted.get(key).why} — ran ${s.calls}× during a pure pan (must be ≤ ${limit})`,
      });
    }
  }
  /* A registered computation the probe never observed is a FAILURE, not a pass. That is the exact
   * shape of a guard rotting away: the code is renamed or removed, the probe records nothing, and
   * a guard that only checks the sites it happens to see reports green forever. */
  const missing = [...wanted.keys()].filter((k) => !seen.has(k));
  return { ok: failures.length === 0 && missing.length === 0, failures, missing, checked: seen.size };
}
