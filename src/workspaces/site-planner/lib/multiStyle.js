/* B734 — shared style editing across a multi-selection (Site Planner).
 *
 * Pure helpers, kept out of the 13k-line SitePlanner.jsx so they're unit-testable:
 *   - which style properties a single selected item exposes,
 *   - the COMMON editable set across a whole selection + each property's
 *     uniform-value-or-"mixed" state (so the panel can show a "—"/"Mixed"
 *     indicator instead of silently picking one element's value), and
 *   - the rotation-aware outline ring for the per-member selection chrome.
 *
 * Pure: depends only on the shared style resolver (planStyle) and the shared
 * markup geometry accessors (markupModel). No React, no DOM, no host state.
 */
import { elStyle, elRingFeet, toHex6 } from "./planStyle.js";
import { ptsOf } from "../../../shared/markup/markupModel.js";

// Closed markup kinds carry a fill; open ones (line / polyline / easement) don't.
const CLOSED_MARKUP = new Set(["rect", "ellipse", "polygon"]);

// A stable display order for the shared controls (opacity first — it's the driver).
const CAP_ORDER = ["fillOpacity", "fill", "stroke", "weight", "dash"];

/**
 * The style properties a single selected item can have edited in the shared panel.
 * - el: fill / stroke / fillOpacity are the ONLY per-element overrides (weight is a
 *   type-level token, so it isn't editable per element and never enters the set).
 * - markup: stroke / weight / dash always; fill / fillOpacity only on a closed shape.
 * - anything else (measure, callout): no shared style properties.
 */
export function styleCapsOf(item, kind) {
  if (!item) return [];
  if (kind === "el") return ["fill", "stroke", "fillOpacity"];
  if (kind === "markup") {
    const base = ["stroke", "weight", "dash"];
    return CLOSED_MARKUP.has(item.kind) ? [...base, "fill", "fillOpacity"] : base;
  }
  return [];
}

// Resolve one item's current value for a property (el defaults via elStyle, matching
// the render), so an el with no explicit fillOpacity reports 1, not undefined.
function valueOf(item, kind, prop, settings) {
  if (kind === "el") {
    const st = elStyle(item, settings);
    if (prop === "fill") return st.fill;
    if (prop === "stroke") return st.stroke;
    if (prop === "fillOpacity") return st.fillOpacity;
    return undefined;
  }
  if (kind === "markup") {
    if (prop === "stroke") return item.stroke;
    if (prop === "weight") return item.weight ?? 2;
    if (prop === "dash") return item.dash || "solid";
    if (prop === "fill") return item.fill;
    if (prop === "fillOpacity") return item.fillOpacity ?? 0;
    return undefined;
  }
  return undefined;
}

// Normalize a value for equality: colors compared as lowercase #rrggbb (so "#abc"
// and "#aabbcc" match), numbers coerced, dash left as its string.
function normVal(prop, v) {
  if (prop === "fill" || prop === "stroke") return toHex6(v || "").toLowerCase();
  if (prop === "fillOpacity" || prop === "weight") return Number(v);
  return v;
}

/**
 * The common editable style state across a selection.
 * @param members [{ item, kind }] — already resolved objects (el host / markup).
 * @returns { caps: string[], props: { [prop]: { value, mixed } } }
 *   caps = intersection of every member's styleCapsOf, in CAP_ORDER.
 *   props[p].mixed = true when members disagree on p (value is then undefined).
 */
export function commonStyleState(members, settings) {
  const valid = (members || []).filter((m) => m && m.item);
  if (!valid.length) return { caps: [], props: {} };
  let caps = null;
  for (const m of valid) {
    const c = new Set(styleCapsOf(m.item, m.kind));
    caps = caps == null ? c : new Set([...caps].filter((x) => c.has(x)));
  }
  const capList = CAP_ORDER.filter((p) => caps.has(p));
  const props = {};
  for (const prop of capList) {
    let value, key, mixed = false, first = true;
    for (const m of valid) {
      const v = valueOf(m.item, m.kind, prop, settings);
      const nk = normVal(prop, v);
      if (first) { value = v; key = nk; first = false; }
      else if (nk !== key) { mixed = true; break; }
    }
    props[prop] = { value: mixed ? undefined : value, mixed };
  }
  return { caps: capList, props };
}

/**
 * The rotation-aware outline ring for a member's selection chrome, in planner feet.
 * @returns { pts: {x,y}[], closed: boolean } | null
 *   - polygon el → its ring (closed); rotated-rect el → four rotated corners (closed);
 *   - centerline road (pts, no points) → its centerline polyline (open);
 *   - markup → its vertices, closed for rect/ellipse/polygon, else open.
 * Uses the element's own angle (never an axis-aligned box), so an angled strip gets a
 * tight outline instead of a box that floats wider than the footprint.
 */
export function selectionRingFeet(o, kind) {
  if (!o) return null;
  if (kind === "el") {
    if (Array.isArray(o.pts) && !o.points) return { pts: o.pts, closed: false }; // centerline road
    const ring = elRingFeet(o);
    return ring && ring.length ? { pts: ring, closed: true } : null;
  }
  if (kind === "markup") {
    const pts = ptsOf(o);
    if (!pts || !pts.length) return null;
    return { pts, closed: CLOSED_MARKUP.has(o.kind) };
  }
  return null;
}
