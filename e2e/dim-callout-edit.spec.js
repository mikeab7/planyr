/* Editable dimensions + zoom-declutter + resizable callouts (B911 / B912 / B913) — logged-out,
 * sandbox-headless drive of the REAL SVG canvas. The pure math is unit-tested (labelLayout,
 * edgeRuns, calloutLayout); these specs prove the WIRING works live and nothing crashes:
 *   • B911 — a selected parcel's per-edge length labels HIDE when the site is zoomed fully out and
 *     RETURN on zoom-in (they used to stay a fixed size and dominate the shrunk view).
 *   • B912 — double-tapping an element's dimension number opens the inline length editor and the
 *     geometry resizes to the typed feet.
 *   • B913 — dragging a text-box's side handle gives it an explicit width (text wraps); "Fit to
 *     text" clears it back to auto.
 * Runs with no seeded account (like smoke.spec.js / click-behavior.spec.js). */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const panel = (p) => p.getByTestId("property-panel");

function firstSite(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    return map[Object.keys(map)[0]] || {};
  });
}
const parcelCount = (page) => firstSite(page).then((s) => (s.parcels || []).length);
const firstBuilding = (page) => firstSite(page).then((s) => (s.els || []).find((e) => e.type === "building") || null);
const firstCallout = (page) => firstSite(page).then((s) => (s.callouts || [])[0] || null);

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

// A helper double-tap: two real down/up pairs at the same point (pointer capture eats the DOM
// dblclick, so the app reconstructs the double-tap on pointerdown — see click-behavior.spec.js).
async function doubleTap(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.down(); await page.mouse.up();
}

// Zoom the canvas by dispatching N wheel steps over its centre (deltaY sign chooses in/out; the
// handler ignores magnitude, so each event is one 1.12× step).
async function wheelZoom(page, steps, dir /* -1 in, +1 out */) {
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dir * 120); await page.waitForTimeout(16); }
}

