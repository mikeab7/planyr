/* NEW-2 — Parcel & setback styling: boundary (colour · weight · dashed), setback line (same three, its own
 * layer) and dimension labels (show · colour · size in pt), at two scopes — "All parcels (workspace default)"
 * and "This parcel only".
 *
 * Runs signed-out and offline of any GIS: the workspace default then lives in the on-device mirror and the UI
 * must SAY so (the account write is the signed-in live check). What this proves in a real browser:
 *   · per-parcel edits repaint the canvas on every input event and touch only that parcel
 *   · the workspace default restyles every parcel that does not override, survives a reload
 *   · "Reset to workspace default" clears the override (the parcel inherits again)
 *   · weight is SCREEN pixels — the stroke width does not change when the view zooms
 *   · the setback ring is its own layer with its own style; dimension labels honour show/colour/size
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const site = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return map[Object.keys(map)[0]] || {};
});
const parcels = async (page) => (await site(page)).parcels || [];

async function startBlank(page) {
  await page.goto("/");
  await openModule(page, "site-planner");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}
async function drawParcel(page, n, pts) {
  const landOpen = (await page.getByTestId("parcels-panel").count()) + (await page.getByTestId("parcel-page").count()) + (await page.getByRole("button", { name: /Draw a (new boundary|parcel)/i }).count());
  if (!landOpen) await page.locator('[data-rail-tab="parcel"]').click(); // the rail tab toggles — never close an open Land panel
  const toList = page.getByRole("button", { name: /All parcels/ });
  if (await toList.count()) await toList.first().click(); // a parcel's own page may be open
  const addLandBtn = page.getByTestId("land-add-btn").or(page.getByTitle(/Add land to this plan/i)).first();
  if ((await addLandBtn.count()) && !(await page.getByRole("button", { name: /Draw a (new boundary|parcel)/i }).count())) await addLandBtn.click();
  await page.getByRole("button", { name: /Draw a (new boundary|parcel)/i }).click();
  const box = await canvas(page).boundingBox();
  const ring = pts.map(([x, y]) => [box.x + x, box.y + y]);
  for (const [x, y] of ring) { await page.mouse.click(x, y); await page.waitForTimeout(60); }
  await page.mouse.click(ring[0][0], ring[0][1]);
  await expect.poll(async () => (await parcels(page)).length).toBeGreaterThanOrEqual(n);
  await page.keyboard.press("Escape");
}
const outline = (page, id) => page.locator(`[data-feature="parcel:${id}"] [data-testid="parcel-outline"]`);
const ring = (page) => page.getByTestId("setback-ring");
async function openPage(page, id) {
  const back = page.getByRole("button", { name: /All parcels/ });
  if (await back.count()) await back.first().click();
  await page.getByTestId(`parcel-row-${id}`).click();
  await expect(page.getByTestId("parcel-style-panel")).toBeVisible();
}
const setRange = (loc, v) => loc.evaluate((el, val) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(el, String(val)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
}, v);
const T = (page, id) => page.getByTestId(id);

test("per-parcel styling, workspace default, inheritance, reset — and weight is constant screen pixels", async ({ page }) => {
  await startBlank(page);
  await drawParcel(page, 1, [[220, 150], [480, 150], [480, 360], [220, 360]]);
  await drawParcel(page, 2, [[520, 220], [650, 220], [650, 330], [520, 330]]); // inside the first lot's frame — the view re-fits after a draw
  const [a, b] = await parcels(page);
  await openPage(page, a.id);

  // scope selector: both scopes offered with a parcel open; defaults to "This parcel only"
  await expect(T(page, "parcel-style-panel")).toHaveAttribute("data-scope", "parcel");
  await expect(T(page, "parcel-style-scope-parcel")).toBeEnabled();

  // ---- boundary: colour · weight · dashed, live on every input event
  await T(page, "look-boundary-color").fill("#ff0000");
  await expect(outline(page, a.id)).toHaveAttribute("stroke", "#ff0000");
  await expect(outline(page, b.id)).not.toHaveAttribute("stroke", "#ff0000"); // the other parcel is untouched
  await setRange(T(page, "look-boundary-weight"), 4);
  await expect(outline(page, a.id)).toHaveAttribute("stroke-width", /^(4|3)$/); // selected lines draw at least 3
  await expect.poll(async () => +(await outline(page, a.id).getAttribute("stroke-width"))).toBeGreaterThanOrEqual(4);
  await T(page, "look-boundary-dashed").click();
  await expect(outline(page, a.id)).toHaveAttribute("stroke-dasharray", /\d/);
  await expect.poll(async () => (await parcels(page)).find((p) => p.id === a.id)).toMatchObject({ stroke: "#ff0000", weight: 4, dash: "dashed" }); // autosave lands it on device

  // ---- weight is screen pixels: zoom the view in, the stroke width does not move
  const w0 = await outline(page, a.id).getAttribute("stroke-width");
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(120); }
  await page.waitForTimeout(400);
  expect(await outline(page, a.id).getAttribute("stroke-width")).toBe(w0);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(120); }
  await page.waitForTimeout(400);
  expect(await outline(page, a.id).getAttribute("stroke-width")).toBe(w0);

  // ---- setback line: its own layer, its own style (dashed by default)
  const sb = ring(page).first();
  await expect(sb).toBeVisible();
  await T(page, "look-setback-color").fill("#0000ff");
  await expect(sb).toHaveAttribute("stroke", "#0000ff");
  await expect(sb).toHaveAttribute("stroke-dasharray", /\d/);
  await T(page, "look-setback-dashed").click(); // off
  await expect(sb).not.toHaveAttribute("stroke-dasharray", /./);
  await setRange(T(page, "look-setback-weight"), 3);
  await expect(sb).toHaveAttribute("stroke-width", "3");
  expect((await outline(page, a.id).getAttribute("stroke"))).toBe("#ff0000"); // boundary independent of the setback

  // ---- dimension labels: show · colour · size (pt)
  await expect(T(page, "parcel-edge-dim").first()).toBeVisible();
  await setRange(T(page, "look-labels-size"), 16);
  await expect(T(page, "parcel-edge-dim").first()).toHaveAttribute("font-size", /^21\.33/);
  await T(page, "look-labels-color").fill("#00aa00");
  await expect(T(page, "parcel-edge-dim").first()).toHaveAttribute("fill", "#00aa00");
  await T(page, "look-labels-show").click();
  await expect(T(page, "parcel-edge-dim")).toHaveCount(0);
  await T(page, "look-labels-show").click();
  await expect(T(page, "parcel-edge-dim").first()).toBeVisible();

  // ---- workspace default: restyles every parcel without an override, never the one that has its own
  await T(page, "parcel-style-scope-default").click();
  await expect(T(page, "parcel-style-panel")).toHaveAttribute("data-scope", "default");
  await T(page, "look-boundary-color").fill("#00ff00");
  await expect(outline(page, b.id)).toHaveAttribute("stroke", "#00ff00");
  await expect(outline(page, a.id)).toHaveAttribute("stroke", "#ff0000"); // its own override still wins
  // signed out: the notice says it lives on this computer (never a false "saved to your account")
  await expect(page.getByText(/saved on this computer only/i).first()).toBeVisible({ timeout: 8000 });

  // ---- reset to workspace default clears the override → the parcel inherits
  await T(page, "parcel-style-scope-parcel").click();
  await expect(T(page, "parcel-look-reset")).toBeEnabled();
  await T(page, "parcel-look-reset").click();
  await expect(outline(page, a.id)).toHaveAttribute("stroke", "#00ff00");
  await expect(T(page, "parcel-look-reset")).toBeDisabled();
  await expect.poll(async () => {
    const c = (await parcels(page)).find((p) => p.id === a.id) || {};
    return ["stroke", "weight", "dash", "sbStroke", "sbWeight", "sbDash", "dimShow", "dimColor", "dimSize"].filter((k) => (c[k] ?? null) !== null);
  }).toEqual([]);

  // ---- the workspace default survives a reload
  await page.waitForTimeout(700); // past the trailing write
  await page.reload();
  await openModule(page, "site-planner");
  await expect(outline(page, b.id)).toHaveAttribute("stroke", "#00ff00", { timeout: 15_000 });
});
