/* A DEFERRED CONFLICT SURVIVES A RELOAD — DRIVEN THROUGH THE ACTUAL STORE (B849106).
 *
 * The owner's report: "there's no option to back out of this, so I'm forced to make a decision
 * even though I may not want to yet." `ConflictReview.jsx`'s close control (né a bare "✕", now
 * "✕ Decide later") has always been non-destructive by construction — closing it only flips a
 * local `open` boolean in `ConflictNotice.jsx`, never touches `resolveNotesConflict` — but that
 * is a claim about ONE component's local state, not proof that the conflict itself survives
 * something as real as the tab actually being reloaded. This is that proof, at the store level:
 * a genuine reload (fresh JS module state — `vi.resetModules()` — over the SAME persisted
 * localStorage, which is exactly what a real browser reload does) with the conflict never
 * resolved, and both copies still there, unmerged, afterward.
 *
 * Reuses the `fakeServer`/`clientFor`/`openWindow` shape from test/notesTwoClientConflict.test.js
 * (not exported — see that file for why the shape looks the way it does), plus a `reopenWindow`
 * that shares the SAME localStorage backing `Map` instead of a fresh one, which is the one thing
 * that differs.
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";

const UID = "u1";
const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

function fakeServer() {
  return { tree: null, treeRev: 0, pages: new Map(), images: new Map() };
}

function clientFor(server) {
  const runSelect = (table, filters) => {
    if (table === "notes_trees") return server.tree == null ? [] : [{ data: server.tree, rev: server.treeRev }];
    if (table === "notes_images") return [...server.images.values()];
    let rows = [...server.pages.entries()].map(([id, r]) => ({ id, ...r }));
    if (filters.id !== undefined) {
      const want = Array.isArray(filters.id) ? new Set(filters.id) : new Set([filters.id]);
      rows = rows.filter((r) => want.has(r.id));
    }
    return rows;
  };

  const runWrite = (table, op, payload, filters) => {
    if (table === "notes_trees") {
      if (op === "insert") {
        if (server.tree != null) return { rows: [], error: { code: "23505", message: "duplicate key" } };
        server.tree = payload.data; server.treeRev = 1;
        return { rows: [{ rev: 1 }], error: null };
      }
      if (filters.rev !== undefined && filters.rev !== server.treeRev) return { rows: [], error: null };
      server.tree = payload.data; server.treeRev += 1;
      return { rows: [{ rev: server.treeRev }], error: null };
    }
    if (op === "insert") {
      if (server.pages.has(payload.id)) return { rows: [], error: { code: "23505", message: "duplicate key" } };
      server.pages.set(payload.id, { doc: payload.doc, rev: 1, deleted_at: null, purged_at: null });
      return { rows: [{ id: payload.id, rev: 1 }], error: null };
    }
    const want = filters.id === undefined ? [...server.pages.keys()]
      : (Array.isArray(filters.id) ? filters.id : [filters.id]);
    const out = [];
    for (const id of want) {
      const row = server.pages.get(id);
      if (!row) continue;
      if (filters.rev !== undefined && filters.rev !== row.rev) continue;
      Object.assign(row, payload);
      row.rev += 1;
      out.push({ id, rev: row.rev });
    }
    return { rows: out, error: null };
  };

  const builder = (table, op, payload) => {
    const filters = {};
    const exec = () => {
      if (op === "select") return { data: runSelect(table, filters), error: null };
      const r = runWrite(table, op, payload, filters);
      return { data: r.error ? null : r.rows, error: r.error };
    };
    const self = {
      eq(col, val) { filters[col] = val; return self; },
      in(col, vals) { filters[col] = vals; return self; },
      select() { return self; },
      maybeSingle() { const { data, error } = exec(); return Promise.resolve({ data: error ? null : (data?.[0] ?? null), error }); },
      then(res, rej) { const { data, error } = exec(); return Promise.resolve({ data, error }).then(res, rej); },
    };
    return self;
  };

  return {
    from(table) {
      return {
        select: () => builder(table, "select"),
        insert: (p) => builder(table, "insert", p),
        update: (p) => builder(table, "update", p),
        upsert: (p) => builder(table, "upsert", p),
      };
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), download: async () => ({ data: null, error: { message: "not stored" } }), remove: async () => ({ error: null }) }) },
  };
}

/** A client window over a GIVEN localStorage backing `Map` — pass a fresh one for a new
 *  browser tab, or an EXISTING one (still holding what a previous window instance wrote) to
 *  simulate that SAME tab reloading: JS module state resets (`vi.resetModules()`), storage
 *  does not. That distinction is the entire point of this file. */
