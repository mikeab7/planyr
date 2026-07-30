/* THE map stacking model — one fixed semantic order every renderer honours.
 * (NEW-1, 2026-07-30. Owner case: "I place buildings, then I want to see the site
 * contours, but the contours are now behind the buildings." He explicitly rejected a
 * hold-to-peek key — "whatever an apple or a google would do, lets do." Neither Google
 * Maps nor Apple Maps lets a user reorder layers; they use a FIXED semantic hierarchy
 * and expose opacity. So this file is that hierarchy, and there is no z-order UI.)
 *
 * THE LOAD-BEARING RULE
 *   Filled AREA layers draw UNDER site elements. LINE/stroke layers draw OVER them.
 * A contour crossing a building is a hairline and reads fine; a floodplain fill over a
 * building buries it. That ONE distinction answers the complaint with no control at all:
 * contours read through the buildings, and the buildings never vanish under a blue wash.
 *
 * NO new mode, NO keyboard shortcut, NO per-layer z-order picker. A future exception is a
 * deliberate edit to THIS file — never a user setting. Per-layer OPACITY is the one escape
 * hatch (every toggleable layer has it — see test/layerOpacityCoverage.test.js).
 *
 * WHERE THE TIERS PHYSICALLY LIVE (planner canvas, SitePlanner.jsx):
 *   basemap · gisArea  → Leaflet panes inside the BACKDROP map <div> (below the SVG)
 *   reference … label  → `<g>` groups INSIDE the one planner SVG, in this order
 *   gisLine            → a Leaflet pane hosted ABOVE the SVG (the map-top host)
 *   handle             → the manipulation-handle tier, the top of the model
 * The SVG is a single DOM node, so it occupies the contiguous reference…label band; the
 * order WITHIN it is realized by its own group order, not by z-index.
 *
 * References (a scanned exhibit the user is aligning) are USER CONTENT, not a data layer,
 * so Figma-style Bring-to-front / Send-to-back ordering is correct for them — that control
 * reorders references AMONG THEMSELVES, inside this tier. It does not define its own scheme.
 *
 * Pure — no DOM, no Leaflet, no imports. */

/* Bottom → top. `z` is the CSS z-index each tier's host element takes when it is its own
 * DOM node; tiers that share the planner SVG all resolve to the SVG's own z-index. Gaps of
 * 100 are deliberate: a new tier slots in without renumbering the world. */
export const MAP_STACK = [
  { id: "basemap", z: 100, label: "Aerial / basemap imagery" },
  { id: "gisArea", z: 200, label: "GIS AREA layers — filled polygons (floodplain, wetlands, soils, watersheds, districts)" },
  { id: "reference", z: 300, label: "References / imported site-plan overlays (the DEFAULT 'below' band)" },
  { id: "parcel", z: 400, label: "Parcel boundary" },
  { id: "setback", z: 500, label: "Setback band" },
  { id: "elements", z: 600, label: "Site elements" },
  // B1198's opt-in "Draw above the plan" band. A reference is USER CONTENT, so a user may
  // deliberately promote one over the plan (a coloured land-plan exhibit being worked ON); it
  // still sits inside this model rather than defining a scheme of its own. lib/overlayOrder.js
  // owns the ordering WITHIN both reference bands (front/back among references).
  { id: "referenceFront", z: 650, label: "References explicitly promoted above the plan (overlayOrder band 'above')" },
  { id: "gisLine", z: 700, label: "GIS LINE layers — strokes (contours, streams, easement centrelines, BFE lines, utility lines)" },
  { id: "label", z: 800, label: "Labels & chips" },
  { id: "handle", z: 900, label: "Manipulation handles — always on top" },
];

export const STACK_Z = Object.freeze(Object.fromEntries(MAP_STACK.map((t) => [t.id, t.z])));

/* The tiers that share the ONE planner SVG element. The SVG's own z-index is the first of
 * them, which is what puts the whole band above gisArea and below gisLine. */
export const SVG_TIERS = ["reference", "parcel", "setback", "elements", "referenceFront", "label", "handle"];
export const SVG_Z = STACK_Z.reference;

/* ⚠ THE ONE KNOWN DEVIATION, stated plainly rather than papered over.
 *
 * `handle` is the TOP of the model, and B1197 made that true inside the plan: every manipulation
 * handle renders from one `data-handle-layer` group that is the LAST child of the plan SVG, so a
 * handle paints over — and hit-tests ahead of — every drawn element and every AREA layer.
 *
 * It does NOT currently paint over the `gisLine` band, because that band is a separate DOM host
 * above the whole SVG. Promoting the handle group into its own top host would move it out of the
 * plan SVG, and every planner drag relies on pointer moves BUBBLING to that SVG — a handle in a
 * sibling SVG would swallow the moves that pass over it mid-drag. So the deviation is deliberate,
 * and it is bounded: the line band is thin, non-interactive (`pointer-events: none`) and cannot
 * take a click, so a hairline may CROSS a handle but can never make one unreachable. Closing it
 * properly means lifting the handle layer and its pointer plumbing together — a change that must
 * be made with B1197's own guards, not alongside them. */

/* The planner canvas's ACTUAL CSS z-index for each of its three host elements. The `z`
 * numbers above are the MODEL'S ORDER (and what the export sorts by); these are the numbers
 * the DOM carries, kept deliberately small because the canvas chrome that already lives in
 * this wrapper — the identify cards, banners, toolbars, mobile rails — occupies 6 and up and
 * must stay above all three. Only the relative order matters, and it is the model's. */
export const CANVAS_Z = Object.freeze({
  basemap: 0, // the Leaflet backdrop <div>: basemap tiles + the gisArea pane
  plan: 1, // the planner SVG: reference → parcel → setback → elements → referenceFront → label → handle
  gisLine: 2, // the map-top host: the gisLine pane, above the plan, below the canvas chrome
});

