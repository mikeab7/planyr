/* NEW-1 — Google Earth (KMZ) export lives under File ▾ (not only on the canvas right-click).
 *
 * The owner opened File looking for it, found only PNG / PDF and concluded it was gone. It was only on
 * the empty-canvas right-click. Asserted here, on the real built app:
 *   • File ▾ shows "Export to Google Earth (KMZ)" + "Export with 3D buildings", enabled on a LOCATED plan;
 *   • on an UNLOCATED plan both are greyed WITH the reason (title) and a click downloads nothing;
 *   • the same two rows ride the toolbar's More menu when File is folded into it (menuRows);
 *   • the labels fit the menu (no clipping);
 *   • clicking the KMZ row downloads a non-empty .kmz — a real zip holding doc.kml with lon,lat coordinates —
 *     and the Blob carries the Google Earth MIME;
 *   • the canvas right-click NO LONGER carries the export (owner amendment 2026-10-22: File ▾ is the one home).
 * Red on 0fef933 (the rows do not exist there).
 */
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE_ID = "e2e-file-menu-kmz";
const REASON = "Place this plan on the map first";

function plan(origin) {
  return {
    id: SITE_ID, groupId: SITE_ID, site: "KMZ File Menu — throwaway", name: "ZZ kmz",
    origin, county: "harris",
    parcels: [{ id: "pc1", active: true, addr: "123 Test Rd", points: [{ x: -400, y: -300 }, { x: 400, y: -300 }, { x: 400, y: 300 }, { x: -400, y: 300 }] }],
    els: [{ id: "b1", type: "building", cx: 0, cy: 0, w: 400, h: 200, rot: 0 }],
    markups: [], measures: [], callouts: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
}

async function load(page, origin, { fold = false } = {}) {
  await armPlannerHooks(page);
  // Record the MIME of every Blob handed to createObjectURL — the download itself only exposes a filename.
  await page.addInitScript(() => {
    window.__blobTypes = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { try { window.__blobTypes.push(b && b.type); } catch { /* ignore */ } return orig(b); };
  });
  await page.addInitScript(([id, rec]) => {
    if (localStorage.getItem("planarfit:currentSite:v1") === id) return;
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, plan(origin)]);
  await page.goto(`/#/project/${SITE_ID}/site`, { waitUntil: "load" });
  await expect(canvas(page)).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(600);
  if (fold) {
    // The Site row-2 toolbar folds by its OWN box (a bare plan at any desktop width never fills it), so squeeze that box
    // the way a small window or a docked panel would, and wait for the real fold (File leaves the bar, More appears).
    await page.evaluate(() => {
      const t = document.querySelector('[data-priority-toolbar="site-actions"]');
      let n = t; for (let i = 0; i < 3 && n; i++, n = n.parentElement) { n.style.maxWidth = "300px"; n.style.overflow = "hidden"; }
    });
    await expect(page.getByRole("button", { name: /^File/ })).toHaveCount(0, { timeout: 8000 });
  }
}

const fileBtn = (p) => p.getByRole("button", { name: /^File/ }).first();
const kmzRow = (p) => p.getByTestId("file-export-kmz");
const kmz3dRow = (p) => p.getByTestId("file-export-kmz-3d");

function unzipFirst(buf) {
  expect(buf.readUInt32LE(0), "zip local-file signature").toBe(0x04034b50);
  const method = buf.readUInt16LE(8), comp = buf.readUInt32LE(18), nlen = buf.readUInt16LE(26), elen = buf.readUInt16LE(28);
  const name = buf.slice(30, 30 + nlen).toString("utf8");
  const data = buf.slice(30 + nlen + elen, 30 + nlen + elen + comp);
  return { name, text: (method === 0 ? data : inflateRawSync(data)).toString("utf8") };
}

test.describe("NEW-1 — File ▾ carries the Google Earth export", () => {
  test("located plan: both rows are in File ▾, enabled, fit their menu, and the KMZ row downloads a real .kmz", async ({ page }) => {
    await load(page, { lat: 29.786, lon: -95.83 });
    await fileBtn(page).click();
    await expect(page.getByRole("button", { name: "Export PNG", exact: true })).toBeVisible();
    await expect(kmzRow(page)).toBeVisible();
    await expect(kmz3dRow(page)).toBeVisible();
    await expect(kmzRow(page)).toBeEnabled();
    await expect(kmz3dRow(page)).toBeEnabled();
    await expect(kmzRow(page)).toHaveText("Export to Google Earth (KMZ)");
    await expect(kmz3dRow(page)).toHaveText("Export with 3D buildings");
    // No clipping: the row's text fits its own box and the box sits inside the menu panel.
    for (const row of [kmzRow(page), kmz3dRow(page)]) {
      const m = await row.evaluate((el) => {
        const r = el.getBoundingClientRect(), panel = el.parentElement.getBoundingClientRect();
        return { sw: el.scrollWidth, cw: el.clientWidth, inside: r.left >= panel.left - 0.5 && r.right <= panel.right + 0.5 };
      });
      expect(m.sw, "label must not overflow its row").toBeLessThanOrEqual(m.cw);
      expect(m.inside, "row must sit inside the menu panel").toBe(true);
    }

    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), kmzRow(page).click()]);
    expect(dl.suggestedFilename()).toMatch(/\.kmz$/);
    const buf = await readFile(await dl.path());
    expect(buf.length, "non-empty .kmz").toBeGreaterThan(200);
    const { name, text } = unzipFirst(buf);
    expect(name).toBe("doc.kml");
    const m = text.match(/<coordinates>\s*(-?\d+\.\d+),(-?\d+\.\d+)/);
    expect(m, "KML has coordinates").not.toBeNull();
    expect(Number(m[1])).toBeLessThan(-90); // lon first
    expect(Number(m[2])).toBeGreaterThan(29); // then lat
    expect(text).toContain("Building 1");
    expect(await page.evaluate(() => window.__blobTypes)).toContain("application/vnd.google-earth.kmz");
    await expect(page.getByRole("button", { name: "Export PNG", exact: true })).toHaveCount(0); // menu closed after the pick

    // The 3D row downloads too, and extrudes.
    await fileBtn(page).click();
    const [dl3] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), kmz3dRow(page).click()]);
    expect(unzipFirst(await readFile(await dl3.path())).text).toContain("<extrude>1</extrude>");
  });

  test("unlocated plan: both rows are greyed with the reason, and a click downloads nothing", async ({ page }) => {
    await load(page, null);
    let downloads = 0;
    page.on("download", () => { downloads += 1; });
    await fileBtn(page).click();
    for (const row of [kmzRow(page), kmz3dRow(page)]) {
      await expect(row).toBeVisible();
      await expect(row).toBeDisabled();
      await expect(row).toHaveAttribute("title", REASON);
    }
    await kmzRow(page).click({ force: true });
    await page.waitForTimeout(500);
    expect(downloads).toBe(0);
  });

  test("File folded into More: the same two rows are reachable there (menuRows), disabled with the reason when unlocated", async ({ page }) => {
    await load(page, null, { fold: true });
    const more = page.locator('[data-priority-toolbar="site-actions"] [data-toolbar-more]');
    await expect(more, "the toolbar must fold into More").toBeVisible();
    await more.click();
    const menu = page.locator("[data-toolbar-menu]").first();
    const k = menu.getByRole("menuitem", { name: "File · Export to Google Earth (KMZ)" });
    const k3 = menu.getByRole("menuitem", { name: "File · Export with 3D buildings" });
    await expect(k).toBeVisible();
    await expect(k3).toBeVisible();
    await expect(k).toBeDisabled();
    await expect(k).toHaveAttribute("title", REASON);
  });

  test("File folded into More + located: the More row runs the same export", async ({ page }) => {
    await load(page, { lat: 29.786, lon: -95.83 }, { fold: true });
    await page.locator('[data-priority-toolbar="site-actions"] [data-toolbar-more]').click();
    const k = page.locator("[data-toolbar-menu]").first().getByRole("menuitem", { name: "File · Export to Google Earth (KMZ)" });
    await expect(k).toBeEnabled();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), k.click()]);
    expect(dl.suggestedFilename()).toMatch(/\.kmz$/);
  });

  test("the canvas right-click no longer carries the export (owner decision 2026-10-22: File ▾ is its one home)", async ({ page }) => {
    await load(page, { lat: 29.786, lon: -95.83 });
    const box = await canvas(page).boundingBox();
    await page.mouse.click(box.x + 40, box.y + box.height - 40, { button: "right" });
    // The empty-canvas "Map" menu is open (known-good arm: its own rows are there) …
    const menu = page.locator('[role="menu"]').filter({ hasText: /Zoom to fit/i }).first();
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Paste");
    // … and the export rows are gone from it, with no orphaned divider left at the foot.
    await expect(menu).not.toContainText(/Google Earth/i);
    await expect(menu).not.toContainText(/3D buildings/i);
    await expect(page.getByText(/Export to Google Earth/i)).toHaveCount(0);
    expect(await menu.evaluate((el) => {
      const last = [...el.querySelectorAll("*")].filter((n) => n.children.length === 0).pop();
      return last && last.textContent.trim() === "" && getComputedStyle(last).borderTopWidth !== "0px";
    }), "no empty divider at the bottom of the menu").toBe(false);
  });

  test("the Map view's empty-map right-click has no export menu either (owner decision 2026-10-22); comp/site menus are untouched", async ({ page }) => {
    await armPlannerHooks(page);
    await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
    await page.goto("/#/site");
    await expect(page.getByTestId("map-toolbar-draw")).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1500);
    const map = page.locator(".leaflet-container").first();
    const box = await map.boundingBox();
    // Known-good arm: the map is really there and takes a right-click without throwing.
    expect(box && box.width > 300).toBe(true);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
    await page.waitForTimeout(500);
    await expect(page.getByText(/Export to Google Earth/i)).toHaveCount(0);
    await expect(page.getByText(/Export with 3D buildings/i)).toHaveCount(0);
    await expect(page.locator('[aria-label="Map actions"]')).toHaveCount(0);
  });
});
