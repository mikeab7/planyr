/* NEW-1 (2026-11-05) — GIS AREA fills (Zoning, Future Land Use, flood zones …) are NEVER cut out by the plan's stored map snapshot.
 *
 * The owner's report: on his Academy plan's site view the Zoning and Future Land Use fills painted all around but "a roughly rectangular block surrounding the site footprint is left
 * unfilled" — while the Map view filled straight across. Measured live 2026-11-05 (ui-audit/diagnose-gis-fill-hole.mjs): the plan carries its pinned "Aerial backdrop" capture
 * (`fromMap`), and with the Map Base set to Off the canvas drew that capture as an SVG image ABOVE the backdrop map, so an opaque rectangle (~1.8× the parcel on every side) painted over
 * every fill. With the live basemap on there was no hole.
 *
 * This drives the REAL planner, logged out, the area service STUBBED at the network boundary (the Wetlands layer, an AREA-only fill like Zoning / Future Land Use: same band, same host;
 * its export is answered with a half-transparent blue picture). The snapshot is a SOLID-GREEN picture, so what is on screen at a point is unambiguous:
 *   known-good arm — with the fill layer OFF the point reads PURE snapshot green (the instrument can see the snapshot; without this arm a missing snapshot would read as a pass);
 *   the assertion  — with the fill layer ON the same point must NOT read pure green: the blue fill shows OVER the snapshot (red on the pre-fix build, where the canvas painted the
 *                    snapshot over it);
 *   structure      — the snapshot is not an SVG image in the canvas and lives in the backdrop map's pane that sits under the GIS area pane.
 */
import { test, expect } from "@playwright/test";
import { openPlannerLayers, setLayer, panelSel } from "./lib/layersPanel.js";

const LAT = 29.6232, LON = -95.624; // Fort Bend
const GREEN = "#00ff00";

