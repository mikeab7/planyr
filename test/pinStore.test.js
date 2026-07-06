/* pinStore — pinned folders/files behind the Library Home.
 *
 * Two backends: signed-out is the per-device localStorage bucket (v1, still exercised here
 * because the test env has no Supabase configured, so the public API takes the local path);
 * signed-in is the Supabase `pins` table (B675). The cloud I/O functions take the client as a
 * parameter (the casUpsert/folderStoreSupabase DI convention), so a fake client covers them
 * without a live DB. Pure helpers + the one-time migration decision are unit-tested directly.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  // public API (local path — supabase is null in the test env)
  listPins, addPin, removePin, togglePin, isPinned,
  // pure helpers
  rowToPin, pinToRow, dedupePins, planPinMigration,
  // cloud I/O (dependency-injected client)
  fetchPinsCloud, listPinsCloud, addPinCloud, removePinCloud, runPinMigration,
} from "../src/shared/pins/pinStore.js";

function makeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.delete(k); map.set(k, String(v)); },
    removeItem: (k) => map.delete(k),
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
}

/* A chainable fake Supabase client that records calls and returns canned {data,error}.
 * Faithful to the bits prod depends on: .select(cols).order(col,opts) SORTS by that column
 * (so newest-first ordering is actually exercised, not faked as a no-op); .upsert stamps a
 * monotonic created_at when the payload omits one (models the DB default now(), so migration
 * insert order is observable); .delete().eq().eq() removes matching rows so a follow-up read
 * reflects it. failOn simulates a query error on select/upsert/delete. */
function fakeClient({ rows = [], failOn = new Set() } = {}) {
  const calls = [];
  let store = rows.slice();
  let seq = store.length; // monotonic created_at source for upserts without an explicit one
  const from = (table) => {
    calls.push({ op: "from", table });
    return {
      select(cols) {
        calls.push({ op: "select", table, cols });
        return {
          order(col, opts = {}) {
            calls.push({ op: "order", table, col, opts });
            if (failOn.has("select")) return Promise.resolve({ data: null, error: { message: "select boom" } });
            const dir = opts.ascending === false ? -1 : 1;
            const sorted = store.map((r) => ({ ...r })).sort((a, b) => {
              const av = a[col], bv = b[col];
              return av === bv ? 0 : (av < bv ? -1 : 1) * dir;
            });
            return Promise.resolve({ data: sorted, error: null });
          },
        };
      },
      upsert(payload, opts) {
        calls.push({ op: "upsert", table, payload, opts });
        if (failOn.has("upsert")) return Promise.resolve({ error: { message: "upsert boom" } });
        const i = store.findIndex((r) => r.type === payload.type && r.target_id === payload.target_id);
        const created_at = payload.created_at != null ? payload.created_at : seq++;
        if (i >= 0) store[i] = { ...store[i], ...payload };
        else store.push({ created_at, ...payload });
        return Promise.resolve({ error: null });
      },
      delete() {
        calls.push({ op: "delete", table });
        const eqs = [];
        const chain = {
          eq(col, val) { eqs.push([col, val]); return chain; },
          then(res) {
            if (failOn.has("delete")) return Promise.resolve({ error: { message: "delete boom" } }).then(res);
            store = store.filter((r) => !eqs.every(([c, v]) => r[c] === v));
            return Promise.resolve({ error: null }).then(res);
          },
        };
        return chain;
      },
    };
  };
  return { calls, _rows: () => store, from };
}

beforeEach(() => { globalThis.localStorage = makeStore(); });

const F = { type: "folder", id: "fold-1", projectId: "pA", label: "Drawings" };
const D = { type: "file", id: "rv-1", projectId: "pA", label: "Site plan" };

/* ---- pure helpers ---------------------------------------------------------------- */
describe("pinStore — pure helpers", () => {
  it("rowToPin maps snake_case DB row → camelCase pin, defaulting nullish", () => {
    expect(rowToPin({ type: "folder", target_id: "x", project_id: "p", label: "L" }))
      .toEqual({ type: "folder", id: "x", projectId: "p", label: "L" });
    expect(rowToPin({ type: "file", target_id: "y", project_id: null, label: null }))
      .toEqual({ type: "file", id: "y", projectId: null, label: "" });
  });

  it("pinToRow builds the DB payload with NO user_id (server stamps auth.uid())", () => {
    const row = pinToRow(F);
    expect(row).toMatchObject({ type: "folder", target_id: "fold-1", project_id: "pA", label: "Drawings" });
    expect(row).not.toHaveProperty("user_id");
    expect(typeof row.updated_at).toBe("string");
  });

  it("dedupePins keeps the first of each {type,id} and drops junk", () => {
    const out = dedupePins([F, { ...F, label: "dup" }, D, { type: "bad" }, null, { type: "file", id: "" }]);
    expect(out.map((p) => p.id)).toEqual(["fold-1", "rv-1"]);
    expect(out[0].label).toBe("Drawings"); // first wins
  });

  it("planPinMigration returns only local-only pins (never proposes deleting cloud pins)", () => {
    const local = [F, D];
    const cloud = [{ type: "file", id: "rv-1" }]; // D already in cloud
    const plan = planPinMigration(local, cloud);
    expect(plan.map((p) => p.id)).toEqual(["fold-1"]);
  });
});

