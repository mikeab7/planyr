/* NEW-1 — Owner is an ORDERED LIST of contact names now; the FIRST is the accountable one,
 * implicitly (no separate "primary" control to maintain — reordering the chips IS how you correct
 * it). This file guards the pure engine that decision rests on: ownerListOf (the one coercion every
 * reader goes through — legacy string, real array, or garbage, all land on the same clean shape),
 * normalizeOwnerLists (the one-time load migration), and the array-aware health-rule matching
 * (isBlank/isNotBlank/is/contains all read the WHOLE list, not just the first entry).
 *
 * The pure functions live in public/sequence/index.html (compiled in-browser by Babel — not
 * importable); ui-audit/stress/scheduler-engine.mjs is a FAITHFUL mirror, guarded against drift by
 * test/schedulerEngine.test.js's own anti-drift assertions. This file exercises the mirror directly.
 */
import { describe, it, expect } from "vitest";
import * as E from "../ui-audit/stress/scheduler-engine.mjs";

const T = (rp) => ({ id: 1, responsibleParty: rp });

describe("ownerListOf — the one coercion every reader goes through", () => {
  it("a legacy single string becomes a one-element list", () => {
    expect(E.ownerListOf(T("Juan Macias"))).toEqual(["Juan Macias"]);
  });
  it("an empty string, null, undefined, and a missing field all become an empty list", () => {
    expect(E.ownerListOf(T(""))).toEqual([]);
    expect(E.ownerListOf(T(null))).toEqual([]);
    expect(E.ownerListOf(T(undefined))).toEqual([]);
    expect(E.ownerListOf({ id: 1 })).toEqual([]);
    expect(E.ownerListOf(null)).toEqual([]);
  });
  it("whitespace-only entries are dropped, real entries are trimmed", () => {
    expect(E.ownerListOf(T(["  Juan Macias  ", "   ", ""]))).toEqual(["Juan Macias"]);
  });
  it("a real array passes through, order preserved (first stays first — the accountable one)", () => {
    expect(E.ownerListOf(T(["Juan Macias", "Matt LeBlanc", "Priya Shah"]))).toEqual(["Juan Macias", "Matt LeBlanc", "Priya Shah"]);
  });
  it("a duplicate name (any casing) collapses to one entry, first occurrence wins — a count must never overstate how many people share a task", () => {
    expect(E.ownerListOf(T(["Juan Macias", "juan macias", "JUAN MACIAS"]))).toEqual(["Juan Macias"]);
  });
  it("a stray non-string entry (e.g. a bad import) is stringified, not thrown on", () => {
    expect(() => E.ownerListOf(T([42, null, "Bob"]))).not.toThrow();
    expect(E.ownerListOf(T([42, null, "Bob"]))).toEqual(["42", "Bob"]);
  });
});

describe("ownerJoin / ownerDisplayParts — display never uses a comma (that is a name character now)", () => {
  it("ownerJoin uses '; ', never ','", () => {
    expect(E.ownerJoin(["Juan Macias", "Matt LeBlanc"])).toBe("Juan Macias; Matt LeBlanc");
    expect(E.ownerJoin(["Juan Macias"])).toBe("Juan Macias");
    expect(E.ownerJoin([])).toBe("");
  });
  it("ownerDisplayParts: zero owners is blank", () => {
    expect(E.ownerDisplayParts([])).toEqual({ label: "", title: "" });
  });
  it("ownerDisplayParts: one owner shows plainly, no '+0'", () => {
    expect(E.ownerDisplayParts(["Juan Macias"])).toEqual({ label: "Juan Macias", title: "Juan Macias" });
  });
  it("ownerDisplayParts: several owners show FIRST + a count, full list on hover", () => {
    expect(E.ownerDisplayParts(["Juan Macias", "Matt LeBlanc", "Priya Shah"])).toEqual({
      label: "Juan Macias +2",
      title: "Juan Macias, Matt LeBlanc, Priya Shah",
    });
  });
});

