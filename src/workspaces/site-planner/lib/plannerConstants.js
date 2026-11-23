/* @planner-extract — AUDIT BATCH G1: the module-scope constants and small pure helpers that used to sit above the component in
 * SitePlanner.jsx (tool tables, selection/markup constants, geometry helpers, DEFAULT_SETTINGS, the id minter), moved verbatim.
 * Behaviour-identical; see test/helpers/plannerSource.js. */
import { BUTTON_WALL_MIN_PX } from "./buildingButtons.js";
import { DRAG_SLOP_PX } from "./dragGate.js";
import { journalSessionId } from "./elementJournal.js";
import { CLOUD_ARC_DEFAULT_FT } from "./cloudGeometry.js";
import { TYPE } from "./planStyle.js";
import { dist, labelPlaceOf, centroid } from "./planRenderHelpers.jsx";
import { lineIntersect } from "./parcelOffset.js";
import { polyArea, roadDenseCenterline, isCenterlineRoad, roadDefaultRadius } from "./siteGeometry.js";
import { roadClassOf, classMinRadius } from "./roadClasses.js";
import { roadMinRadius } from "./roadGeometry.js";
import { createIdMinter, randomIdSalt } from "../../../shared/ids.js";


/* The record's VOCABULARY (provenance labels, the typed-field list) is imported only by the lazily
 * loaded panel — see lib/parcelArea.js's header for why the two tiers are kept apart. `cleanText` is
 * the one string helper the planner itself needs, and it is three lines, so it lives here. */
export const cleanText = (v) => { const s = (v == null ? "" : String(v)).trim(); return s || null; };


/* NEW-1 — render-loop probe identities. Module-scope constants so naming a run costs no allocation
 * (see src/app/renderLoopProbe.js for why this is recorded unconditionally). The dep NAMES are what
 * make a report readable — "view=51i" is a diagnosis, "dep[0]=51i" is another character count. */
export const GEO_REG_EFFECT = "site-planner:geo-registration";
export const GEO_REG_DEPS = Object.freeze(["view.ppf", "view.offX", "view.offY", "size.w", "size.h", "origin", "geoOverscan", "geoDockX"]);
/* A frozen module-scope zero so the reset path cannot allocate a fresh object per call. */
export const ZERO_REG_SHIFT = Object.freeze({ dx: 0, dy: 0 });
export const PANEL_SHIFT_EFFECT = "site-planner:panel-shift";
export const PANEL_SHIFT_DEPS = Object.freeze(["leftPanel", "narrow", "companionSel", "narrowProps", "leftWidth", "size.w"]);

/* Geographic basemap under the planner canvas. The planner stays a feet-based
 * SVG (so every metric, setback and stall count is computed from true feet and
 * is unaffected by display projection); we just place a Leaflet Web-Mercator
 * basemap + the shared overlay layers beneath it, anchored to the site origin.
 * Mercator is conformal, so a uniform pixels-per-foot aligns to it with no x/y
 * distortion over a site — only the basemap's zoom/center are derived from the
 * planner view. */
// The aerial source registry is shared with the map finder (lib/basemaps.js, B693) —
// the planner's Basemap control offers the same Esri/USGS sources as the finder's
// Imagery dropdown, plus "Off". (The old single-source GEO_BASEMAP constant became
// BASEMAPS.esri.)
// How far the basemap container overhangs the viewport on each side (px). The
// extra margin (with keepBuffer tiles loaded) means a pan/zoom that CSS-transforms
// the basemap reveals already-loaded imagery instead of the backdrop (B65).
// NEW-7 — this is now the CEILING, not a constant: lib/tileBudget.js steps it (and the
// matching keepBuffer) down on a heavy plan, a constrained device, or a small window,
// because measured it made the tile container 3.9x the visible pixel area before retina.
// (the ceiling itself is OVERSCAN_FULL in lib/tileBudget.js — the single place the policy lives)
// ppfToZoom now lives in lib/mapLock.js beside the feet↔lat/lng projection it has to agree
// with — the two ARE one model, and splitting them across files is how they silently drifted
// apart (NEW-1). Always anchor it at the SITE ORIGIN latitude, never the panned-to centre.

/* ------------------------------------------------------------------ *
 *  Industrial Site Planner — prototype (TestFit-style, industrial)
 *  Units: everything internal is in FEET. The canvas <g> scales
 *  feet -> pixels via pxPerFoot + pan offsets. Labels & handles are
 *  drawn in screen (pixel) space for crisp, zoom-independent UI.
 * ------------------------------------------------------------------ */

/* NEW-1 — the ONE surface every docked left-rail panel (Land, Analysis, Drainage, Yield, Properties, Overlays,
 * Standards) sits on: white in light, the matching overlay surface in dark. It used to be the grey column
 * backdrop (--planner-panel) with only Analysis overridden per-panel, so every other panel read as a grey wall. */
export const LEFT_PANEL_SURFACE = "var(--surface-overlay)";
export const MONO_FONT = "ui-monospace, monospace";   // same reason — spelled out 21× before this

