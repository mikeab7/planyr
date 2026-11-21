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


/* IN-FLIGHT HOUSEKEEPING PUSH vs A REAL EDIT (owner audit finding #3, 2026-11-21).
 * The load-time litter sweep writes a page `auto:true` and pushes it. If the user types while that
 * push is in flight, the page is real-edit dirty (`auto:false`) — but pushOnce captured
 * `wasAuto` BEFORE the await and used that stale value afterwards, so a refusal adopted the
 * server's row over the typed text in silence, and a success that left the page still dirty
 * re-stamped it `auto:true`. */
const emptyBox = { type: "noteAnchor", attrs: { x: 10, y: 10, width: 200 }, content: [{ type: "paragraph" }] };
const litterDoc = (...lines) => ({ type: "doc", content: [...doc(...lines).content, emptyBox] });

describe("a real edit made while a housekeeping push is in flight is never overwritten", () => {
  it("refused push: the typed text survives (kept local or raised as a conflict, never silently replaced)", async () => {
    const server = fakeServer();
    server.pages.set("p1", { doc: doc("original"), rev: 1, deleted_at: null, purged_at: null });
    server.tree = { v: 3, pages: [{ id: "p1", title: "T", createdAt: 1, updatedAt: 1, pages: [], projectId: null, orgScope: true }], trash: [] };
    server.treeRev = 1;
    let release; const gate = new Promise((r) => { release = r; });
    let held = false;
    const A = await openWindow(server, { gate: async (p, f) => {
      if ((p.id ?? f.id) !== "p1" || held) return;
      held = true;
      // another window moves the row while this device's push is on the wire
      server.pages.get("p1").doc = doc("server changed it entirely");
      server.pages.get("p1").rev = 5;
      await gate;
    } });
    focus(A);
    A.store.setNotesScope(UID);
    await A.store.startNotesSync({});            // seed adopts the clean body
    // the page has no recorded merge base (cache evicted / IndexedDB unavailable) so no per-paragraph merge can run
    await (await import("../src/workspaces/notes/lib/notesImageDb.js")).idbDeleteMergeBases([`${UID}:p1`]);
    const key = [...A.mem.keys()].find((k) => k.includes("p1") && !k.includes("tree"));
    A.mem.set(key, JSON.stringify(litterDoc("original")));   // an old empty box is lying in the local copy
    expect(A.store.sweepEmptyAnchors(["p1"]).pages).toBe(1);   // load-time cleanup: auto write, push armed
    await waitUntil(() => held, { timeoutMs: 5000 });          // ...and its push is now on the wire
    A.store.writePage("p1", doc("TYPED WHILE SAVING"));        // a real edit lands mid-flight
    release();
    await waitUntil(() => !A.store.notesConflicts().length && JSON.stringify(A.store.readPage("p1")).length > 0);
    await new Promise((r) => setTimeout(r, 300));
    await A.store.refreshNotesSync();
    const kept = JSON.stringify(A.store.readPage("p1")).includes("TYPED WHILE SAVING");
    const raised = A.store.notesConflicts().includes("p1");
    expect({ kept, raised, kind: kept || raised }).toMatchObject({ kind: true });
  }, 20000);
});
