/* Storage census — how much room this app is using, per TIER and per CLASS (NEW-3/B1429).
 *
 * WHY THIS EXISTS. Before it, nothing in the app knew how much room it was using anywhere, so
 * "your device's storage is full" (the B473 banner) was the FIRST and ONLY signal — a wall, with
 * no number behind it and no way to see it coming. It also made the failure easy to mis-diagnose:
 * the first read of the B1427 crisis blamed IndexedDB and was wrong by three orders of magnitude.
 * A guess is what you get when nothing measures.
 *
 * ⛔ THE TWO TIERS ARE REPORTED SEPARATELY AND ARE NEVER SUMMED.
 *
 *     localStorage — a hard ~5 MB per-origin cap, synchronous, and where saved plans live.
 *     IndexedDB    — a browser-derived quota in the GIGABYTES (10,275.9 MB measured on the
 *                    owner's own machine, 0.3% used), asynchronous, and PERSISTENT for this
 *                    origin (SitePlannerApp calls idbPersist()), so the browser will never
 *                    evict it for us.
 *
 * Adding those two numbers together produces a figure that means nothing — "4.0 MB of 10,280.9 MB"
 * reads as 0.04% full while the store that actually matters is at 78% and about to throw. Every
 * function here returns them as two objects and there is deliberately no combined total anywhere.
 *
 * WHAT IS SAFE TO DELETE. Each class declares a `rebuild` source: the thing that can put the data
 * back if we drop it. `rebuild: null` means NOTHING can — that class is never reclaimable, at any
 * pressure, by any code path. See ./storageReclaim.js, which is the only consumer allowed to act
 * on this, and B474's raster hazard, which is why the rule is a declaration rather than a habit.
 *
 * Pure over injected stores, so it unit-tests in Node with no DOM — the one import below is the
 * dependency-free IndexedDB walker, defaulted in so callers don't have to wire it, and overridable
 * by every function that uses it.
 */
import { walkOriginStore } from "./originStore.js";

/* Where a class of data can be re-obtained from if we drop it. `null` = nowhere: it is the only
 * copy, and it may never be evicted to make room for anything. */
export const REBUILD = {
  NONE: null,
  GIS: "gis-service",       // a published GIS endpoint will serve it again on the next pan
  CLOUD: "cloud",           // a copy exists in the signed-in user's account
  IDB_MIRROR: "idb-mirror", // mirrored in the large store (but the mirror is best-effort — see below)
};

const has = (k, ...prefixes) => prefixes.some((p) => k.indexOf(p) === 0);

/* localStorage classes, ORDER-SENSITIVE: first match wins, so the narrow ones come first
 * (the version ring is `planarfit:sites:history:v1`, which would otherwise be swallowed by
 * the `planarfit:sites` plans prefix). */
export const LOCAL_CLASSES = [
  {
    id: "history", label: "Version history", rebuild: REBUILD.IDB_MIRROR, reclaimable: false,
    // Mirrored into IndexedDB by storage.js — but that write is FIRE-AND-FORGET, so on any given
    // device the localStorage copy may be the only one. Never reclaimable. (B474 review #14.)
    match: (k) => has(k, "planarfit:sites:history"),
  },
  {
    id: "plans", label: "Saved plans", rebuild: REBUILD.NONE, reclaimable: false,
    match: (k) => has(k, "planarfit:sites", "planarfit:autosave", "planarfit:currentSite", "planarfit:sitesGroups", "planarfit:scenario", "scenario:"),
  },
  {
    id: "mapdata", label: "Map data", rebuild: REBUILD.GIS, reclaimable: true,
    // The GIS screening cache (legacy localStorage namespace — the persistent tier lives in
    // IndexedDB since B1427) and the cached layer-extent probes. Both are one fetch away.
    match: (k) => has(k, "planyr:giscache:", "planarfit:layerExtent"),
  },
  {
    id: "documents", label: "Drawings & notes", rebuild: REBUILD.NONE, reclaimable: false,
    match: (k) => has(k, "planyr:docreview", "planyr-note", "planyr:notes", "planyr:library", "planyr:pins"),
  },
  {
    id: "settings", label: "Settings & preferences", rebuild: REBUILD.NONE, reclaimable: false,
    match: (k) => has(k, "planarfit:", "planyr:", "planyr.", "planyr-", "sb-"),
  },
  { id: "other", label: "Other", rebuild: REBUILD.NONE, reclaimable: false, match: () => true },
];

