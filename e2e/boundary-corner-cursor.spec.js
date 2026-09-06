/* NEW-1 (B1264944) — RECURRENCE of the B1253248 placement-cursor fix (see
 * e2e/pointer-affordance-placement.spec.js): that fix made every PLACEMENT tool hold a
 * crosshair over anything already drawn. It never reached "Edit boundary corners" — the one
 * mode named in the owner's own report ("if I am trying to place a corner... it will change
 * based on what is behind it") — because that mode arms the plain Select tool rather than a
 * distinct `tool` id (see `startBoundaryEdit` in SitePlanner.jsx), so every `tool === "select"`
 * cursor ternary in the file read it as ordinary Select and showed what the object underneath
 * would do there instead of what the mode is FOR.
 *
 * Every assertion here is RED on the pre-fix build (confirmed by stashing the SitePlanner.jsx
 * change and re-running) and GREEN after. The instrument is the one the report specifies: walk
 * up from `document.elementFromPoint` via `getComputedStyle(...).cursor` — the SAME probe as
 * pointer-affordance-placement.spec.js — with the Select-tool "move" cursor over the same spot
 * as the RED-PROOF CONTROL that the sample point is genuinely on the element.
 *
 * ⚠ Closing a parcel boundary calls `requestFit()` (SitePlanner.jsx's `closePoly`), which re-fits
 * the view to the new geometry — so a screen coordinate computed BEFORE the parcel exists (or
 * before a later resize) is stale afterward. Every point this spec hovers is read live off the
 * DOM (a real element's `boundingBox()`, or the live-rendered parcel polygon's own `points`
 * attribute) AFTER all drawing/resizing is done, never precomputed from canvas fractions.
 */
import { test, expect } from "@playwright/test";
import { startBlank, canvas, drawBuilding, selectTool } from "./drawKinds.js";

const cursorAt = (page, x, y) => page.evaluate(([px, py]) => {
  const el = document.elementFromPoint(px, py);
  return el ? getComputedStyle(el).cursor : null;
}, [x, y]);

const siteRecord = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const id = localStorage.getItem("planarfit:currentSite:v1");
  return map[id] || null;
});

/* Draws a parcel boundary through the real Parcel tool at CALLER-CHOSEN corners (fractions of
 * the canvas box AT THE TIME OF DRAWING) — the stock `drawParcel` helper in drawKinds.js always
 * lands in the same empty corner of the canvas, which is exactly wrong for this bug (the report
 * is about a parcel that HAS a building on it, so it needs to land wherever the caller wants). */
async function drawParcelAt(page, box, fracPts, { plan = "Concept A", expect: n = 1 } = {}) {
  await page.locator('[data-rail-tab="parcel"]').click();
  const addLandBtn = page.getByTitle(/Add land to this plan/i);
  if (await addLandBtn.count()) await addLandBtn.click();
  await page.getByRole("button", { name: /Draw a new boundary/i }).click();
  await expect(page.getByText(/drop boundary points/i)).toBeVisible();
  const pts = fracPts.map(([fx, fy]) => ({ x: Math.round(box.x + box.width * fx), y: Math.round(box.y + box.height * fy) }));
  for (const { x, y } of pts) { await page.mouse.click(x, y); await page.waitForTimeout(90); }
  await page.mouse.click(pts[0].x, pts[0].y);
  await expect.poll(async () => (await siteRecord(page))?.parcels?.length ?? 0).toBe(n);
  await page.keyboard.press("Escape");
  await selectTool(page);
  await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="left-menu-panel"]');
    const lit = panel && panel.previousElementSibling && panel.previousElementSibling.querySelector('button[aria-pressed="true"]');
    if (lit) lit.click();
  });
}

const enterBoundaryEdit = async (page) => {
  await page.locator('[data-testid="rail-parcel-tools"]').click();
  await page.locator('[data-testid="parcel-menu-boundary"]').click();
  await expect(page.locator('[data-testid="boundary-edit-banner"]')).toBeVisible();
};

/* The building's LIVE on-screen centre, read after every draw/resize/fit has settled — never a
 * precomputed drag-rectangle midpoint, which `requestFit()` can invalidate.
 * el-tier: every test in this file draws exactly ONE element (a building) and this reads THAT
 * one element's own rendered box — not a census of the plan's contents (COUNT-EVERY-KIND). */
async function buildingCenter(page) {
  const b = await page.locator("[data-el-id]").first().boundingBox();
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}

/* The first drawn parcel's LIVE on-screen ring, as an array of {x,y} PAGE coordinates — read off
 * the real rendered `parcel-outline` polygon's own `points` attribute (SVG user units, which line
 * up 1:1 with CSS px against the planner's own viewBox) rather than trusting where a click landed
 * before the boundary closed and the view re-fit around it. */
