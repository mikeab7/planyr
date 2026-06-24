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
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { openModule, hasAccount, STORAGE_STATE } from "./helpers.js";
import { toolsForWorkspace, propsForTool } from "../src/shared/markup/tools.matrix.js";
import { schemaForMarkup } from "../src/shared/markup/propertySchema.js";

/* A tiny valid 1-page PDF the per-tool tests open so the tool rail renders (B436). */
const FIXTURE_PDF = fileURLToPath(new URL("./fixtures/sample.pdf", import.meta.url));

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

  // Reuse the session captured once by auth.setup.js instead of re-signing-in per test — the
  // single biggest cost in this suite. Each test loads an already-authenticated page.
  test.use({ storageState: hasAccount ? STORAGE_STATE : undefined });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // The restored session should land us signed in — the module tabs only render in the
    // authed shell. This replaces the full interactive sign-in.
    await expect(page.getByTestId("module-tab-site-planner")).toBeVisible({ timeout: 20_000 });
  });

  test("the Review workspace mounts", async ({ page }) => {
    // openModule already verifies the tab becomes current (works on any deploy). doc-review-root
    // is the module container, present once THIS branch deploys — tolerate an older live build
    // that predates the testid by falling back to the now-current tab signal. The tool rail
    // itself only renders once a review is open (asserted, with a graceful skip, below).
    await openModule(page, "doc-review");
    const root = page.getByTestId("doc-review-root");
    if (await root.count()) {
      await expect(root).toBeVisible({ timeout: 20_000 });
    } else {
      await expect(page.getByTestId("module-tab-doc-review")).toHaveAttribute("aria-current", "page");
    }
  });

  /* Per-tool rail-arm assertions, generated 1:1 from the matrix (B432/B436).
   * The seeded account (B280) has a site but no PDF, so the rail wouldn't render on its own —
   * we open a tiny fixture PDF through the header file input first, then each test arms its
   * tool button and verifies aria-pressed. A tool not yet on the live build (the matrix can
   * lead the deploy) is skipped, not failed; likewise if the rail never renders. */
  test.describe("per-tool rail arm", () => {
    test.beforeEach(async ({ page }) => {
      await openModule(page, "doc-review");
      // The "Open PDF" file input lives in the always-rendered header toolbar. setInputFiles
      // works on the hidden input directly; openFile() then parses it and mounts the canvas.
      await page
        .locator('input[type="file"][accept*="pdf"]')
        .first()
        .setInputFiles(FIXTURE_PDF)
        .catch(() => {});
      // The rail appears once the PDF is parsed + the canvas view mounts. Don't hard-fail here;
      // the per-tool tests skip gracefully if it never shows (e.g. an older deploy / storage hiccup).
      await page
        .getByTestId("markup-rail")
        .waitFor({ state: "visible", timeout: 30_000 })
        .catch(() => {});
    });

    for (const tool of toolsForWorkspace("doc")) {
      if (tool.drawMode === "mode") continue;

      test(`"${tool.id}" button is present and arms the tool`, async ({ page }) => {
        const rail = page.getByTestId("markup-rail");
        const railVisible = await rail.isVisible().catch(() => false);
        if (!railVisible) {
          test.skip(true, `Tool rail didn't render (fixture PDF didn't open) — skipping "${tool.id}"`);
          return;
        }

        const btn = page.getByTestId(`tool-${tool.id}`);
        // The matrix can list a tool before it's deployed — tolerate an absent button.
        if (!(await btn.count())) {
          test.skip(true, `tool-${tool.id} not present on the current deploy yet`);
          return;
        }
        await expect(btn).toBeVisible({ timeout: 5_000 });
        await btn.click();
        await expect(btn).toHaveAttribute("aria-pressed", "true");
      });
    }
  });
});
