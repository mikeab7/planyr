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
import { serializeEsriParams, needsPost, isArcgisOnline, readEsriBody, esriResponseToFeatures } from "./parcelQueryWire.js";
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
    return { abort() { if (jobs.delete(id)) { try { w.postMessage({ id, type: "abort" }); } catch (_) { /* worker gone */ } } } };
  };
  return query;
}

/* NEW-1 (Select parcels, wide view) — one plain /query GET, run in the same worker, for the wide-view TILE engine (parcelWideEngine.js).
 * `cb({ ok, features, exceeded, status, transient, message })`; returns { abort() } that really cancels the fetch. A 429 / 5xx / network
 * failure / a 499-500-503 ArcGIS error body is `transient` (back off and retry); anything else is a refusal. With no Worker (or after a
 * crash) the same parse runs on the calling thread — the answer is small by construction (size-filtered, generalised, one tile). */
const TRANSIENT_CODES = new Set([0, 408, 429, 499, 500, 502, 503, 504]);
export function fetchEsriFeatures({ url, body, timeout = 30000 }, cb) {
  const abs = new URL(url, location.href).href;
  const finish = (error, status, features, meta) => {
    if (error) {
      const code = Number((error.error && error.error.code) || error.code || status || 0);
      const message = (error.error && error.error.message) || error.message || `HTTP ${status}`;
      cb({ ok: false, status, transient: TRANSIENT_CODES.has(status === 200 || !status ? code : status), message, unparsable: /^Could not parse response/.test(message) });
      return;
    }
    cb({ ok: true, status, features, exceeded: !!(meta && meta.exceededTransferLimit) });
  };
  if (broken || !enabled()) return mainThreadFetch(abs, body, timeout, finish);
  let w;
  try { w = getWorker(); } catch (_) { return mainThreadFetch(abs, body, timeout, finish); }
  const id = ++seq;
  const job = {
    features: [],
    fallback: () => { const h = mainThreadFetch(abs, body, timeout, finish); job.abort = h.abort; },
    done: (d) => finish(d.error, d.status, job.features, d.meta),
  };
  jobs.set(id, job);
  w.postMessage({ id, url: abs, body, post: false, timeout, geojson: false });
  return { abort() { if (jobs.delete(id)) { try { w.postMessage({ id, type: "abort" }); } catch (_) { /* worker gone */ } } if (job.abort) job.abort(); } };
}
function mainThreadFetch(abs, body, timeout, finish) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl && timeout > 0 ? setTimeout(() => ctrl.abort(), timeout) : null;
  let aborted = false;
  fetch(`${abs}?${body}`, ctrl ? { signal: ctrl.signal } : undefined)
    .then(async (r) => ({ status: r.status, text: await r.text() }))
    .then(({ status, text }) => {
      if (aborted) return;
      const { error, response } = readEsriBody(text);
      if (error) { finish(error, status); return; }
      const meta = {};
      for (const k in response) if (k !== "features" && k !== "results") meta[k] = response[k];
      finish(null, status, esriResponseToFeatures(response), meta);
    })
    .catch(() => { if (!aborted) finish({ error: { code: 500, message: "network error" } }, 0); })
    .finally(() => { if (timer) clearTimeout(timer); });
  return { abort() { aborted = true; if (ctrl) ctrl.abort(); } };
}
