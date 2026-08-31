/* NEW-1 — "all the parcel tools should also be on the right hand menu."
 *
 * `test/parcelActions.test.js` proves the DECISION (which rows exist, when each is enabled) and
 * guards the wiring at the source level. This spec proves the THING THE OWNER SEES: open the right
 * rail's Parcel tools flyout on a real build and drive each action from there, end to end.
 *
 * Runs LOGGED OUT against a blank site, so the whole thing is verifiable here (the
 * ATTEMPT-BEFORE-YOU-PARK rule). Two rows are deliberately NOT exercised end to end because they
 * reach the county GIS host the sandbox egress blocks — "Click a lot on the map" and
 * "Add by address". Those are asserted as PRESENT and correctly gated instead, and the live click
 * lives in VERIFICATION.md.
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const railBtn = (p) => p.getByTestId("rail-parcel-tools");
const row = (p, id) => p.locator(`[data-parcel-action="${id}"]`);

/* The persisted (logged-out) site model — on-disk truth, so an assertion survives a reload. */
function readModel(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    const parcels = site.parcels || [];
    return {
      count: parcels.filter((p) => p.active !== false).length,
      total: parcels.length,
      parcels: parcels.map((p) => ({ id: p.id, pts: (p.points || []).length, locked: !!p.locked, chipHidden: !!p.chipHidden, active: p.active !== false })),
    };
  });
}

async function boot(page) {
  await page.goto("/");
  await openModule(page, "site-planner");
  await page.getByTestId("map-start-blank-menu-btn").first().click();
  await page.getByTestId("map-start-blank-menu-item").first().click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
}

/* Open the flyout (idempotent — it is a toggle, so only open when it is closed). */
async function openMenu(page) {
  if (await row(page, "draw").isVisible().catch(() => false)) return;
  await railBtn(page).click();
  await expect(row(page, "draw")).toBeVisible();
}

/* Pick a row from the flyout. */
async function pick(page, id) {
  await openMenu(page);
  await row(page, id).click();
}

/* Draw a rectangular parcel from the menu's own "Draw new parcel" row.
 *
 * ⚠ Drawing a parcel RE-FITS the view, so the coordinates you drew at no longer locate it
 * afterwards (the same trap e2e/click-contract.spec.js documents). Read `outlineBox` for where a
 * parcel actually IS on screen; never reuse the draw coordinates. */
async function drawParcel(page, x0, y0, x1, y1) {
  await pick(page, "draw");
  await expect(page.getByText(/drop boundary points/i)).toBeVisible();
  const b = await canvas(page).boundingBox();
  const pt = (fx, fy) => [b.x + fx, b.y + fy];
  for (const [x, y] of [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)]) { await page.mouse.click(x, y); await page.waitForTimeout(80); }
  await page.mouse.click(...pt(x0, y0)); // close on the first point
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250); // let the re-fit settle before anyone reads a box
}

/* A screen point ON a rendered parcel — its centre, or the midpoint of its first boundary edge.
 *
 * ⚠ Read it through the live SVG transform, NOT `boundingBox()`. Selecting a parcel thickens its
 * stroke, which inflates the reported box by several pixels on every side — enough to put a
 * "click the top edge" outside the edge hit tolerance, which is exactly how the reshape assertion
 * first failed here against a build where the gesture worked fine. */
