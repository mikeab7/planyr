/* NEW-1 / NEW-2 (2026-10-21) — the Overlays panel's ROTATION DIAL and CROP SWITCH, on the REAL panel.
 *
 * What a unit test cannot say: that a real pointer drag on the dial turns the real overlay, that one drag is one
 * Ctrl+Z, that ▲/▼, typing and both 90° buttons each write the right rotation, that the crop switch shows the
 * whole sheet when off and the SAME polygon when switched back on — and that every one of those works on a
 * LOCKED overlay (owner constraint #24). Runs logged out on a locally-seeded fixture plan (never a real plan),
 * no GIS, no network. Each arm runs for an unlocked AND a locked overlay.
 *
 * The overlay is a drawn sketch (an SVG data URL), so the crop picture in the screenshots shows a real shape.
 * Set SHOTS=<dir> to write the panel screenshots (narrow + wide, crop off + on) used in the PR.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const W = 1000, H = 700;
const SKETCH = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>` +
  `<rect width='${W}' height='${H}' fill='#f4efe2'/><rect x='30' y='30' width='940' height='640' fill='none' stroke='#333' stroke-width='6'/>` +
  `<rect x='130' y='110' width='520' height='260' fill='#9fb8d4' stroke='#234' stroke-width='5'/>` +
  `<rect x='690' y='150' width='230' height='380' fill='#c9d9a8' stroke='#342' stroke-width='5'/>` +
  `<circle cx='300' cy='520' r='90' fill='#d9b38c' stroke='#432' stroke-width='5'/>` +
  `<text x='60' y='90' font-size='54' font-family='sans-serif' fill='#222'>SITE PLAN</text></svg>`);

const siteFor = (id, locked, crop) => ({
  schemaVersion: 12, id, groupId: id, site: "Dial Crop Fixture", name: "Dial Crop Fixture", updatedAt: 1783000000000,
  teamId: null, ownerId: null, scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: 40.348437, lon: -104.981121 }, county: "Weld", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 700 }, { x: 0, y: 700 }], active: true, z: 0 }],
  sheetOverlays: [{ id: "ov1", name: "Fixture sheet.png", src: SKETCH, x: 100, y: 100, imgW: W, imgH: H, ftPerPx: 0.5, rotation: 0, opacity: 0.85, locked, visible: true, ...(crop ? { crop } : {}) }],
  underlay: null, parcelDrawings: [], settings: {}, els: [],
});

async function openPlan(page, { locked, crop = null, vw = 1440, vh = 900, leftWidth } = {}) {
  const id = `dialcrop-${locked ? "locked" : "free"}${crop ? "-c" : ""}`;
  await armPlannerHooks(page);
  await page.setViewportSize({ width: vw, height: vh });
  await page.addInitScript(({ s, id, leftWidth }) => {
    try {
      localStorage.setItem("planarfit:sites:v1", s); localStorage.setItem("planarfit:currentSite:v1", id);
      if (leftWidth) localStorage.setItem("planarfit:leftWidth", String(leftWidth));
    } catch (_) {}
  }, { s: JSON.stringify({ [id]: siteFor(id, locked, crop) }), id, leftWidth });
  await page.goto(`/#/project/${id}/site`, { waitUntil: "load" });
  await page.locator('[data-testid="planner-canvas"]').first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(900);
  await page.locator('[data-rail-tab="references"]').first().click();
  await page.waitForTimeout(700);
  const row = page.locator('[data-testid="reference-open-ov1"]');
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await expect(page.locator('[data-testid="overlay-rot-dial"]')).toBeVisible({ timeout: 10000 });
  return id;
}

/** The overlay's rotation as the CANVAS draws it (the <g transform="rotate(deg …)">) and as the panel reads it back. */
const canvasRotation = (page) => page.evaluate(() => {
  const g = document.querySelector('[data-feature="reference:ov1"]');
  const m = g && /rotate\(([-\d.]+)/.exec(g.getAttribute("transform") || "");
  return m ? Number(m[1]) : 0;
});
const boxRotation = async (page) => Number(await page.locator('[data-testid="overlay-rotation"]').inputValue());
const storedOverlay = (page, id) => page.evaluate((id) => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const direct = map[id];
  if (direct) return (direct.sheetOverlays || [])[0] || null;
  for (const k of Object.keys(map)) if (map[k] && map[k].id === id) return (map[k].sheetOverlays || [])[0] || null;
  return null;
}, id);
const settle = (page) => page.waitForTimeout(350);
/** The autosave mirror is debounced — poll the stored record instead of sleeping. */
const stored = (page, id, pred) => expect.poll(async () => { const o = await storedOverlay(page, id); return !!(o && pred(o)); }, { timeout: 8000 }).toBe(true);
const near = (a, b, tol = 0.11) => Math.abs(((a - b + 540) % 360) - 180) <= tol;

