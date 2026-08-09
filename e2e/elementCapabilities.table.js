/* THE ELEMENT CAPABILITY CONTRACT — one declaration, shared by the live audit and the source guard.
 *
 * Owner report (NEW-1, 2026-08-09), verbatim: "investigate the element tools and make sure they all
 * share the same attributes as it makes sense, bc rn sometimes a certain markup won't have the same
 * properties as other markups for no good reason, or like the same right menu options."
 *
 * ⛔ THE POINT IS NOT UNIFORMITY. Forcing an irrelevant capability onto a type is worse than the
 * drift it would close — a line has no fill area, a measurement has no building height. So every
 * type declares, for EVERY capability in the vocabulary below, exactly one of:
 *
 *     "yes"                       — the type has it.
 *     { na: "<reason>" }          — the type genuinely lacks the CONCEPT. The reason is required
 *                                   and is the thing a reviewer argues with.
 *     { open: "<question>" }      — a JUDGEMENT CALL parked for the owner. Deliberately NOT closed
 *                                   by whoever wrote the row; it is a taste decision, not a bug.
 *
 * There is no fourth option, and in particular there is no way to leave a cell blank. That is the
 * whole mechanism: a new element type cannot ship without someone stating, capability by capability,
 * what it does and does not do — which is what stops this drifting apart again. Closing today's
 * specific gaps without this check just resets the clock.
 *
 * Same shape as THE CLICK CONTRACT (`e2e/clickContract.table.js`, B1188), for the same reason and
 * with the same enforcement: `test/elementCapabilities.test.js` reads the planner's own DRAW_TYPES /
 * MARKUP_TOOLS registries and FAILS the build until every selectable type has a complete row.
 */

/* ---------------------------------------------------------------------------------------------
 * THE VOCABULARY. Two groups: what the INSPECTOR exposes, and what the RIGHT-CLICK menu offers.
 * A capability is in here only if more than one family plausibly wants it — this is a parity
 * vocabulary, not an inventory of every control in the app.
 */
export const PROP_CAPS = [
  "stroke",        // outline / line colour
  "fill",          // fill colour + opacity
  "lineWeight",    // stroke width
  "dash",          // dash pattern
  "size",          // width / height / length in feet
  "rotation",      // rotation in degrees
  "label",         // a name or inline label riding the object
  "lock",          // a lock/pin control IN THE INSPECTOR
];

export const ACTION_CAPS = [
  "properties",    // "Properties…" — reach the inspector from the menu
  "copy",          // Copy to the canvas clipboard
  "duplicate",     // Duplicate in place
  "lock",          // Lock / Unlock (or Pin / Unpin — see the NAMING rule below)
  "arrangeEnds",   // Bring to Front / Send to Back
  "arrangeSteps",  // Bring Forward / Send Backward — the one-step siblings of the above
  "crossBand",     // the explicit escape hatch across the plan (e.g. "Send behind buildings")
  "delete",        // Delete
];

/* ⛔ ONE NAME PER CONCEPT. Lock and Pin are the same capability wearing two words: the element menu
 * said "Pin", every other family said "Lock", and a user cannot be expected to know those are one
 * idea. The canonical user-facing verb is LOCK/UNLOCK, and the guard below pins it so a future menu
 * cannot reintroduce a synonym. (The internal field stays `locked` everywhere — it always was.) */
export const CANONICAL_LOCK_VERB = "Lock";

const YES = "yes";

/* ---------------------------------------------------------------------------------------------
 * THE MATRIX.
 */
