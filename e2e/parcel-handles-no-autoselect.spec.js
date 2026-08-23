/* ⛔ B-VTX-SEL — VERTEX HANDLES MUST NEVER RENDER WITHOUT A GENUINE, USER-INITIATED SELECTION.
 *
 * Owner report: a screenshot of the Site Planner canvas showed a magenta shape's vertex control
 * points (the small draggable squares/circles on every corner) rendered on the canvas while he
 * had not clicked anything — "I don't even have it selected."
 *
 * AUDIT-FIRST swept every vertex-editable kind (parcel, el-polygon, road, easement, encumbrance,
 * markup polygon, measurement) across fresh-load / hover / select / deselect (click-blank and
 * Escape) / locked / hidden-layer. Every one of those gates correctly on `sel` — EXCEPT one:
 *
 *   SitePlanner.jsx had a mount-time effect —
 *     // Auto-select the single restored parcel so its handles are ready to use.
 *     useEffect(() => {
 *       if (restored?.parcels?.length === 1 && !(restored?.els?.length)) setSel({ kind: "parcel", id: restored.parcels[0].id });
 *     }, []);
 *   — that fires on EVERY mount (i.e. every time such a plan is opened, not only the moment a
 *   parcel is first drawn), so re-opening ANY plan that currently has exactly one parcel and no
 *   elements yet (a very ordinary early-stage state — the owner draws the boundary before adding
 *   buildings) auto-selects that parcel and paints its vertex handles with zero user action.
 *
 * Every real parcel-creation path (hand-draw via closePoly, GIS-record lookup, deed promotion,
 * split, merge) ALREADY calls setSel itself as part of that same user gesture — the effect was
 * therefore pure redundancy for the "just created" case and pure harm on every later reopen.
 * The fix removes the effect outright.
 *
 * This spec reproduces the reported symptom exactly: seed a plan shaped like the owner's ("one
 * parcel, no elements yet" — his boundary is drawn, buildings aren't), reload it fresh, and prove
 * NOTHING is selected and NO handle renders, with no click anywhere.
 *
 * A second case regresses a related finding from the same audit: `parcelHandles` was the only one
 * of the four handle-render functions (parcel/el-polygon/markup/measure) that did not gate on
 * `.locked` — a selected LOCKED parcel still painted full interactive-looking drag squares that
 * silently do nothing when dragged (the false-affordance class this repo already names in
 * B922/NEW-3). Fixed alongside the primary bug since it's the same rendering function.
 *
 * Runs LOGGED OUT against a seeded site — no network, no GIS, no sign-in — so it is
 * Claude-verifiable here (ATTEMPT-BEFORE-YOU-PARK).
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";
import { assertMeasurable, pacedWait } from "../ui-audit/lib/tabTiming.mjs";

const canvas = (p) => p.getByTestId("planner-canvas");
const handleLayer = (p) => p.locator('[data-handle-layer] *');

// The parcel boundary is fill:none with pointer-events:stroke, so a click has to land exactly
// on the line — the true midpoint of its first edge (converted through the real SVG CTM), not a
// point guessed from the polygon's bounding box (which for an irregular ring can sit off-stroke).
async function edgeMidpoint(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const pts = el.getAttribute("points").trim().split(/\s+/).map((s) => s.split(",").map(Number));
    const cx = (pts[0][0] + pts[1][0]) / 2, cy = (pts[0][1] + pts[1][1]) / 2;
    const svg = el.ownerSVGElement;
    const m = el.getScreenCTM();
    const p = svg.createSVGPoint(); p.x = cx; p.y = cy;
    const v = p.matrixTransform(m);
    return { x: v.x, y: v.y };
  }, selector);
}

/* A magenta-stroked, six-sided boundary — deliberately not the default green, echoing the
 * owner's screenshot, and deliberately not a simple rectangle so the vertex count is unambiguous
 * if this ever needs re-diagnosing. */
const PARCEL = {
  id: "p-vtx-sel", active: true, stroke: "#c026d3", fill: "none",
  points: [
    { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4200, y: 2600 },
    { x: 3600, y: 3100 }, { x: 400, y: 2900 }, { x: 0, y: 1200 },
  ],
};

function siteRecord(id, { locked = false } = {}) {
  return {
    id, groupId: id, site: "Vertex Handle Regression", name: "Plan 1", status: "active",
    origin: null, county: "harris",
    parcels: [{ ...PARCEL, locked }], els: [], measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
}

async function boot(page, siteId, opts) {
  await armPlannerHooks(page);
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [siteId, siteRecord(siteId, opts)]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.locator(`[data-feature="parcel:${PARCEL.id}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await pacedWait(page, 800); // let every mount effect (including the one under test) settle
  await assertMeasurable(page, "parcel-handles-no-autoselect");
}

test("reopening a one-parcel, no-elements plan does not auto-select the boundary (no floating handles)", async ({ page }) => {
  await boot(page, "e2e-vtx-sel-fresh");

  // The bug's own symptom, straight off the handle layer — nothing was clicked.
  expect(await handleLayer(page).count(), "vertex handles rendered with zero user interaction").toBe(0);

  // And the parcel outline itself must not carry the SELECTED stroke bump (a second, independent
  // signal of the same fact, so a future refactor of the handle layer can't silently re-break this
  // while leaving the handle-layer count at zero by accident).
  const outlineWidth = await page.locator('[data-testid="parcel-outline"]').first().getAttribute("stroke-width");
  expect(Number(outlineWidth), `parcel-outline stroke-width ${outlineWidth} reads as SELECTED`).toBeLessThan(3);

  // A real, deliberate selection must still work normally, and must still clear on deselect —
  // the fix must not have thrown out the baby with the bathwater. The boundary is fill:none /
  // pointer-events:stroke, so the click has to land exactly ON the line — use the true midpoint
  // of one edge (not the AABB, which for an irregular ring can sit off the actual stroke).
  const edgePt = await edgeMidpoint(page, '[data-testid="parcel-outline"]');
  await page.mouse.click(edgePt.x, edgePt.y);
  await page.waitForTimeout(300);
  expect(await page.locator('[data-handle-layer] [data-testid="vtx-handle"]').count(), "a genuine click did not arm vertex drag handles").toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  expect(await handleLayer(page).count(), "Escape did not clear the handles").toBe(0);
});

test("a LOCKED, selected parcel does not paint draggable vertex handles (parity with el/markup/measure)", async ({ page }) => {
  await boot(page, "e2e-vtx-sel-locked", { locked: true });

  // Confirm nothing is auto-selected here either.
  expect(await handleLayer(page).count(), "vertex handles rendered on load for a locked parcel").toBe(0);

  const edgePt = await edgeMidpoint(page, '[data-testid="parcel-outline"]');
  await page.mouse.click(edgePt.x, edgePt.y);
  await page.waitForTimeout(300);

  // Locked parcels still select — and still show their SETBACK chrome (grab ring, chips, edge
  // dimensions), which is a separate, still-editable attribute — but must not paint the
  // interactive vertex-DRAG squares — a locked el/markup/measurement never does (elPolyHandles /
  // markupHandles / measureHandles all check `.locked`; parcelHandles is the one that didn't).
  // `vtx-handle` is the one stable testid every vertex drag handle in the app carries (vtxRect).
  expect(await page.locator('[data-handle-layer] [data-testid="vtx-handle"]').count(), "a locked parcel still paints draggable vertex handles").toBe(0);
});
