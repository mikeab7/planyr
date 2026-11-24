/* NEW-1 (2026-11-24) — a metes-and-bounds tract (a deed, kind "encumbrance") has a real Properties panel:
 * name + label controls, closure facts, and every course typed. Real canvas, real panel, on a throwaway seeded plan.
 *   • retyping a course's distance re-draws the shape, opens a misclosure the panel reports, and is ONE undo step
 *   • a bad bearing is refused in words and changes nothing
 *   • hiding one course's bearing / distance removes just that half from the canvas label (and the built sheet follows)
 *   • the name is editable and can be hidden */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

const canvas = (page) => page.locator('[data-testid="planner-canvas"]');
const CALLS = [
  { label: "N 90° E  600′", az: 90, distFt: 600 },
  { label: "S 0° E  400′", az: 180, distFt: 400 },
  { label: "S 90° W  600′", az: 270, distFt: 600 },
  { label: "N 0° E  400′", az: 0, distFt: 400 },
];
const ring = [{ x: 0, y: 100 }, { x: 600, y: 100 }, { x: 600, y: 500 }, { x: 0, y: 500 }];
const REC = (id) => ({
  id, groupId: id, site: "Deed panel", name: "Concept A", origin: null, county: null, parcels: [], els: [], measures: [], callouts: [],
  markups: [{ id: "mkA", kind: "encumbrance", pts: ring, centerline: [...ring, ring[0]], closed: true, calls: CALLS, label: "Tract 1", deedGroup: "gA", except: false, stroke: "#7c3aed", fill: "#7c3aed", fillOpacity: 0.14, weight: 2, dash: "solid", showCalls: true }],
  settings: {}, updatedAt: Date.now(),
});
const stored = (page, id) => page.evaluate((sid) => JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1") || "{}")[sid]?.markups?.[0] || null, id);
const storedCalls = async (page, id) => (await stored(page, id))?.calls || [];

test("deed Properties panel: edit a course, label visibility, name", async ({ page }) => {
  const ID = "e2eDeedPanel";
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(([sid, r]) => {
    if (localStorage.getItem("e2e:seeded:" + sid)) return;
    localStorage.setItem("e2e:seeded:" + sid, "1");
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: r }));
    localStorage.setItem("planarfit:currentSite:v1", sid);
  }, [ID, REC(ID)]);
  await page.goto("/");
  await openModule(page, "site-planner");
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.locator('[data-feature="markup:mkA"]').count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "×" }).first().click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(500);

  const box = await page.locator('[data-feature="markup:mkA"]').first().boundingBox();
  const x = box.x + box.width * 0.25, y = box.y + box.height * 0.75;
  await page.mouse.click(x, y); await page.waitForTimeout(250); await page.mouse.click(x, y, { clickCount: 2 });
  await expect(page.getByTestId("deed-inspector")).toBeVisible({ timeout: 20_000 });

  // Closure facts for a clean 600 x 400 rectangle.
  await expect(page.getByTestId("deed-closure")).toContainText("closes");
  await expect(page.getByTestId("deed-perimeter")).toContainText("2,000");
  await expect(page.getByTestId("deed-courses-list").locator("li")).toHaveCount(4);

  // A bad bearing is refused and nothing changes.
  const b0 = page.getByTestId("deed-course-bearing-0");
  await b0.fill("nonsense"); await b0.press("Enter");
  await expect(b0).toHaveValue(/N 90° E/);
  await expect.poll(async () => (await storedCalls(page, ID))[0]?.az).toBe(90);

  // Retype the last course longer: the shape re-draws, the panel reports the miss, the path starts where it did.
  const d3 = page.getByTestId("deed-course-dist-3");
  await d3.fill("430"); await d3.press("Enter");
  await expect(page.getByTestId("deed-closure")).toContainText("does not close");
  await expect.poll(async () => (await storedCalls(page, ID))[3]?.distFt).toBe(430);
  const m1 = await stored(page, ID);
  expect(m1.centerline[0]).toEqual({ x: 0, y: 100 });
  expect(m1.centerline.length).toBe(5);

  // One undo step puts it back.
  await page.mouse.click(5, 5);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("deed-closure")).toContainText("closes");
  await expect.poll(async () => (await storedCalls(page, ID))[3]?.distFt).toBe(400);

  // Course 1: hide the bearing — its canvas label keeps only the distance; the others are untouched.
  const labels = () => page.locator('[data-feature="markup:mkA"] text').filter({ hasText: /[°′]/ }).allTextContents();
  await expect.poll(async () => (await labels()).length).toBe(4);
  await page.getByTestId("deed-course-hideBearing-0").click();
  await expect.poll(async () => (await labels()).filter((t) => !/°/.test(t)).length).toBe(1);
  await page.getByTestId("deed-course-hideDist-1").click();
  await expect.poll(async () => (await labels()).length).toBe(4); // course 2 still has its bearing
  await page.getByTestId("deed-courses-show-all").click();
  await expect.poll(async () => (await labels()).filter((t) => /°/.test(t)).length).toBe(4);

  // The name: editable, and hideable.
  await page.getByTestId("deed-name").fill("Tract A");
  await expect(page.locator('[data-feature="markup:mkA"] text', { hasText: "Tract A" })).toHaveCount(1);
  await page.getByTestId("deed-show-name").uncheck();
  await expect(page.locator('[data-feature="markup:mkA"] text', { hasText: "Tract A" })).toHaveCount(0);
});
