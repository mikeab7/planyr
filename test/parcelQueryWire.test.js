/* B2092656 ×3 — the parcel-outline query runs in a worker; what it puts on the wire and how it converts the answer must be
 * IDENTICAL to esri-leaflet's own code, or the worker would fetch a different query or hand back different lots.
 * This suite runs esri-leaflet 3.0.19's real `request` (with a capturing fake XHR) and its real
 * `responseToFeatureCollection` beside ours, on the same inputs. */
import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "node:fs";

const sent = [];
beforeAll(() => {
  class FakeXHR {
    constructor() { this.withCredentials = false; this.headers = {}; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(body) { sent.push({ method: this.method, url: this.url, body, headers: this.headers }); }
  }
  globalThis.window = { XMLHttpRequest: FakeXHR };
  globalThis.document = { documentElement: { style: { pointerEvents: "" } } };
});
vi.mock("leaflet", () => {
  const Util = { falseFn: () => false, bind: (fn, ctx) => fn.bind(ctx), extend: Object.assign, setOptions: () => {} };
  return { Util, DomUtil: {}, latLng: () => ({}), latLngBounds: () => ({}), LatLng: function () {}, LatLngBounds: function () {}, GeoJSON: {}, default: { Util } };
});

const loadEsri = async () => ({ req: await import("esri-leaflet/src/Request.js"), util: await import("esri-leaflet/src/Util.js") });
const loadWire = () => import("../src/workspaces/site-planner/lib/parcelQueryWire.js");

// A realistic parcel /query param set, as esri-leaflet's FeatureManager._buildQuery builds it.
const params = () => ({
  returnGeometry: true, where: "1=1", outSR: 4326, outFields: "OBJECTID,PARCELID",
  geometry: { xmin: -84.8441, ymin: 34.1922, xmax: -84.8331, ymax: 34.2013, spatialReference: { wkid: 4326 } },
  geometryType: "esriGeometryEnvelope", spatialRel: "esriSpatialRelIntersects", inSR: 4326, geometryPrecision: 6, resultType: "tile",
  objectIds: [1, 2, 3], when: new Date(1700000000000), note: "O'Brien",
});

describe("the request on the wire is esri-leaflet's, byte for byte", () => {
  it("GET for a short query: same URL", async () => {
    const { req } = await loadEsri();
    const { serializeEsriParams, needsPost } = await loadWire();
    const url = "https://www.bartowgis.org/arcgis/rest/services/AGOServices/BartowLand/FeatureServer/2/query";
    sent.length = 0;
    req.request(url, params(), () => {}, { options: {} });
    const body = serializeEsriParams(params());
    expect(needsPost(url, body)).toBe(false);
    expect(sent[0].method).toBe("GET");
    expect(sent[0].url).toBe(`${url}?${body}`);
    expect(body).toContain("%27"); // apostrophes encoded, as esri does
  });
  it("POST past 2,000 characters: same body", async () => {
    const { req } = await loadEsri();
    const { serializeEsriParams, needsPost } = await loadWire();
    const url = "https://example.test/arcgis/rest/services/P/MapServer/0/query";
    const p = () => ({ ...params(), where: `PARCELID IN (${Array.from({ length: 300 }, (_, i) => `'A${i}'`).join(",")})` });
    sent.length = 0;
    req.request(url, p(), () => {}, { options: {} });
    const body = serializeEsriParams(p());
    expect(needsPost(url, body)).toBe(true);
    expect(sent[0].method).toBe("POST");
    expect(sent[0].url).toBe(url);
    expect(sent[0].body).toBe(body);
  });
  it("f defaults to json and an explicit f is kept (geojson for a hosted FeatureServer)", async () => {
    const { serializeEsriParams, isArcgisOnline } = await loadWire();
    expect(serializeEsriParams({ a: 1 })).toBe("a=1&f=json");
    expect(serializeEsriParams({ f: "geojson" })).toBe("f=geojson");
    expect(isArcgisOnline("https://services1.arcgis.com/x/arcgis/rest/services/P/FeatureServer/0")).toBe(true);
    expect(isArcgisOnline("https://utility.arcgis.com/usrsvcs/servers/x/rest/services/P/FeatureServer/0")).toBe(false);
    expect(isArcgisOnline("https://www.bartowgis.org/arcgis/rest/services/AGOServices/BartowLand/FeatureServer/2")).toBe(false);
  });
});

describe("the answer converts exactly as esri-leaflet converts it", () => {
  const answer = {
    objectIdFieldName: "OBJECTID",
    fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }, { name: "PARCELID", type: "esriFieldTypeString" }],
    exceededTransferLimit: true,
    features: [
      { attributes: { OBJECTID: 11, PARCELID: "A010-0202-001" }, geometry: { rings: [[[-84.83, 34.2], [-84.829, 34.2], [-84.829, 34.201], [-84.83, 34.201], [-84.83, 34.2]]] } },
      { attributes: { OBJECTID: 12, PARCELID: "A010-0202-002" }, geometry: { rings: [[[-84.828, 34.2], [-84.827, 34.2], [-84.827, 34.201], [-84.828, 34.2]], [[-84.8275, 34.2002], [-84.8274, 34.2002], [-84.8274, 34.2003], [-84.8275, 34.2002]]] } },
    ],
  };
  it("same features, same ids, same order", async () => {
    const { util } = await loadEsri();
    const { esriResponseToFeatures } = await loadWire();
    expect(esriResponseToFeatures(JSON.parse(JSON.stringify(answer)))).toEqual(util.responseToFeatureCollection(JSON.parse(JSON.stringify(answer))).features);
  });
  it("no objectIdFieldName: the OID field, then a well-known name, then the feature's own key — as esri does", async () => {
    const { util } = await loadEsri();
    const { esriResponseToFeatures } = await loadWire();
    for (const variant of [{ ...answer, objectIdFieldName: undefined }, { ...answer, objectIdFieldName: undefined, fields: [{ name: "FID", type: "esriFieldTypeInteger" }] }, { ...answer, objectIdFieldName: undefined, fields: undefined }]) {
      expect(esriResponseToFeatures(JSON.parse(JSON.stringify(variant)))).toEqual(util.responseToFeatureCollection(JSON.parse(JSON.stringify(variant))).features);
    }
  });
  it("body → (error, response) as esri's XHR callback reads it", async () => {
    const { readEsriBody } = await loadWire();
    expect(readEsriBody('{"features":[]}')).toEqual({ error: null, response: { features: [] } });
    expect(readEsriBody('{"error":{"code":400,"message":"bad"}}')).toEqual({ error: { code: 400, message: "bad" }, response: null });
    expect(readEsriBody("<html>404</html>").error.code).toBe(500);
  });
});

describe("source guards", () => {
  const disp = fs.readFileSync(new URL("../src/workspaces/site-planner/lib/parcelDisplay.js", import.meta.url), "utf8");
  const tr = fs.readFileSync(new URL("../src/workspaces/site-planner/lib/parcelQueryTransport.js", import.meta.url), "utf8");
  it("the parcel outline layer routes its queries through the worker transport", () => {
    expect(disp).toMatch(/layer\._buildQuery = function \(bounds, offset\) \{ return routeQueryThroughWorker\(baseBuildQuery\.call\(this, bounds, offset\)\); \}/);
  });
  it("the transport keeps the service's own request events (the hang-guards read them) and has esri's own path as the fallback", () => {
    expect(tr).toMatch(/svc\.fire\("requeststart"/);
    expect(tr).toMatch(/svc\._createServiceCallback\("request"/);
    expect(tr).toMatch(/EL\.request\(url, params, wrapped, svc\)/);
  });
});
