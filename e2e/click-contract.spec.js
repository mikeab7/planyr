/* THE CLICK CONTRACT — live drive, one case per element type (NEW-1).
 *
 * Owner, 2026-07-30: "not sure why but single clicks open up the left menu on ponds, fix that, and
 * check other elements, measurements, parcels, buildings, etc." … "I click on the pond, it
 * automatically pops the menu open — the properties menu open. And then if I click-click and drag
 * anywhere on screen, the menu disappears. So weird behavior."
 *
 * The contract itself is declared ONCE in `clickContract.table.js` (shared with the source guard
 * `test/clickContract.test.js`, which fails if a new selectable type ships undeclared). This spec is
 * the LIVE half — it drives the real app, logged out, on a blank site, and asserts per type:
 *
 *   1. PANEL CLOSED + single click        → still closed (the pond bug)
 *   2. PANEL OPEN on another tab + click  → still open, still that same tab (no takeover on select)
 *   3. double click                       → the declared surface opens
 *   4. PANEL OPEN + click-drag on empty canvas → still open (the "menu disappears" half)
 *   5. PANEL OPEN + deselect              → still open, showing "Nothing selected"
 *
 * (4) and (5) are the invariant the owner named: NO pointer interaction with the map may change the
 * panel's open/closed state. Only the rail button / ✕ / Esc may.
 *
 * The observable for "which panel holds the dock" is the left rail's `data-rail-tab` + aria-pressed —
 * one stable fact for open/closed AND which panel, so a takeover reads as a failure too. */
import { test, expect } from "@playwright/test";
import { CLICK_CONTRACT, E2E_DRIVEN } from "./clickContract.table.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const panel = (p) => p.getByTestId("property-panel");
const railTab = (p, id) => p.locator(`[data-rail-tab="${id}"]`);

/* Which panel the left dock holds right now: the rail tab id, or "none". */
async function dockState(page) {
  return page.evaluate(() => {
    const on = document.querySelector('[data-rail-tab][aria-pressed="true"]');
    return on ? on.getAttribute("data-rail-tab") : "none";
  });
}

async function startBlank(page) {
  await page.goto("/");
  await page.getByTestId("map-start-blank-menu-btn").click();
  await page.getByTestId("map-start-blank-menu-item").click();
  await expect(canvas(page)).toBeVisible();
}

const count = (page, pick) => page.evaluate((k) => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  if (k === "parcel") return (site.parcels || []).length;
  if (k === "measure") return (site.measures || []).length;
  if (k === "markup") return (site.markups || []).length;
  return (site.els || []).filter((e) => e.type === k).length;
}, pick);

/* A real double-click on the canvas. The app reconstructs the double-tap on pointerdown (pointer
 * capture eats the DOM dblclick), so two separate down/up pairs at one point are required —
 * capture releases on the first up before the second down, which a fast clickCount:2 can't promise. */
async function doubleTap(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.down(); await page.mouse.up();
}

/* Clear the pending tap record (DBLTAP_MS = 350 ms) so the NEXT gesture's presses pair with each
 * other rather than with the click that preceded them. */
const settleTaps = (page) => page.waitForTimeout(450);

async function dragRect(page, tool, x1, y1, x2, y2) {
  await page.getByRole("button", { name: tool, exact: true }).click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
}

/* Draw the object for a contract row and return a reliable interior/on-line hit point.
 *
 * ⚠ Geometry lives in the RIGHT ~40-80% of the canvas on purpose. Opening a left panel narrows the
 * canvas and the pan-compensation (VIEWPORT-STABLE / B837) holds the drawing at the SAME client
 * coordinates — so anything drawn near the left edge ends up BEHIND the panel and a later click
 * would silently miss, turning the assertions into no-ops. */
