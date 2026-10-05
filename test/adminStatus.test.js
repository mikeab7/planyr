import { describe, it, expect, vi } from "vitest";
import { createAdminStatusStore } from "../src/workspaces/admin/lib/adminStatus.js";
import { checkAdminStatus, checkIsAdmin } from "../src/workspaces/admin/lib/adminAccess.js";

// NEW-2 — is_admin() is asked ONCE per signed-in user, never leaks across an account switch in
// either direction, and an ERROR is retried (never remembered as a "no").
const seq = (...answers) => { const f = vi.fn(); answers.forEach((a) => f.mockResolvedValueOnce(a)); return f; };

describe("admin status store", () => {
  it("asks once per user: repeat and concurrent asks share one RPC", async () => {
    const check = seq("admin");
    const s = createAdminStatusStore(check);
    const [a, b] = await Promise.all([s.get({}, "u1"), s.get({}, "u1")]);
    expect([a, b]).toEqual(["admin", "admin"]);
    expect(await s.get({}, "u1")).toBe("admin");
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("admin → sign out → non-admin: the row/page never survives the switch", async () => {
    const s = createAdminStatusStore(seq("admin", "not-admin"));
    expect(await s.get({}, "admin-user")).toBe("admin");
    expect(s.peek("admin-user")).toBe("admin");
    expect(s.peek("other-user")).toBe("unknown");          // another id never reads the admin's answer
    expect(await s.get({}, null)).toBe("not-admin");         // sign-out
    expect(s.peek("admin-user")).toBe("unknown");
    expect(await s.get({}, "plain-user")).toBe("not-admin");
    expect(s.peek("plain-user")).toBe("not-admin");
  });

  it("non-admin → sign out → admin: an earlier 'no' never hides the admin", async () => {
    const s = createAdminStatusStore(seq("not-admin", "admin"));
    expect(await s.get({}, "plain-user")).toBe("not-admin");
    await s.get({}, null);
    expect(await s.get({}, "admin-user")).toBe("admin");
  });

  it("switching user WITHOUT a sign-out in between still re-asks", async () => {
    const check = seq("admin", "not-admin");
    const s = createAdminStatusStore(check);
    await s.get({}, "a");
    expect(await s.get({}, "b")).toBe("not-admin");
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("an in-flight answer for the previous account is dropped after a switch", async () => {
    let resolveA;
    const check = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveA = r; }))
      .mockResolvedValueOnce("not-admin");
    const s = createAdminStatusStore(check);
    const pa = s.get({}, "a");
    expect(await s.get({}, "b")).toBe("not-admin");
    resolveA("admin");
    expect(await pa).toBe("not-admin");           // never reports admin for a user who is gone
    expect(s.peek("b")).toBe("not-admin");
  });

  it("an ERROR is not remembered: hidden now (fail closed), retried on the next ask", async () => {
    const check = seq("error", "admin");
    const s = createAdminStatusStore(check);
    expect(await s.get({}, "u1")).toBe("error");
    expect(s.peek("u1")).toBe("error");
    expect(await s.get({}, "u1")).toBe("admin");   // next ask (menu open / retry) recovers
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("a definite 'not-admin' is NOT re-asked on every menu open", async () => {
    const check = seq("not-admin");
    const s = createAdminStatusStore(check);
    await s.get({}, "u1"); await s.get({}, "u1");
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe("checkAdminStatus — error is distinct from no, and still fails closed", () => {
  it("true → admin; false/odd → not-admin; error/throw → error", async () => {
    expect(await checkAdminStatus({ rpc: async () => ({ data: true, error: null }) })).toBe("admin");
    for (const d of [false, null, "true", 1]) expect(await checkAdminStatus({ rpc: async () => ({ data: d, error: null }) })).toBe("not-admin");
    expect(await checkAdminStatus({ rpc: async () => ({ data: null, error: { message: "x" } }) })).toBe("error");
    expect(await checkAdminStatus({ rpc: async () => { throw new Error("net"); } })).toBe("error");
    expect(await checkAdminStatus(null)).toBe("not-admin");
  });
  it("checkIsAdmin stays a strict boolean", async () => {
    expect(await checkIsAdmin({ rpc: async () => ({ data: null, error: { message: "x" } }) })).toBe(false);
  });
});
