/* NEW-1 — "Fit the biggest building": the planner's APPLY path, driven on the real canvas. The owner gate keeps the Fit button off for every test
 * account (and the search itself is proven in test/fitBuilding.test.js + ui-audit/verify-fit-building.mjs), so this spec drives the two doors the
 * controller uses — `source` (what the plan holds) and `apply` (the answer going back) — through the E2E-gated `window.__plannerFit`:
 *   1  a drawn cross-dock with its dock stack + car parking is RESIZED, MOVED and TURNED to a candidate box through the planner's own refitChildren: the building
 *      takes the box and a typed finished floor, and every bonded piece (courts, trailer rows, parking, walks) is re-laid with it — none left behind
 *   2  ONE Ctrl+Z puts the building and every piece back exactly (one undo step)
 *   3  with NO building on the plan, apply creates a cross-dock — building + a court, trailer row and buffer on each long side — selected, in one undo step
 * Run: BASE_URL=http://localhost:4173 PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/fit-building-apply.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, openModule, panelPlus } from "./helpers.js";

const rawEls = (page) => page.evaluate(() => {
  const map = JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
  return (map[Object.keys(map)[0]] || {}).els || [];
});
const rot = (x, y, deg) => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c }; };

async function drawBuilding(page) {
  await page.getByTestId("map-toolbar-draw").first().click();
  const svg = page.getByTestId("planner-canvas");
  await expect(svg).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const box = await svg.boundingBox();
  const x0 = box.x + box.width * 0.3, y0 = box.y + box.height * 0.38, x1 = box.x + box.width * 0.62, y1 = box.y + box.height * 0.56;
  await page.mouse.move(x0, y0); await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await page.mouse.move(x1, y1, { steps: 6 }); await page.mouse.up();
}

test.describe("Fit the biggest building — Use this (logged out)", () => {
  test("an existing building is resized / moved / turned with its whole assembly, as one undo step", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await armPlannerHooks(page);
    await page.goto("/");
    await openModule(page, "site-planner");
    await drawBuilding(page);
    await page.getByRole("button", { name: /^Properties$/ }).click();
    for (const [label, times] of [["Dock zones", 2], ["Car parking", 1]]) for (let i = 0; i < times; i++) { await panelPlus(page, label).click(); await page.waitForTimeout(300); }
    await page.waitForTimeout(900);

    const before = await rawEls(page);
    const b0 = before.find((e) => e.type === "building" && !e.attachedTo);
    const kids0 = before.filter((e) => e.attachedTo === b0.id);
    expect(kids0.length).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate((id) => { const s = window.__plannerFit.source(id); return { has: !!s.building, kids: s.kids.length, roads: s.roads.length }; }, b0.id)).toMatchObject({ has: true });

    // a candidate: 1.5× longer, 1.2× deeper, moved 500 ft east / 300 ft south, turned to 30°
    const cand = { ffe: 101.26, box: { cx: b0.cx + 500, cy: b0.cy + 300, w: Math.round(b0.w * 1.5), h: Math.round(b0.h * 1.2), rot: 30 } };
    await page.evaluate(([c, id]) => window.__plannerFit.apply(c, { buildingId: id }), [cand, b0.id]);
    await page.waitForTimeout(1200);

    const after = await rawEls(page);
    const b1 = after.find((e) => e.id === b0.id);
    expect(b1).toMatchObject({ cx: cand.box.cx, cy: cand.box.cy, w: cand.box.w, h: cand.box.h });
    expect(((b1.rot % 360) + 360) % 360).toBeCloseTo(30, 3);
    expect(b1.padElevFt).toBe(101.5);                               // the nearest half foot, typed
    expect(b1.ffeBasis).toBe("typed");
    expect(after.length).toBe(before.length);                      // nothing added, nothing lost
    // every bonded piece moved WITH the building: its centre, in the building's OWN (turned) frame, lies within the footprint plus the stack / parking reach
    // beside it (courts + trailer rows are ≤ ~200 ft deep, car rows ≤ ~125) — a piece left at the old spot is 580 ft away and far outside this box
    for (const k of after.filter((e) => e.attachedTo === b0.id)) {
      const l = rot(k.cx - b1.cx, k.cy - b1.cy, -30);
      expect(Math.abs(l.x), `${k.type} ${k.id} stayed behind (local x ${Math.round(l.x)})`).toBeLessThanOrEqual(b1.w / 2 + 260);
      expect(Math.abs(l.y), `${k.type} ${k.id} stayed behind (local y ${Math.round(l.y)})`).toBeLessThanOrEqual(b1.h / 2 + 260);
    }
    // the same test, red on purpose: the OLD positions are all outside that box (so the check above can fail)
    expect(kids0.some((k) => { const l = rot(k.cx - b1.cx, k.cy - b1.cy, -30); return Math.abs(l.x) > b1.w / 2 + 260 || Math.abs(l.y) > b1.h / 2 + 260; })).toBe(true);
    // the dock courts run the NEW length along their wall and carry the new rotation
    for (const k of after.filter((e) => e.attachedTo === b0.id && e.truckCourt)) {
      const rel = (((k.rot - 30) % 180) + 180) % 180;
      expect(Math.min(rel, 180 - rel)).toBeLessThan(0.5);
      expect(Math.max(k.w, k.h)).toBeGreaterThan(b1.w * 0.8);
    }
    // a court sits flush against a long wall of the TURNED building
    const court = after.find((e) => e.attachedTo === b0.id && e.truckCourt);
    const loc = rot(court.cx - b1.cx, court.cy - b1.cy, -30);
    expect(Math.abs(Math.abs(loc.y) - (b1.h / 2 + Math.min(court.w, court.h) / 2))).toBeLessThan(1.5);

    // ONE undo step puts every piece back
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(900);
    const undone = await rawEls(page);
    const key = (e) => `${e.id}:${Math.round(e.cx * 10)}:${Math.round(e.cy * 10)}:${Math.round(e.w * 10)}:${Math.round(e.h * 10)}:${Math.round((e.rot || 0) * 10)}`;
    expect(undone.map(key).sort()).toEqual(before.map(key).sort());
    expect(undone.find((e) => e.id === b0.id).padElevFt ?? null).toBe(b0.padElevFt ?? null);
    expect(errors).toEqual([]);
  });

  test("with NO building on the plan, Use this creates a cross-dock — building + court + trailer row + buffer on each long side — as one undo step", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await armPlannerHooks(page);
    await page.goto("/");
    await openModule(page, "site-planner");
    await page.getByTestId("map-toolbar-draw").first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 15000 });
    const before = await rawEls(page);
    expect(before.filter((e) => e.type === "building").length).toBe(0);
    expect(await page.evaluate(() => window.__plannerFit.source(null).building)).toBeNull();

    await page.evaluate(() => window.__plannerFit.apply({ ffe: 100, box: { cx: 0, cy: 0, w: 784, h: 560, rot: 12 } }, { buildingId: null }));
    await page.waitForTimeout(1200);
    const after = await rawEls(page);
    const b = after.find((e) => e.type === "building");
    expect(b).toMatchObject({ cx: 0, cy: 0, w: 784, h: 560, dock: "cross", dockAxis: "x", padElevFt: 100, ffeBasis: "typed" });
    const kids = after.filter((e) => e.attachedTo === b.id);
    expect(kids.filter((e) => e.truckCourt).length).toBe(2);
    expect(kids.filter((e) => e.type === "trailer").length).toBe(2);
    expect(kids.filter((e) => e.type === "landscape").length).toBe(2);
    // the two courts are on opposite long walls of the turned building, flush
    const locs = kids.filter((e) => e.truckCourt).map((c) => rot(c.cx - b.cx, c.cy - b.cy, -12).y);
    expect(Math.min(...locs)).toBeLessThan(0); expect(Math.max(...locs)).toBeGreaterThan(0);

    await page.keyboard.press("Control+z");
    await page.waitForTimeout(900);
    expect((await rawEls(page)).length).toBe(0);                    // the building AND its six pieces are one step
    expect(errors).toEqual([]);
  });
});
