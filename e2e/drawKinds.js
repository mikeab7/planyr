/* drawKinds — one of EACH of the five drawn kinds, through the real tools (NEW-2).
 *
 * Lifted out of `clipboard-survives-plan-switch.spec.js` unchanged so a second spec can seed the
 * same canvas without a second copy of five draw flows. The flows are fiddly for real reasons —
 * a blank callout is discarded, a parcel opens a docked panel over the canvas, an unfilled shape is
 * selected by its outline and not its middle — and those reasons do not want re-learning per spec.
 *
 * Every flow POLLS the persisted record until the object is actually there, so a spec that builds
 * on them starts from a proven state rather than from a hopeful `waitForTimeout`.
 */
import { expect } from "@playwright/test";

export const canvas = (p) => p.getByTestId("planner-canvas");
export const planCrumb = (p) => p.getByTestId("plan-crumb");

/* Every plan of the site, by name, straight off disk. */
export function plans(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const out = {};
    for (const rec of Object.values(map)) {
      if (!rec || !rec.id) continue;
      out[rec.name || "?"] = {
        els: (rec.els || []).filter((e) => !e.attachedTo).length,
        markups: (rec.markups || []).length,
        markupKinds: (rec.markups || []).map((m) => m.kind).sort(),
        measures: (rec.measures || []).length,
        callouts: (rec.callouts || []).length,
        parcels: (rec.parcels || []).length,
      };
    }
    return out;
  });
}
export const planNamed = async (page, name) => (await plans(page))[name] || null;

export const selectTool = async (page) => {
  const b = page.getByRole("button", { name: /^Select V$/ });
  await b.click();
  await expect(b).toHaveAttribute("aria-pressed", "true");
};

export async function startBlank(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const tab = page.getByTestId("module-tab-site-planner").filter({ visible: true });
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  await expect(async () => {
    await tab.click({ timeout: 3_000 });
    await expect(tab).toHaveAttribute("aria-current", "page", { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  // NEW-1 — "Start blank" is the secondary option behind the "Select parcels" split button's caret.
  await page.getByTestId("map-start-blank-menu-btn").first().click();
  await page.getByTestId("map-start-blank-menu-item").first().click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
}

const settled = (page, plan, field, n) =>
  expect.poll(() => planNamed(page, plan).then((p) => p && p[field]), { timeout: 15_000 }).toBe(n);

/* The owner's own case: a markup POLYGON. Click three corners, double-click to close. */
export async function drawPolygonMarkup(page, box, { plan = "Concept A", expect: n = 1 } = {}) {
  await page.keyboard.press("Shift+P");
  const pts = [[0.30, 0.30], [0.46, 0.30], [0.46, 0.46]];
  for (const [fx, fy] of pts) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(90);
  }
  await page.mouse.dblclick(box.x + box.width * 0.30, box.y + box.height * 0.46);
  await settled(page, plan, "markups", n);
  await selectTool(page);
}

export async function drawBuilding(page, box, { plan = "Concept A", expect: n = 1 } = {}) {
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const x0 = box.x + box.width * 0.58, y0 = box.y + box.height * 0.28;
  const x1 = box.x + box.width * 0.76, y1 = box.y + box.height * 0.44;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 6 });
  await page.mouse.up();
  await settled(page, plan, "els", n);
  await selectTool(page);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export async function drawLengthMeasure(page, box, { plan = "Concept A", expect: n = 1 } = {}) {
  await page.getByRole("button", { name: "Measure modes" }).click();
  await page.getByRole("button", { name: "Length", exact: true }).click();
  const y = box.y + box.height * 0.62;
  await page.mouse.click(box.x + box.width * 0.30, y);
  await page.mouse.click(box.x + box.width * 0.46, y);
  await settled(page, plan, "measures", n);
  await selectTool(page);
  return { cx: box.x + box.width * 0.38, cy: y };
}

/* A callout is committed by its TEXT — a blank one is discarded — so type before leaving. Escape
 * inside the editor commits (it is the Bluebeam finish gesture), it does not cancel. */
export async function drawCallout(page, box, { plan = "Concept A", expect: n = 1, text = "Copy me" } = {}) {
  await page.keyboard.press("q");
  await page.mouse.click(box.x + box.width * 0.60, box.y + box.height * 0.62);
  await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.70);
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await settled(page, plan, "callouts", n);
  await selectTool(page);
  return { cx: box.x + box.width * 0.72, cy: box.y + box.height * 0.70 };
}

export async function drawParcel(page, box, { plan = "Concept A", expect: n = 1 } = {}) {
  await page.locator('[data-rail-tab="parcel"]').click();
  await page.getByTitle(/Add land to this plan/i).click();
  await page.getByRole("button", { name: /Draw a new boundary/i }).click();
  await expect(page.getByText(/drop boundary points/i)).toBeVisible();
  // Kept clear of the left rail's docked panel (which the Parcel tool opens over the canvas's
  // left edge) and of everything else already drawn.
  const L = Math.round(box.x + box.width * 0.34), R = Math.round(box.x + box.width * 0.52);
  const T = Math.round(box.y + box.height * 0.72), B = Math.round(box.y + box.height * 0.90);
  for (const [x, y] of [[L, T], [R, T], [R, B], [L, B]]) { await page.mouse.click(x, y); await page.waitForTimeout(90); }
  await page.mouse.click(L, T);
  await settled(page, plan, "parcels", n);
  await page.keyboard.press("Escape");
  await selectTool(page);
  // Collapse the panel the Parcel tool opened, so it can't sit over the canvas we click next.
  await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="left-menu-panel"]');
    const lit = panel && panel.previousElementSibling && panel.previousElementSibling.querySelector('button[aria-pressed="true"]');
    if (lit) lit.click();
  });
  return { edge: { cx: (L + R) / 2, cy: T } };
}

/** Draw one of every kind on the current plan, in an order that keeps them out of each other's way. */
export async function drawOneOfEachKind(page, box, opts = {}) {
  await drawPolygonMarkup(page, box, opts);
  await drawBuilding(page, box, opts);
  await drawLengthMeasure(page, box, opts);
  await drawCallout(page, box, opts);
  await drawParcel(page, box, opts);
}
