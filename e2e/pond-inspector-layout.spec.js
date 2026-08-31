/* v3 UI SPEC Part B — the Detention-Pond inspector. Drives the REAL app, logged out, on a
 * seeded-blank site (no network dependency): draws a pond, selects it, and asserts the v3
 * structure renders with zero page errors — the DETENTION POND header, the Dimensions rows,
 * and the four collapsed groups (Sizing & criteria, Outlet & storms, Flood & datum, Appearance)
 * that open on click. The engine values (drainage / flood facts) are GIS-gated and unit-tested
 * elsewhere; this is the structure. */
import { test, expect } from "@playwright/test";
import { drawAndOpenPond, POND_GROUP } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByTestId("map-start-blank-menu-btn").click();
  await page.getByTestId("map-start-blank-menu-item").click();
  await expect(canvas(page)).toBeVisible();
}

test.describe("Pond inspector — v3 UI SPEC Part B structure", () => {
  test("inspector renders: DETENTION POND header, Dimensions rows, and four collapsed groups", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    // B1188 (85f9062b, PR #873, 2026-07-30): a single click SELECTS, a double click OPENS
    // Properties. This spec used to click once and assert against a docked inspector.
    await drawAndOpenPond(page);

    // Opening the pond docks its inspector: the header + subtitle + Dimensions rows.
    await expect(page.getByText("Detention Pond", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Water area", { exact: true })).toBeVisible();
    // B977 (97e3bfbe, PR #787, 2026-07-23 — "label every acreage") renamed this row "Holds" →
    // "Holds (gross)", the gross tub volume before the flood/tailwater dead-storage split. Its
    // label span also carries an ⓘ, so match the leading text rather than the whole span.
    await expect(page.getByText("Holds (gross)", { exact: false }).first()).toBeVisible();

    // The four collapsed groups, closed by default (their bodies hidden). B969/B970 (d4595625 /
    // c105648e, PR #779 / #780, 2026-07-23) renamed the first from "Sizing & criteria" to
    // "Engineering assumptions" — an engineer-only override section, hence the new name.
    for (const title of [POND_GROUP.sizing, POND_GROUP.outlet, POND_GROUP.flood, POND_GROUP.appearance]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${title}`, "i") }).first()).toBeVisible();
    }

    // Open the engineering group → its detail (freeboard field) appears; close → hides.
    const sizing = page.getByRole("button", { name: new RegExp(`^${POND_GROUP.sizing}`, "i") }).first();
    await sizing.click();
    await expect(page.getByText("Freeboard (ft)")).toBeVisible();
    await sizing.click();
    await expect(page.getByText("Freeboard (ft)")).toHaveCount(0);

    // Open "Appearance" → the Fill/Outline controls (moved from the old Properties section).
    // (A group header's accessible name is "<title> <closed-state summary>", so anchor on the
    // title rather than matching the whole name.)
    await page.getByRole("button", { name: new RegExp(`^${POND_GROUP.appearance}`, "i") }).first().click();
    await expect(page.getByText("Fill", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Outline", { exact: true }).first()).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
