/* NEW-1 (Meriwether GA, 2026-11-24) — a typed PARCEL NUMBER finds its lot in the county the MAP IS LOOKING AT, for every county that declares an `idField`.
 *
 * Until now the only parcel-number path in the app was Tennessee's (`parcelIdSearch.js`): the Map's top search read "023 012" as a Tennessee id, offered no Georgia
 * choice and reported "Tennessee parcel server is slow", and the Land › Add parcels box only took addresses. The ONE id/address query (`lookupParcels`, with the
 * padded-id rule in `parcelQuery.idLikePattern`) already finds the lot; this module is the missing front door, shared by BOTH surfaces:
 *   · `looksLikeParcelNumber(text)` — is this typed text a parcel number rather than an address or a place? (Pure.)
 *   · `viewIdCounties(lat, lng)`     — the wired counties under the view that can answer an id search (statewide stand-ins and Tennessee's own normalised ids are not asked here).
 *   · `resolveViewParcelId(text, { lat, lng })` — { status: "none" | "found" | "notfound" | "unavailable", … }; a server that did not answer is `unavailable`, never "not found" (LOUD-FAILURE).
 * `point` is inside the lot (pole of inaccessibility), so the caller's identify-at-a-point selection lands on this lot and no neighbour. */
import { COUNTIES, candidateCountiesForPoint } from "./counties.js";
import { lookupParcels, idAttrFor } from "./parcelQuery.js";
import { pickIdMatch } from "./tnParcelId.js";
import { interiorPointOf } from "./parcelIdSearch.js";
import { looksLikeParcelNumber } from "./parcelNumberShape.js";
export { looksLikeParcelNumber };

/** Wired county rows under this view that can answer an id search (own layer, an id column, no Tennessee id-normaliser — those go through `parcelIdSearch`). */
export function viewIdCounties(lat, lng) {
  let keys = [];
  try { keys = candidateCountiesForPoint(lat, lng) || []; } catch (_) { keys = []; }
  return keys.filter((k) => { const c = COUNTIES[k]; return c && c.layerUrl && c.idField && !c.statewide && !c.idNormalizer && !c.cityScoped; });
}

export async function resolveViewParcelId(text, { lat, lng, lookup = lookupParcels, timeoutMs = 15000 } = {}) {
  if (!looksLikeParcelNumber(text) || !Number.isFinite(lat) || !Number.isFinite(lng)) return { status: "none" };
  const keys = viewIdCounties(lat, lng).slice(0, 3);
  if (!keys.length) return { status: "none" };
  const typed = String(text).trim();
  const settled = await Promise.allSettled(keys.map((county) => lookup({ county, lookupUrl: COUNTIES[county].layerUrl, mode: "id", value: typed, timeoutMs })));
  const failed = [], hits = [];
  settled.forEach((r, i) => {
    const county = keys[i];
    if (r.status === "rejected") { failed.push(county); return; }
    const feats = (r.value && r.value.feats) || [];
    const pick = pickIdMatch(feats, typed, (f) => idAttrFor(county, f.attributes || {}));
    const feature = pick || feats[0];
    if (feature) hits.push({ county, feature, ambiguous: !pick && feats.length > 1 });
  });
  const names = keys.map((k) => (COUNTIES[k].label || k).replace(/,\s*[A-Z]{2}$/, ""));
  if (!hits.length) return { status: failed.length ? "unavailable" : "notfound", tried: names, ...(failed.length ? { failed: failed.map((k) => (COUNTIES[k].label || k).replace(/,\s*[A-Z]{2}$/, "")) } : {}) };
  for (const h of hits) {
    const point = interiorPointOf(h.feature);
    if (!point) continue;
    const id = idAttrFor(h.county, h.feature.attributes || {}) || typed;
    return { status: "found", county: h.county, feature: h.feature, point, ambiguous: h.ambiguous, label: `Parcel ${String(id).replace(/\s+/g, " ").trim()} · ${COUNTIES[h.county].label || h.county}` };
  }
  return { status: "notfound", tried: names, reason: "no-geometry" };
}

/** The owner-facing sentence for a non-found outcome (plain words, names where it looked). */
export function viewParcelIdMessage(res, typed) {
  const t = String(typed || "").trim();
  const where = (res.tried || []).join(" and ") || "this county";
  if (res.status === "unavailable") return `The ${(res.failed || res.tried || []).join(" / ")} parcel server didn't answer, so parcel number "${t}" could not be checked. Try again.`;
  return `No parcel numbered "${t}" in ${where}. Check the number, or type the site address instead.`;
}
