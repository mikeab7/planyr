/* NEW-1 · NEW-2 · NEW-4 · NEW-5 · NEW-6 — logged-out drive of the real Site Planner canvas.
 *
 *  NEW-1/NEW-5  no × delete badge on a measurement or a callout leader — and Delete still works,
 *               so removing the badge strands nothing.
 *  NEW-2/NEW-6  ONE general clipboard: Ctrl+C/Ctrl+V copies whatever is selected (a callout, a
 *               parcel, a building with the elements bonded to it) with fresh ids, in one undo frame.
 *  NEW-4        the colour chip opens a picker whose palette + recently-used grids apply on click.
 *
 * Everything here is reachable signed-out with no external GIS, so it runs in this sandbox rather
 * than being parked for a live pass (ATTEMPT-BEFORE-YOU-PARK).
 */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

const site = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return map[Object.keys(map)[0]] || {};
});
const counts = async (page) => {
  const s = await site(page);
  return {
    els: (s.els || []).length,
    measures: (s.measures || []).length,
    callouts: (s.callouts || []).length,
    parcels: (s.parcels || []).length,
    markups: (s.markups || []).length,
  };
};

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

async function armMeasure(page, mode) {
  await page.getByRole("button", { name: "Measure modes" }).click();
  await page.getByRole("button", { name: mode, exact: true }).click();
}

async function drawLengthMeasure(page, x1, y1, x2, y2) {
  const before = (await counts(page)).measures;
  await page.mouse.click(x1, y1);
  await page.mouse.click(x2, y2);
  await expect.poll(async () => (await counts(page)).measures).toBe(before + 1);
}

async function drawBuilding(page, x1, y1, x2, y2) {
  await page.getByRole("button", { name: "Building", exact: true }).click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await counts(page)).els).toBeGreaterThanOrEqual(1);
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

async function drawCallout(page, tipX, tipY, boxX, boxY) {
  await page.getByRole("button", { name: /^Callout\s/ }).click();
  await page.mouse.click(tipX, tipY);
  await page.mouse.click(boxX, boxY);
  await page.getByPlaceholder("Type…").waitFor({ state: "visible" });
  await page.keyboard.type("Test note");
  await page.keyboard.press("Escape"); // commit the text
  await page.keyboard.press("Escape"); // deselect
  return { cx: boxX, cy: boxY };
}

/* ------------------------------------------------ NEW-1 / NEW-5: no × delete badges */

test.describe("no × delete badge on canvas objects (NEW-1 / NEW-5)", () => {
  test("a selected measurement shows grips but NO × — and Delete still removes it", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    await armMeasure(page, "Length");
    const y = box.y + 260;
    await drawLengthMeasure(page, box.x + 300, y, box.x + 520, y);
    await page.mouse.click(box.x + 410, y);                       // select it
    await expect(page.getByTestId("measure-selected")).toHaveCount(1);

    // The badge was a circle + "×" glyph inside the selected-measurement group. It must be gone.
    const xGlyphs = await page.getByTestId("measure-selected").locator("text").allTextContents();
    expect(xGlyphs.join("")).not.toContain("×");

    // …and the object is NOT stranded: Delete removes it.
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await counts(page)).measures).toBe(0);
    expect(errors).toEqual([]);
  });

  test("a selected callout's leader shows the re-aim grip but NO × — and Delete removes the callout", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    const c = await drawCallout(page, box.x + 300, box.y + 500, box.x + 430, box.y + 450);
    await expect.poll(async () => (await counts(page)).callouts).toBe(1);
    await page.mouse.click(c.cx, c.cy);                            // select it

    // The per-leader delete badge carried this stable testid — it must no longer render at all.
    await expect(page.locator('[data-testid^="callout-delete-leader-"]')).toHaveCount(0);
    // The leader itself (and therefore its right-click "Delete Leader" path) is still there.
    await expect(page.locator('[data-testid^="callout-leader-"]').first()).toBeVisible();

    await page.keyboard.press("Delete");
    await expect.poll(async () => (await counts(page)).callouts).toBe(0);
    expect(errors).toEqual([]);
  });
});

/* --------------------------------------------- NEW-2 / NEW-6: the general clipboard */

