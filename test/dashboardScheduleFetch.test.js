import { describe, it, expect, vi } from "vitest";

/* B1927952 (NEW-1, 2026-09-27) — RED-PROOF + the full adjacent-cases table for the Dashboard's
 * schedule read. Before this fix, dashboardScheduleFetch.js read ONLY public.planar_data (key
 * "hs-v1"), which is the RETIRED whole-account blob once an account is flipped to
 * schedule_account_index.rows_authoritative = true. That is Michael's own production account's
 * real state since 2026-09-25 — main at e68a272 — so his Dashboard's Schedule health / Needs
 * Attention / "Since you were last here" cards were silently frozen on the 2026-09-22 snapshot.
 *
 * This mocks the real import path (../src/workspaces/site-planner/lib/supabase.js), the same
 * technique test/dashboardDocFetch.test.js already uses, so it proves the INTEGRATION — that
 * dashboardScheduleFetch.js actually resolves through scheduleSource.js — not just the pure logic
 * (that's test/scheduleSource.test.js).
 */

const h = vi.hoisted(() => ({ tables: {}, errors: {} }));

function fakeFrom(table) {
  let rows = (h.tables[table] || []).map((r) => ({ ...r }));
  const query = {
    select() { return query; },
    eq(field, val) { rows = rows.filter((r) => r[field] === val); return query; },
    is(field, val) { rows = rows.filter((r) => (r[field] ?? null) === val); return query; },
    order(field, { ascending = true } = {}) {
      rows = rows.slice().sort((a, b) => {
        const av = a[field], bv = b[field];
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
      return query;
    },
    limit(n) { rows = rows.slice(0, n); return query; },
    maybeSingle() {
      return Promise.resolve({ data: rows[0] ?? null, error: h.errors[table] || null });
    },
    then(resolve) {
      return Promise.resolve({ data: rows, error: h.errors[table] || null }).then(resolve);
    },
  };
  return query;
}

vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: { from: (table) => fakeFrom(table) },
}));

import { fetchScheduleProjects, fetchScheduleLastWriteAt } from "../src/workspaces/dashboard/lib/dashboardScheduleFetch.js";

function reset() { h.tables = {}; h.errors = {}; }

// The frozen blob, exactly as described in the dispatch: newest planar_history snapshot
// 2026-09-22, drifted from the live schedules rows (id 3 = "8 South", 159 tasks in rows vs
// "8 South" 161 in the blob).
const STALE_BLOB_PROJECTS = {
  1: { id: 1, name: "Master Schedule", tasks: Array.from({ length: 262 }, (_, i) => ({ id: i + 1 })) },
  3: { id: 3, name: "8 South", tasks: Array.from({ length: 161 }, (_, i) => ({ id: i + 1 })) },
};

function seedBlob() {
  h.tables.planar_data = [{ key: "hs-v1", value: { __rev: 5026, projects: STALE_BLOB_PROJECTS } }];
  h.tables.planar_history = [{ key: "hs-v1", created_at: "2026-09-22T14:37:59Z" }];
}

describe("fetchScheduleProjects / fetchScheduleLastWriteAt — RED-PROOF", () => {
  it("RED-PROOF: on a flipped (rows_authoritative) account with rows that disagree with a stale blob, returns the ROWS' content, not the blob's", async () => {
    reset();
    seedBlob();
    h.tables.schedule_account_index = [{ rows_authoritative: true, updated_at: "2026-09-25T17:58:00Z" }];
    h.tables.schedules = [
      { id: 1, data: { id: 1, name: "Master Schedule", tasks: Array.from({ length: 263 }, (_, i) => ({ id: i + 1 })) }, deleted_at: null },
      { id: 3, data: { id: 3, name: "8 South", tasks: Array.from({ length: 159 }, (_, i) => ({ id: i + 1 })) }, deleted_at: null },
    ];

    const projects = await fetchScheduleProjects();

    // The rows' own numbers (263 / 159), not the blob's (262 / 161) — this is what fails on
    // unmodified main, since main reads only planar_data and returns the blob's 262/161.
    expect(projects["1"].tasks).toHaveLength(263);
    expect(projects["3"].tasks).toHaveLength(159);
    expect(projects["3"].name).toBe("8 South");
  });
});

