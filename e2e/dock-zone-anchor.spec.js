/* NEW-1 — "when I shrink the trailer parking, it shrinks from both sides", through the REAL render
 * and the REAL drag.
 *
 * Seeded with the OWNER'S ACTUAL elements from "Concept D — Sylvestri Retail" (site sms4zs8unbkg,
 * copied verbatim out of `site_elements`): building e1454698mwpaoj, 867.94 × 300 at rot 0, a 55 ft
 * corner bump-out at each end of its dock wall (clear face 757.94 ft), carrying truck court
 * e1454699mwpaoj and trailer parking e1454796yyuqqs. Nothing in the fixture carries an `alongLen` —
 * this defect needs no poisoned data, it is what a clean plan does the moment a zone is shrunk.
 *
 * What it drives, exactly as the owner does: select the trailer, grab the edge grip at one END of
 * the row, drag it IN, and then drag it back OUT — asserting after each that the OPPOSITE END
 * NEVER MOVED. Every number is read back off the live SVG (each element group carries `data-el-id`)
 * and converted to feet with the planner's own view scale, so it measures what he actually sees.
 *
 * Logged out + no external GIS, so it runs here (VERIFICATION.md rule 4 — attempt before you park).
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/dock-zone-anchor.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/sylvestri-concept-d.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-dock-zone-anchor";

const HOST = "e1454698mwpaoj";        // 867.94 × 300, rot 0, dock on its BOTTOM wall
const COURT = "e1454699mwpaoj";       // 757.94 × 135 — the clear face between the bump-outs
const TRAILER = "e1454796yyuqqs";     // 757.94 × 50 — the row the owner shrinks
const FACE = 757.94;

const canvas = (p) => p.getByTestId("planner-canvas");

async function loadPlan(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Sylvestri", name: "Concept D", origin: null, county: "harris",
    parcels: [], els: FIXTURE.els, measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: 1785500000000,
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  await expect.poll(() => page.locator(`[data-el-id="${TRAILER}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window.__plannerView ? 1 : 0)), { timeout: 20_000 }).toBe(1);
  // Park the viewport on the host at a fixed scale so the grips are on screen and the drag is
  // reproducible, rather than wheel-scroll-and-hope.
  const host = FIXTURE.els.find((e) => e.id === HOST);
  await page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y + 130, 0.55), [host.cx, host.cy]);
  await page.waitForTimeout(150);
}

/* Read an element's two along-wall ends back out of the live SVG, in FEET. The host is at rot 0 and
 * its dock wall is horizontal, so the along axis is world X and the ends are the rect's own edges. */
const readEnds = (page, id) => page.evaluate((elId) => {
  const ppf = window.__plannerView.get().ppf;
  const g = document.querySelector(`[data-el-id="${elId}"]`);
  const r = g && g.querySelector("rect");
  if (!r) return null;
  const m = r.getScreenCTM();
  const pt = (x, y) => { const p = new DOMPoint(x, y).matrixTransform(m); return { x: p.x, y: p.y }; };
  const x = +r.getAttribute("x"), y = +r.getAttribute("y");
  const w = +r.getAttribute("width"), h = +r.getAttribute("height");
  const a = pt(x, y + h / 2), b = pt(x + w, y + h / 2);
  return { minPx: Math.min(a.x, b.x), maxPx: Math.max(a.x, b.x), len: w / ppf, ppf };
}, id);

/* Select an element by pressing its own centre on the canvas. */
async function select(page, id) {
  const c = await page.evaluate((elId) => {
    const r = document.querySelector(`[data-el-id="${elId}"] rect`);
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, id);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('[data-handle="edge"]').first()).toBeVisible({ timeout: 5_000 });
}

/* Drag the edge grip on one END of the along axis by `dxPx` screen pixels. `edge` is the grip's
 * own local normal: "1,0" is the +X end of the row, "-1,0" the −X end. */
