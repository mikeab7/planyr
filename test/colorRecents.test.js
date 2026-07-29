/* NEW-4 — recently-used colors: one shared most-recently-used list, seeded from the app's default
 * palette so the row is never blank, persisted across sessions. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  RECENTS_MAX, normalizeHex, mergeRecent, uniqueHexes,
  loadRecents, saveRecents, getRecents, pushRecent, subscribeRecents, _resetRecentsCache,
  notePick, commitPick, pendingPickValue,
} from "../src/shared/ui/colorRecents.js";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

beforeEach(() => { store.clear(); _resetRecentsCache(); });

describe("normalizeHex", () => {
  it("accepts #rrggbb and lowercases it", () => expect(normalizeHex("#AABBCC")).toBe("#aabbcc"));
  it("expands #rgb shorthand", () => expect(normalizeHex("#f0a")).toBe("#ff00aa"));
  it("rejects anything an <input type=color> can't round-trip", () => {
    ["red", "rgb(1,2,3)", "", null, undefined, 12, "#12345"].forEach((v) => expect(normalizeHex(v)).toBe(null));
  });
});

describe("mergeRecent — most-recently-used order", () => {
  it("puts the newest color first", () => {
    expect(mergeRecent(["#111111"], "#222222")).toEqual(["#222222", "#111111"]);
  });
  it("re-using a color MOVES it up instead of duplicating it (the distinct-colors rule)", () => {
    expect(mergeRecent(["#111111", "#222222", "#333333"], "#333333"))
      .toEqual(["#333333", "#111111", "#222222"]);
  });
  it("caps the list", () => {
    let list = [];
    for (let i = 0; i < 30; i++) list = mergeRecent(list, `#0000${String(i % 100).padStart(2, "0")}`);
    expect(list.length).toBe(RECENTS_MAX);
  });
  it("an unparseable color is ignored, not stored", () => {
    expect(mergeRecent(["#111111"], "chartreuse")).toEqual(["#111111"]);
  });
  it("normalizes existing entries so #ABC and #aabbcc never both sit in the row", () => {
    expect(mergeRecent(["#ABC"], "#aabbcc")).toEqual(["#aabbcc"]);
  });
});

describe("uniqueHexes — what a swatch grid renders", () => {
  it("normalizes and de-duplicates", () => {
    expect(uniqueHexes(["#ABC", "#aabbcc", "#111111"])).toEqual(["#aabbcc", "#111111"]);
  });
  it("drops anything an <input type=color> can't round-trip", () => {
    expect(uniqueHexes(["#111111", "chartreuse", null, "#222222"])).toEqual(["#111111", "#222222"]);
  });
  it("respects the cap", () => {
    expect(uniqueHexes(["#111111", "#222222", "#333333"], 2)).toEqual(["#111111", "#222222"]);
  });
  it("is NOT padded — an empty recents list stays empty, so the section can hide itself", () => {
    // The row used to be padded out of the default palette so it was never blank. That made the
    // list lie about what had actually been used; the palette is now its own grid above it.
    expect(uniqueHexes([])).toEqual([]);
  });
});

describe("persistence", () => {
  it("round-trips through storage so a color survives a reload", () => {
    saveRecents(["#123456", "#abcdef"]);
    expect(loadRecents()).toEqual(["#123456", "#abcdef"]);
  });
  it("a corrupt entry reads as empty — never a crash on boot", () => {
    store.set("planyr:colorRecents:v1", "{not json");
    expect(loadRecents()).toEqual([]);
  });
  it("a storage write failure never breaks the color change itself", () => {
    const spy = vi.spyOn(globalThis.localStorage, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
    expect(() => pushRecent("#123456")).not.toThrow();
    expect(getRecents()[0]).toBe("#123456"); // still applied in-session
    spy.mockRestore();
  });
});

describe("pushRecent — the live shared list", () => {
  it("records a color and notifies every open picker", () => {
    const seen = [];
    const off = subscribeRecents((l) => seen.push(l));
    pushRecent("#ff0000");
    pushRecent("#00ff00");
    off();
    pushRecent("#0000ff");
    expect(seen.length).toBe(2);                    // no notification after unsubscribe
    expect(getRecents()).toEqual(["#0000ff", "#00ff00", "#ff0000"]);
  });
  it("is a no-op for an unparseable value (no phantom row entry)", () => {
    pushRecent("#123456");
    const before = getRecents();
    expect(pushRecent("not-a-color")).toBe(before);
  });
  it("the list is SHARED — a color recorded from one control is available to the next", () => {
    pushRecent("#c2410c");   // e.g. picked on a parcel outline
    expect(getRecents()).toContain("#c2410c"); // …now one click away on a markup
  });
});

/* ---------------------------------------------------------------- the picking SESSION (the bug)
 *
 * "When I just scrolled my mouse over some colours, it filled up the entire colour swatch. That's
 * not really the intent, it's to actually use stuff that I used."
 *
 * The wheel picks LIVE by design, so the browser fires a change event for every shade the cursor
 * passes through. Recording each one filled all ten slots from a single drag with near-identical
 * intermediates. A session must contribute EXACTLY ONE entry — the colour it settled on.
 */
