/* NEW-1 (B1253248) — "while I'm trying to place stuff... the hover icon changes based on what's
 * behind it, and it happens for a lot of stuff."
 *
 * An active mode owns the cursor and the press until it commits or cancels. Several pieces of
 * SELECTION chrome never got the memo: `selectTool()` (the rail's tool switcher) never clears
 * `sel`/`selParcel` when you pick a placement tool, so a leftover selection from before the switch
 * kept its own manipulation affordances alive — resize/rotate grips, a setback chip, standalone
 * review chrome — showing a "select/manipulate" cursor and, worse, actually intercepting the press
 * a placement tool needed.
 *
 * Every case here is RED on the pre-fix build and GREEN after:
 *   1. handleNodes (SitePlanner.jsx) was missing the `tool !== "select"` guard every sibling
 *      handle group already carries (elPolyHandles / markupHandles / calloutHandles /
 *      measureHandles) — so a selected building's resize/rotate grips stayed live and draggable
 *      under a placement tool. `startResize` / `startRotate` were also missing the tool check
 *      their siblings (`startEdgeResize`, `startRoadEnd`, `startRoadVtx`, …) all have.
 *   2. `setbackChipNodes` had no tool gate at all — a selected parcel's setback chip stayed a
 *      live "click to edit" hotspot during placement.
 *   3. The callout box's idle cursor fell back to "default" instead of "crosshair" outside Select.
 *   4. A mid-draft measurement's `canGrab` didn't exclude the draft itself, so hovering an
 *      EXISTING finished measurement while placing a NEW one still promised a "move" grab that
 *      `startMoveMeasure`'s own mid-draft guard would never honour.
 *   5. The road min-radius warning flag (dot + label) carried no tool gate at all — its
 *      onPointerDown called `e.stopPropagation()` and `setSel(...)` regardless of tool, so a
 *      placement click landing on a flagged corner was swallowed into SELECTING that road
 *      instead of placing anything.
 *
 * Runs LOGGED OUT against a seeded-blank site (ATTEMPT-BEFORE-YOU-PARK: no auth, no live GIS) —
 * except the road-radius-flag case, which drives the owner's real Tsakiris/Concept A plan (the
 * same fixture e2e/road-corner-selffix.spec.js uses) because a non-compliant corner is real
 * project geometry, not something worth hand-authoring.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { startBlank, canvas } from "./drawKinds.js";
import { armPlannerHooks } from "./helpers.js";

const cursorAt = (page, x, y) => page.evaluate(([px, py]) => {
  const el = document.elementFromPoint(px, py);
  return el ? getComputedStyle(el).cursor : null;
}, [x, y]);

const siteRecord = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const id = localStorage.getItem("planarfit:currentSite:v1");
  return map[id] || null;
});

const buildingTool = (page) => page.getByRole("button", { name: /^Building$/ }).first();

async function dragRect(page, x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 6 });
  await page.mouse.up();
}

test.describe("NEW-1 (B1253248) — placement mode owns the cursor and the press", () => {
  test("a leftover selected building's resize/rotate grips do not survive a tool switch", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    // Draw building A. Buildings auto-select on commit and the tool drops back to Select
    // (see e2e/building-reshape.spec.js) — so A is selected with nothing else asked of us.
    const ax0 = box.x + box.width * 0.20, ay0 = box.y + box.height * 0.20;
    const ax1 = box.x + box.width * 0.34, ay1 = box.y + box.height * 0.34;
    await buildingTool(page).click();
    await dragRect(page, ax0, ay0, ax1, ay1);
    await expect.poll(async () => (await siteRecord(page))?.els?.length ?? 0).toBe(1);

    // el-tier: this test is specifically about a BUILDING's own resize/rotate grips, not a
    // census of the plan's contents — the plan holds nothing else, so the one `[data-el-id]` is A.
    const aId = await page.locator("[data-el-id]").first().getAttribute("data-el-id");
    const before = (await siteRecord(page)).els.find((e) => e.id === aId);

    // Read A's REAL rendered resize grip off the DOM (data-handle="corner", added alongside this
    // fix) rather than trusting the drag target survived grid-snap unchanged.
    const gripBox = await page.locator('[data-handle="corner"]').first().boundingBox();
    const corner = { x: Math.round(gripBox.x + gripBox.width / 2), y: Math.round(gripBox.y + gripBox.height / 2) };

    // Setup check: with A selected and the Select tool still active, its corner really is a
    // resize grip. If this fails, the test fixture — not the fix — is wrong.
    const cornerBeforeSwitch = await cursorAt(page, corner.x, corner.y);
    expect(cornerBeforeSwitch, "setup check: A's corner should show a resize cursor before any tool switch").toMatch(/resize/);

    // THE REPORTED CASE: pick a placement tool to draw a SECOND building, without deselecting A.
    await buildingTool(page).click();

    // THE ASSERTION: A's own corner must now read the placement cursor, not a resize affordance.
    const cornerDuringPlacement = await cursorAt(page, corner.x, corner.y);
    expect(cornerDuringPlacement, "A's leftover resize grip must not survive the tool switch").toBe("crosshair");

    // FUNCTIONAL PROOF: drag FROM that exact corner to draw building B. Pre-fix this grabbed A's
    // resize handle — A resized and nothing new was drawn.
    const bx1 = box.x + box.width * 0.62, by1 = box.y + box.height * 0.62;
    await dragRect(page, corner.x, corner.y, bx1, by1);

    await expect.poll(async () => (await siteRecord(page))?.els?.length ?? 0, {
      message: "dragging from A's old corner must draw a new building, not resize A",
    }).toBe(2);
    const after = await siteRecord(page);
    const aAfter = after.els.find((e) => e.id === aId);
    expect(aAfter, "building A must be unchanged — not resized by the placement drag").toMatchObject({
      w: before.w, h: before.h, cx: before.cx, cy: before.cy,
    });

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a leftover selected parcel's setback chip does not survive a tool switch", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    const L = Math.round(box.x + box.width * 0.34), R = Math.round(box.x + box.width * 0.52);
    const T = Math.round(box.y + box.height * 0.72), B = Math.round(box.y + box.height * 0.90);
    // Opens the docked "Land" panel (id "parcel" — see the NEW-1 note at its definition).
    await page.locator('[data-rail-tab="parcel"]').click();
    await page.getByTitle(/Add land to this plan/i).click();
    await page.getByRole("button", { name: /Draw a new boundary/i }).click();
    await expect(page.getByText(/drop boundary points/i)).toBeVisible();
    for (const [x, y] of [[L, T], [R, T], [R, B], [L, B]]) { await page.mouse.click(x, y); await page.waitForTimeout(90); }
    await page.mouse.click(L, T);
    await expect.poll(async () => (await siteRecord(page))?.parcels?.length ?? 0).toBe(1);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Select V$/ }).click();

    // Select the parcel through the Land panel's own row (setSel({kind:"parcel",…}) directly) —
    // the parcel's boundary is otherwise a thin invisible hit-STROKE, not its filled interior, and
    // is drawn LOCKED by default (closePoly), so a canvas click needs sub-pixel accuracy this test
    // has no business depending on. The Land panel is still open from drawing the parcel above.
    const parcelId = (await siteRecord(page)).parcels[0].id;
    const row = page.locator(`[data-testid="parcel-row-${parcelId}"]`);
    await expect(row, "setup check: the Land panel should list the drawn parcel").toBeVisible();
    await row.click();
    await expect.poll(() => page.locator('[data-testid="setback-chip"]').count(), {
      message: "setup check: selecting the parcel should show its setback chip(s)",
    }).toBeGreaterThan(0);
    const chipBox = await page.locator('[data-testid="setback-chip"]').first().boundingBox();
    const chipPoint = { x: Math.round(chipBox.x + chipBox.width / 2), y: Math.round(chipBox.y + chipBox.height / 2) };

    // THE REPORTED CASE: switch to a placement tool without deselecting the parcel.
    await buildingTool(page).click();

    // THE ASSERTION: the chip is gone — not just re-styled, gone — so it can neither claim the
    // cursor nor eat the click a placement tool needs at that point.
    await expect(page.locator('[data-testid="setback-chip"]'), "the setback chip must not survive the tool switch").toHaveCount(0);

    // FUNCTIONAL PROOF: clicking where the chip used to be must not open its numeric editor.
    await page.mouse.click(chipPoint.x, chipPoint.y);
    await expect(page.locator('[data-testid="setback-chip-input"]')).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a callout's idle cursor is the placement crosshair, not a bare arrow, outside Select", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    // Place a callout (Q), commit its text, back to Select (mirrors drawCallout in drawKinds.js).
    await page.keyboard.press("q");
    await page.mouse.click(box.x + box.width * 0.60, box.y + box.height * 0.62);
    const cx = box.x + box.width * 0.72, cy = box.y + box.height * 0.70;
    await page.mouse.click(cx, cy);
    await page.keyboard.type("hover me");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await siteRecord(page))?.callouts?.length ?? 0).toBe(1);

    // THE REPORTED CASE: switch to a placement tool and hover the callout's own box.
    await buildingTool(page).click();
    await page.mouse.move(cx, cy);

    const cursor = await cursorAt(page, cx, cy);
    expect(cursor, "a callout's idle cursor outside Select must be the placement crosshair").toBe("crosshair");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a finished measurement's grab band stops offering \"move\" while a NEW measurement is mid-draft", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    // Draw a first Length measurement, M1 (mirrors drawLengthMeasure in drawKinds.js).
    await page.getByRole("button", { name: "Measure modes" }).click();
    await page.getByRole("button", { name: "Length", exact: true }).click();
    const my = box.y + box.height * 0.62;
    const m1x0 = box.x + box.width * 0.30, m1x1 = box.x + box.width * 0.46;
    await page.mouse.click(m1x0, my);
    await page.mouse.click(m1x1, my);
    await expect.poll(async () => (await siteRecord(page))?.measures?.length ?? 0).toBe(1);
    const m1Before = (await siteRecord(page)).measures[0];
    const m1MidX = Math.round((m1x0 + m1x1) / 2), m1MidY = Math.round(my);

    // THE REPORTED CASE: start a SECOND Length measurement (still in the Measure tool — B910 says
    // that alone should be enough to grab M1 — but this click is MID-DRAFT: the first point of a
    // brand-new measurement is already down).
    await page.getByRole("button", { name: "Measure modes" }).click();
    await page.getByRole("button", { name: "Length", exact: true }).click();
    const startX = box.x + box.width * 0.30, startY = box.y + box.height * 0.80;
    await page.mouse.click(startX, startY);
    await page.mouse.move(m1MidX, m1MidY);

    // THE ASSERTION: hovering M1's own grab band mid-draft must not promise a grab that
    // startMoveMeasure's own guard (measDraft.length > 0 → let the click through) will refuse.
    const cursor = await cursorAt(page, m1MidX, m1MidY);
    expect(cursor, "M1's grab band must not read \"move\" while a new measurement is mid-draft").not.toBe("move");

    // FUNCTIONAL PROOF: the click lands the new measurement's SECOND point at M1's midpoint —
    // M1 itself is untouched, and a second, independent measurement now exists.
    await page.mouse.click(m1MidX, m1MidY);
    await expect.poll(async () => (await siteRecord(page))?.measures?.length ?? 0).toBe(2);
    const after = await siteRecord(page);
    const m1After = after.measures.find((m) => m.id === m1Before.id);
    expect(m1After.pts, "M1 must be untouched by the click meant for the new measurement").toEqual(m1Before.pts);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the road min-radius flag does not claim the cursor or the press while placing", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/tsakiris-concept-a-live.json", import.meta.url), "utf8"));
    const SITE_ID = "e2e-tsakiris-radius-flag";
    await armPlannerHooks(page);
    await page.addInitScript(([id, rec]) => {
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
      localStorage.setItem("planarfit:currentSite:v1", id);
    }, [SITE_ID, {
      id: SITE_ID, groupId: SITE_ID, site: "Tsakiris", name: "Concept A", origin: null, county: "waller",
      parcels: [], els: FIXTURE.els, measures: [], callouts: [], markups: [], settings: {},
      underlay: null, parcelDrawings: [], updatedAt: Date.now(),
    }]);
    // A bare "/" lands on the Dashboard unless a "last route" pointer says otherwise (see
    // src/app/lastRoute.js) — go straight to the seeded project's Site route instead.
    await page.goto(`/#/project/${SITE_ID}/site`);
    await expect(canvas(page)).toBeVisible();
    await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20_000 });

    // The known non-compliant corner on the owner's real Tsakiris/Concept A plan (same spot
    // ui-audit/verify-corner-selffix.mjs drives) — zoom to it so its flag is on screen. The initial
    // boot-fit view settles asynchronously (B1191456's own recent fix touched exactly this), so
    // wait for it BEFORE imposing our own view, then poll the dot's box until it stops moving
    // rather than trusting one timed read.
    const ROAD_ID = "e1454682splyoj";
    await page.waitForTimeout(700);
    await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [-216, 450, 2.0]);

    const flag = page.locator(`[data-road-radius-flag^="${ROAD_ID}:"]`).first();
    await expect(flag, "setup check: the owner's known non-compliant corner should still flag").toBeVisible({ timeout: 10_000 });
    const dot = flag.locator("circle").first();
    const stableDotPoint = async () => {
      let last = null;
      for (let i = 0; i < 20; i++) {
        const b = await dot.boundingBox();
        const p = b ? { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) } : null;
        if (p && last && p.x === last.x && p.y === last.y) return p;
        last = p;
        await page.waitForTimeout(100);
      }
      return last;
    };
    const dotPoint = await stableDotPoint();

    // Setup check: in Select, the dot really does claim a "pointer" cursor.
    const cursorInSelect = await cursorAt(page, dotPoint.x, dotPoint.y);
    expect(cursorInSelect, "setup check: the flag dot should read \"pointer\" in Select").toBe("pointer");

    // THE REPORTED CASE: pick a placement tool and hover/click the flagged corner. Re-read the
    // dot's position fresh (a tool switch can shift chrome) rather than trusting the pre-switch read.
    await buildingTool(page).click();
    const dotPointWhilePlacing = await stableDotPoint();
    expect(dotPointWhilePlacing, "the flag dot must not move off screen when entering a placement tool").not.toBeNull();

    const cursorWhilePlacing = await cursorAt(page, dotPointWhilePlacing.x, dotPointWhilePlacing.y);
    expect(cursorWhilePlacing, "the road-radius flag must not claim the cursor while placing").toBe("crosshair");

    // FUNCTIONAL PROOF: a drag starting exactly on the flag dot must draw a NEW building, not
    // select the flagged road (pre-fix: onPointerDown stopped propagation and called setSel
    // unconditionally). The real Tsakiris plan already carries its own buildings, so compare
    // against the count BEFORE the drag rather than assuming a fresh count of one.
    const buildingCount = async () => {
      const rec = await page.evaluate((id) => {
        const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
        return m[id];
      }, SITE_ID);
      return (rec.els || []).filter((e) => e.type === "building").length;
    };
    const buildingsBefore = await buildingCount();
    // A fixed, generous offset from the dot — NOT the canvas centre, which this test deliberately
    // framed the view on and so can sit only a few px from the dot itself, too short a drag for a
    // real rectangle to commit.
    const farX = dotPointWhilePlacing.x + 220, farY = dotPointWhilePlacing.y + 180;
    await page.mouse.move(dotPointWhilePlacing.x, dotPointWhilePlacing.y);
    await page.mouse.down();
    await page.mouse.move(dotPointWhilePlacing.x + 60, dotPointWhilePlacing.y + 50, { steps: 4 });
    await page.mouse.move(farX, farY, { steps: 6 });
    await page.mouse.up();
    await expect.poll(buildingCount, {
      message: "dragging from the flag dot must place a NEW building, not select the flagged road",
    }).toBe(buildingsBefore + 1);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