async function dragEdge(page, edge, dxPx) {
  const grip = page.locator(`[data-handle="edge"][data-edge="${edge}"]`).first();
  const b = await grip.boundingBox();
  expect(b, `edge grip ${edge} is not on screen`).toBeTruthy();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dxPx / 2, y, { steps: 4 });
  await page.mouse.move(x + dxPx, y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

test.describe("NEW-1 — the owner's real Sylvestri plan: a shrink moves ONE end", () => {
  test("as loaded, the trailer tracks its court on the clear bump-out face", async ({ page }) => {
    await loadPlan(page);
    const t = await readEnds(page, TRAILER), c = await readEnds(page, COURT);
    expect(t.len).toBeCloseTo(FACE, 1);
    expect(c.len).toBeCloseTo(FACE, 1);
    expect(t.minPx).toBeCloseTo(c.minPx, 0);
    expect(t.maxPx).toBeCloseTo(c.maxPx, 0);
  });

  test("dragging the trailer's +X end IN and back OUT never moves the −X end", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await loadPlan(page);
    const before = await readEnds(page, TRAILER);
    await select(page, TRAILER);

    await dragEdge(page, "1,0", -120);                       // pull the + end in
    const shrunk = await readEnds(page, TRAILER);
    expect(shrunk.len, "the drag did not shorten the row").toBeLessThan(before.len - 50);
    expect(shrunk.minPx, "the end the owner did NOT grab moved").toBeCloseTo(before.minPx, 0);

    await dragEdge(page, "1,0", 60);                         // …and push it back out
    const grown = await readEnds(page, TRAILER);
    expect(grown.len).toBeGreaterThan(shrunk.len + 20);
    expect(grown.minPx, "growing back moved the far end").toBeCloseTo(before.minPx, 0);
    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("dragging the trailer's −X end IN and back OUT never moves the +X end", async ({ page }) => {
    await loadPlan(page);
    const before = await readEnds(page, TRAILER);
    await select(page, TRAILER);

    await dragEdge(page, "-1,0", 120);                       // pull the − end in
    const shrunk = await readEnds(page, TRAILER);
    expect(shrunk.len).toBeLessThan(before.len - 50);
    expect(shrunk.maxPx, "the end the owner did NOT grab moved").toBeCloseTo(before.maxPx, 0);

    await dragEdge(page, "-1,0", -60);                       // …and back out
    const grown = await readEnds(page, TRAILER);
    expect(grown.len).toBeGreaterThan(shrunk.len + 20);
    expect(grown.maxPx).toBeCloseTo(before.maxPx, 0);
  });

  test("the shrunk row SURVIVES A RELOAD anchored — the heal does not re-centre it", async ({ page }) => {
    await loadPlan(page);
    await select(page, TRAILER);
    await dragEdge(page, "1,0", -120);
    const shrunk = await readEnds(page, TRAILER);
    const court = await readEnds(page, COURT);
    expect(shrunk.minPx).toBeCloseTo(court.minPx, 0);        // still flush at the end it was anchored to

    // Re-open the SAVED record — the on-device write the planner just made, anchor and all — so the
    // load-time heals (`normalizeBondedChildren`) get their turn at it. The seed init-script above
    // re-runs on every navigation, so the saved bytes are re-armed AFTER it to win.
    const saved = await page.evaluate(async (id) => {
      for (let i = 0; i < 40; i++) {
        const raw = localStorage.getItem("planarfit:sites:v1");
        const rec = raw && JSON.parse(raw)[id];
        const t = rec && (rec.els || []).find((e) => e.id === "e1454796yyuqqs");
        if (t && Number.isFinite(t.alongLen)) return rec;
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    }, SITE_ID);
    expect(saved, "the shrunk row was never written to storage").toBeTruthy();
    const savedTrailer = saved.els.find((e) => e.id === TRAILER);
    expect(savedTrailer.alongLen, "no length was stored").toBeGreaterThan(0);
    expect(savedTrailer.alongAnchor, "no ANCHOR was stored beside the length").not.toBe(0);

    await page.addInitScript(([id, rec]) => {
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
      localStorage.setItem("planarfit:currentSite:v1", id);
    }, [SITE_ID, saved]);
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect.poll(() => page.locator(`[data-el-id="${TRAILER}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    const after = await readEnds(page, TRAILER), courtAfter = await readEnds(page, COURT);
    expect(after.len, "the stored length was lost on reload").toBeCloseTo(shrunk.len, 0);
    expect(after.minPx - courtAfter.minPx, "the anchor was lost on reload — it re-centred")
      .toBeCloseTo(shrunk.minPx - court.minPx, 0);
  });
});
