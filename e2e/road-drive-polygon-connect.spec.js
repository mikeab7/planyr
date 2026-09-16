/* NEW-3 (this round) — a free-drawn POLYGON parking field / paving pad never became a drive
 * target at all: the road's endpoint welded onto it (a real `driveTee` got stored, the "Connected
 * to…" toast fired), but the junction rendered as a bare, unfilleted rectangle — no curb return, no
 * "Connected to…" toast on a fresh look, no DRIVE INTERSECTION section in Properties. Root cause,
 * measured live with a debug dump of the raw elements: TWO independent copies of the same wrong
 * precondition, one in the CONNECT decision and one in the RENDER decision.
 *
 * `closeElPoly` (SitePlanner.jsx) commits a freshly free-drawn polygon element as
 * `{ id, type, points, rot }` — no `cx`/`cy` at all; a centroid is synced in only on the element's
 * FIRST reshape (a vertex drag), via `frameBBox`. Both `driveTargetKind` (decides whether an
 * element is a valid connect target at all) and `driveJunctionsOf` (decides whether a road with a
 * `driveTee` renders a junction) ran `typeof el.cx === "number"` BEFORE branching on `el.points`, so
 * a freshly drawn polygon field failed that check and was silently treated as "not a target" in
 * both places — CONNECT never started for it in one case, and even where a `driveTee` HAD already
 * been stored (this fix's own first half), the render still discarded it. This is invisible to any
 * PURE geometry test (`test/roadDriveJunctionFillet.test.js`'s polygon suite) because those replicate
 * `driveJunctionsOf`'s math directly, bypassing the connect-decision layer entirely — this spec
 * drives the real tool, the real click-to-place-a-vertex polygon draw, and the real road-draw
 * connect magnet, so it exercises the exact code path the owner's report did.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, roadNetwork, netSurfaces } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}

// Draw a free-form (click-to-place-vertex) polygon field with the given tool — NOT a rectangle
// drag — matching V1192544's own "FREEHAND (polygon) draw tool" repro steps exactly.
async function drawPolygonPad(page, pts, kind) {
  await page.getByRole("button", { name: kind, exact: true }).click();
  for (const p of pts) await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Enter");
}

async function drawRoadTo(page, from, to) {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /^\d+′$/ }).last().click();
  await page.mouse.click(from.x, from.y);
  await page.mouse.click(to.x, to.y);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
}

test.describe("road → FREE-DRAWN polygon parking/paving field — the connect fires and the junction fillets", () => {
  for (const kind of ["Parking", "Paving"]) {
    test(`${kind}: a road ending on a freshly drawn polygon field's edge connects and renders a real fillet`, async ({ page }) => {
      await startBlank(page);
      const box = await canvas(page).boundingBox();
      // A clean, axis-aligned quad drawn via CLICKS (never a rect drag), so it commits through
      // `closeElPoly` — the exact path that carried no `cx`/`cy` at creation.
      const A = { x: box.x + 250, y: box.y + 300 };
      const B = { x: box.x + 550, y: box.y + 300 };
      const C = { x: box.x + 550, y: box.y + 550 };
      const D = { x: box.x + 250, y: box.y + 550 };
      await drawPolygonPad(page, [A, B, C, D], kind);

      // Land the road's endpoint exactly on the field's top edge, midway between A and B.
      const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      await drawRoadTo(page, { x: mid.x - 60, y: mid.y - 150 }, mid);

      await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? 0).toBe(1);
      const net = await roadNetwork(page);
      expect(net.drives[0].wedges, "both curb-return wedges were computed").toBe(2);
      expect(net.regions.length, "the driveway's pavement is ONE region, not a bare rect").toBe(1);
      // The pre-fix defect rendered a bare 4-point rectangle (no fillet at all) — a real curb
      // return tessellates into many more vertices than that.
      expect(net.regions[0].outer.length, "the region is a filleted shape, not a bare 4-point rect").toBeGreaterThan(4);
      await expect(netSurfaces(page)).toHaveCount(1);
    });
  }

  test("connects near the middle of a CONCAVE (inward) corner of a free-drawn field, no crash", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    const pts = [
      { x: box.x + 200, y: box.y + 200 },
      { x: box.x + 500, y: box.y + 200 },
      { x: box.x + 500, y: box.y + 350 },
      { x: box.x + 350, y: box.y + 350 },
      { x: box.x + 350, y: box.y + 500 },
      { x: box.x + 200, y: box.y + 500 },
    ];
    await drawPolygonPad(page, pts, "Parking");
    const target = { x: (pts[2].x + pts[3].x) / 2, y: pts[2].y - 10 };
    await drawRoadTo(page, { x: target.x, y: target.y - 150 }, target);

    await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? 0).toBe(1);
    const net = await roadNetwork(page);
    expect(net.regions.length, "one connected, simple pavement region even at a concave corner").toBe(1);
  });
});