async function draw(page, type) {
  const box = await canvas(page).boundingBox();
  const X = (f) => Math.round(box.x + box.width * f), Y = (f) => Math.round(box.y + box.height * f);
  const L = X(0.42), R = X(0.80), T = Y(0.30), B = Y(0.62);
  // MID = the shape's centre (a filled interior is safe to click there). EDGE sits ~30% along the top
  // edge — deliberately NOT the edge MIDPOINT, which a selected shape covers with a resize / vertex
  // handle, so the second press of a double-click would grab the handle instead of the shape.
  const MID = X(0.61), NEAR = X(0.50), EDGE = X(0.53);

  if (type === "pond" || type === "building" || type === "paving") {
    const tool = { pond: "Detention Pond", building: "Building", paving: "Paving" }[type];
    await dragRect(page, tool, L, T, R, B);
    await expect.poll(() => count(page, type)).toBeGreaterThanOrEqual(1);
    return { cx: MID, cy: Y(0.46) };
  }

  if (type === "trailer") {
    // B900416 — Car Parking and Trailer Parking merged into one "Parking" row; Trailer is now a
    // sub-option under its caret (car remains the row body's default arm).
    await page.getByRole("button", { name: "Parking type" }).click();
    await page.getByRole("button", { name: "Trailer parking", exact: true }).click();
    await page.mouse.move(L, T);
    await page.mouse.down();
    await page.mouse.move(L + 60, T + 40, { steps: 5 });
    await page.mouse.move(R, B, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => count(page, type)).toBeGreaterThanOrEqual(1);
    return { cx: MID, cy: Y(0.46) };
  }

  if (type === "road") {
    await page.getByRole("button", { name: "Road", exact: true }).click();
    await page.getByRole("button", { name: "Road presets" }).click();
    await page.getByRole("button", { name: /^\d+′$/ }).first().click();
    await page.mouse.click(L, T);
    await page.mouse.click(R, T);
    await page.keyboard.press("Enter");
    await expect.poll(() => count(page, "road")).toBeGreaterThanOrEqual(1);
    return { cx: NEAR, cy: T };
  }

  if (type === "easement") {
    await page.getByRole("button", { name: "Easement", exact: true }).click();
    await page.mouse.click(L, T);
    await page.mouse.click(R, T);
    await page.keyboard.press("Enter");
    await expect.poll(() => count(page, "markup")).toBeGreaterThanOrEqual(1);
    return { cx: NEAR, cy: T };
  }

  if (type === "mrect") {
    await page.getByRole("button", { name: /^Rectangle\s/ }).click();
    await page.mouse.move(L, T);
    await page.mouse.down();
    await page.mouse.move(R, B, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => count(page, "markup")).toBeGreaterThanOrEqual(1);
    return { cx: EDGE, cy: T };   // ON the top edge — a markup rect is fill:"none"
  }

  if (type === "measure") {
    await page.getByRole("button", { name: /^Measure\s*$/ }).click();
    await page.mouse.click(L, T);
    await page.mouse.click(R, T);
    await expect.poll(() => count(page, "measure")).toBeGreaterThanOrEqual(1);
    await page.keyboard.press("Escape");
    return { cx: NEAR, cy: T };
  }

  if (type === "parcel") {
    // The Parcel tool's own arming flow (mirrors e2e/parcel-select-toggle.spec.js).
    await page.locator('[data-rail-tab="parcel"]').first().click();
    await page.getByTitle(/Add land to this plan/i).click();
    await page.getByRole("button", { name: /Draw a new boundary/i }).click();
    await expect(page.getByText(/drop boundary points/i)).toBeVisible();
    for (const [x, y] of [[L, T], [R, T], [R, B], [L, B]]) { await page.mouse.click(x, y); await page.waitForTimeout(90); }
    await page.mouse.click(L, T);   // close the ring
    await expect.poll(() => count(page, "parcel")).toBeGreaterThanOrEqual(1);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Select V$/ }).click();
    // The tool docks its own panel; the contract cases start from a CLOSED dock, so put it back.
    const docked = await dockState(page);
    if (docked !== "none") await railTab(page, docked).click();
    // Drawing a parcel re-fits the view, so the drawn coordinates no longer locate it — read the
    // RENDERED outline instead. A parcel is grabbed by its BOUNDARY edge, never its interior (B420);
    // 3/4 along the top edge keeps clear of the mid-edge "+" vertex handle AND of the left panel.
    const bb = await page.getByTestId("parcel-outline").first().boundingBox();
    return { cx: Math.round(bb.x + bb.width * 0.75), cy: Math.round(bb.y) };
  }

  throw new Error(`click-contract: no draw recipe for "${type}"`);
}

/* The declared surface for a double-click, as a rail-tab id. */
const surfaceTab = (opens) => (opens === "parcel-panel" ? "parcel" : "properties");

