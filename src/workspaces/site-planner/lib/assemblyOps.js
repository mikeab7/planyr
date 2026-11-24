/* @planner-extract — AUDIT BATCH G3: the dock / wall-kid / ramp assembly engine that used to sit inside the SitePlanner component
 * (zone chains, wall strips, side parking, dog-ears, relayout + refit), moved verbatim as PURE functions of the element array.
 * The only change: the component-state `settings` that a few of them closed over is now an explicit trailing argument; the
 * component keeps thin wrappers with the old signatures. Behaviour-identical; see test/helpers/plannerSource.js. */
import { freeParkStack, relayoutFreeStack } from "./parking.js";
import { bondedChildRot } from "./siteModel.js";
import { rot2, CURB, isCenterlineRoad } from "./siteGeometry.js";
import { dogEarGeom, dogEarSize, sidewalkSpanForBumps, wallStripBoxFor, isFlushWallLayer, inboardReach, wallKidBox, wallKidAlong, hostAxisExtents, ownExtents, bumpsOfHost, sideParkAlongRun, hasWallExtent, extentFieldsFor, flushKidBoxFor, sideParkStack } from "./dogEar.js";
import { dockSidesFor, ZONE_CATALOG, zoneDepthDefaults, catalogDepthDefault, layoutZoneByKind, usableCourtSpan, anchoredAlongSpan, boxExtentAlong, resizedZoneAlongFit, withDockAxis } from "./dockZones.js";
import { clampTrailerRows, trailerSpec, trailerCfg, storedRowDepths, applyZonePatch } from "./wallRows.js";
import { dockSegExtent } from "./footprintEdit.js";
import { centroid } from "./planRenderHelpers.jsx";
import { uid } from "./plannerConstants.js";

// Re-derive every bonded box child's angle from its host (B363): a child's rot is always
// host.rot + its fixed quarter-turn offset, so this removes any stored drift. Pure; preserves
// object identity for children that are already in sync. Called from EVERY host-geometry path
// (resize via refitChildren, rotate via rotateAssemblyTo + the rotate drag) so a child can't
// be left visibly off-angle from its building.
export const resyncBondedRot = (list, hostId) => {
  const host = list.find((x) => x.id === hostId);
  if (!host || host.points || typeof host.rot !== "number") return list;
  return list.map((x) => {
    if (x.attachedTo !== hostId || x.points || typeof x.rot !== "number") return x;
    const want = bondedChildRot(x.rot, host.rot);
    return Math.abs((((x.rot % 360) + 360) % 360) - want) > 1e-6 ? { ...x, rot: want } : x;
  });
};

// Sidewalks / parking / trailer fields attached to a building track the wall
// they hug when the building is resized. At drag start, capture each child in
// the building's LOCAL frame: which wall it hugs (the axis it sits outside of),
// its fixed depth, and its position/length along the wall.
export const WALL_KID_TYPES = ["sidewalk", "landscape", "parking", "trailer", "paving", "road"];

// ...then re-fit each child: it stays flush against the wall and keeps its
// depth, while its length/position ALONG the wall scale with that wall.
export const fitKid = (nb, k) => {
  const newAlongHalf = (k.perpIsY ? nb.w : nb.h) / 2;
  const newPerpHalf = (k.perpIsY ? nb.h : nb.w) / 2;
  const ratio = k.oldAlongHalf ? newAlongHalf / k.oldAlongHalf : 1;
  const along = k.alongCenter * ratio;          // position along the wall
  const alongDim = 2 * k.alongHalf * ratio;      // length along the wall
  const perp = k.sidePerp * (newPerpHalf + k.perpDepth / 2 + Math.max(0, k.perpGap || 0)); // keep its clearance outside the wall
  const lx = k.perpIsY ? along : perp, ly = k.perpIsY ? perp : along;
  const dimBX = k.perpIsY ? alongDim : k.perpDepth; // child extent on building X
  const dimBY = k.perpIsY ? k.perpDepth : alongDim; // child extent on building Y
  const w = k.cross ? dimBY : dimBX, h = k.cross ? dimBX : dimBY; // back to the child's own w/h
  const off = rot2(lx, ly, nb.rot);
  return { cx: nb.cx + off.x, cy: nb.cy + off.y, w, h, rot: k.rot0 != null ? k.rot0 : ((nb.rot % 360) + 360) % 360 };
};

// Add a sidewalk strip flush against whichever side of the building was clicked.
export const SIDEWALK_W = 5;

export const OPP_TRAILER_W = 12;  // default trailer-stall width for a single striped dock-zone row
export const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

// Build (don't commit) a full-wall strip element flush against one building side.
export const makeStrip = (b, nx, ny, type, depth, extra = {}) => {
  const w = nx !== 0 ? depth : b.w;
  const h = ny !== 0 ? depth : b.h;
  const off = rot2(nx * (b.w / 2 + depth / 2), ny * (b.h / 2 + depth / 2), b.rot);
  return { id: uid(), type, cx: b.cx + off.x, cy: b.cy + off.y, w, h, rot: ((b.rot % 360) + 360) % 360, attachedTo: b.id, ...extra };
};

// Build a 55′×60′ dog-ear bump-out at one corner (sign = ±1 along the wall) of a
// dock side. A dog-ear is part of the building: it sits flush at the end of the
// dock wall and projects out into the court, taking that span out of dock use.
// It's a building element (adds to SF), with no docks/label of its own.
// Bump-out box geometry (dogEarGeom) + the size-by-wall helper (dogEarSize) are pure, in
// lib/dogEar.js (B362). `de` carries the corner (side/sign) and, once resized, its stored
// span along the wall + projection (`along`/`proj`); absent → the 55′×60′ default.
// `size` ({along, proj}) is optional: a corner added beside a bump-out the user already sized adopts it.
export const makeDogEar = (b, side, sign, size) => {
  const de = size && size.along > 0 && size.proj > 0 ? { side, sign, along: size.along, proj: size.proj } : { side, sign };
  return {
    id: uid(), type: "building", ...dogEarGeom(b, de),
    attachedTo: b.id, noFit: true, noLabel: true, dock: "none", dogEar: de,
  };
};

// Re-anchor a dog-ear to the building corner when the building is resized: slides to the
// new corner / dock face and re-derives the host angle, while KEEPING its size — the
// user's if it was resized (B362), else the 55′×60′ default.
export const fitDogEar = (nb, de) => dogEarGeom(nb, de);

// Add a single row of parking + drive aisle flush against a building side, the
// wall's full length, oriented so it grows OUTWARD (drive on the building side).
export const SIDE_PARK_ANGLE = { top: 180, bottom: 0, left: 90, right: 270 };

