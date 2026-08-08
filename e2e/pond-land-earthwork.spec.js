/* B907 — CE roadmap #7: tie detention SIZING to LAND TAKE + EARTHWORK $. A detention pond
 * consumes real developable acreage and costs real excavation dollars — this ties the
 * pond's actual drawn geometry into the Yield panel's land breakdown ("Detention" %,
 * previously only ever verified against a genuinely drawn pond) and the "Earthwork cost
 * (screening)" card's "Pond excavation" line (already existed and already priced off the
 * user's own $/CY bid — this session's audit confirmed both were already wired to real
 * pond geometry, not stubbed). This spec is a REGRESSION/CONFIRMATION guard for that
 * existing wiring plus the two genuine gaps this session closed: (1) incremental
 * excavation for an ENLARGED pond (unit-tested in pondGeom.test.js — the interactive
 * "Expand this pond" flow isn't exercised here) and (2) the forward-looking land-take
 * advisory for a detention shortfall (needs a live drainage-criteria check — GIS-gated,
 * blocked in this sandbox; unit-tested in pondGeom.test.js instead).
 *
 * Drives the real app LOGGED OUT (no account) on a seeded-blank site. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

async function drawParcel(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Parcel tools ▾", exact: true }).click();
  await page.getByText("Draw new parcel", { exact: true }).click();
  const pts = [
    [box.x + 80, box.y + 80],
    [box.x + 700, box.y + 80],
    [box.x + 700, box.y + 500],
    [box.x + 80, box.y + 500],
  ];
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
  }
  await page.getByRole("button", { name: "Finish", exact: false }).first().click();
  const doneBtn = page.getByRole("button", { name: "Done", exact: true });
  if (await doneBtn.count()) await doneBtn.click();
  await page.keyboard.press("Escape");
}

async function drawPond(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Detention Pond", exact: true }).click();
  const x1 = box.x + 320, y1 = box.y + 250, x2 = box.x + 560, y2 = box.y + 420;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

async function openYield(page) {
  await page.getByRole("button", { name: "Yield", exact: true }).click();
}

test.describe("Detention land-take + earthwork $ (B907)", () => {
  test("(a) a drawn detention pond shows a non-zero Detention share in the Yield land breakdown", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawParcel(page);
    await drawPond(page);
    await openYield(page);

    // B944 (f414ce59, PR #754, 2026-07-21) deleted the standalone "Detention %" row: the pond's
    // share of the site now reads off the LAND USE legend, which that same change introduced (its
    // own comment says the Impervious / Detention-sf / Detention-% / Detention-storage rows
    // "moved to LAND USE and the pond inspector's Holds"). Same fact, one surface instead of two.
    // LAND USE is the one group open by default, so nothing needs unfolding here.
    const pondRow = page.getByTestId("yield-landuse-pond");
    await pondRow.scrollIntoViewIfNeeded();
    await expect(pondRow).toBeVisible();
    const text = await pondRow.textContent();
    expect(text, "the drawn pond must take a non-zero share of the site").not.toMatch(/\b0%/);
    expect(text, "the drawn pond must report a non-zero acreage").not.toMatch(/\b0\.00 ac/);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("(b) the Earthwork cost card prices the pond's real excavation once a $/CY bid is entered", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawParcel(page);
    await drawPond(page);
    await openYield(page);

    // FINAL UI SPEC B1.2 — the cost cards live inside the collapsed "Costs" group. B944
    // (f414ce59, PR #754, 2026-07-21) rewrote that group's closed-state summary: it reads
    // "not priced yet" until a unit price is entered, so the old "Costs road + earthwork"
    // accessible name no longer exists on an unpriced plan. Match the group title.
    await page.getByRole("button", { name: /^Costs/ }).first().click();
    // B954 (af2f8447, PR #766, 2026-07-22) replaced the "Earthwork cost (screening)" <Section>
    // with a CostDisclosure row: a label plus a "Set unit prices →" link that unfolds the same
    // lines. Two such rows exist (Earthwork, Road), so scope the link to the Earthwork row.
    const earthworkRow = page.getByText("Earthwork", { exact: true }).locator("xpath=ancestor::div[1]");
    await earthworkRow.getByRole("button", { name: /Set unit prices/i }).click();

    const excavationRow = page.getByText(/Pond excavation/i).first();
    await excavationRow.scrollIntoViewIfNeeded();
    await expect(excavationRow).toBeVisible();
    // Before a price is set, the row offers to set one rather than showing a fabricated $.
    await expect(page.getByRole("button", { name: /Set \$\/CY/i }).first()).toBeVisible();

    const priceInput = page.locator("#price-field-earthworkCy input").first();
    await priceInput.fill("12");
    await priceInput.press("Tab");

    await expect(page.getByText(/\$[\d,]+/).first()).toBeVisible();
    await expect(page.getByText("Subtotal", { exact: true })).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
