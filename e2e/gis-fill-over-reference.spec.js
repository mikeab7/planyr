/* NEW-1 second pass (B2671190 ×2, 2026-11-06) — GIS AREA fills paint OVER a hand-dropped reference picture, with the Map Base ON.
 *
 * The owner's report after the first fix (#2876): on Academy › Concept A, Map Base ON, Zoning and Future Land Use still leave a crisp rectangle
 * unfilled around the site, reaching east toward the airport. Measured 2026-11-06: that rectangle is NOT the stored map snapshot (which stands
 * down while the live basemap is on) — it is a PNG he dropped on the plan (2026-10-29), drawn as a reference in the plan SVG, ABOVE the backdrop
 * map that held the fills. The live diagnostic with `--ref` reproduced it on build 49b8f32: 257 of 365 zoning points unpainted.
 *
 * Real planner, logged out, the area service STUBBED at the network boundary (Wetlands — an AREA-only fill, the same band as Zoning / Future Land
 * Use — answered with a half-transparent blue picture), basemap tiles aborted (the Map Base stays ON; nothing paints from it in the sandbox). The
 * reference is a SOLID-GREEN picture, so what is on screen at a point is unambiguous:
 *   known-good arm — fill OFF: the point inside the reference reads pure green (the instrument sees the reference);
 *   the assertion  — fill ON: the same point is NOT pure green, the blue shows over it (red on 49b8f32: the reference covered the fill);
 *   the plan rule  — a point on the building still reads the BUILDING, not the fill (fills stay under the elements);
 *   structure      — the area band anchor sits after the reference image and before the building in the SVG.
 */
import { test, expect } from "@playwright/test";
import { openPlannerLayers, setLayer, panelSel } from "./lib/layersPanel.js";

const LAT = 29.6232, LON = -95.624; // Fort Bend
const GREEN = "#00ff00";