/* IndexedDB classes, keyed off the `kv` store's key prefixes. Same order rule. */
export const IDB_CLASSES = [
  {
    id: "mapdata", label: "Map data", rebuild: REBUILD.GIS, reclaimable: true,
    match: (k) => has(k, "giscache:"),
  },
  {
    id: "history", label: "Version history", rebuild: REBUILD.IDB_MIRROR, reclaimable: false,
    match: (k) => has(k, "planarfit:sites:history"),
  },
  {
    /* Performance recordings (NEW-1). In the LARGE tier deliberately — TIER-BY-REBUILDABILITY:
     * a diagnostic must never compete with saved plans for the ~5 MB small store. NOT reclaimable,
     * because nothing can rebuild one: the moment it describes is gone. It is kept small by its
     * own writer instead (perfCaptureStore.js prunes to three on every write) and it is shown in
     * the storage panel with its own clear control, so it can never grow without being visible. */
    id: "perfcaptures", label: "Performance recordings", rebuild: REBUILD.NONE, reclaimable: false,
    match: (k) => has(k, "perfcap:"),
  },
  {
    /* Reference images: the aerial underlay and placed PDF/CAD rasters. CONDITIONALLY rebuildable
     * and therefore NEVER bulk-reclaimable. B474 recorded the exact hazard: "a raster whose src had
     * been dropped (idbKey set) was then unrecoverable". A raster with a `storageKey` has a cloud
     * copy; one with only an `idbKey` is the user's ONLY copy of that image. Since the key alone
     * cannot tell you which, this class is `reclaimable: false` and stays that way. */
    id: "rasters", label: "Reference images", rebuild: REBUILD.NONE, reclaimable: false,
    match: (k) => has(k, "raster:"),
  },
  { id: "other", label: "Other", rebuild: REBUILD.NONE, reclaimable: false, match: () => true },
];

export const classifyLocalKey = (k) => LOCAL_CLASSES.find((c) => c.match(k)) || LOCAL_CLASSES[LOCAL_CLASSES.length - 1];
export const classifyIdbKey = (k) => IDB_CLASSES.find((c) => c.match(k)) || IDB_CLASSES[IDB_CLASSES.length - 1];

/* The practical per-origin localStorage ceiling. Every major browser lands on ~5 MB of UTF-16
 * code units; it is not queryable, so this is a documented constant used for the "% full"
 * readout only — never for a decision. The owner's measured census: 3.88 MB across 156 keys. */
export const LOCAL_CAP_BYTES = 5 * 1024 * 1024;

/* Byte census of a localStorage-like store, grouped by class. Pure. `bytes` counts the value
 * plus the key, because the key is stored too and a namespace of 156 long keys is not free. */
export function censusLocalStorage(store) {
  const out = { supported: !!store, totalBytes: 0, keyCount: 0, capBytes: LOCAL_CAP_BYTES, classes: [], largest: [] };
  if (!store) return out;
  const byClass = new Map();
  const all = [];
  let n = 0;
  try { n = store.length; } catch (_) { return out; }
  for (let i = 0; i < n; i++) {
    let k = null, v = null;
    try { k = store.key(i); if (k == null) continue; v = store.getItem(k) || ""; } catch (_) { continue; }
    const bytes = v.length + k.length;
    const cls = classifyLocalKey(k);
    const row = byClass.get(cls.id) || { id: cls.id, label: cls.label, rebuild: cls.rebuild, reclaimable: cls.reclaimable, bytes: 0, keys: 0 };
    row.bytes += bytes; row.keys += 1;
    byClass.set(cls.id, row);
    out.totalBytes += bytes; out.keyCount += 1;
    all.push({ key: k, bytes, classId: cls.id });
  }
  out.classes = [...byClass.values()].sort((a, b) => b.bytes - a.bytes);
  out.largest = all.sort((a, b) => b.bytes - a.bytes).slice(0, 8);
  return out;
}

/* navigator.storage.estimate() + persisted(), normalized. Resolves an honest "unsupported"
 * shape rather than throwing or guessing. `usageDetails` is Chromium-only and is passed through
 * untouched — it is the only per-backend breakdown the platform gives us. */
