/* NEW-1 (B2497472) — the Oklahoma statewide-parcel adapter (src/shared/gis/okParcelsAdapter.js) and its Pages Function (functions/okparcels).
 *
 * RED-PROOF: on main neither file exists (every import below fails). The fixtures are REAL GetFeatureInfo answers recorded from the state's
 * GeoServer through the production relay on 2026-10-29 (test/fixtures/okStatewideGfi*.json) — not hand-made shapes.
 * KNOWN-ANSWER ARM (a probe must also pass on a case whose answer is known independently of the code under test): the server publishes each
 * lot's `acres` itself; the acreage COMPUTED from the polygon the adapter returns must agree with it, which checks ring orientation and units
 * against the server rather than against our own arithmetic. And the point fixture holds TWO neighbouring lots — only the one the point is
 * inside may come back. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseOkPath, translateWhereOk, arcQueryToOk, okUpstreamUrl, featureToArcOk, okToArcQuery, layerMetadata, OK_FIELDS, OK_LAYER, OK_UPSTREAM,
  OK_MAX_SPAN_DEG, OK_MAX_RECORDS, okLayerUrl,
} from "../src/shared/gis/okParcelsAdapter.js";
import { ringsAcres } from "../src/shared/gis/mapguideAdapter.js";
import { onRequest } from "../functions/okparcels/[[path]].js";

const PT = JSON.parse(readFileSync(new URL("./fixtures/okStatewideGfiPoint.json", import.meta.url), "utf8"));
const EN = JSON.parse(readFileSync(new URL("./fixtures/okStatewideGfiEnvelope.json", import.meta.url), "utf8"));
const POINT = { x: -95.1623, y: 36.51 }; // inside parcel 490010509 (Mayes), 39.29 acres per the server
const geomPt = (o = POINT) => JSON.stringify({ x: o.x, y: o.y, spatialReference: { wkid: 4326 } });

describe("path", () => {
  it("accepts layer 0, meta or query; refuses everything else", () => {
    expect(parseOkPath(["FeatureServer", "0"])).toEqual({ op: "meta" });
    expect(parseOkPath(["FeatureServer", "0", "query"])).toEqual({ op: "query" });
    for (const bad of [["MapServer", "0"], ["FeatureServer", "1"], ["FeatureServer", "0", "delete"], ["FeatureServer", "0", "query", "x"], []]) expect(parseOkPath(bad).error, JSON.stringify(bad)).toBeTruthy();
    expect(okLayerUrl()).toBe("/okparcels/FeatureServer/0");
  });
});

describe("where → county scope + search filters", () => {
  it("reads the row's scope and the shapes buildParcelWhere produces", () => {
    expect(translateWhereOk("1=1")).toEqual({ county: null, filters: [] });
    expect(translateWhereOk("county='Mayes'")).toEqual({ county: "Mayes", filters: [] });
    expect(translateWhereOk("(county='LeFlore') AND (UPPER(parcelid) LIKE UPPER('%490%'))")).toEqual({ county: "LeFlore", filters: [{ field: "parcelid", op: "like", value: "%490%" }] });
    expect(translateWhereOk("accountnumber = 1035667").filters).toEqual([{ field: "accountnumber", op: "eq", value: "1035667" }]);
  });
  it("refuses what it cannot answer truthfully (LOUD, never a different query)", () => {
    for (const bad of ["DROP TABLE x", "owner IN ('a')", "1=1; --", "county='Ma;yes'"]) expect(() => translateWhereOk(bad), bad).toThrow();
  });
});

describe("request", () => {
  const base = { f: "json", inSR: "4326", outSR: "4326", returnGeometry: "true", outFields: "*", where: "county='Mayes'" };
  it("a point becomes one small GetFeatureInfo window on the ONE public layer, scoped to the county, with no credential", () => {
    const q = arcQueryToOk({ ...base, geometry: geomPt() });
    expect(q.gfi).toMatchObject({ service: "WMS", request: "GetFeatureInfo", layers: OK_LAYER, query_layers: OK_LAYER, srs: "EPSG:4326", width: "101", height: "101", x: "50", y: "50", info_format: "application/json", cql_filter: "county='Mayes'" });
    const [x0, y0, x1, y1] = q.gfi.bbox.split(",").map(Number);
    expect((x0 + x1) / 2).toBeCloseTo(POINT.x, 6); expect((y0 + y1) / 2).toBeCloseTo(POINT.y, 6);
    const url = okUpstreamUrl(q);
    expect(url.startsWith(OK_UPSTREAM + "?")).toBe(true);
    expect(url).not.toMatch(/secure|token|key=|session|password|authorization/i);
    expect(OK_LAYER).toBe("ogi_wms:Statewide_Parcels");
  });
  it("an envelope is a 256-pixel window that covers it whole; too wide is a loud refusal", () => {
    const e = { xmin: -95.319, ymin: 36.3057, xmax: -95.3138, ymax: 36.3112 };
    const q = arcQueryToOk({ ...base, geometry: JSON.stringify({ ...e, spatialReference: { wkid: 4326 } }), resultRecordCount: "50" });
    expect(q.gfi).toMatchObject({ width: "256", height: "256", x: "128", y: "128", feature_count: "51" });
    expect(Number(q.gfi.buffer)).toBeGreaterThanOrEqual(181); // half the window's diagonal in pixels: the pick area is the whole window
    expect(() => arcQueryToOk({ ...base, geometry: JSON.stringify({ xmin: -95.4, ymin: 36.3, xmax: -95.2, ymax: 36.4, spatialReference: { wkid: 4326 } }) })).toThrow(/too large/);
    expect(OK_MAX_SPAN_DEG).toBeGreaterThan(0.0055);
  });
  it("a search with no place on the map (account / owner / address across a county) is a LOUD 400 that says to click the lot", () => {
    const err = (() => { try { arcQueryToOk({ ...base, where: "(county='Mayes') AND (UPPER(parcelid) LIKE UPPER('%490%'))" }); } catch (e) { return e; } })();
    expect(err && err.mgBadRequest).toBe(true);
    expect(err.message).toMatch(/click the lot/);
  });
  it("refuses unsupported shapes: other outSR, objectIds, offsets, statistics", () => {
    for (const extra of [{ outSR: "102100" }, { objectIds: "1,2" }, { resultOffset: "10" }, { outStatistics: "[]" }, { spatialRel: "esriSpatialRelWithin" }]) expect(() => arcQueryToOk({ ...base, geometry: geomPt(), ...extra }), JSON.stringify(extra)).toThrow();
  });
});

describe("response — the recorded real answers", () => {
  const q = (o = {}, g = geomPt()) => arcQueryToOk({ f: "json", inSR: "4326", outSR: "4326", returnGeometry: "true", outFields: "*", where: "county='Mayes'", geometry: g, ...o });
  it("KNOWN ANSWER: the fixture holds two neighbouring lots; only the one the point is inside comes back, with the server's own attributes", () => {
    expect(PT.features.map((f) => f.properties.parcelid).sort()).toEqual(["490010509", "490010510"]);
    const r = okToArcQuery(PT, q());
    expect(r.features).toHaveLength(1);
    const a = r.features[0].attributes;
    expect(a).toMatchObject({ county: "Mayes", parcelid: "490010509", accountnumber: 1035667, owner: "GILMORE, JOE A & LINDA TRUST", acres: 39.29 });
    expect(Number.isSafeInteger(a.OBJECTID)).toBe(true);
    expect(r.geometryType).toBe("esriGeometryPolygon"); expect(r.spatialReference.wkid).toBe(4326); expect(r.exceededTransferLimit).toBeUndefined();
  });
  it("KNOWN ANSWER: the acreage computed from the returned polygon agrees with the server's own `acres` (orientation + units)", () => {
    const f = okToArcQuery(PT, q()).features[0];
    expect(Math.abs(ringsAcres(f.geometry.rings) - f.attributes.acres) / f.attributes.acres).toBeLessThan(0.02);
  });
  it("the same stable OBJECTID on every request; a point in neither lot, or the wrong county scope, gets nothing", () => {
    expect(okToArcQuery(PT, q()).features[0].attributes.OBJECTID).toBe(okToArcQuery(PT, q()).features[0].attributes.OBJECTID);
    expect(okToArcQuery(PT, q({}, geomPt({ x: -95.1700, y: 36.5100 }))).features).toHaveLength(0);
    expect(okToArcQuery(PT, q({ where: "county='Craig'" })).features).toHaveLength(0);
  });
  it("county scope tolerates the spelling differences the layer has (LeFlore / Le Flore, case)", () => {
    const g = { ...PT.features[0], properties: { ...PT.features[0].properties, county: "LeFlore" } };
    const f = okToArcQuery({ features: [g] }, q({ where: "county='Le Flore'" }, JSON.stringify({ x: -95.1600, y: 36.5090 }))).features;
    expect(Array.isArray(f)).toBe(true);
  });
  it("search clauses are applied to what came back (owner LIKE)", () => {
    const hit = okToArcQuery(PT, q({ where: "(county='Mayes') AND (UPPER(owner) LIKE UPPER('%gilmore, joe%'))" })).features;
    const miss = okToArcQuery(PT, q({ where: "(county='Mayes') AND (UPPER(owner) LIKE UPPER('%nobody%'))" })).features;
    expect(hit).toHaveLength(1); expect(miss).toHaveLength(0);
  });
  it("an envelope returns every lot it touches, flags overflow, counts, and lists ids", () => {
    const env = JSON.stringify({ xmin: -95.319, ymin: 36.3057, xmax: -95.3138, ymax: 36.3112, spatialReference: { wkid: 4326 } });
    const all = okToArcQuery(EN, q({ resultRecordCount: "100" }, env));
    expect(all.features.length).toBeGreaterThan(10); expect(all.exceededTransferLimit).toBeUndefined();
    expect(all.features.every((f) => f.geometry.rings.length > 0)).toBe(true);
    const some = okToArcQuery(EN, q({ resultRecordCount: "5" }, env));
    expect(some.features).toHaveLength(5); expect(some.exceededTransferLimit).toBe(true);
    expect(okToArcQuery(EN, q({ returnCountOnly: "true" }, env)).count).toBe(all.features.length);
    const ids = okToArcQuery(EN, q({ returnIdsOnly: "true" }, env)).objectIds;
    expect(new Set(ids).size).toBe(ids.length);
    const far = JSON.stringify({ xmin: -94.0, ymin: 35.0, xmax: -93.9985, ymax: 35.0015, spatialReference: { wkid: 4326 } });
    expect(okToArcQuery(EN, q({}, far)).features).toHaveLength(0);
  });
  it("attribute-only requests drop the geometry; a feature with no polygon is dropped when a polygon is asked for", () => {
    expect(okToArcQuery(PT, q({ returnGeometry: "false" })).features[0].geometry).toBeUndefined();
    expect(featureToArcOk({ properties: { county: "Mayes" }, geometry: null }, q())).toBeNull();
  });
  it("outFields narrows the attribute bag but keeps the OBJECTID", () => {
    const a = okToArcQuery(PT, q({ outFields: "parcelid,owner" })).features[0].attributes;
    expect(Object.keys(a).sort()).toEqual(["OBJECTID", "owner", "parcelid"]);
  });
  it("the static metadata declares every column the real answers carry (no claim the data does not back)", () => {
    const names = layerMetadata().fields.map((f) => f.name);
    for (const k of Object.keys(PT.features[0].properties)) expect(names, k).toContain(k);
    expect(OK_FIELDS.length).toBeGreaterThan(15);
    expect(layerMetadata().objectIdField).toBe("OBJECTID");
  });
});

describe("functions/okparcels end to end (stubbed upstream)", () => {
  const ask = async (path, params = {}, { upstream, method = "GET" } = {}) => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u, o) => { calls.push({ u: String(u), o }); return upstream ? upstream(String(u), o, calls.length) : new Response(JSON.stringify(PT), { status: 200 }); };
    try {
      const qs = new URLSearchParams(params).toString();
      const req = new Request(`https://planyr.io/okparcels/${path}${method === "GET" && qs ? "?" + qs : ""}`, method === "POST" ? { method, body: qs, headers: { "content-type": "application/x-www-form-urlencoded" } } : { method });
      const res = await onRequest({ request: req, params: { path: path.split("/") } });
      return { status: res.status, body: await res.json(), calls };
    } finally { globalThis.fetch = realFetch; }
  };
  const Q = { f: "json", inSR: "4326", outSR: "4326", outFields: "*", returnGeometry: "true", where: "county='Mayes'", geometry: geomPt() };
  it("serves layer metadata statically — no upstream call, trailing slash tolerated", async () => {
    for (const path of ["FeatureServer/0", "FeatureServer/0/"]) { const r = await ask(path, { f: "json" }); expect(r.status).toBe(200); expect(r.body.objectIdField).toBe("OBJECTID"); expect(r.calls).toHaveLength(0); }
  });
  it("answers a point query in the ArcGIS shape, GET or POST, and sends only the public GetFeatureInfo on the public layer", async () => {
    for (const method of ["GET", "POST"]) {
      const r = await ask("FeatureServer/0/query", Q, { method });
      expect(r.status).toBe(200); expect(r.body.features).toHaveLength(1); expect(r.body.features[0].attributes.parcelid).toBe("490010509");
      expect(r.calls).toHaveLength(1);
      const u = new URL(r.calls[0].u);
      expect(u.origin + u.pathname).toBe(OK_UPSTREAM); expect(u.searchParams.get("request")).toBe("GetFeatureInfo"); expect(u.searchParams.get("layers")).toBe(OK_LAYER);
      expect(JSON.stringify(r.calls[0].o.headers)).not.toMatch(/authorization|cookie|token|key/i);
    }
  });
  it("a blip (one 502) is retried once and answered; two 502s are a 502 error, surfaced", async () => {
    let n = 0;
    const blip = await ask("FeatureServer/0/query", Q, { upstream: () => (++n === 1 ? new Response("bad gateway", { status: 502 }) : new Response(JSON.stringify(PT), { status: 200 })) });
    expect(blip.status).toBe(200); expect(blip.calls).toHaveLength(2); expect(blip.body.features).toHaveLength(1);
    const down = await ask("FeatureServer/0/query", Q, { upstream: () => new Response("bad gateway", { status: 502 }) });
    expect(down.status).toBe(502); expect(down.body.error.message).toMatch(/Oklahoma statewide parcel server/); expect(down.calls).toHaveLength(2);
  });
  it("garbage / an XML ServiceException / a timeout / a 401 are errors, never an empty list", async () => {
    const xml = '<?xml version="1.0"?><ServiceExceptionReport><ServiceException>bad</ServiceException></ServiceExceptionReport>';
    for (const up of [() => new Response("<html>", { status: 200 }), () => new Response(xml, { status: 200 }), () => { throw new Error("net"); }, () => new Response("no", { status: 401 })]) {
      const r = await ask("FeatureServer/0/query", Q, { upstream: up });
      expect(r.status).toBe(502); expect(r.body.error.message).toBeTruthy(); expect(r.body.features).toBeUndefined();
    }
  });
  it("a query it cannot answer is a 200 + ArcGIS error body and never reaches upstream", async () => {
    for (const p of [{ ...Q, geometry: undefined, where: "county='Mayes' AND UPPER(parcelid) LIKE UPPER('%1%')" }, { ...Q, where: "DROP TABLE x" }]) {
      const r = await ask("FeatureServer/0/query", Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
      expect(r.status).toBe(200); expect(r.body.error.code).toBe(400); expect(r.calls).toHaveLength(0);
    }
  });
  it("an unknown path is a 404 and a wrong method a 405; neither reaches upstream", async () => {
    const r = await ask("FeatureServer/9", {}); expect(r.status).toBe(404); expect(r.calls).toHaveLength(0);
    const m = await ask("FeatureServer/0/query", Q, { method: "PUT" }); expect(m.status).toBe(405);
  });
  it("is bounded: OK_MAX_RECORDS caps a huge resultRecordCount", () => {
    expect(arcQueryToOk({ ...Q, resultRecordCount: "999999" }).want).toBe(OK_MAX_RECORDS);
  });
});
