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
