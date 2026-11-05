/* NEW-1 (2026-10-28) — the team-invite INBOX in the account menu, driven in a REAL browser as a fake
 * signed-in user (the same Supabase-shaped session + page.route() technique as new1-team-plan-count.spec.js;
 * the sandbox cannot do a real sign-in). The two RPCs are stateful stubs, so the spec proves the whole
 * client path: badge → card → Accept/Decline → the exact RPC body → the card leaves → a failure stays on
 * the card in words. A "no invitations" arm is the known-good control (no badge, no section).
 * Needs the build configured with VITE_SUPABASE_URL=https://plnrinvite123456.supabase.co (fake). */
import { test, expect } from "@playwright/test";

const HOST = "plnrinvite123456.supabase.co";
const KEY = `sb-${HOST.split(".")[0]}-auth-token`;
const PAUL = "00000000-0000-0000-0000-00000000a001";
const INVITE = { invite_id: "721f5cdc-8b69-4b51-a283-d5f36a4cce49", team_id: "7ffe217c-73b9-4576-bac7-50e3f2da78f2", team_name: "USEC", role: "admin", invited_by_name: "Chris Seward", created_at: "2026-10-28T18:14:16Z" };

function session() {
  const iso = new Date().toISOString();
  return {
    access_token: "t", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r",
    user: { id: PAUL, aud: "authenticated", role: "authenticated", email: "paul.reinke@hillwood.com", email_confirmed_at: iso, phone: "", confirmed_at: iso,
      last_sign_in_at: iso, app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], created_at: iso, updated_at: iso },
  };
}

async function boot(page, { invites, respond }) {
  const state = { invites: [...invites], answers: [] };
  await page.addInitScript(([k, s]) => { try { localStorage.setItem(k, JSON.stringify(s)); } catch (_) {} }, [KEY, session()]);
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    const req = route.request();
    let u; try { u = new URL(req.url()); } catch (_) { return route.continue(); }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname !== HOST) return route.abort();
    const json = (b, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    const p = u.pathname;
    if (p === "/auth/v1/health") return json({ date: new Date().toISOString() });
    if (p === "/auth/v1/user") return json({ user: session().user });
    if (p.startsWith("/auth/v1/")) return json({});
    if (p === "/rest/v1/rpc/list_my_invites") return json(state.invites);
    if (p === "/rest/v1/rpc/respond_to_invite") {
      const body = JSON.parse(req.postData() || "{}");
      state.answers.push(body);
      const out = respond(body, state);
      return json(out.body, out.status || 200);
    }
    if (p.startsWith("/rest/v1/rpc/")) return json([]);
    if (p.startsWith("/rest/v1/")) return json([]);
    return json({});
  });
  await page.goto("/", { waitUntil: "load" });
  const trigger = page.locator('button[aria-label^="Account:"]:visible').first();
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  return { state, trigger };
}

const accept = (body, state) => {
  state.invites = state.invites.filter((i) => i.invite_id !== body.p_invite);
  return { body: { ok: true, status: body.p_accept ? "accepted" : "declined", team_id: INVITE.team_id, team_name: "USEC" } };
};

test.describe("team-invite inbox in the account menu", () => {
  test("a pending invite shows a count badge and a card with team, inviter and role", async ({ page }) => {
    const { trigger } = await boot(page, { invites: [INVITE], respond: accept });
    const badge = trigger.getByTestId("account-invite-badge");
    await expect(badge).toHaveText("1");
    await expect(trigger).toHaveAttribute("aria-label", /1 team invitation waiting/);
    await trigger.click();
    const card = page.getByTestId("account-invite-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("USEC");
    await expect(card).toContainText("Chris Seward invited you as admin");
    await expect(card.getByTestId("account-invite-accept")).toBeVisible();
    await expect(card.getByTestId("account-invite-decline")).toBeVisible();
    // The card sits ABOVE Profile, inside the viewport.
    const box = await card.boundingBox();
    const vp = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    await page.screenshot({ path: "test-results/team-invite-inbox-menu.png" });
  });

  test("Accept sends exactly that invite id with accept=true, the card leaves and the badge clears", async ({ page }) => {
    const { state, trigger } = await boot(page, { invites: [INVITE], respond: accept });
    let teamsChanged = 0;
    await page.exposeFunction("__teamsChanged", () => { teamsChanged++; });
    await page.evaluate(() => window.addEventListener("planyr:teams-changed", () => window.__teamsChanged()));
    await trigger.click();
    await page.getByTestId("account-invite-accept").click();
    await expect(page.getByTestId("account-invite-card")).toHaveCount(0);
    await expect(page.getByTestId("account-invites")).toContainText("You joined USEC.");
    expect(state.answers).toEqual([{ p_invite: INVITE.invite_id, p_accept: true }]);
    await expect.poll(() => teamsChanged).toBe(1);
    await expect(trigger.getByTestId("account-invite-badge")).toHaveCount(0);
  });

  test("Decline sends accept=false, fires no teams-changed signal, and the card leaves", async ({ page }) => {
    const { state, trigger } = await boot(page, { invites: [INVITE], respond: accept });
    let teamsChanged = 0;
    await page.exposeFunction("__teamsChanged", () => { teamsChanged++; });
    await page.evaluate(() => window.addEventListener("planyr:teams-changed", () => window.__teamsChanged()));
    await trigger.click();
    await page.getByTestId("account-invite-decline").click();
    await expect(page.getByTestId("account-invite-card")).toHaveCount(0);
    expect(state.answers).toEqual([{ p_invite: INVITE.invite_id, p_accept: false }]);
    expect(teamsChanged).toBe(0);
  });

  test("a server failure stays on the card in words, with the buttons live again (LOUD-FAILURE)", async ({ page }) => {
    const { trigger } = await boot(page, { invites: [INVITE], respond: () => ({ status: 500, body: { message: "boom" } }) });
    await trigger.click();
    await page.getByTestId("account-invite-accept").click();
    const card = page.getByTestId("account-invite-card");
    await expect(card.getByRole("alert")).toContainText("boom");
    await expect(card.getByTestId("account-invite-accept")).toBeEnabled();
    await expect(trigger.getByTestId("account-invite-badge")).toHaveText("1"); // still pending
  });

  test("CONTROL — no invitations: no badge, no section, the menu is exactly as before", async ({ page }) => {
    const { trigger } = await boot(page, { invites: [], respond: accept });
    await expect(trigger.getByTestId("account-invite-badge")).toHaveCount(0);
    await trigger.click();
    await expect(page.getByRole("button", { name: "Profile" })).toBeVisible();
    await expect(page.getByTestId("account-invites")).toHaveCount(0);
  });
});
