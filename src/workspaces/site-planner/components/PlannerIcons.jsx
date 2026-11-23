/* @planner-extract — AUDIT BATCH G1: the planner's icon tables (tool + rail glyphs), the shared dash <option> list and the hatch pattern def, moved
 * verbatim out of SitePlanner.jsx. Behaviour-identical; see test/helpers/plannerSource.js. */
import { hatchSpec } from "../../../shared/style/hatchPatterns.js";
import { hatchPatternTransform } from "../lib/hatchAnchor.js";
import { GRADING_GLYPH } from "./railGlyphs.js";


// NEW-EASE-STYLE — the ONE renderer that turns a hatch catalog spec (shared/style/hatchPatterns.js)
// into an SVG <pattern>. MODULE-SCOPE (never defined inside SitePlanner's render body — a component
// authored per-render is a fresh type every render, which remounts and thrashes). Used for the
// easement/encumbrance type-default patterns AND any per-element override pattern, so a hatch looks
// identical whichever level (type default or per-object override) produced it. `wash` is the
// background rect's opacity (0 = no rect at all, matching the historic line-only pat-encumber);
// `lineOpacity` is the hatch stroke/dot opacity. Tile is constant SCREEN-PIXEL space (no scale
// ancestor reaches it), so it never turns to mush zoomed out or a solid block zoomed in.
// `labelK` (1 on screen, the export-frame correction — see the render body's `labelFrame`) keeps
// the tile's PHYSICAL size on a printed sheet independent of whatever live zoom was active when
// the export was captured — see B794960: this tile is a constant-canvas-px size with no scale
// ancestor (deliberately, so it never turns to mush/solid on screen at any zoom — see
// shared/style/hatchPatterns.js), but the export clone gets its OWN uniform rescale onto the page
// (buildComposedSheet nests it as `<svg viewBox=…>` at a fixed physical plan-box size), and that
// rescale is exactly as zoom-dependent for a pattern tile as it is for the callout arrowhead this
// item also fixes. `patternTransform` composing a uniform `scale(labelK)` with any existing
// rotation is safe because a uniform scale commutes with rotation.
// NEW-1 (hatchAnchor.js) — `anchor` pins the tile lattice to the GROUND (the render view's feet
// origin) instead of the canvas corner, so a panel drag / resize / pan never slides the stripes.
export function HatchPatternDef({ id, hatchKey, color, washColor = color, wash = 0, lineOpacity = 0.5, labelK = 1, anchor = null }) {
  const spec = hatchSpec(hatchKey);
  const size = spec ? spec.size : 7;
  const tf = hatchPatternTransform({ rotate: spec ? spec.rotate : 0, scale: labelK, anchor });
  return (
    <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse" patternTransform={tf}>
      {wash > 0 && <rect width={size} height={size} fill={washColor} opacity={wash} />}
      {spec && spec.lines && spec.lines.map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.1" opacity={lineOpacity} />
      ))}
      {spec && spec.dot && <circle cx={spec.dot[0]} cy={spec.dot[1]} r={spec.dot[2]} fill={color} opacity={lineOpacity} />}
    </pattern>
  );
}




// PAL (the canvas + panel palette) is now theme-derived inside the SitePlanner
// component from usePalette() — see the adapter at the top of the component body.
// It must be REAL HEXES, not var() tokens: the canvas is SVG and exports to PNG/PDF,
// where CSS variables don't resolve. (B317/B319)

