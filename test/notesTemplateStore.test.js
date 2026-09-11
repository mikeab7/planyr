/* NEW-1 — the storage half of the per-account template library: readNoteTemplates seeds a
 * scope exactly once (never again, even once every template has been deleted), scopes by
 * account like every other key this module owns, and reports a real failure the same way
 * the tree and page bodies already do (LOUD-FAILURE) rather than reading as "no templates".
 *
 * Harness mirrors test/notesPageCreationBody.test.js's `openWindow` (a fresh in-memory
 * localStorage + a fresh module instance per "window"), trimmed to what this suite needs —
 * templates have no cloud tier yet, so no fake Supabase client is required. */
import { describe, expect, it, vi } from "vitest";

async function openWindow({ breakWrites = false } = {}) {
  const mem = new Map();
  const localStorage = {
    get length() { return mem.size; },
    key: (i) => [...mem.keys()][i] ?? null,
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => {
      if (breakWrites && k.includes(":templates:")) throw new DOMException("quota exceeded", "QuotaExceededError");
      mem.set(k, String(v));
    },
    removeItem: (k) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
  globalThis.window = { localStorage, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { visibilityState: "visible" };
  vi.resetModules();
  const store = await import("../src/workspaces/notes/lib/notesStore.js");
  return { store, localStorage };
}

describe("readNoteTemplates / writeNoteTemplates", () => {
  it("seeds the two built-in templates the first time a scope is ever read", async () => {
    const w = await openWindow();
    w.store.setNotesScope("u_seed");
    const list = w.store.readNoteTemplates();
    expect(list.map((t) => t.id).sort()).toEqual(["asset-info", "contacts"]);
  });

  it("persists the seed to disk — a second read returns the SAME records, not a fresh seed", async () => {
    const w = await openWindow();
    w.store.setNotesScope("u_persist");
    const first = w.store.readNoteTemplates();
    const second = w.store.readNoteTemplates();
    expect(second).toEqual(first);
  });

  it("a write round-trips exactly, and a scope emptied by hand is NEVER re-seeded", async () => {
    const w = await openWindow();
    w.store.setNotesScope("u_empty");
    w.store.readNoteTemplates(); // triggers the one-time seed
    const ok = w.store.writeNoteTemplates([]); // the account deletes every template
    expect(ok).toBe(true);
    expect(w.store.readNoteTemplates()).toEqual([]); // stays empty — not re-seeded
  });

  it("a real edit round-trips through storage", async () => {
    const w = await openWindow();
    w.store.setNotesScope("u_roundtrip");
    const seeded = w.store.readNoteTemplates();
    const edited = seeded.map((t) => (t.id === "contacts" ? { ...t, label: "Renamed" } : t));
    w.store.writeNoteTemplates(edited);
    expect(w.store.readNoteTemplates().find((t) => t.id === "contacts").label).toBe("Renamed");
  });

  it("two accounts on one machine never see each other's templates", async () => {
    const w = await openWindow();
    w.store.setNotesScope("u_alice");
    const alice = w.store.readNoteTemplates().map((t) => (t.id === "contacts" ? { ...t, label: "Alice's" } : t));
    w.store.writeNoteTemplates(alice);

    w.store.setNotesScope("u_bob");
    const bob = w.store.readNoteTemplates();
    expect(bob.find((t) => t.id === "contacts").label).toBe("Project Contacts"); // Bob's own fresh seed, untouched

    w.store.setNotesScope("u_alice");
    expect(w.store.readNoteTemplates().find((t) => t.id === "contacts").label).toBe("Alice's");
  });

  it("a corrupt blob reports LOUD-FAILURE and reads as empty, never as a silent re-seed", async () => {
    const w = await openWindow();
    w.store.setNotesScope("u_corrupt");
    w.localStorage.setItem("planyr:notes:templates:v1:u_corrupt", "{not json");
    let seen = null;
    const off = w.store.onNotesStorageError((e) => { seen = e; });
    expect(w.store.readNoteTemplates()).toEqual([]);
    expect(seen).toBeTruthy();
    off();
  });

  it("a write that cannot land is reported and returns false", async () => {
    const w = await openWindow({ breakWrites: true });
    w.store.setNotesScope("u_break");
    let seen = null;
    const off = w.store.onNotesStorageError((e) => { seen = e; });
    expect(w.store.writeNoteTemplates([{ id: "x", label: "X", doc: { type: "doc", content: [] } }])).toBe(false);
    expect(seen).toBeTruthy();
    off();
  });
});
