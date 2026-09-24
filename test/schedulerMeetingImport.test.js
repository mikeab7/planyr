import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as E from "../ui-audit/stress/scheduler-engine.mjs";

// NEW-1 (B1824576) — "Reuse a meeting calendar from another schedule instead of rebuilding it."
// The import/copy/dedup logic lives in public/sequence/index.html (compiled in-browser by Babel
// — not importable), so ui-audit/stress/scheduler-engine.mjs carries a VERBATIM mirror, same
// discipline as every other meeting-body engine function in this repo (see schedulerEngine.test.js).

const rules = {
  // "the 3rd Tuesday of every month"
  thirdTuesday: [{ positions: [3], weekday: 2, months: "all", anchor: null }],
  // "the 2nd and 4th Thursday of every month"
  secondFourthThursday: [{ positions: [2, 4], weekday: 4, months: "all", anchor: null }],
  // "the 1st Saturday of May" + "the Tuesday after the 1st Monday of November" (Election Day primitive)
  mayAndElectionDay: [
    { positions: [1], weekday: 6, months: [5], anchor: null },
    { positions: [1], weekday: 2, months: [11], anchor: { position: 1, weekday: 1 } },
  ],
};

const mkBody = (id, name, recurrence, extra = {}) => ({
  id, name, recurrence, agendaLead: { type: "offset", n: 10, unit: "business" },
  blackoutDates: [], extraDates: [], ...extra,
});

describe("importMeetingBody / importMeetingBodies — red-proof: schedule B can bind to a body that only exists in schedule A", () => {
  it("a body copied into another schedule resolves to the SAME dates as the source, for all three real cadence shapes", () => {
    const from = "2026-01-01", to = "2028-01-01";
    for (const [key, recurrence] of Object.entries(rules)) {
      const source = mkBody("mb_src_" + key, "Council — " + key, recurrence);
      const { bodies, id } = E.importMeetingBody([], source, 0);
      const copy = bodies.find(b => b.id === id);
      expect(copy).toBeTruthy();
      expect(copy.id).not.toBe(source.id); // globally-unique id (B816) — never shares the source's id
      expect(E.meetingDatesInRange(copy, from, to)).toEqual(E.meetingDatesInRange(source, from, to));
    }
  });

  it("a task in schedule B binds to a body stored in B (not a reference into A) once imported", () => {
    // Schedule A's own body — B never touches this array.
    const scheduleABodies = [mkBody("mb_council_a", "Baytown Council", rules.thirdTuesday)];
    // Schedule B starts with none.
    let scheduleBBodies = [];
    const { bodies, id } = E.importMeetingBody(scheduleBBodies, scheduleABodies[0], 0);
    scheduleBBodies = bodies;
    expect(scheduleBBodies).toHaveLength(1);
    expect(scheduleBBodies[0].id).not.toBe("mb_council_a");
    // The task binds to B's own copy's id.
    const task = { meetingBound: true, meetingBodyId: id };
    const boundBody = scheduleBBodies.find(b => b.id === task.meetingBodyId);
    expect(boundBody).toBeTruthy();
    expect(E.meetingDatesInRange(boundBody, "2026-01-01", "2028-01-01"))
      .toEqual(E.meetingDatesInRange(scheduleABodies[0], "2026-01-01", "2028-01-01"));
  });
});

describe("copyMeetingBodyWithNewId — the copy and the source are fully independent", () => {
  it("editing the copy does not change the source, and vice versa", () => {
    const source = mkBody("mb_a", "Council", rules.secondFourthThursday);
    const copy = E.copyMeetingBodyWithNewId(source, 0);
    copy.name = "Renamed Council";
    copy.recurrence[0].positions = [1];
    expect(source.name).toBe("Council");
    expect(source.recurrence[0].positions).toEqual([2, 4]);
    // and the reverse
    const source2 = mkBody("mb_b", "P&Z", rules.thirdTuesday);
    const copy2 = E.copyMeetingBodyWithNewId(source2, 1);
    source2.name = "Renamed P&Z";
    source2.recurrence[0].positions = [1];
    expect(copy2.name).toBe("P&Z");
    expect(copy2.recurrence[0].positions).toEqual([3]);
  });

  it("mints a fresh, globally-unique id every call, even for the same source in the same millisecond", () => {
    const source = mkBody("mb_x", "Council", rules.thirdTuesday);
    const ids = new Set();
    for (let i = 0; i < 20; i++) ids.add(E.copyMeetingBodyWithNewId(source, i).id);
    expect(ids.size).toBe(20);
  });
});

