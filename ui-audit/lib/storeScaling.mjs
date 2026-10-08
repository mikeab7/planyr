/* storeScaling — the pure verdict behind ui-audit/perf-plan-store-scaling.mjs (B2165120). No browser.
 *
 * THE CLAIM UNDER TEST: with one storage entry per plan, what an edit WRITES to the device store does not depend on how many plans the device
 * holds. The instrument is the same harness (perf-edit-switch), the same build, run at several library sizes with ONE variable toggled — the
 * layout (`planarfit:planStore:layout` = blob is planStore's own kill switch, which is exactly the pre-change behaviour).
 *
 * WHAT MAKES A RUN VOID, NOT GREEN (the repo's standing rule: a harness that could not have seen the defect proves nothing):
 *   · the "plan" arm did not actually run per-plan (no index / no entries — e.g. the headroom guard refused the split on that device);
 *   · the "blob" arm did not reproduce the problem (its write size must grow with the library — if it does not, the instrument is blind);
 *   · too few sizes, sizes not spread at least 10× apart, or too few edits per arm.
 */
const r1 = (v) => Math.round(v * 10) / 10;
export const MIN_SIZES = 3, MIN_SPREAD = 10, MIN_EDITS_PER_ARM = 4;

/** @param arms { plan: [{plans, writeKBMedian, writeKBMax, largestWriteKB, edits, layoutObserved}], blob: [...] } */
export function storeScalingVerdict(arms, budget = {}) {
  const out = { lines: [], pass: true, void: false, plan: [], blob: [] };
  const sort = (a) => [...(a || [])].sort((x, y) => x.plans - y.plans);
  const plan = sort(arms.plan), blob = sort(arms.blob);
  out.plan = plan; out.blob = blob;
  const voidIf = (cond, why) => { if (cond) { out.lines.push(`VOID: ${why}`); out.void = true; out.pass = false; } };
  voidIf(plan.length < MIN_SIZES || blob.length < MIN_SIZES, `needs ≥ ${MIN_SIZES} library sizes in BOTH arms (got plan ${plan.length}, blob ${blob.length})`);
  if (plan.length && blob.length) {
    voidIf(plan[plan.length - 1].plans < plan[0].plans * MIN_SPREAD, `library sizes ${plan[0].plans}…${plan[plan.length - 1].plans} are not ≥ ${MIN_SPREAD}× apart — a flat line over a narrow range proves nothing`);
    for (const a of plan) voidIf(!(a.layoutObserved && a.layoutObserved.indexed && a.layoutObserved.entries > 0), `the "plan" arm at ${a.plans} plans did not run per-plan (observed ${JSON.stringify(a.layoutObserved)}) — it measured the wrong program`);
    for (const a of blob) voidIf(a.layoutObserved && a.layoutObserved.indexed, `the "blob" arm at ${a.plans} plans ran per-plan — the kill switch did not hold`);
    for (const a of [...plan, ...blob]) voidIf((a.edits || 0) < MIN_EDITS_PER_ARM, `${a.edits || 0} edits at ${a.plans} plans — needs ≥ ${MIN_EDITS_PER_ARM}`);
  }
  if (out.void) return out;
  const p0 = plan[0], p1 = plan[plan.length - 1], b0 = blob[0], b1 = blob[blob.length - 1];
  const slack = budget.flatSlackKB ?? 12;                           // the edited plan's own entry varies a little edit to edit
  out.planGrowthKB = r1(p1.writeKBMedian - p0.writeKBMedian);
  out.blobGrowthX = r1(b1.writeKBMedian / Math.max(0.1, b0.writeKBMedian));
  const check = (ok, text) => { out.lines.push(`  ${ok ? "✅" : "❌"} ${text}`); if (!ok) out.pass = false; };
  check(b1.writeKBMedian >= b0.writeKBMedian * (budget.blobMustGrowX ?? 4), `RED-PROOF — the un-split layout's per-edit write grows with the library: ${b0.writeKBMedian} KB @ ${b0.plans} plans → ${b1.writeKBMedian} KB @ ${b1.plans} (${out.blobGrowthX}×, needs ≥ ${budget.blobMustGrowX ?? 4}×)`);
  check(out.planGrowthKB <= slack, `per-plan layout is FLAT: median write ${p0.writeKBMedian} KB @ ${p0.plans} plans vs ${p1.writeKBMedian} KB @ ${p1.plans} (growth ${out.planGrowthKB} KB, budget ≤ ${slack} KB)`);
  check(p1.largestWriteKB <= (budget.maxLargestWriteKB ?? 400), `largest single plan-store write @ ${p1.plans} plans: ${p1.largestWriteKB} KB (budget ≤ ${budget.maxLargestWriteKB ?? 400}; the library is ${p1.layoutObserved.legacyKB} KB)`);
  check(p1.writeKBMedian <= b1.writeKBMedian * (budget.planVsBlobMax ?? 0.5), `at ${p1.plans} plans a per-plan edit writes ${p1.writeKBMedian} KB vs ${b1.writeKBMedian} KB un-split (must be ≤ ${(budget.planVsBlobMax ?? 0.5) * 100}%)`);
  return out;
}
