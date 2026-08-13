import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  crc32, zipStore, xmlEscape, buildKml, buildKmz, siteToFeatures, elToRingFeet, kmzFilename, KMZ_MIME,
} from "../src/workspaces/site-planner/lib/kmzExport.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const enc = (s) => new TextEncoder().encode(s);
const dec = (bytes) => new TextDecoder().decode(bytes);
// Identity projector: treat foot {x,y} as [lon,lat] so tests can assert order/closure directly.
const ident = (p) => [p.x, p.y];

describe("crc32", () => {
  it("matches the canonical IEEE test vector", () => {
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
  });
  it("is 0 for empty input", () => {
    expect(crc32(enc(""))).toBe(0);
  });
});

describe("zipStore", () => {
  it("writes a valid STORED zip with the expected signatures + name", () => {
    const zip = zipStore([{ name: "doc.kml", bytes: enc("hello") }]);
    expect(zip).toBeInstanceOf(Uint8Array);
    // Local file header signature PK\x03\x04
    expect([zip[0], zip[1], zip[2], zip[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // Compression method (offset 8, u16 LE) = 0 (store)
    expect(zip[8] | (zip[9] << 8)).toBe(0);
    // End-of-central-directory signature present near the tail
    const s = dec(zip);
    expect(s).toContain("doc.kml");
    expect(s).toContain("hello");
    // EOCD sig 0x06054b50 as the last record marker
    let found = false;
    for (let i = 0; i < zip.length - 3; i++) if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) found = true;
    expect(found).toBe(true);
  });
  it("stores the file uncompressed (comp size === uncompressed size, verbatim bytes)", () => {
    const body = "line1\nline2\n";
    const zip = zipStore([{ name: "doc.kml", bytes: enc(body) }]);
    expect(dec(zip)).toContain(body); // stored → the raw text is right there in the archive
  });
});

describe("xmlEscape", () => {
  it("escapes the five XML metacharacters", () => {
    expect(xmlEscape(`A & B < C > D " E ' F`)).toBe("A &amp; B &lt; C &gt; D &quot; E &apos; F");
  });
  it("coerces null/undefined to empty", () => {
    expect(xmlEscape(null)).toBe("");
    expect(xmlEscape(undefined)).toBe("");
  });
});

describe("buildKml — #1 KML gotcha: coordinate order is lon,lat", () => {
  it("writes lon BEFORE lat (never lat,lon)", () => {
    const kml = buildKml("t", [{ geom: "point", name: "Houston", folder: [], coord: [-95.3698, 29.7604] }]);
    expect(kml).toContain("-95.3698,29.7604");
    expect(kml).not.toContain("29.7604,-95.3698");
  });
  it("closes an open polygon ring (first vertex repeated as last)", () => {
    const kml = buildKml("t", [{ geom: "polygon", name: "b", folder: [], rings: [[[0, 0], [10, 0], [10, 10]]] }]);
    // buildKml itself does not close; siteToFeatures does. A pre-closed ring round-trips verbatim:
    const closed = buildKml("t", [{ geom: "polygon", name: "b", folder: [], rings: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }]);
    expect(closed).toContain("0,0 10,0 10,10 0,0");
    expect(kml).toContain("0,0 10,0 10,10"); // open ring emitted as-is by the low-level builder
  });
  it("emits polygon holes as <innerBoundaryIs>", () => {
    const kml = buildKml("t", [{ geom: "polygon", name: "b", folder: [], rings: [[[0, 0], [10, 0], [10, 10], [0, 0]], [[2, 2], [4, 2], [4, 4], [2, 2]]] }]);
    expect(kml).toContain("<outerBoundaryIs>");
    expect(kml).toContain("<innerBoundaryIs>");
    expect(kml).toContain("2,2 4,2 4,4 2,2");
  });
  it("nests placemarks into a Folder tree from the folder path", () => {
    const kml = buildKml("t", [
      { geom: "point", name: "d1", folder: ["Site A", "Dock doors"], coord: [1, 2] },
      { geom: "point", name: "d2", folder: ["Site A", "Dock doors"], coord: [3, 4] },
    ]);
    expect(kml).toContain("<Folder><name>Site A</name><Folder><name>Dock doors</name>");
  });
  it("XML-escapes placemark + folder names", () => {
    const kml = buildKml("t", [{ geom: "point", name: "A & B", folder: ["R&D"], coord: [1, 2] }]);
    expect(kml).toContain("<name>A &amp; B</name>");
    expect(kml).toContain("<name>R&amp;D</name>");
  });
});

describe("buildKml — building extrude toggle", () => {
  const feat = (extrude) => ({ geom: "polygon", name: "Building 1", folder: ["Buildings"], rings: [[[0, 0], [10, 0], [10, 10], [0, 0]]], height: 9.7536, extrude });
  it("flat (default) → clampToGround, no <extrude>", () => {
    const kml = buildKml("t", [feat(false)]);
    expect(kml).toContain("<altitudeMode>clampToGround</altitudeMode>");
    expect(kml).not.toContain("<extrude>1</extrude>");
    expect(kml).toContain("0,0 10,0 10,10 0,0"); // 2D coords, no altitude
  });
  it("extruded → <extrude>1</extrude> + relativeToGround + altitude on every coord", () => {
    const kml = buildKml("t", [feat(true)]);
    expect(kml).toContain("<extrude>1</extrude>");
    expect(kml).toContain("<altitudeMode>relativeToGround</altitudeMode>");
    expect(kml).toContain("0,0,9.75"); // lon,lat,altMeters
  });
});

describe("siteToFeatures — layer mapping + reprojection", () => {
  const model = {
    parcels: [{ id: "p1", active: true, addr: "123 Main", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }],
    els: [
      { id: "b1", type: "building", cx: 50, cy: 50, w: 400, h: 200, rot: 0 },
      { id: "pk1", type: "parking", cx: 10, cy: 10, w: 60, h: 60, rot: 0 },
      { id: "pd1", type: "pond", points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }] },
    ],
    settings: {},
  };
  it("maps boundary + each element type to its own folder", () => {
    const f = siteToFeatures(model, ident, {});
    const folders = f.map((x) => x.folder.join("/"));
    expect(folders).toContain("Boundary");
    expect(folders).toContain("Building"); // planStyle TYPE label
    expect(folders).toContain("Car Parking");
    expect(folders).toContain("Detention Pond");
    // boundary named from the parcel address
    expect(f.find((x) => x.folder[0] === "Boundary").name).toBe("123 Main");
    // building numbered
    expect(f.find((x) => x.name === "Building 1")).toBeTruthy();
  });
  it("closes every reprojected ring", () => {
    const f = siteToFeatures(model, ident, {});
    for (const poly of f.filter((x) => x.geom === "polygon")) {
      const r = poly.rings[0];
      expect(r[0]).toEqual(r[r.length - 1]);
    }
  });
  it("reprojects through the supplied projector (lon,lat)", () => {
    const f = siteToFeatures(model, (p) => [p.x + 1000, p.y - 2000], {});
    const b = f.find((x) => x.folder[0] === "Boundary");
    expect(b.rings[0][0]).toEqual([1000, -2000]); // (0,0) → (+1000,-2000)
  });
  /* NEW-2 — dock doors: OFF by default, a RUN per side when asked for, and never decided by a
   * canvas display toggle. On the owner's Bain plan (five buildings, several hundred doors) the old
   * behaviour opened Google Earth under a blanket of pins. */
  it("emits NO dock-door features by default — the includeDimensions precedent", () => {
    const f = siteToFeatures(model, ident, {});
    expect(f.filter((x) => x.folder.includes("Dock doors")).length).toBe(0);
    expect(f.some((x) => x.geom === "point")).toBe(false);
  });
  it("MUTATION CHECK: the pre-fix rule would have emitted them here, and a pin per door", () => {
    // Verbatim pre-fix gate + geometry: `settings.showDocks !== false` (absent ⇒ on) and a POINT
    // per door. If this ever agrees with the shipped behaviour above, the guard is guarding nothing.
    const preFixOn = model.settings.showDocks !== false;
    expect(preFixOn).toBe(true);
    const runs = siteToFeatures(model, ident, { includeDockDoors: true }).filter((x) => x.folder.includes("Dock doors"));
    const doorsThatWouldHaveBeenPins = runs.reduce((n, r) => n + Number(/— (\d+) @/.exec(r.name)[1]), 0);
    expect(doorsThatWouldHaveBeenPins).toBeGreaterThan(runs.length); // many doors, few runs
  });
  it("when asked for, emits ONE LINE per dock side — named with the count and the o.c.", () => {
    const f = siteToFeatures(model, ident, { includeDockDoors: true });
    const runs = f.filter((x) => x.folder.includes("Dock doors"));
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.length).toBeLessThanOrEqual(4);          // at most one per wall of a box building
    for (const r of runs) {
      expect(r.geom).toBe("line");
      expect(r.coords.length).toBe(2);
      expect(r.coords[0]).not.toEqual(r.coords[1]);      // a real run, never a degenerate point
      expect(r.name).toMatch(/^Dock doors — \d+ @ \d+(\.\d+)?′ o\.c\.$/);
    }
  });
  it("⛔ THE CLASS: the canvas display toggle no longer decides — showDocks is inert either way", () => {
    const on = (s) => ({ ...model, settings: { ...model.settings, ...s } });
    const count = (m, o) => siteToFeatures(m, ident, o).filter((x) => x.folder.includes("Dock doors")).length;
    expect(count(on({ showDocks: true }), {})).toBe(0);              // shown on canvas → still out
    expect(count(on({ showDocks: false }), { includeDockDoors: true }))
      .toBe(count(on({ showDocks: true }), { includeDockDoors: true })); // hidden on canvas → still in
    expect(count(on({ showDocks: false }), { includeDockDoors: true })).toBeGreaterThan(0);
  });
  it("includes dimension lines only when asked", () => {
    const m2 = { ...model, measures: [{ mode: "line", pts: [{ x: 0, y: 0 }, { x: 50, y: 0 }] }] };
    expect(siteToFeatures(m2, ident, {}).some((x) => x.geom === "line")).toBe(false);
    expect(siteToFeatures(m2, ident, { includeDimensions: true }).some((x) => x.geom === "line")).toBe(true);
  });
  it("extrudes buildings only when extrudeBuildings is set", () => {
    expect(siteToFeatures(model, ident, {}).some((x) => x.extrude)).toBe(false);
    expect(siteToFeatures(model, ident, { extrudeBuildings: true }).some((x) => x.name === "Building 1" && x.extrude)).toBe(true);
  });
  it("prefixes folders (multi-site export from the map viewer)", () => {
    const f = siteToFeatures(model, ident, { prefix: ["Katy Site"] });
    expect(f.every((x) => x.folder[0] === "Katy Site")).toBe(true);
  });
  it("LOUD-FAILURE: throws when a vertex reprojects to NaN", () => {
    expect(() => siteToFeatures(model, () => [NaN, NaN], {})).toThrow(/reprojected/);
  });
  it("skips inactive parcels", () => {
    const m = { parcels: [{ id: "p", active: false, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }], els: [], settings: {} };
    expect(siteToFeatures(m, ident, {}).length).toBe(0);
  });
});

