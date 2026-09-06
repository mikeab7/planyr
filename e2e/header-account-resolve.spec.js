/* B1218496 — the shared header's account control (src/app/AccountControl.jsx) starts every load
 * not knowing whether the visitor is signed in — `user` is `null` until Supabase's auth listener
 * reports back (src/app/Shell.jsx), which always costs at least one paint and, whenever the
 * cached session needs a token refresh, a real network round trip. Before this fix, that null
 * state rendered the SIGNED-OUT "Sign in" pill — often actively wrong for a signed-in visitor —
 * and swapped to the real, usually WIDER, named account pill the moment auth resolved. Row 1's
 * right zone (account control, `flex:"0 0 auto"`) growing squeezes the left zone (the project/
 * plan breadcrumb, `flex:"0 1 auto"`) via plain flexbox — moving a crumb someone may already be
 * pressing (event:click-swallowed, "moved": true).
 *
 * The fix (Shell.jsx's `authKnown` + AccountControl.jsx) holds a neutral placeholder, forced to
 * MenuTrigger's own hard `maxWidth: 220` ceiling from the very first paint, until auth is known —
 * so the eventual real pill (also capped at 220) can only ever shrink the right zone or leave it
 * unchanged, never grow it. This spec uses a deliberately long display name (so the real,
 * resolved pill ALSO clamps to the 220px ceiling) to make the transition PROVABLY zero-width —
 * the strongest case the fix guarantees; a short name can still shrink the zone a little, which
 * only releases pressure on the crumb, never adds it.
 *
 * Drives the real Site Planner map screen (#/site, no project open) fully offline: a fake,
 * ALREADY-EXPIRED session is seeded in localStorage (Supabase-shaped, matching
 * e2e/new1-team-plan-count.spec.js's proven pattern), forcing GoTrueClient's own token-refresh
 * network call before it can decide the visitor is signed in — exactly the "auth is slow to
 * resolve" window this bug lives in. That refresh response is held open by the test itself
 * (a gate the mock awaits before answering) rather than a fixed delay, so the press below is
 * GUARANTEED to land before auth resolves regardless of how long this build takes to boot —
 * a wall-clock delay raced app-boot time in an earlier version of this spec and was flaky.
 *
 *   VITE_SUPABASE_URL="https://clickswallowedfix1.supabase.co" \
 *     VITE_SUPABASE_ANON_KEY="clickswallowedfix1-dummy-key" \
 *     npx playwright test e2e/header-account-resolve.spec.js
 *
 * Red-proofed against the pre-fix source: the project crumb's box shifts once the real,
 * much-wider named pill replaces the (pre-fix) "Sign in" pill mid-refresh.
 */
import { test, expect } from "@playwright/test";

const SUPABASE_HOST = "clickswallowedfix1.supabase.co";

const UID = "11111111-1111-1111-1111-111111111111";
// Deliberately long — see the file header: this makes the RESOLVED pill also hit MenuTrigger's
// 220px ceiling, so the fix's guarantee (shrink-or-same, never grow) reads as an exact match.
const LONG_FIRST = "Alexandra-Christina";
const LONG_LAST = "Montgomery-Fitzgerald";

function expiredSession() {
  const now = Math.floor(Date.now() / 1000);
  const iso = new Date().toISOString();
  return {
    access_token: "expired-access-token", token_type: "bearer", expires_in: 1,
    expires_at: now - 3600, // already expired → forces a real refresh network call, no shortcut
    refresh_token: "test-refresh-token",
    user: {
      id: UID, aud: "authenticated", role: "authenticated", email: "alexandra@example.com",
      email_confirmed_at: iso, phone: "", confirmed_at: iso, last_sign_in_at: iso,
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: { first_name: LONG_FIRST, last_name: LONG_LAST },
      identities: [], created_at: iso, updated_at: iso,
    },
  };
}

function refreshedSession() {
  const now = Math.floor(Date.now() / 1000);
  return { ...expiredSession(), access_token: "fresh-access-token", expires_at: now + 3600 };
}

