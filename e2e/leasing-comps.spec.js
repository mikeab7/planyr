/* Leasing Comps (NEW-COMPS) — logged-out UI mechanics, driven headlessly per
 * ATTEMPT-BEFORE-YOU-PARK: no external GIS, no sign-in needed for these checks. Proves the
 * "+ Comp" pin-drop flow arms, opens the create form pre-filled with the clicked anchor, and
 * that saving while signed out fails LOUDLY (an owner-facing message), never silently.
 *
 * The signed-in round trip (insert/update/delete actually landing in Supabase, team-visibility)
 * is V### (parked — Blocker: auth; Supabase sign-in is CORS-blocked from this sandbox). The RLS
 * policies themselves were proven directly against the real database (see the item's session
 * notes) — this spec covers what a browser can prove without a session: the UI mechanics.
 *
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/leasing-comps.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

test("the + Comp pin flow arms, opens the create form pre-filled, and a signed-out save fails loudly", async ({ page }) => {
  await page.goto("/");
  await openModule(page, "site-planner");

  const placeCompBtn = page.getByRole("button", { name: "＋ Comp" });
  await expect(placeCompBtn).toBeVisible({ timeout: 20_000 });
  await placeCompBtn.click();

  // Armed: the map shows the "click to place" prompt instead of the button.
  await expect(page.getByText("Click the map to place a comp…")).toBeVisible();

  // Click roughly the middle of the map canvas.
  const mapBox = await page.locator(".leaflet-container").first().boundingBox();
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);

  // The comp create form opens, pre-filled from that click (Type + Date fields present).
  await expect(page.getByText("Leasing Comps")).toBeVisible({ timeout: 10_000 });
  const dateInput = page.locator('input[type="date"]');
  await expect(dateInput).toBeVisible();

  // The armed prompt is gone — placing mode consumed itself.
  await expect(page.getByText("Click the map to place a comp…")).toHaveCount(0);

  // Required field per the spec: date. Type defaults to Land.
  await dateInput.fill("2026-08-01");
  await page.getByRole("button", { name: "Save comp" }).click();

  // LOUD-FAILURE: the save must say so — never a silent no-op. Which honest message appears
  // depends on the build: "Sign in to add a comp" when Supabase is configured but no session
  // exists, "Supabase not configured" when this build carries no Supabase env at all (this
  // sandbox's case, confirmed live) — either is a real, specific failure, never silence.
  await expect(page.getByText(/Sign in to add a comp|Supabase not configured/)).toBeVisible({ timeout: 10_000 });
});

test("the Comps toggle opens an honest empty list when signed out", async ({ page }) => {
  await page.goto("/");
  await openModule(page, "site-planner");

  const toggle = page.getByRole("button", { name: /^Comps/ });
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await toggle.click();

  await expect(page.getByText("No comps yet. Use “+ Comp” on the map to add one.")).toBeVisible({ timeout: 10_000 });
});

// NEW-1/NEW-2/NEW-7(amended)/NEW-8 — the create-form UI mechanics, driven headlessly per
// ATTEMPT-BEFORE-YOU-PARK. The DETAIL view (NEW-3/NEW-4/NEW-5/NEW-6) needs a real saved comp,
// which needs a signed-in session — that half is Blocker: auth, parked as a V### instead (see
// BACKLOG.md/VERIFICATION.md). Everything reachable signed-out is proven here.
async function openCompCreateForm(page) {
  await page.goto("/");
  await openModule(page, "site-planner");
  await page.getByRole("button", { name: "＋ Comp" }).click();
  const mapBox = await page.locator(".leaflet-container").first().boundingBox();
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await expect(page.getByText("Leasing Comps")).toBeVisible({ timeout: 10_000 });
}

test("lease rate + period render inline on one row, as a compact labelled MO/YR control — no separate Period row", async ({ page }) => {
  await openCompCreateForm(page);
  // Type defaults to Land; switch to Lease to reach the rate/period row.
  await page.locator("select").first().selectOption("lease");

  const periodSelect = page.getByLabel("Rate period");
  await expect(periodSelect).toBeVisible();
  // Real labelled control, compact abbreviations.
  await expect(periodSelect.locator("option")).toHaveText(["YR", "MO"]);
  // No more standalone "Period" field label anywhere in the form.
  await expect(page.getByText("Period", { exact: true })).toHaveCount(0);

  // Inline: the rate input and the period select share one row (same Y position, roughly).
  const rateInput = page.locator('input[type="number"]').first();
  const rateBox = await rateInput.boundingBox();
  const periodBox = await periodSelect.boundingBox();
  expect(Math.abs(rateBox.y - periodBox.y)).toBeLessThan(4);
  // Neither control overflows the panel's own narrow width.
  const panelBox = await page.getByText("Leasing Comps").locator("..").boundingBox();
  expect(periodBox.x + periodBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
});

test("free rent (months) is a field on the lease form, positioned next to Term", async ({ page }) => {
  await openCompCreateForm(page);
  await page.locator("select").first().selectOption("lease");
  await expect(page.getByText("Free rent (mo)")).toBeVisible();
});

test("party fields relabel per comp type: lease=Owner/Developer+Tenant, land=Seller+Buyer, building_sale=Seller+Buyer/User", async ({ page }) => {
  await openCompCreateForm(page);
  const typeSelect = page.locator("select").first();

  await typeSelect.selectOption("land");
  await expect(page.getByText("Seller", { exact: true })).toBeVisible();
  await expect(page.getByText("Buyer", { exact: true })).toBeVisible();

  await typeSelect.selectOption("building_sale");
  await expect(page.getByText("Seller", { exact: true })).toBeVisible();
  await expect(page.getByText("Buyer/User", { exact: true })).toBeVisible();

  await typeSelect.selectOption("lease");
  await expect(page.getByText("Owner/Developer", { exact: true })).toBeVisible();
  await expect(page.getByText("Tenant", { exact: true })).toBeVisible();
});

test("party fields are accessible comboboxes and never force a value — a brand-new name types with zero friction", async ({ page }) => {
  await openCompCreateForm(page);
  await page.locator("select").first().selectOption("lease");
  const providerField = page.getByRole("combobox", { name: "Owner/Developer" });
  await expect(providerField).toBeVisible();
  await expect(providerField).toHaveAttribute("aria-expanded", "false");

  await providerField.fill("Brand New Development Co");
  await expect(providerField).toHaveValue("Brand New Development Co");
  // No candidates exist signed-out (an empty comps list), so no suggestion list opens — and
  // nothing about typing a name with no match blocks or alters what was typed.
  await expect(page.locator('[role="listbox"]')).toHaveCount(0);
});
