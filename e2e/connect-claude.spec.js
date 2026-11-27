/* "Connect to Claude" in the REAL built app (2026-11-27): the Allow page and Settings → AI assistants, driven end to
 * end against a mocked Supabase (the database half is proven on the real SQL in test/mcpOauthSql.test.js).
 * Needs a build with dummy config baked in, as the auth specs do:
 *   VITE_SUPABASE_URL=https://authagent1.supabase.co VITE_SUPABASE_ANON_KEY=authagent1-dummy npm run build
 *   npx vite preview --port 4173 &  BASE_URL=http://localhost:4173 npx playwright test e2e/connect-claude.spec.js
 * SHOTS=<dir> writes the screenshots shown to the owner.
 * Arms: C1 Allow sends the browser back to the ONE redirect with code+state+iss · C2 Cancel sends access_denied ·
 * C3 an answered / expired / unknown request is a dead end with words, no buttons that act · C4 signed out: sign in
 * first, the request survives · C5 Settings lists a connection and Disconnect removes it · C6 a loopback assistant
 * carries the "your own computer" warning · C7 "Sign out on all devices" signs out even when disconnecting assistants
 * fails, and says so · C8 "Not you?" signs out and keeps the request · P1 phone width, both themes. */
import { test, expect } from "@playwright/test";
import { asHumanBrowser } from "./lib/humanBrowser.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://authagent1.supabase.co";
const HOST = new URL(SUPABASE_URL).hostname;
const KEY = `sb-${HOST.split(".")[0]}-auth-token`;
const UID = "33333333-3333-4333-8333-333333333333";
const RID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SHOTS = process.env.SHOTS || "";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

function session() {
  const now = Math.floor(Date.now() / 1000), iso = new Date().toISOString();
  return {
    access_token: "a.b.c", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "r",
    user: { id: UID, aud: "authenticated", role: "authenticated", email: "dana@example.com", email_confirmed_at: iso, confirmed_at: iso, last_sign_in_at: iso,
      app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { first_name: "Dana" }, identities: [], created_at: iso, updated_at: iso },
  };
}

/* state: { info, decide, grants, signedIn } — every rpc call is recorded in state.rpc. */
async function mock(page, state) {
  await asHumanBrowser(page);
  if (state.signedIn !== false) await page.addInitScript(([k, s]) => { try { localStorage.setItem(k, JSON.stringify(s)); } catch (_) {} }, [KEY, session()]);
  state.rpc = [];
  state.left = null;
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    const req = route.request();
    let u; try { u = new URL(req.url()); } catch (_) { return route.continue(); }
    if (u.hostname === "localhost" && u.port === "9") { state.left = req.url(); return route.fulfill({ status: 200, contentType: "text/plain", body: "assistant callback" }); }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname === "claude.ai") { state.left = req.url(); return route.fulfill({ status: 200, contentType: "text/plain", body: "claude callback" }); }
    if (u.hostname !== HOST) return route.abort();
    const json = (b, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    const p = u.pathname;
    if (p === "/auth/v1/token") return json(session());
    if (p === "/auth/v1/user") return json(session().user);
    if (p === "/auth/v1/logout") { state.logout = (state.logout || []).concat(u.searchParams.get("scope") || ""); return route.fulfill({ status: 204, body: "" }); }
    if (p.startsWith("/auth/v1/")) return json({});
    if (p.startsWith("/rest/v1/rpc/mcp_oauth_")) {
      const fn = p.slice("/rest/v1/rpc/".length);
      const body = (() => { try { return JSON.parse(req.postData() || "{}"); } catch (_) { return {}; } })();
      state.rpc.push({ fn, body, method: req.method(), auth: req.headers()["authorization"] || "" });
      if (fn === "mcp_oauth_request_info") return json(state.info);
      if (fn === "mcp_oauth_decide") return json(body.p_allow ? state.decide : { ok: true, redirect_uri: state.info.redirect_uri || CALLBACK, state: "st-1", error: "access_denied" });
      if (fn === "mcp_oauth_my_grants") return json(state.grants);
      if (fn === "mcp_oauth_revoke_my_grant") { state.grants = state.grants.filter((g) => g.id !== body.p_id); return json(true); }
      if (fn === "mcp_oauth_revoke_all_my_grants") return state.revokeAllFails ? json({ message: "function public.mcp_oauth_revoke_all_my_grants() does not exist" }, 404) : json(state.grants.length);
      return json(null);
    }
    if (p.startsWith("/rest/v1/")) return json([]);
    return json({});
  });
}

const readyInfo = (o = {}) => ({ ok: true, client_name: "Claude", redirect_host: "claude.ai", scope: "planyr.read", ...o });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const allowPage = (page) => page.getByTestId("connect-landing");