/* ---- NEW-2: "what is on this wall?" is answered by GEOMETRY, with the tag as a fast path ------
 *
 * `sideParkingOn` / `empSidePark` used to test `x.sideParkSide === name` and NOTHING else. That
 * made the answer depend on a tag surviving every write path — and it did not: `splitParkingRows`
 * dropped it off every Explode piece, so a wall carrying a full 60 ft parking module answered
 * "nothing here". `empSideSidewalk` beside it has always used the forgiving test (bonded + a
 * strip type + `sideOfKid`), which is why the sidewalk stayed visible while the parking vanished,
 * and therefore why the "−" ladder fell through to the sidewalk rung with pavement still bonded
 * to that wall. Same forgiving test here: a bonded, non-stack, non-strip pad whose side resolves
 * to this wall IS parking on this wall, tagged or not. A future tag-loss bug can then only cost a
 * label — never geometry. Returned INNER→OUTER, because an exploded field is a stack and the
 * ladder must always act on the outermost piece. */
export const SIDE_PARK_PAD_TYPES = new Set(["parking", "paving"]);

export const isSideParkPad = (x, b) => SIDE_PARK_PAD_TYPES.has(x.type) && x.attachedTo === b.id && !x.points
  && !x.dogEar && !x.noFit && !x.truckCourt && !x.forCourt && !x.forTrailer && !x.prevZone && !isWallStrip(x);

/* ---- Building-anchored dock-zone stack (B228): truck court → trailer parking →
   buffer, stacked OUTWARD from each dock face. The building footprint is the
   control hub: one "+" walks the stack outward, one "−" peels the outermost off
   (LIFO). A single pure layout (lib/dockZones `layoutZone`) positions all three
   from their stored depths (`zd`), so they stay flush + depth-correct on add /
   remove / inline depth-edit / building-resize. Truck court + trailer parking REUSE
   the existing `truckCourt` / `forCourt` tags; the buffer is the new zone (a sage
   `landscape` clear strip), bonded to its trailer via `forTrailer`. Car parking and
   bump-outs are deliberately NOT in this stack (see growEmployeeSide / dog-ears). ---- */
// Find the stack members on a side, within a given element array (pure).
export const findCourtIn = (arr, b, side) => arr.find((x) => x.attachedTo === b.id && x.truckCourt && x.truckCourt.side === side && !x.points);

export const findTrailerIn = (arr, court) => (court ? arr.find((x) => x.forCourt === court.id && !x.points) : null);

export const findBufferIn = (arr, trailer) => (trailer ? arr.find((x) => x.forTrailer === trailer.id && !x.points) : null);

export const findZoneIn = (arr, b, side, i) => { const c = findCourtIn(arr, b, side); if (i === 0) return c; const t = findTrailerIn(arr, c); if (i === 1) return t; return findBufferIn(arr, t); };

// How many zones are present on a side (0..3), within `arr`.
export const stackCountIn = (arr, b, side) => { const c = findCourtIn(arr, b, side); if (!c) return 0; const t = findTrailerIn(arr, c); if (!t) return 1; return findBufferIn(arr, t) ? 3 : 2; };

// Is this element a member of a dock-zone stack, and which zone (0 court / 1 trailer / 2 buffer)?
export const isDockZone = (el) => !!el && !el.points && !!(el.truckCourt || el.forCourt || el.forTrailer);

export const zoneIndexOf = (el) => (el.truckCourt ? 0 : el.forCourt ? 1 : 2);

// NEW-1 — the dock-layer Properties panel also covers a BUFFER added from the Building panel's "Docks & walls" strip
// (`makeChainZone`: bonded by `prevZone` + `stackSide`, no `forTrailer`), which `isDockZone` deliberately does not claim.
export const isDockLayerEl = (el) => isDockZone(el) || (!!el && !el.points && !!el.buffer && !!el.noFit && !!el.stackSide && !!el.attachedTo);

// The min / max stack depth across a building's dock sides (the "+"/"−" operate on
// the whole set as a unit, so the min level advances together and the max peels off).
// The dock side a stack zone belongs to (court carries it; trailer/buffer inherit via their chain).
export const zoneSideOf = (arr, z) => {
  if (!z) return null;
  if (z.truckCourt) return z.truckCourt.side;
  if (z.forCourt) { const c = arr.find((x) => x.id === z.forCourt); return c && c.truckCourt ? c.truckCourt.side : null; }
  if (z.forTrailer) { const t = arr.find((x) => x.id === z.forTrailer); const c = t && arr.find((x) => x.id === t.forCourt); return c && c.truckCourt ? c.truckCourt.side : null; }
  if (z.stackSide) return z.stackSide;   // an appended chain layer carries its wall
  return null;
};

// A zone's depth (feet): stored `zd` wins; else derive its extent along the side
// normal (so a legacy court/trailer survives); else fall back to the configured default.
export const zoneDepthOfIn = (z, b, side, i, settings) => {
  if (Number.isFinite(z.zd) && z.zd > 0) return z.zd;
  const u = outwardUnit(b, side);
  const ax = rot2(z.w / 2, 0, z.rot || 0), ay = rot2(0, z.h / 2, z.rot || 0);
  const derived = 2 * (Math.abs(ax.x * u.x + ax.y * u.y) + Math.abs(ay.x * u.x + ay.y * u.y));
  return derived > 0.5 ? derived : zoneDepthDefaults(settings)[i];
};

// The along-wall span a corner bump-out consumes at one end (sign ±1) of a dock side — the same
// measure the dock-door renderer uses, so the truck court pulls in to exactly the doors' clear span.
export const bumpAlongOnSide = (arr, b, side, sign) => {
  const horiz = side === "top" || side === "bottom";
  const d = arr.find((x) => x.attachedTo === b.id && x.dogEar && x.dogEar.side === side && x.dogEar.sign === sign);
  return d ? (horiz ? d.w : d.h) : 0;
};

