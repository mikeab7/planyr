/* NEW-1 / NEW-2 / NEW-3 (2026-11-04) — recurrence + amendment of B2641728. Owner, on Grand Port: on the non-dock side, after
 * employee parking, the Docks & walls add button offered a BUFFER and never more parking; the sidewalk read "Walk"; and he wanted
 * icons on the add control instead of words.
 *
 * THE LAST HARNESS (V2086400 step 4) ASSERTED THE DESIGNED SEQUENCE, so it passed 53/53 while the real gap stayed open. This one
 * drives a REAL BUILD-UP and READS GEOMETRY instead of asserting a sequence: sidewalk → parking → more rows to eight → a buffer →
 * more parking, and after EVERY click it reads, from the stored plan, each layer's interval along the wall's outward normal (no
 * two may overlap, the buffer must stay outermost) and the parking's row + stall count (against the pure carStalls), and from the
 * map the rendered parking node. The WALL-STATE MATRIX then drives each state a wall can be in and compares what the panel
 * offers with an INDEPENDENT list of the layers that could sensibly go there (not derived from the code under test).
 *
 * Run: BASE_URL=http://127.0.0.1:4173 npx playwright test e2e/wall-parking-buildup.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, addWallLayer } from "./helpers.js";
import { canvas, startBlank } from "./drawKinds.js";
import { carStalls } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import { parkRowsForDepth } from "../src/workspaces/site-planner/lib/parking.js";

const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const rot2 = (x, y, deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return { x: x * c - y * s, y: x * s + y * c }; };
const planRec = (page) => page.evaluate(() => {
  const map = JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
  return map[Object.keys(map)[0]] || {};
});
const hostOf = async (page) => ((await planRec(page)).els || []).find((e) => e.type === "building" && !e.dogEar);
async function drawBldg(page) {
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + 200, box.y + 260); await page.mouse.down();
  await page.mouse.move(box.x + 620, box.y + 400, { steps: 12 }); await page.mouse.up();
}
async function boot(page, deg) {
  await startBlank(page);
  await drawBldg(page);
  await expect.poll(async () => !!(await hostOf(page))).toBe(true);
  const b = await hostOf(page);
  const pt = await page.evaluate((id) => { const r = document.querySelector(`[data-el-id="${id}"]`).querySelector("rect, path").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, b.id);
  await page.mouse.dblclick(pt.x, pt.y);
  await expect(page.getByTestId("building-header")).toBeVisible();
  if (deg) { const f = page.getByLabel("Rotation in degrees"); await f.fill(String(deg)); await f.press("Enter"); await expect.poll(async () => Math.round((await hostOf(page)).rot)).toBe(deg); }
  return b;
}
const rowByRole = (page, role) => page.locator(`[data-testid="wall-row"][data-role="${role}"]`);
const lead = (row) => row.getByTestId("wall-add");
const leadKind = async (row) => ((await lead(row).count()) ? lead(row).getAttribute("data-kind") : null);
const moreKinds = async (row) => {
  if (!(await row.getByTestId("wall-add-more").count())) return [];
  await row.getByTestId("wall-add-more").click();
  const menu = row.page().getByTestId("wall-add-menu");
  await expect(menu).toBeVisible();
  const ks = await menu.getByRole("menuitem").evaluateAll((n) => n.map((x) => (x.getAttribute("data-testid") || "").replace("wall-add-", "")));
  await row.page().keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  return ks;
};
const offered = async (row) => { const l = await leadKind(row); return l ? [l, ...(await moreKinds(row))] : []; };
const kinds = (row) => row.getByTestId("wall-piece").evaluateAll((n) => n.map((x) => x.getAttribute("data-kind")));

/* The stored layers on one wall, each as an interval along the wall's OUTWARD normal (feet from the wall face), read from the
 * plan record — the AABB of the rotated box in the host's frame, exact for these quarter-turn-to-host children. */
