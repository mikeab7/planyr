/* Georgia — the due-diligence layers a Georgia industrial land deal checks on day one (NEW-1, 2026-10-29).
 *
 * WHAT THIS IS. Registry rows for the Georgia gaps the first Georgia pass (B2081248 / B2095744) left: the Part V environmental-planning criteria
 * (groundwater recharge, pollution susceptibility, protected rivers, protected mountains, small water supply watersheds), the Metropolitan River
 * Protection Act corridor, karst-prone ground, EPD's solid-waste and brownfield registers, regulated dams, impaired streams, DNR conservation lands
 * and easements, and the three jurisdiction facts a developer asks of a Georgia county (opportunity zone, job-tax-credit tier, zoning where the
 * county publishes it). The registry spreads GEORGIA_LAYERS into ALL_LAYERS, exactly as it does DESOTO_LAYERS.
 *
 * EVERY ROW is an agency's own ArcGIS Online feature service, recorded in the GIS source registry (src/shared/gis/sources.js `ga*` rows) with its probe
 * date and live counts; the URL, and any `where`, are READ FROM THAT ROW — never typed twice. Every row declares `states: ["GA"]`, so a Texas or
 * Colorado view never lists it; the five rows whose source reaches only part of Georgia also declare a real boundary `regions` (serviceAreas.js:
 * `mngwpd` = the 15-county Metropolitan North Georgia Water Planning District, `spalding_ga` = Spalding County), so a Savannah site is not offered
 * a layer that can only ever read "nothing here".
 *
 * REGULATORY NUMBERS are each cited in the row's note (O.C.G.A. 12-2-8, Rules 391-3-16-.01…-.05, O.C.G.A. 12-5-440, the District's own item text);
 * where a rule is adopted locally the note says the county ordinance governs, and no width is drawn for it here. Screening only: a layer pill, never
 * a Site Analysis verdict (siteChecks TRUSTED_CHECKS is untouched).
 *
 * PURE: no network, no React, no Leaflet — the style / card rules below unit-test standalone (test/georgiaLayers.test.js). */

import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import { approvalDate } from "./desotoZoning.js";

/* ⛔ NO ROW SETS `fields` (the outFields limiter). esri-leaflet keys every feature by its OBJECT ID, and a request that leaves the id field out of `outFields` gets features
 * with no id — they all collapse into ONE feature, so a layer returning 50 river segments drew exactly one (caught on the real map by verify-georgia-due-diligence, not by
 * 1,000 unit tests). The services here name their id differently (OBJECTID · FID · ObjectId · ObjectID), so the limiter is not worth the trap; test/georgiaLayers asserts it. */
const GA = { kind: "esriFeature", states: ["GA"], hoverIdentify: true, canvasIdentify: true };

/* One row from its registry source: the URL (and the source's own `where`) always come from GIS_SOURCES. */
const row = (key, o) => ({
  ...GA,
  url: GIS_SOURCES[key].serviceUrl,
  ...(GIS_SOURCES[key].where ? { where: GIS_SOURCES[key].where } : {}),
  ...o,
});

/* A polygon wash: thin outline, quiet fill. The fill is PROPORTIONAL to the slider and the print path multiplies the same base (PDF-PARITY). */
export const washStyle = (color, fill = 0.35, weight = 1) => (_props, opacity) => ({ color, weight, opacity, fill: true, fillColor: color, fillOpacity: opacity * fill });

const text = (v) => { const s = v == null ? "" : String(v).trim(); return s && !/^(null|none|n\/a|0)$/i.test(s) ? s : ""; };
/* EPD / DNR store some display text SHOUTED; a value with any lowercase letter is left as the publisher wrote it. */
export const sentence = (v) => {
  const s = text(v);
  if (!s || /[a-z]/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
};
const rowIf = (label, v) => { const t = typeof v === "string" ? v : text(v); return t ? [{ label, text: t }] : []; };
const card = (title, rows, note) => ({ title, rows: rows.flat(), note: note || null });

/* ───────────────────────────── Part V: groundwater ───────────────────────────── */

export const SUSCEPTIBILITY_COLORS = { HIGH: "#c2410c", AVERAGE: "#fb923c", LOW: "#fdba74" };
export const SUSCEPTIBILITY_LABEL = { HIGH: "High", AVERAGE: "Average", LOW: "Low" };
export const susceptibilityClass = (props) => String((props && (props.CLASS ?? props.Class)) || "").trim().toUpperCase();
export const susceptibilityStyle = (props, opacity) => {
  const c = SUSCEPTIBILITY_COLORS[susceptibilityClass(props)] || "#94a3b8";
  return { color: c, weight: 0.6, opacity, fill: true, fillColor: c, fillOpacity: opacity * 0.4 };
};

/* ───────────────────────────── Conservation lands ───────────────────────────── */

/* An easement over private land is the one a buyer is not told about; it gets its own ink. Fee-owned public land, then everything else. */
export const CONSERVATION_COLORS = { Easement: "#b45309", Fee: "#15803d", Joint: "#0f766e", Other: "#64748b" };
export const conservationKind = (props) => {
  const c = text(props && props.Category);
  return CONSERVATION_COLORS[c] ? c : "Other";
};
export const conservationStyle = (props, opacity) => {
  const c = CONSERVATION_COLORS[conservationKind(props)];
  return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: opacity * 0.3 };
};
const ACCESS_WORDS = { OA: "Open to the public", RA: "Restricted access", XA: "Closed", Closed: "Closed", Open: "Open to the public", Restricted: "Restricted access" };

