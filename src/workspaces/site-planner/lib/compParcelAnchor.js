/* compParcelAnchor.js — B941152: the pure "which parcels become this comp's anchor" derivation,
 * split out of MapFinder.jsx (which imports Leaflet and so cannot be unit-tested directly) so the
 * multi-parcel fix is provable without a browser or a live county GIS parcel-identify call.
 *
 * Before this, `placeCompOnSelectedParcel` read ONLY `selected[selected.length - 1]` — a
 * two-plus-parcel selection silently dropped every parcel but the last (no `parcelApn`/
 * `parcelGeom` of its own), and the one button that called it was gated to
 * `selected.length === 1` and simply did not render for a bigger selection. Michael's "I selected
 * parcels and press enter but nothing happens" on a 2-parcel, 66.17 AC selection.
 *
 * `selected` is MapFinder's own parcel-selection state — one entry per resolved parcel, shape
 * `{key, rings, latlngsList, addr, acct, attrs, county}` (see MapFinder.jsx's `selected` state
 * comment; `rings` is every outer part, multipart-safe). `asm` is `computeAssembly(selected, …)`'s
 * result — reused as-is (`asm.origin`, `asm.totalAc`), never re-derived.
 */

/** GeoJSON geometry for every selected parcel's ring(s): `Polygon` for one parcel (byte-identical
 * to the pre-B941152 single-parcel shape), `MultiPolygon` for several. Null if none carry rings. */
export function parcelGeomFromSelection(selected) {
  const polys = (selected || []).filter((s) => s?.rings?.length).map((s) => s.rings);
  if (!polys.length) return null;
  return polys.length === 1
    ? { type: "Polygon", coordinates: polys[0] }
    : { type: "MultiPolygon", coordinates: polys };
}

/** Every selected parcel's account id, joined — never just the last one. Null if none have one. */
export function parcelApnFromSelection(selected) {
  const apns = (selected || []).map((s) => s?.acct).filter(Boolean);
  return apns.length ? apns.join(", ") : null;
}

/** The county to anchor with: the last-selected parcel's county, falling back to the first
 * selected parcel that has one — the same fallback `planSelected` already uses for Site mode. */
export function parcelCountyFromSelection(selected) {
  const sel = selected || [];
  const last = sel[sel.length - 1];
  return last?.county || sel.find((s) => s?.county)?.county || null;
}

/** The full comp anchor payload for a real-parcel selection of any size. `asm` must be
 * `computeAssembly(selected, …)`'s result (or null, matching a caller that hasn't computed it). */
export function compAnchorFromSelection(selected, asm) {
  if (!asm || !selected?.length) return null;
  return {
    kind: "parcel",
    lat: asm.origin.lat,
    lon: asm.origin.lon,
    county: parcelCountyFromSelection(selected),
    parcelApn: parcelApnFromSelection(selected),
    parcelGeom: parcelGeomFromSelection(selected),
    acreageAc: asm.totalAc,
  };
}
