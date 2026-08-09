/* How a baked NFHL flood polygon PAINTS (NEW-2) — pure, no DOM, no Leaflet, no canvas.
 *
 * The live FEMA layer is a server-rendered picture: FEMA's own renderer decides the colours
 * and we get back a PNG. A tile layer has no such luxury — the client draws it — so the
 * palette has to be stated somewhere, and it has to MATCH what the live layer already paints
 * or a user flipping the flag would see the map change colour underneath them. The reference
 * is the rendering verified in a real browser on 2026-06-17 and recorded on the `fema` config
 * in layers.js: "teal AE floodplain / orange floodway / red boundaries".
 *
 * Keyed on `resolveFloodZone(...).variant`, so this file and the classifier cannot drift and a
 * zone class nobody anticipated lands on a stated default rather than vanishing.
 *
 * ⛔ NOT THEME-SWITCHED, DELIBERATELY. These are an agency's map colours sitting on aerial
 * imagery, not app chrome: FEMA's teal means "1% annual chance" to a floodplain administrator
 * in either theme, and re-hueing it in dark mode would make the map lie. The app's theme rule
 * governs CHROME (see index.css / palette.js); this is content. */

/* Fill + stroke per variant. Alpha is baked into the rgba here rather than applied globally so
 * a floodway can read louder than a 0.2% band at the SAME layer opacity — which is the whole
 * point of the symbology. The layer's own opacity slider multiplies on top. */
const STYLES = {
  // The regulatory 1%-annual-chance floodplain (Zones A, AE, AH, AO, V, VE, A99, AR…).
  sfha:        { fill: "rgba(30, 159, 191, 0.45)",  stroke: "rgba(14, 106, 130, 0.85)", width: 0.75 },
  // The regulatory FLOODWAY — the channel that must be kept clear. The loudest thing here,
  // because it is the one class where "build nothing" is usually the answer.
  floodway:    { fill: "rgba(232, 102, 60, 0.55)",  stroke: "rgba(160, 56, 24, 0.95)",  width: 1 },
  // Shaded Zone X — the 0.2% (500-yr) band. KEPT in the tiles because real rules key off it
  // (COH Ch.19, Fort Bend Interim Atlas-14 §9, Waller Art. 5 §A(8)).
  "shaded-x":  { fill: "rgba(242, 184, 114, 0.40)", stroke: "rgba(176, 118, 46, 0.75)",  width: 0.6 },
  // Future-conditions X — drawn by FEMA in its own class, and NOT the effective regulatory
  // floodplain. Muted on purpose: visible, never mistakable for the SFHA.
  "x-future":  { fill: "rgba(156, 123, 184, 0.30)", stroke: "rgba(106, 78, 132, 0.65)",  width: 0.6 },
  // Area of reduced flood risk due to a levee — again FEMA's own class, again not an SFHA.
  "x-levee":   { fill: "rgba(143, 168, 184, 0.32)", stroke: "rgba(92, 116, 132, 0.65)",  width: 0.6 },
  // Zone D — flood hazard UNDETERMINED. Not "no hazard"; nobody has studied it.
  d:           { fill: "rgba(183, 176, 165, 0.35)", stroke: "rgba(122, 115, 104, 0.7)",  width: 0.6 },
};

/* Anything the classifier lands on `other` — most visibly NFHL's `OPEN WATER` polygons, which
 * are real published features and are not a flood zone. A stated default, never invisible. */
const DEFAULT_STYLE = { fill: "rgba(127, 179, 213, 0.30)", stroke: "rgba(80, 124, 156, 0.6)", width: 0.5 };

/* ⛔ THE TWO VARIANTS THE BUILD DROPS have no style ON PURPOSE — if one ever appears in a tile,
 * something upstream changed and it should paint (loudly, in the default) rather than be
 * silently skipped. Never add a transparent entry for them here to "clean up" the palette. */
export function floodTileStyle(variant) {
  return STYLES[variant] || DEFAULT_STYLE;
}

/* Draw order WITHIN a tile. Painter's algorithm: the biggest, least specific class first so the
 * floodway ends up on top of the AE zone it sits inside. Without this the ordering is whatever
 * order the tile happens to hold, and a floodway can disappear under its own SFHA. */
const PAINT_ORDER = ["other", "d", "x-levee", "x-future", "shaded-x", "sfha", "floodway"];
export const paintRank = (variant) => {
  const i = PAINT_ORDER.indexOf(variant);
  return i < 0 ? 0 : i;
};

/* ---------------------------------------------------------------------------
 * The identify payload. Same shape `vectorOverlay.identifyPayload` produces, so the canvas
 * identify card renders a tile answer and a vector answer identically (layers.identifyOverlaysAt
 * is the shared gate; see its `identifyAt` contract).
 * ------------------------------------------------------------------------- */

/* The headline. Answer-first: the zone code is what a reader is looking for, and the subtype is
 * the only thing that separates the two completely different things both called "Zone X". */
export function floodTileTitle(resolved) {
  if (!resolved) return "Flood zone";
  const { zone, subtype, variant } = resolved;
  if (variant === "floodway") return `Zone ${zone} — regulatory floodway`;
  if (variant === "shaded-x") return "Zone X (shaded) — 0.2% annual chance";
  if (variant === "x-future") return "Zone X — future conditions (not the effective map)";
  if (variant === "x-levee") return "Zone X — reduced risk behind a levee";
  if (variant === "d") return "Zone D — flood hazard undetermined";
  if (resolved.sfha) return `Zone ${zone} — 1% annual chance (SFHA)`;
  return zone ? `Zone ${zone}` : subtype || "Flood zone";
}

/* The rows under the headline. `STATIC_BFE` is absent (not -9999) in the tiles, so a missing
 * base flood elevation simply omits its row rather than printing a sentinel. */
export function floodTileRows(props, resolved) {
  const rows = [];
  if (resolved && resolved.subtype) rows.push({ label: "Subtype", value: resolved.subtype });
  if (props && typeof props.STATIC_BFE === "number") {
    rows.push({ label: "Base flood elevation", value: `${props.STATIC_BFE} ft` });
  }
  rows.push({ label: "In the SFHA", value: resolved && resolved.sfha ? "Yes" : "No" });
  return rows;
}

/* ⛔ THE NOTE THAT RIDES EVERY TILE ANSWER, and the reason it is not optional. A tile is
 * generalised — simplified per zoom and quantised to a tile grid — so its boundary is a
 * PICTURE of the line, never the line. The moment a reader treats this card as the parcel's
 * answer, they are acting on a generalisation. Live FEMA remains the authority for the
 * boundary and for the floodplain-intersection acreage the mitigation math is built on. */
export const FLOOD_TILE_IDENTIFY_NOTE =
  "From the baked FEMA map — fast, and generalised for drawing. The parcel's authoritative " +
  "zone and acreage still come from the live FEMA query.";
