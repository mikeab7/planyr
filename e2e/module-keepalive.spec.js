/* Keep-alive module switching + resume-last-route (owner request, 2026-07-05) — logged-out
 * coverage. Proves: (1) a visited workspace STAYS MOUNTED (hidden) when you switch away,
 * so switching back doesn't rebuild from nothing; (2) an empty-hash boot reopens the last
 * module ("open where I left off") while an explicit deep link still wins; (3) the
 * fullscreen keyboard shortcut belongs to the VISIBLE module only — a hidden workspace's
 * header must not react; (4) the Schedule iframe survives a switch (no Gantt re-boot).
 * The signed-in halves (open drawing survives a switch, no cloud re-pull) are V-items. */
import { test, expect } from "@playwright/test";
import { openModule, moduleTab, expectOnScreen, expectOffScreen } from "./helpers.js";

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

  /* B1179 / B266082 — this case was RED on main for 17 consecutive scheduled runs, and BOTH of
   * its halves were wrong in a way that hid the other.
   *
   * (1) It pressed Escape to leave fullscreen. Since B1156, `f` asks for REAL browser
   *     fullscreen (the Fullscreen API on documentElement) and DELIBERATELY leaves Esc to the
   *     browser, which owns that gesture in native mode — fighting it would double-toggle.
   *     Headless Chromium has no browser chrome, so nothing exits on Esc. Probed directly on
   *     this build: after `f` → {fullscreenElement: true}; after Escape → {fullscreenElement:
   *     true}; after document.exitFullscreen() → {fullscreenElement: false}. The APP is right;
   *     the STEP was written for the old chrome-hide `f`, where Esc did the work.
   * (2) Its "the chrome is back" assertion was toBeVisible() on a module tab — which is true of
   *     a tab sitting at y = −44, off the top of the screen. So the stale step above did not
   *     even fail where it was wrong: it failed one line later, on a click, and the case's real
   *     subject (does a HIDDEN module's header react to a global key?) was never reached.
   *
   * Rewritten to exercise the product as it actually is, on BOTH exit paths, and to assert
   * position rather than mere visibility. Nothing is relaxed: the native path now proves the
   * chrome genuinely collapses and genuinely returns, which the old version never did. */
  test("global keys act on the visible module only (hidden headers ignore 'f') — native fullscreen", async ({ page }) => {
    await page.goto("/");
    await openModule(page, "doc-review");   // Review now mounted
    await openModule(page, "site-planner"); // visible: Site; hidden: Review

    // 'f' toggles fullscreen in the ACTIVE (Site) header…
    await page.keyboard.press("f");
    await expect(page.getByTitle(/Exit fullscreen/i)).toBeVisible();
    expect(await page.evaluate(() => !!document.fullscreenElement), "'f' should enter REAL browser fullscreen (B1156)").toBe(true);
    // …and the chrome really collapses — the tabs leave the screen, they do not merely "hide".
    await expectOffScreen(page, moduleTab(page, "site-planner"), "the Site tab in fullscreen");

    // Leave the way the browser's own UI would. Esc belongs to the BROWSER in native mode and
    // there is no browser UI here, so the API is the honest stand-in (the same call every
    // ui-audit fullscreen harness makes).
    await page.evaluate(() => document.exitFullscreen());
    await expect(page.getByTitle(/Exit fullscreen/i)).toHaveCount(0);
    await expectOnScreen(page, moduleTab(page, "site-planner"), "the Site tab after leaving fullscreen");

    // THE ACTUAL SUBJECT, which the stale step above never reached: the hidden Review header
    // must not have reacted to the global key. Switching there shows normal chrome.
    await openModule(page, "doc-review");
    await expectOnScreen(page, moduleTab(page, "doc-review"), "the Review tab");
    await expect(page.getByTitle(/Exit fullscreen/i)).toHaveCount(0);
  });

  /* The OTHER half of B1156's design, and the branch Escape genuinely owns. When the Fullscreen
   * API refuses (no user activation, a permissions policy, an iframe without allow="fullscreen")
   * or does not exist at all (iOS Safari has no fullscreen for a non-video element), `f` falls
   * back to a plain chrome-hide — and there, Escape IS the app's job. Deleting the Escape
   * assertion outright would have left that path with no coverage at all, which is how a spec
   * "quietly rewritten to match current behaviour" blesses a future regression. So it is not
   * deleted; it is aimed at the path it describes. */
  test("the fullscreen FALLBACK (request refused) puts the chrome back on Escape", async ({ page }) => {
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
    await expect(page.getByTitle(/Exit fullscreen/i)).toBeVisible();
    expect(await page.evaluate(() => !!document.fullscreenElement), "the request was refused, so the browser must NOT be in fullscreen").toBe(false);
    await expectOffScreen(page, moduleTab(page, "site-planner"), "the Site tab in fallback fullscreen");

    // Fallback mode never entered browser fullscreen, so the app owns the exit — and Escape is it.
    await page.keyboard.press("Escape");
    await expect(page.getByTitle(/Exit fullscreen/i)).toHaveCount(0);
    await expectOnScreen(page, moduleTab(page, "site-planner"), "the Site tab after Escape");
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
