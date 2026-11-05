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
import { armPlannerHooks, addWallLayer, rowFit } from "./helpers.js";
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
/* Every add option is its own icon on the wall's row (NEW-1, 2026-11-04 — no ▾): the leftmost is the likely next layer. */
const icons = (row) => row.getByTestId("wall-add-group").locator("button");
const lead = (row) => icons(row).first();
const iconKinds = async (row) => ((await row.getByTestId("wall-add-group").count()) ? icons(row).evaluateAll((n) => n.map((x) => x.getAttribute("data-kind"))) : []);
const leadKind = async (row) => (await iconKinds(row))[0] ?? null;
const moreKinds = async (row) => (await iconKinds(row)).slice(1);
const offered = iconKinds;
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
      // 4) a buffer by its own icon (parking leads, the buffer is a later icon), then the lead moves on to the road
      await expect(row.getByTestId("wall-add-buffer")).toBeVisible();
      await addWallLayer(row, "buffer");
      expect(await kinds(row)).toEqual(["sidewalk", "parking", "buffer"]);
      let layers = await wallLayers(page, side);
      assertNoOverlap(layers, "buffer added");
      const bufferBefore = layers.find((l) => l.buffer);
      await expect(lead(row)).toHaveAttribute("data-kind", "road");                 // sidewalk > parking > buffer → road
      expect(await moreKinds(row)).toContain("parking");                            // …and parking waits further along the icons
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
  await addWallLayer(row, "parking");                                                  // …and parking waits further along the icons
  const after = await wallLayers(page, side);
  assertNoOverlap(after, "exploded stack grown");
  expect(after.filter((l) => l.el.sideParkSide).length).toBeGreaterThan(before.filter((l) => l.el.sideParkSide).length);
  await expect.poll(() => panelRows(row)).toBe(rowsBefore + 1);
  expect(await kinds(row)).toEqual(["sidewalk", "parking", "buffer"]);
});

/* ---- THE WALL-STATE MATRIX -------------------------------------------------------------------------------------------------
 * Each state a wall can be in, reached by REAL clicks, on a REAR wall and an END wall at rot 0 and 315 (and a dock wall below). For each:
 * the icons on the row are compared with the layers that could sensibly go there — written down here by hand from the product rules,
 * NOT computed from the panel's own code:
 *   sidewalk  only if the wall has none · parking while nothing is a road (a first field, or one more row) · trailer parking
 *   always (repeat rows) · landscape buffer · road · and NOTHING after a road.
 * Then EVERY offered icon is pressed (a real click) and must change the wall without overlapping, and the row is MEASURED (not eyeballed)
 * for one line / no clipped icon at desktop width and at phone width, before and after the presses. */
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
  { name: "parking > trailer > buffer > trailer (no sidewalk: five icons beside four pieces)", build: ["parking", "trailer", "buffer", "trailer"] },
  { name: "sidewalk > parking > buffer > road", build: ["sidewalk", "parking", "buffer", "road"] },
  { name: "sidewalk > road", build: ["sidewalk", "road"] },
];
/* Measure the row at desktop width and at a phone width (the bottom sheet), then put the viewport back. */
async function assertFits(page, row, label) {
  const sz = page.viewportSize();
  expect(await rowFit(row), `${label} · desktop`).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await rowFit(row)).length, { message: `${label} · phone row fit` }).toBe(0);
  expect(await rowFit(row), `${label} · phone`).toEqual([]);
  await page.setViewportSize(sz);
  await expect(row.getByTestId("wall-row-badge")).toBeVisible();
}
for (const deg of [0, 315]) {
  for (const role of ["ends", "rear"]) {
    for (const st of STATES) {
      test(`wall-state matrix · rot ${deg} · ${role} wall · ${st.name}: the offered icons are the sensible layers, each one works, the row fits`, async ({ page }) => {
        test.setTimeout(180_000);
        await boot(page, deg);
        const row = rowByRole(page, role).first();
        const side = (await row.getAttribute("data-sides")).split(",")[0];
        for (const k of st.build) { await addWallLayer(row, k); assertNoOverlap(await wallLayers(page, side), `${st.name}: after ${k}`); }
        const have = (await kinds(row)).filter((k, i, a) => a.indexOf(k) === i);
        const got = await offered(row);
        const want = SENSIBLE(await kinds(row));
        expect(got.slice().sort(), `${st.name}: offered ${JSON.stringify(got)}`).toEqual(want.slice().sort());
        expect(new Set(got).size, "each option is one icon").toBe(got.length);
        const key = have.join(",");
        if (LEAD[key] !== undefined && want.length) expect(got[0], `${st.name}: lead (leftmost)`).toBe(LEAD[key]);
        await expect(row.getByTestId("wall-add-plus")).toHaveCount(want.length ? 1 : 0);
        await assertFits(page, row, `${st.name}: as built`);
        // every offered icon is REACHABLE: pressing it changes the wall (a new layer, or one more parking row) and never overlaps
        for (const k of want) {
          const before = JSON.stringify({ k: await kinds(row), r: await panelRows(row) });
          await row.getByTestId(`wall-add-${k}`).click();
          await expect.poll(async () => JSON.stringify({ k: await kinds(row), r: await panelRows(row) }), { message: `${st.name}: adding ${k} changed nothing` }).not.toBe(before);
          assertNoOverlap(await wallLayers(page, side), `${st.name}: + ${k}`);
          if (k === "road") break;                                                                    // terminal — nothing can follow it
        }
        await assertFits(page, row, `${st.name}: after pressing every icon`);
      });
    }
  }
}

