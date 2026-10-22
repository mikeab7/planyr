/* NEW-1 (2026-10-22) — a right-click along a road ALWAYS opens the road's full menu, with "Add control point" then
 * "Add a T-intersection here" leading it. Owner: "no longer have the ability to right click on a road and tee off from there.
 * It only adds a control point. The right click should give me the full drop down menu, but add control point should
 * probably be at the top."
 *
 * The defect: once a road was SELECTED, `onCanvasVtxContextCapture` answered a right-click on its centreline with a one-row
 * "Add control point" menu and swallowed the event, so the element's own menu (where the T row lives) was unreachable.
 * Drives the real canvas logged out, a plain straight two-point road, selected AND not selected, plus a measurement line.
 *
 * Run: npx playwright test e2e/road-context-menu.spec.js
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}
async function pickRoadPreset(page) {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /^\d+′$/ }).first().click();
}
const roads = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return (site.els || []).filter((e) => e.type === "road" && Array.isArray(e.pts) && e.pts.length >= 2)
    .map((e) => ({ id: e.id, pts: e.pts, cls: e.roadClass, w: e.travelW }));
});

/* Draw one straight 2-point road across the canvas; returns its screen midpoint. */
async function drawStraightRoad(page) {
  const box = await canvas(page).boundingBox();
  await pickRoadPreset(page);
  const y = box.y + 340;
  await page.mouse.click(box.x + 260, y);
  await page.mouse.click(box.x + 720, y);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect.poll(() => roads(page).then((r) => r.length)).toBe(1);
  return { box, mid: { x: box.x + 490, y }, y };
}
/* The menu's rows in DOM order, as visible text. */
const menuRows = (page) => page.locator(".menu button").evaluateAll((bs) => bs.map((b) => ({ id: b.getAttribute("data-testid") || "", text: (b.textContent || "").trim() })));

for (const selected of [true, false]) {
  test.describe(`road right-click menu — road ${selected ? "SELECTED" : "NOT selected"}`, () => {
    test("mid-segment opens the FULL menu with Add control point then the T row on top", async ({ page }) => {
      await startBlank(page);
      const { mid, box } = await drawStraightRoad(page);
      // After Escape nothing is selected; a plain click on the pavement selects the road.
      if (selected) { await page.mouse.click(mid.x, mid.y); }
      else { await page.mouse.click(box.x + 40, box.y + 60); }

      await page.mouse.click(mid.x, mid.y, { button: "right" });
      const rows = await menuRows(page);
      expect(rows.length, "the full element menu, not a one-row stub").toBeGreaterThan(4);
      expect(rows[0].id, "row 1 is Add control point").toBe("el-menu-add-control-point");
      expect(rows[0].text).toContain("Add control point");
      expect(rows[1].id, "row 2 is the T").toBe("road-branch-here");
      expect(rows[1].text).toContain("Add a T-intersection here");
      expect(rows.filter((r) => r.id === "road-branch-here"), "the T is not repeated in a Road section").toHaveLength(1);
      expect(rows.map((r) => r.text).join("|")).toMatch(/Bring to Front/);
      expect(rows.map((r) => r.text).join("|")).toMatch(/Delete/);
    });

    test("Add control point inserts a vertex at the clicked spot", async ({ page }) => {
      await startBlank(page);
      const { mid, box } = await drawStraightRoad(page);
      if (selected) await page.mouse.click(mid.x, mid.y); else await page.mouse.click(box.x + 40, box.y + 60);
      const grips = page.locator('[data-handle-layer] circle');
      const centresOf = () => grips.evaluateAll((cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
      await page.mouse.click(mid.x + 60, mid.y, { button: "right" });
      const baseline = (await centresOf()).length;
      await page.getByTestId("el-menu-add-control-point").click();
      // The road is selected afterwards and wears a round grip per control point; the new one sits ON the line at the clicked spot.
      // (Read off the canvas — a bare vertex insert is not a gesture end, so the device copy lags behind it.)
      await expect.poll(() => grips.count()).toBeGreaterThan(baseline);
      const centres = await centresOf();
      expect(centres.some((c) => Math.abs(c.x - (mid.x + 60)) < 4 && Math.abs(c.y - mid.y) < 4), "a grip appears where the right-click landed").toBe(true);
    });

    test("Add a T-intersection here starts a branch that resolves as a real tee on this road", async ({ page }) => {
      await startBlank(page);
      const { mid, box, y } = await drawStraightRoad(page);
      if (selected) await page.mouse.click(mid.x, mid.y); else await page.mouse.click(box.x + 40, box.y + 60);
      const parent = (await roads(page))[0];
      await page.mouse.click(mid.x, mid.y, { button: "right" });
      await page.getByTestId("road-branch-here").click();
      await page.mouse.click(mid.x, y - 160); // far end of the branch
      await page.getByTestId("road-draft-finish").click({ force: true });
      await expect.poll(() => roads(page).then((r) => r.length), { timeout: 10_000 }).toBe(2);
      const all = await roads(page);
      const branch = all.find((r) => r.id !== parent.id);
      const host = all.find((r) => r.id === parent.id);
      expect(branch.cls, "inherits the host's class").toBe(parent.cls);
      expect(branch.w, "…and its width").toBe(parent.w);
      expect(host.pts.length, "the host gained the junction vertex").toBe(3);
      const j = host.pts[1];
      const end = branch.pts[0];
      expect(Math.hypot(j.x - end.x, j.y - end.y), "the branch starts exactly on that vertex").toBeLessThan(1.5);
    });
  });
}

test.describe("road right-click menu — other cases", () => {
  test("a LOCKED road offers neither Add control point nor the T", async ({ page }) => {
    await startBlank(page);
    const { mid } = await drawStraightRoad(page);
    await page.mouse.click(mid.x, mid.y, { button: "right" });
    await page.getByRole("button", { name: /^Lock$/ }).click();
    await page.mouse.click(mid.x, mid.y, { button: "right" });
    const rows = await menuRows(page);
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.map((r) => r.id)).not.toContain("el-menu-add-control-point");
    expect(rows.map((r) => r.id)).not.toContain("road-branch-here");
  });

  test("right-click right at a corner of a selected multi-point road still opens the vertex menu", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await pickRoadPreset(page);
    await page.mouse.click(box.x + 260, box.y + 300);
    await page.mouse.click(box.x + 490, box.y + 300);
    await page.mouse.click(box.x + 490, box.y + 460);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await page.mouse.click(box.x + 400, box.y + 300); // select via a straight run
    await page.mouse.click(box.x + 490, box.y + 300, { button: "right" }); // the middle control point
    await expect(page.getByRole("button", { name: /Delete control point/ })).toBeVisible();
    expect(await menuRows(page).then((r) => r.map((x) => x.id))).not.toContain("el-menu-add-control-point");
  });

  test("a SELECTED measurement line's right-click leads with Add control point", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await page.getByRole("button", { name: /^Measure mode:/ }).click();
    await page.getByRole("button", { name: "Polylength", exact: true }).click();
    await page.mouse.click(box.x + 260, box.y + 380);
    await page.mouse.click(box.x + 560, box.y + 380);
    await page.mouse.click(box.x + 560, box.y + 500);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await page.mouse.click(box.x + 410, box.y + 380); // select it
    await page.mouse.click(box.x + 410, box.y + 380, { button: "right" });
    const rows = await page.locator(".menu button").evaluateAll((bs) => bs.map((b) => (b.textContent || "").trim()));
    expect(rows[0]).toContain("Add control point");
    expect(rows.join("|")).toMatch(/Properties/);
    expect(rows.join("|")).toMatch(/Delete measurement/);
  });
});
