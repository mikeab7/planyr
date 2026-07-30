/* NEW-3 — a plain CLICK on empty canvas must not jump the drawing by a panel width.
 *
 * Owner report: "double-click a measurement so its Properties menu opens, then single-click empty
 * canvas — no drag. The map jumps and the panel closes." The panel closing is intended; the jump
 * is not.
 *
 * The mechanism, and why `e2e/panel-toggle-viewport.spec.js` (which already reads this exact seam)
 * missed it: that spec toggles panels via the RAIL, so the panel reflow never overlaps a live
 * pointer gesture. Here the SAME pointerdown does both — it clears the selection (which closes the
 * inspector and un-docks the left column) AND arms a pan whose origin `ox` was captured from the
 * render closure, i.e. the offset that was correct while the panel was still open. The B837 layout
 * effect then measures the canvas's new left edge and correctly rewrites `offX` by −delta to hold
 * the drawing still — and the very first pointermove, even a sub-slop one, overwrites it with
 * `d.ox + travel`. The compensation is gone and the effect will not re-run (left is unchanged).
 *
 * The invariant, the same one B837 established: a FIXED feet point that stays visible keeps its
 * viewport screen-x. It must hold across a click that closes a panel, not only across a rail toggle.
 *
 * The spec deliberately moves the pointer by ONE pixel between down and up — inside
 * PARCEL_CLICK_SLOP_PX, so the gesture is still classified as a tap on release. That is the point:
 * a gesture the app itself calls a click had already committed a full-panel-width pan.
 */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const panel = (p) => p.getByTestId("property-panel");

const FX = 900; // feet — a fixed ground point that stays on screen throughout

// Map a fixed feet point to its viewport screen-x via the canvas transform seam (B837's probe).
const feetScreenX = (page, fx) =>
  page.evaluate((f) => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    const offX = parseFloat(svg.getAttribute("data-view-offx"));
    const ppf = parseFloat(svg.getAttribute("data-view-ppf"));
    const vb = svg.getAttribute("viewBox").split(" ").map(Number); // 0 0 w h → w = size.w
    const r = svg.getBoundingClientRect();
    return r.left + ((f * ppf + offX) / vb[2]) * r.width;
  }, fx);

const rawOffX = (page) =>
  page.evaluate(() => parseFloat(document.querySelector('[data-testid="planner-canvas"]').getAttribute("data-view-offx")));
const canvasLeft = (page) =>
  page.evaluate(() => Math.round(document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect().left));

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

// Draw a building rectangle; returns its approximate CENTER in client px.
async function drawBuilding(page, ox = 380, oy = 240) {
  const b = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const x1 = b.x + ox, y1 = b.y + oy, x2 = x1 + 220, y2 = y1 + 150;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 6 });
  await page.mouse.up();
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

// Reconstruct the app's double-tap (pointer capture eats the DOM dblclick): two real down/up pairs.
async function doubleTap(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.down(); await page.mouse.up();
}

test.describe("a click on empty canvas never pans the map (NEW-3, logged out)", () => {
  test("a background CLICK holds the drawing still (and, since B1188, leaves the inspector open)", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawBuilding(page);

    await page.keyboard.press("Escape");   // drop the freshly-drawn selection
    await doubleTap(page, cx, cy);         // → Properties opens and TAKES the left dock
    await expect(panel(page)).toBeVisible();
    await page.waitForTimeout(350);        // let the dock swap + B837 compensation settle

    const openLeft = await canvasLeft(page);
    const before = await feetScreenX(page, FX);
    const offBefore = await rawOffX(page);

    // A plain CLICK on empty canvas, well clear of the building. One pixel of travel — inside the
    // click slop, so the app itself classifies this as a tap, not a pan.
    const box = await canvas(page).boundingBox();
    const ex = Math.round(box.x + box.width - 90), ey = Math.round(box.y + box.height - 90);
    await page.mouse.move(ex, ey);
    await page.mouse.down();
    const offDuringDown = await rawOffX(page);   // diagnostic: has the compensation landed yet?
    const leftDuringDown = await canvasLeft(page);
    await page.mouse.move(ex + 1, ey);
    await page.mouse.up();
    await page.waitForTimeout(350);

    // B1188 — the panel closing on a background click is NO LONGER intended, and asserting it
    // would now assert the defect. The owner's rule: "NO pointer interaction with the map may
    // change the panel's open/closed state. Not a click, not a drag, not a marquee, not a pan,
    // not a deselect." So the inspector STAYS OPEN and swaps to its "Nothing selected" body, the
    // dock keeps its width, and the deselect still happens. NEW-3's own invariant — the drawing
    // does not move — is unchanged and still asserted below; it is simply satisfied a stronger
    // way now, because there is no dock swap left for a gesture to race.
    await expect(panel(page)).toBeVisible();
    await expect(page.getByText(/Nothing selected/i)).toBeVisible();
    const closedLeft = await canvasLeft(page);
    expect(closedLeft).toBe(openLeft); // the dock never gave the width back — nothing to compensate

    const after = await feetScreenX(page, FX);
    // Diagnostic trail — makes a failure legible instead of "two numbers differ".
    // eslint-disable-next-line no-console
    console.log(`[NEW-3] canvas left ${openLeft} → (down) ${leftDuringDown} → ${closedLeft} · offX ${offBefore} → (down) ${offDuringDown} → ${await rawOffX(page)}`);

    // The invariant. 2px of tolerance for sub-pixel layout rounding; the bug is a ~320px jump.
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  test("a real DRAG on empty canvas pans, and does NOT close the inspector", async ({ page }) => {
    // The other half of the fix: deselect moved from pointerdown to release, gated on the same
    // slop + duration test the tap classifier already uses. So dragging the map no longer wipes
    // the selection or closes the inspector out from under a gesture — which is the same reasoning
    // B310 and B735 already apply to their own release-time decisions.
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawBuilding(page);

    await page.keyboard.press("Escape");
    await doubleTap(page, cx, cy);
    await expect(panel(page)).toBeVisible();
    await page.waitForTimeout(350);

    const box = await canvas(page).boundingBox();
    const sx = Math.round(box.x + box.width - 120), sy = Math.round(box.y + box.height - 120);
    const offBefore = await rawOffX(page);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx - 140, sy - 60, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    // It panned…
    expect(Math.abs((await rawOffX(page)) - offBefore)).toBeGreaterThan(100);
    // …and the inspector survived the drag.
    await expect(panel(page)).toBeVisible();
    expect(errors).toEqual([]);
  });
});