// Truck-court (zone 0) along-span + centre shift on a dock side (B492): pulled IN to the clear
// dock face between the corner bump-outs, then capped by an optional manual length (court.alongLen)
// so a typed length never re-overlaps a bump. The WHOLE outward stack (trailer parking + buffer +
// any appended layer) now follows this same span, so the trailer never over-hangs the court.
export const courtBumpOpts = (arr, b, side) => {
  const horiz = side === "top" || side === "bottom";
  const full = horiz ? b.w : b.h;
  let insStart = bumpAlongOnSide(arr, b, side, -1), insEnd = bumpAlongOnSide(arr, b, side, 1);
  // NEW-1/B872 — on a reshaped building the loaded wall may be shorter than the bounding box (a
  // clipped corner / angled end). Pull the truck court (and the whole outward stack) in to the TRUE
  // wall span, reusing the same B492 clear-span mechanism the corner bump-outs use.
  if (b.footEdit) { const seg = dockSegExtent(b, side); if (seg) { insStart = Math.max(insStart, seg.startF); insEnd = Math.max(insEnd, seg.L - seg.endF); } }
  const { along: usable, shift } = usableCourtSpan(full, insStart, insEnd);
  const court = findCourtIn(arr, b, side);
  // NEW-1 — the court's own length is ANCHORED too: shorten it from one end and that end is the
  // one that moves. Its clamp window is the CLEAR FACE (not the whole wall), so an anchored court
  // can never slide onto a corner bump-out. With no anchor stored this is byte-identical to the
  // old `Math.min(court.alongLen, usable)` centred on `shift`.
  const fit = anchoredAlongSpan({
    stored: court && court.alongLen, anchor: court && court.alongAnchor, off: court && court.alongOff,
    chainAlong: usable, chainShift: shift, fullAlong: full, limitAlong: usable, limitShift: shift,
  });
  // `faceAlong`/`faceShift` are the clear bump-out face itself — the reference the COURT's own
  // anchor is measured against (every outward zone anchors against the court's resolved span).
  return { along: fit.along, alongShift: fit.shift, faceAlong: usable, faceShift: shift };
};

// The along-wall frame a dock wall's layers are measured in (wallRows.js extent helpers): the court's resolved span
// (what a plain layer tracks), its centre shift, and the whole wall.
export const wallExtentCtx = (arr, b, side) => { const o = courtBumpOpts(arr, b, side); return { chainAlong: o.along, chainShift: o.alongShift, fullAlong: (side === "top" || side === "bottom") ? b.w : b.h }; };

/* ---- Generic outward-stack chain (B495). The dock sequence (court → trailer → buffer) plus any
   menu-appended layers (landscape buffer / road) form ONE linked list rooted at the wall, bonded
   by the generic `prevZone` id. `nextInChain` follows `prevZone` first and FALLS BACK to the legacy
   forCourt/forTrailer bonds, so old saved plans (no `prevZone`) walk identically with no migration.
   Appended dock layers are `noFit` like the trailer/buffer, so relayoutSide owns their geometry. ---- */
export const nextInChain = (arr, el) => {
  if (!el) return null;
  const byPrev = arr.find((x) => x.prevZone === el.id && !x.points);
  if (byPrev) return byPrev;
  if (el.truckCourt) return findTrailerIn(arr, el);   // legacy court → trailer
  if (el.type === "trailer") return findBufferIn(arr, el); // legacy trailer → buffer
  return null;
};

export const chainFromHead = (arr, head) => {
  const out = []; const seen = new Set(); let cur = head;
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.push(cur); cur = nextInChain(arr, cur); }
  return out;
};

// Building panel v3 — a dock wall's chain is normally rooted at its truck court, but the court's bin removes ONLY
// the court (and its trailer parking): the buffer / walk / road outside it stay, close in against the wall, and the
// innermost of them heads the chain — a stack member stamped with this `stackSide` whose inboard neighbour is gone.
// (Trailer parking can never head one: it opens off a court. A non-dock wall's layers carry no `noFit`.)
export const findHeadIn = (arr, b, side) => findCourtIn(arr, b, side) || arr.find((x) => x.attachedTo === b.id && !x.points && !x.dogEar && x.type !== "driveInRamp" && x.noFit
  && x.stackSide === side && !x.truckCourt && !x.forCourt && x.type !== "trailer"
  && !arr.some((y) => y.id === x.prevZone || y.id === x.forTrailer));

// The full dock-zone chain on a side (head → outward), within `arr`.
export const dockChainOnSide = (arr, b, side) => { const c = findHeadIn(arr, b, side); return c ? chainFromHead(arr, c) : []; };

// The layout kind for layoutZoneByKind: only the trailer is special; everything else is a strip
// (court/buffer/sidewalk/road laid flush, full wall length — a road's curbs are a render detail).
export const chainKindOf = (z) => (z.type === "trailer" || z.forCourt ? "trailer" : "strip");

// Re-lay the whole chain on one side of building `b` (pure over `arr`): each present zone
// flush-outward from the building face, depth-correct. The truck court (head) pulls in to the
// clear face between corner bump-outs (B492), and the trailer parking + buffer + any appended
// layer track that SAME span, so nothing stacked outward ever over-hangs the court.
export const relayoutSideIn = (arr, b, side, settings) => {
  const zones = dockChainOnSide(arr, b, side);
  if (!zones.length) return arr;
  const kinds = zones.map(chainKindOf);
  // A trailer zone with its own row depths (v3) is exactly as deep as those rows + aisles say, whatever `zd` holds.
  const depths = zones.map((z, i) => (z.type === "trailer" && storedRowDepths(z, clampTrailerRows(z.trailerRows)) ? trailerSpec(z, settings.trailerAisle).total : zoneDepthOfIn(z, b, side, i, settings)));
  const courtOpts = courtBumpOpts(arr, b, side);
  // Per-zone LENGTH override. The chain still shares the court's span BY DEFAULT (the 2026-06-30
  // fix that stopped the trailer over-hanging the court), but a zone the user has actually given
  // a length keeps it — clamped to the wall, never reset. Index 0 is excluded: the court's own
  // alongLen is already folded into courtOpts.along, capped to the clear bump-out face (B492).
  const alongs = zones.map((z, i) => (i === 0 ? null : (Number.isFinite(z.alongLen) && z.alongLen > 0 ? z.alongLen : null)));
  // NEW-1 — WHICH END that length is anchored from. Index 0 is 0/0 because the court's own anchor
  // is already resolved into `courtOpts.alongShift`; every outward zone anchors against that.
  const anchors = zones.map((z, i) => (i === 0 ? 0 : z.alongAnchor));
  const offs = zones.map((z, i) => (i === 0 ? 0 : z.alongOff));
  const patch = new Map();
  zones.forEach((z, i) => {
    const g = layoutZoneByKind(b, side, i, depths, kinds, { ...courtOpts, alongs, anchors, offs });
    // NEW-3 (Building panel v2) — a trailer zone may carry 1–4 rows: rows / aisle ride the zone, the
    // total depth (`zd`) is rows × row + ⌊rows / 2⌋ × aisle, and the cfg is the band · aisle · band
    // pattern `trailerStalls` already draws. One row is byte-identical to the old single strip.
    patch.set(z.id, z.type === "trailer"
      ? { ...g, cfg: trailerCfg(z.cfg, trailerSpec({ ...z, zd: depths[i] }, settings.trailerAisle), (z.cfg && z.cfg.trailerW) || settings.trailerW || OPP_TRAILER_W, side) }
      : g);
  });
  return arr.map((x) => (patch.has(x.id) ? { ...x, ...patch.get(x.id) } : x));
};

