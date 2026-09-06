/* B1156866-family (this branch) — fetchProjects()/listProjects() in doc-review/lib/reviewStore.js
 * must exclude role:"tracked" market-record sites (comps) from every doc-review/Library project
 * list: the Library's one-time folder organizer (migrateAllProjects → ensureSeeded, which
 * provisions the full 133-folder template), ReviewsBar's project filter, and FileBrowser's
 * cross-project filing picker all read through this ONE function. Mirrors the identical
 * `roleOf(s) === "pursuit"` filter shared/projects/projects.js already applies for the Site
 * Planner's own project surfaces.
 *
 * Same chainable-builder supabase mock as reviewDeleteSafety.test.js.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1" },
  exec: () => ({ data: null, error: null }),
  calls: [],
}));

function builder(table) {
  const ops = [];
  const settle = () => { const r = h.exec({ table, ops }); h.calls.push({ table, ops }); return r; };
  const b = {
    then(resolve, reject) { try { resolve(settle()); } catch (e) { reject(e); } },
  };
  for (const m of ["select", "update", "delete", "upsert", "insert", "eq", "neq", "is", "not", "lt", "contains", "limit", "order", "or"])
    b[m] = (...args) => { ops.push([m, ...args]); return b; };
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

import { fetchProjects, listProjects } from "../src/workspaces/doc-review/lib/reviewStore.js";

beforeEach(() => { h.calls = []; h.user = { id: "u1" }; h.exec = () => ({ data: null, error: null }); });

describe("fetchProjects — excludes role:tracked market-record sites (comps)", () => {
  it("drops a tracked group entirely, keeps pursuit groups", async () => {
    h.exec = () => ({
      data: [
        { group_id: "g-pursuit-1", site: "Real Project", updated_at: "2026-09-05T19:00:00Z", team_id: null, status: "active", role: "pursuit" },
        { group_id: "trk0892cf7b73", site: "Tesla - TGS DC4", updated_at: "2026-09-05T19:14:29Z", team_id: null, status: "pursuit", role: "tracked" },
      ],
      error: null,
    });
    const r = await fetchProjects();
    expect(r.ok).toBe(true);
    expect(r.rows.map((p) => p.id)).toEqual(["g-pursuit-1"]);
  });

  it("an absent role column value normalizes to pursuit (never silently excluded)", async () => {
    h.exec = () => ({
      data: [{ group_id: "legacy1", site: "Old Project", updated_at: "2026-01-01T00:00:00Z", team_id: null, status: "active", role: null }],
      error: null,
    });
    const r = await fetchProjects();
    expect(r.rows.map((p) => p.id)).toEqual(["legacy1"]);
  });

  it("listProjects() (the Library organizer / ReviewsBar / FileBrowser call site) inherits the filter", async () => {
    h.exec = () => ({
      data: [{ group_id: "trkONLY", site: "Comp only", updated_at: "2026-09-05T00:00:00Z", team_id: null, status: "pursuit", role: "tracked" }],
      error: null,
    });
    const rows = await listProjects();
    expect(rows).toEqual([]);
  });
});

/* B1162193 — a soft-deleted project (sites.deleted_at set) must never appear in this list either:
 * it feeds the Library's one-time folder organizer (migrateAllProjects → ensureSeeded), which
 * would otherwise seed a fresh 133-folder tree and mirror it to Google Drive on behalf of a
 * project the owner already deleted (part of the ~2,700-orphan-folder finding). */
describe("fetchProjects — excludes soft-deleted sites (deleted_at set)", () => {
  const ALL_ROWS = [
    { group_id: "g-live", site: "Live One", updated_at: "2026-09-05T19:00:00Z", team_id: null, status: "active", role: "pursuit", deleted_at: null },
    { group_id: "g-deleted", site: "Deleted One", updated_at: "2026-09-03T20:13:59Z", team_id: null, status: "active", role: "pursuit", deleted_at: "2026-09-03T20:13:59Z" },
  ];
  const stripDeletedAt = (rows) => rows.map(({ deleted_at, ...rest }) => rest);
  const appliedDeletedAtFilter = (ops) => ops.some(([m, f, v]) => m === "is" && f === "deleted_at" && v === null);

  it("the query asks Supabase to exclude deleted_at rows, and a soft-deleted project is dropped", async () => {
    h.exec = ({ ops }) => ({
      data: stripDeletedAt(appliedDeletedAtFilter(ops) ? ALL_ROWS.filter((r) => r.deleted_at == null) : ALL_ROWS),
      error: null,
    });
    const r = await fetchProjects();
    expect(r.ok).toBe(true);
    expect(r.rows.map((p) => p.id)).toEqual(["g-live"]);
    expect(h.calls.some((c) => appliedDeletedAtFilter(c.ops))).toBe(true);
  });

  it("degrades gracefully on a pre-migration DB with no deleted_at column — lists everything rather than failing", async () => {
    h.exec = ({ ops }) =>
      appliedDeletedAtFilter(ops)
        ? { data: null, error: { message: 'column "deleted_at" does not exist', code: "42703" } }
        : { data: stripDeletedAt(ALL_ROWS), error: null };
    const r = await fetchProjects();
    expect(r.ok).toBe(true);
    expect(r.rows.map((p) => p.id).sort()).toEqual(["g-deleted", "g-live"]);
  });
});
