/* editSwitch — the pure verdict behind ui-audit/perf-edit-switch.mjs (NEW-1, B217540 ×3 / B1317824 ×3). No browser, no DOM.
 *
 * Two questions, asked of ONE run that does repeated edits interleaved with plan switches:
 *   1. PLAIN EDITING HITCHES — does a single edit commit block the main thread for a long task, over and over?
 *      (the owner's capture: ~10 tasks of 255-275 ms at roughly one per edit.)  Read per edit: the longest task in the
 *      edit's window, and how many edits carried a task over `hitchMs`.
 *   2. HEAP ACROSS SWITCHES — is the heap read AFTER a forced GC flat across visits?  A slope, not a level (a level
 *      says the plan is big; only a slope says something is retained), plus the heap-snapshot DETACHED-node count.
 * A run that could not have seen either is VOID, not green: too few switches/edits, a switch that never changed the
 * drawn scene, drags that moved nothing, or a missing detachedness reading.
 */
const r1 = (v) => Math.round(v * 10) / 10;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
export function slope(ys) {
  const n = ys.length; if (n < 2) return 0;
  const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (i - mx) * (ys[i] - my); sxx += (i - mx) ** 2; }
  return sxx ? sxy / sxx : 0;
}

export const MIN = { switches: 7, edits: 20, movedFraction: 0.8 };

/** @param run {visits:[{heapMB}], editLog:[{moved, lt:[[t,dur]], fr:[[t,dt]]}], switchProven, detachedNodes, edits, editedOk} */
export function editSwitchVerdict(run, budget = {}) {
  const log = run.editLog || [], visits = run.visits || [];
  const worstPerEdit = log.map((e) => Math.max(0, ...(e.lt || []).map((x) => x[1])));
  const ltPerEdit = log.map((e) => (e.lt || []).reduce((a, x) => a + x[1], 0));
  const hitchMs = budget.hitchMs ?? 150;
  const hitchEdits = worstPerEdit.filter((w) => w >= hitchMs).length;
  const heap = visits.map((v) => v.heapMB);
  const out = {
    visits: visits.length, edits: log.length, hitchEdits, hitchMs,
    medianWorstTaskMs: r1(med(worstPerEdit)), maxTaskMs: r1(Math.max(0, ...worstPerEdit)),
    medianLongTaskMsPerEdit: r1(med(ltPerEdit)),
    frames100: log.reduce((n, e) => n + (e.fr || []).length, 0),
    /* COUNTS of whole-store-sized (> 500 KB) JSON.parse / JSON.stringify / setItem calls, worst edit and median edit */
    bigParsesMax: Math.max(0, ...log.map((e) => e.big?.parse || 0)), bigStringifiesMax: Math.max(0, ...log.map((e) => e.big?.stringify || 0)),
    bigWritesMax: Math.max(0, ...log.map((e) => e.big?.set || 0)), bigWritesMedian: med(log.map((e) => e.big?.set || 0)),
    bigParsesTotal: log.reduce((n, e) => n + (e.big?.parse || 0), 0), bigWritesTotal: log.reduce((n, e) => n + (e.big?.set || 0), 0),
    bigSeen: log.some((e) => e.big),
    /* the first visits climb on their own (JIT, the first big plan's caches, the one-time normalisation of each seeded plan) — a
     * SLOPE is only meaningful after that, so the first `heapWarmupVisits` are not in the fit */
    heapWarmupVisits: (heap.length >= (budget.heapWarmupVisits ?? 6) + 5) ? (budget.heapWarmupVisits ?? 6) : 0,
    heapSlopeMBPerSwitch: r1(slope(heap.slice((heap.length >= (budget.heapWarmupVisits ?? 6) + 5) ? (budget.heapWarmupVisits ?? 6) : 0))), heapFirstMB: heap[0] ?? null, heapLastMB: heap[heap.length - 1] ?? null,
    detachedNodes: run.detachedNodes, lines: [], pass: true, void: false,
  };
  const voidIf = (cond, why) => { if (cond) { out.lines.push(`VOID: ${why}`); out.void = true; out.pass = false; } };
  voidIf(visits.length < (budget.minSwitches ?? MIN.switches), `${visits.length} plan switches — the brief's scenario needs at least ${MIN.switches}`);
  voidIf(log.length < (budget.minEdits ?? MIN.edits), `${log.length} edits — needs at least ${MIN.edits}`);
  voidIf(!run.switchProven, "no plan switch was proven (the drawn-feature count never changed)");
  voidIf(log.length && log.filter((e) => e.moved).length / log.length < MIN.movedFraction, "fewer than 80% of the drags moved anything — the edit cost is about a gesture that did not happen");
  voidIf(!out.bigSeen, "the whole-store call counters did not report (the instrument is not observing)");
  voidIf(budget.minStoreKB && (run.store?.extraKB || 0) < budget.minStoreKB, `the device store was only ${run.store?.extraKB || 0} KB of other plans — the owner's held 3.88 MB; below ${budget.minStoreKB} KB the whole-store costs are not exercised`);
  voidIf(run.detachedNodes == null, "the heap snapshot did not report detachedness");
  if (out.void) return out;
  const check = (name, value, max) => {
    if (!Number.isFinite(max)) { out.lines.push(`  ${name}: ${value} (no budget set)`); return; }
    const ok = value <= max; if (!ok) out.pass = false;
    out.lines.push(`  ${ok ? "✅" : "❌"} ${name}: ${value}  (budget ≤ ${max})`);
  };
  check("edits with a task ≥ hitchMs", hitchEdits, budget.maxHitchEdits);
  check("worst single task, ms", out.maxTaskMs, budget.maxWorstTaskMs);
  check("median long-task ms per edit", out.medianLongTaskMsPerEdit, budget.maxMedianLongTaskMsPerEdit);
  check("frames over 100 ms while editing", out.frames100, budget.maxFrames100);
  check("whole-store JSON.parse calls in the WORST edit", out.bigParsesMax, budget.maxBigParsesPerEdit);
  check("whole-store JSON.stringify calls in the WORST edit", out.bigStringifiesMax, budget.maxBigStringifiesPerEdit);
  check("whole-store setItem calls in the WORST edit", out.bigWritesMax, budget.maxBigWritesPerEdit);
  if (run.allocMB != null) check("MB allocated per edit (--alloc: collected garbage included)", r1(run.allocMB / Math.max(1, log.length)), budget.maxAllocMBPerEdit);
  check("post-GC heap slope, MB per switch", out.heapSlopeMBPerSwitch, budget.maxHeapSlopeMBPerSwitch);
  check("detached DOM nodes at end", out.detachedNodes, budget.maxDetachedNodes);
  return out;
}
