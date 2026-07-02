// B615 migration verification — proves the duration-model migration (durUnit/durValue + the
// unit-aware resolver) shifts ZERO end dates for legacy ('d') data, is idempotent, and preserves
// parent roll-ups. Data-safe: runs on a synthetic fixture, not production data. Run:
//   node ui-audit/stress/verify-b615-migration.mjs
// (The real production before/after diff was run separately against the live scheduler Supabase —
//  667 tasks, 0 real shifts; the 5 flagged were parents whose end comes from rollup, unchanged.)
import * as E from "./scheduler-engine.mjs";

let fail = 0;
const ok = (cond, msg) => { if (!cond) { console.error("  ✗ " + msg); fail++; } };

// 1) THE NO-SHIFT GUARANTEE: for every (start, duration), the B615 'd' path === the pre-B615 calcEnd.
//    This is why stamping durUnit='d'/durValue=duration and re-deriving cannot move a legacy end.
{
  let checked = 0, mism = 0;
  const base = new Date("2024-01-01T12:00:00");
  for (let i = 0; i < 1500; i++) {
    const d = new Date(base); d.setDate(d.getDate() + i);
    const start = E.fd(d);
    for (const dur of [0, 1, 2, 5, 10, 15, 20, 63, 150, 188, 363, 732]) {
      checked++;
      const legacyEnd = E.calcEnd(start, dur);                       // pre-B615 behavior
      const b615End = E.resolveDuration(start, dur, "d").end;        // post-B615 'd' path
      if (legacyEnd !== b615End) { mism++; if (mism <= 5) console.error(`   shift @ ${start} ${dur}d: ${legacyEnd} -> ${b615End}`); }
    }
  }
  ok(mism === 0, `no-shift guarantee: ${mism}/${checked} (start,duration) pairs shifted`);
  console.log(`1) no-shift guarantee: ${checked - mism}/${checked} identical (expected all).`);
}

// 2) FULL PIPELINE on a fixture with a parent + a weekend (Sunday) milestone child — mirrors the real
//    production shape (a project's summary rolls up to a year-end milestone the user placed on a Sunday).
//    normalizeToV7(normalizeToV6(...)) must (a) stamp durUnit/durValue, (b) leave the milestone on its
//    Sunday, (c) roll the parent up to that Sunday — never "correcting" it to a weekday.
{
  const fixture = { projects: { p1: { name: "P", tasks: [
    { id: 1, name: "Design", start: "2026-05-26", end: "2026-12-27", duration: 150, predecessors: [], parentId: null },
    { id: 2, name: "Kickoff", start: "2026-05-26", end: "2026-05-29", duration: 5, predecessors: [], parentId: 1 },
    { id: 3, name: "Year-end milestone", start: "2026-12-27", end: "2026-12-27", duration: 0, predecessors: [], parentId: 1 }, // Sunday
  ] } } };
  const migrated = E.normalizeToV7(E.normalizeToV6(fixture));
  const t = Object.fromEntries(migrated.projects.p1.tasks.map(x => [x.id, x]));
  ok(t[1].durUnit === "d" && t[1].durValue === 150, "parent stamped durUnit='d'/durValue");
  ok(t[2].durUnit === "d" && t[2].durValue === 5, "leaf stamped durUnit='d'/durValue");
  ok(t[3].end === "2026-12-27", "Sunday milestone preserved (calcEnd of a 0-duration task = start)");
  ok(t[2].end === E.calcEnd("2026-05-26", 5), "leaf end is the working-day derivation");
  ok(t[1].end === "2026-12-27", "parent rolls UP to the milestone's Sunday end (rollup unchanged by B615)");
  console.log(`2) parent + weekend-milestone fixture: parent end=${t[1].end} (rolled up, preserved).`);
}

// 3) IDEMPOTENCY — the _v7 flag short-circuits a second migration; tasks are byte-identical.
{
  const fixture = { projects: { p1: { name: "P", tasks: [
    { id: 1, name: "a", start: "2026-06-22", end: "2026-06-26", duration: 5, predecessors: [], parentId: null },
    { id: 2, name: "b", start: "2026-07-06", end: "2026-07-06", duration: 0, predecessors: [], parentId: null },
  ] } } };
  const once = E.normalizeToV7(E.normalizeToV6(fixture));
  const twice = E.normalizeToV7(once);
  ok(twice._v7 === true, "second pass keeps _v7");
  ok(JSON.stringify(once.projects.p1.tasks) === JSON.stringify(twice.projects.p1.tasks), "migration is idempotent");
  console.log(`3) idempotency: normalizeToV7 twice is identical.`);
}

// 4) NEW UNITS resolve as specified (weeks = working days; months/years = calendar-real).
{
  ok(E.resolveDuration("2026-06-22", 3, "w").duration === 15, "3 weeks = 15 working days");
  ok(E.resolveDuration("2026-01-31", 1, "mo").end === E.rollForwardToWorkday("2026-02-28"), "1 month clamps Jan31→Feb28 + roll");
  ok(E.resolveDuration("2026-03-10", 1, "y").end === E.rollForwardToWorkday("2027-03-10"), "1 year = same day next year + roll");
  ok(E.resolveDuration("2026-06-22", 4, "w").end !== E.resolveDuration("2026-06-22", 1, "mo").end, "4 weeks ≠ 1 month (accepted divergence)");
  console.log(`4) new units: weeks=working-days, months/years=calendar-real. OK.`);
}

console.log(fail === 0 ? "\n✅ B615 migration verified: zero end-date shift for legacy data, idempotent, parents preserved." : `\n❌ ${fail} check(s) failed.`);
process.exit(fail === 0 ? 0 : 1);
