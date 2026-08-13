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

/* ---- Per-zone LENGTH along the wall (the trailer-parking fix).
 *
 * The chain shares ONE span by default — that is the deliberate 2026-06-30 owner fix that stopped
 * the trailer parking over-hanging the truck court, and it stays the DEFAULT. What was missing is
 * that it was also the ONLY behaviour: a trailer could never be any length other than exactly the
 * court's, so "I can't make the trailer parking any different of a length than the truck court"
 * was structurally true.
 *
 * Same derive-by-default / preserve-once-touched pattern as side parking and the dog-ears:
 *   · no stored length  → the zone tracks the chain span (unchanged behaviour, to the foot);
 *   · a stored length   → it is kept, CLAMPED to the wall but never reset, so shrinking the host
 *                         past it renders the clamp and growing the host back springs it out again.
 * PURE — the whole point is that this rule is unit-testable apart from the React canvas.
 */
export function zoneAlongSpan(stored, chainAlong, fullAlong) {
  const v = Number(stored);
  if (!Number.isFinite(v) || v <= 0) return chainAlong;   // untouched → tracks the court
  return Math.min(v, fullAlong);                          // clamped to the wall, never forgotten
}

/* ---- NEW-1: the span is ANCHORED — a resize moves the end you GRABBED, and only that end --------
 *
 * THE OWNER'S REPORT: "fix the fact that when I shrink the trailer parking, it shrinks from both
 * sides."
 *
 * ROOT CAUSE, and it is structural rather than arithmetic: `layoutZoneByKind` builds the zone's
 * centre as `b.c + u·center + tan·alongShift`, and the ONLY along-wall term in it is `alongShift`,
 * which exists to carry the B492 bump-out trim. The LENGTH came from the user (`alongLen` →
 * `zoneAlongSpan` above) and the CENTRE did not — so a shrunk zone stayed centred on its wall and
 * BOTH ends travelled inward by half the reduction. The model stored a SPAN WITH NO ANCHOR; there
 * was no field in which "which end did you grab" could even be written down.
 *
 * THE MODEL — the override is an ANCHORED span. Three fields on the element, of which only the
 * first already existed, so nothing migrates:
 *   · `alongLen`    — the length in feet, semantics unchanged.
 *   · `alongAnchor` — WHICH END is held: `-1` the −along end, `+1` the +along end, `0` centred.
 *                     Absent ⇒ 0 ⇒ byte-for-byte the old behaviour.
 *   · `alongOff`    — feet from the CHAIN DEFAULT's corresponding reference to the held one, so a
 *                     zone may sit off-centre on its wall. It is zero for the first end-drag (the
 *                     held end IS the chain's) and becomes non-zero on the second, from the other
 *                     end — which is exactly the case a bare offset could not express.
 *
 * Because the anchor is a REFERENCE rather than a world position, it survives everything the zone
 * is derived through: shrink the host and the held end moves with the wall it is bonded to; grow it
 * back and the zone springs out again; add a bump-out and the whole chain slides together. And it
 * COMPOSES with the bump-out trim instead of replacing it — `chainShift` is the trim, `off` rides on
 * top of it. PURE, so every one of those cases is unit-testable apart from the React canvas. */
export const ALONG_ANCHOR = { START: -1, CENTER: 0, END: 1 };
export const normalizeAlongAnchor = (a) => (Number(a) === 1 ? 1 : Number(a) === -1 ? -1 : 0);

/**
 * Resolve an anchored along-wall span into the length to draw and the along-wall centre shift.
 *
 * @param stored      the zone's `alongLen` (absent/0 ⇒ it tracks the chain span)
 * @param anchor      its `alongAnchor` (-1 | 0 | 1)
 * @param off         its `alongOff` (feet)
 * @param chainAlong  the span it tracks by default (the truck court's resolved length)
 * @param chainShift  that span's own along-wall centre (the B492 bump-out trim) — composed, never replaced
 * @param fullAlong   the host wall
 * @param limitAlong/limitShift  the window the zone must stay inside (defaults to the whole wall).
 *        The court head passes the CLEAR FACE here, so a typed length can never slide onto a bump-out.
 * @returns { along, shift } — feet, both already clamped to the limit window.
 */