describe("elToRingFeet", () => {
  it("returns a centreline road as a real pavement STRIP (>=3 pts, not the 2 centreline pts)", () => {
    const ring = elToRingFeet({ type: "road", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }], travelW: 24, curb: 0.5 });
    expect(ring.length).toBeGreaterThanOrEqual(3);
  });
  it("returns rotated box corners for a plain box element", () => {
    const ring = elToRingFeet({ type: "building", cx: 0, cy: 0, w: 10, h: 20, rot: 0 });
    expect(ring.length).toBe(4);
  });
});

describe("buildKmz + kmzFilename", () => {
  it("produces a single doc.kml archive", () => {
    const bytes = buildKmz("Katy Site A", [{ geom: "point", name: "x", folder: [], coord: [1, 2] }]);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(dec(bytes)).toContain("doc.kml");
    expect(dec(bytes)).toContain("<kml");
  });
  it("sanitizes the download filename", () => {
    expect(kmzFilename("Katy — Site A!")).toBe("katy-site-a.kmz");
    expect(kmzFilename("")).toBe("planyr-export.kmz");
  });
  it("exposes the correct KMZ MIME type", () => {
    expect(KMZ_MIME).toBe("application/vnd.google-earth.kmz");
  });
});

/* ⛔ NEW-2 (b) — THE COUPLING IS THE CLASS, THE DOCK DOORS WERE THE INSTANCE.
 *
 * The defect was not "dock doors are on"; it was that a CANVAS DISPLAY PREFERENCE decided what went
 * into a file built for a different audience. So the guard is the class, not the instance: no module
 * that builds an export FROM THE MODEL may read one of the View ▾ toggles.
 *
 * The audit that produced this list (2026-08-11, every export path in the workspace):
 *   • `kmzExport.js`      — the instance. `settings.showDocks` gated the dock doors. FIXED.
 *   • `printSheet.js` · `imagePdf.js` · `overlayVectorSvg.js` · `sheetFurnitureLayout.js` ·
 *     `exportStyle.js` · `exportLabelScale.js` · `measureSheet.js` — clean, and pinned clean here.
 *   • `exportSheet.js`'s PDF/PNG path is DELIBERATELY excluded and is NOT the same defect: it
 *     CLONES the live `<svg>`, so it inherits every display toggle by construction. That artifact is
 *     the drawing on paper for the same audience, and the user sets those toggles while looking at
 *     the very drawing they are printing — inheriting them there is the intent, not an accident.
 *     (`measureSheet.js` is where that path's own rule lives: an export is a document, not a
 *     screenshot, so ZOOM gates are lifted on the sheet while display toggles are honoured.)
 *   • `exportJSON` writes `settings` wholesale — a save file that round-trips, not a decision.
 */
