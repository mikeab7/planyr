/* NEW-1 — THE GUARD FOR THE OWNER'S SYLVESTRI PRINT: an export is a DOCUMENT, not a screenshot.
 *
 * The report (2026-07-31): "fix the fact that my measurements on the Sylvestri site looked like this
 * when I print — they should not look like that big, obviously." Each length measurement printed as
 * TWO large filled discs joined by a short stub, and the number was nowhere on the sheet.
 *
 * Why no source reading could catch it: `exportSheet.buildExportSvg` CLONES the live `<svg>` and
 * strips only what is tagged `data-export="skip"`, so an export is by construction exactly what was
 * on screen at that instant. Zoomed out to see a whole multi-parcel site — the normal thing to do
 * before printing — the value labels were below their zoom gate and simply were not in the DOM to
 * clone, while the endpoint discs had no gate at all and were sized in constant screen px. The
 * defect exists only in the built sheet, so this spec builds the REAL sheet (`window.__plannerExportSvg`,
 * gated behind `window.__PLANYR_E2E`, never present in production) and inspects what came out.
 *
 * Runs LOGGED OUT on a seeded-blank site, no GIS and no network: draw a building (so the sheet has a
 * plan to frame), then a Length, a Polylength and a Count measurement over it; zoom BELOW the label
 * gate; export; then assert the three halves of the fix —
 *   • every measurement in the output carries its value text (labels ignore the zoom gate on a sheet);
 *   • zero endpoint discs survive for the length and polylength cases, replaced by drafting ticks; and
 *   • a COUNT's numbered markers ARE present, because those are content, not an editing affordance.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

function measureCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.measures || []).length;
  });
}

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

async function armMeasure(page, mode) {
  await page.getByRole("button", { name: "Measure modes" }).click();
  await page.getByRole("button", { name: mode, exact: true }).click();
}

// One 1.12× wheel step per event (the handler ignores magnitude) — the shared zoom helper.
async function wheelZoom(page, steps, dir /* -1 in, +1 out */) {
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dir * 120); await page.waitForTimeout(16); }
}

