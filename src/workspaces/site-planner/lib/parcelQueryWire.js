/* B2092656 ×3 — the pure half of the parcel-outline query WORKER transport: what goes on the wire, and how an ArcGIS
 * answer becomes GeoJSON. Shared by the main thread (parcelQueryTransport.js — serialises the request exactly as
 * esri-leaflet would) and the worker (parcelQueryWorker.js — parses and converts the answer exactly as esri-leaflet's
 * `Query.run` would). No Leaflet, no DOM: unit-tested in plain Node against esri-leaflet's own behaviour.
 *
 * WHY THE WORKER (measured, synthetic Bartow-density service, ui-audit/verify-parcel-arrival-cost.mjs + the
 * Select-on harness): one county /query answer (~1,200 lots) was parsed (`JSON.parse`) and converted
 * (`arcgisToGeoJSON` per lot) inside esri-leaflet's XHR callback as ONE main-thread task — 15–35 ms, the largest
 * task left after PR 2002 and the one it said only "a worker transport" could split. In the worker the parse and the
 * conversion cost the main thread nothing; the lots come back in LOTS_PER_MESSAGE batches (each its own small task). */
import { arcgisToGeoJSON } from "@terraformer/arcgis";

/** Lots per message from the worker (one message = one main-thread deserialise). */
export const LOTS_PER_MESSAGE = 300;

/* esri-leaflet 3.0.19's `serialize` (src/Request.js), verbatim in behaviour: f defaults to json, arrays of objects and
 * objects are JSON, other arrays comma-joined, dates as their value, and apostrophes percent-encoded. NOTE it MUTATES
 * `params.f` like the original does. */
export function serializeEsriParams(params) {
  let data = "";
  params.f = params.f || "json";
  for (const key in params) {
    if (Object.hasOwn(params, key)) {
      const param = params[key];
      const type = Object.prototype.toString.call(param);
      let value;
      if (data.length) data += "&";
      if (type === "[object Array]") value = Object.prototype.toString.call(param[0]) === "[object Object]" ? JSON.stringify(param) : param.join(",");
      else if (type === "[object Object]") value = JSON.stringify(param);
      else if (type === "[object Date]") value = param.valueOf();
      else value = param;
      data += `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }
  }
  return data.replaceAll("'", "%27");
}

/** esri-leaflet's GET-or-POST rule: GET when `url?params` fits in 2,000 characters, else a form POST. */
export const needsPost = (url, body) => `${url}?${body}`.length > 2000;

/* Same as esri-leaflet's `isArcgisOnline` (src/Util.js): a hosted FeatureServer answers `f=geojson` directly. */
export const isArcgisOnline = (url) => /^(?!.*utility\.arcgis\.com).*\.arcgis\.com.*FeatureServer/i.test(String(url || ""));

const knownFieldNames = /^(OBJECTID|FID|OID|ID)$/i;
function idFromResponse(response) {
  if (response.objectIdFieldName) return response.objectIdFieldName;
  if (response.fields) {
    for (let j = 0; j < response.fields.length; j++) if (response.fields[j].type === "esriFieldTypeOID") return response.fields[j].name;
    for (let j = 0; j < response.fields.length; j++) if (knownFieldNames.test(response.fields[j].name)) return response.fields[j].name;
  }
  return undefined;
}
function idFromFeature(feature) {
  for (const key in feature.attributes) if (knownFieldNames.test(key)) return key;
  return undefined;
}

/** esri-leaflet's `responseToFeatureCollection` (src/Util.js) without Leaflet: same id rule, same REVERSE order. */
export function esriResponseToFeatures(response) {
  const features = (response && (response.features || response.results)) || [];
  const idField = idFromResponse(response);
  const out = [];
  for (let i = features.length - 1; i >= 0; i--) out.push(arcgisToGeoJSON(features[i], idField || idFromFeature(features[i])));
  return out;
}

/** Turn an HTTP body into esri-leaflet's (error, response) pair, exactly as its XHR callback does. */
export function readEsriBody(text) {
  let response;
  try { response = JSON.parse(text); } catch (_) {
    return { error: { code: 500, message: "Could not parse response as JSON. This could also be caused by a CORS or XMLHttpRequest error." }, response: null };
  }
  if (response && response.error) return { error: response.error, response: null };
  return { error: null, response };
}