export const ELEMENT_CAPABILITIES = [
  /* ---- SITE ELEMENTS (`kind: "el"`) --------------------------------------------------------
   * One family, one row shape: these all share the element inspector and the element right-click
   * menu, so the interesting declarations are the per-type ones (a road has no rectangle W/H).
   *
   * ⛔ THE SIX `crossBand` CELLS BELOW WERE THE ONLY `{ open: … }` LEFT IN THIS TABLE, AND THE OWNER
   * HAS NOW ANSWERED THEM (2026-08-09, NEW-1). Verbatim: *"for item one, paving over a building. I
   * mean, I don't think that should be the default. But, like, if I try and force it and then I
   * don't see why I shouldn't be able to do that."* — so the answer is BOTH halves, and they are
   * recorded here as `yes` because the CAPABILITY exists, not because the behaviour changed by
   * default. The type-layer rule (road → paving → pond → parking → building) is still absolute for
   * every element nobody has touched, and ordinary Arrange still stops at the band edge; the
   * capability is the explicit "Force on top of everything" row, which is the same single-toggle
   * escape hatch markups, measurements, callouts and references already carry. See
   * `site-planner/lib/planStyle.js` (`bandForceOf` / `EL_BANDS`) for the one place it resolves.
   *
   * The MECHANISM this table exists for is untouched: a new element type still cannot ship without
   * declaring `crossBand` — `yes`, or an `na` with a reason, or a fresh `open` for the owner. */
  {
    type: "building", label: "Building", family: "el",
    props: {
      stroke: YES, fill: YES, lineWeight: YES, dash: YES, size: YES, rotation: YES, label: YES,
      lock: YES,
    },
    actions: {
      properties: YES, copy: YES, duplicate: YES, lock: YES,
      arrangeEnds: YES, arrangeSteps: YES,
      crossBand: YES,
      delete: YES,
    },
  },
  {
    type: "paving", label: "Paving", family: "el",
    props: { stroke: YES, fill: YES, lineWeight: YES, dash: YES, size: YES, rotation: YES, label: YES, lock: YES },
    actions: { properties: YES, copy: YES, duplicate: YES, lock: YES, arrangeEnds: YES, arrangeSteps: YES, crossBand: YES, delete: YES },
  },
  {
    type: "road", label: "Road", family: "el",
    props: {
      stroke: YES, fill: YES, lineWeight: YES, dash: YES, rotation: YES, label: YES, lock: YES,
      size: { na: "a centreline road is sized by its travel width + its drawn centreline, not by a W×H box; the width field lives in the road card and the length is the geometry the user drew" },
    },
    actions: { properties: YES, copy: YES, duplicate: YES, lock: YES, arrangeEnds: YES, arrangeSteps: YES, crossBand: YES, delete: YES },
  },
  {
    type: "parking", label: "Car Parking", family: "el",
    props: { stroke: YES, fill: YES, lineWeight: YES, dash: YES, size: YES, rotation: YES, label: YES, lock: YES },
    actions: { properties: YES, copy: YES, duplicate: YES, lock: YES, arrangeEnds: YES, arrangeSteps: YES, crossBand: YES, delete: YES },
  },
  {
    type: "trailer", label: "Trailer Parking", family: "el",
    props: { stroke: YES, fill: YES, lineWeight: YES, dash: YES, size: YES, rotation: YES, label: YES, lock: YES },
    actions: { properties: YES, copy: YES, duplicate: YES, lock: YES, arrangeEnds: YES, arrangeSteps: YES, crossBand: YES, delete: YES },
  },
  {
    type: "pond", label: "Detention Pond", family: "el",
    props: { stroke: YES, fill: YES, lineWeight: YES, dash: YES, size: YES, rotation: YES, label: YES, lock: YES },
    actions: { properties: YES, copy: YES, duplicate: YES, lock: YES, arrangeEnds: YES, arrangeSteps: YES, crossBand: YES, delete: YES },
  },

  /* ---- MARKUPS (`kind: "markup"`) ----------------------------------------------------------
   * The family the owner named. These share ONE inspector and ONE right-click menu, so the drift
   * he saw between "a certain markup" and the others is per-KIND: what each row declares below is
   * which controls that kind's own geometry can carry. */
  {
    type: "mline", label: "Line markup", family: "markup",
    props: {
      stroke: YES, lineWeight: YES, dash: YES, label: YES, lock: YES,
      fill: { na: "an open two-point path encloses no area, so there is nothing to fill" },
      size: { na: "a line is sized by dragging either end dot; a W×H box would not describe it" },
      rotation: { na: "rotating a two-point line is the same gesture as moving one end — the end dots ARE the rotation control" },
    },
    actions: { properties: YES, copy: YES, duplicate: YES, lock: YES, arrangeEnds: YES, arrangeSteps: YES, crossBand: YES, delete: YES },
  },
  {
    type: "mpolyline", label: "Polyline markup", family: "markup",
    props: {
      stroke: YES, lineWeight: YES, dash: YES, label: YES, lock: YES,
      fill: { na: "an open path encloses no area, so there is nothing for a fill colour to apply to" },
      size: { na: "sized by its vertices — drag a dot to reshape, ＋ adds one, Shift-click removes one" },
      rotation: { na: "a free vertex path has no single rotation axis; reshape by its dots instead" },
    },
    actions: { properties: YES, copy: YES, duplicate: YES, lock: YES, arrangeEnds: YES, arrangeSteps: YES, crossBand: YES, delete: YES },
  },
  {
    type: "mpolygon", label: "Polygon markup", family: "markup",
    props: {
      stroke: YES, fill: YES, lineWeight: YES, dash: YES, label: YES, lock: YES,
      size: { na: "sized by its vertices, like the polyline it closes" },
      rotation: { na: "a free vertex ring has no single rotation axis" },
    },
    actions: { properties: YES, copy: YES, duplicate: YES, lock: YES, arrangeEnds: YES, arrangeSteps: YES, crossBand: YES, delete: YES },
  },
  {
    type: "mrect", label: "Rectangle markup", family: "markup",
    props: { stroke: YES, fill: YES, lineWeight: YES, dash: YES, size: YES, rotation: YES, label: YES, lock: YES },
    actions: { properties: YES, copy: YES, duplicate: YES, lock: YES, arrangeEnds: YES, arrangeSteps: YES, crossBand: YES, delete: YES },
  },
  {
    type: "mellipse", label: "Ellipse markup", family: "markup",
    props: { stroke: YES, fill: YES, lineWeight: YES, dash: YES, size: YES, rotation: YES, label: YES, lock: YES },
    actions: { properties: YES, copy: YES, duplicate: YES, lock: YES, arrangeEnds: YES, arrangeSteps: YES, crossBand: YES, delete: YES },
  },
  {
    type: "easement", label: "Easement", family: "markup",
    props: {
      stroke: YES, fill: YES, lineWeight: YES, dash: YES, size: YES, label: YES, lock: YES,
      rotation: { na: "an easement's corridor is DERIVED from its centreline and width; a free rotation would desync the two" },
    },
    actions: { properties: YES, copy: YES, duplicate: YES, lock: YES, arrangeEnds: YES, arrangeSteps: YES, crossBand: YES, delete: YES },
  },

  /* ---- ANNOTATIONS (`kind: "callout"`) -----------------------------------------------------
   * ⛔ THE BIGGEST GAP THE AUDIT FOUND. A callout and a text box were the only drawn objects with
   * NO ordering at all — no z, no Arrange rows, no chords — so two overlapping text boxes could
   * never be reordered by any means. Closed in NEW-2. */
  {
    type: "callout", label: "Callout", family: "callout",
    props: {
      stroke: YES, fill: YES, size: YES, label: YES, lock: YES,
      lineWeight: { na: "the box outline weight is not separately authored; the text SIZE is the weight control that matters here, and it has its own field" },
      dash: { na: "a dashed callout box is not a convention anyone draws; the leader is what carries meaning" },
      rotation: { na: "annotation text is always read horizontally — a rotated callout is a legibility bug, not a feature" },
    },
    actions: { properties: YES, copy: YES, duplicate: YES, lock: YES, arrangeEnds: YES, arrangeSteps: YES, crossBand: YES, delete: YES },
  },
  {
    type: "text", label: "Text box", family: "callout",
    props: {
      stroke: YES, fill: YES, size: YES, label: YES, lock: YES,
      lineWeight: { na: "see callout — a text box is a callout with no leader" },
      dash: { na: "see callout" },
      rotation: { na: "see callout — annotation text stays horizontal" },
    },
    actions: { properties: YES, copy: YES, duplicate: YES, lock: YES, arrangeEnds: YES, arrangeSteps: YES, crossBand: YES, delete: YES },
  },

  /* ---- MEASUREMENTS (`kind: "measure"`) ---------------------------------------------------- */
  {
    type: "measure", label: "Measurement", family: "measure",
    props: {
      stroke: YES, lineWeight: YES, size: YES, label: YES, lock: YES,
      fill: { na: "an area measurement paints a translucent tint keyed to its own colour; a second independent fill would let the tint disagree with the line it measures" },
      dash: { na: "a measurement's line style is what makes it READ as a measurement rather than as drawn work — authoring it away is the one change that would make it lie" },
      rotation: { na: "a measurement describes geometry that already exists; rotating it would change the number it reports, which is the one thing it must never do" },
    },
    actions: { properties: YES, copy: YES, duplicate: YES, lock: YES, arrangeEnds: YES, arrangeSteps: YES, crossBand: YES, delete: YES },
  },

  /* ---- PARCELS (`kind: "parcel"`) ----------------------------------------------------------
   * The one type whose inspector is a different panel (the Parcel panel — see THE CLICK CONTRACT),
   * and the one whose stacking is fixed by the drawing model rather than by the user. */
  {
    type: "parcel", label: "Parcel", family: "parcel",
    props: {
      stroke: YES, fill: YES, lineWeight: YES, dash: YES, label: YES, lock: YES,
      size: { na: "a parcel's dimensions come from the deed or the county record — typing a width would falsify the boundary" },
      rotation: { na: "a parcel is georeferenced; rotating it would move real property lines off their real position" },
    },
    actions: {
      properties: YES, lock: YES, delete: YES, copy: YES,
      duplicate: { na: "two parcels stacked on the same coordinates is never what anyone means; add another parcel from the county record instead" },
      arrangeEnds: { na: "the parcel boundary is the plan's ground reference — it draws under the site elements and over the basemap, one fixed position in the stack (mapStack.js)" },
      arrangeSteps: { na: "see arrangeEnds" },
      crossBand: { na: "see arrangeEnds" },
    },
  },
];

/* ---------------------------------------------------------------------------------------------
 * Lookups + the shared vocabulary checks the guard and the live audit both use.
 */
export const capabilityFor = (type) => ELEMENT_CAPABILITIES.find((r) => r.type === type) || null;

/* Every cell's verdict, normalised: "yes" | "na" | "open". */
export function verdict(cell) {
  if (cell === YES) return "yes";
  if (cell && typeof cell === "object" && typeof cell.na === "string" && cell.na.trim()) return "na";
  if (cell && typeof cell === "object" && typeof cell.open === "string" && cell.open.trim()) return "open";
  return null;                                    // malformed — the guard fails on this
}

/* The capabilities a row claims. Used by the live audit to check the app against the declaration. */
export const claims = (row, group) => {
  const caps = group === "props" ? PROP_CAPS : ACTION_CAPS;
  return caps.filter((c) => verdict(row[group][c]) === "yes");
};

/* Rows whose family shares ONE inspector and ONE context menu. Within such a family a capability
 * declared "yes" by one member and "na" by another is the exact drift the owner reported, so the
 * guard demands the "na" reason be about that member's own GEOMETRY — never about the family. */
export const FAMILIES = ["el", "markup", "callout", "measure", "parcel"];
