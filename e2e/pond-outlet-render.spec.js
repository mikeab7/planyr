/* B900 (hotfix) — proposing a detention-pond outlet crashed the whole Site workspace with
 * "ReferenceError: React is not defined", caught by the workspace error boundary ("Site Planyr
 * hit an error and couldn't load"). Reproduced live on a signed-in deployed project (Tsakiris):
 * pond inspector → REQUIRED DETENTION → enter an allowable release → RATE CONTROL · POST ≤ PRE
 * → click "Propose outlet" → crash. Because the outlet is written to the pond's `det` and
 * persisted, a saved plan then crashed on every reload until the outlet was removed.
 *
 * Root cause: `SitePlanner.jsx` imports only named hooks from "react" (no default `React`
 * import), but the routed per-storm table — rendered ONLY once an outlet exists AND routing
 * succeeds (`routed.kind === "routed"`, `lib/pondRouting.js` assessRoutedDetention) — mapped
 * over `routed.perStorm` using `<React.Fragment key={...}>`, an explicit reference to the bare
 * `React` global. Under the automatic JSX runtime that global is never defined, so it throws
 * only on this specific render path — which is why ordinary pond/detention rendering worked
 * fine and only proposing/adding an outlet (with a nonzero drainage area, so routing actually
 * resolves) crashed. Fixed by importing `Fragment` as a named import (matching the rest of the
 * file's fragment-shorthand convention) and using `<Fragment key={...}>` instead.
 *
 * This spec drives the real SVG canvas LOGGED OUT (no account) on a seeded-blank site — the
 * exact crashing render path needs zero auth or live GIS data, just a drawn pond + a few typed
 * numbers, so it's fully reproducible here. Covers both outlet kinds named in the report
 * ("Propose outlet" → orifice, and switching to Restrictor). */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

// Draw a detention-pond rectangle and double-click its center to open the pond inspector
// (Properties) — B750: single-click selects, double-click opens Properties.
async function drawAndOpenPond(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Detention Pond", exact: true }).click();
  const x1 = box.x + 320, y1 = box.y + 250, x2 = box.x + 560, y2 = box.y + 420;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape"); // back to Select tool
  const cx = Math.round((x1 + x2) / 2), cy = Math.round((y1 + y2) / 2);
  await page.mouse.dblclick(cx, cy);
}

// A pond inspector `Field` renders `<div><span>{label}</span>{children}</div>` (no
// label[for]) — locate the input by its label text's parent container.
const fieldInput = (page, labelText) =>
  page.getByText(labelText, { exact: true }).first().locator("xpath=ancestor::div[1]").locator("input").first();

async function fillField(page, labelText, value) {
  const input = fieldInput(page, labelText);
  await input.scrollIntoViewIfNeeded();
  await input.fill(String(value));
  await input.press("Tab");
}

test.describe("Pond outlet render — proposing an outlet must never crash the workspace (B900)", () => {
  test("Propose outlet: orifice, with a routed storm table, renders with no throw", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawAndOpenPond(page);

    // Anchor the pond (required for the Rate control section to render at all) and give it a
    // nonzero drainage area so routing actually resolves (routed.kind === "routed") — the
    // EXACT branch that maps over routed.perStorm with the fragment that crashed.
    await fillField(page, "Top-of-bank elev. (ft)", 100);
    await fillField(page, "Drainage area (ac)", 10);
    await fillField(page, "Allowable release (cfs)", 15);

    const proposeBtn = page.getByRole("button", { name: /Propose outlet/i });
    await expect(proposeBtn).toBeEnabled();
    await proposeBtn.click();

    // The routed per-storm table (the crashing render path) must appear, not the error boundary.
    await expect(page.getByText("RATE CONTROL", { exact: false })).toBeVisible();
    await expect(page.getByText("Site Planyr hit an error", { exact: false })).toHaveCount(0);
    await expect(page.getByText(/PASS|SHORT|OVERTOPS/)).not.toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Restrictor outlet also renders the routed table with no throw", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawAndOpenPond(page);

    await fillField(page, "Top-of-bank elev. (ft)", 100);
    await fillField(page, "Drainage area (ac)", 10);
    await fillField(page, "Allowable release (cfs)", 15);

    // B903 — the outlet is now a genuine editable STAGE LIST (no more in-place "switch this
    // stage's kind" toggle), so the report's Restrictor path is exercised via the "+ Restrictor"
    // manual-start button directly — still the same routed.perStorm.map(...) Fragment block
    // that originally crashed, now rendered against a restrictor-kind outlet.
    await page.getByRole("button", { name: "+ Restrictor", exact: true }).click();
    await expect(page.getByText("RATE CONTROL", { exact: false })).toBeVisible();
    await page.waitForTimeout(150);

    await expect(page.getByText("Site Planyr hit an error", { exact: false })).toHaveCount(0);
    await expect(page.getByText(/PASS|SHORT|OVERTOPS/)).not.toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a proposed outlet survives a reload without crashing (the persisted-crash half of the report)", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawAndOpenPond(page);
    await fillField(page, "Top-of-bank elev. (ft)", 100);
    await fillField(page, "Drainage area (ac)", 10);
    await fillField(page, "Allowable release (cfs)", 15);
    await page.getByRole("button", { name: /Propose outlet/i }).click();
    await expect(page.getByText("RATE CONTROL", { exact: false })).toBeVisible();

    await page.reload({ waitUntil: "load" });
    await expect(canvas(page)).toBeVisible();
    await expect(page.getByText("Site Planyr hit an error", { exact: false })).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
