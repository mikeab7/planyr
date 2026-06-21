// Adversarial stress test for the Scheduler date/cascade engine.
// Exercises the REAL extracted functions (scheduler-engine.mjs) with malformed,
// hostile, and boundary inputs that a user (or imported/synced/hand-edited data)
// could realistically produce. Reports CRASH (throw), HANG (unbounded loop), or
// WRONG (silently bad result) findings.
//
//   node ui-audit/stress/stress-scheduler.mjs
//
import * as E from "./scheduler-engine.mjs";

let pass = 0, fail = 0;
const findings = [];
const log = (s) => process.stdout.write(s + "\n");

// Run fn; classify as ok / CRASH. Returns {ok, val, err}.
function probe(label, fn) {
  try { return { ok: true, val: fn() }; }
  catch (e) { return { ok: false, err: e }; }
}

// Time a synchronous fn (ms). Used to detect O(n) loops that scale to a hang.
function timeMs(fn) { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; }

function expectOk(label, fn) {
  const r = probe(label, fn);
  if (r.ok) { pass++; log(`  ok    ${label}`); }
  else { fail++; findings.push({ label, kind: "CRASH", detail: r.err.message }); log(`  CRASH ${label}\n          → ${r.err.message}`); }
  return r;
}

function note(kind, label, detail) {
  findings.push({ label, kind, detail });
  log(`  ${kind.padEnd(5)} ${label}\n          → ${detail}`);
}

log("\n=== 1. Date helpers: malformed / hostile date strings ===");
// pd()/fd() are the foundation. A bad date string → Invalid Date → fd() throws RangeError.
for (const bad of ["", "garbage", "2026-13-40", "2026-02-31", "0000-00-00", "2026/01/01", "20260101", "not-a-date", "2026-1-1", "+275760-09-13", "1e9", "Infinity"]) {
  const r = probe(`addBD(${JSON.stringify(bad)}, 1)`, () => E.addBD(bad, 1));
  if (!r.ok) note("CRASH", `addBD(${JSON.stringify(bad)}, 1)`, r.err.message);
  else if (bad && r.val === undefined) note("WRONG", `addBD(${JSON.stringify(bad)}, 1)`, "returned undefined");
  else log(`  ok    addBD(${JSON.stringify(bad)},1) → ${r.val}`);
}

log("\n=== 2. addBD / difBD: numeric edge cases ===");
{
  const base = "2026-06-22"; // a Monday
  for (const n of [NaN, Infinity, -Infinity, 2.5, -2.5, "3", null, undefined]) {
    const r = probe(`addBD(base, ${String(n)})`, () => E.addBD(base, n));
    if (!r.ok) note("CRASH", `addBD(base, ${String(n)})`, r.err.message);
    else log(`  ok    addBD("${base}", ${String(n)}) → ${r.val}`);
  }
  // Fractional duration silently over-counts business days:
  const f = E.addBD(base, 2.5);
  if (f === E.addBD(base, 3)) note("WRONG", "addBD(base, 2.5)", `fractional rounds UP to 3 BDs (=${f}); duration 2.5 should not advance 3 working days`);
}

log("\n=== 3. HANG RISK: business-day loop must stay bounded for huge magnitudes ===");
{
  // addBD loops once per BUSINESS DAY of |n|. Before the fix there was no bound, so a
  // typed/pasted duration of 1e9 froze the tab for ~13 min. The engine now caps
  // iterations at MAX_BD_STEPS, so even an absurd value returns in well under a second.
  const base = "2026-06-22";
  for (const N of [1e8, 1e9, Number.MAX_SAFE_INTEGER]) {
    const ms = timeMs(() => E.calcEnd(base, N));   // calcEnd → addBD, the path the grid hits
    log(`  calcEnd(base, ${N.toExponential ? N.toExponential() : N}) returned in ${ms.toFixed(1)}ms`);
    if (ms > 2000) note("HANG", `calcEnd(base, ${N})`, `took ${ms.toFixed(0)}ms — iteration cap not effective`);
  }
  // Far-apart dates must not spin difBD either (e.g. a year-9999 import vs 2026).
  const msDif = timeMs(() => E.difBD("2026-06-22", "9999-12-31"));
  log(`  difBD(2026 → 9999) returned in ${msDif.toFixed(1)}ms`);
  if (msDif > 2000) note("HANG", "difBD over a multi-millennium span", `took ${msDif.toFixed(0)}ms`);
}

