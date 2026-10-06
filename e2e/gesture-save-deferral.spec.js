/* NEW-1 (B217540 recurrence ×2) — A GESTURE IN FLIGHT IS NOT A SAVE POINT: dragging does not rewrite the device store
 * on every pointer-move frame.
 *
 * THE REPORT. The owner's 2026-10-06 "Something was slow just now" (problem_reports 5f82f13a): after minutes of
 * copy → paste of whole building assemblies, moves and road resizes, 229 long tasks / 41.5 s of blocking, the worst
 * 940 ms. Measured with ui-audit/perf-edit-cycle.mjs on a replica of his plan: the SAME drag cost 1.0 s with an empty
 * device store, 2.4 s at 1.3 MB and 3.7 s at 3 MB — the cost followed what ELSE the device stores, because every
 * pointer-move frame ran the whole autosave stack (parse the whole `planarfit:sites:v1`, normalise, stringify and
 * `setItem` the whole thing, read it back).
 *
 * WHY THIS IS A COUNT AND NOT A TIME (B267539): a duration budget passes the moment the work merely gets cheaper, and
 * on a shared runner it flakes. The property is "the store is not rewritten ~20 times during one drag", which is an
 * integer, and which the pre-fix build fails by an order of magnitude.
 *
 * NEGATIVE CONTROL: on the pre-fix build the drag below writes the store on every frame (≥ 10 writes inside it).
 */
import { test, expect } from "@playwright/test";
import { startBlank, drawBuilding, canvas, selectTool } from "./drawKinds.js";

const SITES_KEY = "planarfit:sites:v1";

/** Count every write to the plans store, and expose the count + the live position of the (only) building on disk. */
const arm = (page) => page.evaluate((key) => {
  window.__storeWrites = 0;
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (k === key) window.__storeWrites++; return orig.call(this, k, v); };
  window.__storeWritesRead = () => window.__storeWrites;
}, SITES_KEY);
const writes = (page) => page.evaluate(() => window.__storeWrites);
/* A screen point where the app's OWN hit test answers "the building", with NOTHING selected. Two traps measured here:
 * the centre of a building is its label (answers nothing — a press there moves nothing), and a SELECTED building
 * wears edge grips and on-body "+/−" controls, so most points on it resize or add a bump-out instead of dragging.
 * Deselect first (Escape + a click on bare map), then ask the app's own `__plannerHitTarget` (E2E-gated, read-only)
 * rather than re-implementing the rule. */
const pointOnBuilding = async (page) => {
  await page.keyboard.press("Escape");
  const box = await canvas(page).boundingBox();
  await page.mouse.click(box.x + 60, box.y + 60);
  await page.waitForTimeout(500);
  return page.evaluate(() => {
  const g = document.querySelector('[data-feature^="el:"]');
  if (!g || typeof window.__plannerHitTarget !== "function") return null;
  const r = g.getBoundingClientRect();
  for (const fy of [0.5, 0.3, 0.7, 0.2, 0.8]) for (const fx of [0.3, 0.7, 0.5, 0.2, 0.8]) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy, t = window.__plannerHitTarget(x, y);
    if (t && t.kind === "el") return { x: Math.round(x), y: Math.round(y) };
  }
  return null;
  });
};
const buildingOnDisk = (page) => page.evaluate((key) => {
  const map = JSON.parse(localStorage.getItem(key) || "{}");
  for (const rec of Object.values(map)) for (const e of rec.els || []) if (e.type === "building" && !e.attachedTo) return { cx: Math.round(e.cx), cy: Math.round(e.cy) };
  return null;
}, SITES_KEY);

test.describe("the autosave waits for a gesture to end", () => {
  test.beforeEach(async ({ page }) => { await page.addInitScript(() => { window.__PLANYR_E2E = true; }); });   // arms the app's read-only hit-test hook
  test("a 40-frame drag writes the plans store at most once, and the settled position is saved after release", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    const at = await drawBuilding(page, box);
    await selectTool(page);
    await expect.poll(() => buildingOnDisk(page), { timeout: 10_000 }).not.toBeNull();
    const start = await buildingOnDisk(page);
    await page.waitForTimeout(900);                       // let the draw's own debounced writes finish before counting

    const p = await pointOnBuilding(page);
    expect(p, "no point on the building answers to it — the drag would test nothing").toBeTruthy();
    await arm(page);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x - 90, p.y + 60, { steps: 40 });
    const during = await writes(page);
    expect(during, `the store was rewritten ${during}× WHILE the drag was still in flight — every pointer-move frame ran the whole autosave stack`).toBeLessThanOrEqual(1);
    await page.mouse.up();

    // the ordinary save runs once the gesture ends, and what it saves is the SETTLED position
    await expect.poll(() => writes(page), { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => { const b = await buildingOnDisk(page); return b && (b.cx !== start.cx || b.cy !== start.cy); }, { timeout: 5_000 }).toBe(true);
  });

  test("the deferral is bounded: a gesture that never ends cannot switch autosave off", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    const at = await drawBuilding(page, box);
    await selectTool(page);
    await page.waitForTimeout(900);
    const p = await pointOnBuilding(page);
    expect(p, "no point on the building answers to it — the drag would test nothing").toBeTruthy();
    await arm(page);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    // keep the gesture alive and the model changing for longer than GESTURE_SAVE_DEFER_MAX_MS (5 s)
    for (let i = 0; i < 70; i++) { await page.mouse.move(p.x - i, p.y + i, { steps: 2 }); await page.waitForTimeout(100); }
    const held = await writes(page);
    expect(held, "a very long drag never wrote the store — the expiry that keeps autosave alive is gone").toBeGreaterThanOrEqual(1);
    expect(held, `a long drag wrote the store ${held}× — it should write at most about once per deferral window`).toBeLessThanOrEqual(4);
    await page.mouse.up();
  });
});
