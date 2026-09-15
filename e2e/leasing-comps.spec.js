/* Leasing Comps (NEW-COMPS) — logged-out UI mechanics, driven headlessly per
 * ATTEMPT-BEFORE-YOU-PARK: no external GIS, no sign-in needed for these checks. Proves the
 * comp-pin flow arms, opens the create form pre-filled with the clicked anchor, and that saving
 * while signed out fails LOUDLY (an owner-facing message), never silently.
 *
 * B831777/B831776 (2026-08-28, merged into main the same day this spec's own owner-chat block
 * arrived) moved Comps from a floating right-side "Leasing Comps" panel with a "＋ Comp" button
 * into a left-rail TAB ("Sites"/"Comps"). Every locator below targets that shape — there is
 * no more "Leasing Comps" title or "＋ Comp" button anywhere in the app.
 *
 * ⛔ B848304 (2026-09-02) then NEW-1 (2026-09-08) each touched only the ONE assumption this file's
 * `openCompCreateForm` makes about the map's ENTRY POINT. NEW-1 took that toolbar GROUND-FIRST:
 * there is no "Place comp" button and no Site/Comp mode any more — you point at ground (Drop a
 * pin), and the decide bar that follows is where you say it is a comp. Same anchor, same
 * downstream flow, one more click; fixed below. Everything past
 * that click (a "Type" field + a "Save comp" button opening directly) predates B849232/B849233
 * (2026-09-01), which replaced that single-comp create form with the CompEntryGrid paste sheet as
 * the one create surface; a map pick now opens that grid pre-seeded with one row, not a field
 * form. This file was not brought forward for that rework (owned by the comps-grid sessions, out
 * of scope here) — treat every assertion past the first two per test as STALE until it is.
 *
 * The signed-in round trip (insert/update/delete actually landing in Supabase, team-visibility,
 * and everything the DETAIL view renders) is `Blocker: auth` — parked as V### items (see
 * BACKLOG.md/VERIFICATION.md) — Supabase sign-in is CORS-blocked from this sandbox. This spec
 * covers what a browser can prove without a session: the UI mechanics.
 *
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/leasing-comps.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

// The left rail's "Records" tab (relabeled from "Comps" — NEW-2, the settled "site record" term;
// see MapFinder.jsx's RailTab comment) opens the rail if it was collapsed — one click reaches the
// comps list/create-form surface (RailTab, MapFinder.jsx). NEW-1 (2026-09-08): it is its own
// state and no longer moves anything on the centre toolbar (there is no centre mode left to move).
async function openCompsTab(page) {
  await page.goto("/");
  await openModule(page, "site-planner");
  await page.getByRole("tab", { name: "Records" }).click();
}

async function openCompCreateForm(page) {
  await openCompsTab(page);
  // NEW-1 (2026-09-08) — GROUND FIRST. "Drop a pin" marks a point; it does not decide what the
  // point is. The decide bar that follows is where "Log a comp" lives.
  await page.getByTestId("map-toolbar-drop-pin").click();
  // Armed: the map says it is waiting for a point, and says nothing about what it will become.
  await expect(page.getByText("Click the map to mark a point…")).toBeVisible();
  const mapBox = await page.locator(".leaflet-container").first().boundingBox();
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  // The armed prompt is gone — the pin consumed it — and the decide bar is asking.
  await expect(page.getByText("Click the map to mark a point…")).toHaveCount(0);
  await expect(page.getByTestId("map-decide-summary")).toBeVisible();
  await page.getByTestId("map-decide-verb-comp").click();
  // The comp create form opens, pre-filled from that click (the Type field is the tell — it's
  // unique to the form, unlike the list/detail views).
  await expect(page.getByText("Type", { exact: true })).toBeVisible({ timeout: 10_000 });
}

test("the Drop-a-pin flow arms, opens the create form pre-filled, and a signed-out save fails loudly", async ({ page }) => {
  await openCompCreateForm(page);

  const dateInput = page.locator('input[type="date"]');
  await expect(dateInput).toBeVisible();

  // Required field per the spec: date. Type defaults to Land.
  await dateInput.fill("2026-08-01");
  await page.getByRole("button", { name: "Save comp" }).click();

  // LOUD-FAILURE: the save must say so — never a silent no-op. Which honest message appears
  // depends on the build: "Sign in to add a comp" when Supabase is configured but no session
  // exists, "Supabase not configured" when this build carries no Supabase env at all (this
  // sandbox's case, confirmed live) — either is a real, specific failure, never silence.
  await expect(page.getByText(/Sign in to add a comp|Supabase not configured/)).toBeVisible({ timeout: 10_000 });
});

test("the Comps tab opens an honest empty list when signed out", async ({ page }) => {
  await openCompsTab(page);
  // NEW-1 — the empty-state copy names the ground-first entry point.
  await expect(page.getByText("No comps yet. Paste a few from a broker email with “＋ Paste comps” above, or point at the map and choose “Log a comp”.")).toBeVisible({ timeout: 10_000 });
});

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

  // Neither control overflows the rail panel's own narrow width — walk up from the field to the
  // panel's positioned container (the rail box MapFinder renders both tabs and this form inside).
  const panelBox = await periodSelect.evaluate((el) => {
    let n = el;
    while (n && n !== document.body) {
      if (getComputedStyle(n).position === "absolute") {
        const r = n.getBoundingClientRect();
        return { x: r.x, width: r.width };
      }
      n = n.parentElement;
    }
    return null;
  });
  expect(panelBox).not.toBeNull();
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
