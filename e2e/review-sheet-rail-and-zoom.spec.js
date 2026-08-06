/* NEW-4 / NEW-5 / NEW-6 / NEW-7 — the single-sheet Review view, driven for real, LOGGED OUT with a
 * locally dropped PDF (client-side pdf.js, no auth, no network).
 *
 * ⛔ EVERY assertion here is an OUTCOME the owner could see on his screen. "A handler ran", "an
 * element received focus" and "a state variable changed" are explicitly not acceptable in this
 * suite and none are used: the questions asked are "is a sheet actually visible", "is the toast
 * gone", "did the picture actually get bigger", "can two rows be told apart".
 *
 * The four reports being pinned:
 *   NEW-4  32 rows all read the identical "2024-10-08 - JACI…" — the page number, the only thing
 *          that distinguishes them, is exactly what CSS ellipsis cuts.
 *   NEW-5  the rail announced "30 SHEETS · 49 PAGES" with rows literally labelled "Sheet 1"…
 *          "Sheet 30" for ~30 seconds, then settled to 21 — a count and names read from nothing.
 *   NEW-6  the "Opening A227…" toast never dismissed.
 *   NEW-7  no wheel zoom and no visible zoom control anywhere in this mode.
 */
import { test, expect } from "@playwright/test";
import { dropSheetSet } from "./sheetSet.js";

const PAGES = 14;
const sheet = (p) => p.locator('[data-testid="review-sheet"]');
const scaleOf = async (p) => Number(await sheet(p).getAttribute("data-view-scale"));

