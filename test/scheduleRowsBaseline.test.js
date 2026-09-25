/* NEW-1 — false "A newer version was saved elsewhere" banner + empty "Merged in changes saved
 * elsewhere" toast on a flipped (rows_authoritative) account with a single user and no other
 * device (owner report 2026-09-25, DISPATCH). Measured on public.client_errors: three identical
 * `schedules-version-guard-refused` rows for the same schedule id (stored_rev === attempted_rev)
 * inside one second, interleaved with `merge-toast` rows reporting "0 tasks updated across 0
 * schedules" — the account was never actually conflicted; it was racing against ANOTHER INSTANCE
 * OF ITSELF (a keep-alive Scheduler iframe kept alive in every open planyr.io tab, each its own
 * storage instance).
 *
 * Root cause (see public/sequence/index.html): readFromScheduleRows seeds scheduleBase from the
 * RAW stored row.data, but the in-app document is never byte-equal to that raw row once the App's
 * normalize pipeline (normalizeToV8/normalizeIds/ensureContacts/normalizeOwnerLists/
 * recascadeWithDrift) and stripViewState have run on it — so writeScheduleRowsPrimary's
 * `_mEq(s.data, base)` no-op check compared apples to oranges on the first save of every load,
 * rewriting every schedule even with zero user edits.
 *
 * This test extracts the REAL functions from public/sequence/index.html — same "never drift from
 * the shipped code" pattern as test/schedulerSaveQueue.test.js and test/schedulerViewState.test.js
 * — so it can never pass against a stale reimplementation of the fix.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  mergeCloudDoc, _mEq, _mIsObj, decomposeForDualWrite,
  countChangedTaskRows, changedProjectIds, mergeLocationPhrase,
} from "../ui-audit/stress/scheduler-engine.mjs";

const _deepClone = (o) => { try { return JSON.parse(JSON.stringify(o)); } catch { return o; } };

const SRC = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");

// Structural landmarks (the block's own opening declaration + the next top-level declaration/
// object literal), never a copy of the logic — a mutation inside a block changes what gets
// extracted and evaluated, it never breaks the extraction step itself. Same pattern as
// test/schedulerSaveQueue.test.js / test/schedulerViewState.test.js.
function sliceBetween(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  expect(start, `"${startMarker}" not found in public/sequence/index.html`).toBeGreaterThan(-1);
  const end = SRC.indexOf(endMarker, start);
  expect(end, `"${endMarker}" not found after "${startMarker}"`).toBeGreaterThan(-1);
  return SRC.slice(start, end);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Extraction #1: stripViewState (real, with its VIEW_STATE_KEYS/TASK_VIEW_FIELDS dependencies) —
// reused verbatim from test/schedulerViewState.test.js's own extraction slice.
// ─────────────────────────────────────────────────────────────────────────────────────────────
function makeViewStateModule() {
  const viewStateSrc = sliceBetween("const VIEW_TAB_KEYS", "function App() {");
  const fn = new Function(
    "sessionStorage", "localStorage",
    `${viewStateSrc}\nreturn { stripViewState };`
  );
  const storage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  return fn(storage(), storage());
}
const { stripViewState } = makeViewStateModule();

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Extraction #2: reseedScheduleBaseline (the fix for the root cause above).
// ─────────────────────────────────────────────────────────────────────────────────────────────
function makeReseedHarness({ scheduleRowsAuthoritative, scheduleBase }) {
  const src = sliceBetween(
    "const reseedScheduleBaseline = (doc) => {",
    "\n  const countTasks = (parsed) => {"
  );
  const fn = new Function(
    "scheduleRowsAuthoritative", "decomposeForDualWrite", "stripViewState", "_deepClone", "scheduleBase",
    `
    let indexBase = null;
    ${src}
    return { reseedScheduleBaseline, getIndexBase: () => indexBase };
    `
  );
  return fn(scheduleRowsAuthoritative, decomposeForDualWrite, stripViewState, _deepClone, scheduleBase);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Extraction #3: the storage-layer write path — writeScheduleHistorySnapshot through
// writeScheduleRowsPrimary, one contiguous block in the shipped file.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const rowWriterSrc = sliceBetween(
  "const writeScheduleHistorySnapshot = (scheduleId, projData, label) => {",
  "\n  window.storage = {"
);

// A minimal fake PostgREST-shaped `sb` client — only the exact chains the extracted code calls.
// `schedules`/`index` are plain Maps/objects the test seeds and inspects directly (the "database").
function makeFakeSb({ schedules = new Map(), indexRow = null, ownerUid = "user-1" } = {}) {
  function matchRow(row, filters) { return filters.every(([col, val]) => row[col] === val); }
  function makeBuilder(table) {
    let op = null, payload = null;
    const filters = [];
    const builder = {
      update(obj) { op = "update"; payload = obj; return builder; },
      insert(obj) { op = "insert"; payload = obj; return builder; },
      select() { if (op == null) op = "select"; return builder; },
      eq(col, val) { filters.push([col, val]); return builder; },
      is(col, val) { filters.push([col, val]); return builder; },
      async maybeSingle() {
        const rows = runSelect();
        return { data: rows[0] || null, error: null };
      },
      async single() {
        const rows = runSelect();
        return rows.length ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116" } };
      },
      then(resolve, reject) { return run().then(resolve, reject); },
    };
    function runSelect() {
      if (table === "schedules") return [...schedules.values()].filter(r => matchRow(r, filters));
      if (table === "schedule_account_index") return indexRow && matchRow(indexRow, filters) ? [indexRow] : [];
      return [];
    }
    async function run() {
      if (table === "planar_history") {
        if (op === "insert") return { error: null };
        return { data: null, error: null };
      }
      if (table === "schedules") {
        if (op === "insert") {
          if (schedules.has(payload.id)) return { error: { code: "23505" } };
          schedules.set(payload.id, { ...payload });
          return { error: null };
        }
        if (op === "update") {
          const matches = [...schedules.values()].filter(r => matchRow(r, filters));
          if (!matches.length) return { data: [], error: null };
          const row = matches[0];
          // Mirrors the real schedules_enforce_version_monotonic trigger: silently skip (0 rows
          // returned) unless the new rev strictly exceeds the row's current rev. An update that
          // never touches `rev` at all (the soft-delete tombstone) is never refused.
          if (typeof payload.rev === "number" && payload.rev <= row.rev) return { data: [], error: null };
          Object.assign(row, payload);
          return { data: [{ id: row.id }], error: null };
        }
      }
      if (table === "schedule_account_index") {
        if (op === "update") {
          if (!indexRow || !matchRow(indexRow, filters)) return { data: [], error: null };
          if (typeof payload.rev === "number" && payload.rev <= indexRow.rev) return { data: [], error: null };
          Object.assign(indexRow, payload);
          return { data: [{ user_id: indexRow.user_id }], error: null };
        }
      }
      return { data: null, error: null };
    }
    return builder;
  }
  return { auth: { getUser: async () => ({ data: { user: { id: ownerUid } } }) }, from: (table) => makeBuilder(table) };
}

function makeFakeWindow() {
  const listeners = {};
  return {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    dispatchEvent(evt) { (listeners[evt.type] || []).forEach(fn => fn(evt)); return true; },
    _listenersFor: (type) => listeners[type] || [],
  };
}

function makeRowWriter({ sb, scheduleKnownRev = {}, scheduleBase = {}, scheduleStaleSnapped = {}, indexKnownRev = 0, indexBase = null, fakeWindow = makeFakeWindow(), consoleStub = { error: vi.fn(), warn: vi.fn() } }) {
  const fn = new Function(
    "sb", "_mEq", "_mIsObj", "_deepClone", "mergeCloudDoc", "decomposeForDualWrite",
    "console", "window", "showToast",
    "scheduleKnownRev", "scheduleBase", "scheduleStaleSnapped", "scheduleLastAutoHistoryAt",
    "AUTO_HISTORY_MS", "HISTORY_TABLE", "SCHEDULE_SANITY_MIN_TASKS", "SCHEDULE_SANITY_DROP_RATIO",
    "indexKnownRevInit", "indexBaseInit",
    `
    let indexKnownRev = indexKnownRevInit, indexBase = indexBaseInit;
    ${rowWriterSrc}
    return { writeOneScheduleRow, writeScheduleRowsPrimary, attemptScheduleWrite, writeIndexRow, getIndexState: () => ({ indexKnownRev, indexBase }) };
    `
  );
  const mod = fn(
    sb, _mEq, _mIsObj, _deepClone, mergeCloudDoc, decomposeForDualWrite,
    consoleStub, fakeWindow, () => {},
    scheduleKnownRev, scheduleBase, scheduleStaleSnapped, {},
    30000, "planar_history", 20, 0.5,
    indexKnownRev, indexBase
  );
  return { ...mod, sb, scheduleKnownRev, scheduleBase, scheduleStaleSnapped, fakeWindow, consoleStub };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("reseedScheduleBaseline — fixes the root cause (raw-row baseline vs normalized doc)", () => {
  it("is a no-op for an account that hasn't been flipped", () => {
    const scheduleBase = { "1": { stale: true } };
    const { reseedScheduleBaseline } = makeReseedHarness({ scheduleRowsAuthoritative: false, scheduleBase });
    reseedScheduleBaseline({ projects: { 1: { id: 1, name: "X", tasks: [] } } });
    expect(scheduleBase).toEqual({ "1": { stale: true } });   // untouched
  });

  it("THE BUG (F-i): a raw-row baseline mismatches the normalized doc's decomposed shape, so writeScheduleRowsPrimary would write every schedule with zero real edits", () => {
    // A realistic normalization artifact: the load pipeline's recascade stamps a `_sid` onto every
    // task (normalizeIds) — the raw DB row, seeded straight from readFromScheduleRows, never has one.
    const rawRow = { id: 1, name: "Goose Creek", tasks: [{ id: 1, name: "Kickoff" }] };
    const normalizedDoc = {
      projects: { 1: { id: 1, name: "Goose Creek", tasks: [{ id: 1, _sid: "a", name: "Kickoff" }] } },
    };
    const decomposedFromNormalized = decomposeForDualWrite(stripViewState(normalizedDoc)).schedules[0].data;
    // This is exactly writeScheduleRowsPrimary's own no-op test (`_mEq(s.data, base)`) evaluated
    // against the OLD (raw-row) baseline — false, so the schedule would be written for nothing.
    expect(_mEq(decomposedFromNormalized, rawRow)).toBe(false);
  });

  it("THE FIX (F-i): after reseeding from the normalized doc, the SAME no-op test now matches — zero spurious writes", () => {
    const normalizedDoc = {
      projects: {
        1: { id: 1, name: "Goose Creek", tasks: [{ id: 1, _sid: "a", name: "Kickoff" }] },
        2: { id: 2, name: "Grand Port", tasks: [] },
      },
    };
    const scheduleBase = {};
    const { reseedScheduleBaseline } = makeReseedHarness({ scheduleRowsAuthoritative: true, scheduleBase });
    reseedScheduleBaseline(normalizedDoc);
    const decomposed = decomposeForDualWrite(stripViewState(normalizedDoc));
    decomposed.schedules.forEach(s => {
      expect(_mEq(s.data, scheduleBase[String(s.id)])).toBe(true);   // the exact check writeScheduleRowsPrimary runs
    });
  });

  it("leaves scheduleKnownRev untouched (revs come from the real rows, never from re-normalizing the document)", () => {
    const scheduleKnownRev = { "1": 107 };
    const scheduleBase = {};
    const { reseedScheduleBaseline } = makeReseedHarness({ scheduleRowsAuthoritative: true, scheduleBase });
    reseedScheduleBaseline({ projects: { 1: { id: 1, name: "X", tasks: [] } } });
    expect(scheduleKnownRev).toEqual({ "1": 107 });   // never touched by the reseed
  });

  it("strips view-state (stripTaskViewFields' `focused`) before decomposing, so a per-task view toggle never poisons the baseline", () => {
    const scheduleBase = {};
    const { reseedScheduleBaseline } = makeReseedHarness({ scheduleRowsAuthoritative: true, scheduleBase });
    const doc = { aPid: 1, projects: { 1: { id: 1, name: "X", tasks: [{ id: 1, name: "Kickoff", focused: true }] } } };
    reseedScheduleBaseline(doc);
    expect(scheduleBase["1"].tasks[0]).not.toHaveProperty("focused");
    expect(scheduleBase["1"]).not.toHaveProperty("aPid");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("writeOneScheduleRow — identical-content refusal is not a conflict (Fix B)", () => {
  it("a refusal whose cloud content is byte-identical to what this tab tried to write is silently adopted: no second write, no stale-block/premerge-ours snapshot, no console.error", async () => {
    // Schedule 2, cloud already at rev 131 holding EXACTLY what this tab is about to try to write
    // (another instance of the same account won the race a moment earlier) — the measured shape:
    // "id=2 stored_rev=131 attempted_rev=131" logged three times in one second.
    const cloudData = { id: 2, name: "Sched", tasks: [] };
    const schedules = new Map([[2, { id: 2, data: cloudData, rev: 131, user_id: "user-1" }]]);
    const sb = makeFakeSb({ schedules });
    const scheduleKnownRev = { "2": 130 };   // this tab's stale idea of the rev (one behind)
    const scheduleBase = { "2": cloudData };
    const scheduleStaleSnapped = {};
    const { writeOneScheduleRow, consoleStub } = makeRowWriter({ sb, scheduleKnownRev, scheduleBase, scheduleStaleSnapped });

    const result = await writeOneScheduleRow("user-1", 2, cloudData, { label: "auto" });

    expect(result).toEqual({ merged: null });
    expect(scheduleKnownRev["2"]).toBe(131);          // adopted the real cloud rev
    expect(scheduleBase["2"]).toEqual(cloudData);
    expect(scheduleStaleSnapped["2"]).toBe(false);
    expect(schedules.get(2).rev).toBe(131);           // NO second write bumped it further
    expect(consoleStub.error).not.toHaveBeenCalled();  // no stale-block / "lost the race" noise
  });

  it("MUTATION-DISCRIMINATING: with no baseline for this schedule yet (scheduleBase[key] undefined), identical content can ONLY be caught by the check-#1 short-circuit -- mergeCloudDoc is never even called without a base, so a reliance on check-#2 alone would misreport this as an unrecoverable conflict", async () => {
    const cloudData = { id: 2, name: "Sched", tasks: [] };
    const schedules = new Map([[2, { id: 2, data: cloudData, rev: 131, user_id: "user-1" }]]);
    const sb = makeFakeSb({ schedules });
    const scheduleKnownRev = { "2": 130 };
    const scheduleBase = {};   // deliberately NOT seeded for "2"
    const { writeOneScheduleRow, consoleStub } = makeRowWriter({ sb, scheduleKnownRev, scheduleBase, scheduleStaleSnapped: {} });

    const result = await writeOneScheduleRow("user-1", 2, cloudData, { label: "auto" });

    expect(result).toEqual({ merged: null });
    expect(scheduleKnownRev["2"]).toBe(131);
    expect(consoleStub.error).not.toHaveBeenCalled();
  });

  it("a 3-way merge that resolves to exactly the cloud row's own content is adopted without a second write", async () => {
    // ancestor -> both this tab AND the cloud independently flipped `flag` the same way; only the
    // CLOUD also carries its own separate `name` change. mergeCloudDoc(base, ours, theirs) then
    // converges to exactly `theirs` even though `ours` (newData) was never literally equal to it.
    const ancestor = { id: 2, name: "Sched", tasks: [], flag: false };
    const newData  = { id: 2, name: "Sched", tasks: [], flag: true };
    const cloudData = { id: 2, name: "Sched2", tasks: [], flag: true };
    expect(mergeCloudDoc(ancestor, newData, cloudData)).toEqual(cloudData);   // sanity on the fixture itself
    expect(_mEq(newData, cloudData)).toBe(false);                            // NOT the check-#1 case

    const schedules = new Map([[2, { id: 2, data: cloudData, rev: 50, user_id: "user-1" }]]);
    const sb = makeFakeSb({ schedules });
    const scheduleKnownRev = { "2": 49 };
    const scheduleBase = { "2": ancestor };
    const { writeOneScheduleRow, consoleStub } = makeRowWriter({ sb, scheduleKnownRev, scheduleBase, scheduleStaleSnapped: {} });

    const result = await writeOneScheduleRow("user-1", 2, newData, { label: "auto" });

    expect(result).toEqual({ merged: null });
    expect(scheduleKnownRev["2"]).toBe(50);
    expect(scheduleBase["2"]).toEqual(cloudData);
    expect(schedules.get(2).rev).toBe(50);   // still no second write
    expect(consoleStub.error).not.toHaveBeenCalled();
  });

  it("regression: a GENUINE conflict (content really differs after the merge) still performs the second CAS write and merges normally", async () => {
    const ancestor = { id: 2, name: "Sched", tasks: [], siteId: null };
    const newData  = { id: 2, name: "Sched New", tasks: [], siteId: null };            // our real edit
    const cloudData = { id: 2, name: "Sched", tasks: [], siteId: "gc" };               // their real edit
    const schedules = new Map([[2, { id: 2, data: cloudData, rev: 50, user_id: "user-1" }]]);
    const sb = makeFakeSb({ schedules });
    const scheduleKnownRev = { "2": 49 };
    const scheduleBase = { "2": ancestor };
    const { writeOneScheduleRow } = makeRowWriter({ sb, scheduleKnownRev, scheduleBase, scheduleStaleSnapped: {} });

    const result = await writeOneScheduleRow("user-1", 2, newData, { label: "auto" });

    expect(result.merged).toEqual({ id: 2, name: "Sched New", tasks: [], siteId: "gc" });
    expect(schedules.get(2).rev).toBe(51);   // the real second CAS write DID happen
    expect(scheduleKnownRev["2"]).toBe(51);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("writeScheduleRowsPrimary — the full acceptance scenario (Fix A+B+C together)", () => {
  it("two instances of the same account, both reseeded from an identical baseline: the editor writes one row, the idle instance's own autosave then writes ZERO rows and raises no stale event", async () => {
    const schedA = { id: 1, name: "Goose Creek", tasks: [] };
    const schedB = { id: 2, name: "Grand Port", tasks: [] };
    const indexRow = { user_id: "user-1", n_pid: 3, n_tid: {}, last_active_by_site: {}, settings: {}, migration_flags: {}, rev: 5 };
    const schedules = new Map([
      [1, { id: 1, data: schedA, rev: 10, user_id: "user-1" }],
      [2, { id: 2, data: schedB, rev: 10, user_id: "user-1" }],
    ]);
    const sb = makeFakeSb({ schedules, indexRow });

    // Both instances "loaded" identically -- baselines match the DB exactly (what Fix A guarantees
    // in the real app via reseedScheduleBaseline).
    const instanceA = makeRowWriter({
      sb, scheduleKnownRev: { "1": 10, "2": 10 }, scheduleBase: { "1": _deepClone(schedA), "2": _deepClone(schedB) },
      scheduleStaleSnapped: {}, indexKnownRev: 5, indexBase: _deepClone({ nPid: 3, nTid: {}, lastActiveBySite: {}, settings: {}, migrationFlags: {} }),
    });
    const instanceB = makeRowWriter({
      sb, scheduleKnownRev: { "1": 10, "2": 10 }, scheduleBase: { "1": _deepClone(schedA), "2": _deepClone(schedB) },
      scheduleStaleSnapped: {}, indexKnownRev: 5, indexBase: _deepClone({ nPid: 3, nTid: {}, lastActiveBySite: {}, settings: {}, migrationFlags: {} }),
    });

    // Instance A edits schedule 1's name and saves the WHOLE doc (as attemptCloudSave always does).
    const editedDoc = {
      nPid: 3, nTid: {}, lastActiveBySite: {}, settings: {},
      projects: { 1: { id: 1, name: "Goose Creek EDITED", tasks: [] }, 2: { id: 2, name: "Grand Port", tasks: [] } },
    };
    let staleFiredA = false, mergedFiredA = false;
    instanceA.fakeWindow.addEventListener("planar:stale", () => { staleFiredA = true; });
    instanceA.fakeWindow.addEventListener("planar:merged", () => { mergedFiredA = true; });
    const resA = await instanceA.writeScheduleRowsPrimary(editedDoc, JSON.stringify(editedDoc), { label: "auto" });
    expect(resA).not.toBeNull();
    expect(staleFiredA).toBe(false);
    expect(mergedFiredA).toBe(false);
    expect(schedules.get(1).rev).toBe(11);    // exactly the ONE edited row was written
    expect(schedules.get(2).rev).toBe(10);    // schedule 2 untouched

    // Instance B, still holding its OWN unedited doc, now fires an ordinary autosave (a carry-in
    // re-drive, a settings touch -- anything that calls attemptCloudSave with no real user edit).
    const untouchedDoc = {
      nPid: 3, nTid: {}, lastActiveBySite: {}, settings: {},
      projects: { 1: { id: 1, name: "Goose Creek", tasks: [] }, 2: { id: 2, name: "Grand Port", tasks: [] } },
    };
    let staleFiredB = false, mergedFiredB = false;
    instanceB.fakeWindow.addEventListener("planar:stale", () => { staleFiredB = true; });
    instanceB.fakeWindow.addEventListener("planar:merged", () => { mergedFiredB = true; });
    const writesBefore = { s1: schedules.get(1).rev, s2: schedules.get(2).rev };
    const resB = await instanceB.writeScheduleRowsPrimary(untouchedDoc, JSON.stringify(untouchedDoc), { label: "auto" });

    expect(resB).not.toBeNull();
    expect(staleFiredB).toBe(false);     // THE regression this item exists to fix
    expect(mergedFiredB).toBe(false);    // and no "0 tasks updated" toast either
    expect(schedules.get(1).rev).toBe(writesBefore.s1);   // zero writes: instance B's own baseline
    expect(schedules.get(2).rev).toBe(writesBefore.s2);   // still matched what it was about to send
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("onMerged toast handler — empty merges are silent (Fix D)", () => {
  function makeOnMergedHarness() {
    const src = sliceBetween("const onMerged = (e) => {", '\n    window.addEventListener("planar:merged", onMerged);');
    const setDataCalls = [];
    const state = { staleNotice: null, toasts: [], mergeToastLogs: [] };
    const fn = new Function(
      "countChangedTaskRows", "changedProjectIds", "mergeLocationPhrase", "dataRef", "setData",
      "mergeCloudDoc", "setStaleNotice", "showToast", "logMergeToastEvent", "_mEq",
      `${src}\nreturn onMerged;`
    );
    const onMerged = fn(
      countChangedTaskRows, changedProjectIds, mergeLocationPhrase,
      { current: { aPid: 1 } },
      (updater) => setDataCalls.push(updater),
      mergeCloudDoc,
      (v) => { state.staleNotice = v; },
      (msg, opts) => { state.toasts.push({ msg, opts }); },
      (changedRows, changedPids, projects) => { state.mergeToastLogs.push({ changedRows, changedPids }); },
      _mEq
    );
    return { onMerged, state, setDataCalls };
  }

  it("a merge whose result is byte-identical to the ancestor (nothing really changed) never toasts and never logs a merge-toast telemetry row", () => {
    const { onMerged, state } = makeOnMergedHarness();
    const anc = { aPid: 1, projects: { 1: { id: 1, name: "X", tasks: [] } } };
    const merged = { aPid: 1, projects: { 1: { id: 1, name: "X", tasks: [] } } };   // identical content, only __rev moved
    onMerged({ detail: { value: merged, base: anc } });
    expect(state.toasts).toEqual([]);
    expect(state.mergeToastLogs).toEqual([]);
    expect(state.staleNotice).toBe(false);   // still clears the banner -- this tab IS caught up
  });

  it("a real change (a genuine task edit merged in) still toasts with the honest count", () => {
    const { onMerged, state } = makeOnMergedHarness();
    const anc = { aPid: 1, projects: { 1: { id: 1, name: "X", tasks: [{ id: 1, _sid: "a", name: "Kickoff" }] } } };
    const merged = { aPid: 1, projects: { 1: { id: 1, name: "X", tasks: [{ id: 1, _sid: "a", name: "Kickoff v2" }] } } };
    onMerged({ detail: { value: merged, base: anc } });
    expect(state.toasts.length).toBe(1);
    expect(state.toasts[0].msg).toMatch(/1 task updated/);
    expect(state.mergeToastLogs.length).toBe(1);
  });

  it("a project-metadata-only change (no task diff, but the projects tree really differs) still toasts -- countChangedTaskRows alone must never be trusted to mean 'nothing changed'", () => {
    const { onMerged, state } = makeOnMergedHarness();
    const anc = { aPid: 1, projects: { 1: { id: 1, name: "X", linkedSiteId: null, tasks: [] } } };
    const merged = { aPid: 1, projects: { 1: { id: 1, name: "X", linkedSiteId: "gc", tasks: [] } } };
    onMerged({ detail: { value: merged, base: anc } });
    expect(state.toasts.length).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("the live-refresh poll's check() — a clean, visible tab catches up SILENTLY instead of nagging (Fix E)", () => {
  function makeCheckHarness({ checkRemoteResult, saveStatus, hidden, silentRefreshResult }) {
    const src = sliceBetween("let stopped = false;", "\n    const iv = setInterval(check, 20000);");
    const state = { staleNotice: null, reloaded: false, applied: null };
    const fakeWindow = {
      storage: {
        checkRemote: async () => checkRemoteResult,
        silentRefresh: silentRefreshResult === undefined ? undefined : (async () => silentRefreshResult),
      },
      location: { reload: () => { state.reloaded = true; } },
    };
    const fn = new Function(
      "window", "document", "saveStatusRef", "setStaleNotice", "applyLoadedDataRef",
      `${src}\nreturn check;`
    );
    const check = fn(
      fakeWindow, { hidden },
      { current: saveStatus },
      (v) => { state.staleNotice = v; },
      { current: (fresh) => { state.applied = fresh; } }
    );
    return { check, state, fakeWindow };
  }

  it("clean + visible + newer: silently pulls fresh rows and clears the banner -- no nag", async () => {
    const { check, state } = makeCheckHarness({
      checkRemoteResult: { ok: true, newer: true },
      saveStatus: "saved", hidden: false,
      silentRefreshResult: { projects: { 1: { id: 1, name: "X", tasks: [] } } },
    });
    await check();
    expect(state.staleNotice).toBe(false);
    expect(state.applied).toEqual({ projects: { 1: { id: 1, name: "X", tasks: [] } } });
    expect(state.reloaded).toBe(false);
  });

  it("dirty tab (unsaved edits) + newer: still shows the banner -- it has something of its own to protect", async () => {
    const { check, state } = makeCheckHarness({
      checkRemoteResult: { ok: true, newer: true },
      saveStatus: "saving", hidden: false,
      silentRefreshResult: { projects: {} },
    });
    await check();
    expect(state.staleNotice).toBe(true);
    expect(state.applied).toBe(null);   // silent catch-up never runs for a dirty tab
  });

  it("clean + hidden + newer: still reloads the page (unchanged prior behavior)", async () => {
    const { check, state } = makeCheckHarness({
      checkRemoteResult: { ok: true, newer: true },
      saveStatus: "saved", hidden: true,
      silentRefreshResult: { projects: {} },
    });
    await check();
    expect(state.reloaded).toBe(true);
    expect(state.applied).toBe(null);
  });

  it("not newer: clears the banner and does nothing else", async () => {
    const { check, state } = makeCheckHarness({
      checkRemoteResult: { ok: true, newer: false },
      saveStatus: "saved", hidden: false,
    });
    await check();
    expect(state.staleNotice).toBe(false);
    expect(state.applied).toBe(null);
    expect(state.reloaded).toBe(false);
  });
});
