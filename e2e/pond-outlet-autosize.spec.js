/* B902 — make detention design on a pond genuinely ONE-CLICK. Verified live on Tsakiris: to
 * design detention on an existing pond, a user had to MANUALLY TYPE an "Allowable release
 * (cfs)" before "Propose outlet" un-greyed ("Enter an allowable release (above), or the
 * criteria publish no cfs/ac cap"). Waller (and Brookshire–Katy DD) publish NO cfs/ac cap —
 * they're Post ≤ Pre rate-match districts — so a user who didn't already know their allowable
 * release was stuck at a dead, greyed button with no path forward.
 *
 * Fix: the allowable release the outlet is sized/checked against now falls back, in priority
 * order, to (1) a manual release the user typed, (2) the jurisdiction's published cfs/ac cap ×
 * drainage area, or (3) an AUTO-SUGGESTED pre-development peak discharge — the site's OWN
 * pre-development runoff, computed with the SAME rationalPeakCfs() engine assessRoutedDetention
 * already uses for the pre-dev side of every Post ≤ Pre check (lib/pondRouting.js
 * suggestedPreDevReleaseCfs). In a Post ≤ Pre regime the allowable release literally IS the
 * site's pre-development peak, so this can never disagree with what routing later verifies.
 * The primary button becomes "⚡ Auto-size detention" and is a genuine one-click action: size an
 * orifice to the suggested release → route the required storms → show the PASS/SHORT table —
 * with ZERO manual number entry (a blank site with no address matches the "generic" jurisdiction,
 * which — like Waller — publishes no cfs/ac cap, so this spec exercises the suggested tier
 * without needing to fake any specific jurisdiction).
 *
 * The manual override + clear path (B901) stays fully intact: typing a release always wins over
 * the suggestion, and — since a one-click auto-size commits the resolved number into the real
 * field for audit/edit — that committed number remains clearable via the already-shipped
 * allowClear fix.
 *
 * This spec drives the real SVG canvas LOGGED OUT (no account) on a seeded-blank site — the
 * suggested-release path needs zero auth or live GIS data, just a drawn pond + a drainage area. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

async function drawAndOpenPond(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Detention Pond", exact: true }).click();
  const x1 = box.x + 320, y1 = box.y + 250, x2 = box.x + 560, y2 = box.y + 420;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  const cx = Math.round((x1 + x2) / 2), cy = Math.round((y1 + y2) / 2);
  await page.mouse.dblclick(cx, cy);
}

const fieldInput = (page, labelText) =>
  page.getByText(labelText, { exact: true }).first().locator("xpath=ancestor::div[1]").locator("input").first();

async function fillField(page, labelText, value) {
  const input = fieldInput(page, labelText);
  await input.scrollIntoViewIfNeeded();
  await input.fill(String(value));
  await input.press("Tab");
}

// Anchor the pond (tobElev) + give it a drainage area, but NEVER touch "Allowable release" —
// this is the exact zero-manual-entry setup the brief describes.
async function drawAnchorAndSizePondNoRelease(page) {
  await drawAndOpenPond(page);
  await fillField(page, "Top-of-bank elev. (ft)", 100);
  await fillField(page, "Drainage area (ac)", 52.04);
}

test.describe("Pond detention — one-click auto-size (B902)", () => {
  test("(a) a pond with no release shows a non-empty SUGGESTED release + an enabled one-click path", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawAnchorAndSizePondNoRelease(page);

    // The field itself stays uncommitted (null) — never typed into — but a suggested figure is
    // visible, sourced with an ESTIMATE provenance tag, and the primary action is enabled.
    await expect(page.getByText("≈", { exact: false }).filter({ hasText: "suggested" }).first()).toBeVisible();
    await expect(page.getByText("ESTIMATE", { exact: true }).first()).toBeVisible();

    const autosizeBtn = page.getByRole("button", { name: /Auto-size detention/i });
    await expect(autosizeBtn).toBeVisible();
    await expect(autosizeBtn).toBeEnabled();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("(b) one click sizes an outlet AND shows a Post ≤ Pre routing result — zero manual typing", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawAnchorAndSizePondNoRelease(page);

    // The "Allowable release (cfs)" field was never typed into.
    const relInput = page.locator('[id^="pond-release-field-"] input').first();
    await expect(relInput).toHaveValue("");

    const autosizeBtn = page.getByRole("button", { name: /Auto-size detention/i });
    await autosizeBtn.scrollIntoViewIfNeeded();
    await autosizeBtn.click();

    // A sized orifice now exists...
    await expect(page.getByText("Orifice ⌀", { exact: false })).toBeVisible();
    // ...and the routed Post ≤ Pre table (PASS/SHORT chips) rendered — routing actually ran.
    await expect(page.getByText(/PASS|SHORT/).first()).toBeVisible();

    // The resolved release is now committed into the real field too — auditable, not a value
    // that only ever existed inside the click.
    await expect(relInput).not.toHaveValue("");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("(c) the suggestion is overridable (typing wins) and the resulting value is clearable", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawAnchorAndSizePondNoRelease(page);

    const relInput = page.locator('[id^="pond-release-field-"] input').first();
    // Override: type a manual release before ever clicking auto-size.
    await relInput.scrollIntoViewIfNeeded();
    await relInput.fill("42");
    await relInput.press("Tab");
    await expect(relInput).toHaveValue("42");
    await expect(page.getByText("Allowable release ≈ 42 cfs", { exact: false })).toBeVisible();

    // The primary button is no longer the auto-size flavor once a manual value governs.
    await expect(page.getByRole("button", { name: /^\+ Propose outlet$/ })).toBeVisible();

    // Clearable (the already-shipped B901 fix): select-all + delete empties it.
    await relInput.click({ clickCount: 3 });
    await page.keyboard.press("Delete");
    await relInput.press("Tab");
    await expect(relInput).toHaveValue("");

    // With the override gone, the suggested release reappears and the one-click path returns.
    await expect(page.getByRole("button", { name: /Auto-size detention/i })).toBeEnabled();

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
