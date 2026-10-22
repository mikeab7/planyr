/* Imagery & Layers panel — the PURE rules behind the two-pane redesign (owner-approved mockup,
 * round 3, 2026-10-20). No React, no Leaflet, no registry import: every function takes the
 * registry (or the entries) it should reason about, so the whole module loads in plain Node and the
 * panel component is left with presentation only (the layerPanelInfo.js precedent).
 *
 * WHAT LIVES HERE
 *   · the seven panel groups, in order, and which registry `group` feeds which panel group;
 *   · LOCATION: whether a row can serve a site at all (state + a DECLARED region scope) — a row that
 *     cannot is not rendered, never demoted into a reveal list;
 *   · the DRAW filter: Hide Layers and "row hidden at this location" both resolve to the same pure
 *     function, so the saved overlay state is never written to (byte-identical site model);
 *   · the row dropdown PLAN (what a row's ▾ holds, in order, and only what applies);
 *   · small presentation facts: swatch, legend key, elevation ramp gradient, merged-row key.
 *
 * ⛔ NOTHING HERE WRITES OVERLAY STATE. The panel's checkboxes are the only writers; this module only
 * decides what is SHOWN and what is DRAWN.
 */

import { areaContains } from "./serviceAreas.js";

/* ── Groups ─────────────────────────────────────────────────────────────────────────────────── */

/* The seven panel groups, in the owner's order. `base` is special: it holds the basemap source, the
 * labels and (finder only) "Your Data" — none of which are rows of the overlay registry, and none of
 * which Hide Layers touches. */
export const PANEL_GROUPS = [
  { key: "base", label: "Map Base" },
  { key: "topo", label: "Topography" },
  { key: "jur", label: "Jurisdictions" },
  { key: "flood", label: "Flood & Drainage" },
  { key: "util", label: "Utilities" },
  { key: "env", label: "Environmental" },
  { key: "access", label: "Access" },
];
export const PANEL_GROUP_KEYS = PANEL_GROUPS.map((g) => g.key);

/* registry `group` → panel group. The registry's own taxonomy (LAYER_GROUP_ORDER) is left exactly as
 * it is — other surfaces and tests read it; this map is the panel's view of it. */
const REGISTRY_TO_PANEL = {
  base: "topo", jurisdiction: "jur", flood: "flood", utilities: "util", environmental: "env", access: "access",
};
export const panelGroupOf = (cfg) => (cfg && (cfg.panelGroup || REGISTRY_TO_PANEL[cfg.group])) || null;

/* Entries ([id, cfg]) of the registry that belong to one panel group. */
export function groupEntriesFor(layers, panelGroup) {
  return Object.entries(layers || {}).filter(([, cfg]) => panelGroupOf(cfg) === panelGroup && !cfg.settingOf);
}

/* ── Location ───────────────────────────────────────────────────────────────────────────────── */

/* DECLARED region scopes. A registry row names the region(s) its source can serve with `regions: [...]`; two kinds of name:
 *   · a CIRCLE in this table — only `houston_metro`, the USGS growth-fault STUDY extent (a metro-scale study, not an agency's area);
 *   · a real BOUNDARY in lib/serviceAreas.js (built into serviceAreaData.js): `harris` (HCFCD's channels), `houston` (the City of
 *     Houston limits + ETJ — its water / sewer / storm / hydrant data), `bkdd` (the Brookshire–Katy Drainage District).
 * Declared, never inferred from coverage (owner 2026-10-11) — coverage is a live, view-dependent guess, a region is a standing fact
 * about the source. (The old 65-mile "houston" circle claimed HCFCD / BKDD / City of Houston data reached Chambers, Galveston and
 * Brazoria; none of those sources serves them — B2436066.) */
export const REGION_ZONES = Object.freeze({
  houston_metro: Object.freeze({ lat: 29.7604, lng: -95.3698, radiusMiles: 65, label: "Houston metro (growth-fault study area)" }),
});