function outlinePoint(page, i, what) {
  return page.evaluate(({ i, what }) => {
    const poly = document.querySelectorAll('[data-testid="parcel-outline"]')[i];
    if (!poly) return null;
    const pts = poly.getAttribute("points").trim().split(/\s+/).map((s) => s.split(",").map(Number));
    const [ux, uy] = what === "edge"
      ? [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
      : [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    const p = poly.ownerSVGElement.createSVGPoint();
    p.x = ux; p.y = uy;
    const s = p.matrixTransform(poly.getScreenCTM());
    return [Math.round(s.x), Math.round(s.y)];
  }, { i, what });
}
const outlineCount = (page) => page.getByTestId("parcel-outline").count();

test.describe("the right rail is the complete answer to 'what can I do to a parcel'", () => {
  test("the rail button is 'Parcel tools' and the left tab is 'Land' — no two-sided collision", async ({ page }) => {
    await boot(page);
    await expect(railBtn(page)).toContainText("Parcel tools");
    // The left rail's parcel panel no longer shares the word.
    const landTab = page.locator('[data-rail-tab="parcel"]');
    await expect(landTab).toHaveAttribute("title", "Land");
    const railTitles = await page.locator("[data-rail-tab]").evaluateAll((els) => els.map((e) => e.getAttribute("title")));
    expect(railTitles).toContain("Land");
    expect(railTitles).not.toContain("Parcel");
  });

  test("the flyout carries every action, grouped create → modify → remove", async ({ page }) => {
    await boot(page);
    await openMenu(page);
    // The three that were already there, plus the ones the owner found missing.
    for (const id of ["draw", "deed", "identify", "address", "split", "combine", "boundary", "setbacks", "lock", "active", "chip", "removeMode", "deleteSelected"]) {
      await expect(row(page, id), `"${id}" is not in the Parcel tools menu`).toBeVisible();
    }
    // Document order IS the reading order: create rows before modify rows before remove rows.
    const order = await page.locator("[data-parcel-action]").evaluateAll((els) => els.map((e) => e.getAttribute("data-parcel-action")));
    expect(order.indexOf("draw")).toBeLessThan(order.indexOf("split"));
    expect(order.indexOf("split")).toBeLessThan(order.indexOf("removeMode"));
    expect(order.indexOf("boundary")).toBeLessThan(order.indexOf("removeMode"));
  });

  test("an action a blank plan can't use is VISIBLE and says why — never hidden", async ({ page }) => {
    await boot(page);
    await openMenu(page);
    for (const id of ["split", "combine", "boundary", "removeMode"]) {
      await expect(row(page, id)).toBeVisible();
      await expect(row(page, id)).toBeDisabled();
      expect(await row(page, id).getAttribute("title"), `${id} is disabled with no reason`).toBeTruthy();
    }
    // Draw + Deed always work — a blank plan has to be able to start one.
    await expect(row(page, "draw")).toBeEnabled();
    await expect(row(page, "deed")).toBeEnabled();
    // The two GIS-backed create rows are gated on a georeferenced plan (their live click is the V#).
    await expect(row(page, "identify")).toBeDisabled();
    await expect(row(page, "address")).toBeDisabled();
  });

  test("Draw and Remove both run from the menu, end to end", async ({ page }) => {
    await boot(page);
    await drawParcel(page, 240, 150, 430, 300);
    expect((await readModel(page)).total).toBe(1);

    // REMOVE — the action that had no entry point in the rail at all.
    const at = await outlinePoint(page, 0, "centre");
    await pick(page, "removeMode");
    await expect(page.getByText(/click a parcel to delete it/i)).toBeVisible();
    await page.mouse.click(...at);                   // inside the parcel
    await expect.poll(() => readModel(page).then((m) => m.total)).toBe(0);
    await page.keyboard.press("Escape");
  });

  test("Split then Combine both run from the menu, end to end", async ({ page }) => {
    await boot(page);
    await drawParcel(page, 300, 200, 460, 340);

    // SPLIT — cut the lot in half with a line drawn right across it. Two pieces that share the cut
    // exactly, which is what Combine then needs (a merge only fuses parcels that touch edge to edge).
    const bb = await canvas(page).boundingBox();
    const box = await page.getByTestId("parcel-outline").first().boundingBox();
    const midY = Math.round(box.y + box.height / 2);
    await pick(page, "split");
    await page.mouse.click(Math.max(bb.x + 4, Math.round(box.x - 30)), midY);
    await page.waitForTimeout(150);
    await page.mouse.click(Math.round(box.x + box.width + 30), midY);
    await page.keyboard.press("Enter");
    await expect.poll(() => readModel(page).then((m) => m.count)).toBe(2); // two ACTIVE lots now
    expect(await outlineCount(page)).toBe(2);
    await page.keyboard.press("Escape"); // clear the split's selection before arming the pick

    // COMBINE — the whole tool that had no entry point in the right rail.
    const [a, c] = [await outlinePoint(page, 0, "centre"), await outlinePoint(page, 1, "centre")];
    await pick(page, "combine");
    await expect(page.getByText(/click parcels to merge/i)).toBeVisible();
    await page.mouse.click(...a);
    await page.waitForTimeout(200);
    await page.mouse.click(...c);
    await expect(page.getByText(/2 parcels picked/i)).toBeVisible();
    await page.getByRole("button", { name: /Merge parcels/i }).click();
    await expect.poll(() => readModel(page).then((m) => m.count)).toBe(1);
  });

  test("Edit boundary corners gives the gesture a visible home, and actually reshapes", async ({ page }) => {
    await boot(page);
    await drawParcel(page, 240, 150, 430, 300);
    const before = (await readModel(page)).parcels[0].pts;

    await pick(page, "boundary");
    const banner = page.getByTestId("boundary-edit-banner");
    await expect(banner).toBeVisible();

    // A drawn parcel arrives LOCKED, and a locked boundary has no editable path. The banner must
    // say that instead of teaching gestures it would then swallow — and carry the way out.
    await expect(banner).toContainText(/locked/i);
    await banner.getByTestId("boundary-edit-unlock").click();
    await expect.poll(() => readModel(page).then((m) => m.parcels[0].locked)).toBe(false);

    // Now it TEACHES the three gestures rather than hiding them in a tooltip.
    await expect(banner).toContainText(/drag a corner/i);
    await expect(banner).toContainText(/shift-click/i);

    // And the gesture it teaches works: Shift-click an edge inserts a corner.
    const mid = await outlinePoint(page, 0, "edge");  // midpoint of the first boundary edge
    await page.mouse.move(...mid);                    // reveals the insert dot
    await page.waitForTimeout(200);
    await page.keyboard.down("Shift");
    await page.mouse.click(...mid);
    await page.keyboard.up("Shift");
    await expect.poll(() => readModel(page).then((m) => m.parcels[0].pts)).toBe(before + 1);

    // Done leaves the mode (and so does Esc — no mode you can get stuck in).
    await banner.getByRole("button", { name: /^Done$/ }).click();
    await expect(banner).toBeHidden();
    await pick(page, "boundary");
    await expect(page.getByTestId("boundary-edit-banner")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("boundary-edit-banner")).toBeHidden();
  });

  test("the label and state rows that used to be right-click-only run from the menu", async ({ page }) => {
    await boot(page);
    await drawParcel(page, 240, 150, 430, 300);

    await pick(page, "chip");                                  // hide the acreage label
    await expect.poll(() => readModel(page).then((m) => m.parcels[0].chipHidden)).toBe(true);
    await openMenu(page);
    await expect(row(page, "chip")).toContainText(/show acreage label/i); // the row says what the next click does
    await row(page, "chip").click();
    await expect.poll(() => readModel(page).then((m) => m.parcels[0].chipHidden)).toBe(false);

    // A drawn parcel starts LOCKED, so the row reads "Unlock" and the first click unlocks it.
    await openMenu(page);
    await expect(row(page, "lock")).toContainText(/unlock/i);
    await row(page, "lock").click();
    await expect.poll(() => readModel(page).then((m) => m.parcels[0].locked)).toBe(false);
    await openMenu(page);
    await expect(row(page, "lock")).toContainText(/^Lock/i);
    await row(page, "lock").click();
    await expect.poll(() => readModel(page).then((m) => m.parcels[0].locked)).toBe(true);

    await pick(page, "active");
    await expect.poll(() => readModel(page).then((m) => m.parcels[0].active)).toBe(false);
  });

  test("Delete this parcel runs from the menu", async ({ page }) => {
    await boot(page);
    await drawParcel(page, 240, 150, 430, 300);
    await pick(page, "deleteSelected");
    await expect.poll(() => readModel(page).then((m) => m.total)).toBe(0);
  });

  test("setbacks are one step from the right rail, and the Land panel points back", async ({ page }) => {
    await boot(page);
    await drawParcel(page, 240, 150, 430, 300);

    // Right rail → the Land panel's Boundary section, where the setback editor lives.
    await pick(page, "setbacks");
    await expect(page.getByRole("button", { name: /By role/i })).toBeVisible();
    await expect(page.getByText(/Edit setbacks:/i)).toBeVisible();

    // …and the return path: the Land panel opens the Parcel tools menu.
    await page.getByTestId("land-to-parcel-tools").click();
    await expect(row(page, "draw")).toBeVisible();
  });
});
