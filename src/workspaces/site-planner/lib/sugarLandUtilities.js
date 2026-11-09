/* City of Sugar Land WATER and SEWER network (NEW-1, 2026-11-06) — the pure half: where it comes from, what date it carries, how each line / point is painted, what the click card says.
 *
 * SOURCE (public, CORS-open ArcGIS Online, no token): services1.arcgis.com/VVapzOPgBae5joyC/.../CityofSugarLand/FeatureServer — item "CityofSugarLand", owner seetoner_CDMSmith (CDM Smith, the city's
 * consultant on its integrated water resources plan; the layers are named "IWRP - …"). The city's OWN server (interactivemaps.sugarlandtx.gov/512) keeps PW_Utilities and CWOL_Services behind a token;
 * this copy is what is public.
 *
 * ⛔ THE DATE — MEASURED 2026-11-06, AND IT IS NOT THE DATE THE LAYERS REPORT. Three different dates exist and the row must not blur them:
 *   · the ITEM was last modified 2021-11-10;
 *   · each LAYER's own editingInfo.lastEditDate: Pressurized Main (water) 2025-11-20 · Gravity Main (sewer) 2025-12-23 · every other layer used here 2021-11-10;
 *   · the CONTENT — the newest `InstallDat` in ANY of these layers is 2017-01-27 (water mains 2017-01-27, gravity mains 2017-01-27, laterals 2017-01-27, force mains 2017-03-02, valves, manholes,
 *     clean-outs all 2017-01-27; water plants 2012). Of 32,175 water mains 629 are dated 2016 or later and 18 after 2017-01-02. The later layer-edit dates are republishes of the same network, not newer mapping.
 * A developer reads "how old is this" to mean "what has been built since" — so the ROW TAG is the content date ("as of 2017"), and the full story (the 2017 content date AND the layer's own edit date) is on the
 * row's (i) and on every click card. The tag is one constant (`UTILITY_TAG`): if the city publishes a newer network, change it here and in `UTILITY_DATA_AS_OF`, nowhere else.
 *
 * WHAT IS DELIBERATELY NOT DECODED (each measured): `Subtype` is an integer with NO coded-value domain on any of these layers (water mains carry 11 distinct values, gravity mains 7) — it is never turned into a
 * word; `Elevation` / `InvertElev` / `FlowLineDe` carry no datum or unit statement — never printed; `Operationa` ("District 1") is an internal zone — never printed. Pipe size is `Diameter` (inches) on water,
 * force-main and lateral lines and `NominalDia` (inches) on gravity mains; a size over 72 in is a data-entry slip (one 86-inch "lateral") and is not printed. Material is the city's short code
 * (AC, CI, DIP, PVC, STL, ABS, CONC …) and only the ones whose meaning is certain are spelled out.
 *
 * LEFT OUT ON PURPOSE (reasons measured): Surface Water Transmission Line (layer 27, 91 mains — 89 of its 91 ASSETIDs are already in the Pressurized Main layer); IWRP Hydrant (layer 7, 5,749 — the
 * city's inspection layer is already the Hydrants row); IWRP Fitting / Fittings (18,432 points — a wall of dots with no use at site scale); Meter (0 features); Pump / Network Structure (tens of points,
 * no site use); Water Meters / Address Points (customer data); GRP Wells (groundwater-reduction-plan wells of other owners).
 *
 * NO PERSONAL DATA: the water layer carries `created_us` / `last_edite` (editor names) — every row names its `fields` and none of those is requested.
 *
 * Pure: no network, no React — unit-tested in test/sugarLandUtilities.test.js. */

export const UTILITY_PUBLISHER = "CDM Smith for the City of Sugar Land";
/* The newest install date found in the network (2017-01-27), as a month. */
export const UTILITY_DATA_AS_OF = "Jan 2017";
/* The tag on every row label. */
export const UTILITY_TAG = "as of 2017"; // the owner asked for this wording (2026-11-06 follow-up) — the NAMES are kept short enough that it is never clipped at the panel's default width (a geometric check in verify-sugarland-utilities-live)
/* Each layer's own editingInfo.lastEditDate (read 2026-11-06). */
export const UTILITY_LAYER_EDITED = Object.freeze({ water: "Nov 20, 2025", gravity: "Dec 23, 2025", other: "Nov 10, 2021" });

