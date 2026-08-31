/* NEW-1 · NEW-2 — the Standards panel: the setback line's own style controls, and the footer's
 * three explicitly named actions.
 *
 * NEW-1  The setback line had NO controls: colour, weight and dash were hardcoded at the one
 *        place it was drawn, while the parcel boundary beside it carried a full set of standards.
 *        It now has the same three, in the same section, under their own sub-label.
 * NEW-2  The footer's `Project | All` toggle is gone. It looked like one axis with Apply and was
 *        two — the toggle chose WHERE A VALUE IS STORED, Apply PUSHED IT ONTO WHAT IS DRAWN. The
 *        three actions now say what they do, and because "Save for this plan" is explicit, an
 *        edit is a PENDING DRAFT until a button commits it.
 *
 * Everything here is reachable signed-out with no external GIS, so it runs in this sandbox rather
 * than being parked for a live pass (ATTEMPT-BEFORE-YOU-PARK). The one path that genuinely needs
 * an account — the account-level write behind "Save for all projects" — is asserted only as far
 * as it goes logged out (the control disables and says why); the write itself is the live check.
 */
import { test, expect } from "@playwright/test";
import { PALETTES } from "../src/shared/theme/palette.js";

/* The setback ring's default colour is a THEME token, not a constant this spec gets to restate:
 * B1192 moved it indigo → the property-line green and left two hardcoded hexes here red. */
const SETBACK_DEFAULT = PALETTES.light.canvasSetback.toLowerCase();

const canvas = (p) => p.getByTestId("planner-canvas");
const SHOTS = "test-results/standards-footer";

const site = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return map[Object.keys(map)[0]] || {};
});
const parcelCount = async (page) => ((await site(page)).parcels || []).length;

async function startBlank(page) {
  await page.goto("/");
  await page.getByTestId("map-start-blank-menu-btn").click();
  await page.getByTestId("map-start-blank-menu-item").click();
  await expect(canvas(page)).toBeVisible();
}

async function drawParcel(page) {
  await page.locator('[data-rail-tab="parcel"]').click();
  await page.getByTitle(/Add land to this plan/i).click();
  await page.getByRole("button", { name: /Draw a new boundary/i }).click();
  const box = await canvas(page).boundingBox();
  const ring = [[box.x + 220, box.y + 150], [box.x + 480, box.y + 150], [box.x + 480, box.y + 360], [box.x + 220, box.y + 360]];
  for (const [x, y] of ring) { await page.mouse.click(x, y); await page.waitForTimeout(60); }
  await page.mouse.click(ring[0][0], ring[0][1]);
  await expect.poll(() => parcelCount(page)).toBeGreaterThanOrEqual(1);
  await page.keyboard.press("Escape");
}

async function openStandardsParcels(page) {
  await page.getByRole("button", { name: "Standards", exact: true }).click();
  await expect(page.getByTestId("standards-bar")).toHaveCount(1);
  // The Parcels section remembers its state, so only expand it when it is actually collapsed.
  const sec = page.getByRole("button", { name: /^Parcels/ });
  if ((await sec.getAttribute("aria-expanded")) === "false") await sec.click();
  await expect(page.getByText("Parcel line", { exact: true })).toBeVisible();
}

const bar = (p) => p.getByTestId("standards-bar");
/* The ring's weight and dash are both multiplied by the live zoom factor, so what is stable —
 * and what "renders byte-identically to before" actually means — is the dash pattern's ratio to
 * the stroke weight (5.6 / 4.8 at any zoom = the historic "7 6" at weight 1.25). */
const ringShape = async (ring) => {
  const [dash, w, stroke] = await Promise.all([
    ring.getAttribute("stroke-dasharray"), ring.getAttribute("stroke-width"), ring.getAttribute("stroke"),
  ]);
  return { dashRatio: dash.split(/[\s,]+/).map((n) => +(+n / +w).toFixed(2)), stroke: (stroke || "").toLowerCase() };
};
const dirtyMark = (p) => p.getByTestId("standards-dirty");
const lineStyleSelect = (p, nth) => p.locator('select').filter({ has: p.locator('option[value="dotted"]') }).nth(nth);

/* ------------------------------------------------------------------ NEW-1: the setback line */

