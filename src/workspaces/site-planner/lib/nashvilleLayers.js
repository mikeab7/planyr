/* Metro Nashville & Davidson County — the regional GIS layer rows (NEW-1 / NEW-3, 2026-11-12).
 *
 * Every row here is a REGIONAL source: it declares `states: ["TN"]` and `regions: ["davidson"]` (serviceAreas.js: Davidson County from Planyr's bundled county polygons), so `layerAvailableHere` hides
 * the row — and the map's draw filter turns it off before any request — on a Memphis, Knoxville, Houston or Atlanta site. The registry spreads NASHVILLE_LAYERS into ALL_LAYERS (layers.js).
 *
 * ROWS: base Zoning (Metro's 6,027 polygons) · Zoning Overlays (Airport Impact, Urban Design, Historic …) · Downtown Code subdistricts · Planned Unit Developments · the NashvilleNext Community Character
 * Policy (a planning policy, not zoning — a context row). Every row reads its URL and fields from `GIS_SOURCES` (src/shared/gis/sourcesNashville.js), so the two cannot disagree.
 *
 * OWNER CONSTRAINTS honoured here: #41/#46 a result is labelled by the government that zones the SITE (a satellite city's land reads "Zoned by City of X — not Metro", never a Metro code) and a district
 * NAME is shown only where Title 17 sources it (nashvilleZoningNames.js; every other code shows bare); #50 the Zoning legend is headed by the jurisdiction with one code per row; #42 the layers start at
 * full opacity (layers.js normalises it); #43/#45 information on click only, clean plain-label cards.
 *
 * WHAT IS NOT HERE, on purpose: the satellite-city limits as a drawn layer (they only name the city a site is in — nashvilleJurisdiction.js); a link to the ordinance (Metro publishes ordinance numbers, not a
 * verified per-ordinance URL pattern, so the number is shown as written).
 *
 * PURE: no network at module load, no React — the style / card rules unit-test standalone (test/nashvilleLayers.test.js). */

import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import {
  zoningStyle, zoningCard, zoningLegend, legendItemsOf, zoneLabelText, ZONING_CITATION,
  overlayStyle, overlayCard, overlayLegend, dtcStyle, dtcCard, dtcLabelText, pudStyle, pudCard, ccmStyle, ccmCard, ccmLegend, ccmLabelText, DTC_COLOR, PUD_COLOR,
} from "./nashvilleZoning.js";
import { satelliteCityAt, ensureSatellites } from "./nashvilleJurisdiction.js";

export const NASHVILLE_RELAY = "/gis-proxy/maps.nashville.gov/arcgis/rest/services";
/* The row's URL: Metro's own ArcGIS Server goes through the relay (browser CORS is unmeasured, the build sandbox is refused); the org's ArcGIS Online is read directly. */
export function relayed(url) {
  const m = /^https:\/\/maps\.nashville\.gov\/arcgis\/rest\/services(\/.*)$/.exec(String(url || ""));
  return m ? NASHVILLE_RELAY + m[1] : url;
}
const srcOf = (k) => {
  const s = GIS_SOURCES[k];
  if (!s) throw new Error(`nashvilleLayers: no GIS_SOURCES row "${k}"`);
  return s;
};

const NASH = { states: ["TN"], regions: ["davidson"] };
const feature = (k, o) => {
  const s = srcOf(k);
  return { kind: "esriFeature", ...NASH, role: "area", group: "jurisdiction", hoverIdentify: true, canvasIdentify: true, ...o, url: relayed(s.serviceUrl), ...(s.where ? { where: s.where } : {}) };
};

