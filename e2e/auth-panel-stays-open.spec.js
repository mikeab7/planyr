/* NEW-1 (2026-11-08) — the sign-in panel closes only when the PERSON asks.
 *
 * Owner, desktop Chrome + 1Password, signed out: "the sign-in prompt seemed to disappear ... randomly ... as I was
 * working through the prompts." Drives the REAL built app with Supabase + Turnstile mocked (e2e/lib/authMock.js), so
 * it needs a build with dummy config baked in:
 *
 *   VITE_SUPABASE_URL="https://authcaptcha1.supabase.co" VITE_SUPABASE_ANON_KEY="authcaptcha1-dummy" \
 *   VITE_TURNSTILE_SITE_KEY="1x00000000000000000000AA" npx playwright test e2e/auth-panel-stays-open.spec.js
 *
 * Runs in the chromium project AND, with PW_WEBKIT_PHONE=1, in mobile WebKit at iPhone size (webkit-phone project).
 * Each numbered case is one close path of the brief. Cases 2 3 4 5 6 were RED on main e282104 before the fix; case 1
 * (idle for over a minute) and 7 8 (the close paths that must still work) are the controls that were green.
 * What this cannot prove (a real password manager's menu, a real Cloudflare challenge) is a V-entry, not claimed here. */
import { test, expect } from "@playwright/test";
import { mockAuth, dlg, HOST, SITE_KEY } from "./lib/authMock.js";

const open = async (page) => {
  await mockAuth(page);
  await page.goto("/?app&auth=signin");
  await expect(dlg(page)).toBeVisible();
  return dlg(page);
};
const email = (page) => dlg(page).getByLabel("Email");

test.describe("sign-in panel stays open until the person closes it (NEW-1)", () => {
  test.skip(!HOST || !SITE_KEY, "needs VITE_SUPABASE_URL + VITE_TURNSTILE_SITE_KEY baked into the build (see the header)");

  test("1. open, signed out, no input for over a minute: still open, same page (no reload), typed email intact", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    await email(page).fill("idle@example.com");
    await page.evaluate(() => { window.__sameDoc = "yes"; });
    await page.waitForTimeout(65_000);
    await expect(dlg(page)).toBeVisible();
    expect(await page.evaluate(() => window.__sameDoc)).toBe("yes");
    await expect(email(page)).toHaveValue("idle@example.com");
  });

  test("2. Escape that a password manager / autofill menu already took does not close the panel", async ({ page }) => {
    await page.addInitScript(() => {
      // Stands in for 1Password's inline menu: a document-level capture listener that is installed before the page's
      // own, and that marks the Escape as handled (the menu closes) while the menu is up.
      window.__mgrMenuOpen = false;
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && window.__mgrMenuOpen) e.preventDefault(); }, true);
    });
    await open(page);
    await email(page).focus();
    await page.evaluate(() => { window.__mgrMenuOpen = true; });
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toBeVisible();
    // The menu is gone now: the next Escape is the person's own and closes the panel.
    await page.evaluate(() => { window.__mgrMenuOpen = false; });
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
  });

  test("3. Escape inside an open dropdown (aria-expanded) only closes the dropdown", async ({ page }) => {
    await open(page);
    await email(page).focus();
    await page.evaluate(() => { document.querySelector('input[aria-label="Email"]').setAttribute("aria-expanded", "true"); });
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toBeVisible();
    await page.evaluate(() => { document.querySelector('input[aria-label="Email"]').setAttribute("aria-expanded", "false"); });
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
  });

  test("4. Escape while focus is OUTSIDE the panel (the browser's own UI, another frame) does not close it", async ({ page }) => {
    await open(page);
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toBeVisible();
    // ...and with focus back inside, Escape is the person's and closes it.
    await email(page).focus();
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
  });

  test("5. selecting text in a field and letting go OUTSIDE the card does not close the panel", async ({ page }) => {
    test.skip(test.info().project.name === "webkit-phone", "mouse drag-select is a desktop gesture; the phone case is the synthetic click below");
    await open(page);
    await email(page).fill("selectme@example.com");
    const box = await email(page).boundingBox();
    const card = await dlg(page).boundingBox();
    await page.mouse.move(box.x + box.width - 6, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(card.x + card.width + 40, card.y + 10, { steps: 6 });   // released on the dark backdrop
    await page.mouse.up();
    await expect(dlg(page)).toBeVisible();
    await expect(email(page)).toHaveValue("selectme@example.com");
  });

  test("6. a click that arrives on the backdrop with no press behind it (an injected / synthetic click) does not close the panel", async ({ page }) => {
    await open(page);
    await page.evaluate(() => { document.querySelector("[data-auth-backdrop]").click(); });
    await expect(dlg(page)).toBeVisible();
  });

  test("7. press AND release on the backdrop still closes it", async ({ page }) => {
    await open(page);
    const vp = page.viewportSize();
    await page.mouse.click(4, vp.height - 4);
    await expect(dlg(page)).toHaveCount(0);
  });

  test("8. the Close button still closes it", async ({ page }) => {
    await open(page);
    await dlg(page).getByRole("button", { name: "Close" }).click();
    await expect(dlg(page)).toHaveCount(0);
  });

  test("9. a forced page reload (stale-build chunk rescue) brings the panel back with the typed email — never the password", async ({ page }) => {
    await open(page);
    await email(page).fill("keepme@example.com");
    await dlg(page).getByLabel("Password").fill("do-not-keep-this");
    await page.evaluate(() => { window.__sameDoc = "yes"; window.dispatchEvent(new Event("vite:preloadError")); });   // the rescue: location.replace(?_r=…)
    await page.waitForFunction(() => !window.__sameDoc && document.readyState === "complete", null, { timeout: 15_000 });
    await expect(dlg(page)).toBeVisible();
    await expect(email(page)).toHaveValue("keepme@example.com");
    await expect(dlg(page).getByLabel("Password")).toHaveValue("");
    expect(await page.evaluate(() => JSON.stringify(sessionStorage) + JSON.stringify(localStorage))).not.toContain("do-not-keep-this");
  });

  test("10. closing it on purpose forgets the draft: a reload afterwards does not reopen it", async ({ page }) => {
    await open(page);
    await email(page).fill("gone@example.com");
    await dlg(page).getByRole("button", { name: "Close" }).click();
    await expect(dlg(page)).toHaveCount(0);
    await page.reload();
    await page.waitForLoadState("load");
    await expect(page.locator("body")).toBeVisible();
    await page.waitForTimeout(800);
    await expect(dlg(page)).toHaveCount(0);
  });
});
