/* Address / place suggestion lists — keyboard picking (owner report 2026-10-29: "you can't use the up or down keys to pick one of the
 * drop-down suggestions. Or if it does work, I can't see it.").
 *
 * MEASURED on planyr.io before the fix: the keys DID work (aria-activedescendant moved, aria-selected flipped) and the highlighted row's
 * computed background was rgb(255,255,255) — the list's own background — so the highlight was drawn and invisible. Red on main:
 * "the highlighted row is visibly different from the list" (both themes). The rest are the behaviours the owner listed, asserted so the
 * shared list (shared/ui/useListboxNav.js) cannot lose them: Down ×2 + Enter picks row 2 exactly as a click would, Up wraps, Escape
 * closes and keeps the typed text, the caret does not jump, hover and keyboard share one highlight, typing resets it.
 *
 * Covers the map toolbar's address field (PlaceSearchField — the geocoder list) with the geocoder STUBBED (the sandbox network varies; the
 * list's behaviour is what is under test). The Food search and the comp party-name field use the same hook; their sources are pure
 * source-guarded in test/listboxNav.test.js.
 *
 * Run: npx playwright test e2e/address-suggest-keyboard.spec.js
 */
import { test, expect } from "@playwright/test";

const ADDRS = ["100 Main St, Houston, TX", "200 Main St, Houston, TX", "300 Main St, Houston, TX", "400 Main St, Houston, TX"];
const input = (p) => p.getByRole("combobox", { name: "Search for an address or place" }).first();
const options = (p) => p.locator('[role="listbox"] [role="option"]');

async function open(page, theme) {
  await page.route(/geocode\.arcgis\.com\/.*findAddressCandidates/, (r) => r.fulfill({
    status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ candidates: ADDRS.map((a, i) => ({ address: a, location: { x: -95.3 + i * 0.01, y: 29.7 } })) }),
  }));
  await page.addInitScript((t) => { try { localStorage.setItem("planyr.theme", t); } catch (_) {} }, theme);
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.locator(".leaflet-container").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  const live = await page.evaluate(async (t) => {
    document.documentElement.setAttribute("data-theme", t);
    const raf = await Promise.race([new Promise((r) => requestAnimationFrame(() => r("raf"))), new Promise((r) => setTimeout(() => r("timeout"), 1500))]);
    return { vis: document.visibilityState, raf };
  }, theme);
  expect(live).toEqual({ vis: "visible", raf: "raf" }); // FOREGROUND-OR-VOID
  await input(page).click();
  await page.keyboard.type("main st", { delay: 20 });
  // 4 stubbed hits + the "Press ⏎ to search" row — proves the instrument can see a populated list before anything is judged.
  await expect(options(page)).toHaveCount(ADDRS.length + 1, { timeout: 8000 });
}
// WCAG contrast between two computed "rgb(...)" colours — a highlight must be seen against the list it sits on (≥ 3:1, the graphics floor).
const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const state = (page) => page.evaluate(() => {
  const i = document.querySelector('input[role="combobox"][aria-label="Search for an address or place"]');
  const rows = [...document.querySelectorAll('[role="listbox"] [role="option"]')];
  const list = rows[0] && rows[0].parentElement;
  const active = i.getAttribute("aria-activedescendant");
  return {
    activeIdx: active ? rows.findIndex((r) => r.id === active) : -1,
    selected: rows.map((r) => r.getAttribute("aria-selected") === "true"),
    listBg: list ? getComputedStyle(list).backgroundColor : null,
    rowBg: rows.map((r) => getComputedStyle(r).backgroundColor),
    rowInk: rows.map((r) => getComputedStyle(r).color),
    value: i.value, caret: [i.selectionStart, i.selectionEnd],
  };
});

for (const theme of ["light", "dark"]) {
  test.describe(`address suggestion list keyboard — ${theme} theme`, () => {
    test("the highlighted row is VISIBLY different from the list (solid fill, readable ink)", async ({ page }) => {
      await open(page, theme);
      const before = await state(page);
      expect(before.activeIdx, "nothing highlighted until a key is pressed").toBe(-1);
      await page.keyboard.press("ArrowDown");
      const s = await state(page);
      expect(s.activeIdx, "Down from the box enters at row 1").toBe(0);
      expect(s.selected).toEqual([true, false, false, false, false]);
      expect(contrast(s.rowBg[0], s.listBg), `the highlight (${s.rowBg[0]}) must be seen against the list (${s.listBg}) — at least 3:1`).toBeGreaterThanOrEqual(3);
      expect(contrast(s.rowInk[0], s.rowBg[0]), "the highlighted row's text is readable (AA)").toBeGreaterThanOrEqual(4.5);
      expect(s.rowBg[0], "the highlight is a solid fill, not transparent").not.toBe("rgba(0, 0, 0, 0)");
      expect(s.rowBg[1], "a row that is not highlighted shows the list").toBe("rgba(0, 0, 0, 0)");
    });

    test("Down, Down, Enter picks the second address; the typed text is never rewritten by navigation", async ({ page }) => {
      await open(page, theme);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      const s = await state(page);
      expect(s.activeIdx).toBe(1);
      expect(s.value, "navigating never rewrites the input").toBe("main st");
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await state(page)).value, { message: "Enter on a highlighted row = a click on it" }).toBe(ADDRS[1]);
    });

    test("Up wraps from the first row to the last; Down enters; Escape closes and keeps the text; typing resets", async ({ page }) => {
      await open(page, theme);
      await page.keyboard.press("ArrowUp");
      expect((await state(page)).activeIdx, "Up from the box enters at the last row").toBe(ADDRS.length);
      await page.keyboard.press("ArrowDown");
      expect((await state(page)).activeIdx, "Down past the end wraps to row 1").toBe(0);
      await page.keyboard.type("x");
      expect((await state(page)).activeIdx, "typing resets the highlight").toBe(-1);
      await expect(options(page).first()).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Escape");
      await expect(options(page)).toHaveCount(0);
      expect((await state(page)).value, "Escape keeps the typed text").toBe("main stx");
    });

    test("the caret does not jump while the list is open, and hover and keyboard share one highlight", async ({ page }) => {
      await open(page, theme);
      const len = "main st".length;
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      expect((await state(page)).caret, "Up/Down are not caret keys while the list is open").toEqual([len, len]);
      const box = await options(page).nth(2).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 1);
      expect((await state(page)).activeIdx, "hover moves the highlight").toBe(2);
      await page.keyboard.press("ArrowDown");
      expect((await state(page)).activeIdx, "a later arrow continues from where the pointer left it").toBe(3);
    });
  });
}
