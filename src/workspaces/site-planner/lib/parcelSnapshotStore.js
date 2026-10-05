/* B2092656 ×3 — how a county's whole-county parcel SAVED COPY (B629) is kept in IndexedDB: in CHUNKS, never as one value.
 *
 * MEASURED (recorded real production copies, ui-audit/verify-select-parcels-on-cost.mjs): Chambers is 36,798 lots /
 * 25 MB and Waller 46,231 lots / 30 MB of GeoJSON. Stored as ONE IndexedDB value each, reading one back is ONE
 * structured-clone deserialise on the main thread — 254 ms and 227 ms, two separate tasks — and that is exactly the
 * pair of long frames Michael measured turning Select parcels on in Georgia (161 / 308 ms, build 947c0ff). A value
 * of SNAPSHOT_CHUNK lots deserialises in a few ms, and each chunk is its own `get` (its own task), so the browser
 * paints between them.
 *
 * Layout: `parcel-snapshot:v2:<county>:meta` = { gen, generatedAt, count, bbox, chunks, featureCount } and
 * `parcel-snapshot:v2:<county>:chunk:<i>` = { gen, features }. `gen` is a per-WRITE id: the meta is written LAST and
 * is the commit marker, so a write interrupted halfway leaves chunks whose `gen` disagrees with the meta and the
 * reader discards the whole copy (it is re-fetchable from Drive — TIER-BY-REBUILDABILITY — so discarding is safe and
 * a half-old/half-new county is never assembled). The v1 single-value key is deleted, never read: reading it IS the
 * 250 ms task.
 *
 * No Leaflet, no DOM: imported by the main thread (parcelSnapshot.js) AND by the download worker
 * (parcelSnapshotWorker.js); `get`/`put`/`del` are injectable so the unit test runs it in plain Node. */
import { idbGet, idbPut, idbDelete } from "./localDb.js";

/** Lots per stored chunk / per worker message (≈ 5–8 ms to deserialise at Waller's vertex density). */
export const SNAPSHOT_CHUNK = 1500;
const P = "parcel-snapshot:v2:";
export const legacySnapshotKey = (county) => `parcel-snapshot:v1:${county}:full`;
export const snapshotMetaKey = (county) => `${P}${county}:meta`;
export const snapshotChunkKey = (county, i) => `${P}${county}:chunk:${i}`;

/** Split `features` into arrays of at most `size`. Pure. */
export function chunkFeatures(features, size = SNAPSHOT_CHUNK) {
  const out = [];
  const list = Array.isArray(features) ? features : [];
  const n = Math.max(1, Math.floor(size) || SNAPSHOT_CHUNK);
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Read a county's stored copy chunk by chunk (each `get` its own task). `onChunk(features)` sees each chunk as it
 *  lands. Resolves { generatedAt, count, bbox, features } or null when absent, partial or inconsistent. */
export async function readStoredSnapshot(county, { get = idbGet, onChunk } = {}) {
  const meta = await get(snapshotMetaKey(county));
  if (!meta || !meta.gen || !Number.isInteger(meta.chunks) || meta.chunks < 0) return null;
  const features = [];
  for (let i = 0; i < meta.chunks; i++) {
    const c = await get(snapshotChunkKey(county, i));
    if (!c || c.gen !== meta.gen || !Array.isArray(c.features)) return null; // interrupted / mixed write → re-fetch
    if (onChunk) onChunk(c.features);
    for (let k = 0; k < c.features.length; k++) features.push(c.features[k]);
  }
  if (Number.isInteger(meta.featureCount) && features.length !== meta.featureCount) return null;
  return { generatedAt: meta.generatedAt || null, count: meta.count ?? features.length, bbox: meta.bbox || null, features };
}

/** Store a county's copy as chunks, then the meta (the commit marker), then drop stale chunks and the legacy v1
 *  value. Every `put` is awaited before the next, so no one task serialises more than a chunk. Resolves true when the
 *  meta committed. Never throws. */
export async function writeStoredSnapshot(county, snap, { get = idbGet, put = idbPut, del = idbDelete, size = SNAPSHOT_CHUNK } = {}) {
  try {
    if (!snap || !Array.isArray(snap.features)) return false;
    const prev = await get(snapshotMetaKey(county));
    const gen = `${snap.generatedAt || "none"}#${Date.now()}#${Math.random().toString(36).slice(2, 8)}`;
    const chunks = chunkFeatures(snap.features, size);
    for (let i = 0; i < chunks.length; i++) {
      if (!(await put(snapshotChunkKey(county, i), { gen, features: chunks[i] }))) return false;
    }
    const ok = await put(snapshotMetaKey(county), { gen, generatedAt: snap.generatedAt || null, count: snap.count ?? snap.features.length, bbox: snap.bbox || null, chunks: chunks.length, featureCount: snap.features.length });
    if (!ok) return false;
    const prevChunks = prev && Number.isInteger(prev.chunks) ? prev.chunks : 0;
    for (let i = chunks.length; i < prevChunks; i++) await del(snapshotChunkKey(county, i));
    await del(legacySnapshotKey(county));
    return true;
  } catch (_) { return false; }
}
