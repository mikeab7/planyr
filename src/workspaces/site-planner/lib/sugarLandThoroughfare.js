/* City of Sugar Land Master Thoroughfare Plan (NEW-1, 2026-11-02) — the pure half: which segments the map draws, how each class is painted, what the click card says.
 *
 * SOURCE: Planning/Master_Thoroughfare_Plan/MapServer/0 on the city's own ArcGIS Server (9,092 polylines, EPSG:2278), read through the /gis-proxy relay. This is the
 * current one — its map document path says 2026. NOT used: Thoroughfare_Master_Plan/MapServer/0 (same count, but with a minimum-scale gate) and the org copy
 * Major_Thoroughfare_Network (9,080).
 *
 * THE LAYER HOLDS EVERY STREET. FUNCTIONAL_CLASS (measured 2026-11-02): OTHER 5,777 · MIN COLL 1,103 · ARTERIAL 821 · MAJ COLL 806 · STATE 335 · FRWY 221 · LOCAL 1 · blank 28.
 * The city's own renderer draws only the five classed values; null / LOCAL / OTHER are invisible there, and so they are here — `THOROUGHFARE_WHERE` keeps the 3,286 classed
 * segments and drops the 2 whose LIFE_CYCLE is Retired (3,284 drawn; 7 classed segments have a blank LIFE_CYCLE and are kept).
 *
 * WHAT IS DELIBERATELY NOT SAID (the traps, each measured):
 *   · ROAD_WIDTH is a string ("50", "60"…) and nothing in the layer says whether it is pavement or right-of-way; RR_Wd_1 / RR_WD_2 are unexplained (a sample read 25 and 40). None is
 *     shown, none is called ROW. The SECTION codes are the city's cross-section names (P4D, C4D, L2U, C2U-B, C2U-40-P, CSD, CD4, U2 … 25 spellings); their meaning is on the plan's
 *     legend (the Master Thoroughfare Plan PDF, Ordinance 2167, Feb 2020 print), which gives CLASSIFICATION only — no ROW, no definition of the letters. A code that is exactly a legend row shows its
 *     classification (`SECTION_CLASSIFICATION`); every other code (C4D, the most common, is not on the 2020 legend) shows AS THE CITY WRITES IT. The letters are never expanded and no width is shown.
 *   · LANE_NUMBER is the city's per-line count: it reads 2 on 655 of 674 C4D segments and on all 48 P6D — it is NOT the road's total lane count. It is shown as "Lanes (city's
 *     count)" and the layer's note says to read the section code instead.
 *   · Whether the plan's section DIFFERS from the road's current section is shown as a card row (the two codes, side by side) — "findable, without a verdict".
 *
 * Pure: no network, no React — unit-tested in test/sugarLandThoroughfare.test.js. */

export const THOROUGHFARE_CLASSES = Object.freeze({
  "FRWY": { label: "Freeway", color: "#dc2626", weight: 3.5 },
  "STATE": { label: "State highway", color: "#ec4899", weight: 3 },
  "ARTERIAL": { label: "Arterial", color: "#f59e0b", weight: 2.6 },
  "MAJ COLL": { label: "Major collector", color: "#0ea5e9", weight: 2.2 },
  "MIN COLL": { label: "Minor collector", color: "#22c55e", weight: 1.8 },
});
export const THOROUGHFARE_ORDER = Object.keys(THOROUGHFARE_CLASSES);

/* The classed segments that are not retired. SQL: `<> 'Retired'` alone would drop the 7 classed segments with a blank LIFE_CYCLE, so blank is kept explicitly. */
export const THOROUGHFARE_WHERE = `FUNCTIONAL_CLASS IN (${THOROUGHFARE_ORDER.map((k) => `'${k}'`).join(",")}) AND (LIFE_CYCLE IS NULL OR LIFE_CYCLE <> 'Retired')`;

const str = (v) => (v == null ? "" : String(v).trim());
export const classKey = (props) => str(props && props.FUNCTIONAL_CLASS).toUpperCase().replace(/\s+/g, " ");
export const classInfo = (props) => THOROUGHFARE_CLASSES[classKey(props)] || null;

/* esri-leaflet per-feature style. A segment of a class the plan does not draw gets a hairline-free neutral (it never reaches the map: the `where` removes it). */
export function thoroughfareStyle(props, opacity) {
  const c = classInfo(props);
  return { color: c ? c.color : "#6b7280", weight: c ? c.weight : 1.2, opacity, fill: false, lineCap: "round", lineJoin: "round" };
}

