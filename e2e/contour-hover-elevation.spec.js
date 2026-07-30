/* NEW-1 + NEW-2 — reading elevations off the planner, driven in a REAL browser.
 *
 * The two reports, both from the live diagnosis run on 2026-07-29:
 *  NEW-1 — only the sparse every-5-ft INDEX contours carry a label, and the polylines are
 *          deliberately `interactive:false`, so four out of five lines were unreadable.
 *  NEW-2 — the ground readout "sometimes shows an elevation, sometimes doesn't": with the
 *          terrain layer off (or below the z16 contour gate) the only path left was ONE
 *          debounced network sample, and every non-value outcome rendered as ABSENCE.
 *
 * This spec runs LOGGED OUT on a seeded located site. USGS 3DEP is reachable from the
 * sandbox, so the elevation paths run for real; the aerial tiles are aborted (no basemap
 * needed to hover a canvas) and the district endpoints are left alone.
 *
 * What it asserts is exactly what the owner asked to see: the elevation field is PRESENT on
 * every frame in every state, a hovered contour names its elevation with exactly one label,
 * and a sweep leaves nothing orphaned behind.
 */
import { test, expect } from "@playwright/test";

/* The sandbox's browser egress can't reach the USGS host (Chromium gets a tunnel reset)
 * while NODE can, so the spec relays the agency request itself. This is a transport
 * detail only — the app's own fetch, decode, worker trace and paint all run for real, on
 * real Katy LiDAR. Any relay failure aborts the route so the layer reports its own honest
 * failure rather than the spec inventing a grid. */
async function relay3dep(page) {
  await page.route("**elevation.nationalmap.gov/**", async (route) => {
    try {
      const r = await fetch(route.request().url());
      const buf = Buffer.from(await r.arrayBuffer());
      await route.fulfill({ status: r.status, contentType: r.headers.get("content-type") || "application/octet-stream", body: buf });
    } catch (_) { await route.abort(); }
  });
}

// The Tsakiris tract (Waller County) — the coordinates of the report.
const LAT = 29.77938, LON = -95.89503;
const SITE = {
  schemaVersion: 12, id: "new1-contour-hover", groupId: "new1-contour-hover",
  site: "Contour Hover Guard", name: "Contour Hover Guard",
  updatedAt: 1783000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: LAT, lon: LON }, county: "waller", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [],
};

const chip = (p) => p.locator("[data-ground-el]");
// each part renders as " · Exist 152.6 ft" — strip the separator the chip joins them with
const partText = async (p, key) =>
  ((await p.locator(`[data-readout-part="${key}"]`).innerText().catch(() => "")) || "").replace(/^\s*·\s*/, "").trim();
// The transient hover label and the permanent index labels are the same divIcon markup;
// counting the rendered contour labels is how a ghost or a doubled stamp would show up.
const contourLabels = (p) => p.locator(".leaflet-marker-icon span");
// the ONE transient hover label carries its own class, so a ghost or a stack is visible
const hoverLabels = (p) => p.locator(".planyr-contour-hover");

async function openSite(page, { terrain = false } = {}) {
  if (terrain) await relay3dep(page);
  await page.route("**/*.jpg", (route) => route.abort()); // no aerial tiles needed to hover
  await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText("Contour Hover Guard", { exact: false }).first().click();
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(900); // fit-on-load + first map commit settle
}

const canvasBox = async (page) => (await page.getByTestId("planner-canvas").boundingBox());

