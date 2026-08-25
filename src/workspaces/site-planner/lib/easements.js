/* Easement domain logic — pure, client-side, dependency-free, unit-tested.
 *
 * A "first-class" easement is a markup (kind:"easement") on the editable layer —
 * the imported survey/drawing stays an immutable backdrop; the easement is analysis
 * the user builds OVER it. This module owns everything ABOUT an easement that isn't
 * React: its type catalog, its derived display label, the default attributes, and
 * the geometry that turns each INPUT MODE into the drawn ring. All math is planar
 * feet (the app's EPSG:2278 frame).
 *
 * Three input modes:
 *   • centerline — a digitized spine + total width → a symmetric strip (offsetting
 *                  the centerline ±width/2 with flat end caps).  [NEW-1 mode A]
 *   • boundary   — a closed polygon drawn (or parsed from a metes-and-bounds legal
 *                  description) directly.                          [NEW-1 mode B / NEW-2]
 *   • parceledge — a contiguous run of parcel edges + a width → a one-sided strip
 *                  parallel to and inset from the boundary.        [NEW-3]
 *
 * The offset engine (offsetPolyline / bufferPolyline in metesAndBounds.js) is shared
 * with the corridor plotter and is already asymmetric-capable, so an asymmetric-strip
 * UI later needs no new geometry — only a per-side width.
 */
import { offsetPolyline, bufferPolyline } from "./metesAndBounds.js";
// Ray-cast point-in-ring (even-odd) — used to choose which side of a parcel edge is "interior".
import { pointInRing, ringArea } from "./ringMath.js";
import { isHatchKey } from "../../../shared/style/hatchPatterns.js";

/* The type catalog drives the attributes dropdown, the color-coding, and the label.
 * `short` is the human label suffix ("16′ Sanitary Sewer Esmt"); `color` is the
 * semi-transparent fill / hatch color so a glance reads the type. */
export const EASEMENT_TYPES = [
  { key: "utility",  label: "Utility / PUE",            short: "Utility Esmt",            color: "#7c3aed" },
  { key: "sanitary", label: "Sanitary Sewer",          short: "Sanitary Sewer Esmt",     color: "#a16207" },
  { key: "storm",    label: "Storm / Drainage",        short: "Storm/Drainage Esmt",     color: "#0891b2" },
  { key: "water",    label: "Water",                   short: "Water Esmt",              color: "#2563eb" },
  { key: "pipeline", label: "Pipeline",                short: "Pipeline Esmt",           color: "#b45309" },
  { key: "access",   label: "Access / Ingress-Egress", short: "Access Esmt",             color: "#15803d" },
  { key: "aerial",   label: "Aerial / Overhead",       short: "Aerial Esmt",             color: "#9333ea" },
  { key: "temp",     label: "Temporary Construction",  short: "Temp Construction Esmt",  color: "#6b7280" },
  { key: "other",    label: "Other",                   short: "Easement",                color: "#4b5563" },
];
const TYPE_BY_KEY = Object.fromEntries(EASEMENT_TYPES.map((t) => [t.key, t]));
export const easementType = (key) => TYPE_BY_KEY[key] || TYPE_BY_KEY.other;
export const easementColor = (e) => easementType(e && e.easeType).color;

/* Attribute defaults for a freshly-created easement. restrictsBuildings defaults
 * TRUE (an easement usually keeps buildings off it); restrictsPaving defaults FALSE
 * (most easements still allow paving over them). */
export const DEFAULT_EASEMENT_ATTRS = {
  easeType: "utility",
  holder: "",            // holder / beneficiary
  recording: "",         // recording reference (free text)
  exclusive: false,      // exclusive use (y/n)
  status: "existing",    // "existing" | "proposed"
  restrictsBuildings: true,
  restrictsPaving: false,
  notes: "",
};

/* Display label, derived from type + width (cosmetic only). A user override
 * (`labelOverride`) always wins — that's the "relabel" affordance. Strip modes
 * include the width ("16′ Sanitary Sewer Esmt"); a boundary easement has no single
 * width so it's just the type label. */
export function easementLabel(e) {
  if (e && typeof e.labelOverride === "string" && e.labelOverride.trim()) return e.labelOverride.trim();
  const t = easementType(e && e.easeType);
  const w = e && e.width;
  const wStr = (e && e.mode !== "boundary" && w > 0) ? `${Math.round(w)}′ ` : "";
  return `${wStr}${t.short}`;
}

// Shoelace area (absolute) of a ring of {x,y} — feet² when fed planner feet.
export { ringArea };