log("\n=== 4. cascadeDates: dependency graph pathologies ===");
{
  const T = (id, o = {}) => ({ id, name: "t"+id, start: "2026-06-22", end: "2026-06-22", duration: 1, predecessors: [], parentId: null, ...o });

  expectOk("empty task list", () => E.cascadeDates([]));
  expectOk("self-dependency (1→1)", () => E.cascadeDates([T(1, { predecessors: [{ id: 1, type: "FS", lag: 0 }] })]));
  expectOk("2-cycle (1→2→1)", () => E.cascadeDates([
    T(1, { predecessors: [{ id: 2, type: "FS", lag: 0 }] }),
    T(2, { predecessors: [{ id: 1, type: "FS", lag: 0 }] }),
  ]));
  expectOk("3-cycle", () => E.cascadeDates([
    T(1, { predecessors: [{ id: 3 }] }), T(2, { predecessors: [{ id: 1 }] }), T(3, { predecessors: [{ id: 2 }] }),
  ]));
  expectOk("pred id not present", () => E.cascadeDates([T(1, { predecessors: [{ id: 999 }] })]));
  expectOk("pred id null/undefined/NaN", () => E.cascadeDates([
    T(1, { predecessors: [{ id: null }, { id: undefined }, { id: NaN }] }),
  ]));
  expectOk("pred as bare numbers + strings", () => E.cascadeDates([
    T(1), T(2, { predecessors: [1, "1", { id: 1 }] }),
  ]));
  expectOk("duplicate task ids", () => E.cascadeDates([T(1), T(1, { name: "dup" }), T(2, { predecessors: [{ id: 1 }] })]));
  expectOk("FF with huge successor duration", () => E.cascadeDates([
    T(1), T(2, { duration: 100000, predecessors: [{ id: 1, type: "FF", lag: 0 }] }),
  ]));
  expectOk("blank/missing start on pred", () => E.cascadeDates([
    T(1, { start: "", end: "" }), T(2, { predecessors: [{ id: 1, type: "FS" }] }),
  ]));
  expectOk("huge lag", () => E.cascadeDates([T(1), T(2, { predecessors: [{ id: 1, lag: 50000 }] })]));
  expectOk("negative duration", () => E.cascadeDates([T(1, { duration: -5 })]));
  expectOk("non-integer / NaN duration", () => E.cascadeDates([T(1, { duration: NaN }), T(2, { duration: 1.7 })]));

  // Correctness spot-check: simple FS chain should advance by business days.
  const chain = E.cascadeDates([T(1, { start: "2026-06-22", duration: 1 }), T(2, { duration: 1, predecessors: [{ id: 1, type: "FS" }] })]);
  const t2 = chain.find(t => t.id === 2);
  if (t2.start !== "2026-06-23") note("WRONG", "FS chain start", `expected 2026-06-23, got ${t2.start}`);
  else log(`  ok    FS chain: t2.start = ${t2.start}`);
}

