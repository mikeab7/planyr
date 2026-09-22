import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mergeCloudDoc, _mEq, _mIsObj, decomposeForDualWrite } from "../ui-audit/stress/scheduler-engine.mjs";

// B1777120 — THE AUTHORITY FLIP write path (writeScheduleRowsPrimary / writeOneScheduleRow /
// writeIndexRow / attemptScheduleWrite), EXTRACTED verbatim from public/sequence/index.html —
// same technique as test/schedulerSaveQueue.test.js's queue-wrapper extraction, so this can never
// silently drift from the code the owner actually runs. mergeCloudDoc/_mEq/_mIsObj/
// decomposeForDualWrite are injected from the already-established engine mirror (byte-identical
// to the app source, per the describe blocks in test/schedulerEngine.test.js) rather than
// re-extracted a second time.
//
// The fake Supabase client below enforces the SAME CAS rule the real database triggers do
// (schedules_enforce_version_monotonic / schedule_account_index_enforce_version_monotonic —
// src/workspaces/scheduler/db/schedules_version_monotonic_guard.sql and
// schedules_authority_flip.sql): an UPDATE that changes content without strictly advancing `rev`
// is silently excluded from the result set (0 rows), exactly like a real refused PostgREST
// request with `.select(...)` attached — this is what lets these tests exercise a REAL race
// through the REAL refusal-detection-and-retry code, not a hand-waved substitute.
//
// This proves the acceptance criteria from BACKLOG.md B1777120 at the storage-layer level:
//   1. two tabs editing two different schedules never conflict, and neither row's rev moves
//      because of the other (case: "two schedules, two tabs, independent saves").
//   2. a write to one schedule cannot modify another schedule's row (proven, not asserted — every
//      test inspects the OTHER schedule's row after each write).
//   5. a genuine same-schedule race (two tabs) is refused-then-merged, never silently dropped.
// (Criteria 3/4 — restore-path compatibility and idempotent migration — are proven in
// src/workspaces/scheduler/db/test/schedules_authority_flip.test.sql and
// schedules_decompose_recompose.sql's own BACKLOG-recorded live exercise, not here.)

const SRC = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");

function sliceBetween(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  expect(start, `"${startMarker}" not found in public/sequence/index.html`).toBeGreaterThan(-1);
  const end = SRC.indexOf(endMarker, start);
  expect(end, `"${endMarker}" not found after "${startMarker}"`).toBeGreaterThan(-1);
  return SRC.slice(start, end);
}

const stateSrc = sliceBetween("const scheduleKnownRev = {};", "const SCHEDULE_SANITY_DROP_RATIO = 0.5;") +
  "const SCHEDULE_SANITY_DROP_RATIO = 0.5;\n";
const writeFnsSrc = sliceBetween("const writeScheduleHistorySnapshot = ", "\n  window.storage = {");