export const POND_ADD_MIN_SF = 50; // B157: below this, an expansion is too small to seat its own added-area label
// Corner bump-out (dog-ear) defaults + geometry live in lib/dogEar.js (pure, unit-tested — B362).
// B225: the building feature-add buttons (+/− dock, sidewalk, parking, bump-out) are
// FIXED-PIXEL overlays inset ~22px inside each wall. When a building's rendered
// footprint shrinks below them (zoomed out) the cluster grows larger than the
// footprint and spills past the edges into an unreadable pile. Each button is gated on
// the on-screen size of the wall it hangs off, in PIXELS (resolution-independent — real
// building sizes vary too much for one zoom number): a wall's inset +/− only shows when
// its PERPENDICULAR on-screen dimension clears the cluster. ~22px inset + 9px radius on
// each side means opposite buttons overlap below ~68px; this adds a small legibility
// margin. Tunable. (The map's Building Pin + Progress Arc live in MapFinder — untouched.)
// ⛔ NEW-2 — THIS GATE IS ABOUT THE CONTAINER, AND IT IS ONLY HALF THE ANSWER. It asks whether the
// BUILDING is big enough on screen to seat the cluster, which a 900 ft industrial building clears
// at almost any zoom a site plan is read at — so on the owner's 109-acre Bain plan the controls
// armed with the whole site in the viewport, at full size, over the two largest objects on the
// drawing. The second gate (`lib/featureEditZoom.js`) asks whether the EDIT is legible yet, in
// feet per pixel. Both must pass; read that module's header before changing either.
export const FEAT_BTN_MIN_PX = BUTTON_WALL_MIN_PX;   // one number, in lib/buildingButtons.js (the grading label placer reads the same wall filter)
// B310 — parcel click-vs-drag: a press on a (locked) parcel pans the canvas; only a brief,
// low-travel pointer-up counts as a real click that selects it. So panning across parcels no
// longer constantly mis-fires as a selection. Travel is in SCREEN px (zoom-independent); the
// time window lets a slow, precise click that drifts a pixel or two still select, while any
// real drag pans. This is the hand-rolled fallback the standard map engines use internally.
// NEW-1 — ONE definition of "how far may a click drift", shared with the element/parcel/vertex/
// handle drag gate in lib/dragGate.js, so the pan path and the move path can never disagree about
// what counts as a click. (The DURATION below belongs to the pan test ONLY — a slow press that
// never moves is still a click, and the move gate deliberately has no clock. See dragGate.js.)
export const PARCEL_CLICK_SLOP_PX = DRAG_SLOP_PX; // max pointer travel (px) to still count as a click, not a pan
export const PARCEL_CLICK_MS = 400;      // max press duration (ms) to still count as a click
// B1092 — how close a tap must land to a GIS LINE feature (a channel centreline) to
// identify it, on screen. Polygons hit-test by containment and ignore this.
export const CANVAS_IDENTIFY_SLOP_PX = 14;
/* B1349/B1121(b) — the hard ceiling on how long a LOAD-kind drainage auto-check will wait for an
 * idle main thread before firing regardless. It is a `requestIdleCallback` timeout, so it is a
 * BOUND, not a delay: on a quiet page the pass runs at the first idle slot, and on a page that
 * never goes idle it still fires here. B874's "the attempt always fires" invariant depends on
 * this being finite — never remove it in favour of a bare requestIdleCallback. */
export const DRAIN_AUTO_IDLE_TIMEOUT_MS = 4000;
// Feet per degree, the SHORTER of the two axes at this latitude band (longitude at ~30°N),
// so a tolerance in degrees is never tighter than the on-screen slop it came from.
export const FT_PER_DEG_MIN = 300000;

/* B1600353 — how long the boot framing keeps retrying a container it cannot yet measure, on a WALL
   CLOCK. Bounded on purpose: an unbounded retry against a container that will never exist is a leak,
   not a rescue, and the wake listeners cover anything slower. */
export const BOOT_FRAMING_RETRY_MS = 10000;