describe("a live picking session records exactly ONE colour, at commit", () => {
  it("N live events + one commit grows the list by exactly one, equal to the FINAL value", () => {
    pushRecent("#000000");                                  // something already in the list
    const before = getRecents();

    // Drag through the spectrum: every intermediate is applied live to the object (the caller's
    // job) and noted here, but none is recorded.
    ["#ff0000", "#ff3300", "#ff6600", "#ff9900", "#ffcc00", "#ffff00"].forEach(notePick);
    expect(getRecents()).toEqual(before);                   // nothing recorded MID-drag

    commitPick();                                           // the wheel blurs / the picker closes
    const after = getRecents();
    expect(after.length).toBe(before.length + 1);           // exactly ONE new entry…
    expect(after[0]).toBe("#ffff00");                       // …and it is the colour settled on
    expect(after.slice(1)).toEqual(before);                 // no intermediate shade got in
  });

  it("the OLD behaviour — one push per live event — is what filled the row (regression witness)", () => {
    const shades = ["#ff0000", "#ff3300", "#ff6600", "#ff9900", "#ffcc00", "#ffff00"];
    shades.forEach(pushRecent);                             // what the code used to do per event
    expect(getRecents().length).toBe(shades.length);        // one drag, six slots gone
  });

  it("committing twice does not double-record: the session is consumed", () => {
    notePick("#123456");
    commitPick();
    const after = getRecents();
    commitPick();
    expect(getRecents()).toEqual(after);
    expect(pendingPickValue()).toBe(null);
  });

  it("a session that picked nothing records nothing", () => {
    pushRecent("#111111");
    const before = getRecents();
    commitPick();
    expect(getRecents()).toEqual(before);
  });

  it("re-settling on a colour already in the list moves it up, it never doubles", () => {
    pushRecent("#111111");
    pushRecent("#222222");
    notePick("#111111");
    commitPick();
    expect(getRecents()).toEqual(["#111111", "#222222"]);
  });

  it("an unparseable live value is ignored — the session keeps the last real colour", () => {
    notePick("#abcdef");
    notePick("rgb(1,2,3)");
    commitPick();
    expect(getRecents()[0]).toBe("#abcdef");
  });
});

/* The wiring, guarded at the source: the live handlers must NOT record straight into the list, or
 * the session boundary above is bypassed and the bug returns. (Only the discrete swatch-click path
 * may call pushRecent — one click, one entry.) */
describe("SitePlanner wires the wheel through the session, not straight to the list", () => {
  it("livePick notes live values and commits on blur; it never pushes per event", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("const livePick ="), src.indexOf("const colorCtl ="));
    expect(body).toContain("notePick(e.target.value)");
    expect(body).toContain("commitPick()");
    expect(body).not.toContain("pushRecent(");            // the flooding call, gone from the wheel
  });
});
