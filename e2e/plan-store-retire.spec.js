/* B2200384 — THE WHOLE-LIBRARY DEVICE ENTRY IS RETIRED, AND NOTHING THAT READ THE PLANS NOTICES.
 *
 * A device that holds the old shape (ONE `planarfit:sites:v1` entry with every plan in it) is moved to one entry per plan on first load and the old
 * entry is deleted. Three things must stay true, and each is a place this change could have quietly broken a surface:
 *   1. a plan EDITED after the move survives a reload (the edit went to that plan's entry, not into a copy that no longer exists);
 *   2. the project switcher on the Notes, Model (Spreadsheet) and Dashboard routes — which read the plans through storage.js, not through the planner —
 *      still lists EVERY project, with the device holding no whole-library entry at all;
 *   3. nothing ever writes the whole-library entry again.
 * The unit half (every failure path, mutation-proven) is test/planStore.test.js; the real filled-localStorage half is ui-audit/verify-plan-store.mjs --tight.
 */
import { test, expect } from "@playwright/test";
import { drawBuilding, canvas } from "./drawKinds.js";

const KEY = "planarfit:sites:v1";

test.describe("the whole-library entry is retired", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((key) => {
      window.__PLANYR_E2E = true;
      try {
        if (!sessionStorage.getItem("zz-retire-seeded")) {            // seed ONCE: the old shape, before the app's first read
          sessionStorage.setItem("zz-retire-seeded", "1");
          const mk = (id, g, site, name, bump = 0) => ({ id, groupId: g, site, name, status: "pursuit", role: "pursuit", origin: { lat: 29.7, lon: -95.4 }, updatedAt: Date.now() + bump, parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {} });
          localStorage.setItem(key, JSON.stringify({
            zzr1: mk("zzr1", "zzg1", "ZZ Retire Alpha", "Concept A", 5000),   // the newest plan of its project: the one a deep link opens
            zzr2: mk("zzr2", "zzg1", "ZZ Retire Alpha", "Concept B"),
            zzr3: mk("zzr3", "zzg2", "ZZ Retire Beta", "Plan 1"),
          }));
        }
      } catch (_) {}
    }, KEY);
  });

  const state = (page) => page.evaluate((key) => {
    const ids = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(key + ":p:")) ids.push(k.slice((key + ":p:").length)); }
    let idx = null; try { idx = JSON.parse(localStorage.getItem(key + ":idx")); } catch (_) {}
    return { ids: ids.sort(), legacy: localStorage.getItem(key), ledger: localStorage.getItem(key + ":led"), retired: !!(idx && idx.legacyRetired) };
  }, KEY);

  test("the old entry is moved plan by plan and removed; every project is still listed on Notes, Model and the Site Planner", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/site-planner");
    await expect.poll(async () => (await state(page)).retired, { timeout: 30_000 }).toBe(true);
    const s = await state(page);
    expect(s.ids).toEqual(["zzr1", "zzr2", "zzr3"]);
    expect(s.legacy).toBeNull(); expect(s.ledger).toBeNull();

    // the writes from here on never touch the whole-library key
    await page.evaluate((key) => {
      window.__legacyWrites = 0; const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === key) window.__legacyWrites++; return orig.call(this, k, v); };
    }, KEY);

    for (const route of ["#/project/zzg1/notes", "#/project/zzg1/spreadsheet", "#/project/zzg1/site"]) {
      await page.goto("/" + route);
      const crumb = page.getByTestId("project-crumb").filter({ visible: true }).first();
      await crumb.waitFor({ state: "visible", timeout: 30_000 });
      await crumb.click();
      const list = page.getByTestId("project-list-scroll");
      await expect(list, `${route}: the project list`).toBeVisible({ timeout: 15_000 });
      await expect(list, `${route}: Alpha`).toContainText("ZZ Retire Alpha");
      await expect(list, `${route}: Beta`).toContainText("ZZ Retire Beta");
      await page.keyboard.press("Escape");
    }
    expect((await state(page)).legacy).toBeNull();
    expect(await page.evaluate(() => window.__legacyWrites || 0)).toBe(0);
  });

  test("a plan edited AFTER the move survives a reload", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/project/zzg1/site");
    await canvas(page).waitFor({ state: "visible", timeout: 45_000 });
    await expect.poll(async () => (await state(page)).retired, { timeout: 30_000 }).toBe(true);
    await drawBuilding(page, await canvas(page).boundingBox());
    const before = await page.evaluate((key) => { const out = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(key + ":p:")) { try { out[k.slice((key + ":p:").length)] = (JSON.parse(localStorage.getItem(k)).els || []).length; } catch (_) {} } } return out; }, KEY);
    const edited = Object.keys(before).filter((id) => before[id] > 0);
    expect(edited.length).toBe(1);                                          // exactly one plan took the edit
    await page.reload();
    await canvas(page).waitFor({ state: "visible", timeout: 45_000 });
    const after = await page.evaluate((key) => { const out = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(key + ":p:")) { try { out[k.slice((key + ":p:").length)] = (JSON.parse(localStorage.getItem(k)).els || []).length; } catch (_) {} } } return out; }, KEY);
    expect(after).toEqual(before);                                          // the reload lost and invented nothing
    expect((await state(page)).legacy).toBeNull();
  });
});
