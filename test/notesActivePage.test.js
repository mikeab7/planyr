/* NEW-1 — a reload used to always land on the tree's FIRST page, because nothing recorded
 * which page the user actually had open (`Notes.jsx`'s mount effect called
 * `setActivePageId(firstPageId(loaded))` unconditionally). `readActivePageId`/
 * `writeActivePageId` (lib/notesStore.js) are the one-blob-per-scope pair that fixes it —
 * same shape as `readIgnoredDuplicates`/`ignoreDuplicate`, exercised here through the real
 * seam against a real (in-memory) localStorage, never a mock of the module under test.
 */
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

describe("which page was open (readActivePageId/writeActivePageId)", () => {
  beforeEach(() => {
    mem.clear();
    store.setNotesScope("u_activepage");
  });

  it("reads null before anything has ever been written — the honest 'no default page yet'", () => {
    expect(store.readActivePageId()).toBeNull();
  });

  it("round-trips the id that was written", () => {
    expect(store.writeActivePageId("p1")).toBe(true);
    expect(store.readActivePageId()).toBe("p1");
    expect(store.writeActivePageId("p2")).toBe(true);
    expect(store.readActivePageId()).toBe("p2");
  });

  it("writing a falsy id clears the stored one rather than storing the literal string", () => {
    store.writeActivePageId("p1");
    expect(store.writeActivePageId(null)).toBe(true);
    expect(store.readActivePageId()).toBeNull();
  });

  it("two accounts on one machine never see each other's open page", () => {
    store.setNotesScope("userA");
    store.writeActivePageId("a-page");
    store.setNotesScope("userB");
    expect(store.readActivePageId()).toBeNull();
    store.writeActivePageId("b-page");
    store.setNotesScope("userA");
    expect(store.readActivePageId()).toBe("a-page");
    store.setNotesScope("userB");
    expect(store.readActivePageId()).toBe("b-page");
  });

  it("a caller can name an explicit scope instead of relying on the module's current one", () => {
    store.writeActivePageId("home-page", "local");
    expect(store.readActivePageId("local")).toBe("home-page");
    expect(store.readActivePageId()).toBeNull();   // current scope ("u_activepage") is untouched
  });
});