export function anchoredAlongSpan({ stored, anchor = 0, off = 0, chainAlong, chainShift = 0, fullAlong, limitAlong, limitShift } = {}) {
  const cap = Number.isFinite(limitAlong) ? limitAlong : Number(fullAlong) || 0;
  const capC = Number.isFinite(limitShift) ? limitShift : 0;
  const along = zoneAlongSpan(stored, chainAlong, cap);
  const a = normalizeAlongAnchor(anchor);
  const o = Number.isFinite(Number(off)) ? Number(off) : 0;
  // The held reference, expressed against the chain default: its centre (a=0) or one of its ends.
  const held = (Number(chainShift) || 0) + a * ((Number(chainAlong) || 0) / 2) + o;
  const want = held - a * (along / 2);                    // the centre that keeps that reference put
  const lim = Math.max(0, (cap - along) / 2);             // …re-clamped rather than sliding off the wall
  return { along, shift: Math.min(capC + lim, Math.max(capC - lim, want)) };
}

/** A box's along-wall placement in its HOST's frame: centre, length, and the two ends. */
export function zoneAlongPlacement(box, host, side = "bottom") {
  const horiz = side === "top" || side === "bottom";
  const hostRot = (host && Number(host.rot)) || 0;
  const tan = rot2(horiz ? 1 : 0, horiz ? 0 : 1, hostRot);
  const center = ((Number(box.cx) || 0) - (Number(host.cx) || 0)) * tan.x
               + ((Number(box.cy) || 0) - (Number(host.cy) || 0)) * tan.y;
  const len = zoneAlongExtent(box, hostRot, side);
  return { center, len, min: center - len / 2, max: center + len / 2 };
}

/**
 * Which end a resize HELD, read off the geometry rather than off the handle: an edge drag pins the
 * opposite edge EXACTLY, and a corner drag pins the opposite corner, so whichever end moved less is
 * the one the user did not grab. Both ends moving (a re-centre) reads as centred, which is the
 * conservative answer.
 */
export function alongAnchorFromDrag(prev, next, tol = 0.5) {
  if (!prev || !next) return 0;
  const dMin = Math.abs(next.min - prev.min), dMax = Math.abs(next.max - prev.max);
  if (dMin <= tol && dMax > tol) return -1;
  if (dMax <= tol && dMin > tol) return 1;
  return 0;
}

/** The `alongOff` to store for a placement under a given anchor — sub-foot residue snaps to zero so
 *  a zone that IS on the chain's held end keeps tracking it. */
export function alongOffsetFor(anchor, placement, chainAlong, chainShift = 0, tol = 0.5) {
  const a = normalizeAlongAnchor(anchor);
  const held = a === 0 ? placement.center : a === -1 ? placement.min : placement.max;
  const off = held - ((Number(chainShift) || 0) + a * ((Number(chainAlong) || 0) / 2));
  return Math.abs(off) <= tol ? 0 : Math.round(off * 100) / 100;
}

/** Extent of a rotated box {w,h,rot} projected onto a unit direction {x,y} — feet. */
export function boxExtentAlong(box, unit) {
  const ax = rot2((box.w || 0) / 2, 0, box.rot || 0);
  const ay = rot2(0, (box.h || 0) / 2, box.rot || 0);
  return 2 * (Math.abs(ax.x * unit.x + ax.y * unit.y) + Math.abs(ay.x * unit.x + ay.y * unit.y));
}

