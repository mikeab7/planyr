/* NEW-2 (2026-10-11) — A PRESS THAT STARTS ON AN ELEMENT'S LABEL MOVES THAT ELEMENT.
 *
 * Owner report: press the mouse down on a building's square-footage label and drag — nothing
 * moves. The same drag starting on bare building area moves it. Cause: every element's on-canvas
 * label is pointer-enabled (so it can take a click / double-click / right-click itself, NEW-1 of the
 * click-ownership audit) and its pointerdown handler SELECTED the element and stopped the event —
 * it never armed the move, so the drag had no owner. Fix: the label hands the press to the body's
 * own `startMoveEl`.
 *
 * RED-PROOF: on main this spec fails every "drag from the label" case (the element's centre is
 * unchanged); each case also drags from the BODY first as the known-good arm — if the body drag
 * does not move the element the run is VOID rather than scored.
 *
 * Also asserts NEW-1: no label carries bump-out wording, with bump-outs attached.
 *
 * Run: npx playwright test e2e/label-press-drags-element.spec.js
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE_ID = "e2e-label-press";

const els = [
  { id: "bPlain", type: "building", cx: -900, cy: -500, w: 600, h: 300, rot: 0, dock: "cross", dockSide: "bottom", z: 0 },
  { id: "bRot", type: "building", cx: 300, cy: -500, w: 600, h: 300, rot: 30, dock: "cross", dockSide: "bottom", z: 1 },
  { id: "bBump", type: "building", cx: -900, cy: 400, w: 600, h: 300, rot: 0, dock: "cross", dockSide: "bottom", z: 2 },
  { id: "bBump-d1", type: "building", cx: -900 - 300 - 27.5, cy: 400 + 150 + 30, w: 55, h: 60, rot: 0, dock: "none", noFit: true, noLabel: true, dogEar: { side: "bottom", sign: -1 }, attachedTo: "bBump", z: 3 },
  { id: "bBump-d2", type: "building", cx: -900 + 300 + 27.5, cy: 400 + 150 + 30, w: 55, h: 60, rot: 0, dock: "none", noFit: true, noLabel: true, dogEar: { side: "bottom", sign: 1 }, attachedTo: "bBump", z: 4 },
  { id: "pTrailer", type: "trailer", cx: 500, cy: 650, w: 1000, h: 80, rot: 0, noFit: true, cfg: { single: true, trailerL: 80, trailerW: 12, trailerAisle: 0 }, z: 5 },
  { id: "pPond", type: "pond", rot: 0, z: 6, points: [{ x: 1100, y: 100 }, { x: 1700, y: 100 }, { x: 1700, y: 500 }, { x: 1100, y: 500 }] },
];

async function load(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Label press", name: "plan", origin: null, county: "harris",
    parcels: [], els, measures: [], callouts: [], markups: [], settings: { showAreas: true }, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto(`/#/project/${SITE_ID}/site`, { waitUntil: "load" });
  await expect(canvas(page)).toBeVisible();
  await expect.poll(async () => page.locator("[data-el-id]").count(), { timeout: 20_000 }).toBeGreaterThan(3); // el-tier: seeded plan has no other kinds
  await page.waitForTimeout(1200);
}

const stored = (page, id) => page.evaluate((i) => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const e = ((map[Object.keys(map)[0]] || {}).els || []).find((x) => x.id === i);
  return e ? (e.points ? { cx: e.points[0].x, cy: e.points[0].y } : { cx: e.cx, cy: e.cy }) : null;
}, id);

/* Screen centre of the label's text, the point a person presses. */
const labelPoint = (page, id) => page.evaluate((i) => {
  const g = document.querySelector(`[data-label-for="${i}"] text`);
  if (!g) return null;
  const r = g.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, id);

/* A point on the element's OWN body, clear of its label and of the chrome inside the shape (the red
 * dimension number, the door/dock overlays): for a rectangle, 30% of its length from the centre along
 * its own axis — correct at any rotation. A polygon (the pond) is found by scanning for a bare-fill hit. */
const bodyPoint = (page, id) => page.evaluate(([i, spec]) => {
  const g = document.querySelector(`[data-el-id="${i}"]`);
  const r = g.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  if (spec.w) {
    const ppf = window.__plannerView.get().ppf, a = ((spec.rot || 0) * Math.PI) / 180, d = 0.3 * spec.w * ppf;
    return { x: cx + d * Math.cos(a), y: cy + d * Math.sin(a) };
  }
  for (let fy = 0.3; fy <= 0.7; fy += 0.05) for (let fx = 0.2; fx <= 0.8; fx += 0.05) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    const hit = document.elementFromPoint(x, y);
    if (hit && hit.closest(`[data-el-id="${i}"]`) && !hit.closest("[data-label-for]") && /^(rect|path|polygon)$/i.test(hit.tagName) && !hit.hasAttribute("data-testid")) return { x, y };
  }
  return null;
}, [id, els.find((e) => e.id === id)]);