test.describe("Ctrl+C / Ctrl+V copies whatever is selected (NEW-2 / NEW-6)", () => {
  test("a callout copies and pastes — the type the owner reported as un-copyable", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    const c = await drawCallout(page, box.x + 300, box.y + 500, box.x + 430, box.y + 450);
    await page.mouse.click(c.cx, c.cy);
    await page.keyboard.press("Control+c");
    await page.mouse.move(box.x + 620, box.y + 300);               // paste lands under the cursor
    await page.keyboard.press("Control+v");

    await expect.poll(async () => (await counts(page)).callouts).toBe(2);
    const s = await site(page);
    const ids = s.callouts.map((x) => x.id);
    expect(new Set(ids).size).toBe(2);                              // fresh id, not a duplicate
    expect(s.callouts[1].text).toBe("Test note");                   // content came across
    // ONE undo frame: a single Ctrl+Z takes the whole paste back.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await counts(page)).callouts).toBe(1);
    expect(errors).toEqual([]);
  });

  test("a measurement copies and pastes", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await armMeasure(page, "Length");
    const y = box.y + 260;
    await drawLengthMeasure(page, box.x + 300, y, box.x + 520, y);
    await page.mouse.click(box.x + 410, y);
    await expect(page.getByTestId("measure-selected")).toHaveCount(1);

    await page.keyboard.press("Control+c");
    await page.mouse.move(box.x + 400, box.y + 420);
    await page.keyboard.press("Control+v");
    await expect.poll(async () => (await counts(page)).measures).toBe(2);
  });

  test("a parcel copies — and the copy arrives OFF so it can't double-count the site area", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    await page.getByRole("button", { name: "Parcel", exact: true }).click();
    await page.getByTitle(/Add land to this plan/i).click();
    await page.getByRole("button", { name: /Draw a new boundary/i }).click();
    const box = await canvas(page).boundingBox();
    const ring = [[box.x + 220, box.y + 150], [box.x + 480, box.y + 150], [box.x + 480, box.y + 360], [box.x + 220, box.y + 360]];
    for (const [x, y] of ring) { await page.mouse.click(x, y); await page.waitForTimeout(60); }
    await page.mouse.click(ring[0][0], ring[0][1]);
    await expect.poll(async () => (await counts(page)).parcels).toBe(1);
    await page.keyboard.press("Escape");

    // Selecting a parcel by click needs the "Select parcels" mode (B311, deliberately off by
    // default so a lot's edge doesn't swallow clicks during building work). Simpler and more
    // stable here: reloading a plan whose only content is one parcel auto-selects it, which is
    // the app's own path — no synthetic selection state.
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    const pb = await page.getByTestId("parcel-outline").first().boundingBox();
    await page.keyboard.press("Control+c");
    await page.mouse.move(Math.round(pb.x + pb.width / 2), Math.round(pb.y + pb.height / 2));
    await page.keyboard.press("Control+v");

    await expect.poll(async () => (await counts(page)).parcels).toBe(2);
    const s = await site(page);
    expect(new Set(s.parcels.map((p) => p.id)).size).toBe(2);
    // The stated decision: the copy is INACTIVE (visible + editable, excluded from the area math),
    // and it does NOT claim the original's county parcel record.
    const copy = s.parcels[1];
    expect(copy.active).toBe(false);
    expect(copy.gisKey).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test("a building copies WITH the elements bonded to it, as one unit (NEW-2)", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    const b = await drawBuilding(page, box.x + 260, box.y + 200, box.x + 500, box.y + 340);
    await page.mouse.dblclick(b.cx, b.cy);                          // open the building's inspector

    // Bond real dock zones (truck court, trailer parking) to it through the app's OWN control, so
    // the relation under test is the genuine `attachedTo` bond, not a hand-written fixture.
    await page.getByTitle(/Extend every dock side out by one zone/).click();
    await expect.poll(async () => (await counts(page)).els).toBeGreaterThan(1);
    const beforeEls = (await counts(page)).els;
    const beforeKids = (await site(page)).els.filter((e) => e.attachedTo).length;
    expect(beforeKids).toBeGreaterThanOrEqual(1);

    await page.keyboard.press("Escape");
    await page.mouse.click(b.cx, b.cy);                             // select the building itself
    await page.keyboard.press("Control+c");
    await page.mouse.move(box.x + 700, box.y + 520);
    await page.keyboard.press("Control+v");

    // The host AND every element bonded to it arrived — nothing left behind.
    await expect.poll(async () => (await counts(page)).els).toBe(beforeEls * 2);
    const s = await site(page);
    const hosts = s.els.filter((e) => e.type === "building" && !e.attachedTo && !e.points);
    const kids = s.els.filter((e) => e.attachedTo);
    expect(hosts.length).toBe(2);
    expect(kids.length).toBe(beforeKids * 2);
    // Every copied child is bonded to the COPY, never back to the original building.
    const hostIds = new Set(hosts.map((h) => h.id));
    kids.forEach((k) => expect(hostIds.has(k.attachedTo)).toBe(true));
    expect(new Set(kids.map((k) => k.attachedTo)).size).toBe(2);
    // The role tags survived, so the copy's court still knows which face it belongs to.
    expect(kids.filter((k) => k.truckCourt).length).toBe(
      s.els.filter((e) => e.truckCourt).length);
    // …and it was ONE undo frame.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await counts(page)).els).toBe(beforeEls);
    expect(errors).toEqual([]);
  });
});

