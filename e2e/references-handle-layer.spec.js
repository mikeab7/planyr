/* NEW-1 / NEW-2 — reference overlays: handles always on top, and an explicit z-order control.
 *
 * The owner's repro (Weld County, a coloured land-plan exhibit dropped on the map): one of the
 * overlay's resize corners fell under the parcel boundary, so it was drawn behind the green line
 * AND could not be grabbed — the overlay could not be resized from that corner at all. He also had
 * no way to bring the reference forward.
 *
 * This drives the REAL render path, logged out, on a locally-seeded plan — no auth, no GIS, no
 * network — and asserts the two things a screenshot cannot: which node actually answers a hit test
 * at each handle's centre, and where the reference sits in the paint order relative to the parcel.
 *
 * The geometry is deliberately hostile: the reference's top edge lies exactly ON the parcel's top
 * boundary, so two of its four corner grips are directly over the boundary stroke.
 */
import { test, expect } from "@playwright/test";

// 1×1 transparent PNG — the raster's content is irrelevant; imgW/imgH/ftPerPx set its real size.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const SITE = {
  schemaVersion: 12, id: "handle-layer", groupId: "handle-layer",
  site: "Handle Layer Guard", name: "Handle Layer Guard",
  updatedAt: 1783000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: 40.348437, lon: -104.981121 }, county: "Weld", status: "active",
  // A 1320 × 1320 ft lot. Its TOP edge is the line y = 0.
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  // 400 × 300 ft reference whose top edge sits exactly on the parcel's top boundary, so its two
  // top corner grips land on the boundary stroke — the owner's case.
  sheetOverlays: [{
    id: "ov1", name: "Land plan exhibit.png", src: PNG,
    x: 400, y: 0, imgW: 400, imgH: 300, ftPerPx: 1, rotation: 0, opacity: 0.85, locked: false, visible: true,
  }],
  underlay: null, parcelDrawings: [], settings: {}, els: [],
};

/** Every overlay resize grip, with the node the browser says is on top at its centre — plus what
 *  is stacked UNDER it, so the assertion can prove the parcel really is in the way (a guard that
 *  only checks "the handle answers" would pass just as happily if the parcel weren't drawn). */
const gripHitTests = (page) => page.evaluate(() => {
  const grips = Array.from(document.querySelectorAll('[data-handle="overlay-scale"]'));
  return grips.map((g) => {
    const r = g.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const stack = document.elementsFromPoint(cx, cy);
    const top = stack[0];
    return {
      cx: Math.round(cx), cy: Math.round(cy),
      isSelf: top === g,
      topHandle: top ? top.getAttribute("data-handle") : null,
      topTag: top ? top.tagName : null,
      topTestid: top ? top.getAttribute("data-testid") : null,
      // Is the parcel (its visible outline or its fat grab stroke) underneath this grip?
      overParcel: stack.slice(1).some((n) => n.getAttribute && (n.getAttribute("data-testid") === "parcel-outline"
        || (n.tagName === "polygon" && n.getAttribute("pointer-events") === "stroke"))),
    };
  });
});

/** Paint order: does the reference raster come BEFORE (under) or AFTER (over) the parcel? */
const referenceVsParcel = (page) => page.evaluate(() => {
  const img = document.querySelector('[data-overlay-image="1"]');
  const parcel = document.querySelector('[data-testid="planner-canvas"] polygon[data-parcel-id], [data-testid="planner-canvas"] polyline[data-parcel-id]')
    || Array.from(document.querySelectorAll('[data-testid="planner-canvas"] polygon')).find((p) => (p.getAttribute("points") || "").split(" ").length === 4);
  if (!img || !parcel) return { ok: false, img: !!img, parcel: !!parcel };
  const rel = img.compareDocumentPosition(parcel);
  // Node.DOCUMENT_POSITION_FOLLOWING = 4 → the parcel comes AFTER the image → image is UNDER it.
  return { ok: true, referenceUnderParcel: !!(rel & 4) };
});

async function openPlan(page) {
  await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText("Handle Layer Guard", { exact: false }).first().click();
  await page.locator('[data-testid="planner-canvas"]').first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(800); // fit-on-load + first commit settle
}