async function mockSupabase(page, { clickSwallowedReports, refreshGate }) {
  const STORAGE_KEY = `sb-${SUPABASE_HOST.split(".")[0]}-auth-token`;
  await page.addInitScript(([key, session]) => {
    try { window.localStorage.setItem(key, JSON.stringify(session)); } catch (_) {}
  }, [STORAGE_KEY, expiredSession()]);

  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch (_) { return route.continue(); }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname !== SUPABASE_HOST) return route.abort(); // aerial tiles / GIS / fonts — offline, deterministic

    const path = u.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/v1/token") {
      // The forced refresh — exactly the network round trip an expired cached session needs
      // before GoTrueClient can report a real user back to onAuthStateChange. Held open until
      // the test itself releases it (see refreshGate), so the press below is guaranteed to land
      // first regardless of how long this build takes to boot.
      await refreshGate;
      return json(refreshedSession());
    }
    if (path === "/auth/v1/health") return json({ date: new Date().toISOString() });
    if (path === "/auth/v1/user") return json({ user: refreshedSession().user });
    if (path.startsWith("/auth/v1/")) return json({});
    if (path === "/rest/v1/client_errors" && req.method() === "POST") {
      try {
        const body = JSON.parse(req.postData() || "{}");
        if (body && body.source === "event:click-swallowed") clickSwallowedReports.push(body);
      } catch (_) {}
      return json({});
    }
    if (path.startsWith("/rest/v1/")) return json([]); // profiles/sites/etc. — empty is fine, this bug is about the header, not the data
    return json({});
  });
}

test.describe("B1218496 — the header's project crumb doesn't reflow while auth resolves", () => {
  test("the project crumb's box is unchanged across a delayed token refresh", async ({ page }) => {
    test.setTimeout(60_000);
    const clickSwallowedReports = [];
    let releaseRefresh;
    const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
    await page.addInitScript(() => { window.__PLANYR_TELEMETRY_NETWORK = true; });
    await mockSupabase(page, { clickSwallowedReports, refreshGate });
    await page.goto("/#/site", { waitUntil: "load" });

    const crumb = page.getByTestId("project-crumb");
    await expect(crumb).toBeVisible({ timeout: 20_000 });
    // The auth-pending placeholder must still be up at this point — otherwise the refresh
    // already completed before the press below, and a green result would just mean the race
    // never happened (the whole reason the gate above exists).
    await expect(page.getByTestId("account-auth-pending")).toBeVisible({ timeout: 5_000 });

    const boxAtPress = await crumb.boundingBox();
    expect(boxAtPress).toBeTruthy();

    await page.mouse.move(boxAtPress.x + boxAtPress.width / 2, boxAtPress.y + boxAtPress.height / 2);
    await page.mouse.down();
    releaseRefresh(); // let the held-open refresh complete now that the press is in flight
    // Comfortably under clickDiag's 900ms grace window (a longer hold is itself an artificial
    // missed click, independent of any reflow — not what this spec tests).
    await page.waitForTimeout(400);
    const boxAtRelease = await crumb.boundingBox();
    await page.mouse.up();

    // Confirm the account control really did resolve to the long signed-in name during this
    // wait — otherwise a green result would just mean the race never happened.
    await expect(page.getByRole("button", { name: new RegExp(LONG_FIRST) })).toBeVisible({ timeout: 5_000 });

    expect(boxAtRelease).toBeTruthy();
    // Sub-pixel layout rounding (<1px) is real-browser noise, not a reflow; anything wider is the
    // bug this spec is guarding.
    expect(Math.abs(boxAtRelease.x - boxAtPress.x), "the project crumb must not move while auth resolves in the background")
      .toBeLessThan(1);
    expect(Math.abs(boxAtRelease.y - boxAtPress.y)).toBeLessThan(1);
    expect(Math.abs(boxAtRelease.width - boxAtPress.width)).toBeLessThan(1);

    await page.waitForTimeout(200);
    expect(clickSwallowedReports).toEqual([]);
  });
});
