/* Building-anchored dock-zone stack (B228).
 *
 * The building footprint is the control hub for the dock-side site elements.
 * Three zones stack OUTWARD from each dock face, in a fixed order:
 *
 *     building wall │ (0) truck court │ (1) trailer parking │ (2) buffer
 *
 * A "+" walks outward (court → trailer → buffer); a "−" peels the outermost off
 * (buffer → trailer → court — last-in-first-out). Everything is real-world US
 * survey feet (EPSG:2278). This module is the PURE geometry + ordering so the
 * stack can be unit-tested apart from the React canvas; SitePlanner.jsx wires it
 * to the element list, the panel and the resize/refit machinery.
 *
 * Truck court and trailer parking already existed as the `truckCourt` paving
 * strip and the far-side `forCourt` striped trailer row — this REUSES them
 * (same geometry the old `makeStrip` / `oppTrailerGeom` produced) and only adds
 * the new buffer zone + a single layout that positions all three from their
 * stored depths, so depths survive a resize and outer zones stay flush. */

// Ordered, outward from the dock face. `setting` is the per-plan default key in
// `settings`; `fallback` is the built-in default depth (feet). `type` is the
// drawn element type for each zone (buffer = sage `landscape` clear strip).
export const DOCK_ZONES = [
  { key: "court", type: "paving", label: "Truck court", setting: "truckCourtD", fallback: 135 },
  { key: "trailer", type: "trailer", label: "Trailer parking", setting: "trailerParkD", fallback: 50 },
  { key: "buffer", type: "landscape", label: "Buffer", setting: "bufferD", fallback: 15 },
];

export const MAX_DOCK_ZONES = DOCK_ZONES.length;

// Catalog of every layer type the outward stack can carry (B495). The fixed dock sequence above is
// a SUBSET of this; the "Add layer ▾" chooser offers these by side. Fields:
//   key      — stable id (also the chain-step key + the element tag used to recover it)
//   elType   — the drawn element `type` written into `els`
//   label    — human text for the menu / panel / tooltips
//   setting  — per-plan default-depth key in `settings` (null → use `fallback` / element default)
//   fallback — built-in default depth (feet); for a road this is the TRAVEL width (curbs add on)
//   layout   — geometry branch: "strip" (full-wall rectangle), "trailer" (rotated striped row);
//              parking/road reuse "strip"/"parking" handling in the wiring (a road laid ALONG a
//              wall is geometrically a strip — its curbs are a render detail keyed on `el.curb`)
//   sides    — where the chooser may offer it: "dock" | "nondock" | "any"
//   terminal — true ⇒ nothing may stack BEHIND it (a road is the end of a run)
//   tag      — extra fields merged onto the created element (e.g. buffer:true for landscape)
export const ZONE_CATALOG = {
  court:    { key: "court",    elType: "paving",    label: "Truck court",     setting: "truckCourtD", fallback: 135, layout: "strip",   sides: "dock",    terminal: false },
  trailer:  { key: "trailer",  elType: "trailer",   label: "Trailer parking", setting: "trailerParkD", fallback: 50, layout: "trailer", sides: "dock",    terminal: false },
  buffer:   { key: "buffer",   elType: "landscape", label: "Landscape buffer", setting: "bufferD",    fallback: 15,  layout: "strip",   sides: "any",     terminal: false, tag: { buffer: true } },
  sidewalk: { key: "sidewalk", elType: "sidewalk",  label: "Sidewalk",        setting: null,          fallback: 5,   layout: "strip",   sides: "any",     terminal: false },
  parking:  { key: "parking",  elType: "parking",   label: "Parking row",     setting: null,          fallback: null, layout: "parking", sides: "nondock", terminal: false },
  road:     { key: "road",     elType: "road",      label: "Road",            setting: "roadDefaultW", fallback: 24, layout: "road",    sides: "any",     terminal: true },
};

// Default depth (feet) for a catalog layer: a positive per-plan override wins, else the built-in.
// (For a road this returns the TRAVEL width; the wiring adds the two curbs to get the box depth.)
export function catalogDepthDefault(key, settings = {}) {
  const c = ZONE_CATALOG[key];
  if (!c) return 0;
  const v = Number(settings && c.setting && settings[c.setting]);
  return Number.isFinite(v) && v > 0 ? v : (c.fallback || 0);
}

// User-configurable default depths (Setup → Dock zones), falling back to the
// built-ins. Always positive feet.
export function zoneDepthDefaults(settings = {}) {
  return DOCK_ZONES.map((z) => {
    const v = Number(settings && settings[z.setting]);
    return Number.isFinite(v) && v > 0 ? v : z.fallback;
  });
}
export function zoneDepthDefault(i, settings = {}) {
  return zoneDepthDefaults(settings)[i] ?? DOCK_ZONES[i].fallback;
}