/* ───────────────────────────── Job tax credit tiers ───────────────────────────── */

/* DCA ranks all 159 counties; "Bottom 40" are the 40 lowest-ranked (least developed), Tier 4 the highest-ranked. Darker = less developed. */
export const JTC_COLORS = { "Bottom 40": "#7c2d12", "Tier 1": "#c2410c", "Tier 2": "#f59e0b", "Tier 3": "#fcd34d", "Tier 4": "#e2e8f0" };
export const jtcStyle = (props, opacity) => {
  const c = JTC_COLORS[text(props && props.Tier26)] || "#94a3b8";
  return { color: "#475569", weight: 1, opacity: opacity * 0.8, fill: true, fillColor: c, fillOpacity: opacity * 0.45 };
};

/* ───────────────────────────── Spalding County zoning ───────────────────────────── */

/* The zone CODE → a colour class. Colour = a coarse use class, never a district NAME: the county's own description field disagrees with itself for
 * several codes (C2 reads both MANUFACTURING and MANUFACTURING--LIGHT), and a district name comes from the ordinance, not from here. A code not
 * recognised is drawn neutral, never guessed. */
export function spaldingZoneClass(code) {
  const z = String(code == null ? "" : code).trim().toUpperCase().replace(/[\s-]/g, "");
  if (!z) return "other";
  if (z === "C1C" || z === "C2") return "manufacturing"; // the county's own records call these MANUFACTURING / LIGHT MANUFACTURING
  if (/^(C1|C1A|C1B|C3|OI)$/.test(z)) return "commercial";
  if (/^(AR1|AR2|AT)$/.test(z)) return "agricultural";
  if (z === "PDD" || z === "PRRRD" || z === "R6" || z === "VN") return "planned";
  if (/^(R\d|R\dA|AAR)$/.test(z)) return "residential";
  return "other";
}
export const SPALDING_COLORS = { manufacturing: "#7c3aed", commercial: "#ea580c", residential: "#ca8a04", agricultural: "#4d7c0f", planned: "#0f766e", other: "#6b7280" };
export const SPALDING_CLASS_LABEL = { manufacturing: "Manufacturing", commercial: "Commercial / office", residential: "Residential", agricultural: "Agricultural / rural", planned: "Planned / village", other: "Other" };
export const spaldingStyle = (props, opacity) => {
  const c = SPALDING_COLORS[spaldingZoneClass(props && props.LABEL)];
  return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: opacity * 0.5 };
};
export const spaldingCode = (props) => String((props && props.LABEL) || "").trim();

/* ───────────────────────────── Impaired streams ───────────────────────────── */

/* EPA integrated-report category → what it means for a developer. Georgia files under the same numbering. */
export const IMPAIRED_CATEGORY = {
  "5": "Impaired — needs a cleanup plan (TMDL) that does not yet exist",
  "4a": "Impaired — a cleanup plan (TMDL) is in place",
  "4b": "Impaired — other controls expected to fix it",
  "4c": "Impaired — not caused by a pollutant (e.g. flow or habitat)",
};
export function impairedCategories(raw) {
  return String(raw == null ? "" : raw).split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    .map((c) => ({ code: c, meaning: IMPAIRED_CATEGORY[c] || null }));
}

/* ───────────────────────────── Dams ───────────────────────────── */

export const DAM_CLASS = {
  I: "Class I — failure would probably cost lives",
  II: "Class II — failure would cause significant economic loss",
};

/* ───────────────────────────── Solid waste ───────────────────────────── */

export const solidWasteType = (raw) => text(raw).replace(/^SW-\s*/i, "");

/* ───────────────────────────── The rows ───────────────────────────── */

const ENV = { group: "environmental" };
const JUR = { group: "jurisdiction" };

