/* NEW-1 — "Select parcels: off" must never strand the user again.
 *
 * Live repro (owner's plan `smrjdgmlinea`): `settings.parcelSelect` was saved false, so B311's
 * click-through branch let every press on a lot fall through to a background pan — silently. The
 * owner clicked his parcels, nothing happened, and nothing at the point of interaction said why.
 *
 * This drives the REAL render path, logged out, on a seeded-blank site with one drawn parcel (no
 * account, no external GIS), and asserts what the owner actually experiences:
 *   • with selection OFF, a press on the boundary raises the hint, does NOT select, does NOT move
 *     the lot — the B311 click-through pan itself is untouched;
 *   • a press on empty canvas stays silent;
 *   • repeat presses inside the cooldown don't stack hints;
 *   • the hint's inline "Turn it on" restores selection, and the SAME boundary then selects;
 *   • the header pill is a real toggle (aria-pressed, keyboard-operable) that flips + persists.
 * Run at desktop and narrow width, in both light and dark theme.
 */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const toggle = (p) => p.getByTestId("parcel-select-toggle");
const hint = (p) => p.getByTestId("parcel-select-hint");
// Edge-length labels render ONLY for the currently-selected parcel — the app's own "is a parcel
// selected?" signal, with no synthetic state poked in.
const selectedParcelMarks = (p) => p.getByTestId("parcel-edge-dim");

const site = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return map[Object.keys(map)[0]] || {};
});
const parcelCount = async (page) => ((await site(page)).parcels || []).length;
const parcelPoints = async (page) => JSON.stringify(((await site(page)).parcels || [])[0]?.points || []);
const savedParcelSelect = async (page) => (await site(page)).settings?.parcelSelect;

/* Boot a blank plan. The parcel is always DRAWN at desktop width — the narrow layout collapses the
 * tool rail behind a "✎ Tools" flyout and floats the boundary-draw panel over the canvas, which
 * makes authoring a ring there a test of the draw affordances rather than of this fix. The viewport
 * is switched to the case's width AFTER the lot exists, so what each case actually exercises is the
 * toggle + hint at that width and theme. */
async function startBlank(page, { theme }) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((t) => { try { localStorage.setItem("planyr.theme", t); } catch { /* ignore */ } }, theme);
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

async function drawParcel(page) {
  const box = await canvas(page).boundingBox();
  await page.locator('[data-rail-tab="parcel"]').click();
  await page.getByTitle(/Add land to this plan/i).click();
  await page.getByRole("button", { name: /Draw a new boundary/i }).click();
  await expect(page.getByText(/drop boundary points/i)).toBeVisible(); // the tool is armed before we click
  const L = Math.round(box.x + box.width * 0.32), R = Math.round(box.x + box.width * 0.68);
  const T = Math.round(box.y + box.height * 0.28), B = Math.round(box.y + box.height * 0.68);
  for (const [x, y] of [[L, T], [R, T], [R, B], [L, B]]) { await page.mouse.click(x, y); await page.waitForTimeout(90); }
  await page.mouse.click(L, T); // close the ring
  await expect.poll(() => parcelCount(page)).toBe(1);
  // Leave the Parcel tool for Select — startMoveParcel only runs under the Select tool, and Escape
  // alone leaves the boundary-draw mode armed.
  await page.keyboard.press("Escape");
  const selectTool = page.getByRole("button", { name: /^Select V$/ });
  await selectTool.click();
  await expect(selectTool).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("parcel-outline")).toBeVisible();
}

/* Collapse whatever left panel the Parcel tool left open. On desktop it docks beside the canvas
 * and is harmless; at narrow width it floats OVER the canvas, so the lot would be behind it. Done
 * the way a user does it — re-clicking the lit rail tab. */
async function closeLeftPanel(page) {
  await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="left-menu-panel"]');
    const lit = panel && panel.previousElementSibling && panel.previousElementSibling.querySelector('button[aria-pressed="true"]');
    if (lit) lit.click();
  });
  await expect(page.getByTestId("left-menu-panel")).toHaveCount(0);
}

/* Client coords of (a) a point ON the parcel's top boundary — the hit-stroke a press must land on —
 * and (b) a point on genuinely empty canvas. Both are read off the RENDERED outline at the CURRENT
 * viewport, so a resize or a post-draw fit can't move the target out from under the press. */
