/* NEW-1 (2026-11-25, owner: public street names "don't show up on the exhibit … have it match whatever is on the site plan") — the
 * sheet renders its own copy of the Site Plan map's road lines + names at the SHEET's scale. These pin the scale maths and the two
 * gates: the Site Plan map's own zoom gate (no roads on a frame so wide the screen would not draw them) and the WebGL buffer cap. */
import { describe, it, expect } from "vitest";
import { roadNamesSnapshotPlan, SNAPSHOT_MAX_DEVICE_PX } from "../src/shared/basemaps/roadNamesSnapshot.js";
import { SITE_ROADS_FROM, VECTOR_ZOOM_OFFSET } from "../src/shared/basemaps/basemaps.js";
import { readFileSync } from "node:fs";
import { plannerSource } from "./helpers/plannerSource.js";

const LAT = 29.76; // Houston
const zoomAt = (ppf, lat = LAT) => Math.log2((40075016.686 * Math.cos((lat * Math.PI) / 180) * ppf) / (512 * 0.3048)) + VECTOR_ZOOM_OFFSET;

describe("roadNamesSnapshotPlan", () => {
  it("a typical letter sheet of a 40-acre site: CSS size = extent × sheet ppf, crisp pixel ratio, a zoom the Site map draws roads at", () => {
    const p = roadNamesSnapshotPlan({ extentWft: 1800, extentHft: 1200, labelPpf: 0.55, lat: LAT });
    expect(p).not.toBeNull();
    expect(p.cssW).toBe(990);
    expect(p.cssH).toBe(660);
    expect(p.pixelRatio).toBeGreaterThanOrEqual(2);
    expect(p.cssW * p.pixelRatio).toBeLessThanOrEqual(SNAPSHOT_MAX_DEVICE_PX + 1);
    expect(p.leafletZoom).toBeCloseTo(zoomAt(0.55), 6);
    expect(p.glZoom).toBeCloseTo(p.leafletZoom - VECTOR_ZOOM_OFFSET, 9);
    expect(p.leafletZoom).toBeGreaterThanOrEqual(SITE_ROADS_FROM);
  });
  it("zoom follows the sheet scale: twice the px-per-foot is exactly one zoom level deeper", () => {
    const a = roadNamesSnapshotPlan({ extentWft: 1000, extentHft: 800, labelPpf: 0.4, lat: LAT });
    const b = roadNamesSnapshotPlan({ extentWft: 1000, extentHft: 800, labelPpf: 0.8, lat: LAT });
    expect(b.leafletZoom - a.leafletZoom).toBeCloseTo(1, 9);
  });
  it("a frame so wide the Site Plan map would draw no roads draws none on the sheet either", () => {
    let ppf = 0.5;
    while (zoomAt(ppf) >= SITE_ROADS_FROM) ppf /= 2;
    expect(roadNamesSnapshotPlan({ extentWft: 1000, extentHft: 1000, labelPpf: ppf, lat: LAT })).toBeNull();
    expect(roadNamesSnapshotPlan({ extentWft: 1000, extentHft: 1000, labelPpf: ppf * 4, lat: LAT })).not.toBeNull();
  });
  it("a huge frame never asks WebGL for more than the buffer cap, and still at least 2× pixels", () => {
    const p = roadNamesSnapshotPlan({ extentWft: 20000, extentHft: 9000, labelPpf: 2, lat: LAT });
    expect(p).not.toBeNull();
    expect(Math.max(p.cssW, p.cssH) * p.pixelRatio).toBeLessThanOrEqual(SNAPSHOT_MAX_DEVICE_PX + 2);
    expect(p.pixelRatio).toBeGreaterThanOrEqual(2);
    expect(p.cssW / p.cssH).toBeCloseTo(20000 / 9000, 2); // the shape of the frame is kept
  });
  it("refuses nonsense input instead of drawing a wrong picture", () => {
    expect(roadNamesSnapshotPlan({ extentWft: 0, extentHft: 10, labelPpf: 1, lat: LAT })).toBeNull();
    expect(roadNamesSnapshotPlan({ extentWft: 10, extentHft: 10, labelPpf: 0, lat: LAT })).toBeNull();
    expect(roadNamesSnapshotPlan({ extentWft: 10, extentHft: 10, labelPpf: 1, lat: NaN })).toBeNull();
  });
});

describe("the sheet follows the Layers panel's Road Names row (no print-only switch)", () => {
  // source-scan: the wiring between the planner and the lazy export chunk has no pure seam to call (the export needs a live DOM + WebGL; the live behaviour is ui-audit/verify-exhibit-road-names.mjs)
  const src = readFileSync(new URL("../src/workspaces/site-planner/lib/exportSheet.js", import.meta.url), "utf8");
  const planner = plannerSource();
  it("the planner hands the export the same Road Names on/opacity the map uses", () => {
    expect(planner).toMatch(/roadNamesOn: roadNamesPref\.on, roadNamesOpacity: roadNamesPref\.opacity/);
  });
  it("off → no render, no fetch", () => {
    expect(src).toMatch(/if \(!roadNamesOn \|\| !origin\) return null;/);
  });
  it("both sheet paths (PNG and PDF) ask for them at the sheet's own scale", () => {
    expect((src.match(/exportAerialForFrame\(printFrame, sheetLabelPpfFor\(printFrame/g) || []).length).toBe(2);
  });
  it("a failed render is said out loud, never a silent omission", () => {
    expect(src).toMatch(/Couldn't load the street names from the map/);
  });
});