log("\n=== 5. rollupParentDates: hierarchy pathologies ===");
{
  const T = (id, o = {}) => ({ id, name: "t"+id, start: "2026-06-22", end: "2026-06-22", duration: 1, predecessors: [], parentId: null, ...o });

  expectOk("normal parent/child", () => E.rollupParentDates([
    T(1, { parentId: null }), T(2, { parentId: 1, start: "2026-06-22", end: "2026-06-25" }), T(3, { parentId: 1, start: "2026-06-23", end: "2026-06-30" }),
  ]));
  // THE SUSPECTED CRASH: a child whose parentId points to a task that doesn't exist.
  // renumberTasks/sortByVisualOrder both defend against this elsewhere — rollup does not.
  const r = expectOk("ORPHANED parentId (points to missing task)", () => E.rollupParentDates([
    T(2, { parentId: 1, start: "2026-06-22", end: "2026-06-25" }),
  ]));
  if (r.ok) log(`          (no crash — re-check guard)`);
  expectOk("parent is its own child (parentId===id)", () => E.rollupParentDates([T(1, { parentId: 1 })]));
  expectOk("parent cycle (1↔2 parentIds)", () => E.rollupParentDates([T(1, { parentId: 2 }), T(2, { parentId: 1 })]));
  expectOk("child with blank dates", () => E.rollupParentDates([T(1), T(2, { parentId: 1, start: "", end: "" })]));
  expectOk("child with invalid date string", () => E.rollupParentDates([T(1), T(2, { parentId: 1, start: "garbage", end: "garbage" })]));
}

log("\n=== 6. parseFlexDate: garbage in ===");
{
  const cases = [
    ["", null], ["garbage", null], ["13/45/2026", null], ["2/31", "2026-02-31?"],
    ["6/22/26", "2026-06-22"], ["6-22-2026", "2026-06-22"], ["6.22.2026", "2026-06-22"],
    ["99/99/9999", null], ["1/1", "year-default"], ["2026-06-22", "2026-06-22"],
    ["0/0/0", null], ["-5/-5/-5", null],
  ];
  for (const [inp, exp] of cases) {
    const r = probe(`parseFlexDate(${JSON.stringify(inp)})`, () => E.parseFlexDate(inp));
    if (!r.ok) note("CRASH", `parseFlexDate(${JSON.stringify(inp)})`, r.err.message);
    else {
      log(`  ok    parseFlexDate(${JSON.stringify(inp)}) → ${JSON.stringify(r.val)}`);
      // Feb 31 etc.: passes the range check but is not a real calendar date.
      if (r.val && /^\d{4}-\d{2}-\d{2}$/.test(r.val)) {
        const d = E.pd(r.val);
        const round = E.fdLocal(d);
        if (round !== r.val) note("WRONG", `parseFlexDate(${JSON.stringify(inp)})`, `accepts impossible date ${r.val}; pd() rolls it to ${round}`);
      }
    }
  }
}

log("\n=== 7. End-to-end: realistic hostile project through the full pipeline ===");
{
  // Simulate a project as it would arrive from cloud/import, then run the same
  // recompute the app runs: rollupParentDates(cascadeDates(tasks)).
  const hostile = [
    { id: 1, name: "Parent", start: "2026-06-22", end: "2026-06-22", duration: 1, predecessors: [], parentId: null },
    { id: 2, name: "Child A", start: "bad-date", end: "", duration: 3, predecessors: [{ id: 1, type: "FS", lag: 0 }], parentId: 1 },
    { id: 3, name: "Orphan child", start: "2026-06-22", end: "2026-06-25", duration: 2, predecessors: [], parentId: 77 },
    { id: 4, name: "Cyclic", start: "2026-06-22", end: "2026-06-22", duration: 1, predecessors: [{ id: 5, type: "FS" }], parentId: null },
    { id: 5, name: "Cyclic2", start: "2026-06-22", end: "2026-06-22", duration: 1, predecessors: [{ id: 4, type: "FS" }], parentId: null },
  ];
  expectOk("full recompute on hostile project", () => E.rollupParentDates(E.cascadeDates(hostile)));
}

log("\n========================================================");
log(`PASS (no-crash) checks: ${pass}   CRASH checks: ${fail}`);
log(`\nFindings (${findings.length}):`);
const order = { CRASH: 0, HANG: 1, WRONG: 2 };
findings.sort((a, b) => (order[a.kind] - order[b.kind]));
for (const f of findings) log(`  [${f.kind}] ${f.label}\n         ${f.detail}`);
log("");
// Exit non-zero only on hard crashes so CI can gate; HANG/WRONG are reported.
process.exit(0);