describe("normalizeOwnerLists — the one-time load migration", () => {
  const doc = (tasks) => ({ projects: { 1: { id: 1, name: "P", tasks } } });
  it("a legacy string task becomes a one-element list; nothing else about the task changes", () => {
    const before = { id: 1, name: "t", responsibleParty: "Bryndan Nerren", start: "2026-01-01" };
    const out = E.normalizeOwnerLists(doc([before]));
    expect(out.projects[1].tasks[0].responsibleParty).toEqual(["Bryndan Nerren"]);
    expect(out.projects[1].tasks[0].start).toBe("2026-01-01");   // no existing task changes meaning
  });
  it("is naturally idempotent — running it twice is identical to running it once", () => {
    const once = E.normalizeOwnerLists(doc([{ id: 1, responsibleParty: "Bob" }]));
    const twice = E.normalizeOwnerLists(once);
    expect(twice.projects[1].tasks[0].responsibleParty).toEqual(["Bob"]);
    expect(twice).toEqual(once);
  });
  it("an already-migrated array is left alone (order preserved)", () => {
    const out = E.normalizeOwnerLists(doc([{ id: 1, responsibleParty: ["Matt LeBlanc", "Juan Macias"] }]));
    expect(out.projects[1].tasks[0].responsibleParty).toEqual(["Matt LeBlanc", "Juan Macias"]);
  });
  it("survives a garbage project / non-array tasks without throwing (defensive, like its siblings)", () => {
    expect(() => E.normalizeOwnerLists({ projects: { 1: null, 2: { tasks: "not-an-array" } } })).not.toThrow();
  });
});

describe("evalFieldCondition — Owner is a LIST; isBlank/isNotBlank/is/contains all read ANY entry", () => {
  const base = { id: 1, end: "", start: "", health: "gray", percentComplete: 0 };
  it("isBlank is true only when the WHOLE list is empty", () => {
    expect(E.evalFieldCondition({ field: "owner", op: "isBlank" }, { ...base, responsibleParty: [] }, "2026-08-15")).toBe(true);
    expect(E.evalFieldCondition({ field: "owner", op: "isBlank" }, { ...base, responsibleParty: ["Bob"] }, "2026-08-15")).toBe(false);
    expect(E.evalFieldCondition({ field: "owner", op: "isBlank" }, { ...base, responsibleParty: "" }, "2026-08-15")).toBe(true);   // legacy string, still coerced
  });
  it("isNotBlank is true once there is at least one owner, whichever position", () => {
    expect(E.evalFieldCondition({ field: "owner", op: "isNotBlank" }, { ...base, responsibleParty: ["", "Bob"] }, "2026-08-15")).toBe(true);
  });
  it("'is' matches ANY owner, not just the first — a task where the queried person is SECOND still matches", () => {
    const t = { ...base, responsibleParty: ["Juan Macias", "Matt LeBlanc"] };
    expect(E.evalFieldCondition({ field: "owner", op: "is", value: "Matt LeBlanc" }, t, "2026-08-15")).toBe(true);
    expect(E.evalFieldCondition({ field: "owner", op: "is", value: "matt leblanc" }, t, "2026-08-15")).toBe(true);   // case-insensitive
    expect(E.evalFieldCondition({ field: "owner", op: "is", value: "Priya Shah" }, t, "2026-08-15")).toBe(false);
  });
  it("'contains' matches a substring of ANY owner, not the joined display string", () => {
    const t = { ...base, responsibleParty: ["Juan Macias", "Matt LeBlanc"] };
    expect(E.evalFieldCondition({ field: "owner", op: "contains", value: "leblanc" }, t, "2026-08-15")).toBe(true);
    // Neither name individually contains "macias;" (the join delimiter would falsely bridge two
    // names if a rule ever matched against the JOINED string instead of each entry — it must not).
    expect(E.evalFieldCondition({ field: "owner", op: "contains", value: "macias; matt" }, t, "2026-08-15")).toBe(false);
  });
  it("a bare legacy string still behaves exactly as it always did (back-compat for every existing rule)", () => {
    expect(E.evalFieldCondition({ field: "owner", op: "is", value: "Bob" }, { ...base, responsibleParty: "Bob" }, "2026-08-15")).toBe(true);
    expect(E.evalFieldCondition({ field: "owner", op: "contains", value: "ob" }, { ...base, responsibleParty: "Bob" }, "2026-08-15")).toBe(true);
  });
});

describe("evalHealthCondition — legacy noOwner reads the whole list", () => {
  const base = { id: 1, name: "t", percentComplete: 0, predecessors: [] };
  it("true only when NO owner at all is present", () => {
    expect(E.evalHealthCondition("noOwner", null, { ...base, responsibleParty: [] }, "2026-08-15")).toBe(true);
    expect(E.evalHealthCondition("noOwner", null, { ...base, responsibleParty: ["", "  "] }, "2026-08-15")).toBe(true);
    expect(E.evalHealthCondition("noOwner", null, { ...base, responsibleParty: ["Bob"] }, "2026-08-15")).toBe(false);
    expect(E.evalHealthCondition("noOwner", null, { ...base, responsibleParty: ["", "Bob"] }, "2026-08-15")).toBe(false);
  });
});
