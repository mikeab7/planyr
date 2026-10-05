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

  it("asks through the shared per-user store (useIsAdmin) — no RPC of its own", () => {
    expect(src).toMatch(/useIsAdmin\(user\)/);
    expect(src).not.toMatch(/\.rpc\(/);
  });

  it("only ever renders AdminApp behind a confirmed isAdmin", () => {
    expect(src).toMatch(/if \(!isAdmin\) return null;/);
    expect(src).toMatch(/<AdminApp/);
  });

  it("retries an ERRORED check a bounded number of times, never a definite 'not-admin'", () => {
    expect(src).toMatch(/status !== "error"/);
    expect(src).toMatch(/RETRY_DELAYS_MS/);
  });

  it("reports whether the page is really shown, and always resets on unmount (Shell keeps no workspace 'active' only while it shows)", () => {
    expect(src).toMatch(/onShownChange\(isAdmin\)/);
    expect(src).toMatch(/return \(\) => onShownChange\(false\)/);
    const shell = readFileSync(new URL("../src/app/Shell.jsx", import.meta.url), "utf8");
    expect(shell).toMatch(/isDashboardHash \|\| \(isAdminHash && adminShown\) \? null : routedModule/);
    // keyed on "shown", never on the hash alone — a non-admin typing #/admin keeps the ordinary workspace
    expect(shell).not.toMatch(/isDashboardHash \|\| isAdminHash \? null/);
  });
});
