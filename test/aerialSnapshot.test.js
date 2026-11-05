/* NEW-1 (2026-11-05) — the pinned map snapshot ("Aerial backdrop") is the aerial: on a LOCATED plan it is drawn by the backdrop MAP under the GIS fills, never by the SVG canvas over them.
 * Owner report: Zoning and Future Land Use "cut out around the site" on the site plan view — the stored snapshot (an opaque rectangle ~1.8× the parcel) painted over every fill when the
 * Map Base was Off. Measured live on planyr.io 2026-11-05 (ui-audit/diagnose-gis-fill-hole.mjs): fills present with the live basemap on, a rectangular hole over the snapshot with it Off. */
import { describe, it, expect } from "vitest";
import { snapshotHostedInMap, snapshotDrawnInCanvas, snapshotBounds } from "../src/workspaces/site-planner/lib/aerialSnapshot.js";
import { feetExtentToBbox, aerialPlacement } from "../src/workspaces/site-planner/lib/arcgis.js";
import { PANE_AREA, PANE_AREA_LABEL, PANE_SNAPSHOT, PANE_SNAPSHOT_Z } from "../src/workspaces/site-planner/lib/mapStack.js";
import { readFileSync } from "node:fs";

const ORIGIN = { lat: 29.6122132390976, lon: -95.6693177247584 };
// the owner's Academy plan's stored snapshot (fields as read from production, 2026-11-05)
const SNAP = { id: "legacy-aerial", kind: "image", fromMap: true, locked: true, opacity: 1, x: -2829.8600019994933, y: -5399.981756616853, imgW: 1085, imgH: 1800, ftPerPx: 5.216331800920725, ftPerPxY: 5.9995397910954456, src: "https://server.arcgisonline.com/x.jpg" };
const HAND = { id: "h1", kind: "image", fromMap: false, opacity: 1, x: 0, y: 0, imgW: 100, imgH: 100, ftPerPx: 1, src: "data:image/png;base64,AA" };

describe("who draws the pinned map snapshot", () => {
  it("located plan, live basemap OFF, aerial shown → the backdrop MAP draws it (the owner's case)", () => {
    expect(snapshotHostedInMap(SNAP, { origin: ORIGIN, basemapOn: false, showAerial: true })).toBe(true);
    expect(snapshotDrawnInCanvas(SNAP, { origin: ORIGIN, showAerial: true })).toBe(false); // …and the SVG canvas must NOT (it paints over every GIS area fill)
  });
  it("located plan, live basemap ON → the live tiles are the aerial; nobody draws the snapshot", () => {
    expect(snapshotHostedInMap(SNAP, { origin: ORIGIN, basemapOn: true, showAerial: true })).toBe(false);
    expect(snapshotDrawnInCanvas(SNAP, { origin: ORIGIN, showAerial: true })).toBe(false);
  });
  it("aerial hidden → nobody draws it", () => {
    expect(snapshotHostedInMap(SNAP, { origin: ORIGIN, basemapOn: false, showAerial: false })).toBe(false);
    expect(snapshotDrawnInCanvas(SNAP, { origin: ORIGIN, showAerial: false })).toBe(false);
  });
  it("UNLOCATED plan: there is no backdrop map and no GIS layers, so the canvas keeps drawing it (unchanged)", () => {
    expect(snapshotHostedInMap(SNAP, { origin: null, basemapOn: false, showAerial: true })).toBe(false);
    expect(snapshotDrawnInCanvas(SNAP, { origin: null, showAerial: true })).toBe(true);
  });
  it("a hidden snapshot record, or one with no picture, is not hosted", () => {
    expect(snapshotHostedInMap({ ...SNAP, visible: false }, { origin: ORIGIN, basemapOn: false, showAerial: true })).toBe(false);
    expect(snapshotHostedInMap({ ...SNAP, src: null }, { origin: ORIGIN, basemapOn: false, showAerial: true })).toBe(false);
  });
  it("a hand-dropped reference is never this module's business — the canvas draws it exactly as before", () => {
    expect(snapshotDrawnInCanvas(HAND, { origin: ORIGIN, showAerial: true })).toBe(true);
    expect(snapshotHostedInMap(HAND, { origin: ORIGIN, basemapOn: false, showAerial: true })).toBe(false);
  });
});

describe("snapshotBounds", () => {
  it("lands where the capture was taken: it round-trips back to the bbox in the snapshot's own URL", () => {
    const [[s, w], [n, e]] = snapshotBounds(SNAP, ORIGIN);
    // bbox in the stored URL (the Esri export the snapshot was captured with)
    expect(w).toBeCloseTo(-95.67823007777187, 3); expect(e).toBeCloseTo(-95.66040537174493, 3);
    expect(s).toBeCloseTo(29.5974288862136, 3); expect(n).toBeCloseTo(29.6269975919816, 3);
    expect(n).toBeGreaterThan(s); expect(e).toBeGreaterThan(w);
  });
  it("is the SAME placement the print uses (feetExtentToBbox) — the screen and the sheet cannot disagree", () => {
    const b = feetExtentToBbox({ minX: SNAP.x, minY: SNAP.y, maxX: SNAP.x + SNAP.imgW * SNAP.ftPerPx, maxY: SNAP.y + SNAP.imgH * SNAP.ftPerPxY }, ORIGIN.lat, ORIGIN.lon);
    expect(snapshotBounds(SNAP, ORIGIN)).toEqual([[b.latMin, b.lonMin], [b.latMax, b.lonMax]]);
    expect(typeof aerialPlacement).toBe("function");
  });
  it("is null for a record with no usable size, or no origin — never a guess", () => {
    expect(snapshotBounds({ ...SNAP, imgW: 0 }, ORIGIN)).toBeNull();
    expect(snapshotBounds({ ...SNAP, ftPerPx: NaN }, ORIGIN)).toBeNull();
    expect(snapshotBounds(SNAP, null)).toBeNull();
  });
});

describe("the stacking model", () => {
  it("the snapshot pane sits UNDER every GIS pane — that is the whole fix", () => {
    expect(PANE_SNAPSHOT).toBe("aerialSnapshotPane");
    expect(PANE_SNAPSHOT_Z).toBeLessThan(200); // under Leaflet's own tile pane too: it IS the basemap
    expect(PANE_SNAPSHOT_Z).toBeLessThan(350);  // GIS area fills (SitePlanner creates PANE_AREA at 350, its labels at 360)
    expect(PANE_AREA).toBe("gisAreaPane"); expect(PANE_AREA_LABEL).toBe("gisAreaLabelPane");
  });
  it("SitePlanner hosts it in that pane and its canvas no longer draws a located plan's snapshot (source guard — red on the pre-fix `origin && basemapOn` stand-down)", () => {
    const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/L\.imageOverlay\(snapOverlay\.src, bounds, \{ pane: PANE_SNAPSHOT/);
    expect(src).toMatch(/o\.fromMap && !snapshotDrawnInCanvas\(o, \{ origin, showAerial \}\)\) return null/);
    expect(src).not.toMatch(/o\.fromMap && \(!showAerial \|\| \(origin && basemapOn\)\)/);
    expect(src).toMatch(/\.createPane\(PANE_SNAPSHOT\)/);
    expect(src).toMatch(/createPane\(PANE_AREA\); areaPane\.style\.zIndex = 350/);
  });
});