/* The street name as the city types it ("CALLAVANCE", "US 90A E", "S STADIUM DR") — shouted text reads as words; route numbers and compass letters stay capitals. */
export function streetName(raw) {
  const t = str(raw);
  if (!t) return "";
  if (/[a-z]/.test(t)) return t;
  return t.toLowerCase().replace(/[a-z0-9][a-z0-9']*/g, (w) => {
    const u = w.toUpperCase();
    if (/^(us|fm|sh|ih|tx|rr|n|s|e|w|ne|nw|se|sw)$/i.test(w)) return u;
    if (/^\d/.test(w)) return u;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).replace(/\bMc([a-z])/g, (_m, c) => "Mc" + c.toUpperCase());
}

/* THE 2020 LEGEND'S CLASSIFICATION TABLE — Master Thoroughfare Plan legend (Ordinance 2167, Feb 2020 print), read by the owner. The legend gives CLASSIFICATION ONLY: no right-of-way, and no definition of the letters
 * — so the letters are never expanded and no width is shown (the legend's "(40')" does not say pavement or ROW). Keys are compared with every space removed. A card glosses a code ONLY when the layer's code is exactly
 * a legend row ("C4U-P" is the legend's "C4U - P"); the layer's spellings that are not a legend row (C2U-B, C2U-40-P, P6D-B, C4D-P …) and C4D — the most common code in the layer, NOT on the 2020 legend — show as written. */
export const SECTION_CLASSIFICATION = Object.freeze({
  "L2U": "None, Minor Collector",
  "R2U": "Minor & Major Collector / Arterial / State Hwy",
  "C2U": "Minor & Major Collector",
  "C2U-BIKE": "Minor & Major Collector",
  "C2U(40')-10'LANES": "Minor & Major Collector",
  "C2U(40')-BIKEORPARKING": "Major Collector",
  "C4U": "Major Collector",
  "C4U-P": "Major Collector",
  "C4U-B": "Major Collector",
  "P4D": "Arterial",
  "P4D-B": "Arterial",
  "P6D": "Arterial / State Hwy",
  "P8D": "Arterial / State Hwy",
});
const secKey = (code) => String(code == null ? "" : code).toUpperCase().replace(/\s+/g, "");
/* The legend's classification for a section code, or null (never a guess). */
export const sectionClassification = (code) => SECTION_CLASSIFICATION[secKey(code)] || null;
/* "P4D · Arterial", or the bare code. */
export const sectionWithClass = (code) => { const c = sectionClassification(code); return c ? `${code} · ${c}` : code; };

/* Section codes as written; the "<Null>" string some rows carry is not a code. */
export const sectionCode = (v) => { const t = str(v); return !t || /^<null>$/i.test(t) ? "" : t.toUpperCase(); };

/* True only when BOTH the current and the plan's section are written and they differ — a road the plan would change. No verdict about why or when. */
export function plannedSectionDiffers(props) {
  const cur = sectionCode(props && props.SECTION_TYPE), rec = sectionCode(props && props.RECOMMENDED_SECTION);
  return !!cur && !!rec && cur !== rec;
}
/* A road with a plan section but NO current section (191 of the classed segments, e.g. University Blvd) is also one the plan has something to say about. */
export const hasPlannedSectionOnly = (props) => !sectionCode(props && props.SECTION_TYPE) && !!sectionCode(props && props.RECOMMENDED_SECTION);

const laneText = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : null; };

export function thoroughfareCard(props) {
  const p = props || {};
  const c = classInfo(p);
  const rows = [];
  if (c) rows.push({ label: "Class", text: c.label });
  const cur = sectionCode(p.SECTION_TYPE), rec = sectionCode(p.RECOMMENDED_SECTION), y35 = sectionCode(p.SECTION_2035);
  if (cur) rows.push({ label: "Current section", text: sectionWithClass(cur) });
  if (rec) rows.push({ label: "Plan's recommended section", text: sectionWithClass(rec) });
  if (y35) rows.push({ label: "2035 section", text: sectionWithClass(y35) });
  if (plannedSectionDiffers(p)) rows.push({ label: "Plan differs from current", text: `${cur} → ${rec}` });
  else if (hasPlannedSectionOnly(p)) rows.push({ label: "Plan differs from current", text: `no current section on file → ${rec}` });
  const ln = laneText(p.LANE_NUMBER);
  if (ln) rows.push({ label: "Lanes (city's count)", text: ln });
  return { title: streetName(p.FULL_STREET_NAME) || "Thoroughfare", rows };
}

/* The legend (map ink and legend read the same table). */
export const thoroughfareLegend = () => THOROUGHFARE_ORDER.map((k) => ({ label: THOROUGHFARE_CLASSES[k].label, color: THOROUGHFARE_CLASSES[k].color, weight: THOROUGHFARE_CLASSES[k].weight }));