test.describe("the setback line has the same tools as the parcel line", () => {
  test("both lines are labelled, and the setback's colour / weight / style drive the ring", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawParcel(page);
    await openStandardsParcels(page);

    // Two lines to style, so each group is named — no unlabelled pair of colour rows.
    await expect(page.getByText("Parcel line", { exact: true })).toBeVisible();
    await expect(page.getByText("Setback line", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Outline color$/i })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Setback line color$/i })).toHaveCount(1);

    // The ring is drawn with the theme default until anything is changed. Weight and dash are
    // scaled by the live zoom (B617/B880), so the invariant is the RATIO they hold to each other.
    // The colour is the palette's `canvasSetback` — B1192 moved that default indigo → the owner's
    // property-line green, so read the token rather than restating a hex that has already drifted once.
    const ring = page.getByTestId("setback-ring").first();
    expect(await ringShape(ring)).toEqual({ dashRatio: [5.6, 4.8], stroke: SETBACK_DEFAULT });

    // Pick a new setback colour: it is a DRAFT — the ring on the canvas has not moved yet,
    // because a parcel is STAMPED at creation and only Apply rewrites what is already drawn.
    await page.getByRole("button", { name: /^Setback line color$/i }).click();
    const palette = page.getByRole("group", { name: "Palette colors" }).first();
    await expect(palette).toBeVisible();
    const swatch = palette.getByRole("button").nth(2);
    const wanted = (await swatch.getAttribute("title")).toLowerCase();
    await swatch.click();
    await expect(dirtyMark(page)).toBeVisible();

    // Apply pushes it onto the parcel already drawn — the ring AND its stored key change.
    await page.getByTestId("standards-apply").click();
    await expect.poll(async () => ((await site(page)).parcels || []).every((p) => (p.sbStroke || "").toLowerCase() === wanted)).toBe(true);
    await expect.poll(() => ring.getAttribute("stroke")).toBe(wanted);

    // The line STYLE follows too (the setback select is the second dash select in the section).
    await lineStyleSelect(page, 1).selectOption("solid");
    await expect(dirtyMark(page)).toBeVisible();
    await page.getByTestId("standards-apply").click();
    await expect.poll(() => ring.getAttribute("stroke-dasharray")).toBeFalsy();
    expect(errors).toEqual([]);
  });

  test("a parcel with no stored setback style still renders exactly as it always did", async ({ page }) => {
    await startBlank(page);
    await drawParcel(page);
    const ring = page.getByTestId("setback-ring").first();
    // The unchanged look: the theme setback colour and a 1.25-weight "7 6" dash, both scaled by the
    // same zoom factor they always were — so the ratios are the fixed point.
    expect(await ringShape(ring)).toEqual({ dashRatio: [5.6, 4.8], stroke: SETBACK_DEFAULT });
    const stored = (await site(page)).parcels[0];
    expect("sbStroke" in stored).toBe(false);
    expect("sbWeight" in stored).toBe(false);
    expect("sbDash" in stored).toBe(false);
  });

  test("one parcel can override the setback line without touching the others", async ({ page }) => {
    await startBlank(page);
    await drawParcel(page);
    // Select the parcel by a LINE, not its interior (the interior stays free for building work).
    // The setback ring is a grab target for its lot (B420), and the view zoom-to-fits after a
    // draw, so take the target off the rendered ring rather than the coordinates we clicked.
    const rb = await page.getByTestId("setback-ring").first().boundingBox();
    await page.mouse.click(Math.round(rb.x + rb.width / 2), Math.round(rb.y));
    await expect(page.getByText("Boundary", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Setback line color$/i }).first()).toBeVisible();
    await page.getByRole("button", { name: /^Reset setback line$/i }).first().click();  // reachable, no-op on a clean parcel
    await page.getByRole("button", { name: /^Setback line color$/i }).first().click();
    const palette = page.getByRole("group", { name: "Palette colors" }).first();
    const swatch = palette.getByRole("button").nth(4);
    const wanted = (await swatch.getAttribute("title")).toLowerCase();
    await swatch.click();
    await expect.poll(async () => ((await site(page)).parcels[0].sbStroke || "").toLowerCase()).toBe(wanted);
    // …and the per-parcel reset puts it back.
    await page.getByRole("button", { name: /^Reset setback line$/i }).first().click();
    await expect.poll(async () => (await site(page)).parcels[0].sbStroke).toBeFalsy();
  });
});