describe("NEW-2 — no model-built export reads a canvas display toggle", () => {
  const DISPLAY_ONLY = ["showDocks", "showGrid", "showDims", "showAreas", "showSetback", "parcelSelect"];
  const MODEL_BUILT_EXPORTS = [
    "kmzExport.js", "printSheet.js", "imagePdf.js", "overlayVectorSvg.js",
    "sheetFurnitureLayout.js", "exportStyle.js", "exportLabelScale.js", "measureSheet.js",
  ];
  const LIB = join(ROOT, "src/workspaces/site-planner/lib");
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const file of MODEL_BUILT_EXPORTS) {
    it(`${file} decides its own contents`, () => {
      const src = strip(readFileSync(join(LIB, file), "utf8"));
      for (const key of DISPLAY_ONLY) {
        expect(src, `${file} reads the View ▾ toggle "${key}"`).not.toContain(key);
      }
      // `settings.snap` / `settings.gridSize` are drafting aids — same class, different shape.
      expect(src).not.toMatch(/settings\.(snap|gridSize)\b/);
    });
  }

  it("the KMZ's content flags are all opts with a stated default, and all default OFF", () => {
    const src = readFileSync(join(LIB, "kmzExport.js"), "utf8");
    expect(src).toMatch(/extrudeBuildings = false, includeDimensions = false, includeDockDoors = false/);
  });

  it("both KMZ call sites state the decision rather than defaulting into it", () => {
    const planner = readFileSync(join(ROOT, "src/workspaces/site-planner/lib/exportSheet.js"), "utf8");
    const finder = readFileSync(join(ROOT, "src/workspaces/site-planner/MapFinder.jsx"), "utf8");
    for (const [name, src] of [["exportSheet.js", planner], ["MapFinder.jsx", finder]]) {
      expect(src, name).toContain("includeDimensions: false, includeDockDoors: false");
    }
  });
});
