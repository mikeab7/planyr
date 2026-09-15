/* B1612608 (item 2) — a road placed against a paved surface it would connect to joins ON
 * PLACEMENT, with no second action. Extends B955/NEW-1's road → parking-drive / truck-court
 * connect (e2e/road-drive-connect.spec.js), which already welded a road's FINAL point onto a
 * "Parking" field or a truckCourt-flagged dock zone. Three real gaps closed here, each named
 * because each is a real, separately-reproduced defect, not a restatement of the same one:
 *
 *   1. A plain "Paving" pad (the tool the owner's real truck courts are usually drawn with —
 *      "Drag for a rectangle, or click points for an irregular paving / drive / truck court")
 *      was NOT a connect target unless it carried the auto-generated dock zone's `truckCourt`
 *      flag — `driveTargetKind` (SitePlanner.jsx) now accepts any `type:"paving"` rect.
 *   2. Only the LAST point of a freshly-drawn road was ever checked for a connect — a road
 *      STARTED at a truck court connected nothing. `finishRoad` now also checks the FIRST point
 *      when the last one found nothing.
 *   3. An endpoint placed WELL INSIDE a big paved rect (not just near its edge) read a large
 *      distance to every edge and so never connected — `findDriveConnect` / `driveJunctionsOf`
 *      now also trigger on CONTAINMENT, never relocating the endpoint in that case (see
 *      `rectContainsPoint`, roadGeometry.js).
 *
 * Run logged out, Snap OFF (matches the sibling spec) — this module never depends on auth.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, roadNetwork, netSurfaces } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
  await canvas(page).click({ position: { x: 20, y: 20 } }); // Snap stays OFF (default)
}

async function pickRoadPreset(page) {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /^\d+′$/ }).first().click();
}

// Draw a plain PAVING rectangle (not "Parking", not the auto-generated dock zone) by dragging.
async function drawPaving(page, box, x0, y0, x1, y1) {
  await page.getByRole("button", { name: "Paving", exact: true }).click();
  await page.mouse.move(box.x + x0, box.y + y0);
  await page.mouse.down();
  await page.mouse.move(box.x + (x0 + x1) / 2, box.y + (y0 + y1) / 2, { steps: 5 });
  await page.mouse.move(box.x + x1, box.y + y1, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

async function drawRoad(page, box, points) {
  await pickRoadPreset(page);
  for (const [x, y] of points) await page.mouse.click(box.x + x, box.y + y);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
}

function roadEls(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).filter((e) => e.type === "road");
  });
}
async function connectedRoad(page) {
  const roads = await roadEls(page);
  return roads.find((r) => r.driveTee) || null;
}

test.describe("B1612608 item 2 — road → paving connect ON PLACEMENT (no second action)", () => {
  test("endpoint dropped ON a plain Paving pad's edge connects the moment placement completes", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPaving(page, box, 300, 450, 820, 640);
    // Road ending ON the paving pad's top edge (y=450) — no second action after Enter.
    await drawRoad(page, box, [[560, 200], [560, 450]]);

    const road = await connectedRoad(page);
    expect(road, "the road must be connected the instant placement completes").toBeTruthy();
    expect(road.driveTee.kind).toBe("truckcourt"); // untagged paving defaults to truck-scale (item 2's own decision)
    await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? 0).toBe(1);
    await expect(netSurfaces(page)).toHaveCount(1);
  });

  test("negative: a road placed clearly away from everything connects to nothing", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPaving(page, box, 300, 450, 820, 640);
    // Road nowhere near the paving pad.
    await drawRoad(page, box, [[100, 100], [100, 250]]);

    const road = await connectedRoad(page);
    expect(road).toBeNull();
    await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? 0).toBe(0);
  });

  test("endpoint exactly on the edge connects", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPaving(page, box, 300, 450, 820, 640);
    await drawRoad(page, box, [[560, 300], [560, 450]]); // ends precisely at the top edge y=450
    expect(await connectedRoad(page)).toBeTruthy();
  });

  test("endpoint overlapping well inside the pad connects without moving (containment)", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPaving(page, box, 200, 400, 900, 700); // a big pad
    // Endpoint dropped near the CENTRE of the pad — far from every edge.
    await drawRoad(page, box, [[550, 150], [550, 550]]);
    const road = await connectedRoad(page);
    expect(road).toBeTruthy();
    // Never relocated: the endpoint sits well clear of every edge of its OWN connect target — if it
    // had been snapped to the nearest edge (the near-edge behaviour, correct for THAT case) it would
    // sit ON one. Read both elements back from storage and do the containment/edge-distance math in
    // plan feet, with no dependency on the live view transform.
    const geom = await page.evaluate((targetId) => {
      const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const site = map[Object.keys(map)[0]] || {};
      const t = (site.els || []).find((e) => e.id === targetId);
      const r = (site.els || []).find((e) => e.type === "road" && e.driveTee && e.driveTee.targetId === targetId);
      return { t: t ? { cx: t.cx, cy: t.cy, w: t.w, h: t.h } : null, last: r ? r.pts[r.pts.length - 1] : null };
    }, road.driveTee.targetId);
    expect(geom.t).toBeTruthy();
    expect(geom.last).toBeTruthy();
    const { cx, cy, w, h } = geom.t;
    const distToNearestEdge = Math.min(Math.abs(geom.last.x - (cx - w / 2)), Math.abs((cx + w / 2) - geom.last.x), Math.abs(geom.last.y - (cy - h / 2)), Math.abs((cy + h / 2) - geom.last.y));
    expect(distToNearestEdge).toBeGreaterThan(15); // genuinely well inside, not a near-edge snap
    const insideX = geom.last.x >= cx - w / 2 && geom.last.x <= cx + w / 2;
    const insideY = geom.last.y >= cy - h / 2 && geom.last.y <= cy + h / 2;
    expect(insideX && insideY).toBe(true);
  });

  test("endpoint just outside the tolerance does NOT connect", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPaving(page, box, 300, 450, 820, 640);
    // 40 screen px short of the top edge — comfortably past the 12 px connect tolerance.
    await drawRoad(page, box, [[560, 200], [560, 410]]);
    expect(await connectedRoad(page)).toBeNull();
  });

  test("a road STARTED at a paving pad (first point, not the last) connects", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPaving(page, box, 300, 450, 820, 640);
    // Click order reversed: begin ON the pad's edge, draw AWAY from it.
    await drawRoad(page, box, [[560, 450], [560, 200]]);
    const road = await connectedRoad(page);
    expect(road, "starting the draw at the pad must connect too").toBeTruthy();
    await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? 0).toBe(1);
  });

  test("both ends near DIFFERENT paving pads — one end connects (reported single-driveTee limitation), nothing crashes", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPaving(page, box, 100, 450, 380, 640);   // pad A (left)
    await drawPaving(page, box, 700, 450, 980, 640);   // pad B (right)
    await drawRoad(page, box, [[300, 450], [800, 450]]); // start on A's edge, end on B's edge
    const road = await connectedRoad(page);
    expect(road, "at least one end must connect").toBeTruthy();
    // The data model carries exactly one driveTee — never two, never a crash/duplicate road.
    const roads = await roadEls(page);
    expect(roads.length).toBe(1);
    expect(roads.filter((r) => r.driveTee).length).toBe(1);
  });

  test("road against another road is unaffected (still connects — a TEE, unchanged pre-existing behaviour)", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawRoad(page, box, [[300, 300], [600, 300]]);      // road A (through road)
    await drawRoad(page, box, [[450, 500], [450, 300]]);      // road B tees into A's interior
    // A tee keeps BOTH roads as separate elements (never a merge — that's only for a matching
    // END-to-END meet); this item does not touch the road↔road path at all, so the pre-existing
    // junction must still be recognised.
    const roads = await roadEls(page);
    expect(roads.length).toBe(2);
    await expect.poll(async () => (await roadNetwork(page))?.tees.length ?? 0).toBe(1);
  });

  test("road against a BUILDING never auto-connects (a building is not paving)", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await page.getByRole("button", { name: "Building", exact: true }).click();
    await page.mouse.move(box.x + 300, box.y + 450);
    await page.mouse.down();
    await page.mouse.move(box.x + 600, box.y + 640, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.press("Escape");
    await drawRoad(page, box, [[450, 200], [450, 450]]); // ends right at the building's edge
    expect(await connectedRoad(page)).toBeNull();
    await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? 0).toBe(0);
  });

  test("dragging an EXISTING road's endpoint onto a paving pad afterward connects it", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPaving(page, box, 300, 450, 820, 640);
    // Road drawn clearly away first — no connect at placement.
    await drawRoad(page, box, [[560, 100], [560, 300]]);
    expect(await connectedRoad(page)).toBeNull();
    // The Escape that ends drawRoad's finish sequence drops selection, so — same pattern as
    // e2e/road-tee-slide.spec.js's grabTeeHandle — click the road's own pavement (midway between
    // its two points, clear of either endpoint) to select it and bring its vertex handles onto
    // the canvas, then grab the LAST control point's handle by testid rather than guessing raw
    // pixel coordinates, and drag it onto the pad's near edge.
    await page.mouse.click(box.x + 560, box.y + 200);
    const roads = await roadEls(page);
    const last = roads[0].pts.length - 1;
    const handle = page.getByTestId(`road-vtx-${last}`);
    await expect(handle).toBeVisible();
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 560, box.y + 400, { steps: 4 });
    await page.mouse.move(box.x + 560, box.y + 450, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => connectedRoad(page)).toBeTruthy();
  });

  test("undo immediately after a connecting placement removes the road and the connection in one step", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPaving(page, box, 300, 450, 820, 640);
    await drawRoad(page, box, [[560, 200], [560, 450]]);
    expect(await connectedRoad(page)).toBeTruthy();
    await canvas(page).click({ position: { x: 20, y: 20 } }); // deselect so Ctrl+Z targets the plan, not a field
    await page.keyboard.press("Control+z");
    const roads = await roadEls(page);
    expect(roads.length).toBe(0); // the whole placement — geometry AND connection — undoes as one step
  });

  test("the connection survives a save and reload", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPaving(page, box, 300, 450, 820, 640);
    await drawRoad(page, box, [[560, 200], [560, 450]]);
    const before = await connectedRoad(page);
    expect(before).toBeTruthy();
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    const after = await connectedRoad(page);
    expect(after).toBeTruthy();
    expect(after.driveTee.targetId).toBe(before.driveTee.targetId);
    expect(after.driveTee.kind).toBe(before.driveTee.kind);
    await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? 0).toBe(1);
  });
});
