/* THE CLICK CONTRACT — one declaration, shared by the live e2e drive and the source guard (NEW-1).
 *
 * Owner rule (2026-07-30, after "single clicks open up the left menu on ponds"), formalising B750:
 *
 *   • SINGLE CLICK  = SELECT ONLY. Handles and on-element affordances appear. The left rail panel's
 *                     open/closed state is UNCHANGED — a closed panel stays closed, an open panel
 *                     stays open on whatever it was showing (its CONTENTS follow the selection).
 *   • DOUBLE CLICK  = open that object's inspector.
 *   • The rail button (and the ✕ / Esc) stay the explicit open/close affordances at any time.
 *   • NO pointer interaction with the canvas may change the panel's open/closed state — not a click,
 *     not a drag, not a marquee, not a pan, not a deselect. Only an explicit affordance may.
 *
 * `opens` names WHICH surface a double-click opens:
 *   "inspector"    — the docked Properties panel (leftPanel === "properties")
 *   "parcel-panel" — the Parcel panel; a parcel's inspector IS that list+detail destination
 *
 * ⛔ ADDING A SELECTABLE TYPE? Declare it here. `test/clickContract.test.js` reads the planner's own
 * TOOLS / DRAW_TYPES / MARKUP_TOOLS registries and FAILS until every selectable type has a row, so a
 * new type cannot ship with an undeclared (and therefore unguarded) click behaviour. */

export const CLICK_CONTRACT = [
  // Site elements (`kind: "el"`)
  { type: "building", label: "Building", family: "el", opens: "inspector", draw: "rect", tool: "Building" },
  { type: "paving", label: "Paving", family: "el", opens: "inspector", draw: "rect", tool: "Paving" },
  { type: "parking", label: "Car Parking", family: "el", opens: "inspector", draw: "rect", tool: "Car Parking" },
  { type: "trailer", label: "Trailer Parking", family: "el", opens: "inspector", draw: "rect", tool: "Trailer Parking" },
  { type: "pond", label: "Detention Pond", family: "el", opens: "inspector", draw: "rect", tool: "Detention Pond",
    note: "the owner's reported case — B875's plain-click reveal removed; the double-click still scroll-flashes the pond card, as do the map label's double-click, the right-click menu and Enter" },
  { type: "road", label: "Road", family: "el", opens: "inspector", draw: "centerline", tool: "Road" },
  { type: "easement", label: "Easement", family: "markup", opens: "inspector", draw: "centerline", tool: "Easement" },

  // Markup shapes (`kind: "markup"`)
  { type: "mline", label: "Line markup", family: "markup", opens: "inspector", draw: "drag", tool: "Line" },
  { type: "mrect", label: "Rectangle markup", family: "markup", opens: "inspector", draw: "drag", tool: "Rectangle" },
  { type: "mellipse", label: "Ellipse markup", family: "markup", opens: "inspector", draw: "drag", tool: "Ellipse" },
  { type: "mpolygon", label: "Polygon markup", family: "markup", opens: "inspector", draw: "poly", tool: "Polygon" },
  { type: "mpolyline", label: "Polyline markup", family: "markup", opens: "inspector", draw: "poly", tool: "Polyline" },

  // Annotations (`kind: "callout"`) — B948 splits the double-click by LOCATION: the text interior
  // edits in place, the border band opens the inspector. Either way a SINGLE click only selects.
  { type: "callout", label: "Callout", family: "callout", opens: "inspector", draw: "callout", tool: "Callout",
    note: "double-click INSIDE the text edits in place (B948); the border band opens the inspector" },
  { type: "text", label: "Text box", family: "callout", opens: "inspector", draw: "callout", tool: "Text",
    note: "a text box is a callout internally — same location-split double-click" },

  // Measurements (`kind: "measure"`)
  { type: "measure", label: "Measurement", family: "measure", opens: "inspector", draw: "measure", tool: "Measure" },

  // Parcels (`kind: "parcel"`) — the one type whose inspector is a different panel.
  { type: "parcel", label: "Parcel", family: "parcel", opens: "parcel-panel", draw: "parcel", tool: "Parcel",
    note: "single click used to auto-open the Parcel panel from a selection effect — removed in NEW-1" },
];

/* ---------------------------------------------------------------------------------------------
 * REVIEW (Document Review) — the same contract, the other workspace (B1190).
 *
 * Review's inspector is a rail SECTION rather than a docked panel, so a stray close collapses a
 * section instead of reflowing the canvas — milder, same rule. Its markup KINDS are declared here
 * so `test/clickContract.test.js` can fail the build when a new drawable tool ships without a
 * declared click behaviour, exactly as it already does for the planner's registries.
 *
 * `opens` is "inspector" for every row: Review has one Properties section and that is where a
 * double-click lands. What varies is the EXCEPTION — the kinds whose double-click edits text in
 * place instead — so that is what each row records.
 */
export const REVIEW_CLICK_CONTRACT = [
  // Redline shapes — double-click opens Properties, nothing else.
  { tool: "line", label: "Line", opens: "inspector" },
  { tool: "polyline", label: "Polyline", opens: "inspector" },
  { tool: "polygon", label: "Polygon", opens: "inspector" },
  { tool: "rect", label: "Rect", opens: "inspector" },
  { tool: "ellipse", label: "Ellipse", opens: "inspector" },
  { tool: "cloud", label: "Cloud", opens: "inspector" },
  { tool: "arc", label: "Arc", opens: "inspector" },
  { tool: "dimension", label: "Dimension", opens: "inspector" },
  { tool: "pen", label: "Pen", opens: "inspector" },
  { tool: "highlight", label: "Highlight", opens: "inspector" },
  { tool: "snapshot", label: "Snapshot", opens: "inspector" },

  // Measurements — same contract as the shapes.
  { tool: "distance", label: "Distance", opens: "inspector" },
  { tool: "polylength", label: "Length", opens: "inspector" },
  { tool: "perimeter", label: "Perimeter", opens: "inspector" },
  { tool: "area", label: "Area", opens: "inspector" },
  { tool: "count", label: "Count", opens: "inspector" },

  // Text-bearing kinds — the double-click SPLITS, and each splits on a different axis.
  { tool: "text", label: "Text", opens: "inspector", editsText: true,
    note: "an ALREADY-selected text note edits its words in place (the B750 temporal rule); otherwise Properties" },
  { tool: "callout", label: "Callout", opens: "inspector", editsText: true,
    note: "LOCATION-based (B948): inside the text region edits in place, the border band / a leader opens Properties" },
];

/* Review tools that draw nothing selectable (modes, not markups) — declared so the completeness
 * check can tell "deliberately has no click contract" from "somebody forgot a row". */
export const REVIEW_NON_MARKUP_TOOLS = ["select", "pan", "marquee", "calibrate", "eraser"];

export const reviewContractFor = (tool) => REVIEW_CLICK_CONTRACT.find((c) => c.tool === tool) || null;

/* The subset the live e2e actually drives end-to-end. Everything else is covered by the source guard
 * plus the shared handlers those types already route through (startMoveEl / startMoveMarkup). Kept
 * explicit so a shrinking drive set is a visible edit, never a silent loss of coverage. */
export const E2E_DRIVEN = ["pond", "building", "paving", "trailer", "road", "easement", "mrect", "measure", "parcel"];

export const contractFor = (type) => CLICK_CONTRACT.find((c) => c.type === type) || null;
