import { describe, it, expect } from "vitest";
import {
  isScheduleRowsAuthoritative,
  fetchScheduleProjectsFromRows,
  fetchScheduleLastWriteAtFromRows,
} from "../src/shared/schedule/scheduleSource.js";

/* B1927952 (NEW-1) — scheduleSource.js is the shared read-side resolver the Dashboard fetch
 * module and (indirectly, via its own mirrored logic) the embedded Scheduler agree on: which
 * storage is authoritative for an account's schedule data, and how to compose the "hs-v1"
 * projects map from public.schedules once it is. These tests exercise the module directly with a
 * dependency-injected fake Supabase client (no module mocking needed, since every export here
 * takes `supabase` as a parameter) — the integration through dashboardScheduleFetch.js's real
 * import path is covered separately in test/dashboardScheduleFetch.test.js. */

/** A minimal fake Supabase client covering exactly the chain shapes this module calls:
 * `.from(t).select(cols).is(field,val).order(...).limit(n).maybeSingle()` and the plain
 * `.from(t).select(cols).is(field,val)` array-returning (thenable) form. */
function makeFakeSupabase(tables, { errors = {} } = {}) {
  return {
    from(table) {
      let rows = (tables[table] || []).map((r) => ({ ...r }));
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
          return Promise.resolve({ data: rows[0] ?? null, error: errors[table] || null });
        },
        then(resolve) {
          return Promise.resolve({ data: rows, error: errors[table] || null }).then(resolve);
        },
      };
      return query;
    },
  };
}

describe("isScheduleRowsAuthoritative", () => {
  it("no supabase client → false", async () => {
    expect(await isScheduleRowsAuthoritative(null)).toBe(false);
  });

  it("no schedule_account_index row at all → false (never migrated)", async () => {
    const sb = makeFakeSupabase({ schedule_account_index: [] });
    expect(await isScheduleRowsAuthoritative(sb)).toBe(false);
  });

  it("row present, rows_authoritative: false → false", async () => {
    const sb = makeFakeSupabase({ schedule_account_index: [{ rows_authoritative: false }] });
    expect(await isScheduleRowsAuthoritative(sb)).toBe(false);
  });

  it("row present, rows_authoritative: true → true (the flipped case)", async () => {
    const sb = makeFakeSupabase({ schedule_account_index: [{ rows_authoritative: true }] });
    expect(await isScheduleRowsAuthoritative(sb)).toBe(true);
  });

  it("a read error → false, never throws", async () => {
    const sb = makeFakeSupabase(
      { schedule_account_index: [{ rows_authoritative: true }] },
      { errors: { schedule_account_index: { message: "network down" } } }
    );
    expect(await isScheduleRowsAuthoritative(sb)).toBe(false);
  });
});

describe("fetchScheduleProjectsFromRows", () => {
  it("no supabase client → null", async () => {
    expect(await fetchScheduleProjectsFromRows(null)).toBeNull();
  });

  it("composes { [id]: data } from non-deleted rows, keyed by string id", async () => {
    const sb = makeFakeSupabase({
      schedules: [
        { id: 1, data: { id: 1, name: "Master Schedule", tasks: [] }, deleted_at: null },
        { id: 3, data: { id: 3, name: "8 South", tasks: [{ id: 1 }] }, deleted_at: null },
      ],
    });
    const projects = await fetchScheduleProjectsFromRows(sb);
    expect(Object.keys(projects).sort()).toEqual(["1", "3"]);
    expect(projects["3"].name).toBe("8 South");
  });

  it("excludes a soft-deleted schedule (id 31 'Operations (Copy)' is the live production case)", async () => {
    const sb = makeFakeSupabase({
      schedules: [
        { id: 1, data: { id: 1, name: "Master Schedule" }, deleted_at: null },
        { id: 31, data: { id: 31, name: "Operations (Copy)" }, deleted_at: "2026-09-25T17:58:00Z" },
      ],
    });
    const projects = await fetchScheduleProjectsFromRows(sb);
    expect(Object.keys(projects)).toEqual(["1"]);
  });

  it("zero live schedules → {} (a real empty answer, not null)", async () => {
    const sb = makeFakeSupabase({ schedules: [] });
    const projects = await fetchScheduleProjectsFromRows(sb);
    expect(projects).toEqual({});
  });

  it("preserves an org-owned schedule's shape (ownerKind:'org', no linkedSiteId) untouched", async () => {
    const sb = makeFakeSupabase({
      schedules: [{ id: 9, data: { id: 9, name: "Pursuits", ownerKind: "org", linkedSiteId: null, tasks: [] }, deleted_at: null }],
    });
    const projects = await fetchScheduleProjectsFromRows(sb);
    expect(projects["9"]).toMatchObject({ ownerKind: "org", linkedSiteId: null });
  });

  it("four schedules sharing the name 'Master Schedule' (ids 1,2,3,6) all resolve as distinct map entries", async () => {
    const sb = makeFakeSupabase({
      schedules: [1, 2, 3, 6].map((id) => ({ id, data: { id, name: "Master Schedule", tasks: [] }, deleted_at: null })),
    });
    const projects = await fetchScheduleProjectsFromRows(sb);
    expect(Object.keys(projects).sort()).toEqual(["1", "2", "3", "6"]);
    for (const id of [1, 2, 3, 6]) expect(projects[String(id)].id).toBe(id);
  });

  it("a read error → null, never throws", async () => {
    const sb = makeFakeSupabase({ schedules: [] }, { errors: { schedules: { message: "boom" } } });
    expect(await fetchScheduleProjectsFromRows(sb)).toBeNull();
  });
});

describe("fetchScheduleLastWriteAtFromRows", () => {
  it("no supabase client → null", async () => {
    expect(await fetchScheduleLastWriteAtFromRows(null)).toBeNull();
  });

  it("returns the max(updated_at) across schedules and the account index row", async () => {
    const sb = makeFakeSupabase({
      schedules: [
        { id: 1, updated_at: "2026-09-20T00:00:00Z", deleted_at: null },
        { id: 2, updated_at: "2026-09-26T12:00:00Z", deleted_at: null },
      ],
      schedule_account_index: [{ updated_at: "2026-09-25T17:58:00Z" }],
    });
    const ms = await fetchScheduleLastWriteAtFromRows(sb);
    expect(ms).toBe(Date.parse("2026-09-26T12:00:00Z"));
  });

  it("ignores a soft-deleted schedule's updated_at, even if it is the newest", async () => {
    const sb = makeFakeSupabase({
      schedules: [
        { id: 1, updated_at: "2026-09-20T00:00:00Z", deleted_at: null },
        { id: 31, updated_at: "2026-09-27T00:00:00Z", deleted_at: "2026-09-25T17:58:00Z" },
      ],
      schedule_account_index: [{ updated_at: "2026-09-20T00:00:00Z" }],
    });
    const ms = await fetchScheduleLastWriteAtFromRows(sb);
    expect(ms).toBe(Date.parse("2026-09-20T00:00:00Z"));
  });

  it("no rows anywhere → null", async () => {
    const sb = makeFakeSupabase({ schedules: [], schedule_account_index: [] });
    expect(await fetchScheduleLastWriteAtFromRows(sb)).toBeNull();
  });

  it("a read error on either query → null, never throws", async () => {
    const sb = makeFakeSupabase(
      { schedules: [{ id: 1, updated_at: "2026-09-20T00:00:00Z", deleted_at: null }], schedule_account_index: [] },
      { errors: { schedules: { message: "boom" } } }
    );
    expect(await fetchScheduleLastWriteAtFromRows(sb)).toBeNull();
  });
});
