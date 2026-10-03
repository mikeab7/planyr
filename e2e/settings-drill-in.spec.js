/* NEW-1 — Settings panel: drill-in on a phone, labelled fields, Save only active when something
 * changed. Signed in via a seeded session + a STATEFUL mock of the profiles row (the upsert
 * really changes what the next read returns, so "after save → disabled" is exercised end to end).
 *
 *   VITE_SUPABASE_URL="https://settingsdrill1.supabase.co" VITE_SUPABASE_ANON_KEY="settingsdrill1-dummy-key" \
 *     npx playwright test e2e/settings-drill-in.spec.js
 *
 * SHOTS=1 also writes the PR screenshots to ui-audit/screens/settings-*.png.
 * Known-good arm: the desktop run still shows the side-by-side nav (the existing layout is kept). */
import { test, expect } from "@playwright/test";

const HOST = "settingsdrill1.supabase.co";
const UID = "22222222-2222-2222-2222-222222222222";
const SHOTS = !!process.env.SHOTS;

function session() {
  const now = Math.floor(Date.now() / 1000), iso = new Date().toISOString();
  return {
    access_token: "a.b.c", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "r",
    user: { id: UID, aud: "authenticated", role: "authenticated", email: "mike@planyr.test", email_confirmed_at: iso, phone: "", confirmed_at: iso, last_sign_in_at: iso,
      app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { first_name: "Mike", last_name: "Abbott", org: "Demo Dev Co" }, identities: [], created_at: iso, updated_at: iso },
  };
}

