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
 *     legend (the Master Thoroughfare Plan PDF, Ordinance 2167), which this build could not read (the city's document host is not reachable from the build environment), so
 *     they are shown AS THE CITY WRITES THEM and never decoded or turned into a right-of-way width.
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
const has = (v) => { const t = str(v); return !!t && !/^(null|none|n\/a|<null>)$/i.test(t); };
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
  if (cur) rows.push({ label: "Current section", text: cur });
  if (rec) rows.push({ label: "Plan's recommended section", text: rec });
  if (y35) rows.push({ label: "2035 section", text: y35 });
  if (plannedSectionDiffers(p)) rows.push({ label: "Plan differs from current", text: `${cur} → ${rec}` });
  else if (hasPlannedSectionOnly(p)) rows.push({ label: "Plan differs from current", text: `no current section on file → ${rec}` });
  const ln = laneText(p.LANE_NUMBER);
  if (ln) rows.push({ label: "Lanes (city's count)", text: ln });
  return { title: streetName(p.FULL_STREET_NAME) || "Thoroughfare", rows };
}

/* The legend (map ink and legend read the same table). */
export const thoroughfareLegend = () => THOROUGHFARE_ORDER.map((k) => ({ label: THOROUGHFARE_CLASSES[k].label, color: THOROUGHFARE_CLASSES[k].color, weight: THOROUGHFARE_CLASSES[k].weight }));
