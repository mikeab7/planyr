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
 * NO new mode, NO keyboard shortcut, NO free-form z-order picker (front/back, up/down, a
 * per-layer number). A future exception to the DEFAULT is a deliberate edit to THIS file.
 *
 * ⛔ THE ONE ESCAPE HATCH IS *ORDER*, NOT OPACITY (NEW-1, 2026-07-30 — this CORRECTS the
 * claim B1205/B1206 shipped with).
 *   Opacity CANNOT fix occlusion for a layer that sits UNDER the site elements. Fading a
 *   buried floodplain fill changes nothing on screen — the building still covers it, and all
 *   the slider does is make the parts you CAN see fainter. Opacity only helps a layer that is
 *   already ON TOP and too loud. Occlusion order can only be fixed by order.
 *   So the escape hatch is the per-layer **"Show above plan"** toggle: a two-state,
 *   semantically-named lift of ONE layer into the `gisAreaFront` tier — above the site
 *   elements, still below the labels/chips and below B1197's always-on-top handle layer.
 *   Per-layer opacity stays (B1206) and is still worth having; it is just not the answer to
 *   "I can't see through my plan".
 *   The DEFAULT is unchanged and stays the point: an area layer defaults to BELOW and a line
 *   layer is already above, so the owner's contours-behind-buildings case needs ZERO clicks.
 *   A toggle you never have to touch beats a toggle you always have to touch.
 *
 * WHERE THE TIERS PHYSICALLY LIVE (planner canvas, SitePlanner.jsx):
 *   basemap · gisArea      → Leaflet panes inside the BACKDROP map <div> (below the SVG)
 *   reference … handle     → `<g>` groups INSIDE the one planner SVG, in this order
 *   gisAreaFront           → a Leaflet pane hosted INSIDE the planner SVG, in a screen-space
 *                            <foreignObject> sitting at the `data-gis-front-band` anchor —
 *                            which is how a LIFTED fill gets above the elements and still
 *                            stays under the labels and the handles (a fill over a handle
 *                            would hide the grip you are dragging; a hairline never does)
 *   gisLine                → a Leaflet pane hosted ABOVE the SVG (the map-top host)
 * The SVG is a single DOM node, so it occupies the contiguous reference…handle band; the
 * order WITHIN it is realized by its own child order, not by z-index.
 *
 * References (a scanned exhibit the user is aligning) are USER CONTENT, not a data layer,
 * so Figma-style Bring-to-front / Send-to-back ordering is correct for them — that control
 * reorders references AMONG THEMSELVES, inside this tier. It does not define its own scheme.
 *
 * Pure — no DOM, no Leaflet, no imports. */

/* Bottom → top. `z` is the CSS z-index each tier's host element takes when it is its own
 * DOM node; tiers that share the planner SVG all resolve to the SVG's own z-index. Gaps of
 * 100 are deliberate: a new tier slots in without renumbering the world.
 *
 * ⚠ Each tier is `{ id, z }` and NOTHING else: what a tier MEANS is documented here, in comments,
 * because a human-readable label on every entry is a string that ships to every visitor's browser
 * and that no runtime code ever reads. (NEW-1 moved them out for exactly that reason, paying for
 * its own bundle cost rather than raising the site route's budget.)
 *   basemap        100 — aerial / basemap imagery
 *   gisArea        200 — GIS AREA layers: filled polygons (floodplain, wetlands, soils, districts)
 *   reference      300 — references / imported site-plan overlays (the DEFAULT "below" band)
 *   parcel         400 — parcel boundary
 *   setback        500 — setback band
 *   elements       600 — site elements
 *   referenceFront 650 — B1198's opt-in "Draw above the plan" band. A reference is USER CONTENT, so
 *                        a user may deliberately promote one over the plan (a coloured land-plan
 *                        exhibit being worked ON); it still sits inside this model rather than
 *                        defining a scheme of its own. lib/overlayOrder.js owns the ordering WITHIN
 *                        both reference bands (front/back among references).
 *   gisAreaFront   660 — NEW-1: an AREA layer the user explicitly LIFTED with "Show above plan". It
 *                        clears the site elements — the whole point — but deliberately stops below
 *                        the labels and the handles: a FILL is not a hairline, and a fill over a
 *                        grip hides the thing you are dragging.
 *   gisLine        700 — GIS LINE layers: strokes (contours, streams, easement centrelines, BFE
 *                        lines, utility lines)
 *   label          800 — labels & chips
 *   handle         900 — manipulation handles, always on top */