/* ---------------------------------------------------------------- appearance (NEW-EASE-STYLE)
 *
 * Before this, an easement carried NO appearance properties at all — its colour came
 * entirely from `easementColor()` (the type catalog above) and its fill was a single
 * hardcoded diagonal-hatch <pattern> per type, baked into SitePlanner.jsx. Owner request
 * (verbatim): "I should really be able to modify easements, like the colors, fill, hatch."
 *
 * DESIGN DECISION 1 — per-type default, with a per-element override (not one or the
 * other). This mirrors the precedent `planStyle.elStyle` already sets for elements
 * (`el.fill ?? base.fill` — a built-in/type default an individual object can override):
 * a plan set wants every pipeline easement to look alike by default (consistency across
 * the drawing), and this gives that for free — but a specific easement can still be
 * called out (a conflicting one, a particularly sensitive one) without breaking every
 * other pipeline easement's look. `hasOverride` tells the caller whether an easement
 * needs its OWN <pattern> (SitePlanner.jsx) or can share its type's.
 *
 * DESIGN DECISION 2 — status ("existing"/"proposed") already drives ONE visual today:
 * SitePlanner.jsx dashes the outline when `status === "proposed"` (solid = existing).
 * That is UNCHANGED by this work — it predates it and isn't part of the new fill/hatch
 * model. Note for the record: several drafting offices use the OPPOSITE convention
 * (existing = dashed/hidden-line, proposed = solid/definite), so this is a judgement
 * call, not a universal standard. Left as-is here because flipping it would silently
 * re-style all 26 production easements (today all `status:"existing"`, i.e. all solid)
 * with no user action — a one-line change (`SitePlanner.jsx`, the `proposed` ternary on
 * the easement polygon's `strokeDasharray`) if the owner wants it flipped.
 *
 * A future per-status-driven FILL change (independent of the dash) was considered and
 * deliberately NOT added — status stays purely a dash cue, appearance stays purely
 * type/override-driven, so the two questions ("what kind of easement" and "is it
 * built yet") don't fight over the same visual channel.
 */
export const DEFAULT_EASE_FILL_OPACITY = 0.10; // matches the pre-existing hardcoded pattern wash
export const DEFAULT_EASE_HATCH = "diagonal";  // matches the pre-existing hardcoded pattern

/** Resolved appearance for one easement: type default (from `easeType`), with any
 * per-element override winning. A plain easement — no fill/stroke/fillOpacity/hatch
 * keys at all, the shape every easement in production is in today — resolves to
 * exactly the historic hardcoded look, so shipping this changes nothing on screen
 * until a user actually edits an easement's appearance. */
export function easementStyle(e) {
  const t = easementType(e && e.easeType);
  const fill = (e && e.fill) || t.color;
  const stroke = (e && e.stroke) || t.color;
  const fillOpacity = (e && e.fillOpacity != null) ? e.fillOpacity : DEFAULT_EASE_FILL_OPACITY;
  const hatch = (e && e.hatch != null && isHatchKey(e.hatch)) ? e.hatch : DEFAULT_EASE_HATCH;
  const hasOverride = !!(e && (e.fill || e.stroke || e.fillOpacity != null || (e.hatch != null && e.hatch !== DEFAULT_EASE_HATCH)));
  return { fill, stroke, fillOpacity, hatch, hasOverride };
}

/** The <pattern> id an easement's fill should reference: the shared per-TYPE pattern
 * when unedited (so most easements draw from one shared <pattern>, not one each), or a
 * per-element id once it carries any override. */
export function easementPatternId(e) {
  return easementStyle(e).hasOverride ? `pat-ease-el-${e.id}` : `pat-ease-${easementType(e && e.easeType).key}`;
}

/* DESIGN DECISION 3 — encumbrances (kind:"encumbrance", the metes-and-bounds deed/title
 * tract objects — e.g. Grand Port's e1454610zupcbv/e1454611zupcbv) share this SAME
 * appearance model. They already carry `fill`/`stroke`/`fillOpacity` fields (stamped at
 * creation in SitePlanner.jsx's `buildEncumbranceMarkup`) but the renderer never read
 * `fill`/`fillOpacity` — only `stroke`/`weight`/`dash` were live, so those two fields
 * were dead data on every encumbrance ever drawn. There is no `easeType` catalog to key
 * a per-type default off (a title encumbrance isn't a categorized utility easement), so
 * `ENCUMBRANCE_DEFAULT` is the one fixed recipe every encumbrance falls back to — chosen
 * to match the historic hand-authored `pat-encumber` pattern exactly (a purple hatch
 * LINE with no background wash), so an untouched encumbrance still renders byte-for-byte
 * as before. Wiring up the (previously inert) `fill`/`fillOpacity` fields does mean the
 * two Grand Port encumbrances — which already carry non-default `fillOpacity` (0.14 /
 * 0.10 for the except-hole) from creation — will now show a faint colour wash matching
 * their own outline colour once this ships; that reads as the feature the stored data
 * always implied and never got wired to, not a regression, but it IS a visible change on
 * two live records and is called out here + in the backlog item for the owner to weigh. */
export const ENCUMBRANCE_DEFAULT = { fill: "#7c3aed", stroke: "#7c3aed", fillOpacity: 0, hatch: "diagonal" };

