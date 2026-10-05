/* B2092656 ×3 — runs a parcel-outline /query OFF the main thread: fetch, JSON parse, ArcGIS→GeoJSON, then hands the lots
 * back in batches. See parcelQueryWire.js for why, and parcelQueryTransport.js for the main-thread half.
 *
 * in:  { id, url, body, post, timeout, geojson }
 * out: { id, type: "part", features } × n  ·  { id, type: "done", error, meta }
 *      (`meta` = the answer's top-level keys minus `features`, e.g. exceededTransferLimit; `error` uses esri-leaflet's
 *       own shapes, so the layer's requesterror / hang-guard / retry handling reads it unchanged) */
import { readEsriBody, esriResponseToFeatures, LOTS_PER_MESSAGE } from "./parcelQueryWire.js";

self.onmessage = async (e) => {
  const { id, url, body, post, timeout, geojson } = e.data || {};
  let ctrl = null, timer = null;
  if (timeout > 0 && typeof AbortController !== "undefined") { ctrl = new AbortController(); timer = setTimeout(() => ctrl.abort(), timeout); }
  let text;
  try {
    const r = post
      ? await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body, signal: ctrl ? ctrl.signal : undefined })
      : await fetch(`${url}?${body}`, { signal: ctrl ? ctrl.signal : undefined });
    text = await r.text();
  } catch (_) {
    // esri-leaflet's XHR onerror shape, verbatim (it wraps the error one level deep)
    self.postMessage({ id, type: "done", error: { error: { code: 500, message: "XMLHttpRequest error" } }, meta: null });
    return;
  } finally { if (timer) clearTimeout(timer); }
  const { error, response } = readEsriBody(text);
  if (error) { self.postMessage({ id, type: "done", error, meta: null }); return; }
  const features = geojson ? (response.features || []) : esriResponseToFeatures(response);
  const meta = {};
  for (const k in response) if (k !== "features" && k !== "results") meta[k] = response[k];
  for (let i = 0; i < features.length; i += LOTS_PER_MESSAGE) self.postMessage({ id, type: "part", features: features.slice(i, i + LOTS_PER_MESSAGE) });
  self.postMessage({ id, type: "done", error: null, meta });
};
