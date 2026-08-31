/* NEW-1 / NEW-2 — A DOUBLE-CLICK OPENS PROPERTIES, ON A BUSY PAGE, THROUGH A RETARGETED EVENT.
 *
 * Owner report, 2026-08-06 (Bain / "Concept A — Quiddity Hydrologic", reproduced live on his own
 * machine on BOTH an easement and a building): the feature SELECTS — grips and the area sub-label
 * appear — but `[data-testid="property-panel"]` never appears. `narrow` is false at his width, so
 * the dock-takeover rule was not the gate: `openInspector()` was simply never called.
 *
 * ONE contract (B750/B935), TWO broken implementations, and this spec is the live half of each.
 *
 * ── NEW-1: the reconstructed double-tap was budgeted on a WALL CLOCK. `isDoubleTap` compared
 *    `Date.now()` read INSIDE the handler against the previous press. Measured on his page, the
 *    second pointerdown's handler began 307 ms after its own event fired (e.timeStamp 330662 →
 *    handler at 330969) against a 350 ms budget — so an ordinary 150 ms double-click measured
 *    ~450 ms and was discarded. The busier the plan, the more often nothing happens.
 *
 *    ⛔ THE NEGATIVE CONTROL IS THE POINT OF THIS SPEC. A double-click test on an IDLE page tests
 *    nothing here — it passed on the broken build too. So `jamMainThread` runs a real synchronous
 *    long task BETWEEN the two presses (dispatched from a `pointerdown` listener, so it is the app's
 *    own handler queue that backs up, exactly as it does on his plan), and the assertion is that
 *    Properties still opens. On the pre-fix build this case is RED; on the fix it is green.
 *
 * ── NEW-2: the NATIVE `dblclick` never reaches the feature's node. A click's target is the common
 *    ancestor of its down and up targets; press 1 selects the feature, React re-renders it, and the
 *    node the browser was holding is gone — so `click#2` and `dblclick` collapse to the bare root
 *    `<svg>`. Every `<g>`-level `onDoubleClick` was unreachable in exactly the case it covered.
 *
 *    ⛔ THIS ASSERTS THE EVENT'S OWN TARGET, not merely that Properties opened — otherwise NEW-1's
 *    fix masks this one (the reconstructed tap would open the panel and the native path could rot
 *    unnoticed until the next render boundary moves). The retarget is recorded from a capture-phase
 *    listener on the document and asserted directly.
 *
 * Runs logged-out on a blank site: no auth, no external GIS, no real project data.
 */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const panel = (p) => p.getByTestId("property-panel");

async function startBlank(page) {
  await page.goto("/");
  await page.getByTestId("map-start-blank-menu-btn").click();
  await page.getByTestId("map-start-blank-menu-item").click();
  await expect(canvas(page)).toBeVisible();
}

/* Clear the pending tap record (DBLTAP_MS = 350 ms) so the NEXT gesture's presses pair with each
 * other rather than with the click that preceded them. */
const settleTaps = (page) => page.waitForTimeout(450);

