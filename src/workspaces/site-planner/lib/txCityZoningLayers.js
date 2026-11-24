/* Texas CITY zoning layer rows (NEW-1 / NEW-2, 2026-11-12) — Richmond, Fulshear (two layers), Stafford, Webster (two layers: base districts and planned developments) and Katy (zoning, future land use, thoroughfare plan). The registry spreads TX_CITY_ZONING_LAYERS into ALL_LAYERS exactly as
 * Sugar Land's rows are (sugarLandLayers.js is the shape; sugarLandZoning.js the pure half this follows via txCityZoning.js).
 *
 * Every row is a REGIONAL source: it declares `states: ["TX"]` and `regions: ["<city>"]` (serviceAreas.js: that city's LIMITS from TxGIO Texas_City_Boundaries, built by
 * scripts/build-service-areas.mjs), so `layerAvailableHere` hides the row — and the map's draw filter turns it off before any request — on a Harris-outside-the-city, Dallas or Georgia site.
 * Zoning applies inside a city's limits only (a Texas city's ETJ is not zoned), so no ETJ is added. Unincorporated Fort Bend County keeps the "Texas counties have no zoning" sentence.
 *
 * The URLs and `where` clauses come from the registry rows (src/shared/gis/sourcesTxCityZoning.js), so the layer and the weekly drift verifier cannot disagree.
 *
 * KATY (2026-11-24) is a Planning_Map service with three layers and a different region: Katy's LIMITS ∪ ETJ (`katy`, from the city's own layers 7 and 8) — the city's FUTURE LAND USE and thoroughfare plan cover its ETJ too.
 *
 * NOT HERE, each measured 2026-11-12: Rosenberg (maps.rosenbergtx.gov publishes no zoning layer), Missouri City (gis.missouricitytx.gov refuses non-browser clients — a
 * browser probe is still owed).
 *
 * PURE: no network, no React — unit-tested in test/txCityZoningLayers.test.js. */

import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import { RICHMOND, FULSHEAR, FULSHEAR_NEWER, STAFFORD, WEBSTER, WEBSTER_PD, KATY, KATY_FLU, KATY_FLU_WHERE, KATY_TP, KATY_TP_WHERE } from "./txCityZoning.js";

const srcOf = (k) => {
  const s = GIS_SOURCES[k];
  if (!s) throw new Error(`txCityZoningLayers: no GIS_SOURCES row "${k}"`);
  return s;
};

/* A relay row's URL: the city's own server sends no CORS header, so it is read through the same-origin /gis-proxy relay (the host is on its ALLOWED_HOSTS); the public ArcGIS Online orgs are read directly. */
export const relayedUrl = (url) => {
  const m = /^https:\/\/([^/]+)(\/.*)$/.exec(String(url || ""));
  return m ? `/gis-proxy/${m[1]}${m[2]}` : url;
};
const feature = (sourceKey, region, o) => {
  const s = srcOf(sourceKey);
  return { kind: "esriFeature", states: ["TX"], regions: [region], hoverIdentify: true, canvasIdentify: true, ...o, url: s.relay ? relayedUrl(s.serviceUrl) : s.serviceUrl, ...(s.where ? { where: s.where } : {}) };
};

/* The row fields every city shares: an AREA layer in the Jurisdictions group, labelled by its codes at close zoom, legend headed by the city. */
const zoningRow = (sourceKey, region, city, z, o) => feature(sourceKey, region, {
  role: "area", group: "jurisdiction", minZoom: 12,
  styleFn: z.style, lineLabel: { field: z.labelField, minZoom: 14, format: z.labelText }, identifyCard: z.card,
  viewLegend: (features) => z.legend(z.legendItemsOf(features)),
  infoCaveat: `Zoning of land inside the City of ${city}'s limits only — a Texas city's ETJ is not zoned. ${z.citation} Confirm with the city's Planning department.`,
  ...o,
});

/* Katy's two non-zoning rows. Both are gated to the `katy` region (limits ∪ ETJ), click-only (#43), 100% opacity (#42). */
const katyFlu = () => zoningRow("katyFutureLandUse", "katy", "Katy", KATY_FLU, {
  label: "Katy Future Land Use", order: 47, source: "City of Katy — Future Land Use", minZoom: 14,
  fields: ["OBJECTID", "FLU", "Jurisdiction"], where: KATY_FLU_WHERE,
  infoCaveat: "The City of Katy's planned land use for each parcel, inside the city and its ETJ. A plan that guides rezoning, not zoning itself. Confirm with the city's Planning department.",
  note: "Planned land use across the City of Katy and its ETJ, coloured by the city's own legend. The legend lists the uses in view. Click a parcel for its planned use.",
});
const katyThoroughfare = () => feature("katyThoroughfare", "katy", {
  role: "line", group: "access", order: 32, minZoom: 12, label: "Katy Thoroughfare Plan", source: "City of Katy — Thoroughfare Plan",
  fields: ["OBJECTID", "ThoroClass", "FullStreet", "StreetName"], where: KATY_TP_WHERE,
  styleFn: KATY_TP.style, viewLegend: (features) => KATY_TP.legend(KATY_TP.legendItemsOf(features)), identifyCard: KATY_TP.card,
  note: "The City of Katy's thoroughfare plan: the freeway, major and collector streets, with the streets it proposes (dashed). Click a street for its name and class.",
  infoCaveat: `${KATY_TP.citation} Confirm with the city's Planning department.`,
});

