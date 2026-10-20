/* NEW-1 (layout "A", owner-approved 2026-10-20) — the Properties panel of every neutral markup (line, polyline, rectangle,
 * ellipse, polygon, cloud) and of text boxes / callouts, driven against the REAL inspector in both themes at the default and the
 * minimum panel width.
 *
 *   • section labels, in order: Text (text box / callout only) → Appearance → Size & position
 *   • ✎ Edit text is at the very top, above the Text label, and is a plain button (the same look as the Lock chip), not a dark fill
 *   • no "pt" next to a line weight; pattern selects are right-aligned (computed text-align-last)
 *   • every number box in the Appearance rows shares one right edge per column
 *   • Rotation: the Level button exists only while the angle is not 0; the quarter-turn buttons turn it by 90
 *   • a line / polyline now has an opacity box, and the canvas honours it
 *   • a text box: strikethrough / all caps / bottom alignment persist (reload) and render; caps never rewrites the stored text
 *   • nothing scrolls sideways
 *
 * Run: npx playwright test e2e/markup-panel-layout-a.spec.js
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE_ID = "e2e-panel-layout-a";
const PPF = 0.5;
const STROKE = { stroke: "#2563eb", weight: 2, dash: "solid", fill: "#16a34a", fillOpacity: 0.3 };
const sq = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]].map(([x, y]) => ({ x, y }));

// [kind, id, click point (feet), record]
// [kind, id, DOM selector of what to click, where on its box (fractions)]
const OBJECTS = [
  ["line", "mk-line", { x: 100, y: 0 }, { id: "mk-line", kind: "line", a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, ...STROKE }],
  ["polyline", "mk-poly", { x: 450, y: 30 }, { id: "mk-poly", kind: "polyline", pts: [{ x: 400, y: 0 }, { x: 500, y: 60 }, { x: 600, y: 0 }], ...STROKE }],
  ["rect", "mk-rect", { x: 900, y: 0 }, { id: "mk-rect", kind: "rect", cx: 900, cy: 0, w: 200, h: 100, rot: 0, ...STROKE }],
  ["ellipse", "mk-ell", { x: 1300, y: 0 }, { id: "mk-ell", kind: "ellipse", cx: 1300, cy: 0, w: 200, h: 100, rot: 0, ...STROKE }],
  ["polygon", "mk-pg", { x: 1700, y: 0 }, { id: "mk-pg", kind: "polygon", pts: sq(1700, 0, 80), ...STROKE }],
  ["cloud", "mk-cl", { x: 2100, y: 0 }, { id: "mk-cl", kind: "cloud", pts: sq(2100, 0, 80), arcFt: 12, ...STROKE }],
  ["textbox", "co-tb", { x: 2500, y: 0 }, null],
  ["callout", "co-co", { x: 2900, y: 0 }, null],
];
const CALLOUTS = [
  { id: "co-tb", box: { x: 2500, y: 0 }, noLeader: true, text: "Typed in Mixed Case", z: 1 },
  { id: "co-co", box: { x: 2900, y: 0 }, tip: { x: 2900, y: 160 }, text: "Move the pond", z: 2 },
];

async function boot(page, { theme = "dark", width = 320, viewport = { width: 1500, height: 950 } } = {}) {
  await page.setViewportSize(viewport);
  await armPlannerHooks(page);
  const markups = OBJECTS.filter((o) => o[3]).map((o, i) => ({ ...o[3], z: i + 3 }));
  const site = { id: SITE_ID, groupId: SITE_ID, site: "Panel layout A", name: "Plan", origin: null, county: "harris", parcels: [], els: [], measures: [], callouts: CALLOUTS, markups, settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.addInitScript(([id, rec, th, w]) => {
    // Seed once per browser context only: a reload must show what the app saved, not the seed again.
    if (!sessionStorage.getItem("seeded-layout-a")) {
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
      localStorage.setItem("planarfit:currentSite:v1", id);
      sessionStorage.setItem("seeded-layout-a", "1");
    }
    localStorage.setItem("planyr.theme", th);
    localStorage.setItem("planarfit:leftWidth", String(w));
  }, [SITE_ID, site, theme, width]);
  await page.goto("/");
  const tab = page.getByTestId("module-tab-site-planner").filter({ visible: true });
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  await expect(async () => { await tab.click({ timeout: 3_000 }); await expect(canvas(page)).toBeVisible({ timeout: 3_000 }); }).toPass({ timeout: 30_000 });
  await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20_000 });
  await page.waitForTimeout(1500); // let the boot framing settle so a centerOn is not overridden
}

/* What to really click for each object: the DOM node of the object and where on its box (fractions). */
const TARGET = {
  "mk-line": ['[data-markup="mk-line"] line', 0.5, 0.5],
  "mk-poly": ['[data-markup="mk-poly"]', 0.5, 0.97],       // the V's bottom vertex — the one point of the box that is on the stroke
  "mk-rect": ['[data-markup="mk-rect"]', 0.5, 0.5],
  "mk-ell": ['[data-markup="mk-ell"]', 0.5, 0.5],
  "mk-pg": ['[data-markup="mk-pg"]', 0.5, 0.5],
  "mk-cl": ['[data-markup="mk-cl"]', 0.5, 0.5],
  "co-tb": ['[data-testid="callout-box-co-tb"]', 0.5, 0.5],
  "co-co": ['[data-testid="callout-box-co-co"]', 0.5, 0.5],
};

