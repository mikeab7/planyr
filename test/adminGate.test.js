import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AdminGate from "../src/workspaces/admin/AdminGate.jsx";

// B711904 (NEW-1) — AdminGate is the ONLY place that decides whether AdminApp mounts.
// Its access check is async (a Supabase RPC round-trip), which react-dom/server's
// synchronous render never runs — so an SSR snapshot can only ever observe the SAFE
// initial state. That's exactly the property worth locking in: before the check has had
// any chance to resolve, for every input (no user, or a user whose admin-ness is still
// unknown), the gate renders NOTHING. It never optimistically shows admin content.
describe("AdminGate — safe by default before the access check resolves", () => {
  it("signed out (no user): renders null, no admin content leaks into first paint", () => {
    const html = renderToStaticMarkup(createElement(AdminGate, { user: null, onExit: () => {} }));
    expect(html).toBe("");
  });

  it("a signed-in user, check not yet resolved: still renders null (never a flash of admin content)", () => {
    const html = renderToStaticMarkup(createElement(AdminGate, { user: { id: "u1" }, onExit: () => {} }));
    expect(html).toBe("");
  });
});

// Source-guard: the gate's own logic must never call checkIsAdmin for a signed-out visitor
// (no session -> nothing to check, and no reason to hit the network) and must only ever
// mount AdminApp behind the `allowed` state that check controls.
describe("AdminGate — source shape", () => {
  const src = readFileSync(new URL("../src/workspaces/admin/AdminGate.jsx", import.meta.url), "utf8");

  it("skips the RPC entirely when there is no signed-in user", () => {
    expect(src).toMatch(/if \(!userId\) \{ setAllowed\(false\); return; \}/);
  });

  it("only ever renders AdminApp behind the allowed flag", () => {
    expect(src).toMatch(/if \(!allowed\) return null;/);
    expect(src).toMatch(/<AdminApp/);
  });
});
