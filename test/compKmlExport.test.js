import { describe, it, expect } from "vitest";

/* B2010352 — NEW-1 / NEW-2 / NEW-3 (owner-measured 2026-10-01 on a throwaway parcel-anchored lease
 * comp, APN 0481850000004, 22.48 AC, near 9800 Telephone Rd, Houston 77075): the KMZ comp balloon
 * read "Location: <the APN>", said "Executed" twice, and exported the parcel outline under Comps
 * while the site record read "No boundary drawn yet". Every assertion below is on the doc.kml
 * STRING the export writes (buildSiteRecordKml -> buildKml), for a lease, a land and a building-sale
 * fixture. Each fails against the pre-fix assembler (which lived as closures in MapFinder.jsx). */
import fs from "node:fs";
import { buildSiteRecordKml, compBalloonSections } from "../src/shared/comps/lib/siteRecordKml.js";
import { compLocationFor } from "../src/shared/comps/lib/compLocationText.js";
import { parseKmlPlacemarks } from "../src/shared/comps/lib/kmlImport.js";

const CLOSED_RING = (() => {
  const pts = [];
  for (let i = 0; i < 19; i++) {
    const t = (i / 19) * 2 * Math.PI;
    pts.push([-95.5 + 0.00176 * Math.cos(t), 29.85 + 0.00153 * Math.sin(t)]);
  }
  pts.push(pts[0]);
  return pts; // 20 vertices, closed
})();
const GEOM = { type: "Polygon", coordinates: [CLOSED_RING] };
const parcelAnchor = { kind: "parcel", lat: 29.85, lon: -95.5, county: "harris", parcelApn: "0481850000004", acreageAc: 22.48, parcelGeom: GEOM };
const base = { id: "c1", title: "ZZ KML test - safe to delete", compDate: "2026-09-15", createdAt: "2026-10-01T12:00:00Z", notes: null, anchor: parcelAnchor, projectId: "s1" };
const LEASE = { ...base, compType: "lease", leaseRate: 0.65, leaseRatePeriod: "monthly", leaseRateExpense: "nnn", leaseSizeSf: 50000 };
const LAND = { ...base, id: "c2", compType: "land", title: "ZZ land", landPrice: 4500000, landSizeValue: 22.48, landSizeUnit: "ac" };
const BLDG = { ...base, id: "c3", compType: "building_sale", title: "ZZ bldg", bldgPrice: 9200000, bldgSizeSf: 80000 };
const PANEL_LOCATION = "Houston, TX 77075"; // what the comp detail panel shows for this comp

const noBoundary = { known: true, hasBoundary: false, acres: 0, rings: [] };
const build = (comp, extra = {}) => buildSiteRecordKml({
  siteName: "ZZ site record", site: { role: "Tracked", status: "Pursuit", county: "Harris County", origin: { lat: 29.85, lon: -95.5 } },
  boundary: noBoundary, comps: [comp], locationFor: () => PANEL_LOCATION, ratePeriod: "monthly", ...extra,
});
// The CDATA balloon of the Placemark whose <name> is `name`.
const balloonOf = (kml, name) => {
  const m = kml.match(new RegExp(`<Placemark><name>${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</name>.*?<description><!\\[CDATA\\[(.*?)\\]\\]></description>`));
  return m ? m[1] : null;
};
const folder = (kml, name) => (kml.match(new RegExp(`<Folder><name>${name}</name>(.*?)</Folder>`)) || [])[1] || "";
const count = (hay, needle) => hay.split(needle).length - 1;

describe.each([["lease", LEASE], ["land", LAND], ["building sale", BLDG]])("NEW-1/2 — the %s comp balloon is the panel's rows, once", (_n, comp) => {
  const kml = build(comp);
  const balloon = balloonOf(kml, comp.title);
  it("has a balloon on the comp pin", () => expect(balloon).toBeTruthy());
  it("NEW-1: Location is the panel's Location, never the APN", () => {
    expect(balloon).toContain(`<b>Location:</b> ${PANEL_LOCATION}`);
    expect(balloon).not.toContain("<b>Location:</b> 0481850000004");
  });
  it("NEW-1: the APN appears only in its own row, once", () => {
    expect(balloon).toContain("<b>Parcel ID (APN):</b> 0481850000004");
    expect(count(balloon, "0481850000004")).toBe(1);
  });
  it("NEW-2: Executed appears exactly once", () => {
    expect(count(balloon, "<b>Executed:</b>")).toBe(1);
    expect(balloon).toContain("<b>Executed:</b> 09/15/26");
  });
  it("rows follow the comp detail panel's order: Location, APN, …, Executed", () => {
    const at = (l) => balloon.indexOf(`<b>${l}:</b>`);
    expect(at("Location")).toBeGreaterThanOrEqual(0);
    expect(at("Location")).toBeLessThan(at("Parcel ID (APN)"));
    expect(at("Parcel ID (APN)")).toBeLessThan(at("Executed"));
  });
});