/* The "Source:" line on a row's (i) — publisher, the content date, and the layer's own edit date. */
export const utilitySource = (edited) => `${UTILITY_PUBLISHER} — network dated through ${UTILITY_DATA_AS_OF}; this layer last edited ${edited}`;
/* The "As of:" line on a solo row's (i). */
export const utilityVintage = (edited) => `Network dated through ${UTILITY_DATA_AS_OF} (newest install date in the data) — layer last edited ${edited}; the item was last modified Nov 10, 2021`;

/* Row labels carry the tag. */
export const taggedLabel = (name) => `${name} · ${UTILITY_TAG}`;

/* ───────────────────────── small readers ───────────────────────── */
const str = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const has = (v) => { const t = str(v); return !!t && !/^(null|none|n\/?a|<null>|unk|unknown)$/i.test(t); };
const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const row = (label, v) => (has(v) ? { label, text: str(v) } : null);
const clean = (rows) => rows.filter(Boolean);

/* A pipe / valve size in inches; null for blank, zero, negative and the slips over 72 in. */
export function sizeInches(v, max = 72) {
  const n = num(v);
  if (n == null || n <= 0 || n > max) return null;
  return Math.round(n * 10) / 10;
}
const sizeText = (v, max) => { const n = sizeInches(v, max); return n == null ? null : `${n} in`; };

/* The year a pipe / structure went in: the install date's year when it is a real date (the sheet's 1900-01-01 is "unset"), else the city's Year_ text; null when neither. Never later than the data's own 2018 ceiling. */
export function installYear(p) {
  p = p || {};
  const raw = num(p.InstallDat);
  if (raw != null && raw > -2208988800000) { // after 1900-01-01
    const y = new Date(raw).getUTCFullYear();
    if (y >= 1900 && y <= 2018) return String(y);
  }
  const t = str(p.Year_);
  if (/^\d{4}$/.test(t) && +t >= 1900 && +t <= 2018) return t;
  return null;
}

/* "Abandoned" / "Adbandoned" (the city's typo) / "Inactive"; the lifecycle word otherwise. */
export function lifecycle(v) {
  const t = str(v);
  if (!t) return null;
  if (/a[bd]+andon/i.test(t)) return "Abandoned";
  if (/^active$/i.test(t)) return "Active";
  if (/^inactive$/i.test(t)) return "Inactive";
  if (/^proposed$/i.test(t)) return "Proposed";
  if (/^removed$/i.test(t)) return "Removed";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}
export const isAbandoned = (p) => lifecycle(p && (p.LifecycleS || p.LIFE_CYCLE)) === "Abandoned";

/* Material codes — only the ones whose meaning is certain are spelled out; any other code shows as the city wrote it. */
const MATERIALS = { PVC: "PVC", AC: "Asbestos cement", CI: "Cast iron", DI: "Ductile iron", DIP: "Ductile iron", STL: "Steel", STEEL: "Steel", HDPE: "HDPE", ABS: "ABS", CONC: "Concrete", RCP: "Reinforced concrete", "POLY VINYL CHLORIDE": "PVC", "PVC SDR 26": "PVC" };
export function materialText(v) {
  const t = str(v);
  if (!has(t)) return null;
  return MATERIALS[t.toUpperCase()] || t;
}

/* Who owns / runs the line, as the city wrote it, with the plain "City" spellings made one. A bare "N" (the hydrant layer's flag) and "Unk" are not names. */
export function operatorText(v) {
  const t = str(v);
  if (!has(t) || /^n$/i.test(t)) return null;
  if (/^city( of sugar ?land)?$/i.test(t)) return "City of Sugar Land";
  return t;
}

/* The "Data as of" rows every card carries — the content date and the layer's own edit date, and who made it. */
export const asOfRows = (edited) => [
  { label: "Data as of", text: `${UTILITY_DATA_AS_OF} · layer last edited ${edited}` },
  { label: "Source", text: UTILITY_PUBLISHER },
];

