/* NEW-1 / NEW-2 — the Layers panel scrolls, and an out-of-state source is DEMOTED, never dropped.
 *
 * The owner's report, both on the panel:
 *   • "It does not scroll… obviously horrible, because then I cannot get to everything."
 *   • On a Colorado site the list still offers Texas-only sources — he named the Railroad
 *     Commission — so a toggle produces an empty map with no way to tell "nothing here" from
 *     "we do not carry this here."
 *
 * ⛔ WHY THIS IS AN E2E SPEC AND NOT A UNIT TEST. NEW-1 is a pure LAYOUT defect and every module
 * involved was already written correctly: the scroll box carried `flex:1; minHeight:0;
 * overflowY:auto`, the wheel handler already exempted `[data-wheelscroll]`, and no source reading
 * of any file shows the bug. It exists only in the resolved cascade — an ancestor's percentage
 * `max-height` silently computing to `none` against an indefinite containing block — so the only
 * honest observable is the REAL element's `scrollHeight` vs `clientHeight` in a real browser, plus
 * the last row actually reachable and hit-testable at a realistic viewport height. The Texas
 * golden-master harness deliberately checks NUMBERS, not pixels, and is structurally blind to it.
 */
import { test, expect } from "@playwright/test";

const mkSite = (id, name, lat, lon, county) => ({
  schemaVersion: 12, id, groupId: id, site: name, name,
  updatedAt: 1783000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat, lon }, county, status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1800, y: 0 }, { x: 1800, y: 1400 }, { x: 0, y: 1400 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {},
  els: [{ id: "b1", type: "building", cx: 500, cy: 500, w: 700, h: 400, rot: 0 }],
});

// Baytown (Harris Co.) and a Weld County, CO tract — the owner's two real cases.
const TX_SITE = mkSite("lp-scroll-tx", "LP Scroll TX", 29.735, -94.977, "harris");
const CO_SITE = mkSite("lp-scroll-co", "LP Scroll CO", 40.19, -104.72, "co_weld");

const PANEL = '[data-testid="layer-panel"][data-surface="planner"]';

async function openLayers(page, site) {
  // Logged out, no external GIS: images are aborted so the run is hermetic and Claude-verifiable
  // here (VERIFICATION.md rule 4 — this is not a live-blocker class).
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} },
    JSON.stringify({ [site.id]: site }));
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText(site.name, { exact: false }).first().click();
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 25000 });
  await page.waitForTimeout(1000);
  // BOTH hosts stay mounted (the finder's copy is hidden), so target the visible control and
  // assert against the planner SURFACE, never against page text.
  await page.getByRole("button", { name: /^\s*❖?\s*Layers/ }).filter({ visible: true }).first().click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(500);
}

