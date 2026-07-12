/* NEW-F1/F3/F5/F7 — review delete-safety (the 2026-07-12 data-loss audit batch).
 *
 * F1: unique-per-source Drive keys (buildDriveKey) + the shared-key byte-delete guard
 *     (shouldDeleteBytes) so a same-named re-upload can't swap another review's backdrop and
 *     deleting one review can't blank another's bytes.
 * F3: deleteReview is a SOFT delete (deleted_at) restorable from Recently deleted; hard
 *     deletion lives only in purgeReview; a pre-migration DB degrades to the hard path.
 * F5: fetchReviews distinguishes a FAILED read from a truly empty account (the pinStore
 *     pattern) so a network blip can't render an empty Library.
 * F7: purgeReview also removes the review's file_facts row (the full cascade set).
 *
 * The supabase client module is mocked with a chainable builder so the real network/config
 * never runs (same approach as reconcileSite.test.js).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1" },
  exec: () => ({ data: null, error: null }), // scripted per test: receives { table, ops }
  calls: [],                                  // every settled builder run, in order
  storageRemove: null,                        // optional storage.remove interceptor
}));

function builder(table) {
  const ops = [];
  const settle = () => { const r = h.exec({ table, ops }); h.calls.push({ table, ops }); return r; };
  const b = {
    then(resolve, reject) { try { resolve(settle()); } catch (e) { reject(e); } },
  };
  for (const m of ["select", "update", "delete", "upsert", "insert", "eq", "neq", "is", "not", "lt", "contains", "limit", "order", "or"])
    b[m] = (...args) => { ops.push([m, ...args]); return b; };
  b.maybeSingle = () => { ops.push(["maybeSingle"]); return Promise.resolve().then(settle); };
  return b;
}

vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabaseConfigured: () => true,
  supabaseRest: () => ({ url: "http://x", anon: "a" }),
  currentAccessToken: () => "tok",
  connectionInfo: () => ({}),
  testConnection: async () => ({ ok: true }),
  supabase: {
    from: (t) => builder(t),
    storage: {
      from: () => ({
        remove: async (keys) => (h.storageRemove ? h.storageRemove(keys) : { error: null }),
        list: async () => ({ data: [] }),
        download: async () => ({ data: null, error: { message: "not in tests" } }),
      }),
    },
    auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) },
  },
}));
vi.mock("../src/workspaces/site-planner/lib/auth.js", () => ({
  signUp: async () => ({}), signIn: async () => ({}), signOut: async () => ({}),
  resetPassword: async () => ({}), updatePassword: async () => ({}),
  getUser: async () => h.user,
  onAuthChange: () => () => {},
}));

import {
  buildDriveKey, shouldDeleteBytes, deleteReview, restoreReview, purgeReview,
  fetchReviews, listReviews, fetchFileFacts,
} from "../src/workspaces/doc-review/lib/reviewStore.js";

// The op list for the last run against a table, flattened to "m1 m2 …" for easy asserts.
const opNames = (call) => call.ops.map((o) => o[0]).join(" ");
const callsFor = (table) => h.calls.filter((c) => c.table === table);

beforeEach(() => { h.calls = []; h.user = { id: "u1" }; h.exec = () => ({ data: null, error: null }); h.storageRemove = null; });

/* ------------------------------- F1: buildDriveKey ------------------------------- */
describe("buildDriveKey — unique per source, legacy-compatible (NEW-F1)", () => {
  it("embeds the srcId in the LAST segment: project-<pid>/<discipline>/<srcId>__<name>", () => {
    expect(buildDriveKey({ projectId: "px", discipline: "Civil", fileName: "C-101.pdf", srcId: "srcabc1" }))
      .toBe("project-px/civil/srcabc1__C-101.pdf");
  });
  it("two same-named uploads (different srcIds) can never collide", () => {
    const a = buildDriveKey({ projectId: "px", discipline: "Civil", fileName: "C-101.pdf", srcId: "srcaaa1" });
    const b = buildDriveKey({ projectId: "px", discipline: "Civil", fileName: "C-101.pdf", srcId: "srcbbb2" });
    expect(a).not.toBe(b);
  });
  it("a new key can never equal a legacy (name-only) key for any same-named file", () => {
    const legacy = buildDriveKey({ projectId: "px", discipline: "Civil", fileName: "C-101.pdf" }); // srcId omitted = the old shape
    const fresh = buildDriveKey({ projectId: "px", discipline: "Civil", fileName: "C-101.pdf", srcId: "srcaaa1" });
    expect(legacy).toBe("project-px/civil/C-101.pdf");
    expect(fresh).not.toBe(legacy);
  });
  it("keeps the server's flat-folder derivation invariant: dropping the last segment yields the same folder as the legacy key", () => {
    // uploads/start.js derives the flat Drive folder as planyrKey.split("/").slice(0, -1) —
    // the srcId must live in the LAST segment so this derivation is byte-for-byte unchanged.
    const folderOf = (k) => k.split("/").slice(0, -1).join("/");
    const legacy = buildDriveKey({ projectId: "px", discipline: "Structural", fileName: "S-201.pdf" });
    const fresh = buildDriveKey({ projectId: "px", discipline: "Structural", fileName: "S-201.pdf", srcId: "src12345" });
    expect(folderOf(fresh)).toBe(folderOf(legacy));
    expect(folderOf(fresh)).toBe("project-px/structural");
  });
  it("unfiled project + defaults keep the historical shape", () => {
    expect(buildDriveKey({ fileName: "plan.pdf", srcId: "srcz" })).toBe("project-unfiled/other/srcz__plan.pdf");
    expect(buildDriveKey({})).toBe("project-unfiled/other/document.pdf");
  });
});