/* Lucide-style 16×16 stroke icons for the tool rail (inherit currentColor). */
const ICON_PATHS = {
  select: <path d="M4 2.5 L12.8 8 L8.8 9 L11.2 13.6 L9.2 14.6 L6.9 9.9 L4 12.4 Z" fill="currentColor" stroke="none" />,
  parcel: <path d="M3 5.2 L8 2.6 L13.2 5.6 L12.2 12.4 L4.2 13.2 Z" />,
  building: <><rect x="2.5" y="4" width="11" height="8.5" rx="0.5" /><path d="M5.5 12.5 v-2.5 h2 v2.5 M10 6.8 h1.5 M4.5 6.8 H6" /></>,
  // NEW-1 (right tool rail) — the Building row's icon SHOWS the current dock layout: a short bar along
  // each loaded long side of the rectangle (cross-dock = both, single-load = one, no docks = none).
  buildingNone: <rect x="2.5" y="4.5" width="11" height="7" rx="0.5" />,
  buildingSingle: <><rect x="2.5" y="4.5" width="11" height="7" rx="0.5" /><path d="M5 14 H11" /></>,
  buildingCross: <><rect x="2.5" y="4.5" width="11" height="7" rx="0.5" /><path d="M5 2 H11 M5 14 H11" /></>,
  paving: <><rect x="2.5" y="2.5" width="11" height="11" rx="1" /><path d="M2.5 9.8 L9.8 2.5 M6.2 13.5 L13.5 6.2" /></>,
  parking: <path d="M5.2 13.5 V2.8 h3.6 a3.1 3.1 0 0 1 0 6.2 H5.2" />,
  trailer: <><rect x="1.8" y="4.5" width="9" height="5.5" rx="0.5" /><path d="M10.8 6.5 h2.6 l0.8 2.4 v1.1 h-3.4" /><circle cx="4.6" cy="11.8" r="1.3" /><circle cx="12.2" cy="11.8" r="1.3" /></>,
  pond: <path d="M8 2.6 C8 2.6 3.6 7.8 3.6 10.4 a4.4 4.4 0 0 0 8.8 0 C12.4 7.8 8 2.6 8 2.6 Z" />,
  road: <><path d="M5.2 2.5 L3.2 13.5 M10.8 2.5 L12.8 13.5" /><path d="M8 3 v2.2 M8 7 v2.2 M8 11 v2.2" /></>,
  easement: <><path d="M2.5 4.5 H13.5 M2.5 11.5 H13.5" /><path d="M2.5 8 H13.5" strokeDasharray="2 1.6" opacity="0.7" /></>,
  measure: <><path d="M2.2 10.8 L10.8 2.2 L13.8 5.2 L5.2 13.8 Z" /><path d="M5.6 7.4 l1.4 1.4 M8 5 l1.4 1.4" /></>,
  combine: <><path d="M2.5 2.5 h7 v4 h4 v7 h-7 v-4 h-4 Z" /></>,
  pan: <path d="M5 7 V3.6 a1.1 1.1 0 0 1 2.2 0 V6.6 M7.2 6.4 V2.9 a1.1 1.1 0 0 1 2.2 0 V6.6 M9.4 6.6 V3.5 a1.1 1.1 0 0 1 2.2 0 V8.5 M11.6 6 a1.1 1.1 0 0 1 2.1 0 l-0.2 4 a4 4 0 0 1-4 3.6 H8 a4 4 0 0 1-3.3-1.8 L2.6 9.6 a1.1 1.1 0 0 1 1.7-1.4 L5 9" />,
  // Marquee/box-select: a dashed selection rectangle with solid corner grips (B570).
  marquee: <><rect x="2.6" y="2.6" width="10.8" height="10.8" rx="0.6" strokeDasharray="2.4 1.8" /><rect x="1.7" y="1.7" width="1.8" height="1.8" fill="currentColor" stroke="none" /><rect x="12.5" y="1.7" width="1.8" height="1.8" fill="currentColor" stroke="none" /><rect x="1.7" y="12.5" width="1.8" height="1.8" fill="currentColor" stroke="none" /><rect x="12.5" y="12.5" width="1.8" height="1.8" fill="currentColor" stroke="none" /></>,
  callout: <><rect x="2.2" y="2.4" width="8.6" height="6" rx="1" /><path d="M5.2 8.4 L4 11.2 L7.2 8.4" /><path d="M11 11.5 L13.8 13.8" /></>,
  text: <><rect x="2.5" y="3" width="11" height="10" rx="1" /><path d="M5.4 6 H10.6 M8 6 V10.6" /></>,
  mline: <path d="M3 13 L13 3" />,
  mrect: <rect x="2.5" y="3.5" width="11" height="9" rx="0.5" />,
  mellipse: <ellipse cx="8" cy="8" rx="6" ry="4.4" />,
  mpolygon: <path d="M8 2.4 L13.4 6.2 L11.3 12.6 L4.7 12.6 L2.6 6.2 Z" />,
  mpolyline: <path d="M2.5 11 L6 5.5 L9 9 L13.5 3.5" />,
  // Revision cloud — the real scalloped outline (8 equal arcs), not a generic weather-cloud glyph,
  // so it reads as the Bluebeam markup rather than "cloud sync". Traced with cloudGeometry.js's own
  // cloudScallopPath so the tool button matches what it actually draws.
  mcloud: <path d="M8 4.4 A 1.55 1.55 0 0 1 12 5.7 A 1.55 1.55 0 0 1 13.6 8.7 A 1.55 1.55 0 0 1 12 11.7 A 1.55 1.55 0 0 1 8 13 A 1.55 1.55 0 0 1 4 11.7 A 1.55 1.55 0 0 1 2.4 8.7 A 1.55 1.55 0 0 1 4 5.7 A 1.55 1.55 0 0 1 8 4.4 Z" />,
  // B543 — deed/title launcher glyph: a document page (folded corner) over a few
  // text lines, signalling "read a deed / title commitment". Same currentColor
  // stroke style (no fill) as the other tool glyphs.
  deed: <><path d="M4.5 2 H9 L12 5 V13 a1 1 0 0 1-1 1 H4.5 a1 1 0 0 1-1-1 V3 a1 1 0 0 1 1-1 Z" /><path d="M9 2 V5 H12" /><path d="M5.6 8 H10 M5.6 10.2 H10 M5.6 12.2 H8.4" /></>,
};
export const ToolIcon = ({ id, size = 15 }) => (
  <svg className="rbtn-icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden="true">
    {ICON_PATHS[id] || <circle cx="8" cy="8" r="5.5" />}
  </svg>
);