test.describe("NEW-1 — the stored map snapshot never covers a GIS area fill", () => {
  test("Map Base Off: the fill shows over the snapshot (and the snapshot is a backdrop-map image, not a canvas one)", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/#/site-planner", { waitUntil: "load" });
    /* two pictures, painted in the page so the spec carries no binary: the solid-green snapshot and the half-transparent blue "fill" the stubbed FEMA export answers with */
    const { snap, fill } = await page.evaluate((g) => {
      const mk = (c) => { const cv = document.createElement("canvas"); cv.width = cv.height = 64; const x = cv.getContext("2d"); x.fillStyle = c; x.fillRect(0, 0, 64, 64); return cv.toDataURL("image/png"); };
      return { snap: mk(g), fill: mk("rgba(0,0,255,0.5)") };
    }, GREEN);
    const FILL_PNG = Buffer.from(fill.split(",")[1], "base64");
    await page.route("**/*", async (r) => {
      const u = new URL(r.request().url());
      if (/\/export$/.test(u.pathname)) return r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "image/png", body: FILL_PNG });
      if (/NFHL/i.test(u.href) || /\/(MapServer|FeatureServer)\//i.test(u.href)) return r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ name: "NFHL", layers: [{ id: 27 }, { id: 28 }] }) });
      if (/\.(jpg|jpeg)(\?|$)/i.test(u.pathname)) return r.abort(); // no aerial tiles in the sandbox
      return r.continue();
    });
    const SITE = {
      schemaVersion: 12, id: "new1-fill-snapshot", groupId: "new1-fill-snapshot", site: "NEW1 Fill Snapshot", name: "NEW1 Fill Snapshot",
      updatedAt: 1783000000000, teamId: null, ownerId: null, scheduleProjectId: null, scheduleProjectName: null,
      origin: { lat: LAT, lon: LON }, county: "fortbend", status: "active",
      parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
      underlay: null, parcelDrawings: [], settings: {}, els: [{ id: "b1", type: "building", cx: 300, cy: 300, w: 400, h: 300, rot: 0 }],
      // the owner's shape: a pinned map capture, opaque, locked, far bigger than the site — 3,000 ft square around the origin here
      sheetOverlays: [{ id: "legacy-aerial", kind: "image", name: "Aerial backdrop", fromMap: true, locked: true, opacity: 1, calibrated: false, knockout: false, rotation: 0, page: 1, pageCount: 1,
        x: -1500, y: -1500, imgW: 64, imgH: 64, ftPerPx: 46.875, ftPerPxY: 46.875, src: snap }],
    };
    await page.evaluate((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));
    await page.reload({ waitUntil: "load" });
    await page.getByText("NEW1 Fill Snapshot", { exact: false }).first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(900);

    await openPlannerLayers(page);
    const panel = page.locator(panelSel("planner")).first();
    await panel.getByTestId("layer-group-base").click();
    await panel.getByTestId("basemap-source").selectOption("off");
    await page.waitForTimeout(1500);

    /* the pixel read: feet → screen through the canvas's own view attributes, then the colour under that point (north-west of the origin: clear of the parcel and the building) */
    const read = async (fx, fy) => {
      const at = await page.evaluate(([x, y]) => {
        const svg = document.querySelector('[data-testid="planner-canvas"]');
        const offX = parseFloat(svg.getAttribute("data-view-offx")), offY = parseFloat(svg.getAttribute("data-view-offy")), ppf = parseFloat(svg.getAttribute("data-view-ppf"));
        const vb = svg.getAttribute("viewBox").split(" ").map(Number), r = svg.getBoundingClientRect();
        return { x: r.left + ((x * ppf + offX) / vb[2]) * r.width, y: r.top + ((y * ppf + offY) / vb[3]) * r.height };
      }, [fx, fy]);
      // the drafting grid is drawn over the backdrop: take the most common colour of a small patch, not one pixel that may sit on a grid line
      const shot = await page.screenshot({ clip: { x: Math.round(at.x) - 12, y: Math.round(at.y) - 12, width: 24, height: 24 } });
      return page.evaluate(async (b64) => {
        const bmp = await createImageBitmap(await (await fetch("data:image/png;base64," + b64)).blob());
        const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height; const x = cv.getContext("2d"); x.drawImage(bmp, 0, 0);
        const d = x.getImageData(0, 0, bmp.width, bmp.height).data, tally = new Map();
        for (let i = 0; i < d.length; i += 4) { const k = `${d[i]},${d[i + 1]},${d[i + 2]}`; tally.set(k, (tally.get(k) || 0) + 1); }
        return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
      }, shot.toString("base64"));
    };
    const isGreen = ([r, g, b]) => r < 12 && g > 243 && b < 12;
    const POINT = [-300, -300];

    // known-good arm — fill OFF: the point reads the snapshot, pure
    const bare = await read(...POINT);
    expect(isGreen(bare), `known-good arm: with the fill layer off the point must read pure snapshot green, got ${bare}`).toBe(true);

    await setLayer(page, "wetlands", true); // an AREA-ONLY fill layer (Environmental › Wetlands) — the stand-in for Zoning / Future Land Use (FEMA also has a line-role half hosted ABOVE the plan, which would show the stub whatever the snapshot does)
    await page.waitForTimeout(3000);   // the stubbed export + paint
    const filled = await read(...POINT);
    expect(isGreen(filled), `the area fill is cut out by the stored snapshot — with the fill on, the point still reads pure snapshot green, got ${filled}`).toBe(false);
    expect(filled[2], `the blue fill must show over the green snapshot, got ${filled}`).toBeGreaterThan(60);

    const where = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const backdrop = [...svg.parentElement.children].find((el) => el.tagName === "DIV" && el.querySelector(".leaflet-container"));
      const snapPane = backdrop && backdrop.querySelector(".leaflet-aerialSnapshot-pane");
      const areaPane = backdrop && backdrop.querySelector(".leaflet-gisArea-pane");
      return {
        snapshotInMap: !!(snapPane && snapPane.querySelector("img")),
        snapshotBelowFills: !!(snapPane && areaPane && parseInt(getComputedStyle(snapPane).zIndex, 10) < parseInt(getComputedStyle(areaPane).zIndex, 10)),
        snapshotInCanvas: !!svg.querySelector('image[href^="data:image/png"]:not([data-overlay-image])'),
      };
    });
    expect(where.snapshotInMap, "the snapshot must be an image in the backdrop map's snapshot pane").toBe(true);
    expect(where.snapshotBelowFills, "the snapshot pane must sit under the GIS area pane").toBe(true);
    expect(where.snapshotInCanvas, "the snapshot must not also be drawn by the canvas (it would cover the fills)").toBe(false);
    expect(errors, errors.join(" | ")).toHaveLength(0);
  });
});