describe("shouldDeleteBytes — fail-safe byte-delete decision (NEW-F1)", () => {
  it("deletes only on a CONFIRMED not-shared answer", () => {
    expect(shouldDeleteBytes({ guardOk: true, sharedByOther: false })).toBe(true);
  });
  it("a shared key keeps the bytes (the other review still needs them)", () => {
    expect(shouldDeleteBytes({ guardOk: true, sharedByOther: true })).toBe(false);
  });
  it("a FAILED guard query fails safe — never delete on an unconfirmed answer", () => {
    expect(shouldDeleteBytes({ guardOk: false, sharedByOther: false })).toBe(false);
    expect(shouldDeleteBytes({})).toBe(false);
  });
});

/* --------------------------- F3: soft delete / restore --------------------------- */
describe("deleteReview — soft delete with hard-path degrade (NEW-F3)", () => {
  it("stamps deleted_at (UPDATE, not DELETE) and keeps B757's no-op detection", async () => {
    h.exec = ({ ops }) => {
      const names = ops.map((o) => o[0]);
      expect(names).toEqual(["update", "eq", "select"]);
      expect(ops[0][1]).toHaveProperty("deleted_at");
      expect(ops[0][1].deleted_at).toBeTruthy();
      return { data: [{ id: "rv1" }], error: null };
    };
    const r = await deleteReview("rv1");
    expect(r).toMatchObject({ ok: true, soft: true, removed: 1 });
    expect(callsFor("doc_reviews")).toHaveLength(1);
  });
  it("a 0-row update (RLS/ownership no-op) is distinguishable — removed: 0", async () => {
    h.exec = () => ({ data: [], error: null });
    const r = await deleteReview("rv-not-mine");
    expect(r.ok).toBe(true);
    expect(r.removed).toBe(0);
  });
  it("missing deleted_at column (pre-migration DB) degrades to the HARD delete path", async () => {
    h.exec = ({ ops }) => {
      if (ops[0][0] === "update") return { data: null, error: { message: 'column "deleted_at" does not exist', code: "42703" } };
      return { data: [{ id: "rv1" }], error: null }; // every purge-path query succeeds
    };
    const r = await deleteReview("rv1");
    expect(r.ok).toBe(true);
    expect(r.soft).toBeUndefined(); // the hard path answered
    // the hard path really ran: a real DELETE landed on doc_reviews
    expect(callsFor("doc_reviews").some((c) => opNames(c).startsWith("delete"))).toBe(true);
  });
});

describe("restoreReview — un-deletes (NEW-F3)", () => {
  it("clears deleted_at and reports whether a row was actually restored", async () => {
    h.exec = ({ ops }) => {
      expect(ops[0]).toEqual(["update", { deleted_at: null }]);
      return { data: [{ id: "rv1" }], error: null };
    };
    expect((await restoreReview("rv1")).ok).toBe(true);
    h.exec = () => ({ data: [], error: null });
    expect((await restoreReview("rv-gone")).ok).toBe(false); // nothing restored = not ok (loud)
  });
});

