/* Shared element styling for the planner canvas AND the map overview, so a
 * site plan looks identical wherever it's drawn. */

// Architectural presentation palette — warm poché building, soft sage landscape,
// muted desaturated water, and a DIFFERENTIATED set of surface colours so the
// paved types never read as one undifferentiated grey (the old failure: paving,
// car/trailer parking, sidewalk and road were all near-identical warm greys).
// Each surface now carries two redundant cues so it stays legible for colour-blind
// users too: a distinct hue + lightness AND, for the plainest fills, a texture
// pattern (`pattern`, painted over the fill in the renderer). Parking always shows
// its stall striping and road its centreline/curbs, so those carry their own
// secondary cue; paving stays the neutral baseline. `weight` feeds a line hierarchy
// (property line / building heaviest, surface edges medium, internal striping
// hairline). Building carries a soft drop shadow in the renderer.
export const TYPE = {
  building: { fill: "#f3ece1", stroke: "#33302b", label: "Building", weight: 2, shadow: true },
  paving: { fill: "#d6d1c7", stroke: "#9a9384", label: "Paving / Drive", weight: 1.25 },
  parking: { fill: "#cdd7dd", stroke: "#7d949e", label: "Car Parking", weight: 1.25 },
  trailer: { fill: "#e3d4b2", stroke: "#b09a6c", label: "Trailer Parking", weight: 1.25, pattern: "trailer" },
  // B231 — cartographic water-body token (no wavy hatch). The fill is the EDGE tone of a
  // radial steel-teal gradient that deepens toward the center (`#2F6675`) in the renderer;
  // the outline is a constant-screen-pixel teal. `cartoWater` is the reusable style token so
  // future water/basin features inherit the same treatment. No orange — that's the Markup accent.
  pond: { fill: "#5B97A5", stroke: "#2C5D6B", label: "Detention Pond", weight: 2, cartoWater: true },
  sidewalk: { fill: "#eceae3", stroke: "#b4b1a6", label: "Sidewalk", weight: 1, pattern: "sidewalk" },
  landscape: { fill: "#bcd3a6", stroke: "#7f9a63", label: "Landscape", weight: 1, hatch: true },
  road: { fill: "#b9b4a8", stroke: "#7c786d", label: "Road", weight: 1.25 },
};

/* NEW-3 — ACCOUNT-level style defaults ("default for ALL projects").
 *
 * The precedence ladder, lowest to highest:
 *   built-in TYPE  <  account default (this user, every project)  <  project setting  <  per-object override
 *
 * It lives here as a module-level register rather than as an extra argument threaded through 14+
 * call sites, so EVERY consumer resolves style the same way — the canvas, the site-list thumbnail
 * (MapFinder), the KMZ export, the print sheet and the multi-select panel — and none of them can
 * drift from the others. It is a read-only fallback layer: it is never written into a site's
 * settings, so a project that hasn't overridden a value keeps following the account default when
 * that default later changes. `userPrefs.js` sets it once the signed-in profile loads.
 */
let ACCOUNT_STD = { parcelStyle: {}, typeStyles: {} };

export const setAccountStyleDefaults = (v) => {
  ACCOUNT_STD = { parcelStyle: { ...(v?.parcelStyle || {}) }, typeStyles: { ...(v?.typeStyles || {}) } };
};
export const getAccountStyleDefaults = () => ACCOUNT_STD;

/* NEW-2 — the PREVIEW layer: the Standards panel's uncommitted DRAFT.
 *
 * Standards edits are now a pending draft (nothing is stored until one of the three footer
 * buttons commits it), but a colour you are picking still has to be visible while you pick it.
 * So the draft rides here, ABOVE the project setting and BELOW a per-object override.
 *
 * The rule that keeps this honest: a draft changes what you SEE, never what gets STORED. Only
 * `typeStyle` reads it, because element type styles resolve at RENDER. `parcelDefaultStyle`
 * deliberately does NOT — it STAMPS a value into a new parcel, and an uncommitted value must
 * never be written into geometry.
 *
 * A `null` in the draft means "clear this override", so it deletes rather than overwrites — a
 * plain spread would have written `fill: null` and painted the element with nothing.
 */