describe("mbBodiesSameCadence / importMeetingBody — no silent duplicates", () => {
  it("importing the exact same body twice yields ONE copy, not two", () => {
    const source = mkBody("mb_src", "Baytown Council", rules.thirdTuesday);
    let bodies = [];
    let r1 = E.importMeetingBody(bodies, source, 0); bodies = r1.bodies;
    let r2 = E.importMeetingBody(bodies, source, 1); bodies = r2.bodies;
    expect(bodies).toHaveLength(1);
    expect(r2.id).toBe(r1.id);
    expect(r2.created).toBe(false);
  });

  it("a same-name body with a DIFFERENT cadence imports as a second, distinct body", () => {
    const a = mkBody("mb_a", "Baytown Council", rules.thirdTuesday);
    const b = mkBody("mb_b", "Baytown Council", rules.secondFourthThursday);
    let bodies = [];
    bodies = E.importMeetingBody(bodies, a, 0).bodies;
    const r2 = E.importMeetingBody(bodies, b, 1);
    bodies = r2.bodies;
    expect(bodies).toHaveLength(2);
    expect(r2.created).toBe(true);
    // the two resolve to different dates — the point of keeping both
    expect(E.meetingDatesInRange(bodies[0], "2026-01-01", "2026-12-31"))
      .not.toEqual(E.meetingDatesInRange(bodies[1], "2026-01-01", "2026-12-31"));
  });

  it("a body already present under a DIFFERENT name (same cadence) is NOT treated as a duplicate", () => {
    const a = mkBody("mb_a", "Baytown Council", rules.thirdTuesday);
    const b = mkBody("mb_b", "P&Z Commission", rules.thirdTuesday); // same cadence, different name
    let bodies = [a];
    const r = E.importMeetingBody(bodies, b, 0);
    expect(r.created).toBe(true);
    expect(r.bodies).toHaveLength(2);
  });

  it("importMeetingBodies (the multi-select batch) dedupes a repeated pick within the SAME batch", () => {
    const source = mkBody("mb_src", "Baytown Council", rules.thirdTuesday);
    const { bodies, ids } = E.importMeetingBodies([], [source, source, source]);
    expect(bodies).toHaveLength(1);
    expect(new Set(ids).size).toBe(1);
  });

  it("importMeetingBodies imports several distinct bodies at once", () => {
    const a = mkBody("mb_a", "Council", rules.thirdTuesday);
    const b = mkBody("mb_b", "P&Z", rules.secondFourthThursday);
    const c = mkBody("mb_c", "Elections Admin", rules.mayAndElectionDay);
    const { bodies, ids } = E.importMeetingBodies([], [a, b, c]);
    expect(bodies).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("agendaLead / blackoutDates differences alone do not stop a dedupe (name + recurrence only)", () => {
    const a = mkBody("mb_a", "Council", rules.thirdTuesday, { agendaLead: { type: "offset", n: 5, unit: "calendar" } });
    const b = mkBody("mb_b", "Council", rules.thirdTuesday, { agendaLead: { type: "offset", n: 20, unit: "business" }, blackoutDates: ["2026-12-25"] });
    const r = E.importMeetingBody([a], b, 0);
    expect(r.created).toBe(false);
    expect(r.id).toBe("mb_a");
  });
});

describe("otherScheduleMeetingBodies — the account-wide source list for the import pickers", () => {
  const data = {
    projects: {
      1: { id: 1, name: "Sched A", meetingBodies: [mkBody("mb_a", "Council", rules.thirdTuesday)] },
      2: { id: 2, name: "Sched B", meetingBodies: [] },
      3: { id: 3, name: "Sched C", linkedSiteName: "Bain Tract", meetingBodies: [mkBody("mb_c", "P&Z", rules.secondFourthThursday)] },
    },
  };
  it("excludes the current schedule and any schedule with zero bodies", () => {
    const groups = E.otherScheduleMeetingBodies(data, 2);
    const pids = groups.map(g => g.pid).sort();
    expect(pids).toEqual([1, 3]);
  });
  it("excludes itself even when it has bodies", () => {
    const groups = E.otherScheduleMeetingBodies(data, 1);
    expect(groups.map(g => g.pid)).toEqual([3]);
  });
  it("B1873361 — schedName is the full qualified crossScheduleLabel, never a bare (possibly ambiguous) name; there is no separate projName field any more (folded into schedName)", () => {
    const groups = E.otherScheduleMeetingBodies(data, 1);
    // Fixture 3 sets only linkedSiteName, not linkedSiteId, so ownerOf resolves it to the
    // Organization (invariant 1's own precedence — a real linkedSiteId is what makes a schedule
    // site-owned), matching crossScheduleLabel's ordinary behavior on this exact shape.
    expect(groups[0]).toEqual({ pid: 3, schedName: "Organization / Sched C", bodies: data.projects[3].meetingBodies });
    expect(groups[0]).not.toHaveProperty("projName");
  });
  it("a schedule with no other schedules on the account returns an empty list, not an error", () => {
    const solo = { projects: { 9: { id: 9, name: "Only one", meetingBodies: [] } } };
    expect(E.otherScheduleMeetingBodies(solo, 9)).toEqual([]);
  });
});

describe("anti-drift: the B1824576 meeting-import engine exists VERBATIM in src + mirror", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  const mjs = readFileSync(fileURLToPath(new URL("../ui-audit/stress/scheduler-engine.mjs", import.meta.url)), "utf8");
  it("mbBodiesSameCadence compares name + recurrence signature only, in both", () => {
    expect(src).toMatch(/mbBodiesSameCadence = \(a, b\) => !!a && !!b && \(a\.name \|\| ""\)\.trim\(\) === \(b\.name \|\| ""\)\.trim\(\) && mbRecurrenceSignature\(a\.recurrence\) === mbRecurrenceSignature\(b\.recurrence\);/);
    expect(mjs).toMatch(/mbBodiesSameCadence = \(a, b\) => !!a && !!b && \(a\.name \|\| ""\)\.trim\(\) === \(b\.name \|\| ""\)\.trim\(\) && mbRecurrenceSignature\(a\.recurrence\) === mbRecurrenceSignature\(b\.recurrence\);/);
  });
  it("copyMeetingBodyWithNewId mints a globally-unique mb_ id, in both", () => {
    expect(src).toMatch(/const nid = "mb_" \+ Date\.now\(\)\.toString\(36\) \+ salt \+ Math\.random\(\)\.toString\(36\)\.slice\(2, 6\);/);
    expect(mjs).toMatch(/const nid = "mb_" \+ Date\.now\(\)\.toString\(36\) \+ salt \+ Math\.random\(\)\.toString\(36\)\.slice\(2, 6\);/);
  });
  it("importMeetingBody reuses an existing identical-cadence copy instead of minting a second one, in both", () => {
    expect(src).toMatch(/const existing = list\.find\(b => mbBodiesSameCadence\(b, sourceBody\)\);/);
    expect(mjs).toMatch(/const existing = list\.find\(b => mbBodiesSameCadence\(b, sourceBody\)\);/);
    expect(src).toMatch(/if \(existing\) return \{ bodies: list, id: existing\.id, created: false \};/);
    expect(mjs).toMatch(/if \(existing\) return \{ bodies: list, id: existing\.id, created: false \};/);
  });
  it("importMeetingBodies dedupes sequentially within the same batch, in both", () => {
    expect(src).toMatch(/const r = importMeetingBody\(bodies, sb, i\);/);
    expect(mjs).toMatch(/const r = importMeetingBody\(bodies, sb, i\);/);
  });
  it("otherScheduleMeetingBodies excludes the current schedule and any schedule with no bodies, in both", () => {
    expect(src).toMatch(/\.filter\(p => p && p\.id !== excludePid && Array\.isArray\(p\.meetingBodies\) && p\.meetingBodies\.length\)/);
    expect(mjs).toMatch(/\.filter\(p => p && p\.id !== excludePid && Array\.isArray\(p\.meetingBodies\) && p\.meetingBodies\.length\)/);
  });
});

describe("anti-drift: buildDuplicateProject reuses copyMeetingBodyWithNewId (no second re-id implementation)", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
  it("the per-body mapper calls the shared helper instead of re-ided inline", () => {
    expect(src).toMatch(/const copy = copyMeetingBodyWithNewId\(mb, i\);/);
    expect(src).toMatch(/if \(mb && mb\.id\) bodyIdMap\[mb\.id\] = copy\.id;/);
  });
});
