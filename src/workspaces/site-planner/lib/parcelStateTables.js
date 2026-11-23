/* The per-state county parcel TABLES load ON DEMAND (batch K stage 2, 2026-11-23, B2671306) — NOT in the Site route's first download.
 *
 * Nineteen files (alabamaParcels.js … kyParcels.js, ~215 KB raw) hold the county rows for states whose counties are wired one by one. They used to be
 * imported statically by counties.js, so a Houston site downloaded Kentucky's. Now counties.js keeps only what every session needs (Texas, Colorado, the
 * statewide composites and the hand-written rows) and this file is the slim eager INDEX: which state codes are lazy, the key prefix that names each one's rows,
 * and how to load it. A state's rows are merged into COUNTIES / COUNTIES_MAP (counties.js `registerParcelState`) the first time something needs them:
 *   · the map view or a clicked / searched point is inside the state   → ensureParcelStatesForView / ensureParcelStatesForPoint
 *   · a saved site names one of its county keys (`ky_fayette`)         → ensureParcelStatesForKeys / the COUNTIES proxy kicks it
 *   · the admin coverage map or a test wants every row                 → loadAllParcelStates
 *
 * ⛔ "NOT LOADED YET" IS NEVER "NO DATA". Until a state's rows are in, `countyIdentity` answers `pending` (the existing "geometry not resident" answer every
 * lot-picking flow already awaits via `ensureCountyGeometryAt`, which now also awaits the point's state) and `displaySourcesForView` falls back to its
 * pending path; a lookup that was missed because the state was still loading KICKS the load itself and notifies `onParcelTablesLoaded` listeners, so the map
 * and the planner re-run. A saved county key is never rewritten because its table has not arrived (nothing here removes or replaces a stored value).
 * ⛔ Adding a state: add its file HERE (and nowhere eager), keep its `<st>_` key prefix, and `test/parcelStateTables.test.js` fails until the index and the rows agree.
 * This module imports nothing from counties.js (counties.js registers itself as the sink) so the dependency stays one-way. */
import { siteState } from "./siteRegion.js";
import { PRELOADED } from "./parcelTablesPreload.js";

/* `load()` resolves `{ raw, map }` — the two row sets counties.js used to spread into COUNTIES_RAW and COUNTIES_MAP_RAW, in their original order. */
export const PARCEL_STATE_FILES = [
  { state: "AL", load: () => import("./alabamaParcels.js").then((m) => ({ raw: m.alRaw(), map: m.alMap() })) },
  { state: "SD", load: () => import("./sdParcels.js").then((m) => ({ raw: m.sdRaw(), map: m.sdMap() })) },
  { state: "ID", load: () => import("./idParcels.js").then((m) => ({ raw: m.idRaw(), map: m.idMap() })) },
  { state: "NM", load: () => import("./nmParcels.js").then((m) => ({ raw: m.nmRaw(), map: m.nmMap() })) },
  { state: "GA", load: () => import("./gaParcels.js").then((m) => ({ raw: m.gaRaw(), map: m.gaMap() })) },
  { state: "LA", load: () => import("./laParcels.js").then((m) => ({ raw: m.laRaw(), map: m.laMap() })) },
  { state: "MO", load: () => import("./moParcels.js").then((m) => ({ raw: m.moRaw(), map: m.moMap() })) },
  { state: "MI", load: () => import("./miParcels.js").then((m) => ({ raw: m.miRaw(), map: m.miMap() })) },
  { state: "SC", load: () => import("./scParcels.js").then((m) => ({ raw: m.scRaw(), map: m.scMap() })) },
  { state: "PA", load: () => import("./paParcels.js").then((m) => ({ raw: m.paRaw(), map: m.paMap() })) },
  { state: "IL", load: () => import("./ilParcels.js").then((m) => ({ raw: m.ilRaw(), map: m.ilMap() })) },
  { state: "WA", load: () => import("./waParcels.js").then((m) => ({ raw: m.waRaw(), map: m.waMap() })) },
  { state: "OR", load: () => import("./orParcels.js").then((m) => ({ raw: m.orRaw(), map: m.orMap() })) },
  { state: "OK", load: () => import("./okParcels.js").then((m) => ({ raw: m.okRaw(), map: m.okMap() })) },
  { state: "AZ", load: () => import("./azParcels.js").then((m) => ({ raw: m.azRaw(), map: m.azMap() })) },
  { state: "KS", load: () => import("./ksParcels.js").then((m) => ({ raw: m.ksRaw(), map: m.ksMap() })) },
  { state: "NY", load: () => import("./nyParcels.js").then((m) => ({ raw: m.nyRaw(), map: m.nyMap() })) },
  { state: "IA", load: () => import("./iaParcels.js").then((m) => ({ raw: { ...m.iaRaw(), ...m.iaCopyRaw() }, map: { ...m.iaMap(), ...m.iaCopyMap() } })) },
  { state: "KY", load: () => import("./kyParcels.js").then((m) => ({ raw: m.kyRaw(), map: m.kyMap() })) },
];

/* THE ORDER THE ROWS HAD WHEN THEY WERE STATIC. Every lazy state's rows sat in ONE block of each literal, right after the last MS MARIS row (`ms_yazoo`), in this order
 * (raw and map differ). Object key order is observable — `candidateCountiesForPoint`'s first answer, `countyForView`'s tie-break, "config order" — so `registerParcelState`
 * (counties.js) re-inserts a loaded state's rows at that block in this order, whatever order states load in. test/parcelStateTables.test.js compares the full key order of
 * the all-loaded registry with a dump taken before the split. */
