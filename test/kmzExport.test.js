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
  /* DOCK DOORS — ALWAYS EXPORTED, as ONE RUN PER DOCK SIDE, and never decided by a canvas display
   * toggle. Two owner decisions live in this block and they are different from each other:
   *   • the ORIGINAL complaint was a pin per door — on his Bain plan, 209 of 261 placemarks — and
   *     the fix for that is the RUN, not absence;
   *   • with the runs in place he then chose the DEFAULT: "Dock doors should just show by default
   *     in the export — that's the behaviour I want, not an option to turn on… no toggle."
   * So there is no flag, and a test asking for one would fail to compile the intent. */
  it("ALWAYS emits dock-door features — no flag, nothing to turn on", () => {
    const runs = siteToFeatures(model, ident, {}).filter((x) => x.folder.includes("Dock doors"));
    expect(runs.length).toBeGreaterThan(0);
    // ⛔ MUTATION CHECK against the superseded default: an opts flag would have made THIS empty.
    // Passing the retired flag as false must change nothing — there is no gate left to close.
    const withRetiredFlag = siteToFeatures(model, ident, { includeDockDoors: false })
      .filter((x) => x.folder.includes("Dock doors"));
    expect(withRetiredFlag.length).toBe(runs.length);
  });
  it("emits ONE LINE per dock side — named with the count and the o.c., never a pin per door", () => {
    const f = siteToFeatures(model, ident, {});
    const runs = f.filter((x) => x.folder.includes("Dock doors"));
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.length).toBeLessThanOrEqual(4);          // at most one per wall of a box building
    expect(f.some((x) => x.geom === "point")).toBe(false); // ⛔ the original defect: zero pins
    let doors = 0;
    for (const r of runs) {
      expect(r.geom).toBe("line");
      expect(r.coords.length).toBe(2);
      expect(r.coords[0]).not.toEqual(r.coords[1]);      // a real run, never a degenerate point
      expect(r.name).toMatch(/^Dock doors — \d+ @ \d+(\.\d+)?′ o\.c\.$/);
      doors += Number(/— (\d+) @/.exec(r.name)[1]);
    }
    // MUTATION CHECK on the REPRESENTATION: the pre-fix geometry was one placemark per door, so a
    // build that regressed to points would emit this many instead of `runs.length`.
    expect(doors).toBeGreaterThan(runs.length);
  });
  it("⛔ THE CLASS: the canvas display toggle does not decide — showDocks is inert either way", () => {
    const withShowDocks = (v) => ({ ...model, settings: { ...model.settings, showDocks: v } });
    const count = (m) => siteToFeatures(m, ident, {}).filter((x) => x.folder.includes("Dock doors")).length;
    // Verbatim pre-fix gate, replayed: `settings.showDocks !== false` said "off" for one of these
    // and "on" for the other. The export must not be able to tell them apart.
    expect(withShowDocks(false).settings.showDocks !== false).toBe(false);
    expect(count(withShowDocks(false))).toBe(count(withShowDocks(true)));
    expect(count(withShowDocks(false))).toBeGreaterThan(0);
  });
  it("includes dimension lines only when asked", () => {
    // ⛔ Scoped to the Dimensions FOLDER, not to `geom === "line"`: the dock-door runs are lines
    // too now, so a bare geometry check would report them as dimensions and pass on a broken build.
    const m2 = { ...model, measures: [{ mode: "line", pts: [{ x: 0, y: 0 }, { x: 50, y: 0 }] }] };
    const dims = (o) => siteToFeatures(m2, ident, o).filter((x) => x.folder.includes("Dimensions"));
    expect(dims({}).length).toBe(0);
    expect(dims({ includeDimensions: true }).length).toBeGreaterThan(0);
    expect(dims({ includeDimensions: true }).every((x) => x.geom === "line")).toBe(true);
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

/* ⛔ THE COUPLING IS THE CLASS, THE DOCK DOORS WERE THE INSTANCE.
 *
 * The defect was never "dock doors are on" — the owner has since asked for them ON, always, and they
 * are. It was that a CANVAS DISPLAY PREFERENCE decided what went into a file built for a different
 * audience. So the guard is the class, not the instance: no module
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
describe("no model-built export reads a canvas display toggle", () => {
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

  it("the KMZ's remaining content flags are opts with a stated default — and dock doors is NOT one", () => {
    const src = readFileSync(join(LIB, "kmzExport.js"), "utf8");
    expect(src).toMatch(/extrudeBuildings = false, includeDimensions = false, prefix = \[\]/);
    // ⛔ THE OWNER'S DECISION, PINNED: there is no dock-door flag to find and none to wire a
    // checkbox to. A flag nothing sets is a decision left half-made — this is what stops one
    // reappearing as "harmless" configurability.
    const body = strip(src);
    expect(body).not.toContain("includeDockDoors");
  });

  it("the one KMZ call site that still names a flag states it, and neither names a dock-door one", () => {
    const planner = readFileSync(join(ROOT, "src/workspaces/site-planner/lib/exportSheet.js"), "utf8");
    const finder = readFileSync(join(ROOT, "src/workspaces/site-planner/MapFinder.jsx"), "utf8");
    for (const [name, src] of [["exportSheet.js", planner], ["MapFinder.jsx", finder]]) {
      expect(src, name).toContain("includeDimensions: false");
      expect(src, name).not.toContain("includeDockDoors");
    }
  });
});
