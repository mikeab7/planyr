/* NEW-2 (2026-10-28, B2387345 follow-on) — COUNTY FIRST, THE STATE'S LAYER WHEN THE COUNTY DOES NOT ANSWER.
 *
 * Owner, verbatim: "wire it to the county one, but then default it to the state one." A county's own server is the primary (the
 * freshest roll); when it errors or times out the click asks the next-best source for that ground instead of stopping at "couldn't
 * reach the county server". This module is the ONE answer to "what is the fallback for this failed county at this point?":
 *
 *   1. the state's statewide layer — but ONLY when that layer really holds the county (a statewide layer that declares the county
 *      in `excludedCounties` is never a fallback for it: New York's and Tennessee's county rows exist BECAUSE the state layer has no
 *      parcels there), and only when its URL differs from the failed county's own (Florida's 17 county rows are PARKED on the state
 *      layer, so the "county" and the "state" are the same dead URL — asking it twice buys nothing);
 *   2. then any town/city layer the county row declares for ground it covers (`COUNTY_EXTRA_FALLBACKS`), each with a measured cover box.
 *
 * Which counties gain a state fallback today (the list is pinned by test/parcelFallbacks.test.js): Texas (harris, fortbend, chambers,
 * montgomery, brazoria, galveston, liberty, austintx — waller IS the state layer) and Colorado (the county rows not parked on the
 * composite). Nobody else yet: FL parks every county row on the state layer; NY and TN county rows are the counties the state layer
 * lacks; every other state is statewide-only or county-only. Niagara County NY has no state polygon layer, so its fallback is the
 * Town of Cambria's layer for Cambria and, elsewhere, the honest "county server didn't answer" with Try again.
 *
 * Pure: no network, no React. The click flows (MapFinder, SitePlanner) feed `lib/identifyWithFallback.js` a `fallbacks` callback built
 * from `fallbackCandidates`; a hit comes back carrying `fallback: { kind, label, failed }` so the surface can SAY it came from the
 * fallback (never silently, per LOUD-FAILURE). */
import { COUNTIES, COUNTIES_MAP, statewideKeysForState, statewideExcludesCounty, countyIdentity, trimLayerUrl } from "./counties.js";

/* Town / city layers a county row falls back to for the ground they cover. `cover` is [south, west, north, east] (a box around the layer's
 * measured footprint — a point in the box but outside the town simply gets an empty answer, which is not a hit and costs one request).
 * Each is public, polygon, and carries the county's own column schema. Measured: docs/STATEWIDE-PARCELS.md "Niagara's fallbacks". */
export const COUNTY_EXTRA_FALLBACKS = {
  ny_niagara: [
    {
      key: "ny_niagara_cambria",
      label: "Town of Cambria’s layer",
      layerUrl: "https://services3.arcgis.com/BPQWtme4xLWlUYsj/arcgis/rest/services/Map/FeatureServer/0",
      cover: [43.12, -78.9, 43.23, -78.74],
    },
  ],
};

/* The phrase a notice uses for a state layer ("this lot came from the …"). TX keeps the wording that shipped with B244. */
const STATE_LAYER_PHRASE = {
  TX: "all-Texas TxGIO layer", CO: "Colorado state layer", NY: "New York state layer", TN: "Tennessee state layer", FL: "Florida state layer",
};
export const stateLayerPhrase = (state) => STATE_LAYER_PHRASE[state] || `${state || "state"} state layer`;

const inBox = (box, lat, lng) => lat >= box[0] && lat <= box[2] && lng >= box[1] && lng <= box[3];
/* The county's name as its own row spells it ("Niagara County", "Fort Bend", "Davidson County, TN (Nashville)" → "Davidson County"), or null —
 * the row's key is the truth about WHICH county failed, so it wins over whatever county the click's point resolves to (a point near a line
 * may resolve to the neighbour). */
const nameOfKey = (k) => {
  const l = COUNTIES[k] && COUNTIES[k].label;
  if (!l) return null;
  const n = String(l).split(" · ")[0].split(",")[0].replace(/\(.*?\)/g, "").replace(/^City\s*(&|and)\s*County of\s+/i, "").trim();
  return n || null;
};
/* "Fort Bend" → "Fort Bend County"; a name that already carries its designation is left alone. */
const countyPhrase = (k) => { const n = nameOfKey(k); return n ? (/\b(county|parish|borough)\b/i.test(n) ? n : `${n} County`) : null; };
const ownUrl = (k) => trimLayerUrl((COUNTIES_MAP[k] && (COUNTIES_MAP[k].layerUrl || COUNTIES_MAP[k].mapServer)) || "");