/* ---- B1123: the zone's TRUE along-wall span, measured in the HOST'S LOCAL FRAME.
 *
 * AUDIT NOTE, so nobody re-derives this from the bug report. `boxExtentAlong(zone, alongUnit(host,
 * side))` is ALREADY host-relative — it dots the zone's own rotated half-axes with the host's along
 * direction, so what it really returns is w·|cos δ| + h·|sin δ| where δ is the zone's angle MINUS
 * the host's. It is therefore exact whenever the zone sits at its host's angle, at any host
 * rotation. The host rotation itself was never the problem, and a measurement that merely un-rotates
 * by the host would be the identical number.
 *
 * What IS wrong with it: it is a bounding-box projection, so the moment δ drifts off a right angle —
 * and it does drift in real plans; this owner's has a zone at 268.543° under a host at 178.543° and
 * another at 359° under a host at 269° — the DEPTH leaks into the along measurement as h·|sin δ|.
 * Comparing two such numbers to answer "did the user drag the LENGTH?" then partly answers "did the
 * DEPTH change?", and a wrong yes PINS `alongLen`, which by design is never reset: the zone stops
 * tracking its court for good.
 *
 * So take the along-axis DIMENSION rather than the projection whenever the zone is within a snap of
 * its host's frame (every zone `layoutZoneByKind` produces is: a strip at the host angle, a trailer
 * +90° on a side wall). Then a depth change moves the along span by EXACTLY zero. A genuinely
 * off-axis box has no clean along dimension, so it keeps the projection — honest rather than wrong.
 * PURE, so the rule is unit-testable at 0 / 90 / 178.543 / 269 / 359°. */
const AXIS_SNAP_DEG = 2; // δ within this of 0/90/180/270 ⇒ read the dimension, not the projection
function zoneFrameExtent(box, hostRot, side, wantAlong) {
  if (!box) return NaN;
  const horiz = side === "top" || side === "bottom";
  const rel = (Number(box.rot) || 0) - (Number(hostRot) || 0);
  const r = ((rel % 180) + 180) % 180;                 // a box and its 180° twin have one extent
  // Which raw dimension runs along the wall: `w` for an aligned box on a horizontal wall (or a
  // quarter-turned box on a vertical one), `h` for the other two combinations.
  const quarter = Math.abs(r - 90) <= AXIS_SNAP_DEG;
  const aligned = r <= AXIS_SNAP_DEG || r >= 180 - AXIS_SNAP_DEG;
  if (aligned || quarter) {
    const alongIsW = quarter ? !horiz : horiz;
    const useW = wantAlong ? alongIsW : !alongIsW;
    return Math.abs(Number(useW ? box.w : box.h)) || 0;
  }
  const unit = horiz === !!wantAlong ? { x: 1, y: 0 } : { x: 0, y: 1 };
  return boxExtentAlong({ w: box.w, h: box.h, rot: rel }, unit);
}

/** The zone's along-wall span in its host's frame — see the note above. */
export function zoneAlongExtent(box, hostRot = 0, side = "bottom") {
  return zoneFrameExtent(box, hostRot, side, true);
}

/** The across-wall (DEPTH) counterpart, by the same rule. Used by the load-time heal, which must not
 *  re-derive a depth from a projection that carries the along span inside it. */
export function zoneDepthExtent(box, hostRot = 0, side = "bottom") {
  return zoneFrameExtent(box, hostRot, side, false);
}

/**
 * Did a resize actually change the zone's ALONG-wall extent (i.e. did the user drag THAT axis)?
 * Returns the length to STORE, or null to leave the zone tracking the chain. Without this test a
 * plain depth drag would silently pin the length at whatever it happened to be, and the zone would
 * stop following the court from then on.
 *
 * ⚠ Feed this EXACT along spans (`zoneAlongExtent`), never world-space projections — see B1123 above.
 */
export function resizedAlongLen(prevAlong, nextAlong, tol = 0.5) {
  if (!Number.isFinite(prevAlong) || !Number.isFinite(nextAlong)) return null;
  return Math.abs(nextAlong - prevAlong) > tol ? Math.max(1, Math.round(nextAlong)) : null;
}

/**
 * B1123 — the ONE rule for whether a gesture may PIN a dock zone's along-wall length.
 * Returns the feet to store on `alongLen`, or null to leave the zone tracking the chain span.
 *
 * Two gates, both required, because the old measure could distinguish neither:
 *  · `userResize` — only a resize gesture aimed AT THIS ZONE may pin it. A host refit, a court
 *    depth change, a rotation, a relayout and the load-time heal all pass false, so none of them
 *    can stamp a length the owner never set.
 *  · `alongAxisDragged` — an edge drag knows which axis it moved; a depth-only drag passes false
 *    and can never pin. `null` = unknown (a corner drag / a numeric edit), so fall through to the
 *    measurement.
 * The measurement itself is the exact host-local along span, so an unchanged along axis compares
 * equal to the foot at ANY host rotation.
 */
