import { describe, it, expect } from "vitest";
import {
  crc32, zipStore, xmlEscape, balloonHtml, pointFeature, polygonFeature, ringWithCentroidPin,
  siteRecordFeatures, buildKml, buildKmz, kmzFilename, KMZ_MIME,
} from "../src/shared/comps/lib/kmlExport.js";
import { parseKmlPlacemarks } from "../src/shared/comps/lib/kmlImport.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (bytes) => new TextDecoder().decode(bytes);

// A square ring around (-95.795, 29.805), matching kmlImport.test.js's own fixture so the two
// modules' centroid math is checked against the same known answer.
const SQUARE_RING = [[-95.80, 29.80], [-95.79, 29.80], [-95.79, 29.81], [-95.80, 29.81]];

describe("crc32 (mirrors the canonical IEEE vector)", () => {
  it("matches the standard test vector", () => {
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
  });
});

describe("zipStore", () => {
  it("writes a valid STORED zip carrying the doc.kml entry", () => {
    const zip = zipStore([{ name: "doc.kml", bytes: enc("hello") }]);
    expect(zip).toBeInstanceOf(Uint8Array);
    expect([zip[0], zip[1], zip[2], zip[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
    expect(zip[8] | (zip[9] << 8)).toBe(0); // compression method = store
    expect(dec(zip)).toContain("hello");
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

describe("balloonHtml", () => {
  it("renders a heading + labeled rows", () => {
    const html = balloonHtml([{ heading: "1115 E Main St", rows: [{ label: "County", value: "Harris" }] }]);
    expect(html).toContain("1115 E Main St");
    expect(html).toContain("<b>County:</b> Harris");
  });
  it("escapes row values (never raw-injects owner text)", () => {
    const html = balloonHtml([{ rows: [{ label: "Notes", value: "5 AC <tag> & more" }] }]);
    expect(html).toContain("5 AC &lt;tag&gt; &amp; more");
    expect(html).not.toContain("<tag>");
  });
  it("renders a hyperlink when a URL exists, plain text when it doesn't", () => {
    const html = balloonHtml([{ links: [{ label: "Survey.pdf", url: "https://example.com/x" }, { label: "Title.pdf", url: null }] }]);
    expect(html).toContain('<a href="https://example.com/x">Survey.pdf</a>');
    expect(html).toContain("<div>Title.pdf</div>");
  });
  it("a null/empty section list renders the outer wrapper with nothing inside it", () => {
    const html = balloonHtml([null, undefined]);
    expect(html).not.toContain("<b>");
    expect(html).not.toMatch(/font-weight:bold[^>]*>[^<]/);
  });
});

describe("ringWithCentroidPin — the polygon+pin pairing rule", () => {
  it("returns a polygon feature and a point feature at the ring's centroid", () => {
    const [poly, pin] = ringWithCentroidPin({ name: "Parcel A", folder: ["Parcel"], ring: SQUARE_RING, lineColor: "#333", description: "<div>balloon</div>" });
    expect(poly.geom).toBe("polygon");
    expect(poly.name).toBe("Parcel A");
    expect(poly.description).toBeUndefined(); // the balloon rides the PIN, never the polygon
    expect(pin.geom).toBe("point");
    expect(pin.coord[0]).toBeCloseTo(-95.795, 3);
    expect(pin.coord[1]).toBeCloseTo(29.805, 3);
    expect(pin.description).toBe("<div>balloon</div>");
  });
  it("degenerate ring (fewer than 3 real vertices) still yields a pin, no polygon", () => {
    const feats = ringWithCentroidPin({ name: "Sliver", ring: [[-95.8, 29.8]] });
    expect(feats).toHaveLength(1);
    expect(feats[0].geom).toBe("point");
  });
});

describe("siteRecordFeatures — Parcel + Comps folders", () => {
  it("a drawn parcel: every ring gets a pair, only the FIRST pin carries the site balloon", () => {
    const feats = siteRecordFeatures({
      parcel: { rings: [{ ring: SQUARE_RING, name: "Tract 1" }, { ring: SQUARE_RING.map(([x, y]) => [x + 1, y + 1]), name: "Tract 2" }], balloon: "<div>SITE</div>" },
      comps: [],
    });
    const pins = feats.filter((f) => f.geom === "point");
    expect(pins).toHaveLength(2);
    expect(pins[0].description).toBe("<div>SITE</div>");
    expect(pins[1].description).toBeUndefined();
    expect(feats.every((f) => f.folder[0] === "Parcel")).toBe(true);
  });
  it("no parcel geometry at all: a single fallback pin at the site's own point, carrying the balloon", () => {
    const feats = siteRecordFeatures({ parcel: { rings: [], fallbackPoint: [-95.8, 29.8], name: "Tracked site", balloon: "<div>SITE</div>" }, comps: [] });
    expect(feats).toHaveLength(1);
    expect(feats[0].geom).toBe("point");
    expect(feats[0].description).toBe("<div>SITE</div>");
  });
  it("a plain-pin comp becomes a bare point feature under Comps", () => {
    const feats = siteRecordFeatures({
      parcel: { rings: [], fallbackPoint: null },
      comps: [{ name: "Lease @ $0.65/SF", point: [-95.81, 29.81], iconColor: "#3f8f5f", balloon: "<div>COMP</div>" }],
    });
    expect(feats).toHaveLength(1);
    expect(feats[0].geom).toBe("point");
    expect(feats[0].folder).toEqual(["Comps"]);
    expect(feats[0].description).toBe("<div>COMP</div>");
  });
  it("a parcel-anchored comp (parcelGeom) becomes a polygon+pin pair, balloon on the pin", () => {
    const feats = siteRecordFeatures({
      parcel: { rings: [] },
      comps: [{ name: "Land sale", polygonRings: [SQUARE_RING], iconColor: "#8a6d3b", lineColor: "#8a6d3b", balloon: "<div>LAND</div>" }],
    });
    expect(feats).toHaveLength(2);
    const poly = feats.find((f) => f.geom === "polygon");
    const pin = feats.find((f) => f.geom === "point");
    expect(poly.folder).toEqual(["Comps"]);
    expect(pin.description).toBe("<div>LAND</div>");
  });
  it("mixed comp types on one site record all land under one Comps folder", () => {
    const feats = siteRecordFeatures({
      parcel: { rings: [{ ring: SQUARE_RING, name: "Site" }], balloon: "<div>SITE</div>" },
      comps: [
        { name: "Lease", point: [-95.81, 29.81], iconColor: "#3f8f5f" },
        { name: "Land", polygonRings: [SQUARE_RING.map(([x, y]) => [x + 2, y + 2])], iconColor: "#8a6d3b", lineColor: "#8a6d3b" },
        { name: "Building sale", point: [-95.82, 29.82], iconColor: "#2f6fb0" },
      ],
    });
    const compFeats = feats.filter((f) => f.folder[0] === "Comps");
    expect(compFeats.length).toBe(4); // 1 lease pin + (1 land polygon + 1 land pin) + 1 building pin
    expect(feats.filter((f) => f.folder[0] === "Parcel").length).toBe(2); // the site's own polygon+pin
  });
});

describe("buildKml — coordinate order + folder structure", () => {
  it("writes lon BEFORE lat", () => {
    const kml = buildKml("Test", [pointFeature({ name: "P", folder: ["Comps"], coord: [-95.5, 29.5] })]);
    expect(kml).toContain("-95.5,29.5");
  });
  it("nests placemarks under named folders matching the feature's folder path", () => {
    const kml = buildKml("Test", [
      polygonFeature({ name: "Parcel", folder: ["Parcel"], rings: [SQUARE_RING] }),
      pointFeature({ name: "Comp", folder: ["Comps"], coord: [-95.81, 29.81] }),
    ]);
    expect(kml).toMatch(/<Folder><name>Parcel<\/name>.*<\/Folder>/s);
    expect(kml).toMatch(/<Folder><name>Comps<\/name>.*<\/Folder>/s);
  });
  it("wraps a description in CDATA so the balloon's HTML renders", () => {
    const kml = buildKml("Test", [pointFeature({ name: "Comp", coord: [-95.81, 29.81], description: "<b>Rate</b>: $0.65" })]);
    expect(kml).toContain("<![CDATA[<b>Rate</b>: $0.65]]>");
  });
  it("XML-escapes a name carrying an ampersand (the classic KML-corrupting case)", () => {
    const kml = buildKml("Smith & Jones tract", [pointFeature({ name: "A & B", coord: [-95.81, 29.81] })]);
    expect(kml).toContain("Smith &amp; Jones tract");
    expect(kml).toContain("A &amp; B");
    expect(kml).not.toMatch(/[^&]& /); // no bare ampersand reaches the document
  });
});

describe("kmzFilename", () => {
  it("slugifies a site-record name", () => {
    expect(kmzFilename("Katy — Site A")).toBe("katy-site-a.kmz");
  });
  it("falls back to a generic name when blank", () => {
    expect(kmzFilename("")).toBe("site-record.kmz");
  });
});

describe("KMZ_MIME", () => {
  it("is the Google Earth KMZ media type", () => {
    expect(KMZ_MIME).toBe("application/vnd.google-earth.kmz");
  });
});

describe("round-trip through this repo's own KML reader (kmlImport.js) — the cheapest honest oracle", () => {
  it("a mixed site record (parcel + 3 comp types) round-trips placemark count, names and coordinates", () => {
    const features = siteRecordFeatures({
      parcel: { rings: [{ ring: SQUARE_RING, name: "Tract 1" }], balloon: balloonHtml([{ heading: "Katy Site", rows: [{ label: "County", value: "Waller" }] }]) },
      comps: [
        { name: "Pin comp", point: [-95.83, 29.79], iconColor: "#3f8f5f", balloon: balloonHtml([{ heading: "Pin comp" }]) },
        { name: "Site-plan comp", point: [-95.84, 29.78], iconColor: "#2f6fb0", balloon: balloonHtml([{ heading: "Site-plan comp" }]) },
        { name: "Parcel comp", polygonRings: [SQUARE_RING.map(([x, y]) => [x + 3, y + 3])], iconColor: "#8a6d3b", lineColor: "#8a6d3b", balloon: balloonHtml([{ heading: "Parcel comp" }]) },
      ],
    });
    const kmz = buildKmz("Katy Site", features);
    const text = dec(kmz);
    const kmlStart = text.indexOf("<?xml");
    const kmlEnd = text.indexOf("</kml>") + "</kml>".length;
    const kml = text.slice(kmlStart, kmlEnd);

    const placemarks = parseKmlPlacemarks(kml);
    // 1 parcel polygon + 1 parcel pin + 2 plain comp pins + (1 comp polygon + 1 comp pin) = 6.
    expect(placemarks).toHaveLength(6);
    const names = placemarks.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Tract 1", "Pin comp", "Site-plan comp", "Parcel comp"]));

    const pinComp = placemarks.find((p) => p.name === "Pin comp");
    expect(pinComp.geometry).toEqual({ kind: "point", lon: -95.83, lat: 29.79 });
    expect(pinComp.description).toContain("Pin comp");

    const tract = placemarks.find((p) => p.name === "Tract 1" && p.geometry?.kind === "polygon");
    expect(tract.geometry.ring.length).toBeGreaterThanOrEqual(4);
  });

  it("an ampersand/quote-bearing site name never corrupts the document (the classic KML failure)", () => {
    const features = siteRecordFeatures({ parcel: { rings: [], fallbackPoint: [-95.8, 29.8], name: `O'Brien & "Sons" tract`, balloon: "" }, comps: [] });
    const kmz = buildKmz(`O'Brien & "Sons" tract`, features);
    const text = dec(kmz);
    const kml = text.slice(text.indexOf("<?xml"), text.indexOf("</kml>") + 6);
    // A bare "&" in a name is exactly what makes a KML file silently unreadable in Earth — assert
    // it never reaches the document unescaped, which is what actually prevents the corruption.
    expect(kml).not.toMatch(/[^&]& /);
    // The reader parses the placemark and its geometry cleanly either way — `parseKmlPlacemarks`
    // deliberately only decodes entities inside <description> (kmlDescriptionToText), not <name>,
    // so the name round-trips through this repo's own reader in its escaped form.
    const [placemark] = parseKmlPlacemarks(kml);
    expect(placemark.name).toBe(`O&apos;Brien &amp; &quot;Sons&quot; tract`);
    expect(placemark.geometry).toEqual({ kind: "point", lon: -95.8, lat: 29.8 });
  });
});
