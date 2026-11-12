/* Texas CITY zoning layer rows (NEW-1, 2026-11-12) — Richmond, Fulshear (two layers), Stafford, and (NEW-2) Webster. The registry spreads TX_CITY_ZONING_LAYERS into ALL_LAYERS exactly as
 * Sugar Land's rows are (sugarLandLayers.js is the shape; sugarLandZoning.js the pure half this follows via txCityZoning.js).
 *
 * Every row is a REGIONAL source: it declares `states: ["TX"]` and `regions: ["<city>"]` (serviceAreas.js: that city's LIMITS from TxGIO Texas_City_Boundaries, built by
 * scripts/build-service-areas.mjs), so `layerAvailableHere` hides the row — and the map's draw filter turns it off before any request — on a Harris-outside-the-city, Dallas or Georgia site.
 * Zoning applies inside a city's limits only (a Texas city's ETJ is not zoned), so no ETJ is added. Unincorporated Fort Bend County keeps the "Texas counties have no zoning" sentence.
 *
 * The URLs and `where` clauses come from the registry rows (src/shared/gis/sourcesTxCityZoning.js), so the layer and the weekly drift verifier cannot disagree.
 *
 * NOT HERE, each measured 2026-11-12: Rosenberg (maps.rosenbergtx.gov publishes no zoning layer), Katy (none public), Missouri City (gis.missouricitytx.gov refuses non-browser clients — a
 * browser probe is still owed).
 *
 * PURE: no network, no React — unit-tested in test/txCityZoningLayers.test.js. */

import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import { RICHMOND, FULSHEAR, FULSHEAR_NEWER, STAFFORD } from "./txCityZoning.js";

const srcOf = (k) => {
  const s = GIS_SOURCES[k];
  if (!s) throw new Error(`txCityZoningLayers: no GIS_SOURCES row "${k}"`);
  return s;
};

const feature = (sourceKey, region, o) => {
  const s = srcOf(sourceKey);
  return { kind: "esriFeature", states: ["TX"], regions: [region], hoverIdentify: true, canvasIdentify: true, ...o, url: s.serviceUrl, ...(s.where ? { where: s.where } : {}) };
};

/* The row fields every city shares: an AREA layer in the Jurisdictions group, labelled by its codes at close zoom, legend headed by the city. */
const zoningRow = (sourceKey, region, city, z, o) => feature(sourceKey, region, {
  role: "area", group: "jurisdiction", minZoom: 12,
  styleFn: z.style, lineLabel: { field: z.labelField, minZoom: 14, format: z.labelText }, identifyCard: z.card,
  viewLegend: (features) => z.legend(z.legendItemsOf(features)),
  infoCaveat: `Zoning of land inside the City of ${city}'s limits only — a Texas city's ETJ is not zoned. ${z.citation} Confirm with the city's Planning department.`,
  ...o,
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
};

/* Vintage lines for the (i) popover — the dates each publisher's own layer reports (2026-11-12). */
export const TX_CITY_ZONING_VINTAGE = {
  richmond_zoning: "City of Richmond zoning layer — edited 2021-03-23; newest ordinance change on file 2020-07-20",
  fulshear_zoning: "City of Fulshear earlier zoning layer — edited 2023-09-06",
  fulshear_zoning_newer: "City of Fulshear newer zoning layer — edited 2026-10-26",
  stafford_zoning: "City of Stafford zoning layer — edited 2024-04-10",
};