/* the dock wall: each stage's icons against a hand-written list; then EVERY icon on offer is pressed; fit measured at both widths */
for (const deg of [0, 315]) {
  test(`dock wall states · rot ${deg}: empty → court; court → trailer lead; … → buffer → sidewalk; every offered icon works; a road is terminal; the row fits`, async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page, deg);
    const dock = rowByRole(page, "dock").first();
    const seq = [[[], "court", ["court"]], [["court"], "trailer", ["trailer", "buffer", "sidewalk", "road"]],
      [["court", "trailer"], "buffer", ["buffer", "sidewalk", "road", "trailer"]], [["court", "trailer", "buffer"], "sidewalk", ["sidewalk", "road", "trailer", "buffer"]]];
    for (const [have, want, set] of seq) {
      expect(await kinds(dock)).toEqual(have);
      const got = await offered(dock);
      expect(got[0], `dock ${have.join(">") || "empty"}: lead`).toBe(want);
      expect(got.slice().sort()).toEqual(set.slice().sort());
      await assertFits(page, dock, `dock ${have.join(">") || "empty"}`);
      await lead(dock).click();
      await expect.poll(async () => (await kinds(dock)).length).toBe(have.length + 1);
    }
    // five layers with four icons still on offer (court > trailer > buffer > sidewalk, now one more trailer): the row still fits both widths
    await dock.getByTestId("wall-add-trailer").click();
    await expect.poll(async () => (await kinds(dock)).length).toBe(5);
    expect((await offered(dock)).slice().sort()).toEqual(["buffer", "road", "sidewalk", "trailer"]);
    await assertFits(page, dock, "dock court>trailer>buffer>sidewalk>trailer");
    // press EVERY offered icon, a road last (terminal)
    const pressed = [];
    for (;;) {
      const left = (await offered(dock)).filter((k) => !pressed.includes(k));
      if (!left.length) break;
      const k = left.find((x) => x !== "road") ?? "road";
      pressed.push(k);
      const before = JSON.stringify(await kinds(dock));
      await dock.getByTestId(`wall-add-${k}`).click();
      await expect.poll(async () => JSON.stringify(await kinds(dock)), { message: `dock + ${k} changed nothing` }).not.toBe(before);
    }
    expect(pressed.slice().sort()).toEqual(["buffer", "road", "sidewalk", "trailer"]);
    expect(await offered(dock)).toEqual([]);
    await expect(dock.getByTestId("wall-add-group")).toHaveCount(0);
    await assertFits(page, dock, "dock after a road");
  });
}

