/* NEW-1 / NEW-2 — A CLICK SELECTS. IT DOES NOT MOVE, AND IT DOES NOT COST AN UNDO STEP.
 *
 * Owner, 2026-08-09: "sometimes when I intend to just click on something to select it, it actually
 * also moves it, like, a couple feet or, like, a pixel or two just because my click is too slow
 * even though, like, to me, it feels like an instantaneous click, and it shouldn't move. Maybe I
 * hold it for a couple milliseconds, and it accidentally moves the element."
 *
 * The move path had NO slop gate: the first pointermove wrote new positions, so a pixel of tremor
 * during a click was a committed move — and the ambient flush-snap could then pull the element up
 * to 20 ft onto a neighbour's edge (the "couple of feet", and the reason it was intermittent).
 * Separately, `pushHistory()` fired on pointer DOWN, so every plain click burnt an undo frame:
 * "Ctrl+Z does nothing, several times in a row."
 *
 * This is the LIVE half, logged out on a blank site — everything here is reachable without an
 * account, so per the repo's ATTEMPT-BEFORE-YOU-PARK rule it runs HERE rather than being filed as
 * a live check. `test/dragGate.test.js` owns the pure rule + the wiring guard; the signed-in half
 * (a plain click must produce NO element row write) is V79612, which needs an account.
 *
 * The observable is the PERSISTED model — `planarfit:sites:v1` — because "did it move" is a
 * question about stored geometry, not about pixels: an assertion on a screen rect cannot tell a
 * sub-pixel render difference from a real coordinate write.
 *
 * ⚠ Every gesture here holds ALT, which bypasses grid snap and the flush-snap. That is deliberate
 * SENSITIVITY, not realism: with snap on, a tremor-sized delta can quantise back to the same grid
 * point, so a broken build would pass. With Alt held, ANY write at all shows up as a changed
 * coordinate. (The flush-snap is what makes the owner's case a couple of FEET; this makes the
 * test able to see a hundredth of one.)
 *
 * Run: npx playwright test e2e/click-never-moves.spec.js
 */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByTestId("map-start-blank-menu-btn").click();
  await page.getByTestId("map-start-blank-menu-item").click();
  await expect(canvas(page)).toBeVisible();
  // FOREGROUND-OR-VOID: a background tab suspends rAF, so every geometry reading below would
  // describe a view the app had already left. Refuse to measure one.
  expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
}

/* The stored buildings, exactly as persisted. `key` is the byte-level identity of the geometry a
 * click must not touch. */
function buildings(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).filter((e) => e.type === "building")
      .map((e) => ({ id: e.id, cx: e.cx, cy: e.cy, w: e.w, h: e.h, key: JSON.stringify([e.cx, e.cy, e.w, e.h, e.rot || 0]) }));
  });
}
const first = async (page) => (await buildings(page))[0];

/* The persisted record is written on a debounce, so a read taken the instant a drag ends can catch
 * a MID-gesture position — which then reads as "a later click moved it". Wait for the stored
 * geometry to stop changing before treating it as the baseline. */
async function settled(page) {
  let prev = null;
  for (let i = 0; i < 25; i++) {
    const now = await first(page);
    if (prev && now.key === prev.key) return now;
    prev = now;
    await page.waitForTimeout(200);
  }
  throw new Error("the stored geometry never settled");
}

/* Drag out a building and return its centre in client px. */
async function drawBuilding(page, { x1 = 300, y1 = 250, x2 = 540, y2 = 410 } = {}) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Building", exact: true }).click();
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x1 + 70, box.y + y1 + 50, { steps: 5 });
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await buildings(page)).length).toBeGreaterThanOrEqual(1);
  return { cx: box.x + (x1 + x2) / 2, cy: box.y + (y1 + y2) / 2 };
}

/* Where the element is on screen right now, from the DOM. Used only for the NO-JUMP assertion,
 * where the question genuinely is about pixels mid-gesture. */
const rectOf = (page, id) => page.evaluate((elId) => {
  const g = document.querySelector(`[data-el-id="${elId}"]`);
  if (!g) return null;
  const r = g.getBoundingClientRect();
  return { x: r.x, y: r.y };
}, id);