describe("NEW-1 — one Location resolver for panel and export", () => {
  it("a parcel anchor resolves to the reverse-geocoded address, not the APN", () => {
    expect(compLocationFor(parcelAnchor, { resolvedAddress: "9800 Telephone Rd, Houston, TX 77075" })).toBe("9800 Telephone Rd, Houston, TX 77075");
  });
  it("with no address yet it falls back to county/coordinates — still never the APN", () => {
    const t = compLocationFor(parcelAnchor, { countyEntry: () => ({ name: "Harris County", state: "TX" }) });
    expect(t).toBe("Harris County, TX");
    expect(t).not.toContain("0481850000004");
  });
  it("source guard: the panel hook and the export both read compLocationFor; the export no longer calls parcelLocationText", () => {
    const panel = fs.readFileSync("src/shared/comps/components/CompsPanel.jsx", "utf8");
    const mf = fs.readFileSync("src/workspaces/site-planner/MapFinder.jsx", "utf8");
    expect(panel).toContain("compLocationFor(");
    expect(mf).toContain("compLocationFor(");
    expect(mf).not.toMatch(/parcelLocationText\(/);
    expect(mf).not.toMatch(/label: "Executed"/); // the balloon adds no row of its own
  });
  it("compBalloonSections adds no row beyond Location + compFieldRows", () => {
    const rows = compBalloonSections(LEASE, { locationText: PANEL_LOCATION, ratePeriod: "monthly" })[0].rows.map((r) => r.label);
    expect(rows.filter((l) => l === "Executed")).toHaveLength(1);
    expect(rows[0]).toBe("Location");
  });
});

// An own (site-record) boundary that IS the comp's parcel: same ring, same APN.
const SITE_RING = { ring: CLOSED_RING, name: "ZZ site record", acct: "0481850000004" };
const elsewhere = { ring: [[-95.6, 29.7], [-95.59, 29.7], [-95.59, 29.71], [-95.6, 29.7]], name: "ZZ site record", acct: "9999" };

describe.each([["lease", LEASE], ["land", LAND], ["building sale", BLDG]])("NEW-3 — outlines on the site, on the comp, or both: %s", (_n, comp) => {
  describe("comp parcel ONLY (site has no boundary of its own)", () => {
    const kml = build(comp);
    it("the outline goes with the comp, in the Comps folder, named as the comp's parcel", () => {
      expect(count(kml, "<Polygon>")).toBe(1);
      expect(folder(kml, "Comps")).toContain("<Polygon>");
      expect(folder(kml, "Parcel")).not.toContain("<Polygon>");
      expect(folder(kml, "Comps")).toContain(`<name>${comp.title} — comp parcel</name>`);
    });
    it("the site balloon never says 'No boundary drawn yet'; it labels the comp's acreage honestly", () => {
      const site = balloonOf(kml, "ZZ site record");
      expect(site).toContain("<b>Comp parcel:</b> 22.48 AC");
      expect(site).not.toContain("No boundary drawn yet");
      expect(site).not.toContain("<b>Acreage:</b>");
    });
    it("the comp itself stays one pin (no second pin from the outline)", () => {
      expect(count(folder(kml, "Comps"), "<Point>")).toBe(1);
    });
  });
  describe("site boundary ONLY (a pin-anchored comp)", () => {
    const pinComp = { ...comp, anchor: { kind: "pin", lat: 29.85, lon: -95.5, county: "harris" } };
    const kml = build(pinComp, { boundary: { known: true, hasBoundary: true, acres: 10, rings: [elsewhere] } });
    it("the outline is in the Parcel folder (site style) with the site's acreage; nothing under Comps", () => {
      expect(folder(kml, "Parcel")).toContain("<Polygon>");
      expect(folder(kml, "Comps")).not.toContain("<Polygon>");
      expect(balloonOf(kml, "ZZ site record")).toContain("<b>Acreage:</b> 10.00 AC");
    });
  });
  describe("BOTH, different parcels", () => {
    const kml = build(comp, { boundary: { known: true, hasBoundary: true, acres: 10, rings: [elsewhere] } });
    it("both are drawn: the site's under Parcel, the comp's under Comps", () => {
      expect(count(kml, "<Polygon>")).toBe(2);
      expect(folder(kml, "Parcel")).toContain("<Polygon>");
      expect(folder(kml, "Comps")).toContain("— comp parcel");
      expect(balloonOf(kml, "ZZ site record")).toContain("<b>Acreage:</b> 10.00 AC");
    });
  });
  describe("BOTH, the same parcel (matched by APN)", () => {
    const kml = build(comp, { boundary: { known: true, hasBoundary: true, acres: 22.5, rings: [SITE_RING] } });
    it("it is drawn once — the site's — and the comp keeps only its pin", () => {
      expect(count(kml, "<Polygon>")).toBe(1);
      expect(folder(kml, "Parcel")).toContain("<Polygon>");
      expect(folder(kml, "Comps")).not.toContain("<Polygon>");
    });
  });
  describe("BOTH, the same parcel (no shared APN — matched by geometry)", () => {
    const kml = build({ ...comp, anchor: { ...parcelAnchor, parcelApn: "COMP-ONLY-ID" } }, { boundary: { known: true, hasBoundary: true, acres: 22.5, rings: [{ ...SITE_RING, acct: null }] } });
    it("still drawn once", () => expect(count(kml, "<Polygon>")).toBe(1));
  });
});

describe("NEW-3 — two comps on one property draw one comp outline", () => {
  it("same APN -> one polygon, acreage counted once", () => {
    const kml = build(LEASE, { comps: [LEASE, { ...LAND }] });
    expect(count(kml, "<Polygon>")).toBe(1);
    expect(balloonOf(kml, "ZZ site record")).toContain("22.48 AC");
  });
  it("a pin comp on a boundary-less site still says so honestly (nothing in the file to claim)", () => {
    const kml = build({ ...LEASE, anchor: { kind: "pin", lat: 29.85, lon: -95.5, county: "harris" } });
    expect(balloonOf(kml, "ZZ site record")).toContain("No boundary drawn yet");
    expect(kml).not.toContain("<Polygon>");
  });
  it("the file still round-trips through the importer's parser", () => {
    expect(() => parseKmlPlacemarks(build(LEASE))).not.toThrow();
  });
});

describe("map notes — the record's notes export as pins in a Notes folder", () => {
  const note = (over) => ({ id: "n", projectId: null, title: "Gate note", body: "Tenant says <dock> & \"yard\" ok\nsecond line", anchor: { kind: "pin", lat: 29.8501, lon: -95.5001 }, deletedAt: null, ...over });
  it("a note linked to the project is exported with title + body, escaped like a comp balloon", () => {
    const kml = build(LEASE, { projectId: "s1", notes: [note({ projectId: "s1", anchor: { kind: "pin", lat: 40, lon: -100 } })] });
    const f = folder(kml, "Notes");
    expect(f).toContain("<Point>");
    expect(f).toContain("<name>Gate note</name>");
    const b = balloonOf(kml, "Gate note");
    expect(b).toContain("Tenant says &lt;dock&gt; &amp; &quot;yard&quot; ok");
    expect(b).toContain("second line");
    expect(b).not.toContain("<dock>");
  });
  it("an UNLINKED note anchored inside the exported parcel belongs to the record too", () => {
    expect(folder(build(LEASE, { projectId: "s1", notes: [note()] }), "Notes")).toContain("Gate note");
  });
  it("an unlinked note carrying a comp parcel's APN belongs to it", () => {
    const n = note({ anchor: { kind: "parcel", lat: 40, lon: -100, parcelApn: "0481850000004" } });
    expect(folder(build(LEASE, { projectId: "s1", notes: [n] }), "Notes")).toContain("Gate note");
  });
  it("a note elsewhere, or deleted, is NOT exported", () => {
    const far = note({ anchor: { kind: "pin", lat: 40, lon: -100 } });
    const gone = note({ projectId: "s1", deletedAt: "2026-10-01T00:00:00Z" });
    expect(build(LEASE, { projectId: "s1", notes: [far, gone] })).not.toContain("<Folder><name>Notes</name>");
  });
  it("no notes, no Notes folder", () => {
    expect(build(LEASE, { projectId: "s1", notes: [] })).not.toContain("<name>Notes</name>");
  });
});

/* NEW-2 (B2013745) — owner-measured 2026-10-02 on build 6246ba3: the site pin, the comp pin and the
 * note pin of one parcel all wrote <coordinates>-95.28189496,29.62385608</coordinates>; Earth / My
 * Maps open only the top pin of a stack. A parcel anchor's lat/lon IS the parcel's assembly centre,
 * and the site pin is the ring centroid, so the three genuinely coincide. */
describe("NEW-2 — no two pins in doc.kml share a coordinate", () => {
  const SITE = { role: "Tracked", status: "Pursuit", county: "Harris County", origin: { lat: 29.85, lon: -95.5 } };
  // site ring + comp anchor at the ring's centre + a note anchored at the same point
  const RING = CLOSED_RING.map(([x, y]) => [x, y]);
  const note = { id: "n1", title: "ZZ note", body: "hello", projectId: "s1", anchor: { kind: "parcel", lat: 29.85, lon: -95.5, parcelApn: "0481850000004" } };
  const kml = buildSiteRecordKml({
    siteName: "ZZ site", site: SITE, boundary: { known: true, hasBoundary: true, acres: 22.48, rings: [{ ring: RING, name: "ZZ site", acct: "0481850000004" }] },
    comps: [LEASE], locationFor: () => PANEL_LOCATION, ratePeriod: "monthly", notes: [note], projectId: "s1",
  });
  const pins = [...kml.matchAll(/<Placemark><name>([^<]*)<\/name>(?:(?!<\/Placemark>).)*?<Point><coordinates>([^<]*)<\/coordinates>/g)].map((m) => ({ name: m[1], c: m[2] }));
  it("the fixture really has a site pin, a comp pin and a note pin", () => {
    expect(pins.map((p) => p.name)).toEqual(expect.arrayContaining(["ZZ site", LEASE.title, "ZZ note"]));
    expect(pins.length).toBe(3);
  });
  it("all three coordinates are distinct", () => expect(new Set(pins.map((p) => p.c)).size).toBe(3));
  it("the site pin keeps its exact true spot (the ring centroid) — the others move, it does not", () => {
    const site = pins.find((p) => p.name === "ZZ site");
    expect(site.c).toMatch(/^-95\.5,29\.85\d*$|^-95\.49\d+,29\.85\d*$|^-95\.50\d+,29\.85\d*$/);
  });
  it("the nudge is small (under ~25 m) and deterministic (same input, same file)", () => {
    const [sx, sy] = pins[0].c.split(",").map(Number);
    for (const p of pins.slice(1)) {
      const [x, y] = p.c.split(",").map(Number);
      expect(Math.hypot((y - sy) * 111320, (x - sx) * 111320 * Math.cos(sy * Math.PI / 180))).toBeLessThan(25);
    }
    expect(buildSiteRecordKml({
      siteName: "ZZ site", site: SITE, boundary: { known: true, hasBoundary: true, acres: 22.48, rings: [{ ring: RING, name: "ZZ site", acct: "0481850000004" }] },
      comps: [LEASE], locationFor: () => PANEL_LOCATION, ratePeriod: "monthly", notes: [note], projectId: "s1",
    })).toBe(kml);
  });
  it("pins that are NOT coincident are left exactly where they are", () => {
    const far = { ...note, anchor: { ...note.anchor, lat: 29.8512, lon: -95.4988 } };
    const k2 = buildSiteRecordKml({ siteName: "ZZ site", site: SITE, boundary: noBoundary, comps: [{ ...LEASE, anchor: { kind: "pin", lat: 29.86, lon: -95.51 } }], locationFor: () => null, notes: [far], projectId: "s1" });
    expect(k2).toContain("<coordinates>-95.51,29.86</coordinates>");
    expect(k2).toContain("<coordinates>-95.4988,29.8512</coordinates>");
  });
  it("separateCoincidentPins: ten stacked pins all end up distinct; polygons untouched", async () => {
    const { separateCoincidentPins } = await import("../src/shared/comps/lib/siteRecordKml.js");
    const f = Array.from({ length: 10 }, (_, i) => ({ geom: "point", name: `p${i}`, coord: [-95.5, 29.85] }));
    const out = separateCoincidentPins([...f, { geom: "polygon", name: "poly", rings: [RING] }]);
    expect(new Set(out.slice(0, 10).map((x) => x.coord.join(","))).size).toBe(10);
    expect(out[0].coord).toEqual([-95.5, 29.85]);
    expect(out[10].rings).toBe(out[10].rings);
  });
});