/* ───────────────────────── water lines ───────────────────────── */
export const WATER_COLORS = Object.freeze({ potable: "#1d63c8", raw: "#0e8f8f", reclaimed: "#9333ea", abandoned: "#7a8190" });
export function waterKind(p) {
  if (isAbandoned(p)) return "abandoned";
  const w = str(p && p.WaterType).toLowerCase();
  if (w === "reclaimed") return "reclaimed";
  if (w === "raw") return "raw";
  return "potable";
}
/* Stroke weight by size, so a 36-inch transmission main reads heavier than a 6-inch service line. */
export function pipeWeight(d) {
  const n = sizeInches(d);
  if (n == null) return 1.2;
  if (n >= 20) return 2.8;
  if (n >= 12) return 2.1;
  if (n >= 8) return 1.6;
  return 1.1;
}
export function waterStyle(p, opacity) {
  const kind = waterKind(p);
  const dash = kind === "raw" ? "8 4" : kind === "abandoned" ? "2 5" : undefined;
  return { color: WATER_COLORS[kind], weight: pipeWeight(p && p.Diameter), opacity, fill: false, lineCap: "round", lineJoin: "round", ...(dash ? { dashArray: dash } : {}) };
}
export const WATER_LEGEND = Object.freeze([
  { label: "Water main", color: WATER_COLORS.potable },
  { label: "Raw water", color: WATER_COLORS.raw },
  { label: "Reclaimed water", color: WATER_COLORS.reclaimed },
  { label: "Abandoned", color: WATER_COLORS.abandoned },
]);
/* What the line carries, from the city's WaterType: "Potable" and "Potable Water" are both drinking water; the chemical-feed values (Phosphates, Fluorine, Chlorine — 36 lines) read as feed lines. */
export function carriesText(waterType) {
  const w = str(waterType).toLowerCase();
  if (w === "potable" || w === "potable water") return "Drinking water";
  if (w === "raw") return "Raw water";
  if (w === "reclaimed") return "Reclaimed water";
  if (/^(phosphates|fluorine|chlorine)$/.test(w)) return `${w.charAt(0).toUpperCase()}${w.slice(1)} feed line`;
  return null;
}
export function waterLineCard(p) {
  p = p || {};
  const water = carriesText(p.WaterType);
  return {
    title: "Water main",
    rows: clean([
      row("Size", sizeText(p.Diameter)), row("Material", materialText(p.Material)), row("Carries", water),
      row("Status", lifecycle(p.LifecycleS)), row("Installed", installYear(p)), row("Operated by", operatorText(p.Administra)),
      ...asOfRows(UTILITY_LAYER_EDITED.water),
    ]),
  };
}

/* ───────────────────────── sewer lines ───────────────────────── */
export const SEWER_COLORS = Object.freeze({ gravity: "#1f8a3d", lateral: "#46b862", force: "#0f5c2a", abandoned: "#7a8190" });
export function sewerStyle(kind) {
  return (p, opacity) => {
    const abandoned = isAbandoned(p);
    const color = abandoned ? SEWER_COLORS.abandoned : SEWER_COLORS[kind];
    const size = p && (p.NominalDia != null ? p.NominalDia : p.Diameter);
    const weight = kind === "lateral" ? 1.0 : kind === "force" ? Math.max(1.8, pipeWeight(size)) : pipeWeight(size);
    const dash = abandoned ? "2 5" : kind === "force" ? "10 5" : undefined;
    return { color, weight, opacity, fill: false, lineCap: "round", lineJoin: "round", ...(dash ? { dashArray: dash } : {}) };
  };
}
export const SEWER_LEGEND = Object.freeze([
  { label: "Gravity sewer main", color: SEWER_COLORS.gravity },
  { label: "Service lateral", color: SEWER_COLORS.lateral },
  { label: "Force main (pressure)", color: SEWER_COLORS.force },
  { label: "Abandoned", color: SEWER_COLORS.abandoned },
]);
const sewerCard = (title, sizeField, edited) => (p) => {
  p = p || {};
  return {
    title,
    rows: clean([
      row("Size", sizeText(p[sizeField], 60)), row("Material", materialText(p.Material)),
      /^treated$/i.test(str(p.WaterType)) ? row("Carries", "Treated water") : null,
      row("Status", lifecycle(p.LifecycleS)), row("Installed", installYear(p)), row("Operated by", operatorText(p.Administra)),
      ...asOfRows(edited),
    ]),
  };
};
export const gravityMainCard = sewerCard("Gravity sewer main", "NominalDia", UTILITY_LAYER_EDITED.gravity);
export const lateralCard = sewerCard("Sewer service lateral", "Diameter", UTILITY_LAYER_EDITED.other);
export const forceMainCard = sewerCard("Sewer force main (pressure)", "Diameter", UTILITY_LAYER_EDITED.other);