/* ---- cloud I/O (dependency-injected fake client) --------------------------------- */
describe("pinStore — cloud backend (DI)", () => {
  it("fetchPinsCloud selects the columns, orders newest-first, and maps rows", async () => {
    const c = fakeClient({ rows: [
      { type: "folder", target_id: "old", project_id: "p", label: "O", created_at: 1 },
      { type: "file", target_id: "new", project_id: null, label: "N", created_at: 9 },
    ] });
    const r = await fetchPinsCloud(c);
    expect(r.ok).toBe(true);
    expect(r.pins.map((p) => p.id)).toEqual(["new", "old"]); // created_at DESC — fails if flipped to ascending
    const sel = c.calls.find((x) => x.op === "select");
    expect(sel.cols).toBe("type,target_id,project_id,label");
    const ord = c.calls.find((x) => x.op === "order");
    expect(ord).toMatchObject({ col: "created_at", opts: { ascending: false } });
  });

  it("fetchPinsCloud DISTINGUISHES a failed read ({ok:false}) from an empty account", async () => {
    const empty = fakeClient({ rows: [] });
    expect(await fetchPinsCloud(empty)).toMatchObject({ ok: true, pins: [] });
    const bad = fakeClient({ failOn: new Set(["select"]) });
    const r = await fetchPinsCloud(bad);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("select boom");
  });

  it("listPinsCloud is the graceful []-wrapper (never throws) for the discarded post-write re-read", async () => {
    const c = fakeClient({ rows: [{ type: "folder", target_id: "a", project_id: "p", label: "A", created_at: 1 }] });
    expect(await listPinsCloud(c)).toEqual([{ type: "folder", id: "a", projectId: "p", label: "A" }]);
    const bad = fakeClient({ failOn: new Set(["select"]) });
    expect(await listPinsCloud(bad)).toEqual([]); // graceful
  });

  it("addPinCloud upserts the payload with onConflict and NO user_id", async () => {
    const c = fakeClient();
    const r = await addPinCloud(c, F);
    expect(r).toEqual({ ok: true });
    const up = c.calls.find((x) => x.op === "upsert");
    expect(up.opts).toEqual({ onConflict: "user_id,type,target_id" });
    expect(up.payload).not.toHaveProperty("user_id");
    expect(up.payload.target_id).toBe("fold-1");
  });

  it("addPinCloud returns {ok:false,error} on a failed write (no throw)", async () => {
    const c = fakeClient({ failOn: new Set(["upsert"]) });
    expect(await addPinCloud(c, F)).toEqual({ ok: false, error: "upsert boom" });
  });

  it("removePinCloud deletes by type + target_id (RLS scopes to own rows), graceful on error", async () => {
    const c = fakeClient({ rows: [pinToRow(F), pinToRow(D)] });
    const r = await removePinCloud(c, "folder", "fold-1");
    expect(r).toEqual({ ok: true });
    expect((await listPinsCloud(c)).map((p) => p.id)).toEqual(["rv-1"]); // F gone, D kept

    const bad = fakeClient({ failOn: new Set(["delete"]) });
    expect(await removePinCloud(bad, "folder", "x")).toEqual({ ok: false, error: "delete boom" });
  });
});

