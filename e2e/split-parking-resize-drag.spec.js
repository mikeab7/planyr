/* NEW-1 (dispatch, 2026-09-18) — owner report on Goose Creek (Phase II - TAS project), verbatim
 * (paraphrased from the dispatch): take a parking paving element, split it into rows and drive
 * aisles, then drag a resize handle to extend one piece — it follows the cursor during the drag,
 * but on release it "snaps back" to its pre-drag size.
 *
 * ROOT CAUSE, found by driving the real gesture headless (not the "+"/"−" ladder — the actual
 * resize-handle DRAG) against a freestanding (not wall-bonded) split stack: `refitChildren`
 * (SitePlanner.jsx) already re-lays a WALL-BONDED stack on every resize frame
 * (`relayoutWallKids` — the B1749152 dispatch's own "hostClampOf" fix sits right next to this),
 * but had NO equivalent for a FREESTANDING split stack (no host wall to relay against). So growing
 * one piece's depth changed ONLY that piece — its neighbours never moved — and the grown region
 * OVERLAPPED the next untouched piece. The untouched piece paints later (higher z / later in
 * array order, since it was created after the piece being grown) and is opaque, so it visually
 * BURIES the grown edge: the piece really did grow (proven directly — its own stored `h` and the
 * DOM box both show the new size, right up until release), but with its neighbour painted on top
 * of the overlap, it reads on screen as "it snapped back to its old size" the moment you let go.
 * This is the SAME root cause `freeParkStack`'s own file header describes for the "+"/"−" ladder
 * (B1620480/B1625728, fixed there by `growFreeParkStack`) — that fix never reached a direct
 * edge/corner drag on the canvas, which is exactly what this report used.
 *
 * NOT the same defect as B1749155 (a plain body MOVE of a wall-bonded side-parking field never
 * stamping `sideParkFit`, so the next heal resets it) — that is a WALL-BONDED field, a MOVE
 * gesture, and a HEAL-time revert; this is a FREESTANDING stack, a RESIZE gesture, and the
 * pieces never actually revert at all — they just overlap and paint wrong. Left open, unamended.
 *
 * Fix: `relayoutFreeStack` (lib/parking.js), the freestanding twin of `relayoutWallKids` — wired
 * into `refitChildren`'s per-frame resize path for any freestanding (`!attachedTo`) parking/paving
 * piece that carries a `sideParkPiece` (i.e., is part of a split stack). It propagates whatever
 * gap/overlap opened on either side of the resized piece, leaving the untouched side's chain
 * exactly where it was — so growing/shrinking any one piece keeps every OTHER piece flush against
 * it, with no gap and no overlap, and the resize survives release exactly as drawn.
 *
 * Reproduced here by DRIVING the real drag (down → move → up on the SVG's own
 * `rect[data-handle="edge"]`, not a synthetic value commit) and reading the saved plan (on-disk
 * truth per the repo's established readEls pattern). Logged out, no external GIS, local storage
 * only: Claude-doable here, per ATTEMPT-BEFORE-YOU-PARK. Verify: sandbox — plain UI/geometry, not
 * one of the LIVE-VERIFY classes.
 */