async function mock(page, state) {
  const KEY = `sb-${HOST.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, s]) => { try { localStorage.setItem(k, JSON.stringify(s)); } catch (_) {} }, [KEY, session()]);
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    const req = route.request();
    let u; try { u = new URL(req.url()); } catch (_) { return route.continue(); }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname !== HOST) return route.abort();
    const json = (b, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    const p = u.pathname;
    if (p === "/auth/v1/token") return json(session());
    if (p === "/auth/v1/user") return json(session().user);
    if (p.startsWith("/auth/v1/")) return json({});
    if (p === "/rest/v1/profiles") {
      if (req.method() === "GET") {
        const wantObj = (req.headers()["accept"] || "").includes("pgrst.object");
        return json(wantObj ? state.row : [state.row]);
      }
      if (req.method() === "POST" || req.method() === "PATCH") {
        state.saves++;
        try { state.row = { ...state.row, ...JSON.parse(req.postData() || "{}") }; } catch (_) {}
        return json([state.row], 201);
      }
    }
    if (p.startsWith("/rest/v1/")) return json([]);
    return json({});
  });
}

const row = () => ({ id: UID, first_name: "Mike", last_name: "Abbott", org: "Demo Dev Co", prefs: {} });

async function openSettings(page, rowName) {
  await page.goto("/?app");
  const acct = page.getByRole("button", { name: /^Account: Mike/ });
  await expect(acct).toBeVisible({ timeout: 30_000 });
  await acct.click();
  await page.getByRole("button", { name: rowName, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test.describe("phone width — drill-in", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("menu → Profile page → dirty rules → back guard → save", async ({ page }) => {
    test.setTimeout(90_000);
    const state = { row: row(), saves: 0 };
    await mock(page, state);
    await openSettings(page, "Settings");
    const dlg = page.getByRole("dialog");

    // MENU: no form, four rows, identity, Sign out.
    await expect(dlg.locator('[data-settings-page="menu"]')).toBeVisible();
    await expect(dlg.getByText("Mike Abbott")).toBeVisible();
    for (const n of ["Profile", "Team", "Account & security", "Interface"]) await expect(dlg.locator("[data-settings-section]").filter({ hasText: n })).toBeVisible();
    await expect(dlg.locator("input")).toHaveCount(0);
    await expect(dlg.locator("[data-settings-signout]")).toHaveText("Sign out");
    if (SHOTS) { await page.waitForTimeout(350); await page.screenshot({ path: "ui-audit/screens/settings-menu-390.png" }) }

    // PROFILE PAGE: no menu, labelled inputs, clean Save is disabled.
    await dlg.locator('[data-settings-section="profile"]').click();
    await expect(dlg.locator("[data-settings-section]")).toHaveCount(0);
    await expect(dlg.locator("[data-settings-back]")).toContainText("Settings");
    await expect(dlg.getByText("Signed in as mike@planyr.test")).toBeVisible();
    for (const [name, val] of [["First name", "Mike"], ["Last name", "Abbott"], ["Organization", "Demo Dev Co"]]) {
      await expect(dlg.getByLabel(name, { exact: true })).toHaveValue(val);
    }
    const save = dlg.locator("[data-settings-save]");
    await expect(save).toBeDisabled();
    await expect(save).toHaveText("Save");
    if (SHOTS) { await page.waitForTimeout(350); await page.screenshot({ path: "ui-audit/screens/settings-profile-clean-390.png" }) }

    // edit → enabled; revert → disabled; edit again.
    const org = dlg.getByLabel("Organization", { exact: true });
    await org.fill("Other Co");
    await expect(save).toBeEnabled();
    await expect(save).toHaveText("Save changes");
    if (SHOTS) { await page.waitForTimeout(350); await page.screenshot({ path: "ui-audit/screens/settings-profile-dirty-390.png" }) }
    await org.fill("Demo Dev Co");
    await expect(save).toBeDisabled();
    await org.fill("Other Co");

    // back with unsaved edits → confirm; Keep editing stays; Discard returns to the menu with the value reverted.
    await dlg.locator("[data-settings-back]").click();
    await expect(dlg.getByRole("alertdialog")).toBeVisible();
    await dlg.getByRole("button", { name: "Keep editing" }).click();
    await expect(dlg.getByRole("alertdialog")).toHaveCount(0);
    await expect(org).toHaveValue("Other Co");
    await dlg.locator("[data-settings-back]").click();
    await dlg.locator("[data-settings-discard-confirm]").click();
    await expect(dlg.locator('[data-settings-page="menu"]')).toBeVisible();
    await dlg.locator('[data-settings-section="profile"]').click();
    await expect(dlg.getByLabel("Organization", { exact: true })).toHaveValue("Demo Dev Co");
    await expect(save).toBeDisabled();

    // close with unsaved edits → confirm too.
    await dlg.getByLabel("Organization", { exact: true }).fill("Closing Co");
    await dlg.getByRole("button", { name: "Close" }).click();
    await expect(dlg.getByRole("alertdialog")).toBeVisible();
    await dlg.getByRole("button", { name: "Keep editing" }).click();

    // save → persisted, button returns to disabled, back is free (no prompt).
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => state.saves).toBeGreaterThan(0);
    await expect(save).toBeDisabled();
    await expect(save).toHaveText("Save");
    await dlg.locator("[data-settings-back]").click();
    await expect(dlg.getByRole("alertdialog")).toHaveCount(0);
    await expect(dlg.locator('[data-settings-page="menu"]')).toBeVisible();
  });

  test("the account dropdown's Profile row lands straight on the Profile page", async ({ page }) => {
    await mock(page, { row: row(), saves: 0 });
    await openSettings(page, "Profile");
    await expect(page.getByRole("dialog").locator('[data-settings-page="profile"]')).toBeVisible();
  });
});

test.describe("desktop width — side-by-side kept, shared fixes applied", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("nav beside the form; labels; Save gated; Sign out is not a filled button", async ({ page }) => {
    test.setTimeout(90_000);
    const state = { row: row(), saves: 0 };
    await mock(page, state);
    await openSettings(page, "Profile");
    const dlg = page.getByRole("dialog");
    await expect(dlg.locator(".settings-nav")).toBeVisible();          // known-good arm: the existing layout survives
    await expect(dlg.getByLabel("First name", { exact: true })).toBeVisible();
    const save = dlg.locator("[data-settings-save]");
    await expect(save).toBeDisabled();
    await dlg.getByLabel("Organization", { exact: true }).fill("Other Co");
    await expect(save).toBeEnabled();
    if (SHOTS) { await page.waitForTimeout(350); await page.screenshot({ path: "ui-audit/screens/settings-profile-dirty-desktop.png" }) }
    await dlg.getByLabel("Organization", { exact: true }).fill("Demo Dev Co");
    await expect(save).toBeDisabled();
    const bg = await dlg.locator("[data-settings-signout]").evaluate((b) => getComputedStyle(b).backgroundColor);
    expect(bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    if (SHOTS) {
      await dlg.locator('[data-settings-section="interface"]').click();
      await page.screenshot({ path: "ui-audit/screens/settings-desktop-interface.png" });
    }
  });
});
