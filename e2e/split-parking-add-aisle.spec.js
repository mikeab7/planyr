/* B1620480 — owner report, verbatim: "adding parking once ive split rows and aisles is broken,
 * its only adding parking but no aisles."
 *
 * ROOT CAUSE, found by reading the wall-edge "+" ladder (growEmployeeSide → addSideParkPieceBeyond,
 * SitePlanner.jsx). Splitting a parking field ("Split rows/aisles") replaces ONE element with a
 * STACK of independent pieces — stall row | drive aisle | stall row — each its own element
 * (lib/parking.js explodeParkingBands). The common case (an even row count, e.g. the default
 * 2-row field) explodes to a stack that ENDS ON A ROW, with nothing beyond it. The "+" ladder's
 * append-beyond-the-outermost-piece function assumed a trailing aisle already existed ("the aisle
 * already exists" — true only for an ODD row count, whose stack ends on a *reserved* aisle) and
 * unconditionally appended one more bare stall row. Glued flush against the existing outermost row
 * with no drive access on either side, exactly the owner's report. The same root cause reached
 * growParking (the per-field canvas "+"/"−" and the Properties panel's "＋ Row"/"－ Row" buttons):
 * resizing ONE piece of a bonded stack in place doesn't move its siblings, so it overlaps them.
 *
 * Both call sites now check whether the outermost piece is already an aisle before deciding what
 * to append, and growParking delegates to the same ladder whenever the selected piece has siblings.
 *
 * Reproduced here by DRIVING the real sequence the owner described — draw a building, build parking
 * against it via the "+" ladder, explode it, click "+" again — and reading the saved plan (on-disk
 * truth per the repo's established readEls pattern, e2e/side-park-explode-sidewalk.spec.js), not
 * screen pixels. Logged out, no external GIS, local storage only: Claude-doable here, per
 * ATTEMPT-BEFORE-YOU-PARK. Verify: sandbox — this is plain UI/geometry, not one of the LIVE-VERIFY
 * classes (no timing/race, no concurrency, no GIS endpoint, not zoom-density-dependent).
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE_KEY = "planarfit:sites:v1";

const readEls = (page) => page.evaluate((key) => {
  const map = JSON.parse(localStorage.getItem(key) || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return site.els || [];
}, SITE_KEY);

/* The "+"/"−" wall-edge controls are an SVG <g data-el-action="1"><title>…</title>…</g> — Playwright's
 * getByTitle does not resolve an SVG <title> CHILD element (confirmed empirically against this build:
 * 0 matches for a title that document.querySelectorAll("title") DOES find), so locate by the raw
 * <title> text and click its owning group's screen centre directly. */
