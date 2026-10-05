/* B2092656 ×3 — the main-thread half of the parcel-outline query WORKER transport (parcelQueryWire.js says why).
 *
 * `routeQueryThroughWorker(query)` swaps ONE esri-leaflet Query's `run` for a version whose network round trip, JSON
 * parse and ArcGIS→GeoJSON conversion happen in parcelQueryWorker.js. Everything around the transport is esri-leaflet's
 * own and unchanged — the query is built by the layer's own `_buildQuery` (fields, geometry, precision, simplify), the
 * service fires the same `requeststart`, and the answer goes through the service's own `_createServiceCallback`, so
 * `requestsuccess` / `requesterror` / `requestend` (the hang-guards in MapFinder and parcelOutlineSet, the retry and
 * breaker paths) fire exactly as before, with esri-leaflet's own error shapes. The callback receives the same
 * (error, featureCollection, response) a normal run gives.
 *
 * Falls back to esri-leaflet's own path (never fails open into a silent no-op) when there is no Worker, when the
 * service is authenticating or not using CORS, when the kill switch is set (VITE_PARCEL_QUERY_WORKER=0), or — for the
 * rest of the session — once the worker has crashed. */
import * as EL from "esri-leaflet";
import { serializeEsriParams, needsPost, isArcgisOnline } from "./parcelQueryWire.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";

function enabled() {
  try {
    const v = import.meta && import.meta.env ? import.meta.env.VITE_PARCEL_QUERY_WORKER : undefined;
    if (v === "0" || v === "false" || v === "off" || v === false) return false;
  } catch (_) { /* default on */ }
  return typeof Worker !== "undefined" && typeof location !== "undefined";
}

let worker = null, broken = false, seq = 0;
const jobs = new Map(); // id -> { features, done(msg), fallback() }
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./parcelQueryWorker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const d = e.data || {};
    const job = jobs.get(d.id);
    if (!job) return;
    if (d.type === "part") { for (let i = 0; i < d.features.length; i++) job.features.push(d.features[i]); return; }
    jobs.delete(d.id);
    job.done(d);
  };
  worker.onerror = (e) => {
    broken = true; // the rest of the session uses esri-leaflet's own transport; in-flight queries are re-sent through it
    reportClientEvent("parcel-query-worker-crashed", `parcel query worker crashed${e && e.message ? `: ${e.message}` : ""} — outline queries fall back to the main thread for this session`, { inFlight: jobs.size });
    const pending = [...jobs.values()];
    jobs.clear();
    try { worker.terminate(); } catch (_) { /* already gone */ }
    worker = null;
    pending.forEach((j) => j.fallback());
  };
  return worker;
}

export function routeQueryThroughWorker(query) {
  if (!query || typeof query.run !== "function" || !enabled()) return query;
  const baseRun = query.run;
  query.run = function (callback, context) {
    const svc = this._service;
    if (broken || !svc || svc._authenticating || !svc.options || svc.options.useCors === false || typeof svc._createServiceCallback !== "function") {
      return baseRun.call(this, callback, context);
    }
    // ── esri-leaflet Query.run + Task.request + Service._request, minus the XHR ──
    this._cleanParams();
    const geojson = !!(this.options.isModern || (isArcgisOnline(this.options.url) && this.options.isModern === undefined));
    if (geojson) this.params.f = "geojson";
    if (this.options.requestParams) Object.assign(this.params, this.options.requestParams);
    const path = this.path, params = this.params, q = this;
    svc.fire("requeststart", { url: svc.options.url + path, params, method: "request" }, true);
    const wrapped = svc._createServiceCallback("request", path, params, (error, response) => {
      if (typeof q._trapSQLerrors === "function") q._trapSQLerrors(error);
      callback.call(context, error, response ? (geojson ? response : response.__fc) : response, response);
    }, q);
    if (svc.options.token) params.token = svc.options.token;
    if (svc.options.requestParams) Object.assign(params, svc.options.requestParams);
    const url = svc.options.proxy ? `${svc.options.proxy}?${svc.options.url}${path}` : svc.options.url + path;
    const fallback = () => EL.request(url, params, wrapped, svc); // esri-leaflet's own transport, same params, same callback
    let w;
    try { w = getWorker(); } catch (err) {
      broken = true;
      reportClientEvent("parcel-query-worker-crashed", `parcel query worker could not start: ${(err && err.message) || err} — main-thread fallback`, {});
      return fallback();
    }
    const id = ++seq;
    const job = {
      features: [],
      fallback,
      done: (d) => {
        if (d.error) { wrapped(d.error, null); return; }
        const fc = { type: "FeatureCollection", features: job.features };
        wrapped(null, geojson ? Object.assign({}, d.meta, fc) : Object.assign({}, d.meta, { __fc: fc }));
      },
    };
    jobs.set(id, job);
    const body = serializeEsriParams(params);
    const abs = new URL(url, location.href).href;
    w.postMessage({ id, url: abs, body, post: needsPost(url, body), timeout: Number(svc.options.timeout) || 0, geojson });
    return { abort() { jobs.delete(id); } };
  };
  return query;
}
