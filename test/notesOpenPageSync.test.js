/* OPEN-PAGE-SYNC (NEW-7) — AN ADOPTED SYNC MUST NEVER REPLACE, REMOUNT OR OVERWRITE AN OPEN PAGE
 * THAT STILL HOLDS UN-FLUSHED KEYSTROKES.
 *
 * Reported from an adversarial iPhone review: Safari returns to the foreground, sync runs on
 * `visibilitychange`, and the page it adopts is the one being typed in. The editor holds a
 * keystroke in `pendingRef` for SAVE_DEBOUNCE_MS before it writes, so inside that window the
 * page is NOT yet `dirty` and the store's only guard (`sync.pages[id].dirty`) cannot see the
 * edit. Old behaviour, reproduced below with a fake open editor: the adopt wrote the server
 * copy, announced it, the workspace REMOUNTED the editor (keyboard closes, caret lost), the old
 * instance's unmount flush wrote its stale pending document OVER the adopted copy, and the next
 * push committed it cleanly past a revision this device legitimately held — the other side's
 * paragraph gone with no conflict and no banner.
 *
 * The fake editor below speaks the same contract `NoteEditor` registers through
 * `registerOpenNoteDoc` ({ applyDocument, hasPending, flush }), and the fake "workspace"
 * listener behaves like Notes.jsx's remount: it flushes the pending document on the way out.
 * Real timers throughout — see docs/NOTES-CARRY-FORWARD.md §1 entry 45. */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

const UID = "u1";
const doc = (...lines) => ({
  type: "doc",
  content: lines.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })),
});

function fakeServer() {
  return { tree: null, treeRev: 0, pages: new Map(), images: new Map() };
}

/** Same shape as notesTwoClientConflict.test.js's own `clientFor`, with one addition: an
 *  optional async `gate(payload, filters)` hook, invoked immediately before a `notes_pages`
 *  insert/update actually lands — so a test can hold ONE write open on purpose. */
function clientFor(server, { gate } = {}) {
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
    const exec = async () => {
      if (op === "select") return { data: runSelect(table, filters), error: null };
      if (table === "notes_pages" && gate && (op === "insert" || op === "update")) await gate(payload, filters);
      const r = runWrite(table, op, payload, filters);
      return { data: r.error ? null : r.rows, error: r.error };
    };
    const self = {
      eq(col, val) { filters[col] = val; return self; },
      in(col, vals) { filters[col] = vals; return self; },
      select() { return self; },
      maybeSingle() { return exec().then(({ data, error }) => ({ data: error ? null : (data?.[0] ?? null), error })); },
      then(res, rej) { return exec().then(({ data, error }) => ({ data, error })).then(res, rej); },
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
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        download: async () => ({ data: null, error: { message: "not stored" } }),
        remove: async () => ({ error: null }),
      }),
    },
  };
}

async function openWindow(server, opts) {
  const mem = new Map();
  const localStorage = {
    get length() { return mem.size; },
    key: (i) => [...mem.keys()][i] ?? null,
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
  const indexedDB = new IDBFactory();
  globalThis.indexedDB = indexedDB;
  globalThis.window = {
    localStorage,
    addEventListener() {}, removeEventListener() {},
    setInterval: () => 0, clearInterval() {}, setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a),
  };
  globalThis.document = { visibilityState: "visible" };

  vi.resetModules();
  vi.doMock("../src/workspaces/site-planner/lib/supabase.js", () => ({ supabase: clientFor(server, opts) }));
  const store = await import("../src/workspaces/notes/lib/notesStore.js");
  return { store, mem, localStorage, indexedDB };
}

const focus = (w) => { globalThis.window.localStorage = w.localStorage; globalThis.indexedDB = w.indexedDB; };

/** Wait (real time) until `cond()` is true, polling on a short real interval — the async chain
 *  from a sync call to the gated write crosses fake-indexeddb's own internal macrotask hops,
 *  which a pure microtask flush does not reach. */
async function waitUntil(cond, { timeoutMs = 2000, stepMs = 5 } = {}) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

afterEach(() => {
  vi.doUnmock("../src/workspaces/site-planner/lib/supabase.js");
});