test.describe("click contract — single click never changes the left panel's open/closed state", () => {
  for (const type of E2E_DRIVEN) {
    const c = CLICK_CONTRACT.find((x) => x.type === type);

    test(`${c.label}: single click selects only; double click opens ${c.opens}; a drag never closes it`, async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await startBlank(page);
      const { cx, cy } = await draw(page, type);
      await page.keyboard.press("Escape");        // deselect + back to Select
      await settleTaps(page);

      // ── 1. panel CLOSED + a single click → still closed. (The owner's pond report.)
      expect(await dockState(page)).toBe("none");
      await page.mouse.click(cx, cy);
      expect(await dockState(page), `${c.label}: a single click OPENED the left panel`).toBe("none");
      await expect(panel(page)).toHaveCount(0);

      // ── 2. panel OPEN on ANOTHER tab + a single click → still that same tab (no takeover on select).
      await railTab(page, "yield").click();
      expect(await dockState(page)).toBe("yield");
      await settleTaps(page);
      await page.keyboard.press("Escape");
      await page.mouse.click(cx, cy);
      expect(await dockState(page), `${c.label}: a single click SWITCHED the docked panel`).toBe("yield");

      // ── 3. a DOUBLE click opens the declared surface.
      await settleTaps(page);
      await doubleTap(page, cx, cy);
      await expect.poll(() => dockState(page), { timeout: 5000 }).toBe(surfaceTab(c.opens));

      // ── 4. click-DRAG on empty canvas → the panel the owner opened is STILL open.
      //     ("if I click-click and drag anywhere on screen, the menu disappears" — it no longer does.)
      const box = await canvas(page).boundingBox();
      const emptyX = Math.round(box.x + box.width * 0.5), emptyY = Math.round(box.y + box.height * 0.9);
      await page.mouse.move(emptyX, emptyY);
      await page.mouse.down();
      await page.mouse.move(emptyX - 120, emptyY - 60, { steps: 8 });
      await page.mouse.up();
      expect(await dockState(page), `${c.label}: a drag on empty canvas CLOSED the panel`).toBe(surfaceTab(c.opens));

      // ── 5. a plain deselect leaves the panel open. For the inspector that means the explicit
      //     "Nothing selected" body, never a vanished panel.
      await settleTaps(page);
      await page.mouse.click(emptyX, emptyY);
      expect(await dockState(page), `${c.label}: a deselect CLOSED the panel`).toBe(surfaceTab(c.opens));
      if (c.opens === "inspector") {
        await expect(panel(page)).toBeVisible();
        await expect(page.getByText(/Nothing selected/i)).toBeVisible();
      }

      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  /* NARROW (phone) keeps the B556 model — a tap only selects, the ✎ pill raises the companion — but
   * the SAME invariant now holds there: the companion no longer follows the selection's lifetime, so
   * a deselect leaves it up on the "Nothing selected" state instead of yanking it away. */
  test("narrow: a tap only selects; the ✎ pill opens the companion; a deselect does not close it", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 700, height: 900 });
    await startBlank(page);
    const { cx, cy } = await draw(page, "building");
    await page.keyboard.press("Escape");
    await settleTaps(page);

    // a tap SELECTS and surfaces the ✎ pill — it does not raise the companion (B556, preserved)
    await page.mouse.click(cx, cy);
    const pill = page.getByRole("button", { name: /^✎ Properties$/ });
    await expect(pill).toBeVisible();
    await expect(panel(page)).toHaveCount(0);

    // the pill is the explicit open
    await pill.click();
    await expect(panel(page)).toBeVisible();

    // …and a deselect on empty canvas leaves it OPEN, on the empty state
    const box = await canvas(page).boundingBox();
    await settleTaps(page);
    await page.mouse.click(Math.round(box.x + box.width * 0.5), Math.round(box.y + box.height * 0.92));
    await expect(panel(page)).toBeVisible();
    await expect(page.getByText(/Nothing selected/i)).toBeVisible();

    // the ✕ is what closes it
    await page.locator('button[aria-label="Close properties"]').click();
    await expect(panel(page)).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  /* The explicit affordances still work — the point is that they are the ONLY things that do. */
  test("the ✕ and the rail button are the only ways the inspector opens and closes", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await draw(page, "pond");
    await page.keyboard.press("Escape");
    await settleTaps(page);

    // rail button opens it with NOTHING selected — and it holds that state through canvas clicks
    await railTab(page, "properties").click();
    expect(await dockState(page)).toBe("properties");
    await expect(page.getByText(/Nothing selected/i)).toBeVisible();

    // selecting swaps the CONTENTS (the pond's inspector body), never the open state
    await page.mouse.click(cx, cy);
    expect(await dockState(page)).toBe("properties");
    await expect(page.getByText(/Nothing selected/i)).toHaveCount(0);
    await expect(panel(page)).toBeVisible();

    // ✕ closes it, and a later single click does NOT bring it back
    await page.locator('button[aria-label="Close properties"]').click();
    expect(await dockState(page)).toBe("none");
    await settleTaps(page);
    await page.mouse.click(cx, cy);
    expect(await dockState(page)).toBe("none");

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