export const GEORGIA_LAYERS = {
  /* ---- Part V: groundwater (EPD) ---- */
  ga_recharge: row("gaRecharge", {
    label: "Groundwater Recharge Areas", source: "Georgia EPD — Hydrologic Atlas 18 (1989)", ...ENV, role: "area", order: 20, minZoom: 8, color: "#0e7490", styleFn: washStyle("#0e7490", 0.35, 0.8), legend: [{ label: "Significant recharge area", color: "#0e7490" }],
    hoverTitle: "Groundwater recharge area", hoverSource: "Georgia EPD", hoverFields: [{ names: ["NAME"], label: "aquifer" }],
    identifyCard: (props) => card("Significant groundwater recharge area",
      [rowIf("Aquifer", sentence(props && props.NAME)), [{ label: "Rule", text: "Georgia Rule 391-3-16-.02 — new landfills, hazardous-waste facilities, large above-ground tanks and septic lot sizes are restricted here; the county's recharge-area ordinance sets the standard." }]],
      "A 1989 modeled map — screening, not a site hydrogeology."),
    note: "Georgia's 'significant groundwater recharge areas' — Hydrologic Atlas 18 (Georgia Geologic Survey, 1989) as EPD republishes it. Rule 391-3-16-.02 defines a recharge area by this map; the county adopts the protective ordinance, so confirm the county's recharge-area overlay. Turn on 'Groundwater Pollution Susceptibility' beside it: the stricter standards apply where susceptibility is high.",
    infoCaveat: "A 1989 modeled map; the county ordinance governs what is restricted. Absence is not an all-clear for private wells.",
  }),
  ga_gw_susceptibility: row("gaPollutionSusc", {
    label: "Groundwater Pollution Susceptibility", source: "Georgia EPD — Hydrologic Atlas 20 (1992, DRASTIC)", ...ENV, role: "area", order: 21, minZoom: 9, simplifyFactor: 1, vertexBudget: 250000,
    color: SUSCEPTIBILITY_COLORS.HIGH, styleFn: susceptibilityStyle,
    legend: [{ label: "High", color: SUSCEPTIBILITY_COLORS.HIGH }, { label: "Average", color: SUSCEPTIBILITY_COLORS.AVERAGE }, { label: "Low", color: SUSCEPTIBILITY_COLORS.LOW }],
    hoverTitle: "Pollution susceptibility", hoverSource: "Georgia EPD", hoverFields: [{ names: ["CLASS"], label: "class" }],
    identifyCard: (props) => {
      const k = susceptibilityClass(props);
      return card("Groundwater pollution susceptibility",
        [rowIf("Class", SUSCEPTIBILITY_LABEL[k] || sentence(k)), [{ label: "Rule", text: "Matters only INSIDE a significant recharge area (turn that layer on): there the class sets how strict Rule 391-3-16-.02's standards are." }]],
        "DRASTIC index, Hydrologic Atlas 20 (1992).");
    },
    note: "Groundwater pollution susceptibility from Hydrologic Atlas 20 (Georgia Geologic Survey, 1992, DRASTIC method): high, average, low. It carries a state requirement only inside a significant groundwater recharge area — Rule 391-3-16-.02 scales its standards by this class. Water bodies are not drawn.",
    infoCaveat: "A 1992 statewide index at small scale — useful for 'is this a sensitive area', not a site condition.",
  }),
  /* ---- Part V: rivers, mountains, water-supply watersheds ---- */
  ga_protected_rivers: row("gaProtectedRiver", {
    label: "Protected Rivers", source: "Georgia DCA — Environmental Planning (O.C.G.A. 12-2-8)", ...ENV, role: "line", order: 22, minZoom: 8, color: "#0369a1", weight: 2.4, opacity: 0.55, legend: [{ label: "Protected river", color: "#0369a1" }],
    hoverTitle: "Protected river", hoverSource: "Georgia DCA", hoverFields: [{ names: ["FENAME"] }],
    identifyCard: (props) => card(sentence(props && props.FENAME) || "Protected river",
      [[{ label: "Rule", text: "A protected river (average flow of 400 cfs or more): local governments must keep a 100-ft natural vegetative buffer each side, measured from the banks (O.C.G.A. 12-2-8, Rule 391-3-16-.04). Turn on 'Stream Buffers' to see the band." }]],
      "DCA's planning map — the local river-corridor ordinance governs."),
    note: "Georgia's PROTECTED RIVERS — perennial streams averaging 400 cfs or more (O.C.G.A. 12-2-8; Rule 391-3-16-.04), compiled by DCA. Local governments adopt a river-corridor plan with a 100-ft natural vegetative buffer each side, measured from the banks. The 'Stream Buffers' layer draws that 100 ft; the county's ordinance governs the exceptions (road and utility crossings, existing uses).",
    infoCaveat: "DCA's compiled lines (2003) — a planning map, not a survey; the buffer is measured from the bank, not this line.",
  }),
  ga_protected_mountains: row("gaProtectedMountain", {
    label: "Protected Mountains", source: "Georgia DCA — Environmental Planning (O.C.G.A. 12-2-8)", ...ENV, role: "area", order: 23, minZoom: 9, simplifyFactor: 2, vertexBudget: 400000, color: "#166534", styleFn: washStyle("#166534", 0.4, 0.5), legend: [{ label: "Protected mountain", color: "#166534" }],
    hoverTitle: "Protected mountain", hoverSource: "Georgia DCA", hoverFields: [],
    identifyCard: () => card("Protected mountain",
      [[{ label: "Definition", text: "Land at or above 2,200 ft elevation with a slope of 25% or more over at least 500 ft horizontally (O.C.G.A. 12-2-8)." }, { label: "Rule", text: "Local governments must adopt mountain-protection standards for it (Rule 391-3-16-.05); check the county ordinance before planning any grading." }]],
      "DCA analysis of the 1:24,000 National Elevation Dataset (2002)."),
    note: "Georgia's PROTECTED MOUNTAINS — land at or above 2,200 ft with a slope of 25% or more over at least 500 ft (O.C.G.A. 12-2-8), as DCA mapped it from the 1:24,000 elevation data (2002). North Georgia only. Local governments apply the mountain-protection standards (Rule 391-3-16-.05); the county ordinance governs.",
    infoCaveat: "A 2002 terrain analysis — drawn as many small pieces; a survey of slope governs a specific parcel.",
  }),
  ga_swsw: row("gaSwsw", {
    label: "Small Water Supply Watersheds", mergeGroup: "ga_water_supply", source: "Atlanta Regional Commission — Metropolitan North Georgia Water Planning District", ...ENV, regions: ["mngwpd"],
    role: "area", order: 24, minZoom: 8, color: "#2563eb", styleFn: washStyle("#2563eb", 0.2, 1),
    legend: [{ label: "Small water supply watershed", color: "#2563eb" }, { label: "Within 7 mi of the intake (protected)", color: "#1e3a8a" }],
    hoverTitle: "Water supply watershed", hoverSource: "Metro North Georgia District", hoverFields: [{ names: ["NAME"] }, { names: ["SYS_NAME"], label: "supplies" }],
    identifyCard: (props) => card(sentence(props && props.NAME) || "Small water supply watershed",
      [rowIf("Supplies", sentence(props && props.SYS_NAME)), rowIf("Counties", text(props && props.County)),
        [{ label: "Rule", text: "Under 100 sq mi above a public intake: Rule 391-3-16-.01(7) — 50-ft undisturbed buffer and 75-ft impervious setback along streams outside the 7-mile reach above the intake (the stricter 100 / 150 ft inside it)." }]],
      "Mapped by the District for its 15 counties only."),
    note: "The 22 small water supply watersheds (under 100 sq mi upstream of a drinking-water intake or non-federal supply reservoir) of the 15-county Metropolitan North Georgia Water Planning District, delineated by the District for Rule 391-3-16-.01(7): a 50-ft undisturbed stream buffer and 75-ft impervious setback. DISTRICT COUNTIES ONLY — elsewhere in Georgia a local government delineates its own, so a blank map outside the District is not an all-clear.",
    infoCaveat: "Delineated from the National Elevation Dataset by the District; the county's adopted watershed ordinance governs.",
  }),
  ga_swsw_protected: row("gaSwswProtected", {
    label: "Water Supply Watersheds — 7 mi Above Intake", mergeGroup: "ga_water_supply", source: "Atlanta Regional Commission — Metropolitan North Georgia Water Planning District", ...ENV, regions: ["mngwpd"],
    role: "area", order: 25, minZoom: 8, color: "#1e3a8a", styleFn: washStyle("#1e3a8a", 0.3, 1),
    hoverTitle: "Protected water supply watershed", hoverSource: "Metro North Georgia District", hoverFields: [{ names: ["DrH2Osrce"], label: "intake" }],
    identifyCard: (props) => card("Within 7 miles above a water-supply intake",
      [rowIf("Intake", sentence(props && props.DrH2Osrce)), rowIf("Operator", sentence(props && props.Ownop)), rowIf("Counties", text(props && props.County)),
        [{ label: "Rule", text: "The stricter reach of Rule 391-3-16-.01(7): 100-ft undisturbed buffer and 150-ft impervious setback along streams (the District's published widths)." }]],
      "Mapped by the District for its 15 counties only."),
    note: "The part of each small water supply watershed within 7 miles upstream of the intake, where the stricter stream buffers apply (100-ft undisturbed, 150-ft impervious setback, per the District's published buffer layer). District counties only.",
  }),
  /* ---- Karst ---- */
  ga_karst: row("gaCarbonate", {
    label: "Karst-Prone Rock (Carbonate)", source: "USGS — State Geologic Map Compilation", ...ENV, role: "area", order: 26, minZoom: 8, color: "#7e22ce", styleFn: washStyle("#7e22ce", 0.35, 0.8), legend: [{ label: "Limestone / dolomite at the surface", color: "#7e22ce" }],
    hoverTitle: "Carbonate rock", hoverSource: "USGS", hoverFields: [{ names: ["UNIT_NAME"] }],
    identifyCard: (props) => card(sentence(props && props.UNIT_NAME) || "Carbonate rock",
      [[{ label: "Why it matters", text: "Limestone and dolomite dissolve — sinkholes, caves and rock-head that varies by tens of feet form in it (Bartow, Floyd and Polk counties; the Dougherty Plain)." }]],
      "A geologic-map proxy for karst, not a sinkhole inventory."),
    note: "Where limestone or dolomite is the bedrock at the surface (USGS State Geologic Map Compilation, Georgia units). A SCREEN FOR KARST — Georgia publishes no statewide sinkhole inventory. Mapped at about 1:500,000, and coastal-plain limestone buried under younger sediment is not shown, so absence is NOT an all-clear. A geotechnical boring and a sinkhole review are the real check.",
    infoCaveat: "State geologic maps are generalised (about 1:500,000): the belts, not the lots.",
  }),
  /* ---- Contamination, waste, dams ---- */
  ga_solid_waste: row("gaSolidWaste", {
    label: "Solid Waste Facilities", source: "Georgia EPD — Land Protection Branch", ...ENV, role: "point", order: 27, minZoom: 10, color: "#78350f", pointRadius: 4.5, weight: 1.5, opacity: 0.55,
    hoverTitle: "Solid waste facility", hoverSource: "Georgia EPD", hoverFields: [{ names: ["Facility_Name"] }],
    identifyCard: (props) => card(sentence(props && props.Facility_Name) || "Solid waste facility",
      [rowIf("Type", solidWasteType(props && props.Interest_Type)), rowIf("Status", sentence(props && props.Operating_Status)), rowIf("Permit", text(props && props.Permit_Number)), rowIf("County", text(props && props.County))],
      "A neighbouring landfill is a Phase I, odour and methane flag."),
    note: "EPD's register of solid-waste facilities — municipal, construction-and-demolition, inert and industrial landfills, transfer stations, composting, thermal and material-recovery sites — with permit number and operating status. A landfill beside a site is a Phase I ESA, odour, methane and (near an airport) bird-hazard flag; closed and in-closure sites keep post-closure care obligations.",
    infoCaveat: "EPD's register as published — a point per permit, not the waste boundary; status can lag a closure.",
  }),
  ga_brownfields: row("gaBrownfields", {
    label: "Brownfield Sites", source: "Georgia EPD — Brownfield Program", ...ENV, role: "point", order: 28, minZoom: 10, color: "#4d7c0f", pointRadius: 4.5, weight: 1.5, opacity: 0.55,
    hoverTitle: "Brownfield site", hoverSource: "Georgia EPD", hoverFields: [{ names: ["PropertyName"] }],
    identifyCard: (props) => {
      const p = props || {};
      const acres = Number(p.Acreage);
      return card(text(p.PropertyName) || "Brownfield site",
        [rowIf("Address", [text(p.Address), text(p.City)].filter(Boolean).join(", ")), rowIf("County", text(p.County)),
          rowIf("Acreage", Number.isFinite(acres) && acres > 0 ? `${acres.toFixed(acres < 10 ? 2 : 1)} AC` : ""),
          rowIf("Liability limitation issued", approvalDate(p.LOLIssueDate) || "")],
        "The limitation of liability travels with the property; EPD's file has the closeout terms.");
    },
    note: "Properties in EPD's Brownfield Program (Georgia Hazardous Site Reuse and Redevelopment Act) with the date EPD issued the prospective purchaser's limitation of liability. A listed site has been through a regulatory closeout — good news for the buyer, and a deed and risk-reduction restriction to read. Neighbouring brownfields are a Phase I flag.",
    infoCaveat: "EPD's list as last edited (May 2022) — newer closeouts are not in this copy.",
  }),
  ga_dams: row("gaDams", {
    label: "Regulated Dams", source: "Georgia EPD — Safe Dams Program (via GEMA)", ...ENV, role: "point", order: 29, minZoom: 10, color: "#0f172a", pointRadius: 4.5, weight: 1.5, opacity: 0.55,
    hoverTitle: "Regulated dam", hoverSource: "Georgia EPD", hoverFields: [{ names: ["Dam_Name"] }],
    identifyCard: (props) => {
      const p = props || {};
      const cls = text(p.Classification).toUpperCase();
      const h = Number(p.Dam_Height);
      return card(text(p.Dam_Name) || "Regulated dam",
        [rowIf("Hazard class", DAM_CLASS[cls] || (cls ? `Class ${cls}` : "")), rowIf("Height", Number.isFinite(h) && h > 0 ? `${h} ft` : ""), rowIf("County", text(p.County)), rowIf("State ID", text(p.State_ID))],
        "Class I and II dams only; the 2019 file.");
    },
    note: "Georgia EPD Safe Dams Program Class I (probable loss of life if it fails) and Class II (significant economic loss) dams. A dam upstream of a site is a flood-risk and a downstream-hazard flag, and the dam's own owner and EPD permit govern any work near it. Class III dams, and dams built since late 2019, are not in this copy.",
    infoCaveat: "EPD's 22 Nov 2019 file, republished by GEMA — a point per dam, not an inundation map.",
  }),
  ga_impaired_streams: row("gaImpaired", {
    label: "Impaired Streams (303(d))", source: "Georgia EPD — 2024 305(b)/303(d) List of Waters", ...ENV, role: "line", order: 30, minZoom: 10, simplifyFactor: 1, color: "#be185d", weight: 2, opacity: 0.55, legend: [{ label: "Stream not meeting its use", color: "#be185d" }],
    hoverTitle: "Impaired stream", hoverSource: "Georgia EPD", hoverFields: [{ names: ["Name"] }],
    identifyCard: (props) => {
      const p = props || {};
      const cats = impairedCategories(p.Category);
      return card(text(p.Name) || "Impaired stream",
        [rowIf("Reach", text(p.Location)), rowIf("Listed for", text(p.Cause)), rowIf("Designated use", text(p.Uses)),
          cats.map((c) => ({ label: `Category ${c.code.toUpperCase()}`, text: c.meaning || "As EPD lists it" }))],
        "A water-quality listing of the reach — it is not a buffer.");
    },
    note: "Stream reaches EPD's 2024 Integrated Report lists as NOT supporting their designated use (Categories 4a, 4b, 4c, 5). A site that discharges stormwater to a listed reach draws extra scrutiny — the TMDL, the NPDES stormwater permit and any §401 review — and a listed stream is a stronger-than-usual reason to over-design the water-quality pond. Updated every two years.",
    infoCaveat: "The 2024 list; a reach can be delisted or newly listed in the next cycle. Reaches with 'assessment pending' or 'supporting' are not drawn.",
  }),
  ga_conservation: row("gaConservation", {
    label: "Conservation Lands & Easements", source: "Georgia DNR — Wildlife Resources Division (Georgia Conservation Lands, 2023)", ...ENV, role: "area", order: 31, minZoom: 10, simplifyFactor: 1, vertexBudget: 250000, color: CONSERVATION_COLORS.Fee, styleFn: conservationStyle,
    legend: [{ label: "Public / fee-owned conservation land", color: CONSERVATION_COLORS.Fee }, { label: "Conservation easement", color: CONSERVATION_COLORS.Easement }, { label: "Joint ownership", color: CONSERVATION_COLORS.Joint }, { label: "Other / unknown", color: CONSERVATION_COLORS.Other }],
    hoverTitle: "Conservation land", hoverSource: "Georgia DNR", hoverFields: [{ names: ["Unit_Nm"] }, { names: ["Category"], label: "kind" }],
    identifyCard: (props) => {
      const p = props || {};
      const kind = conservationKind(p);
      return card(text(p.Unit_Nm) || "Conservation land",
        [rowIf("Kind", kind === "Easement" ? "Conservation easement" : kind === "Fee" ? "Owned in fee for conservation" : kind === "Joint" ? "Jointly held" : ""), rowIf("Owner", sentence(p.Own_Name)),
          rowIf("Easement holder", sentence(p.EsmtHldr)), rowIf("Public access", ACCESS_WORDS[text(p.Pub_Access)] || "")],
        "An easement binds the land; the recorded instrument governs.");
    },
    note: "DNR's statewide inventory of conserved land: state and federal parks, forests and wildlife areas, land trust holdings, and conservation EASEMENTS over private land (holder named). A parcel under an easement — or next to protected land — is a hard constraint on use, access and buffers. DNR aggregates many holders' data, so the recorded easement on the title commitment governs.",
    infoCaveat: "DNR's 2023 aggregation — boundaries can lag a recent closing; confirm on the title commitment and survey.",
  }),
  /* ---- Jurisdictions & incentives ---- */
  ga_mrpa_corridor: row("gaMrpaCorridor", {
    label: "Chattahoochee River Corridor (2,000 ft)", mergeGroup: "ga_mrpa", source: "Atlanta Regional Commission — Metropolitan River Protection Act", ...JUR, regions: ["mngwpd"],
    role: "area", order: 20, minZoom: 9, color: "#0e7490", styleFn: washStyle("#0e7490", 0.12, 1),
    legend: [{ label: "2,000-ft river corridor", color: "#0e7490" }, { label: "150-ft structure / impervious setback", color: "#c2410c" }, { label: "50-ft undisturbed river buffer", color: "#15803d" }, { label: "35-ft undisturbed tributary buffer", color: "#7c3aed" }],
    hoverTitle: "Chattahoochee corridor", hoverSource: "ARC", hoverFields: [],
    identifyCard: () => card("Chattahoochee River Corridor (MRPA)",
      [[{ label: "Rule", text: "Inside the 2,000-ft corridor, ARC reviews every land-disturbing proposal for consistency with the Chattahoochee Corridor Plan before the local government may permit it (Metropolitan River Protection Act, O.C.G.A. 12-5-440 et seq.)." }]],
      "Published by ARC / the Metropolitan North Georgia Water Planning District."),
    note: "The Metropolitan River Protection Act corridor: 2,000 ft either side of the Chattahoochee from Buford Dam to the downstream limit of Fulton and Douglas counties (O.C.G.A. 12-5-440 et seq.). ARC reviews every proposal inside it; the local government issues the permit. The corridor plan adds a 50-ft undisturbed river buffer, a 35-ft tributary buffer and a 150-ft setback for structures and impervious surfaces — switch them on below.",
    infoCaveat: "Buffers are measured from the river bank (and from the stream bank on tributaries); the plan's exceptions and ARC's review govern a specific parcel.",
  }),
  ga_mrpa_buffer_150: row("gaMrpaImpBuffer", {
    label: "Chattahoochee 150-ft Setback", mergeGroup: "ga_mrpa", source: "Atlanta Regional Commission — Metropolitan River Protection Act", ...JUR, regions: ["mngwpd"],
    role: "area", order: 21, minZoom: 11, color: "#c2410c", styleFn: washStyle("#c2410c", 0.25, 0.8),
    hoverTitle: "Chattahoochee 150-ft setback", hoverSource: "ARC", hoverFields: [],
    identifyCard: () => card("Chattahoochee 150-ft setback", [[{ label: "Rule", text: "Structures and impervious surfaces are set back 150 ft from the river bank under the Chattahoochee Corridor Plan." }]], "ARC's published buffer — a survey of the bank governs."),
    note: "The corridor plan's 150-ft setback for structures and impervious surfaces from the Chattahoochee bank.",
  }),
  ga_mrpa_buffer_50: row("gaMrpaVegBuffer", {
    label: "Chattahoochee 50-ft Undisturbed Buffer", mergeGroup: "ga_mrpa", source: "Atlanta Regional Commission — Metropolitan River Protection Act", ...JUR, regions: ["mngwpd"],
    role: "area", order: 22, minZoom: 11, color: "#15803d", styleFn: washStyle("#15803d", 0.35, 0.8),
    hoverTitle: "Chattahoochee 50-ft buffer", hoverSource: "ARC", hoverFields: [],
    identifyCard: () => card("Chattahoochee 50-ft undisturbed buffer", [[{ label: "Rule", text: "A natural vegetative buffer 50 ft wide along the river and its impoundments stays undisturbed under the Chattahoochee Corridor Plan." }]], "ARC's published buffer — a survey of the bank governs."),
    note: "The corridor plan's 50-ft natural (undisturbed) vegetative buffer along the Chattahoochee and its impoundments.",
  }),
  ga_mrpa_buffer_35: row("gaMrpaTributaryBuffer", {
    label: "Chattahoochee 35-ft Tributary Buffer", mergeGroup: "ga_mrpa", source: "Atlanta Regional Commission — Metropolitan River Protection Act", ...JUR, regions: ["mngwpd"],
    role: "area", order: 23, minZoom: 11, color: "#7c3aed", styleFn: washStyle("#7c3aed", 0.35, 0.8),
    hoverTitle: "Tributary 35-ft buffer", hoverSource: "ARC", hoverFields: [],
    identifyCard: () => card("Tributary 35-ft undisturbed buffer", [[{ label: "Rule", text: "A 35-ft natural buffer stays undisturbed along tributary streams inside the Chattahoochee corridor." }]], "ARC's published buffer — a survey of the bank governs."),
    note: "The corridor plan's 35-ft undisturbed buffer along tributary streams inside the 2,000-ft corridor.",
  }),
  ga_opportunity_zones: row("gaOpportunityZones", {
    label: "Opportunity Zones", source: "Georgia DCA — Federal Opportunity Zones", ...JUR, role: "area", order: 22, minZoom: 8, color: "#be185d", styleFn: washStyle("#be185d", 0.3, 1), legend: [{ label: "Qualified Opportunity Zone tract", color: "#be185d" }],
    hoverTitle: "Opportunity zone", hoverSource: "Georgia DCA", hoverFields: [{ names: ["NAMELSAD10"] }, { names: ["County"] }],
    identifyCard: (props) => card("Qualified Opportunity Zone", [rowIf("Census tract", sentence(props && props.NAMELSAD10)), rowIf("County", sentence(props && props.County))], "Federal designation (IRC §1400Z-1); the tax rules are federal."),
    note: "Georgia's federally designated Qualified Opportunity Zone census tracts (2017 designation, DCA). An investment through a qualified opportunity fund into property here carries federal capital-gains treatment — a tract-level fact, so confirm the parcel's tract and the fund rules with tax counsel.",
    infoCaveat: "The 2017 tract designation as DCA publishes it; a tax-law fact, not a zoning one.",
  }),
  ga_jtc_tiers: row("gaJobTaxCredit", {
    label: "Job Tax Credit Tiers", source: "Georgia DCA — Job Tax Credit county tiers (2026)", ...JUR, role: "area", order: 23, minZoom: 6, simplifyFactor: 1, color: "#c2410c", styleFn: jtcStyle,
    legend: Object.entries(JTC_COLORS).map(([label, color]) => ({ label, color })),
    hoverTitle: "Job tax credit tier", hoverSource: "Georgia DCA", hoverFields: [{ names: ["fullName"] }, { names: ["Tier26"], label: "2026" }],
    identifyCard: (props) => {
      const p = props || {};
      const now = text(p.Tier26), before = text(p.Tier25);
      return card(text(p.fullName) || "County", [rowIf("2026 tier", now), rowIf("Rank (1 = least developed)", text(p.Rank26)), now && before && now !== before ? rowIf("2025 tier", before) : []],
        "DCA's schedule governs the credit per job.");
    },
    note: "DCA's 2026 ranking of Georgia's 159 counties for the job tax credit and related incentives: 'Bottom 40' are the 40 lowest-ranked (least developed) counties, then Tier 1 to Tier 4 (most developed). The less developed the county, the larger the credit per job. The tier is re-ranked every year and a county can move — compare the 2025 tier in the click card.",
    infoCaveat: "The 2026 ranking; eligibility and the credit amount are set by DCA's current schedule.",
  }),
  ga_spalding_zoning: row("gaSpaldingZoning", {
    label: "Zoning (Spalding County)", source: "Spalding County, GA — zoning GIS", ...JUR, regions: ["spalding_ga"], role: "area", order: 24, minZoom: 11, color: SPALDING_COLORS.manufacturing, styleFn: spaldingStyle,
    legend: ["manufacturing", "commercial", "residential", "agricultural", "planned", "other"].map((k) => ({ label: SPALDING_CLASS_LABEL[k], color: SPALDING_COLORS[k] })),
    lineLabel: { field: "LABEL", minZoom: 15, format: (v) => { const t = text(v); return t || null; } },
    hoverTitle: "Zoning", hoverSource: "Spalding County", hoverFields: [{ names: ["LABEL"], label: "zone" }],
    identifyCard: (props) => card(`Zone ${spaldingCode(props) || "(code not published)"}`,
      [[{ label: "Jurisdiction", text: "Unincorporated Spalding County — the City of Griffin and the other cities zone themselves" }], rowIf("Colour class", SPALDING_CLASS_LABEL[spaldingZoneClass(props && props.LABEL)])],
      "The county's zoning ordinance defines each district; ask Planning & Zoning."),
    note: "Spalding County's own zoning polygons for the UNINCORPORATED county (colour = a coarse use class; the code prints at close zoom). The cities zone themselves and are not in this layer. District names are not shown: the county's description field disagrees with itself for several codes, and a name comes from the ordinance. Confirm the district and any conditions with the county.",
    infoCaveat: "County-published polygons (edited August 2025); a rezoning or condition may post later. Confirm with Spalding County Planning & Zoning.",
  }),
};

