/* PUSH-SELF-RACE (NEW-1, B1865408) — ONE WINDOW, TWO OF THIS MODULE'S OWN TRIGGERS RACING
 * TO PUSH THE SAME BRAND-NEW PAGE.
 *
 * Reported directly: create a new note, type a few bullet points, and the whole-document
 * "also changed in another of your windows" banner fires — one user, one window, a note
 * created moments ago. Notes has no realtime channel to echo (unlike the Site Planner's
 * `elementSync.js` — see `notesCloud.js`'s own header, "no per-keystroke wire at all"), so the
 * dispatch's own "suppress the realtime echo" framing does not apply here; `judgeConflict`'s
 * semantic-equality suppression (B1391) is unchanged and still runs on every settle (see
 * test/notesTwoClientConflict.test.js for that half, proven unaffected by this fix).
 *
 * The actual mechanism, confirmed by reading `notesStore.js`: `pushPending` is reached from TWO
 * triggers that shared no lock before this fix — `schedulePush`'s own debounce timer, called
 * directly, and `seed`'s own tail call, reached the instant `busy` is cleared (BEFORE that call
 * resolves, not after). `busy` only ever serialised `seed()` against itself; the debounce timer
 * never went through `refreshNotesSync` at all. So a page created and typed into while this
 * module's own sync pass for that same page is still a real network round trip in flight can
 * have both triggers land while the other is mid-push — for a page's first-ever push that is a
 * duplicate-key race on the INSERT, not merely a refused UPDATE.
 *
 * ⛔ ONE SEQUENCING FACT THIS TEST DEPENDS ON, FOUND WHILE BUILDING IT — WORTH RECORDING SO THE
 * NEXT SESSION DOES NOT RE-DISCOVER IT THE SLOW WAY: `schedulePush` is a no-op until
 * `syncOn()` is true, and `syncOn()` needs `cloudClient` — which is only set partway through
 * `startNotesSync`. So writing a page BEFORE `startNotesSync` is called arms NO debounce timer
 * at all (a first draft of this test wrote the page first and never saw a second trigger fire —
 * it was asserting a truth vacuously). The fixtures below call `startNotesSync` on an EMPTY
 * tree first (fast, nothing to push) so `cloudClient` is established, THEN create the page —
 * matching the real report anyway: the workspace is already mounted and syncing by the time a
 * person creates a page and starts typing.
 *
 * Drives the real store (not a reimplementation) through a manually-gated fake Supabase client,
 * so the interleaving is deterministic rather than a matter of luck — the same shape
 * notesTwoClientConflict.test.js already uses for the cross-window cases, adapted with one
 * addition: a hook that can hold a `notes_pages` write open long enough to prove a second,
 * concurrent trigger never also reaches the network for the same page. Real timers throughout
 * (fake-indexeddb's own async simulation crosses real macrotask ticks that fake timers do not
 * reliably drive) — the cost is a real ~1.2s debounce wait per test, accepted for a
 * deterministic reproduction. */
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

