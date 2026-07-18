/* Click behavior — single-click SELECTS, double-click opens PROPERTIES (B750).
 *
 * The owner's rule: "clicking any element must not auto-open its properties menu. Single left-click
 * selects; double-click opens Properties." Before B750 the Site Planner's Properties companion was
 * DERIVED from the selection, so a plain click popped it open. This spec is the live guard for the
 * decoupled behavior — it runs LOGGED OUT against a seeded-blank site (no account), driving the real
 * SVG canvas:
 *   • a freshly DRAWN element is selected but the companion stays CLOSED (Site Planner: no auto-open);
 *   • a plain single-click selects WITHOUT opening the companion;
 *   • a double-click OPENS the companion (with its "Delete element" control);
 *   • the ✕ closes it again.
 * A building (a filled rectangle) is the hit target — its interior is reliably clickable, unlike the
 * fill:"none" markup shapes. The property panel carries data-testid="property-panel". */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const panel = (p) => p.getByTestId("property-panel");
// The floating quick-edit overlay (an <input> in an SVG foreignObject) and the Properties panel's
// OWN "Inline label" field share the identical placeholder text — so a plain getByPlaceholder match
// can't tell them apart. Scope to the one that is NOT inside the property panel.
const inlineLabelOverlay = (p) => p.locator('xpath=//input[contains(@placeholder,"SANITARY SEWER") and not(ancestor::*[@data-testid="property-panel"])]');

function buildingCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).filter((e) => e.type === "building").length;
  });
}

function roadCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).filter((e) => e.type === "road" && Array.isArray(e.pts) && e.pts.length >= 2).length;
  });
}

function lineMarkupCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.markups || []).filter((m) => m.kind === "line").length;
  });
}

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

// Drag a building rectangle; returns its approximate CENTER in client px (a reliable interior hit).
async function drawBuilding(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const x1 = box.x + 300, y1 = box.y + 250, x2 = box.x + 540, y2 = box.y + 410;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 70, y1 + 50, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => buildingCount(page)).toBeGreaterThanOrEqual(1);
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

// Draw a CENTERLINE (preset-width) road: pick a width preset (roadWidth defaults to "free", which
// is the old drag-a-rectangle road, NOT a centerline road), click two points, Enter to finish. Returns
// a reliable hit point on the paved strip — OFFSET from the exact midpoint, which the width-dimension
// label ("24′", its own separately-clickable text) sits directly on top of.
async function drawCenterlineRoad(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /travel — click points/i }).first().click();
  const x1 = box.x + 260, y1 = box.y + 300, x2 = box.x + 560, y2 = y1;
  await page.mouse.click(x1, y1);
  await page.mouse.click(x2, y2);
  await page.keyboard.press("Enter");
  await expect.poll(() => roadCount(page)).toBeGreaterThanOrEqual(1);
  return { cx: x1 + 40, cy: y1 };
}

// Draw a Line markup (drag end-to-end); returns its midpoint.
async function drawLineMarkup(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: /^Line\s/ }).click();
  const x1 = box.x + 260, y1 = box.y + 420, x2 = box.x + 560, y2 = box.y + 420;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => lineMarkupCount(page)).toBeGreaterThanOrEqual(1);
  return { cx: Math.round((x1 + x2) / 2), cy: y1 };
}

// Place a callout (tip click + box click auto-opens the text editor to type into); commit non-blank
// text with Escape (Escape commits the callout's own editor, a second Escape then globally deselects).
async function drawCallout(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: /^Callout\s/ }).click();
  const tipX = box.x + 300, tipY = box.y + 500, boxX = box.x + 420, boxY = box.y + 460;
  await page.mouse.click(tipX, tipY);
  await page.mouse.click(boxX, boxY);
  await page.getByPlaceholder("Type…").waitFor({ state: "visible" });
  await page.keyboard.type("Test note");
  await page.keyboard.press("Escape"); // commits the callout's own text editor
  await page.keyboard.press("Escape"); // global deselect
  return { cx: boxX, cy: boxY };
}