/** Open the References panel and select the seeded reference by name. */
async function selectReference(page) {
  await page.locator('button[title="References"]').first().click();
  await page.getByRole("button", { name: "Land plan exhibit.png" }).first().click();
  await expect(page.locator('[data-handle="overlay-scale"]').first()).toBeVisible({ timeout: 10000 });
}

test.describe("reference overlays: handle layer + z-order (NEW-1 / NEW-2)", () => {
  test("every resize grip wins the hit test, including the two over the parcel boundary", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await openPlan(page);
    await selectReference(page);

    const grips = await gripHitTests(page);
    expect(grips, "the four corner grips should be rendered").toHaveLength(4);
    // The guard is only meaningful if the parcel really is in the way: the seed puts the
    // reference's top edge ON the boundary, so at least the two top grips must have parcel
    // geometry stacked beneath them. Without this, a plan with no parcel would pass vacuously.
    expect(grips.filter((g) => g.overParcel).length,
      "no grip has the parcel underneath it — the fixture no longer reproduces the owner's case").toBeGreaterThanOrEqual(2);
    for (const g of grips) {
      expect(
        g.isSelf,
        `a grip at (${g.cx},${g.cy}) is buried — the top node there is <${g.topTag}> handle=${g.topHandle} testid=${g.topTestid}`,
      ).toBe(true);
    }

    // The rotate knob is chrome too, and it sits ABOVE the reference (outside it), so it can fall
    // over the parcel interior just as easily.
    const rotate = await page.evaluate(() => {
      const k = document.querySelector('[data-handle="overlay-rotate"]');
      if (!k) return null;
      const r = k.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === k;
    });
    expect(rotate, "the rotate knob is missing or buried").toBe(true);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the grips stay grabbable — dragging the corner over the boundary resizes the reference", async ({ page }) => {
    await openPlan(page);
    await selectReference(page);

    const before = await page.evaluate(() => {
      const i = document.querySelector('[data-overlay-image="1"]').getBoundingClientRect();
      return { w: i.width, h: i.height };
    });
    // Grab the TOP-LEFT grip — the one sitting on the parcel's boundary line — and pull it out.
    const box = await page.locator('[data-handle="overlay-scale"]').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 - 90, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => {
      const i = document.querySelector('[data-overlay-image="1"]').getBoundingClientRect();
      return { w: i.width, h: i.height };
    });
    expect(after.w, "the drag did not resize the reference — the grip never took the press").toBeGreaterThan(before.w + 5);
    expect(after.h).toBeGreaterThan(before.h + 5);
  });

  test("the default is unchanged: a reference draws UNDER the parcel until you say otherwise", async ({ page }) => {
    await openPlan(page);
    const rel = await referenceVsParcel(page);
    expect(rel.ok, `could not find both the reference raster and the parcel (${JSON.stringify(rel)})`).toBe(true);
    expect(rel.referenceUnderParcel).toBe(true);
    // …and the panel says so.
    await page.locator('button[title="References"]').first().click();
    await expect(page.locator('[data-reference-band="below"]')).toHaveCount(1);
  });

  test("'Draw above the plan' lifts the reference over the parcel, and survives a reload", async ({ page }) => {
    await openPlan(page);
    await selectReference(page);

    await page.locator('[data-testid="reference-above-ov1"]').check();
    await page.waitForTimeout(400);
    expect((await referenceVsParcel(page)).referenceUnderParcel).toBe(false);
    await expect(page.locator('[data-reference-band="above"]')).toHaveCount(1);

    // The grips must STILL win the hit test from the promoted band (the fix is not "put it on top").
    for (const g of await gripHitTests(page)) expect(g.isSelf).toBe(true);

    // Persisted ON THE REFERENCE RECORD, so it rides the same save/sync path as every other
    // overlay field and survives a reload. (Asserted against the saved plan rather than by
    // reloading the page: this spec's own seed init-script re-runs on every navigation and would
    // overwrite the saved plan with the fixture, hiding the very thing under test.)
    await page.waitForTimeout(1500); // autosave settle
    const saved = await page.evaluate((id) => {
      const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const ov = (all[id]?.sheetOverlays || []).find((o) => o.id === "ov1");
      return ov ? { aboveParcel: ov.aboveParcel } : null;
    }, SITE.id);
    expect(saved, "the reference is missing from the saved plan").not.toBeNull();
    expect(saved.aboveParcel).toBe(true);
  });
});