// NEW-1 (2026-09-18) — the approved seven-icon rail set (artwork swap only; no panel/routing
// change). Geometry is exact/verbatim per the owner's design handoff — do not rescale, recenter,
// or substitute a stock icon. Keys match the leftTabs ids (parcel="Land", references="Overlays").
const RAIL_ICONS = {
  // Land
  parcel: <path d="m4 6.5 10.5-3 5.5 6-3 10.5L4 17Z" />,
  // Analysis
  analysis: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.2 15.2 4.8 4.8" /></>,
  // Drainage
  drainage: <path d="M3 7.5c3-6 6 6 9 0s6 6 9 0M3 16.5c3-6 6 6 9 0s6 6 9 0" />,
  // Grading (owner-only) — three nested contour lines of a knoll + a filled spot-elevation triangle (artwork: components/railGlyphs.js)
  grading: <>{GRADING_GLYPH.contours.map((d) => <path key={d} d={d} />)}<path d={GRADING_GLYPH.spot} fill="currentColor" strokeWidth={GRADING_GLYPH.spotStrokeWidth} /></>,
  // Yield
  yield: <path d="M19 4H5l7 8-7 8h14" />,
  // Properties
  properties: <><path d="M7 3.5v3m0 5v9M17 3.5v9m0 5v3" /><circle cx="7" cy="9" r="2.5" /><circle cx="17" cy="15" r="2.5" /></>,
  // Overlays — the rear square is intentionally interrupted where the front square crosses it;
  // do not close the rear outline or hide the overlap with a background-colored fill.
  references: <><path d="M8 16H4V4h12v4" /><rect x="8" y="8" width="12" height="12" rx="0.75" /></>,
  // Standards
  standards: <><path d="M4 3.5v17h17Z" /><path d="M4 14h3M10.5 20.5v-3" /></>,
};
export const RailIcon = ({ id, size = 21 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    style={{ display: "block", flex: "none" }} aria-hidden="true" focusable="false">
    {RAIL_ICONS[id] || <circle cx="12" cy="12" r="6" />}
  </svg>
);
export const DASH_OPTIONS = [
  <option key="solid" value="solid">Solid</option>,
  <option key="dashed" value="dashed">Dashed</option>,
  <option key="dotted" value="dotted">Dotted</option>,
  <option key="dashdot" value="dashdot">Dash-dot</option>,
  <option key="longdash" value="longdash">Long dash</option>,
];