async function parcelScreenRing(page) {
  const svg = await canvas(page).boundingBox();
  const raw = await page.locator('[data-testid="parcel-outline"]').first().getAttribute("points");
  return raw.trim().split(/\s+/).map((pair) => {
    const [px, py] = pair.split(",").map(Number);
    return { x: Math.round(svg.x + px), y: Math.round(svg.y + py) };
  });
}

test.describe("NEW-1 (B1264944) — Edit boundary corners owns its own cursor, not the object underneath", () => {
  test("map, building, and a locked parcel edge all read the corner-editing cursor — not move/default/grab", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    // Building first, at a fixed spot; then a parcel boundary drawn AROUND it, so the parcel
    // being edited genuinely has a building on it (the owner's exact repro), not just nearby.
    await drawBuilding(page, box);
    await drawParcelAt(page, box, [[0.50, 0.18], [0.86, 0.18], [0.86, 0.52], [0.50, 0.52]]);

    const bldg = await buildingCenter(page);
    const ring = await parcelScreenRing(page); // [top-left, top-right, bottom-right, bottom-left]
    // A point 20% of the way from the top-left CORNER toward the ring's centroid — inside the
    // parcel, comfortably clear of the building (which sits well inset from every edge).
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length, cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    const interiorX = Math.round(ring[0].x + 0.2 * (cx - ring[0].x)), interiorY = Math.round(ring[0].y + 0.2 * (cy - ring[0].y));
    // The midpoint of the top edge (ring[0]→ring[1]) — a parcel edge nowhere near the building.
    const edgeX = Math.round((ring[0].x + ring[1].x) / 2), edgeY = Math.round((ring[0].y + ring[1].y) / 2);
    // Well outside the parcel's own bounding box, on whichever side has the most clearance — a
    // point the view-fit is very unlikely to have placed anything else on top of.
    const minX = Math.min(...ring.map((p) => p.x));
    const bareX = Math.round((box.x + minX) / 2), bareY = Math.round(box.y + box.height * 0.5);

    // RED-PROOF CONTROL — in plain Select (before entering the mode), the building really does
    // read "move" at this exact point. Without this, a wrong sample point makes every assertion
    // below vacuous.
    expect(await cursorAt(page, bldg.x, bldg.y), "setup check: the building should read \"move\" in plain Select").toBe("move");

    await enterBoundaryEdit(page);

    // THE REPORTED CASE, all four readings from BACKLOG's own repro table.
    expect(await cursorAt(page, bareX, bareY), "bare map must read the corner-editing cursor").toBe("crosshair");
    expect(await cursorAt(page, bldg.x, bldg.y), "a building on the plan must never show \"move\" in this mode").toBe("crosshair");
    // The freshly-drawn parcel arrives LOCKED (closePoly) — same state the reported repro hit.
    expect(await cursorAt(page, edgeX, edgeY), "a locked parcel's own edge must read the corner-editing cursor, not \"default\"").toBe("crosshair");
    expect(await cursorAt(page, interiorX, interiorY), "empty parcel interior must read the corner-editing cursor, not \"grab\"").toBe("crosshair");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the two legitimate exceptions still work: the corner handle, and inserting a point on an edge", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawParcelAt(page, box, [[0.30, 0.20], [0.66, 0.20], [0.66, 0.54], [0.30, 0.54]]);
    await enterBoundaryEdit(page);

    // Unlock — the banner's own escape hatch — so the drag/insert gestures the mode teaches are
    // actually live (a locked boundary has no editable path at all).
    await page.locator('[data-testid="boundary-edit-unlock"]').click();
    await expect(page.locator('[data-testid="boundary-edit-unlock"]')).toHaveCount(0);

    // EXCEPTION 1 — the corner handle you can grab (checked now, dragged LAST — see below).
    const handle = page.locator('[data-testid="vtx-handle"]').first();
    await expect(handle).toBeVisible();
    const hb = await handle.boundingBox();
    const hx = Math.round(hb.x + hb.width / 2), hy = Math.round(hb.y + hb.height / 2);
    expect(await cursorAt(page, hx, hy), "a draggable parcel corner must read a grab affordance").toBe("move");

    // EXCEPTION 2 — the edge where a new corner would be inserted. Sample the midpoint of the
    // ring's second edge (ring[1]→ring[2]), read LIVE off the rendered polygon, well clear of any
    // vertex. Runs BEFORE the corner drag below, which is free to move any corner and would
    // otherwise carry an edge's midpoint away from where this test expects to find it.
    const ring = await parcelScreenRing(page);
    const edgeMidX = Math.round((ring[1].x + ring[2].x) / 2);
    const edgeMidY = Math.round((ring[1].y + ring[2].y) / 2);
    const countBefore = (await siteRecord(page)).parcels[0].points.length;
    await page.mouse.move(edgeMidX, edgeMidY);
    await page.keyboard.down("Shift");
    await page.mouse.click(edgeMidX, edgeMidY);
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await siteRecord(page)).parcels[0].points.length, {
      message: "Shift-click on an edge must still insert a new corner in this mode",
    }).toBe(countBefore + 1);

    // FUNCTIONAL PROOF — the mode's own drag still works. Re-query the handle now that a point was
    // just inserted (the DOM may have re-rendered) and compare the WHOLE points array afterward —
    // nothing here guarantees a stable index for whichever handle is grabbed.
    const handle2 = page.locator('[data-testid="vtx-handle"]').first();
    const hb2 = await handle2.boundingBox();
    const hx2 = Math.round(hb2.x + hb2.width / 2), hy2 = Math.round(hb2.y + hb2.height / 2);
    const pointsBefore = (await siteRecord(page)).parcels[0].points;
    await page.mouse.move(hx2, hy2);
    await page.mouse.down();
    await page.mouse.move(hx2 + 40, hy2 + 30, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await siteRecord(page)).parcels[0].points, {
      message: "dragging a corner must still reshape the boundary in this mode",
    }).not.toEqual(pointsBefore);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("exiting the mode restores ordinary Select cursors, and a placement tool still holds crosshair over the same building", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawBuilding(page, box);
    await drawParcelAt(page, box, [[0.50, 0.18], [0.86, 0.18], [0.86, 0.52], [0.50, 0.52]]);
    const bldg = await buildingCenter(page);

    await enterBoundaryEdit(page);
    expect(await cursorAt(page, bldg.x, bldg.y)).toBe("crosshair");

    // Done — back to plain Select. The building is an ordinary select-and-drag target again.
    await page.locator('[data-testid="boundary-edit-banner"]').getByRole("button", { name: "Done" }).click();
    await expect(page.locator('[data-testid="boundary-edit-banner"]')).toHaveCount(0);
    expect(await cursorAt(page, bldg.x, bldg.y), "leaving the mode must restore the ordinary Select \"move\" cursor").toBe("move");

    // REGRESSION GUARD for B1253248 — a placement tool must still hold crosshair over the same
    // building; this fix must not have reopened that one.
    await page.getByRole("button", { name: /^Building$/ }).first().click();
    expect(await cursorAt(page, bldg.x, bldg.y), "a placement tool must still hold crosshair over a building (B1253248)").toBe("crosshair");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("phone width, dark theme: the corner-editing cursor is unaffected by viewport or theme", async ({ page }) => {
    // None of the patched cursor ternaries reference `narrow` or a theme token — this test proves
    // that by exercising the mode under both at once, rather than trusting a source read alone.
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(() => localStorage.setItem("planyr.theme", "dark"));
    await startBlank(page); // full-width — the standard draw flows below need the desktop rail
    const box = await canvas(page).boundingBox();
    await drawBuilding(page, box);
    await drawParcelAt(page, box, [[0.50, 0.18], [0.86, 0.18], [0.86, 0.52], [0.50, 0.52]]);

    // NOW drop to phone width. The view's pan/zoom does NOT auto-refit to a resized container —
    // exactly what a real phone user hitting this would also see — so "Zoom to fit" (a real,
    // always-available control) brings the drawing back on screen, the same thing they'd tap.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const narrowBox = await canvas(page).boundingBox(); // `box` above is stale post-resize
    await page.getByRole("button", { name: "Zoom to fit" }).first().click();
    // The fit pans/zooms over a couple of frames — poll until the building's on-screen centre
    // stops moving (same idiom e2e/pointer-affordance-placement.spec.js uses for its own
    // settling dot) rather than trusting the first read after the click.
    let bldg = await buildingCenter(page);
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(100);
      const next = await buildingCenter(page);
      if (next.x === bldg.x && next.y === bldg.y) break;
      bldg = next;
    }

    // The Parcel-tools rail lives behind the phone tools FAB at this width (B113 — the rail
    // auto-hides so drawing has the full screen), marked `data-canvas-corner="tools-fab"`.
    await page.locator('[data-canvas-corner="tools-fab"]').click();
    await enterBoundaryEdit(page);
    // Picking a menu row closes the MENU (`setToolMenu(false)`) but not the mobile rail itself —
    // `selectTool`'s `setMobileTools(false)` never runs here (the tool was already "select", so
    // `startBoundaryEdit` never calls it) — so the rail's own tap-to-dismiss backdrop is still
    // covering the canvas. Tap a corner of the CANVAS itself (the backdrop is scoped to that
    // wrapper, not the whole page — a page-corner tap hits the real app header instead).
    await page.mouse.click(Math.round(narrowBox.x + 10), Math.round(narrowBox.y + narrowBox.height - 10));
    await expect(page.locator('[data-canvas-corner="tools-fab"]')).toBeVisible();

    bldg = await buildingCenter(page);
    expect(await cursorAt(page, bldg.x, bldg.y), "narrow width + dark theme: a building must still read the corner-editing cursor").toBe("crosshair");

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
