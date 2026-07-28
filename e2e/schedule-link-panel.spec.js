/* B1050 / B1051 — the link-schedule resolution panel: it must never trap the user, and its
 * copy must fit the card in both themes.
 *
 * The owner's repro (Tsakiris, #/project/<gid>/schedule): a project with no linked schedule shows
 * the "No schedule for X yet" panel over the Schedule tab; pressing Dashboard in the breadcrumb
 * only messaged the embedded iframe, so the outer route kept its project and the panel stayed up,
 * dimming and blocking the dashboard — with no X, no Escape and no click-outside.
 *
 * Runs LOGGED OUT: the panel only needs a Site Planner project in the local store (the legacy
 * `planarfit:sites:v1` store the app reads when signed out) plus a route pointing at it. No cloud,
 * no external GIS, so this is self-verifiable in the sandbox. Screenshots land in
 * test-results/link-panel-*.png for the V484 sign-off (light + dark, desktop + narrow).
 */
import { test, expect } from "@playwright/test";

const GID = "g-b1050-tsakiris";
// A deliberately long name — the card is fixed-width, so a long project name is the copy's
// worst case (NEW-2's "no clipped or overflowing text").
const LONG_NAME = "Tsakiris Business Park — Phase II Redevelopment";

/* Seed the logged-out site store + the theme BEFORE any app script runs. */
function seed(page, { theme, name }) {
  return page.addInitScript(([gid, siteName, mode]) => {
    const rec = { id: "p1", groupId: gid, site: siteName, name: "Plan 1", origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} };
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ p1: rec }));
    localStorage.setItem("planyr.theme", mode);
  }, [GID, name, theme]);
}

const panel = (page) => page.getByRole("dialog", { name: /No schedule for/i });

async function openUnlinkedSchedule(page, { theme = "light", name = LONG_NAME } = {}) {
  await seed(page, { theme, name });
  await page.goto(`/#/project/${GID}/schedule`);
  // The panel waits on the iframe reporting in (or the ~2.5 s reveal fallback).
  await expect(panel(page)).toBeVisible({ timeout: 25_000 });
}

test.describe("link-schedule panel — escape hatches (B1050)", () => {
  test("Escape closes the panel and leaves the Schedule tab usable", async ({ page }) => {
    await openUnlinkedSchedule(page);
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    // Dismissing links/creates nothing — the route still points at the same project.
    expect(page.url()).toContain(`/project/${GID}/schedule`);
  });

  test("the X in the corner closes the panel", async ({ page }) => {
    await openUnlinkedSchedule(page);
    await panel(page).getByRole("button", { name: "Close" }).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test("pressing Dashboard clears the outer route AND dismisses the panel (the reported trap)", async ({ page }) => {
    await openUnlinkedSchedule(page);
    await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
    // The outer route must follow the iframe — this is the half that was missing.
    await expect.poll(() => page.url(), { timeout: 10_000 }).not.toContain("/project/");
    await expect(panel(page)).toHaveCount(0);
    // …and it must STAY gone (the carry-out effect must not re-adopt the site we just cleared).
    await expect(panel(page)).toHaveCount(0, { timeout: 5_000 });
  });
});

test.describe("link-schedule panel — copy fits the card (B1051)", () => {
  for (const theme of ["light", "dark"]) {
    for (const [size, viewport] of [["desktop", { width: 1280, height: 820 }], ["narrow", { width: 420, height: 780 }]]) {
      test(`${theme} / ${size}: no clipped or overflowing text`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openUnlinkedSchedule(page, { theme });
        const card = panel(page).locator("> div");
        // Nothing may spill past the card's edges (the fixed-width card + a long project name).
        const overflow = await card.evaluate((el) => ({
          x: el.scrollWidth - el.clientWidth,
          y: el.scrollHeight - el.clientHeight,
          inViewport: el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= window.innerWidth,
        }));
        expect(overflow.x).toBeLessThanOrEqual(1);
        expect(overflow.y).toBeLessThanOrEqual(1);
        expect(overflow.inViewport).toBe(true);
        // The rewritten copy, verbatim.
        await expect(panel(page)).toContainText(`No schedule for “${LONG_NAME}” yet`);
        await expect(panel(page)).toContainText("Link one and it stays with this project across tabs.");
        await expect(panel(page).getByRole("button", { name: "Create schedule", exact: true })).toBeVisible();
        // The wordy old copy is gone.
        await expect(panel(page)).not.toContainText("Connect a schedule");
        await expect(panel(page)).not.toContainText("spin up");
        await page.screenshot({ path: `test-results/link-panel-${theme}-${size}.png`, fullPage: false });
      });
    }
  }
});
