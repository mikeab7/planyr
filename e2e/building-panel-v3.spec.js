/* Building panel v3 (NEW-1…NEW-5) — drives the REAL inspector, logged out, no GIS. A building at a non-zero
 * rotation: the header number box, the Footprint number boxes (+ Edit outline in the heading), the "Docks & walls"
 * strips (one line per wall, icons, legend, the edit box, the bin), per-row trailer depths on the canvas, and the new
 * default colours — in light AND dark. Measured on the canvas model, not just the panel.
 * Run: BASE_URL=http://localhost:4173 PW_CHROME=<chrome> npx playwright test e2e/building-panel-v3.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";
import { canvas, startBlank } from "./drawKinds.js";

const plan = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return site.els || [];
});
const hostOf = async (page) => (await plan(page)).find((e) => e.type === "building" && !e.dogEar);
const kidsOf = async (page, id) => (await plan(page)).filter((e) => e.attachedTo === id);
async function drawBldg(page, x1, y1, x2, y2) {
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 12 });
  await page.mouse.up();
}
async function openProps(page, id) {
  const pt = await page.evaluate((elId) => {
    const r = document.querySelector(`[data-el-id="${elId}"]`).querySelector("rect, path").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  await page.mouse.dblclick(pt.x, pt.y);
  await expect(page.getByTestId("building-header")).toBeVisible();
}
const rotate = async (page, deg) => {
  const f = page.getByLabel("Rotation in degrees");
  await f.fill(String(deg)); await f.press("Enter");
};
const rowByRole = (page, role) => page.locator(`[data-testid="wall-row"][data-role="${role}"]`);
const addLayer = async (r, key) => { await r.getByTestId("wall-add").click(); await r.page().getByTestId(`wall-add-${key}`).click(); };
async function boot(page, deg = 315) {
  await startBlank(page);
  await drawBldg(page, 200, 260, 620, 400);
  await expect.poll(async () => !!(await hostOf(page))).toBe(true);
  const b = await hostOf(page);
  await openProps(page, b.id);
  if (deg) { await rotate(page, deg); await expect.poll(async () => Math.round((await hostOf(page)).rot)).toBe(deg); }
  return b;
}
const trailerOf = async (page, id) => (await kidsOf(page, id)).find((k) => k.type === "trailer");
// court + trailer + buffer + walk + road on the dock wall
async function fullDockStack(page) {
  const dock = rowByRole(page, "dock").first();
  for (const key of ["court", "trailer", "buffer", "sidewalk", "road"]) await addLayer(dock, key);
  await expect(dock.getByTestId("wall-piece")).toHaveCount(5);
  return dock;
}

test.beforeEach(async ({ page }) => { await armPlannerHooks(page); });

for (const scheme of ["light", "dark"]) {
  test.describe(`${scheme} theme`, () => {
    test.beforeEach(async ({ page }) => { await page.emulateMedia({ colorScheme: scheme }); });

    test("header: the building number is a small box sized to its digits; lock · ⋯ · ✕ are borderless", async ({ page }) => {
      const b = await boot(page);
      const num = page.getByLabel("Building number");
      const w1 = (await num.boundingBox()).width;
      await expect(page.getByTestId("building-header")).toContainText("Building");
      expect(await num.evaluate((el) => el.value)).toBe("1");
      // the field outline is the STRONGER border token, not the faint one
      const outline = await num.evaluate((el) => ({ border: getComputedStyle(el).borderTopColor, w: getComputedStyle(el).borderTopWidth, h: el.getBoundingClientRect().height, font: getComputedStyle(el).fontSize }));
      expect(parseFloat(outline.w)).toBeGreaterThanOrEqual(1);
      const tokens = await page.evaluate(() => { const r = document.documentElement; const probe = (v) => { const d = document.createElement("i"); d.style.color = `var(${v})`; r.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }; return { strong: probe("--border-strong"), faint: probe("--border-default") }; });
      expect(outline.border).toBe(tokens.strong);
      expect(outline.border).not.toBe(tokens.faint);
      expect(outline.h).toBeLessThanOrEqual(24);
      // renumber to 12: the box grows to fit two digits; a second building at 12 raises the conflict dialog
      await num.fill("12"); await num.press("Enter");
      await expect.poll(async () => (await num.boundingBox()).width).toBeGreaterThan(w1);
      const w2 = (await num.boundingBox()).width;
      await num.fill("123"); await num.press("Enter");
      await expect.poll(async () => (await num.boundingBox()).width).toBeGreaterThan(w2);
      await num.fill("1"); await num.press("Enter");
      // lock · ⋯ · ✕: no border, no resting background — a hover wash only
      for (const id of ["building-lock", "building-more", "building-close"]) {
        const st = await page.getByTestId(id).evaluate((el) => { const c = getComputedStyle(el); return { bw: c.borderTopWidth, bg: c.backgroundColor }; });
        expect(parseFloat(st.bw)).toBe(0);
        expect(st.bg).toBe("rgba(0, 0, 0, 0)");
      }
      await page.getByTestId("building-lock").hover();
      await expect.poll(() => page.getByTestId("building-lock").evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
      void b;
    });

    test("footprint: Length · Depth · Rotation are ONE bordered box each (value · unit · ▲▼); Edit outline sits in the heading and does not collapse the section", async ({ page }) => {
      const b = await boot(page);
      for (const [id, unit] of [["footprint-length", "ft"], ["footprint-depth", "ft"], ["footprint-rotation", "°"]]) {
        const input = page.getByTestId(id);
        const frame = input.locator("xpath=ancestor::*[@data-numbox][1]");
        await expect(frame).toContainText(unit);
        await expect(frame.locator("[data-num-stepper] button")).toHaveCount(2);
        // the input itself has no border of its own: ONE box
        expect(await input.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");
        expect(parseFloat(await frame.evaluate((el) => getComputedStyle(el).borderTopWidth))).toBeGreaterThanOrEqual(1);
      }
      // type + step Length
      const len = page.getByTestId("footprint-length");
      const l0 = Math.round(((await hostOf(page)).w));
      await len.fill("400"); await len.press("Enter");
      await expect.poll(async () => Math.round((await hostOf(page)).w)).toBe(400);
      await page.getByTestId("footprint-length").locator("xpath=ancestor::*[@data-numbox][1]").getByRole("button", { name: "Increase" }).click();
      await expect.poll(async () => Math.round((await hostOf(page)).w)).toBe(401);
      void l0;
      // rotation: ▲ = +1°, Shift+ArrowUp = +0.1°, wraps through 360
      const rot = page.getByTestId("footprint-rotation");
      await rot.fill("359"); await rot.press("Enter");
      await expect.poll(async () => Math.round((await hostOf(page)).rot)).toBe(359);
      await page.getByRole("button", { name: "Rotate one degree clockwise" }).click();
      await expect.poll(async () => Math.round((await hostOf(page)).rot)).toBe(0);
      await rot.focus();
      await page.keyboard.press("Shift+ArrowUp");
      await expect.poll(async () => Math.round(((await hostOf(page)).rot) * 10) / 10).toBe(0.1);
      await rot.fill("359.4"); await rot.press("Enter");
      expect(await rot.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      // Edit outline: in the heading (right of the title), clicking it leaves the section open
      const heading = page.getByRole("button", { name: /Footprint/ });
      await expect(heading).toHaveAttribute("aria-expanded", "true");
      const edit = page.getByTestId("edit-outline");
      const hb = await heading.boundingBox(), eb = await edit.boundingBox();
      expect(eb.y).toBeLessThan(hb.y + hb.height + 4);                       // on the heading row, not down in the body
      expect(eb.x).toBeGreaterThan(hb.x + hb.width / 2);                     // right-aligned
      await edit.click();
      await expect(heading).toHaveAttribute("aria-expanded", "true");
      expect((await hostOf(page)).points || (await hostOf(page)).footEdit).toBeTruthy();   // …and it did start editing the outline
      void b;
    });

    test("docks & walls: ONE strip per wall; pieces take the canvas colours; the legend lists only the kinds present; edit box = one line; no px", async ({ page }) => {
      const b = await boot(page);
      await expect(page.getByRole("button", { name: /Docks & walls/ })).toBeVisible();
      const dock = await fullDockStack(page);
      // one line: the row (head + strip + add) never wraps
      const strip = dock.getByTestId("wall-strip");
      const rb = await dock.boundingBox(), sb = await strip.boundingBox(), hb = await dock.getByTestId("wall-row-head").boundingBox();
      expect(sb.y).toBeGreaterThanOrEqual(hb.y - 4);
      expect(sb.y + sb.height).toBeLessThanOrEqual(rb.y + rb.height + 1);
      // the dock bar is the deepest wall ⇒ the longest bar; the rear's shallow/empty bar is not longer
      const barW = async (r) => ((await r.getByTestId("wall-strip").count()) ? (await r.getByTestId("wall-strip").boundingBox()).width : 0);
      expect(await barW(dock)).toBeGreaterThan(await barW(rowByRole(page, "rear")));
      // pieces carry their layer's PLAN colour: read each piece's background and the matching element's painted fill
      const fills = await page.evaluate(() => [...document.querySelectorAll('[data-testid="wall-piece"]')].map((el) => ({ kind: el.getAttribute("data-kind"), bg: getComputedStyle(el).backgroundColor })));
      expect(fills.map((f) => f.kind)).toEqual(["court", "trailer", "buffer", "sidewalk", "road"]);
      const hex = (rgb) => "#" + rgb.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
      const want = { court: "#d5d9de", trailer: "#e3d4b2", buffer: "#bcd3a6", sidewalk: "#f7f6f2", road: "#9eabb7" };
      for (const f of fills) expect(hex(f.bg)).toBe(want[f.kind]);
      const kids = await kidsOf(page, b.id);
      const painted = await page.evaluate((ids) => ids.map((id) => { const g = document.querySelector(`[data-el-id="${id}"]`); const r = g && g.querySelector("rect, path, polygon"); return r ? (r.getAttribute("fill") || "").toLowerCase() : null; }), kids.map((k) => k.id));
      for (const f of ["#d5d9de", "#e3d4b2", "#bcd3a6", "#9eabb7"]) expect(painted).toContain(f);
      // the legend: only kinds present, in order, with the swatch icon
      const legend = page.getByTestId("wall-legend");
      expect(await legend.getByTestId("wall-legend-item").evaluateAll((n) => n.map((x) => x.getAttribute("data-kind")))).toEqual(["court", "trailer", "buffer", "sidewalk", "road"]);
      await expect(legend).not.toContainText("Parking");
      // an icon is drawn in a wide-enough piece
      expect(await dock.getByTestId("wall-piece").first().locator("svg").count()).toBe(1);
      // tooltip names the layer and the wall total
      expect(await dock.getByTestId("wall-piece").first().getAttribute("title")).toMatch(/^Truck court 135′ · wall total \d+′$/);
      // open the trailer piece: a one-line box under the row — no wall name, no long title, no total, no ✕, no note
      await dock.getByTestId("wall-piece").nth(1).click();
      const box = page.getByTestId("wall-edit-box");
      await expect(box).toHaveAttribute("data-kind", "trailer");
      await expect(box).toContainText("Trailer");
      for (const bad of ["Trailer parking", "total", "deep", "Remove +", "Truck court"]) await expect(box).not.toContainText(bad);
      await expect(box.getByTestId("wall-edit-caret")).toHaveCount(1);
      await expect(page.getByTestId("wall-legend-item").nth(1)).toHaveAttribute("data-selected", "1");
      // ONE open at a time
      await dock.getByTestId("wall-piece").nth(2).click();
      await expect(page.getByTestId("wall-edit-box")).toHaveCount(1);
      await expect(page.getByTestId("wall-edit-box")).toHaveAttribute("data-kind", "buffer");
      // click it again closes; Esc closes; outside closes
      await dock.getByTestId("wall-piece").nth(2).click();
      await expect(page.getByTestId("wall-edit-box")).toHaveCount(0);
      await dock.getByTestId("wall-piece").nth(0).click();
      await expect(page.getByTestId("wall-edit-box")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("wall-edit-box")).toHaveCount(0);
      await expect(page.getByTestId("building-header")).toBeVisible();      // Esc closed the box, not the inspector
      await dock.getByTestId("wall-piece").nth(0).click();
      await page.getByTestId("building-summary").click();
      await expect(page.getByTestId("wall-edit-box")).toHaveCount(0);
      const text = await page.getByTestId("property-panel").innerText();
      expect(text).not.toMatch(/\bpx\b/);
      expect(text).not.toContain("Remove + outer");
    });

    test("trailer parking: each row has its own depth — 60 and 55 draw two bands of those depths, the aisle between, row 1 against the court", async ({ page }) => {
      const b = await boot(page);
      const dock = rowByRole(page, "dock").first();
      await addLayer(dock, "court"); await addLayer(dock, "trailer");
      const rows = page.getByLabel("Trailer rows", { exact: true });
      await rows.fill("2"); await rows.press("Enter");
      await expect.poll(async () => (await trailerOf(page, b.id))?.trailerRows).toBe(2);
      // line 2 carries one depth per row; line 3 the aisle; adding a row copied the last row's depth
      await expect(page.getByLabel("Trailer row 1 depth")).toHaveValue("50");
      await expect(page.getByLabel("Trailer row 2 depth")).toHaveValue("50");
      await expect(page.getByLabel("Aisle between trailer rows")).toHaveValue("60");
      const r1 = page.getByLabel("Trailer row 1 depth"), r2 = page.getByLabel("Trailer row 2 depth");
      await r1.fill("60"); await r1.press("Enter");
      await r2.fill("55"); await r2.press("Enter");
      await expect.poll(async () => (await trailerOf(page, b.id))?.trailerRowDepths).toEqual([60, 55]);
      let t = await trailerOf(page, b.id);
      expect(t.zd).toBe(60 + 55 + 60);
      expect(Math.round(t.h)).toBe(175);
      expect(t.cfg.trailerRowDepths).toEqual([60, 55]);
      // the canvas: two stall bands drawn at 60 and 55 (feet), the aisle between them, row 1 (the 60) against the court.
      // Read the painted rects in the element's OWN frame (their x/y/height attributes are feet × scale, before the 315° rotation),
      // so the check is about what is drawn, not about screen geometry.
      const side = (await hostOf(page)).dockSide || "bottom";
      const rects = await page.evaluate((tid) => [...document.querySelector(`[data-el-id="${tid}"]`).querySelectorAll("rect")].map((r) => ({ y: +r.getAttribute("y"), h: +r.getAttribute("height") })), t.id);
      const zone = rects.reduce((m, r) => (r.h > m.h ? r : m), rects[0]);
      const bandsPx = rects.filter((r) => r.h > zone.h * 0.05 && r.h < zone.h * 0.9).sort((p, q) => p.y - q.y);   // not the zone's own outline, not the hairline curb
      expect(bandsPx.length).toBe(2);
      const ppf = zone.h / 175;                                           // the zone is 175 ft deep (60 + 60 aisle + 55)
      const [lo, hi] = bandsPx;                                           // lowest y first (the element's local frame)
      const innerIsLow = side === "bottom" || side === "left";           // on a top / right wall the element's y = 0 edge is the OUTER one
      const [near, far] = innerIsLow ? [lo, hi] : [hi, lo];
      expect(near.h / ppf).toBeCloseTo(60, 0);
      expect(far.h / ppf).toBeCloseTo(55, 0);
      expect((hi.y - (lo.y + lo.h)) / ppf).toBeCloseTo(60, 0);           // the aisle between the bands
      // the strip label stays ×2 and the total depth shows on the tooltip
      await expect(dock.getByTestId("wall-piece").nth(1)).toContainText("×2");
      expect(await dock.getByTestId("wall-piece").nth(1).getAttribute("title")).toContain("175′");
      // add a row: copies the last depth (55); remove: drops the last
      await rows.fill("3"); await rows.press("Enter");
      await expect.poll(async () => (await trailerOf(page, b.id))?.trailerRowDepths).toEqual([60, 55, 55]);
      await rows.fill("2"); await rows.press("Enter");
      await expect.poll(async () => (await trailerOf(page, b.id))?.trailerRowDepths).toEqual([60, 55]);
      // old plans (no trailerRowDepths) load unchanged: setting both rows alike returns to the single-depth form
      await r1.fill("55"); await r1.press("Enter");
      await expect.poll(async () => (await trailerOf(page, b.id))?.trailerRowDepths).toBeUndefined();
      t = await trailerOf(page, b.id);
      expect(t.zd).toBe(55 + 55 + 60);
    });

    test("trailer rows on a TOP wall (where the element's local y=0 edge is the outer one): row 1 is still the row against the court", async ({ page }) => {
      const b = await boot(page, 0);
      await page.locator('[data-testid="loading-wall-picker"] [data-wall="top"]').click();
      await expect.poll(async () => (await hostOf(page)).dock).toBe("cross");
      const top = page.locator('[data-testid="wall-row"][data-role="dock"][data-sides="top"]');
      await addLayer(top, "court"); await addLayer(top, "trailer");
      const rows = page.getByLabel("Trailer rows", { exact: true });
      await rows.fill("2"); await rows.press("Enter");
      const r1 = page.getByLabel("Trailer row 1 depth"), r2 = page.getByLabel("Trailer row 2 depth");
      await r1.fill("60"); await r1.press("Enter");
      await r2.fill("55"); await r2.press("Enter");
      await expect.poll(async () => (await kidsOf(page, b.id)).find((k) => k.type === "trailer")?.trailerRowDepths).toEqual([60, 55]);
      const t = (await kidsOf(page, b.id)).find((k) => k.type === "trailer");
      const court = (await kidsOf(page, b.id)).find((k) => k.truckCourt);
      expect(court.truckCourt.side).toBe("top");
      // in the world frame the 60 band's centre is nearer the court than the 55 band's: read both bands' screen centres
      const res = await page.evaluate(({ tid, cid }) => {
        const centre = (r) => { const q = r.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, h: q.height, w: q.width }; };
        const g = document.querySelector(`[data-el-id="${tid}"]`);
        const rs = [...g.querySelectorAll("rect")];
        const zoneH = Math.max(...rs.map((r) => +r.getAttribute("height")));
        const bands = rs.filter((r) => +r.getAttribute("height") > zoneH * 0.05 && +r.getAttribute("height") < zoneH * 0.9).map((r) => ({ depthPx: +r.getAttribute("height"), c: centre(r) }));
        const court = centre(document.querySelector(`[data-el-id="${cid}"]`).querySelector("rect, path, polygon"));
        return { bands, court, zoneH };
      }, { tid: t.id, cid: court.id });
      expect(res.bands.length).toBe(2);
      const ppf = res.zoneH / 175;
      const sixty = res.bands.find((x) => Math.abs(x.depthPx / ppf - 60) < 1), fiftyFive = res.bands.find((x) => Math.abs(x.depthPx / ppf - 55) < 1);
      const d = (c) => Math.hypot(c.x - res.court.x, c.y - res.court.y);
      expect(sixty && fiftyFive).toBeTruthy();
      expect(d(sixty.c)).toBeLessThan(d(fiftyFive.c));
    });

    test("bin removes ONLY that piece: trailer → buffer, walk and road stay and move in; court → its trailer goes too; an end-wall buffer → only it; one undo each", async ({ page }) => {
      const b = await boot(page);
      const dock = await fullDockStack(page);
      const gap = async (kind) => {   // distance from the wall face to the near edge of the layer, along the dock normal (centre − half depth − wall half)
        const k = (await kidsOf(page, b.id)).find((x) => (kind === "buffer" ? x.buffer : kind === "sidewalk" ? x.type === "sidewalk" : kind === "road" ? x.type === "road" : kind === "court" ? x.truckCourt : x.type === "trailer"));
        return k ? { id: k.id, cx: k.cx, cy: k.cy, w: k.w, h: k.h, zd: k.zd } : null;
      };
      const before = { buffer: await gap("buffer"), sidewalk: await gap("sidewalk"), road: await gap("road"), court: await gap("court"), trailer: await gap("trailer") };
      const dist = (k) => Math.hypot(k.cx - (b.cx), k.cy - (b.cy));
      // 1 · bin the trailer: only it goes; the rest keep their depth and slide in by exactly the trailer's depth
      await dock.getByTestId("wall-piece").nth(1).click();
      await page.getByTestId("wall-piece-remove").click();
      await expect(dock.getByTestId("wall-piece")).toHaveCount(4);
      await expect.poll(async () => (await trailerOf(page, b.id)) == null).toBe(true);
      const afterT = { buffer: await gap("buffer"), sidewalk: await gap("sidewalk"), road: await gap("road"), court: await gap("court") };
      for (const k of ["buffer", "sidewalk", "road"]) { expect(afterT[k].zd).toBe(before[k].zd); expect(dist(before[k]) - dist(afterT[k])).toBeCloseTo(before.trailer.zd, 0); }
      expect(dist(afterT.court)).toBeCloseTo(dist(before.court), 3);
      await page.keyboard.press("Control+z");                               // one undo frame brings the trailer back
      await expect(dock.getByTestId("wall-piece")).toHaveCount(5);
      await expect.poll(async () => (await trailerOf(page, b.id)) != null).toBe(true);
      // 2 · bin the court: the trailer opens off it so it goes too; buffer / walk / road stay, now against the wall
      await dock.getByTestId("wall-piece").nth(0).click();
      await expect(page.getByTestId("wall-piece-remove")).toHaveAttribute("title", "Removes the truck court and its trailer parking; everything outside moves in");
      await page.getByTestId("wall-piece-remove").click();
      await expect(dock.getByTestId("wall-piece")).toHaveCount(3);
      await expect.poll(async () => (await kidsOf(page, b.id)).filter((k) => k.truckCourt || k.type === "trailer").length).toBe(0);
      const afterC = { buffer: await gap("buffer"), sidewalk: await gap("sidewalk"), road: await gap("road") };
      for (const k of ["buffer", "sidewalk", "road"]) expect(afterC[k]).toBeTruthy();
      expect(dist(afterC.buffer)).toBeCloseTo(b.h / 2 + afterC.buffer.zd / 2 > 0 ? dist(afterC.buffer) : 0, 0);
      // the court-less wall still reads as ONE strip: kinds buffer · walk · road, depths unchanged, editable
      expect(await dock.getByTestId("wall-piece").evaluateAll((n) => n.map((x) => x.getAttribute("data-kind")))).toEqual(["buffer", "sidewalk", "road"]);
      await dock.getByTestId("wall-piece").nth(0).click();
      const d = page.getByTestId("wall-depth");
      await d.fill("20"); await d.press("Enter");
      await expect.poll(async () => (await gap("buffer")).zd).toBe(20);
      await d.evaluate((el) => el.blur());
      // the Add menu offers the court back at the head, buffer / walk / road — never trailer parking
      await page.keyboard.press("Escape");
      await dock.getByTestId("wall-add").click();
      await expect(page.getByTestId("wall-add-court")).toBeVisible();
      await expect(page.getByTestId("wall-add-trailer")).toHaveCount(0);
      await page.getByTestId("wall-add-court").click();
      await expect(dock.getByTestId("wall-piece").first()).toHaveAttribute("data-kind", "court");
      // …and a reload keeps every layer in place (the load-time heal finds nothing to repair)
      const snap = async () => (await kidsOf(page, b.id)).map((k) => [k.id, Math.round(k.cx), Math.round(k.cy)]).sort();
      const s1 = await snap();
      await page.reload();
      await expect(page.locator(`[data-el-id="${b.id}"]`)).toBeVisible();
      expect(await snap()).toEqual(s1);
      // 3 · an end wall: bin a buffer — only it goes
      await openProps(page, b.id);
      const ends = rowByRole(page, "ends").first();
      await addLayer(ends, "sidewalk"); await addLayer(ends, "buffer");
      await expect(ends.getByTestId("wall-piece")).toHaveCount(2);
      const nKids = (await kidsOf(page, b.id)).length;
      await expect(page.getByTestId("wall-edit-box")).toHaveAttribute("data-kind", "buffer");   // adding opened the new layer's box
      await page.getByTestId("wall-piece-remove").click();
      await expect(ends.getByTestId("wall-piece")).toHaveCount(1);
      expect((await kidsOf(page, b.id)).length).toBe(nKids - 1);
      expect(await ends.getByTestId("wall-piece").first().getAttribute("data-kind")).toBe("sidewalk");
    });

    test("bump-outs leave the dock rows: one line under the wall picker, hidden on a building with no docks", async ({ page }) => {
      const b = await boot(page);
      await expect(page.getByTestId("bump-summary")).toHaveText("Bump-outs none");
      await expect(rowByRole(page, "dock").first().getByTestId("bump-chip")).toHaveCount(0);
      await addLayer(rowByRole(page, "dock").first(), "court");
      await page.getByTestId("picker-corner-add").first().click({ force: true });
      await expect.poll(async () => (await kidsOf(page, b.id)).filter((k) => k.dogEar).length).toBe(1);
      await expect(page.getByTestId("bump-summary")).toHaveText(/^Bump-outs 1 · \d+ × \d+ ft$/);
      await page.getByTestId("bump-edit").click();
      await expect(page.getByTestId("bump-editor")).toBeVisible();
      for (const t of await page.locator('[data-testid^="bump-end-"]').allInnerTexts()) expect(t).toMatch(/^[NSEW]{1,2}$/);
      // cross-dock: each dock wall's pair of end toggles is labelled with that wall's compass letter
      await page.getByTestId("bump-edit").click();
      await page.locator('[data-testid="loading-wall-picker"] [data-wall="top"]').click();
      await expect.poll(async () => (await hostOf(page)).dock).toBe("cross");
      await page.getByTestId("bump-edit").click();
      const groups = await page.locator('[data-testid="bump-editor"] > span[data-wall]').allInnerTexts();
      expect(groups.length).toBe(2);                                       // one pair of end toggles per dock wall…
      for (const g of groups) expect(g).toMatch(/^[NSEW]{1,2} wall/);       // …each labelled with that wall's compass letter
    });

    test("no docks: no bump-outs line, and the wall strips are just empty rows with a +", async ({ page }) => {
      await boot(page);
      await page.locator('[data-testid="loading-wall-picker"] [data-wall]').evaluateAll((n) => n.length);
      const rear = rowByRole(page, "rear");
      await expect(rear.getByTestId("wall-strip")).toHaveCount(0);
      await expect(rear.getByTestId("wall-add")).toHaveCount(1);
    });
  });
}

test("new default colours: canvas and strip follow; a colour the user set keeps winning on both", async ({ page }) => {
  const b = await boot(page, 0);
  const dock = rowByRole(page, "dock").first();
  await addLayer(dock, "court");
  await expect.poll(async () => (await kidsOf(page, b.id)).filter((k) => k.truckCourt).length).toBe(1);
  const courtId = (await kidsOf(page, b.id)).find((k) => k.truckCourt).id;
  const fillOf = (id) => page.evaluate((i) => { const g = document.querySelector(`[data-el-id="${i}"]`); return (g.querySelector("rect, path, polygon").getAttribute("fill") || "").toLowerCase(); }, id);
  const pieceBg = () => dock.getByTestId("wall-piece").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect.poll(() => fillOf(courtId)).toBe("#d5d9de");
  expect(await pieceBg()).toBe("rgb(213, 217, 222)");
  // the user picks a colour for THIS court (the real Fill chip): it wins on the canvas and on the strip, even after a reload
  const pt = await page.evaluate((id) => { const r = document.querySelector(`[data-el-id="${id}"]`).querySelector("rect, path, polygon").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, courtId);
  await page.mouse.dblclick(pt.x, pt.y);
  await page.getByRole("button", { name: /^Fill color$/i }).first().click();
  const target = page.getByRole("group", { name: "Palette colors" }).first().getByRole("button").nth(1);
  const wanted = (await target.getAttribute("title")).toLowerCase();
  await target.click();
  await expect.poll(() => fillOf(courtId)).toBe(wanted);
  await page.reload();
  await expect(page.locator(`[data-el-id="${courtId}"]`)).toBeVisible();
  await expect.poll(() => fillOf(courtId)).toBe(wanted);
  await openProps(page, b.id);
  const hex = (rgb) => "#" + rgb.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  expect(hex(await pieceBg())).toBe(wanted);
});
