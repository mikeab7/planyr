// Round 2 — deeper stress of the Scheduler engine: predecessor parsing, the four
// MS-Project constraint types, and cascade/rollup performance at scale (B256 claims
// recompute is O(n²) past ~500 tasks — measured here).
//
//   node ui-audit/stress/stress-scheduler2.mjs
//
import * as E from "./scheduler-engine.mjs";

const log = (s = "") => process.stdout.write(s + "\n");
const findings = [];
const note = (kind, label, detail) => { findings.push({ kind, label, detail }); log(`  ${kind.padEnd(5)} ${label}\n          → ${detail}`); };
const timeMs = (fn) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };
const probe = (fn) => { try { return { ok: true, val: fn() }; } catch (e) { return { ok: false, err: e }; } };

log("\n=== 1. parsePreds: MS-Project predecessor strings, hostile ===");
for (const raw of ["", "2", "2FS", "2SS+3", "3FF-1d", "1,2SS", "2,,3", "2fs+2", "  2 SS - 1 d ", "abc", "2XX", "999999999999", "-3", "2;3;4", "2FS+", "2,2,2", null, undefined, 42, {}]) {
  const r = probe(() => E.parsePreds(raw));
  if (!r.ok) note("CRASH", `parsePreds(${JSON.stringify(raw)})`, r.err.message);
  else log(`  ok    parsePreds(${JSON.stringify(raw)}) → ${JSON.stringify(r.val)}`);
}

log("\n=== 2. constrainedStartFrom: all four types, edge durations/lags ===");
{
  const pred = { start: "2026-06-22", end: "2026-06-26" }; // Mon–Fri
  for (const type of ["FS", "SS", "FF", "SF", "ZZ", "", null]) {
    for (const dur of [0, 1, 2, 5, -3, NaN, 1e9]) {
      for (const lag of [0, 2, -2]) {
        const r = probe(() => E.constrainedStartFrom(pred, { type, lag }, dur));
        if (!r.ok) note("CRASH", `constrainedStartFrom(${type}, dur=${dur}, lag=${lag})`, r.err.message);
        else if (dur !== 1e9 && (r.val === undefined)) note("WRONG", `constrainedStartFrom(${type}, dur=${dur}, lag=${lag})`, "undefined");
      }
    }
  }
  // Spot-check the documented conventions (end dates inclusive):
  const fs = E.constrainedStartFrom(pred, { type: "FS", lag: 0 }, 1); // next BD after Fri 6/26 → Mon 6/29
  const ss = E.constrainedStartFrom(pred, { type: "SS", lag: 0 }, 1); // same start → 6/22
  log(`  FS → ${fs} (expect 2026-06-29)   SS → ${ss} (expect 2026-06-22)`);
  if (fs !== "2026-06-29") note("WRONG", "FS convention", `got ${fs}`);
  if (ss !== "2026-06-22") note("WRONG", "SS convention", `got ${ss}`);
}

log("\n=== 3. cascadeDates / rollupParentDates: performance at scale ===");
{
  const T = (id, o = {}) => ({ id, name: "t" + id, start: "2026-06-22", end: "2026-06-22", duration: 1, predecessors: [], parentId: null, ...o });
  // (a) Long FS chain — each depends on the previous.
  for (const N of [200, 500, 1000, 2000]) {
    const tasks = [];
    for (let i = 1; i <= N; i++) tasks.push(T(i, i > 1 ? { predecessors: [{ id: i - 1, type: "FS" }] } : {}));
    const ms = timeMs(() => E.cascadeDates(tasks));
    log(`  cascadeDates chain N=${N}: ${ms.toFixed(1)}ms`);
    if (ms > 3000) note("HANG", `cascadeDates chain N=${N}`, `${ms.toFixed(0)}ms — too slow for interactive edit`);
  }
  // (b) Deep parent nesting — worst case for the while-changed rollup loop.
  for (const N of [200, 500, 1000]) {
    const tasks = [];
    for (let i = 1; i <= N; i++) tasks.push(T(i, { parentId: i > 1 ? i - 1 : null, start: "2026-06-22", end: `2026-06-${22 + (i % 7)}` }));
    const ms = timeMs(() => E.rollupParentDates(tasks));
    log(`  rollupParentDates depth=${N}: ${ms.toFixed(1)}ms`);
    if (ms > 3000) note("HANG", `rollupParentDates depth=${N}`, `${ms.toFixed(0)}ms — quadratic/cubic blow-up`);
  }
  // (c) Realistic combined recompute (the app runs rollup(cascade(tasks))).
  for (const N of [500, 1000]) {
    const tasks = [];
    for (let i = 1; i <= N; i++) tasks.push(T(i, { parentId: i % 10 === 0 ? null : Math.max(1, i - (i % 10)), predecessors: i % 3 === 0 ? [{ id: Math.max(1, i - 1), type: "FS" }] : [] }));
    const ms = timeMs(() => E.rollupParentDates(E.cascadeDates(tasks)));
    log(`  full recompute N=${N}: ${ms.toFixed(1)}ms`);
    if (ms > 3000) note("HANG", `full recompute N=${N}`, `${ms.toFixed(0)}ms`);
  }
}

log("\n========================================================");
log(`Findings (${findings.length}):`);
for (const f of findings) log(`  [${f.kind}] ${f.label} — ${f.detail}`);
log("");