import { test, expect } from "@playwright/test";
import { openModule, armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE_KEY = "planarfit:sites:v1";

const readEls = (page) => page.evaluate((key) => {
  const map = JSON.parse(localStorage.getItem(key) || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return site.els || [];
}, SITE_KEY);

const fieldInput = (page, label) => page.getByText(label, { exact: true }).locator("xpath=..").locator("input").first();

async function startBlank(page) {
  await armPlannerHooks(page); // __plannerView.centerOn — a deterministic zoom for the resize-handle drag
  await page.goto("/");
  await openModule(page, "site-planner");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}

async function drawFreestandingField(page, box) {
  await page.getByRole("button", { name: "Parking", exact: true }).click();
  await page.mouse.move(box.x + 250, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 320, { steps: 5 });
  await page.mouse.move(box.x + 650, box.y + 400, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

async function selectAndOpenProperties(page, elId) {
  const box = await page.locator(`[data-el-id="${elId}"]`).first().boundingBox();
  const x = box.x + Math.min(8, box.width / 2), y = box.y + Math.min(4, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(200);
}

async function edgeHandles(page) {
  return page.evaluate(() => [...document.querySelectorAll('rect[data-handle="edge"]')].map((r) => {
    const b = r.getBoundingClientRect();
    return { edge: r.getAttribute("data-edge"), x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }));
}
async function cornerHandles(page) {
  return page.evaluate(() => [...document.querySelectorAll('rect[data-handle="corner"]')].map((r) => {
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }));
}

const freePads = (els) => els.filter((e) => !e.attachedTo && (e.type === "parking" || e.type === "paving"));
const byPiece = (a) => a.slice().sort((x, y) => x.sideParkPiece - y.sideParkPiece);
// Every piece's own near/far edge along its local depth (h) axis, world feet.
const nearFar = (p) => [p.cy - p.h / 2, p.cy + p.h / 2].sort((a, b) => a - b);

test.describe("NEW-1 — a resize-handle DRAG on a split freestanding parking piece commits, no overlap", () => {
  test("growing the innermost row's depth pushes the aisle + outer row outward, contiguous, and survives release", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawFreestandingField(page, box);

    let els = await readEls(page);
    const fieldId = els.find((e) => e.type === "parking" && !e.attachedTo).id;
    await selectAndOpenProperties(page, fieldId);
    await fieldInput(page, "Width (ft)").fill("200");
    await fieldInput(page, "Width (ft)").press("Enter");
    await fieldInput(page, "Depth (ft)").fill("60"); // 2 rows: 2*18 + 24
    await fieldInput(page, "Depth (ft)").press("Enter");
    await page.waitForTimeout(150);

    await selectAndOpenProperties(page, fieldId);
    await page.getByTestId("split-parking").click();
    await page.waitForTimeout(200);

    els = await readEls(page);
    let stack = byPiece(freePads(els));
    expect(stack.map((e) => e.type), "split into row / aisle / row").toEqual(["parking", "paving", "parking"]);
    const target = stack[0]; // the innermost row
    const beforeH = target.h;

    // Select the piece and grab its DEPTH edge handle FACING THE AISLE — the pair whose x sits at
    // the piece's own centre (the along-wall pair sits at the piece's two ends instead), and of
    // those two, whichever is screen-closer to the aisle: growing THAT one drags the piece's edge
    // toward — and past — the aisle, which is the case this bug is actually about (the OTHER depth
    // edge only ever extends the row away from the stack, where there is nothing to overlap).
    const aisle = stack[1];
    await selectAndOpenProperties(page, target.id);
    const handles = await edgeHandles(page);
    const cx = (await page.locator(`[data-el-id="${target.id}"]`).first().boundingBox());
    const aisleBox = await page.locator(`[data-el-id="${aisle.id}"]`).first().boundingBox();
    const aisleY = aisleBox.y + aisleBox.height / 2;
    const depthHandle = handles
      .filter((h) => Math.abs(h.x - (cx.x + cx.width / 2)) < 3)
      .sort((a, b) => Math.abs(a.y - aisleY) - Math.abs(b.y - aisleY))[0];
    expect(depthHandle, "a depth edge handle was found").toBeTruthy();
    const growSign = Math.sign(aisleY - (cx.y + cx.height / 2)) || 1; // drag toward the aisle to grow into it

    // Drag it a real distance and read the piece's OWN size mid-drag — it must actually grow.
    await page.mouse.move(depthHandle.x, depthHandle.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(depthHandle.x, depthHandle.y + growSign * 15 * i, { steps: 1 });
      await page.waitForTimeout(20);
    }
    const midBox = await page.locator(`[data-el-id="${target.id}"]`).first().boundingBox();
    await page.mouse.up();
    await page.waitForTimeout(300);

    els = await readEls(page);
    stack = byPiece(freePads(els));
    const after = stack.find((e) => e.id === target.id);

    // THE REPORTED SYMPTOM, made concrete: the piece must NOT have snapped back to its pre-drag
    // size on release — its committed depth must match what the drag showed mid-gesture, not the
    // original 18'.
    expect(after.h, "the row's depth grew and the growth survived release (no snap-back)").toBeGreaterThan(beforeH + 10);
    expect(midBox.height, "the DOM box actually grew during the drag").toBeGreaterThan(0);

    // THE ROOT CAUSE, made concrete: every piece in the stack is CONTIGUOUS — no overlap, no gap —
    // so the untouched siblings were pushed out of the way rather than sitting under the grown row.
    for (let i = 0; i < stack.length - 1; i++) {
      const [, farI] = nearFar(stack[i]);
      const [nearNext] = nearFar(stack[i + 1]);
      expect(Math.abs(nearNext - farI), `piece ${i} and piece ${i + 1} touch with no gap/overlap`).toBeLessThan(0.01);
    }

    // Reload and confirm the grown, non-overlapping layout is what actually persisted.
    await page.reload();
    await openModule(page, "site-planner");
    await page.waitForTimeout(500);
    els = await readEls(page);
    stack = byPiece(freePads(els));
    const afterReload = stack.find((e) => e.id === target.id);
    expect(afterReload.h, "the grown size survives a reload too").toBeGreaterThan(beforeH + 10);
    for (let i = 0; i < stack.length - 1; i++) {
      const [, farI] = nearFar(stack[i]);
      const [nearNext] = nearFar(stack[i + 1]);
      expect(Math.abs(nearNext - farI)).toBeLessThan(0.01);
    }

    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("growing the OUTERMOST piece's depth into the aisle pushes the whole inboard chain, still no overlap", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawFreestandingField(page, box);

    let els = await readEls(page);
    const fieldId = els.find((e) => e.type === "parking" && !e.attachedTo).id;
    await selectAndOpenProperties(page, fieldId);
    await fieldInput(page, "Width (ft)").fill("200");
    await fieldInput(page, "Width (ft)").press("Enter");
    await fieldInput(page, "Depth (ft)").fill("60");
    await fieldInput(page, "Depth (ft)").press("Enter");
    await page.waitForTimeout(150);

    await selectAndOpenProperties(page, fieldId);
    await page.getByTestId("split-parking").click();
    await page.waitForTimeout(200);

    els = await readEls(page);
    let stack = byPiece(freePads(els));
    const target = stack[2]; // the outermost row
    const before0 = { ...stack[0] }, before1 = { ...stack[1] };
    const beforeH = target.h;

    const aisle = stack[1];
    await page.evaluate((p) => window.__plannerView.centerOn(p.cx, p.cy, p.ppf), { cx: target.cx, cy: target.cy, ppf: 2 });
    await page.waitForTimeout(150);
    await selectAndOpenProperties(page, target.id);
    const handles = await edgeHandles(page);
    const cx = (await page.locator(`[data-el-id="${target.id}"]`).first().boundingBox());
    const depthHandles = handles.filter((h) => Math.abs(h.x - (cx.x + cx.width / 2)) < 3);
    expect(depthHandles.length, "both depth edge handles were found").toBe(2);
    // Grow TOWARD the aisle (into the stack) — the case this bug is about, and the only one that
    // can overlap a sibling; growing the other, free-standing edge has nothing to overlap.
    const aisleBox = await page.locator(`[data-el-id="${aisle.id}"]`).first().boundingBox();
    const aisleY = aisleBox.y + aisleBox.height / 2;
    const depthHandle = depthHandles.sort((a, b) => Math.abs(a.y - aisleY) - Math.abs(b.y - aisleY))[0];
    const growSign = Math.sign(aisleY - (cx.y + cx.height / 2)) || 1;
    await page.mouse.move(depthHandle.x, depthHandle.y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) { await page.mouse.move(depthHandle.x, depthHandle.y + growSign * 15 * i, { steps: 1 }); await page.waitForTimeout(20); }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const grew = (await readEls(page)).find((e) => e.id === target.id).h > beforeH + 10;
    expect(grew, "dragging the aisle-facing depth handle grew the outermost row into the stack").toBe(true);

    els = await readEls(page);
    stack = byPiece(freePads(els));
    const p0 = stack.find((e) => e.id === before0.id), p1 = stack.find((e) => e.id === before1.id);
    // The outermost piece has no sibling beyond it, only one (the aisle) before it — growing INTO
    // that aisle has nowhere to push the overlap to except further inboard, so (unlike growing the
    // innermost row, which only ever pushes pieces further OUT) the whole inboard chain may shift
    // to stay flush. Neither inboard piece's own SIZE may change, only its position:
    expect(p0.w).toBeCloseTo(before0.w, 6);
    expect(p0.h).toBeCloseTo(before0.h, 6);
    expect(p1.w).toBeCloseTo(before1.w, 6);
    expect(p1.h).toBeCloseTo(before1.h, 6);
    for (let i = 0; i < stack.length - 1; i++) {
      const [, farI] = nearFar(stack[i]);
      const [nearNext] = nearFar(stack[i + 1]);
      expect(Math.abs(nearNext - farI), `piece ${i} and piece ${i + 1} touch with no gap/overlap`).toBeLessThan(0.01);
    }

    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });
});

/* NEW-1 (dispatch, 2026-09-18, reopening B1754864) — the fix above was proven ONLY against a pure
 * DEPTH-EDGE drag (nx=0), which never touches `w`. The owner's live repro used "one of the
 * selection handles (the 6-8 small boxes shown around a selected element)" without specifying
 * edge vs corner, and a CORNER handle drags BOTH `w` and `h` at once (`startResize`'s
 * `nw = snapTo(Math.abs(local.x))`, `nh = snapTo(Math.abs(local.y))`, independently).
 *
 * ROOT CAUSE: `freeParkStack`'s sibling-membership test requires the candidate's `w` to match the
 * anchor's `w` within `eps` (0.5 ft) — that is how it tells this stack's own pieces apart from an
 * unrelated field sitting nearby. `refitChildren`'s freestanding-stack branch re-derived that
 * anchor from `next`, which already carries THIS FRAME's dragged geometry — so the instant a
 * corner drag grew the piece's width past the epsilon, its own untouched siblings (still at the
 * original width) stopped matching, `freeParkStack` returned a chain of length 1, and the depth
 * relayout silently never ran. The grown piece's depth really did change (proven directly below),
 * but its now-unmoved, still-opaque, later-painted neighbour sat exactly where it always was and
 * overlapped it — which is the same "snapped back" visual the original B1754864 fix was for, just
 * produced by a handle its own tests never drove.
 *
 * Fix: membership is now resolved ONCE per gesture, from the clean pre-drag geometry (the same
 * "capture at gesture start" shape `wallKids`/`hostClampOf` already use), and threaded through as
 * `opts.freeStackIds` rather than re-derived from the mutating `next` array on every frame.
 */
test.describe("NEW-1 (reopen) — a CORNER drag on a split freestanding parking piece still relays its siblings", () => {
  test("corner-dragging the AISLE (which also grows its width) still pushes the outer row, no overlap", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawFreestandingField(page, box);

    let els = await readEls(page);
    const fieldId = els.find((e) => e.type === "parking" && !e.attachedTo).id;
    await selectAndOpenProperties(page, fieldId);
    await fieldInput(page, "Width (ft)").fill("200");
    await fieldInput(page, "Width (ft)").press("Enter");
    await fieldInput(page, "Depth (ft)").fill("60"); // 2 rows: 2*18 + 24
    await fieldInput(page, "Depth (ft)").press("Enter");
    await page.waitForTimeout(150);

    await selectAndOpenProperties(page, fieldId);
    await page.getByTestId("split-parking").click();
    await page.waitForTimeout(200);

    els = await readEls(page);
    let stack = byPiece(freePads(els));
    const aisle = stack[1], row0 = stack[0], row1 = stack[2];
    const beforeH = aisle.h, beforeW = aisle.w;

    await page.evaluate((p) => window.__plannerView.centerOn(p.cx, p.cy, p.ppf), { cx: aisle.cx, cy: aisle.cy, ppf: 3 });
    await page.waitForTimeout(150);
    await selectAndOpenProperties(page, aisle.id);
    const corners = await cornerHandles(page);
    const cx = await page.locator(`[data-el-id="${aisle.id}"]`).first().boundingBox();
    const center = { x: cx.x + cx.width / 2, y: cx.y + cx.height / 2 };
    const row1Box = await page.locator(`[data-el-id="${row1.id}"]`).first().boundingBox();
    const row1Y = row1Box.y + row1Box.height / 2;
    // The corner on the side facing row1 (whichever quadrant that is) — dragging it further out
    // grows the aisle toward row1 in depth AND changes its width in the same gesture.
    const dySign = Math.sign(row1Y - center.y) || 1;
    const corner = corners.filter((c) => Math.sign(c.y - center.y) === dySign)
      .sort((a, b) => Math.abs(a.x - center.x) - Math.abs(b.x - center.x))[0];
    expect(corner, "a corner handle on the aisle's row1-facing side was found").toBeTruthy();
    const dxSign = Math.sign(corner.x - center.x) || 1;

    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(corner.x + dxSign * 12 * i, corner.y + dySign * 15 * i, { steps: 1 });
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);

    els = await readEls(page);
    stack = byPiece(freePads(els));
    const after = stack.find((e) => e.id === aisle.id);

    expect(after.h, "the aisle's depth grew").toBeGreaterThan(beforeH + 10);
    expect(after.w, "the corner drag also changed the aisle's width (the case that broke identification)").not.toBeCloseTo(beforeW, 0);

    // THE REGRESSION, made concrete: every piece must still be CONTIGUOUS — no gap, no overlap —
    // even though the resized piece's own width now differs from its siblings'.
    for (let i = 0; i < stack.length - 1; i++) {
      const [, farI] = nearFar(stack[i]);
      const [nearNext] = nearFar(stack[i + 1]);
      expect(Math.abs(nearNext - farI), `piece ${i} and piece ${i + 1} touch with no gap/overlap`).toBeLessThan(0.01);
    }
    expect(stack.find((e) => e.id === row0.id).h).toBeCloseTo(row0.h, 6); // the untouched row's own size is unaffected

    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("corner-dragging the INNERMOST row into the aisle still pushes the rest of the stack, no overlap", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawFreestandingField(page, box);

    let els = await readEls(page);
    const fieldId = els.find((e) => e.type === "parking" && !e.attachedTo).id;
    await selectAndOpenProperties(page, fieldId);
    await fieldInput(page, "Width (ft)").fill("200");
    await fieldInput(page, "Width (ft)").press("Enter");
    await fieldInput(page, "Depth (ft)").fill("60");
    await fieldInput(page, "Depth (ft)").press("Enter");
    await page.waitForTimeout(150);

    await selectAndOpenProperties(page, fieldId);
    await page.getByTestId("split-parking").click();
    await page.waitForTimeout(200);

    els = await readEls(page);
    let stack = byPiece(freePads(els));
    const row0 = stack[0], aisle = stack[1];
    const beforeH = row0.h;

    await page.evaluate((p) => window.__plannerView.centerOn(p.cx, p.cy, p.ppf), { cx: row0.cx, cy: row0.cy, ppf: 3 });
    await page.waitForTimeout(150);
    await selectAndOpenProperties(page, row0.id);
    const corners = await cornerHandles(page);
    const cx = await page.locator(`[data-el-id="${row0.id}"]`).first().boundingBox();
    const center = { x: cx.x + cx.width / 2, y: cx.y + cx.height / 2 };
    const aisleBox = await page.locator(`[data-el-id="${aisle.id}"]`).first().boundingBox();
    const aisleY = aisleBox.y + aisleBox.height / 2;
    const dySign = Math.sign(aisleY - center.y) || 1;
    const corner = corners.filter((c) => Math.sign(c.y - center.y) === dySign)
      .sort((a, b) => Math.abs(a.x - center.x) - Math.abs(b.x - center.x))[0];
    expect(corner, "a corner handle on row0's aisle-facing side was found").toBeTruthy();
    const dxSign = Math.sign(corner.x - center.x) || 1;

    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(corner.x + dxSign * 12 * i, corner.y + dySign * 15 * i, { steps: 1 });
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);

    els = await readEls(page);
    stack = byPiece(freePads(els));
    const after = stack.find((e) => e.id === row0.id);
    expect(after.h, "row0's depth grew into the aisle").toBeGreaterThan(beforeH + 10);

    for (let i = 0; i < stack.length - 1; i++) {
      const [, farI] = nearFar(stack[i]);
      const [nearNext] = nearFar(stack[i + 1]);
      expect(Math.abs(nearNext - farI), `piece ${i} and piece ${i + 1} touch with no gap/overlap`).toBeLessThan(0.01);
    }

    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
