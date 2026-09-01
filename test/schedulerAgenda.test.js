import { describe, it, expect, beforeEach } from "vitest";
import {
  RECURRENCE_PRESETS, presetIdFor, recurrenceForPresetId, describeRecurrence,
  todayISO, nextOccurrence, bucketFor, createAgendaItem, toggleAgendaItem,
  updateAgendaItem, deleteAgendaItem, sortAgendaItems,
} from "../src/workspaces/scheduler/lib/agendaModel.js";
import { readAgenda, writeAgenda } from "../src/workspaces/scheduler/lib/agendaStore.js";

describe("agendaModel — recurrence math", () => {
  it("daily advances by N days, crossing a month boundary", () => {
    expect(nextOccurrence("2026-01-30", { freq: "daily", interval: 3 })).toBe("2026-02-02");
  });

  it("weekly (the plain case) advances 7 days", () => {
    expect(nextOccurrence("2026-03-03", { freq: "weekly", interval: 1 })).toBe("2026-03-10");
  });

  it("'every 2 weeks' on a Tuesday stays on a Tuesday — the owner's own example", () => {
    // 2026-03-03 is a Tuesday.
    const d = new Date("2026-03-03T00:00:00Z");
    expect(d.getUTCDay()).toBe(2); // sanity: Tuesday
    const next = nextOccurrence("2026-03-03", { freq: "weekly", interval: 2 });
    expect(next).toBe("2026-03-17");
    const nextDay = new Date(next + "T00:00:00Z").getUTCDay();
    expect(nextDay).toBe(2); // still a Tuesday
  });

  it("monthly clamps to the target month's real last day (Jan 31 -> Feb 28, non-leap year)", () => {
    expect(nextOccurrence("2026-01-31", { freq: "monthly", interval: 1 })).toBe("2026-02-28");
  });

  it("monthly rolls the year over past December", () => {
    expect(nextOccurrence("2026-12-15", { freq: "monthly", interval: 1 })).toBe("2027-01-15");
  });

  it("yearly clamps a Feb 29 anchor onto a non-leap target year", () => {
    expect(nextOccurrence("2028-02-29", { freq: "yearly", interval: 1 })).toBe("2029-02-28");
  });

  it("a one-off item (no recurrence) or a dateless item has no next occurrence", () => {
    expect(nextOccurrence("2026-05-01", null)).toBeNull();
    expect(nextOccurrence(null, { freq: "monthly", interval: 1 })).toBeNull();
  });
});

describe("agendaModel — recurrence presets", () => {
  it("round-trips every preset id through its recurrence value and back", () => {
    for (const p of RECURRENCE_PRESETS) {
      expect(presetIdFor(p.recurrence)).toBe(p.id);
      expect(recurrenceForPresetId(p.id)).toEqual(p.recurrence);
    }
  });

  it("describeRecurrence names the preset, and null reads as 'Does not repeat'", () => {
    expect(describeRecurrence(null)).toBe("Does not repeat");
    expect(describeRecurrence({ freq: "weekly", interval: 2 })).toBe("Every 2 weeks");
  });

  it("an unrecognized freq/interval combination is not silently claimed by a preset", () => {
    expect(presetIdFor({ freq: "monthly", interval: 3 })).toBe("none");
  });
});

describe("agendaModel — todayISO and bucketFor", () => {
  it("todayISO reads local calendar date parts, not UTC", () => {
    const at = new Date(2026, 5, 15, 23, 30).getTime(); // June 15 2026, 11:30pm LOCAL
    expect(todayISO(at)).toBe("2026-06-15");
  });

  it("buckets: before today = overdue, exactly today = today, after = upcoming, no date = someday", () => {
    const t = "2026-06-15";
    expect(bucketFor("2026-06-14", t)).toBe("overdue");
    expect(bucketFor("2026-06-15", t)).toBe("today");
    expect(bucketFor("2026-06-16", t)).toBe("upcoming");
    expect(bucketFor(null, t)).toBe("someday");
  });
});