/* Bring the object into view, then really click it (and double-click to open Properties). */
async function selectAndOpen(page, pt, id) {
  await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [pt.x, pt.y, PPF]);
  await page.waitForTimeout(500);
  const [sel, fx, fy] = TARGET[id];
  const b = await page.locator(sel).first().boundingBox();
  const at = { x: b.x + b.width * fx, y: b.y + b.height * fy };
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(450);
  if (id.startsWith("co-")) {
    // a double-click INSIDE a text box opens the text editor (only its border opens Properties) — use the dock's Properties item.
    if (!(await page.getByTestId("property-panel").isVisible())) await page.locator("button", { hasText: /^Properties$/ }).first().click();
  } else {
    await page.mouse.dblclick(at.x, at.y);
  }
  await expect(page.getByTestId("property-panel")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(250);
  return at;
}

const stored = (page, key, id) => page.evaluate(([k, i]) => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const s = Object.values(m)[0] || {};
  return (s[k] || []).find((x) => x.id === i) || null;
}, [key, id]);

for (const theme of ["dark", "light"]) {
  for (const [wname, width] of [["default", 320], ["minimum", 240]]) {
    test(`layout A — every kind · ${theme} · ${wname} panel width`, async ({ page }) => {
      await boot(page, { theme, width });
      const panel = page.getByTestId("property-panel");

      for (const [kind, id, pt] of OBJECTS) {
        await test.step(kind, async () => {
          await selectAndOpen(page, pt, id);
          const isText = kind === "textbox" || kind === "callout";

          if (process.env.PANEL_SHOTS) await panel.screenshot({ path: `${process.env.PANEL_SHOTS}/${theme}-${wname}-${kind}.png` });

          // sections, in order
          const labels = await panel.locator("[data-panel-section]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-panel-section"), e.textContent.trim()]));
          expect(labels, `${kind} sections`).toEqual(isText
            ? [["text", "Text"], ["appearance", "Appearance"], ["size", "Size & position"]]
            : [["appearance", "Appearance"], ["size", "Size & position"]]);

          // no horizontal overflow
          expect(await panel.evaluate((el) => el.scrollWidth - el.clientWidth), `${kind} overflow`).toBeLessThanOrEqual(1);

          // no "pt" beside a weight; weight is a stepper (a NumberBox with ▲▼)
          const weightRow = panel.locator('[data-field-group="1"][data-row-align="1"]').filter({ has: page.getByText("Weight", { exact: true }) }).first();
          expect((await weightRow.innerText()).replace(/\s+/g, " "), `${kind} weight row`).not.toMatch(/\bpt\b/);
          await expect(weightRow.locator("[data-num-stepper]")).toHaveCount(1);

          // pattern selects are right-aligned (the line pattern; the fill pattern too on a closed shape)
          const sels = panel.locator('select[aria-label$="pattern"]');
          const n = await sels.count();
          expect(n, `${kind} pattern selects`).toBe(kind === "line" || kind === "polyline" || isText ? 1 : 2);
          for (let i = 0; i < n; i++) expect(await sels.nth(i).evaluate((e) => getComputedStyle(e).textAlignLast), `${kind} select ${i}`).toBe("right");

          // every Appearance number box shares one right edge per column
          const edges = await panel.evaluate((root) => {
            const a = root.querySelector('[data-panel-section="appearance"]');
            const b = root.querySelector('[data-panel-section="size"]');
            const boxes = [...root.querySelectorAll("[data-numbox]")].filter((el) => (a.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && (b.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING));
            return boxes.map((el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right }; });
          });
          expect(edges.length, `${kind} appearance number boxes`).toBeGreaterThanOrEqual(2);
          const cols = [];
          for (const e of edges) { const c = cols.find((k) => Math.abs(k.l - e.l) < 6); if (c) c.rs.push(e.r); else cols.push({ l: e.l, rs: [e.r] }); }
          for (const c of cols) expect(Math.max(...c.rs) - Math.min(...c.rs), `${kind} right edges (col at ${Math.round(c.l)})`).toBeLessThan(1.01);

          // text box / callout: Edit text on top, above the Text label, and plain like the Lock chip
          if (isText) {
            const edit = page.getByTestId("callout-edit-text");
            const textLabel = panel.locator('[data-panel-section="text"]');
            expect((await edit.boundingBox()).y + (await edit.boundingBox()).height).toBeLessThanOrEqual((await textLabel.boundingBox()).y + 1);
            const lock = panel.getByRole("button", { name: /^(Lock|Unlock)$/ }).first();
            const bg = (l) => l.evaluate((e) => getComputedStyle(e).backgroundColor);
            expect(await bg(edit), "Edit text is a plain button, not a dark fill").toBe(await bg(lock));
            expect((await edit.boundingBox()).width, "full width").toBeGreaterThan((await panel.boundingBox()).width * 0.7);
          }

          // Rotation: Level only while rotated; quarter turns turn by 90
          const hasRot = kind === "rect" || kind === "ellipse" || isText;
          if (hasRot) {
            const key = isText ? "callouts" : "markups";
            await expect(page.getByTestId("rotation-level")).toHaveCount(0);
            await expect(page.getByTestId("rotation-glyph")).toHaveCount(1);
            await page.getByTestId("rotation-quarter-right").click();
            await expect.poll(async () => (await stored(page, key, id)).rot).toBe(90);
            await expect(page.getByTestId("rotation-level")).toHaveCount(1);
            expect(await page.getByTestId("rotation-glyph").getAttribute("data-angle")).toBe("90");
            await page.getByTestId("rotation-quarter-left").click();
            await page.getByTestId("rotation-quarter-left").click();
            await expect.poll(async () => (await stored(page, key, id)).rot).toBe(270);
            await page.getByTestId("rotation-level").click();
            await expect.poll(async () => (await stored(page, key, id)).rot).toBe(0);
            await expect(page.getByTestId("rotation-level")).toHaveCount(0);
          } else {
            await expect(page.getByTestId("rotation-field")).toHaveCount(0);
          }
        });
      }
    });
  }
}

