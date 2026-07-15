/* NEW-F4 — the pending-edit journal's persistence layer (elementJournal.js): quota-safe
 * localStorage read/write/clear with a 7-day age cap and a size cap. Storage is injected so
 * the tests run clock- and DOM-free (Date.now is banned in the pure layer).
 *
 * NEW-1 (two-tab false-conflict fix) — the journal is keyed PER SESSION (tab), so two live
 * writers on one site never fold or clear each other's crash protection: a fresh sibling
 * journal is untouchable; a journal orphaned past ORPHAN_ADOPT_MS (dead tab) is adopted;
 * the legacy un-suffixed per-site key migrates through the same orphan path. */
import { describe, it, expect } from "vitest";
import {
  writeJournal, readJournal, clearJournal, sweepJournals, journalSessionId, ORPHAN_ADOPT_MS,
} from "../src/workspaces/site-planner/lib/elementJournal.js";

const memStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    get size() { return m.size; },
    has: (k) => m.has(k),
  };
};

const entry = (id, over = {}) => ({ kind: "el", id, cls: "update", el: { id, w: 1 }, baseRev: 2, ...over });
const SID = "tab-a";

describe("elementJournal — write / read / clear round-trip (own session)", () => {
  it("round-trips entries per site + session", () => {
    const s = memStorage();
    expect(writeJournal("siteA", SID, [entry("e1")], 1000, s)).toBe(true);
    expect(readJournal("siteA", SID, 2000, s)).toEqual([entry("e1")]);
    expect(readJournal("siteB", SID, 2000, s)).toEqual([]); // keyed per site
    clearJournal("siteA", SID, s);
    expect(readJournal("siteA", SID, 2000, s)).toEqual([]);
  });

  it("writing an EMPTY entry list clears the key (idle engine leaves nothing behind)", () => {
    const s = memStorage();
    writeJournal("siteA", SID, [entry("e1")], 1000, s);
    writeJournal("siteA", SID, [], 2000, s);
    expect(s.size).toBe(0);
  });

  it("age cap: a journal older than 7 days reads empty AND is removed (stale intent, not a fix)", () => {
    const s = memStorage();
    writeJournal("siteA", SID, [entry("e1")], 0, s);
    const eightDays = 8 * 24 * 3600 * 1000;
    expect(readJournal("siteA", SID, eightDays, s)).toEqual([]);
    expect(s.size).toBe(0);
  });

  it("size cap: an absurdly large journal is refused (mirror + version ring still hold the data)", () => {
    const s = memStorage();
    const huge = Array.from({ length: 2000 }, (_, i) => entry("e" + i, { el: { id: "e" + i, blob: "x".repeat(600) } }));
    expect(writeJournal("siteA", SID, huge, 1000, s)).toBe(false);
    expect(s.size).toBe(0);
  });

  it("malformed stored JSON reads as empty, never throws", () => {
    const s = memStorage();
    s.setItem(`planyr:elements:pending:siteA:s:${SID}`, "{not json");
    expect(readJournal("siteA", SID, 1000, s)).toEqual([]);
    s.setItem(`planyr:elements:pending:siteA:s:${SID}`, JSON.stringify({ at: 0, entries: "nope" }));
    expect(readJournal("siteA", SID, 1000, s)).toEqual([]);
  });

  it("filters malformed entries on read (missing id/kind)", () => {
    const s = memStorage();
    writeJournal("siteA", SID, [entry("e1"), { cls: "update" }, null], 1000, s);
    expect(readJournal("siteA", SID, 1000, s).map((e) => e.id)).toEqual(["e1"]);
  });

  it("a refused (oversize) or throwing write DROPS any previous journal — stale is worse than none", () => {
    const s = memStorage();
    writeJournal("siteA", SID, [entry("e1")], 1000, s);
    const huge = Array.from({ length: 2000 }, (_, i) => entry("e" + i, { el: { id: "e" + i, blob: "x".repeat(600) } }));
    expect(writeJournal("siteA", SID, huge, 2000, s)).toBe(false);
    expect(s.size).toBe(0); // the old journal is gone, not left to fold stale geometry later
    writeJournal("siteB", SID, [entry("e1")], 1000, s);
    const quota = { ...s, getItem: s.getItem, setItem: () => { throw new Error("quota"); }, removeItem: s.removeItem };
    expect(writeJournal("siteB", SID, [entry("e2")], 2000, quota)).toBe(false);
    expect(readJournal("siteB", SID, 2000, s)).toEqual([]); // cleared via the catch path too
  });

  it("a throwing storage degrades silently (quota / privacy mode)", () => {
    const boom = { getItem: () => { throw new Error("nope"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("nope"); }, key: () => { throw new Error("nope"); }, length: 0 };
    expect(writeJournal("siteA", SID, [entry("e1")], 1000, boom)).toBe(false);
    expect(readJournal("siteA", SID, 1000, boom)).toEqual([]);
    expect(() => clearJournal("siteA", SID, boom)).not.toThrow();
    expect(() => sweepJournals("siteA", SID, 1000, boom)).not.toThrow();
  });

  it("no siteId / no sessionId / no storage → safe no-ops", () => {
    expect(writeJournal(null, SID, [entry("e1")], 1000, memStorage())).toBe(false);
    expect(writeJournal("siteA", null, [entry("e1")], 1000, memStorage())).toBe(false);
    expect(readJournal(null, SID, 1000, memStorage())).toEqual([]);
    expect(writeJournal("siteA", SID, [entry("e1")], 1000, null)).toBe(false);
    expect(readJournal("siteA", SID, 1000, null)).toEqual([]);
  });
});

describe("elementJournal — per-session isolation (NEW-1, the two-tab clobber)", () => {
  it("a LIVE sibling tab's journal is neither read nor swept — its crash protection survives", () => {
    const s = memStorage();
    writeJournal("siteA", "tab-b", [entry("theirs")], 10_000, s); // sibling wrote moments ago
    // tab A reads for its refetch fold "now" = 10s later — well inside the orphan threshold
    expect(readJournal("siteA", SID, 20_000, s)).toEqual([]);
    sweepJournals("siteA", SID, 20_000, s);
    expect(readJournal("siteA", "tab-b", 20_000, s)).toEqual([entry("theirs")]); // untouched
  });

  it("clearJournal drops ONLY the calling session's key", () => {
    const s = memStorage();
    writeJournal("siteA", SID, [entry("mine")], 1000, s);
    writeJournal("siteA", "tab-b", [entry("theirs")], 1000, s);
    clearJournal("siteA", SID, s);
    expect(readJournal("siteA", SID, 2000, s)).toEqual([]);
    expect(readJournal("siteA", "tab-b", 2000, s)).toEqual([entry("theirs")]);
  });

  it("an ORPHANED session's journal (frozen `at` past ORPHAN_ADOPT_MS) is adopted, then swept", () => {
    const s = memStorage();
    writeJournal("siteA", "tab-dead", [entry("orphaned")], 1000, s);
    const later = 1000 + ORPHAN_ADOPT_MS + 1;
    expect(readJournal("siteA", SID, later, s)).toEqual([entry("orphaned")]);
    sweepJournals("siteA", SID, later, s);
    expect(s.size).toBe(0); // consumed — never re-folded (and re-discarded loudly) on later refetches
  });

  it("the LEGACY un-suffixed per-site key migrates through the orphan path (fresh = hands off, stale = adopt)", () => {
    const s = memStorage();
    s.setItem("planyr:elements:pending:siteA", JSON.stringify({ at: 1000, entries: [entry("legacy")] }));
    expect(readJournal("siteA", SID, 2000, s)).toEqual([]); // fresh: could be a live old-code tab mid-commit
    // a sweep while the legacy journal is still FRESH must NOT delete it — readJournal refused to
    // fold it, and sweeping what wasn't folded silently destroys that tab's crash protection
    // (adversarial-review finding: read/sweep must consume the SAME key set).
    sweepJournals("siteA", SID, 2000, s);
    expect(s.has("planyr:elements:pending:siteA")).toBe(true);
    const later = 1000 + ORPHAN_ADOPT_MS + 1;
    expect(readJournal("siteA", SID, later, s)).toEqual([entry("legacy")]);
    sweepJournals("siteA", SID, later, s);
    expect(s.has("planyr:elements:pending:siteA")).toBe(false);
  });

  it("dedupe on read: the OWN session's entry beats an orphan's for the same (kind:id)", () => {
    const s = memStorage();
    writeJournal("siteA", "tab-dead", [entry("e1", { el: { id: "e1", w: 99 } })], 0, s);
    writeJournal("siteA", SID, [entry("e1", { el: { id: "e1", w: 7 } })], ORPHAN_ADOPT_MS + 500, s);
    const got = readJournal("siteA", SID, ORPHAN_ADOPT_MS + 1000, s);
    expect(got).toHaveLength(1);
    expect(got[0].el.w).toBe(7);
  });

  it("same-tab reload recovery still works: the session id is stable, so the own journal folds at any age", () => {
    const s = memStorage();
    writeJournal("siteA", SID, [entry("pre-reload")], 1000, s);
    // "reload": a fresh read moments later under the SAME session id — no orphan wait
    expect(readJournal("siteA", SID, 1500, s)).toEqual([entry("pre-reload")]);
  });

  it("journalSessionId: sessionStorage-backed and stable; distinct stores get distinct ids; a blocked store degrades", () => {
    const a = memStorage(), b = memStorage();
    const ida = journalSessionId(a);
    expect(journalSessionId(a)).toBe(ida);          // stable across a reload (same tab store)
    expect(journalSessionId(b)).not.toBe(ida);      // a second tab gets its own id
    const boom = { getItem: () => { throw new Error("nope"); }, setItem: () => { throw new Error("nope"); } };
    const idc = journalSessionId(boom);
    expect(typeof idc).toBe("string");
    expect(idc.length).toBeGreaterThan(5);
    expect(journalSessionId(boom)).toBe(idc);       // per-load memo keeps it stable within the tab
  });
});