export const TOOLS = [
  { id: "select", label: "Select", hint: "Move/resize/rotate • drag to move (snap only ALIGNS to the grid/edges, never bonds; hold Alt to bypass) • Shift-click or marquee to pick several, then Group (Ctrl+G) so they move/copy/select as one unit; double-click a group member to edit it in place • on a selected parcel: drag a dot to move a corner, click a + to add one, Shift-click a dot to delete • something buried behind another object? Alt-click (or Alt-right-click for its menu) reaches it — repeat at the same spot to go deeper • drag empty space to pan • shortcut: V" },
  { id: "marquee", label: "Select multiple", hint: "Box-select (M): drag a box over the drawing — everything it touches is selected together, ready to move (drag any one) or delete. In the Select tool you can also Ctrl/⌘-click to toggle an object, Shift-click to add. Esc / click empty to clear" },
  { id: "parcel", label: "Parcel", hint: "Draw mode: click to drop boundary points, then click the first point (or double-click) to close — draw as many as you like • Remove mode: click a parcel to delete it • click Done (or Esc) to exit" },
  { id: "split", label: "Split", hint: "Cut a parcel: click points to draw the line across it — two points cut straight, or add as many as you like for a bent or stepped cut following a creek, a road or an easement; double-click (or Enter) to finish. A cut that leaves the lot and comes back makes more than two pieces — then delete any you don't want" },
  { id: "callout", label: "Callout", hint: "Annotation (Q): click the point you're calling out, then click where the text box goes, and type. Drag the box to move it, the dot to re-aim the leader; double-click to edit the text. Drag a side handle to set a fixed width (text wraps); Alt+Z shrinks the box back to fit its text" },
  { id: "text", label: "Text", hint: "Text box (T): click where the text goes and type — no leader line. Same size / align / colour / bold / italic options. Drag to move, double-click to edit; Alt+Z shrinks the box to fit its text" },
  { id: "building", label: "Building", hint: "Drag for a rectangle, or click points for an irregular footprint (click the 1st point / double-click to close)" },
  { id: "paving", label: "Paving", hint: "Drag for a rectangle, or click points for an irregular paving / drive / truck court (double-click to close)" },
  { id: "parking", label: "Car Parking", hint: "Pick a row preset from Car Parking ▾ (single 42′ / double 60′) and drag to set the length, or use Free draw for any rectangle / click points for an irregular field; stalls auto-count" },
  { id: "trailer", label: "Trailer Parking", hint: "Drag for a rectangle, or click points to outline irregular trailer storage (double-click to close); auto-counts" },
  { id: "pond", label: "Detention Pond", hint: "Drag for a rectangle, or click points to outline an irregular detention area (double-click to close)" },
  { id: "road", label: "Road", hint: "Pick a width (or Custom width…), then click to drop centerline points — Enter or double-click to finish, Backspace to undo a point, Esc to cancel. Curve each vertex sharp / arc / smooth in the panel. The width is the pavement measured CURB FACE TO CURB FACE; the 6″ curb rides outside it (a 24′ road covers 25′ back-of-curb to back-of-curb)" },
  { id: "easement", label: "Easement", hint: "Draw an easement (Easement ▾ for mode). Centerline+width: click a path, double-click/Enter to finish — it builds a strip of the set width. Boundary: click points, close on the first dot. Offset from parcel edge: click a parcel's edges then Enter. Edit attributes (type/holder/width…) in the Element panel; width re-offsets the strip live" },
  { id: "measure", label: "Measure", hint: "Pick a mode from Measure ▾ — Length (two-point distance), Polylength (click a path, double-click / Enter to finish), Area (outline a region, click the first dot or double-click to close), or Count (click to mark items, Enter to finish)" },
  { id: "mline", label: "Line", hint: "Markup line (L): drag end-to-end. Hold Shift for 45° increments" },
  { id: "mrect", label: "Rectangle", hint: "Markup rectangle (R): drag a box. Hold Shift for a square" },
  { id: "mellipse", label: "Ellipse", hint: "Markup ellipse (E): drag a box. Hold Shift for a circle" },
  { id: "mpolygon", label: "Polygon", hint: "Markup polygon (Shift+P): click points, click the first dot or double-click to close. Shift for 45° segments" },
  { id: "mpolyline", label: "Polyline", hint: "Markup polyline (Shift+N): click points, double-click / Enter to finish. Shift for 45° segments" },
  { id: "mcloud", label: "Cloud", hint: "Revision cloud (C): click to place a point and continue the path, or drag to trace freehand — mix freely, close on the first dot / double-click / Enter. Arc size, colour and the rest are on the Properties panel once it's selected" },
];
export const DRAW_TYPES = ["building", "paving", "road", "parking", "trailer", "pond"];
export const MARKUP_TOOLS = ["mpolyline", "mline", "mrect", "mellipse", "mpolygon", "mcloud"];
// Measure-mode display names — Bluebeam's terms (Length / Polylength / Area). The
// internal mode value stays line/polyline/area (persisted in localStorage), so this is
// label-only; "Polylength" also disambiguates the measurement from the markup "Polyline".
export const MEASURE_MODES = [["line", "Length"], ["polyline", "Polylength"], ["area", "Area"], ["count", "Count"]];
// Road width presets (feet), from the user-editable Standards → Roads "Road widths (ft)" list.
// The number is the pavement CURB FACE TO CURB FACE (B180) — the curb is added outside it.
const DEFAULT_ROAD_WIDTHS = "24, 26, 30, 36, 40";
export const roadWidthPresets = (settings) => (settings?.roadWidths ?? DEFAULT_ROAD_WIDTHS).split(",").map((s) => s.trim()).filter((s) => Number.isFinite(+s) && +s > 0);
export const DEFAULT_ROAD_WIDTH = roadWidthPresets(null)[0]; // "24"
// NEW-2 — the one-line hint under each mode in Measure ▾. Each states what ACTUALLY finishes the
// measurement (verified by e2e/measure-menu.spec.js): Enter or a double-click commits Polylength and
// Count, Area closes on a double-click (or the first dot), Length is exactly two clicks.
export const MEASURE_HINTS = { line: "Two clicks, straight line", polyline: "Click points; double-click or Enter to finish", area: "Click corners; double-click to close", count: "Click each item; double-click or Enter to finish" };
export const measureModeLabel = (m) => { const e = MEASURE_MODES.find(([k]) => k === m); return e ? e[1] : m; };
export const MAX_DIM = 100000; // ft — sane upper clamp so a fat-fingered size can't make absurd geometry / SVG stalls
// Relational tags that point at OTHER elements (a host building or a truck court). A copy/paste
// or duplicate starts standalone, so strip them all — keeping them would dangle a link to an
// element that wasn't cloned (orphan court / dog-ear metadata that refit/trailer logic reads).
// `groupId` is included so a LONE paste/duplicate starts ungrouped (B261) — duplicating a
// whole group is a separate path that re-stamps a fresh shared group id (duplicateGroup).
// B1124 — `prevZone` (the generic outward-stack bond added in B495) was MISSING from this list, so a
// lone duplicate of a chain zone kept a link to the original chain. It is an element id like the rest.
const ORPHAN_TAGS = ["attachedTo", "groupId", "truckCourt", "forCourt", "forTrailer", "prevZone", "dogEar", "oppSide", "sideParkSide", "sidewalkSide"];
export const detachClone = (src) => { const c = { ...src }; for (const k of ORPHAN_TAGS) delete c[k]; return c; };
// Platform-correct modifier name for keyboard hints in prose ("⌘V" vs "Ctrl+V").
export const MOD_LABEL = (typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "")) ? "⌘" : "Ctrl+";
// NEW-1 — this TAB's pending-edit journal session id (sessionStorage-backed: survives a reload in
// place, distinct across tabs — two live writers never share a journal key; see elementJournal.js).
export const journalSid = journalSessionId();
export const MK_DEFAULT = { stroke: "#c2410c", weight: 2, dash: "solid", fill: "#c2410c", fillOpacity: 0 };
// Cloud's OWN sticky style, kept separate from MK_DEFAULT/mkStyle — every other markup tool shares
// one "last used" style, so if Cloud read from that shared state it would inherit whatever colour
// was last drawn (starting from MK_DEFAULT's #c2410c, the exact collision the tool's spec forbids).
// #2563EB is `familyInk.js` FAMILY_DEFAULT_INK.cloud — measured ≥12 ΔE00 from every other drawn
// family's default ink (test/familyInk.test.js). arcFt rides the same sticky-default mechanism as
// every other style field here (NEW-1, B770896) — a cloud's arc size is a per-object property with
// a remembered default, exactly like its stroke weight, not a separate piece of pre-draw config.
export const MK_CLOUD_DEFAULT = { stroke: "#2563EB", weight: 2, dash: "solid", fill: "#2563EB", fillOpacity: 0, arcFt: CLOUD_ARC_DEFAULT_FT };
// NEW-4 — what the recently-used swatch row shows on a fresh browser: the plan's own default
// palette (every element type's fill + line, plus the markup accent), so the row is never blank.
// Derived from TYPE, never a second hardcoded list that could drift from it.
export const COLOR_SEED = [...new Set([MK_DEFAULT.stroke, ...Object.values(TYPE).flatMap((t) => [t.fill, t.stroke])].map((c) => (c || "").toLowerCase()))].filter(Boolean);
export const dashArray = (d, w) => d === "dashed" ? `${w * 3} ${w * 2.4}` : d === "dotted" ? `${w} ${w * 2}` : d === "dashdot" ? `${w * 3} ${w * 1.6} ${w} ${w * 1.6}` : d === "longdash" ? `${w * 6} ${w * 3}` : undefined;

