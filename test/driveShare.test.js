import { describe, it, expect, vi, afterEach } from "vitest";
import { onRequestPost } from "../functions/api/files/share.js";

/* /api/files/share handler — honest statuses (NEW-3 exposure / NEW-4). The handler builds its
 * deps from env and uses global fetch (verifySupabaseUser + the Supabase id-map query), so we
 * stub global fetch and route by URL. Auth runs first; the 404 "no Drive mapping" path resolves
 * the key before any Drive call, so no Drive client/creds are needed to exercise it. The 200
 * happy path (a real Drive webViewLink) is covered at the adapter/backend layer in
 * storageAdapter.test.js, which is where that logic lives. */

const ENV = { SUPABASE_URL: "https://p.supabase.co", SUPABASE_ANON_KEY: "anon" };
const req = (key) => new Request(`https://planyr.io/api/files/share${key ? `?key=${encodeURIComponent(key)}` : ""}`, {
  method: "POST", headers: { authorization: "Bearer tok" },
});
const userOk = { ok: true, status: 200, json: async () => ({ id: "u1", email: "a@b.c" }) };
const route = (map = {}) => async (url) => {
  const u = String(url);
  if (u.includes("/auth/v1/user")) return map.user || userOk;
  if (u.includes("/rest/v1/drive_files")) return map.drive_files || { ok: true, status: 200, json: async () => [] };
  throw new Error("unexpected fetch: " + u);
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("/api/files/share — honest statuses (NEW-3 exposure / NEW-4)", () => {
  it("401 when the session is invalid", async () => {
    vi.stubGlobal("fetch", route({ user: { ok: false, status: 401, json: async () => ({}) } }));
    const resp = await onRequestPost({ env: { ...ENV, PLANYR_STORAGE_BACKEND: "drive" }, request: req("proj/x.pdf") });
    expect(resp.status).toBe(401);
  });
  it("503 when Drive isn't the active backend", async () => {
    vi.stubGlobal("fetch", route());
    const resp = await onRequestPost({ env: { ...ENV, PLANYR_STORAGE_BACKEND: "memory" }, request: req("proj/x.pdf") });
    expect(resp.status).toBe(503);
  });
  it("400 when ?key= is missing", async () => {
    vi.stubGlobal("fetch", route());
    const resp = await onRequestPost({ env: { ...ENV, PLANYR_STORAGE_BACKEND: "drive" }, request: req(null) });
    expect(resp.status).toBe(400);
  });
  it("404 when the file has no Drive mapping (e.g. a Supabase-fallback file)", async () => {
    vi.stubGlobal("fetch", route({ drive_files: { ok: true, status: 200, json: async () => [] } }));
    const resp = await onRequestPost({ env: { ...ENV, PLANYR_STORAGE_BACKEND: "drive" }, request: req("proj/x.pdf") });
    expect(resp.status).toBe(404);
    const jr = await resp.json();
    expect(jr.ok).toBe(false);
    expect(jr.error).toMatch(/No file is filed/i);
  });
});