async function clickFeatTitle(page, text, index = 0) {
  const box = await page.evaluate(({ text, index }) => {
    const titles = [...document.querySelectorAll("title")].filter((t) => t.textContent === text);
    const t = titles[index];
    if (!t) return null;
    const g = t.closest("[data-el-action]") || t.parentElement;
    const r = g.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { text, index });
  if (!box) throw new Error(`no <title> matching "${text}" at index ${index}`);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(200); // let the state update (and re-render new titles) settle before the next lookup
}

/* Select an element and open its Properties panel — single click selects, double click opens
 * Properties (B750). Two separate down/up pairs, not a synthetic dblclick: pointer capture eats
 * the DOM dblclick on the first release (same trap e2e/click-contract.spec.js documents). */
async function openProperties(page, elId) {
  const box = await page.locator(`[data-el-id="${elId}"]`).first().boundingBox();
  const x = box.x + 8, y = box.y + 4;
  await page.mouse.move(x, y);
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(200);
}

async function startBlank(page) {
  await page.goto("/");
  await openModule(page, "site-planner");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}

/* A building big enough to clear the on-building "+"/"−" controls' footprint + zoom gates at the
 * default view (feature-edit-zoom.spec.js's B225/NEW-1 gates). Returns its screen centre. */
async function drawBuilding(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const x1 = box.x + 200, y1 = box.y + 160, x2 = box.x + 700, y2 = box.y + 460;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

const pads = (els) => els.filter((e) => e.sideParkSide === "top" && (e.type === "parking" || e.type === "paving"));
const rows = (p) => p.filter((e) => e.type === "parking").length;
const aisles = (p) => p.filter((e) => e.type === "paving").length;

test.describe("B1620480 — adding parking after a split still adds the drive aisle", () => {
  test("split a double-loaded field, then '+': the new row arrives WITH its own aisle", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await startBlank(page);
    const c = await drawBuilding(page);
    await page.mouse.click(c.cx, c.cy);
    // el-tier: the subject here IS a building element, and the only thing being waited on is
    // that the one building drawn above has rendered — not a census (COUNT-EVERY-KIND).
    await expect(page.locator("[data-el-id]").first()).toBeVisible();

    // Build a 2-row (double-loaded) field against the building's "top" wall — the CONTROL CASE:
    // sidewalk → first row → grow to a second row, all via the same "+" ladder the owner uses.
    // This must keep working exactly as it always has (nothing here is part of a split yet).
    await clickFeatTitle(page, "Add a 5′ sidewalk", 0);
    await clickFeatTitle(page, "Add a parking row", 0);
    await clickFeatTitle(page, "Add another parking row", 0);

    let els = await readEls(page);
    const field = els.find((e) => e.type === "parking" && e.sideParkSide === "top");
    expect(field, "the control case: one un-split double-loaded field exists").toBeTruthy();
    expect(field.h).toBeCloseTo(60, 6); // 2 rows: 2*18 + 24

    // Explode it — "Split rows/aisles" in the field's own Properties panel.
    await openProperties(page, field.id);
    const splitBtn = page.getByTestId("split-parking");
    await expect(splitBtn).toBeVisible();
    await splitBtn.click();
    await page.waitForTimeout(200);

    els = await readEls(page);
    let stack = pads(els);
    expect(rows(stack), "split into two independent stall rows").toBe(2);
    expect(aisles(stack), "…sharing the one aisle between them").toBe(1);
    // The stack ends on a ROW (the common, even-row case) — nothing beyond it yet.
    const orderedAfterSplit = stack.slice().sort((a, b) => a.sideParkPiece - b.sideParkPiece);
    expect(orderedAfterSplit.map((e) => e.type)).toEqual(["parking", "paving", "parking"]);

    // THE REPORTED OPERATION: re-select the building and click "+" again on the now-exploded stack.
    await page.mouse.click(c.cx, c.cy);
    await page.waitForTimeout(200);
    await clickFeatTitle(page, "Add another parking row", 0);

    els = await readEls(page);
    stack = pads(els);
    expect(rows(stack), "a new stall row was appended").toBe(3);
    expect(aisles(stack), "…WITH a new drive aisle ahead of it — not left bare (the bug)").toBe(2);
    // And the new pair is ordered aisle-then-row beyond the old outermost row, not row-then-nothing.
    const ordered = stack.slice().sort((a, b) => a.sideParkPiece - b.sideParkPiece);
    expect(ordered.map((e) => e.type)).toEqual(["parking", "paving", "parking", "paving", "parking"]);
    const totalDepth = ordered.reduce((s, e) => s + e.h, 0);
    expect(totalDepth, "no pavement gained or lost by the append").toBeCloseTo(18 + 24 + 18 + 24 + 18, 6);

    // A SECOND successive add on the already-appended-to stack — confirms the fix isn't a one-shot
    // special case tied to the split's own output shape.
    await page.mouse.click(c.cx, c.cy);
    await page.waitForTimeout(200);
    await clickFeatTitle(page, "Add another parking row", 0);
    els = await readEls(page);
    stack = pads(els);
    expect(rows(stack)).toBe(4);
    expect(aisles(stack)).toBe(3);

    // Undo restores exactly the prior (4-row) state in one step — addBuildingEls wraps both new
    // pieces in one pushHistory, so Ctrl+Z is one atomic step, not two. Click the empty canvas
    // first so keyboard focus isn't left on a control from the click above.
    const cbox = await canvas(page).boundingBox();
    await page.mouse.click(cbox.x + 20, cbox.y + 20);
    await page.waitForTimeout(150);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(200);
    els = await readEls(page);
    stack = pads(els);
    expect(rows(stack), "undo removed the whole 2nd add (row) in one step").toBe(3);
    expect(aisles(stack), "…and its aisle with it").toBe(2);

    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("split a single-loaded field (odd, ends on its own reserved aisle): '+' adds only a row", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await startBlank(page);
    const c = await drawBuilding(page);
    await page.mouse.click(c.cx, c.cy);
    // el-tier: the subject here IS a building element, and the only thing being waited on is
    // that the one building drawn above has rendered — not a census (COUNT-EVERY-KIND).
    await expect(page.locator("[data-el-id]").first()).toBeVisible();

    // A single-loaded bay: sidewalk + one row (the row already carries its own outboard aisle —
    // parkDepthForRows(1,…) = sd + ai, per lib/parking.js). Deliberately NOT grown to 2 rows.
    await clickFeatTitle(page, "Add a 5′ sidewalk", 0);
    await clickFeatTitle(page, "Add a parking row", 0);

    let els = await readEls(page);
    const field = els.find((e) => e.type === "parking" && e.sideParkSide === "top");
    expect(field.h).toBeCloseTo(42, 6); // 1 row: 18 + 24

    await openProperties(page, field.id);
    await page.getByTestId("split-parking").click();

    els = await readEls(page);
    let stack = pads(els).slice().sort((a, b) => a.sideParkPiece - b.sideParkPiece);
    expect(stack.map((e) => e.type), "a single-loaded bay explodes to row + its own aisle").toEqual(["parking", "paving"]);

    // "+" here: the outermost piece already IS an aisle, so the correct append is a BARE row (no
    // second aisle stacked on top of the first) — the case addSideParkPieceBeyond's original
    // "the aisle already exists" comment was actually describing, and must stay correct.
    await page.mouse.click(c.cx, c.cy);
    await clickFeatTitle(page, "Add another parking row", 0);

    els = await readEls(page);
    stack = pads(els).slice().sort((a, b) => a.sideParkPiece - b.sideParkPiece);
    expect(stack.map((e) => e.type)).toEqual(["parking", "paving", "parking"]);
    expect(stack.reduce((s, e) => s + e.h, 0)).toBeCloseTo(18 + 24 + 18, 6);

    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