// B619 — neutral, handle-based selection chrome for the planner canvas. Selecting an object must
// NEVER recolor the object's own fill/stroke (that reads as "the object turned orange" and hides a
// live color change); selection is signalled by WHITE square handles with a thin BLUE outline.
// Real hexes, NOT var() tokens — the canvas is SVG that exports to PNG/PDF where CSS vars don't
// resolve (B317/B319). Blue is chosen over black (which vanishes on the dark aerial and reads heavy
// over light linework) and over the app accent (the "it turned orange" trap); it is none of the five
// status colors or three module accents. All selection chrome carries data-export="skip" so it never
// lands in an exported exhibit. (Generalizes the B231 pond / B567 neutral-markup no-recolor rule.)
export const SEL_BLUE = "#2563eb";
export const SEL_HANDLE_FILL = "#ffffff";
// B848720 — the selection outline for a box-kind markup / a selected element must sit OUTSIDE
// the feature's own stroke, never traced exactly over it: a thin blue line drawn on the SAME
// path as the user's own coloured outline reads as "a blue line painted on my shape", not as a
// selection cue (owner report — an orange-outlined markup rect read as a blue line drawn on an
// orange shape). Both elSelOutline and markupHandles' box-kind branch grow the outline outward
// by this many screen px (constant regardless of zoom, matching every other handle in this
// file) via outsetPolygon / a local half-extent expansion, so the outline can never repaint a
// feature's own colour however the user set it.
export const SEL_OUTLINE_GAP_PX = 4;
// B617 — hold a line's on-screen weight CONSTANT RELATIVE TO THE DRAWING across zoom. A stroke drawn
// in fixed screen px balloons on zoom-out (the geometry shrinks but the stroke doesn't) and hairlines
// on zoom-in. Multiplying the base weight by the SAME zoom factor the callouts use (zk = view.ppf /
// 0.35) makes the stroke track the drawing; the clamp keeps it from vanishing at extreme zoom-out
// (floor) or getting absurd at extreme zoom-in (ceil). Scoped to stroke-only linear features (markup
// lines/polylines, utility routes, easement/encumbrance spines, road curbs, dominant property/element
// outlines); pond/building filled-area edges keep their fixed pixel edge (the fill carries the shape).
const STROKE_ZOOM_FLOOR = 0.6;
export const strokeZoom = (base, zk) => Math.max(STROKE_ZOOM_FLOOR, Math.min(base * zk, base * 3.5));
// Snap an angle to the nearest 45° (for Shift-constrained drawing).
export const snap45 = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, r = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4); return { x: a.x + r * Math.cos(ang), y: a.y + r * Math.sin(ang) }; };