/* ------------------------ F1+F7: purgeReview cascade & guard ------------------------ */
describe("purgeReview — shared-key guard + full cascade (NEW-F1/NEW-F7)", () => {
  // Script a record whose two sources share one legacy drive key with ANOTHER review.
  const rec = {
    id: "rv1",
    sources: [
      { srcId: "s1", driveKey: "project-px/civil/C-101.pdf" },
      { srcId: "s2", driveKey: "project-px/civil/C-101.pdf" }, // duplicate — must dedupe to ONE guard check
    ],
  };
  function scriptedExec({ sharedAnswer, deleted = { data: [{ id: "rv1" }], error: null } }) {
    return ({ table, ops }) => {
      const names = ops.map((o) => o[0]).join(" ");
      if (table === "doc_reviews" && names.includes("maybeSingle")) return { data: { data: rec, version: 1, team_id: null, deleted_at: "2026-07-12T00:00:00Z" }, error: null };
      if (table === "doc_reviews" && names.startsWith("select neq")) return sharedAnswer; // the guard query
      if (table === "file_facts") return { data: null, error: null };
      if (table === "doc_reviews" && names.startsWith("delete")) return deleted;
      return { data: null, error: null };
    };
  }

  it("keeps the bytes when another review still references the key (sharedKept, no Drive delete)", async () => {
    global.fetch = vi.fn(async () => ({ ok: true })); // deleteFromDrive transport — must NOT be called
    h.exec = scriptedExec({ sharedAnswer: { data: [{ id: "rv2" }], error: null } });
    const r = await purgeReview("rv1");
    expect(r.ok).toBe(true);
    expect(r.sharedKept).toBe(1);            // deduped: ONE kept key, not two
    expect(r.orphaned).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
    delete global.fetch;
  });

  it("deletes the bytes when the guard CONFIRMS no other reference", async () => {
    global.fetch = vi.fn(async () => ({ ok: true }));
    h.exec = scriptedExec({ sharedAnswer: { data: [], error: null } });
    const r = await purgeReview("rv1");
    expect(r.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1); // deduped single key → single DELETE /api/files
    delete global.fetch;
  });

  it("a FAILED guard query fails safe: bytes kept, surfaced as orphaned/cleanupFailed", async () => {
    global.fetch = vi.fn(async () => ({ ok: true }));
    h.exec = scriptedExec({ sharedAnswer: { data: null, error: { message: "network sad" } } });
    const r = await purgeReview("rv1");
    expect(r.ok).toBe(true);
    expect(r.orphaned).toBe(1);
    expect(r.cleanupFailed).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    delete global.fetch;
  });

  it("removes the file_facts row for the review (id OR review_id) — the full cascade set", async () => {
    h.exec = scriptedExec({ sharedAnswer: { data: [], error: null } });
    global.fetch = vi.fn(async () => ({ ok: true }));
    await purgeReview("rv1");
    const facts = callsFor("file_facts");
    expect(facts).toHaveLength(1);
    expect(opNames(facts[0])).toBe("delete or");
    expect(facts[0].ops[1][1]).toBe("id.eq.rv1,review_id.eq.rv1");
    delete global.fetch;
  });
});

/* ------------------------------ F5: honest list reads ------------------------------ */
describe("fetchReviews — failed read ≠ empty account (NEW-F5)", () => {
  it("ok:true with rows on a successful (soft-delete-filtered) read", async () => {
    h.exec = ({ ops }) => {
      // first tier carries the NEW-F3 filter
      expect(ops.map((o) => o[0])).toEqual(["select", "is", "order"]);
      expect(ops[1]).toEqual(["is", "deleted_at", null]);
      return { data: [{ id: "rv1" }], error: null };
    };
    const r = await fetchReviews();
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
  });
  it("a TRANSIENT tier-1 failure on a migrated DB is ok:false — the filterless fallbacks never run (no resurfacing of Recently-deleted rows)", async () => {
    let calls = 0;
    h.exec = ({ ops }) => {
      calls += 1;
      if (ops.some((o) => o[0] === "is")) return { data: null, error: { message: "upstream connect error 503" } }; // tier 1 blips
      return { data: [{ id: "rv-deleted" }], error: null }; // a filterless tier WOULD succeed — it must never be asked
    };
    const r = await fetchReviews();
    expect(r.ok).toBe(false);
    expect(calls).toBe(1); // stopped at tier 1 — the fallback is gated on isMissingColumn(deleted_at)
  });
  it("a genuinely un-migrated DB (deleted_at missing) still falls back filterless", async () => {
    h.exec = ({ ops }) =>
      ops.some((o) => o[0] === "is")
        ? { data: null, error: { message: 'column doc_reviews.deleted_at does not exist', code: "42703" } }
        : { data: [{ id: "rv1" }], error: null };
    const r = await fetchReviews();
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
  });
  it("listDeletedReviews: a FAILED read is null (keep the last bin), a missing column is honest-empty", async () => {
    const { listDeletedReviews } = await import("../src/workspaces/doc-review/lib/reviewStore.js");
    h.exec = () => ({ data: null, error: { message: "fetch failed" } });
    expect(await listDeletedReviews()).toBe(null);
    h.exec = () => ({ data: null, error: { message: 'column "deleted_at" does not exist', code: "42703" } });
    expect(await listDeletedReviews()).toEqual([]);
  });
  it("ok:false when EVERY fallback tier fails — and listReviews still degrades to []", async () => {
    h.exec = () => ({ data: null, error: { message: "fetch failed" } });
    const r = await fetchReviews();
    expect(r.ok).toBe(false);
    expect(r.rows).toEqual([]);
    expect(r.error).toMatch(/fetch failed/);
    expect(await listReviews()).toEqual([]); // wrapper stays graceful for pickers
  });
  it("signed out is a GENUINE empty (ok:true), not a failure", async () => {
    h.user = null;
    const r = await fetchReviews();
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([]);
    expect(h.calls).toHaveLength(0); // no query even ran
  });
});

describe("fetchFileFacts — missing table is honest-empty; real failure is loud (NEW-F5)", () => {
  it("a pre-migration DB (missing relation) reads as ok:true empty", async () => {
    h.exec = () => ({ data: null, error: { message: 'relation "public.file_facts" does not exist' } });
    const r = await fetchFileFacts();
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([]);
  });
  it("a network failure is ok:false", async () => {
    h.exec = () => ({ data: null, error: { message: "TypeError: fetch failed" } });
    const r = await fetchFileFacts();
    expect(r.ok).toBe(false);
  });
});