export function resizedZoneAlongLen(prevBox, nextBox, { hostRot = 0, side = "bottom", userResize = false, alongAxisDragged = null, tol = 0.5 } = {}) {
  if (!userResize) return null;
  if (alongAxisDragged === false) return null;
  return resizedAlongLen(zoneAlongExtent(prevBox, hostRot, side), zoneAlongExtent(nextBox, hostRot, side), tol);
}

/**
 * NEW-1 — the ONE call a resize gesture makes: the anchored span to store, or null to leave the zone
 * tracking the chain. `resizedZoneAlongLen`'s two intent gates still decide WHETHER anything is
 * pinned (a depth-only drag, a host refit, a relayout and the load-time heal all still pin nothing);
 * this adds WHERE, which the length alone could never say.
 *
 * `chainAlong`/`chainShift` are the span this zone tracks by default — the truck court's resolved
 * placement for an outward zone, the B492 clear bump-out face for the court head itself.
 */
export function resizedZoneAlongFit(prevBox, nextBox, { host, side = "bottom", chainAlong, chainShift = 0, userResize = false, alongAxisDragged = null, tol = 0.5 } = {}) {
  const hostRot = (host && Number(host.rot)) || 0;
  const len = resizedZoneAlongLen(prevBox, nextBox, { hostRot, side, userResize, alongAxisDragged, tol });
  if (len == null) return null;
  const prev = zoneAlongPlacement(prevBox, host, side);
  const next = zoneAlongPlacement(nextBox, host, side);
  const anchor = alongAnchorFromDrag(prev, next, tol);
  return { len, anchor, off: alongOffsetFor(anchor, next, chainAlong, chainShift, tol) };
}

/**
 * B1123 load-time heal — is a stored `alongLen` indistinguishable from the chain span the zone would
 * derive anyway? Such a value carries no user intent (it is what the zone would render regardless),
 * and keeping it costs the owner the tracking behaviour forever, so it is DROPPED on load. A length
 * genuinely different from the chain span is real intent and is preserved.
 *
 * `eps` is deliberately a couple of feet: the poisoned values this heals were stamped from a
 * projection that drifts by h·|sin θ| (≈1.3 ft on the reported building) plus the ±0.5 ft rounding
 * the stamp itself applies, and no owner sets a length within a few feet of the court's on purpose.
 */
export function alongLenIsChainEcho(stored, chainAlong, eps = 6) {
  const v = Number(stored), c = Number(chainAlong);
  if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(c) || c <= 0) return false;
  return Math.abs(v - c) <= eps;
}