let PREVIEW_STD = { typeStyles: {} };
export const setPreviewStyleDefaults = (v) => { PREVIEW_STD = { typeStyles: { ...(v?.typeStyles || {}) } }; };
export const getPreviewStyleDefaults = () => PREVIEW_STD;

/**
 * Where a given standard's current value comes from — what the Standards scope chips read.
 * @returns "project" (this plan overrides it) · "all" (an account default, every project) · "builtin"
 */
export const standardScope = (projectVal, accountVal) => {
  if (projectVal !== undefined && projectVal !== null) return "project";
  if (accountVal !== undefined && accountVal !== null) return "all";
  return "builtin";
};

// Resolved style for a type = built-in default, under the account default (NEW-3), under any
// project-level default (settings.typeStyles). An individual element may further override
// fill/stroke/fillOpacity on itself (the Bluebeam-style per-element Properties).
export const typeStyle = (type, settings) => {
  const over = {
    ...((ACCOUNT_STD.typeStyles || {})[type] || {}),
    ...((settings && settings.typeStyles && settings.typeStyles[type]) || {}),
  };
  // The uncommitted Standards draft sits on top; a null there CLEARS back to the built-in.
  const draft = (PREVIEW_STD.typeStyles || {})[type];
  if (draft) Object.entries(draft).forEach(([k, v]) => { if (v === null || v === undefined) delete over[k]; else over[k] = v; });
  return { ...TYPE[type], ...over };
};

export const elStyle = (el, settings) => {
  const base = typeStyle(el.type, settings);
  return {
    label: base.label,
    fill: el.fill ?? base.fill,
    stroke: el.stroke ?? base.stroke,
    fillOpacity: el.fillOpacity ?? base.fillOpacity ?? 1,
    weight: base.weight ?? 1,
    shadow: !!base.shadow,
    hatch: !!base.hatch,
    cartoWater: !!base.cartoWater,
    pattern: base.pattern || null,
  };
};

// Style keys stamped onto a freshly DRAWN / ADDED parcel from the user's Standards
// defaults (settings.parcelStyle). Only keys the user actually customized are returned,
// so an untouched default leaves the new parcel to the theme-aware built-in render
// fallbacks (no stroke → the theme's parcel color; no weight → 2; no dash → solid; no
// fill → unfilled). Fill is deliberately opt-in: fillOpacity rides along only when a fill
// color is set. A duplicated / merged / split parcel copies its SOURCE style and never
// calls this. Because these are stamped at creation (not resolved at render), changing a
// default only affects PARCELS DRAWN AFTERWARD — matching "Defaults for new elements".
export const parcelDefaultStyle = (settings) => {
  // NEW-3 — account default under the project's own default (see setAccountStyleDefaults).
  const ps = { ...(ACCOUNT_STD.parcelStyle || {}), ...((settings && settings.parcelStyle) || {}) };
  const out = {};
  if (ps.stroke) out.stroke = ps.stroke;
  if (ps.weight != null) out.weight = ps.weight;
  if (ps.dash && ps.dash !== "solid") out.dash = ps.dash;
  if (ps.fill) {
    out.fill = ps.fill;
    if (ps.fillOpacity != null) out.fillOpacity = ps.fillOpacity;
  }
  // NEW-1 — the SETBACK line's own colour / weight / style, stamped exactly like the boundary's.
  // A value equal to the render default is deliberately NOT stamped, so a parcel drawn with
  // untouched standards carries no setback keys at all and renders exactly as it always has.
  if (ps.sbStroke) out.sbStroke = ps.sbStroke;
  if (ps.sbWeight != null && ps.sbWeight !== SETBACK_LINE.weight) out.sbWeight = ps.sbWeight;
  if (ps.sbDash && ps.sbDash !== SETBACK_LINE.dash) out.sbDash = ps.sbDash;
  return out;
};

/* ---------------------------------------------------------------- the SETBACK line (NEW-1)
 *
 * The setback ring used to be hardcoded at the one place it was drawn — a fixed colour, a fixed
 * weight and a fixed "7 6" dash — while the parcel BOUNDARY beside it carried a full set of
 * standards. This is the one derivation both the ring and its dimension chip read, so the two
 * can never drift, and it is pure so the "existing plan renders byte-identically" guard is a
 * unit test rather than a screenshot.
 *
 * The defaults ARE today's look: weight 1.25, and `dashed` at that weight is exactly "7 6".
 */
