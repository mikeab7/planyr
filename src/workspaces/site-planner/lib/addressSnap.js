/* Snap a geocoded address that landed in the road to the lot it belongs to (NEW-1, TN non-state counties, 2026-10-21).
 *
 * A geocoder places "20 Culvert St" on the street centreline; the county's parcel layer has no lot there ("No parcel at this point — may sit on a
 * road or right-of-way"). Where the county's own layer carries a situs address, the lot the address names is a more honest answer than a dead end.
 * The snap is deliberately NARROW — a wrong lot selected silently is worse than the card:
 *   · the house number must equal the lot's situs house number, and the street's first word (after any N/S/E/W) must equal the lot's;
 *   · the lot must lie within `maxMeters` of the geocoded point (a snap, never a teleport);
 *   · more than one lot matching both is ambiguous → no snap (the card says no parcel, as before).
 * Pure: `addrOf(feature)` reads the situs and `centreOf(feature)` the lot's { lat, lng }, both injected. */

const DIRS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "NORTH", "SOUTH", "EAST", "WEST"]);
const clean = (s) => String(s == null ? "" : s).toUpperCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();

/** { house, street } from a geocoder label or a situs line ("20 Culvert St, Nashville, Tennessee" → { house:"20", street:"CULVERT" }), or null. */
export function houseAndStreet(text) {
  const first = clean(String(text || "").split(",")[0]);
  const toks = first.split(" ").filter(Boolean);
  if (toks.length < 2 || !/^\d+[A-Z]?$/.test(toks[0])) return null;
  const rest = toks.slice(1);
  const street = rest.find((t, i) => !(i === 0 && DIRS.has(t) && rest.length > 1));
  return street ? { house: toks[0], street } : null;
}

const metres = (a, b) => {
  const dLat = (a.lat - b.lat) * 111320;
  const dLng = (a.lng - b.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(dLat, dLng);
};

/** The one lot a label's address names near `point`, or null. */
export function pickAddressSnap(feats, label, point, { addrOf, centreOf, maxMeters = 300 }) {
  const want = houseAndStreet(label);
  if (!want || !point) return null;
  const hits = (feats || []).filter((f) => {
    const got = houseAndStreet(addrOf(f));
    if (!got || got.house !== want.house || got.street !== want.street) return false;
    const c = centreOf(f);
    return c && metres(c, point) <= maxMeters;
  });
  return hits.length === 1 ? hits[0] : null;
}
