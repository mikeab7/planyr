/* DeSoto County MS — WHO SERVES THIS SITE, by provider name (B2507057). The Mississippi Public Service Commission's certificated service areas for water, sewer,
 * gas and electric (CountyWebMap/County_Web_Map layers 71 / 72 / 70 / 69, republished by DeSoto County GIS) are four small polygon sets — 17 + 31 + 2 + 3 features,
 * about 30 KB generalised — so they are fetched ONCE, kept in memory, and a point is answered synchronously by point-in-polygon. A click anywhere in the county then
 * says "Water — City of Olive Branch · Sewer — City of Olive Branch · Gas — City of Olive Branch · Electric — Northcentral Mississippi EPA" without the person reading polygons.
 *
 * Texas has the same question answered by the PUC's CCN layers; Mississippi's PSC areas are the equivalent. Like a CCN, a certificated area is a FACT about who is
 * entitled to serve, not a will-serve letter — the card says so.
 *
 * Pure parts (`providersFrom`, `providerRows`) are unit-tested over a recorded fixture; only `ensureProviders` touches the network. A failed load is never cached
 * as "no providers", and a point whose layers have not loaded answers null (the card says "Loading…", never "none"). */
import { pointInGeometry, DESOTO_RELAY } from "./desotoJurisdiction.js";

const SVC = `${DESOTO_RELAY}/CountyWebMap/County_Web_Map/MapServer`;
/* [key, layer id, display name, the contact column the layer publishes] — the order is the order the card lists them. */
export const PROVIDER_LAYERS = [
  { key: "water", id: 71, label: "Water", contact: "PHONE" },
  { key: "sewer", id: 72, label: "Sewer", contact: null },
  { key: "gas", id: 70, label: "Gas", contact: "PHONE" },
  { key: "electric", id: 69, label: "Electric", contact: "CONTACT" },
];
export const providerUrl = (l) => `${SVC}/${l.id}/query?where=1%3D1&outFields=UTILITY_NA${l.contact ? "%2C" + l.contact : ""}&outSR=4326&maxAllowableOffset=0.0003&f=geojson`;

/* Tidy a provider name for a card: trim, collapse spaces, drop the ", Inc." tail the PSC adds, and put "City of X" in the order people say it. */
export function providerName(raw) {
  const t = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  if (!t) return null;
  const m = t.match(/^(.*?),\s*City of$/i);          // "Olive Branch, City of" (the gas layer) → "City of Olive Branch"
  return (m ? `City of ${m[1]}` : t).replace(/,\s*Inc\.?$/i, "");
}

/* { water: [{ name, contact }], sewer: [...], gas: [...], electric: [...] } for a point over the four collections; a service whose collection is missing is null (not loaded),
 * an empty array is a REAL "no certificated provider mapped here". Pure. */
export function providersFrom(collections, lat, lng) {
  if (!collections) return null;
  const out = {};
  for (const l of PROVIDER_LAYERS) {
    const fc = collections[l.key];
    if (!fc || !Array.isArray(fc.features)) { out[l.key] = null; continue; }
    const seen = new Set(), hits = [];
    for (const f of fc.features) {
      if (!pointInGeometry(f && f.geometry, lng, lat)) continue;
      const p = (f && f.properties) || {};
      const name = providerName(p.UTILITY_NA);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const c = l.contact && p[l.contact] != null ? String(p[l.contact]).trim() : "";
      hits.push({ name, contact: c || null });
    }
    out[l.key] = hits;
  }
  return out;
}

/* The click-card rows: one per service, provider names (a site straddling two areas lists both), the published phone when there is one. */
export function providerRows(result) {
  return PROVIDER_LAYERS.map((l) => {
    const hits = result ? result[l.key] : null;
    if (hits == null) return { label: l.label, text: "Loading…" };
    if (!hits.length) return { label: l.label, text: "No certificated provider mapped here" };
    return { label: l.label, text: hits.map((h) => (h.contact && hits.length === 1 ? `${h.name} · ${h.contact}` : h.name)).join("; ") };
  });
}

let CACHE = null;
let LOADING = null;
export const providersReady = () => !!CACHE;
export function _setProviders(c) { CACHE = c; LOADING = c ? Promise.resolve(c) : null; } // tests / harness seam

export function ensureProviders(fetchImpl = (typeof fetch === "function" ? fetch : null)) {
  if (CACHE) return Promise.resolve(CACHE);
  if (LOADING) return LOADING;
  if (!fetchImpl) return Promise.resolve(null);
  LOADING = (async () => {
    const got = {};
    for (const l of PROVIDER_LAYERS) {
      let fc = null;
      for (let attempt = 0; attempt < 2 && !fc; attempt++) {
        try {
          const r = await fetchImpl(providerUrl(l));
          const j = r && r.ok ? await r.json() : null;
          if (j && Array.isArray(j.features)) fc = j;
        } catch (_) { /* retried once below */ }
      }
      if (!fc) { // one service failing fails the whole load: a partial set must never read as "no electric provider"
        if (typeof console !== "undefined") console.error(`[desotoProviders] the ${l.label.toLowerCase()} service areas did not load — the provider card will say it cannot tell`);
        LOADING = null;
        return null;
      }
      got[l.key] = fc;
    }
    CACHE = got;
    return got;
  })();
  return LOADING;
}

/* Synchronous card answer at a point: the rows, "Loading…" while the sets load (and it starts them). */
export function providerCardAt(lat, lng) {
  if (!CACHE) { ensureProviders(); return providerRows(null); }
  return providerRows(providersFrom(CACHE, Number(lat), Number(lng)));
}
