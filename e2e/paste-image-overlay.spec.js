/* NEW-1 — Ctrl+V a clipboard image (a screenshot) onto the planner → a new overlay, through the SAME path
 * as "Add overlay". RED on the pre-change build: nothing listened for `paste`, so zero overlays appeared.
 * Logged-out and local, so Claude-verifiable here; the signed-in cross-plan half is the live V###. */
import { test, expect } from "@playwright/test";
import { canvas, startBlank, selectTool, drawBuilding, plans } from "./drawKinds.js";

const overlays = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return Object.values(map).flatMap((r) => (r && r.sheetOverlays) || []).map((o) => ({
    name: o.name, imgW: o.imgW, imgH: o.imgH, scaled: !!(o.scaleSet || o.scaleMode || o.calibrated), rotation: o.rotation,
  }));
});

/* A real PNG built in-page, delivered as a real ClipboardEvent('paste') with a DataTransfer. */
async function pasteImage(page, target = "body") {
  return page.evaluate(async (target) => {
    const c = document.createElement("canvas"); c.width = 320; c.height = 200;
    const g = c.getContext("2d"); g.fillStyle = "#3b82f6"; g.fillRect(0, 0, 320, 200); g.fillStyle = "#fff"; g.fillRect(20, 20, 100, 60);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer(); dt.items.add(new File([blob], "image.png", { type: "image/png" }));
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    const el = target === "body" ? document.body : document.querySelector(target);
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, target);
}
async function pasteText(page, target = "body") {
  return page.evaluate((target) => {
    const dt = new DataTransfer(); dt.setData("text/plain", "hello");
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    (target === "body" ? document.body : document.querySelector(target)).dispatchEvent(ev);
    return ev.defaultPrevented;
  }, target);
}
async function touchMap(page) {
  const box = await canvas(page).boundingBox();
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9);
  return box;
}

test.describe("NEW-1 paste a clipboard image as an overlay", () => {
  test("image paste on the map → exactly one overlay, named, unscaled; second dedupes; text paste no-ops", async ({ page }) => {
    await startBlank(page);
    await selectTool(page);
    await touchMap(page);
    expect(await pasteText(page)).toBe(false);          // text-only clipboard: silent no-op, not even consumed
    await page.waitForTimeout(300);
    expect(await overlays(page)).toHaveLength(0);

    expect(await pasteImage(page)).toBe(true);
    await expect.poll(() => overlays(page).then((o) => o.length), { timeout: 15_000 }).toBe(1);
    let o = await overlays(page);
    expect(o[0].name).toBe("Pasted image");
    expect([o[0].imgW, o[0].imgH]).toEqual([320, 200]);
    expect(o[0].scaled).toBe(false);

    await pasteImage(page);
    await expect.poll(() => overlays(page).then((x) => x.map((y) => y.name).sort()), { timeout: 15_000 }).toEqual(["Pasted image", "Pasted image 2"]);
    await expect(page.getByText("Pasted image 2").first()).toBeVisible();
  });

  test("paste with focus in a text input does nothing to the plan", async ({ page }) => {
    await startBlank(page);
    await touchMap(page);
    await page.evaluate(() => { const i = document.createElement("input"); i.id = "e2e-paste-input"; i.type = "text"; document.body.appendChild(i); i.focus(); });
    await pasteImage(page, "#e2e-paste-input");
    await page.waitForTimeout(500);
    expect(await overlays(page)).toHaveLength(0);
  });

  test("existing element copy/paste still works with a non-image clipboard", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawBuilding(page, box);
    await selectTool(page);
    await page.mouse.click(box.x + box.width * 0.67, box.y + box.height * 0.36);
    await page.keyboard.press("Control+c");
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.7);
    await page.keyboard.press("Control+v");
    await expect.poll(() => plans(page).then((p) => Object.values(p)[0]?.els), { timeout: 15_000 }).toBeGreaterThan(1);
    expect(await overlays(page)).toHaveLength(0);
  });

  test("a clipboard image wins over a pending element paste (no double-fire)", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawBuilding(page, box);
    await selectTool(page);
    await page.mouse.click(box.x + box.width * 0.67, box.y + box.height * 0.36);
    await page.keyboard.press("Control+c");
    const before = Object.values(await plans(page))[0].els;
    // Real keydown (arms the deferred internal paste) immediately followed by the image paste event.
    await page.evaluate(async () => {
      const c = document.createElement("canvas"); c.width = 50; c.height = 50; c.getContext("2d").fillRect(0, 0, 50, 50);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const dt = new DataTransfer(); dt.items.add(new File([blob], "image.png", { type: "image/png" }));
      // keydown + paste in ONE task, as a browser delivers them (an await between would let the timer run).
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true }));
      document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect.poll(() => overlays(page).then((o) => o.length), { timeout: 15_000 }).toBe(1);
    await page.waitForTimeout(500);
    expect(Object.values(await plans(page))[0].els).toBe(before);
  });
});
