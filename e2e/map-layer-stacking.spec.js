/* NEW-1 — ONE fixed semantic stacking order: filled GIS layers UNDER the site elements,
 * line/stroke GIS layers OVER them.
 *
 * The owner's report: "I place buildings, then I want to see the site contours, but the
 * contours are now behind the buildings." He ruled out a hold-to-peek key — "whatever an apple
 * or a google would do, lets do" — and neither of those apps lets a user reorder layers, so the
 * answer is a fixed hierarchy plus opacity, with no new mode, shortcut or z-order picker.
 *
 * This drives the REAL planner LOGGED OUT with both GIS services STUBBED at the network
 * boundary (the sandbox's egress proxy blocks the agency hosts, and a spec that depends on a
 * live one is flaky anyway). What it proves is the mechanism the report is about: an AREA layer
 * paints inside the backdrop map below the plan, a LINE layer paints in the map-top host above
 * it, the three hosts carry the model's order, and the layer that now sits over the plan takes
 * no pointer event — so a click still selects the building underneath it.
 */
import { test, expect } from "@playwright/test";

// The Tsakiris tract (Waller County, inside BKDD) — the same coordinates the identify spec uses.
const LAT = 29.77938, LON = -95.89503;
const SITE = {
  schemaVersion: 12, id: "new1-stacking", groupId: "new1-stacking",
  site: "NEW1 Stacking Guard", name: "NEW1 Stacking Guard",
  updatedAt: 1783000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: LAT, lon: LON }, county: "waller", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [],
  settings: {},
  // A building squarely over the site origin — the thing that was burying the contours.
  els: [{ id: "b1", type: "building", cx: 300, cy: 300, w: 400, h: 300, rot: 0 }],
};

const D = 0.0012;
// An AREA layer's geometry: a district easement polygon across the site.
const EASEMENT_JSON = {
  features: [{
    attributes: { width: 70, file: "WF-10.pdf" },
    geometry: { rings: [[[LON - D, LAT - D], [LON + D, LAT - D], [LON + D, LAT + D], [LON - D, LAT + D], [LON - D, LAT - D]]] },
  }],
};
/* A LINE layer's geometry: a watercourse running straight ACROSS the building. The latitude
 * is the building's own row (≈300 ft south of the site origin, at ~364,000 ft per degree), so
 * the stroke crosses the footprint — the exact picture the owner asked for with his contours. */
const HYDRO_JSON = {
  features: [{
    attributes: { gnis_name: "Willow Fork", ftype: 460, fcode: 46006 },
    geometry: { paths: [[[LON - 0.0008, LAT - 0.0011], [LON + 0.0025, LAT - 0.0005]]] },
  }],
};

const toggle = (page, name) => page.getByRole("checkbox", { name, exact: true });

