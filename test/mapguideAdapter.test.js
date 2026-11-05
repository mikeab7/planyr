/* B2302785 — the MapGuide ↔ ArcGIS adapter (src/shared/gis/mapguideAdapter.js) and its Pages Function (functions/mg).
 *
 * RED-PROOF: on main neither file exists (every import below fails), and test/alabamaCounties.test.js's GAPS set still holds the 26
 * Flagship counties. The KNOWN-ANSWER arm (testing doc: a probe must also pass on a case whose answer is known independently of the code):
 * the Mercator↔lon/lat pair below is read straight off the county server's OWN output for one Bibb vertex — the same vertex in
 * Web Mercator (native) and in `transformto=LL84` — so the projection used to build spatial filters is checked against the server, not
 * against itself. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseMgPath, lonLatToMerc, parseQueryGeometry, spatialClause, translateWhere, arcQueryToMg, stableOid, geojsonToRings,
  ringsAcres, featureToArc, mgToArcQuery, layerMetadata, MG_CORE_FIELDS, mgFeaturesUrl, mgLayerUrl, MG_SERVERS, MG_MAX_RECORDS,
} from "../src/shared/gis/mapguideAdapter.js";
import { onRequest } from "../functions/mg/[[path]].js";

const GJ = JSON.parse(readFileSync(new URL("./fixtures/mapguideBibb.json", import.meta.url), "utf8"));

describe("coordinates — known answer from the server's own output", () => {
  it("lon/lat of a Bibb vertex projects to the Mercator the server stores it in", () => {
    const [x, y] = lonLatToMerc(-87.208796805878, 32.896389255318);
    expect(x).toBeCloseTo(-9708038.8531244, 1);
    expect(y).toBeCloseTo(3881559.4313833, 1);
  });
  it("a point becomes an exact INTERSECTS filter, an envelope rides bbox", () => {
    expect(spatialClause({ x: -87.2095, y: 32.8965 }).filter).toMatch(/^Geometry INTERSECTS GEOMFROMTEXT\('POINT \(-97\d{5}\.\d{3} 38\d{5}\.\d{3}\)'\)$/);
    const b = spatialClause({ xmin: -87.215, ymin: 32.893, xmax: -87.205, ymax: 32.899 }).bbox.split(",").map(Number);
    expect(b[0]).toBeLessThan(b[2]); expect(b[1]).toBeLessThan(b[3]);
  });
});

describe("path", () => {
  it("accepts a listed server + a county folder, layer 0, meta or query", () => {
    expect(parseMgPath(["106", "BIBB", "FeatureServer", "0"])).toEqual({ server: 106, county: "BIBB", op: "meta" });
    expect(parseMgPath(["100", "TALLAPOOSA", "FeatureServer", "0", "query"])).toEqual({ server: 100, county: "TALLAPOOSA", op: "query" });
  });
  it("refuses everything else (this is not an open relay)", () => {
    for (const bad of [["103", "BIBB", "FeatureServer", "0"], ["106", "bibb", "FeatureServer", "0"], ["106", "BI/BB", "FeatureServer", "0"], ["106", "BIBB", "MapServer", "0"], ["106", "BIBB", "FeatureServer", "1"], ["106", "BIBB", "FeatureServer", "0", "delete"], ["106", "BIBB", "FeatureServer", "0", "query", "x"], []])
      expect(parseMgPath(bad).error, JSON.stringify(bad)).toBeTruthy();
  });
  it("only the eight servers the viewers name, and the county URL is built from them", () => {
    expect(MG_SERVERS).toEqual([100, 101, 102, 104, 105, 106, 107, 110]);
    expect(mgFeaturesUrl(106, "BIBB")).toBe("https://fgis-map-106.flagshipcloud.com/mapserver106/rest/library/BIBB/3_LAYERS/Parcels.LayerDefinition/features.geojson");
    expect(mgLayerUrl(106, "BIBB")).toBe("/mg/106/BIBB/FeatureServer/0");
  });
});

describe("where → FDO filter", () => {
  it("passes the shapes buildParcelWhere produces", () => {
    expect(translateWhere("1=1")).toBeNull();
    expect(translateWhere(undefined)).toBeNull();
    expect(translateWhere("UPPER(PARCEL_ID) LIKE UPPER('%22030%')")).toBe("PARCEL_ID LIKE '%22030%'");
    expect(translateWhere("UPPER(P_ADDRESS) LIKE UPPER('%hwy 5%')")).toBe("P_ADDRESS LIKE '%HWY 5%'");
    expect(translateWhere("PARCEL_ID = 12345")).toBe("PARCEL_ID = 12345");
    expect(translateWhere("(NAME = 'Smith') AND (UPPER(P_ADDRESS) LIKE UPPER('%main%'))")).toBe("NAME = 'Smith' AND P_ADDRESS LIKE '%MAIN%'");
  });
  it("keeps an apostrophe inside a literal, doubled", () => {
    expect(translateWhere("UPPER(NAME) LIKE UPPER('%O''BRIEN%')")).toBe("NAME LIKE '%O''BRIEN%'");
  });
  it("refuses anything it cannot translate faithfully — a 400, never a different query", () => {
    for (const bad of ["DROP TABLE x", "PARCEL_ID LIKE 'a' OR 1=1", "1=1; DELETE", "NAME = 'x' --", "(SELECT 1)"])
      expect(() => translateWhere(bad), bad).toThrow(/unsupported where/);
  });
});

describe("query geometry", () => {
  it("reads esri point / envelope JSON and bare strings", () => {
    expect(parseQueryGeometry(JSON.stringify({ x: -87.2, y: 32.9, spatialReference: { wkid: 4326 } }))).toEqual({ x: -87.2, y: 32.9 });
    expect(parseQueryGeometry("-87.3,32.8,-87.1,33")).toEqual({ xmin: -87.3, ymin: 32.8, xmax: -87.1, ymax: 33 });
    expect(parseQueryGeometry("-87.2,32.9")).toEqual({ x: -87.2, y: 32.9 });
  });
  it("converts a Web Mercator envelope back to lon/lat and refuses an unknown system", () => {
    const [x, y] = lonLatToMerc(-87.2, 32.9);
    const g = parseQueryGeometry(JSON.stringify({ x, y, spatialReference: { wkid: 102100 } }));
    expect(g.x).toBeCloseTo(-87.2, 6); expect(g.y).toBeCloseTo(32.9, 6);
    expect(() => parseQueryGeometry(JSON.stringify({ x: 1, y: 2, spatialReference: { wkid: 2278 } }))).toThrow(/inSR/);
    expect(() => parseQueryGeometry("nonsense")).toThrow();
  });
});

describe("arcQueryToMg", () => {
  const base = { f: "json", outSR: "4326", inSR: "4326", spatialRel: "esriSpatialRelIntersects" };
  it("a point + attribute request asks for everything and +1 row to detect overflow", () => {
    const q = arcQueryToMg({ ...base, geometry: JSON.stringify({ x: -87.2, y: 32.9 }), geometryType: "esriGeometryPoint", outFields: "*", returnGeometry: "true" });
    expect(q.mode).toBe("features"); expect(q.params.filter).toMatch(/INTERSECTS/); expect(q.params.properties).toBeUndefined();
    expect(q.params.transformto).toBe("LL84"); expect(q.params.maxfeatures).toBe(String(MG_MAX_RECORDS + 1));
  });
  it("the outline layer's id-only request is slim and rides bbox", () => {
    const q = arcQueryToMg({ ...base, outFields: "OBJECTID", returnGeometry: "true", where: "1=1", geometry: JSON.stringify({ xmin: -87.3, ymin: 32.8, xmax: -87.1, ymax: 33 }), geometryType: "esriGeometryEnvelope" });
    expect(q.params.bbox).toBeTruthy(); expect(q.params.filter).toBeUndefined(); expect(q.params.properties).toBe("PARCEL_ID,GISKEY,Geometry");
  });
  it("combines an attribute filter with a spatial one", () => {
    const q = arcQueryToMg({ ...base, where: "UPPER(PARCEL_ID) LIKE UPPER('%22%')", geometry: JSON.stringify({ x: -87.2, y: 32.9 }), geometryType: "esriGeometryPoint" });
    expect(q.params.filter).toMatch(/^PARCEL_ID LIKE '%22%' AND Geometry INTERSECTS/);
  });
  it("caps the record count and honours returnIdsOnly / returnCountOnly", () => {
    expect(arcQueryToMg({ ...base, resultRecordCount: "10" }).want).toBe(10);
    expect(arcQueryToMg({ ...base, resultRecordCount: "99999" }).want).toBe(MG_MAX_RECORDS);
    expect(arcQueryToMg({ ...base, returnIdsOnly: "true" }).mode).toBe("ids");
    expect(arcQueryToMg({ ...base, returnCountOnly: "true" }).mode).toBe("count");
  });
  it("refuses what it cannot answer truthfully", () => {
    expect(() => arcQueryToMg({ ...base, outSR: "2278" })).toThrow(/outSR/);
    expect(() => arcQueryToMg({ ...base, objectIds: "1,2" })).toThrow(/objectIds/);
    expect(() => arcQueryToMg({ ...base, resultOffset: "100" })).toThrow(/resultOffset/);
    expect(() => arcQueryToMg({ ...base, outStatistics: "[]" })).toThrow(/statistics/);
    expect(() => arcQueryToMg({ ...base, geometry: JSON.stringify({ x: 1, y: 2 }), spatialRel: "esriSpatialRelWithin" })).toThrow(/spatialRel/);
  });
});

describe("GeoJSON → ArcGIS", () => {
  const poly = GJ.features[0];
  it("stable OBJECTID: same parcel id → same number, different → different, always a safe integer", () => {
    expect(stableOid("2203074000003003")).toBe(stableOid("2203074000003003"));
    expect(stableOid("2203074000003003")).not.toBe(stableOid("2203074000003002"));
    for (const k of ["", "a", "2203074000003003", "x".repeat(500)]) expect(Number.isSafeInteger(stableOid(k))).toBe(true);
  });
  it("outer ring clockwise, hole counter-clockwise (the winding esri-leaflet reads)", () => {
    const outer = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]; // clockwise in y-up
    const hole = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]];
    const sa = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };
    const rings = geojsonToRings({ type: "Polygon", coordinates: [outer.slice().reverse(), hole.slice().reverse()] });
    expect(sa(rings[0])).toBeLessThan(0); expect(sa(rings[1])).toBeGreaterThan(0);
    expect(geojsonToRings({ type: "Point", coordinates: [1, 2] })).toBeNull();
    expect(geojsonToRings(null)).toBeNull();
  });
  it("acres: a 100 m × 100 m square at Bibb latitude is ~2.471 ac, and a hole subtracts", () => {
    const lat0 = 32.9, dLat = 100 / 110574, dLng = 100 / (111319.49 * Math.cos((lat0 * Math.PI) / 180));
    const sq = [[-87.2, lat0], [-87.2, lat0 + dLat], [-87.2 + dLng, lat0 + dLat], [-87.2 + dLng, lat0], [-87.2, lat0]];
    expect(ringsAcres([sq])).toBeCloseTo(2.471, 2);
    const half = sq.map(([x, y]) => [-87.2 + (x + 87.2) / 2, lat0 + (y - lat0) / 2]);
    expect(ringsAcres([sq, half.slice().reverse()])).toBeCloseTo(2.471 * 0.75, 2);
  });
  it("a recorded real Bibb lot becomes {attributes, geometry.rings} with owner, parcel id and acreage", () => {
    const a = featureToArc(poly, { wantGeom: true, fields: null });
    expect(a.attributes.PARCEL_ID).toBe("2203074000003003");
    expect(a.attributes.NAME).toBe("BARKER ANGELA W"); // trimmed from "BARKER ANGELA W "
    expect(a.attributes.MG_TOOLTIP).toBeUndefined();
    expect(a.attributes.GIS_ACRES).toBeGreaterThan(1); expect(a.attributes.GIS_ACRES).toBeLessThan(2.5);
    expect(Number.isSafeInteger(a.attributes.OBJECTID)).toBe(true);
    expect(a.geometry.rings[0][0]).toEqual([-87.2087968, 32.8963893]);
  });
  it("a label Point (and a row with no geometry) is dropped when geometry is asked for, kept as attributes otherwise", () => {
    const pt = GJ.features.find((f) => f.geometry && f.geometry.type === "Point");
    const nogeom = GJ.features.find((f) => !f.geometry);
    expect(featureToArc(pt, { wantGeom: true, fields: null })).toBeNull();
    expect(featureToArc(nogeom, { wantGeom: true, fields: null })).toBeNull();
    expect(featureToArc(nogeom, { wantGeom: false, fields: null }).attributes.NAME).toBe("UNMAPPED OWNER");
  });
  it("one lot is one feature even though the layer also carries its label point; overflow is flagged", () => {
    const q = { mode: "features", want: 50, wantGeom: true, fields: null };
    const r = mgToArcQuery(GJ, q);
    expect(r.features).toHaveLength(3); // 3 polygons; the point + the geometry-less row are not drawable lots
    expect(r.geometryType).toBe("esriGeometryPolygon"); expect(r.spatialReference.wkid).toBe(4326); expect(r.exceededTransferLimit).toBeUndefined();
    expect(mgToArcQuery(GJ, { ...q, want: 2 }).exceededTransferLimit).toBe(true);
    expect(mgToArcQuery(GJ, { ...q, mode: "count", wantGeom: false }).count).toBe(4); // 3 lots + the geometry-less row, the point deduped
    const ids = mgToArcQuery(GJ, { ...q, mode: "ids", wantGeom: false }).objectIds;
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("layer metadata names an OID field, the county's own columns and the computed acres", () => {
    const m = layerMetadata("BIBB");
    expect(m.objectIdField).toBe("OBJECTID"); expect(m.geometryType).toBe("esriGeometryPolygon");
    const names = m.fields.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["OBJECTID", "NAME", "PARCEL_ID", "P_ADDRESS", "GIS_ACRES"]));
    expect(names).not.toContain("MG_TOOLTIP");
  });
});

describe("functions/mg end to end (stubbed upstream)", () => {
  const ask = async (path, params = {}, { upstream, method = "GET" } = {}) => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u, o) => { calls.push(String(u)); return upstream ? upstream(String(u), o) : new Response(JSON.stringify(GJ), { status: 200 }); };
    try {
      const qs = new URLSearchParams(params).toString();
      const req = new Request(`https://planyr.io/mg/${path}${method === "GET" && qs ? "?" + qs : ""}`, method === "POST" ? { method, body: qs, headers: { "content-type": "application/x-www-form-urlencoded" } } : {});
      const res = await onRequest({ request: req, params: { path: path.split("/") } });
      return { status: res.status, body: await res.json(), calls };
    } finally { globalThis.fetch = realFetch; }
  };
  it("serves layer metadata statically — no upstream call (sampling the server took 19 s on Walker), trailing slash tolerated", async () => {
    for (const path of ["106/BIBB/FeatureServer/0", "106/BIBB/FeatureServer/0/"]) {
      const r = await ask(path, { f: "json" });
      expect(r.status).toBe(200); expect(r.body.name).toBe("BIBB Parcels"); expect(r.calls).toHaveLength(0);
    }
  });
  it("every core column the metadata names is on the recorded real lot (so it is not a claim the data does not back)", () => {
    for (const n of MG_CORE_FIELDS) expect(Object.keys(GJ.features[0].properties), n).toContain(n);
  });
  it("answers a point query in the ArcGIS shape, GET or POST, and sends no credential upstream", async () => {
    let seen;
    for (const method of ["GET", "POST"]) {
      const r = await ask("106/BIBB/FeatureServer/0/query", { f: "json", inSR: "4326", outSR: "4326", outFields: "*", returnGeometry: "true", geometry: JSON.stringify({ x: -87.2095, y: 32.8965 }), geometryType: "esriGeometryPoint", spatialRel: "esriSpatialRelIntersects" }, { method, upstream: (u, o) => { seen = { u, o }; return new Response(JSON.stringify(GJ), { status: 200 }); } });
      expect(r.status).toBe(200); expect(r.body.features[0].attributes.PARCEL_ID).toBe("2203074000003003"); expect(r.body.features[0].geometry.rings.length).toBeGreaterThan(0);
    }
    expect(seen.u).toContain("filter=Geometry+INTERSECTS"); expect(seen.u).toContain("transformto=LL84");
    expect(JSON.stringify(seen.o.headers)).not.toMatch(/authorization|cookie|token|key/i);
    expect(seen.u).not.toMatch(/session|username|password|token|key=/i);
  });
  it("a query it cannot answer is a 200 + ArcGIS error body (how ArcGIS reports it), never a wrong answer", async () => {
    const r = await ask("106/BIBB/FeatureServer/0/query", { where: "DROP TABLE x" });
    expect(r.status).toBe(200); expect(r.body.error.code).toBe(400); expect(r.calls).toHaveLength(0);
  });
  it("an upstream 401/500/garbage/timeout is a 502 error, surfaced, not swallowed", async () => {
    for (const up of [() => new Response("no", { status: 401 }), () => new Response("boom", { status: 500 }), () => new Response("<html>", { status: 200 }), () => { throw new Error("net"); }]) {
      const r = await ask("106/BIBB/FeatureServer/0/query", { f: "json", where: "1=1" }, { upstream: up });
      expect(r.status).toBe(502); expect(r.body.error.message).toBeTruthy();
    }
  });
  it("an unknown server / path is a 404 and never reaches upstream", async () => {
    const r = await ask("103/BIBB/FeatureServer/0", {});
    expect(r.status).toBe(404); expect(r.calls).toHaveLength(0);
  });
});
