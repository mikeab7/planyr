import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccountControl from "../src/app/AccountControl.jsx";

// NEW-1 (B711904 follow-up) — "reach the admin page from the account menu, and only when
// you are the admin." AccountControl's dropdown is a click-opened AnchoredMenu portal
// (`if (!open) return null` before it ever touches `document`), so with the menu closed —
// its state on mount, before any effect has had a chance to run — react-dom/server's
// synchronous render can only ever observe the row NOT existing. That is exactly the
// property this suite locks in for the signed-out and not-yet-checked cases; the
// isAdmin/checkIsAdmin wiring itself is asserted structurally below, and its fail-closed
// behaviour is already covered end to end by test/adminAccess.test.js — this file must
// not re-test that gate, only that AccountControl calls it and calls nothing else.
describe("AccountControl — admin row is absent before anything resolves", () => {
  it("signed out: no dropdown, no admin row, no trace the page exists", () => {
    const html = renderToStaticMarkup(createElement(AccountControl, {
      user: null, profileApi: {}, onOpenAuth: () => {}, onOpenAccount: () => {},
    }));
    expect(html).not.toMatch(/account-admin-row/);
    expect(html).not.toMatch(/>Admin</);
  });

  it("signed in, dropdown closed (mount state, check unresolved): no admin row rendered", () => {
    const html = renderToStaticMarkup(createElement(AccountControl, {
      user: { id: "u1", email: "a@b.com" },
      profileApi: { displayName: "A B", initial: "A" },
      onOpenAuth: () => {}, onOpenAccount: () => {},
    }));
    expect(html).not.toMatch(/account-admin-row/);
    expect(html).not.toMatch(/>Admin</);
  });
});

// Source-guard: renderToStaticMarkup can't exercise the open dropdown (AnchoredMenu portals
// via `createPortal`, which needs a `document` this Node-only suite doesn't have — see
// vitest.config.js), so the gating logic itself is asserted against the real source, the
// same shape test/adminGate.test.js already uses for AdminGate.
describe("AccountControl — admin row source shape", () => {
  const src = readFileSync(new URL("../src/app/AccountControl.jsx", import.meta.url), "utf8");

  it("reuses the EXISTING admin gate — never a second access mechanism", () => {
    expect(src).toMatch(/import \{ checkIsAdmin \} from "\.\.\/workspaces\/admin\/lib\/adminAccess\.js";/);
    expect(src).toMatch(/checkIsAdmin\(supabase\)/);
    // No direct RPC call and no second checker invented in this file.
    expect(src).not.toMatch(/\.rpc\(\s*["']is_admin["']/);
  });

  it("starts closed (false) and only flips on a resolved answer — never renders pending/greyed", () => {
    expect(src).toMatch(/const \[isAdmin, setIsAdmin\] = useState\(false\);/);
    expect(src).toMatch(/if \(!userId\) \{ setIsAdmin\(false\); return; \}/);
    expect(src).toMatch(/checkIsAdmin\(supabase\)\.then\(\(ok\) => \{ if \(live\) setIsAdmin\(ok\); \}\);/);
    // The row is gated on the plain boolean and nothing else — no `? ... : <grey row>` branch.
    expect(src).toMatch(/\{isAdmin && \(/);
  });

  it("the row is a plain navigation to #/admin — a convenience link, not a second gate", () => {
    expect(src).toMatch(/window\.location\.hash = "#\/admin"/);
  });

  it("the admin row only exists inside the signed-in dropdown, after the signed-out returns", () => {
    const signedOutReturn = src.indexOf('if (!user) {');
    const adminRow = src.indexOf('data-testid="account-admin-row"');
    expect(signedOutReturn).toBeGreaterThan(-1);
    expect(adminRow).toBeGreaterThan(signedOutReturn);
  });

  it("does not touch the admin allowlist table or AdminGate — the permission model is unchanged", () => {
    // No direct table read/write and no import of AdminGate — this file only calls the
    // existing checkIsAdmin() wrapper, asserted above.
    expect(src).not.toMatch(/\.from\(\s*["']admin_users["']\s*\)/);
    expect(src).not.toMatch(/import .*AdminGate/);
  });
});