/** Screen point at `deg` (0 = up, clockwise) and `r` px from the dial's centre. */
async function dialPoint(page, deg, r = 24) {
  const b = await page.locator('[data-testid="overlay-rot-dial"]').boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2, a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a), cx, cy };
}

for (const locked of [false, true]) {
  const tag = locked ? "LOCKED overlay" : "unlocked overlay";

  test.describe(`rotation dial — ${tag}`, () => {
    test("dragging the needle turns the overlay live, and the whole drag is ONE Ctrl+Z", async ({ page }) => {
      const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
      await openPlan(page, { locked });
      expect(await boxRotation(page)).toBe(0);
      // press at 0° (straight up), sweep clockwise through 90° to 180°, release
      const p0 = await dialPoint(page, 0, 9);   // press INSIDE the dial; the move may then go anywhere (pointer capture)
      await page.mouse.move(p0.x, p0.y); await page.mouse.down();
      const seen = [];
      for (const deg of [20, 45, 90, 135, 180]) {
        const p = await dialPoint(page, deg);
        await page.mouse.move(p.x, p.y, { steps: 3 });
        await page.waitForTimeout(60);
        seen.push([deg, await boxRotation(page), await canvasRotation(page)]);
      }
      await page.mouse.up(); await settle(page);
      for (const [want, box, cv] of seen) {
        expect(near(box, want, 1.5), `box ${box} vs dial ${want}`).toBe(true);   // the live value follows the pointer (to the pixel's angle)
        expect(near(cv, box, 0.05), `canvas ${cv} vs box ${box}`).toBe(true);    // …and the canvas draws the same angle
      }
      const end = await boxRotation(page);
      expect(near(end, 180, 1.5)).toBe(true);
      expect(Math.round(end * 10) / 10, "rounded to 0.1°").toBe(end);
      // the needle points where the number says
      const needle = await page.evaluate(() => {
        const n = document.querySelector('[data-testid="overlay-rot-needle"]');
        return { x2: +n.getAttribute("x2"), y2: +n.getAttribute("y2") };
      });
      expect(needle.y2, "needle points down at ~180°").toBeGreaterThan(20);
      // ONE undo step for the whole sweep
      await page.keyboard.press("Control+z"); await settle(page);
      expect(await boxRotation(page), "one Ctrl+Z undoes the entire drag").toBe(0);
      expect(await canvasRotation(page)).toBe(0);
      expect(errors, errors.join("\n")).toEqual([]);
    });

    test("Shift snaps to 15° steps, and a drag across 0/360 wraps", async ({ page }) => {
      await openPlan(page, { locked });
      const p0 = await dialPoint(page, 0, 9);
      await page.mouse.move(p0.x, p0.y); await page.keyboard.down("Shift"); await page.mouse.down();
      const p = await dialPoint(page, 100);
      await page.mouse.move(p.x, p.y, { steps: 4 }); await page.waitForTimeout(60);
      expect(await boxRotation(page), "100° with Shift lands on 105°").toBe(105);
      await page.mouse.up(); await page.keyboard.up("Shift"); await settle(page);
      expect(near(await canvasRotation(page), 105, 0.01)).toBe(true);
      // now a free drag from 350° round to 10°: wraps through 0, never stores 360
      const a = await dialPoint(page, 350, 9);
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      const b = await dialPoint(page, 10);
      await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(); await settle(page);
      const r = await boxRotation(page);
      expect(r >= 0 && r < 360 && near(r, 10, 1.5), `wrapped to ${r}`).toBe(true);
    });

    test("▲ / ▼ step ±1°, typing sets an exact value, both 90° buttons turn the sheet", async ({ page }) => {
      await openPlan(page, { locked });
      await page.getByRole("button", { name: "Increase rotation 1 degree" }).click(); await settle(page);
      expect(await boxRotation(page)).toBe(1);
      expect(await canvasRotation(page)).toBe(1);
      await page.getByRole("button", { name: "Decrease rotation 1 degree" }).click();
      await page.getByRole("button", { name: "Decrease rotation 1 degree" }).click(); await settle(page);
      expect(await boxRotation(page), "0 − 1 wraps to 359").toBe(359);
      const box = page.locator('[data-testid="overlay-rotation"]');
      await box.fill("45"); await box.press("Enter"); await settle(page);
      expect(await boxRotation(page)).toBe(45); expect(await canvasRotation(page)).toBe(45);
      await box.fill("200"); await box.press("Escape"); await settle(page);
      expect(await boxRotation(page), "Esc reverts a half-typed value").toBe(45);
      await page.getByRole("button", { name: "Turn 90° clockwise" }).click(); await settle(page);
      expect(await boxRotation(page)).toBe(135);
      await page.getByRole("button", { name: "Turn 90° counterclockwise" }).click();
      await page.getByRole("button", { name: "Turn 90° counterclockwise" }).click(); await settle(page);
      expect(await boxRotation(page)).toBe(315);
      expect(near(await canvasRotation(page), 315, 0.01)).toBe(true);
      await stored(page, "dialcrop-" + (locked ? "locked" : "free"), (o) => o.rotation === 315 && !!o.locked === locked);   // saved, and the lock untouched by any of it
    });

    test("the dial is a keyboard slider: arrows ±1°, Shift ±15°, aria tracks the value", async ({ page }) => {
      await openPlan(page, { locked });
      const dial = page.locator('[data-testid="overlay-rot-dial"]');
      await expect(dial).toHaveAttribute("role", "slider");
      await expect(dial).toHaveAttribute("aria-label", "Rotation dial");
      await expect(dial).toHaveAttribute("aria-valuemin", "0"); await expect(dial).toHaveAttribute("aria-valuemax", "360");
      await dial.focus();
      await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowUp"); await settle(page);
      expect(await boxRotation(page)).toBe(2);
      await expect(dial).toHaveAttribute("aria-valuenow", "2");
      await page.keyboard.press("Shift+ArrowLeft"); await settle(page);
      expect(await boxRotation(page), "2 − 15 wraps to 347").toBe(347);
      await page.keyboard.press("ArrowDown"); await settle(page);
      expect(await boxRotation(page)).toBe(346);
      await expect(dial).toHaveAttribute("aria-valuenow", "346");
    });
  });

  test.describe(`crop switch — ${tag}`, () => {
    const clipPresent = (page) => page.evaluate(() => !!document.querySelector('clipPath[id="ov-crop-ov1"]'));
    const sw = (page) => page.locator('[data-testid="overlay-crop-switch-ov1"]');
    const drawTriangle = async (page) => {
      const dlg = page.locator('[data-testid="overlay-crop-dialog"]');
      await dlg.locator("button", { hasText: "Polygon" }).click(); await page.waitForTimeout(250);
      const b = await dlg.locator("img").first().boundingBox();
      const at = (fx, fy) => ({ x: b.x + fx * b.width, y: b.y + fy * b.height });
      for (const [fx, fy] of [[0.12, 0.15], [0.88, 0.2], [0.55, 0.9]]) { const p = at(fx, fy); await page.mouse.click(p.x, p.y); await page.waitForTimeout(300); }
      const c = at(0.12, 0.15); await page.mouse.click(c.x, c.y); await page.waitForTimeout(250);   // close on the first vertex
      await dlg.locator("button", { hasText: "Done" }).click(); await page.waitForTimeout(500);
    };

    test("off shows only the heading; ON with no shape opens the editor; closing it leaves the switch off", async ({ page }) => {
      const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
      await openPlan(page, { locked });
      await expect(sw(page)).toHaveAttribute("role", "switch");
      await expect(sw(page)).toHaveAttribute("aria-label", "Crop");
      await expect(sw(page)).toHaveAttribute("aria-checked", "false");
      await expect(page.locator('[data-testid="overlay-crop-body"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="overlay-crop-open"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="overlay-crop-reset"]')).toHaveCount(0);
      await expect(sw(page)).toBeEnabled();                   // Edit crop stays available on a locked overlay
      await sw(page).click();
      await expect(page.locator('[data-testid="overlay-crop-dialog"]')).toBeVisible();
      await page.locator('[data-testid="crop-cancel"]').click(); await page.waitForTimeout(400);
      await expect(page.locator('[data-testid="overlay-crop-dialog"]')).toHaveCount(0);
      await expect(sw(page)).toHaveAttribute("aria-checked", "false");
      expect(await clipPresent(page)).toBe(false);
      expect(errors, errors.join("\n")).toEqual([]);
    });

    test("draw a polygon → switch off (whole sheet, shape kept) → switch on (the same polygon); each flip is one undo step", async ({ page }) => {
      const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
      const id = await openPlan(page, { locked });
      await sw(page).click();
      await expect(page.locator('[data-testid="overlay-crop-dialog"]')).toBeVisible();
      await drawTriangle(page);
      await expect(sw(page)).toHaveAttribute("aria-checked", "true");
      await expect(page.locator('[data-testid="overlay-crop-picture-ov1"]')).toBeVisible();
      await expect(page.locator('[data-testid="overlay-crop-open"]')).toHaveText("Adjust");
      await expect(page.locator('[data-testid="overlay-crop-outline"]')).toBeVisible();
      expect(await clipPresent(page)).toBe(true);
      await stored(page, id, (o) => o.crop && o.crop.kind === "poly");
      const drawn = (await storedOverlay(page, id)).crop;
      expect(drawn.pts.length).toBe(3);
      const pointsOn = await page.evaluate(() => document.querySelector('clipPath[id="ov-crop-ov1"] polygon').getAttribute("points"));

      // OFF — the whole sheet, the shape is KEPT
      await sw(page).click(); await settle(page);
      await expect(sw(page)).toHaveAttribute("aria-checked", "false");
      await expect(page.locator('[data-testid="overlay-crop-body"]')).toHaveCount(0);
      expect(await clipPresent(page), "no clip while off — the whole sheet draws").toBe(false);
      await stored(page, id, (o) => o.crop && o.crop.off === true);
      const kept = (await storedOverlay(page, id)).crop;
      expect(kept.pts).toEqual(drawn.pts);

      // the print/PDF clone shows the whole sheet while off (it copies the live SVG)
      const offSheet = await page.evaluate(() => window.__plannerExportSvg());
      expect(/ov-crop-ov1/.test(offSheet), "export clone has no crop clip while off").toBe(false);

      // ON again — the exact same polygon
      await sw(page).click(); await settle(page);
      await expect(sw(page)).toHaveAttribute("aria-checked", "true");
      expect(await clipPresent(page)).toBe(true);
      expect(await page.evaluate(() => document.querySelector('clipPath[id="ov-crop-ov1"] polygon').getAttribute("points"))).toBe(pointsOn);
      await stored(page, id, (o) => o.crop && !("off" in o.crop));
      const back = (await storedOverlay(page, id)).crop;
      expect(back).toEqual(drawn);
      expect("off" in back).toBe(false);
      const onSheet = await page.evaluate(() => window.__plannerExportSvg());
      expect(/ov-crop-ov1/.test(onSheet), "export clone carries the crop clip when on").toBe(true);

      // each flip is ONE undo step: off, then Ctrl+Z → back on
      await sw(page).click(); await settle(page);
      await expect(sw(page)).toHaveAttribute("aria-checked", "false");
      await sw(page).focus(); await page.keyboard.press("Control+z"); await settle(page);
      await expect(sw(page)).toHaveAttribute("aria-checked", "true");
      expect(errors, errors.join("\n")).toEqual([]);
    });

    test("a saved-OFF crop survives a reload as off, and the picture / Adjust open the editor", async ({ page }) => {
      const crop = { kind: "poly", pts: [[150, 100], [850, 140], [800, 600], [200, 560]], off: true };
      await openPlan(page, { locked, crop });
      await expect(sw(page)).toHaveAttribute("aria-checked", "false");
      expect(await clipPresent(page)).toBe(false);
      await sw(page).click(); await settle(page);                 // a kept shape → straight back on, NO editor
      await expect(page.locator('[data-testid="overlay-crop-dialog"]')).toHaveCount(0);
      await expect(sw(page)).toHaveAttribute("aria-checked", "true");
      expect(await clipPresent(page)).toBe(true);
      await page.locator('[aria-label="Adjust the crop"]').click();
      await expect(page.locator('[data-testid="overlay-crop-dialog"]')).toBeVisible();
      await page.locator('[data-testid="crop-cancel"]').click(); await page.waitForTimeout(300);
      await page.locator('[data-testid="overlay-crop-open"]').click();
      await expect(page.locator('[data-testid="overlay-crop-dialog"]')).toBeVisible();
      await page.locator('[data-testid="crop-cancel"]').click();
    });
  });
}

/* Screenshots for the PR: narrowest and widest panel, crop off and on. Only when SHOTS=<dir>. */
test.describe("panel screenshots", () => {
  test.skip(!process.env.SHOTS, "set SHOTS=<dir> to write the PR screenshots");
  const crop = { kind: "poly", pts: [[150, 100], [850, 140], [800, 600], [200, 560]] };
  for (const [name, leftWidth] of [["narrowest", 240], ["widest", 620]]) {
    for (const withCrop of [false, true]) {
      test(`${name} panel, crop ${withCrop ? "on" : "off"}`, async ({ page }) => {
        await openPlan(page, { locked: false, crop: withCrop ? crop : null, vw: 1600, vh: 1000, leftWidth });
        const dial = page.locator('[data-testid="overlay-rot-dial"]');
        await dial.focus();
        for (let i = 0; i < 33; i++) await page.keyboard.press("ArrowRight");   // a 33° needle so the picture shows an angle
        await settle(page);
        const panel = page.locator('[data-testid="overlays-panel"]');
        await panel.scrollIntoViewIfNeeded();
        await panel.screenshot({ path: `${process.env.SHOTS}/overlays-${name}-crop-${withCrop ? "on" : "off"}.png` });
      });
    }
  }
});
