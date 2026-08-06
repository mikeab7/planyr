/* NEW-1 / NEW-2 / NEW-3 / NEW-4 — the Stitch workspace, driven for real, LOGGED OUT.
 *
 * ⛔ The contract for this suite, verbatim from the owner: the assertion is
 *   "click the sheet row → a sheet is actually visible on the canvas".
 * "The handler was invoked" is not acceptable. So every check below reads the rendered SVG.
 *
 * The reports being pinned:
 *   NEW-1  clicking a sheet row, or its plus button, did nothing — silently, with zero network
 *          requests and no console error.
 *   NEW-2  the status bar read "Rendering…" permanently, unchanged after 20+ seconds, over an
 *          empty canvas.
 *   NEW-3  /#/markup opened full screen with no logo, no breadcrumb and none of the module tabs;
 *          the only exit was a "‹ Single sheet" link that doesn't read as an exit.
 *   NEW-4  every tray row rendered the identical truncated string.
 */
import { test, expect } from "@playwright/test";
import { dropSheetSet } from "./sheetSet.js";

const PAGES = 10;
/* A placed sheet on the stitch canvas is an <image> inside the world group. This is the picture
 * itself — not a handler, not a state flag. */
const placedImages = (p) => p.locator('svg image');
/* Tray rows located STRUCTURALLY — the row buttons are the direct button children of the tray
 * column, whose caption is "Sheets" / "Logical sheets". Deliberately not this branch's testid, so
 * the assertions below are mutation-checkable against the old build rather than short-circuiting on
 * a marker that only exists after the fix. */
const trayRows = (p) => p.locator('div:has(> div > div:text-matches("^(Logical sheets|Sheets)$")) > button');

/* Deliberately does NOT wait on a marker this branch introduced: the behaviour specs below must
 * measure the app's behaviour, not the presence of a new attribute. (Mutation-checked: with the
 * fixes reverted, the NEW-4 / NEW-2 assertions here fail on their own merits.) The NEW-3 specs, and
 * only those, assert the chrome directly. */
async function openStitch(page) {
  await page.goto("/#/markup", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Stitch/ }).first().click();
  // The stitcher is up when its own tray heading is: true before and after this branch.
  await expect(page.locator("text=/Logical sheets|^Sheets$/").first()).toBeVisible({ timeout: 15_000 });
}