// Relayout every dock side of `b` that currently carries a court.
export const relayoutAllSidesIn = (arr, b, settings) => {
  const sides = new Set(arr.filter((x) => x.attachedTo === b.id && x.truckCourt).map((x) => x.truckCourt.side));
  // …and the dock walls whose court was binned but whose outer layers stayed (headed by findHeadIn).
  dockSidesFor(b).dockSides.forEach((sd) => { if (!sides.has(sd) && findHeadIn(arr, b, sd)) sides.add(sd); });
  let next = arr; sides.forEach((s) => { next = relayoutSideIn(next, b, s, settings); }); return next;
};

// Remove ids + anything bonded to them (legacy forCourt/forTrailer + the generic prevZone chain, so
// appended road/landscape peel with their host — LIFO preserved by removing the outermost first).
// Pure — the FULL transitive set of ids a removeWithChildren() drop takes out: the seed ids plus
// everything bonded OUTWARD of them (a court's trailer, a trailer's buffer, any prevZone chain).
// Surfaced separately so a delete handler can TOMBSTONE the whole cascade, not just the clicked
// element (B556/NEW-1). Without tombstoning every killed id, two things break: (1) a cloud /
// cross-tab / cross-device union-merge (mergeSiteContent) RESURRECTS the bonded children — the
// truck-court→trailer-parking-comes-back the owner hit; (2) dropping ≥2 items with no tombstone to
// explain them trips the B459 thin-clobber guard, which the caller surfaces as a FALSE "changed in
// another session" conflict (the phantom "Take over editing" re-prompt → resurrect → re-prompt loop).
export const killSetWithChildren = (arr, ids) => {
  const kill = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    arr.forEach((x) => { if (!kill.has(x.id) && ((x.forCourt && kill.has(x.forCourt)) || (x.forTrailer && kill.has(x.forTrailer)) || (x.prevZone && kill.has(x.prevZone)))) { kill.add(x.id); grew = true; } });
  }
  return kill;
};

export const removeWithChildren = (arr, ids) => { const kill = killSetWithChildren(arr, ids); return arr.filter((x) => !kill.has(x.id)); };

// Zone element factories (final geometry is set by relayoutSide).
export const baseZone = (b, extra) => ({ id: uid(), cx: b.cx, cy: b.cy, w: 1, h: 1, rot: ((b.rot % 360) + 360) % 360, attachedTo: b.id, ...extra });

export const makeCourtZoneIn = (b, side, settings) => baseZone(b, { type: "paving", truckCourt: { side }, zd: zoneDepthDefaults(settings)[0] });

export const makeTrailerZoneIn = (b, court, settings) => baseZone(b, { type: "trailer", forCourt: court.id, prevZone: court.id, noFit: true, zd: zoneDepthDefaults(settings)[1], cfg: { trailerW: settings.trailerW || OPP_TRAILER_W, trailerL: zoneDepthDefaults(settings)[1], trailerAisle: 0, single: true } });

export const makeBufferZoneIn = (b, trailer, settings) => baseZone(b, { type: "landscape", forTrailer: trailer.id, prevZone: trailer.id, buffer: true, noFit: true, zd: zoneDepthDefaults(settings)[2] });

// A catalog-driven appended dock layer (landscape buffer / road / sidewalk) bonded OUTWARD of
// `prevEl` via prevZone. noFit ⇒ relayoutSide owns its geometry; road carries travelW/curb so the
// curb-line renderer + roadTravelWidth keep working and its depth = travelW + 2·curb.
export const makeChainZoneIn = (b, side, key, prevEl, settings) => {
  const c = ZONE_CATALOG[key];
  const base = { type: c.elType, prevZone: prevEl ? prevEl.id : null, stackSide: side, noFit: true, ...(c.tag || {}) };
  if (key === "road") {
    const travelW = catalogDepthDefault("road", settings) || 24;
    const curb = (+settings.roadCurb || CURB);
    return baseZone(b, { ...base, travelW, curb, zd: travelW + 2 * curb });
  }
  return baseZone(b, { ...base, zd: catalogDepthDefault(key, settings) });
};

// The next-zone element (index = present count) for a side, within `arr`.
export const buildNextZoneIn = (arr, b, side, settings) => {
  const n = stackCountIn(arr, b, side);
  if (dockChainOnSide(arr, b, side).length > n && n > 0) return null;   // repeat trailer rows / appended layers: extend from "Docks & walls", never fork the chain
  if (n === 0 && findHeadIn(arr, b, side)) return null;   // court binned, outer layers stayed: extend from "Docks & walls", not by a second court
  if (n === 0) return makeCourtZoneIn(b, side, settings);
  if (n === 1) { const c = findCourtIn(arr, b, side); return c ? makeTrailerZoneIn(b, c, settings) : null; }
  if (n === 2) { const c = findCourtIn(arr, b, side); const t = findTrailerIn(arr, c); return t ? makeBufferZoneIn(b, t, settings) : null; }
  return null; // full default sequence (appended layers come via the "Add layer" chooser)
};

/* ---- "Add layer ▾" chooser (B495): the fast "+" keeps the preset sequence; this lets the user
   pick a specific outward layer (landscape buffer / sidewalk / parking / road) per the catalog. ---- */
// The outward perpendicular distance (feet, from building centre) to the OUTER face of the
// furthest bonded element on `side` — i.e. where the next appended layer must start to sit flush.
export const sideOuterPerp = (arr, b, side) => {
  const [nx, ny] = SIDE_N[side]; const isH = ny !== 0, s = isH ? ny : nx;
  let maxOut = (isH ? b.h : b.w) / 2;                       // the wall face itself
  const u = outwardUnit(b, side);
  arr.filter((x) => x.attachedTo === b.id && !x.points && !x.dogEar && x.type !== "driveInRamp" && sideOfKid(b, x) === side).forEach((x) => {
    const l = rot2(x.cx - b.cx, x.cy - b.cy, -b.rot);
    const c = s * (isH ? l.y : l.x);                       // signed perp distance of the element centre
    const ax = rot2(x.w / 2, 0, x.rot || 0), ay = rot2(0, x.h / 2, x.rot || 0);
    const half = Math.abs(ax.x * u.x + ax.y * u.y) + Math.abs(ay.x * u.x + ay.y * u.y);
    maxOut = Math.max(maxOut, c + half);
  });
  return maxOut;
};