async function drawBuilding(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const x1 = box.x + 260, y1 = box.y + 200, x2 = box.x + 620, y2 = box.y + 400;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 80, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

/* Build the real export sheet and report everything this spec asserts on, measured on the OUTPUT
 * rather than on the live canvas. Parsed in the page so the assertions read the same DOM the PDF /
 * PNG rasterizer will. */
async function sheetFacts(page) {
  return page.evaluate(async () => {
    const markup = await window.__plannerExportSvg();
    if (!markup) return { markup: null };
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    const root = doc.documentElement;
    const groups = Array.from(root.querySelectorAll("[data-measure]")).map((g) => ({
      id: g.getAttribute("data-measure"),
      mode: g.getAttribute("data-measure-mode"),
      values: Array.from(g.querySelectorAll("[data-chip-text]")).map((t) => (t.textContent || "").trim()).filter(Boolean),
      vertexDiscs: g.querySelectorAll("[data-measure-vertex]").length,
      terminators: g.querySelectorAll("[data-measure-term]").length,
      tallies: Array.from(g.querySelectorAll("[data-measure-tally]")).map((t) => (t.textContent || "").trim()),
    }));
    return {
      markup,
      groups,
      allVertexDiscs: root.querySelectorAll("[data-measure-vertex]").length,
      // The measurement geometry itself must still be there — this fix hides chrome, not drawings.
      hasGeometry: root.querySelectorAll("[data-measure] polyline, [data-measure] polygon").length,
    };
  });
}

test.describe("NEW-1 — a measurement prints as a dimensioned annotation, never anonymous dots", () => {
  test("exported below the label gate: every measurement carries its value, no endpoint discs survive, a count keeps its numbers", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await startBlank(page);
    /* ZOOM WAY OUT BEFORE DRAWING, so the plan is a REAL multi-hundred-acre site rather than a
       toy one. That matters: the sheet's own px-per-foot is a function of the framed extent
       against the paper, so only a genuinely large site puts the sheet BELOW the shared label
       floor — which is the owner's case, and the only condition under which the un-fixed code
       drops the numbers. A small plan exports above the floor and hides the defect entirely. */
    await wheelZoom(page, 18, +1);
    await drawBuilding(page);
    const box = await canvas(page).boundingBox();

    // A LENGTH (two-point distance) across the building's frontage.
    await armMeasure(page, "Length");
    await page.mouse.click(box.x + 290, box.y + 370);
    await page.mouse.click(box.x + 590, box.y + 370);
    await expect.poll(() => measureCount(page)).toBe(1);

    // A POLYLENGTH (multi-segment run), finished with Enter.
    await armMeasure(page, "Polylength");
    await page.mouse.click(box.x + 290, box.y + 330);
    await page.mouse.click(box.x + 440, box.y + 350);
    await page.mouse.click(box.x + 590, box.y + 330);
    await page.keyboard.press("Enter");
    await expect.poll(() => measureCount(page)).toBe(2);

    // A COUNT — its numbered markers are CONTENT and must keep printing.
    await armMeasure(page, "Count");
    await page.mouse.click(box.x + 320, box.y + 240);
    await page.mouse.click(box.x + 420, box.y + 240);
    await page.mouse.click(box.x + 520, box.y + 240);
    await page.keyboard.press("Enter");
    await expect.poll(() => measureCount(page)).toBe(3);
    await page.keyboard.press("Escape");

    /* Past the label gate — the owner's pre-print state: zoomed out to see the whole site. On the
       CANVAS the summary chips correctly declutter away; that is working-canvas behaviour this fix
       deliberately keeps, and it is what used to reach the sheet verbatim. */
    await wheelZoom(page, 6, +1);
    const canvasChips = page.locator('[data-print-chip="measure"] [data-chip-text]');
    await expect.poll(() => canvasChips.count()).toBe(0);

    // …and now the SHEET, built from that very zoom.
    const facts = await sheetFacts(page);
    expect(facts.markup, "the export produced no sheet at all").toBeTruthy();
    /* Fewer than three means the value invariant fired and OMITTED a measurement — which is the
       correct behaviour when a number can't be placed, and also the exact signature of the
       un-fixed code (labels below the sheet's own gate → nothing to print → the whole measurement
       withheld rather than printed as anonymous dots). Either way the sheet is wrong: all three
       drawn measurements must arrive, each with its number. */
    expect(facts.groups.map((g) => g.mode).sort(), "a measurement was withheld from the sheet")
      .toEqual(["count", "line", "polyline"]);

    // (1) THE INVARIANT — a measurement never prints its geometry without its value.
    for (const g of facts.groups) {
      expect(g.values.length, `measurement ${g.id} (${g.mode}) printed with no value text`).toBeGreaterThan(0);
      expect(g.values.join(" ")).toMatch(/\d/); // a real number, not an empty plate
    }
    // The geometry is still on the sheet — this fix removes chrome, it does not thin the drawing.
    expect(facts.hasGeometry).toBeGreaterThan(0);

    // (2) NO ENDPOINT DISCS anywhere on the sheet; the open runs wear drafting ticks instead.
    expect(facts.allVertexDiscs, "editing discs reached the sheet").toBe(0);
    const line = facts.groups.find((g) => g.mode === "line");
    const poly = facts.groups.find((g) => g.mode === "polyline");
    expect(line, "no length measurement on the sheet").toBeTruthy();
    expect(poly, "no polylength measurement on the sheet").toBeTruthy();
    expect(line.vertexDiscs).toBe(0);
    expect(poly.vertexDiscs).toBe(0);
    expect(line.terminators, "a length prints with a tick at each end").toBe(2);
    expect(poly.terminators, "a polylength terminates at its two ends only").toBe(2);

    // (3) A COUNT's numbered markers ARE content and must still print.
    const count = facts.groups.find((g) => g.mode === "count");
    expect(count, "no count measurement on the sheet").toBeTruthy();
    expect(count.tallies).toEqual(["1", "2", "3"]);
    expect(count.terminators, "a count has no run to terminate").toBe(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the same plan exported from a CLOSE zoom says the same thing (the sheet is zoom-independent)", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await startBlank(page);
    await wheelZoom(page, 18, +1);       // the same large site as above
    await drawBuilding(page);
    const box = await canvas(page).boundingBox();
    await armMeasure(page, "Length");
    await page.mouse.click(box.x + 290, box.y + 370);
    await page.mouse.click(box.x + 590, box.y + 370);
    await expect.poll(() => measureCount(page)).toBe(1);
    await page.keyboard.press("Escape");

    const wide = await (async () => { await wheelZoom(page, 6, +1); return sheetFacts(page); })();
    const close = await (async () => { await wheelZoom(page, 26, -1); return sheetFacts(page); })();

    // What the sheet SAYS is a function of the plan and the paper, never of where the canvas
    // happened to be zoomed when Download was pressed.
    expect(wide.groups.map((g) => g.values)).toEqual(close.groups.map((g) => g.values));
    expect(wide.allVertexDiscs).toBe(0);
    expect(close.allVertexDiscs).toBe(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
