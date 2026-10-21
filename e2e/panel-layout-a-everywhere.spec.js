/* NEW-1/NEW-2/NEW-3 (owner 2026-10-21, "apply it to anything that can get put on the map, other than maybe layers") — layout A's shell and its
 * compact control rules on the measurement panel and on every drawn site element's Properties panel, driven against the REAL inspector.
 *
 *   NEW-1  the value columns are a FIXED compact width that does NOT grow with the panel: measured at the default panel width and again
 *          after a real drag of the panel's resize handle out to its widest. A number box and its ▲▼ touch.
 *   NEW-2  the measurement panel: Label, then APPEARANCE · SIZE & POSITION; no LAYER block, no label-zoom block, no "Drag the line…" hint;
 *          the right-click menu carries Bring to Front / Send to Back / Send behind the plan and they work.
 *   NEW-3  every element panel: section names where they fit, no unit on weight, opacity a typed % box, right-aligned pattern selects,
 *          every number box in a column on one right edge, nothing scrolls sideways — both themes.
 *
 * Run: npx playwright test e2e/panel-layout-a-everywhere.spec.js
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE_ID = "e2e-panel-layout-a-all";
const PPF = 0.5;
const VALUE_W = 92; // PROP_VALUE_W in SitePlanner.jsx — the fixed compact column

const ring = (cx, cy, w, h) => [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]].map(([x, y]) => ({ x, y }));

/* One of each, far enough apart that nothing overlaps: [name, id, centre (feet), record collection, record]. */
const EL = (id, type, cx, cy, w, h, extra = {}) => ({ id, type, cx, cy, w, h, rot: 0, z: 1, ...extra });
const CASES = [
  // name, collection, id, centre, record, expected section labels (in order), pattern selects expected
  { name: "area measurement", coll: "measures", id: "m-area", at: { x: 0, y: 0 }, sel: '[data-measure="m-area"] polygon', rec: { id: "m-area", mode: "area", pts: ring(0, 0, 300, 200), z: 1, labelPpf: 0.05 }, sections: ["appearance", "size"], patterns: 1, title: "Area measurement" },
  { name: "distance measurement", coll: "measures", id: "m-line", at: { x: 500, y: 0 }, sel: '[data-measure="m-line"] polyline', rec: { id: "m-line", mode: "line", pts: [{ x: 400, y: 0 }, { x: 600, y: 0 }], z: 1 }, sections: ["appearance", "size"], patterns: 1, title: "Distance" },
  { name: "polyline measurement", coll: "measures", id: "m-poly", at: { x: 1000, y: 0 }, sel: '[data-measure="m-poly"] polyline', rec: { id: "m-poly", mode: "polyline", pts: [{ x: 900, y: 0 }, { x: 1000, y: 60 }, { x: 1100, y: 0 }], z: 1 }, sections: ["appearance", "size"], patterns: 1, title: "Polyline length" },
  { name: "count measurement", coll: "measures", id: "m-count", at: { x: 1500, y: 0 }, sel: '[data-measure="m-count"]', rec: { id: "m-count", mode: "count", pts: [{ x: 1450, y: 0 }, { x: 1500, y: 40 }, { x: 1550, y: 0 }], z: 1 }, sections: ["appearance", "size"], patterns: 0, title: "Count" },
  { name: "paving", coll: "els", id: "pv", at: { x: 2000, y: 0 }, sel: '[data-el-id="pv"]', rec: EL("pv", "paving", 2000, 0, 220, 120), sections: ["appearance", "size"], patterns: 0 },
  { name: "sidewalk", coll: "els", id: "sw", at: { x: 2500, y: 0 }, sel: '[data-el-id="sw"]', rec: EL("sw", "sidewalk", 2500, 0, 220, 20), sections: ["appearance", "size"], patterns: 0 },
  { name: "trailer parking", coll: "els", id: "tr", at: { x: 3000, y: 0 }, sel: '[data-el-id="tr"]', rec: EL("tr", "trailer", 3000, 0, 220, 100), sections: ["appearance", "size"], patterns: 0 },
  { name: "car parking", coll: "els", id: "pk", at: { x: 3500, y: 0 }, sel: '[data-el-id="pk"]', rec: EL("pk", "parking", 3500, 0, 220, 100), sections: ["size", "appearance"], patterns: 0 },
  { name: "building", coll: "els", id: "bl", at: { x: 4000, y: 0 }, sel: '[data-el-id="bl"]', rec: EL("bl", "building", 4000, 0, 300, 160, { dock: "cross", dockSide: "bottom" }), sections: [], patterns: 0, ownLayout: true },
  { name: "detention pond", coll: "els", id: "pd", at: { x: 4500, y: 0 }, sel: '[data-el-id="pd"]', rec: { id: "pd", type: "pond", rot: 0, z: 1, det: { role: "detention", depth: 8, slope: 3 }, points: ring(4500, 0, 240, 160) }, sections: [], patterns: 0, ownLayout: true },
  { name: "road", coll: "els", id: "rd", at: { x: 5500, y: 0 }, sel: '[data-el-id="rd"]', rec: EL("rd", "road", 5500, 0, 300, 40, { pts: [{ x: 5350, y: 0 }, { x: 5650, y: 0 }], travelW: 40, roadClass: "truck" }), sections: [], patterns: 0, ownLayout: true },
  { name: "easement", coll: "markups", id: "es", at: { x: 5000, y: 0 }, sel: '[data-markup="es"]', rec: { id: "es", kind: "easement", mode: "centerline", width: 40, status: "existing", easeType: "utility", pts: ring(5000, 0, 240, 40), centerline: [{ x: 4880, y: 0 }, { x: 5120, y: 0 }], z: 1 }, sections: ["text", "appearance", "size"], patterns: 1 },
];