async function drawBuilding(page) {
  const box = await canvas(page).boundingBox();
  const X = (f) => Math.round(box.x + box.width * f), Y = (f) => Math.round(box.y + box.height * f);
  await page.getByRole("button", { name: "Building", exact: true }).click();
  await page.mouse.move(X(0.42), Y(0.30));
  await page.mouse.down();
  await page.mouse.move(X(0.60), Y(0.45), { steps: 5 });
  await page.mouse.move(X(0.80), Y(0.62), { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  // The dimension number rides ~18% along the footprint, so the CENTRE is the body.
  return { cx: X(0.66), cy: Y(0.46) };
}

/* Hold the main thread for `ms` on the NEXT pointerdown, once. Installed as a capture-phase
 * listener so it runs before the app's own handlers and pushes them behind it — which is what a
 * busy plan does on its own (the 24–80% main-thread occupancy measured on the owner's machine).
 * A synchronous spin is deliberate: a timer would yield and the handler queue would drain. */
async function jamNextPointerDown(page, ms) {
  await page.evaluate((hold) => {
    const jam = () => {
      document.removeEventListener("pointerdown", jam, true);
      const until = performance.now() + hold;
      while (performance.now() < until) { /* burn the thread — this is the defect's amplifier */ }
    };
    document.addEventListener("pointerdown", jam, true);
  }, ms);
}

/* Two separate down/up pairs at one point. Pointer capture releases on the first up before the
 * second down, which a fast `clickCount: 2` cannot promise. */
async function twoPresses(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.down(); await page.mouse.up();
}

test.describe("a double-click opens Properties", () => {
  test("NEW-1 (negative control): it still opens when the main thread is jammed between the presses", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawBuilding(page);
    await settleTaps(page);

    // Sanity: on an IDLE page it opens. This half passed on the broken build too — which is exactly
    // why it cannot be the whole test.
    await twoPresses(page, cx, cy);
    await expect(panel(page)).toBeVisible();
    await page.locator('button[aria-label="Close properties"]').click();
    await expect(panel(page)).toHaveCount(0);
    await settleTaps(page);

    /* THE CONTROL. Press 1 lands, then the thread is held for longer than the whole 350 ms budget
     * before press 2's handler can run. On the wall-clock build the recorded interval is the JAM,
     * not the gesture, so the pair is discarded and nothing opens. The presses themselves are still
     * an ordinary double-click — the browser stamps both events when they happen. */
    await page.mouse.move(cx, cy);
    await page.mouse.down(); await page.mouse.up();
    await jamNextPointerDown(page, 700);
    await page.mouse.down(); await page.mouse.up();

    await expect(panel(page), "a double-click on a busy plan did not open Properties (the wall-clock budget)").toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("NEW-2: the native dblclick retargets to the bare <svg> — and Properties opens anyway", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawBuilding(page);
    await settleTaps(page);

    // Record what the browser actually delivered, from a capture-phase listener on the document so
    // nothing in the app can intercept it first.
    await page.evaluate(() => {
      window.__dblTrace = [];
      for (const type of ["pointerdown", "click", "dblclick"]) {
        document.addEventListener(type, (e) => {
          const t = e.target;
          window.__dblTrace.push({
            type,
            tag: t && t.tagName ? String(t.tagName).toLowerCase() : String(t),
            feature: t && t.closest ? ((t.closest("[data-feature]") || {}).getAttribute ? t.closest("[data-feature]").getAttribute("data-feature") : null) : null,
            detail: e.detail,
          });
        }, true);
      }
    });

    /* `clickCount` 1 then 2 is what makes Chromium synthesise a `dblclick` at all — two independent
     * `mouse.down()/up()` pairs leave the counter at 1 both times and no dblclick is ever delivered. */
    await page.mouse.move(cx, cy);
    await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
    await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });

    const trace = await page.evaluate(() => window.__dblTrace);
    const shown = JSON.stringify(trace);

    /* ⛔ THE RETARGET IS THE ASSERTION — the event's OWN target, not merely that Properties opened.
     *
     * WHICH event in the pair loses its target is a function of WHEN React's commit lands relative
     * to the browser's down/up pairing, so it moves with machine speed: on the owner's busy plan the
     * press-1 commit landed between down#2 and up#2 and his `click#2` AND `dblclick` both came out
     * on the bare `<svg>`; on an idle machine here the press-1 commit lands earlier and it is
     * `click#1` that loses its target instead. Pinning one specific event would therefore be pinning
     * the machine, not the defect — so what is asserted is the INVARIANT underneath both traces: a
     * press that lands squarely on a feature can be delivered as a click on the bare root, because
     * press 1 replaced the node the browser was holding. That is what makes every `<g>`-level
     * onDoubleClick unreachable, and it is why the gesture is resolved at the root by hit-testing.
     *
     * If this ever goes green-by-vacuum — no retarget anywhere in the gesture — the render boundary
     * has MOVED, and that is exactly the moment to re-measure rather than relax the check. */
    const downOnFeature = trace.filter((r) => r.type === "pointerdown" && r.feature);
    expect(downOnFeature.length, `the presses did not land on the feature at all: ${shown}`).toBeGreaterThanOrEqual(2);

    const retargeted = trace.filter((r) => (r.type === "click" || r.type === "dblclick") && r.tag === "svg");
    expect(retargeted.length, `no click in the gesture retargeted to the bare root — the render boundary moved: ${shown}`).toBeGreaterThan(0);
    expect(retargeted[0].feature, "a click on the bare root cannot carry the feature's identity").toBeNull();

    // …and the double-click still did its job.
    await expect(panel(page)).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  /* NEW-2, the half that pins the FIX rather than the defect: a `dblclick` whose own target IS the
   * bare `<svg>` — the owner's measured case, verbatim — still opens Properties.
   *
   * Two things are deliberately taken away first, so nothing else can be carrying the gesture:
   *   • the reconstructed double-tap, by spacing the presses past the 350 ms budget so `isDoubleTap`
   *     cannot pair them (otherwise NEW-1's fix would mask this one);
   *   • every per-node `onDoubleClick`, by dispatching AT the root, so React's synthetic propagation
   *     path contains no feature node for a `<g>`-level handler to fire from.
   * What is left is the root resolver, hit-testing the point. If it regresses, this goes red. */
  test("NEW-2: a dblclick delivered on the bare <svg> still opens Properties", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const { cx, cy } = await drawBuilding(page);
    await settleTaps(page);

    await page.mouse.click(cx, cy);          // select
    await expect(panel(page)).toHaveCount(0); // a single click never opens the panel (the contract)
    await settleTaps(page);                   // …and now no pair is possible

    const target = await page.evaluate(({ x, y }) => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      svg.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 2 }));
      return { tag: svg.tagName.toLowerCase(), feature: svg.closest("[data-feature]") ? "yes" : null };
    }, { x: cx, y: cy });
    expect(target.tag, "the canvas root is not an <svg> any more — this test is no longer testing the reported case").toBe("svg");
    expect(target.feature, "the canvas root must carry no feature identity of its own").toBeNull();

    await expect(panel(page), "a dblclick on the bare canvas root did not open Properties — the root resolver is dead").toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  /* NEW-3 — a centerline road pops the inline width chip instead of Properties. Found under the
   * FRIENDLIEST conditions (fast machine, unthrottled, two-element plan), so it is a wiring defect
   * independent of the two above: the road's width dimension NUMBER is anchored to the centreline
   * midpoint, i.e. painted ON the pavement, so a double-click aimed at the road cannot miss it. */
  test("NEW-3: double-clicking a road opens Properties, not the inline width editor", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    const X = (f) => Math.round(box.x + box.width * f), Y = (f) => Math.round(box.y + box.height * f);

    await page.getByRole("button", { name: "Road", exact: true }).click();
    await page.getByRole("button", { name: "Road presets" }).click();
    await page.getByRole("button", { name: /^\d+′$/ }).first().click();
    await page.mouse.click(X(0.42), Y(0.35));
    await page.mouse.click(X(0.82), Y(0.35));
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await settleTaps(page);

    // The road's MIDPOINT — which is exactly where its width number sits.
    await twoPresses(page, X(0.62), Y(0.35));

    await expect(panel(page), "a double-click on a road did not open Properties").toBeVisible();
    await expect(page.getByTestId("num-edit-field"), "the inline width editor opened instead of Properties").toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