/* ---- NEW-2: icons, not words — and amended 2026-11-04: every option its own icon, no ▾ ---- */
test("the add control is a plus then one icon per option, each the layer's own icon in its legend swatch (same fill as the strip piece), the full name in aria-label/title, no word, no ▾", async ({ page }) => {
  await boot(page, 0);
  const row = rowByRole(page, "ends").first();
  // empty end wall: sidewalk, parking, buffer, road, trailer — five icons (the order orderedAddOptions gives), each its own button
  expect(await iconKinds(row)).toEqual(["sidewalk", "parking", "buffer", "road", "trailer"]);
  const btn = lead(row);
  await expect(btn).toHaveAttribute("aria-label", /^Add sidewalk to the End wall \(/);
  await expect(btn).toHaveAttribute("title", "Add sidewalk to this wall");
  await expect(row.getByTestId("wall-add-parking")).toHaveAttribute("aria-label", /^Add car parking to the End wall \(/);
  await expect(row.getByTestId("wall-add-parking")).toHaveAttribute("title", "Add car parking to this wall");
  for (const k of await iconKinds(row)) {
    const b = row.getByTestId(`wall-add-${k}`);
    expect((await b.innerText()).trim(), `no word on the ${k} icon`).toBe("");
    expect(await b.locator("svg").count(), `the ${k} icon draws an icon`).toBeGreaterThan(0);
    const bb = await b.boundingBox();
    expect(bb.width, `${k} is a usable click target`).toBeGreaterThanOrEqual(22 - 0.5);
    expect(bb.height).toBeGreaterThanOrEqual(22 - 0.5);
  }
  await expect(row.getByTestId("wall-add-plus")).toHaveText("+");
  // the icon's fill IS the strip piece's fill for that kind: read each icon BEFORE its layer exists (the kind's default style), then the piece it adds
  const fill = (loc) => loc.evaluate((n) => getComputedStyle(n).backgroundColor);
  const before = { sidewalk: await fill(row.getByTestId("wall-add-sidewalk")), parking: await fill(row.getByTestId("wall-add-parking")) };
  await addWallLayer(row, "sidewalk"); await addWallLayer(row, "parking");
  for (const k of ["sidewalk", "parking"]) expect(before[k], `${k} icon fill = the strip piece's fill`).toBe(await fill(row.locator(`[data-testid="wall-piece"][data-kind="${k}"]`)));
  expect(await fill(row.getByTestId("wall-add-parking")), "parking icon fill once the piece exists").toBe(before.parking);
  // no ▾ and no menu anywhere
  await expect(page.getByTestId("wall-add-more")).toHaveCount(0);
  await expect(page.getByTestId("wall-add-menu")).toHaveCount(0);
  await expect(page.locator("[data-wall-add][aria-haspopup]")).toHaveCount(0);
  // the icons sit to the right of the strip on the same line
  const strip = await row.getByTestId("wall-strip").boundingBox(), grp = await row.getByTestId("wall-add-group").boundingBox();
  expect(Math.abs(strip.y + strip.height / 2 - (grp.y + grp.height / 2))).toBeLessThan(6);
  expect(grp.x).toBeGreaterThanOrEqual(strip.x + strip.width - 1);
  expect(grp.height).toBeLessThan(40);
  await assertFits(page, row, "end wall sidewalk>parking");
});

/* ---- NEW-3: Sidewalk, never Walk ---- */
test("no user-facing surface of Docks & walls says Walk: pieces, legend, edit box heading, bin and add icon all say Sidewalk", async ({ page }) => {
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

test("there is no ▾ on any wall row, and Escape with nothing open does not open or leave behind a menu", async ({ page }) => {
  await boot(page, 0);
  for (const role of ["dock", "rear", "ends"]) {
    const row = rowByRole(page, role).first();
    await expect(row.getByTestId("wall-add-more")).toHaveCount(0);
    await expect(row.locator("[data-wall-add][aria-haspopup]")).toHaveCount(0);
    expect(await row.innerText()).not.toContain("▾");
  }
  await expect(page.getByTestId("wall-add-menu")).toHaveCount(0);
});