/* ----------------------------- geometry ---------------------------- */
// Black or white label text depending on how light the element's fill is.
export const labelInk = (hex) => {
  const h = (hex || "#ffffff").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 0.6 ? "#1a1a1a" : "#ffffff";
};
// Pick the CSS resize cursor that matches an on-screen direction vector
// (so grips read correctly even when the element is rotated).
export const resizeCursor = (dx, dy) => {
  let a = (Math.atan2(dy, dx) * 180) / Math.PI;
  a = ((a % 180) + 180) % 180; // fold to [0,180)
  if (a < 22.5 || a >= 157.5) return "ew-resize";
  if (a < 67.5) return "nwse-resize";
  if (a < 112.5) return "ns-resize";
  return "nesw-resize";
};
// Snap a dragged rectangle flush against nearby axis-aligned rectangles.
// Returns an adjusted {cx,cy}. thr = contact/alignment threshold in feet.
export const edgeSnapCenter = (moved, others, thr) => {
  let cx = moved.cx, cy = moved.cy;
  const hw = moved.w / 2, hh = moved.h / 2;
  const mx0 = cx - hw, mx1 = cx + hw, my0 = cy - hh, my1 = cy + hh;
  let bestX = { d: thr }, bestY = { d: thr }, alignX = { d: thr }, alignY = { d: thr };
  for (const t of others) {
    if (t.points || (((t.rot % 360) + 360) % 360) !== 0) continue;
    const thw = t.w / 2, thh = t.h / 2;
    const tx0 = t.cx - thw, tx1 = t.cx + thw, ty0 = t.cy - thh, ty1 = t.cy + thh;
    const yNear = Math.min(my1, ty1) - Math.max(my0, ty0) > -thr; // roughly side-by-side
    const xNear = Math.min(mx1, tx1) - Math.max(mx0, tx0) > -thr; // roughly stacked
    if (yNear) {
      let d = Math.abs(mx0 - tx1); if (d < bestX.d) bestX = { d, cx: tx1 + hw }; // our left → their right
      d = Math.abs(mx1 - tx0); if (d < bestX.d) bestX = { d, cx: tx0 - hw };     // our right → their left
      let dy = Math.abs(my0 - ty0); if (dy < alignY.d) alignY = { d: dy, cy: ty0 + hh };
      dy = Math.abs(my1 - ty1); if (dy < alignY.d) alignY = { d: dy, cy: ty1 - hh };
    }
    if (xNear) {
      let d = Math.abs(my0 - ty1); if (d < bestY.d) bestY = { d, cy: ty1 + hh }; // our top → their bottom
      d = Math.abs(my1 - ty0); if (d < bestY.d) bestY = { d, cy: ty0 - hh };     // our bottom → their top
      let dx = Math.abs(mx0 - tx0); if (dx < alignX.d) alignX = { d: dx, cx: tx0 + hw };
      dx = Math.abs(mx1 - tx1); if (dx < alignX.d) alignX = { d: dx, cx: tx1 - hw };
    }
  }
  if (bestX.cx !== undefined) { cx = bestX.cx; if (alignY.cy !== undefined) cy = alignY.cy; }
  if (bestY.cy !== undefined) { cy = bestY.cy; if (alignX.cx !== undefined) cx = alignX.cx; }
  return { cx, cy };
};
// Proper segment crossing (excludes shared endpoints / collinear touches). Used to
// reject self-intersecting "bow-tie" outlines, whose shoelace area is silently wrong.
const segsCross = (p1, p2, p3, p4) => {
  const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const o1 = o(p1, p2, p3), o2 = o(p1, p2, p4), o3 = o(p3, p4, p1), o4 = o(p3, p4, p2);
  return !!o1 && !!o2 && !!o3 && !!o4 && o1 !== o2 && o3 !== o4;
};
// Does a closed ring cross itself? O(n²), fine for hand-drawn shapes (few vertices).
export const polySelfIntersects = (pts) => {
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if ((i + 1) % n === j || (j + 1) % n === i) continue; // adjacent / wrap edges share a vertex
    if (segsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  }
  return false;
};
// Measure records are {mode, pts}. Old records were {a,b} — normalize both.
export const measPts = (m) => (m.pts ? m.pts : (m.a && m.b ? [m.a, m.b] : []));
export const measMode = (m) => m.mode || "line";
// Neutral markup shapes that support Bluebeam-style geometry editing: vertex shapes
// (line/polyline/polygon/cloud) expose draggable control points; box shapes (rect/ellipse)
// resize + rotate via grips. Semantic markups (encumbrance/easement) stay
// move-only — they carry derived geometry that hand-editing would desync.
// A cloud is ALWAYS stored as a vertex ring (`pts`), whichever of its three draw modes made it
// (polygon click-path, rectangle drag, or freehand) — never a centre-box — so it reshapes via the
// SAME vertex idiom as a building footprint / polygon markup, per spec.
export const MK_VERTEX_KINDS = ["line", "polyline", "polygon", "cloud"];
export const MK_BOX_KINDS = ["rect", "ellipse"];
// NEW-1 (layout "A") — the neutral drawing markups that share the three-section inspector.
export const NEUTRAL_MARKUP_KINDS = ["line", "polyline", "rect", "ellipse", "polygon", "cloud"];
// Width (screen px) of the transparent fat hit-stroke under open-path markups (line/polyline),
// so they grab within ~6px on either side at any zoom — matching a polyline's forgiving feel (B155).
export const MK_HIT_PX = 12;
// NEW-2 — width (screen px) of a callout's border/frame band for the LOCATION-based double-click:
// a double-click landing this close to the box perimeter opens Properties; deeper inside (the text
// region) edits the text. Screen px so the band is the same at every zoom (mirrors hitTest's 6px).
export const CALLOUT_BORDER_BAND_PX = 6;
// How close (px) a measurement/line start-click must be to a parcel boundary to snap onto it and
// arm the Shift "perpendicular-to-the-property-line" lock (NEW). Same feel as MK_HIT_PX.
// EDGE_LOCK_PX / EDGE_LOCK_MAX_FT / edgeLockTolFt now live in lib/edgeConstrain.js beside the
// magnet they bound (NEW-2(d)), so the cap is unit-tested rather than buried in this file.
export const mkPts = (m) => (m.kind === "line" ? [m.a, m.b] : (m.pts || []));
export const setMkPts = (m, pts) => (m.kind === "line" ? { ...m, a: pts[0], b: pts[1] } : { ...m, pts });
export const mkMinPts = (m) => (m.kind === "polygon" || m.kind === "cloud" ? 3 : 2);
// B230 — nearest point on segment a→b to p (all {x,y}); lets a Shift-click / right-click
// drop a control point EXACTLY where the user touched the edge (Bluebeam-style), not at the
// old fixed midpoint. Returns the point + its distance for hit-testing.
export const projToSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  let t = L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = a.x + t * dx, y = a.y + t * dy;
  return { x, y, d: Math.hypot(p.x - x, p.y - y) };
};
export const pathLen = (pts) => { let t = 0; for (let i = 1; i < pts.length; i++) t += dist(pts[i - 1], pts[i]); return t; };

/* Shared inline-style atoms (NEW-2 perf pass, the B1093 pattern). These exact object literals were
 * repeated dozens of times across the panels — each copy is its own object in the bundle AND a new
 * identity every render. One definition each: byte-identical output, stable identity, smaller chunk.
 * Pure values only — anything reading PAL (theme) has to stay inside the component. */
export const ROW6 = { display: "flex", alignItems: "center", gap: 6 };
export const ROW4 = { display: "flex", alignItems: "center", gap: 4 };
export const INK_HALO = { paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 };
/* NEW-6 — the base size (at working zoom) of each centroid FEATURE-NAME label. These are the three
 * labels that were authored as a bare constant screen size with no zoom ramp and no fit test; the
 * numbers are their historic sizes, unchanged, and they are now the `basePx` handed to
 * `featureNameFontPx` / `featureNameLabelVisible` rather than a final font size. Named here so the
 * gate and the render cannot drift, and so a new one cannot be added without choosing a base. */