const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const mk = (...t) => ({ type: "doc", content: t.map(para) });
const texts = (d) => (d?.content || []).map((b) => (b.content || []).map((x) => x.text).join(""));

/** A fake mounted editor: `live` is what the screen shows, `pending` is the un-flushed queue. */
function fakeEditor(store, pageId, live) {
  const ed = { live, pending: true, applied: 0, flushed: 0 };
  ed.type = (doc) => { ed.live = doc; ed.pending = true; };
  ed.flush = () => {
    if (!ed.pending) return;
    ed.pending = false; ed.flushed += 1;
    store.writePage(pageId, ed.live);
  };
  ed.unregister = store.registerOpenNoteDoc(pageId, {
    applyDocument: (doc) => { ed.live = doc; ed.applied += 1; return { ok: true }; },
    hasPending: () => ed.pending,
    flush: ed.flush,
  });
  return ed;
}

describe("an open page with un-flushed edits survives a foreground sync (NEW-7)", () => {
  it("type, then within the debounce window a newer server copy arrives: both sides' edits survive, the editor is never remounted", async () => {
    const server = fakeServer();
    const A = await openWindow(server);
    focus(A);
    A.store.setNotesScope(UID);
    await A.store.startNotesSync({});
    A.store.writeTree({
      v: 3,
      pages: [{ id: "p1", title: "T", createdAt: 1, updatedAt: 1, pages: [], projectId: null, orgScope: true }],
      trash: [],
    });
    const base = mk("alpha", "bravo", "charlie");
    A.store.writePage("p1", base);
    await A.store.refreshNotesSync();                       // pushed: server rev 1, merge base recorded
    await waitUntil(() => server.pages.get("p1")?.rev === 1);

    // The OTHER device edits paragraph 1 and pushes (server rev 2).
    server.pages.get("p1").doc = mk("alpha FROM SERVER", "bravo", "charlie");
    server.pages.get("p1").rev = 2;

    // This device: the editor is open, a keystroke has landed in paragraph 3 and has NOT been
    // flushed (inside the 600ms window) — so the store's `dirty` flag is still false.
    const ed = fakeEditor(A.store, "p1", base);
    ed.type(mk("alpha", "bravo", "charlie TYPED"));

    // The "workspace": a page announcement remounts the editor, and a remount's unmount flush
    // writes whatever the old instance still holds.
    let remounts = 0;
    A.store.onNotesPagesChanged((ids) => { if (ids.includes("p1")) { remounts += 1; ed.flush(); } });

    await A.store.refreshNotesSync();                       // visibilitychange → sync
    await A.store.refreshNotesSync();                       // the follow-up poll
    ed.flush();                                             // the debounce finally fires
    await A.store.refreshNotesSync();
    await A.store.refreshNotesSync();

    const onServer = texts(server.pages.get("p1").doc);
    expect(onServer).toEqual(["alpha FROM SERVER", "bravo", "charlie TYPED"]);   // both survive
    expect(texts(ed.live)).toEqual(["alpha FROM SERVER", "bravo", "charlie TYPED"]);
    expect(remounts).toBe(0);                               // the instance survived
    expect(A.store.notesConflicts()).toEqual([]);
  }, 20000);

  it("a plain adopt (no local edit at all) still reaches the open editor, in place", async () => {
    const server = fakeServer();
    const A = await openWindow(server);
    focus(A);
    A.store.setNotesScope(UID);
    await A.store.startNotesSync({});
    A.store.writeTree({
      v: 3,
      pages: [{ id: "p1", title: "T", createdAt: 1, updatedAt: 1, pages: [], projectId: null, orgScope: true }],
      trash: [],
    });
    A.store.writePage("p1", mk("one"));
    await A.store.refreshNotesSync();
    server.pages.get("p1").doc = mk("one", "two");
    server.pages.get("p1").rev = 2;
    const ed = fakeEditor(A.store, "p1", mk("one"));
    ed.pending = false;
    let remounts = 0;
    A.store.onNotesPagesChanged(() => { remounts += 1; });
    await A.store.refreshNotesSync();
    expect(texts(ed.live)).toEqual(["one", "two"]);
    expect(ed.applied).toBe(1);
    expect(remounts).toBe(0);
  }, 20000);
});