test.describe("NEW-1 second pass — a dropped reference picture never covers a GIS area fill", () => {
  test("Map Base On: the fill shows over an opaque reference, and still under the building", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    test.setTimeout(150_000);
    await page.addInitScript(() => { // the composed sheet is handed to the PDF writer as an image/svg+xml blob — keep a copy to read
      window.__svgBlobs = [];
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (o) => { try { if (o && o.type === "image/svg+xml") o.text().then((t) => window.__svgBlobs.push(t)).catch(() => {}); } catch (_) {} return orig(o); };
    });
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
      if (/\.(jpg|jpeg)(\?|$)/i.test(u.pathname) || /\/tile\//.test(u.pathname)) return r.abort(); // no aerial tiles in the sandbox (the Map Base itself stays ON)
      return r.continue();
    });
    const SITE = {
      schemaVersion: 12, id: "new1-fill-ref", groupId: "new1-fill-ref", site: "NEW1 Fill Reference", name: "NEW1 Fill Reference",
      updatedAt: 1783000000000, teamId: null, ownerId: null, scheduleProjectId: null, scheduleProjectName: null,
      origin: { lat: LAT, lon: LON }, county: "fortbend", status: "active",
      parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
      underlay: null, parcelDrawings: [], settings: {}, els: [{ id: "b1", type: "building", cx: 300, cy: 300, w: 400, h: 300, rot: 0 }],
      // the owner's shape: a hand-dropped picture (NOT `fromMap`), opaque, locked, unscaled, far bigger than the site and offset east of it
      sheetOverlays: [{ id: "ref-png", kind: null, name: "reference.png", locked: true, opacity: 1, visible: true, rotation: 0, page: 1, pageCount: 1, unscaled: true,
        x: -1500, y: -1500, imgW: 64, imgH: 64, ftPerPx: 62.5, src: snap }],
    };
    await page.evaluate((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));
    await page.reload({ waitUntil: "load" });
    await page.getByText("NEW1 Fill Reference", { exact: false }).first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(900);

    await openPlannerLayers(page);
    const panel = page.locator(panelSel("planner")).first();
    await panel.getByTestId("layer-group-base").click();
    expect(await panel.getByTestId("basemap-source").inputValue(), "the Map Base must be ON for this case").not.toBe("off");
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

    // known-good arm — fill OFF: the point reads the reference, pure
    const bare = await read(...POINT);
    expect(isGreen(bare), `known-good arm: with the fill layer off the point must read pure reference green, got ${bare}`).toBe(true);
    const bldg0 = await read(300, 300);

    await setLayer(page, "wetlands", true); // an AREA-ONLY fill layer (Environmental › Wetlands) — the stand-in for Zoning / Future Land Use
    await page.waitForTimeout(3000);   // the stubbed export + paint
    const filled = await read(...POINT);
    expect(isGreen(filled), `the area fill is cut out by the reference picture — with the fill on, the point still reads pure reference green, got ${filled}`).toBe(false);
    expect(filled[2], `the blue fill must show over the green reference, got ${filled}`).toBeGreaterThan(60);
    const bldg1 = await read(300, 300);
    expect(bldg1, "the building must still paint OVER the fill (fills stay under the site elements)").toEqual(bldg0);

    const where = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const all = [...svg.querySelectorAll("*")];
      const ref = svg.querySelector("image[data-overlay-image]");
      const band = svg.querySelector("[data-gis-area-band]");
      const bld = svg.querySelector('[data-el-id="b1"]');
      const backdrop = [...svg.parentElement.children].find((el) => el.tagName === "DIV" && el.querySelector(".leaflet-container"));
      return {
        refIdx: ref ? all.indexOf(ref) : -1, bandIdx: band ? all.indexOf(band) : -1, bldIdx: bld ? all.indexOf(bld) : -1,
        paneInBand: !!(band && band.querySelector(".leaflet-gisArea-pane")),
        paneInBackdrop: !!(backdrop && backdrop.querySelector(".leaflet-gisArea-pane")),
        bandImgs: band ? band.querySelectorAll("img").length : 0,
      };
    });
    expect(where.refIdx, "the reference image must be in the canvas").toBeGreaterThan(-1);
    expect(where.bandIdx, "the area band anchor must come AFTER the reference image").toBeGreaterThan(where.refIdx);
    expect(where.bldIdx, "the building must come AFTER the area band").toBeGreaterThan(where.bandIdx);
    expect(where.paneInBand, "the GIS area pane must live in the in-SVG area band").toBe(true);
    expect(where.paneInBackdrop, "the GIS area pane must not also be in the backdrop map").toBe(false);
    expect(where.bandImgs, "the stubbed fill must be painted inside the band").toBeGreaterThan(0);
    /* PDF-PARITY — the printed sheet lays the fill the same way: INTO the plan's `data-gis-area-band` group, after the reference picture, before the building. */
    await page.locator('button:has-text("File")').first().click();
    await page.locator('button:has-text("Download PDF / pick frame")').click();
    await expect(page.locator('[data-testid="print-frame"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('button:has-text("Continue")').click();
    await expect(page.locator('[data-testid="print-compose"]')).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 });
    let sheet = "";
    await expect.poll(async () => { sheet = (await page.evaluate(() => window.__svgBlobs || [])).find((t) => /data-layer-id="wetlands"/.test(t)) || ""; return sheet.length > 0; }, { timeout: 60_000, message: "the composed sheet never carried the wetlands fill" }).toBe(true);
    const printed = await page.evaluate((t) => {
      const doc = new DOMParser().parseFromString(t, "image/svg+xml");
      const fill = doc.querySelector('[data-layer-id="wetlands"]');
      const ref = doc.querySelector("image[data-overlay-image]");
      // the building itself is lifted out of the page as an editable-PDF annotation (root constraint #28), so the page's proof is the PARCEL — drawn in the page, and
      // above the fill exactly like the elements (the export's own copy of the parcel tier carries `data-feature="parcel:…"`)
      const bld = doc.querySelector('[data-el-id="b1"]') || doc.querySelector('[data-feature^="parcel:"]');
      const FOLLOWING = 4;
      return {
        inBand: !!(fill && fill.closest("[data-gis-area-band]")),
        afterRef: !!(fill && ref && (ref.compareDocumentPosition(fill) & FOLLOWING)),
        bldFound: !!bld,
        beforeBuilding: !bld || !!(fill && (fill.compareDocumentPosition(bld) & FOLLOWING)),
      };
    }, sheet);
    expect(printed.inBand, "on the sheet the fill must sit in the plan's data-gis-area-band group").toBe(true);
    expect(printed.afterRef, "on the sheet the fill must paint OVER the reference picture").toBe(true);
    expect(printed.bldFound, "the sheet carries neither the building nor the parcel — the order check would prove nothing").toBe(true);
    expect(printed.beforeBuilding, "on the sheet the plan (parcel / building) must still paint over the fill").toBe(true);
    expect(errors, errors.join(" | ")).toHaveLength(0);
  });
});