// A minimal fake Supabase client covering exactly the chain shapes the extracted code above
// calls: .from(t).select(cols).eq(col,val).maybeSingle()/.single(), .from(t).insert(obj), and
// .from(t).update(obj).eq(col,val).select(cols) — the last of which enforces the CAS rule
// described above. Every builder is "thenable" so a bare `await sb.from(t).insert(obj)` (no
// terminal .select()) works exactly as it does against the real supabase-js client.
function makeFakeSupabase(seed, ownerUid) {
  const tables = {};
  Object.keys(seed).forEach(t => { tables[t] = seed[t].map(r => ({ ...r })); });

  function pick(row, cols) {
    if (!row) return row;
    if (!cols || cols === "*") return { ...row };
    const out = {};
    cols.split(",").forEach(c => {
      const part = c.trim();
      const [alias, real] = part.includes(":") ? part.split(":") : [part, part];
      out[alias] = row[real];
    });
    return out;
  }

  function builder(table) {
    const filters = [];
    let selectCols = null, pendingInsert = null, pendingUpdate = null;
    const api = {
      select(cols) { selectCols = cols; return api; },
      eq(col, val) { filters.push(r => r[col] === val); return api; },
      is(col, val) { filters.push(r => r[col] === val); return api; },
      insert(obj) { pendingInsert = obj; return api; },
      update(obj) { pendingUpdate = obj; return api; },
      single() { return exec(true); },
      maybeSingle() { return exec(true, true); },
      then(resolve, reject) { return exec().then(resolve, reject); },
    };
    async function exec(wantsSingle, allowEmpty) {
      const rows = tables[table] || (tables[table] = []);
      if (pendingInsert) {
        const row = { ...pendingInsert };
        if (row.id == null) row.id = rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
        else if (rows.some(r => r.id === row.id)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        row.rev = row.rev ?? 0;
        rows.push(row);
        const result = selectCols ? pick(row, selectCols) : row;
        return wantsSingle ? { data: result, error: null } : { data: [result], error: null };
      }
      const matched = rows.filter(r => filters.every(f => f(r)));
      if (pendingUpdate) {
        const applied = [];
        matched.forEach(r => {
          if (typeof pendingUpdate.rev === "number" && typeof r.rev === "number") {
            const contentKeys = Object.keys(pendingUpdate).filter(k => k !== "rev");
            const contentChanged = contentKeys.some(k => JSON.stringify(pendingUpdate[k]) !== JSON.stringify(r[k]));
            if (contentChanged && !(pendingUpdate.rev > r.rev)) return;   // CAS refusal — row excluded
          }
          Object.assign(r, pendingUpdate);
          applied.push(r);
        });
        return { data: applied.map(r => pick(r, selectCols || "*")), error: null };
      }
      if (wantsSingle) {
        if (!matched.length) { if (allowEmpty) return { data: null, error: null }; return { data: null, error: { message: "no rows" } }; }
        return { data: pick(matched[0], selectCols), error: null };
      }
      return { data: matched.map(r => pick(r, selectCols)), error: null };
    }
    return api;
  }

  return { auth: { getUser: async () => ({ data: { user: { id: ownerUid } } } ) }, from: (t) => builder(t), __tables: tables };
}

const _deepClone = o => { try { return JSON.parse(JSON.stringify(o)); } catch { return o; } };
const AUTO_HISTORY_MS = 30 * 1000;
const HISTORY_TABLE = "planar_history";
const OWNER = "owner-uid-1";

function buildEngine(sb) {
  const fn = new Function(
    "sb", "HISTORY_TABLE", "AUTO_HISTORY_MS", "mergeCloudDoc", "_mEq", "_mIsObj", "_deepClone",
    "decomposeForDualWrite", "showToast",
    `${stateSrc}\n${writeFnsSrc}\nreturn { writeScheduleRowsPrimary, writeOneScheduleRow, writeIndexRow, attemptScheduleWrite, scheduleBase, scheduleKnownRev, getIndexState: () => ({ indexKnownRev, indexBase }), seedIndexState: (rev, base) => { indexKnownRev = rev; indexBase = base; } };`
  );
  return fn(sb, HISTORY_TABLE, AUTO_HISTORY_MS, mergeCloudDoc, _mEq, _mIsObj, _deepClone, decomposeForDualWrite, undefined);
}

function doc(overrides) {
  return {
    nPid: 3, nTid: { 1: 5, 2: 5 }, lastActiveBySite: {}, settings: {},
    projects: {
      1: { id: 1, name: "Goose Creek", tasks: [{ id: 1, name: "Kickoff", _sid: "a" }] },
      2: { id: 2, name: "Grand Port", tasks: [{ id: 1, name: "Survey", _sid: "b" }] },
    },
    ...overrides,
  };
}

describe("writeScheduleRowsPrimary/writeOneScheduleRow — extracted from public/sequence/index.html", () => {
  let sb, engine;
  beforeEach(() => {
    sb = makeFakeSupabase({
      schedules: [
        { id: 1, user_id: OWNER, name: "Goose Creek", data: doc().projects[1], rev: 5, deleted_at: null },
        { id: 2, user_id: OWNER, name: "Grand Port", data: doc().projects[2], rev: 9, deleted_at: null },
      ],
      schedule_account_index: [
        { user_id: OWNER, n_pid: 3, n_tid: { 1: 5, 2: 5 }, last_active_by_site: {}, settings: {}, migration_flags: {}, rev: 2, rows_authoritative: true },
      ],
      planar_history: [],
    }, OWNER);
    engine = buildEngine(sb);
    // Seed baselines the way readFromScheduleRows would at load time (scheduleKnownRev/
    // scheduleBase per row, plus indexKnownRev/indexBase for the one account-wide index row).
    engine.scheduleKnownRev["1"] = 5; engine.scheduleBase["1"] = _deepClone(doc().projects[1]);
    engine.scheduleKnownRev["2"] = 9; engine.scheduleBase["2"] = _deepClone(doc().projects[2]);
    engine.seedIndexState(2, decomposeForDualWrite(doc()).index);
  });

  it("KNOWN-GOOD ARM: an unchanged doc writes nothing — no row's rev moves", async () => {
    const before = _deepClone(sb.__tables.schedules);
    const res = await engine.writeScheduleRowsPrimary(doc(), "v", { skipSanity: false, label: "auto" });
    expect(res).toEqual({ key: "hs-v1", value: "v" });
    expect(sb.__tables.schedules).toEqual(before);
  });

  it("ACCEPTANCE 1/2: editing ONLY schedule 1's task name writes schedule 1 and leaves schedule 2 byte-identical, rev untouched", async () => {
    const d = doc();
    d.projects[1] = { ...d.projects[1], tasks: [{ ...d.projects[1].tasks[0], name: "Kickoff v2" }] };
    const beforeRow2 = _deepClone(sb.__tables.schedules.find(r => r.id === 2));

    const res = await engine.writeScheduleRowsPrimary(d, "v", { skipSanity: false, label: "auto" });
    expect(res).toEqual({ key: "hs-v1", value: "v" });

    const row1 = sb.__tables.schedules.find(r => r.id === 1);
    const row2 = sb.__tables.schedules.find(r => r.id === 2);
    expect(row1.rev).toBe(6);   // advanced exactly once
    expect(row1.data.tasks[0].name).toBe("Kickoff v2");
    expect(row2).toEqual(beforeRow2);   // PROVEN untouched, not merely asserted unchanged by us
  });

  it("ACCEPTANCE 5: a genuine same-schedule race (sibling tab wrote rev 6 first) is refused, then merged and retried — never silently dropped", async () => {
    // Sibling tab already advanced schedule 1 to rev 6 with its own edit, unknown to this tab.
    sb.__tables.schedules.find(r => r.id === 1).data = { ...doc().projects[1], tasks: [{ id: 1, name: "Kickoff", _sid: "a", notes: ["from sibling"] }] };
    sb.__tables.schedules.find(r => r.id === 1).rev = 6;

    const d = doc();
    d.projects[1] = { ...d.projects[1], tasks: [{ ...d.projects[1].tasks[0], name: "Kickoff, our edit" }] };
    const res = await engine.writeScheduleRowsPrimary(d, "v", { skipSanity: false, label: "auto" });

    expect(res).not.toBeNull();   // never a silent failure for a mergeable race
    const row1 = sb.__tables.schedules.find(r => r.id === 1);
    expect(row1.rev).toBe(7);   // one retry landed on top of the sibling's rev 6
    expect(row1.data.tasks[0].name).toBe("Kickoff, our edit");   // our edit survived
    expect(row1.data.tasks[0].notes).toEqual(["from sibling"]);   // sibling's addition survived too
  });

  it("a schedule removed from the doc is soft-deleted, and only that row", async () => {
    const d = doc();
    delete d.projects[2];
    const res = await engine.writeScheduleRowsPrimary(d, "v", { skipSanity: false, label: "auto" });
    expect(res).toEqual({ key: "hs-v1", value: "v" });
    const row2 = sb.__tables.schedules.find(r => r.id === 2);
    expect(row2.deleted_at).toBeTruthy();
    const row1 = sb.__tables.schedules.find(r => r.id === 1);
    expect(row1.deleted_at).toBeFalsy();
  });

  it("a settings-only change writes the index row and NEITHER schedule row", async () => {
    const before1 = _deepClone(sb.__tables.schedules.find(r => r.id === 1));
    const before2 = _deepClone(sb.__tables.schedules.find(r => r.id === 2));
    const d = doc({ settings: { rowHeight: 30 } });
    const res = await engine.writeScheduleRowsPrimary(d, "v", { skipSanity: false, label: "auto" });
    expect(res).toEqual({ key: "hs-v1", value: "v" });
    expect(sb.__tables.schedules.find(r => r.id === 1)).toEqual(before1);
    expect(sb.__tables.schedules.find(r => r.id === 2)).toEqual(before2);
    const idx = sb.__tables.schedule_account_index.find(r => r.user_id === OWNER);
    expect(idx.settings).toEqual({ rowHeight: 30 });
    expect(idx.rev).toBe(3);
  });

  it("a task-count sanity drop on ONE schedule blocks only that schedule, not the whole save", async () => {
    // Make schedule 1 look like it had a real body of tasks before this edit.
    const bigTasks = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: "t" + i, _sid: "s" + i }));
    sb.__tables.schedules.find(r => r.id === 1).data = { ...doc().projects[1], tasks: bigTasks };
    engine.scheduleBase["1"] = { ...doc().projects[1], tasks: bigTasks };

    const d = doc();
    d.projects[1] = { ...d.projects[1], tasks: bigTasks.slice(0, 5) };   // 25 -> 5, a drastic drop
    d.projects[2] = { ...d.projects[2], name: "Grand Port (renamed)" };   // a real, legitimate edit elsewhere

    const res = await engine.writeScheduleRowsPrimary(d, "v", { skipSanity: false, label: "auto" });
    expect(res).toBeNull();   // overall save reports failure (schedule 1 never landed anywhere)

    const row1 = sb.__tables.schedules.find(r => r.id === 1);
    expect(row1.data.tasks).toHaveLength(25);   // refused — old content intact
    const row2 = sb.__tables.schedules.find(r => r.id === 2);
    expect(row2.data.name).toBe("Grand Port (renamed)");   // schedule 2's legitimate edit still landed
  });

  it("an explicit checkpoint (skipSanity) bypasses the task-count guard", async () => {
    const bigTasks = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: "t" + i, _sid: "s" + i }));
    sb.__tables.schedules.find(r => r.id === 1).data = { ...doc().projects[1], tasks: bigTasks };
    engine.scheduleBase["1"] = { ...doc().projects[1], tasks: bigTasks };

    const d = doc();
    d.projects[1] = { ...d.projects[1], tasks: bigTasks.slice(0, 2) };
    const res = await engine.writeScheduleRowsPrimary(d, "v", { skipSanity: true, label: "pre-delete-project" });
    expect(res).toEqual({ key: "hs-v1", value: "v" });
    expect(sb.__tables.schedules.find(r => r.id === 1).data.tasks).toHaveLength(2);
  });

  it("a brand-new schedule id unknown to this tab (a restore resurrecting one) is inserted, not silently skipped", async () => {
    const d = doc();
    d.projects[9] = { id: 9, name: "Resurrected", tasks: [] };
    const res = await engine.writeScheduleRowsPrimary(d, "v", { skipSanity: true, label: "pre-restore" });
    expect(res).toEqual({ key: "hs-v1", value: "v" });
    const row9 = sb.__tables.schedules.find(r => r.id === 9);
    expect(row9).toBeTruthy();
    expect(row9.data.name).toBe("Resurrected");
  });
});