export const NASHVILLE_LAYERS = {
  tn_nash_zoning: feature("nashZoning", {
    label: "Zoning", order: 30, minZoom: 12, source: "Metro Nashville & Davidson County — Planning Department (zoning districts)",
    fields: ["OBJECTID", "ZONE_DESC", "NAME", "ORDINANCE", "ORD_DATE", "CASE_NO"],
    /* 6,027 polygons: the first 2,000 alone are 92,652 vertices at full precision, the whole county ~280 k against the 300 k draw budget — so the layer is asked simplified (server-side, ~1.5 px) and every page of a view is followed. */
    simplifyFactor: 1.5, fetchAll: true,
    styleFn: zoningStyle, lineLabel: { field: "ZONE_DESC", minZoom: 14, format: zoneLabelText, declutter: true },
    viewLegend: (features) => zoningLegend(legendItemsOf(features)),
    warm: () => { ensureSatellites(); },
    identifyCard: (props, at) => zoningCard(props, at && Number.isFinite(at.lat) ? satelliteCityAt(at.lat, at.lng) : null),
    note: "Zoning districts across Davidson County (Metro Nashville). Colour = district family; the code prints at close zoom; the legend lists the districts in view. Click for the district, ordinance and adoption date.",
    infoCaveat: `Metro zoning only. Belle Meade, Berry Hill, Forest Hills, Goodlettsville, Oak Hill and Ridgetop zone themselves — Metro's layer reads "Satellite City" there and the card names the city. ${ZONING_CITATION} Confirm with Metro Planning.`,
  }),
  tn_nash_overlays: feature("nashOverlays", {
    label: "Zoning Overlays", order: 31, minZoom: 12, source: "Metro Nashville & Davidson County — Planning Department (overlay districts)",
    fields: ["OBJECTID", "ZONE_DESC", "NAME", "SUBDISTRICT", "IMPACT_ZONE", "ORDINANCE", "ORD_DATE", "CASE_NO"],
    simplifyFactor: 1.5, fetchAll: true,
    styleFn: overlayStyle, viewLegend: (features) => overlayLegend(features), identifyCard: overlayCard,
    note: "Overlay districts that add rules on top of the base zoning — Airport Impact, Urban Design, Historic Preservation, Neighborhood Conservation, I-440 Impact and the rest. Click for which one applies.",
    infoCaveat: "An overlay does not replace the base zoning: both apply. Airport Impact and I-440 Impact can limit height, noise and use — read the overlay's own standards.",
  }),
  tn_nash_dtc: feature("nashDtc", {
    label: "Downtown Code Subdistricts", order: 32, minZoom: 12, source: "Metro Nashville & Davidson County — Planning Department (Downtown Code)",
    fields: ["OBJECTID_1", "Subdistrict", "UseArea"],
    color: DTC_COLOR, styleFn: dtcStyle, lineLabel: { field: "Subdistrict", minZoom: 14, format: dtcLabelText, declutter: true }, identifyCard: dtcCard,
    note: "The Downtown Code's subdistricts and use areas — the zoning-code framework for the urban core, where the base zone reads DTC.",
    infoCaveat: "A subdistrict sets the Downtown Code's building form and use rules; the standards live in the Downtown Code itself.",
  }),
  tn_nash_pud: feature("nashPud", {
    label: "Planned Unit Developments", order: 33, minZoom: 12, source: "Metro Nashville & Davidson County — Planning Department (planned unit developments)",
    fields: ["OBJECTID", "ZONE_DESC", "CASE_NO", "ORDINANCE", "ORD_DATE"],
    color: PUD_COLOR, simplifyFactor: 1.5, fetchAll: true, styleFn: pudStyle, identifyCard: pudCard,
    note: "Planned unit developments — land governed by its own adopted plan. Click for the PUD type, case and ordinance.",
    infoCaveat: "A PUD's adopted plan, not the underlying base zone, sets what can be built; the case file holds the plan.",
  }),
  tn_nash_ccm: feature("nashCcm", {
    label: "Community Character Policy (NashvilleNext)", order: 40, minZoom: 13, source: "Metro Nashville & Davidson County — Planning Department (NashvilleNext Community Character Manual)",
    fields: ["OBJECTID", "PolicyCode", "PolicyDesc", "Transect", "DateAdopted"],
    simplifyFactor: 1.5, fetchAll: true,
    styleFn: ccmStyle, lineLabel: { field: "PolicyCode", minZoom: 15, format: ccmLabelText, declutter: true }, viewLegend: (features) => ccmLegend(features), identifyCard: ccmCard,
    note: "NashvilleNext's community character policy for each area — the planning guidance Metro weighs in a rezoning. Click for the policy.",
    infoCaveat: "A planning policy, not zoning: it says what Metro wants the area to become, which shapes whether a rezoning is supported.",
  }),
};

/* Vintage lines for the (i) popover — the dates the publisher's own layers report (2026-11-12). */
export const NASHVILLE_VINTAGE = {
  tn_nash_zoning: "Metro Nashville zoning layer — last edited 2026-11-12; the oldest ordinances in it date from the 1970s",
  tn_nash_overlays: "Metro Nashville overlay districts — last edited 2026-11-12",
  tn_nash_dtc: "Metro Nashville Downtown Code subdistricts — last edited 2026-11-11",
  tn_nash_pud: "Metro Nashville planned unit developments — last edited 2026-11-12",
  tn_nash_ccm: "NashvilleNext Community Character Manual policy — adoption dates are on each policy (the card)",
};
