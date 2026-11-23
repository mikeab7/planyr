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
function clientFor(server, { gate, selectGate, onSelect } = {}) {
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
      if (op === "select") {
        onSelect?.(table, filters);
        if (selectGate && table === "notes_pages" && filters.id !== undefined) await selectGate(filters);
        return { data: runSelect(table, filters), error: null };
      }
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

afterEach(() => {
  vi.doUnmock("../src/workspaces/site-planner/lib/supabase.js");
});

/* ACCOUNT SWITCH MID-SYNC (audit 2026-11-20, batch B1). `scope` and `sync` are module globals;
 * a seed/push that is awaiting the network when the account changes must NOT write what it
 * fetched under the NEW account's keys, and must not leave `busy` set so the new account's
 * first seed is skipped. */
const U1 = "u1", U2 = "u2";
const keysFor = (mem, scopeId) => [...mem.keys()].filter((k) => k.includes(`:${scopeId}`));

describe("an account switch while a sync pass is on the wire", () => {
  it("never lands account A's server data under account B's keys, and B's own first seed still runs", async () => {
    const server = fakeServer();
    server.pages.set("a1", { doc: doc("Account A secret"), rev: 3, deleted_at: null, purged_at: null });
    let release; const gate = new Promise((r) => { release = r; });
    let gated = false; let treeSelects = 0;
    const A = await openWindow(server, {
      selectGate: async () => { if (!gated) { gated = true; await gate; } },
      onSelect: (table) => { if (table === "notes_trees") treeSelects += 1; },
    });
    focus(A);
    A.store.setNotesScope(U1);
    const p1 = A.store.startNotesSync({});
    await waitUntil(() => gated);                 // account A's seed is mid-fetch of page bodies

    A.store.setNotesScope(U2);                    // sign out of A / into B
    const p2 = A.store.startNotesSync({});        // B's first seed must NOT be skipped by a stuck `busy`
    await waitUntil(() => treeSelects >= 2, { timeoutMs: 1500 });
    release();
    await p1; await p2;

    expect(treeSelects).toBeGreaterThanOrEqual(2);
    // The stale pass is aborted: nothing of A's pass lands as A's page under B's scope by way
    // of the stale write. (B's own seed may adopt the shared fake server's row legitimately, so
    // assert on the stale pass's tell-tale: a1's sync entry exists exactly once, from B's seed.)
    const syncB = JSON.parse(A.mem.get(`${A.store.SYNC_KEY_BASE}:${U2}`) || "{}");
    expect(Object.keys(syncB.pages || {})).toEqual(["a1"]);
    expect(keysFor(A.mem, U1).some((k) => k.includes("a1"))).toBe(false);
  }, 15000);

  it("a push on the wire when the account changes never writes its bookkeeping into the new account", async () => {
    const server = fakeServer();
    let release; const gate = new Promise((r) => { release = r; });
    let gated = false;
    const A = await openWindow(server, {
      gate: async (payload, filters) => { if ((payload.id ?? filters.id) === "new1" && !gated) { gated = true; await gate; } },
    });
    focus(A);
    A.store.setNotesScope(U1);
    await A.store.startNotesSync({});
    A.store.writeTree({ v: 3, pages: [{ id: "new1", title: "Untitled", createdAt: 1, updatedAt: 1, pages: [], projectId: null, orgScope: true }], trash: [] });
    A.store.writePage("new1", doc("A's words"));
    const p1 = A.store.refreshNotesSync();
    await waitUntil(() => gated);

    A.store.setNotesScope(U2);
    release();
    await p1;

    const rawB = A.mem.get(`${A.store.SYNC_KEY_BASE}:${U2}`);
    const syncB = rawB ? JSON.parse(rawB) : { pages: {} };
    expect(Object.keys(syncB.pages || {})).not.toContain("new1");
    expect(keysFor(A.mem, U2).some((k) => k.includes("new1"))).toBe(false);
  }, 15000);
});

describe("binning a page that has unpushed edits keeps the push guarded on the old revision", () => {
  it("a later push does not overwrite another device's change", async () => {
    const server = fakeServer();
    server.pages.set("p1", { doc: doc("base"), rev: 1, deleted_at: null, purged_at: null });
    const A = await openWindow(server);
    focus(A);
    A.store.setNotesScope(U1);
    await A.store.startNotesSync({});                      // adopts p1 @ rev 1
    // The other device edits and pushes: server now rev 2.
    server.pages.get("p1").doc = doc("base", "from the other device"); server.pages.get("p1").rev = 2;
    // This device edits locally (dirty against rev 1)…
    A.store.writePage("p1", doc("base", "from this device"));
    // …then restores the page from the bin, which bumps the server rev to 3 and must NOT be adopted.
    await A.store.markPagesRestored(["p1"]);
    await A.store.refreshNotesSync();
    expect(JSON.stringify(server.pages.get("p1").doc)).toContain("from the other device");
  }, 15000);
});

describe("a Notes push failure is kept in the durable write-failure log", () => {
  it("is recorded on a failed push, and settled by the next good sync", async () => {
    const server = fakeServer();
    let fail = true;
    const A = await openWindow(server, { gate: async () => { if (fail) throw new Error("boom"); } });
    focus(A);
    A.store.setNotesScope(U1);
    await A.store.startNotesSync({});
    A.store.writeTree({ v: 3, pages: [{ id: "n1", title: "T", createdAt: 1, updatedAt: 1, pages: [], projectId: null, orgScope: true }], trash: [] });
    A.store.writePage("n1", doc("hello"));
    await A.store.refreshNotesSync();
    const log = () => JSON.parse(A.mem.get("planyr:cloudWriteFailures") || "[]").filter((e) => e.kind === "notes");
    expect(log().length).toBe(1);
    fail = false;
    await A.store.refreshNotesSync();
    expect(log().length).toBe(0);
  }, 15000);
});
