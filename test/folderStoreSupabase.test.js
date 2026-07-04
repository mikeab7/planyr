import { describe, it, expect } from "vitest";
import { folderStoreSupabase } from "../server/storage/folderStoreSupabase.js";

// Records every request; returns canned JSON. Lets us assert URL/method/body without a network.
function recorder(responder = () => ({ ok: true, status: 200, json: async () => [] })) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
    return responder(url, opts);
  };
  fn.calls = calls;
  return fn;
}

const cfg = (fetchImpl) => folderStoreSupabase({ supabaseUrl: "https://x.supabase.co", anonKey: "anon", token: "tok", fetchImpl });

describe("folderStoreSupabase.list (B645)", () => {
  it("GETs project_folders scoped by project and maps to the planner row shape", async () => {
    const f = recorder(() => ({ ok: true, status: 200, json: async () => [
      { id: "a", parent_id: null, name: "A", trashed: false, drive_folder_id: "d1", drive_parent_id: null, drive_name: "A", drive_trashed: false },
    ] }));
    const rows = await cfg(f).list("proj1");
    expect(f.calls[0].url).toMatch(/\/rest\/v1\/project_folders\?/);
    expect(f.calls[0].url).toMatch(/project_id=eq\.proj1/);
    expect(f.calls[0].headers.authorization).toBe("Bearer tok");
    expect(rows[0]).toEqual({ id: "a", parentId: null, name: "A", trashed: false, driveFolderId: "d1", driveParentId: null, driveName: "A", driveTrashed: false });
  });

  it("returns [] on a query error instead of throwing", async () => {
    const f = recorder(() => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await cfg(f).list("proj1")).toEqual([]);
  });
});

describe("folderStoreSupabase.updateDrive (B645) — writes drive_* only via the guarded RPC", () => {
  it("POSTs to /rpc/folder_set_drive_meta with { p_id, p_patch } and ONLY the present keys", async () => {
    const f = recorder(() => ({ ok: true, status: 204, json: async () => null }));
    const r = await cfg(f).updateDrive("row1", { driveFolderId: "d9", driveName: "Civil" });
    expect(r.ok).toBe(true);
    const call = f.calls[0];
    expect(call.method).toBe("POST");
    expect(call.url).toMatch(/\/rest\/v1\/rpc\/folder_set_drive_meta$/);
    const body = JSON.parse(call.body);
    expect(body.p_id).toBe("row1");
    expect(body.p_patch).toEqual({ drive_folder_id: "d9", drive_name: "Civil" }); // no parent/trashed keys
  });

  it("keeps a present NULL parent in the patch (a top-level move must clear drive_parent_id)", async () => {
    const f = recorder(() => ({ ok: true, status: 204, json: async () => null }));
    await cfg(f).updateDrive("row1", { driveParentId: null });
    const body = JSON.parse(f.calls[0].body);
    expect("drive_parent_id" in body.p_patch).toBe(true);
    expect(body.p_patch.drive_parent_id).toBe(null);
  });

  it("reports { ok:false } (never throws) when the RPC fails, so the reconcile can roll back", async () => {
    const f = recorder(() => ({ ok: false, status: 403, json: async () => ({}) }));
    const r = await cfg(f).updateDrive("row1", { driveTrashed: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/folder_set_drive_meta 403/);
  });
});
