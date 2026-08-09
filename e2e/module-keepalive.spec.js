/* Keep-alive module switching + resume-last-route (owner request, 2026-07-05) — logged-out
 * coverage. Proves: (1) a visited workspace STAYS MOUNTED (hidden) when you switch away,
 * so switching back doesn't rebuild from nothing; (2) an empty-hash boot reopens the last
 * module ("open where I left off") while an explicit deep link still wins; (3) the
 * fullscreen keyboard shortcut belongs to the VISIBLE module only — a hidden workspace's
 * header must not react; (4) the Schedule iframe survives a switch (no Gantt re-boot).
 * The signed-in halves (open drawing survives a switch, no cloud re-pull) are V-items. */
import { test, expect } from "@playwright/test";
import { openModule, moduleTab, expectOnScreen } from "./helpers.js";

test.describe("keep-alive module switching (logged out)", () => {
  test("a visited workspace stays mounted (hidden) after switching away", async ({ page }) => {
    await page.goto("/");
    await openModule(page, "library");
    await expect(page.getByTestId("library-root")).toBeVisible();
    await openModule(page, "site-planner");
    // The Library did NOT unmount on switch — it's still in the DOM, just hidden.
    await expect(page.getByTestId("library-root")).toBeAttached();
    await expect(page.getByTestId("library-root")).not.toBeVisible();
    // And returning shows the SAME mounted tree (no loader flash — assert it's instantly visible).
    await openModule(page, "library");
    await expect(page.getByTestId("library-root")).toBeVisible();
  });

  test("the Schedule iframe survives a switch away and back", async ({ page }) => {
    await page.goto("/");
    await openModule(page, "scheduler");
    const iframe = page.locator('iframe[src*="/sequence/"]');
    await expect(iframe).toBeAttached({ timeout: 20_000 });
    await openModule(page, "site-planner");
    // Keep-alive: the heavy Gantt iframe is still there, hidden — not torn down.
    await expect(iframe).toBeAttached();
    await openModule(page, "scheduler");
    await expect(iframe).toBeVisible();
  });

  /* B1179 / B266082 rewrote this case once already, for a stale step. B1173(×2) rewrites it
   * again, for a changed PRODUCT DECISION rather than a stale one — and the difference is worth
   * recording, because the assertions that go are the ones that were right about the old design.
   *
   * B1156 made `f` a real browser fullscreen AND hid the header, so this case proved the chrome
   * genuinely left the screen (`expectOffScreen` on a module tab) and came back. The owner's second
   * report overruled the hiding: "I should still have the two headers at the top when I go into
   * full screen." So the chrome must NOT leave the screen, and the two `expectOffScreen` steps are
   * inverted rather than deleted — the position assertion is exactly as strict, it just asserts the
   * opposite fact. NOTHING ELSE IS RELAXED, and the case's real subject is unchanged: does a HIDDEN
   * module's header react to a global key? */
  test("global keys act on the visible module only (hidden headers ignore 'f') — native fullscreen", async ({ page }) => {
    await page.goto("/");
    await openModule(page, "doc-review");   // Review now mounted
    await openModule(page, "site-planner"); // visible: Site; hidden: Review

    // 'f' toggles fullscreen in the ACTIVE (Site) header…
    await page.keyboard.press("f");
    expect(await page.evaluate(() => !!document.fullscreenElement), "'f' should enter REAL browser fullscreen (B1156)").toBe(true);
    // …exactly ONE header claims the mode — the visible one. (Two claiming it is the "two stacked"
    // defect the #869 harness exists to catch, and it is invisible now that nothing floats.)
    await expect(page.locator('header[data-fullscreen="on"]')).toHaveCount(1);
    // …AND BOTH ROWS STAY PUT. This is B1173(×2): the tabs are still on screen, so a plan or a
    // workspace can be switched without leaving fullscreen first.
    // BOTH rows, asserted by a control from each: the workspace tabs (row 2) and the fullscreen
    // toggle (row 1). The breadcrumb's plan crumb is deliberately NOT used here — this spec never
    // opens a plan, so it does not exist, and asserting it would be testing the fixture.
    await expectOnScreen(page, moduleTab(page, "site-planner"), "the Site tab (row 2) IN fullscreen");
    await expectOnScreen(page, page.getByTestId("toggle-fullscreen").filter({ visible: true }), "the row-1 controls IN fullscreen");
    // …and the one exit control reports the mode it is in.
    await expect(page.getByTestId("toggle-fullscreen").filter({ visible: true })).toHaveAttribute("aria-pressed", "true");

    // Leave the way the browser's own UI would. Esc belongs to the BROWSER in native mode and
    // there is no browser UI here, so the API is the honest stand-in (the same call every
    // ui-audit fullscreen harness makes).
    await page.evaluate(() => document.exitFullscreen());
    await expect(page.locator('header[data-fullscreen="on"]')).toHaveCount(0);
    await expectOnScreen(page, moduleTab(page, "site-planner"), "the Site tab after leaving fullscreen");

    // THE ACTUAL SUBJECT: the hidden Review header must not have reacted to the global key.
    await openModule(page, "doc-review");
    await expectOnScreen(page, moduleTab(page, "doc-review"), "the Review tab");
    await expect(page.locator('header[data-fullscreen="on"]')).toHaveCount(0);
  });

  /* The branch that used to be the chrome-hide FALLBACK. B1173(×2) retired the fallback — with the
   * header staying put there was nothing left for it to do, so it would have been a keypress that
   * visibly changed nothing. The obligation it encoded (never a silent no-op — LOUD-FAILURE) is
   * unchanged and is now met by a notice, so this case is re-aimed at that rather than deleted. */
  test("a REFUSED fullscreen request says so, and leaves the chrome alone", async ({ page }) => {
    await page.addInitScript(() => {
      // Refuse every fullscreen request, exactly as a permissions policy would.
      const refuse = () => Promise.reject(new Error("fullscreen-refused-by-test"));
      Object.defineProperty(Element.prototype, "requestFullscreen", { value: refuse, configurable: true });
      if ("webkitRequestFullscreen" in Element.prototype) {
        Object.defineProperty(Element.prototype, "webkitRequestFullscreen", { value: refuse, configurable: true });
      }
    });
    await page.goto("/");
    await openModule(page, "site-planner");

    await page.keyboard.press("f");
    await expect(page.getByTestId("fullscreen-refused")).toBeVisible();
    expect(await page.evaluate(() => !!document.fullscreenElement), "the request was refused, so the browser must NOT be in fullscreen").toBe(false);
    // No header may claim a mode the document is not in, and nothing moved.
    await expect(page.locator('header[data-fullscreen="on"]')).toHaveCount(0);
    await expectOnScreen(page, moduleTab(page, "site-planner"), "the Site tab after a refused request");
  });

  test("stray keys with hidden workspaces mounted don't crash anything", async ({ page }) => {
    await page.goto("/");
    await openModule(page, "doc-review");
    await openModule(page, "library");
    await openModule(page, "site-planner"); // two hidden workspaces now mounted
    for (const key of ["Delete", "Backspace", "Escape", "Enter", "ArrowRight", " "]) {
      await page.keyboard.press(key);
    }
    await expect(moduleTab(page, "site-planner")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("library-root")).toBeAttached(); // still alive, still hidden
  });
});

test.describe("open the app where you left off (logged out)", () => {
  test("an empty-hash boot reopens the last module", async ({ page }) => {
    await page.goto("/#/library");
    await expect(page.getByTestId("library-root")).toBeVisible();
    // Fresh open with NO route: the stored last-route pointer seeds the URL pre-render.
    await page.goto("/");
    await expect(moduleTab(page, "library")).toHaveAttribute("aria-current", "page", { timeout: 15_000 });
    expect(new URL(page.url()).hash).toBe("#/library");
  });

  test("an explicit deep link — including the dashboard '#/' — beats the stored pointer", async ({ page }) => {
    await page.goto("/#/library");
    await expect(page.getByTestId("library-root")).toBeVisible();
    await page.goto("/#/");
    await expect(moduleTab(page, "site-planner")).toHaveAttribute("aria-current", "page", { timeout: 15_000 });
    expect(new URL(page.url()).hash).toBe("#/");
    await page.goto("/#/markup");
    await expect(moduleTab(page, "doc-review")).toHaveAttribute("aria-current", "page", { timeout: 15_000 });
  });
});
