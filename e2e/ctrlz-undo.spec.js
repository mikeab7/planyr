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
  await page.getByTestId("map-toolbar-draw").click();
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

// Read the first parcel's raw boundary weight straight from localStorage (on-disk truth). Undefined until something sets it.
function rawParcelWeight(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    const p = (site.parcels || [])[0];
    return p ? p.weight : undefined;
  });
}

// NEW-3 (layout "A" everywhere, 2026-10-21) — a deed's Fill opacity was the last SLIDER left in a markup / element inspector;
// the owner ruled opacity is a typed % box on EVERY drawn object ("never a slider"), so the deed lost it too. The one
// SLIDER-scoped control left on the plan canvas that edits a drawn object and takes an undo frame is the parcel page's
// Boundary weight (owner-approved parcel look, constraint #23 — a slider by design), so the B746/V258 contract (a slider has
// no native undo, so Ctrl+Z must still reach the app's undo while it holds focus) is exercised there. The parcel is drawn
// with the REAL Parcel tool and its page opened from the Parcels list, like parcel-look.spec does.
async function seedParcelPage(page) {
  await startBlank(page);
  await page.locator('[data-rail-tab="parcel"]').click();
  const addLandBtn = page.getByTestId("land-add-btn").or(page.getByTitle(/Add land to this plan/i)).first();
  const drawBtn = page.getByRole("button", { name: /Draw a (new boundary|parcel)/i });
  if ((await addLandBtn.count()) && !(await drawBtn.count())) await addLandBtn.click();
  await drawBtn.click();
  const box = await canvas(page).boundingBox();
  const pts = [[260, 190], [520, 190], [520, 400], [260, 400]];
  for (const [x, y] of pts) { await page.mouse.click(box.x + x, box.y + y); await page.waitForTimeout(60); }
  await page.mouse.click(box.x + pts[0][0], box.y + pts[0][1]);
  await expect.poll(async () => page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    return ((map[Object.keys(map)[0]] || {}).parcels || []).length;
  })).toBeGreaterThanOrEqual(1);
  await page.keyboard.press("Escape");
  const id = await page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    return ((map[Object.keys(map)[0]] || {}).parcels || [])[0].id;
  });
  const back = page.getByRole("button", { name: /All parcels/ });
  if (await back.count()) await back.first().click();
  await page.getByTestId(`parcel-row-${id}`).click();
  await expect(page.getByTestId("parcel-style-panel")).toBeVisible({ timeout: 20_000 });
}

test.describe("Ctrl+Z reliability while a slider holds focus (B746/V258)", () => {
  /* ⛔ R3 (B1857905) — THIS TEST USED TO DRAW A BUILDING. A building's Fill opacity control is
   * `PercentField`/`NumInput` (SitePlanner.jsx ~31774/~32215) — a plain text
   * `<input aria-label="Fill opacity">` with an arrow-key stepper, not an `<input type="range">`
   * — confirmed against the real Properties panel's accessibility tree (no `range` input appears
   * anywhere in it). Measured directly: Ctrl+Z while that field holds focus does NOT reach the
   * app's global undo, and that is CORRECT, current, deliberate behaviour, not a regression —
   * `keyScopeVerdict` (lib/keyContract.js) classifies a plain text input as `SCOPE.FIELD`, and a
   * FIELD deliberately refuses undo/redo so Ctrl+Z stays the box's own native text-undo (the
   * exact rule this file's OWN sibling test two cases below already asserts for a callout's text
   * editor). Only `SCOPE.SLIDER` — a literal `input[type=range]` — carries B746/V258's exception
   * ("a slider has no native undo to consume"), and a slider still exists, for a CLOSED markup
   * that is NOT `simpleClosedMarkup` — concretely, a "cloud" revision-cloud shape
   * (SitePlanner.jsx ~26783). So the control this test is actually about was never removed from
   * the product, only from the BUILDING panel; the repair below re-targets the one remaining
   * SLIDER-scoped instance instead of asserting a FIELD-scoped contract the product no longer
   * has for a building. */
  test("drag the parcel Boundary-weight slider, then Ctrl+Z WITHOUT deselecting still undoes it", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await seedParcelPage(page);

    // The parcel page's style panel carries range inputs; the Boundary weight one is addressed by its own test id.
    const slider = page.getByTestId("look-boundary-weight");
    await expect(slider).toBeVisible();

    // Change the slider's value with the keyboard (native range behavior) — this leaves focus ON
    // the range input, exactly like a mouse drag does, and matches the exact repro: select an
    // element, drag its opacity slider, then Ctrl+Z WITHOUT deselecting or clicking away first.
    // A single Home/End keystroke (jumps to the slider's min/max) rather than several rapid
    // Arrow presses — under parallel-worker load, consecutive keydowns can outrun React's
    // re-render and drop a step, making the test itself flaky.
    await slider.focus();
    const beforeRaw = await rawParcelWeight(page); // undefined — nothing explicitly set yet
    const displayed = parseFloat(await slider.inputValue());
    const mid = (parseFloat(await slider.getAttribute("min")) + parseFloat(await slider.getAttribute("max"))) / 2;
    const key = displayed > mid ? "Home" : "End"; // jump to the opposite end of the range
    await page.keyboard.press(key);
    await expect.poll(() => rawParcelWeight(page)).not.toBe(beforeRaw);
    const changedRaw = await rawParcelWeight(page);

    // Before the fix: the global Ctrl+Z handler saw document.activeElement === this <input> and
    // silently returned without ever calling undo(). Focus is still on the slider here — nothing
    // was clicked away.
    await expect(slider).toBeFocused();
    await page.keyboard.press("Control+z");

    /* Ctrl+Z reaches the app's real undo. THE PROOF IS THE PERSISTED VALUE — the B746/V258 bug left
     * it untouched, because the global handler saw `document.activeElement` was this <input> and
     * returned without ever calling undo(). This assertion is the whole point of the test and is
     * unchanged.
     *
     * ⛔ B481328 — WHAT THIS TEST USED TO ASSERT BELOW WAS STALE, AND IT HAD BEEN FAILING ON MAIN.
     * It required the undo to DESELECT: "Nothing selected" visible, the slider unmounted. That was
     * true when this spec was written, and **B385040 deliberately changed it** — `applySnapshot`
     * now FILTERS `sel`/`multi` against the snapshot instead of blanking them, so a still-valid
     * selection SURVIVES an undo (B743's no-stale-ref invariant met more strictly, not waived).
     * The spec was never updated, so a red build here has been reporting a behaviour change that
     * was intentional and correct.
     *
     * Measured on the real app before rewriting these lines: after the undo the stored value is
     * back to its original, the shape is STILL SELECTED, the slider is still mounted, and
     * "Nothing selected" never appears. So the assertions now say that — the undo ran AND the
     * selection survived. */
    // The proof is that the slider edit IS undone.
    await expect.poll(() => rawParcelWeight(page)).not.toBe(changedRaw);
    await expect(page.getByTestId("parcel-style-panel")).toBeVisible();
    await expect(page.getByText(/Nothing selected/i)).toHaveCount(0);
    await expect(slider).toHaveCount(1);

    // Redo (Ctrl+Shift+Z) brings the change back.
    await page.keyboard.press("Control+Shift+Z");
    await expect.poll(() => rawParcelWeight(page)).toBe(changedRaw);

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
