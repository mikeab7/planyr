/* Client loader for the county PARCEL snapshot cache (B629).
 *
 * Plain-English: a nightly job saves a whole-county copy of the parcel outlines into Google Drive
 * (served by functions/api/parcel-cache). This module downloads that copy once, keeps it in the
 * browser (IndexedDB, uncapped — B474), and answers "draw the parcels in view" + "what lot is under
 * this click" entirely LOCALLY — so a flaky county server (Chambers/Waller ride the State/TxGIO
 * service that keeps going down) no longer blanks the map. It is a FALLBACK layered on top of the
 * live flow, never a replacement: it only supplies geometry the live source can't.
 *
 * The geometry helpers (featuresForView / featureAtPoint / featureBbox) are pure and unit-tested in
 * plain Node (test/parcelSnapshot.test.js). The IO (ensureSnapshot / IndexedDB / fetch) degrades to
 * a no-op when IndexedDB/fetch aren't available, so behaviour is never worse than today. Kill
 * switch: VITE_PARCEL_SNAPSHOT=0.
 *
 * ⛔ B1164656 (NEW-1) — the full-snapshot fetch below is a plain `r.json()`, on purpose: the
 * `/api/parcel-cache` endpoint decompresses its stored gzip Drive copy SERVER-SIDE before
 * responding (functions/api/parcel-cache/_handler.js), so this module never touches
 * `DecompressionStream` itself. A prior version had the server ship raw gzip bytes with a manually
 * set `content-encoding: gzip` header and expected the browser to gunzip it transparently — measured
 * live in a real signed-in browser against production, it does NOT, `r.json()` threw, and the
 * `catch (_) { return; }` below swallowed it silently, so the snapshot never loaded in ANY real
 * browser even though the endpoint reported healthy. Don't reintroduce client-side decompression as
 * "a fix" — the bug was the server declaring an encoding it didn't reliably apply, not a missing
 * client capability.
 */
import { SNAPSHOT_COUNTIES, STATEWIDE_PARCEL_LAYER } from "./counties.js";
import { idbDelete } from "./localDb.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { readStoredSnapshot, writeStoredSnapshot, legacySnapshotKey } from "./parcelSnapshotStore.js";
import { featureBbox, featuresForView, featureAtPoint } from "./parcelSnapshotGeom.js";

export { featureBbox, featuresForView, featureAtPoint };

/* ⛔ B2092656 ×3 — IN THE BROWSER A SAVED COPY LIVES IN A WORKER, NEVER ON THE MAIN THREAD. Turning Select parcels on
 * (even in Georgia) warmed both Texas copies, and each was one IndexedDB value (a 227–254 ms structured-clone
 * deserialise per county on a returning visit) or one `r.json()` (276–392 ms on a new-vintage day) — the pair of long
 * frames Michael measured (161 / 308 ms, build 947c0ff). Holding 46k lots on the main thread also left ~50 ms major-GC
 * pauses behind even once the work was sliced. So now: the worker (parcelSnapshotWorker.js) reads the CHUNKED
 * IndexedDB copy (parcelSnapshotStore.js), checks Drive, downloads, parses and stores — and keeps the features. The main
 * thread holds only the copy's vintage (`getSnapshot` → { generatedAt, count, bbox, inWorker: true }) and asks the
 * worker for the lots in a view (`snapshotFeaturesInView`) or under a click (`snapshotHitAt`). The CALLER warms only the
 * counties in view (MapFinder.syncDisplaysToView). Node / an injected fetch keeps the old in-memory path (the unit
 * tests). Gate: ui-audit/verify-select-parcels-on-cost.mjs (recorded real copies). */

// Default ON; disabled only by an explicit VITE_PARCEL_SNAPSHOT=0/false/off (mirrors VITE_GIS_PROXY).
export function snapshotEnabled() {
  try {
    const v = import.meta && import.meta.env ? import.meta.env.VITE_PARCEL_SNAPSHOT : undefined;
    return v !== "0" && v !== "false" && v !== "off" && v !== false;
  } catch (_) { return true; }
}

const _trimUrl = (u) => String(u || "").replace(/\/+$/, "");

/* Should the Drive snapshot be the DISPLAYED outline source for this county, or just a
 * click/outage fallback? Prefer it for DISPLAY only when the live source can't itself draw
 * current, client-selectable outlines: an image-only source — the statewide TxGIO layer,
 * whose /query is disabled upstream, matched by URL (mirrors `parcelDisplayIsImageOnly`).
 * A healthy queryable CAD (e.g. Chambers → CCAD after B787, or HCAD/FBCAD) draws its OWN
 * current vectors, so it owns the display and the snapshot stays purely a click/outage
 * fallback — otherwise a stale harvested snapshot would shadow the live CAD and Planyr's
 * parcels wouldn't match the county's own map (the exact B787 complaint). Requires a known
 * `liveUrl`: until it resolves we DON'T prefer the snapshot, so a queryable CAD is never
 * permanently shadowed by a snapshot that happened to load first. Pure. */