const THEMES = ["dark", "light"];

async function boot(page, { theme = "dark", width = 320, viewport = { width: 1500, height: 950 } } = {}) {
  await page.setViewportSize(viewport);
  await armPlannerHooks(page);
  const els = CASES.filter((c) => c.coll === "els").map((c) => c.rec);
  const measures = CASES.filter((c) => c.coll === "measures").map((c) => c.rec);
  const markups = CASES.filter((c) => c.coll === "markups").map((c) => c.rec);
  const site = { id: SITE_ID, groupId: SITE_ID, site: "Panel layout A (all)", name: "Plan", origin: null, county: "harris", parcels: [], els, measures, callouts: [], markups, settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.addInitScript(([id, rec, th, w]) => {
    if (!sessionStorage.getItem("seeded-layout-a-all")) {
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
      localStorage.setItem("planarfit:currentSite:v1", id);
      sessionStorage.setItem("seeded-layout-a-all", "1");
    }
    localStorage.setItem("planyr.theme", th);
    localStorage.setItem("planarfit:leftWidth", String(w));
  }, [SITE_ID, site, theme, width]);
  await page.goto("/");
  const tab = page.getByTestId("module-tab-site-planner").filter({ visible: true });
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  await expect(async () => { await tab.click({ timeout: 3_000 }); await expect(canvas(page)).toBeVisible({ timeout: 3_000 }); }).toPass({ timeout: 30_000 });
  await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20_000 });
  await page.waitForTimeout(1500);
}

/* Centre the object, select it with a real click, open its Properties with a real double-click. */
async function open(page, c) {
  await page.keyboard.press("Escape");
  await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [c.at.x, c.at.y, PPF]);
  await page.waitForTimeout(500);
  const b = await page.locator(c.sel).first().boundingBox();
  const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(400);
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByTestId("property-panel")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(250);
  // the pond's own Appearance group is a collapsed section — open it so its boxes are measured too
  if (c.id === "pd") {
    const hdr = page.getByTestId("property-panel").getByRole("button", { name: /^Appearance/ });
    if ((await hdr.getAttribute("aria-expanded")) !== "true") { await hdr.click(); await page.waitForTimeout(200); }
    await expect(page.getByTestId("property-panel").getByLabel("Fill opacity")).toBeVisible();
  }
  return at;
}