async function drag(page, from, dx, dy) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

const moved = (a, b) => Math.hypot(b.cx - a.cx, b.cy - a.cy);

for (const id of ["bPlain", "bRot", "bBump", "pTrailer", "pPond"]) {
  test(`${id}: a drag that starts on the LABEL moves the element like a body drag (unselected, then selected)`, async ({ page }) => {
    await load(page);
    // Parking fields, truck courts and roads carry NO on-canvas label (NO_LABEL in SitePlanner.jsx), so
    // they have nothing to press; the trailer row and the pond are the other element labels.
    const lbl = await labelPoint(page, id);
    expect(lbl, `VOID: ${id}'s label is not shown — the case under test is not present`).toBeTruthy();

    // KNOWN-GOOD ARM — the body drag must move it, or the run is void.
    const b0 = await stored(page, id);
    const bp = await bodyPoint(page, id);
    expect(bp, `VOID: no body point found for ${id}`).toBeTruthy();
    await drag(page, bp, 40, 25);
    const b1 = await stored(page, id);
    expect(moved(b0, b1), "VOID: a body drag did not move the element, so this run cannot judge the label").toBeGreaterThan(5);

    // UNSELECTED: click empty canvas first, then press-drag the label.
    await page.keyboard.press("Escape");
    await canvas(page).click({ position: { x: 5, y: 5 } });
    const lp = await labelPoint(page, id);
    const s0 = await stored(page, id);
    await drag(page, lp, -50, 30);
    const s1 = await stored(page, id);
    expect(moved(s0, s1), `${id}: label drag (unselected) moved nothing`).toBeGreaterThan(5);

    // SELECTED: it is selected now — press-drag the label again.
    const lp2 = await labelPoint(page, id);
    await drag(page, lp2, 30, -20);
    const s2 = await stored(page, id);
    expect(moved(s1, s2), `${id}: label drag (selected) moved nothing`).toBeGreaterThan(5);
  });
}

test("a bump-out building's label carries no bump-out wording; a click on the label still selects, a double-click opens Properties", async ({ page }) => {
  await load(page);
  const txt = await page.locator('[data-label-for="bBump"]').first().textContent();
  expect(txt, "label should show the building SF").toMatch(/SF/);
  expect(txt).not.toMatch(/bump|incl/i);
  for (const t of await page.locator("[data-label-for]").allTextContents()) expect(t).not.toMatch(/bump-?out/i);

  const lp = await labelPoint(page, "bPlain");
  const before = await stored(page, "bPlain");
  await page.mouse.click(lp.x, lp.y);
  await page.waitForTimeout(300);
  expect(moved(before, await stored(page, "bPlain")), "a plain click must not move it").toBeLessThan(0.5);
  await page.mouse.dblclick(lp.x, lp.y);
  await page.waitForTimeout(500);
  expect(moved(before, await stored(page, "bPlain")), "a double-click must not move it").toBeLessThan(0.5);
});