const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const rot2 = (x, y, deg) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
};

// The usable truck-court span between corner bump-outs (B492). The court (zone 0) pulls IN to the
// clear dock face between the two corner bump-outs — `bumpStart`/`bumpEnd` are their along-wall
// spans at the −axis / +axis ends. Returns the reduced length + the centre shift (toward the
// smaller bump, in the +along-wall direction), so the paving stops overlapping the bump corners —
// the same model the dock-door renderer already uses. PURE for unit testing.
export function usableCourtSpan(full, bumpStart = 0, bumpEnd = 0) {
  return { along: Math.max(1, full - (bumpStart || 0) - (bumpEnd || 0)), shift: ((bumpStart || 0) - (bumpEnd || 0)) / 2 };
}

// Geometry of the i-th zone (0..2) on `side` of building box `b` ({cx,cy,w,h,rot}),
// given the ordered `depths` of the zones present on that side. Each zone sits
// flush beyond the previous one (cumulative inner depth), full wall length along
// the dock face. The trailer (i=1) is rotated so its striped stalls run ALONG the
// wall — matching the legacy `oppTrailerGeom`. Returns {cx,cy,w,h,rot}.
// `opts` (B492) lets the CALLER pull zone 0 (the truck court) in to the usable dock face between
// corner bump-outs: {along} overrides its wall-length span and {alongShift} offsets its centre
// along the wall. Other zones (trailer/buffer) always keep the full wall length, so a 4-arg call
// (and every existing caller/test) is unchanged.
// Generalized (B495): lay the i-th zone of an ARBITRARY chain whose per-zone layout kinds are
// `kinds` ("strip" | "trailer"; road/buffer/sidewalk/court are all "strip" — a road along a wall is
// geometrically a strip). `i === 0` (the chain head, a court) still honours the bump-out trim opts.
// Other zones keep full wall length. The cumulative-outward math is identical to the old layoutZone.
export function layoutZoneByKind(b, side, i, depths, kinds = [], opts = {}) {
  const [nx, ny] = SIDE_N[side] || SIDE_N.bottom;
  const horiz = ny !== 0;                       // top/bottom wall → zones run along X
  const fullAlong = horiz ? b.w : b.h;          // full wall length
  const useOverride = i === 0 && Number.isFinite(opts.along);
  const along = useOverride ? opts.along : fullAlong;
  const alongShift = useOverride && Number.isFinite(opts.alongShift) ? opts.alongShift : 0;
  const inner = depths.slice(0, i).reduce((s, d) => s + (d || 0), 0); // depth nearer the wall
  const d = depths[i];
  const half = (horiz ? b.h : b.w) / 2;         // building face along the outward normal
  const center = half + inner + d / 2;          // this zone's centre, measured outward
  const u = rot2(nx, ny, b.rot || 0);           // outward normal in world feet
  const tan = rot2(horiz ? 1 : 0, horiz ? 0 : 1, b.rot || 0); // along-wall unit (+X horiz / +Y vert)
  const cx = b.cx + u.x * center + tan.x * alongShift, cy = b.cy + u.y * center + tan.y * alongShift;
  const rotBase = (((b.rot || 0) % 360) + 360) % 360;
  if (kinds[i] === "trailer") {                 // trailer parking: w=wall length, h=depth, +90 on a side wall
    return { cx, cy, w: along, h: d, rot: ((((b.rot || 0) + (horiz ? 0 : 90)) % 360) + 360) % 360 };
  }
  return { cx, cy, w: horiz ? along : d, h: horiz ? d : along, rot: rotBase };
}

// Geometry of the i-th zone of the DEFAULT dock sequence (court, trailer, buffer) — a thin wrapper
// over layoutZoneByKind with kinds = [strip, trailer, strip, …]. Kept for back-compat: every prior
// caller/test sees byte-identical output. `opts` is the B492 court bump-out trim.
export function layoutZone(b, side, i, depths, opts = {}) {
  return layoutZoneByKind(b, side, i, depths, depths.map((_, j) => (j === 1 ? "trailer" : "strip")), opts);
}

// Position the whole stack on a side at once → [{i, geom}] for the zones present.
export function layoutStack(b, side, depths) {
  return depths.map((_, i) => ({ i, geom: layoutZone(b, side, i, depths) }));
}

