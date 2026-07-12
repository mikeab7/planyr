/* NEW-F4 — the pending-edit journal's persistence layer (elementJournal.js): quota-safe
 * localStorage read/write/clear with a 7-day age cap and a size cap. Storage is injected so
 * the tests run clock- and DOM-free (Date.now is banned in the pure layer). */
import { describe, it, expect } from "vitest";
import { writeJournal, readJournal, clearJournal } from "../src/workspaces/site-planner/lib/elementJournal.js";

const memStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    get size() { return m.size; },
  };
};

const entry = (id, over = {}) => ({ kind: "el", id, cls: "update", el: { id, w: 1 }, baseRev: 2, ...over });

describe("elementJournal — write / read / clear round-trip", () => {
  it("round-trips entries per site", () => {
    const s = memStorage();
    expect(writeJournal("siteA", [entry("e1")], 1000, s)).toBe(true);
    expect(readJournal("siteA", 2000, s)).toEqual([entry("e1")]);
    expect(readJournal("siteB", 2000, s)).toEqual([]); // keyed per site
    clearJournal("siteA", s);
    expect(readJournal("siteA", 2000, s)).toEqual([]);
  });

  it("writing an EMPTY entry list clears the key (idle engine leaves nothing behind)", () => {
    const s = memStorage();
    writeJournal("siteA", [entry("e1")], 1000, s);
    writeJournal("siteA", [], 2000, s);
    expect(s.size).toBe(0);
  });

  it("age cap: a journal older than 7 days reads empty AND is removed (stale intent, not a fix)", () => {
    const s = memStorage();
    writeJournal("siteA", [entry("e1")], 0, s);
    const eightDays = 8 * 24 * 3600 * 1000;
    expect(readJournal("siteA", eightDays, s)).toEqual([]);
    expect(s.size).toBe(0);
  });

  it("size cap: an absurdly large journal is refused (mirror + version ring still hold the data)", () => {
    const s = memStorage();
    const huge = Array.from({ length: 2000 }, (_, i) => entry("e" + i, { el: { id: "e" + i, blob: "x".repeat(600) } }));
    expect(writeJournal("siteA", huge, 1000, s)).toBe(false);
    expect(s.size).toBe(0);
  });

  it("malformed stored JSON reads as empty, never throws", () => {
    const s = memStorage();
    s.setItem("planyr:elements:pending:siteA", "{not json");
    expect(readJournal("siteA", 1000, s)).toEqual([]);
    s.setItem("planyr:elements:pending:siteA", JSON.stringify({ at: 0, entries: "nope" }));
    expect(readJournal("siteA", 1000, s)).toEqual([]);
  });

  it("filters malformed entries on read (missing id/kind)", () => {
    const s = memStorage();
    writeJournal("siteA", [entry("e1"), { cls: "update" }, null], 1000, s);
    expect(readJournal("siteA", 1000, s).map((e) => e.id)).toEqual(["e1"]);
  });

  it("a throwing storage degrades silently (quota / privacy mode)", () => {
    const boom = { getItem: () => { throw new Error("nope"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("nope"); } };
    expect(writeJournal("siteA", [entry("e1")], 1000, boom)).toBe(false);
    expect(readJournal("siteA", 1000, boom)).toEqual([]);
    expect(() => clearJournal("siteA", boom)).not.toThrow();
  });

  it("no siteId / no storage → safe no-ops", () => {
    expect(writeJournal(null, [entry("e1")], 1000, memStorage())).toBe(false);
    expect(readJournal(null, 1000, memStorage())).toEqual([]);
    expect(writeJournal("siteA", [entry("e1")], 1000, null)).toBe(false);
    expect(readJournal("siteA", 1000, null)).toEqual([]);
  });
});