// Geometry of the i-th zone (0..2) on `side` of building box `b` ({cx,cy,w,h,rot}),
// given the ordered `depths` of the zones present on that side. Each zone sits
// flush beyond the previous one (cumulative inner depth), full wall length along
// the dock face. The trailer (i=1) is rotated so its striped stalls run ALONG the
// wall — matching the legacy `oppTrailerGeom`. Returns {cx,cy,w,h,rot}.
// `opts` lets the CALLER pull a zone IN to the usable dock face between corner bump-outs: {along}
// overrides its wall-length span and {alongShift} offsets its centre along the wall. Omit it and the
// zone keeps the full wall length, so a 4-arg call (and every existing caller/test) is unchanged.
// The truck court (zone 0) AND every zone stacked outward from it (trailer parking, buffer, appended
// road/landscape) honour the SAME override BY DEFAULT, so the whole stack tracks the court's clear
// span between the bump-outs — the trailer parking no longer over-hangs the court (owner fix,
// 2026-06-30). The caller chooses which zones to trim by passing or withholding `opts`
// (relayoutSide passes the court's resolved span to every chain member). `opts.alongs[i]` is the
// per-zone ESCAPE from that shared span: a length the user set on that zone specifically, which
// wins over the chain span and is clamped (never reset) to the wall — see zoneAlongSpan.
// Generalized (B495): lay the i-th zone of an ARBITRARY chain whose per-zone layout kinds are
// `kinds` ("strip" | "trailer"; road/buffer/sidewalk/court are all "strip" — a road along a wall is
// geometrically a strip). The cumulative-outward math is identical to the old layoutZone.
export function layoutZoneByKind(b, side, i, depths, kinds = [], opts = {}) {
  const [nx, ny] = SIDE_N[side] || SIDE_N.bottom;
  const horiz = ny !== 0;                       // top/bottom wall → zones run along X
  const fullAlong = horiz ? b.w : b.h;          // full wall length
  const useOverride = Number.isFinite(opts.along); // any zone may pull in to the clear bump-out span
  const chainAlong = useOverride ? opts.along : fullAlong;
  const chainShift = useOverride && Number.isFinite(opts.alongShift) ? opts.alongShift : 0;
  // Per-zone ANCHORED span override: a zone the user has actually dragged/typed a length onto keeps
  // it, instead of being forced to the chain span — and keeps the END IT WAS ANCHORED FROM, instead
  // of re-centring on its wall (NEW-1). Absent anchor/offset ⇒ centred ⇒ the pre-NEW-1 behaviour to
  // the foot. The anchor COMPOSES with the bump-out trim (`chainShift`), it never replaces it.
  const { along, shift: alongShift } = anchoredAlongSpan({
    stored: opts.alongs && opts.alongs[i],
    anchor: opts.anchors && opts.anchors[i],
    off: opts.offs && opts.offs[i],
    chainAlong, chainShift, fullAlong,
  });
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

/* ⛔ NEW-2 (B385041) — THE DOCK ORIENTATION IS STORED, NOT RE-DERIVED ON EVERY READ.
 *
 * THE REPORT, verbatim: *"if I had a cross-dock and I shrink it lengthwise, it almost seemed to
 * recompute where the docks went versus where the parking went, when I made it deeper than it was
 * long. I don't really want it to do that. Let me just play around instead of correcting it for me
 * — it doesn't help if I'm just trying to figure out what will and won't fit."*
 *
 * THE CAUSE, one line: this function used to open with
 *     const longSides = el.w >= el.h ? ["top", "bottom"] : ["left", "right"];
 * so which walls were loaded was a LIVE function of whichever dimension happened to be larger AT
 * READ TIME. Shrink a cross-dock building lengthwise past square and the whole dock assembly —
 * truck courts, trailer parking, buffers, sidewalks, dog-ears — rotated 90° onto the other walls
 * MID-DRAG. And because the comparison is `>=`, one foot either side of square flips it and flips
 * it back: dragging THROUGH square did it twice.
 *
 * THE FIX is the pattern this codebase already uses for every other value a user can mean
 * deliberately (dog-ears, side parking, trailer length, zone spans): DERIVE BY DEFAULT, PRESERVE
 * ONCE ESTABLISHED. `el.dockAxis` ("x" = the top/bottom pair, "y" = left/right) is stamped when the
 * orientation is first established — at creation, at the first resize of a building that predates
 * this field, or when the user sets it — and from then on a resize can never re-derive it. Pure
 * aspect-ratio derivation survives ONLY for a building that has no established orientation yet.
 *
 * ⛔ AND A STORED `dockSide` IS THE SAME STATEMENT, MORE SPECIFICALLY: it names a wall, which names
 * an axis. It used to be honoured only `if (longSides.includes(el.dockSide))`, i.e. it was thrown
 * away the instant the aspect ratio flipped — an explicit choice discarded by an implicit one. It
 * now WINS, always, for a building whose orientation is established. The `established` gate is not
 * ceremony: a legacy record can carry a `dockSide` that disagrees with what it currently RENDERS
 * (that is what the old validation did for a living), and honouring it unconditionally on load
 * would strand — and therefore prune — the zones bonded to the walls the plan actually shows.
 */
export const DOCK_AXES = { x: ["top", "bottom"], y: ["left", "right"] };
const SIDE_AXIS = { top: "x", bottom: "x", left: "y", right: "y" };

/** Has this building's dock orientation been ESTABLISHED (stamped), or is it still derived? */
export const dockAxisEstablished = (el) => !!el && (el.dockAxis === "x" || el.dockAxis === "y");

/** The axis the dock walls run along: "x" (top/bottom) or "y" (left/right). Stored wins; a stored
 *  `dockSide` on an established building is the more specific statement and wins over that. */
export function dockAxisOf(el) {
  if (!el) return "x";
  if (dockAxisEstablished(el)) {
    if ((el.dock || "cross") === "single" && SIDE_AXIS[el.dockSide]) return SIDE_AXIS[el.dockSide];
    return el.dockAxis;
  }
  return (Number(el.w) || 0) >= (Number(el.h) || 0) ? "x" : "y"; // no orientation yet → aspect ratio
}

/** The patch that ESTABLISHES a building's orientation from its CURRENT footprint, preserving
 *  exactly what it renders today: the axis it is being read at, plus (single-load) the wall it is
 *  actually docked on, so a stale `dockSide` cannot become authoritative by being stamped. Returns
 *  `null` when there is nothing to establish — already stamped, or not a plain building. */
export function establishDockAxisPatch(el) {
  if (!el || el.type !== "building" || el.dogEar || dockAxisEstablished(el)) return null;
  const axis = dockAxisOf(el);                      // the derived answer, i.e. what it looks like now
  const patch = { dockAxis: axis };
  if ((el.dock || "cross") === "single") patch.dockSide = dockSidesFor(el).dside;
  return patch;
}

/** Stamp `el` if it needs it, else return it untouched (identity-stable). */
export function withDockAxis(el) {
  const p = establishDockAxisPatch(el);
  return p ? { ...el, ...p } : el;
}

/** Load-time heal: establish every plain building's orientation from what the plan currently shows.
 *  Identity-stable — a list with nothing to stamp is returned as-is, so an already-healed plan does
 *  no work and is not marked dirty. */
export function healDockAxes(els) {
  if (!Array.isArray(els)) return els;
  let changed = false;
  const next = els.map((e) => { const y = withDockAxis(e); if (y !== e) changed = true; return y; });
  return changed ? next : els;
}

/** Turn the dock face a quarter turn — the DELIBERATE way to do what a resize used to do by
 *  accident. Returns the patch (axis + the mapped single-load wall), never mutating. */
export function rotateDockAxisPatch(el) {
  const axis = dockAxisOf(el) === "x" ? "y" : "x";
  const patch = { dockAxis: axis };
  if ((el.dock || "cross") === "single") {
    const cur = dockSidesFor(el).dside;
    patch.dockSide = { top: "left", bottom: "right", left: "top", right: "bottom" }[cur] || DOCK_AXES[axis][1];
  }
  return patch;
}

// Dock-capable sides run along a building's two loaded walls; the dock preset chooses how
// many — cross = both, single = one, none = neither. Which PAIR of walls those are is
// `dockAxisOf` above (stored once established, else the aspect ratio, where a square tie-breaks
// to the horizontal pair). PURE (depends only on the element's own footprint + dock fields), so
// the canvas, the panel, the depth/length readouts, the dock-door count and the stranded-zone
// guard below all share one source of truth — B548's "these must never disagree" contract now
// holding against the STORED orientation rather than a recomputed one.
// (Extracted from SitePlanner's old inline `dockSidesOf`.)
export function dockSidesFor(el) {
  const longSides = DOCK_AXES[dockAxisOf(el)];
  const dock = (el && el.dock) || "cross";
  if (dock === "none") return { dside: longSides[1], dockSides: [] };
  if (dock === "single") {
    // An established building's stored side is authoritative (dockAxisOf already adopted its axis,
    // so it is always one of `longSides`); an un-established one keeps the old validation, which is
    // what preserves a legacy plan's appearance until its orientation is stamped.
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
// and the dock-door readout (B548).
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
// dock doors array along (B548). The dock-axis counterpart of footprintDepth; for a rectangle
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