// B2268801 — the { run, alongShift } (host frame) of the layer a NEW layer on a rear / end wall would sit outside of: the
// outermost bonded layer on that wall (strip, road, trailer or parking), or null when the wall holds none.
export const wallOutermostExtent = (arr, b, side) => {
  const [nx, ny] = SIDE_N[side], isH = ny !== 0, sg = isH ? ny : nx;
  let best = null, bestOut = -Infinity;
  arr.filter((x) => x.attachedTo === b.id && !x.points && !x.dogEar && x.type !== "driveInRamp" && !x.noFit && !x.truckCourt && !x.forCourt && !x.forTrailer && !x.prevZone && sideOfKid(b, x) === side
    && (isWallStrip(x) || x.type === "road" || isWallTrailer(x) || x.sideParkSide || SIDE_PARK_PAD_TYPES.has(x.type))).forEach((x) => {
    const l = rot2(x.cx - b.cx, x.cy - b.cy, -b.rot), out = sg * (isH ? l.y : l.x);
    if (out > bestOut) { bestOut = out; best = x; }
  });
  return best ? wallKidAlong(b, side, best) : null;
};

// Re-fit every feature bonded to a resized building so the whole assembly stays
// stuck together: dog-ears slide to the corner, wall strips scale, the
// opposite-side trailer re-hugs its wall, and a court's trailer follows the
// (re-scaled) court's far edge.
// `opts` (B1123) carries the GESTURE's intent, which the geometry alone cannot express:
//   · userResize      — this refit is a resize aimed AT `buildingId`. Only then may a dock zone
//                       pin its along-wall length. A relayout / rotation / heal passes nothing.
//   · dragAxis        — {w,h}: which local dimension an EDGE drag moved, so a depth-only drag can
//                       never be mistaken for a length drag. Absent for a corner drag / a typed
//                       dimension (both may legitimately change the length).
export const refitChildrenIn = (a, buildingId, nb, kids, opts = {}, settings) => {
  const resized = a.find((x) => x.id === buildingId);
  const hostIsBuilding = !!resized && resized.type === "building" && !resized.dogEar;
  /* NEW-2 (B385041) — ESTABLISH THE DOCK ORIENTATION BEFORE THE FOOTPRINT MOVES.
     This is the one funnel every building resize goes through (grip drag, edge drag, typed
     Length/Depth, the on-canvas dimension editor), so stamping here — from the PRE-resize
     `resized`, i.e. from what the building looks like at the instant the user grabs it — is what
     makes "derive by default, preserve once established" true for a building whose record predates
     `dockAxis` and which has not been through the load heal (a row seeded mid-session by the sync
     engine, say). A building that is already stamped is untouched. */
  const axisStamp = hostIsBuilding ? withDockAxis(resized) : resized;
  const dockAxisPatch = axisStamp !== resized ? { dockAxis: axisStamp.dockAxis, ...(axisStamp.dockSide !== resized.dockSide ? { dockSide: axisStamp.dockSide } : {}) } : null;
  let next = a.map((x) => {
    if (x.id === buildingId) {
      // A bump-out resized on its own stays GLUED to its building corner: update its stored span
      // along the dock wall + projection (B362), then RE-DERIVE its box from the host via
      // dogEarGeom so it can never slide away along the wall. Without this re-anchor the free drag
      // position let the bump float off the corner, opening a gap between it and the dock doors —
      // even when only the projection (the away-from-the-dock direction) was dragged. Its inner
      // edge stays pinned to the dock face and its outer end to the building corner; only along /
      // projection change, so the doors (which start at the bump's along-edge) stay flush.
      if (x.dogEar) {
        const de = { ...x.dogEar, ...dogEarSize(x.dogEar, nb.w, nb.h) };
        const host = a.find((h) => h.id === x.attachedTo && h.type === "building" && !h.points);
        return host ? { ...x, dogEar: de, ...dogEarGeom(host, de) }
          : { ...x, cx: nb.cx, cy: nb.cy, w: nb.w, h: nb.h, dogEar: de, ...(nb.rot != null ? { rot: nb.rot } : {}) };
      }
      return { ...x, ...(dockAxisPatch || {}), cx: nb.cx, cy: nb.cy, w: nb.w, h: nb.h, ...(nb.rot != null ? { rot: nb.rot } : {}) };
    }
    if (x.attachedTo === buildingId && x.dogEar) return { ...x, ...fitDogEar(nb, x.dogEar) };
    // NEW-2 / NEW-3 — wall strips and side-parking rows are DERIVED by relayoutWallKids below
    // (span rule / flush-against-the-sidewalk), never ratio-scaled here. fitKid's
    // `alongDim = 2 * alongHalf * ratio` rescaled a strip's stored run instead of recomputing it
    // from the span, and its `perpGap` replayed a clearance captured before the sidewalk changed
    // — the two drifts the owner reported on Building 3.
    if (hostIsBuilding && (ownedWallStrip(x, resized) || ownedSidePark(x, resized))) return x;
    const k = kids?.find((kk) => kk.id === x.id);
    if (k) return { ...x, ...fitKid(nb, k) };
    return x;
  });
  // Re-lay the dock-zone stack from stored depths so court → trailer → buffer stay
  // flush + depth-correct. The resized element may be the building (relay its dock
  // sides) or a stack zone itself (re-derive that zone's depth from its new box, then
  // relay its side so the trailer/buffer beyond it follow — the old "court drags its
  // trailer" behaviour, now extended through the buffer).
  if (hostIsBuilding) {
    const newB = { ...resized, ...(dockAxisPatch || {}), cx: nb.cx, cy: nb.cy, w: nb.w, h: nb.h, rot: nb.rot != null ? nb.rot : resized.rot };
    next = relayoutAllSidesIn(next, newB, settings);
    // NEW-2 / NEW-3 — the branch that was MISSING: on a host resize the wall strips and side
    // parking must be re-derived from the span rule + the live sidewalk, not left to fitKid's
    // proportional replay. `resized` (the PRE-resize host) is the side reference so an untagged
    // strip can't be inferred onto the wrong wall part-way through a big drag.
    next = relayoutWallKids(next, newB, resized);
  } else if (resized && resized.dogEar) {
    // A bump-out resized on its own (B492): re-lay the host's full-side sidewalks and pull its
    // truck court in to the new clear face between the (now-resized) bump-outs.
    const host = next.find((x) => x.id === resized.attachedTo);
    if (host) { next = relayoutBumpSidewalks(next, host); next = relayoutSideIn(next, host, resized.dogEar.side, settings); }
  } else if (resized && (resized.truckCourt || resized.forCourt || resized.forTrailer)) {
    const b = next.find((x) => x.id === resized.attachedTo);
    const side = zoneSideOf(next, resized);
    if (b && side) {
      const u = outwardUnit(b, side), rr = nb.rot != null ? nb.rot : resized.rot;
      const box = { w: nb.w, h: nb.h, rot: rr };
      const newDepth = Math.max(1, Math.round(boxExtentAlong(box, u)));
      // Did the drag change the ALONG-wall axis too? If so the user is setting this zone's
      // LENGTH, so remember it on the zone (derive-by-default / preserve-once-touched) instead of
      // letting the relayout snap it back to the court's span. A pure depth drag stores nothing,
      // so an untouched trailer keeps tracking the court exactly as before. The court head keeps
      // its own alongLen path (B492), which is capped to the clear bump-out face.
      //
      // B1123 — two things were wrong here, and the SECOND is the one that mattered.
      //  (1) The spans were compared as bounding-box PROJECTIONS (`boxExtentAlong(…, alongUnit(b,
      //      side))`), which leak the depth into the along measurement as h·|sin δ| once the zone's
      //      angle drifts off its host's — and it does drift in real plans. `zoneAlongExtent` reads
      //      the along DIMENSION in the host's frame instead, so a depth change moves it by zero.
      //  (2) There was no notion of INTENT at all: whether the owner had set a length was inferred
      //      from geometry alone, so anything that reached this branch could pin `alongLen` — and a
      //      pin is by design never reset, which is why the trailer never tracked its court again.
      //      The stamp now requires the gesture to BE a user resize OF THIS ZONE, and an edge drag
      //      must have moved the along axis. A host refit, a relayout, a rotation, a court depth
      //      change and the load-time heal are all structurally incapable of stamping.
      //
      // NEW-1 — the length was stored with no ANCHOR, so the relayout re-centred it on the wall and
      // both ends walked inward by half the reduction ("when I shrink the trailer parking, it
      // shrinks from both sides"). The gesture knows which end it held — an edge drag pins the
      // opposite edge exactly — so store that with the length. The truck court is no longer excluded:
      // it shares the defect (its typed length re-centred too), and `courtBumpOpts` still caps it to
      // the clear bump-out face, so B492 is unchanged.
      const isTrailerZone = resized.type === "trailer" || !!resized.forCourt;
      const alongIsW = isTrailerZone || side === "top" || side === "bottom";
      const alongAxisDragged = opts.dragAxis ? !!(alongIsW ? opts.dragAxis.w : opts.dragAxis.h) : null;
      const cOpts = courtBumpOpts(next, b, side);
      const fit = resizedZoneAlongFit(resized, { ...box, cx: nb.cx, cy: nb.cy }, {
        host: b, side, userResize: !!opts.userResize, alongAxisDragged,
        // The court head anchors against the clear bump-out FACE; everything outward of it anchors
        // against the court's own resolved span.
        chainAlong: resized.truckCourt ? cOpts.faceAlong : cOpts.along,
        chainShift: resized.truckCourt ? cOpts.faceShift : cOpts.alongShift,
      });
      next = next.map((x) => (x.id === buildingId
        ? { ...x, zd: newDepth, ...(fit ? { alongLen: fit.len, alongAnchor: fit.anchor, alongOff: fit.off } : {}) }
        : x));
      next = relayoutSideIn(next, b, side, settings);
    }
  } else if (resized && (isWallStrip(resized) || resized.sideParkSide)) {
    // NEW-3 — a wall strip or the parking row itself was resized: re-derive the whole side so the
    // parking stays flush against the strip's new thickness (and the strip back onto its span).
    // A resize of the parking field's RUN is user intent, so the pin rule in relayoutWallKids
    // keeps it; only its distance out from the wall is re-resolved.
    const host = next.find((x) => x.id === resized.attachedTo);
    // NEW-1 (2026-11-03) — a rear / end wall's Walk or Buffer is DERIVED from the wall span, so a handle drag that shortens it
    // must RECORD the length and the end it was held from (the same three keys a typed length used to write, `extentFieldsFor`):
    // otherwise the relayout below re-derives the full wall (or re-centres it) and the dragged end snaps back. Only a user
    // resize that really changed the run along the wall stamps anything — a depth-only drag, a host refit, a heal never do.
    if (host && host.type === "building" && !host.dogEar && opts.userResize && ownedWallStrip(resized, host)) {
      const wside = swSideOn(host, resized);
      const was = wallKidAlong(host, wside, resized), now = wallKidAlong(host, wside, { ...resized, cx: nb.cx, cy: nb.cy, w: nb.w, h: nb.h });
      if (Math.abs(was.run - now.run) > 0.5) {
        const keys = extentFieldsFor({ run: now.run, alongShift: now.alongShift }, sidewalkSpanForBumps(host, wside, bumpsOfHost(next, host)));
        next = next.map((x) => (x.id === resized.id ? applyZonePatch(x, keys) : x));
      }
    }
    // NEW-1 — this gesture IS aimed at the row, so it (and only it) may pin an over-length run.
    if (host && host.type === "building" && !host.dogEar) next = relayoutWallKids(next, host, host, { pinFrom: resized.id });
  } else if (resized && !resized.attachedTo && (resized.type === "parking" || resized.type === "paving") && Number.isFinite(resized.sideParkPiece)) {
    /* NEW-1 (dispatch: parking snaps back once split) — a direct canvas resize of one piece of a
       FREESTANDING split stack (no host wall to relay against) never moved its siblings, so
       growing/shrinking one row/aisle overlapped the next piece instead of pushing it — the
       paint order then buries the grown edge under an untouched, opaque sibling, which is what
       reads as "it snapped back to its old size" on release. `growFreeParkStack` (the "+"/"−"
       ladder) already re-lays the whole stack for this exact case (B1625728's freestanding
       remainder); a direct edge/corner drag on the canvas never got the same treatment. Re-lay
       the stack via the shared pure helper (`relayoutFreeStack`), the freestanding twin of
       `relayoutWallKids` — it propagates the gap/overlap that opened on whichever side of the
       dragged piece moved, so undisturbed siblings on the OTHER side never move.

       ⛔ NEW-1 (dispatch: parking STILL snaps back on expand, reopening the above) — membership
       is resolved from `opts.freeStackIds`, captured ONCE (by the caller, before any change —
       see `freeStackIdsFor`) rather than re-derived here from `next`. Re-deriving it here from
       `next` was the original (still-broken) shape: `next`'s resized piece already carries THIS
       frame's new geometry, and a CORNER (or along-wall edge) drag moves `w` along with `h`, so
       `freeParkStack`'s own width-match test — the thing that tells this stack's pieces apart
       from an unrelated field sitting nearby — silently found a chain of ONE the instant width
       diverged, and the depth relayout below never ran. A pure depth-edge drag (never touches
       `w`) always looked fixed, which is exactly why B1754864's own tests never caught it. */
    const ids = opts.freeStackIds && opts.freeStackIds.length > 1
      ? opts.freeStackIds
      : freeParkStack(next.find((x) => x.id === resized.id) || resized, next).map((p) => p.id); // no pre-captured membership — degrade to the old (width-sensitive) derivation rather than skip relayout outright
    if (ids.length > 1) {
      const byId = new Map(next.map((x) => [x.id, x]));
      const stack = ids.map((pid) => byId.get(pid)).filter(Boolean);
      if (stack.length > 1) {
        const relaid = relayoutFreeStack(stack, resized.id);
        if (relaid !== stack) {
          const relaidById = new Map(relaid.map((p) => [p.id, p]));
          next = next.map((x) => (relaidById.has(x.id) ? { ...x, ...relaidById.get(x.id) } : x));
        }
      }
    }
  }
  // Keep every bonded child's angle locked to the building's (B363) — closes the gap where a
  // strip kept a stale angle through a resize (fitKid preserves rot0, so drift would survive).
  return resyncBondedRot(next, resized && resized.attachedTo ? resized.attachedTo : buildingId);
};