export const MAP_STACK = [
  { id: "basemap", z: 100 },
  { id: "gisArea", z: 200 },
  { id: "reference", z: 300 },
  { id: "parcel", z: 400 },
  { id: "setback", z: 500 },
  { id: "elements", z: 600 },
  { id: "referenceFront", z: 650 },
  { id: "gisAreaFront", z: 660 },
  { id: "gisLine", z: 700 },
  { id: "label", z: 800 },
  { id: "handle", z: 900 },
];

export const STACK_Z = Object.freeze(Object.fromEntries(MAP_STACK.map((t) => [t.id, t.z])));

/* The tiers that share the ONE planner SVG element. The SVG's own z-index is the first of
 * them, which is what puts the whole band above gisArea. `gisAreaFront` (NEW-1) joins them:
 * its Leaflet pane is hosted in a screen-space <foreignObject> parked at the SVG's
 * `data-gis-front-band` anchor, so a lifted fill clears the elements without leaving the one
 * SVG — which is exactly what keeps it under the labels and under the handle layer. */
export const SVG_TIERS = ["reference", "parcel", "setback", "elements", "referenceFront", "gisAreaFront", "label", "handle"];
export const SVG_Z = STACK_Z.reference;

/* The DOM anchor the lifted band is hosted at, inside the plan SVG. Named here (not spelled
 * inline at each site) because THREE renderers have to agree on it: the canvas mounts the
 * pane host at it, the PDF/PNG export inserts the lifted layers into it (PDF-PARITY), and the
 * e2e stacking spec reads it to prove the tier is where the model says it is. */
export const FRONT_BAND_ATTR = "data-gis-front-band";

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
 * be made with B1197's own guards, not alongside them.
 *
 * ⚠ THE DEVIATION IS BOUNDED TO `gisLine`, AND NEW-1 DELIBERATELY DID NOT WIDEN IT. The cheap way
 * to build "Show above plan" would have been to drop the lifted layer into the map-top host beside
 * the line band — one line of code, and it would have inherited this deviation. Refused: the
 * deviation is only tolerable for a HAIRLINE. A filled floodplain wash painted over the handle
 * layer would hide the grip you are dragging, which is strictly worse than the occlusion the lift
 * exists to fix. Hence the in-SVG `gisAreaFront` host. Keep it there. */

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
 * THE ROLE SPLIT: a source that publishes BOTH (an ArcGIS service whose sublayers are watershed
 * polygons AND stream centrelines) declares `roleLayers: { area: [...], line: [...] }` and renders
 * as one request per role, each into its own pane — area under the plan, lines over it — both
 * driven by the single panel row, the single opacity and the single "Show above plan" toggle. */
export const GIS_ROLES = ["area", "line", "point"];

/* Which roles sit ABOVE the site elements. */
export const ROLES_OVER_ELEMENTS = Object.freeze(["line", "point"]);

/** Does this role draw over the site elements? */
export const roleOverElements = (role) => ROLES_OVER_ELEMENTS.includes(role);

/** The stack tier a role lands in, by DEFAULT (before any user lift). */
export const tierForRole = (role) => (roleOverElements(role) ? "gisLine" : "gisArea");

/* ---------------------------------------------------------------------------------
 * "SHOW ABOVE PLAN" (NEW-1) — the per-layer, two-state lift.
 *
 * Only an AREA role can be lifted, and that is the whole design, not a limitation:
 *   • an area fill is the ONLY role the default puts under the elements, so it is the only
 *     one that can be occluded by them — and opacity cannot fix that (see the header);
 *   • line and point roles are ALREADY over the plan, so for them the control has nothing to
 *     do. The panel renders it in its already-on state rather than hiding it, so a row's
 *     silence never has to be interpreted (see LayerPanel's abovePlanControl).
 * A role-SPLIT source (FEMA zones + hazard boundaries) lifts only its AREA half; its line half
 * was over the plan already. One row, one toggle, still two export requests. */
