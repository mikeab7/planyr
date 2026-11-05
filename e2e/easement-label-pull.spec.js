/* NEW-1/NEW-2 (easement label: pull out · move · rotate · snap back · area off) — REAL BROWSER.
 * Seeds a vertical storm strip, then drives the owner's whole sequence with the real mouse:
 *   · area line is OFF by default;
 *   · select the strip, drag its LABEL off → pulled out, leader to the strip appears;
 *   · drag the round grip to put the label UPSIDE DOWN (free 360°, not forced upright);
 *   · reload → the offset + angle stuck (saved with the plan);
 *   · drag the EASEMENT → the label follows with the same offset, leader re-aims;
 *   · right-click the label → "Snap back to strip" returns it inline, leader gone;
 *   · right-click an inline label → Show area on/off, Snap back disabled.
 * Logged out, seeded, no network. FOREGROUND-OR-VOID before every geometry read. */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, openModule } from "./helpers.js";
import { assertMeasurable, pacedWait } from "../ui-audit/lib/tabTiming.mjs";
import { deriveEasementRing } from "../src/workspaces/site-planner/lib/easements.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE_ID = "e2e-easement-label-pull";
const VERT = (() => {
  const m = { id: "ev", kind: "easement", mode: "centerline", width: 100, easeType: "storm", status: "existing", exclusive: false,
    restrictsBuildings: true, restrictsPaving: false, centerline: [{ x: 600, y: 300 }, { x: 600, y: 1900 }], z: 100 };
  m.pts = deriveEasementRing(m);
  return m;
})();
const PARCEL = { id: "p-pull", active: true, pts: [{ x: 0, y: 0 }, { x: 1400, y: 0 }, { x: 1400, y: 2400 }, { x: 0, y: 2400 }] };