// Trailer parking flush against the FAR (outer) edge of a truck court — where trailers
// actually back in. Routes through the stack ("+" adds the next zone, here the trailer).
export const isWallStrip = (x) => x.type === "sidewalk" || x.type === "landscape"; // 5′ wall strips
// Recompute a wall strip's run + along-centre to span the FULL building side, folding in any
// corner bump-outs that lengthen that wall (B492). Preserves the strip's thickness and its
// outward offset from the wall — only its length along the wall and its centre move. So a
// bump-out added/edited/removed keeps the sidewalk covering the whole side, at the real bump size.
export const sidewalkFullRunPatch = (arr, b, sw, sideRef = b) => {
  const side = swSideOn(sideRef, sw);
  const { cross, dimBX, dimBY } = hostAxisExtents(b, sw);
  const isVert = side === "left" || side === "right";
  const depth = isVert ? dimBX : dimBY;                // thickness: perpendicular to the wall
  const box = wallStripBoxFor(b, side, bumpsOfHost(arr, b), depth, sw, isFlushWallLayer(sw) ? inboardReach(b, side, arr.filter((k) => k !== sw && k.attachedTo === b.id && !k.dogEar && k.type !== "driveInRamp" && !k.noFit && !isFlushWallLayer(k) && (isWallStrip(k) || isSideParkPad(k, b)) && sideOfKid(b, k) === side)) : 0);
  const off = rot2(box.lx, box.ly, b.rot);
  return { ...sw, ...ownExtents(cross, box.dimBX, box.dimBY), cx: b.cx + off.x, cy: b.cy + off.y };
};