describe("agendaModel — item lifecycle", () => {
  it("createAgendaItem trims text and defaults date/recurrence to null, done to false", () => {
    const it_ = createAgendaItem({ text: "  Submit expenses  " }, 1000);
    expect(it_.text).toBe("Submit expenses");
    expect(it_.date).toBeNull();
    expect(it_.recurrence).toBeNull();
    expect(it_.done).toBe(false);
    expect(it_.createdAt).toBe(1000);
  });

  it("two items created back to back never collide on id", () => {
    const a = createAgendaItem({ text: "A" }, 1000);
    const b = createAgendaItem({ text: "B" }, 1000);
    expect(a.id).not.toBe(b.id);
  });

  it("toggling a ONE-OFF item flips done and back, undoably", () => {
    const it_ = createAgendaItem({ text: "Meet the BD contact" }, 1000);
    const done = toggleAgendaItem(it_, 2000);
    expect(done.done).toBe(true);
    expect(done.date).toBeNull();
    const undone = toggleAgendaItem(done, 3000);
    expect(undone.done).toBe(false);
  });

  it("toggling a RECURRING item never marks it done — it rolls the date forward and stays open", () => {
    const it_ = createAgendaItem({ text: "Submit expenses", date: "2026-01-31", recurrence: { freq: "monthly", interval: 1 } }, 1000);
    const rolled = toggleAgendaItem(it_, 2000);
    expect(rolled.done).toBe(false);
    expect(rolled.date).toBe("2026-02-28");
    expect(rolled.lastCompletedAt).toBe(2000);
    // rolls again, from its NEW date
    const rolledAgain = toggleAgendaItem(rolled, 3000);
    expect(rolledAgain.date).toBe("2026-03-28");
  });

  it("updateAgendaItem patches one item by id and stamps updatedAt, leaving others untouched", () => {
    const a = createAgendaItem({ text: "A" }, 1000);
    const b = createAgendaItem({ text: "B" }, 1000);
    const next = updateAgendaItem([a, b], a.id, { text: "A2" }, 5000);
    expect(next.find((x) => x.id === a.id).text).toBe("A2");
    expect(next.find((x) => x.id === a.id).updatedAt).toBe(5000);
    expect(next.find((x) => x.id === b.id).text).toBe("B");
  });

  it("deleteAgendaItem removes exactly the named item", () => {
    const a = createAgendaItem({ text: "A" }, 1000);
    const b = createAgendaItem({ text: "B" }, 1000);
    expect(deleteAgendaItem([a, b], a.id)).toEqual([b]);
  });
});

describe("agendaModel — sortAgendaItems", () => {
  it("open items sort before done items regardless of date", () => {
    const a = { ...createAgendaItem({ text: "done", date: "2026-01-01" }, 1), done: true };
    const b = createAgendaItem({ text: "open", date: "2026-12-31" }, 2);
    expect(sortAgendaItems([a, b]).map((x) => x.text)).toEqual(["open", "done"]);
  });

  it("within the same done-state, dated items sort ascending and undated items sort last", () => {
    const a = createAgendaItem({ text: "later", date: "2026-06-01" }, 1);
    const b = createAgendaItem({ text: "sooner", date: "2026-01-01" }, 2);
    const c = createAgendaItem({ text: "no date" }, 3);
    expect(sortAgendaItems([a, b, c]).map((x) => x.text)).toEqual(["sooner", "later", "no date"]);
  });

  it("ties within the same date fall back to creation order", () => {
    const a = createAgendaItem({ text: "first", date: "2026-06-01" }, 100);
    const b = createAgendaItem({ text: "second", date: "2026-06-01" }, 200);
    expect(sortAgendaItems([b, a]).map((x) => x.text)).toEqual(["first", "second"]);
  });
});

/* No DOM environment in this suite (vitest.config.js runs "node" everywhere) — stub the same
 * minimal in-memory `window.localStorage` shape `test/notesTreeWriteThrough.test.js` uses for
 * notesStore.js's identical `store()` pattern. */
function stubWindow() {
  const mem = new Map();
  globalThis.window = {
    localStorage: {
      get length() { return mem.size; },
      key: (i) => [...mem.keys()][i] ?? null,
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => { mem.set(k, String(v)); },
      removeItem: (k) => { mem.delete(k); },
      clear: () => mem.clear(),
    },
  };
}

describe("agendaStore — local per-scope persistence", () => {
  beforeEach(() => { stubWindow(); });

  it("round-trips a list through write/read for one scope", () => {
    const items = [createAgendaItem({ text: "Call the lender" }, 1000)];
    expect(writeAgenda(items, "user-1")).toBe(true);
    expect(readAgenda("user-1")).toEqual(items);
  });

  it("reading an untouched scope returns an empty list, never throws", () => {
    expect(readAgenda("nobody-yet")).toEqual([]);
  });

  it("two scopes never see each other's items", () => {
    writeAgenda([createAgendaItem({ text: "A" }, 1)], "user-a");
    writeAgenda([createAgendaItem({ text: "B" }, 1)], "user-b");
    expect(readAgenda("user-a")).toHaveLength(1);
    expect(readAgenda("user-a")[0].text).toBe("A");
    expect(readAgenda("user-b")[0].text).toBe("B");
  });

  it("a corrupt stored record reads back as an empty list rather than throwing", () => {
    window.localStorage.setItem("planyr:agenda:v1:user-1", "{not json");
    expect(readAgenda("user-1")).toEqual([]);
  });

  it("reads/writes fail loudly-but-safely (return false / []) when no window exists at all", () => {
    const saved = globalThis.window;
    delete globalThis.window;
    try {
      expect(readAgenda("user-1")).toEqual([]);
      expect(writeAgenda([], "user-1")).toBe(false);
    } finally { globalThis.window = saved; }
  });
});