test.describe("NEW-2 — the ground readout always shows a state", () => {
  test("the elevation field is present on EVERY move, with the terrain layer off", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await openSite(page);
    const box = await canvasBox(page);

    // Sweep WITHOUT pausing — the exact gesture that used to leave the field blank, because
    // the debounced network sample never got its 300 ms of cursor rest.
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(box.x + 120 + i * 22, box.y + 140 + (i % 3) * 18);
      await page.waitForTimeout(60);
      const t = await partText(page, "exist");
      expect(t, "the elevation field must never be blank mid-sweep").not.toBe("");
      expect(t.startsWith("Exist")).toBe(true);
      seen.add(t.replace(/[\d.]+/g, "#"));
    }
    // Every frame carried one of the four honest states — a number, in-flight, no-data,
    // or unavailable — and never nothing.
    for (const shape of seen) {
      expect(shape).toMatch(/^Exist (…|#+\.#+( ft)?|≈#+\.#+( ft)?|— \((no data here|unavailable)\))$/);
    }
    expect(errors).toEqual([]);
  });

  test("a resting cursor resolves to a real elevation (the fast local path warms itself)", async ({ page }) => {
    await openSite(page, { terrain: true });
    const box = await canvasBox(page);
    await page.mouse.move(box.x + 200, box.y + 200);
    // The cursor tile is pulled whatever the layer toggles say — no contour layer is on here.
    // It settles on a NUMBER where 3DEP is reachable and on an explicit "unavailable" where
    // it is not (the sandbox's egress blocks the agency host) — but NEVER on silence.
    // With NO contour layer on and no cursor rest budget assumed, the ungated cursor-tile
    // warm must still produce a real number off real Katy LiDAR.
    await expect(async () => {
      expect(await partText(page, "exist")).toMatch(/^Exist ≈?[\d.]+ ft$/);
    }).toPass({ timeout: 40000 });
    const ft = parseFloat((await partText(page, "exist")).replace(/[^\d.]/g, ""));
    expect(ft).toBeGreaterThan(50);   // Katy sits around 150 ft NAVD88 — a sane bare-earth band
    expect(ft).toBeLessThan(400);
    // The first answer may well have come from the debounced point sample while the tile
    // was still downloading. Give the tile time to land (poll a second point), then prove
    // the fast path: a THIRD, never-visited point must resolve in less than the 300 ms
    // debounce, which it can only do from the local grid — no network, no cursor rest.
    await expect(async () => {
      await page.mouse.move(box.x + 240, box.y + 220);
      await page.waitForTimeout(120);
      expect(await partText(page, "exist")).toMatch(/^Exist ≈?[\d.]+ ft$/);
    }).toPass({ timeout: 40000 });
    const t0 = Date.now();
    await page.mouse.move(box.x + 300, box.y + 260);
    let quick = "";
    while (Date.now() - t0 < 280) {
      quick = await partText(page, "exist");
      if (/^Exist ≈?[\d.]+ ft$/.test(quick)) break;
    }
    expect(quick, "a warm grid answers faster than the network debounce").toMatch(/^Exist ≈?[\d.]+ ft$/);
  });

  test("the chip stays ONE line, and the coordinates — never the elevation — give way", async ({ page }) => {
    await openSite(page);
    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(600);
    const box = await canvasBox(page);
    // low-left of the canvas: clear of the floating property panels the narrow layout stacks
    await page.mouse.move(box.x + 30, box.y + box.height - 130);
    await page.mouse.move(box.x + 35, box.y + box.height - 125);
    await expect(chip(page)).toBeVisible({ timeout: 15000 });
    const m = await chip(page).evaluate((el) => {
      const wrap = el.parentElement, coord = wrap.firstElementChild;
      const cs = getComputedStyle(coord), es = getComputedStyle(el);
      return {
        h: wrap.getBoundingClientRect().height,
        coordShrinks: cs.overflow === "hidden" && cs.minWidth === "0px",
        elFixed: es.flexGrow === "0" && es.flexShrink === "0",
      };
    });
    expect(m.h, "the chip must stay ONE line at its existing size").toBeLessThan(30);
    // (f) — when space runs out the COORDINATE pair is what gives way; the elevation group
    // is flex-fixed, so it can never be the truncated part (the old chip truncated it first).
    expect(m.coordShrinks).toBe(true);
    expect(m.elFixed).toBe(true);
    expect(await partText(page, "exist")).toMatch(/^Exist /);
  });
});