// A wall-hugging child this relayout OWNS: a free sidewalk/landscape strip or a side-parking
// row bonded straight to the building. Dock-zone stack members and appended "Add layer" chain
// zones (both `noFit`, positioned by relayoutSide) are deliberately excluded — the old
// relayoutBumpSidewalks filter caught a chain-zone landscape buffer as if it were a sidewalk.
export const ownedWallStrip = (x, b) => isWallStrip(x) && x.attachedTo === b.id && !x.points && !x.noFit
  && !x.truckCourt && !x.forCourt && !x.forTrailer && !x.prevZone;

/* NEW-2 — geometric, with the tag as the fast path (same rule as `sideParkPadsOn`). An untagged
 * Explode piece used to fail this test and therefore never re-flushed when its host moved or was
 * resized — the "the parking is entirely separated from the building" class. */
export const ownedSidePark = (x, b) => isSideParkPad(x, b) && !!sideOfKid(b, x);

// B2268801 — a Road or Trailer layer on a rear / end wall: a FLUSH layer (placed beyond what is inboard, repacked by
// repackFlushBeyond), never a dock-chain member (no noFit / forCourt / prevZone).
export const isWallTrailer = (x) => !!x && x.type === "trailer" && !!x.wallTrailer && !x.points;

export const ownedFlushKid = (x, b) => !!x && (x.type === "road" || isWallTrailer(x)) && x.attachedTo === b.id && !x.points && !x.dogEar
  && !x.noFit && !x.truckCourt && !x.forCourt && !x.forTrailer && !x.prevZone && !isCenterlineRoad(x);

export const sideParkSideOf = (b, x) => x.sideParkSide || sideOfKid(b, x);

/* Re-lay every wall-hugging child of `b` from the RULE rather than from a remembered box
   (NEW-2 / NEW-3). `sideRef` is the host box used only to infer an untagged child's side — on a
   resize that's the PRE-resize host, so a big drag can't flip a strip onto the wrong wall.

   Two different contracts, deliberately:
     • Wall STRIPS (sidewalk / landscape) — fully derived, and the span rule is ABSOLUTE
       (owner rule): the strip spans exactly the extended side (building depth + the projection
       of any corner bump-out that lengthens that wall), centred on that span, flush to the wall.
       So a host resize, a bump-out add/delete/resize and a strip width edit all land on the same
       number, and deleting the bump collapses the strip back to the bare side.
     • SIDE PARKING — split by axis (owner amendment). PERPENDICULAR is always derived and always
       flush against the live sidewalk on that side (or the wall when there is none); replaying a
       `perpGap` captured before the sidewalk changed is the whole bug. ALONG the wall is USER
       INTENT: a field whose run + centre already match the span default is UNTOUCHED and tracks
       the span; anything else has been positioned by hand (the owner slid Building 3's east field
       to get the curb return right where the fire lane ties in) and is carried through every
       refit unchanged, only its run clamped to the span — with the unclamped intent stamped on
       `sideParkFit` so it springs back when the host grows again, exactly like a dog-ear's
       stored along/proj. */