test.describe("click behavior — single-click selects, double-click opens Properties (logged out)", () => {
  test("Site Planner: click selects only; double-click opens Properties; ✕ closes it", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawBuilding(page);

    // Freshly drawn → the companion stays CLOSED (B750: no auto-open on draw in the Site Planner).
    await expect(panel(page)).toHaveCount(0);

    // Double-click → Properties opens (with its "Delete element" control). The app reconstructs the
    // double-tap on pointerdown (pointer capture eats the DOM dblclick), so we issue two real down/up
    // pairs at the same point — capture releases on the first up before the second down, which a fast
    // clickCount:2 doesn't guarantee. Done FIRST (tap history is clean straight after the draw) so the
    // detection is deterministic.
    await page.keyboard.press("Escape"); // deselect + Select tool
    await page.mouse.move(cx, cy);
    await page.mouse.down(); await page.mouse.up();
    await page.mouse.down(); await page.mouse.up();
    await expect(panel(page)).toBeVisible();
    await expect(page.getByRole("button", { name: /Delete element/i })).toBeVisible();

    // ✕ closes it (the element stays selected — but the panel is gone). Target by aria-label: the panel's
    // collapsible header is itself a role=button and rolls the ✕'s label into its own accessible name.
    await page.locator('button[aria-label="Close properties"]').click();
    await expect(panel(page)).toHaveCount(0);

    // And a plain single-click SELECTS the building WITHOUT re-popping the companion (the old annoyance).
    await page.keyboard.press("Escape");
    await page.mouse.click(cx, cy);
    await expect(panel(page)).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  /* NEW-1 — regression guard: a centerline road, a Line markup, and a callout each carried a raw
   * native `onDoubleClick` (a pre-B750 B620 leftover) that unconditionally forced the inline text/label
   * editor open, bypassing the "single-click selects; double-click opens Properties; an ALREADY-selected
   * text-bearing feature's double-click edits its text" gate that B750 wired everywhere else. That raw
   * handler is a fallback for whenever the browser's native dblclick fires (pointer capture doesn't
   * always suppress it) — so a fresh double-click on any of these three could open the inline editor
   * straight away instead of Properties. Fixed by gating the fallback identically to the reconstructed
   * pointerdown path (onElDouble / the new onMarkupDouble / the callout box handler all now read
   * dblWasSelRef). This spec drives all three: fresh double-click → Properties; select, then
   * double-click again → inline editor. */
  test("Site Planner: double-click a centerline road opens Properties; already-selected double-click edits its inline label", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawCenterlineRoad(page);

    await expect(panel(page)).toHaveCount(0); // freshly drawn → no auto-open

    // Fresh double-click (not already selected) → Properties, NOT the inline label editor.
    await page.keyboard.press("Escape");
    await page.mouse.move(cx, cy);
    await page.mouse.down(); await page.mouse.up();
    await page.mouse.down(); await page.mouse.up();
    await expect(panel(page)).toBeVisible();
    await expect(inlineLabelOverlay(page)).toHaveCount(0);

    await page.locator('button[aria-label="Close properties"]').click();
    await expect(panel(page)).toHaveCount(0);

    // Already-selected (single click, then a SEPARATE double-click) → edits the inline label in place.
    // The wait clears the single click's own tap record (DBLTAP_MS=350ms) so the upcoming double-click's
    // two presses pair with EACH OTHER, not with this re-select click (which would itself count as the
    // double-tap's first press and leave only one further press — a single, not a double, click).
    await page.mouse.click(cx, cy);
    await expect(panel(page)).toHaveCount(0);
    await page.waitForTimeout(450);
    await page.mouse.move(cx, cy);
    await page.mouse.down(); await page.mouse.up();
    await page.mouse.down(); await page.mouse.up();
    await expect(panel(page)).toHaveCount(0);
    await expect(inlineLabelOverlay(page)).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Site Planner: double-click a Line markup opens Properties; already-selected double-click edits its inline label", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawLineMarkup(page);

    await expect(panel(page)).toHaveCount(0);

    await page.keyboard.press("Escape");
    await page.mouse.move(cx, cy);
    await page.mouse.down(); await page.mouse.up();
    await page.mouse.down(); await page.mouse.up();
    await expect(panel(page)).toBeVisible();
    await expect(inlineLabelOverlay(page)).toHaveCount(0);

    await page.locator('button[aria-label="Close properties"]').click();
    await expect(panel(page)).toHaveCount(0);

    await page.mouse.click(cx, cy);
    await expect(panel(page)).toHaveCount(0);
    await page.waitForTimeout(450); // see the road test above for why this wait matters
    await page.mouse.move(cx, cy);
    await page.mouse.down(); await page.mouse.up();
    await page.mouse.down(); await page.mouse.up();
    await expect(panel(page)).toHaveCount(0);
    await expect(inlineLabelOverlay(page)).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Site Planner: double-click a callout opens Properties; already-selected double-click edits its text", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawCallout(page);

    await expect(panel(page)).toHaveCount(0); // deselected after the two Escapes in drawCallout

    // Fresh double-click (not already selected) → Properties, NOT the text editor reopening.
    await page.mouse.move(cx, cy);
    await page.mouse.down(); await page.mouse.up();
    await page.mouse.down(); await page.mouse.up();
    await expect(panel(page)).toBeVisible();
    await expect(page.getByPlaceholder("Type…")).toHaveCount(0);

    await page.locator('button[aria-label="Close properties"]').click();
    await expect(panel(page)).toHaveCount(0);

    // Already-selected → double-click reopens the text editor in place.
    await page.mouse.click(cx, cy);
    await expect(panel(page)).toHaveCount(0);
    await page.waitForTimeout(450); // see the road test above for why this wait matters
    await page.mouse.move(cx, cy);
    await page.mouse.down(); await page.mouse.up();
    await page.mouse.down(); await page.mouse.up();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByPlaceholder("Type…")).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  /* NEW-1 — regression guard: "click to select, then immediately double-click to edit" done FAST (all
   * three presses landing inside one ~350ms double-tap window, a completely natural way to do this
   * gesture) used to silently swallow the third press. `isDoubleTap`'s matched branch wiped its tap
   * history to an empty record, so press 3 had nothing to pair with and fell through as an unrelated
   * lone click — the callout ended up selected with Properties open (from presses 1+2), never editing.
   * Fixed by re-arming the tap history to press 2 (marked "already selected", since a matched pair
   * always selects) instead of clearing it, so press 3 pairs with press 2 and correctly edits. */
  test("Site Planner: a fast 3-click select-then-double-click on a callout edits its text (not just Properties)", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawCallout(page);

    // ~100ms between presses — a genuinely fast triple-click by human standards (a real mouse can't
    // produce a truly zero-gap press anyway), and enough for the Properties panel's own reflow (opening
    // it narrows the canvas) to settle before the next press, so the press lands on the callout and not
    // on whatever the reflow left behind at that fixed viewport coordinate.
    await page.mouse.move(cx, cy);
    await page.mouse.down(); await page.mouse.up(); // press 1: selects
    await page.waitForTimeout(100);
    await page.mouse.down(); await page.mouse.up(); // press 2: pairs with 1 → Properties
    await page.waitForTimeout(100);
    await page.mouse.down(); await page.mouse.up(); // press 3: pairs with 2 → edit
    await expect(page.getByPlaceholder("Type…")).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
