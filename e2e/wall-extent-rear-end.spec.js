/* B2268801 (NEW-1 2026-11-03: the typed Length / Align / Full length are GONE from the edit box — a layer is shortened by dragging
 * its end handle, see wall-layer-handles.spec.js; this spec keeps what is still true) — rear / end wall layers: a new layer takes the length + position of
 * the layer before it, Trailer parking is offered on rear and end walls (and repeats), end walls are separate rows.
 * Real inspector, logged out. Measured on the saved model in the HOST's frame (rotation-proof), plus painted nodes.
 * Run: BASE_URL=http://localhost:4173 PW_CHROME=<chrome> npx playwright test e2e/wall-extent-rear-end.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, addWallLayer, dragWallLayerEnd, reopenBuildingPanel } from "./helpers.js";
import { canvas, startBlank } from "./drawKinds.js";

const plan = (page) => page.evaluate(() => {
  const map = JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return site.els || [];
});
const hostOf = async (page) => (await plan(page)).find((e) => e.type === "building" && !e.dogEar);
async function drawBldg(page, x1, y1, x2, y2) {
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + x1, box.y + y1); await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 12 }); await page.mouse.up();
}
async function openProps(page, id) {
  const pt = await page.evaluate((elId) => { const r = document.querySelector(`[data-el-id="${elId}"]`).querySelector("rect, path").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
  await page.mouse.dblclick(pt.x, pt.y);
  await expect(page.getByTestId("building-header")).toBeVisible();
}
const rotate = async (page, deg) => { const f = page.getByLabel("Rotation in degrees"); await f.fill(String(deg)); await f.press("Enter"); };
const rowByRole = (page, role) => page.locator(`[data-testid="wall-row"][data-role="${role}"]`);
const addLayer = addWallLayer;
async function boot(page, deg) {
  await startBlank(page);
  await drawBldg(page, 200, 260, 620, 400);
  await expect.poll(async () => !!(await hostOf(page))).toBe(true);
  const b = await hostOf(page);
  await openProps(page, b.id);
  if (deg) { await rotate(page, deg); await expect.poll(async () => Math.round((await hostOf(page)).rot)).toBe(deg); }
  return b;
}
// a kid's length + centre ALONG its wall, in the host's frame
const along = (host, side, k) => {
  const r = (host.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = k.cx - host.cx, dy = k.cy - host.cy, lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const rel = (((k.rot - host.rot) % 360) + 360) % 360, cross = Math.min(Math.abs(rel - 90), Math.abs(rel - 270)) < 45;
  const bx = cross ? k.h : k.w, by = cross ? k.w : k.h, horiz = side === "top" || side === "bottom";
  return { len: horiz ? bx : by, centre: horiz ? lx : ly, depth: horiz ? by : bx };
};
const kidsOn = async (page, hostId, side) => {
  const h = await hostOf(page);
  return (await plan(page)).filter((e) => e.attachedTo === hostId && !e.dogEar && !e.noFit && !e.truckCourt && (e.sidewalkSide === side || e.stackSide === side || e.sideParkSide === side
    || (() => { const r = (h.rot * Math.PI) / 180, dx = e.cx - h.cx, dy = e.cy - h.cy, lx = dx * Math.cos(r) + dy * Math.sin(r), ly = -dx * Math.sin(r) + dy * Math.cos(r);
        const ox = Math.abs(lx) - h.w / 2, oy = Math.abs(ly) - h.h / 2; const s2 = oy >= ox ? (ly >= 0 ? "bottom" : "top") : (lx >= 0 ? "right" : "left"); return s2 === side; })()));
};
const openPiece = async (page, row, i) => {
  const p = row.getByTestId("wall-piece").nth(i);
  await p.click();
  if (!(await page.getByTestId("wall-edit-box").isVisible())) await p.click();
};

test.beforeEach(async ({ page }) => { await armPlannerHooks(page); });

for (const deg of [0, 315]) {
  test(`rot ${deg} · rear wall: Walk shortened by its handle, then Trailer ×2 and a Buffer all take its length + position; trailer parking is on offer`, async ({ page }) => {
    const b = await boot(page, deg);
    const rear = rowByRole(page, "rear");
    const side = await rear.getAttribute("data-sides");
    await addLayer(rear, "sidewalk");
    await expect(rear.getByTestId("wall-piece")).toHaveCount(1);
    // the edit box has NO length controls
    await openPiece(page, rear, 0);
    for (const id of ["wall-extent", "wall-extent-len", "wall-extent-full", "wall-align-start", "wall-align-centre", "wall-align-end"]) await expect(page.getByTestId(id)).toHaveCount(0);
    await page.keyboard.press("Escape");
    // first layer against the wall = full length; shorten the Walk from its far end with the handle
    const host0 = await hostOf(page);
    const walk0 = (await kidsOn(page, b.id, side)).find((k) => k.type === "sidewalk");
    const full = along(host0, side, walk0).len;
    expect(full).toBeGreaterThan(100);
    await dragWallLayerEnd(page, host0, side, walk0, "plus", 60);
    await expect.poll(async () => { const h = await hostOf(page); const w = (await kidsOn(page, b.id, side)).find((k) => k.type === "sidewalk"); return Math.round(along(h, side, w).len); }).toBeLessThan(Math.round(full) - 30);
    const host = await hostOf(page);
    const walk = (await kidsOn(page, b.id, side)).find((k) => k.type === "sidewalk");
    const wa = along(host, side, walk);
    expect(wa.centre).toBeCloseTo(-(full - wa.len) / 2, 0);              // the start end held, the dragged end pulled in
    await reopenBuildingPanel(page, host);

    // Trailer parking is offered on a rear wall — in the ▾ list, twice — then a buffer
    await rear.getByTestId("wall-add-more").click();
    await expect(page.getByTestId("wall-add-trailer")).toBeVisible();
    await page.getByTestId("wall-add-trailer").click();
    await addLayer(rear, "trailer");
    await addLayer(rear, "buffer");
    expect(await rear.getByTestId("wall-piece").evaluateAll((n) => n.map((x) => x.getAttribute("data-kind")))).toEqual(["sidewalk", "trailer", "trailer", "buffer"]);
    const h2 = await hostOf(page);
    const kids = await kidsOn(page, b.id, side);
    const ts = kids.filter((k) => k.type === "trailer"), buf = kids.find((k) => k.type === "landscape" && !k.sidewalkSide);
    expect(ts).toHaveLength(2);
    for (const z of [...ts, buf]) {
      const a = along(h2, side, z);
      expect(a.len).toBeCloseTo(wa.len, 0); expect(a.centre).toBeCloseTo(wa.centre, 0);
    }
    expect(ts.every((t) => t.wallTrailer && Math.round(along(h2, side, t).depth) === 50)).toBe(true);   // default trailer depth, nothing copied
    // each layer's own length changes alone: drag one trailer's end
    const tFirst = ts[0];
    await dragWallLayerEnd(page, h2, side, tFirst, "plus", 40);
    await expect.poll(async () => { const h = await hostOf(page); const t = (await kidsOn(page, b.id, side)).filter((k) => k.type === "trailer"); return t.map((x) => Math.round(along(h, side, x).len)).sort((p, q) => p - q); }).not.toEqual(ts.map((x) => Math.round(wa.len)));
    const h3 = await hostOf(page);
    const after3 = (await kidsOn(page, b.id, side)).filter((k) => k.type === "trailer").map((x) => Math.round(along(h3, side, x).len)).sort((p, q) => p - q);
    expect(after3[0]).toBeLessThan(Math.round(wa.len) - 10); expect(after3[1]).toBe(Math.round(wa.len));
    if (process.env.SHOTS) { await page.keyboard.press("Escape"); const f = page.getByTitle(/zoom to fit|fit to/i).first(); if (await f.count()) await f.click().catch(() => {}); await page.waitForTimeout(900); }
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/rear-wall-rot${deg}.png` });
    // every layer paints; survives a reload
    for (const k of await kidsOn(page, b.id, side)) await expect(page.locator(`[data-el-id="${k.id}"]`)).toHaveCount(1);
    await page.reload();
    await expect.poll(async () => (await kidsOn(page, b.id, side)).length).toBe(4);
    const h4 = await hostOf(page);
    const after = (await kidsOn(page, b.id, side)).filter((k) => k.type === "trailer").map((x) => Math.round(along(h4, side, x).len)).sort((p, q) => p - q);
    expect(after).toEqual(after3);
  });
}

test("each end wall is separate: shortening one end's layer leaves the other end full; end layers inherit; bump-outs keep the span", async ({ page }) => {
  const b = await boot(page, 315);
  const ends = rowByRole(page, "ends");
  await expect(ends).toHaveCount(2);
  const sides = [await ends.nth(0).getAttribute("data-sides"), await ends.nth(1).getAttribute("data-sides")];
  await addLayer(ends.nth(0), "buffer"); await addLayer(ends.nth(1), "buffer");
  const h0 = await hostOf(page);
  const buf00 = (await kidsOn(page, b.id, sides[0])).find((k) => k.type === "landscape");
  const full = along(h0, sides[0], buf00).len;
  await dragWallLayerEnd(page, h0, sides[0], buf00, "minus", 60);          // pull the START end in; the END stays
  await expect.poll(async () => { const h = await hostOf(page); const k = (await kidsOn(page, b.id, sides[0])).find((x) => x.type === "landscape"); return Math.round(along(h, sides[0], k).len); }).toBeLessThan(Math.round(full) - 30);
  await reopenBuildingPanel(page, await hostOf(page));
  await addLayer(ends.nth(0), "trailer");                                // inherits the shorter length, held at the end
  const h = await hostOf(page);
  const k0 = await kidsOn(page, b.id, sides[0]), k1 = await kidsOn(page, b.id, sides[1]);
  const buf0 = k0.find((k) => k.type === "landscape"), tr0 = k0.find((k) => k.type === "trailer"), buf1 = k1.find((k) => k.type === "landscape");
  const a0 = along(h, sides[0], buf0), at = along(h, sides[0], tr0), a1 = along(h, sides[1], buf1);
  expect(a0.len).toBeLessThan(full - 30);
  expect(a0.centre + a0.len / 2).toBeCloseTo(full / 2, 0);                // the dragged-from end moved; the other end stayed on the wall's end
  expect(at.len).toBeCloseTo(a0.len, 0); expect(at.centre).toBeCloseTo(a0.centre, 0);
  expect(a1.len).toBeGreaterThan(a0.len + 10);                          // the other end is untouched (still the full wall)
  // a bump-out lengthens an end wall: the layers re-derive without losing their extents
  await page.locator('[data-testid="picker-corner-add"]').first().click({ force: true });
  await expect.poll(async () => (await plan(page)).filter((e) => e.dogEar).length).toBeGreaterThan(0);
  const h2 = await hostOf(page);
  for (const [s, k] of [[sides[0], buf0], [sides[0], tr0]]) {
    const cur = (await plan(page)).find((e) => e.id === k.id);
    expect(along(h2, s, cur).len).toBeCloseTo(a0.len, 0);
  }
  await page.reload();
  await expect.poll(async () => (await kidsOn(page, b.id, sides[0])).length).toBeGreaterThanOrEqual(2);
});