export const TX_CITY_ZONING_LAYERS = {
  richmond_zoning: zoningRow("richmondZoning", "richmond", "Richmond", RICHMOND, {
    label: "Richmond Zoning", order: 40, source: "City of Richmond — Zoning Districts",
    fields: ["OBJECTID", "Zone", "ZOrdinance", "ZoneChange", "ZoneDate", "ZoneDesc", "ECP_Zone", "ECP_Zone_Description", "District_Purpose", "Land_Use_Allowance", "Density_Lot_and_Scale_Standar_1", "Parking_Requirements"],
    note: "Zoning districts within the City of Richmond. Colour = district family; the code prints at close zoom; the legend lists the districts in view with the city's own names. Click for the district, its ordinance and last change, and links into the city's online code.",
  }),
  fulshear_zoning: zoningRow("fulshearZoning", "fulshear", "Fulshear", FULSHEAR, {
    label: "Fulshear Zoning", order: 41, source: "City of Fulshear — Zoning (earlier map)",
    fields: ["FID", "Zone_Distr", "OrdNo", "Zone_Prev", "Zone_Rev", "Effect_Dat", "Comments"],
    note: "Zoning districts within the City of Fulshear, from the city's earlier zoning layer. Colour = district family; the code prints at close zoom. The city's newer layer (Fulshear Zoning (Newer Map)) re-codes much of this ground under its new districts and is drawn above it.",
  }),
  fulshear_zoning_newer: zoningRow("fulshearZoningNewer", "fulshear", "Fulshear", FULSHEAR_NEWER, {
    label: "Fulshear Zoning (Newer Map)", order: 42, source: "City of Fulshear — Zoning (newer map)",
    fields: ["OBJECTID", "Zone_Distr", "OrdNo", "Zone_Prev", "Zone_Rev", "Effect_Dat", "Comments"],
    note: "The City of Fulshear's newer zoning layer: its recent rezonings under the city's new district codes (D, CD, SR…), plus two areas the earlier map never covered. Turn it on with Fulshear Zoning; where both cover a spot the click card shows each.",
  }),
  stafford_zoning: zoningRow("staffordZoning", "stafford", "Stafford", STAFFORD, {
    label: "Stafford Zoning", order: 43, source: "City of Stafford — Zoning Designations",
    fields: ["OBJECTID", "ZONE_CODE", "ZONE_DESCR", "CODE_LINK"],
    note: "Zoning districts within the City of Stafford. Colour = district family; the code prints at close zoom; the legend lists the districts in view with the city's own names. Click for the district and a link to its section of the city's code.",
  }),
  webster_zoning: zoningRow("websterZoning", "webster", "Webster", WEBSTER, {
    label: "Webster Zoning", order: 44, source: "City of Webster — Zoning Districts",
    fields: ["OBJECTID_1", "ZONE_", "ORDINANCE", "DATE_", "Zone_Link", "Use_Link", "District_Summary"],
    note: "Zoning districts within the City of Webster. Colour = district family; the code prints at close zoom; the legend lists the districts in view with the city's own names. The city's planned developments are the separate Webster Planned Developments row. Click for the district, its ordinance and links into the city's code.",
  }),
  katy_zoning: zoningRow("katyZoning", "katy", "Katy", KATY, {
    label: "Katy Zoning", order: 46, source: "City of Katy — Zoning",
    fields: ["OBJECTID", "ZONECODE", "ZONDESC", "LINK"],
    note: "Zoning districts within the City of Katy. Colour = district family; the code prints at close zoom; the legend lists the districts in view with the city's own names. Click for the district and a link to its section of the city's code.",
  }),
  katy_flu: katyFlu(),
  katy_thoroughfare: katyThoroughfare(),
  webster_pd: zoningRow("websterPlannedDev", "webster", "Webster", WEBSTER_PD, {
    label: "Webster Planned Developments", order: 45, source: "City of Webster — Planned Development Districts",
    fields: ["OBJECTID_1", "ZONE_", "ORDINANCE", "DATE_", "Zone_Link", "Use_Link", "District_Summary", "PD_Guide_Name", "PD_Guide_Location", "PD_Guide_Ordinance", "Ord_Link", "PD_Guide_Hyperlink"],
    note: "The City of Webster's planned development districts — land zoned by its own development guide rather than a standard district. They sit where the base Webster Zoning row has no polygon. Click for the development's name, location, ordinance and guide.",
  }),
};

/* Vintage lines for the (i) popover — the dates each publisher's own layer reports (2026-11-12). */
export const TX_CITY_ZONING_VINTAGE = {
  richmond_zoning: "City of Richmond zoning layer — edited 2021-03-23; newest ordinance change on file 2020-07-20",
  fulshear_zoning: "City of Fulshear earlier zoning layer — edited 2023-09-06",
  fulshear_zoning_newer: "City of Fulshear newer zoning layer — edited 2026-10-26",
  stafford_zoning: "City of Stafford zoning layer — edited 2024-04-10",
  webster_zoning: "City of Webster zoning layer — edited 2025-12-29",
  webster_pd: "City of Webster planned development layer — edited 2025-12-29",
  katy_zoning: "City of Katy zoning layer — edited 2024-12-02",
  katy_flu: "City of Katy future land use layer — edited 2024-12-02",
  katy_thoroughfare: "City of Katy thoroughfare plan layer — edited 2024-12-02",
};