describe("a brand-new page never raises a false conflict from the store racing its own two push triggers (NEW-1)", () => {
  it("schedulePush's debounce firing while a concurrent sync pass is mid-push for the SAME new page never reaches the network twice", async () => {
    const server = fakeServer();

    // The gate: the FIRST notes_pages write for "new1" hangs until release() is called — a
    // stand-in for a real network round trip taking longer than the code's own two triggers
    // take to both arm themselves.
    let release;
    const gate = new Promise((res) => { release = res; });
    let gated = false;
    const gateCalls = [];
    const beforeWrite = async (payload, filters) => {
      const id = payload.id ?? filters.id;
      gateCalls.push({ id, op: payload.id ? "insert" : "update" });
      if (id === "new1" && !gated) { gated = true; await gate; }
    };

    const A = await openWindow(server, { gate: beforeWrite });
    focus(A);
    A.store.setNotesScope(UID);

    // Establish sync on an EMPTY tree first — fast, nothing to push — so `cloudClient` is set
    // and `schedulePush`'s debounce is live by the time the page below is created. This is the
    // realistic shape too: the workspace is already open and syncing before a person creates a
    // page and starts typing.
    await A.store.startNotesSync({});

    // "Create a new note… type a few bullet points" — the page, and its content, never seen by
    // the server before. This arms a real 1.2s debounce timer.
    A.store.writeTree({
      v: 3,
      pages: [{ id: "new1", title: "Untitled", createdAt: 1, updatedAt: 1, pages: [], projectId: null, orgScope: true }],
      trash: [],
    });
    A.store.writePage("new1", doc("First bullet", "Second bullet"));

    // Trigger 1 — a second, independent sync pass over the SAME new page (mirrors what the
    // workspace's own initial full seed would have been doing, had this page existed a moment
    // earlier). It reaches the gated write within a handful of real macrotask ticks.
    const p1 = A.store.refreshNotesSync();
    await waitUntil(() => gated);

    // Trigger 2 — schedulePush's real debounce timer (armed above) fires somewhere in this
    // window, WHILE trigger 1 still holds the push lock. Pre-fix, this called the unlocked
    // push function directly and reached the network too; post-fix it must find the push
    // already running and defer.
    await new Promise((r) => setTimeout(r, 1400));

    // The proof that trigger 2 did NOT also reach the network: only ONE call ever arrived at
    // the gate for "new1" before it was released.
    expect(gateCalls.filter((c) => c.id === "new1").length).toBe(1);

    release();
    await p1;
    // Drain any follow-up the mutex owed once the lock cleared.
    await A.store.refreshNotesSync();

    // ⛔ THE ASSERTION: no false conflict banner, on a brand-new page, in one window — and
    // exactly one row ever landed on the server (the structural proof a duplicate-key race
    // never happened, which is what the old, unlocked code could not promise).
    expect(A.store.notesConflicts()).toEqual([]);
    expect(server.pages.size).toBe(1);
    expect(server.pages.get("new1").doc).toEqual(doc("First bullet", "Second bullet"));
    expect(server.pages.get("new1").rev).toBe(1);
    expect(gateCalls.filter((c) => c.id === "new1").length).toBe(1);   // never a second attempt
  }, 15000);

  /* A second, independent reproduction of the same race with a real typing pause DURING the
   * in-flight push — closer to "type a few bullet points" than one single write, and it proves
   * the mutex's queued-work guarantee: content typed while the lock was held still reaches the
   * cloud once the lock drains, it is never silently dropped alongside the suppressed race. */
  it("a second edit made while trigger 1 is mid-push still lands, with no conflict, once the lock drains", async () => {
    const server = fakeServer();
    let release;
    const gate = new Promise((res) => { release = res; });
    let gated = false;
    const gateCalls = [];
    const beforeWrite = async (payload, filters) => {
      const id = payload.id ?? filters.id;
      gateCalls.push({ id });
      if (id === "new1" && !gated) { gated = true; await gate; }
    };

    const A = await openWindow(server, { gate: beforeWrite });
    focus(A);
    A.store.setNotesScope(UID);
    await A.store.startNotesSync({});

    A.store.writeTree({
      v: 3,
      pages: [{ id: "new1", title: "Untitled", createdAt: 1, updatedAt: 1, pages: [], projectId: null, orgScope: true }],
      trash: [],
    });
    A.store.writePage("new1", doc("First bullet"));

    const p1 = A.store.refreshNotesSync();
    await waitUntil(() => gated);

    // A little more typing lands WHILE trigger 1's own push of "First bullet" is still stuck
    // at the gate.
    A.store.writePage("new1", doc("First bullet", "Second bullet"));
    await new Promise((r) => setTimeout(r, 1400));   // trigger 2 fires, finds the lock held, defers

    expect(gateCalls.filter((c) => c.id === "new1").length).toBe(1);   // still only one in flight

    release();
    await p1;
    // Drain: the deferred trigger's own follow-up, which now finds the page dirty again with
    // the fuller content (per the fresh-read fix alongside this one — a push's success handler
    // no longer clears `dirty` off a stale captured snapshot) and pushes it for real.
    await A.store.refreshNotesSync();

    expect(A.store.notesConflicts()).toEqual([]);
    expect(server.pages.size).toBe(1);
    expect(server.pages.get("new1").doc).toEqual(doc("First bullet", "Second bullet"));
  }, 15000);
});
