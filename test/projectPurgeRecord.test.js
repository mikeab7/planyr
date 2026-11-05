/* NEW-4 (data-risk 2026-10-29) — a permanently deleted project is recorded: which one, who owned it, when it was
 * trashed, and what went with it. Observability only: the purge itself is untouched. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { collectPurgeManifest, buildPurgeEvent } from "../src/workspaces/site-planner/lib/projectPurgeRecord.js";

function fakeClient({ rows = [], counts = {}, failTables = [] } = {}) {
  return {
    from(table) {
      const q = {
        select(_cols, opts) { q.head = !!(opts && opts.head); return q; },
        in() {
          if (failTables.includes(table)) return Promise.resolve({ data: null, count: null, error: { message: "boom" } });
          if (q.head) return Promise.resolve({ count: counts[table] ?? 0, data: null, error: null });
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return q;
    },
  };
}
const ROW = { id: "s1", group_id: "g1", site: "Goose Creek", name: "Concept A", user_id: "u1", deleted_at: "2026-09-20T10:00:00Z" };

describe("collectPurgeManifest", () => {
  it("reads the rows and every count", async () => {
    const m = await collectPurgeManifest(fakeClient({ rows: [ROW], counts: { site_elements: 120, comps: 2, site_plan_overlays: 1, schedules: 1, project_folders: 118 } }), { ids: ["s1"], groupId: "g1" });
    expect(m.rows).toEqual([ROW]);
    expect(m.counts).toEqual({ site_elements: 120, comps: 2, overlays: 1, schedules: 1, folder_rows: 118, notes: "unlinked" });
  });
  it("an unreadable count is null, never 0 — unknown stays distinguishable from none", async () => {
    const m = await collectPurgeManifest(fakeClient({ rows: [ROW], failTables: ["comps"] }), { ids: ["s1"], groupId: "g1" });
    expect(m.counts.comps).toBeNull();
    expect(m.counts.site_elements).toBe(0);
  });
  it("never throws, even with no client", async () => {
    expect((await collectPurgeManifest(null, { ids: ["s1"] })).rows).toBeNull();
  });
});

describe("buildPurgeEvent", () => {
  const manifest = { ids: ["s1"], groupId: "g1", rows: [ROW], counts: { site_elements: 5 } };
  it("names id, group, name, owner, both timestamps and the counts", () => {
    const ev = buildPurgeEvent(manifest, { ok: true, gone: ["s1"] }, Date.UTC(2026, 9, 29, 12));
    expect(ev).toMatchObject({ ids: ["s1"], groupId: "g1", name: "Goose Creek", owner: "u1", softDeletedAt: "2026-09-20T10:00:00Z", purgedAt: "2026-10-29T12:00:00.000Z", counts: { site_elements: 5 } });
  });
  it("records nothing when nothing was proven gone", () => {
    expect(buildPurgeEvent(manifest, { ok: false, gone: [] })).toBeNull();
  });
  it("a manifest whose rows could not be read still records the purge, saying what is unknown", () => {
    const ev = buildPurgeEvent({ ids: ["s1"], groupId: "g1", rows: null, counts: null }, { ok: true, gone: ["s1"] });
    expect(ev.ids).toEqual(["s1"]);
    expect(ev.name).toBeNull();
    expect(ev.detail).toMatch(/unknown/);
  });
});

describe("wiring (source guard) — both destroy paths record, after the proof, and gate nothing", () => {
  const src = readFileSync("src/workspaces/site-planner/lib/storage.js", "utf8");
  it("purgeDeletedProject and purgeExpiredDeletedProjects each snapshot BEFORE the delete and record AFTER it", () => {
    const manual = src.slice(src.indexOf("export async function purgeDeletedProject"), src.indexOf("async function hardDeleteVerified"));
    expect(manual.indexOf("snapshotForPurge")).toBeGreaterThan(-1);
    expect(manual.indexOf("snapshotForPurge")).toBeLessThan(manual.indexOf("hardDeleteVerified(list)"));
    expect(manual.indexOf("hardDeleteVerified(list)")).toBeLessThan(manual.indexOf("recordProjectPurge"));
    const sweep = src.slice(src.indexOf("export async function purgeExpiredDeletedProjects"));
    expect(sweep.indexOf("snapshotForPurge")).toBeLessThan(sweep.indexOf("hardDeleteVerified([row.id])"));
    expect(sweep.indexOf("hardDeleteVerified([row.id])")).toBeLessThan(sweep.indexOf("recordProjectPurge"));
  });
});