export const SETBACK_LINE = { weight: 1.25, dash: "dashed" };

const round3 = (n) => +n.toFixed(3);
/** Line style name → SVG dash pattern, scaled off the line weight (so "7 6" holds at 1.25). */
export const setbackDashArray = (dash, weight) => {
  const w = weight != null ? weight : SETBACK_LINE.weight;
  if (dash === "solid") return undefined;
  if (dash === "dotted") return `${round3(w)} ${round3(w * 2.4)}`;
  return `${round3(w * 5.6)} ${round3(w * 4.8)}`; // "dashed" — the historic ring
};

/**
 * Resolved setback-line style for one parcel. `fallbackStroke` is the theme's setback colour
 * (PAL.setback), passed in because SVG attributes can't read a CSS var.
 * @returns { stroke, weight, dash } — `dash` is the ready-to-use strokeDasharray (undefined = solid)
 */
export const setbackLineStyle = (pc, fallbackStroke) => {
  const weight = pc && pc.sbWeight != null ? pc.sbWeight : SETBACK_LINE.weight;
  const dash = (pc && pc.sbDash) || SETBACK_LINE.dash;
  return { stroke: (pc && pc.sbStroke) || fallbackStroke, weight, dash: setbackDashArray(dash, weight) };
};

/* ------------------------------------------------------------ the setback CHIP's ink (NEW-1)
 *
 * The dimension chip on the map is a WHITE PLATE with a border and numerals, and those two read
 * a FIXED INK that tracks NOTHING on the parcel — not the setback line's colour, not the
 * boundary's. That decoupling IS the feature (owner, 2026-07-30, on the amber parcel: "the
 * setback is orange, and then the chip showing that setback, the outline of the chip is orange,
 * and then the text is orange. I'd like that to all be … black.").
 *
 * It was re-coupled once already: the chip resolved `pc.sbStroke || ink`, which reads as black
 * only for as long as nobody has set a setback colour. The moment the line default moved
 * indigo → green (B1192) — or a user picks any colour of their own — the chip inherited it
 * again and the ink default was dead code on that parcel.
 *
 * So this takes **NO parcel**. The independence is structural, not a convention that survives
 * only while each future edit remembers it: there is no per-parcel value in scope here to
 * couple to. `ink` is the theme's chip-ink token (`PAL.chipInk`), passed in because an SVG
 * attribute cannot read a CSS var.
 *
 * @returns { plate, stroke, text } — plate fill, border colour, numeral colour
 */
export const setbackChipStyle = (ink) => ({ plate: "#fff", stroke: ink, text: ink });

// Coerce any CSS color we store into the #rrggbb form an <input type=color> needs.
export const toHex6 = (c) => {
  if (!c) return "#000000";
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map((h) => h + h).join("");
  return c;
};

// Paint order: ground surfaces first, structures last, so paving/road never
// cover a building (a dock dog-ear is a building bump-out that sits ON the court).
const Z_LAYER = { road: 0, paving: 1, sidewalk: 1, landscape: 1, pond: 2, parking: 3, trailer: 3, building: 5 };
export const zOrder = (el) => Z_LAYER[el.type] ?? 4;
// Paint order = the type layer, then the element's explicit `z` (the within-type tiebreak, B671),
// then id. Before v12 this leaned on Array.sort being stable + array position as the tiebreak — but
// array order isn't preserved across the cross-tab merge and has no per-row home once elements are
// individual site_elements rows, so the tiebreak is now the explicit z (0 for any not-yet-migrated
// element) with id as the final deterministic decider.
export const byZ = (a, b) =>
  zOrder(a) - zOrder(b) ||
  (a.z || 0) - (b.z || 0) ||
  (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

// Outline of an element in planner feet: polygon points, or the rect's four
// rotated corners.
export const elRingFeet = (el) => {
  if (el.points) return el.points;
  if (el.w == null || el.h == null) return null;
  const r = ((el.rot || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const hw = el.w / 2, hh = el.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => ({
    x: el.cx + lx * c - ly * s,
    y: el.cy + lx * s + ly * c,
  }));
};