async function wallLayers(page, side) {
  const rec = await planRec(page), els = rec.els || [], b = els.find((e) => e.type === "building" && !e.dogEar);
  const [nx, ny] = SIDE_N[side], isH = ny !== 0, sg = isH ? ny : nx, face = (isH ? b.h : b.w) / 2;
  const out = [];
  for (const x of els) {
    if (x.attachedTo !== b.id || x.dogEar || x.points || !["sidewalk", "landscape", "parking", "paving", "road", "trailer"].includes(x.type)) continue;
    if (x.truckCourt || x.forCourt || x.forTrailer) continue;
    const l = rot2(x.cx - b.cx, x.cy - b.cy, -b.rot);
    const rel = ((((x.rot || 0) - b.rot) % 360) + 360) % 360, cross = Math.min(Math.abs(rel - 90), Math.abs(rel - 270)) < 45;
    const dimX = cross ? x.h : x.w, dimY = cross ? x.w : x.h, depth = isH ? dimY : dimX, mid = sg * (isH ? l.y : l.x) - face;
    // only the wall's own layers: centre must sit on this side of the wall
    if (mid + face < 0) continue;
    const alongC = isH ? l.x : l.y, run = isH ? dimX : dimY;
    if (Math.abs(alongC) > ((isH ? b.w : b.h) / 2 + run)) continue;
    out.push({ id: x.id, type: x.type, buffer: x.type === "landscape" && !x.sidewalkSide, lo: mid - depth / 2, hi: mid + depth / 2, depth, el: x });
  }
  return out.sort((a, c) => a.lo - c.lo);
}
/* the invariant after EVERY click: no two layers overlap along the normal; a buffer / road is never inboard of a parking field */
function assertNoOverlap(layers, where) {
  for (let i = 1; i < layers.length; i++) {
    expect(layers[i].lo, `${where}: ${layers[i - 1].type} [${layers[i - 1].lo.toFixed(1)},${layers[i - 1].hi.toFixed(1)}] vs ${layers[i].type} [${layers[i].lo.toFixed(1)},${layers[i].hi.toFixed(1)}] overlap`).toBeGreaterThanOrEqual(layers[i - 1].hi - 0.5);
  }
  const park = layers.filter((l) => l.type === "parking" || (l.type === "paving" && l.el.sideParkSide));
  const flush = layers.filter((l) => l.buffer || l.type === "road");
  for (const f of flush) for (const p of park) expect(f.lo, `${where}: a ${f.type} sits inboard of the parking`).toBeGreaterThanOrEqual(p.hi - 0.5);
}
async function parkingFacts(page, side) {
  const rec = await planRec(page), layers = await wallLayers(page, side), s = rec.settings || {};
  const pads = layers.filter((l) => l.type === "parking" || (l.type === "paving" && l.el.sideParkSide));
  const rows = pads.reduce((t, p) => t + (p.type === "parking" ? parkRowsForDepth(p.el.h, (p.el.cfg || {}).stallDepth || s.stallDepth, (p.el.cfg || {}).aisle ?? s.aisle) : 0), 0);
  const stalls = pads.filter((p) => p.type === "parking").reduce((t, p) => t + carStalls(p.el.w, p.el.h, { ...s, ...(p.el.cfg || {}) }).count, 0);
  return { rows, stalls, pads: pads.length };
}
/* what the PANEL shows for the wall's parking, and what the MAP renders for it */
async function panelRows(row) {
  const piece = row.locator('[data-testid="wall-piece"][data-kind="parking"]');
  if (!(await piece.count())) return 0;
  return Number(/(\d+) rows?/.exec(await piece.getAttribute("aria-label"))[1]);
}
const mapParkNodes = (page, ids) => page.evaluate((list) => list.map((id) => { const n = document.querySelector(`[data-el-id="${id}"]`); const r = n && n.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; }), ids);

test.beforeEach(async ({ page }) => { test.setTimeout(120_000); await armPlannerHooks(page); });

