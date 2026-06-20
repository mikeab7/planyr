/* County appraisal-district attribute view — shared, pure helpers that turn the
 * raw county GIS attributes (the ones that ride along with a map-identified parcel)
 * into curated, human-labelled rows. Used by BOTH the planner's "Appraisal data"
 * panel (SitePlanner.jsx) and the map finder's address-search parcel info card
 * (MapFinder.jsx), so the two never diverge (B233). No React here — just data.
 */

// Curated field order: regex that matches a county's column name → the label we show.
// Patterns cover both the per-county CAD columns AND the statewide TxGIO columns
// (prop_id, owner_name, situs_addr, legal_area/gis_area, land_value, imp_value,
// mkt_value, stat_land_use, year_built) so a parcel answered by the statewide backup
// surfaces the same curated rows as one from its home county (B239).
export const APPR_FIELDS = [
  [/^(owner|own_?name|owner_?name|name|owner1)$/i, "Owner"],
  [/(situs|site_?addr|prop_?addr|loc_?addr|full_?addr|^addr|address)/i, "Situs address"],
  [/(hcad_?num|^acct|account|parcel_?id|prop_?id|geo_?id|quick_?ref|^pid)/i, "Account / ID"],
  [/(gis_?acre|calc_?acre|legal_?acre|^acre|acreage|deed_?acre|legal_?area|gis_?area)/i, "Acreage"],
  [/(land_?val|land_?mkt|land_?value)/i, "Land value"],
  [/(imp_?val|improvement_?val|bld_?val|impr_?val)/i, "Improvement value"],
  [/(tot_?val|market_?val|appr_?val|assessed_?val|total_?val|tot_?mkt|mkt_?val|mkt_?value)/i, "Total value"],
  [/(land_?use|state_?use|use_?cd|use_?desc|^class|prop_?type|stat_?land_?use)/i, "Land use"],
  [/zoning/i, "Zoning"],
  [/(year_?built|yr_?built)/i, "Year built"],
  [/(legal_?desc|^legal|subdiv|abstract|^abst)/i, "Legal"],
];

export const prettyKey = (k) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// The curated subset (only the recognized fields, in APPR_FIELDS order).
export const apprRows = (attrs) => {
  if (!attrs) return [];
  const used = new Set(), rows = [];
  for (const [re, label] of APPR_FIELDS) {
    const k = Object.keys(attrs).find((key) => !used.has(key) && re.test(key) && attrs[key] != null && attrs[key] !== "");
    if (k) { used.add(k); rows.push({ label, value: attrs[k] }); }
  }
  return rows;
};

// Everything the county returned (minus geometry/system fields) — the "all fields" expander.
export const apprAll = (attrs) => Object.entries(attrs || {})
  .filter(([k, v]) => v != null && v !== "" && !/^(shape|objectid|globalid|geometry|st_area|st_length|shape_?area|shape_?len)/i.test(k))
  .map(([k, v]) => ({ label: prettyKey(k), value: v }));

// Format a value, adding $ + thousands for the money fields.
export const apprVal = (label, v) => (/value/i.test(label) && v !== "" && !isNaN(+v)) ? `$${(+v).toLocaleString()}` : String(v);

// First attribute whose key matches `re` and has a non-empty value, as a string.
export const findAttr = (attrs, re) => { const k = Object.keys(attrs || {}).find((key) => re.test(key) && attrs[key] != null && attrs[key] !== ""); return k ? String(attrs[k]) : null; };