export const LIFTABLE_ROLE = "area";

/** Can this role be lifted above the plan? (Only the one the default puts underneath.) */
export const canLiftRole = (role) => role === LIFTABLE_ROLE;

/** Does this layer config have anything the lift would actually move? */
export const configCanLift = (cfg) => rolesOf(cfg).some((r) => canLiftRole(r.role));

/** The stack tier a role lands in GIVEN the user's per-layer lift. */
export const tierForLayer = (role, above = false) =>
  (above && canLiftRole(role) ? "gisAreaFront" : tierForRole(role));

/** Does every part of this layer draw above the site elements right now? True for a line/point
 *  source always, for an area source only once lifted. The panel's checked-state. */
export const layerOverPlan = (cfg, above = false) => {
  const roles = rolesOf(cfg);
  return roles.length > 0 && roles.every((r) => roleOverElements(r.role) || (above && canLiftRole(r.role)));
};

/* Canonical pane names. One pane per BAND — never one pane per layer, which would be a
 * free-form z-order picker by another name. */
export const PANE_AREA = "gisAreaPane";
export const PANE_AREA_FRONT = "gisAreaFrontPane"; // NEW-1 — the lifted band, hosted inside the plan SVG
export const PANE_LINE = "gisLinePane";
/* Name labels belonging to a layer ride in that layer's own band, so a stream's name never
 * ends up under the building the stream is drawn over. */
export const PANE_AREA_LABEL = "gisAreaLabelPane";
export const PANE_AREA_FRONT_LABEL = "gisAreaFrontLabelPane";
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

/** Pane names for a role GIVEN the user's per-layer lift (NEW-1). A lifted AREA role takes the
 *  front band's panes; every other case is exactly `panesForRole`, unchanged.
 *
 *  A surface with no site elements (the map finder) has nothing to be "above", so it may point
 *  `areaFront` back at its own area pane — the caller's hosting decision. The BAND KEY below is
 *  read off the resolved pane names for precisely that reason: when the two collapse onto one
 *  pane there is no rebuild to do, and asking the pane rather than the flag is what knows it. */
export function panesForLayer(role, panes = null, above = false) {
  if (!(above && canLiftRole(role))) return panesForRole(role, panes);
  const p = panes || {};
  return {
    pane: p.areaFront || PANE_AREA_FRONT,
    labelPane: p.areaFrontLabel || PANE_AREA_FRONT_LABEL,
  };
}

/** The identity of the band set a live layer was BUILT into. Leaflet fixes a layer's pane at
 *  construction, so flipping "Show above plan" has to tear the layer down and re-add it — and
 *  `syncOverlayLayers` needs a cheap, exact way to notice. Comparing resolved pane names (not
 *  the `above` flag) means a surface that collapses the bands never rebuilds for nothing. */
export function bandKey(cfg, panes = null, above = false) {
  const roles = rolesOf(cfg);
  const parts = roles.length ? roles : [{ role: LIFTABLE_ROLE }];
  return parts.map(({ role }) => {
    const { pane, labelPane } = panesForLayer(role, panes, above);
    return `${pane}/${labelPane || ""}`;
  }).join("|");
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

/* The three bands the SHEET composites, named once so screen and paper cannot drift
 * (PDF-PARITY). `under` inserts at the backdrop anchor, `front` goes into the plan SVG's own
 * `data-gis-front-band` group — which is why a lifted fill prints above the buildings and still
 * under the printed labels, exactly as it reads on screen — and `over` appends after the plan. */
export const EXPORT_BANDS = Object.freeze(["under", "front", "over"]);

/** Which sheet band a role prints in, given the user's per-layer lift (NEW-1). */
export const exportBandFor = (role, above = false) => {
  if (roleOverElements(role)) return "over";
  return above && canLiftRole(role) ? "front" : "under";
};