/* Everything this spec asserts on one open panel, read in the page. */
const readPanel = (panel) => panel.evaluate((root, VALUE_W) => {
  const w = (el) => el.getBoundingClientRect().width;
  const sections = [...root.querySelectorAll("[data-panel-section]")].map((e) => [e.getAttribute("data-panel-section"), (e.firstElementChild || e).textContent.trim()]);
  const pairedCells = [...root.querySelectorAll("[data-paired-cell]")].map((e) => Math.round(w(e) * 10) / 10);
  const compactCells = [...root.querySelectorAll('[data-field-value="compact"]')].map((e) => Math.round(w(e) * 10) / 10);
  // a stepper that is NOT inside the shared NumberBox is the old loose pair — its input must still be touching it
  const looseGaps = [...root.querySelectorAll("[data-num-stepper]")].filter((s) => !s.closest("[data-numbox]")).map((s) => {
    const inp = s.parentElement && s.parentElement.querySelector("input");
    return inp ? Math.round((s.getBoundingClientRect().left - inp.getBoundingClientRect().right) * 10) / 10 : null;
  });
  const boxed = [...root.querySelectorAll("[data-numbox]")].map((box) => {
    const st = box.querySelector("[data-num-stepper]");
    const r = box.getBoundingClientRect();
    return { w: Math.round(r.width * 10) / 10, right: r.right, left: r.left, stepperGap: st ? Math.round((r.right - st.getBoundingClientRect().right) * 10) / 10 : null };
  });
  const sels = [...root.querySelectorAll('select[aria-label$="pattern"]')].map((s) => getComputedStyle(s).textAlignLast);
  const weightRows = [...root.querySelectorAll('[data-field-group="1"][data-row-align="1"]')].filter((r) => /(^|\s)(Line weight|Weight)(\s|$)/.test(r.innerText.replace(/\n/g, " "))).map((r) => r.innerText.replace(/\s+/g, " "));
  return { sections, pairedCells, compactCells, looseGaps, boxed, sels, weightRows, overflow: root.scrollWidth - root.clientWidth, text: root.innerText.replace(/\s+/g, " ") };
}, VALUE_W);