/* NEW-1 — `pinFrom` is the id of the field the CURRENT gesture is aimed at, and it is the only
   thing allowed to pin an over-length run (lib/dogEar `sideParkAlongRun`). A host refit passes
   nothing, so a resize can no longer stamp a `sideParkFit` remembering the host's OLD length. */
export const relayoutWallKids = (arr, b, sideRef = b, { pinFrom = null } = {}) => {
  const bumps = bumpsOfHost(arr, b);
  // The strip (if any) each parking row has to clear, keyed by side — resolved from the array
  // being built, so a just-added / just-deleted / just-widened sidewalk is already reflected.
  const stripBySide = {};
  arr.forEach((x) => { if (ownedWallStrip(x, b) && !isFlushWallLayer(x)) { const s = swSideOn(sideRef, x); if (!stripBySide[s]) stripBySide[s] = x; } });
  /* NEW-1 — a wall's side parking may be an exploded STACK (stall row | drive aisle | stall row),
     so each piece clears the strip PLUS everything stacked inboard of it. One shared derivation
     with the load-time heal (lib/dogEar `sideParkStack`); a single un-exploded field still
     resolves to the bare strip thickness, so this is identity for a plan never exploded. */
  const gapById = new Map();
  {
    const byWall = new Map();
    arr.forEach((x) => {
      if (!ownedSidePark(x, b)) return;
      const s = sideParkSideOf(b, x);
      if (!byWall.has(s)) byWall.set(s, []);
      byWall.get(s).push(x);
    });
    byWall.forEach((pads, s) => {
      const strip = stripBySide[s];
      const isV = s === "left" || s === "right";
      const sd = strip ? (isV ? hostAxisExtents(b, strip).dimBX : hostAxisExtents(b, strip).dimBY) : 0;
      sideParkStack(b, s, pads, sd).forEach((r) => gapById.set(r.el.id, r.gap));
    });
  }
  const placed = arr.map((x) => {
    if (ownedWallStrip(x, b)) return sidewalkFullRunPatch(arr, b, x, sideRef);
    // B2268801 — a rear / end wall's Road or Trailer layer with its own along extent re-derives its length + position
    // from it (a layer with none is left exactly as before: its stored box, scaled with the wall on a resize).
    if (ownedFlushKid(x, b) && hasWallExtent(x)) {
      const fside = sideOfKid(sideRef, x), fbox = flushKidBoxFor(b, fside, bumps, x);
      const { cross: fcross } = hostAxisExtents(b, x), foff = rot2(fbox.lx, fbox.ly, b.rot);
      return { ...x, ...ownExtents(fcross, fbox.dimBX, fbox.dimBY), cx: b.cx + foff.x, cy: b.cy + foff.y };
    }
    if (!ownedSidePark(x, b)) return x;
    const side = sideParkSideOf(b, x);
    const { cross } = hostAxisExtents(b, x);
    const cur = wallKidAlong(b, side, x);                       // its live run / centre / depth
    // Only the strip's THICKNESS may become part of the gap — never its run (a rotated strip
    // would otherwise leak a wall-length value here, the swThick guard from addParkingRowSide).
    const gap = gapById.has(x.id) ? gapById.get(x.id) : 0;
    const span = sidewalkSpanForBumps(b, side, bumps);
    // NEW-1 — the along-wall decision is the ONE shared rule (lib/dogEar `sideParkAlongRun`), so
    // the canvas refit and the load-time heal cannot answer "is this run user intent?" differently.
    const res = sideParkAlongRun({ cur, span, stamp: x.sideParkFit || null, pinAllowed: pinFrom === x.id });
    const box = wallKidBox(b, side, { depth: cur.depth, gap, run: res.run, alongShift: res.alongShift });
    const off = rot2(box.lx, box.ly, b.rot);
    const out = { ...x, ...ownExtents(cross, box.dimBX, box.dimBY), cx: b.cx + off.x, cy: b.cy + off.y };
    if (res.stamp === null) delete out.sideParkFit;             // an impossible stamp is dropped, not clamped
    else if (res.stamp) out.sideParkFit = res.stamp;
    return out;
  });
  // Preserve object identity when nothing actually moved (no dirty flag / no cloud re-save
  // churn on a plan that is already correct — the same idempotency contract as dogEarGeom).
  const near = (p, q) => Math.abs(p - q) <= 1e-6;
  return placed.map((x, i) => {
    const o = arr[i];
    return (x !== o && near(x.cx, o.cx) && near(x.cy, o.cy) && near(x.w, o.w) && near(x.h, o.h)
      && x.sideParkFit === o.sideParkFit) ? o : x;
  });
};

export const relayoutBumpSidewalks = (arr, b, sideRef = b) => relayoutWallKids(arr, b, sideRef);

/* ---- Drive-in ramps (NEW-1 / NEW-2, 2026-10-30 — lib/driveInRamp.js owns every rule) -------------------------------------------------------
 * One building-attached `driveInRamp` element per ramp. The "+" beside a purple corner "+" drops one at the end of the belt by that corner (there is no
 * ramp button at a wall's middle — owner 2026-11-02); it then opens the ramp's Properties. A wall that is not a dock wall
 * takes a door MARKER instead (no ramp: the floor is at grade there). The door run it reads is `dockDoorRun` WITHOUT ramps — the module grid is the
 * building's, not the ramps'. */
export const rampsOnHost = (arr, b) => arr.filter((x) => x.type === "driveInRamp" && x.attachedTo === b.id);

// Which building side a bonded kid hugs. Trust an explicit tag; else infer it
// from the kid's position (so legacy / untagged strips are still recognised).
export const sideOfKid = (b, kid) => {
  if (kid.sidewalkSide) return kid.sidewalkSide;
  const c = kid.points ? centroid(kid.points) : { x: kid.cx, y: kid.cy };
  const l = rot2(c.x - b.cx, c.y - b.cy, -b.rot);
  const outX = Math.abs(l.x) - b.w / 2, outY = Math.abs(l.y) - b.h / 2;
  return outY >= outX ? (l.y >= 0 ? "bottom" : "top") : (l.x >= 0 ? "right" : "left");
};

// Which building side a strip hugs, and whether its thickness is on the h axis.
// Which side a strip hugs, resolved against an EXPLICIT host box — so a relayout mid-resize can
// infer from the pre-resize host instead of whatever `els` happens to hold.
export const swSideOn = (b, el) => el.sidewalkSide || (b ? sideOfKid(b, el) : (el.w >= el.h ? "bottom" : "right"));

export const outwardUnit = (b, side) => { const [nx, ny] = SIDE_N[side]; return rot2(nx, ny, b.rot); };
