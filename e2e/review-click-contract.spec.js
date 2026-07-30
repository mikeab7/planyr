/* B1190 — the click contract in Document Review (the B1188 rule, other workspace).
 *
 * The rule, identical in both workspaces: a single click SELECTS, a double click OPENS the
 * Properties inspector, and NO pointer interaction with the sheet — click, drag, marquee, pan,
 * deselect — may change whether that inspector is open. Only an explicit affordance (the double
 * click, the ✕, Escape) may.
 *
 * Review's inspector is a rail SECTION rather than a docked panel, so before B1190 a deselect
 * collapsed a section instead of reflowing the canvas — milder than the planner's version of the
 * bug, and the same broken invariant. The defect was `propsForId`, a marker that had to keep
 * matching `sel`, plus an effect that cleared it on every selection change.
 *
 * Drives the REAL Review workspace LOGGED OUT with a locally dropped PDF (client-side pdf.js, no
 * auth, no network) — the same approach as doc-review-panel-toggle.spec.js.
 */
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

const PDF = fileURLToPath(new URL("./fixtures/sample.pdf", import.meta.url));

/* `property-panel` is shared with the armed-tool style block, so the contract is asserted against
 * `data-props-mode`, which names the three states apart: a selected markup's properties ("markup"),
 * the armed tool's style ("tool"), and the open-but-empty state ("empty"). "the inspector is open"
 * means mode markup OR empty. */
const propsMode = (p, m) => p.locator(`[data-props-mode="${m}"]`);
const inspectorOpen = (p) => p.locator('[data-props-mode="markup"], [data-props-mode="empty"]');
const nothingSelected = (p) => p.getByTestId("props-nothing-selected");
const closeProps = (p) => p.locator('button[aria-label="Close properties"]');

/* The sheet is usually TALLER than the viewport (its box starts above the top edge), so sheet-
 * relative fractions can land on the chrome. These are points inside the canvas viewport itself:
 * clear of the header rows, the left sheet rail and the right tool rail. */
const DRAW = { x1: 400, y1: 240, x2: 560, y2: 370 };
const EMPTY = { x: 950, y: 560 };

async function openReviewWithPdf(page) {
  await page.goto("/#/markup", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  if (!(await page.locator('input[type="file"]').count())) {
    await page.getByRole("button", { name: /review/i }).first().click().catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.locator('input[type="file"]').first().setInputFiles(PDF);
  const sheet = page.locator('[data-testid="review-sheet"]');
  await sheet.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1000);
  return sheet;
}

/* Draw a rectangle markup on the sheet and return its approximate centre in client px. */
async function drawRect(page) {
  await page.getByRole("button", { name: "Rect", exact: true }).click();
  const { x1, y1, x2, y2 } = DRAW;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 50, y1 + 40, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  // A rect markup is drawn fill:"none", so only its STROKE is hittable — the midpoint of the top
  // edge is on the shape, the centre of the box is not.
  return { cx: Math.round((x1 + x2) / 2), cy: y1 };
}

/* Review handles the REAL DOM dblclick (`onDoubleClick={onDbl}`) rather than reconstructing a
 * double-tap on pointerdown the way the planner has to — so a genuine dblclick is what to send.
 * Two separate down/up pairs each carry clickCount 1 and would never produce one. */
async function doubleTap(page, x, y) {
  await page.mouse.dblclick(x, y);
  await page.waitForTimeout(300);
}

test.describe("B1190 — Review's Properties section is owner-owned", () => {
  test("a deselect, a drag and a marquee never close the Properties the user opened", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await openReviewWithPdf(page);
    const { cx, cy } = await drawRect(page);

    // A freshly drawn markup shows ITS properties — an EXPLICIT open, unchanged from B750.
    await expect(propsMode(page, "markup"), "a freshly drawn markup did not open its Properties").toBeVisible();

    // A plain click on EMPTY sheet deselects. Before B1190 the section vanished with the
    // selection. It must now hold its ground and say what is going on.
    await page.mouse.click(EMPTY.x, EMPTY.y);
    await page.waitForTimeout(400);
    await expect(inspectorOpen(page), "a deselect closed the Properties section").toBeVisible();
    await expect(nothingSelected(page)).toBeVisible();

    // A single click ON the markup selects it — and the OPEN section simply swaps its CONTENTS.
    // That is the other half of the separation: selection drives the body, never the visibility.
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(400);
    await expect(propsMode(page, "markup"), "selecting a markup should fill the open section").toBeVisible();
    await expect(nothingSelected(page)).toHaveCount(0);

    // And back off it again — still open, back to the empty state.
    await page.mouse.click(EMPTY.x, EMPTY.y);
    await page.waitForTimeout(400);
    await expect(nothingSelected(page), "a second deselect closed the Properties section").toBeVisible();

    // Finally a DRAG on empty sheet (the gesture that closed it in the planner). It PANS the
    // sheet, which is why it comes last — the markup is no longer under its old coordinates.
    await page.mouse.move(EMPTY.x, EMPTY.y);
    await page.mouse.down();
    await page.mouse.move(EMPTY.x - 120, EMPTY.y - 90, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await expect(inspectorOpen(page), "a drag on empty sheet closed the Properties section").toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the ✕ and Escape are the explicit closes, and a double-click reopens", async ({ page }) => {
    await openReviewWithPdf(page);
    const { cx, cy } = await drawRect(page);
    await expect(propsMode(page, "markup")).toBeVisible();

    // ✕ closes it. Nothing else is open, so the whole section goes.
    await closeProps(page).click();
    await page.waitForTimeout(300);
    await expect(inspectorOpen(page)).toHaveCount(0);

    // A double-click reopens on the same markup — the close is not a one-way door.
    await doubleTap(page, cx, cy);
    await expect(propsMode(page, "markup"), "a double-click did not reopen Properties").toBeVisible();

    // Escape is the keyboard half of the same explicit close.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await expect(inspectorOpen(page)).toHaveCount(0);

    // …and it still reopens after that, so Escape is not a dead end either.
    await doubleTap(page, cx, cy);
    await expect(propsMode(page, "markup")).toBeVisible();
  });
});