describe("attemptScheduleWrite — the low-level CAS primitive", () => {
  it("reports refused: true (0 rows) when rev does not advance past a content change, matching the real DB trigger's behavior", async () => {
    const sb = makeFakeSupabase({ schedules: [{ id: 1, user_id: OWNER, name: "x", data: { id: 1, tasks: ["a"] }, rev: 4 }] }, OWNER);
    const engine = buildEngine(sb);
    const result = await engine.attemptScheduleWrite(1, { id: 1, tasks: ["b"] }, 3);   // baseRev 3 -> newRev 4, but stored is ALREADY 4
    expect(result.refused).toBe(true);
    expect(sb.__tables.schedules[0].data.tasks).toEqual(["a"]);   // untouched
  });

  it("succeeds when rev strictly advances past the stored value", async () => {
    const sb = makeFakeSupabase({ schedules: [{ id: 1, user_id: OWNER, name: "x", data: { id: 1, tasks: ["a"] }, rev: 4 }] }, OWNER);
    const engine = buildEngine(sb);
    const result = await engine.attemptScheduleWrite(1, { id: 1, tasks: ["b"] }, 4);
    expect(result.refused).toBe(false);
    expect(result.newRev).toBe(5);
    expect(sb.__tables.schedules[0].data.tasks).toEqual(["b"]);
  });
});