export const EASE_LABEL_BASE_PX = 10.5;      // easement — the reported case (B435536)
export const ENCUMBER_LABEL_BASE_PX = 11;    // deed encumbrance boundary
/* The one line-style choice list, shared by every dash <select> (parcel boundary + setback, as a
 * Standards default and as a per-object override, plus the markup/easement pickers). */
export const PARCEL_FILL_DEFAULT = "#5b6650"; // the fill colour a parcel takes when its Fill opacity is first raised above 0

// B935 — perpendicular inset (feet) that tucks a closed easement ring's inline label just INSIDE its
// boundary: a fraction of the ring's smaller bbox dimension (so it scales with the shape and never
// overshoots the middle), aimed at the centroid by the caller.
function ringLabelInsetFt(ptsFeet) {
  if (!ptsFeet || ptsFeet.length < 3) return 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ptsFeet) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return Math.max(0, Math.min(maxX - minX, maxY - minY) * 0.2);
}
// B935 — the { insetFt, interiorFeet } an easement passes to inlineLabelEls when its inline label is
// set to "Inside" placement. A STRIP (open centerline) tucks toward one side by a quarter of its
// width; a BOUNDARY ring aims at its centroid, inset a fraction of its smaller extent. Returns {} for
// the classic on-the-line ride (labelInside off).
export function easementInsetOpts(m) {
  const place = labelPlaceOf(m);
  if (place !== "inside") return { place };
  const strip = m.centerline && m.mode !== "boundary" && m.centerline.length >= 2;
  if (strip) return { place, insetFt: Math.max(0, (+m.width || 0) / 4) };
  return { place, insetFt: ringLabelInsetFt(m.pts), interiorFeet: centroid(m.pts) };
}

/* Outward (EXPANDING) offset by d>0 — pushes every edge out along its outward normal,
 * the opposite of offsetPolygon (which is inward-only, for setbacks/taper). Same miter/
 * bevel handling; selects the variant that GROWS the ring. Used by the pond "push banks
 * out" expansion (B139). Returns null if it can't build a sane ring; callers must ALSO
 * reject a self-intersecting result (tight concave corners) and fall back to drag. */
export function expandPolygon(pts, d) {
  const n = pts.length;
  if (n < 3) return null;
  if (!(d > 0)) return pts.map((p) => ({ x: p.x, y: p.y }));
  const build = (sign) => {
    const off = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const ex = -(b.y - a.y), ey = b.x - a.x; // left normal of edge a→b
      const len = Math.hypot(ex, ey);
      if (len === 0) { off.push(null); continue; }
      const k = (sign * d) / len;
      off.push({ ax: a.x + ex * k, ay: a.y + ey * k, bx: b.x + ex * k, by: b.y + ey * k });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const e1 = off[(i - 1 + n) % n], e2 = off[i];
      if (!e1 && !e2) { out.push(pts[i]); continue; }
      if (!e1) { out.push({ x: e2.ax, y: e2.ay }); continue; }
      if (!e2) { out.push({ x: e1.bx, y: e1.by }); continue; }
      const p = lineIntersect(e1.ax, e1.ay, e1.bx, e1.by, e2.ax, e2.ay, e2.bx, e2.by);
      if (!p) { out.push({ x: e1.bx, y: e1.by }, { x: e2.ax, y: e2.ay }); continue; }
      const lim = Math.abs(d) * 6 + 1; // bevel a runaway miter spike instead of keeping it
      if (Math.hypot(p.x - e1.bx, p.y - e1.by) > lim) out.push({ x: e1.bx, y: e1.by }, { x: e2.ax, y: e2.ay });
      else out.push(p);
    }
    return out.length >= 3 ? out : null;
  };
  const a1 = build(1);
  if (!a1) return build(-1);
  return polyArea(a1) >= polyArea(pts) ? a1 : (build(-1) || a1); // outward must GROW
}
/* Ray-cast point-in-ring (even-odd) — powers the pond expansion's "past the property
 * line" screening warning (B139) and the building-under-footprint lookup. Imported from
 * lib/ringMath.js: this file used to carry TWO copies of it (here and `ringHas`), and six
 * more lived across lib/. */

/* detentionStorage(ring, depth, freeboard, slope) — the pond stage/volume calc —
 * moved to lib/pondGeom.js (B630) so the yield metrics pass and the pure auto-size
 * solver can share it. Same signature/return; imported above. */

/* ------------------- utility service routing (elec/water) ------------------ */
export function nearestOnSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}
/* --------------------------- parking math -------------------------- */
// carStalls / trailerStalls / estStalls / estTrailers moved to ./lib/siteGeometry.js
// (site-metrics-extraction) — pure, shared with lib/siteMetrics.js.

/* --------------- parking row stepping (double-loading) ------------- */
// parkDepthForRows / parkRowsForDepth / splitParkingPieces are pure (unit-tested
// in test/parking.test.js) and imported from lib/parking.js. A drive aisle is
// double-loaded when it has a stall row on BOTH sides: depth(n) = n·stallDepth +
// ⌈n/2⌉·aisle (one aisle shared per pair of rows).

/* ------------------------- curbs (derived) ------------------------- */
// curbWidthOf / curbEdgesOf / curbAreaOf (+ their curbHost/outwardCurbEdge/sidewalkBetween
// internals) moved to ./lib/siteGeometry.js (site-metrics-extraction) — pure, shared with
// lib/siteMetrics.js. `curbAreaFrom`'s resolved-neighbour fast path (B1352) is retired: nothing
// outside the render's own `resolveElNeighbors` record needs it any more, and `curbAreaOf(el,
// allEls)` — called directly by lib/siteMetrics.js — computes the identical number.