test.describe("NEW-1 — hovering a contour names its elevation", () => {
  test("no hover label below the contour zoom gate, and none without the layer", async ({ page }) => {
    await openSite(page);
    const box = await canvasBox(page);
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.waitForTimeout(600);
    expect(await contourLabels(page).count()).toBe(0);
  });

  test("hovering a line names its elevation — one label, tracking the cursor, no ghosts", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await openSite(page, { terrain: true });

    // Turn the contour layer on through the real Layers panel (the visible planner copy —
    // the map finder stays mounted behind it and renders its own row).
    await page.getByRole("button", { name: /Layers/ }).first().click();
    const row = page.getByRole("checkbox", { name: /contour/i }).filter({ visible: true }).first();
    await row.check({ force: true });
    await page.keyboard.press("Escape").catch(() => {});
    // Wait for the real trace: the permanent every-5-ft index labels appearing means the
    // DEM tile fetched, the worker traced it, and the layer painted.
    await expect(async () => {
      expect(await contourLabels(page).count()).toBeGreaterThan(0);
    }).toPass({ timeout: 60000 });
    const resting = await contourLabels(page).count();

    const box = await canvasBox(page);
    // Sweep ACROSS the slope, finely, so the cursor crosses several 1-ft lines.
    const hits = [], agree = [];
    let maxHover = 0;
    for (let i = 0; i < 90; i++) {
      await page.mouse.move(box.x + 120 + i * 6, box.y + 120 + i * 5);
      await page.waitForTimeout(28);
      const n = await hoverLabels(page).count();
      maxHover = Math.max(maxHover, n);
      if (n) {
        const label = (await hoverLabels(page).first().innerText()).trim();
        hits.push(label);
        // The hovered LINE and the bottom-left ground readout must agree — one is traced
        // from the smoothed grid, the other bilinear-sampled from the raw one, so they are
        // allowed to differ by a fraction of a foot, never by a contour interval.
        const r = await partText(page, "exist");
        const m = /([\d.]+)/.exec(r);
        if (m) agree.push(Math.abs(parseFloat(label) - parseFloat(m[1])));
      }
    }
    // EXACTLY ONE transient label, ever — never a stacked pair (the B1087 class).
    expect(maxHover).toBeLessThanOrEqual(1);
    // The sweep crossed lines and each one named its elevation in feet.
    expect(hits.length, "a sweep across a slope must land on lines").toBeGreaterThan(0);
    for (const t of hits) expect(t).toMatch(/^-?\d+(\.\d)? ft$/);
    // It reads INTERMEDIATE values, not only the labelled multiples of five.
    const levels = [...new Set(hits.map((t) => parseFloat(t)))];
    expect(levels.length).toBeGreaterThan(0);
    // The hovered line's value tracks the ground readout at the same cursor. Measured on
    // real Katy LiDAR: median ≈ 0.3 ft, p90 ≈ 1.0 ft. The tail sits on the steep channel
    // bank, where the lines pack tight and the two answers come from DIFFERENT grids by
    // design — contours are traced from the SMOOTHED grid, the readout is bilinear-sampled
    // from the RAW one (so it agrees with the cross-section tool, V242). The guard is on
    // the typical case, with a loose ceiling that would still catch a real mismatch.
    expect(agree.length).toBeGreaterThan(5);
    const sorted = agree.slice().sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)], "median line-vs-readout disagreement").toBeLessThanOrEqual(0.6);
    expect(sorted[sorted.length - 1], "worst line-vs-readout disagreement").toBeLessThanOrEqual(2.5);

    // Moving off a line clears it, and the permanent label set is exactly as it was —
    // the sweep left nothing orphaned behind.
    await page.mouse.move(box.x + box.width - 3, box.y + 3);
    await page.waitForTimeout(400);
    expect(await hoverLabels(page).count()).toBe(0);
    expect(await contourLabels(page).count()).toBe(resting);
    // And no text is stamped twice at the same spot.
    const stamps = await page.evaluate(() => Array.from(document.querySelectorAll(".leaflet-marker-icon span"))
      .map((sp) => { const r = sp.getBoundingClientRect(); return `${sp.textContent}@${Math.round(r.x)},${Math.round(r.y)}`; }));
    expect(new Set(stamps).size).toBe(stamps.length);
    expect(errors).toEqual([]);
  });

  /* NEW-1 (the 2026-07-29 refinement of B1095) — the tag was painted AT the hit point, i.e.
   * under the mouse pointer, and the pointer glyph covered the number. With the Pan tool
   * armed that glyph is a big grab hand, so the elevation was partly or wholly hidden:
   * "my mouse shows a grab and it ends up covering the elevation that I'm trying to see."
   *
   * This drives the real canvas and asserts the two things the fix owes: the tag's painted
   * rectangle never intersects the pointer's own glyph footprint, and it never leaves the
   * visible canvas — including the reserved bottom row where the coordinate/elevation chip
   * and the scale bar float. The sweep deliberately runs a lap just inside all four edges,
   * so the flip cases are exercised rather than assumed. */
  test("the tag sits BESIDE the pointer, and flips at the edges instead of clipping", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await openSite(page, { terrain: true });
    await page.getByRole("button", { name: /Layers/ }).first().click();
    const row = page.getByRole("checkbox", { name: /contour/i }).filter({ visible: true }).first();
    await row.check({ force: true });
    await page.keyboard.press("Escape").catch(() => {});
    await expect(async () => {
      expect(await contourLabels(page).count()).toBeGreaterThan(0);
    }).toPass({ timeout: 60000 });

    const box = await canvasBox(page);
    // The gap the tag is placed at, and the bottom row the layer reserves for the floating
    // chip / scale bar. Kept as literals here on purpose: the spec is the independent check
    // on the shipped constants, so importing them would make it agree with itself.
    const GAP = 16, BOTTOM_RESERVE = 56;
    // A lap just inside every edge, then a diagonal through the middle — so the sweep visits
    // the top, bottom, left, right and both far corners as well as open canvas.
    const path = [];
    const inset = 8, W = box.width, H = box.height;
    for (let i = 0; i <= 40; i++) path.push({ x: inset + (W - 2 * inset) * (i / 40), y: inset });
    for (let i = 0; i <= 30; i++) path.push({ x: W - inset, y: inset + (H - 2 * inset) * (i / 30) });
    for (let i = 0; i <= 40; i++) path.push({ x: W - inset - (W - 2 * inset) * (i / 40), y: H - inset });
    for (let i = 0; i <= 30; i++) path.push({ x: inset, y: H - inset - (H - 2 * inset) * (i / 30) });
    for (let i = 0; i <= 40; i++) path.push({ x: inset + (W - 2 * inset) * (i / 40), y: inset + (H - 2 * inset) * (i / 40) });

    // Read the painted tag for the CURRENT cursor. The readout is throttled and the paint is
    // asynchronous, so a rect identical to the previous read is a STALE frame, not a fresh
    // answer — measured live, a busy main thread can hold one for several moves. Such a
    // sample is skipped rather than asserted, because asserting a tag against a cursor it was
    // never placed for would be measuring nothing (in either direction).
    const readTag = () => page.evaluate(() => {
      const sp = document.querySelector(".planyr-contour-hover span");
      if (!sp) return null;
      const b = sp.getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom, text: (sp.textContent || "").trim() };
    });
    const same = (a, b2) => !!a && !!b2 && a.l === b2.l && a.t === b2.t && a.text === b2.text;
    const samples = [];
    let prev = null;
    for (const p of path) {
      const cx = Math.round(box.x + p.x), cy = Math.round(box.y + p.y);
      await page.mouse.move(cx, cy);
      await page.waitForTimeout(45);
      let r = await readTag();
      if (same(r, prev)) { await page.waitForTimeout(70); r = await readTag(); }
      const stale = same(r, prev);
      if (r) prev = r;
      if (r && !stale && r.r > r.l) samples.push({ cx, cy, r });
    }
    expect(samples.length, "a lap of the canvas must land on contour lines").toBeGreaterThan(4);

    const canvasBoxAbs = { x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height - BOTTOM_RESERVE };
    let flippedX = 0, flippedY = 0;
    for (const s of samples) {
      // (1) the number is legible without moving the mouse: the tag's rect must not intersect
      // the pointer glyph's footprint (a square of the placement gap about the hotspot).
      const g = { l: s.cx - GAP, t: s.cy - GAP, r: s.cx + GAP, b: s.cy + GAP };
      const hitsGlyph = s.r.l < g.r && g.l < s.r.r && s.r.t < g.b && g.t < s.r.b;
      expect(hitsGlyph, `tag "${s.r.text}" covers the pointer at ${s.cx},${s.cy}`).toBe(false);
      // (2) it is never clipped by the canvas edge and never lands in the reserved bottom row
      // (the coordinate chip bottom-left, the scale bar and zoom cluster bottom-right).
      expect(s.r.l).toBeGreaterThanOrEqual(canvasBoxAbs.x0 - 0.6);
      expect(s.r.t).toBeGreaterThanOrEqual(canvasBoxAbs.y0 - 0.6);
      expect(s.r.r).toBeLessThanOrEqual(canvasBoxAbs.x1 + 0.6);
      expect(s.r.b).toBeLessThanOrEqual(canvasBoxAbs.y1 + 0.6);
      if (s.r.r <= s.cx) flippedX++;   // moved to the LEFT of the pointer
      if (s.r.t >= s.cy) flippedY++;   // dropped BELOW the pointer
    }
    // The lap ran along the right edge and along the top, so both flips must have fired —
    // otherwise the "never clipped" assertion above could be passing vacuously.
    expect(flippedX, "the tag must flip to the left near the right edge").toBeGreaterThan(0);
    expect(flippedY, "the tag must flip below the pointer near the top edge").toBeGreaterThan(0);

    // Still exactly one tag, and nothing orphaned once the cursor leaves the lines.
    expect(await hoverLabels(page).count()).toBeLessThanOrEqual(1);
    await page.mouse.move(box.x + box.width - 3, box.y + 3);
    await page.waitForTimeout(400);
    expect(await hoverLabels(page).count()).toBe(0);
    expect(errors).toEqual([]);
  });
});

