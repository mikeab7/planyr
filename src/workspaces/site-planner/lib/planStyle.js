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
  pond: { fill: "#9fc4d4", stroke: "#5d8497", label: "Detention Pond", weight: 1.25, water: true },
  sidewalk: { fill: "#eceae3", stroke: "#b4b1a6", label: "Sidewalk", weight: 1, pattern: "sidewalk" },
  landscape: { fill: "#bcd3a6", stroke: "#7f9a63", label: "Landscape", weight: 1, hatch: true },
  road: { fill: "#b9b4a8", stroke: "#7c786d", label: "Road", weight: 1.25 },
};

// Resolved style for a type = built-in default merged with any user-set default
// (settings.typeStyles). An individual element may further override fill/stroke/
// fillOpacity on itself (the Bluebeam-style per-element Properties).
export const typeStyle = (type, settings) => ({ ...TYPE[type], ...((settings && settings.typeStyles && settings.typeStyles[type]) || {}) });

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
    water: !!base.water,
    pattern: base.pattern || null,
  };
};

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
export const byZ = (a, b) => zOrder(a) - zOrder(b);

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