/* ------------------------------------------------------- NEW-2: three named actions + a draft */

test.describe("the Standards footer names its three actions", () => {
  test("no scope toggle; the primary action is Apply, and Save for all projects says why it's off", async ({ page }) => {
    await startBlank(page);
    await drawParcel(page);          // something for Apply to act on, so its filled state is real
    await openStandardsParcels(page);

    // The two-axes-in-one-row confusion is gone.
    await expect(bar(page).getByRole("button", { name: "Project", exact: true })).toHaveCount(0);
    await expect(bar(page).getByRole("button", { name: "All", exact: true })).toHaveCount(0);

    await expect(page.getByTestId("standards-apply")).toContainText("Apply to this plan");
    await expect(page.getByTestId("standards-save-plan")).toContainText("Save for this plan");
    await expect(page.getByTestId("standards-save-all")).toContainText("Save for all projects");

    // Signed out the account store isn't reachable — the control disables and explains itself
    // rather than passing a per-computer value off as an account default.
    await expect(page.getByTestId("standards-save-all")).toBeDisabled();
    await expect(page.getByTestId("standards-save-all")).toHaveAttribute("title", /Sign in/i);

    // Hierarchy: the primary action is the filled one; the Saves are quiet outlined secondaries.
    await lineStyleSelect(page, 0).selectOption("dashed");
    await expect(page.getByTestId("standards-apply")).toBeEnabled();
    const filled = (t) => page.getByTestId(t).evaluate((el) => getComputedStyle(el).backgroundColor);
    await expect.poll(() => filled("standards-apply")).not.toBe("rgba(0, 0, 0, 0)");
    expect(await filled("standards-save-plan")).toBe("rgba(0, 0, 0, 0)");
    expect(await filled("standards-save-all")).toBe("rgba(0, 0, 0, 0)");
  });

  test("an edit is a pending draft: it marks unsaved, Discard restores it, and nothing is stored until a button", async ({ page }) => {
    await startBlank(page);
    await drawParcel(page);          // a blank plan isn't persisted at all until something is on it
    await openStandardsParcels(page);

    const storedDash = () => page.evaluate(() => {
      const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const s = map[Object.keys(map)[0]] || {};
      return (s.settings || {}).parcelStyle?.dash || null;
    });

    await expect(dirtyMark(page)).toHaveCount(0);
    await expect(page.getByTestId("standards-save-plan")).toBeDisabled();

    await lineStyleSelect(page, 0).selectOption("dotted");
    await expect(dirtyMark(page)).toBeVisible();
    await expect(page.getByTestId("standards-save-plan")).toBeEnabled();
    await expect(lineStyleSelect(page, 0)).toHaveValue("dotted");   // the panel shows the pending value
    expect(await storedDash()).toBe(null);                          // …and nothing has been stored

    // Discard puts the pre-edit value back and clears the marker.
    await page.getByTestId("standards-discard").click();
    await expect(dirtyMark(page)).toHaveCount(0);
    await expect(lineStyleSelect(page, 0)).toHaveValue("solid");
    expect(await storedDash()).toBe(null);

    // Save for this plan stores it — with a brief confirmation and NO Undo (nothing drawn changed).
    await lineStyleSelect(page, 0).selectOption("dotted");
    await page.getByTestId("standards-save-plan").click();
    await expect.poll(storedDash).toBe("dotted");
    await expect(dirtyMark(page)).toHaveCount(0);
    await expect(page.getByTestId("standards-apply-toast")).toBeVisible();
    await expect(page.getByTestId("standards-apply-undo")).toHaveCount(0);
  });

  test("Apply to this plan commits the defaults AND restyles what is drawn, in one undoable step", async ({ page }) => {
    await startBlank(page);
    await drawParcel(page);
    await openStandardsParcels(page);

    const stored = () => page.evaluate(() => {
      const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const s = map[Object.keys(map)[0]] || {};
      return { def: (s.settings || {}).parcelStyle?.dash || null, drawn: (s.parcels || [])[0]?.dash || null };
    });

    await lineStyleSelect(page, 0).selectOption("dashed");
    await expect(dirtyMark(page)).toBeVisible();
    const apply = page.getByTestId("standards-apply");
    await expect(apply).toContainText(/Apply to this plan \(\d+\)/);   // a live count of what changes
    await apply.click();

    // BOTH halves happened on one click: the plan default is stored and the parcel was restyled.
    await expect.poll(stored).toEqual({ def: "dashed", drawn: "dashed" });
    await expect(dirtyMark(page)).toHaveCount(0);

    // …and the Undo on its toast takes the whole thing back, defaults included.
    await page.getByTestId("standards-apply-undo").click();
    await expect.poll(stored).toEqual({ def: null, drawn: null });
  });

  test("the draft survives closing the panel — edits are never silently thrown away", async ({ page }) => {
    await startBlank(page);
    await drawParcel(page);          // so the plan is persisted and a reload comes back to it
    await openStandardsParcels(page);
    await lineStyleSelect(page, 0).selectOption("dotted");
    await expect(dirtyMark(page)).toBeVisible();

    await page.getByRole("button", { name: "Standards", exact: true }).click();   // close the panel
    await expect(page.getByTestId("standards-bar")).toHaveCount(0);
    await openStandardsParcels(page);
    await expect(dirtyMark(page)).toBeVisible();
    await expect(lineStyleSelect(page, 0)).toHaveValue("dotted");

    // …and a full reload, too (the draft is kept for the browser session, per plan).
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await openStandardsParcels(page);
    await expect(dirtyMark(page)).toBeVisible();
    await expect(lineStyleSelect(page, 0)).toHaveValue("dotted");
  });
});

