/* editCycle — the pure verdict behind ui-audit/perf-edit-cycle.mjs (NEW-1, B217540). No browser, no DOM.
 *
 * The question is a SLOPE, not a level: the same edit sequence repeated N times — does cycle N cost more than
 * cycle 1? A level ("1.2 s per cycle") says the sequence is heavy; only a slope says it gets heavier, which is
 * what the owner's "progressively slower … near-freeze after ~5 min" is. Fitted by ordinary least squares on the
 * per-cycle series, then compared to a budget that is stated in a file with the reasoning for each number.
 */

export function linearFitXY(ys) {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] || 0 };
  const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (i - mx) * (ys[i] - my); sxx += (i - mx) ** 2; }
  const slope = sxx ? sxy / sxx : 0;
  return { slope, intercept: my - slope * mx };
}

const r1 = (v) => Math.round(v * 10) / 10;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** @param perCycle [{workMs, longTaskMs, maxTaskMs, heapMB, domNodes, canvasNodes}]  @param budget see perf-edit-cycle.budget.json */
export function editCycleVerdict(perCycle, budget = {}) {
  const cy = perCycle || [];
  const work = cy.map((c) => c.workMs), lt = cy.map((c) => c.longTaskMs), heap = cy.map((c) => c.heapMB), dom = cy.map((c) => c.domNodes);
  const w = linearFitXY(work), l = linearFitXY(lt), h = linearFitXY(heap), d = linearFitXY(dom);
  const first = med(work.slice(0, 2)), last = med(work.slice(-2));
  const out = {
    cycles: cy.length,
    medianWorkMs: r1(med(work)), medianLongTaskMs: r1(med(lt)),
    workSlopeMsPerCycle: r1(w.slope), longTaskSlopeMsPerCycle: r1(l.slope), heapSlopeMBPerCycle: r1(h.slope), domSlopePerCycle: r1(d.slope),
    firstWorkMs: r1(first), lastWorkMs: r1(last), growthFactor: first > 0 ? r1(last / first) : null,
    worstTaskMs: Math.max(0, ...cy.map((c) => c.maxTaskMs || 0)),
    lines: [], pass: true,
  };
  /* A harness that did too few cycles to see a slope must say so, never print a flat-looking pass. */
  if (cy.length < 4) { out.lines.push(`VOID: ${cy.length} cycles — a slope needs at least 4`); out.pass = false; return out; }
  const check = (name, value, max) => {
    if (!Number.isFinite(max)) { out.lines.push(`  ${name}: ${value} (no budget set)`); return; }
    const ok = value <= max;
    out.lines.push(`${ok ? "✓" : "✗"} ${name}: ${value} (budget ≤ ${max})`);
    if (!ok) out.pass = false;
  };
  /* LEVELS, at the store weight the run states (the cost followed the DEVICE STORE, so a level is only meaningful
   * beside it): a flat 7-second cycle is not "no growth", it is the bug at a constant. */
  check("median cycle work ms", out.medianWorkMs, budget.maxMedianWorkMs);
  check("median long-task ms per cycle", out.medianLongTaskMs, budget.maxMedianLongTaskMs);
  check("work slope ms/cycle", out.workSlopeMsPerCycle, budget.maxWorkSlopeMsPerCycle);
  check("long-task slope ms/cycle", out.longTaskSlopeMsPerCycle, budget.maxLongTaskSlopeMsPerCycle);
  check("retained-heap slope MB/cycle", out.heapSlopeMBPerCycle, budget.maxHeapSlopeMBPerCycle);
  check("DOM-node slope /cycle", out.domSlopePerCycle, budget.maxDomSlopePerCycle);
  check("worst single task ms", out.worstTaskMs, budget.maxWorstTaskMs);
  return out;
}
