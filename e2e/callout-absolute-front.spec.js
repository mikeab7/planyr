/* B806080 round 2 — "Bring to front" on a callout must reach the ABSOLUTE top of the plan, driven
 * on the owner's REAL, measured case (per his own correction — no synthetic substitute):
 *
 *   Plan smt7q6ar8egz, callout e1455193brcgly ("WE WOULD BE REQUIRED TO DEDICATE THIS PORTION OF
 *   THE MAJOR THOROUGHFARE"), z=34816 — already the highest z of any callout on the plan — still
 *   painted UNDER area measurement e1454898kaaymz (z=0, a 60%-opaque cream wash) that overlaps it.
 *   The app's own "Bring to Front" told him it was "Already in front of everything on the plan,"
 *   which was false: the toast was built from the callout's position within its own family
 *   (`af.atTop`), never from what actually painted on top of it.
 *
 * Fixture note: the callout and measure geometry below is READ VERBATIM off the real production
 * rows (`site_elements` for site_id smt7q6ar8egz, ids e1455193brcgly / e1454898kaaymz — a read-only
 * SELECT), so this reproduces his exact reported shapes, positions and z-values — but seeded onto a
 * fresh THROWAWAY site id, never written back to production (house rule: production Supabase is
 * READ-ONLY; live checks run on a throwaway plan only).
 *
 * Run: npx playwright test e2e/callout-absolute-front.spec.js
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE_ID = "e2e-callout-absolute-front";
const CO_ID = "e1455193brcgly";
const MEASURE_ID = "e1454898kaaymz";

// Verbatim from the real production row (read-only SELECT, 2026-08-27).
const CALLOUT = {
  id: CO_ID,
  z: 34816,
  box: { x: -1353.4769169028757, y: -3029.725970777355 },
  tip: { x: -1681.9739897607558, y: -2644.7452174635964 },
  text: "WE WOULD BE REQUIRED TO DEDICATE THIS PORTION OF THE MAJOR THOUROUGHFARE",
};
const MEASURE = {
  id: MEASURE_ID,
  z: 0,
  mode: "area",
  stroke: "#f3ece1",
  fillOpacity: 0.6,
  labelOffset: { x: -250.40044392099207, y: -134.56208646016012 },
  pts: [
    { x: -2017.1236975532508, y: -3093.497682276225 }, { x: -2039.5845264086236, y: -2805.73 },
    { x: -1954.6445264086235, y: -2477.93 }, { x: -1732.1145264086235, y: -1613.26 },
    { x: -1678.9645264086234, y: -1368.47 }, { x: -1672.9445264086235, y: -1279.6 },
    { x: -1604.7645264086234, y: -308.69 }, { x: -1539.1645264086235, y: 35.16 },
    { x: -1589.4645264086234, y: 777.45 }, { x: -1515.2445264086234, y: 916.62 },
    { x: -1423.3045264086234, y: 931.8 }, { x: -1369.3245264086236, y: 1025.42 },
    { x: -1435.9645264086234, y: 1158.68 }, { x: -1513.5545264086234, y: 1254.84 },
    { x: -1629.9145264086235, y: 1981.69 }, { x: -1542.3145264086234, y: 2160.85 },
    { x: -1558.2245264086234, y: 2284.87 }, { x: -1701.5545264086234, y: 2442.8 },
    { x: -1763.9345264086235, y: 2813.08 }, { x: -1713.5045264086234, y: 3005.51 },
    { x: -1663.0645264086234, y: 3249.71 }, { x: -2261.6145264086235, y: 3249.71 },
    { x: -2364.6145264086235, y: -3247.11 },
  ],
};

// `fit()` (Zoom to fit) only reads parcels/els/underlay bounds — never measures or callouts — so a
// fixture carrying only those two would frame at the app's blank-plan default and show nothing.
// One rectangular parcel with margin around the real bbox gives the auto-fit something real to
// frame, matching an ordinary plan (a thoroughfare-dedication callout is drawn against a parcel).
const PARCEL = {
  id: "throwawayParcel1", z: 0, stroke: "#0729cf", weight: 2,
  points: [{ x: -2500, y: -3400 }, { x: -1200, y: -3400 }, { x: -1200, y: 3400 }, { x: -2500, y: 3400 }],
};

async function loadPlan(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Concept A (copy) — throwaway", name: "ZZ callout absolute front",
    origin: null, county: "harris",
    parcels: [PARCEL], els: [], markups: [], measures: [MEASURE], callouts: [CALLOUT],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    if (localStorage.getItem("planarfit:currentSite:v1") === id) return;
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  await expect(page.locator(`[data-feature="callout:${CO_ID}"]`)).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator(`[data-measure="${MEASURE_ID}"]`)).toHaveCount(1);
  await page.waitForTimeout(800); // let the fit / label passes settle
}

const calloutOverMeasure = (page) => page.evaluate(([co, mv]) => {
  const c = document.querySelector(`[data-feature="callout:${co}"]`);
  const m = document.querySelector(`[data-measure="${mv}"]`);
  if (!c || !m) return null;
  // DOCUMENT_POSITION_FOLLOWING (4) on m → m comes after c → the MEASURE is on top (the defect).
  return !(c.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING);
}, [CO_ID, MEASURE_ID]);

// The box's own screen position — fetched FRESH before every click, never cached across a
// selection or a panel open/close, either of which can shift the canvas horizontally.
async function boxCenter(page) {
  const r = await page.locator(`[data-testid="callout-box-${CO_ID}"]`).boundingBox();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

test.describe("B806080 round 2 — a callout's absolute front clears a measurement, not just other callouts", () => {
  test("Bring to Front puts the callout over the measurement; the toast only fires once that is true", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await loadPlan(page);

    // Precondition — the vacuity guard. If the measure isn't genuinely painting over the callout
    // to begin with, the rest of this spec proves nothing (WRONG-CASE).
    expect(await calloutOverMeasure(page), "the measurement must start out covering the callout — this is the owner's exact reported state").toBe(false);

    // Select the callout (this may open the Properties companion panel, shifting canvas width —
    // fetch the box centre fresh AFTER selection settles, never before).
    let c = await boxCenter(page);
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(300); // panel-open reflow, if any
    c = await boxCenter(page);
    await page.mouse.click(c.x, c.y, { button: "right" });
    const menu = page.locator('[role="menu"]');
    const bringToFront = menu.getByRole("button", { name: "Bring to Front" });
    await expect(bringToFront).toBeVisible();
    // ⛔ PRE-FIX: this row was `af.atTop` on the callout's OWN family alone — his WETLANDS callout
    // was already the highest z of any callout, so the row was DISABLED here already, with no way
    // to reach the real fix through the menu at all. It must be enabled now.
    await expect(bringToFront, "Bring to Front must be reachable — the callout is not yet at the absolute front").toBeEnabled();

    await bringToFront.click();
    await expect.poll(() => calloutOverMeasure(page), { timeout: 6000 }).toBe(true);

    // Re-open the menu: NOW it is genuinely true, so the row reads disabled with the accurate toast.
    c = await boxCenter(page);
    await page.mouse.click(c.x, c.y, { button: "right" });
    const bringToFront2 = page.locator('[role="menu"]').getByRole("button", { name: "Bring to Front" });
    await expect(bringToFront2).toBeVisible();
    await expect(bringToFront2).toBeDisabled();
    await expect(bringToFront2).toHaveAttribute("title", "Already in front of everything on the plan.");
    await page.keyboard.press("Escape");

    // The keyboard chord (⌘/Ctrl+Shift+]) bypasses the UI-disabled row entirely and calls the same
    // arrangeSel — confirms the flashWarn toast fires, and that it is TRUE when it does.
    c = await boxCenter(page);
    await page.mouse.click(c.x, c.y);
    await page.keyboard.press("Control+Shift+BracketRight");
    await expect(page.getByText("Already in front of everything on the plan.")).toBeVisible({ timeout: 4000 });

    // And the callout is STILL over the measurement — the toast firing didn't move anything.
    expect(await calloutOverMeasure(page)).toBe(true);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("undo restores the pre-force order", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await loadPlan(page);
    expect(await calloutOverMeasure(page)).toBe(false);

    const c = await boxCenter(page);
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(300); // selection settle (companion panel may open)
    await page.keyboard.press("Control+Shift+BracketRight");
    await expect.poll(() => calloutOverMeasure(page), { timeout: 6000 }).toBe(true);

    await page.keyboard.press("Control+z");
    await expect.poll(() => calloutOverMeasure(page), { timeout: 6000 }).toBe(false);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