/* Drag the docked panel's real resize handle to its widest (leftWidth is clamped to 620). */
async function widen(page) {
  const h = page.locator('[title="Drag to resize"]').first();
  const b = await h.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 400, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

for (const theme of THEMES) {
  test(`layout A everywhere — compact fixed columns, sections, controls · ${theme}`, async ({ page }) => {
    test.setTimeout(240_000);
    await boot(page, { theme, width: 320 });
    const narrow = {}; // per case: the numbers read at the default panel width
    for (const c of CASES) {
      await test.step(`${c.name} · default width`, async () => {
        await open(page, c);
        const panel = page.getByTestId("property-panel");
        const r = await readPanel(panel);
        narrow[c.id] = r;
        if (process.env.PANEL_SHOTS) await panel.screenshot({ path: `${process.env.PANEL_SHOTS}/${theme}-default-${c.id}.png` });
        if (c.title) await expect(page.getByTestId("props-panel-title")).toHaveText(c.title);
        if (!c.ownLayout && c.sections.length) expect(r.sections.map((s) => s[0]), `${c.name} sections`).toEqual(c.sections);
        if (c.name === "car parking") expect(r.sections.map((s) => s[1])).toEqual(["Size & position", "Appearance"]);
        if (c.name === "road") {
          // the owner-approved road panel keeps its order: the Road / Cross-section / Label sections first, Appearance after them
          expect(r.sections.map((s) => s[0])).toEqual(["appearance"]);
          const road = await panel.getByRole("button", { name: /^Road/ }).first().boundingBox();
          const app = await panel.locator('[data-panel-section="appearance"]').boundingBox();
          expect(app.y, "road: Appearance sits after the Road section").toBeGreaterThan(road.y);
        }
        expect(r.overflow, `${c.name} sideways overflow`).toBeLessThanOrEqual(1);
        for (const wr of r.weightRows) expect(wr, `${c.name} weight row`).not.toMatch(/\bpt\b/);
        expect(r.sels.length, `${c.name} pattern selects`).toBe(c.patterns);
        for (const a of r.sels) expect(a, `${c.name} select alignment`).toBe("right");
        // every fixed column is at most the compact width; a paired row never stretches
        for (const cw of [...r.pairedCells, ...r.compactCells]) expect(cw, `${c.name} column width`).toBeLessThanOrEqual(VALUE_W + 0.6);
        // a number box and its ▲▼ touch (the box IS the frame); a loose stepper sits against its input
        for (const b of r.boxed) if (b.stepperGap != null) expect(b.stepperGap, `${c.name} stepper inside its box`).toBeLessThanOrEqual(2);
        for (const g of r.looseGaps) if (g != null) expect(g, `${c.name} loose stepper gap`).toBeLessThanOrEqual(8);
      });
    }

    await widen(page);
    for (const c of CASES) {
      await test.step(`${c.name} · widest panel`, async () => {
        await open(page, c);
        const panel = page.getByTestId("property-panel");
        const wide = await readPanel(panel);
        const was = narrow[c.id];
        if (process.env.PANEL_SHOTS) await panel.screenshot({ path: `${process.env.PANEL_SHOTS}/${theme}-wide-${c.id}.png` });
        // the panel really is wider now …
        const pw = (await panel.boundingBox()).width;
        expect(pw, "the panel was widened").toBeGreaterThan(520);
        expect(wide.overflow, `${c.name} sideways overflow (wide)`).toBeLessThanOrEqual(1);
        // … and the columns are EXACTLY the width they were at the default panel width: extra width is empty space on the right
        expect(wide.pairedCells, `${c.name} paired columns do not grow`).toEqual(was.pairedCells);
        expect(wide.compactCells, `${c.name} compact cells do not grow`).toEqual(was.compactCells);
        expect(wide.boxed.map((b) => b.w), `${c.name} number boxes do not grow`).toEqual(was.boxed.map((b) => b.w));
        for (const b of wide.boxed) if (b.stepperGap != null) expect(b.stepperGap, `${c.name} stepper inside its box (wide)`).toBeLessThanOrEqual(2);
      });
    }
  });
}

test("layout A everywhere — the measurement panel has no Layer block, no label-zoom block and no drag hint; the right-click menu carries the ordering", async ({ page }) => {
  await boot(page, {});
  const c = CASES[0];
  const at = await open(page, c);
  const panel = page.getByTestId("property-panel");
  const text = (await panel.innerText()).replace(/\s+/g, " ");
  for (const gone of ["Layer", "Send behind the plan", "Bring to front", "Send to back", "Set at current zoom", "Reset to default", "Shows from", "a selected measurement always shows its label", "Drag the line to move it"]) expect(text, gone).not.toContain(gone);
  // order: Label input first (above Appearance), then the two sections; the old header-less "Area" row is gone from the top
  const labelY = (await panel.getByText("Label", { exact: true }).first().boundingBox()).y;
  const appY = (await panel.locator('[data-panel-section="appearance"]').boundingBox()).y;
  const sizeY = (await panel.locator('[data-panel-section="size"]').boundingBox()).y;
  expect(labelY).toBeLessThan(appY);
  expect(appY).toBeLessThan(sizeY);
  // area: Outline | Fill table — outline carries colour/weight/pattern, fill carries colour/opacity (the outline opacity cell is the shared dash)
  await expect(panel.getByLabel("Fill opacity")).toBeVisible();
  await expect(panel.getByLabel("Line weight")).toBeVisible();
  await expect(panel.getByLabel("Line opacity")).toHaveCount(0);
  // Size & position reads the area + perimeter
  const size = await panel.locator('[data-panel-section="size"]').evaluate((e) => e.parentElement.innerText);
  expect(size).toMatch(/Area/); expect(size).toMatch(/Perimeter/);

  // the right-click menu offers all three, and they work (nothing was lost, only moved)
  await page.mouse.click(at.x, at.y, { button: "right" });
  const menu = page.locator(".menu").last();
  await expect(menu.getByText("Bring to Front", { exact: true })).toBeVisible();
  await expect(menu.getByText("Send to Back", { exact: true })).toBeVisible();
  await menu.getByText("Send behind the plan", { exact: true }).click();
  const stored = () => page.evaluate(() => { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return ((Object.values(m)[0] || {}).measures || []).find((x) => x.id === "m-area"); });
  await expect.poll(async () => !!(await stored()).behindEls).toBe(true);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await page.locator(".menu").last().getByText("Bring in front of the plan", { exact: true }).click();
  await expect.poll(async () => !!(await stored()).behindEls).toBe(false);
});

test("layout A everywhere — a measurement's saved label zoom still decides when its label shows (the stored labelPpf is untouched)", async ({ page }) => {
  await boot(page, {});
  const c = CASES[0];
  await open(page, c);
  // editing through the panel must not strip a saved labelPpf
  await page.getByTestId("property-panel").getByLabel("Fill opacity").fill("40");
  await page.getByTestId("property-panel").getByLabel("Fill opacity").press("Enter");
  const read = (k) => page.evaluate((key) => { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return ((Object.values(m)[0] || {}).measures || []).find((x) => x.id === "m-area")?.[key]; }, k);
  await expect.poll(() => read("fillOpacity")).toBeCloseTo(0.4, 5);
  expect(await read("labelPpf")).toBe(0.05);
});

test("layout A everywhere — the phone bottom sheet still fits (no sideways overflow) for the measurement and the generic element panels", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  try {
    await boot(page, { viewport: { width: 390, height: 844 } });
    for (const c of [CASES[0], CASES[4]]) {
      await page.keyboard.press("Escape");
      await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [c.at.x, c.at.y, PPF]);
      await page.waitForTimeout(500);
      const b = await page.locator(c.sel).first().boundingBox();
      const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      await page.touchscreen.tap(at.x, at.y);
      await page.waitForTimeout(500);
      await page.touchscreen.tap(at.x, at.y);
      await page.waitForTimeout(200);
      await page.touchscreen.tap(at.x, at.y);
      const sheet = page.locator('[data-bottom-sheet="properties"]').first();
      const open = await sheet.isVisible().catch(() => false);
      if (!open) { await page.locator("button", { hasText: /^Properties$/ }).first().click().catch(() => {}); }
      await expect(page.locator('[data-bottom-sheet="properties"]').first()).toBeVisible({ timeout: 8000 });
      const over = await page.locator('[data-bottom-sheet="properties"]').first().evaluate((el) => {
        const worst = [...el.querySelectorAll("*")].reduce((m, n) => Math.max(m, n.getBoundingClientRect().right), 0);
        return { overflow: el.scrollWidth - el.clientWidth, right: Math.round(worst), vw: window.innerWidth };
      });
      expect(over.overflow, `${c.name} phone sheet overflow`).toBeLessThanOrEqual(1);
      expect(over.right, `${c.name} nothing past the viewport edge`).toBeLessThanOrEqual(over.vw + 1);
    }
  } finally { await ctx.close(); }
});