export function preferSnapshotForDisplay({ hasSnapshot, liveUrl } = {}) {
  if (!hasSnapshot || !liveUrl) return false;
  return _trimUrl(liveUrl) === _trimUrl(STATEWIDE_PARCEL_LAYER);
}

// ---------------------------------------------------------------------------
// IO — download once, hold in IndexedDB, SWR-refresh when the Drive copy is newer.
// ---------------------------------------------------------------------------

const loaded = new Map();       // county -> { generatedAt, count, bbox, features } (in memory) | { …, inWorker: true }
const inflight = new Map();     // county -> Promise (dedupe concurrent ensureSnapshot)
const listeners = new Set();    // repaint hooks

/* The snapshot for a county (null until loaded). Synchronous. In the browser it carries the vintage only
 * (`inWorker: true`) — ask `snapshotFeaturesInView` / `snapshotHitAt` for lots; never read `.features`. */
export function getSnapshot(county) { return loaded.get(county) || null; }
export function snapshotVintage(county) { const s = loaded.get(county); return s ? { asOf: s.generatedAt || null, count: s.count ?? (s.features ? s.features.length : 0) } : null; }

/* Subscribe to "a snapshot loaded/refreshed" so the map can repaint. Returns an unsubscribe fn. */
export function onSnapshotChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emitChange(county) { for (const fn of listeners) { try { fn(county); } catch (_) {} } }

/* Stable per-vintage key on every feature (its index in the county's list), so a layer can tell "already held" from
 * "new" across separate view queries — the worker's answers are fresh objects each time. */
function stampKeys(features) { for (let i = 0; i < features.length; i++) features[i].__k = i; return features; }

/* Warm the snapshot for a county: (1) load the IndexedDB copy if present, then (2) background-check the Drive
 * vintage and re-download only when it's newer (SWR). Safe to call repeatedly. Resolves the current snapshot
 * (possibly null). `fetchImpl` is injectable for tests and selects the in-memory path. */
export async function ensureSnapshot(county, { fetchImpl, base = "/api/parcel-cache" } = {}) {
  if (!snapshotEnabled() || !SNAPSHOT_COUNTIES.has(county)) return null;
  if (inflight.has(county)) return inflight.get(county);
  const run = (!fetchImpl && workerAvailable()
    ? ensureInWorker(county, base).catch((err) => {
      // LOUD: the fallback works, but it is the main-thread path this item removed — say so, never silently.
      reportClientEvent("parcel-snapshot-worker-failed", `${county}: ${(err && err.message) || err} — loading the saved copy on the main thread`, { county });
      return ensureInMemory(county, fetch.bind(globalThis), base);
    })
    : ensureInMemory(county, fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null), base));
  inflight.set(county, run);
  try { return await run; } finally { inflight.delete(county); }
}

/* The lots of `county` whose bbox meets `bounds` ({ w, s, e, n }). Each carries `__k`. Resolves [] when not loaded. */
export function snapshotFeaturesInView(county, bounds) {
  const s = loaded.get(county);
  if (!s) return Promise.resolve([]);
  if (s.features) return Promise.resolve(featuresForView(s.features, bounds));
  const parts = [];
  return ask({ op: "view", county, bounds }, (d) => { if (d.type === "viewPart") parts.push(d.features); }).then(() => parts.flat());
}

/* The lot under (lng, lat) in any loaded saved copy, shaped like an identify hit ({ county, feature(esri) }), or
 * null — the last-resort answer when every live source is unreachable (B629 / B1164656). */
export async function snapshotHitAt(lng, lat, counties = SNAPSHOT_COUNTIES) {
  const remote = [];
  for (const c of counties) {
    const s = loaded.get(c);
    if (!s) continue;
    if (s.features) { const feature = featureAtPoint(s.features, lng, lat); if (feature) return { county: c, feature }; }
    else remote.push(c);
  }
  if (!remote.length) return null;
  const d = await ask({ op: "point", counties: remote, lng, lat }).catch(() => null);
  return d && d.hit ? d.hit : null;
}

// ── the in-memory path (Node, tests, or a browser with no Worker) ──
async function ensureInMemory(county, doFetch, base) {
  // 1. Hydrate memory from IndexedDB, one chunk (one task) at a time.
  if (!loaded.has(county)) {
    const stored = await readStoredSnapshot(county, { onChunk: warmBboxes }).catch(() => null);
    if (stored && Array.isArray(stored.features)) { stampKeys(stored.features); loaded.set(county, stored); emitChange(county); }
    else idbDelete(legacySnapshotKey(county)).catch(() => {}); // a pre-B2092656 ×3 single-value copy: dropped, never read (reading it IS the long task)
  }
  // 2. Background: is Drive's copy newer (or do we have nothing)?
  if (doFetch) await refreshInMemory(county, doFetch, base).catch(() => {});
  return loaded.get(county) || null;
}

