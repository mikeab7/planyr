/* NEW-1 / NEW-2 — A MARKUP OVER A BUILDING. THE CASE FOUR SESSIONS NEVER DROVE.
 *
 * ⛔ READ THIS BEFORE CHANGING THE FIXTURE. Every earlier pass at "send to back / layers never work"
 * (B421, B820, B671, B293072/B293073) tested MARKUP AGAINST MARKUP, which already worked before all
 * of them — and every one of those fixes was correct and missed the report. The variable is not the
 * command and not the markup: it is WHAT IS UNDERNEATH. Two markups in open land share a band, so
 * "back" moves within it and the picture changes. A markup over a BUILDING is a question about the
 * OTHER band, and the old command could not reach it — so it sent the markup to the back of a band
 * that is entirely above the elements, changed nothing on screen, and greyed itself as though it had
 * worked. A fixture whose markups do not overlap an element cannot see any of this and will report
 * PASS on a dead implementation.
 *
 * So: the markup here is seeded to COMPLETELY COVER a real building on the owner's own Goose Creek
 * geometry, and it is FILLED — an unfilled markup grabs by its stroke only (B920) and would never
 * have produced the report.
 *
 * Run: npx playwright test e2e/markup-behind-building.spec.js
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/goose-creek-plan1copy.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-markup-over-building";
const BLDG = "e1454729ykduhm";           // a real 870 × 480 building on the owner's plan
const MK = "mkOverBuilding";

function seedMarkup() {
  const b = FIXTURE.els.find((e) => e.id === BLDG);
  // Bigger than the building on both axes and on the same centre + rotation, so there is no
  // uncovered sliver anywhere over it — which is precisely the state that made the send-behind
  // door one-way in the owner's report.
  return {
    id: MK, kind: "rect", cx: b.cx, cy: b.cy, w: b.w + 160, h: b.h + 160, rot: b.rot,
    stroke: "#e11d48", weight: 2, fill: "#e11d48", fillOpacity: 0.35, z: 1000,
  };
}

async function loadPlan(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Goose Creek", name: "ZZ markup over building",
    origin: null, county: "harris",
    parcels: FIXTURE.parcels, els: FIXTURE.els, measures: [], callouts: [], markups: [seedMarkup()],
    settings: FIXTURE.settings || {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  /* ⛔ SEED ONCE, NOT ON EVERY NAVIGATION. An init script runs on each document, so an unconditional
     write re-seeds the ORIGINAL record on `page.reload()` — which would silently undo the edit the
     reload case is measuring and report a persistence failure against a working feature. */
  await page.addInitScript(([id, rec]) => {
    if (localStorage.getItem("planarfit:currentSite:v1") === id) return;
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  /* el-tier: the readiness gate here really is about the ELEMENT tier — the markup is asserted on
     its own line below, and what this waits for is the building band being on the canvas at all. */
  await expect.poll(async () => page.locator("[data-el-id]").count(), { timeout: 20_000 }).toBeGreaterThan(10);
  await expect(page.locator(`[data-feature="markup:${MK}"]`)).toHaveCount(1);
  await page.waitForTimeout(1200);   // let the fit / label / declutter passes settle
}

/* The centre of the covered building, in client coordinates. Every press in this spec is aimed
 * here: it is inside the building AND inside the markup, which is the only interesting point. */
async function overlapPoint(page) {
  return page.evaluate((id) => {
    const g = document.querySelector(`[data-el-id="${id}"]`);
    const r = g.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, BLDG);
}

/* ⛔ PAINT ORDER IS DOCUMENT ORDER IN SVG, so this is the honest reading of "which one is on top",
 * and it is read off the RENDERED DOM rather than off the model. `true` = the markup paints AFTER
 * the building, i.e. it covers it — which is the state the owner is trying to get out of. */
async function markupCoversBuilding(page) {
  return page.evaluate(([mk, el]) => {
    const m = document.querySelector(`[data-feature="markup:${mk}"]`);
    const b = document.querySelector(`[data-el-id="${el}"]`);
    if (!m || !b) return null;
    // DOCUMENT_POSITION_FOLLOWING (4) on b → b comes after m → the BUILDING is on top.
    return !(m.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, [MK, BLDG]);
}

/* What the browser itself says is on top at the point — the same hit-test that picks a press. */
async function topFeatureAt(page, pt) {
  return page.evaluate(({ x, y }) => {
    for (const n of document.elementsFromPoint(x, y)) {
      if (n.closest("[data-handle-layer], [data-chrome]")) continue;
      const f = n.closest("[data-feature]");
      if (f) return f.getAttribute("data-feature");
    }
    return null;
  }, pt);
}

const menuRow = (page, name) => page.getByRole("button", { name, exact: false });

test.describe("Send to Back on a markup over a building", () => {
  test("the command is OFFERED, and it moves the markup under the building", async ({ page }) => {
    await loadPlan(page);
    const pt = await overlapPoint(page);

    // Precondition — the vacuity guard. If the markup is not actually covering the building, this
    // spec is testing nothing, and every assertion below would pass on a dead implementation.
    expect(await markupCoversBuilding(page)).toBe(true);
    expect(await topFeatureAt(page, pt)).toBe(`markup:${MK}`);

    await page.mouse.move(pt.x, pt.y);
    await page.mouse.click(pt.x, pt.y, { button: "right" });
    const back = menuRow(page, /^Send to Back/);
    await expect(back).toBeVisible();
    // ⛔ PRE-FIX THIS ROW WAS DISABLED (the markup was alone in its band, so the old flags read
    // "already at the back"). A disabled row here is the claim of completion this item exists to kill.
    await expect(back).toBeEnabled();

    await back.click();
    await expect.poll(() => markupCoversBuilding(page)).toBe(false);
    expect(await topFeatureAt(page, pt)).toBe(`el:${BLDG}`);
  });

  test("...and only THEN does the row grey out, because it is genuinely at the back", async ({ page }) => {
    await loadPlan(page);
    const pt = await overlapPoint(page);
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.click(pt.x, pt.y, { button: "right" });
    await menuRow(page, /^Send to Back/).click();
    await expect.poll(() => markupCoversBuilding(page)).toBe(false);

    // The markup is still SELECTED, so this right-click reaches it (NEW-2's priority rule).
    await page.mouse.move(pt.x + 3, pt.y + 3);
    await page.mouse.click(pt.x + 3, pt.y + 3, { button: "right" });
    const back = menuRow(page, /^Send to Back/);
    await expect(back).toBeVisible();
    await expect(back).toBeDisabled();
    // And the reason is stated in the terms the user is thinking in — the whole plan, not a band.
    await expect(back).toHaveAttribute("title", /behind everything on the plan/i);
  });

  test("the move survives a reload (it is a real edit, not a paint trick)", async ({ page }) => {
    await loadPlan(page);
    const pt = await overlapPoint(page);
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.click(pt.x, pt.y, { button: "right" });
    await menuRow(page, /^Send to Back/).click();
    await expect.poll(() => markupCoversBuilding(page)).toBe(false);

    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect(page.locator(`[data-feature="markup:${MK}"]`)).toHaveCount(1);
    await page.waitForTimeout(1200);
    expect(await markupCoversBuilding(page)).toBe(false);
  });

  /* PDF-PARITY is asserted where it can be MEASURED rather than skipped: the export module is
     lazily loaded, so `window.__plannerExportSvg` is not reliably armed in this spec's preview
     build, and a permanently-skipping parity test is a guard that has quietly rotted green. It is
     proved on the REAL BUILT SHEET by ui-audit/verify-markup-over-building.mjs instead. */
});

test.describe("NEW-2 — the way back does not depend on finding uncovered geometry", () => {
  /* ⛔ B845584/B845585 — THE MECHANISM CHANGED, THE GUARANTEE DID NOT. The covering element's menu
   * used to grow a "Behind this" group naming what was underneath, with one row to select it and one
   * to lift it back in front. That group is CUT (per the owner's own instruction — the context-menu
   * rebuild's brief says so explicitly) because Alt+hover now answers "what is under my cursor" for
   * ANY buried feature, not just a behind-band annotation reached through the ONE element covering
   * it — so it is the more general fix, not a smaller one. Once picked, the SAME priority rule these
   * tests already proved (first describe block, and the two "while selected" cases below) still
   * makes the object reachable by an ordinary right-click, which is where the actual reversal lives
   * (the object's own cross-band toggle) — nothing about THAT half moved. */
  async function sendBehind(page, pt) {
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.click(pt.x, pt.y, { button: "right" });
    await menuRow(page, /^Send to Back/).click();
    await expect.poll(() => markupCoversBuilding(page)).toBe(false);
  }

  const altStackLabels = (page) => page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="alt-stack-pick-row-"]')].map((n) => n.textContent.trim()));

  test("while it is selected, a right-click over the overlap still reaches the MARKUP", async ({ page }) => {
    await loadPlan(page);
    const pt = await overlapPoint(page);
    await sendBehind(page, pt);

    await page.mouse.move(pt.x + 4, pt.y + 4);
    await page.mouse.click(pt.x + 4, pt.y + 4, { button: "right" });
    // Pre-fix this opened the BUILDING's menu, which mentions the markup nowhere.
    await expect(menuRow(page, /Bring in front of the plan/)).toBeVisible();
  });

  test("once DESELECTED, Alt+hover names what is underneath and picking it reaches the way back", async ({ page }) => {
    await loadPlan(page);
    const pt = await overlapPoint(page);
    await sendBehind(page, pt);

    // Deselect by pressing empty canvas well away from the plan, then confirm the markup really is
    // unreachable by an ordinary press — the state the owner was stuck in.
    await page.keyboard.press("Escape");
    await page.mouse.move(pt.x, pt.y);
    expect(await topFeatureAt(page, pt)).toBe(`el:${BLDG}`);

    // Alt+hover surfaces BOTH — the building (topmost) then the markup underneath it.
    await page.keyboard.down("Alt");
    await page.mouse.move(pt.x, pt.y);
    await expect(page.getByTestId("alt-stack-pick")).toBeVisible();
    const labels = await altStackLabels(page);
    expect(labels.some((l) => /markup/i.test(l))).toBe(true);
    const markupRow = page.locator('[data-testid^="alt-stack-pick-row-"]', { hasText: /Markup/i }).first();
    await markupRow.click();
    await page.keyboard.up("Alt");

    // Picking it SELECTS it (does not move it) — still behind the plan.
    expect(await markupCoversBuilding(page)).toBe(false);
    // …and now that it is selected, the priority rule reaches its own menu over the overlap, where
    // the actual reversal lives.
    await page.mouse.move(pt.x + 5, pt.y + 5);
    await page.mouse.click(pt.x + 5, pt.y + 5, { button: "right" });
    const bringFront = menuRow(page, /Bring in front of the plan/);
    await expect(bringFront).toBeVisible();
    await bringFront.click();

    await expect.poll(() => markupCoversBuilding(page)).toBe(true);
    expect(await topFeatureAt(page, pt)).toBe(`markup:${MK}`);
  });

  test("an Alt+hover pick never moves the feature it selects", async ({ page }) => {
    await loadPlan(page);
    const pt = await overlapPoint(page);
    await sendBehind(page, pt);
    await page.keyboard.press("Escape");

    const before = await page.evaluate((id) => {
      const m = document.querySelector(`[data-feature="markup:${id}"]`);
      const r = m.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, MK);

    await page.keyboard.down("Alt");
    await page.mouse.move(pt.x, pt.y);
    await page.locator('[data-testid^="alt-stack-pick-row-"]', { hasText: /Markup/i }).first().click();
    await page.keyboard.up("Alt");

    const after = await page.evaluate((id) => {
      const m = document.querySelector(`[data-feature="markup:${id}"]`);
      const r = m.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, MK);
    expect(after).toEqual(before);
    expect(await markupCoversBuilding(page)).toBe(false); // unmoved: still behind the plan
  });

  test("an element with NOTHING behind it shows only itself, and empty canvas shows nothing", async ({ page }) => {
    await loadPlan(page);
    // A different building, nowhere near the seeded markup.
    const other = FIXTURE.els.find((e) => e.type === "building" && e.id !== BLDG && e.w > 200);
    const pt = await page.evaluate((id) => {
      const g = document.querySelector(`[data-el-id="${id}"]`);
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }, other.id);
    test.skip(!pt, "control building not rendered at this zoom");

    await page.keyboard.down("Alt");
    await page.mouse.move(pt.x, pt.y);
    await expect(page.getByTestId("alt-stack-pick")).toBeVisible();
    expect(await altStackLabels(page)).toHaveLength(1); // just the building — nothing buried under it

    // Empty canvas, well away from every drawn feature — no box at all, not an empty one.
    await page.mouse.move(30, 30);
    await expect(page.getByTestId("alt-stack-pick")).toHaveCount(0);
    await page.keyboard.up("Alt");
  });
});
