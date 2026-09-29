/* parcelIdentity — the ONE answer to "which county lot is this?" (B1964512, NEW-1).
 *
 * Both parcel-adding surfaces (the planner's identify-and-add and the Map view's Select-parcels
 * tool) key a lot so a re-click toggles it and the same lot is never added twice. That key used
 * to be `attrs.OBJECTID ?? attrs.objectid ?? attrs.OID`, else the ring's FIRST VERTEX. Joined CAD
 * layers (Chambers: `ChambersCADWeb.DBO.TaxParcels.OBJECTID`) publish only table-PREFIXED field
 * names, so every lot fell to the first-vertex key — and neighbouring strip lots share corners,
 * so clicking lot B resolved to lot A (toggled A off, or selected A instead of adding B).
 *
 * Rules: (1) an id is an exact OBJECTID/objectid/OID, else a key ENDING in `.OBJECTID`, preferring
 * the geometry table's (`…TaxParcels.OBJECTID`) over a joined accounts table, since one shape can
 * carry several accounts; (2) with no id, the key is a HASH OF THE FULL NORMALISED RING SET — never
 * one vertex; (3) a stored parcel is compared by a key RECOMPUTED from its stored attrs, not its
 * stored `gisKey` string, so plans saved under the old `geo:` key are still recognised.
 * Pure — no DOM, no React. */

const EXACT_ID_KEYS = ["OBJECTID", "objectid", "OID"];

/** The lot's stable id from a feature's attributes, or null. */
export function parcelIdOf(attrs) {
  if (!attrs || typeof attrs !== "object") return null;
  for (const k of EXACT_ID_KEYS) if (attrs[k] != null && attrs[k] !== "") return attrs[k];
  const tails = Object.keys(attrs)
    .filter((k) => /\.objectid$/i.test(k) && attrs[k] != null && attrs[k] !== "")
    .sort();
  if (!tails.length) return null;
  // The geometry table (…TaxParcels…) identifies the SHAPE; an accounts/owners join can repeat.
  const geom = tails.find((k) => /parcel/i.test(k));
  return attrs[geom || tails[0]];
}

// cyrb53 — small, well-distributed 53-bit string hash (no crypto needed; this is identity, not security).
function hash53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// One ring → canonical string: 6-dp vertices, closing duplicate dropped, start at the smallest
// vertex, direction fixed — so the same shape hashes the same however the server wound it.
function canonRing(ring) {
  let pts = (ring || []).map((p) => [Number(p[0]).toFixed(6), Number(p[1]).toFixed(6)]);
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) pts = pts.slice(0, -1);
  }
  if (!pts.length) return "";
  const str = (arr) => arr.map((p) => p.join(",")).join(";");
  const variants = [];
  for (const dir of [pts, [...pts].reverse()]) {
    let best = 0;
    for (let i = 1; i < dir.length; i++) {
      const c = dir[i], m = dir[best];
      if (c[0] < m[0] || (c[0] === m[0] && c[1] < m[1])) best = i;
    }
    variants.push(str([...dir.slice(best), ...dir.slice(0, best)]));
  }
  return variants.sort()[0];
}

/** Collision-proof shape key: hash of every part of the lot. */
export function ringsHash(rings) {
  const parts = (rings || []).map(canonRing).filter(Boolean).sort();
  return parts.length ? hash53(parts.join("|")) : null;
}

/** The lot key. `namespace` (e.g. the county) is prefixed as MapFinder does; the planner passes none
 *  so stored `oid:<id>` keys keep their existing shape. `fallback` supplies a last-resort unique key. */
export function parcelKey(attrs, rings, { namespace, fallback } = {}) {
  const id = parcelIdOf(attrs);
  const h = id == null ? ringsHash(rings) : null;
  const core = id != null ? `oid:${id}` : h != null ? `geo:${h}` : (fallback ? fallback() : null);
  if (core == null) return null;
  return namespace ? `${namespace}:${core}` : core;
}

/** Key for an already-stored planner parcel, recomputed from its attrs so a legacy `geo:` gisKey
 *  (first-vertex era) still matches by id. A parcel with no id in its attrs keeps its stored key. */
export function storedParcelKey(pc) {
  const id = parcelIdOf(pc?.attrs);
  return id != null ? `oid:${id}` : (pc?.gisKey ?? null);
}