test.describe("NEW-1 — map layer stacking", () => {
  test("area layers paint under the plan, line layers over it, and the top band steals no clicks", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.route("**gisclient.quiddity.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EASEMENT_JSON) }));
    await page.route("**hydro.nationalmap.gov/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(HYDRO_JSON) }));
    await page.route("**/*.jpg", (route) => route.abort()); // no aerial tiles in the sandbox

    await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));
    await page.goto("/#/site-planner", { waitUntil: "load" });
    await page.getByText("NEW1 Stacking Guard", { exact: false }).first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(900); // fit-on-load + first commit settle

    /* 1. THE THREE HOSTS, in the model's order. Positioned siblings in one stacking context,
     *    so their z-index IS the paint order — the backdrop map, then the plan, then the band
     *    that draws over it. */
    const order = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const wrap = svg.parentElement;
      const z = (el) => parseInt(getComputedStyle(el).zIndex, 10);
      const boxes = [...wrap.children].filter((el) => el.tagName === "DIV" && Number.isFinite(z(el)));
      const backdrop = boxes.find((el) => el.querySelector(".leaflet-container"));
      const topHost = boxes.find((el) => el.querySelector(".leaflet-gisLine-pane"));
      return {
        backdrop: backdrop ? z(backdrop) : null,
        plan: z(svg),
        topHost: topHost ? z(topHost) : null,
        topHostEvents: topHost ? getComputedStyle(topHost).pointerEvents : null,
      };
    });
    expect(order.backdrop, "the backdrop map host was not found").not.toBeNull();
    expect(order.topHost, "the map-top host (the line band) was not found").not.toBeNull();
    expect(order.backdrop).toBeLessThan(order.plan);
    expect(order.plan).toBeLessThan(order.topHost);
    // It sits OVER the plan, so if it took pointer events it would swallow every click and drag.
    expect(order.topHostEvents).toBe("none");

    /* 2. Turn ON one layer of each role and prove each landed in its own band. */
    await page.getByRole("button", { name: /Layers/ }).first().click();
    const easements = toggle(page, "District drainage easements"); // AREA role
    await expect(easements).toBeVisible({ timeout: 10000 });
    await easements.click();
    const streams = toggle(page, "Streams, canals & ditches"); // LINE role
    await expect(streams).toBeVisible({ timeout: 10000 });
    await streams.click();
    await page.waitForTimeout(2000); // the (stubbed) pulls + paint

    const where = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const wrap = svg.parentElement;
      const backdrop = [...wrap.children].find((el) => el.tagName === "DIV" && el.querySelector(".leaflet-container"));
      const topHost = [...wrap.children].find((el) => el.tagName === "DIV" && el.querySelector(".leaflet-gisLine-pane"));
      // Scoped to the PLANNER's own hosts: the map finder stays mounted behind the planner
      // (display:none, to keep its map alive) and builds its own copy of both panes, so a bare
      // document.querySelector would sample the wrong map.
      const areaPane = backdrop && backdrop.querySelector(".leaflet-gisArea-pane");
      const linePane = topHost && topHost.querySelector(".leaflet-gisLine-pane");
      const drawn = (pane) => (pane ? pane.querySelectorAll("path, canvas, img").length : -1);
      return {
        areaInBackdrop: !!(areaPane && backdrop && backdrop.contains(areaPane)),
        // The line pane must NOT be inside the backdrop — that is exactly the trap: Leaflet's
        // map pane carries the pan transform, so a pane hosted there can never rise above the
        // plan, whatever z-index it is given.
        lineInBackdrop: !!(backdrop && backdrop.querySelector(".leaflet-gisLine-pane")),
        // Paint order here is z-index, not DOM order: the host is a positioned sibling of the
        // plan in one stacking context, and it is deliberately authored ABOVE the plan in the
        // markup's reading order (next to the backdrop it mirrors).
        lineAbovePlan: !!(topHost && parseInt(getComputedStyle(topHost).zIndex, 10) > parseInt(getComputedStyle(svg).zIndex, 10)),
        areaDrawn: drawn(areaPane),
        lineDrawn: drawn(linePane),
      };
    });
    expect(where.areaInBackdrop, "the AREA pane must live inside the backdrop map, below the plan").toBe(true);
    expect(where.lineInBackdrop, "the LINE pane must NOT live inside the backdrop map — it can never rise above the plan there").toBe(false);
    expect(where.lineAbovePlan).toBe(true);
    expect(where.areaDrawn, "the stubbed easement painted nothing").toBeGreaterThan(0);
    expect(where.lineDrawn, "the stubbed watercourse painted nothing in the top band").toBeGreaterThan(0);

    /* 3. The building under the line band is still selectable — the whole point of the band
     *    being non-interactive. Click its centre; the plan must react, not the overlay. */
    const at = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const offX = parseFloat(svg.getAttribute("data-view-offx"));
      const offY = parseFloat(svg.getAttribute("data-view-offy"));
      const ppf = parseFloat(svg.getAttribute("data-view-ppf"));
      const vb = svg.getAttribute("viewBox").split(" ").map(Number);
      const r = svg.getBoundingClientRect();
      return { x: r.left + ((300 * ppf + offX) / vb[2]) * r.width, y: r.top + ((300 * ppf + offY) / vb[3]) * r.height };
    });
    const hit = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el ? el.closest('[data-testid="planner-canvas"]') !== null : false;
    }, [at.x, at.y]);
    expect(hit, "a point over the building resolves to the overlay instead of the plan canvas").toBe(true);

    /* 4. THE OWNER'S PICTURE: the line layer's stroke genuinely overlaps the building's own
     *    box on screen. Without this the DOM checks above would still pass on a fixture whose
     *    stream happened to miss the footprint entirely. */
    const overlap = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const wrap = svg.parentElement;
      const topHost = [...wrap.children].find((el) => el.tagName === "DIV" && el.querySelector(".leaflet-gisLine-pane"));
      const stroke = topHost.querySelector(".leaflet-gisLine-pane path, .leaflet-gisLine-pane canvas");
      const bldg = svg.querySelector('[data-el-id="b1"]') || svg.querySelector("g");
      if (!stroke || !bldg) return null;
      const a = stroke.getBoundingClientRect(), b = bldg.getBoundingClientRect();
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    });
    expect(overlap, "the line layer's stroke does not reach the building — the fixture proves nothing").toBe(true);

    expect(errors, errors.join(" | ")).toHaveLength(0);
  });
});