test.describe("the Allow page", () => {
  test("C1 Allow: one POST with the session, then back to the registered redirect with code, state and issuer", async ({ page }) => {
    test.setTimeout(90_000);
    const state = { info: readyInfo(), decide: { ok: true, redirect_uri: CALLBACK, state: "st-1", code: "pmcp_code_abc" }, grants: [] };
    await mock(page, state);
    await page.goto(`/?app#/connect/${RID}`);
    await expect(page.getByTestId("connect-title")).toHaveText("Connect Claude to Planyr?", { timeout: 30_000 });
    await expect(page.getByTestId("connect-email")).toHaveText("dana@example.com");
    await expect(page.getByTestId("connect-host")).toContainText("gave itself");
    await expect(page.getByTestId("connect-host")).toContainText("claude.ai");
    await expect(page.getByTestId("connect-can").locator("li")).toHaveCount(5);
    await expect(page.getByTestId("connect-cannot")).toContainText("Change, add, share or delete anything");
    await expect(page.getByTestId("connect-loopback")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`#/connect/${RID}$`));           // the route was not rewritten away
    await shot(page, "connect-allow-desktop");
    expect(state.rpc.filter((r) => r.fn === "mcp_oauth_decide")).toHaveLength(0); // nothing is decided by opening the page
    const issuer = new URL(page.url()).origin;                                // read BEFORE Allow: the page then leaves for the callback
    await page.getByTestId("connect-allow").click();
    await expect.poll(() => state.left).not.toBeNull();
    const back = new URL(state.left);
    expect(back.origin + back.pathname).toBe(CALLBACK);
    expect(Object.fromEntries(back.searchParams)).toEqual({ code: "pmcp_code_abc", state: "st-1", iss: issuer });
    const d = state.rpc.filter((r) => r.fn === "mcp_oauth_decide");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ method: "POST", body: { p_id: RID, p_allow: true }, auth: "Bearer a.b.c" });
  });

  test("C2 Cancel sends access_denied back, and grants nothing", async ({ page }) => {
    test.setTimeout(90_000);
    const state = { info: readyInfo(), decide: null, grants: [] };
    await mock(page, state);
    await page.goto(`/?app#/connect/${RID}`);
    await page.getByTestId("connect-cancel").click({ timeout: 30_000 });
    await expect.poll(() => state.left).not.toBeNull();
    expect(new URL(state.left).searchParams.get("error")).toBe("access_denied");
    expect(new URL(state.left).searchParams.get("code")).toBeNull();
    expect(state.rpc.find((r) => r.fn === "mcp_oauth_decide").body).toEqual({ p_id: RID, p_allow: false });
  });

  for (const reason of ["used", "expired", "missing"]) {
    test(`C3 a request that is ${reason} is a dead end with words`, async ({ page }) => {
      test.setTimeout(90_000);
      const state = { info: { ok: false, reason }, grants: [] };
      await mock(page, state);
      await page.goto(`/?app#/connect/${RID}`);
      await expect(page.getByTestId(`connect-stop-${reason}`)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("connect-allow")).toHaveCount(0);
      await allowPage(page).getByRole("button", { name: "Close" }).click();
      await expect(allowPage(page)).toHaveCount(0);
      expect(state.rpc.filter((r) => r.fn === "mcp_oauth_decide")).toHaveLength(0);
    });
  }

  test("C4 signed out: sign in first; the request id is kept on this device for another tab", async ({ page }) => {
    test.setTimeout(90_000);
    const state = { info: readyInfo(), grants: [], signedIn: false };
    await mock(page, state);
    await page.goto(`/?app#/connect/${RID}`);
    await expect(page.getByTestId("connect-signed-out")).toBeVisible({ timeout: 30_000 });
    expect(state.rpc).toHaveLength(0);                                       // nothing is asked of the server signed out
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("planyr:auth:pendingConnect") || "null"));
    expect(kept && kept.id).toBe(RID);
    await shot(page, "connect-signed-out");
    await page.getByTestId("connect-signin").click();
    await expect(page.getByTestId("connect-landing")).toHaveCount(0);        // the sign-in panel takes its place…
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");                                     // …and closing it brings the Allow page back
    await expect(page.getByTestId("connect-signed-out")).toBeVisible();
  });

  test("C8 Not you? signs out here and keeps the request for the right person", async ({ page }) => {
    test.setTimeout(90_000);
    const state = { info: readyInfo(), decide: null, grants: [] };
    await mock(page, state);
    await page.goto(`/?app#/connect/${RID}`);
    await expect(page.getByTestId("connect-email")).toHaveText("dana@example.com", { timeout: 30_000 });
    await page.getByTestId("connect-not-you").click();
    await expect(page.getByTestId("connect-signed-out")).toBeVisible();
    await expect.poll(() => (state.logout || []).length).toBe(1);
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("planyr:auth:pendingConnect") || "null"));
    expect(kept && kept.id).toBe(RID);
    expect(state.rpc.filter((r) => r.fn === "mcp_oauth_decide")).toHaveLength(0);   // nothing was answered
  });

  test("C6 an assistant on the person's own computer carries a warning", async ({ page }) => {
    test.setTimeout(90_000);
    const state = { info: readyInfo({ client_name: "Claude Code", redirect_host: "localhost", redirect_uri: "http://localhost:9/cb" }), decide: { ok: true, redirect_uri: "http://localhost:9/cb", state: "s", code: "pmcp_code_l" }, grants: [] };
    await mock(page, state);
    await page.goto(`/?app#/connect/${RID}`);
    await expect(page.getByTestId("connect-loopback")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("connect-allow").click();
    await expect.poll(() => state.left).toMatch(/^http:\/\/localhost:9\/cb\?code=pmcp_code_l/);
  });
});

