/* Opening a left-rail panel must not SQUISH the drawing for a frame (B962).
 *
 * Owner report: "when I click on an element and then click on Yield, the screen flashes."
 * Root cause traced in code + confirmed headless per-animation-frame:
 *
 *   The SVG canvas is `width:100% viewBox="0 0 size.w size.h"`. When a docked panel opens it steals
 *   width from the in-flow canvas, so the SVG element shrinks IMMEDIATELY (flex layout). But `size.w`
 *   — which drives the viewBox width — is fed only by a ResizeObserver, which reports the new width one
 *   frame LATER. For that one frame the OLD (wider) viewBox renders into the freshly-narrowed element,
 *   so the whole drawing scales down horizontally (ratio clientWidth/viewBoxW ≈ 0.69) and snaps back the
 *   next frame — the visible "flash". (It happens on ANY panel open/switch; the owner just had an element
 *   selected.) The sibling B837 spec measures only AFTER a 500ms settle, so it never caught this 1-frame
 *   squish; THIS spec records every animation frame across the transition.
 *
 * B962 syncs `size` synchronously in the same LAYOUT effect that pan-compensates the canvas left-edge,
 * so the viewBox width lands in the SAME commit as the reflow. This spec proves it: across every frame
 * of an element-selected Yield-panel open, the SVG's clientWidth/viewBoxW ratio stays ≈1 (no squish) and
 * a fixed feet point never jumps. Runs LOGGED OUT on a seeded one-parcel site (no account, no network).
 */
import { test, expect } from "@playwright/test";

const SITE = {
  schemaVersion: 12, id: "b962-squish", groupId: "b962-squish",
  site: "B962 Squish Guard", name: "B962 Squish Guard",
  updatedAt: 1783000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: 29.7604, lon: -95.3698 }, county: "Harris", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [],
};

const canvas = (p) => p.locator('[data-testid="planner-canvas"]').first();

test.describe("panel open must not squish the drawing (B962)", () => {
  test("selecting an element then opening Yield keeps the viewBox welded to the canvas width every frame", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));

    await page.goto("/#/site-planner", { waitUntil: "load" });
    await page.getByText("B962 Squish Guard", { exact: false }).first().click();
    await canvas(page).waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(900); // fit-on-load + first commit settle

    // Draw a building so there's a real element to select (matches the owner's flow).
    const box = await canvas(page).boundingBox();
    const bx = box.x + box.width * 0.42, by = box.y + box.height * 0.4;
    await page.getByRole("button", { name: "Building", exact: true }).click();
    await page.mouse.move(bx, by);
    await page.mouse.down();
    await page.mouse.move(bx + 80, by + 60, { steps: 5 });
    await page.mouse.move(bx + 240, by + 170, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Start from the real scenario: every panel CLOSED. Click any active rail tab to close it.
    for (let i = 0; i < 8; i++) {
      const closed = await page.evaluate(() => { const b = document.querySelector('.dbtn[aria-pressed="true"]'); if (b) { b.click(); return false; } return true; });
      if (closed) break;
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(200);
    // Panel really closed (canvas hard against the 54px rail).
    expect(await page.evaluate(() => Math.round(document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect().left))).toBeLessThan(60);

    // Select the building (plain click on its center).
    await page.mouse.click(bx + 120, by + 85);
    await page.waitForTimeout(300);

    // Arm a per-animation-frame recorder of the SVG's clientWidth/viewBoxW ratio + a fixed feet point.
    await page.evaluate(() => {
      window.__f = [];
      const FX = 900; // a fixed feet point (within the parcel)
      let n = 0;
      const tick = () => {
        const svg = document.querySelector('[data-testid="planner-canvas"]');
        if (svg) {
          const offX = parseFloat(svg.getAttribute("data-view-offx"));
          const ppf = parseFloat(svg.getAttribute("data-view-ppf"));
          const vb = svg.getAttribute("viewBox").split(" ").map(Number);
          const r = svg.getBoundingClientRect();
          window.__f.push({ ratio: r.width / vb[2], feetX: r.left + ((FX * ppf + offX) / vb[2]) * r.width });
        }
        if (n++ < 40) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.locator('button[title="Yield"]').first().click();
    await page.waitForTimeout(800);

    const frames = await page.evaluate(() => window.__f);
    expect(frames.length, "frames were recorded").toBeGreaterThan(5);
    const settledX = frames[frames.length - 1].feetX;

    // No frame may squish the drawing (ratio must stay ≈1) or jump the fixed feet point.
    const worstRatio = Math.max(...frames.map((f) => Math.abs(f.ratio - 1)));
    const worstJump = Math.max(...frames.map((f) => Math.abs(f.feetX - settledX)));
    expect(worstRatio, `SVG squished a frame (worst clientWidth/viewBoxW deviation ${worstRatio.toFixed(3)}; pre-B962 ≈0.31)`).toBeLessThan(0.03);
    expect(worstJump, `fixed feet point jumped ${Math.round(worstJump)}px during the open (pre-B962 ≈146px)`).toBeLessThanOrEqual(3);

    // The panel actually opened (guards a trivially-passing no-op).
    expect(await page.evaluate(() => Math.round(document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect().left))).toBeGreaterThan(300);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