/* The statewide layers that can really stand in for `countyKey` (see the header). `countyName` (optional) is the polygon asset's
 * spelling of the county at the click, used only when the row has no readable name. Pure. */
export function stateLayerKeysFor(countyKey, countyName) {
  const c = COUNTIES_MAP[countyKey];
  if (!c || c.statewide || c.cityScoped) return [];
  const name = nameOfKey(countyKey) || countyName || null;
  const mine = ownUrl(countyKey);
  return statewideKeysForState(c.state).filter((sk) => {
    if (name && statewideExcludesCounty(sk, name)) return false; // the state layer declares it holds none of this county
    const u = ownUrl(sk);
    return !!u && u !== mine;                                  // parked on the composite: same URL, same outage
  });
}

/* Does state layer `stateKey` really stand in for the failed county `countyKey`? The OUTLINE drawing asks this too (a failed Niagara must not pull
 * New York's layer over ground that layer has no parcels for). Pure. */
export const stateLayerCoversCounty = (stateKey, countyKey) => stateLayerKeysFor(countyKey).includes(stateKey);

/* The fallback SPECS for a click at (lat, lng) whose `failed` sources (county keys) did not answer: state layer(s) first, then the
 * town/city extras that cover the point. No URLs yet (see `fallbackCandidates`). Order is the order they are asked. Pure. */
export function fallbackSpecsFor({ failed = [], lat, lng } = {}) {
  const real = [...new Set(failed)].filter((k) => COUNTIES_MAP[k] && !COUNTIES_MAP[k].statewide && !COUNTIES_MAP[k].cityScoped);
  if (!real.length || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const idName = countyIdentity(lat, lng).name || null;
  const out = [];
  const seen = new Set();
  const push = (spec) => { if (!seen.has(spec.key)) { seen.add(spec.key); out.push(spec); } };
  for (const k of real) {
    const st = COUNTIES_MAP[k].state;
    for (const sk of stateLayerKeysFor(k, idName)) push({ key: sk, asCounty: sk, kind: "state", label: stateLayerPhrase(st), failed: k, statewide: true });
  }
  for (const k of real) {
    for (const x of COUNTY_EXTRA_FALLBACKS[k] || []) {
      if (inBox(x.cover, lat, lng)) push({ key: x.key, asCounty: k, kind: "town", label: x.label, failed: k, statewide: false, directUrl: x.layerUrl });
    }
  }
  return out;
}

/* Specs → identify candidates ({county, url, statewide, …}). `urlFor(key)` resolves a registry key to its queryable layer URL (it may be async —
 * the planner resolves lazily); a spec with a `directUrl` skips it. A spec with no URL is dropped (nothing to ask), never guessed. The
 * candidate's `county` is the spec's own key — a fallback's answer must never be booked as the failed county answering (identifyWithFallback
 * keeps the failed county's silence for the "couldn't reach" verdict) — and `asCounty` is what a hit is relabelled to afterwards. */
export async function fallbackCandidates(specs, urlFor) {
  const urls = await Promise.all((specs || []).map((s) => (s.directUrl ? s.directUrl : Promise.resolve(urlFor ? urlFor(s.key) : null))));
  return (specs || []).map((s, i) => ({ county: s.key, url: urls[i], statewide: !!s.statewide, fallback: true, asCounty: s.asCounty, kind: s.kind, label: s.label, failedKey: s.failed })).filter((c) => c.url);
}

/* The words for a lot that came from a fallback. `failedKey` names the county whose server did not answer. Pure. */
export function fallbackNoticeText({ failedKey, label } = {}) {
  const who = countyPhrase(failedKey);
  return `${who ? `${who}’s` : "The county’s"} own parcel server didn’t answer, so this lot came from the ${label || "state layer"} — accurate for selecting the lot, but it may lag the county’s latest changes.`;
}

/* Every county that has a usable fallback today, as { county, state, fallbacks: [labels] } — the pinned list in the test and the doc. Pure. */
export function countiesWithFallback() {
  const out = [];
  for (const [k, c] of Object.entries(COUNTIES_MAP)) {
    if (c.statewide || c.cityScoped) continue;
    const labels = [
      ...stateLayerKeysFor(k).map(() => stateLayerPhrase(c.state)),
      ...(COUNTY_EXTRA_FALLBACKS[k] || []).map((x) => x.label),
    ];
    if (labels.length) out.push({ county: k, state: c.state, fallbacks: labels });
  }
  return out;
}
