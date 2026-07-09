/* Element-delete hardening (NEW-1 / NEW-2) — the regression guard for "Delete on a road did nothing
 * ~20 times, then suddenly worked." Runs LOGGED OUT against a seeded-blank site (no account needed),
 * so it covers the pure client-side half of the bug that the sandbox can reproduce:
 *   • the road keyboard-Delete TRAP — an armed interior control point routed Delete to "delete this
 *     vertex", and on a non-removable/stale index it swallowed the keypress WITHOUT clearing the armed
 *     point, so every later Delete no-op'd until an unrelated click reset it. The fix makes a no-op
 *     vertex-delete FALL THROUGH to a whole-element delete, so Delete is never a dead key.
 *   • the shared deleteSel path via BOTH the panel button and the keyboard.
 *   • deletion PERSISTS across a reload (logged-out localStorage store).
 *
 * The cloud-sync half (the silent commit-timeout wedge + no-resurrection) is signed-in only and lives
 * in the unit tests (test/elementApi.test.js) + VERIFICATION.md V### for a live click-through.
 *
 * Drawing a CENTERLINE road (the variant with editable control points + the selVtx trap) needs a real
 * travel width picked first (SitePlanner.jsx:3092 gates the centerline path on roadWidth !== "free"),
 * so the helper opens Road presets → "24′ travel" before clicking centerline points. finishRoad
 * auto-selects the new road, so its control-point handles (data-testid road-vtx-N) render immediately. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const ROAD_PTS = [[300, 300], [430, 340], [560, 300], [690, 340]]; // 4 pts → 2 interior control points

// Read the logged-out site model straight from localStorage: total els + centerline-road count +
// the first road's control-point count. This is the on-disk truth, so it doubles as the persistence
// assertion after a reload.
function readEls(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    const els = site.els || [];
    const road = els.find((e) => e.type === "road" && Array.isArray(e.pts));
    return {
      els: els.length,
      clRoads: els.filter((e) => e.type === "road" && Array.isArray(e.pts) && e.pts.length >= 2).length,
      roadPts: road ? road.pts.length : null,
    };
  });
}

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

// Draw a centerline road and leave it selected (finishRoad selects it + switches to the Select tool).
async function drawRoad(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByText(/24′ travel/).click();
  for (const [dx, dy] of ROAD_PTS) await page.mouse.click(box.x + dx, box.y + dy);
  await page.keyboard.press("Enter");
  await expect.poll(() => readEls(page).then((r) => r.clRoads)).toBe(1);
  await expect(page.locator('[data-testid^="road-vtx-"]').first()).toBeVisible();
}

test.describe("element delete — never a silent no-op (logged out)", () => {
  test("panel 'Delete element' button removes the road and it stays gone after reload", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawRoad(page);

    await page.getByRole("button", { name: /Delete element/i }).click();
    await expect.poll(() => readEls(page).then((r) => r.clRoads)).toBe(0);

    await page.reload();
    await expect.poll(() => readEls(page).then((r) => r.clRoads)).toBe(0); // persisted deletion
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("keyboard Delete after arming an interior control point never wedges (the reported bug)", async ({ page }) => {
    await startBlank(page);
    await drawRoad(page);

    // Arm an interior control point, then press Delete. With a REMOVABLE point this deletes just that
    // vertex (the intended B230 behavior) — road survives with one fewer point.
    await page.getByTestId("road-vtx-1").click();
    await page.keyboard.press("Delete");
    await expect.poll(() => readEls(page).then((r) => r.roadPts)).toBe(3);
    await expect.poll(() => readEls(page).then((r) => r.clRoads)).toBe(1);

    // The armed point was cleared by that delete; a second Delete must now delete the WHOLE road —
    // under the old bug it could no-op forever on a stale/non-removable armed index.
    await page.keyboard.press("Delete");
    await expect.poll(() => readEls(page).then((r) => r.clRoads)).toBe(0);
  });

  test("reshaping a control point then Delete deletes the whole road", async ({ page }) => {
    await startBlank(page);
    await drawRoad(page);

    // Drag (reshape) an interior control point. The drag-end clears the armed point, so Delete then
    // targets the whole road — matching "road selected → Delete → road gone".
    const v = await page.getByTestId("road-vtx-2").boundingBox();
    await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
    await page.mouse.down();
    await page.mouse.move(v.x + 30, v.y - 40, { steps: 6 });
    await page.mouse.move(v.x + 50, v.y - 60, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => readEls(page).then((r) => r.clRoads)).toBe(1);

    await page.keyboard.press("Delete");
    await expect.poll(() => readEls(page).then((r) => r.clRoads)).toBe(0);
  });
});
