/* Markup tool assertions (B278 harness; the home of the NEW-9 per-tool loop).
 *
 * Auth-gated: needs the seeded test account (B280). Without E2E_EMAIL / E2E_PASSWORD the
 * whole file skips cleanly (a contributor still gets the logged-out smoke.spec.js coverage).
 *
 * NEW-9 GROWS HERE. As each tool row lands (B425+), add its assertion group: the rail button
 * exists and arms the tool (aria-pressed), drawing produces a markup of the right kind, and
 * the property panel exposes exactly that matrix row's controls. The matrix is imported so
 * the loop is generated FROM it — a tool added to the matrix but not the app fails here, and
 * the matrix is never edited to make this pass (B421 rule). Today it asserts the harness logs
 * in, the Review workspace mounts, and its tool rail renders — the spine the per-tool groups
 * attach to. */
import { test, expect } from "@playwright/test";
import { signIn, openModule, hasAccount } from "./helpers.js";
import { toolsForWorkspace } from "../src/shared/markup/tools.matrix.js";

test.describe("markup tools (signed in)", () => {
  test.skip(!hasAccount, "set E2E_EMAIL / E2E_PASSWORD (B280 seeded account) to run");

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await signIn(page);
  });

  test("the Review workspace opens and shows its tool rail", async ({ page }) => {
    await openModule(page, "doc-review");
    await expect(page.getByTestId("markup-rail")).toBeVisible({ timeout: 20_000 });
  });

  /* The matrix knows which tools the Review surface should carry. As B425 implements them,
   * flip the per-tool body from "documented" to a real arm+draw+panel assertion. The list
   * here is the spec; the assertions are filled in tool-by-tool by the NEW-9 loop. */
  for (const tool of toolsForWorkspace("doc")) {
    test(`matrix row "${tool.id}" is specified for Review [NEW-9 pending wiring]`, async () => {
      // Spec-presence check today; becomes a live rail-arm + draw + property-panel assertion
      // when the tool lands (B425+). Keeps the matrix↔suite mapping visible and 1:1.
      expect(tool.workspaces).toContain("doc");
      test.info().annotations.push({ type: "new-9", description: `arm+draw+panel for ${tool.id}` });
    });
  }
});