export function encumbranceStyle(e) {
  const d = ENCUMBRANCE_DEFAULT;
  const fill = (e && e.fill) || d.fill;
  const stroke = (e && e.stroke) || d.stroke;
  const fillOpacity = (e && e.fillOpacity != null) ? e.fillOpacity : d.fillOpacity;
  const hatch = (e && e.hatch != null && isHatchKey(e.hatch)) ? e.hatch : d.hatch;
  const hasOverride = !!(e && (e.fill || e.fillOpacity != null || (e.hatch != null && e.hatch !== d.hatch)));
  return { fill, stroke, fillOpacity, hatch, hasOverride };
}

export function encumbrancePatternId(e) {
  return encumbranceStyle(e).hasOverride ? `pat-encumber-el-${e.id}` : "pat-encumber";
}

/* Turn an easement's stored INPUT (mode + centerline/pts + width) into the closed
 * strip/boundary ring that gets drawn and area-counted. This is the single place
 * geometry is derived, so editing a vertex or the width and re-deriving always
 * agrees with what was first created.
 *   • boundary   → the polygon itself
 *   • parceledge → a one-sided strip: the edge run + its inward offset, reversed
 *   • centerline → a symmetric (asymmetric-ready) strip around the spine */
export function deriveEasementRing(e) {
  if (!e) return null;
  if (e.mode === "boundary") return (e.pts && e.pts.length >= 3) ? e.pts : null;
  const cl = e.centerline || [];
  if (cl.length < 2) return (e.pts && e.pts.length >= 3) ? e.pts : null;
  if (e.mode === "parceledge") {
    const inner = offsetPolyline(cl, (e.offsetSide || 1) * (e.width || 0));
    return inner ? [...cl, ...inner.slice().reverse()] : null;
  }
  // centerline (default): symmetric ±width/2, or per-side leftW/rightW if ever set
  return bufferPolyline(cl, e.width || 0, { leftW: e.leftW, rightW: e.rightW });
}

// Area (ft²) of an easement from its derived ring.
export function easementArea(e) {
  const r = deriveEasementRing(e);
  return r ? ringArea(r) : 0;
}

/* NEW-3 — a one-sided strip running parallel to, and inset from, a contiguous run
 * of an active parcel's edges (the "10′ utility easement adjacent to the property
 * line" pattern). `edgeIdx` are edge indices (edge i = points[i]→points[i+1]); they
 * must form ONE contiguous run (wrap-around allowed). The inward side is chosen
 * automatically (offset toward the parcel interior). Corners where the run turns are
 * mitered by the shared offset engine.
 *
 * Returns { ring, run, offsetSide } — `run` is the edge-run polyline (stored as the
 * easement's editable "centerline"), `offsetSide` is +1/-1 so re-derivation matches.
 * Returns null if the selection isn't a usable run. */
export function buildParcelEdgeStrip(parcelPoints, edgeIdx, width) {
  const n = parcelPoints ? parcelPoints.length : 0;
  if (n < 3 || !edgeIdx || !edgeIdx.length || !(width > 0)) return null;
  const set = [...new Set(edgeIdx.map((i) => ((i % n) + n) % n))].sort((a, b) => a - b);
  if (set.length >= n) return null; // the whole boundary isn't an edge "run" (that's a setback ring)
  const has = (i) => set.includes(((i % n) + n) % n);
  // Start at an edge whose predecessor isn't selected (the open end of the run).
  let start = set.find((i) => !has(i - 1));
  if (start == null) start = set[0];
  // Walk forward; bail unless ALL selected edges form one contiguous chain.
  const edges = [];
  for (let k = 0, i = start; k < set.length; k++, i = (i + 1) % n) {
    if (!has(i)) break;
    edges.push(i);
  }
  if (edges.length !== set.length) return null;
  // Run vertices: points[start] .. points[last+1].
  const run = [parcelPoints[start]];
  for (const e of edges) run.push(parcelPoints[(e + 1) % n]);
  if (run.length < 2) return null;
  // Decide the inward side with a thin probe offset (always lands inside for a small
  // inset), then apply the full width on that side. Probe the offset run's CENTROID,
  // not a vertex — a vertex can sit exactly on another parcel edge, where point-in-ring
  // is ambiguous.
  const probe = Math.max(0.5, Math.min(width, width * 0.1));
  const probeCentroid = (side) => {
    const o = offsetPolyline(run, side * probe);
    if (!o) return null;
    let x = 0, y = 0; o.forEach((p) => { x += p.x; y += p.y; });
    return { x: x / o.length, y: y / o.length };
  };
  const inProbe = probeCentroid(1);
  const side = (inProbe && pointInRing(inProbe, parcelPoints)) ? 1 : -1;
  const inner = offsetPolyline(run, side * width);
  if (!inner) return null;
  return { ring: [...run, ...inner.slice().reverse()], run, offsetSide: side };
}
