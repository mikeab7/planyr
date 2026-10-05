/* B2081251 — SSURGO shallow-rock: pure parse/join/classify, written against the documented WFS + SDA formats
 * (neither host is reachable from the build sandbox; the live arm is ui-audit/verify-ssurgo-bedrock.mjs). */
import { describe, it, expect } from "vitest";
import {
  classifyDepthCm, buildWfsUrl, parseMapunitGml, buildBedrockQuery, parseBedrockRows, joinBedrock, fetchBedrockView,
} from "../src/workspaces/site-planner/lib/ssurgoBedrock.js";

const BB = { s: 34.0, w: -84.3, n: 34.1, e: -84.2 };
const poly = (coords) => `<gml:Polygon><gml:outerBoundaryIs><gml:LinearRing><gml:coordinates>${coords}</gml:coordinates></gml:LinearRing></gml:outerBoundaryIs></gml:Polygon>`;
const member = (mukey, coords, extra = "") => `<gml:featureMember><ms:mapunitpoly><ms:mukey>${mukey}</ms:mukey><ms:musym>X</ms:musym><ms:the_geom><gml:MultiPolygon>${poly(coords)}${extra}</gml:MultiPolygon></ms:the_geom></ms:mapunitpoly></gml:featureMember>`;
const SQ = "-84.25,34.05 -84.24,34.05 -84.24,34.06 -84.25,34.06 -84.25,34.05";
const GML = `<wfs:FeatureCollection>${member("111", SQ)}${member("222", SQ)}${member("333", SQ)}</wfs:FeatureCollection>`;

describe("classifyDepthCm", () => {
  it("classes by inches and paints nothing at/over 60 in or with no depth", () => {
    expect(classifyDepthCm(30).id).toBe("very");      // 11.8 in
    expect(classifyDepthCm(60).id).toBe("shallow");   // 23.6 in
    expect(classifyDepthCm(120).id).toBe("moderate"); // 47 in
    expect(classifyDepthCm(152.4)).toBeNull();        // exactly 60 in
    expect(classifyDepthCm(200)).toBeNull();
    expect(classifyDepthCm(null)).toBeNull();
    expect(classifyDepthCm("")).toBeNull();
    expect(classifyDepthCm(NaN)).toBeNull();
  });
});

describe("WFS request + GML parse", () => {
  it("asks for mapunitpoly inside the view, lon,lat order", () => {
    const u = decodeURIComponent(buildWfsUrl(BB));
    expect(u).toContain("TYPENAME=mapunitpoly");
    expect(u).toContain("<coordinates>-84.3,34 -84.2,34.1</coordinates>");
  });
  it("reads mukey + rings from GML 2", () => {
    const { features } = parseMapunitGml(GML, BB);
    expect(features.map((f) => f.mukey)).toEqual(["111", "222", "333"]);
    expect(features[0].polygons[0][0][0]).toEqual([-84.25, 34.05]);
  });
  it("keeps holes as inner rings", () => {
    const hole = `<gml:Polygon><gml:outerBoundaryIs><gml:LinearRing><gml:coordinates>${SQ}</gml:coordinates></gml:LinearRing></gml:outerBoundaryIs><gml:innerBoundaryIs><gml:LinearRing><gml:coordinates>-84.248,34.052 -84.246,34.052 -84.246,34.054 -84.248,34.052</gml:coordinates></gml:LinearRing></gml:innerBoundaryIs></gml:Polygon>`;
    const { features } = parseMapunitGml(`<x><gml:featureMember><a><ms:mukey>9</ms:mukey>${hole}</a></gml:featureMember></x>`, BB);
    expect(features[0].polygons[0]).toHaveLength(2);
  });
  it("flips a lat-first (posList) answer back to lng,lat when only the flipped reading fits the view", () => {
    const pl = `<gml:featureMember><a><ms:mukey>5</ms:mukey><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>34.05 -84.25 34.05 -84.24 34.06 -84.24 34.05 -84.25</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></a></gml:featureMember>`;
    const { features } = parseMapunitGml(pl, BB);
    expect(features[0].polygons[0][0][0]).toEqual([-84.25, 34.05]);
  });
  it("REFUSES an answer that fits the view in neither axis order (never draws soil on the wrong ground)", () => {
    expect(() => parseMapunitGml(GML.replace(/-84\.2\d,34\.0\d/g, "10,10"), BB)).toThrow(/outside the requested view/);
  });
  it("throws on a WFS exception report instead of returning an empty list", () => {
    expect(() => parseMapunitGml("<ows:ExceptionReport><ows:Exception><ows:ExceptionText>bad filter</ows:ExceptionText></ows:Exception></ows:ExceptionReport>", BB)).toThrow(/bad filter/);
  });
});

describe("SDA tabular join", () => {
  const sda = { Table: [["mukey", "muname", "brockdepmin"], ["111", "Pacolet-Cecil complex", "45"], ["222", "Deep loam", null], ["333", "Rock outcrop", "10"]] };
  it("builds a quote-safe IN list", () => {
    expect(buildBedrockQuery(["1", "2'; DROP"])).toBe("SELECT mu.mukey, mu.muname, ma.brockdepmin FROM mapunit mu INNER JOIN muaggatt ma ON ma.mukey = mu.mukey WHERE mu.mukey IN ('1','2DROP')");
  });
  it("paints only units with a shallow depth; a null-depth unit is left unpainted, not 'clear'", () => {
    const joined = joinBedrock(parseMapunitGml(GML, BB).features, parseBedrockRows(sda));
    expect(joined.map((j) => [j.mukey, j.cls.id])).toEqual([["111", "very"], ["333", "very"]]);
  });
  it("a response with no brockdepmin column is a loud error", () => {
    expect(() => parseBedrockRows({ Table: [["mukey"], ["1"]] })).toThrow(/brockdepmin/);
  });
});

describe("fetchBedrockView — failure is never an empty 'clear' map", () => {
  const okText = (t) => ({ ok: true, text: async () => t });
  const okJson = (j) => ({ ok: true, json: async () => j });
  it("joins WFS + SDA end to end", async () => {
    const fetchImpl = async (url) => (String(url).includes(".wfs") ? okText(GML) : okJson({ Table: [["mukey", "muname", "brockdepmin"], ["111", "A", "45"]] }));
    const r = await fetchBedrockView(BB, { fetchImpl });
    expect(r.total).toBe(3);
    expect(r.polys).toHaveLength(1);
  });
  it("rejects when the WFS errors", async () => {
    await expect(fetchBedrockView(BB, { fetchImpl: async () => ({ ok: false, status: 503 }) })).rejects.toThrow(/WFS HTTP 503/);
  });
  it("rejects when SDA errors", async () => {
    const fetchImpl = async (url) => (String(url).includes(".wfs") ? okText(GML) : { ok: false, status: 500 });
    await expect(fetchBedrockView(BB, { fetchImpl })).rejects.toThrow(/tabular HTTP 500/);
  });
});