/* ---- Centerline road geometry (B596–B598 / NEW-1..3) ----
 * A centerline road carries pts + per-vertex treatment (vtx) + travelW + curb + roadClass.
 * Its surface, curbs and dimension all DERIVE from these via roadCenterline (B597) fed
 * through the shared bufferPolyline / offsetPolyline offset primitives (B598) — no new
 * geometry dependency. The legacy rotated-rect road (no `pts`) keeps the old render.
 * isCenterlineRoad / roadCurbWidth / roadDefaultRadius / roadDenseCenterline / roadStripRing /
 * roadStripArea moved to ./lib/siteGeometry.js (site-metrics-extraction) — pure, shared with
 * lib/siteMetrics.js. */
// Snap-and-connect (B945/NEW-1): a road endpoint magnet engages within ~12 screen px of a
// candidate endpoint, but never welds across more than this in real-world feet (so it can't
// bridge a large gap when zoomed out). ROAD_FIX_MAX_NUDGE_FT bounds NEW-2's tier-3 corner nudge.
export const ROAD_CONNECT_MAX_FT = 10;
export const ROAD_FIX_MAX_NUDGE_FT = 50;
// NEW-3 — how far the corner solver may RUN AN APPROACH OUT past a road end so a class turn fits.
// Bounded so a road never grows an arbitrary tail; the extension follows the leg's own bearing, so
// the alignment is unchanged and a weld at that end just slides along the pavement it already meets.
export const ROAD_FIX_MAX_EXTEND_FT = 25;
// NEW-5 — below this zoom a radius flag folds to just its corner dot. A fixed-pixel label on a
// whole-site view sprawls across the plan and reads as attached to nothing (owner, 2026-07-25).
export const ROAD_FLAG_LABEL_PPF = 0.5;
// B953/NEW-1 — detect road tees for the clean-intersection render. A tee = a centerline road's
// ENDPOINT coincident with an INTERIOR vertex of another centerline road (the B945/B949 tee
// topology, where planRoadConnect inserted a vertex on the through road at the weld point). Returns
// [{ sideId, throughId, T, geom }] with geom = teeGeometry(...) in world feet (or skips a non-tee).
// The return radius seeds from the side road's class (classReturnRadius) unless the side road stores
// an explicit el.tee override for this through road. Pure over (els, settings); memoized at the call site.
// TEE_COINCIDE_FT / TEE_COINCIDE_MAX_FT / teeCoincideFt moved to ./lib/siteGeometry.js
// (site-metrics-extraction) — pure, shared with lib/siteMetrics.js.
// roadRunFrom / roadTangentNoise / buildingRunLimit / driveJunctionsOf moved to
// ./lib/roadJunctions.js (B1703666) — pure and exported, so the test suite exercises the SAME
// function the renderer calls instead of a hand-copied re-implementation (see that module's header).
// teeTargetOf / roadJunctionVerticesOf moved to ./lib/siteGeometry.js (site-metrics-extraction) —
// pure, shared with lib/siteMetrics.js.
// teeJunctionsOf itself moved to ./lib/roadJunctions.js (B1717616) — same reason as driveJunctionsOf's
// own extraction above: a road-to-road tee's own test suite was hand-copying this exact function's
// math instead of calling it, which is precisely how the B1011 reach-cap overshoot defect (NEW-2,
// same B#) went unnoticed by a fully green suite.
// driveJunctionsOf (B955/NEW-1, plus its DRIVE_RETURN_SEED / BUILDING_CLEAR_FT / buildingRunLimit
// helpers) moved to ./lib/roadJunctions.js — see that module's header (B1703666 — geometric
// detection, not just a stored driveTee flag) and this file's `driveJunctions` useMemo below.
// True length (ft) of a centerline road = its tessellated centerline length.
export const roadCenterlineLength = (el, settings, sharpAt) => {
  const dense = roadDenseCenterline(el, settings, sharpAt);
  let L = 0;
  for (let i = 1; i < dense.length; i++) L += Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y);
  return L;
};
// Rigidly shift an element by (dx,dy). A centerline road carries BOTH a `pts` alignment and a
// synced `cx/cy` bbox, so move both; a polygon element moves its `points`; a rect element moves
// its centre. One road-aware translate used by nudge / move / group-move (B596).
export const shiftEl = (el, dx, dy) => isCenterlineRoad(el)
  ? { ...el, pts: el.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })), cx: el.cx + dx, cy: el.cy + dy }
  : el.points
    ? { ...el, points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
    : { ...el, cx: el.cx + dx, cy: el.cy + dy };
// Non-blocking civil min-radius check (B599/NEW-4): the road's TIGHTEST radius of curvature
// anywhere along its tessellated centerline vs. its class threshold. Pure; returns null when
// the class carries no threshold (Custom) or the alignment is within spec — so a straight or
// gently-curved road never warns. Works uniformly for arc fillets and traced/smooth runs.
export function roadRadiusStatus(el, settings) {
  if (!isCenterlineRoad(el)) return null;
  const cls = roadClassOf(settings, el.roadClass);
  const threshold = classMinRadius(cls);
  if (!(threshold > 0)) return null;
  const minR = roadMinRadius(el.pts, el.vtx, { defaultRadius: roadDefaultRadius(el, settings) });
  if (!Number.isFinite(minR) || minR >= threshold) return null;
  return { minR, threshold, label: cls.label };
}

/* ----------------------- geometry helpers -------------------------- */
// Parcel split geometry (straight + bent cuts) lives in lib/polygonSplit.js, imported above.
// Closest point on segment a-b to point p (used for snapping to a boundary): nearestOnSeg above.

/* ------------------------------ format ----------------------------- */
// NEW-1 — the pond's area line is the ACREAGE and nothing else ("6.58 ac"), per the owner:
// "get rid of footprint and get rid of square feet, leave the acreage." It used to be a
// reflowable two-atom spec ("footprint 6.58 ac · 286,648 sf") that the fit ladder had to stack
// or abbreviate; a single short atom simply FITS, which is the point. Lives in
// lib/pondLabelText.js so the unit guard drives the real builder rather than grepping this file
// — and see that module's header for why PR-Q/O4's "no bare acreage" rule is deliberately NOT
// applied to this one line (the pond's noun sits directly above it).

/* --------------- county appraisal-district attribute view --------------- */
// The curated attribute view (APPR_FIELDS / apprRows / apprAll / apprVal / findAttr)
// now lives in ./lib/appraisal.js so the map finder's address-search info card shares
// the exact same labelling (B233).

// B591 — collision-resistant element ids. A per-TAB salt is appended to every minted id so
// two tabs (or a reopen after a delete) can never mint the same id, and a freshly drawn item
// can never reuse an id already sitting in a `deletedIds` tombstone (which mergeSiteContent's
// tombstone filter would then strip — the polyline that vanished mid-session). The salt is
// letters only, so seedAbove still parses the numeric sequence for ordering.
export const uid = createIdMinter(randomIdSalt());
// After restoring saved work, bump the id counter past any restored ids so new elements don't
// collide with old ones (which would break keys/selection). Feed it EVERY id-bearing
// collection (not just parcels+els) plus the tombstone list — see the callers below.
export const ensureIdAbove = (ids) => uid.seedAbove(ids);

// Snap is a per-SESSION drafting preference (a tool mode), NOT a per-site attribute.
// It defaults OFF every time the app is opened and is remembered only within the
// current browser-tab session (sessionStorage) — so it stays put while you switch
// plans/projects this session, but never silently carries over to the next session
// or to a freshly opened tab (B263: it used to be globally sticky in localStorage, so
// it could be on without anyone enabling it "this session"). We still mirror it into
// `settings.snap` so every read site is unchanged, but the per-site saved value is
// ignored on load/import in favour of this pref. Snap only ALIGNS positions (grid /
// flush against neighbours) — it never bonds or groups anything (B261/B262).
const SNAP_PREF_KEY = "planarfit:snap";
export const loadSnapPref = () => {
  try { localStorage.removeItem(SNAP_PREF_KEY); } catch (_) {} // retire the old globally-sticky key (B263)
  try { return sessionStorage.getItem(SNAP_PREF_KEY) === "1"; } catch { return false; }
};
export const saveSnapPref = (on) => { try { sessionStorage.setItem(SNAP_PREF_KEY, on ? "1" : "0"); } catch (_) {} };

export const DEFAULT_SETTINGS = {
  gridSize: 10, snap: false,
  setback: 25, showSetback: true,
  // B929 — default style for NEW parcels (outline color/weight/style + optional fill),
  // stamped at creation via parcelDefaultStyle(). Empty = the theme-aware built-ins; only
  // keys the user customizes in Standards → Parcels are stored. A duplicated/merged parcel
  // copies its source style instead, and any parcel can still override on itself.
  parcelStyle: {}, // { stroke, weight, dash, fill, fillOpacity }
  stallW: 9, stallDepth: 18, aisle: 24, parkAngle: 90,
  trailerW: 12, trailerL: 53, trailerAisle: 60,
  // Building-anchored dock-zone stack default depths (B228), outward from the dock
  // face: truck court → trailer parking → buffer. User-editable in Standards → Dock zones.
  truckCourtD: 135, trailerParkD: 50, bufferD: 15,
  roadCurb: 0.5, roadWidths: "24, 26, 30, 36, 40",
  showDocks: true,
  // Structural column grid on drawn buildings (B568): speed bay off each dock face, then
  // UNIFORM interior bays sized within the band toward the per-direction target (so the
  // grid reads as evenly-spaced columns; the speed bay is the only different bay). Dock
  // doors at doorOC o.c., doorWidth wide. Per-building overrides live on the element.
  showGrid: true,
  // B121 label-legibility toggles (default ON): the red edge-dimension callouts, and the sf/acreage
  // line on centred element labels — let a crowded layout shed either tier. Read via `!== false` so a
  // project saved before these keys existed still shows both.
  showDims: true, showAreas: true,
  // B783280 — the designated ROW boundary lines + label on a banded road. Read via `!== false` so a
  // project saved before this key existed still shows them.
  showRowLines: true,
  speedBay: 60, bayLengthTarget: 56, bayDepthTarget: 50, bayMin: 50, bayMax: 58,
  doorWidth: 9, doorOC: 12,
  typeStyles: {}, // user-set default colors per element type (Bluebeam-style defaults)
  // B750 — drainage overrides + remembered last check. drainsToHcfcdChannel / authorityId:
  // null = auto (use GIS detection); true/false or an authority id = the user's own answer,
  // used when the county maps can't confirm it. lastCheck = a slim summary of the last
  // "Check drainage criteria" result so the readout survives a reload. Reads null-guard, so
  // a project saved before this key still works.
  drainage: {}, // { drainsToHcfcdChannel, authorityId, lastCheck }
};

// NEW-1 (phone-chrome-parity pass) — an alpha-blended variant of a theme HEX token (never a raw
// literal — the mobile edge tabs read PAL.chrome through this so the slight see-through reads
// correctly in both themes instead of a fixed rgba() that would go wrong in one of them).
// ⛔ NEW-1 (Overlays redesign): this is now the LAST module-scope const before the component (the scale
// formatters `trimNum`/`fmtScaleNum` that used to hold that slot went with the old panel). `hiddenContentReads.js`'s
// audit sweep attributes a module-scope binding's "body" from its own line to the NEXT module-scope binding, and
// `export default function SitePlanner` doesn't match that sweep's pattern (`export default`, not `export
// const/function`) — so whichever module-scope const sits LAST before it silently swallows the sweep's
// attribution for the entire component as its own "body" (see `hexA`'s own DECLARATIONS entry). Adding a new
// module-scope const AFTER it would inherit that role instead — see test/hiddenContentReads.test.js's "stale
// declaration" guard, which caught exactly this.
export const hexA = (hex, a) => {
  const h = String(hex).replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};