/* THE RED-PROOF TEST (NEW-1). Layout-agnostic on purpose — it asks only "how wide is each value column, at the default panel width and
 * at the widest?" — so it can be pointed at the PRE-FIX build (where the columns were `1fr 1fr` and grew from ~100 px to ~250 px)
 * and fail on exactly that, rather than on a section name that did not exist yet. */
test("layout A everywhere — NEW-1 red-proof: a paired value column is the same width at the default and the widest panel (and never wider than the compact width)", async ({ page }) => {
  await boot(page, {});
  const widths = async (c) => {
    await open(page, c);
    return page.getByTestId("property-panel").evaluate((root) => [...root.querySelectorAll("[data-paired-cell]")].map((e) => Math.round(e.getBoundingClientRect().width * 10) / 10));
  };
  const probe = [CASES[0], CASES[4]]; // an area measurement and paving — both have paired rows
  const before = [];
  for (const c of probe) before.push(await widths(c));
  await widen(page);
  for (let i = 0; i < probe.length; i++) {
    const after = await widths(probe[i]);
    expect(after.length, probe[i].name).toBeGreaterThan(0);
    expect(after, `${probe[i].name}: columns do not grow with the panel`).toEqual(before[i]);
    for (const w of after) expect(w, `${probe[i].name}: compact`).toBeLessThanOrEqual(VALUE_W + 0.6);
  }
});