/* ---------------- Standards: ONE Apply for the whole panel.
 *
 * NEW-2 note: the panel-level Project|All SCOPE toggle this file also used to cover is gone —
 * it read as one axis with Apply and was two. The footer's three named actions and the pending
 * draft that replaced it are covered in e2e/standards-footer-setback.spec.js. */

const openPicker = async (page, nth = 0) => {
  await page.getByRole("button", { name: /color$/i }).nth(nth).click();
  return page.getByRole("group", { name: "Palette colors" }).first();
};

test.describe("Standards: one Apply for the whole panel", () => {
  test("changing a parcel standard offers ONE Apply, which restyles EVERY existing parcel in one undo frame", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    // Two parcels, so "Apply" has to be retroactive across more than one object.
    await page.getByRole("button", { name: "Parcel", exact: true }).click();
    await page.getByTitle(/Add land to this plan/i).click();
    await page.getByRole("button", { name: /Draw a new boundary/i }).click();
    const box = await canvas(page).boundingBox();
    const ring = [[box.x + 220, box.y + 150], [box.x + 480, box.y + 150], [box.x + 480, box.y + 360], [box.x + 220, box.y + 360]];
    for (const [x, y] of ring) { await page.mouse.click(x, y); await page.waitForTimeout(60); }
    await page.mouse.click(ring[0][0], ring[0][1]);
    await expect.poll(async () => (await counts(page)).parcels).toBeGreaterThanOrEqual(1);
    await page.keyboard.press("Escape");

    // Open Standards → Parcels.
    await page.getByRole("button", { name: "Standards", exact: true }).click();
    await page.getByRole("button", { name: /^Parcels/ }).click();

    // No setting carries its own Apply row any more — there is exactly ONE for the panel.
    await expect(page.getByTestId("standards-bar")).toHaveCount(1);
    await expect(page.getByTestId("standards-apply")).toHaveCount(1);

    // Change the parcel outline standard from inside the picker the colour chip opens.
    const palette = await openPicker(page, 0);
    await expect(palette).toBeVisible();
    const swatch = palette.getByRole("button").nth(2);
    const wanted = (await swatch.getAttribute("title")).toLowerCase();
    await swatch.click();
    await expect(palette).toBeHidden();                     // a pick closes the popover

    // The ONE Apply carries a live count of the objects it would change — and applies them.
    const apply = page.getByTestId("standards-apply");
    await expect(apply).toBeEnabled();
    await apply.click();

    await expect.poll(async () => {
      const s = await site(page);
      return (s.parcels || []).every((p) => (p.stroke || "").toLowerCase() === wanted);
    }).toBe(true);

    // A short toast confirms it and carries an Undo (never a modal, never a paragraph) — and it
    // is anchored LOW AND LEFT in the canvas, not over the middle of the plan.
    const toast = page.getByTestId("standards-apply-toast");
    await expect(page.getByText(/^Applied to \d+ objects?$/)).toBeVisible();
    const tb = await toast.boundingBox();
    const cb = await canvas(page).boundingBox();
    expect(tb.x).toBeLessThan(cb.x + cb.width * 0.4);        // to one side, not optically centred
    expect(tb.y).toBeGreaterThan(cb.y + cb.height * 0.6);    // low
    expect(tb.x).toBeGreaterThanOrEqual(cb.x - 1);           // inside the canvas, never over a panel

    // …and it stays out of the plan's centre when the panel CLOSES (the pane widens under it)
    // and at a narrow window, where the pane is the whole width.
    await page.getByRole("button", { name: "Standards", exact: true }).click();   // close the panel
    await expect(toast).toBeVisible();
    const cb2 = await canvas(page).boundingBox();
    const tb2 = await toast.boundingBox();
    expect(tb2.x).toBeGreaterThanOrEqual(cb2.x - 1);
    expect(tb2.x).toBeLessThan(cb2.x + cb2.width * 0.4);
    expect(tb2.y + tb2.height).toBeLessThan(cb2.y + cb2.height);   // never off the bottom

    await page.setViewportSize({ width: 720, height: 800 });
    await expect(toast).toBeVisible();
    const cb3 = await canvas(page).boundingBox();
    const tb3 = await toast.boundingBox();
    expect(tb3.x).toBeGreaterThanOrEqual(cb3.x - 1);
    expect(tb3.x + tb3.width).toBeLessThanOrEqual(cb3.x + cb3.width + 1);         // never overflows
    expect(tb3.y).toBeGreaterThan(cb3.y + cb3.height * 0.5);                      // still low

    await page.getByTestId("standards-apply-undo").click();
    await expect.poll(async () => {
      const s = await site(page);
      return (s.parcels || []).some((p) => (p.stroke || "").toLowerCase() !== wanted);
    }).toBe(true);
    expect(errors).toEqual([]);
  });

});