async function boot(page) {
  await armPlannerHooks(page);
  const site = { id: SITE_ID, groupId: SITE_ID, site: "Pull", name: "A", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
    parcels: [PARCEL], els: [], measures: [], callouts: [], markups: [VERT],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.addInitScript(([id, rec]) => {
    if (localStorage.getItem("e2e-pull-seeded")) return;           // seed ONCE — a reload must read what the app saved
    localStorage.setItem("e2e-pull-seeded", "1");
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:sites:history:v1", JSON.stringify({ [id]: [] }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await open(page);
}
async function open(page) {
  await page.goto("/");
  if (!(await canvas(page).count())) await openModule(page, "site-planner");
  await expect(canvas(page)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.locator(`[data-markup="${VERT.id}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await pacedWait(page, 1200);
  await assertMeasurable(page, "easement-label-pull");
}
const lab = (p) => p.locator(`[data-markup="${VERT.id}"] [data-easement-label]`).first();
const info = (p) => lab(p).evaluate((g) => ({
  angle: parseFloat(g.getAttribute("data-label-angle")), pulled: g.getAttribute("data-label-pulled") === "1",
  area: g.getAttribute("data-label-area") === "1", leader: !!g.querySelector("[data-easement-leader]"),
  texts: [...g.querySelectorAll("text")].map((t) => t.textContent),
}));
const hitBox = (p) => p.locator(`[data-markup="${VERT.id}"] [data-easement-label-hit]`).first().boundingBox();
const centreOf = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
async function drag(page, a, b, steps = 12) {
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps }); await page.mouse.up();
  await pacedWait(page, 350);
}
async function zoomIn(page) {
  await page.getByRole("button", { name: "Zoom to fit" }).click(); await pacedWait(page, 700);
  // wheel IN over the strip so it stays under the pointer (the seeded view is not framed on it)
  for (let i = 0; i < 4; i++) {
    const b = await page.locator(`[data-markup="${VERT.id}"] polygon`).first().boundingBox();
    const c = await canvas(page).boundingBox();
    const x = Math.min(Math.max(b.x + b.width / 2, c.x + 40), c.x + c.width - 40), y = Math.min(Math.max(b.y + b.height / 2, c.y + 40), c.y + c.height - 40);
    await page.mouse.move(x, y); await page.mouse.wheel(0, -200); await pacedWait(page, 300);
  }
}
async function pressStrip(page) {          // a point on the strip well away from the label (a press there selects + moves it)
  const b = await page.locator(`[data-markup="${VERT.id}"] polygon`).first().boundingBox();
  const c = await canvas(page).boundingBox();
  const p = { x: b.x + b.width / 2, y: c.y + c.height * 0.45 };   // clear of the on-canvas start card and of the label
  return p;
}
const menuRow = (page, name) => page.getByText(name, { exact: true }).filter({ visible: true }).first();

test("easement label: area off by default, pull out, rotate upside down, persists, follows the easement, snap back, show area", async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page);
  await zoomIn(page);
  await expect(lab(page)).toBeAttached();
  let s = await info(page);
  expect(s.area, "area line must be OFF by default").toBe(false);
  expect(s.pulled).toBe(false);
  expect(s.leader).toBe(false);
  expect(s.texts).toHaveLength(1);

  // an UNSELECTED easement's label is the strip: clicking the label selects the easement (not eaten by the label)
  const hb0 = await hitBox(page);
  const c0 = centreOf(hb0);
  await page.mouse.click(c0.x, c0.y); await pacedWait(page, 350);
  await expect(page.getByTestId("markup-selected")).toHaveCount(1);

  // drag the label off the strip (selected easement → the press is the label's own)
  await drag(page, c0, { x: c0.x + 170, y: c0.y + 40 });
  s = await info(page);
  expect(s.pulled, "dragging the label must detach it").toBe(true);
  expect(s.leader, "a pulled-out label wears a leader to the strip").toBe(true);
  const hb1 = await hitBox(page);
  expect(centreOf(hb1).x).toBeGreaterThan(c0.x + 100);

  // rotate with the round grip: drag it below the label → upside down (free 360°, not folded upright)
  const grip = await page.locator("[data-easement-label-rotate]").first().boundingBox();
  const lc = centreOf(hb1);
  await drag(page, centreOf(grip), { x: lc.x, y: lc.y + 120 }, 16);
  s = await info(page);
  expect(Math.abs(s.angle), `label should be upside down, got ${s.angle}`).toBeGreaterThan(170);

  // PDF-PARITY: the REAL built sheet carries the pulled-out label, rotated as on screen, with its leader and dot —
  // and none of the editing chrome (hit target, outline, rotate grip)
  const screenXf = await lab(page).getAttribute("transform");
  const sheet = await page.evaluate(async () => {
    const markup = await window.__plannerExportSvg({ cx: 600, cy: 1100, wFt: 600, hFt: 400 });
    if (!markup) return null;
    const root = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
    const g = root.querySelector('[data-easement-label="ev"]');
    return g ? {
      xf: g.getAttribute("transform"), pulled: g.getAttribute("data-label-pulled"),
      leader: !!g.querySelector("[data-easement-leader] line") && !!g.querySelector("[data-easement-leader] circle"),
      chrome: root.querySelectorAll("[data-easement-label-hit],[data-easement-label-handles],[data-easement-label-rotate]").length,
    } : { missing: true };
  });
  expect(sheet, "export sheet could not be built").not.toBeNull();
  expect(sheet.missing, "the pulled-out label is missing from the printed sheet").toBeUndefined();
  expect(sheet.pulled).toBe("1");
  expect(sheet.leader, "leader line + dot must print").toBe(true);
  expect(sheet.chrome, "editing chrome must not print").toBe(0);
  const rot = (t) => parseFloat(/rotate\((-?[\d.]+)\)/.exec(t)[1]);
  expect(Math.abs(Math.abs(rot(sheet.xf)) - Math.abs(rot(screenXf)))).toBeLessThan(0.2);

  // saved with the plan: reload and it is still pulled out and upside down
  await pacedWait(page, 1800);
  await open(page);
  await zoomIn(page);
  s = await info(page);
  expect(s.pulled).toBe(true);
  expect(Math.abs(s.angle)).toBeGreaterThan(170);
  expect(s.leader).toBe(true);

  // move the EASEMENT: the label follows it (same offset) and the leader stays
  const polyBox = () => page.locator(`[data-markup="${VERT.id}"] polygon`).first().boundingBox();
  const before = centreOf(await hitBox(page)), pb0 = await polyBox();
  const sp = await pressStrip(page);
  await drag(page, sp, { x: sp.x - 90, y: sp.y + 30 });
  const after = centreOf(await hitBox(page)), pb1 = await polyBox();
  const mdx = pb1.x - pb0.x;                                   // the easement's real (grid-snapped) travel
  expect(Math.abs(mdx), "the easement itself must have moved").toBeGreaterThan(40);
  expect(Math.abs(after.x - before.x - mdx), "label must travel with the easement (same offset, within grid/stroke slop)").toBeLessThan(5);
  expect((await info(page)).leader).toBe(true);

  // right-click the pulled label → Snap back to strip
  const hb2 = centreOf(await hitBox(page));
  await page.mouse.click(hb2.x, hb2.y, { button: "right" }); await pacedWait(page, 300);
  await expect(menuRow(page, "Snap back to strip")).toBeVisible();
  await menuRow(page, "Snap back to strip").click(); await pacedWait(page, 400);
  s = await info(page);
  expect(s.pulled).toBe(false);
  expect(s.leader).toBe(false);
  expect(Math.abs(s.angle)).toBeCloseTo(90, 0);

  // right-click the INLINE label: Show area is offered, Snap back is disabled
  const hb3 = centreOf(await hitBox(page));
  await page.mouse.click(hb3.x, hb3.y, { button: "right" }); await pacedWait(page, 300);
  await expect(menuRow(page, "Show area")).toBeVisible();
  await expect(menuRow(page, "Snap back to strip")).toBeDisabled();
  await menuRow(page, "Show area").click(); await pacedWait(page, 400);
  s = await info(page);
  expect(s.area).toBe(true);
  expect(s.texts.length).toBe(2);
  expect(s.texts[1]).toMatch(/SF · .* AC/);

  await page.mouse.click(hb3.x, hb3.y, { button: "right" }); await pacedWait(page, 300);
  await menuRow(page, "Hide area").click(); await pacedWait(page, 400);
  expect((await info(page)).area).toBe(false);

  // a real double-click on the label opens the easement's Properties (the label never eats the gesture),
  // and the panel carries the same "Show area" choice, directly under the Map label box
  const hb4 = centreOf(await hitBox(page));
  await page.mouse.dblclick(hb4.x, hb4.y); await pacedWait(page, 500);
  await expect(page.getByTestId("easement-map-label")).toBeVisible();
  const box = page.getByLabel("Show area on label");
  await expect(box).not.toBeChecked();
  await box.check(); await pacedWait(page, 400);
  expect((await info(page)).area).toBe(true);
  await box.uncheck(); await pacedWait(page, 400);
  expect((await info(page)).area).toBe(false);
});
