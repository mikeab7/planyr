/* B2078593 — a note opens at FULL PAGE WIDTH on every device, every time. Michael's phone opened
 * "Hard Cost Pricing" at 55% with the right side off screen while his desktop framed it differently:
 * each was obeying a view left in its OWN localStorage by an earlier pinch/pan. The view is no
 * longer persisted: it lives in memory for the life of the tab (so switching pages and back inside a
 * session returns to where you were), nothing reaches storage, and a view an older build stored is
 * deleted the first time one is looked for, so it can never win on open again. */
import { beforeEach, describe, expect, it } from "vitest";

const mem = new Map();
globalThis.window = globalThis.window || {};
globalThis.window.localStorage = {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
};

const store = await import("../src/workspaces/notes/lib/notesStore.js");
const OLD = "planyr:notes:view:v1:local:p1";

describe("the note view is a session memory, not a stored preference", () => {
  beforeEach(() => { mem.clear(); store.setNotesScope("local"); });

  it("a view written in this session is read back (leave a page and return)", () => {
    expect(store.writeNoteView("p1", { x: 40, y: 80, z: 0.55 })).toBe(true);
    expect(store.readNoteView("p1")).toEqual({ x: 40, y: 80, z: 0.55 });
    expect(store.readNoteView("p2")).toBeNull();
  });

  it("nothing is ever written to storage", () => {
    store.writeNoteView("p9", { x: 1, y: 2, z: 1 });
    expect([...mem.keys()].some((k) => k.includes("notes:view:v1"))).toBe(false);
  });

  it("a view an older build stored is deleted on first look and never returned", () => {
    mem.set(OLD, JSON.stringify({ x: 123, y: 77, z: 0.55 }));
    mem.set("planyr:notes:view:v1:u_other:p2", JSON.stringify({ x: 1, y: 1, z: 2 }));
    mem.set("planyr:notes:tree:v1:local", "{}");
    // purge runs once per load; reset the guard by re-importing a fresh module instance
    return import("../src/workspaces/notes/lib/notesStore.js?fresh").then((fresh) => {
      expect(fresh.readNoteView("p1")).toBeNull();
      expect(mem.has(OLD)).toBe(false);
      expect(mem.has("planyr:notes:view:v1:u_other:p2")).toBe(false);
      expect(mem.has("planyr:notes:tree:v1:local")).toBe(true);   // only view keys go
    });
  });
});