async function refreshInMemory(county, doFetch, base) {
  const cur = loaded.get(county);
  let meta = null;
  try { const r = await doFetch(`${base}/svc/${county}?meta=1`); meta = r && r.ok ? await r.json() : null; } catch (_) { return; }
  if (!meta || !meta.cached) return; // nothing on Drive yet → keep what we have (maybe nothing)
  // Up to date? (same vintage) → nothing to do.
  if (cur && cur.generatedAt && meta.generatedAt && cur.generatedAt === meta.generatedAt) return;

  let fc = null;
  try { const r = await doFetch(`${base}/svc/${county}`); fc = r && r.ok ? await r.json() : null; } catch (_) { return; }
  if (!fc || !Array.isArray(fc.features)) return;

  const snap = {
    generatedAt: meta.generatedAt || null,
    count: meta.count ?? fc.features.length,
    features: stampKeys(fc.features),
    bbox: meta.bbox || null,
  };
  loaded.set(county, snap);
  writeStoredSnapshot(county, snap).catch(() => {}); // chunked: each put serialises one chunk
  emitChange(county);
}

/* Memoise every feature's bbox as its chunk lands, so the first `featuresForView` over the whole county is not one
 * long task. */
function warmBboxes(features) { for (let i = 0; i < features.length; i++) featureBbox(features[i]); }

// ── the worker path (the browser) ──
let worker = null, seq = 0;
const pending = new Map(); // id -> { resolve, reject, onPart }
const workerAvailable = () => typeof Worker !== "undefined" && typeof location !== "undefined";
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./parcelSnapshotWorker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const d = e.data || {};
    if (d.type === "loaded") { // a county's copy is now held in the worker (from IndexedDB, or a fresher download)
      loaded.set(d.county, { generatedAt: d.meta.generatedAt || null, count: d.meta.count ?? null, bbox: d.meta.bbox || null, inWorker: true });
      emitChange(d.county);
      return;
    }
    const p = pending.get(d.id);
    if (!p) return;
    if (d.type === "viewPart") { if (p.onPart) p.onPart(d); return; } // a batch of a reply still coming
    pending.delete(d.id);
    if (d.type === "error") p.reject(new Error(d.message || "saved-copy worker error"));
    else p.resolve(d);
  };
  worker.onerror = (e) => {
    const err = new Error(`saved-copy worker crashed${e && e.message ? `: ${e.message}` : ""}`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    for (const [c, s] of loaded) if (s && s.inWorker) loaded.delete(c); // its copies died with it; the next ensure reloads
    try { worker.terminate(); } catch (_) { /* already gone */ }
    worker = null;
  };
  return worker;
}
function ask(msg, onPart) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = getWorker(); } catch (err) { reject(err); return; }
    const id = ++seq;
    pending.set(id, { resolve, reject, onPart });
    w.postMessage({ ...msg, id });
  });
}
async function ensureInWorker(county, base) {
  await ask({ op: "ensure", county, base: new URL(base, location.href).href });
  return loaded.get(county) || null;
}

/* ── NEW-7 — INSTRUMENTATION, deliberately not a cap ────────────────────────────────────────
 * `loaded` is county → the county's FULL GeoJSON feature array, and nothing but the test helper
 * below ever clears it. It could plausibly be tens of megabytes per county, and a session that
 * touches three counties holds three of them — but that "could" is the whole problem: the size
 * could not be established from source, and capping a fallback the map depends on, blind, is how
 * you trade a memory number for a blank map over a county whose live server is down.
 *
 * So: MEASURE FIRST. `snapshotFootprint()` reports what is actually retained, per county and in
 * total. `approxBytes` is the serialized size of the held features — the honest measure of the
 * retained object graph's scale, though the live JS objects cost more than their JSON text.
 * It is computed ON DEMAND (serializing a county is not free) and never on a render path.
 *
 * If the number turns out to justify a cap, the durable copy is already in IndexedDB (`writeStoredSnapshot`
 * above / `readStoredSnapshot` in ensureSnapshot), so an evicted county rehydrates instantly and locally —
 * the eviction would cost nothing but a disk read. That work is deliberately NOT done here. */
export function snapshotFootprint() {
  const counties = [];
  let totalBytes = 0, totalFeatures = 0;
  for (const [county, snap] of loaded) {
    const features = snap && Array.isArray(snap.features) ? snap.features.length : (snap && snap.count) || 0;
    let approxBytes = null; // a copy held in the worker is not on this heap at all (B2092656 ×3) — reported as null, never 0
    if (snap && snap.features) { try { approxBytes = JSON.stringify(snap.features).length; } catch (_) { approxBytes = null; } }
    counties.push({ county, features, approxBytes, generatedAt: (snap && snap.generatedAt) || null });
    totalFeatures += features;
    if (approxBytes != null) totalBytes += approxBytes;
  }
  return { counties, totalFeatures, totalBytes };
}

/* Reachable from a real signed-in session's console (`__planyrSnapshotFootprint()`) so the number
   can be READ off a live browser with real county data — the sandbox has no Drive access, and this
   is exactly the class of question a static read of the source could not answer. Read-only. */
if (typeof window !== "undefined") { try { window.__planyrSnapshotFootprint = snapshotFootprint; } catch (_) {} }

// Test/teardown helper — clear the in-memory registry (IndexedDB untouched).
export function _resetSnapshots() { loaded.clear(); inflight.clear(); }