/* ------------------------------ the colour picker: swatches live INSIDE it, recents mean recents */

test.describe("the colour control is a chip that opens a picker", () => {
  test("the panel row shows only the chip; the palette + recents live in the popover", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    const b = await drawBuilding(page, box.x + 260, box.y + 200, box.x + 500, box.y + 340);
    await page.mouse.dblclick(b.cx, b.cy);                          // open Properties

    // Nothing is on the panel but the chip — no swatch row beside it.
    await expect(page.getByRole("group", { name: "Palette colors" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Recently used colors" })).toHaveCount(0);

    const chip = page.getByRole("button", { name: /^Fill color$/i }).first();
    await chip.click();
    const palette = page.getByRole("group", { name: "Palette colors" }).first();
    await expect(palette).toBeVisible();
    // On a fresh browser nothing has been used yet, so the RECENTS section is absent entirely
    // (never padded out of the palette — that made the list lie about what had been used).
    await expect(page.getByRole("group", { name: "Recently used colors" })).toHaveCount(0);

    const target = palette.getByRole("button").nth(1);
    const wanted = (await target.getAttribute("title")).toLowerCase();
    await target.click();                                            // applies immediately

    await expect.poll(async () => {
      const s = await site(page);
      const el = (s.els || []).find((e) => e.type === "building");
      return (el?.fill || el?.stroke || "").toLowerCase();
    }).toBe(wanted);

    // The colour just used is now recorded — and shows up as a RECENTS section next time.
    await expect.poll(() => page.evaluate(() => {
      const l = JSON.parse(localStorage.getItem("planyr:colorRecents:v1") || "[]");
      return l[0] || "";
    })).toBe(wanted);
    await chip.click();
    await expect(page.getByRole("group", { name: "Recently used colors" }).first()).toBeVisible();

    // Escape closes it, and focus is not trapped.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "Palette colors" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a live picking session records ONE recent, not one per shade the cursor crosses", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    const b = await drawBuilding(page, box.x + 260, box.y + 200, box.x + 500, box.y + 340);
    await page.mouse.dblclick(b.cx, b.cy);
    await page.getByRole("button", { name: /^Fill color$/i }).first().click();

    const wheel = page.getByLabel("Custom color").first();
    const shades = ["#ff0000", "#ff3300", "#ff6600", "#ff9900", "#ffcc00", "#ffff00"];
    for (const hex of shades) {
      // What the OS wheel does while the cursor moves through the spectrum: fire per shade.
      await wheel.evaluate((el, v) => {
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, hex);
    }
    // Live preview still recolours the object — that behaviour is intentional and stays.
    await expect.poll(async () => {
      const el = ((await site(page)).els || []).find((e) => e.type === "building");
      return (el?.fill || "").toLowerCase();
    }).toBe("#ffff00");
    // …but nothing has reached the recents list yet.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("planyr:colorRecents:v1") || "[]"))).toEqual([]);

    await page.keyboard.press("Escape");                             // end the picking session
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("planyr:colorRecents:v1") || "[]")))
      .toEqual(["#ffff00"]);                                         // exactly ONE, the final value
    expect(errors).toEqual([]);
  });
});