/* NEW-1 — "Show above plan": the per-layer lift, and the correction it carries.
 *
 * B1205/B1206 called per-layer OPACITY the escape hatch in the fixed model. That had a hole:
 * opacity cannot fix OCCLUSION for a layer drawn UNDER the site elements — the building still
 * covers it, whatever the slider says. Only order fixes order. This drives the control that
 * replaces that claim, on the real planner, logged out, with the AREA service stubbed.
 *
 * What it proves, and why each strand is here:
 *   (a) the DEFAULT is untouched — the fill starts under the plan, which is what keeps the
 *       owner's contours case a zero-interaction case;
 *   (b) one click moves it into the lifted band, which is hosted INSIDE the plan SVG;
 *   (c) document order — which IS paint order in SVG, with no z-index in play — puts that band
 *       AFTER the buildings and BEFORE the labels and the handle layer. This is the assertion
 *       that would go red if anyone "simplified" the lift into the map-top host, where a filled
 *       wash would paint over the grip you are dragging;
 *   (d) it actually PAINTS: the pixels over the building change when you flip it. A DOM-only
 *       pass would be satisfied by a <foreignObject> the browser silently refused to render;
 *   (e) it steals nothing — the building under it still takes the click;
 *   (f) it survives a round trip, because the lift is remembered per plan.
 */
