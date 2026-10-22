/* NEW-1 / NEW-2 / NEW-3 (2026-10-22) — the Overlays panel's 90° turns, the removed non-standard-sheet note and the
 * Set-scale Preset | Custom switch, on the REAL panel (logged out, a locally-seeded fixture plan — never a real one).
 *
 *   NEW-1  the two 90° buttons sit on ONE row (never stacked), left-aligned and sized to their text, at the narrowest AND
 *          widest panel; each turns the sheet — on an unlocked AND a locked overlay (owner constraint #24)
 *   NEW-2  a non-standard PDF sheet shows no "Non-standard sheet" note
 *   NEW-3  Set scale opens a Preset | Custom switch; Preset applies a standard scale from a dropdown with no Custom entry;
 *          Custom is ONE box (`1" = [N] '`) that takes 40, 1" = 40', 1:480, 1/8" = 1'-0" and reverts junk
 *
 * The fixture overlay is an image carrying a `sheet` record (the panel's rule for a PDF-kind overlay), so the sandbox needs no
 * pdf.js. Set SHOTS=<dir> to write the PR screenshots (narrowest + widest: rotation row, Set scale in each mode).
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const W = 1000, H = 700;
const SKETCH = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'><rect width='${W}' height='${H}' fill='#f4efe2'/><rect x='30' y='30' width='940' height='640' fill='none' stroke='#333' stroke-width='6'/><rect x='130' y='110' width='520' height='260' fill='#9fb8d4'/><circle cx='300' cy='520' r='90' fill='#d9b38c'/></svg>`);

const siteFor = (id, locked, ov) => ({
  schemaVersion: 12, id, groupId: id, site: "Turns Scale Fixture", name: "Turns Scale Fixture", updatedAt: 1783000000000,
  teamId: null, ownerId: null, scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: 40.348437, lon: -104.981121 }, county: "Weld", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 700 }, { x: 0, y: 700 }], active: true, z: 0 }],
  sheetOverlays: [{ id: "ov1", name: "Master plan.pdf", src: SKETCH, x: 100, y: 100, imgW: W, imgH: H, ftPerPx: 40 / 72, rotation: 0, opacity: 0.85, locked, visible: true,
    sheet: { std: false, label: "9.1×14.2 in" }, ...ov }],
  underlay: null, parcelDrawings: [], settings: {}, els: [],
});

async function openPlan(page, { locked, ov = {}, leftWidth = 400, vw = 1600, vh = 1000 } = {}) {
  const id = `turns-${locked ? "locked" : "free"}-${leftWidth}`;
  await armPlannerHooks(page);
  await page.setViewportSize({ width: vw, height: vh });
  await page.addInitScript(({ s, id, leftWidth }) => {
    try { localStorage.setItem("planarfit:sites:v1", s); localStorage.setItem("planarfit:currentSite:v1", id); localStorage.setItem("planarfit:leftWidth", String(leftWidth)); } catch (_) {}
  }, { s: JSON.stringify({ [id]: siteFor(id, locked, ov) }), id, leftWidth });
  await page.goto(`/#/project/${id}/site`, { waitUntil: "load" });
  await page.locator('[data-testid="planner-canvas"]').first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(900);
  await page.locator('[data-rail-tab="references"]').first().click();
  await page.waitForTimeout(700);
  const row = page.locator('[data-testid="reference-open-ov1"]');
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await expect(page.locator('[data-testid="overlay-rot-dial"]')).toBeVisible({ timeout: 10000 });
}

const T = (page, id) => page.locator(`[data-testid="${id}"]`);
const boxRotation = async (page) => Number(await T(page, "overlay-rotation").inputValue());
const canvasRotation = (page) => page.evaluate(() => {
  const g = document.querySelector('[data-feature="reference:ov1"]');
  const m = g && /rotate\(([-\d.]+)/.exec(g.getAttribute("transform") || "");
  return m ? Number(m[1]) : 0;
});
const ratio = async (page) => (await T(page, "overlay-scale-ratio").innerText()).replace(/\s+/g, " ").trim();
const ftPerInch = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  for (const k of Object.keys(map)) { const o = ((map[k] || {}).sheetOverlays || [])[0]; if (o) return o.ftPerPx * 72; }
  return null;
});
const fpiNear = (page, want) => expect.poll(async () => Math.abs((await ftPerInch(page)) - want) < 1e-6, { timeout: 8000 }).toBe(true);

for (const locked of [false, true]) {
  const tag = locked ? "locked" : "unlocked";
  test.describe(`${tag} overlay`, () => {
    for (const [name, leftWidth] of [["narrowest", 240], ["widest", 620]]) {
      test(`NEW-1 · 90° buttons: one row, left-aligned, each turns the sheet (${name} panel)`, async ({ page }) => {
        await openPlan(page, { locked, leftWidth });
        const ccw = T(page, "overlay-rot-ccw90"), cw = T(page, "overlay-rot-cw90"), group = T(page, "overlay-quarter-group");
        const [a, b, g, dial] = await Promise.all([ccw.boundingBox(), cw.boundingBox(), group.boundingBox(), T(page, "overlay-rot-dial").boundingBox()]);
        expect(Math.abs(a.y - b.y), "same row").toBeLessThan(1);
        expect(b.x, "side by side, ccw first").toBeGreaterThan(a.x + a.width - 1);
        expect(a.x - g.x, "left-aligned in the group").toBeLessThan(2);
        expect(a.y, "under the rotation line").toBeGreaterThan(dial.y + dial.height - 4);
        const overshoot = Math.round(b.x + b.width - (g.x + g.width));
        console.log(`[${tag}] ${name}: group ${Math.round(g.width)} wide, label tier "${await group.getAttribute("data-label")}", second button ends ${overshoot} past the group's edge`);
        if (name === "narrowest") {
          // The owner's stated limit: at the narrowest panel even the shortest wording is wider than the row. The buttons stay on ONE
          // row (never stacked) and, rather than be cut off by the panel edge, drop to the two turn arrows (full wording in aria-label/title).
          expect(await group.getAttribute("data-label")).toBe("icons");
          expect(overshoot, "never cut off by the panel edge").toBeLessThanOrEqual(1);
        } else {
          expect(overshoot, "fits inside the group").toBeLessThanOrEqual(1);
          expect(await group.getAttribute("data-label")).toBe("full");
          expect(await ccw.innerText()).toBe("Turn 90° counterclockwise");
          expect(a.width, "sized to its text, not half the panel").toBeLessThan(g.width / 2 + 20);
        }
        expect(await ccw.getAttribute("aria-label")).toBe("Turn 90° counterclockwise");
        expect(await cw.getAttribute("title")).toBe("Turn 90° clockwise");
        const text = (await ccw.innerText()).trim();
        expect(name === "narrowest" ? text === "" : /^(Turn )?90° counterclockwise$/.test(text)).toBe(true);
        await cw.click(); await page.waitForTimeout(250);
        expect(await boxRotation(page)).toBe(90); expect(await canvasRotation(page)).toBe(90);
        await ccw.click(); await ccw.click(); await page.waitForTimeout(250);
        expect(await boxRotation(page)).toBe(270); expect(await canvasRotation(page)).toBe(270);
      });
    }

    test("NEW-2 · a non-standard sheet shows no note, but the scale readout is still there", async ({ page }) => {
      await openPlan(page, { locked });
      await expect(T(page, "overlay-scale-ratio")).toBeVisible();
      const body = await page.evaluate(() => document.body.innerText);
      expect(body).not.toMatch(/non-standard sheet/i); expect(body).not.toMatch(/may have been shrunk/i);
    });

    test("NEW-3 · Set scale: Preset applies a standard scale, no Custom entry in the dropdown", async ({ page }) => {
      await openPlan(page, { locked });
      await T(page, "overlay-scale-set").click();
      await expect(T(page, "overlay-scale-mode-preset")).toHaveAttribute("aria-pressed", "true");
      const sel = T(page, "overlay-scale-preset");
      expect(await sel.inputValue()).toBe("eng-40");
      expect(await sel.locator('option[value="custom"]').count()).toBe(0);
      expect(await sel.innerText()).not.toMatch(/Custom/);
      await sel.selectOption("eng-60");
      await fpiNear(page, 60);
      await expect.poll(() => ratio(page)).toMatch(/60/);
      await sel.selectOption("arch-1-8");
      await fpiNear(page, 8);
    });

    test("NEW-3 · Set scale: Custom is ONE box — 40, 1\" = 40', 1:480, 1/8\" = 1'-0\" apply; junk reverts and flags the field", async ({ page }) => {
      await openPlan(page, { locked });
      await T(page, "overlay-scale-set").click();
      await T(page, "overlay-scale-mode-custom").click();
      const box = T(page, "overlay-scale-custom-input");
      await expect(box).toBeVisible();
      expect(await T(page, "overlay-scale-custom").locator("input").count()).toBe(1);
      expect(await T(page, "overlay-scale-custom").locator("select").count()).toBe(0);
      expect(await box.inputValue()).toBe("40");
      {   // the row stays inside the Placement section at every panel width (the closing ' is never pushed out of the panel)
        const [sec, row, tail] = await Promise.all([T(page, "overlay-placement").boundingBox(), T(page, "overlay-scale-custom").boundingBox(), T(page, "overlay-scale-custom").locator("span").last().boundingBox()]);
        console.log(`[${tag}] custom row ${JSON.stringify(row)} section ${JSON.stringify(sec)} tail ${JSON.stringify(tail)}`);
        expect(row.x + row.width, "custom row inside the section").toBeLessThanOrEqual(sec.x + sec.width + 0.5);
        expect(tail.x + tail.width, "closing ' inside the section").toBeLessThanOrEqual(sec.x + sec.width + 0.5);
      }
      for (const [typed, want] of [["50", 50], ["1\" = 45'", 45], ["1:480", 40], ["1/8\" = 1'-0\"", 8], ["37.5", 37.5]]) {
        await box.fill(typed); await box.press("Enter");
        await fpiNear(page, want);
      }
      await box.fill("banana"); await box.press("Enter"); await page.waitForTimeout(250);
      expect(await ftPerInch(page)).toBeCloseTo(37.5, 6);
      expect(await box.inputValue()).toBe("37.5");
      expect(await box.getAttribute("aria-invalid")).toBe("true");
      await box.fill("120"); await box.blur();   // blur applies too
      await fpiNear(page, 120);
      await box.focus(); await box.blur(); await page.waitForTimeout(250);   // an idle focus→blur never re-commits
      expect(await ftPerInch(page)).toBeCloseTo(120, 6);
    });

    test("NEW-3 · which segment opens first", async ({ page }) => {
      await openPlan(page, { locked, ov: { ftPerPx: 37.5 / 72 } });   // from Trace / Match / typing: matches no preset
      await T(page, "overlay-scale-set").click();
      await expect(T(page, "overlay-scale-mode-custom")).toHaveAttribute("aria-pressed", "true");
      expect(await T(page, "overlay-scale-custom-input").inputValue()).toBe("37.5");
      await T(page, "overlay-scale-mode-preset").click();
      expect(await T(page, "overlay-scale-preset").inputValue()).toBe("");
      expect(await T(page, "overlay-scale-preset").locator("option:checked").innerText()).toBe("Choose a scale");
    });
  });
}

for (const leftWidth of [240, 620]) test(`NEW-3 · the Custom row (1" = [ ] ') stays inside the section (panel ${leftWidth === 240 ? "narrowest" : "widest"})`, async ({ page }) => {
  {
    await openPlan(page, { locked: false, leftWidth });
    await T(page, "overlay-scale-set").click(); await T(page, "overlay-scale-mode-custom").click();
    const [sec, row, input, tail] = await Promise.all([T(page, "overlay-placement").boundingBox(), T(page, "overlay-scale-custom").boundingBox(), T(page, "overlay-scale-custom-input").boundingBox(), T(page, "overlay-scale-custom").locator("span").last().boundingBox()]);
    console.log(`custom @${leftWidth}: section ${Math.round(sec.x)}..${Math.round(sec.x + sec.width)} row ..${Math.round(row.x + row.width)} input ${Math.round(input.width)} wide, tail ..${Math.round(tail.x + tail.width)}`);
    expect(row.x + row.width).toBeLessThanOrEqual(sec.x + sec.width + 0.5);
    expect(tail.x + tail.width).toBeLessThanOrEqual(sec.x + sec.width + 0.5);
    expect(input.width, "a usable box").toBeGreaterThan(40);
  }
});

/* Screenshots for the PR: narrowest and widest panel — the rotation row, Set scale in Preset and in Custom. */
test.describe("panel screenshots", () => {
  test.skip(!process.env.SHOTS, "set SHOTS=<dir> to write the PR screenshots");
  for (const [name, leftWidth] of [["narrowest", 240], ["widest", 620]]) {
    test(`${name} panel`, async ({ page }) => {
      await openPlan(page, { locked: false, leftWidth, vw: 1600, vh: 1000 });
      const panel = T(page, "overlays-panel");
      await panel.scrollIntoViewIfNeeded();
      await T(page, "overlay-rotation-row").screenshot({ path: `${process.env.SHOTS}/turns-${name}-rotation-row.png` });
      await T(page, "overlay-scale-set").click();
      await page.waitForTimeout(250);
      await T(page, "overlay-placement").screenshot({ path: `${process.env.SHOTS}/scale-${name}-preset.png` });
      await T(page, "overlay-scale-mode-custom").click();
      await page.waitForTimeout(250);
      await T(page, "overlay-placement").screenshot({ path: `${process.env.SHOTS}/scale-${name}-custom.png` });
      await T(page, "overlay-scale-custom-input").fill("bad"); await T(page, "overlay-scale-custom-input").press("Enter");
      await page.waitForTimeout(250);
      await T(page, "overlay-placement").screenshot({ path: `${process.env.SHOTS}/scale-${name}-custom-invalid.png` });
      await panel.screenshot({ path: `${process.env.SHOTS}/panel-${name}.png` });
    });
  }
});
