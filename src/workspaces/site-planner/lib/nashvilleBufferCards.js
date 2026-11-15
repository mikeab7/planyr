/* Metro Nashville stormwater buffers + pending / preliminary flood maps (NEW-1 / NEW-2, 2026-11-12) — the PURE click-card wording. No network, no React.
 *
 * Owner constraint #45: a layer's click card is CLEAN — plain labels, no raw field names, no empty or null rows, normal dates, the source / vintage behind the (i). Each builder takes one feature's attributes and
 * returns `{ title, rows: [{ label, text }], note? }`.
 *
 * Owner constraint #4: no distance is printed without the rule record behind it. The ONLY width a card prints is Metro's own `BufferDistance` attribute (floodway and pond layers); the stream and wetland
 * polygons carry NO width, so their cards say what the rule is and where its tiers are — never a per-polygon number Metro did not publish. The tier table lives in the row's (i) (nashvilleLayers.js). */

const clean = (v) => {
  const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim();
  return !s || /^(null|none|n\/?a|unknown|undetermined|0|-{1,2})$/i.test(s) ? "" : s;
};
const row = (label, text) => (clean(text) ? { label, text: clean(text) } : null);
const rowsOf = (...rs) => rs.filter(Boolean);

export const SWMM_CITATION = "Metro Stormwater Manual, Vol. 1, ch. 6 §6.10";
const ASK = "Metro Water Services confirms what applies on a given site.";

/* Metro's BufferDistance is in feet (the layer's spatial reference is Tennessee State Plane feet). A figure that is not a positive number is NOT printed. */
export function feetText(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n)} ft` : "";
}

export function floodwayBufferCard(props) {
  const p = props || {};
  return {
    title: "Floodway buffer — Metro stormwater rules",
    rows: rowsOf(
      row("Buffer beyond the floodway", feetText(p.BufferDistance)),
      row("Rule", `${SWMM_CITATION}: land beside a FEMA floodway stays out of development.`),
    ),
    note: ASK,
  };
}

export function streamBufferCard() {
  return {
    title: "Stream buffer — Metro stormwater rules",
    rows: rowsOf(
      row("Width", "30, 50 or 75 ft by the stream's drainage area and flood study — Metro's map does not say which for this stream"),
      row("Inner zone", "No clearing, grading or building"),
      row("Outer zone", "No structures and no impervious surface"),
      row("Rule", SWMM_CITATION),
    ),
    note: ASK,
  };
}

export function pondBufferCard(props) {
  const p = props || {};
  return {
    title: "Pond buffer — Metro stormwater rules",
    rows: rowsOf(
      row("Buffer", feetText(p.BufferDistance) ? `${feetText(p.BufferDistance)} from the normal pool` : "Measured from the normal pool"),
      row("Rule", SWMM_CITATION),
    ),
    note: ASK,
  };
}

export function wetlandBufferCard() {
  return {
    title: "Wetland buffer — Metro stormwater rules",
    rows: rowsOf(
      row("Buffer", "25 ft from the delineated wetland edge"),
      row("Rule", SWMM_CITATION),
    ),
    note: ASK,
  };
}

/* ---- Metro's copy of FEMA's not-yet-effective maps ---- */
export const MAP_STATE = Object.freeze({
  pending: { title: "Pending", words: "Pending — a revised map Metro lists as not yet in effect" },
  preliminary: { title: "Preliminary", words: "Preliminary — a draft revised map under review, not yet adopted" },
});
export const ZONE_WORDS = Object.freeze({
  "100 YEAR FLOODPLAIN": "100-year floodplain",
  "500 YEAR FLOODPLAIN": "500-year floodplain",
  FLOODWAY: "Floodway",
});
export function zoneWords(desc) {
  const k = clean(desc).toUpperCase().replace(/-/g, " ");
  return ZONE_WORDS[k] || clean(desc);
}

export function pendingFloodCard(props, state) {
  const p = props || {};
  const s = MAP_STATE[state] || MAP_STATE.pending;
  const zone = zoneWords(p.ZoneDescription);
  return {
    title: `${s.title} flood map${zone ? ` — ${zone.toLowerCase()}` : ""}`,
    rows: rowsOf(
      row("Map status", s.words),
      row("Flood zone", clean(p.FloodZone) ? `Zone ${clean(p.FloodZone)}` : ""),
      row("Status noted by Metro", p.Status),
      row("Takes effect", p.Effective),
      row("Study type", p.StudyType),
    ),
    note: "The adopted (effective) map still governs until this one takes effect. Ask Metro Water Services' floodplain administrator whether pending or preliminary data is applied to your project.",
  };
}
