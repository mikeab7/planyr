/* NEW-1 (Missouri second pass, 2026-10-29) — the GIS Cloud ↔ ArcGIS adapter (src/shared/gis/giscloudAdapter.js) and its Pages Function (functions/gc).
 * Clinton and Hickory counties (MO) publish their parcels only as a public GIS Cloud map.
 *
 * RED-PROOF: on main neither file exists (every import below fails), and the two counties are named gaps. The recorded answers in
 * fixtures/giscloudSamples.json are the REAL `api.giscloud.com/1/layers/<id>/features.json?epsg=4326&geometry=geojson` bodies read for each county on 2026-10-29,
 * trimmed to a few lots — the adapter is checked against what the server actually sends, not against a shape written to suit it. KNOWN-ANSWER arm: the Hickory
 * point query's box overlaps TWO recorded lots; exactly one contains the point (worked out independently below), and the adapter must return that one. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseGcPath, translateWhere, arcQueryToGc, gcToArcQuery, featureToArc, ringsContain, layerMetadata, gcFeaturesUrl, gcLayerUrl, GC_MAPS, GC_MAX_RECORDS,
} from "../src/shared/gis/giscloudAdapter.js";
import { onRequest } from "../functions/gc/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/giscloudSamples.json", import.meta.url), "utf8"));

describe("path", () => {
  it("accepts a listed map, layer 0, meta or query", () => {
    expect(parseGcPath(["clinton", "FeatureServer", "0"])).toEqual({ key: "clinton", op: "meta" });
    expect(parseGcPath(["hickory", "FeatureServer", "0", "query"])).toEqual({ key: "hickory", op: "query" });
  });
  it("refuses everything else (this is not an open relay)", () => {
    for (const bad of [["johnson", "FeatureServer", "0"], ["Clinton", "FeatureServer", "0"], ["clinton", "MapServer", "0"], ["clinton", "FeatureServer", "1"], ["clinton", "FeatureServer", "0", "delete"], ["clinton", "FeatureServer", "0", "query", "x"], ["../x", "FeatureServer", "0"], [], ["constructor", "FeatureServer", "0"]])
      expect(parseGcPath(bad).error, JSON.stringify(bad)).toBeTruthy();
  });
  it("the upstream URL is built from the fixed layer id, never from the caller", () => {
    expect(gcFeaturesUrl("clinton")).toBe("https://api.giscloud.com/1/layers/4976776/features.json");
    expect(gcFeaturesUrl("hickory")).toBe("https://api.giscloud.com/1/layers/2619197/features.json");
    expect(gcLayerUrl("clinton")).toBe("/gc/clinton/FeatureServer/0");
  });
});

describe("where → GIS Cloud where", () => {
  it("passes the shapes buildParcelWhere produces, against the layer's own columns", () => {
    expect(translateWhere("1=1", "clinton")).toBeNull();
    expect(translateWhere(undefined, "clinton")).toBeNull();
    expect(translateWhere("UPPER(parcel_num) LIKE UPPER('%03-05.1%')", "clinton")).toBe("UPPER(parcel_num) LIKE UPPER('%03-05.1%')");
    expect(translateWhere("UPPER(PARCEL_NUM) LIKE UPPER('%03-05.1%')", "clinton")).toBe("UPPER(parcel_num) LIKE UPPER('%03-05.1%')");
    expect(translateWhere("parcel = '07-7.0-36-000-000-007.000'", "hickory")).toBe("UPPER(parcel) = UPPER('07-7.0-36-000-000-007.000')");
    expect(translateWhere("acres = 84.73", "hickory")).toBe("acres = 84.73");
    expect(translateWhere("(UPPER(name) LIKE UPPER('%skyline%')) AND (acres = 84.73)", "hickory")).toBe("UPPER(name) LIKE UPPER('%skyline%') AND acres = 84.73");
  });
  it("keeps an apostrophe inside a literal, doubled", () => {
    expect(translateWhere("UPPER(name) LIKE UPPER('%O''BRIEN%')", "hickory")).toBe("UPPER(name) LIKE UPPER('%O''BRIEN%')");
  });
  it("refuses a column the layer does not have and anything it cannot translate faithfully — a 400, never free SQL", () => {
    for (const bad of ["secret = 'x'", "DROP TABLE x", "parcel LIKE 'a' OR 1=1", "1=1; DELETE", "parcel = 'x' --", "(SELECT 1)", "parcel IN ('a')"])
      expect(() => translateWhere(bad, "hickory"), bad).toThrow();
    for (const bad of ["secret = 'x'", "parcel_num IN ('a')"]) expect(() => translateWhere(bad, "clinton"), bad).toThrow();
    try { translateWhere("secret = 'x'", "clinton"); } catch (e) { expect(e.mgBadRequest).toBe(true); }
  });
});

describe("request", () => {
  const base = { f: "json", inSR: "4326", outSR: "4326", outFields: "*", returnGeometry: "true", spatialRel: "esriSpatialRelIntersects" };
  it("a point becomes a ~2 m box asked in lon/lat; the exact decision is made on the answer", () => {
    const q = arcQueryToGc({ ...base, geometry: JSON.stringify({ x: -94.4505, y: 39.5654 }), geometryType: "esriGeometryPoint" }, "clinton");
    expect(q.point).toEqual({ x: -94.4505, y: 39.5654 });
    expect(q.params.epsg).toBe("4326"); expect(q.params.geometry).toBe("geojson");
    const b = q.params.bounds.split(",").map(Number);
    expect(b[2] - b[0]).toBeCloseTo(0.00004, 6); expect(b[3] - b[1]).toBeCloseTo(0.00004, 6);
    expect(b[0] < -94.4505 && b[2] > -94.4505 && b[1] < 39.5654 && b[3] > 39.5654).toBe(true);
  });
  it("an envelope rides bounds; a Web Mercator envelope is converted to lon/lat", () => {
    const q = arcQueryToGc({ ...base, geometry: "-94.46,39.56,-94.44,39.57", geometryType: "esriGeometryEnvelope" }, "clinton");
    expect(q.point).toBeNull(); expect(q.params.bounds).toBe("-94.4600000,39.5600000,-94.4400000,39.5700000");
    const m = arcQueryToGc({ ...base, inSR: "102100", geometry: JSON.stringify({ xmin: -10515130, ymin: 4804000, xmax: -10513000, ymax: 4805500, spatialReference: { wkid: 102100 } }) }, "clinton");
    const b = m.params.bounds.split(",").map(Number);
    expect(b[0]).toBeGreaterThan(-94.5); expect(b[0]).toBeLessThan(-94.4); expect(b[1]).toBeGreaterThan(39); expect(b[1]).toBeLessThan(40);
  });
  it("modes and limits", () => {
    expect(arcQueryToGc({ ...base, returnCountOnly: "true" }, "clinton").mode).toBe("count");
    expect(arcQueryToGc({ ...base, returnIdsOnly: "true" }, "clinton").mode).toBe("ids");
    expect(arcQueryToGc({ ...base, resultRecordCount: "99999" }, "clinton").want).toBe(GC_MAX_RECORDS);
    expect(arcQueryToGc({ ...base, returnGeometry: "false" }, "clinton").wantGeom).toBe(false);
  });
  it("refuses what it cannot answer truthfully", () => {
    for (const p of [{ outSR: "3857" }, { objectIds: "1,2" }, { resultOffset: "10" }, { outStatistics: "[]" }, { spatialRel: "esriSpatialRelWithin", geometry: "-94.5,39.5" }, { geometry: "nonsense" }])
      expect(() => arcQueryToGc({ ...base, ...p }, "clinton"), JSON.stringify(p)).toThrow();
  });
});

describe("response — the recorded real answers", () => {
  it("every column the metadata advertises is a column the recorded real lots have (so it is not a claim the data does not back)", () => {
    for (const key of Object.keys(GC_MAPS)) {
      const cols = Object.keys(FX[key].envAnswer.data[0].data);
      for (const n of GC_MAPS[key].fields) expect(cols, `${key}.${n}`).toContain(n);
      for (const n of [GC_MAPS[key].id, GC_MAPS[key].addr, GC_MAPS[key].owner, GC_MAPS[key].acres].filter(Boolean)) expect(cols, `${key} ${n}`).toContain(n);
    }
  });
  it("a point query returns exactly the lot the point is in (Clinton: one box, one lot)", () => {
    const q = arcQueryToGc({ f: "json", inSR: "4326", outSR: "4326", outFields: "*", geometry: JSON.stringify(FX.clinton.point) }, "clinton");
    const r = gcToArcQuery(FX.clinton.pointAnswer, q);
    expect(r.features).toHaveLength(1);
    expect(r.features[0].attributes.parcel_num).toBe("11-06.0-24-002-039-007.000");
    expect(r.features[0].attributes.OBJECTID).toBe(1209);
    expect(r.features[0].attributes.GIS_ACRES).toBeGreaterThan(0);
    expect(r.geometryType).toBe("esriGeometryPolygon"); expect(r.spatialReference.wkid).toBe(4326);
  });
  it("KNOWN ANSWER: Hickory's box overlaps two lots; the adapter returns only the one that contains the point", () => {
    const answer = FX.hickory.pointAnswer;
    expect(answer.data).toHaveLength(2); // the server's box test really did return both
    const { x, y } = FX.hickory.point;
    const containing = answer.data.filter((f) => ringsContain(f.__geometry.type === "Polygon" ? f.__geometry.coordinates : f.__geometry.coordinates.flat(), x, y));
    expect(containing.length).toBeLessThanOrEqual(1);
    const q = arcQueryToGc({ f: "json", inSR: "4326", outSR: "4326", outFields: "*", geometry: JSON.stringify(FX.hickory.point) }, "hickory");
    const r = gcToArcQuery(answer, q);
    expect(r.features.map((f) => f.attributes.parcel)).toEqual(containing.map((f) => f.data.parcel));
  });
  it("a point in a road gap (no recorded lot contains it) is an EMPTY answer, not the neighbour", () => {
    const rings = (f) => (f.__geometry.type === "Polygon" ? f.__geometry.coordinates : f.__geometry.coordinates.flat());
    const lots = FX.clinton.envAnswer.data;
    const xs = lots.flatMap((f) => rings(f).flat().map((p) => p[0])), ys = lots.flatMap((f) => rings(f).flat().map((p) => p[1]));
    let gap = null;
    for (let i = 0; i <= 40 && !gap; i++) for (let j = 0; j <= 40 && !gap; j++) {
      const x = Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * i) / 40, y = Math.min(...ys) + ((Math.max(...ys) - Math.min(...ys)) * j) / 40;
      if (!lots.some((f) => ringsContain(rings(f), x, y))) gap = { x, y };
    }
    expect(gap, "the recorded block has ground that is in no lot").toBeTruthy();
    const q = arcQueryToGc({ f: "json", inSR: "4326", outSR: "4326", outFields: "*", geometry: JSON.stringify(gap) }, "clinton");
    expect(gcToArcQuery(FX.clinton.envAnswer, q).features).toEqual([]); // the box answer holds six lots; none contains the point
  });
  it("an envelope returns every lot in the answer; rings are ESRI-wound (outer clockwise) and rounded", () => {
    const q = arcQueryToGc({ f: "json", inSR: "4326", outSR: "4326", outFields: "*", geometry: "-94.452,39.564,-94.449,39.567" }, "clinton");
    const r = gcToArcQuery(FX.clinton.envAnswer, q);
    expect(r.features).toHaveLength(FX.clinton.envAnswer.data.length);
    const ring = r.features[0].geometry.rings[0];
    let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    expect(a / 2).toBeLessThan(0);
    for (const [x, y] of ring) { expect(x).toBeLessThan(-94); expect(y).toBeGreaterThan(39); }
  });
  it("count / ids / attribute-only / outFields / exceededTransferLimit", () => {
    const env = { f: "json", inSR: "4326", outSR: "4326", geometry: "-94.452,39.564,-94.449,39.567" };
    expect(gcToArcQuery(FX.clinton.envAnswer, arcQueryToGc({ ...env, returnCountOnly: "true" }, "clinton")).count).toBe(6);
    const ids = gcToArcQuery(FX.clinton.envAnswer, arcQueryToGc({ ...env, returnIdsOnly: "true" }, "clinton")).objectIds;
    expect(new Set(ids).size).toBe(6);
    const slim = gcToArcQuery(FX.clinton.envAnswer, arcQueryToGc({ ...env, returnGeometry: "false", outFields: "parcel_num,deedholder" }, "clinton"));
    expect(slim.features[0].geometry).toBeUndefined(); expect(Object.keys(slim.features[0].attributes).sort()).toEqual(["OBJECTID", "deedholder", "parcel_num"]);
    const small = gcToArcQuery(FX.clinton.envAnswer, arcQueryToGc({ ...env, resultRecordCount: "2" }, "clinton"));
    expect(small.features).toHaveLength(2); expect(small.exceededTransferLimit).toBe(true);
    const full = { data: Array.from({ length: 5000 }, (_, i) => ({ ...FX.clinton.envAnswer.data[0], __id: i + 1 })) };
    expect(gcToArcQuery(full, arcQueryToGc({ ...env }, "clinton")).exceededTransferLimit).toBe(true); // a full page may have more behind it
  });
  it("a feature with no polygon or no id is dropped, and strings are trimmed", () => {
    const q = arcQueryToGc({ f: "json", geometry: "-94.5,39.5,-94.4,39.6" }, "clinton");
    expect(featureToArc({ __id: 1, __geometry: null, data: {} }, q)).toBeNull();
    expect(featureToArc({ __id: "x", __geometry: FX.clinton.envAnswer.data[0].__geometry, data: {} }, q)).toBeNull();
    const f = featureToArc({ ...FX.clinton.envAnswer.data[0], data: { deedholder: "  A   B  " } }, q);
    expect(f.attributes.deedholder).toBe("A B");
  });
  it("layer metadata names an OID field, the county's own columns and the computed acres", () => {
    const m = layerMetadata("clinton");
    expect(m.objectIdField).toBe("OBJECTID"); expect(m.geometryType).toBe("esriGeometryPolygon");
    expect(m.fields.map((f) => f.name)).toEqual(expect.arrayContaining(["OBJECTID", "parcel_num", "siteaddres", "deedholder", "GIS_ACRES"]));
    expect(layerMetadata("hickory").fields.map((f) => f.name)).toEqual(expect.arrayContaining(["parcel", "name", "acres"]));
    expect(GC_MAPS.hickory.addr).toBeNull(); // mailing address only — never offered as a site address
  });
});

describe("functions/gc end to end (stubbed upstream)", () => {
  const ask = async (path, params = {}, { upstream, method = "GET" } = {}) => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u, o) => { calls.push({ u: String(u), o }); return upstream ? upstream(String(u), o) : new Response(JSON.stringify(FX.clinton.pointAnswer), { status: 200 }); };
    try {
      const qs = new URLSearchParams(params).toString();
      const req = new Request(`https://planyr.io/gc/${path}${method === "GET" && qs ? "?" + qs : ""}`, method === "POST" ? { method, body: qs, headers: { "content-type": "application/x-www-form-urlencoded" } } : {});
      const res = await onRequest({ request: req, params: { path: path.split("/") } });
      return { status: res.status, body: await res.json(), calls };
    } finally { globalThis.fetch = realFetch; }
  };
  const pt = { f: "json", inSR: "4326", outSR: "4326", outFields: "*", returnGeometry: "true", geometry: JSON.stringify(FX.clinton.point), geometryType: "esriGeometryPoint" };
  it("serves layer metadata statically — no upstream call, trailing slash tolerated", async () => {
    for (const path of ["clinton/FeatureServer/0", "clinton/FeatureServer/0/"]) {
      const r = await ask(path, { f: "json" });
      expect(r.status).toBe(200); expect(r.body.name).toBe("Clinton County Parcels"); expect(r.calls).toHaveLength(0);
    }
  });
  it("answers a point query in the ArcGIS shape, GET or POST, and sends no credential upstream", async () => {
    for (const method of ["GET", "POST"]) {
      const r = await ask("clinton/FeatureServer/0/query", pt, { method });
      expect(r.status).toBe(200); expect(r.body.features[0].attributes.parcel_num).toBe("11-06.0-24-002-039-007.000"); expect(r.body.features[0].geometry.rings.length).toBeGreaterThan(0);
      const c = r.calls[0];
      const u = new URL(c.u);
      expect(u.origin).toBe("https://api.giscloud.com"); expect(u.pathname).toBe("/1/layers/4976776/features.json");
      expect(u.searchParams.get("epsg")).toBe("4326"); expect(u.searchParams.get("bounds")).toBeTruthy();
      expect(JSON.stringify(c.o.headers)).not.toMatch(/authorization|cookie|token|key/i);
      expect(c.u).not.toMatch(/session|username|password|token|key=/i);
    }
  });
  it("Hickory goes to Hickory's own layer", async () => {
    const r = await ask("hickory/FeatureServer/0/query", { ...pt, geometry: JSON.stringify(FX.hickory.point) }, { upstream: () => new Response(JSON.stringify(FX.hickory.pointAnswer), { status: 200 }) });
    expect(new URL(r.calls[0].u).pathname).toBe("/1/layers/2619197/features.json");
    expect(r.status).toBe(200);
  });
  it("a query it cannot answer is a 200 + ArcGIS error body (how ArcGIS reports it), never a wrong answer or an upstream call", async () => {
    for (const where of ["DROP TABLE x", "secret = 'x'"]) {
      const r = await ask("clinton/FeatureServer/0/query", { where });
      expect(r.status).toBe(200); expect(r.body.error.code).toBe(400); expect(r.calls).toHaveLength(0);
    }
  });
  it("an upstream 401/500/garbage/timeout is a 502 error, surfaced, not swallowed", async () => {
    for (const up of [() => new Response("no", { status: 401 }), () => new Response("boom", { status: 500 }), () => new Response("<html>", { status: 200 }), () => { throw new Error("net"); }]) {
      const r = await ask("clinton/FeatureServer/0/query", { f: "json", where: "1=1", geometry: "-94.5,39.5,-94.4,39.6" }, { upstream: up });
      expect(r.status).toBe(502); expect(r.body.error.message).toBeTruthy();
    }
  });
  it("an unknown map / path / method is refused and never reaches upstream", async () => {
    for (const path of ["johnson/FeatureServer/0", "clinton/FeatureServer/9", "clinton/FeatureServer/0/delete"]) {
      const r = await ask(path, {});
      expect(r.status, path).toBe(404); expect(r.calls).toHaveLength(0);
    }
    const res = await onRequest({ request: new Request("https://planyr.io/gc/clinton/FeatureServer/0", { method: "DELETE" }), params: { path: ["clinton", "FeatureServer", "0"] } });
    expect(res.status).toBe(405);
  });
});