export const LAZY_ROWS_AFTER_KEY = "ms_yazoo";
export const LAZY_ROW_ORDER = {
  raw: ["LA", "AL", "MI", "PA", "OK", "KS", "NY", "IA", "MO", "SC", "IL", "WA", "OR", "SD", "AZ", "ID", "NM", "GA", "KY"],
  map: ["AL", "OR", "SD", "AZ", "ID", "NM", "GA", "LA", "MI", "KS", "NY", "MO", "SC", "PA", "IL", "WA", "OK", "IA", "KY"],
};

const BY_STATE = Object.fromEntries(PARCEL_STATE_FILES.map((f) => [f.state, f]));
export const LAZY_PARCEL_STATES = Object.freeze(PARCEL_STATE_FILES.map((f) => f.state));
export const isLazyParcelState = (st) => !!(st && BY_STATE[String(st).toUpperCase()]);
/* A routing key's state code when it is one of the lazy states' (`ky_fayette` → "KY"); null for every other key (Texas bare keys, `co_*`, hand-written rows too —
 * asking for them is harmless, the load simply merges rows that are not there yet). */
export function lazyStateOfKey(key) {
  const m = /^([a-z]{2})_/.exec(String(key == null ? "" : key).trim().toLowerCase());
  const st = m && m[1].toUpperCase();
  return st && BY_STATE[st] ? st : null;
}

const loaded = new Set();
const inflight = new Map();
const failedAt = new Map(); // state → time of its last failed load: the fire-and-forget kick backs off for KICK_BACKOFF_MS (an explicit ensure always retries)
const KICK_BACKOFF_MS = 5000;
const listeners = new Set();
let sink = null; // counties.js's `registerParcelState(state, { raw, map })`
let version = 0;
export const setParcelTableSink = (fn) => {
  sink = fn;
  // Unit suites only (the alias in vitest.config.js): every table is merged and marked loaded at once. Production's PRELOADED is null.
  if (PRELOADED) for (const [st, rows] of Object.entries(PRELOADED)) { fn(st, rows); loaded.add(st); }
};
export const parcelTablesVersion = () => version;
export const parcelStateLoaded = (st) => !isLazyParcelState(st) || loaded.has(String(st).toUpperCase());
/* Subscribe to "a state's rows just landed" (map re-run, planner re-sync, React re-render). Returns the unsubscribe. */
export function onParcelTablesLoaded(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/* Failure is LOUD: console.error + the optional reporter (telemetry), and the in-flight entry is dropped so the NEXT ask retries. A failed chunk fetch on a stale
 * build is also what the app's stale-build reload rescue listens for. */
let reporter = null;
export const setParcelTableReporter = (fn) => { reporter = fn; };

export function ensureParcelState(st) {
  const code = st ? String(st).toUpperCase() : null;
  const file = code && BY_STATE[code];
  if (!file || loaded.has(code)) return Promise.resolve(false);
  if (inflight.has(code)) return inflight.get(code);
  const p = file.load().then((rows) => {
    if (sink) sink(code, rows);
    loaded.add(code);
    failedAt.delete(code);
    version += 1;
    inflight.delete(code);
    listeners.forEach((fn) => { try { fn(code); } catch (e) { console.error("[parcelStateTables] listener failed", e); } });
    return true;
  }).catch((e) => {
    inflight.delete(code);
    failedAt.set(code, Date.now());
    console.error(`[parcelStateTables] could not load the ${code} county parcel table — parcel sources for ${code} are unavailable until it loads`, e);
    if (reporter) { try { reporter(code, e); } catch (_e) { /* the reporter must never mask the failure */ } }
    throw e;
  });
  inflight.set(code, p);
  return p;
}
/* Fire-and-forget form for synchronous callers (a missed lookup). The rejection is already reported above; swallow it here so it is not also unhandled. */
export function kickParcelState(st) {
  if (!isLazyParcelState(st)) return;
  const code = String(st).toUpperCase();
  if (loaded.has(code)) return;
  const f = failedAt.get(code);
  if (f && Date.now() - f < KICK_BACKOFF_MS) return; // a sync caller must not re-fire a failing chunk fetch on every frame
  ensureParcelState(code).catch(() => {});
}

export const loadAllParcelStates = () => Promise.all(LAZY_PARCEL_STATES.map((s) => ensureParcelState(s)));
export const ensureParcelStatesForKeys = (keys) => Promise.all([...new Set((keys || []).map(lazyStateOfKey).filter(Boolean))].map((s) => ensureParcelState(s)));
export const ensureParcelStatesForPoint = (lat, lng) => ensureParcelState(siteState({ lat, lng }));

/* The lazy states a view reaches — a 5×5 sample of the view through the same real state boundaries `siteState` answers from (never a rectangle). */
export function lazyStatesForView(bounds) {
  const out = new Set();
  if (!bounds) return out;
  const N = 4;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const st = siteState({ lat: bounds.south + ((bounds.north - bounds.south) * i) / N, lng: bounds.west + ((bounds.east - bounds.west) * j) / N });
    if (isLazyParcelState(st)) out.add(st);
  }
  return out;
}
export const parcelTablesReadyForView = (bounds) => [...lazyStatesForView(bounds)].every((s) => loaded.has(s));
export const ensureParcelStatesForView = (bounds) => Promise.all([...lazyStatesForView(bounds)].map((s) => ensureParcelState(s)));

/* Test seam: forget what was loaded (used with vi.resetModules in test/parcelStateTables.test.js). */
export function _resetParcelStateTablesForTest() { loaded.clear(); inflight.clear(); failedAt.clear(); version = 0; }
