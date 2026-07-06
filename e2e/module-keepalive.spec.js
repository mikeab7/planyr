/* Keep-alive module switching + resume-last-route (owner request, 2026-07-05) — logged-out
 * coverage. Proves: (1) a visited workspace STAYS MOUNTED (hidden) when you switch away,
 * so switching back doesn't rebuild from nothing; (2) an empty-hash boot reopens the last
 * module ("open where I left off") while an explicit deep link still wins; (3) the
 * fullscreen keyboard shortcut belongs to the VISIBLE module only — a hidden workspace's
 * header must not react; (4) the Schedule iframe survives a switch (no Gantt re-boot).
 * The signed-in halves (open drawing survives a switch, no cloud re-pull) are V-items. */
import { test, expect } from "@playwright/test";
import { openModule, moduleTab } from "./helpers.js";

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

  test("global keys act on the visible module only (hidden headers ignore 'f')", async ({ page }) => {
    await page.goto("/");
    await openModule(page, "doc-review");   // Review now mounted
    await openModule(page, "site-planner"); // visible: Site; hidden: Review
    // 'f' toggles fullscreen in the ACTIVE (Site) header…
    await page.keyboard.press("f");
    await expect(page.getByTitle(/Exit fullscreen/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(moduleTab(page, "site-planner")).toBeVisible();
    // …and must NOT have toggled the hidden Review header: switching there shows normal chrome.
    await openModule(page, "doc-review");
    await expect(moduleTab(page, "doc-review")).toBeVisible();
    await expect(page.getByTitle(/Exit fullscreen/i)).toHaveCount(0);
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
