/* siteChecksTransport — the main-thread half of the Site Analysis polygon-query worker (siteChecksWorker.js says why).
 *
 * `windowedFetchImpl(siteRings)` returns a `fetchImpl` for gisFetch.fetchArcgisJson: the request runs in the worker and
 * the Response it resolves carries the ALREADY-WINDOWED answer. Everything around the transport is fetchArcgisJson's own
 * and unchanged — GET/POST choice, timeout (the abort reaches the worker's fetch), retries, HTTP and ArcGIS error
 * classification — so every failure path the panel already words is untouched (a worker-side error is rethrown with
 * its own name, so an AbortError still reads as a timeout).
 *
 * Falls back to a main-thread fetch (still windowed, still correct — only the parse cost returns) when there is no
 * Worker, and, for the rest of the session, once the worker has crashed — never silently: the crash is reported. */
import { windowArcgisAnswer, WINDOW_PAD_M } from "./featureWindow.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";

let worker = null, broken = false, seq = 0;
const jobs = new Map(); // id -> { resolve, reject, fallback }

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./siteChecksWorker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const d = e.data || {};
    const job = jobs.get(d.id);
    if (!job) return;
    jobs.delete(d.id);
    if (d.error) {
      const err = new Error(d.error.message);
      err.name = d.error.name;
      job.reject(err);
    } else job.resolve({ ok: !!d.ok, status: d.status, json: async () => d.json });
  };
  worker.onerror = (e) => {
    broken = true;
    try { reportClientEvent("site-checks-worker-crashed", `site-check polygon worker crashed${e && e.message ? `: ${e.message}` : ""} — polygon queries fall back to the main thread for this session`, { inFlight: jobs.size }); } catch (_) { /* telemetry never throws */ }
    const pending = [...jobs.values()];
    jobs.clear();
    try { worker.terminate(); } catch (_) { /* already gone */ }
    worker = null;
    pending.forEach((j) => j.fallback());
  };
  return worker;
}

const mainThreadFetch = (siteRings, padM) => async (url, init) => {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, json: async () => windowArcgisAnswer(await res.json(), siteRings, padM) };
};

export function workerAvailable() {
  return !broken && typeof Worker !== "undefined" && typeof location !== "undefined";
}

/* A fetchImpl for ONE site's polygon queries. */
export function windowedFetchImpl(siteRings, padM = WINDOW_PAD_M) {
  const viaMain = mainThreadFetch(siteRings, padM);
  return (url, init = {}) => {
    if (!workerAvailable()) return viaMain(url, init);
    const { signal, ...rest } = init;
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const w = getWorker();
      const fallback = () => viaMain(url, init).then(resolve, reject);
      jobs.set(id, { resolve, reject, fallback });
      if (signal) {
        const onAbort = () => {
          if (!jobs.has(id)) return;
          jobs.delete(id);
          try { w.postMessage({ type: "abort", id }); } catch (_) { /* worker gone */ }
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        };
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      w.postMessage({ id, url, init: rest, siteRings, padM });
    });
  };
}
