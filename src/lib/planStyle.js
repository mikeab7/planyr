/* Shared element styling for the planner canvas AND the map overview, so a
 * site plan looks identical wherever it's drawn. */

export const TYPE = {
  building: { fill: "#ffffff", stroke: "#2b2b2b", label: "Building" },
  paving: { fill: "#555555", stroke: "#333333", label: "Paving / Drive" },
  parking: { fill: "#555555", stroke: "#cfcfcf", label: "Car Parking" },
  trailer: { fill: "#555555", stroke: "#d4d4d4", label: "Trailer Parking" },
  pond: { fill: "#1ed4e1", stroke: "#0b8a96", label: "Detention Pond" },
  sidewalk: { fill: "#c9cccd", stroke: "#9aa1a8", label: "Sidewalk" },
  road: { fill: "#4a4a4a", stroke: "#e8e8e8", label: "Road" },
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
  };
};

// Coerce any CSS color we store into the #rrggbb form an <input type=color> needs.
export const toHex6 = (c) => {
  if (!c) return "#000000";
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map((h) => h + h).join("");
  return c;
};

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