// Dock-capable sides run along a building's TWO LONG sides; the dock preset chooses how
// many — cross = both, single = one, none = neither. A square (w === h) tie-breaks to the
// horizontal pair (top/bottom), matching `el.w >= el.h`. PURE (depends only on the element's
// own footprint + dock fields), so the canvas, the panel and the stranded-zone guard below
// all share one source of truth. (Extracted from SitePlanner's old inline `dockSidesOf`.)
export function dockSidesFor(el) {
  const longSides = el.w >= el.h ? ["top", "bottom"] : ["left", "right"];
  const dock = (el && el.dock) || "cross";
  if (dock === "none") return { dside: longSides[1], dockSides: [] };
  if (dock === "single") {
    const dside = longSides.includes(el.dockSide) ? el.dockSide : longSides[1];
    return { dside, dockSides: [dside] };
  }
  return { dside: longSides[1], dockSides: longSides };
}

// Which raw footprint axis ("w" | "h") runs PERPENDICULAR to the dock face (the DEPTH axis) and
// which runs ALONG it (the LENGTH axis). Read off `dockSidesFor`, NEVER hardcoded to X/Y, so it
// tracks the dock metadata — a building whose docks move walls keeps depth perpendicular to the
// face and length parallel to it. For a rectangle depth = the short axis and length = the long
// axis (the dock always rides the long walls), but we derive it from the dock axis so intent is
// explicit and robust. PURE — the single source of truth shared by the canvas, the massing panel
// and the dock-door readout (B544).
export function footprintAxes(el) {
  const { dockSides, dside } = dockSidesFor(el);
  const side = dockSides[0] || dside;                 // a dock side (or the implied one when dock=none)
  const horizWall = side === "top" || side === "bottom"; // horizontal dock wall → outward normal is vertical
  // depth runs along the outward normal: vertical (h) for a horizontal wall, horizontal (w) for a vertical wall
  return horizWall ? { depth: "h", length: "w" } : { depth: "w", length: "h" };
}

// The building's DEPTH (feet): its footprint extent perpendicular to the dock face — dock
// wall → dock wall (cross) / dock wall → rear wall (single), which both reduce to the span
// across the dock-normal axis. So a 135′ truck court (an attached site element) can't masquerade
// as the building's depth (NEW-2/B417). For a rectangle this equals the shorter side.
export function footprintDepth(el) {
  return el[footprintAxes(el).depth];
}

// The building's LENGTH (feet): its footprint extent PARALLEL to the dock face — the wall the
// dock doors array along (B544). The dock-axis counterpart of footprintDepth; for a rectangle
// this is the longer side, derived from the dock axis so it stays correct as docks move walls.
export function footprintLength(el) {
  return el[footprintAxes(el).length];
}

// IDs of dock-zone stack members (truck court → trailer parking → buffer) sitting on a side
// that is NO LONGER a dock side — e.g. after a reshape flips the long-side axis, or a dock
// preset drops a side. A stranded court drags its bonded trailer + buffer, so the whole chain
// is returned. PURE; the caller removes them so trailer parking stays dock-side-only
// (NEW-1/B416). Courts are only ever CREATED on dock sides, so a court off the dock sides is
// always a stranding artefact — never intentional.
export function strandedZoneIds(els, building) {
  const ok = new Set(dockSidesFor(building).dockSides);
  const kill = new Set(
    (els || [])
      .filter((x) => x.attachedTo === building.id && x.truckCourt && !x.points && !ok.has(x.truckCourt.side))
      .map((x) => x.id),
  );
  let grew = true;
  while (grew) {                                       // cascade onto bonded trailers, buffers + any appended layers
    grew = false;
    (els || []).forEach((x) => {
      if (kill.has(x.id)) return;
      // forCourt/forTrailer = the legacy bonds; prevZone = the generic outward-stack bond (B495), so a
      // stranded court drags its road/landscape too. Only court-headed chains seed `kill`, so this never
      // touches a legitimate non-dock road/landscape (its prevZone never reaches a stranded court).
      if ((x.forCourt && kill.has(x.forCourt)) || (x.forTrailer && kill.has(x.forTrailer)) || (x.prevZone && kill.has(x.prevZone))) { kill.add(x.id); grew = true; }
    });
  }
  return [...kill];
}

// Heal a loaded element list: drop every stranded dock-zone stack from every building, so an
// older plan reshaped before this guard existed cleans itself up the moment it's opened.
export function pruneStrandedZones(els) {
  let next = els || [];
  next.filter((x) => x.type === "building" && !x.dogEar).forEach((b) => {
    const ids = strandedZoneIds(next, b);
    if (ids.length) next = next.filter((x) => !ids.includes(x.id));
  });
  return next;
}
