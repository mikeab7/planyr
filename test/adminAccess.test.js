import { describe, it, expect, vi } from "vitest";
import { checkIsAdmin } from "../src/workspaces/admin/lib/adminAccess.js";

// B711904 (NEW-1) — checkIsAdmin is the ONE gate between "signed-in user" and "sees the
// admin page." Every one of these fails CLOSED: a false positive here would leak the page.
describe("checkIsAdmin — fails closed on every path", () => {
  it("no client at all -> false, no call attempted", async () => {
    expect(await checkIsAdmin(null)).toBe(false);
    expect(await checkIsAdmin(undefined)).toBe(false);
  });

  it("the RPC's own honest 'not an admin' answer -> false", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: false, error: null }) };
    expect(await checkIsAdmin(client)).toBe(false);
    expect(client.rpc).toHaveBeenCalledWith("is_admin");
  });

  it("the RPC's honest 'is an admin' answer -> true, and ONLY a literal true passes", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: true, error: null }) };
    expect(await checkIsAdmin(client)).toBe(true);
  });

  it("a non-boolean data value never passes as true (fail closed on a weird answer)", async () => {
    for (const weird of [1, "true", {}, [], null, undefined]) {
      const client = { rpc: vi.fn().mockResolvedValue({ data: weird, error: null }) };
      expect(await checkIsAdmin(client)).toBe(false);
    }
  });

  it("an RPC-level error (e.g. permission denied for a signed-out call) -> false, never throws", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "permission denied" } }) };
    await expect(checkIsAdmin(client)).resolves.toBe(false);
  });

  it("a thrown/rejected rpc() call -> false, never throws or rejects", async () => {
    const client = { rpc: vi.fn().mockRejectedValue(new Error("network down")) };
    await expect(checkIsAdmin(client)).resolves.toBe(false);
  });
});