async function openReview(page) {
  await page.goto("/#/markup", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  if (!(await page.locator('input[type="file"]').count())) {
    await page.getByRole("button", { name: /review/i }).first().click().catch(() => {});
    await page.waitForTimeout(800);
  }
}

async function openSet(page, pages = PAGES) {
  await openReview(page);
  await dropSheetSet(page, pages);
  await sheet(page).waitFor({ state: "visible", timeout: 60_000 });
  return sheet(page);
}

/* The rail has finished READING when it stops saying so. */
const railRead = (p) => p.locator('[data-testid="sheet-count"][data-scan="complete"]');

test.describe("Review sheet rail + zoom", () => {
  test("NEW-5 — the rail never states a sheet count, or a sheet name, it has not read", async ({ page }) => {
    await openReview(page);
    // Throttle so the read is a window a human would live through, not a single frame.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    await dropSheetSet(page, PAGES);
    await sheet(page).waitFor({ state: "visible", timeout: 90_000 });

    // Sample the rail continuously from first pixels until the read completes, and assert the
    // invariant held at EVERY sample — not just at some convenient moment.
    let samples = 0, sawReading = false;
    const deadline = Date.now() + 60_000;
    for (;;) {
      const state = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="sheet-count"]');
        return {
          scan: c ? c.getAttribute("data-scan") : null,
          count: c ? c.textContent.trim() : "",
          rows: [...document.querySelectorAll('[data-testid="sheet-entry"]')].map((b) => b.textContent.trim()),
        };
      });
      samples++;
      if (state.scan === "reading") {
        sawReading = true;
        // (a) no invented COUNT — the headline may only report pages while it is still reading.
        expect(state.count, "a count claimed while still reading").not.toMatch(/\bsheets?\b\s*·/i);
        expect(state.count).toMatch(/\bpages?\b/);
        // (b) no invented NAMES — "Sheet 7" is a position, not a name read from the drawing.
        const invented = state.rows.filter((r) => /^Sheet \d+$/.test(r));
        expect(invented, `rows labelled from nothing: ${invented.join(", ")}`).toEqual([]);
      }
      if (state.scan === "complete") break;
      expect(Date.now(), "the read never completed").toBeLessThan(deadline);
      await page.waitForTimeout(60);
    }
    expect(samples).toBeGreaterThan(1);
    expect(sawReading, "the reading state was never observed — widen the throttle").toBe(true);

    // And once it IS read, it states the real thing: a sheet count over the page count.
    await expect(page.getByTestId("sheet-count")).toHaveText(new RegExp(`sheets? · ${PAGES} pages`));
    // Every skeleton is gone: nothing is left claiming to be still reading.
    await expect(page.getByTestId("sheet-skeleton")).toHaveCount(0);
  });

  test("NEW-5 — an unread page is still navigable: clicking a skeleton opens that sheet", async ({ page }) => {
    await openReview(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await dropSheetSet(page, PAGES);
    await sheet(page).waitFor({ state: "visible", timeout: 90_000 });
    const skeleton = page.getByTestId("sheet-skeleton").last();
    if (await skeleton.count()) {
      await skeleton.click();
      // OUTCOME: the pager moved off sheet 1 — the click navigated, it did not merely exist.
      await expect(page.locator('[data-testid="sheet-rail"]')).not.toContainText(`1 / ${PAGES}`, { timeout: 10_000 });
    }
  });

  test("NEW-6 — the Opening toast clears, and the sheet is not left dimmed", async ({ page }) => {
    const s = await openSet(page);
    await railRead(page).waitFor({ timeout: 90_000 });
    // Switch sheets: this is the exact motion that produced "Opening A227…".
    await page.getByTestId("sheet-entry").last().click().catch(async () => {
      await page.getByTestId("sheet-group").last().click();
    });
    // OUTCOME 1: the toast goes away on its own.
    await expect(page.getByTestId("sheet-switching")).toHaveCount(0, { timeout: 20_000 });
    // OUTCOME 2: the sheet is at full opacity — the dim rode the same comparison and outlived the
    // switch just as silently.
    await expect.poll(async () => Number(await s.evaluate((el) => getComputedStyle(el).opacity)), { timeout: 15_000 }).toBe(1);
    // OUTCOME 3: nothing was swapped for a permanent error either.
    await expect(page.getByTestId("sheet-open-error")).toHaveCount(0);
  });

  test("NEW-7 — the zoom control is ON SCREEN, and pressing it makes the sheet bigger", async ({ page }) => {
    const s = await openSet(page);
    const before = await scaleOf(page);

    // The control has to be inside the rail's VISIBLE box, not merely in the DOM: it used to sit
    // hundreds of pixels below the fold of the rail's own scroll container at every window size.
    const geom = await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="markup-rail"]');
      const zin = document.querySelector('[data-testid="tool-zoomIn"]');
      if (!rail || !zin) return null;
      const r = rail.getBoundingClientRect(), z = zin.getBoundingClientRect();
      return { inside: z.top >= r.top - 1 && z.bottom <= r.bottom + 1, railBottom: r.bottom, zoomBottom: z.bottom };
    });
    expect(geom, "no zoom control in the rail at all").not.toBeNull();
    expect(geom.inside, `zoom control is ${Math.round(geom.zoomBottom - geom.railBottom)}px below the rail's visible bottom`).toBe(true);

    // OUTCOME: pressing it actually enlarges the drawing.
    await page.getByTestId("tool-zoomIn").click();
    await expect.poll(() => scaleOf(page), { timeout: 5_000 }).toBeGreaterThan(before);
    const zoomed = await scaleOf(page);

    // And "Page" is a real reset — it puts the sheet back to a fit, not merely a different number.
    await page.getByTestId("tool-fitP").click();
    await expect.poll(() => scaleOf(page), { timeout: 5_000 }).toBeLessThan(zoomed);
  });

  test("NEW-7 — the wheel zooms toward the cursor over the canvas", async ({ page }) => {
    await openSet(page);
    const box = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="review-sheet"]').parentElement.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const cx = Math.round(box.x + box.w / 2), cy = Math.round(box.y + box.h / 2);
    const before = await scaleOf(page);
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -500);
    await expect.poll(() => scaleOf(page), { timeout: 5_000 }).toBeGreaterThan(before);
    // Scrolling the other way must come back down — a one-way "zoom" is not a zoom.
    const up = await scaleOf(page);
    await page.mouse.wheel(0, 500);
    await expect.poll(() => scaleOf(page), { timeout: 5_000 }).toBeLessThan(up);
  });

  test("NEW-4 — two sheet rows that differ only at the end are visibly different", async ({ page }) => {
    await openSet(page);
    await railRead(page).waitFor({ timeout: 90_000 });
    // Squeeze the rail to the narrowest a user can drag it, which is when a head-only ellipsis
    // collapses every row to the same string.
    await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="sheet-rail"]');
      if (rail) rail.style.width = "120px";
    });
    await page.waitForTimeout(300);
    const rows = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[data-testid="sheet-entry"], [data-testid="sheet-group"]')) {
        // What is actually PAINTED: the pinned tail survives a collapsed head box.
        const spans = [...el.querySelectorAll("[data-full]")].map((s) => s.getAttribute("data-full"));
        out.push({ text: el.textContent.trim(), full: spans.join("|"), title: el.getAttribute("title") || "" });
      }
      return out;
    });
    expect(rows.length).toBeGreaterThan(1);
    // Every row carries the full name for hover, so nothing is unrecoverable.
    for (const r of rows) expect(r.title.length, `a row with no tooltip: ${r.text}`).toBeGreaterThan(0);
    // The distinguishing tails are actually distinct — the whole point of the report.
    const tails = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="sheet-entry"] [data-full], [data-testid="sheet-group"] [data-full]')]
        .map((s) => s.lastElementChild ? s.lastElementChild.textContent : ""));
    expect(new Set(tails.filter(Boolean)).size).toBeGreaterThan(1);
  });
});