async function pressPoints(page) {
  const box = await canvas(page).boundingBox();
  const ob = await page.getByTestId("parcel-outline").first().boundingBox();
  // The grab target is the transparent fat hit-stroke ON the ring (the visible outline is
  // pointer-inert, B420). Take the mid-span of its first edge in SVG user units and project it to
  // client px through the live screen matrix — exact at any zoom, width or device pixel ratio, and
  // then CONFIRMED by asking the document what is actually under that point.
  // Narrow layouts float View / Layers / zoom controls over the canvas, so the first edge's
  // midpoint may sit under one — walk every edge at several fractions until a point is genuinely
  // topmost.
  const onBoundary = await page.evaluate(() => {
    const outline = document.querySelector('[data-testid="parcel-outline"]');
    const hit = outline && outline.parentElement.querySelector('polygon[pointer-events="stroke"]');
    if (!hit || hit.points.numberOfItems < 2) return null;
    const n = hit.points.numberOfItems, ctm = hit.getScreenCTM();
    for (let i = 0; i < n; i++) {
      const a = hit.points.getItem(i), b = hit.points.getItem((i + 1) % n);
      for (const t of [0.5, 0.35, 0.65, 0.25, 0.75]) {
        const p = hit.ownerSVGElement.createSVGPoint();
        p.x = a.x + (b.x - a.x) * t; p.y = a.y + (b.y - a.y) * t;
        const s = p.matrixTransform(ctm);
        const pt = { x: Math.round(s.x), y: Math.round(s.y) };
        if (document.elementsFromPoint(pt.x, pt.y)[0] === hit) return pt;
      }
    }
    return null;
  });
  expect(onBoundary, "the parcel's boundary hit-stroke is not reachable at this viewport").not.toBeNull();
  // A genuinely empty spot: scan the gap between the canvas edge and the parcel for a point whose
  // topmost element IS the canvas itself — no lot, no rail, no floating control.
  const empty = await page.evaluate(([bx, by, bw, bh, ox, oy, ow, oh]) => {
    const clear = (px, py) => {
      const el = document.elementsFromPoint(px, py)[0];
      return !!el && el.tagName.toLowerCase() === "svg" && el.getAttribute("data-testid") === "planner-canvas";
    };
    const inParcel = (px, py) => px > ox - 16 && px < ox + ow + 16 && py > oy - 16 && py < oy + oh + 16;
    for (let py = Math.round(by + bh * 0.2); py < by + bh * 0.9; py += 12) {
      for (let px = Math.round(bx + 8); px < bx + bw - 8; px += 12) {
        if (!inParcel(px, py) && clear(px, py)) return { x: px, y: py };
      }
    }
    return null;
  }, [box.x, box.y, box.width, box.height, ob.x, ob.y, ob.width, ob.height]);
  expect(empty, "no empty canvas point found outside the parcel").not.toBeNull();
  return { onBoundary, emptyCanvas: empty };
}

const cases = [
  { name: "desktop · light", theme: "light", width: 1440, height: 900 },
  { name: "desktop · dark", theme: "dark", width: 1440, height: 900 },
  { name: "narrow · light", theme: "light", width: 430, height: 880 },
  { name: "narrow · dark", theme: "dark", width: 430, height: 880 },
];

test.describe('"Select parcels: off" gives feedback at the point of failure (logged out)', () => {
  for (const c of cases) {
    test(`${c.name} — blocked press hints once, never selects or moves; the hint's action restores selection`, async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await startBlank(page, c);
      await drawParcel(page);
      await closeLeftPanel(page);
      await page.setViewportSize({ width: c.width, height: c.height });
      await expect(page.getByTestId("parcel-outline")).toBeVisible();
      await page.getByRole("button", { name: "Zoom to fit" }).last().click(); // the lot is fully on screen at this width
      await page.waitForTimeout(250);
      const { onBoundary, emptyCanvas } = await pressPoints(page);

      // The toggle is a real, reachable control that reports its state (default ON).
      await toggle(page).scrollIntoViewIfNeeded();
      await expect(toggle(page)).toBeVisible();
      await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
      await expect(toggle(page)).toContainText("Select parcels: on");

      // Turn selection OFF from the header pill — and it persists into the saved plan (the trap:
      // this is what silently followed the owner across sessions and devices).
      await toggle(page).click();
      await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
      await expect(toggle(page)).toContainText("Select parcels: off");
      await expect.poll(() => savedParcelSelect(page)).toBe(false);

      await page.keyboard.press("Escape"); // drop any selection left over from drawing
      await expect(selectedParcelMarks(page)).toHaveCount(0);
      const before = await parcelPoints(page);

      // (a) A press on EMPTY canvas is silent — this must never fire on a background pan.
      await page.mouse.click(emptyCanvas.x, emptyCanvas.y);
      await expect(hint(page)).toHaveCount(0);

      // (b) A press that actually lands on the boundary hit-stroke: the hint appears, the parcel is
      // NOT selected, and its geometry is untouched. The B311 click-through pan itself is intact —
      // that is the whole point of the mode; only the silence is gone.
      await page.mouse.click(onBoundary.x, onBoundary.y);
      await expect(hint(page)).toBeVisible();
      await expect(hint(page)).toContainText(/Parcel selection is off/i);
      await expect(selectedParcelMarks(page)).toHaveCount(0);
      expect(await parcelPoints(page)).toBe(before);

      // (c) Impatient repeat clicking does not stack hints — exactly one is on screen.
      await page.mouse.click(onBoundary.x, onBoundary.y);
      await page.mouse.click(onBoundary.x, onBoundary.y);
      await expect(hint(page)).toHaveCount(1);

      // (d) The inline action fixes it right where the click failed: selection comes back on, the
      // hint clears, and the SAME boundary point now selects the lot.
      await page.getByTestId("parcel-select-hint-on").click();
      await expect(hint(page)).toHaveCount(0);
      await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => savedParcelSelect(page)).toBe(true);

      await page.mouse.click(onBoundary.x, onBoundary.y);
      await expect(selectedParcelMarks(page).first()).toBeVisible();
      expect(await parcelPoints(page)).toBe(before); // a click selects; it never nudges the lot

      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  test("the header toggle is keyboard-operable — focus it and press Enter", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page, { theme: "light" });
    await drawParcel(page);

    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await toggle(page).focus();
    await expect(toggle(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => savedParcelSelect(page)).toBe(false);
    await page.keyboard.press("Enter");
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
