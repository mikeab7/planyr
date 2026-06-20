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

// Geometry of the i-th zone (0..2) on `side` of building box `b` ({cx,cy,w,h,rot}),
// given the ordered `depths` of the zones present on that side. Each zone sits
// flush beyond the previous one (cumulative inner depth), full wall length along
// the dock face. The trailer (i=1) is rotated so its striped stalls run ALONG the
// wall — matching the legacy `oppTrailerGeom`. Returns {cx,cy,w,h,rot}.
export function layoutZone(b, side, i, depths) {
  const [nx, ny] = SIDE_N[side] || SIDE_N.bottom;
  const horiz = ny !== 0;                       // top/bottom wall → zones run along X
  const along = horiz ? b.w : b.h;              // full wall length
  const inner = depths.slice(0, i).reduce((s, d) => s + (d || 0), 0); // depth nearer the wall
  const d = depths[i];
  const half = (horiz ? b.h : b.w) / 2;         // building face along the outward normal
  const center = half + inner + d / 2;          // this zone's centre, measured outward
  const u = rot2(nx, ny, b.rot || 0);           // outward normal in world feet
  const cx = b.cx + u.x * center, cy = b.cy + u.y * center;
  const rotBase = (((b.rot || 0) % 360) + 360) % 360;
  if (i === 1) {                                // trailer parking: w=wall length, h=depth, +90 on a side wall
    return { cx, cy, w: along, h: d, rot: ((((b.rot || 0) + (horiz ? 0 : 90)) % 360) + 360) % 360 };
  }
  return { cx, cy, w: horiz ? along : d, h: horiz ? d : along, rot: rotBase };
}

// Position the whole stack on a side at once → [{i, geom}] for the zones present.
export function layoutStack(b, side, depths) {
  return depths.map((_, i) => ({ i, geom: layoutZone(b, side, i, depths) }));
}
