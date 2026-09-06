import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// This suite is about the authKnown/user branch, not the "Supabase not configured at all" branch
// AccountControl checks first — force `configured` so a vitest run with no VITE_SUPABASE_URL set
// exercises the same branch a real, cloud-configured build would (same pattern as
// test/cloudRole.test.js).
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: { auth: {} }, supabaseConfigured: () => true,
}));
const AccountControl = (await import("../src/app/AccountControl.jsx")).default;

// B1218496 — `user` starts null on every load and only resolves once Supabase's auth listener
// reports back, so a signed-in visitor briefly saw the SIGNED-OUT "Sign in" pill before the real,
// usually WIDER, named pill replaced it — growing the header's right zone, which squeezes the
// left zone's breadcrumb via plain flexbox (event:click-swallowed, "moved": true; see
// e2e/header-account-resolve.spec.js for the live behavioral proof). The fix: a distinct
// `authKnown` flag (Shell.jsx) holds a neutral, width-reserved placeholder instead of asserting
// "Sign in" while auth is still resolving.
describe("AccountControl — a neutral placeholder while auth is still resolving, never Sign in", () => {
  it("authKnown:false renders the reserved placeholder, not Sign in, regardless of `user`", () => {
    const html = renderToStaticMarkup(createElement(AccountControl, {
      user: null, authKnown: false, profileApi: {}, onOpenAuth: () => {}, onOpenAccount: () => {},
    }));
    expect(html).toMatch(/data-testid="account-auth-pending"/);
    expect(html).not.toMatch(/data-testid="account-signed-out"/);
    expect(html).not.toMatch(/>Sign in</);
  });

  it("authKnown defaults to true (every existing caller besides Shell.jsx is unaffected)", () => {
    const html = renderToStaticMarkup(createElement(AccountControl, {
      user: null, profileApi: {}, onOpenAuth: () => {}, onOpenAccount: () => {},
    }));
    expect(html).not.toMatch(/data-testid="account-auth-pending"/);
    expect(html).toMatch(/data-testid="account-signed-out"/);
  });

  it("authKnown:true with a real user renders the ordinary signed-in pill, not the placeholder", () => {
    const html = renderToStaticMarkup(createElement(AccountControl, {
      user: { id: "u1", email: "a@b.com" }, authKnown: true,
      profileApi: { displayName: "A B", initial: "A" },
      onOpenAuth: () => {}, onOpenAccount: () => {},
    }));
    expect(html).not.toMatch(/data-testid="account-auth-pending"/);
    expect(html).toMatch(/Signed in as/);
  });
});

// Source-guard: the placeholder's width-reservation trick (forcing MenuTrigger's own 220px
// ceiling from the first paint, so the eventual real pill — also capped at 220 — can only ever
// shrink the zone, never grow it) can't be measured without a live layout; assert its shape here.
describe("AccountControl — auth-pending placeholder source shape", () => {
  const src = readFileSync(new URL("../src/app/AccountControl.jsx", import.meta.url), "utf8");

  it("checks authKnown BEFORE the !user branch, so a resolving session never asserts Sign in", () => {
    const pendingIdx = src.indexOf("if (!authKnown)");
    const signedOutIdx = src.indexOf("if (!user)");
    expect(pendingIdx).toBeGreaterThan(-1);
    expect(signedOutIdx).toBeGreaterThan(-1);
    expect(pendingIdx).toBeLessThan(signedOutIdx);
  });

  it("reserves a width comfortably past MenuTrigger's hard 220px cap", () => {
    const menuTriggerSrc = readFileSync(new URL("../src/shared/ui/controls.jsx", import.meta.url), "utf8");
    expect(menuTriggerSrc).toMatch(/maxWidth:\s*220/);
    const m = src.match(/if \(!authKnown\) \{[\s\S]*?width:\s*(\d+)/);
    expect(m, "auth-pending placeholder bar must declare an explicit width").toBeTruthy();
    expect(Number(m[1])).toBeGreaterThan(220);
  });
});