async function windowOver(server, mem) {
  const localStorage = {
    get length() { return mem.size; },
    key: (i) => [...mem.keys()][i] ?? null,
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
  globalThis.window = {
    localStorage,
    addEventListener() {}, removeEventListener() {},
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  };
  globalThis.document = { visibilityState: "visible" };

  vi.resetModules();
  vi.doMock("../src/workspaces/site-planner/lib/supabase.js", () => ({ supabase: clientFor(server) }));
  const store = await import("../src/workspaces/notes/lib/notesStore.js");
  return { store, mem, localStorage };
}
const openWindow = (server) => windowOver(server, new Map());
const reopenWindow = (server, w) => windowOver(server, w.mem);   // same storage, fresh module — a reload
const focus = (w) => { globalThis.window.localStorage = w.localStorage; };

const seedTree = (pageId) => ({ v: 3, pages: [{ id: pageId, title: "Utility", createdAt: 1, updatedAt: 1, pages: [], projectId: null }], trash: [] });

afterEach(() => { vi.doUnmock("../src/workspaces/site-planner/lib/supabase.js"); });

describe("a conflict the user closed without choosing survives a reload (B849106)", () => {
  it("reappears, on its own, with BOTH copies exactly as they were — never silently resolved by leaving", async () => {
    const PAGE = "utility_page";
    const server = fakeServer();

    // --- A publishes the note ---
    const A = await openWindow(server);
    focus(A);
    A.store.setNotesScope(UID);
    A.store.writeTree(seedTree(PAGE));
    A.store.writePage(PAGE, doc("has a table"));
    await A.store.startNotesSync({});

    // --- B adopts it, then diverges (an unpushed local edit) ---
    const B = await openWindow(server);
    focus(B);
    B.store.setNotesScope(UID);
    await B.store.startNotesSync({});
    B.store.writePage(PAGE, doc("B's own unpushed edit"));

    // --- A pushes a DIFFERENT edit first, so B's push will be refused ---
    focus(A);
    A.store.writePage(PAGE, doc("A's edit, landed first"));
    await A.store.refreshNotesSync();

    // --- B syncs: the push is refused, and the workspace would show ConflictNotice/ConflictReview now ---
    focus(B);
    await B.store.refreshNotesSync();
    expect(B.store.notesConflicts()).toEqual([PAGE]);
    const before = B.store.notesConflictFor(PAGE);
    expect(before.serverDoc).toEqual(doc("A's edit, landed first"));
    expect(B.store.readPage(PAGE)).toEqual(doc("B's own unpushed edit"));

    // --- THE OWNER'S CASE: he closes the review ("✕ Decide later") without picking a version.
    // Nothing in that action calls resolveNotesConflict — this is simply NOT calling it, which
    // is the whole mechanism (ConflictNotice.jsx's close only flips its own `open` state). ---

    // --- B's tab is reloaded: fresh module state, SAME localStorage ---
    const B2 = await reopenWindow(server, B);
    focus(B2);
    // A real app calls setNotesScope() + startNotesSync() on mount; this is that sequence,
    // on the reloaded tab (a fresh module instance starts scopeless, same as a fresh page load).
    B2.store.setNotesScope(UID);
    await B2.store.startNotesSync({});

    // The conflict is detected again, ON ITS OWN — nobody had to re-cause it.
    expect(B2.store.notesConflicts()).toEqual([PAGE]);
    const after = B2.store.notesConflictFor(PAGE);
    // Same server copy...
    expect(after.serverDoc).toEqual(doc("A's edit, landed first"));
    // ...and B's own unresolved edit is still sitting right where it was — never quietly
    // dropped, never quietly overwritten by the server's row just because the tab reloaded.
    expect(B2.store.readPage(PAGE)).toEqual(doc("B's own unpushed edit"));

    // And a genuine resolve still works from here, exactly as if the reload never happened —
    // deferring cost nothing.
    const res = await B2.store.resolveNotesConflict(PAGE, "theirs");
    expect(res.ok).toBe(true);
    expect(B2.store.notesConflicts()).toEqual([]);
    expect(B2.store.readPage(PAGE)).toEqual(doc("A's edit, landed first"));
  });
});