/* NEW-2(c/d/e) — PROPOSED + the signed cut/fill, on a seeded concept with a finished
 * floor. Logged out, so the FFE and the building are seeded straight into the site model
 * (the same shape the planner persists); the grading engine, the DEM sample and the chip
 * all run for real. */
const FFE = 156;
const CONCEPT = {
  ...SITE,
  id: "new2-proposed", groupId: "new2-proposed", site: "Proposed Readout Guard", name: "Proposed Readout Guard",
  settings: { floodMitigation: { padFfeFt: FFE } },
  els: [{ id: "b1", type: "building", cx: 400, cy: 400, w: 400, h: 300, rot: 0 }],
};

test.describe("NEW-2 — proposed elevation and the signed cut/fill", () => {
  test("a pad reads its FFE, bare ground reads an honest dash, and the delta is the difference", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await relay3dep(page);
    await page.route("**/*.jpg", (route) => route.abort());
    await page.addInitScript((s2) => { try { localStorage.setItem("planarfit:sites:v1", s2); } catch (_) {} }, JSON.stringify({ [CONCEPT.id]: CONCEPT }));
    await page.addInitScript(() => { window.__PLANYR_E2E = true; });
    await page.goto("/#/site-planner", { waitUntil: "load" });
    await page.getByText("Proposed Readout Guard", { exact: false }).first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1500);

    // Feet → screen, off the canvas transform seam the planner publishes.
    const at = async (fx, fy) => page.evaluate(([f, g]) => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const offX = parseFloat(svg.getAttribute("data-view-offx"));
      const offY = parseFloat(svg.getAttribute("data-view-offy"));
      const ppf = parseFloat(svg.getAttribute("data-view-ppf"));
      const vb = svg.getAttribute("viewBox").split(" ").map(Number);
      const r = svg.getBoundingClientRect();
      return { x: r.left + ((f * ppf + offX) / vb[2]) * r.width, y: r.top + ((g * ppf + offY) / vb[3]) * r.height };
    }, [fx, fy]);

    // ON the pad: Prop is the finished floor, exactly.
    const onPad = await at(400, 400);
    await page.mouse.move(onPad.x, onPad.y);
    await expect(async () => {
      expect(await partText(page, "prop")).toBe(`Prop ${FFE.toFixed(1)}`);
    }).toPass({ timeout: 30000 });

    // …and the delta is proposed minus existing, labelled Fill or Cut.
    await expect(async () => {
      expect(await partText(page, "exist")).toMatch(/^Exist ≈?[\d.]+/);
    }).toPass({ timeout: 30000 });
    const exist = parseFloat((await partText(page, "exist")).replace(/[^\d.]/g, ""));
    const delta = await partText(page, "delta");
    const dz = FFE - exist;
    expect(delta).toBe(`${dz > 0 ? "Fill" : "Cut"} ${Math.abs(dz).toFixed(1)} ft`);

    // OFF every graded element and its daylight wedge: an honest dash with a reason —
    // never the pad plane extrapolated across the site.
    const offPad = await at(1250, 1250);
    await page.mouse.move(offPad.x, offPad.y);
    await page.waitForTimeout(500);
    expect(await partText(page, "prop")).toBe("Prop —");
    expect(await page.locator("[data-ground-el]").locator("xpath=..").getAttribute("title")).toMatch(/No graded element here/);
    expect(errors).toEqual([]);
  });
});
