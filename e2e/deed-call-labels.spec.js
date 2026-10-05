/* NEW-1 — metes-and-bounds CALL LABELS are hidden by default; a per-shape "Show calls" brings them back.
 *
 * RED-PROOF: on main (labels drawn unconditionally) the first test's "zero labels" assertion fails.
 * Two tracts are seeded (one "reader-style" purple, one "placed" red hatched — both are
 * kind:"encumbrance", the one render path). Asserts, on the REAL canvas and the REAL built sheet
 * (`__plannerExportSvg`, PDF-PARITY): default = no call text anywhere; the toggle in Properties turns
 * labels on for THAT shape only, is one undo frame, persists across a reload, and the export follows. */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

const canvas = (page) => page.locator('[data-testid="planner-canvas"]');
const CALLS = [
  { label: "N 87° 04' 16\" E 600.00'", az: 87, distFt: 600 },
  { label: "S 02° 10' 00\" W 400.00'", az: 178, distFt: 400 },
  { label: "S 87° 04' 16\" W 600.00'", az: 267, distFt: 600 },
  { label: "N 02° 10' 00\" E 400.00'", az: 358, distFt: 400 },
];
const mk = (id, group, ox, extra = {}) => {
  const ring = [{ x: ox, y: 100 }, { x: ox + 600, y: 100 }, { x: ox + 600, y: 500 }, { x: ox, y: 500 }];
  return {
    id, kind: "encumbrance", pts: ring, centerline: [...ring, ring[0]], closed: true, calls: CALLS, label: id,
    deedGroup: group, except: false, stroke: "#7c3aed", fill: "#7c3aed", fillOpacity: 0.14, weight: 2, dash: "solid", ...extra,
  };
};
const REC = (id) => ({
  id, groupId: id, site: "Calls", name: "Concept A", origin: null, county: null,
  parcels: [], els: [], measures: [], callouts: [],
  // mkB carries the legacy-less shape (no showCalls key) exactly like every plan saved before the feature.
  markups: [mk("mkA", "gA", 0), mk("mkB", "gB", 900, { stroke: "#b91c1c", fill: "#b91c1c" })],
  settings: {}, updatedAt: Date.now(),
});
async function open(page, id) {
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(([sid, r]) => {
    if (localStorage.getItem("e2e:seeded:" + sid)) return;
    localStorage.setItem("e2e:seeded:" + sid, "1");
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: r }));
    localStorage.setItem("planarfit:currentSite:v1", sid);
  }, [id, REC(id)]);
  await page.goto("/");
  await openModule(page, "site-planner");
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.locator('[data-feature="markup:mkA"]').count(), { timeout: 20_000 }).toBeGreaterThan(0);
  // The "Start your site" card sits over the top-left of a deed-only plan — close it so presses land on the canvas.
  await page.getByRole("button", { name: "×" }).first().click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(500);
}
const callTexts = (page, mkId) => page.locator(`[data-feature="markup:${mkId}"] text`).filter({ hasText: /°/ }).count();
const sheetCallTexts = (page, mkId) => page.evaluate(async (mid) => {
  // Explicit frame over both tracts (feet): a deed-only plan has no element extent to auto-frame on.
  const markup = await window.__plannerExportSvg({ cx: 750, cy: 300, wFt: 1700, hFt: 700 });
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const g = doc.querySelector(`[data-feature="markup:${mid}"]`);
  return g ? Array.from(g.querySelectorAll("text")).filter((t) => /°/.test(t.textContent || "")).length : -1;
}, mkId);
async function openProps(page, mkId) {
  const box = await page.locator(`[data-feature="markup:${mkId}"]`).first().boundingBox();
  const x = box.x + box.width * 0.25, y = box.y + box.height * 0.75;
  await page.mouse.click(x, y, { clickCount: 1 });
  await page.waitForTimeout(250);
  await page.mouse.click(x, y, { clickCount: 2 });
  await expect(page.getByTestId("deed-show-calls")).toBeVisible({ timeout: 20_000 });
}
const storedShow = (page, id, mid) => page.evaluate(([sid, m]) => {
  const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return (all[sid]?.markups || []).find((x) => x.id === m)?.showCalls;
}, [id, mid]);

test.describe("NEW-1 · metes-and-bounds call labels default OFF, per-shape Show calls", () => {
  test("default: no call labels on the canvas or the sheet; toggle is per shape, undoable, persisted", async ({ page }) => {
    const ID = "e2eDeedCalls";
    await open(page, ID);

    // Default — both tracts, canvas AND built sheet. (Red on main: 4 labels each.)
    expect(await callTexts(page, "mkA")).toBe(0);
    expect(await callTexts(page, "mkB")).toBe(0);
    expect(await sheetCallTexts(page, "mkA")).toBe(0);
    expect(await sheetCallTexts(page, "mkB")).toBe(0);

    // The calls are NOT deleted: the panel still lists them, toggle reads OFF.
    await openProps(page, "mkA");
    await expect(page.getByTestId("deed-show-calls")).not.toBeChecked();
    await page.getByTestId("deed-courses-list").locator("summary").click();
    await expect(page.getByTestId("deed-courses-list").locator("li")).toHaveCount(4);

    // Turn ON for A only.
    await page.getByTestId("deed-show-calls").check();
    await expect.poll(() => callTexts(page, "mkA")).toBe(4);
    expect(await callTexts(page, "mkB")).toBe(0);
    expect(await sheetCallTexts(page, "mkA")).toBe(4);   // print follows the toggle
    expect(await sheetCallTexts(page, "mkB")).toBe(0);
    await expect.poll(() => storedShow(page, ID, "mkA")).toBe(true);

    // Undo round-trips it (focus off the checkbox first so the chord reaches the canvas).
    await page.mouse.click(5, 5);
    await page.keyboard.press("Control+z");
    await expect.poll(() => callTexts(page, "mkA")).toBe(0);
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(() => callTexts(page, "mkA")).toBe(4);

    // Persisted: reload (seed script no-ops the second time) — still on for A, off for B.
    await expect.poll(() => storedShow(page, ID, "mkA")).toBe(true);
    await page.reload();
    await openModule(page, "site-planner");
    await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => callTexts(page, "mkA"), { timeout: 20_000 }).toBe(4);
    expect(await callTexts(page, "mkB")).toBe(0);
  });
});
