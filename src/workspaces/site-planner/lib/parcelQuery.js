/* Shared parcel ID/address lookup (B239/B240).
 *
 * `buildParcelWhere` is the ONE place a parcel-search SQL where-clause is built, so a
 * county's own CAD query and the statewide-backup (TxGIO) query are constructed
 * identically — same field-name validation, same county scoping. `lookupParcels`
 * orchestrates the primary → statewide fallback: when a county's own server is
 * UNAVAILABLE (timeout / HTTP / ArcGIS error — a typed ParcelFetchError), it retries
 * the all-Texas TxGIO layer scoped to that one county, so a search still answers and
 * can't leak into a neighbouring county.
 */
import { resolveLayerUrl, getLayerInfo, queryFeatures } from "./arcgis.js";
import { COUNTIES, detectField, statewideFallbackFor, STATEWIDE_PARCEL_LAYER } from "./counties.js";
import { recordSourceResult } from "./sourceHealth.js";

// A field name gets interpolated into the where-clause and may come from a live (or a
// user-pasted) layer's metadata, so it must be a plain identifier — reject anything
// else so a hostile/compromised endpoint can't inject SQL that escapes the county
// scope (B47).
export const okField = (f) => /^[A-Za-z0-9_.]+$/.test(f || "");

/* Build the where-clause for one search. `meta` is the layer's live field metadata
 * (used to pick equality-vs-LIKE for a numeric id field and to confirm the scope
 * field exists). Throws a plain Error for a config problem (missing/odd field name) —
 * distinct from a ParcelFetchError, so a caller can tell "bad query" from "server
 * down". */
export function buildParcelWhere({ meta, mode, value, idField, addrField, scopeWhere }) {
  if (idField && !okField(idField)) throw new Error("Unexpected parcel-ID field name on this layer.");
  if (addrField && !okField(addrField)) throw new Error("Unexpected address field name on this layer.");
  const v = String(value ?? "").trim();
  const esc = v.replace(/'/g, "''");
  const fields = meta?.fields || [];
  let where;
  if (mode === "id") {
    if (!idField) throw new Error("No account/parcel-id field on this layer — try an address search.");
    const fld = fields.find((f) => f.name === idField);
    const numeric = fld && /integer|double|single|oid|smallinteger/i.test(fld.type);
    where = numeric && /^\d+$/.test(v) ? `${idField} = ${v}` : `UPPER(${idField}) LIKE UPPER('%${esc}%')`;
  } else {
    if (!addrField) throw new Error("No address field on this layer — try an account/ID search.");
    where = `UPPER(${addrField}) LIKE UPPER('%${esc}%')`;
  }
  // Statewide layers (TxGIO covers all 254 counties) need a county scope or an
  // ID/address search could match a like-named/numbered parcel in another county.
  // Apply it only when the scope's field actually exists on this layer, so a
  // single-county override URL pasted in the box is left untouched (self-healing).
  if (scopeWhere) {
    const scopeField = scopeWhere.split("=")[0].replace(/[()]/g, "").trim().toLowerCase();
    if (fields.some((f) => (f.name || "").toLowerCase() === scopeField))
      where = `(${scopeWhere}) AND (${where})`;
  }
  return where;
}

// Run one ID/address query against a single layer; returns the matched features plus
// the resolved layer + detected field names (so the caller can import a result).
async function queryOneLayer(rawUrl, { mode, value, idHint, addrHint, scopeWhere }) {
  const layerUrl = await resolveLayerUrl(rawUrl);
  const meta = await getLayerInfo(layerUrl);
  const idField = detectField(meta.fields, "id") || idHint;
  const addrField = detectField(meta.fields, "address") || addrHint;
  const where = buildParcelWhere({ meta, mode, value, idField, addrField, scopeWhere });
  const feats = await queryFeatures(layerUrl, { where, count: 10, outSR: 4326 }); // lon/lat → importFeature projects via the shared 365223 model (B57c)
  return { feats, layerUrl, idField, addrField };
}

/* Look up parcels for a county, with automatic statewide fallback. Tries the primary
 * (the configured CAD, or a user-pasted override URL); on a genuine source outage
 * (ParcelFetchError) for a county that hasn't been overridden, retries the statewide
 * TxGIO layer scoped to that county. Records the primary's circuit-breaker health.
 * Returns { feats, layerUrl, idField, addrField, backup, backupCounty }. A config
 * error (no id field, bad field name) is rethrown as-is — it isn't an outage. */
export async function lookupParcels({ county, lookupUrl, mode, value }) {
  try {
    const r = await queryOneLayer(lookupUrl, {
      mode, value,
      idHint: COUNTIES[county]?.idField,
      addrHint: COUNTIES[county]?.addrField,
      scopeWhere: COUNTIES[county]?.scopeWhere,
    });
    recordSourceResult(county, true);
    return { ...r, backup: false, backupCounty: null };
  } catch (err) {
    if (!(err && err.unavailable)) throw err; // a real config/validation error — not an outage
    recordSourceResult(county, false);
    // Only auto-fall-back when the user is on the county's default source (don't
    // override a hand-pasted URL) and a statewide stand-in exists for this county.
    const isDefaultUrl = isDefaultLookupUrl(county, lookupUrl);
    const fb = isDefaultUrl ? statewideFallbackFor(county) : null;
    if (!fb) throw err;
    const r = await queryOneLayer(fb.layerUrl, {
      mode, value, idHint: fb.idField, addrHint: fb.addrField, scopeWhere: fb.scopeWhere,
    });
    return { ...r, backup: true, backupCounty: fb.countyName };
  }
}

// Is the lookup URL still the county's configured default (not a user override)?
export function isDefaultLookupUrl(county, lookupUrl) {
  const c = COUNTIES[county];
  if (!c) return false;
  const def = (c.layerUrl || c.serviceUrl || "").replace(/\/+$/, "");
  const cur = String(lookupUrl || "").trim().replace(/\/+$/, "");
  return cur === def || cur === STATEWIDE_PARCEL_LAYER.replace(/\/+$/, "");
}
