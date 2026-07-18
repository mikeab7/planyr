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

const panel = (p) => p.getByTestId("property-panel");

function buildingCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).filter((e) => e.type === "building").length;
  });
}

function calloutCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.callouts || []).length;
  });
}

// Raw (unfallback-resolved) fillOpacity on the first building — undefined until explicitly set.
function rawBuildingFillOpacity(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    const b = (site.els || []).find((e) => e.type === "building");
    return b ? b.fillOpacity : undefined;
  });
}

// Drag a building rectangle; returns its approximate CENTER in client px (matches click-behavior.spec.js).
async function drawBuilding(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const x1 = box.x + 300, y1 = box.y + 250, x2 = box.x + 540, y2 = box.y + 410;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 70, y1 + 50, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => buildingCount(page)).toBeGreaterThanOrEqual(1);
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

// Double-click (two real down/up pairs — pointer capture eats a native dblclick) to open Properties.
async function openProperties(page, cx, cy) {
  await page.mouse.move(cx, cy);
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.down(); await page.mouse.up();
  await expect(panel(page)).toBeVisible();
}

test.describe("Ctrl+Z reliability while the Fill-opacity slider holds focus (B746/V258)", () => {
  test("drag the Fill-opacity slider, then Ctrl+Z WITHOUT deselecting still undoes it", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawBuilding(page);
    await openProperties(page, cx, cy);

    const slider = panel(page).locator('input[type="range"]');
    await expect(slider).toBeVisible();

    // Change the slider's value with the keyboard (native range behavior) — this leaves focus ON
    // the range input, exactly like a mouse drag does, and matches the exact repro: select an
    // element, drag its opacity slider, then Ctrl+Z WITHOUT deselecting or clicking away first.
    // A single Home/End keystroke (jumps to the slider's min/max) rather than several rapid
    // Arrow presses — under parallel-worker load, consecutive keydowns can outrun React's
    // re-render and drop a step, making the test itself flaky.
    await slider.focus();
    const beforeRaw = await rawBuildingFillOpacity(page); // undefined — nothing explicitly set yet
    const displayed = parseFloat(await slider.inputValue());
    const key = displayed > 0.5 ? "Home" : "End"; // jump to the opposite end, safely inside [0.1, 1]
    await page.keyboard.press(key);
    await expect.poll(() => rawBuildingFillOpacity(page)).not.toBe(beforeRaw);
    const changedRaw = await rawBuildingFillOpacity(page);

    // Before the fix: the global Ctrl+Z handler saw document.activeElement === this <input> and
    // silently returned without ever calling undo(). Focus is still on the slider here — nothing
    // was clicked away.
    await expect(slider).toBeFocused();
    await page.keyboard.press("Control+z");

    // Ctrl+Z now reaches the app's real undo — same as the toolbar Undo button, INCLUDING its
    // documented side effect of deselecting (applySnapshot always clears selection on undo/redo,
    // which is why the Properties panel closes here too). The bug report's own note confirms this
    // is the correct, matching behavior: "the toolbar Undo button correctly reverts it (and
    // deselects as a side effect)". So we read the persisted value rather than the now-unmounted
    // slider — the panel closing IS the proof undo actually ran (the old bug left it untouched,
    // open, still focused, still showing the changed value).
    await expect.poll(() => rawBuildingFillOpacity(page)).toBe(beforeRaw);
    await expect(panel(page)).toHaveCount(0);

    // Redo (Ctrl+Shift+Z) brings the change back.
    await page.keyboard.press("Control+Shift+Z");
    await expect.poll(() => rawBuildingFillOpacity(page)).toBe(changedRaw);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("no regression: Ctrl+Z with focus in a REAL text field (a callout's inline editor) does not fire app undo", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    // A building on the plan first so the site is never fully blank (Planyr doesn't persist an
    // empty site — see the top-of-file note on the existing global-undo test).
    await drawBuilding(page);
    await expect.poll(() => buildingCount(page)).toBe(1);

    // Place a callout (tip click, then box click) — placement itself pushes ONE history frame
    // (before any text is typed) and opens its own real <textarea> editor, autofocused.
    const box = await canvas(page).boundingBox();
    await page.getByRole("button", { name: /^Callout\s/ }).click();
    await page.mouse.click(box.x + 300, box.y + 500);
    await page.mouse.click(box.x + 420, box.y + 460);
    const editor = page.getByPlaceholder("Type…");
    await expect(editor).toBeVisible();
    await page.keyboard.type("hello");
    await expect(editor).toBeFocused();
    await expect.poll(() => calloutCount(page)).toBe(1);

    // Ctrl+Z while typing in a real text field must NOT reach the app's global undo — if it did,
    // it would pop the callout-creation history frame (the most recent one) and delete the callout
    // that's still being typed into out from under the user.
    await page.keyboard.press("Control+z");
    await expect(editor).toBeFocused();
    await expect.poll(() => calloutCount(page)).toBe(1);
    await expect.poll(() => buildingCount(page)).toBe(1);

    await page.keyboard.press("Escape"); // commits the callout's own text editor
    await page.keyboard.press("Escape"); // global deselect
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

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
