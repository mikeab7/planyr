/* B2092656 ×3 — runs a parcel-outline /query OFF the main thread: fetch, JSON parse, ArcGIS→GeoJSON, then hands the lots
 * back in batches. See parcelQueryWire.js for why, and parcelQueryTransport.js for the main-thread half.
 *
 * in:  { id, url, body, post, timeout, geojson }  ·  { id, type: "abort" } (cancel that request's fetch)
 * out: { id, type: "part", features } × n  ·  { id, type: "done", error, meta }
 *      (`status` = the HTTP status, 0 when the fetch itself failed — the wide-view tile engine reads 429/503 from it;
 *       `meta` = the answer's top-level keys minus `features`, e.g. exceededTransferLimit; `error` uses esri-leaflet's
 *       own shapes, so the layer's requesterror / hang-guard / retry handling reads it unchanged) */
import { readEsriBody, esriResponseToFeatures, ensureFeatureIds, LOTS_PER_MESSAGE } from "./parcelQueryWire.js";

const ctrls = new Map(); // id -> AbortController, so the main thread can cancel a request whose tile left the view
self.onmessage = async (e) => {
  const { id, url, body, post, timeout, geojson, type } = e.data || {};
  if (type === "abort") { const c = ctrls.get(id); if (c) c.abort(); return; }
  let ctrl = null, timer = null;
  if (typeof AbortController !== "undefined") { ctrl = new AbortController(); ctrls.set(id, ctrl); }
  if (timeout > 0 && ctrl) timer = setTimeout(() => ctrl.abort(), timeout);
  let text, status = 0;
  try {
    const r = post
      ? await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body, signal: ctrl ? ctrl.signal : undefined })
      : await fetch(`${url}?${body}`, { signal: ctrl ? ctrl.signal : undefined });
    status = r.status;
    text = await r.text();
  } catch (_) {
    // esri-leaflet's XHR onerror shape, verbatim (it wraps the error one level deep)
    self.postMessage({ id, type: "done", error: { error: { code: 500, message: "XMLHttpRequest error" } }, meta: null, status: 0 });
    return;
  } finally { if (timer) clearTimeout(timer); ctrls.delete(id); }
  const { error, response } = readEsriBody(text);
  if (error) { self.postMessage({ id, type: "done", error, meta: null, status }); return; }
  const features = geojson ? ensureFeatureIds(response.features || []) : esriResponseToFeatures(response);
  const meta = {};
  for (const k in response) if (k !== "features" && k !== "results") meta[k] = response[k];
  for (let i = 0; i < features.length; i += LOTS_PER_MESSAGE) self.postMessage({ id, type: "part", features: features.slice(i, i + LOTS_PER_MESSAGE) });
  self.postMessage({ id, type: "done", error: null, meta, status });
};
