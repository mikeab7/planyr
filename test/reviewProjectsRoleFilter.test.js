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
