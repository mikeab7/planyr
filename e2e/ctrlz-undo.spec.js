/* Ctrl+Z / undo behavior — Bluebeam parity + reliability (RC-1..RC-9).
 *
 * Runs LOGGED OUT against a seeded-blank site (no account needed), covering the client-side half
 * the sandbox can reproduce. The complaint that drove this: "Ctrl+Z doesn't always work, and it
 * should work like Bluebeam when drawing an element." In Bluebeam, Ctrl+Z WHILE drawing a
 * multi-point shape peels the last placed vertex; only once no draft is in progress does Ctrl+Z do
 * a global undo. Before the fix the Site Planner's Ctrl+Z ALWAYS did a global undo (it never
 * consulted removeLastVertex), so mid-draw it either did nothing or silently reverted a
 * previously-committed shape while the half-drawn one stayed on screen.
 *
 * We drive the markup-polygon tool (keyboard shortcut ⇧P, no toolbar dependency) and read the
 * persisted site model from localStorage — a finished polygon's POINT COUNT is the on-disk proof
 * of how many vertices Ctrl+Z peeled mid-draw, and the markups COUNT proves a mid-draw Ctrl+Z did
 * not touch already-committed shapes. The pure step-back resolver is unit-tested in
 * test/drafts.test.js; this is the live end-to-end guard. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
// Five well-separated points so finishMkPoly's coincident-point filter keeps them all.
const PTS = [[300, 220], [520, 240], [560, 430], [360, 470], [250, 360]];

// Read the logged-out site model's markups straight from localStorage (on-disk truth).
function readMarkups(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    const markups = site.markups || [];
    const polys = markups.filter((m) => m.kind === "polygon" || m.kind === "polyline");
    return { count: markups.length, polyCount: polys.length, ptCounts: polys.map((m) => (m.pts ? m.pts.length : 0)) };
  });
}

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

// Place `n` points of a markup polygon (armed with ⇧P) WITHOUT finishing — leaves the draft open.
async function drawPolyPoints(page, n) {
  const box = await canvas(page).boundingBox();
  await page.keyboard.press("Shift+P"); // select the markup-polygon tool
  for (let i = 0; i < n; i++) await page.mouse.click(box.x + PTS[i][0], box.y + PTS[i][1]);
}

test.describe("Ctrl+Z undo — Bluebeam parity + reliability (logged out)", () => {
  test("mid-draw Ctrl+Z peels the last placed vertex (Bluebeam), proven by the finished point count", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    await drawPolyPoints(page, 5);        // 5 vertices placed in the draft
    await page.keyboard.press("Control+z"); // peel one → 4
    await page.keyboard.press("Control+z"); // peel another → 3
    await page.keyboard.press("Enter");     // finish the 3-vertex polygon

    await expect.poll(() => readMarkups(page).then((r) => r.polyCount)).toBe(1);
    // If Ctrl+Z had done a global undo (the bug) the finished shape would still have 5 points.
    await expect.poll(() => readMarkups(page).then((r) => r.ptCounts[0])).toBe(3);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("mid-draw Ctrl+Z does NOT revert a previously-committed shape", async ({ page }) => {
    await startBlank(page);

    // Commit polygon A (3 pts).
    await drawPolyPoints(page, 3);
    await page.keyboard.press("Enter");
    await expect.poll(() => readMarkups(page).then((r) => r.polyCount)).toBe(1);

    // Start polygon B (4 pts), then Ctrl+Z once. Under the old bug this would have undone the
    // COMMITTED polygon A (global undo) while B's draft stayed on screen.
    await drawPolyPoints(page, 4);
    await page.keyboard.press("Control+z");
    // A is still committed — the mid-draw Ctrl+Z touched only the draft.
    await expect.poll(() => readMarkups(page).then((r) => r.polyCount)).toBe(1);

    // Finish B: it now has 3 points (4 placed − 1 peeled), and A survives → 2 committed polygons.
    await page.keyboard.press("Enter");
    await expect.poll(() => readMarkups(page).then((r) => r.polyCount)).toBe(2);
    await expect.poll(() => readMarkups(page).then((r) => r.ptCounts.slice().sort())).toEqual([3, 3]);
  });

  test("with no draft in progress, Ctrl+Z does a global undo of the last committed shape", async ({ page }) => {
    await startBlank(page);

    // Commit TWO polygons. (Undoing back to zero would leave a fully-blank site, which Planyr
    // deliberately doesn't persist — so we keep one committed shape to read the on-disk truth.)
    await drawPolyPoints(page, 3);
    await page.keyboard.press("Enter");
    await drawPolyPoints(page, 3);
    await page.keyboard.press("Enter");
    await expect.poll(() => readMarkups(page).then((r) => r.polyCount)).toBe(2);

    // No draft is open now → Ctrl+Z falls through to a real global undo of the LAST committed shape.
    await page.keyboard.press("Control+z");
    await expect.poll(() => readMarkups(page).then((r) => r.polyCount)).toBe(1);

    // Redo brings it back (Ctrl+Shift+Z), one committed action.
    await page.keyboard.press("Control+Shift+Z");
    await expect.poll(() => readMarkups(page).then((r) => r.polyCount)).toBe(2);
  });
});
