/* Shared markup/measure TOOL MATRIX (B422 / NEW-1).
 *
 * This file is the SINGLE SOURCE OF TRUTH for which markup & measure tools exist, how
 * each is drawn, which property controls it exposes, and which workspaces carry it. The
 * shared markup engine's property panel is DRIVEN by it (`propertySchema.schemaForMarkup`
 * reads `propsForTool`), and the automated tool tests are GENERATED from it (NEW-9). It
 * encodes the Bluebeam-parity TARGET, not merely today's state — a tool a workspace does
 * not yet implement still has its row here, so the loop has something to converge toward.
 *
 * ⛔ THE REFINEMENT LOOP NEVER EDITS THIS FILE TO MAKE A RED TEST GO GREEN. The matrix is
 * the specification; a failing assertion means the CODE is behind the matrix, so the code
 * moves. The matrix changes only on explicit owner direction (a deliberate spec change).
 *
 * Pure data + tiny pure accessors. No imports, no React, no DOM — fully unit-testable and
 * safe to load from either workspace or a Node test. (Mirrors the purity discipline of
 * `shared/viewport/viewportTransform.js`.)
 */

/* ------------------------------------------------------------------ *
 *  PROPERTY COLUMNS — the universe of controls a tool row may list.
 *  Each tool's `properties` array is a subset of these keys. The panel
 *  renders one control per key using this metadata (type/label/default).
 *  Canonical keys are workspace-neutral; the markup data-model maps them
 *  onto each host's stored field names (e.g. Site Planner persists
 *  `weight`/`dash`; the engine speaks `strokeWidth`/`strokeStyle`).
 * ------------------------------------------------------------------ */
export const PROPERTY_COLUMNS = {
  stroke:         { type: "color",  label: "Line color",   default: "#c2410c" },
  strokeWidth:    { type: "number", label: "Line weight",  default: 2,   min: 0.5, max: 64 },
  strokeStyle:    { type: "enum",   label: "Dash",         default: "solid", options: ["solid", "dashed", "dotted"] },
  opacity:        { type: "range",  label: "Opacity",      default: 1,   min: 0, max: 1, step: 0.05 },
  fill:           { type: "color",  label: "Fill color",   default: "#c2410c" },
  fillOpacity:    { type: "range",  label: "Fill opacity", default: 0,   min: 0, max: 1, step: 0.05 },
  arrowStart:     { type: "bool",   label: "Start arrow",  default: false },
  arrowEnd:       { type: "bool",   label: "End arrow",    default: false },
  fontSize:       { type: "number", label: "Text size",    default: 14,  min: 6, max: 96 },
  fontColor:      { type: "color",  label: "Text color",   default: "#1a1a1a" },
  bold:           { type: "bool",   label: "Bold",         default: false },
  italic:         { type: "bool",   label: "Italic",       default: false },
  underline:      { type: "bool",   label: "Underline",    default: false },
  align:          { type: "enum",   label: "Align",        default: "left", options: ["left", "center", "right"] },
  lineHeight:     { type: "number", label: "Line spacing", default: 1.2, min: 0.8, max: 3 },
  padding:        { type: "number", label: "Padding",      default: 6,   min: 0, max: 64 },
  measureCaption: { type: "bool",   label: "Show label",   default: true },
};

/* The legal `drawMode` values. The shared interaction model (NEW-8) maps each to one
 * gesture: how many clicks/drags create the markup, and what Shift constrains.
 *   twoPoint   — press → drag → release (or click-click): line, rect, ellipse, cloud,
 *                distance, dimension, arrow. Shift = 45°/square/circle.
 *   multiPoint — click each vertex, double-click / Enter / click-first-dot to finish:
 *                polyline, polygon, perimeter, area, arc. Shift = 45° segments.
 *   point      — a single click places it: text, callout anchor, count marker.
 *   freehand   — press-drag a continuous path: pen, highlight.
 *   region     — drag a box that selects an area (not a shape): snapshot, eraser sweep.
 *   calibrate  — two points + a typed real length (sets the unit scale).
 *   mode       — not a markup; a pointer mode: select, pan.
 */
export const DRAW_MODES = ["twoPoint", "multiPoint", "point", "freehand", "region", "calibrate", "mode"];

/* Tool categories — used to group the rail and to let tests slice the matrix. */
export const CATEGORIES = ["mode", "shape", "text", "freehand", "measure", "capture"];

/* The three SVG surfaces that consume the engine. A row lists every workspace that
 * should carry the tool (the parity target). */
