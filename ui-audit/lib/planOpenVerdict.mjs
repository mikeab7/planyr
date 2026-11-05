/* planOpenVerdict — pure scoring for ui-audit/perf-plan-open.mjs (B2224000). No browser here, so it is unit-tested (test/planOpenVerdict.test.js).
 *
 * An action = one plan open / switch, scored over the 5 s after it. Per action across runs: the WORST single main-thread gap (heartbeat
 * ping-gap) in each run → we report median-of-runs and worst-of-runs; the budget is checked against the WORST run (a stall that appears in
 * 1 run of 3 is still a stall the owner meets).
 *
 * EVERY GAP (B2225425 round 3): the score is the worst of ALL heartbeat gaps in the action's window — not one gap attributed to one click — and
 * each row also reports how many runs crossed 50 ms and 150 ms, plus the worst gap split by cause when the harness classed them.
 *
 * BUDGET: `budget.byLabel[label]` per action (else `budget.maxGapMs`). `targetGapMs` (the owner-stated 50 ms) is a TARGET, reported, never gating — the
 * budget is set at what the fixed build measures plus noise headroom so a regression of the measured defect fails; the distance to the target is the open work.
 *
 * VOID, not pass, when the instrument or the scene cannot be trusted:
 *   · the known-good arm (a deliberate 200 ms busy loop) read under 150 ms → the heartbeat cannot see a stall;
 *   · the action errored or the canvas drew no features → nothing was opened;
 *   · a signed-in open that never fetched the plan's rows → it measured the logged-out program, not the owner's.
 */
export const SELF_TEST_MIN_MS = 150;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

export function planOpenVerdict(results, budget = {}) {
  const defaultMax = budget.maxGapMs ?? 50, byLabel = budget.byLabel || {}, target = budget.targetGapMs ?? null;
  const lines = []; const rows = []; let void_ = false, fail = false;
  for (const [scenario, runs] of Object.entries(results || {})) {
    const groups = new Map();
    for (const run of runs) for (const a of run) {
      if (!groups.has(a.label)) groups.set(a.label, []);
      groups.get(a.label).push(a);
    }
    for (const [label, acts] of groups) {
      const good = acts.filter((a) => !a.error);
      const reasons = [];
      if (good.length !== acts.length) reasons.push(`${acts.length - good.length} run(s) errored: ${acts.find((a) => a.error).error}`);
      if (good.some((a) => !(a.feat > 0))) reasons.push("canvas drew no features");
      if (good.some((a) => a.rowFetches === 0)) reasons.push("plan rows never fetched (not the signed-in path)");
      const st = good.map((a) => a.selfTestMs).filter((x) => x != null);
      if (st.length && Math.min(...st) < SELF_TEST_MIN_MS) reasons.push(`known-good arm read ${Math.min(...st)} ms (< ${SELF_TEST_MIN_MS})`);
      const worst = good.map((a) => a.maxMs);
      const row = { scenario, label, n: good.length, medianMax: median(worst), worstMax: Math.max(0, ...worst), over50: Math.max(0, ...good.map((a) => a.over50)), sumOver50: median(good.map((a) => a.sumOver50)), void: reasons.length > 0, reasons };
      /* B2225425 (round 3) — the heartbeat counts EVERY main-thread gap in the window, whatever caused it; these say how many RUNS crossed the
       * owner's two lines (50 ms target, 150 ms "a freeze he feels"), and split the worst gap by cause when the run classed its gaps
       * ("task" = one long task, "queue" = the heartbeat waited behind many short ones). Reported; the budget still gates on worstMax. */
      row.runsOver50 = worst.filter((m) => m > 50).length;
      row.runsOver150 = worst.filter((m) => m > 150).length;
      if (good.some((a) => a.maxTaskMs != null)) { row.worstTask = Math.max(0, ...good.map((a) => a.maxTaskMs || 0)); row.worstQueue = Math.max(0, ...good.map((a) => a.maxQueueMs || 0)); }
      row.targetMet = target != null ? !row.void && row.worstMax <= target : null;
      row.max = byLabel[label] ?? defaultMax;
      row.pass = !row.void && row.worstMax <= row.max;
      if (row.void) void_ = true; else if (!row.pass) fail = true;
      rows.push(row);
      lines.push(`${row.void ? "VOID" : row.pass ? "PASS" : "FAIL"}  ${scenario.padEnd(15)} ${label.padEnd(40)} worst-gap  median ${String(row.medianMax).padStart(4)}  worst ${String(row.worstMax).padStart(4)} / budget ${String(row.max).padStart(4)} ms  (>50ms: ${row.over50}, sum ${row.sumOver50} ms; runs >50: ${row.runsOver50}/${row.n}, >150: ${row.runsOver150}/${row.n}${row.worstTask != null ? `; worst task ${row.worstTask}, queue ${row.worstQueue}` : ""})${row.void ? "  — " + reasons.join("; ") : ""}`);
    }
  }
  if (!rows.length) { void_ = true; lines.push("VOID  no action was scored"); }
  return { rows, lines, pass: !void_ && !fail, void: void_, budget: { maxGapMs: defaultMax, byLabel, targetGapMs: target } };
}