/* -------------------------------------------------- NEW-2: it is a FOOTER, not a floating bar */

test.describe("the footer is chrome, not a card floating over the list", () => {
  /* The bar used to be `position: sticky` INSIDE the scrolling settings list, with a negative
   * bottom margin — so it hovered over the content and cut whatever row sat at the bottom of the
   * scrollport in half. It is now a sibling BELOW the scroll container, which is provable at any
   * scroll position: the footer's top edge never rises above the scroll container's bottom edge. */
  const geometry = async (page) => {
    const scroller = page.locator('[data-wheelscroll="1"]').filter({ visible: true }).first();
    const panel = page.getByTestId("left-menu-panel");
    return {
      scroll: await scroller.boundingBox(),
      foot: await bar(page).boundingBox(),
      panel: await panel.boundingBox(),
    };
  };

  const assertNoOcclusion = ({ scroll, foot, panel }) => {
    expect(foot.y).toBeGreaterThanOrEqual(scroll.y + scroll.height - 1);   // below the list, never over it
    expect(foot.width).toBeGreaterThanOrEqual(panel.width - 1);            // full panel width
    expect(foot.x).toBeLessThanOrEqual(panel.x + 1);
  };

  for (const theme of ["light", "dark"]) {
    for (const [name, width, height] of [["desktop", 1280, 800], ["narrow", 700, 720]]) {
      test(`${name} · ${theme}: no settings row is hidden under it, scrolled to the middle or the bottom`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem("planyr.theme", t), theme);
        await page.setViewportSize({ width, height });
        await startBlank(page);
        await openStandardsParcels(page);

        const scroller = page.locator('[data-wheelscroll="1"]').filter({ visible: true }).first();
        const max = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);

        await scroller.evaluate((el, y) => { el.scrollTop = y; }, Math.floor(max / 2));
        await page.waitForTimeout(120);
        assertNoOcclusion(await geometry(page));
        await page.screenshot({ path: `${SHOTS}/${name}-${theme}-middle.png` });

        await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(120);
        const g = await geometry(page);
        assertNoOcclusion(g);
        await page.screenshot({ path: `${SHOTS}/${name}-${theme}-bottom.png` });

        // At the very bottom the LAST settings row is fully above the footer — nothing is stranded.
        const lastRow = page.getByText(/Per-edge setbacks live on the parcel/).first();
        if (await lastRow.count()) {
          const rb = await lastRow.boundingBox();
          if (rb) expect(rb.y + rb.height).toBeLessThanOrEqual(g.foot.y + 1);
        }

        // Nothing overflows the panel horizontally, at either width.
        const actions = await bar(page).getByRole("button").all();
        for (const a of actions) {
          const ab = await a.boundingBox();
          if (ab) expect(ab.x + ab.width).toBeLessThanOrEqual(g.panel.x + g.panel.width + 1);
        }
      });
    }
  }
});