for (const deg of [0, 315]) {
  for (const role of ["ends", "rear"]) {
    test(`rot ${deg} · ${role} wall · REAL BUILD-UP: sidewalk, parking, rows to eight, a buffer, then more parking — geometry + stalls read after every click`, async ({ page }) => {
      await boot(page, deg);
      const row = rowByRole(page, role).first();
      const side = (await row.getAttribute("data-sides")).split(",")[0];
      const step = async (key, label) => {
        await addWallLayer(row, key);
        await expect.poll(async () => (await kinds(row)).includes(key), { message: `${label}: panel shows ${key}` }).toBe(true);
        await expect.poll(async () => (await wallLayers(page, side)).length, { message: `${label}: stored` }).toBeGreaterThan(0);
        const layers = await wallLayers(page, side);
        assertNoOverlap(layers, label);
        return layers;
      };
      // 1) sidewalk, 2) the first parking row
      await expect(lead(row)).toHaveAttribute("data-kind", "sidewalk");
      await step("sidewalk", "sidewalk");
      await expect(lead(row)).toHaveAttribute("data-kind", "parking");
      await step("parking", "first parking row");
      expect(await kinds(row)).toEqual(["sidewalk", "parking"]);
      let facts = await parkingFacts(page, side);
      expect(facts.rows).toBe(1);
      // 3) THE OWNER'S CASE: with parking on the wall the lead button IS parking, and every click adds exactly one more row —
      //    through the real button, up to eight, never a buffer.
      for (let n = 2; n <= 8; n++) {
        await expect(lead(row), `lead before row ${n}`).toHaveAttribute("data-kind", "parking");
        await lead(row).click();
        // the plan record is flushed a beat after the click: wait for THIS click's row to land before reading the geometry
        await expect.poll(async () => (await parkingFacts(page, side)).rows, { message: `stored rows after click ${n - 1}` }).toBe(n);
        const layers = await wallLayers(page, side);
        assertNoOverlap(layers, `row ${n}`);
        facts = await parkingFacts(page, side);
        await expect.poll(() => panelRows(row), { message: `panel rows after click ${n - 1}` }).toBe(n);
        expect(facts.stalls, `stalls with ${n} rows`).toBeGreaterThan(0);
        // the click opens the parking edit box with Rows ready (rows rose, the layer COUNT did not)
        await expect(page.getByTestId("wall-edit-box")).toHaveAttribute("data-kind", "parking");
        await expect(page.getByTestId("wall-parking-rows")).toHaveValue(String(n));
      }
      expect(await kinds(row)).toEqual(["sidewalk", "parking"]);
      const stalls8 = facts.stalls;
      // the map renders the field (node present with a real box)
      expect((await mapParkNodes(page, (await wallLayers(page, side)).filter((l) => l.type === "parking").map((l) => l.id))).every(Boolean)).toBe(true);
      // 4) a buffer through the ▾ (parking leads, so the buffer is in the menu), then the lead moves on to the road
      await expect(row.getByTestId("wall-add-more")).toBeVisible();
      await addWallLayer(row, "buffer");
      expect(await kinds(row)).toEqual(["sidewalk", "parking", "buffer"]);
      let layers = await wallLayers(page, side);
      assertNoOverlap(layers, "buffer added");
      const bufferBefore = layers.find((l) => l.buffer);
      await expect(lead(row)).toHaveAttribute("data-kind", "road");                 // sidewalk > parking > buffer → road
      expect(await moreKinds(row)).toContain("parking");                            // …and parking waits in the ▾
      // 5) MORE PARKING with the buffer outside it: the field grows, the buffer is pushed out by exactly the new depth, no overlap
      const parkHi0 = layers.filter((l) => l.type === "parking").reduce((m, l) => Math.max(m, l.hi), 0);
      await addWallLayer(row, "parking");
      await expect.poll(async () => (await parkingFacts(page, side)).rows, { message: "stored rows after the parking click beside the buffer" }).toBe(9);
      layers = await wallLayers(page, side);
      assertNoOverlap(layers, "parking after the buffer");
      facts = await parkingFacts(page, side);
      expect(facts.rows).toBe(9);
      expect(facts.stalls).toBeGreaterThan(stalls8);
      await expect.poll(() => panelRows(row)).toBe(9);
      const parkHi1 = layers.filter((l) => l.type === "parking").reduce((m, l) => Math.max(m, l.hi), 0);
      const bufferAfter = layers.find((l) => l.buffer);
      expect(parkHi1).toBeGreaterThan(parkHi0 + 1);
      expect(bufferAfter.lo).toBeGreaterThanOrEqual(parkHi1 - 0.5);                  // outermost, flush beyond the grown field
      expect(bufferAfter.lo - bufferBefore.lo).toBeCloseTo(parkHi1 - parkHi0, 0);    // pushed out by exactly what the field grew
      expect(bufferAfter.depth).toBeCloseTo(bufferBefore.depth, 1);                  // the buffer keeps its own depth
      expect(await kinds(row)).toEqual(["sidewalk", "parking", "buffer"]);
      await expect(page.getByTestId("wall-edit-box")).toHaveAttribute("data-kind", "parking");
      // 6) ONE undo step puts the last row back, buffer and all
      await page.locator("body").click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
      await page.keyboard.press("Control+z");
      await expect.poll(async () => (await parkingFacts(page, side)).rows).toBe(8);
      assertNoOverlap(await wallLayers(page, side), "after undo");
      const afterUndo = (await wallLayers(page, side)).find((l) => l.buffer);
      expect(afterUndo.lo).toBeCloseTo(bufferBefore.lo, 0);
    });
  }
}

