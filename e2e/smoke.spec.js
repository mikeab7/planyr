/* Logged-out smoke (B278) — runs with no seeded account, so it works for any contributor
 * and in the sandbox. Proves the harness itself is wired: the app boots, the shell renders,
 * and the workspace switcher moves between Site and Review. The auth-gated per-tool
 * assertions live in markup-tools.spec.js. */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

test.describe("app shell smoke (logged out)", () => {
  test("boots and shows the workspace switcher", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("module-tab-site-planner")).toBeVisible();
    await expect(page.getByTestId("module-tab-doc-review")).toBeVisible();
  });

  test("switches into the Review workspace and back", async ({ page }) => {
    await page.goto("/");
    await openModule(page, "doc-review");
    // The Review module mounts as its own lazy chunk; its tab becomes the current page.
    await expect(page.getByTestId("module-tab-doc-review")).toHaveAttribute("aria-current", "page");
    await openModule(page, "site-planner");
    await expect(page.getByTestId("module-tab-site-planner")).toHaveAttribute("aria-current", "page");
  });

  // B650: the Library's new Folders tab mounts (logged out shows the sign-in prompt, not a crash).
  test("Library Folders tab renders the folder-tree surface", async ({ page }) => {
    await page.goto("/");
    await openModule(page, "library");
    await page.getByTestId("library-tab-folders").click();
    await expect(page.getByTestId("folder-tree")).toBeVisible();
    await expect(page.getByText(/Sign in to use project folders/i)).toBeVisible();
  });
});