export async function estimateQuota(nav) {
  const n = nav || (typeof navigator !== "undefined" ? navigator : null);
  const out = { supported: false, usageBytes: null, quotaBytes: null, persisted: null, usageDetails: null };
  if (!n || !n.storage || typeof n.storage.estimate !== "function") return out;
  try {
    const est = await n.storage.estimate();
    out.supported = true;
    out.usageBytes = typeof est.usage === "number" ? est.usage : null;
    out.quotaBytes = typeof est.quota === "number" ? est.quota : null;
    out.usageDetails = est.usageDetails || null;
  } catch (_) { return out; }
  try { if (typeof n.storage.persisted === "function") out.persisted = await n.storage.persisted(); } catch (_) {}
  return out;
}

/* Byte census of the IndexedDB kv store, grouped by class. `walk` defaults to the dependency-free
 * originStore walker — one cursor pass, one record resident at a time, so measuring a large raster
 * namespace costs one raster of peak memory rather than all of them. Tests inject a fake. */
export async function censusIndexedDb(walk = walkOriginStore) {
  const out = { supported: typeof walk === "function", totalBytes: 0, keyCount: 0, classes: [] };
  if (!out.supported) return out;
  const byClass = new Map();
  await walk("", (k, v) => {
    const bytes = (typeof v === "string" ? v.length : approxBytes(v)) + String(k).length;
    const cls = classifyIdbKey(String(k));
    const row = byClass.get(cls.id) || { id: cls.id, label: cls.label, rebuild: cls.rebuild, reclaimable: cls.reclaimable, bytes: 0, keys: 0 };
    row.bytes += bytes; row.keys += 1;
    byClass.set(cls.id, row);
    out.totalBytes += bytes; out.keyCount += 1;
  });
  out.classes = [...byClass.values()].sort((a, b) => b.bytes - a.bytes);
  return out;
}

// Cheap size of a non-string record (rare here — nearly everything is stored as JSON text).
function approxBytes(v) {
  if (v == null) return 0;
  if (typeof v === "string") return v.length;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (v instanceof Blob) return v.size;
  try { return JSON.stringify(v).length; } catch (_) { return 0; }
}

/* One call for the whole picture, as TWO tiers that are never combined. `local` is exact
 * (localStorage is synchronous and enumerable). `idb` carries BOTH the platform's own
 * origin-wide estimate and our per-class measurement — those disagree slightly (the estimate
 * includes every IndexedDB database plus the Cache/Service Worker storage, and it rounds for
 * privacy), and showing both is how a future reader can tell WHICH is off rather than
 * assuming. */
export async function storageSnapshot({ store, walk = walkOriginStore, nav } = {}) {
  const local = censusLocalStorage(store !== undefined ? store : safeLocalStorage());
  const [quota, idbClasses] = await Promise.all([estimateQuota(nav), censusIndexedDb(walk)]);
  return {
    local,
    idb: {
      supported: quota.supported || idbClasses.supported,
      usageBytes: quota.usageBytes,
      quotaBytes: quota.quotaBytes,
      persisted: quota.persisted,
      usageDetails: quota.usageDetails,
      measuredBytes: idbClasses.totalBytes,
      keyCount: idbClasses.keyCount,
      classes: idbClasses.classes,
    },
  };
}

function safeLocalStorage() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (_) { return null; }
}

/* Compact key/value facts for a telemetry payload (NEW-3b). Flat, small, and TIER-LABELLED —
 * `local_*` vs `idb_*` — so a future save-failure row answers "which store was full, and what
 * was in it" instead of only "a write failed". Never sums the tiers. */
export function telemetryFacts(snap) {
  if (!snap) return {};
  const f = {
    local_bytes: snap.local.totalBytes,
    local_keys: snap.local.keyCount,
    local_cap: snap.local.capBytes,
    local_pct: snap.local.capBytes ? Math.round((snap.local.totalBytes / snap.local.capBytes) * 100) : null,
    idb_usage: snap.idb.usageBytes,
    idb_quota: snap.idb.quotaBytes,
    idb_pct: snap.idb.quotaBytes ? Math.round(((snap.idb.usageBytes || 0) / snap.idb.quotaBytes) * 100) : null,
    idb_persisted: snap.idb.persisted,
  };
  for (const c of snap.local.classes) f[`local_${c.id}`] = c.bytes;
  for (const c of snap.idb.classes) f[`idb_${c.id}`] = c.bytes;
  return f;
}

/* Human byte label. Binary units, one decimal below 10 — the same convention the browser's own
 * storage UI uses, so a user comparing the two sees the same shape of number. */
export function formatBytes(n) {
  if (n == null || !isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}