test.describe("NEW-1 — the Layers panel scrolls, and the last row is reachable", () => {
  // It failed at EVERY realistic height, not only short ones: the card resolved to its full
  // content height regardless of the room it was given, so the overflow scaled with the viewport
  // instead of the shortfall. All four are asserted so a fix that only works when there is plenty
  // of room cannot pass.
  for (const height of [1000, 800, 700, 600]) {
    test(`the list overflows and scrolls at ${height}px tall`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height });
      await openLayers(page, TX_SITE);

      const m = await page.evaluate((sel) => {
        const root = document.querySelector(sel);
        const scroller = root.parentElement;   // the declared overflowY:auto box
        scroller.scrollTop = 999999;
        return {
          clientH: scroller.clientHeight,
          scrollH: scroller.scrollHeight,
          scrolledTo: scroller.scrollTop,
          overflowY: getComputedStyle(scroller).overflowY,
          rows: root.querySelectorAll('input[type="checkbox"]').length,
        };
      }, PANEL);

      // The scroll box must be BOUNDED by the room available, not grown to its content.
      expect(m.overflowY).toBe("auto");
      expect(m.rows).toBeGreaterThan(10);                 // enough rows to overflow at all
      expect(m.clientH).toBeLessThan(height);             // it is not taller than the window
      expect(m.scrollH).toBeGreaterThan(m.clientH + 1);   // it genuinely overflows…
      expect(m.scrolledTo).toBeGreaterThan(1);            // …and scrolling actually moves it
    });
  }

  test("the LAST row is reachable and takes a press, at the shortest height", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await openLayers(page, TX_SITE);

    /* ⛔ THE GESTURE MUST BE A REAL WHEEL, NOT `scrollIntoView`. Written the easy way this test
     * PASSED ON THE BUG: `scrollIntoView` walks up and scrolls whatever ancestor will move,
     * including one the user has no way to reach, so it proved only that the row exists in the
     * DOM. The owner's sentence is "I cannot get to everything" — the thing under test is the
     * gesture he actually has. A real wheel also exercises the app-specific hazard: this canvas
     * binds a non-passive wheel handler that `preventDefault`s to zoom the map, so if the panel
     * were not exempt from it, CSS could be perfect and the list would still refuse to move. */
    /* ⛔ Hover the SCROLLER's visible centre, not the panel ROOT's box centre. The root is the
     * list's full content height (taller than the box that shows it), so its own centre sits
     * BELOW the scrollport — off the bottom of a short viewport entirely — and the wheel then
     * lands on the map instead of the list. That mistake made this test fail intermittently
     * against a perfectly good fix, which is its own small lesson: aim at the box that scrolls. */
    const pt = await page.evaluate((sel) => {
      const r = document.querySelector(sel).parentElement.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: (Math.max(0, r.top) + Math.min(window.innerHeight, r.bottom)) / 2 };
    }, PANEL);
    await page.mouse.move(pt.x, pt.y);
    for (let i = 0; i < 25; i++) await page.mouse.wheel(0, 200);   // a plain wheel, over the list
    await page.waitForTimeout(300);

    const res = await page.evaluate((sel) => {
      const root = document.querySelector(sel);
      const boxes = root.querySelectorAll('input[type="checkbox"]');
      const last = boxes[boxes.length - 1];
      const b = last.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return {
        scrolled: root.parentElement.scrollTop,
        inViewport: b.top >= 0 && b.bottom <= window.innerHeight,
        ownsItsCentre: top === last,
      };
    }, PANEL);
    expect(res.scrolled).toBeGreaterThan(1);   // the wheel moved the LIST, not the map
    // …and the last row is now inside the window AND the topmost thing at its own centre
    // (CHROME-NEVER-EATS-A-PRESS, applied to the panel).
    expect(res.inViewport).toBe(true);
    expect(res.ownsItsCentre).toBe(true);

    // And it is genuinely operable, not merely visible.
    const last = page.locator(`${PANEL} input[type="checkbox"]`).last();
    const before = await last.isChecked();
    await last.click();
    expect(await last.isChecked()).toBe(!before);
  });

  test("the fix adds no invisible click-eating strip down the right of the map", async ({ page }) => {
    // The height fix works by making the card row's height DEFINITE. A full-height row that still
    // claimed pointer events would swallow every press beside the collapsed cards — so the row is
    // transparent to the pointer and each card claims its own presses back. Worst case is both
    // cards collapsed, which is what this drives.
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLayers(page, TX_SITE);
    await page.getByRole("button", { name: /^\s*❖?\s*Layers/ }).filter({ visible: true }).first().click();
    await page.waitForTimeout(300);

    const r = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-wheelscroll="1"]')].filter((n) => n.offsetParent);
      const bottom = Math.max(...cards.map((c) => c.getBoundingClientRect().bottom));
      const right = Math.max(...cards.map((c) => c.getBoundingClientRect().right));
      const el = document.elementFromPoint(right - 40, bottom + 200);
      return { insideACard: !!(el && el.closest('[data-wheelscroll="1"]')) };
    });
    expect(r.insideACard).toBe(false);
  });
});

test.describe("NEW-2 — an out-of-state source is DEMOTED into the list, never hidden", () => {
  test("Colorado demotes the Texas Railroad Commission rows, and they stay READABLE", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openLayers(page, CO_SITE);

    const before = await page.locator(PANEL).innerText();
    // Not offered as an ordinary toggle…
    expect(before).not.toContain("Oil & gas wells");
    expect(before).not.toContain("Pipeline easement corridor");
    // …but the panel SAYS SO, per group, rather than going quiet.
    expect(before).toMatch(/not available in Colorado/);

    // ⛔ The load-bearing half: the user can still SEE that the RRC exists, is real, and does not
    // apply here. Absence of data must never wear the costume of an answer.
    for (const b of await page.locator(`${PANEL} button`, { hasText: /not available in/ }).all()) await b.click();
    const after = await page.locator(PANEL).innerText();
    expect(after).toContain("Oil & gas wells");
    expect(after).toContain("Pipelines");
    expect(after).toMatch(/Texas-only/);
    expect(after).toMatch(/no Colorado equivalent is wired yet/);

    // Demoted rows are inert, not clickable toggles that would produce an empty map.
    const wells = page.locator(`${PANEL} input[aria-label*="Oil & gas wells"]`).first();
    await expect(wells).toBeDisabled();
    await expect(wells).not.toBeChecked();
  });

  test("a MERGED row survives while only its Texas members are out of state", async ({ page }) => {
    // "Water & sewer" bundles the Texas CCN / MUD / City-of-Houston mains WITH Colorado's water &
    // sanitation districts. Reading the slot's state off its first member would demote the whole
    // row and silently remove the one source a Colorado site needs — the exact failure this item
    // exists to stop, arriving through the fix for it.
    await page.setViewportSize({ width: 1280, height: 900 });
    await openLayers(page, CO_SITE);
    const txt = await page.locator(PANEL).innerText();
    expect(txt).toContain("Water & sewer");
    expect(txt).toContain("Fire hydrants");
  });

  test("Texas is unchanged — the RRC rows are ordinary toggles there", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openLayers(page, TX_SITE);
    const txt = await page.locator(PANEL).innerText();
    expect(txt).toContain("Oil & gas wells");
    expect(txt).toContain("Pipelines");
    expect(txt).not.toMatch(/Oil & gas wells[\s\S]{0,80}Texas-only/);
    await expect(page.locator(`${PANEL} input[aria-label*="Oil & gas wells"]`)).toHaveCount(0); // not a demoted row
  });
});