test.describe("NEW-1 — show a layer above the plan", () => {
  test("a filled layer under the buildings can be lifted over them with one click, and stays under the labels and handles", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.route("**gisclient.quiddity.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EASEMENT_JSON) }));
    await page.route("**/*.jpg", (route) => route.abort()); // no aerial tiles in the sandbox

    await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));
    await page.goto("/#/site-planner", { waitUntil: "load" });
    await page.getByText("NEW1 Stacking Guard", { exact: false }).first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(900);

    // The lifted band's host exists inside the plan SVG from the start — it is a tier, not a
    // thing that appears when used. (Hosting it outside the SVG is what this whole feature
    // deliberately does NOT do; see the model's known-deviation note.)
    const hostInSvg = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const band = svg.querySelector("[data-gis-front-band]");
      return { present: !!band, inSvg: !!(band && svg.contains(band)), hasForeign: !!(band && band.querySelector("foreignObject")) };
    });
    expect(hostInSvg.present, "the data-gis-front-band anchor is missing from the plan SVG").toBe(true);
    expect(hostInSvg.inSvg).toBe(true);
    expect(hostInSvg.hasForeign, "the lifted band has no foreignObject host — a Leaflet pane cannot live in the SVG without one").toBe(true);

    await page.getByRole("button", { name: /Layers/ }).first().click();
    const easements = toggle(page, "District drainage easements"); // an AREA-role source: liftable
    await expect(easements).toBeVisible({ timeout: 10000 });
    await easements.click();
    await page.waitForTimeout(2000);

    // (a) THE DEFAULT: under the plan, in the backdrop map's own pane. No interaction needed for
    //     the case the owner actually reported, and none taken here.
    const before = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const backdrop = [...svg.parentElement.children].find((el) => el.tagName === "DIV" && el.querySelector(".leaflet-container"));
      const band = svg.querySelector("[data-gis-front-band]");
      const drawn = (p) => (p ? p.querySelectorAll("path, canvas, img").length : 0);
      return {
        inBackdrop: drawn(backdrop && backdrop.querySelector(".leaflet-gisArea-pane")),
        inFront: drawn(band && band.querySelector(".leaflet-gisAreaFront-pane")),
      };
    });
    expect(before.inBackdrop, "the stubbed easement painted nothing in the default band").toBeGreaterThan(0);
    expect(before.inFront, "nothing may sit in the lifted band before anything is lifted").toBe(0);

    // The control itself: a line layer is already above, so its control renders in the on state
    // and inert — the row never has to be interpreted.
    const lift = page.getByRole("checkbox", { name: "Show District drainage easements above plan", exact: true });
    await expect(lift).toBeVisible({ timeout: 10000 });
    await expect(lift).not.toBeChecked();
    await expect(lift).toBeEnabled();

    /* WHERE to look for the change, derived rather than guessed: the rectangle where the layer's
     * painted geometry ACTUALLY crosses the building. A clip picked by eye (the footprint's
     * centre, say) can easily sit outside the layer's own extent, and would then "pass" as
     * unchanged whether the lift worked or not. Measured here, BEFORE the lift, off the layer in
     * its default band — so the probe is aimed at the one place a working lift must repaint. */
    const clip = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const backdrop = [...svg.parentElement.children].find((el) => el.tagName === "DIV" && el.querySelector(".leaflet-container"));
      const painted = backdrop && backdrop.querySelector(".leaflet-gisArea-pane path, .leaflet-gisArea-pane canvas, .leaflet-gisArea-pane img");
      const bldg = svg.querySelector('[data-el-id="b1"]');
      if (!painted || !bldg) return null;
      const a = painted.getBoundingClientRect(), b = bldg.getBoundingClientRect();
      const x = Math.max(a.left, b.left), y = Math.max(a.top, b.top);
      const w = Math.min(a.right, b.right) - x, h = Math.min(a.bottom, b.bottom) - y;
      return w > 4 && h > 4 ? { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) } : null;
    });
    expect(clip, "the stubbed layer does not cross the building at all — the fixture proves nothing").toBeTruthy();
    const pixelsBefore = await page.screenshot({ clip });

    // (b) ONE CLICK.
    await lift.click();
    await page.waitForTimeout(2200); // the rebuild: Leaflet fixes a pane at construction, so the layer is re-added

    const after = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const backdrop = [...svg.parentElement.children].find((el) => el.tagName === "DIV" && el.querySelector(".leaflet-container"));
      const band = svg.querySelector("[data-gis-front-band]");
      const frontPane = band && band.querySelector(".leaflet-gisAreaFront-pane");
      const drawn = (p) => (p ? p.querySelectorAll("path, canvas, img").length : 0);
      // (c) DOCUMENT ORDER IS PAINT ORDER inside one SVG. DOCUMENT_POSITION_FOLLOWING === 4.
      const FOLLOWING = 4;
      const bldg = svg.querySelector('[data-el-id="b1"]');
      const handles = svg.querySelector("[data-handle-layer]");
      // Measure the PAINTED node, never the pane: a Leaflet pane is a zero-size positioned div,
      // so its own rect would be an empty box at the host's origin and would prove nothing.
      const painted = frontPane && frontPane.querySelector("path, canvas, img");
      const rect = painted ? painted.getBoundingClientRect() : null;
      const bRect = bldg ? bldg.getBoundingClientRect() : null;
      return {
        inBackdrop: drawn(backdrop && backdrop.querySelector(".leaflet-gisArea-pane")),
        inFront: drawn(frontPane),
        frontInsideSvg: !!(frontPane && svg.contains(frontPane)),
        // the band paints AFTER the building…
        afterBuilding: !!(bldg && (bldg.compareDocumentPosition(band) & FOLLOWING)),
        // …and BEFORE the handle layer, which must stay on top of it (a fill over a grip hides it)
        beforeHandles: !!(handles && (band.compareDocumentPosition(handles) & FOLLOWING)),
        // it is inert, so it can neither block a click nor steal a handle
        events: frontPane ? getComputedStyle(frontPane).pointerEvents : null,
        // and it really lands over the footprint, so the picture is real rather than off-screen
        overlapsBuilding: !!(rect && bRect && rect.left < bRect.right && rect.right > bRect.left && rect.top < bRect.bottom && rect.bottom > bRect.top),
      };
    });
    expect(after.inFront, "the lifted layer painted nothing in the front band").toBeGreaterThan(0);
    expect(after.inBackdrop, "the layer must LEAVE the default band, not be drawn in both").toBe(0);
    expect(after.frontInsideSvg, "the lifted band left the plan SVG — it would then paint over the labels and handles").toBe(true);
    expect(after.afterBuilding, "the lifted band does not paint after the building").toBe(true);
    expect(after.beforeHandles, "the lifted band paints over the handle layer — a fill there hides the grip being dragged").toBe(true);
    expect(after.events).toBe("none");
    expect(after.overlapsBuilding, "the lifted layer does not reach the building — the fixture proves nothing").toBe(true);

    // (d) IT ACTUALLY PAINTS. Every check above is DOM-shaped and would be satisfied by a
    //     <foreignObject> the browser quietly declined to render, which is the real risk of
    //     hosting a Leaflet pane inside an SVG. The pixels over the building must change.
    const pixelsAfter = await page.screenshot({ clip });
    expect(Buffer.compare(pixelsBefore, pixelsAfter), "nothing changed on screen over the building — the lifted band is not painting").not.toBe(0);

    // (e) IT STEALS NOTHING: the building under it still takes the click.
    const hit = await page.evaluate(({ x, y, width, height }) => {
      const el = document.elementFromPoint(x + width / 2, y + height / 2);
      return el ? el.closest('[data-testid="planner-canvas"]') !== null : false;
    }, clip);
    expect(hit, "a point over the lifted layer resolves to the band instead of the plan canvas").toBe(true);

    /* VIEWPORT-STABLE — the lifted band is WELDED to the drawing through a gesture. Its host is
     * a third mirror of the wrap's transform, and a mirror written a frame late is exactly the
     * "sling the map and the buildings move separately" class B1122 removed. Pan, then require
     * the lifted layer and the building it covers to have moved by the same amount. */
    const weld = await page.evaluate(async () => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const band = svg.querySelector("[data-gis-front-band]");
      const at = () => {
        const painted = band.querySelector(".leaflet-gisAreaFront-pane path, .leaflet-gisAreaFront-pane canvas, .leaflet-gisAreaFront-pane img");
        const bldg = svg.querySelector('[data-el-id="b1"]');
        return { layer: painted.getBoundingClientRect().left, bldg: bldg.getBoundingClientRect().left };
      };
      const a0 = at();
      const r = svg.getBoundingClientRect();
      const from = { x: r.left + r.width * 0.35, y: r.top + r.height * 0.7 };
      const ev = (type, x, y) => svg.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, pointerId: 1, isPrimary: true }));
      ev("pointerdown", from.x, from.y);
      for (let i = 1; i <= 6; i++) ev("pointermove", from.x - i * 12, from.y);
      ev("pointerup", from.x - 72, from.y);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const a1 = at();
      return { layer: a1.layer - a0.layer, bldg: a1.bldg - a0.bldg };
    });
    // A pan that moved nothing would make this vacuous, so require a real one first.
    expect(Math.abs(weld.bldg), "the pan gesture moved nothing — this strand would prove nothing").toBeGreaterThan(8);
    expect(Math.abs(weld.layer - weld.bldg), `the lifted layer slid ${weld.layer - weld.bldg} away from the building it covers`).toBeLessThan(1.5);

    // (f) IT IS REMEMBERED, because a lift is a decision about THIS plan.
    const saved = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const site = raw["new1-stacking"] || {};
      return site.layerAbove || null;
    });
    expect(saved, "the lift was not persisted onto the plan").toBeTruthy();
    expect(Object.values(saved).some((v) => v === true), `layerAbove holds nothing lifted: ${JSON.stringify(saved)}`).toBe(true);

    expect(errors, errors.join(" | ")).toHaveLength(0);
  });
});
