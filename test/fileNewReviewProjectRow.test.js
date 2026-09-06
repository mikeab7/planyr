/* B1160480 — a Library upload (fileNewReview) and a re-file (refileReview) both write a
 * doc_reviews row whose project_id points at a Site Planner project. A project born with no
 * located origin has no public.sites row until its first drawing save, so filing straight into
 * that id used to write doc_reviews/file_facts rows — and bytes in Drive — keyed to a project
 * that names no row anywhere: a hard reload then reported "This project doesn't exist" and
 * stranded the file. Both functions now call storage.js's `ensureProjectRow` first; these tests
 * prove the WIRING (the guard actually gates the write), not just the guard's own logic (covered
 * separately in ensureProjectRow.test.js).
 *
 * The supabase client module is mocked with a chainable builder so the real network/config
 * never runs (same approach as reviewDeleteSafety.test.js); storage.js is mocked directly so
 * this suite tests the CALLER's reaction to ensureProjectRow's verdict, not its own internals.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1" },
  exec: () => ({ data: [{ id: "rv1", version: 1 }], error: null }),
  calls: [],
  ensureProjectRowResult: { ok: true, created: true },
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
    storage: { from: () => ({ remove: async () => ({ error: null }), list: async () => ({ data: [] }), download: async () => ({ data: null, error: { message: "not in tests" } }) }) },
    auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) },
  },
}));
vi.mock("../src/workspaces/site-planner/lib/auth.js", () => ({
  signUp: async () => ({}), signIn: async () => ({}), signOut: async () => ({}),
  resetPassword: async () => ({}), updatePassword: async () => ({}),
  getUser: async () => h.user,
  onAuthChange: () => () => {},
}));
vi.mock("../src/workspaces/site-planner/lib/storage.js", () => ({
  ensureProjectRow: vi.fn(async () => h.ensureProjectRowResult),
}));

import { fileNewReview, refileReview } from "../src/workspaces/doc-review/lib/reviewStore.js";
import { ensureProjectRow } from "../src/workspaces/site-planner/lib/storage.js";

const callsFor = (table) => h.calls.filter((c) => c.table === table);

beforeEach(() => {
  h.calls = [];
  h.user = { id: "u1" };
  h.exec = () => ({ data: [{ id: "rv1", version: 1 }], error: null });
  vi.clearAllMocks();
  h.ensureProjectRowResult = { ok: true, created: true }; // vi.clearAllMocks() doesn't touch h
});

describe("fileNewReview — ensures the target project's row exists before filing (B1160480)", () => {
  it("a real project id: ensureProjectRow is called, and a confirmed row lets the file through", async () => {
    const r = await fileNewReview({ projectId: "smrealproj", project: "Untitled project", fileName: "plan.pdf" });
    expect(ensureProjectRow).toHaveBeenCalledWith("smrealproj", { name: "Untitled project", confirmLive: true });
    expect(r.ok).toBe(true);
    expect(callsFor("doc_reviews").length).toBeGreaterThan(0); // the review really was written
  });

  it("a project that couldn't be confirmed with the cloud refuses the ingest — nothing is written", async () => {
    h.ensureProjectRowResult = { ok: false, created: false, error: "couldn't reach the cloud" };
    const r = await fileNewReview({ projectId: "smflaky", project: "Untitled project", fileName: "plan.pdf" });
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe("string");
    expect(callsFor("doc_reviews")).toHaveLength(0); // no doc_reviews row, no file_facts, nothing orphaned
  });

  it("a genuinely soft-deleted project refuses the ingest with a clear reason — never files into it", async () => {
    h.ensureProjectRowResult = { ok: false, created: false, deleted: true, error: "This project has been deleted." };
    const r = await fileNewReview({ projectId: "smdeleted", project: "Old project", fileName: "plan.pdf" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/deleted/i);
    expect(callsFor("doc_reviews")).toHaveLength(0);
  });

  it("an Organization-scoped upload never asks about a project row (there is no project)", async () => {
    const r = await fileNewReview({ orgScope: true, fileName: "plan.pdf" });
    expect(ensureProjectRow).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it("a cross-project upload matched to NO project (holding area) never asks either", async () => {
    const r = await fileNewReview({ projectId: null, fileName: "plan.pdf" });
    expect(ensureProjectRow).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });
});

describe("refileReview — the same guard applies when moving a review INTO a project (B1160480)", () => {
  beforeEach(() => {
    // loadReview reads doc_reviews by id; script the maybeSingle lookup it performs.
    h.exec = ({ table, ops }) => {
      if (table === "doc_reviews" && ops.some((o) => o[0] === "maybeSingle"))
        return { data: { data: { id: "rv1", projectId: null, project: "" }, version: 1, team_id: null, deleted_at: null }, error: null };
      return { data: [{ id: "rv1", version: 2 }], error: null };
    };
  });

  it("re-filing into a real project ensures its row first, then writes", async () => {
    const r = await refileReview("rv1", { projectId: "smrealproj", project: "Untitled project" });
    expect(ensureProjectRow).toHaveBeenCalledWith("smrealproj", { name: "Untitled project", confirmLive: true });
    expect(r.ok).toBe(true);
  });

  it("re-filing into a project that can't be confirmed refuses — the review is NOT re-pointed", async () => {
    h.ensureProjectRowResult = { ok: false, created: false, error: "couldn't reach the cloud" };
    const r = await refileReview("rv1", { projectId: "smflaky", project: "Untitled project" });
    expect(r.ok).toBe(false);
    expect(callsFor("doc_reviews").some((c) => c.ops.some((o) => o[0] === "update" || o[0] === "insert"))).toBe(false);
  });

  it("re-filing to Organization never asks about a project row", async () => {
    const r = await refileReview("rv1", { orgScope: true });
    expect(ensureProjectRow).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });
});