test.describe("NEW-1: a click selects and never moves", () => {
  test("a press with a pixel or two of tremor leaves the geometry byte-identical", async ({ page }) => {
    await startBlank(page);
    const c = await drawBuilding(page);
    const before = await settled(page);

    await page.keyboard.down("Alt");
    await page.mouse.move(c.cx, c.cy);
    await page.mouse.down();
    // The owner's gesture: a hand that is not quite still.
    for (const [dx, dy] of [[1, 0], [1, 1], [2, 1], [1, 2], [0, 1]]) await page.mouse.move(c.cx + dx, c.cy + dy);
    await page.mouse.up();
    await page.keyboard.up("Alt");

    // Give any write a chance to land before claiming none happened.
    await page.waitForTimeout(600);
    const after = await first(page);
    expect(after.key, `the click moved the building: ${before.key} → ${after.key}`).toBe(before.key);

    // …and it DID select: the shared handle layer is populated for the selected element.
    expect(await page.locator('[data-handle-layer="1"] [data-handle]').count()).toBeGreaterThan(0);
  });

  test("a SLOW, deliberate press that never moves is still a click (duration is not part of the test)", async ({ page }) => {
    /* The mirror-image bug: the pan path's tap classifier pairs slop with a 400 ms limit, and
     * copying it here would make a careful, slow press start dragging — which is the complaint. */
    await startBlank(page);
    const c = await drawBuilding(page);
    const before = await settled(page);

    await page.keyboard.down("Alt");
    await page.mouse.move(c.cx, c.cy);
    await page.mouse.down();
    await page.waitForTimeout(2500);                 // far past PARCEL_CLICK_MS
    await page.mouse.move(c.cx + 2, c.cy + 1);       // …with a little drift, as a real hand has
    await page.waitForTimeout(1500);
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await page.waitForTimeout(600);
    expect((await first(page)).key).toBe(before.key);
  });

  test("a real drag still moves — and does not JUMP when the gate opens", async ({ page }) => {
    await startBlank(page);
    const c = await drawBuilding(page);
    const before = await settled(page);

    await page.keyboard.down("Alt");
    await page.mouse.move(c.cx, c.cy);
    await page.mouse.down();
    await page.mouse.move(c.cx + 3, c.cy);           // inside the slop: nothing may move yet
    const atSlop = await rectOf(page, before.id);
    await page.mouse.move(c.cx + 7, c.cy);           // the frame the drag begins on
    const atArm = await rectOf(page, before.id);
    // THE NO-JUMP PROPERTY: opening the gate must not leap the element by the accumulated travel.
    expect(Math.abs(atArm.x - atSlop.x), "the element jumped when the drag armed").toBeLessThan(1);

    await page.mouse.move(c.cx + 87, c.cy, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await expect.poll(async () => (await first(page)).cx !== before.cx).toBe(true);
    const after = await settled(page);
    // It moved by the travel SINCE the drag began (87 − 7 px worth of feet), not by 87 and not by 0.
    const movedPx = (after.cx - before.cx) * (await page.evaluate(() => window.__plannerView?.get?.().ppf ?? null) ?? 1);
    expect(movedPx).toBeGreaterThan(60);
    expect(after.cy).toBeCloseTo(before.cy, 5);      // a horizontal drag moves nothing vertically
  });
});

test.describe("NEW-2: an undo frame only for a real change", () => {
  test("plain clicks cost no undo steps — ONE Ctrl+Z reverses the last real edit", async ({ page }) => {
    await startBlank(page);
    const c = await drawBuilding(page);
    const placed = await settled(page);

    // ONE real edit: drag it somewhere new.
    await page.keyboard.down("Alt");
    await page.mouse.move(c.cx, c.cy);
    await page.mouse.down();
    await page.mouse.move(c.cx + 40, c.cy + 25, { steps: 6 });
    await page.mouse.move(c.cx + 90, c.cy + 60, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await first(page)).cx !== placed.cx).toBe(true);
    const moved = await settled(page);

    // Then a run of plain clicks — the gesture the owner performs dozens of times an hour.
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(c.cx + 90, c.cy + 60);
      await page.mouse.down();
      await page.mouse.move(c.cx + 91, c.cy + 61);
      await page.mouse.up();
      await page.waitForTimeout(60);
    }
    await page.keyboard.up("Alt");
    await page.waitForTimeout(400);
    expect((await first(page)).key, "one of the plain clicks moved it").toBe(moved.key);

    // ⌘/Ctrl+Z ONCE must undo the DRAG. Before the fix each click had pushed its own no-op frame,
    // so this took six presses and the first five looked like a broken undo.
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await first(page)).cx, { timeout: 5000 }).toBeCloseTo(placed.cx, 5);
    expect((await first(page)).cy).toBeCloseTo(placed.cy, 5);
  });
});