test.describe("Stitch — a press on a sheet row puts a sheet on the canvas", () => {
  test("NEW-1 — clicking a tray row makes a sheet APPEAR on the canvas", async ({ page }) => {
    await openStitch(page);
    await dropSheetSet(page, PAGES);
    await expect.poll(() => trayRows(page).count(), { timeout: 60_000 }).toBeGreaterThan(0);

    const before = await placedImages(page).count();
    await trayRows(page).first().click();

    // THE assertion: a sheet is now visible on the canvas, with real pixels behind it.
    await expect.poll(() => placedImages(page).count(), { timeout: 45_000 }).toBeGreaterThan(before);
    const img = placedImages(page).first();
    await expect(img).toBeVisible();
    const href = await img.getAttribute("href");
    expect(href, "the placed sheet has no raster behind it").toMatch(/^(blob:|data:image)/);
    const box = await img.boundingBox();
    expect(box.width, "the placed sheet has no area on screen").toBeGreaterThan(4);
    // And the app's own tally agrees with what is painted — the picture and the bookkeeping match.
    const n = await placedImages(page).count();
    await expect(page.locator(`text=Placed sheets · ${n}`).first()).toBeVisible({ timeout: 10_000 });
  });

  test("NEW-1 — a SECOND row adds a second sheet, rather than the first click being the only one that ever works", async ({ page }) => {
    await openStitch(page);
    await dropSheetSet(page, PAGES);
    await expect.poll(() => trayRows(page).count(), { timeout: 60_000 }).toBeGreaterThan(1);
    await trayRows(page).first().click();
    await expect.poll(() => placedImages(page).count(), { timeout: 45_000 }).toBeGreaterThan(0);
    const one = await placedImages(page).count();
    await trayRows(page).nth(1).click();
    await expect.poll(() => placedImages(page).count(), { timeout: 45_000 }).toBeGreaterThan(one);
  });

  test("NEW-1 — a press that CANNOT run right now is answered, never swallowed", async ({ page }) => {
    await openStitch(page);
    await dropSheetSet(page, PAGES);
    await expect.poll(() => trayRows(page).count(), { timeout: 60_000 }).toBeGreaterThan(0);
    // Place a sheet, then click the SAME row again: the app must say something about it. The
    // failure mode this pins is the class, not the case — a user press that produces no visible
    // response at all.
    await trayRows(page).first().click();
    await expect.poll(() => placedImages(page).count(), { timeout: 45_000 }).toBeGreaterThan(0);
    const n = await placedImages(page).count();
    await trayRows(page).first().click();
    await page.waitForTimeout(1500);
    const responded = await page.evaluate(() => /already placed|still loading|couldn/i.test(document.body.innerText));
    const grew = (await placedImages(page).count()) > n;
    expect(responded || grew, "the press produced neither a sheet nor a word").toBe(true);
  });

  test("NEW-2 — the status bar reports real state and goes quiet when the work is done", async ({ page }) => {
    await openStitch(page);
    await dropSheetSet(page, PAGES);
    await expect.poll(() => trayRows(page).count(), { timeout: 60_000 }).toBeGreaterThan(0);
    await trayRows(page).first().click();
    await expect.poll(() => placedImages(page).count(), { timeout: 45_000 }).toBeGreaterThan(0);

    // The line must not survive the work it describes. (The old one was the fixed string
    // "Rendering…" and sat there indefinitely.)
    await expect.poll(async () => {
      const bar = page.getByTestId("stitch-status");
      if (!(await bar.count())) return "gone";
      return (await bar.getAttribute("data-phase")) || "";
    }, { timeout: 30_000 }).toMatch(/^(gone|idle|error)$/);
    await expect(page.locator("text=Rendering…")).toHaveCount(0);
  });

  test("NEW-3 — Stitch keeps the app chrome, and the tabs actually take you out of it", async ({ page }) => {
    await openStitch(page);
    // The chrome the owner said was missing: the module tabs.
    const reviewTab = page.getByTestId("module-tab-doc-review").filter({ visible: true });
    await expect(reviewTab).toBeVisible();
    await expect(page.getByTestId("module-tab-site-planner").filter({ visible: true })).toBeVisible();
    // An explicitly labelled exit, and it must WORK: pressing it leaves stitch mode.
    await expect(page.getByTestId("exit-stitch")).toBeVisible();
    await page.getByTestId("exit-stitch").click();
    await expect(page.locator('[data-review-mode="stitch"]')).toHaveCount(0, { timeout: 15_000 });
    // OUTCOME: we are in the single-sheet Review view — the one with the Stitch door in it.
    await expect(page.getByRole("button", { name: /Stitch/ }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("NEW-3 — a module tab leaves Review entirely, from inside Stitch", async ({ page }) => {
    await openStitch(page);
    await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click();
    await expect(page.getByTestId("module-tab-site-planner").filter({ visible: true }))
      .toHaveAttribute("aria-current", "page", { timeout: 20_000 });
  });

  test("NEW-4 — tray rows that differ only at the end are visibly different, and carry the full name", async ({ page }) => {
    await openStitch(page);
    await dropSheetSet(page, PAGES);
    await expect.poll(() => trayRows(page).count(), { timeout: 60_000 }).toBeGreaterThan(1);

    const readRows = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="stitch-tray-row"]')].map((b) => ({
      painted: b.innerText.replace(/\s+/g, " ").trim(),
      title: b.getAttribute("title") || "",
      // The pinned tail — what survives when the head box collapses to nothing.
      // The pinned tail (and the label it belongs to) — present only once middle-truncation ships;
      // on the old build these read "" and the painted-distinctness assertion is what fails.
      tail: (() => { const m = b.querySelector("[data-full]"); return m && m.children.length > 1 ? m.lastElementChild.textContent : ""; })(),
      full: (() => { const m = b.querySelector("[data-full]"); return m ? m.getAttribute("data-full") : ""; })(),
    })));

    const grouped = await readRows();
    // Every row has the whole name on hover — the split is display-only, nothing is lost.
    for (const r of grouped) expect(r.title.length, "a tray row with no tooltip").toBeGreaterThan(0);
    // The rows are TELLABLE APART by what is painted, which is the entire report.
    expect(new Set(grouped.map((r) => r.painted)).size, "grouped tray rows paint the same string").toBe(grouped.length);
    // head + tail is exactly the name: nothing invented, nothing dropped.
    for (const r of grouped) if (r.tail) expect(r.full.endsWith(r.tail)).toBe(true);

    // Now the owner's EXACT case: the raw per-page list, whose names are byte-identical except for
    // the trailing "· pN". Before this fix all 32 of his rows read "2024-10-08 - JACI…".
    await page.getByRole("button", { name: /all pages/i }).click();
    await expect.poll(() => trayRows(page).count(), { timeout: 20_000 }).toBe(PAGES);
    const perPage = await readRows();
    expect(new Set(perPage.map((r) => r.painted)).size, "per-page tray rows paint the same string").toBe(PAGES);
    // …and specifically by the PINNED TAIL, which is what a narrow rail leaves visible.
    expect(new Set(perPage.map((r) => r.tail)).size, "the pinned tails repeat").toBe(PAGES);
    for (const r of perPage) {
      expect(r.tail, "a per-page row pinned nothing").not.toBe("");
      expect(r.full.endsWith(r.tail)).toBe(true);
      expect(r.title).toMatch(/page \d+$/); // the tooltip names the page, which the old one never did
    }
  });
});