/* ---------------------------------------------------------------------------------
 * ROLES — declared per GIS source, never inferred at render time from the geometry
 * that happens to come back. An explicit property is auditable and testable; a runtime
 * sniff is neither, and it would flip a layer's z-order between two map views.
 *
 *   area  — drawn as a filled polygon. Buries what it covers → UNDER site elements.
 *   line  — drawn as a stroke. A hairline over a building reads fine → OVER them.
 *   point — a marker/symbol. Reads like a line, and burying a well or a hydrant under a
 *           pad defeats the point of turning it on → OVER, with the lines.
 *
 * A source that publishes BOTH (an ArcGIS service whose sublayers are watershed polygons
 * AND stream centrelines) splits into its two roles via `roleLayers` — one request per
 * role, each into its own pane, both driven by the single panel row. See ROLE_SPLIT_NOTE. */
export const GIS_ROLES = ["area", "line", "point"];

/* Which roles sit ABOVE the site elements. */
export const ROLES_OVER_ELEMENTS = Object.freeze(["line", "point"]);

export const ROLE_SPLIT_NOTE =
  "A source whose sublayers are part polygon and part stroke declares `roleLayers: { area: [...], line: [...] }` " +
  "— one export request per role, area under the plan and lines over it, both driven by one panel row.";

/** Does this role draw over the site elements? */
export const roleOverElements = (role) => ROLES_OVER_ELEMENTS.includes(role);

/** The stack tier a role lands in. */
export const tierForRole = (role) => (roleOverElements(role) ? "gisLine" : "gisArea");

/* Canonical pane names. Two panes, because there are exactly two bands — not one pane per
 * layer, which would be a z-order picker by another name. */
export const PANE_AREA = "gisAreaPane";
export const PANE_LINE = "gisLinePane";
/* Name labels belonging to a layer ride in that layer's own band, so a stream's name never
 * ends up under the building the stream is drawn over. */
export const PANE_AREA_LABEL = "gisAreaLabelPane";
export const PANE_LINE_LABEL = "gisLineLabelPane";

/** Pane names for a role, given a caller's pane map. `panes` lets a surface with no site
 *  elements (the map finder) collapse both bands onto one pane and still keep lines above
 *  areas — the order is the model's, the hosting is the surface's. */
export function panesForRole(role, panes = null) {
  const over = roleOverElements(role);
  const p = panes || {};
  return {
    pane: (over ? p.line : p.area) || (over ? PANE_LINE : PANE_AREA),
    labelPane: (over ? p.lineLabel : p.areaLabel) || (over ? PANE_LINE_LABEL : PANE_AREA_LABEL),
  };
}

/** Every role a layer config renders in, bottom band first.
 *  → [{ role, layers }] where `layers` is the sublayer id list for that role (null = the
 *  config's own `layers`, i.e. the un-split case). */
export function rolesOf(cfg) {
  if (!cfg) return [];
  if (cfg.roleLayers) {
    return GIS_ROLES
      .filter((r) => Array.isArray(cfg.roleLayers[r]) && cfg.roleLayers[r].length > 0)
      .map((r) => ({ role: r, layers: cfg.roleLayers[r] }))
      // area first so a same-pane surface still paints fills under strokes
      .sort((a, b) => (roleOverElements(a.role) ? 1 : 0) - (roleOverElements(b.role) ? 1 : 0));
  }
  return cfg.role ? [{ role: cfg.role, layers: cfg.layers ?? null }] : [];
}

/** True when a config renders in more than one band (needs one request per role). */
export const isRoleSplit = (cfg) => rolesOf(cfg).length > 1;

/* ---------------------------------------------------------------------------------
 * THE AUDIT — a layer with no declared role has no defined position in the model, which
 * is exactly the drift this file exists to prevent. `test/mapStack.test.js` fails the
 * build on any problem here, so a new GIS source cannot merge un-classified. */
export function auditLayerRoles(allLayers = {}) {
  const problems = [];
  for (const [id, cfg] of Object.entries(allLayers)) {
    if (!cfg || typeof cfg !== "object") continue;
    const roles = rolesOf(cfg);
    if (!roles.length) {
      problems.push({ id, problem: "no `role` (or `roleLayers`) declared — every GIS source must declare area | line | point" });
      continue;
    }
    for (const { role } of roles) {
      if (!GIS_ROLES.includes(role)) problems.push({ id, problem: `unknown role "${role}" — expected one of ${GIS_ROLES.join(" | ")}` });
    }
    if (cfg.roleLayers && cfg.role) problems.push({ id, problem: "declares BOTH `role` and `roleLayers` — pick one (roleLayers is the split case)" });
    if (cfg.roleLayers) {
      const declared = Object.keys(cfg.roleLayers);
      for (const r of declared) if (!GIS_ROLES.includes(r)) problems.push({ id, problem: `roleLayers has unknown role "${r}"` });
      if (roles.length < 2) problems.push({ id, problem: "`roleLayers` with fewer than two non-empty roles — use a plain `role` instead" });
    }
  }
  return problems;
}

/** Ordering key for anything that has to paint the whole stack itself in one pass —
 *  the PDF/PNG export (PDF-PARITY). Lower paints first. */
export function stackOrder(tierId) {
  const t = MAP_STACK.find((x) => x.id === tierId);
  return t ? t.z : STACK_Z.elements;
}

/** Export helper: does this layer config paint ABOVE the drawn plan on the sheet?
 *  Split configs paint in BOTH bands, so the caller asks per role, not per config. */
export const exportsOverPlan = (role) => roleOverElements(role);
