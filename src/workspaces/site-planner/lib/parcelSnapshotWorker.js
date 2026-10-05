/* B2092656 ×3 — where a county's whole-county parcel SAVED COPY (B629) lives in the browser: in this worker, never on
 * the main thread.
 *
 * MEASURED on the recorded real production copies (Chambers 36,798 lots / 25 MB, Waller 46,231 / 30 MB;
 * ui-audit/verify-select-parcels-on-cost.mjs): on the main thread, reading one back from IndexedDB was one 227–254 ms
 * deserialise per county, a download's `r.json()` one 276–392 ms task, and once both were sliced, simply HOLDING
 * 46k lots on the main heap still cost ~50 ms major-GC pauses. Here the worker reads the chunked IndexedDB copy
 * (parcelSnapshotStore.js), checks Drive's vintage, downloads + parses + stores a newer one, and keeps the features;
 * the main thread asks it only for the lots in a view or the lot under a click — a few hundred small objects at most.
 *
 * Protocol (every request carries `id`; the reply echoes it):
 *   { op: "ensure", county, base }  → { type: "loaded", county, meta } (unsolicited, whenever a copy becomes held — from
 *                                     IndexedDB and/or a fresher download) … then { type: "ensured" }
 *   { op: "view", county, bounds }  → { type: "viewPart", features } × n, then { type: "view" }   (bounds { w, s, e, n };
 *                                     each feature carries __k)
 *   { op: "point", counties, lng, lat } → { type: "point", hit: { county, feature(esri) } | null }
 *   failure → { type: "error", message } */
import { readStoredSnapshot, writeStoredSnapshot, legacySnapshotKey } from "./parcelSnapshotStore.js";
import { idbDelete } from "./localDb.js";
import { featureBbox, featuresForView, featureAtPoint } from "./parcelSnapshotGeom.js";

const held = new Map(); // county -> { generatedAt, count, bbox, features }
const VIEW_BATCH = 200; // lots per "viewPart" message (≈ 5–8 ms to deserialise on the main thread at Waller's vertex density)

const metaOf = (s) => ({ generatedAt: s.generatedAt || null, count: s.count ?? s.features.length, bbox: s.bbox || null });
function hold(county, snap) {
  for (let i = 0; i < snap.features.length; i++) { snap.features[i].__k = i; featureBbox(snap.features[i]); } // stable key + memoised bbox
  held.set(county, snap);
  self.postMessage({ type: "loaded", county, meta: metaOf(snap) });
}

async function ensure(county, base) {
  if (!held.has(county)) {
    const stored = await readStoredSnapshot(county).catch(() => null);
    if (stored && Array.isArray(stored.features)) hold(county, stored);
    else idbDelete(legacySnapshotKey(county)).catch(() => {}); // a pre-B2092656 ×3 single-value copy: dropped, never read
  }
  let meta = null;
  try { const r = await fetch(`${base}/svc/${county}?meta=1`); meta = r && r.ok ? await r.json() : null; } catch (_) { return; }
  if (!meta || !meta.cached) return; // nothing on Drive yet → keep what we have (maybe nothing)
  const cur = held.get(county);
  if (cur && cur.generatedAt && meta.generatedAt && cur.generatedAt === meta.generatedAt) return; // up to date
  let fc = null;
  try { const r = await fetch(`${base}/svc/${county}`); fc = r && r.ok ? await r.json() : null; } catch (_) { return; }
  if (!fc || !Array.isArray(fc.features)) return;
  const snap = { generatedAt: meta.generatedAt || null, count: meta.count ?? fc.features.length, bbox: meta.bbox || null, features: fc.features };
  hold(county, snap);
  await writeStoredSnapshot(county, snap).catch(() => false);
}

self.onmessage = async (e) => {
  const d = e.data || {};
  try {
    if (d.op === "ensure") { await ensure(d.county, d.base); self.postMessage({ id: d.id, type: "ensured" }); return; }
    if (d.op === "view") { // in batches: one message is one main-thread deserialise, and 1,285 real Katy lots in one was ~44 ms
      const s = held.get(d.county);
      const feats = s ? featuresForView(s.features, d.bounds) : [];
      for (let i = 0; i < feats.length; i += VIEW_BATCH) self.postMessage({ id: d.id, type: "viewPart", features: feats.slice(i, i + VIEW_BATCH) });
      self.postMessage({ id: d.id, type: "view" });
      return;
    }
    if (d.op === "point") {
      let hit = null;
      for (const c of d.counties || []) {
        const s = held.get(c);
        if (!s) continue;
        const feature = featureAtPoint(s.features, d.lng, d.lat);
        if (feature) { hit = { county: c, feature }; break; }
      }
      self.postMessage({ id: d.id, type: "point", hit });
      return;
    }
    self.postMessage({ id: d.id, type: "error", message: `unknown op ${d.op}` });
  } catch (err) {
    self.postMessage({ id: d.id, type: "error", message: String((err && err.message) || err) });
  }
};