test("layout A — a line's opacity box writes strokeOpacity and the canvas honours it", async ({ page }) => {
  await boot(page, {});
  await selectAndOpen(page, OBJECTS[0][2], "mk-line");
  const panel = page.getByTestId("property-panel");
  const box = panel.getByLabel("Line opacity");
  await box.fill("40");
  await box.press("Enter");
  await expect.poll(async () => (await stored(page, "markups", "mk-line")).strokeOpacity).toBeCloseTo(0.4, 5);
  const op = await page.locator('[data-markup="mk-line"] line[stroke-dasharray], [data-markup="mk-line"] line:not([stroke="rgba(0,0,0,0.001)"])').last().getAttribute("stroke-opacity");
  expect(Number(op)).toBeCloseTo(0.4, 5);
});

test("layout A — text box: strikethrough + all caps + bottom alignment persist across a reload, render, and never rewrite the typed text", async ({ page }) => {
  await boot(page, {});
  await selectAndOpen(page, OBJECTS[6][2], "co-tb");
  const panel = page.getByTestId("property-panel");
  await page.getByTestId("callout-strike").click();
  await page.getByTestId("callout-caps").click();
  await page.getByTestId("callout-valign-bottom").click();
  await expect.poll(async () => { const c = await stored(page, "callouts", "co-tb"); return c && [c.strike, c.caps, c.valign].join(); }).toBe("true,true,bottom");

  // give the box a fixed height with the real bottom grip so the alignment has room to show
  const grip = page.getByTestId("callout-handle-b");
  await expect(grip).toBeVisible();
  const gb = await grip.boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2 + 30, { steps: 6 });
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await stored(page, "callouts", "co-tb")).boxH).toBeGreaterThan(0);
  const c1 = await stored(page, "callouts", "co-tb");
  expect(c1.text, "all caps is display-only").toBe("Typed in Mixed Case");
  await expect(panel.getByRole("button", { name: /Fit to text/ })).toBeVisible();

  const read = () => page.evaluate(() => {
    const g = document.querySelector('[data-testid="callout-co-tb"]');
    const rect = g.querySelector('[data-testid="callout-box-co-tb"]').getBoundingClientRect();
    const t = g.querySelector("text");
    return { text: t.textContent, deco: t.getAttribute("text-decoration"), textBottom: t.getBoundingClientRect().bottom, boxBottom: rect.bottom, boxTop: rect.top, boxH: rect.height };
  });
  const before = await read();
  expect(before.text).toBe("TYPED IN MIXED CASE");
  expect(before.deco).toBe("line-through");
  expect(before.boxBottom - before.textBottom, "bottom aligned: the text sits at the box's foot").toBeLessThan(before.boxH * 0.35);
  expect(before.textBottom - before.boxTop, "the box is taller than its text").toBeGreaterThan(before.boxH * 0.6);

  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20_000 });
  const c2 = await stored(page, "callouts", "co-tb");
  expect([c2.strike, c2.caps, c2.valign, c2.boxH > 0, c2.text].join()).toBe("true,true,bottom,true,Typed in Mixed Case");
  const after = await read();
  expect(after.text).toBe("TYPED IN MIXED CASE");
  expect(after.deco).toBe("line-through");

  // Fit to text clears the fixed height; turning caps off restores the typed case
  await selectAndOpen(page, OBJECTS[6][2], "co-tb");
  await page.getByRole("button", { name: /Fit to text/ }).click();
  await expect.poll(async () => (await stored(page, "callouts", "co-tb")).boxH ?? null).toBeNull();
  await page.getByTestId("callout-caps").click();
  await expect.poll(async () => (await read()).text).toBe("Typed in Mixed Case");
});