describe("fetchScheduleProjects — adjacent cases", () => {
  it("un-flipped account → blob fallback, unchanged behavior", async () => {
    reset();
    seedBlob();
    h.tables.schedule_account_index = [{ rows_authoritative: false }];
    h.tables.schedules = [{ id: 1, data: { id: 1, name: "Rows copy, must NOT be used" }, deleted_at: null }];

    const projects = await fetchScheduleProjects();
    expect(projects["1"].name).toBe("Master Schedule"); // the blob's content
  });

  it("no schedule_account_index row at all → blob fallback", async () => {
    reset();
    seedBlob();
    h.tables.schedule_account_index = [];

    const projects = await fetchScheduleProjects();
    expect(projects["1"].name).toBe("Master Schedule");
  });

  it("schedules rows present but rows_authoritative false → still the blob, never the rows", async () => {
    reset();
    seedBlob();
    h.tables.schedule_account_index = [{ rows_authoritative: false }];
    h.tables.schedules = [{ id: 1, data: { id: 1, name: "Should not be read" }, deleted_at: null }];

    const projects = await fetchScheduleProjects();
    expect(projects["1"].name).toBe("Master Schedule");
  });

  it("a soft-deleted schedule (id 31, 'Operations (Copy)') never appears in a flipped account's map", async () => {
    reset();
    h.tables.schedule_account_index = [{ rows_authoritative: true }];
    h.tables.schedules = [
      { id: 6, data: { id: 6, name: "Pappadoupolos" }, deleted_at: null },
      { id: 31, data: { id: 31, name: "Operations (Copy)" }, deleted_at: "2026-09-25T17:58:00Z" },
    ];

    const projects = await fetchScheduleProjects();
    expect(Object.keys(projects)).toEqual(["6"]);
  });

  it("an org-owned schedule with null linked_site_id (Pursuits, Operations) still resolves — ownerOf must read Organization", async () => {
    reset();
    h.tables.schedule_account_index = [{ rows_authoritative: true }];
    h.tables.schedules = [
      { id: 15, data: { id: 15, name: "Pursuits", ownerKind: "org", linkedSiteId: null, tasks: [] }, deleted_at: null },
    ];

    const projects = await fetchScheduleProjects();
    expect(projects["15"]).toMatchObject({ ownerKind: "org", linkedSiteId: null });
  });

  it("four schedules sharing the name 'Master Schedule' (ids 1,2,3,6) all appear as distinct entries", async () => {
    reset();
    h.tables.schedule_account_index = [{ rows_authoritative: true }];
    h.tables.schedules = [1, 2, 3, 6].map((id) => ({
      id, data: { id, name: "Master Schedule", tasks: [] }, deleted_at: null,
    }));

    const projects = await fetchScheduleProjects();
    expect(Object.keys(projects).sort()).toEqual(["1", "2", "3", "6"]);
  });

  it("zero schedules on a flipped account → {} (not null — a real 'no schedules yet' answer)", async () => {
    reset();
    h.tables.schedule_account_index = [{ rows_authoritative: true }];
    h.tables.schedules = [];

    const projects = await fetchScheduleProjects();
    expect(projects).toEqual({});
  });
});

describe("fetchScheduleLastWriteAt — adjacent cases", () => {
  it("flipped account → exact max(updated_at) across schedules + the index row, not the history ring", async () => {
    reset();
    seedBlob(); // planar_history says 2026-09-22 — must NOT be read on this path
    h.tables.schedule_account_index = [{ rows_authoritative: true, updated_at: "2026-09-25T17:58:00Z" }];
    h.tables.schedules = [{ id: 1, updated_at: "2026-09-26T09:00:00Z", deleted_at: null }];

    const ms = await fetchScheduleLastWriteAt();
    expect(ms).toBe(Date.parse("2026-09-26T09:00:00Z"));
  });

  it("un-flipped account → falls back to the planar_history ring's newest snapshot, unchanged behavior", async () => {
    reset();
    seedBlob();
    h.tables.schedule_account_index = [{ rows_authoritative: false }];

    const ms = await fetchScheduleLastWriteAt();
    expect(ms).toBe(Date.parse("2026-09-22T14:37:59Z"));
  });

  it("an account whose newest write is older than the last visit → returns that (real, if stale-looking) timestamp, never fabricates a more-recent one", async () => {
    reset();
    h.tables.schedule_account_index = [{ rows_authoritative: true, updated_at: "2026-01-01T00:00:00Z" }];
    h.tables.schedules = [{ id: 1, updated_at: "2026-01-01T00:00:00Z", deleted_at: null }];

    const ms = await fetchScheduleLastWriteAt();
    expect(ms).toBe(Date.parse("2026-01-01T00:00:00Z"));
  });

  it("both functions degrade to null/blob-fallback on a read error, never throw", async () => {
    reset();
    h.errors.schedule_account_index = { message: "network down" };
    h.tables.planar_data = [];
    h.tables.planar_history = [];

    await expect(fetchScheduleProjects()).resolves.toBeNull();
    await expect(fetchScheduleLastWriteAt()).resolves.toBeNull();
  });
});