/* The consolidated panel rows these members fold into (layers.js spreads this into MERGE_GROUPS). */
export const GEORGIA_MERGE_GROUPS = {
  ga_mrpa: {
    label: "Chattahoochee River Corridor",
    note: "The Metropolitan River Protection Act corridor along the Chattahoochee (2,000 ft) and the plan's river, tributary and impervious-surface buffers — one switch for all four.",
  },
  ga_water_supply: {
    label: "Water Supply Watersheds",
    note: "Small water supply watersheds of the Metropolitan North Georgia Water Planning District, and the stricter 7-mile reach above each intake — one switch for both.",
  },
};

/* The ⓘ line: edition / vintage of each source as its own item reports it (probed 2026-10-29). */
export const GEORGIA_VINTAGE = {
  ga_recharge: "Hydrologic Atlas 18 (1989), digitised 1996 — EPD layer edited 2020-04-07",
  ga_gw_susceptibility: "Hydrologic Atlas 20 (1992, DRASTIC) — EPD layer edited 2020-04-07",
  ga_protected_rivers: "DCA protected rivers (compiled 2003) — layer edited 2024-03-12",
  ga_protected_mountains: "DCA terrain analysis (NED 1:24,000, 2002) — layer edited 2024-03-12",
  ga_swsw: "Metropolitan North Georgia Water Planning District — current edition (edition date not published)",
  ga_swsw_protected: "Metropolitan North Georgia Water Planning District — current edition (edition date not published)",
  ga_karst: "USGS State Geologic Map Compilation (doi:10.5066/F7WH2N65) — state maps of differing dates",
  ga_solid_waste: "Georgia EPD solid waste facility register — edition date not published",
  ga_brownfields: "Georgia EPD Brownfield Program — layer edited 2022-05-16",
  ga_dams: "Georgia EPD Safe Dams — 22 Nov 2019 file, republished by GEMA 2022-01-15",
  ga_impaired_streams: "Georgia EPD 2024 305(b)/303(d) List of Waters — published 2024-11-13",
  ga_conservation: "Georgia DNR Conservation Lands — 2023 edition",
  ga_mrpa_corridor: "Atlanta Regional Commission — current edition (edition date not published)",
  ga_mrpa_buffer_150: "Atlanta Regional Commission — current edition (edition date not published)",
  ga_mrpa_buffer_50: "Atlanta Regional Commission — current edition (edition date not published)",
  ga_mrpa_buffer_35: "Atlanta Regional Commission — current edition (edition date not published)",
  ga_opportunity_zones: "Qualified Opportunity Zones — 2017 designation (DCA)",
  ga_jtc_tiers: "DCA Job Tax Credit tiers — 2026 ranking",
  ga_spalding_zoning: "Spalding County zoning — layer edited 2025-08-11",
};
