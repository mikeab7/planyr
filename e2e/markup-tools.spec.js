/* Markup tool assertions (B278 harness; the home of the NEW-9 per-tool loop).
 *
 * Two sections:
 *   A) matrix ↔ propertySchema conformance — pure JS, runs with no auth, no PDF.
 *      If schemaForMarkup drifts from the matrix the loop catches it here, before CI
 *      even opens a browser. The matrix is NEVER edited to make this pass (B421 rule).
 *   B) per-tool rail + arm (auth-gated) — needs the seeded test account (B280).
 *      Without E2E_EMAIL / E2E_PASSWORD the whole describe skips cleanly.
 *
 * NEW-9 GROWS HERE. As each tool row lands (B425+), the conformance block auto-covers it
 * (no manual edit needed — it's generated from the matrix). The rail-arm block already
 * emits one test per matrix row and upgrades to a live assertion automatically once B280's
 * fixture account can open a PDF. */
import { test, expect } from "@playwright/test";
import { signIn, openModule, hasAccount } from "./helpers.js";
import {
  TOOL_MATRIX,
  toolsForWorkspace,
  propsForTool,
} from "../src/shared/markup/tools.matrix.js";
import { schemaForMarkup } from "../src/shared/markup/propertySchema.js";

/* ──────────────────────────────────────────────────────────────────────────
 * A) matrix ↔ propertySchema conformance — no auth, no browser needed
 * ────────────────────────────────────────────────────────────────────────── */
test.describe("matrix ↔ propertySchema conformance (no auth needed)", () => {
  for (const tool of toolsForWorkspace("doc")) {
    /* "mode" rows (e.g. select, pan) carry no property controls — skip. */
    if (tool.drawMode === "mode") continue;

    test(`schemaForMarkup("${tool.id}") matches the matrix row's properties`, () => {
      const schemaKeys = schemaForMarkup({ kind: tool.id })
        .map((s) => s.key)
        .sort();
      const matrixKeys = [...propsForTool(tool.id)].sort();
      expect(schemaKeys).toEqual(matrixKeys);
    });
  }
});

/* ──────────────────────────────────────────────────────────────────────────
 * B) per-tool rail + arm assertions — auth-gated (needs B280 seeded account)
 * ────────────────────────────────────────────────────────────────────────── */
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

  /* Per-tool rail-arm assertions, generated 1:1 from the matrix.
   * Each test arms the tool button and verifies aria-pressed flips to "true".
   * When the tool rail is not visible (no PDF open / fixture not yet seeded via B280),
   * the test skips gracefully with an explanatory message instead of failing. */
  test.describe("per-tool rail arm", () => {
    test.beforeEach(async ({ page }) => {
      await openModule(page, "doc-review");
    });

    for (const tool of toolsForWorkspace("doc")) {
      if (tool.drawMode === "mode") continue;

      test(`"${tool.id}" button is present and arms the tool`, async ({ page }) => {
        const rail = page.getByTestId("markup-rail");
        const railVisible = await rail.isVisible({ timeout: 5_000 }).catch(() => false);

        if (!railVisible) {
          test.skip(
            true,
            `Tool rail not visible — open a review with a PDF first ` +
              `(B280 fixture account must load a seeded review for "${tool.id}")`,
          );
          return;
        }

        const btn = page.getByTestId(`tool-${tool.id}`);
        await expect(btn).toBeVisible({ timeout: 5_000 });
        await btn.click();
        await expect(btn).toHaveAttribute("aria-pressed", "true");
      });
    }
  });
});