/* ---- one-time migration ----------------------------------------------------------- */
describe("pinStore — runPinMigration (local → cloud)", () => {
  it("copies only local-only pins and reports counts", async () => {
    const c = fakeClient({ rows: [pinToRow(D)] }); // D already in cloud
    const res = await runPinMigration(c, [F, D]);
    expect(res).toEqual({ copied: 1, skipped: 1, failed: 0 });
    expect((await listPinsCloud(c)).map((p) => p.id).sort()).toEqual(["fold-1", "rv-1"]);
  });

  it("is idempotent — a re-run with everything already in cloud copies nothing", async () => {
    const c = fakeClient({ rows: [pinToRow(F), pinToRow(D)] });
    expect(await runPinMigration(c, [F, D])).toEqual({ copied: 0, skipped: 2, failed: 0 });
  });

  it("counts failed upserts without throwing", async () => {
    const c = fakeClient({ failOn: new Set(["upsert"]) });
    const res = await runPinMigration(c, [F]);
    expect(res).toEqual({ copied: 0, skipped: 0, failed: 1 });
  });

  it("ABORTS without any write when the cloud read fails (no blind clobber, no done-marker)", async () => {
    const c = fakeClient({ failOn: new Set(["select"]) });
    const res = await runPinMigration(c, [F, D]);
    expect(res).toEqual({ copied: 0, skipped: 0, failed: 2 }); // failed>0 → Library withholds the marker
    expect(c.calls.some((x) => x.op === "upsert")).toBe(false); // never upserted against an unknown cloud
  });

  it("inserts oldest-first so migrated pins read newest-first (no order reversal)", async () => {
    const c = fakeClient({ rows: [] }); // empty cloud
    const local = [ // newest-first, as readList returns
      { type: "folder", id: "C", projectId: null, label: "C" },
      { type: "folder", id: "B", projectId: null, label: "B" },
      { type: "folder", id: "A", projectId: null, label: "A" },
    ];
    await runPinMigration(c, local);
    expect((await listPinsCloud(c)).map((p) => p.id)).toEqual(["C", "B", "A"]); // preserved, not reversed
  });

  it("stops writing on an identity change mid-run and marks the rest failed", async () => {
    const c = fakeClient({ rows: [] });
    let n = 0;
    const checkIdentity = async () => { n += 1; return n <= 1; }; // ok for the first write, then account changed
    const res = await runPinMigration(c, [F, D], checkIdentity);
    expect(res.copied).toBe(1);
    expect(res.failed).toBe(1); // the remaining pin isn't written under the wrong account
    expect(c.calls.filter((x) => x.op === "upsert").length).toBe(1);
  });
});

/* ---- signed-out local backend (public API; supabase is null in the test env) ------ */
describe("pinStore — signed-out local backend (unchanged v1 behavior)", () => {
  it("adds newest-first and lists per uid bucket", async () => {
    await addPin("u1", F);
    await addPin("u1", D);
    expect((await listPins("u1")).map((p) => p.id)).toEqual(["rv-1", "fold-1"]);
    expect(await listPins("u2")).toEqual([]);   // other account bucket empty
    expect(await listPins(null)).toEqual([]);   // signed-out bucket separate
  });

  it("re-pinning the same target dedupes (moves to front, no duplicate)", async () => {
    await addPin("u1", F);
    await addPin("u1", D);
    await addPin("u1", { ...F, label: "Renamed" });
    const pins = await listPins("u1");
    expect(pins.length).toBe(2);
    expect(pins[0]).toEqual({ type: "folder", id: "fold-1", projectId: "pA", label: "Renamed" });
  });

  it("removePin drops only the matching type+id", async () => {
    await addPin("u1", F);
    await addPin("u1", { type: "file", id: "fold-1", projectId: "pA", label: "same id, other type" });
    await removePin("u1", { type: "folder", id: "fold-1" });
    expect(await listPins("u1")).toEqual([{ type: "file", id: "fold-1", projectId: "pA", label: "same id, other type" }]);
  });

  it("togglePin flips presence", async () => {
    await togglePin("u1", F);
    expect(isPinned(await listPins("u1"), F)).toBe(true);
    await togglePin("u1", F);
    expect(isPinned(await listPins("u1"), F)).toBe(false);
  });

  it("rejects junk pins (bad type / missing id) without touching the list", async () => {
    await addPin("u1", F);
    await addPin("u1", { type: "nope", id: "x" });
    await addPin("u1", { type: "file", id: "" });
    expect((await listPins("u1")).length).toBe(1);
  });

  it("corrupt storage reads empty and clears the key", async () => {
    localStorage.setItem("planyr:pins:v1:u1", "{nope");
    expect(await listPins("u1")).toEqual([]);
    expect(localStorage.getItem("planyr:pins:v1:u1")).toBe(null);
  });
});

describe("pinStore — isPinned", () => {
  it("matches on both type and id", () => {
    const list = [F, D];
    expect(isPinned(list, { type: "folder", id: "fold-1" })).toBe(true);
    expect(isPinned(list, { type: "file", id: "fold-1" })).toBe(false); // same id, other type
    expect(isPinned(null, F)).toBe(false);
  });
});