export const WORKSPACES = ["site", "doc", "stitch"];

/* ------------------------------------------------------------------ *
 *  THE MATRIX. One row per tool.
 *   id            canonical engine id (also the model `kind` for shapes/measures)
 *   label         rail caption
 *   hint          tooltip / status-bar help
 *   category      one of CATEGORIES
 *   drawMode      one of DRAW_MODES
 *   closed        true if the geometry is a closed ring (drives fill controls)
 *   measureOutput "length" | "area" | "count" | null  (a measure reads a real-world value)
 *   properties    subset of PROPERTY_COLUMNS keys the panel exposes
 *   workspaces    subset of WORKSPACES that should carry it
 * ------------------------------------------------------------------ */

const STROKE = ["stroke", "strokeWidth", "strokeStyle", "opacity"];
const STROKE_FILL = [...STROKE, "fill", "fillOpacity"];
const TEXT_PROPS = ["fontSize", "fontColor", "bold", "italic", "underline", "align", "lineHeight"];

export const TOOL_MATRIX = [
  /* ----- pointer modes (not markups) ----- */
  { id: "select", label: "Select", hint: "Click a markup to select; drag to move; double-click text to edit; Delete removes it.",
    category: "mode", drawMode: "mode", closed: false, measureOutput: null, properties: [], workspaces: ["site", "doc", "stitch"] },
  { id: "pan", label: "Pan", hint: "Drag to move around the canvas. (Hold Space in any tool to pan; wheel / Ctrl+scroll to zoom toward the cursor.)",
    category: "mode", drawMode: "mode", closed: false, measureOutput: null, properties: [], workspaces: ["site", "doc", "stitch"] },
  { id: "marquee", label: "Marquee", hint: "Drag a box on empty canvas to select everything it touches. In the default pointer use Ctrl/⌘-click to toggle one object, Shift-click to add; Esc or a click on empty canvas clears.",
    category: "mode", drawMode: "mode", closed: false, measureOutput: null, properties: [], workspaces: ["site", "doc"] },
  { id: "calibrate", label: "Calibrate", hint: "Click two points a known distance apart, then type the real length to set the scale.",
    category: "mode", drawMode: "calibrate", closed: false, measureOutput: null, properties: [], workspaces: ["site", "doc", "stitch"] },

  /* ----- annotation shapes ----- */
  { id: "line", label: "Line", hint: "Drag end-to-end. Hold Shift for 45° increments. Toggle a start/end arrowhead in the panel (Arrow).",
    category: "shape", drawMode: "twoPoint", closed: false, measureOutput: null,
    properties: [...STROKE, "arrowStart", "arrowEnd"], workspaces: ["site", "doc"] },
  { id: "polyline", label: "Polyline", hint: "Click points; double-click / Enter to finish. Shift for 45° segments.",
    category: "shape", drawMode: "multiPoint", closed: false, measureOutput: null,
    properties: [...STROKE, "arrowStart", "arrowEnd"], workspaces: ["site", "doc"] },
  { id: "polygon", label: "Polygon", hint: "Click points; click the first dot / double-click to close. Shift for 45° segments.",
    category: "shape", drawMode: "multiPoint", closed: true, measureOutput: null,
    properties: STROKE_FILL, workspaces: ["site", "doc"] },
  { id: "rect", label: "Rectangle", hint: "Drag a box. Hold Shift for a square.",
    category: "shape", drawMode: "twoPoint", closed: true, measureOutput: null,
    properties: STROKE_FILL, workspaces: ["site", "doc"] },
  { id: "ellipse", label: "Ellipse", hint: "Drag a box. Hold Shift for a circle.",
    category: "shape", drawMode: "twoPoint", closed: true, measureOutput: null,
    properties: STROKE_FILL, workspaces: ["site", "doc"] },
  { id: "cloud", label: "Cloud", hint: "Revision cloud: drag a box; the scalloped outline traces it.",
    category: "shape", drawMode: "twoPoint", closed: true, measureOutput: null,
    properties: STROKE_FILL, workspaces: ["site", "doc"] },
  { id: "arc", label: "Arc", hint: "Click start, end, then a third point to set the bulge. Shift snaps the chord to 45°.",
    category: "shape", drawMode: "multiPoint", closed: false, measureOutput: null,
    properties: [...STROKE, "arrowStart", "arrowEnd"], workspaces: ["site", "doc"] },
  { id: "dimension", label: "Dimension", hint: "Drag end-to-end; the calibrated length labels the line with witness ticks.",
    category: "shape", drawMode: "twoPoint", closed: false, measureOutput: "length",
    properties: [...STROKE, "fontSize", "fontColor"], workspaces: ["site", "doc"] },

  /* ----- text ----- */
  { id: "text", label: "Text", hint: "Click to place a text note; type inline. Double-click later to edit.",
    category: "text", drawMode: "point", closed: false, measureOutput: null,
    properties: [...TEXT_PROPS, "fill", "fillOpacity", "padding"], workspaces: ["site", "doc"] },
  { id: "callout", label: "Callout", hint: "Click to place; a leader points from the box to the target. Edit text inline.",
    category: "text", drawMode: "point", closed: false, measureOutput: null,
    properties: [...TEXT_PROPS, "stroke", "fill", "fillOpacity", "padding"], workspaces: ["site", "doc"] },

  /* ----- freehand ----- */
  { id: "pen", label: "Pen", hint: "Press and draw a freehand path.",
    category: "freehand", drawMode: "freehand", closed: false, measureOutput: null,
    properties: STROKE, workspaces: ["site", "doc"] },
  { id: "highlight", label: "Highlight", hint: "Press and sweep a translucent highlighter over the drawing.",
    category: "freehand", drawMode: "freehand", closed: false, measureOutput: null,
    properties: ["stroke", "strokeWidth", "opacity"], workspaces: ["site", "doc"] },
  { id: "eraser", label: "Eraser", hint: "Sweep to remove Pen / Highlight strokes only — never the engineer's drawing.",
    category: "freehand", drawMode: "region", closed: false, measureOutput: null,
    properties: [], workspaces: ["site", "doc"] },

  /* ----- capture ----- */
  { id: "snapshot", label: "Snapshot", hint: "Drag a region to capture it as an image you can place elsewhere.",
    category: "capture", drawMode: "region", closed: true, measureOutput: null,
    properties: [], workspaces: ["site", "doc"] },

  /* ----- measures (read a real-world value via the unit-scale seam) ----- */
  { id: "distance", label: "Distance", hint: "Click two points to measure a length.",
    category: "measure", drawMode: "twoPoint", closed: false, measureOutput: "length",
    properties: [...STROKE, "measureCaption"], workspaces: ["site", "doc", "stitch"] },
  { id: "polylength", label: "Polylength", hint: "Click a path; double-click / Enter to finish. Measures the total run.",
    category: "measure", drawMode: "multiPoint", closed: false, measureOutput: "length",
    properties: [...STROKE, "measureCaption"], workspaces: ["site", "doc"] },
  { id: "perimeter", label: "Perimeter", hint: "Click points around a shape; close it. Measures the loop length.",
    category: "measure", drawMode: "multiPoint", closed: true, measureOutput: "length",
    properties: [...STROKE, "measureCaption"], workspaces: ["site", "doc", "stitch"] },
  { id: "area", label: "Area", hint: "Outline a region; close it. Measures square feet / acres.",
    category: "measure", drawMode: "multiPoint", closed: true, measureOutput: "area",
    properties: [...STROKE_FILL, "measureCaption"], workspaces: ["site", "doc", "stitch"] },
  { id: "count", label: "Count", hint: "Click each item (stall, dock door); Enter / double-click to finish.",
    category: "measure", drawMode: "point", closed: false, measureOutput: "count",
    properties: ["stroke", "fillOpacity", "measureCaption"], workspaces: ["site", "doc"] },
];

/* ------------------------------------------------------------------ *
 *  Pure accessors.
 * ------------------------------------------------------------------ */

const _byId = TOOL_MATRIX.reduce((m, t) => { m[t.id] = t; return m; }, {});

/** The full row for a tool id (undefined if unknown). */
export const toolById = (id) => _byId[id];

/** The ordered property-column keys a tool exposes ([] for modes / unknown). */
export const propsForTool = (id) => (_byId[id] ? _byId[id].properties : []);

/** Every tool a workspace ("site" | "doc" | "stitch") should carry, matrix order. */
export const toolsForWorkspace = (ws) => TOOL_MATRIX.filter((t) => t.workspaces.includes(ws));

/** Every measure tool (those with a `measureOutput`). */
export const measureTools = () => TOOL_MATRIX.filter((t) => t.measureOutput);

/** True if the tool draws a closed ring (drives fill controls + area/perimeter). */
export const isClosedTool = (id) => !!(_byId[id] && _byId[id].closed);

/** The metadata block for a property column (type/label/default/…). */
export const columnMeta = (key) => PROPERTY_COLUMNS[key];