test.describe("Settings → AI assistants", () => {
  test("C5 address, steps, a connection with its host, and Disconnect", async ({ page }) => {
    test.setTimeout(90_000);
    const now = Date.now();
    const state = { info: readyInfo(), grants: [{ id: "g-1", client_name: "Claude", redirect_host: "claude.ai", scope: "planyr.read", created_at: new Date(now - 3600_000).toISOString(), last_used_at: new Date(now - 5 * 60_000).toISOString() }] };
    await mock(page, state);
    await page.goto("/?app");
    const acct = page.getByRole("button", { name: /^Account:/ });
    await expect(acct).toBeVisible({ timeout: 30_000 });
    await acct.click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: /AI assistants/ }).click();
    await expect(dlg.getByTestId("assistants-url")).toHaveText(/\/api\/mcp$/);
    await expect(dlg.getByTestId("assistants-steps")).toContainText("Add custom connector");
    const row = dlg.getByTestId("assistant-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Claude");
    await expect(row).toContainText("used a few minutes ago");
    await expect(row).toContainText("sends you back to claude.ai");
    await shot(page, "settings-assistants");
    await row.getByTestId("assistant-disconnect").click();
    await expect(dlg.getByTestId("assistants-notice")).toContainText("is disconnected");
    await expect(dlg.getByTestId("assistants-empty")).toBeVisible();
    expect(state.rpc.find((r) => r.fn === "mcp_oauth_revoke_my_grant")).toMatchObject({ method: "POST", body: { p_id: "g-1" } });
    await shot(page, "settings-assistants-empty");
  });
});

test.describe("Sign out on all devices", () => {
  for (const fails of [false, true]) {
    test(`C7 signs out everywhere${fails ? " even when disconnecting assistants fails, and says so" : " and disconnects assistants"}`, async ({ page }) => {
      test.setTimeout(90_000);
      const state = { info: readyInfo(), grants: [], revokeAllFails: fails };
      await mock(page, state);
      await page.goto("/?app");
      const acct = page.getByRole("button", { name: /^Account:/ });
      await expect(acct).toBeVisible({ timeout: 30_000 });
      await acct.click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const dlg = page.getByRole("dialog");
      await dlg.getByRole("button", { name: /Account & security/ }).click();
      await dlg.getByTestId("sign-out-everywhere").click();
      await expect.poll(() => state.logout || []).toEqual(["global"]);   // the sign-out itself is never skipped
      expect(state.rpc.filter((r) => r.fn === "mcp_oauth_revoke_all_my_grants")).toHaveLength(1);
      await expect(page.getByRole("button", { name: /^Account:/ })).toHaveCount(0);
      if (fails) {
        await expect(page.getByTestId("auth-msg")).toContainText("couldn't disconnect your AI assistants");
        await expect(page.getByTestId("auth-msg")).toContainText("signed out on all devices");
      } else {
        await expect(page.getByTestId("auth-msg")).toHaveCount(0);
      }
    });
  }
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const theme of ["light", "dark"]) {
    test(`P1 the Allow page fits and stays readable (${theme})`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme });
      const state = { info: readyInfo(), decide: null, grants: [] };
      await mock(page, state);
      await page.goto(`/?app#/connect/${RID}`);
      await expect(page.getByTestId("connect-allow")).toBeVisible({ timeout: 30_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const box = await page.getByTestId("connect-allow").boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      await shot(page, `connect-allow-phone-${theme}`);
    });
  }
});