const toRad = (d) => (d * Math.PI) / 180;
export function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* true / false, or null when it cannot be told (no location, or an undeclared region name). */
export function inRegion(region, loc) {
  const z = REGION_ZONES[region];
  if (!z) return areaContains(region, loc); // a real boundary (null until its geometry has loaded → fails open)
  if (!loc) return null;
  const lat = Number(loc.lat), lng = Number(loc.lng != null ? loc.lng : loc.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return distanceMiles(lat, lng, z.lat, z.lng) <= z.radiusMiles;
}

/* CAN THIS ROW'S SOURCE SERVE THIS SITE AT ALL? Fires on a POSITIVE mismatch only — an unknown
 * location (no state, no coordinates) shows everything, exactly as before the gate existed. A row
 * with neither `states` nor `regions` is national and always available. */
export function layerAvailableHere(cfg, scope = {}) {
  if (!cfg) return false;
  const { state = null, loc = null } = scope || {};
  if (state && Array.isArray(cfg.states) && cfg.states.length && !cfg.states.includes(state)) return false;
  if (Array.isArray(cfg.regions) && cfg.regions.length && loc) {
    // available when ANY declared region contains the site, or none of them can be told
    const answers = cfg.regions.map((r) => inRegion(r, loc));
    if (answers.every((a) => a === false)) return false;
  }
  return true;
}

export const availableEntries = (entries, scope) => (entries || []).filter(([, cfg]) => layerAvailableHere(cfg, scope));

/* ── Draw filter (Hide Layers + hidden-at-this-location) ────────────────────────────────────── */

/* The overlay state the MAP draws from. Returns the INPUT object itself whenever nothing changes, so
 * the identity-stable contract (layerPrefs.js B385040) holds and a no-op never rebuilds the stack.
 * `hideAll` (the session-only Hide Layers pill) and a row that cannot serve this location both read
 * as "off" HERE and nowhere else: the saved state, the checkboxes and `layerOverrides` are untouched. */
export function drawnOverlaysOf(overlays, { hideAll = false, scope = null, layers = null } = {}) {
  if (!overlays) return overlays;
  let out = null;
  for (const [id, st] of Object.entries(overlays)) {
    if (!st || !st.on) continue;
    const cfg = layers ? layers[id] : null;
    const hiddenHere = !!(cfg && scope && !layerAvailableHere(cfg, scope));
    if (hideAll || hiddenHere) {
      if (!out) out = { ...overlays };
      out[id] = { ...st, on: false };
    }
  }
  return out || overlays;
}

/* ── Contour interval ───────────────────────────────────────────────────────────────────────── */

export const CONTOUR_INTERVALS = Object.freeze([1, 2, 5, 10]);
export const DEFAULT_CONTOUR_INTERVAL = 1;
export const normalizeContourInterval = (v) => (CONTOUR_INTERVALS.includes(Number(v)) ? Number(v) : DEFAULT_CONTOUR_INTERVAL);
/* The heavier (index) line sits on every 5th interval: 1→5 ft, 2→10 ft, 5→25 ft, 10→50 ft. */
export const CONTOUR_INDEX_EVERY = 5;
export const contourIndexFt = (interval) => normalizeContourInterval(interval) * CONTOUR_INDEX_EVERY;
export const contourIntervalLabel = (interval) => `${normalizeContourInterval(interval)} ft`;
export const contourRowValue = (interval) => `${normalizeContourInterval(interval)}′`;

/* ── Pipeline easement corridor ─────────────────────────────────────────────────────────────── */

export const CORRIDOR_WIDTH_CHOICES = Object.freeze([25, 50, 75, 100]);
/* The dropdown's options for a saved width: the four standards, plus the saved value itself when it
 * is something else (a saved odd width still SHOWS and still DRAWS — it is never snapped). */
export function corridorWidthOptions(saved) {
  const w = Number(saved);
  return Number.isFinite(w) && w > 0 && !CORRIDOR_WIDTH_CHOICES.includes(w)
    ? [...CORRIDOR_WIDTH_CHOICES, w].sort((a, b) => a - b)
    : [...CORRIDOR_WIDTH_CHOICES];
}

/* ── Presentation facts ─────────────────────────────────────────────────────────────────────── */

/* The map-colour swatch a row wears when it is ON. First declared, first used. */
export function rowSwatch(cfg) {
  if (!cfg) return null;
  return cfg.swatch || cfg.color || (Array.isArray(cfg.legend) && cfg.legend[0] && cfg.legend[0].color) || null;
}

/* A CSS gradient for a layer whose rendering is a multipart colour ramp (Elevation Shading). Derived
 * from the layer's OWN ramp definition so the bar can never disagree with what the service paints. */
export function rampGradient(cfg) {
  const ramps = cfg && cfg.rendering && cfg.rendering.rasterFunctionArguments
    && cfg.rendering.rasterFunctionArguments.ColorRamp && cfg.rendering.rasterFunctionArguments.ColorRamp.colorRamps;
  if (!Array.isArray(ramps) || !ramps.length) return null;
  const stops = [];
  ramps.forEach((r, i) => {
    if (i === 0 && Array.isArray(r.fromColor)) stops.push(r.fromColor);
    if (Array.isArray(r.toColor)) stops.push(r.toColor);
  });
  if (stops.length < 2) return null;
  const css = stops.map((c, i) => `rgb(${c[0]}, ${c[1]}, ${c[2]}) ${Math.round((i / (stops.length - 1)) * 100)}%`); // design-exempt: map ink — the layer's own ramp, not UI chrome
  return `linear-gradient(to right, ${css.join(", ")})`;
}

/* Which key entry a member of a merged row contributes ("Counties & Cities": heavier county line,
 * thin city line, dashed ETJ). Members without a role contribute nothing. */
const KEY_ROLE = {
  jur_county: "County", ga_county: "County", ca_county: "County",
  jur_city: "City Limits", ga_city: "City Limits", ca_city: "City Limits", co_city: "City Limits",
  jur_etj: "ETJ",
};
const KEY_STYLE = { County: { weight: 3.5, dash: false }, "City Limits": { weight: 1.5, dash: false }, ETJ: { weight: 1.5, dash: true } };
export function boundaryKey(members) {
  const seen = new Map();
  for (const [id, cfg] of members || []) {
    const label = KEY_ROLE[id];
    if (!label || seen.has(label)) continue;
    // County is a KEY of line weight, not of hue — a dark-grey county line is invisible on a dark panel, so it reads in the panel's own text colour.
    seen.set(label, { label, color: label === "County" ? "var(--text-secondary)" : ((cfg && cfg.color) || "currentColor"), ...KEY_STYLE[label] });
  }
  return ["County", "City Limits", "ETJ"].filter((l) => seen.has(l)).map((l) => seen.get(l));
}

/* The legend/key a row's dropdown shows: its own `legend`, the boundary key for a Counties & Cities
 * row, or one entry per member for a merged row whose members are each a colour class (Pipelines on
 * a Florida / Georgia site, where each EIA commodity is its own registry row). */
export function legendFor(members, mergeKey) {
  if (mergeKey === "counties_cities") return boundaryKey(members);
  const first = members && members[0] && members[0][1];
  if (members && members.length === 1 && first && Array.isArray(first.legend)) return first.legend;
  const withLegend = (members || []).find(([, c]) => Array.isArray(c && c.legend));
  if (withLegend) return withLegend[1].legend;
  if (mergeKey === "pipelines") {
    return (members || []).filter(([, c]) => c && c.color).map(([, c]) => ({
      label: String(c.label || "").replace(/\s*pipelines?\s*\(approx\.\)/i, "").replace(/\s*\(approx\.\)/i, "") || c.label,
      color: c.color, dash: !!c.legendDash,
    }));
  }
  return [];
}

/* ── The row dropdown plan ──────────────────────────────────────────────────────────────────── */

/* WHAT A ROW'S ▾ HOLDS, in order, and only what applies. The component renders exactly this list;
 * a test asserts it. An OFF row holds the info only (muted). `ctx`:
 *   on          the row is on
 *   zoomGated   the row is on but too far out to draw (layerZoomGate `dormant-zoom`)
 *   canLift     the "Draw above plan" lift applies (an AREA layer) and the surface is the planner
 *   hasStatus   a status line should lead (failed / slow / empty / needs setup / out-of-area)
 *   settings    layer-specific settings, in order: "interval" | "corridor" | "token"
 *   hasLegend   a key exists
 *   hasRamp     the legend is a continuous colour bar (Elevation Shading)
 *   hasInfo     there is source / vintage / caveat text behind the ⓘ
 */
/* The settings that are a standing preference about HOW a layer draws (not a second layer with its own switch), so they stay reachable on an off row. */
export const OFF_ROW_SETTINGS = new Set(["interval"]);
export function dropdownPlan(ctx = {}) {
  const out = [];
  /* A SETTING (contour interval, corridor width, the Mapillary token) is the person's choice about the layer, not a fact about what is
   * drawing — so it is reachable whether the row is on or off. Everything else (status, zoom, opacity, lift, legend) is about a layer
   * that is drawing, so an off row offers only its settings and its ⓘ. */
  if (!ctx.on) { for (const st of ctx.settings || []) if (OFF_ROW_SETTINGS.has(st)) out.push(st); if (ctx.hasInfo) out.push("info"); return out; }
  if (ctx.hasStatus) out.push("status");
  if (ctx.zoomGated) out.push("zoom");
  out.push("opacity");
  for (const s of ctx.settings || []) out.push(s);
  if (ctx.canLift) out.push("above");
  if (ctx.hasRamp) out.push("ramp");
  else if (ctx.hasLegend) out.push("legend");
  if (ctx.hasInfo) out.push("info");
  return out;
}

/* ── Opacity ────────────────────────────────────────────────────────────────────────────────── */

export const OPACITY_MIN = 0.1;
export const OPACITY_MAX = 1;
/* A typed percentage (digits only is not assumed — "55", "55%", " 55 ") → a clamped 0.1–1 fraction,
 * or null when it is not a number at all (the box keeps what the person typed and writes nothing). */
export function opacityFromPercent(text) {
  const n = parseFloat(String(text == null ? "" : text).replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.max(OPACITY_MIN, Math.min(OPACITY_MAX, Math.round(n) / 100));
}
export const percentOf = (opacity) => Math.round((Number(opacity) || 0) * 100);

/* ── Group choice ───────────────────────────────────────────────────────────────────────────── */

/* The group to show: the remembered one when it still exists for this location, else the first. */
export function pickGroup(remembered, visibleKeys) {
  if (remembered && visibleKeys.includes(remembered)) return remembered;
  return visibleKeys[0] || null;
}