/* ───────────────────────── points ───────────────────────── */
export const POINT_COLORS = Object.freeze({
  waterValve: "#1d63c8", controlValve: "#0b3a8c", manhole: "#1f8a3d", cleanout: "#46b862",
  liftStation: "#0f5c2a", wwtp: "#0a3d1c", waterPlant: "#1d63c8", well: "#0e8f8f",
});
const structureCard = (title, edited, extra) => (p) => {
  p = p || {};
  return { title, rows: clean([...(extra ? extra(p) : []), row("Status", lifecycle(p.LifecycleS)), row("Installed", installYear(p)), row("ID", p.ASSETID), ...asOfRows(edited)]) };
};
export const waterValveCard = structureCard("Water valve", UTILITY_LAYER_EDITED.other, (p) => [row("Size", sizeText(p.Diameter))]);
export const controlValveCard = structureCard("Water control valve", UTILITY_LAYER_EDITED.other, (p) => [row("Size", sizeText(p.Diameter))]);
export const manholeCard = structureCard("Sewer manhole", UTILITY_LAYER_EDITED.other);
export const cleanoutCard = structureCard("Sewer clean-out", UTILITY_LAYER_EDITED.other);

/* Facility names arrive shouted ("HARMON LIFT STATION") or as a bare word ("Industrial"). */
function facilityName(raw) {
  const t = str(raw);
  if (!t) return "";
  if (/[a-z]/.test(t)) return t;
  return t.toLowerCase().replace(/[a-z][a-z'.&]*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}
export function liftStationCard(p) {
  p = p || {};
  const name = facilityName(p.BUILDING_N) || (has(p.Common_Nam) ? `${facilityName(p.Common_Nam)} lift station` : "");
  return {
    title: name || "Sewer lift station",
    rows: clean([row("Address", facilityName(p.LOCATION)), row("Status", lifecycle(p.LIFE_CYCLE)), ...asOfRows(UTILITY_LAYER_EDITED.other)]),
  };
}
export function wwtpCard(p) {
  p = p || {};
  return { title: facilityName(p.BUILDING_N) || (has(p.Common_Nam) ? `${facilityName(p.Common_Nam)} wastewater treatment plant` : "Wastewater treatment plant"), rows: clean([row("Status", lifecycle(p.LIFE_CYCLE)), ...asOfRows(UTILITY_LAYER_EDITED.other)]) };
}
export function waterPlantCard(p) {
  p = p || {};
  const n = facilityName(p.Name) || facilityName(p.Name_1) || facilityName(p.text);
  return { title: n ? `${n} water plant` : "Water plant", rows: clean([row("Status", lifecycle(p.LifecycleS)), row("Installed", installYear(p)), ...asOfRows(UTILITY_LAYER_EDITED.other)]) };
}
export function wellCard(p) {
  p = p || {};
  const w = str(p.WaterType).toLowerCase();
  const n = facilityName(p.Name);
  return {
    title: n ? `${n} well` : "Water well",
    rows: clean([row("Carries", w === "raw" ? "Raw water" : w === "potable" ? "Drinking water" : null), row("Status", lifecycle(p.LifecycleS)), row("Installed", installYear(p)), ...asOfRows(UTILITY_LAYER_EDITED.other)]),
  };
}

/* ───────────────────────── the SQL `where` of each row (one definition, read by the registry) ───────────────────────── */
/* Removed lines are not in the ground; abandoned ones are (and are drawn grey and dotted, never hidden). */
export const WATER_WHERE = "(LifecycleS IS NULL OR LifecycleS <> 'Removed')";
/* Not Removed, not Proposed (never built), and not the 11 mains the city typed as WaterType Storm in its sewer layer. */
export const GRAVITY_WHERE = "(LifecycleS IS NULL OR LifecycleS NOT IN ('Removed','Proposed')) AND (WaterType IS NULL OR WaterType <> 'Storm')";
export const FORCE_WHERE = "(LifecycleS IS NULL OR LifecycleS <> 'Removed')";

/* The one caution every water / sewer row carries (deduped into a single line on a merged row's (i)). */
export const UTILITY_CAVEAT_TEXT = `Network dated through ${UTILITY_DATA_AS_OF} — mains, valves and manholes built since are not shown. These are the consultant's GIS locations, not a survey or an as-built: confirm size, material and depth with the city's as-builts (Utility Map Request) and an 811 locate before design or digging.`;
