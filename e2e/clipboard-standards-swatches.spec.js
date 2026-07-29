/* NEW-1 · NEW-2 · NEW-4 · NEW-5 · NEW-6 — logged-out drive of the real Site Planner canvas.
 *
 *  NEW-1/NEW-5  no × delete badge on a measurement or a callout leader — and Delete still works,
 *               so removing the badge strands nothing.
 *  NEW-2/NEW-6  ONE general clipboard: Ctrl+C/Ctrl+V copies whatever is selected (a callout, a
 *               parcel, a building with the elements bonded to it) with fresh ids, in one undo frame.
 *  NEW-4        the recently-used swatch row sits beside the color wheel and applies on click.
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

/* ------------------------------------------- NEW-3: Standards scope + retroactive apply */

test.describe("Standards: Apply to existing + default scope (NEW-3)", () => {
  test("changing a parcel standard offers Apply, which restyles EVERY existing parcel in one undo frame", async ({ page }) => {
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

    // Change the parcel outline standard through its color wheel's recents row (one click).
    const outline = page.getByRole("group", { name: "Recently used colors" }).first();
    await expect(outline).toBeVisible();
    const swatch = outline.getByRole("button").nth(2);
    const wanted = (await swatch.getAttribute("title")).toLowerCase();
    await swatch.click();

    // The Apply chip appears with a live count of what it would change — and applies it.
    const apply = page.getByRole("button", { name: /^Apply \d+$/ }).first();
    await expect(apply).toBeVisible();
    await apply.click();

    await expect.poll(async () => {
      const s = await site(page);
      return (s.parcels || []).every((p) => (p.stroke || "").toLowerCase() === wanted);
    }).toBe(true);

    // A short toast confirms it and carries an Undo (never a modal, never a paragraph).
    const undo = page.getByTestId("standards-apply-undo");
    await expect(page.getByText(/^Applied to \d+ parcels?$/)).toBeVisible();
    await undo.click();
    await expect.poll(async () => {
      const s = await site(page);
      return (s.parcels || []).some((p) => (p.stroke || "").toLowerCase() !== wanted);
    }).toBe(true);
    expect(errors).toEqual([]);
  });

  test("the scope chips are short, and switching to All moves the default off this project", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await page.getByRole("button", { name: "Standards", exact: true }).click();
    await page.getByRole("button", { name: /^Parcels/ }).click();

    const project = page.getByRole("button", { name: "Project", exact: true }).first();
    const all = page.getByRole("button", { name: "All", exact: true }).first();
    await expect(project).toBeVisible();
    await expect(all).toBeVisible();

    // Set a project-scope value first, then promote it to the account scope.
    const row = page.getByRole("group", { name: "Recently used colors" }).first();
    const swatch = row.getByRole("button").nth(3);
    const wanted = (await swatch.getAttribute("title")).toLowerCase();
    await swatch.click();
    await expect(project).toHaveAttribute("aria-pressed", "true");

    await all.click();
    await expect(all).toHaveAttribute("aria-pressed", "true");
    // Promoting DROPS the project's own copy, so this plan keeps following the account default.
    await expect.poll(async () => {
      const s = await site(page);
      return (s.settings?.parcelStyle || {}).stroke;
    }).toBeUndefined();
    // …and the value itself is still what's in force (read back through the account store).
    await expect.poll(() => page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem("planyr:userPrefs:v1") || "{}");
      return (p.planStandards?.parcelStyle?.stroke || "").toLowerCase();
    })).toBe(wanted);
    expect(errors).toEqual([]);
  });
});

/* ----------------------------------------------------- NEW-4: recently-used swatches */

test.describe("recently-used color swatches (NEW-4)", () => {
  test("the row sits beside the wheel, is seeded so it's never blank, and applies on click", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    const b = await drawBuilding(page, box.x + 260, box.y + 200, box.x + 500, box.y + 340);
    await page.mouse.dblclick(b.cx, b.cy);                          // open Properties

    const row = page.getByRole("group", { name: "Recently used colors" }).first();
    await expect(row).toBeVisible();                                 // seeded from the default palette
    const swatches = row.getByRole("button");
    expect(await swatches.count()).toBeGreaterThan(1);

    const target = swatches.nth(1);
    const wanted = await target.getAttribute("title");
    await target.click();                                            // applies immediately

    await expect.poll(async () => {
      const s = await site(page);
      const el = (s.els || []).find((e) => e.type === "building");
      return (el?.fill || el?.stroke || "").toLowerCase();
    }).toBe(wanted.toLowerCase());

    // The color just used is now FIRST in the shared list — that's the whole point of the row.
    await expect.poll(() => page.evaluate(() => {
      const l = JSON.parse(localStorage.getItem("planyr:colorRecents:v1") || "[]");
      return l[0] || "";
    })).toBe(wanted.toLowerCase());
    expect(errors).toEqual([]);
  });
});
