import { describe, it, expect } from "vitest";
import { supabaseIdStore } from "../server/storage/idStoreSupabase.js";

// Request-shape lock for listByPrefix (B660 migration): prefix scan of the caller's
// drive_files rows, ordered + paged, mapped to { planyrKey, driveId }.
describe("supabaseIdStore.listByPrefix (B660)", () => {
  const recorder = (responder) => {
    const calls = [];
    const fn = async (url, opts = {}) => { calls.push({ url, opts }); return responder(url, opts); };
    fn.calls = calls;
    return fn;
  };

  it("GETs drive_files with a like-prefix pattern, ordering, limit + offset", async () => {
    const f = recorder(() => ({ ok: true, json: async () => [
      { planyr_key: "u1/project-p1/civil/a.pdf", drive_id: "d1" },
    ] }));
    const store = supabaseIdStore({ supabaseUrl: "https://x.supabase.co", anonKey: "anon", token: "tok", fetchImpl: f });
    const rows = await store.listByPrefix("u1/project-p1/", { limit: 8, offset: 16 });
    const url = f.calls[0].url;
    expect(url).toMatch(/\/rest\/v1\/drive_files\?/);
    expect(url).toContain(`planyr_key=like.${encodeURIComponent("u1/project-p1/*")}`);
    expect(url).toContain("order=planyr_key.asc");
    expect(url).toContain("limit=8");
    expect(url).toContain("offset=16");
    expect(rows).toEqual([{ planyrKey: "u1/project-p1/civil/a.pdf", driveId: "d1" }]);
  });

  it("returns NULL on failure — a failed page must never look like the end of the list", async () => {
    // An [] here made a blipped page read report the one-time migration COMPLETE and write
    // the permanent done-marker (B660 review #1).
    const f = recorder(() => ({ ok: false, status: 500, json: async () => ({}) }));
    const store = supabaseIdStore({ supabaseUrl: "https://x.supabase.co", anonKey: "anon", token: "tok", fetchImpl: f });
    expect(await store.listByPrefix("u1/")).toBe(null);
  });
});
