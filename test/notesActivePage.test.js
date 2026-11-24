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

  it("remembers a page per project, and projects never read each other's", () => {
    store.writeActivePageId("a1", undefined, "projA");
    store.writeActivePageId("b1", undefined, "projB");
    expect(store.readActivePageId(undefined, "projA")).toBe("a1");
    expect(store.readActivePageId(undefined, "projB")).toBe("b1");
    expect(store.readActivePageId(undefined, "projC")).toBeNull();
    store.writeActivePageId("a2", undefined, "projA");
    expect(store.readActivePageId(undefined, "projA")).toBe("a2");
    expect(store.readActivePageId(undefined, "projB")).toBe("b1");
  });

  it("clearing one project's page leaves the others", () => {
    store.writeActivePageId("a1", undefined, "projA");
    store.writeActivePageId("b1", undefined, "projB");
    store.writeActivePageId(null, undefined, "projA");
    expect(store.readActivePageId(undefined, "projA")).toBeNull();
    expect(store.readActivePageId(undefined, "projB")).toBe("b1");
  });

  it("a bare id written before per-project memory still reads, for any project (the caller proves visibility)", () => {
    store.writeActivePageId("seed");
    const k = [...mem.keys()][0];
    mem.set(k, "legacy");   // the pre-change shape: a bare id string
    expect(store.readActivePageId()).toBe("legacy");
    expect(store.readActivePageId(undefined, "projA")).toBe("legacy");
  });

  it("per-project memory is account-scoped", () => {
    store.setNotesScope("userA");
    store.writeActivePageId("a-page", undefined, "projA");
    store.setNotesScope("userB");
    expect(store.readActivePageId(undefined, "projA")).toBeNull();
  });

  it("activeProjectKey names project, org and all routes distinctly", () => {
    expect(store.activeProjectKey("p9", false)).toBe("p9");
    expect(store.activeProjectKey(null, true)).toBe("org");
    expect(store.activeProjectKey(null, false)).toBe("all");
  });
});
