/* NEW-1 (New York, 2026-10-20) — New York county parcel sources beyond the statewide public layer (ny_statewide in counties.js).
 * The statewide layer holds 38 of 62 counties (the five NYC boroughs among them); NY_UNCOVERED is the other 24, MEASURED from its Footprint
 * layer and a per-county count. A county here with no row says so by name ("<County> — no parcel data wired here yet."); docs/STATEWIDE-PARCELS.md
 * "New York counties (2026-10-20)" has the per-county table and what was searched.
 * Row: [slug, county name, layer, idField, addrField, scopeWhere, owner column?, centre lat, lng, padded bbox, displayMinZoom?]. */
export const NY_UNCOVERED = ["Allegany", "Cattaraugus", "Chemung", "Chenango", "Clinton", "Columbia", "Delaware", "Dutchess", "Essex", "Franklin", "Fulton", "Herkimer", "Jefferson", "Madison", "Monroe", "Nassau", "Niagara", "Orleans", "Saratoga", "Schenectady", "Schoharie", "Seneca", "Washington", "Yates"];
export const NY_ROWS = [];
export const nyRaw = () => Object.fromEntries(NY_ROWS.map(([k, n, url, id, addr, scope, ow, la, ln, bb, floor]) => ["ny_" + k, {
  state: "NY", label: n + " County, NY", layerUrl: url, idField: id, pinIdField: true, ...(addr ? { addrField: addr, pinAddrField: true } : {}), ...(scope ? { scopeWhere: scope } : {}), ...(floor ? { displayMinZoom: floor } : {}),
  help: n + " County parcels (county GIS). Search by parcel number" + (addr ? " or a site address." : "."),
}]));
export const nyMap = () => Object.fromEntries(NY_ROWS.map(([k, n, url, id, addr, scope, ow, la, ln, bb, floor]) => ["ny_" + k, {
  state: "NY", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url, ...(scope ? { scopeWhere: scope } : {}), ...(floor ? { displayMinZoom: floor } : {}),
}]));