test("sidewalk > buffer with no parking yet: parking is offered, leads, and the buffer stays outermost with no overlap", async ({ page }) => {
  await boot(page, 0);
  const row = rowByRole(page, "ends").first();
  const side = (await row.getAttribute("data-sides")).split(",")[0];
  await addWallLayer(row, "sidewalk");
  await addWallLayer(row, "buffer");
  expect(await kinds(row)).toEqual(["sidewalk", "buffer"]);
  await expect(lead(row)).toHaveAttribute("data-kind", "parking");
  await lead(row).click();
  const layers = await wallLayers(page, side);
  assertNoOverlap(layers, "parking added to sidewalk > buffer");
  expect(layers.filter((l) => l.type === "parking")).toHaveLength(1);
  const buf = layers.find((l) => l.buffer), park = layers.find((l) => l.type === "parking");
  expect(buf.lo).toBeGreaterThanOrEqual(park.hi - 0.5);                              // buffer is outermost; the new field is not under it
  expect(await kinds(row)).toEqual(["sidewalk", "parking", "buffer"]);
});

test("an EXPLODED (split) parking stack: the lead adds a row beyond the outermost piece, with the missing aisle, and the buffer moves out", async ({ page }) => {
  await boot(page, 0);
  const row = rowByRole(page, "ends").first();
  const side = (await row.getAttribute("data-sides")).split(",")[0];
  await addWallLayer(row, "sidewalk"); await addWallLayer(row, "parking"); await lead(row).click();      // 2 rows
  await addWallLayer(row, "buffer");
  // explode the field through the map-selected parking's own Properties button
  const park = (await wallLayers(page, side)).find((l) => l.type === "parking");
  const pt = await page.evaluate((id) => { const r = document.querySelector(`[data-el-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, park.id);
  await page.mouse.dblclick(pt.x, pt.y);
  const explode = page.getByTestId("split-parking");
  await expect(explode, "the selected field's Properties offer Split rows/aisles").toBeVisible();
  await explode.click();
  await page.mouse.click(5, 5);
  const hostId = (await hostOf(page)).id;
  await page.mouse.dblclick(...await page.evaluate((id) => { const r = document.querySelector(`[data-el-id="${id}"]`).querySelector("rect, path").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, hostId));
  await expect(page.getByTestId("building-header")).toBeVisible();
  const before = await wallLayers(page, side);
  expect(before.filter((l) => l.el.sideParkSide).length).toBeGreaterThan(1);                          // genuinely split
  const rowsBefore = await panelRows(row);
  await expect(lead(row)).toHaveAttribute("data-kind", "road");                       // sidewalk > parking > buffer leads with the road…
  await addWallLayer(row, "parking");                                                  // …and parking waits in the ▾
  const after = await wallLayers(page, side);
  assertNoOverlap(after, "exploded stack grown");
  expect(after.filter((l) => l.el.sideParkSide).length).toBeGreaterThan(before.filter((l) => l.el.sideParkSide).length);
  await expect.poll(() => panelRows(row)).toBe(rowsBefore + 1);
  expect(await kinds(row)).toEqual(["sidewalk", "parking", "buffer"]);
});

/* ---- THE WALL-STATE MATRIX -------------------------------------------------------------------------------------------------
 * Each state a non-dock wall can be in, reached by REAL clicks; for each: the lead + the ▾ are compared with the layers that could
 * sensibly go there — written down here by hand from the product rules, NOT computed from the panel's own code:
 *   sidewalk  only if the wall has none · parking while nothing is a road (a first field, or one more row) · trailer parking
 *   always (repeat rows) · landscape buffer · road · and NOTHING after a road. */
const SENSIBLE = (have) => {
  if (have.includes("road")) return [];
  return [...(have.includes("sidewalk") ? [] : ["sidewalk"]), "parking", "trailer", "buffer", "road"];
};
const LEAD = { "": "sidewalk", sidewalk: "parking", parking: "parking", "sidewalk,parking": "parking", "sidewalk,parking,buffer": "road", "sidewalk,buffer": "parking" };
const STATES = [
  { name: "empty", build: [] },
  { name: "sidewalk", build: ["sidewalk"] },
  { name: "parking only (no sidewalk)", build: ["parking"] },
  { name: "sidewalk > parking", build: ["sidewalk", "parking"] },
  { name: "sidewalk > parking (8 rows)", build: ["sidewalk", "parking", "parking", "parking", "parking", "parking", "parking", "parking"] },
  { name: "sidewalk > parking > buffer", build: ["sidewalk", "parking", "buffer"] },
  { name: "sidewalk > buffer", build: ["sidewalk", "buffer"] },
  { name: "buffer only", build: ["buffer"] },
  { name: "sidewalk > parking > trailer", build: ["sidewalk", "parking", "trailer"] },
  { name: "sidewalk > parking > buffer > road", build: ["sidewalk", "parking", "buffer", "road"] },
  { name: "sidewalk > road", build: ["sidewalk", "road"] },
];
for (const st of STATES) {
  test(`wall-state matrix · end wall · ${st.name}: every sensible layer is offered, nothing impossible is, the lead is the required one`, async ({ page }) => {
    await boot(page, 0);
    const row = rowByRole(page, "ends").first();
    const side = (await row.getAttribute("data-sides")).split(",")[0];
    for (const k of st.build) { await addWallLayer(row, k); assertNoOverlap(await wallLayers(page, side), `${st.name}: after ${k}`); }
    const have = (await kinds(row)).filter((k, i, a) => a.indexOf(k) === i);
    const got = await offered(row);
    const want = SENSIBLE(await kinds(row));
    expect(got.slice().sort(), `${st.name}: offered ${JSON.stringify(got)}`).toEqual(want.slice().sort());
    const key = have.join(",");
    if (LEAD[key] !== undefined && want.length) expect(got[0], `${st.name}: lead`).toBe(LEAD[key]);
    // every offered layer is REACHABLE: pressing it changes the wall (a new layer, or one more parking row) and never overlaps
    for (const k of want) {
      const before = JSON.stringify({ k: await kinds(row), r: await panelRows(row) });
      await addWallLayer(row, k);
      const after = JSON.stringify({ k: await kinds(row), r: await panelRows(row) });
      expect(after, `${st.name}: adding ${k} changed nothing`).not.toBe(before);
      assertNoOverlap(await wallLayers(page, side), `${st.name}: + ${k}`);
      if (k === "road") break;                                                                    // terminal — nothing can follow it
    }
  });
}

test("dock wall states: empty → court; court → trailer lead; … → buffer → sidewalk; road is terminal; the order is unchanged", async ({ page }) => {
  await boot(page, 0);
  const dock = rowByRole(page, "dock").first();
  const seq = [[[], "court", ["court"]], [["court"], "trailer", ["trailer", "buffer", "sidewalk", "road"]],
    [["court", "trailer"], "buffer", ["buffer", "sidewalk", "road", "trailer"]], [["court", "trailer", "buffer"], "sidewalk", ["sidewalk", "road", "trailer", "buffer"]]];
  for (const [have, want, set] of seq) {
    expect(await kinds(dock)).toEqual(have);
    const got = await offered(dock);
    expect(got[0], `dock ${have.join(">") || "empty"}: lead`).toBe(want);
    expect(got.slice().sort()).toEqual(set.slice().sort());
    await lead(dock).click();
  }
  await addWallLayer(dock, "road");
  expect(await offered(dock)).toEqual([]);
});

/* ---- NEW-2: icons, not words ---- */
test("the add control is a plus and the layer's own icon in its legend swatch (same fill as the strip piece), with the full name in aria-label/title; the ▾ rows show swatch + name; one line at desktop and phone width", async ({ page }) => {
  await boot(page, 0);
  const row = rowByRole(page, "ends").first();
  const btn = lead(row);
  await expect(btn).toHaveAttribute("aria-label", /^Add sidewalk to the End wall/);
  await expect(btn).toHaveAttribute("title", "Add sidewalk to this wall");
  await expect(btn.getByTestId("wall-add-swatch")).toHaveAttribute("data-kind", "sidewalk");
  expect((await btn.innerText()).replace(/\s/g, "")).toBe("+");                                    // no word on the button
  expect(await btn.evaluate((n) => getComputedStyle(n).borderTopColor)).not.toBe("rgba(0, 0, 0, 0)");   // the accent outline stays
  await addWallLayer(row, "sidewalk"); await addWallLayer(row, "parking");
  // the swatch fill IS the strip piece's fill for that kind
  await expect(btn.getByTestId("wall-add-swatch")).toHaveAttribute("data-kind", "parking");
  const fill = (loc) => loc.evaluate((n) => getComputedStyle(n).backgroundColor);
  expect(await fill(btn.getByTestId("wall-add-swatch"))).toBe(await fill(row.locator('[data-testid="wall-piece"][data-kind="parking"]')));
  // the ▾: every row is swatch + full name; the lead button has its ▾ joined to it
  await row.getByTestId("wall-add-more").click();
  const items = page.getByTestId("wall-add-menu").getByRole("menuitem");
  expect(await items.count()).toBeGreaterThan(1);
  for (let i = 0; i < await items.count(); i++) {
    const it = items.nth(i);
    await expect(it.getByTestId("wall-add-swatch")).toBeVisible();
    expect((await it.innerText()).trim().length).toBeGreaterThan(3);                              // its name
    expect(await it.getAttribute("aria-label")).toMatch(/^Add .+ to the End wall/);
  }
  await page.keyboard.press("Escape");
  // the row stays ONE line at desktop; the strip is not squeezed (a full-height row, the control to the right of the strip)
  const strip = await row.getByTestId("wall-strip").boundingBox(), grp = await row.getByTestId("wall-add-group").boundingBox();
  expect(Math.abs(strip.y + strip.height / 2 - (grp.y + grp.height / 2))).toBeLessThan(6);
  expect(grp.x).toBeGreaterThanOrEqual(strip.x + strip.width - 1);
  expect(grp.height).toBeLessThan(40);
  // phone width
  await page.setViewportSize({ width: 390, height: 800 });
  const s2 = await row.getByTestId("wall-strip").boundingBox(), g2 = await row.getByTestId("wall-add-group").boundingBox();
  expect(Math.abs(s2.y + s2.height / 2 - (g2.y + g2.height / 2))).toBeLessThan(6);
  expect(g2.x + g2.width).toBeLessThanOrEqual(390);
});

/* ---- NEW-3: Sidewalk, never Walk ---- */
test("no user-facing surface of Docks & walls says Walk: pieces, legend, edit box heading, bin, ▾ and add button all say Sidewalk", async ({ page }) => {
  await boot(page, 0);
  const row = rowByRole(page, "ends").first();
  await addWallLayer(row, "sidewalk");
  const piece = row.locator('[data-testid="wall-piece"][data-kind="sidewalk"]');
  expect(await piece.getAttribute("aria-label")).toBe("Sidewalk 5′");
  const box = page.getByTestId("wall-edit-box");                                                   // the add just opened the new layer's box
  if (!(await box.count())) await piece.click();
  await expect(box).toContainText("Sidewalk");
  const heading = box.getByText("Sidewalk", { exact: true }).first();
  const hb = await heading.boundingBox();
  expect(hb.height).toBeLessThan(24);                                                             // the heading fits on one line
  await expect(box.getByTestId("wall-piece-remove")).toHaveAttribute("aria-label", "Remove Sidewalk");
  await expect(page.getByTestId("wall-legend")).toContainText("Sidewalk");
  await page.keyboard.press("Escape");
  const panel = page.getByTestId("building-header").locator("xpath=ancestor::*[.//*[@data-testid='wall-legend']][1]");
  expect(await panel.innerText()).not.toMatch(/\bWalk\b/);
  // the legend wraps cleanly: no item is taller than one line
  for (const h of await page.getByTestId("wall-legend-item").evaluateAll((n) => n.map((x) => x.getBoundingClientRect().height))) expect(h).toBeLessThan(24);
});

test("Escape closes the ▾ and leaves the building selected with its panel open (even with no edit box open)", async ({ page }) => {
  await boot(page, 0);
  const row = rowByRole(page, "ends").first();
  await row.getByTestId("wall-add-more").click();
  await expect(page.getByTestId("wall-add-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("wall-add-menu")).toHaveCount(0);
  await expect(page.getByTestId("building-header")).toBeVisible();
});
