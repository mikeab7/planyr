/* NEW-6 (data-risk 2026-10-29) — `purge-project` asks the same liveness question the DB guards ask
 * (coalesce(data->>'groupId', id), NOT the group_id column) before it trashes a Drive tree, and fails SAFE. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { projectHasLivePlans } from "../server/storage/projectLiveness.js";

const base = { supabaseUrl: "https://x.supabase.co", anonKey: "anon", token: "tok" };
const answering = (rows, ok = true, status = 200) => async () => ({ ok, status, json: async () => rows });

describe("projectHasLivePlans", () => {
  it("a live row → live:true", async () => {
    expect(await projectHasLivePlans({ ...base, projectId: "smabc", fetchImpl: answering([{ id: "smabc" }]) })).toEqual({ ok: true, live: true });
  });
  it("no live row → live:false (the only answer that lets the purge go on)", async () => {
    expect(await projectHasLivePlans({ ...base, projectId: "smabc", fetchImpl: answering([]) })).toEqual({ ok: true, live: false });
  });
  it("asks coalesce(data->>'groupId', id) — jsonb key OR (jsonb key null AND id) — never the group_id column", async () => {
    let seen = "";
    await projectHasLivePlans({ ...base, projectId: "smabc", fetchImpl: async (url) => { seen = decodeURIComponent(url); return { ok: true, json: async () => [] }; } });
    expect(seen).toContain("deleted_at=is.null");
    expect(seen).toContain("data->>groupId.eq.smabc");
    expect(seen).toContain("and(id.eq.smabc,data->>groupId.is.null)");
    expect(seen).not.toContain("group_id");
  });
  it("FAILS SAFE: a non-OK answer, a throw, an unreadable body and a hostile id are all ok:false, never 'not live'", async () => {
    expect((await projectHasLivePlans({ ...base, projectId: "smabc", fetchImpl: answering([], false, 500) })).ok).toBe(false);
    expect((await projectHasLivePlans({ ...base, projectId: "smabc", fetchImpl: async () => { throw new Error("net"); } })).ok).toBe(false);
    expect((await projectHasLivePlans({ ...base, projectId: "smabc", fetchImpl: answering({ message: "x" }) })).ok).toBe(false);
    expect((await projectHasLivePlans({ ...base, projectId: "a),id.neq.(b", fetchImpl: answering([]) })).ok).toBe(false);
    expect((await projectHasLivePlans({ ...base, token: "", projectId: "smabc", fetchImpl: answering([]) })).ok).toBe(false);
  });
});

describe("functions/api/folders.js — the check runs BEFORE the trash", () => {
  const src = readFileSync("functions/api/folders.js", "utf8");
  const arm = src.slice(src.indexOf('action === "purge-project"'));
  it("projectHasLivePlans precedes purgeProjectDrive; a live project is 409 and an unanswerable check is 502", () => {
    expect(arm.indexOf("projectHasLivePlans(")).toBeGreaterThan(-1);
    expect(arm.indexOf("projectHasLivePlans(")).toBeLessThan(arm.indexOf("purgeProjectDrive("));
    expect(arm).toMatch(/lv\.live\)[^\n]*409/);
    expect(arm).toMatch(/!lv\.ok\)[^\n]*502/);
  });
});

describe("e2e seeds — never hard-delete a LIVE sites row (sites_block_delete_live_group, PLYR1)", () => {
  for (const f of ["e2e/seed/seed.sql", "e2e/seed/seed-fixtures.sql"]) {
    it(`${f} soft-deletes the prior fixture before deleting it`, () => {
      const s = readFileSync(f, "utf8");
      const upd = s.search(/update public\.sites set deleted_at = now\(\)/);
      const del = s.search(/delete from public\.sites\b/);
      expect(upd).toBeGreaterThan(-1);
      expect(del).toBeGreaterThan(upd);
    });
  }
});