test.describe("B911 — parcel edge dimension labels declutter on zoom-out", () => {
  test("a selected parcel's edge length labels hide when zoomed fully out, return on zoom-in", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    // Arm the parcel DRAW tool: Parcel panel → "＋ Add" → "Draw a new boundary". This docks the left
    // Parcel panel, which shifts the canvas — so capture the canvas box AFTER arming, not before.
    await page.getByRole("button", { name: "Parcel", exact: true }).click();
    await page.getByTitle(/Add land to this plan/i).click();
    await page.getByRole("button", { name: /Draw a new boundary/i }).click();
    await expect(page.getByRole("button", { name: /Draw/, pressed: true })).toBeVisible();
    const box = await canvas(page).boundingBox();

    // Draw a 4-corner parcel: drop the four corners, then click the FIRST dot again to close it
    // (clicking within ~12px of the start point closes the ring).
    const p = [[box.x + 200, box.y + 150], [box.x + 520, box.y + 150], [box.x + 520, box.y + 400], [box.x + 200, box.y + 400]];
    for (const [x, y] of p) { await page.mouse.click(x, y); await page.waitForTimeout(60); }
    await page.mouse.click(p[0][0], p[0][1]); // click the first dot again → close (also zoom-to-fits)
    await expect.poll(() => parcelCount(page)).toBeGreaterThanOrEqual(1);

    // Exit the draw tool and SELECT the parcel from the panel list (deterministic — closePoly does a
    // zoom-to-fit, so canvas coordinates have moved). Selecting it shows its per-edge length labels.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Parcel 1\b/ }).click();
    const edgeDims = page.getByTestId("parcel-edge-dim");
    await expect.poll(() => edgeDims.count()).toBeGreaterThan(0); // labels visible at working zoom

    // Zoom fully out — the parcel shrinks to nothing; the length labels must disappear (the bug was
    // that they stayed large and dominated the view).
    await wheelZoom(page, 26, +1);
    await expect.poll(() => edgeDims.count(), { timeout: 8000 }).toBe(0);

    // Zoom back in — they return.
    await wheelZoom(page, 26, -1);
    await expect.poll(() => edgeDims.count(), { timeout: 8000 }).toBeGreaterThan(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("B912 — editable dimension length", () => {
  test("double-tap a building's dimension number → type a length → the building resizes", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    // A WIDE, short building: the depth dimension sits well clear of the centred name label, so its
    // number renders (it isn't collision-suppressed) and is a reliable double-tap target.
    const box = await canvas(page).boundingBox();
    await page.getByRole("button", { name: "Building", exact: true }).click();
    const x1 = box.x + 150, y1 = box.y + 250, x2 = box.x + 640, y2 = box.y + 380;
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 5 });
    await page.mouse.move(x2, y2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => firstBuilding(page)).not.toBeNull();

    const dim = page.getByTestId("el-dim").first();
    await expect(dim).toBeVisible({ timeout: 8000 });
    const db = await dim.boundingBox();

    // Double-tap the dimension number → the inline numeric editor opens (an <input type=number>).
    await doubleTap(page, db.x + db.width / 2, db.y + db.height / 2);
    const editor = page.locator('input[type="number"]');
    await expect(editor.first()).toBeVisible({ timeout: 6000 });

    // Type a new depth and commit → the building's depth axis resizes to ~200 ft.
    await editor.first().fill("200");
    await page.keyboard.press("Enter");
    await expect.poll(async () => {
      const b = await firstBuilding(page);
      return b ? Math.round(Math.min(b.w, b.h)) : null; // depth = the shorter axis for this wide rect
    }, { timeout: 6000 }).toBe(200);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("B923 — click to place the caret inside a text box", () => {
  test("clicking inside the callout/text-box editor moves the caret to the click point", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    // Place a Text box and type a long single-line string; leave the editor OPEN (don't commit).
    const box = await canvas(page).boundingBox();
    await page.getByRole("button", { name: /^Text\s/ }).click();
    const tx = box.x + 380, ty = box.y + 300;
    await page.mouse.click(tx, ty);
    const ta = page.getByPlaceholder("Type…");
    await ta.waitFor({ state: "visible" });
    const TEXT = "alpha beta gamma delta epsilon zeta";
    await page.keyboard.type(TEXT);

    // Baseline: after typing, the caret sits at the END of the text.
    await expect.poll(() => ta.evaluate((el) => el.selectionStart)).toBe(TEXT.length);

    // Click near the LEFT edge of the text box → the browser must move the caret to that point.
    // The bug (B923): the canvas SVG's onMouseDown preventDefault — bubbling up from this
    // foreignObject <textarea> — cancelled the mousedown's default caret placement, so the caret
    // stayed stuck at the end and a mouse click could never reposition it. The fix guards that
    // handler so it doesn't preventDefault when the mousedown lands on an inline text editor.
    const tb = await ta.boundingBox();
    await page.mouse.click(tb.x + 12, tb.y + tb.height / 2);
    await page.waitForTimeout(50);
    const caret = await ta.evaluate((el) => el.selectionStart);
    expect(caret, `caret should move off the end (was ${caret}, text length ${TEXT.length})`).toBeLessThan(TEXT.length);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("B913 — resizable text box / callout", () => {
  test("drag a text box's side handle → explicit width; Fit to text clears it", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    // Place a Text box (no leader) and type into it, then commit.
    const box = await canvas(page).boundingBox();
    await page.getByRole("button", { name: /^Text\s/ }).click();
    const tx = box.x + 380, ty = box.y + 300;
    await page.mouse.click(tx, ty);
    await page.getByPlaceholder("Type…").waitFor({ state: "visible" });
    await page.keyboard.type("alpha beta gamma delta epsilon");
    await page.keyboard.press("Escape"); // commit text
    await page.keyboard.press("Escape"); // deselect
    await expect.poll(() => firstCallout(page)).not.toBeNull();

    // Select it → the resize handles appear (no explicit width yet).
    await page.mouse.click(tx, ty);
    const rightHandle = page.getByTestId("callout-handle-r").first();
    await expect(rightHandle).toBeVisible({ timeout: 6000 });
    expect((await firstCallout(page)).boxW == null).toBe(true);

    // Drag the right handle outward → the callout gets an explicit boxW (feet).
    const hb = await rightHandle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 140, hb.y + hb.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => {
      const c = await firstCallout(page);
      return c && c.boxW != null && c.boxW > 0;
    }, { timeout: 6000 }).toBe(true);

    // Open Properties and "Fit to text" → boxW clears back to auto.
    await doubleTap(page, tx, ty);          // double-tap opens Properties (already selected)
    await expect(panel(page)).toBeVisible();
    await page.getByRole("button", { name: /Fit to text/i }).click();
    await expect.poll(async () => (await firstCallout(page)).boxW == null).toBe(true);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
