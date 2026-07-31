/* Corner bump-out ("dog-ear") geometry (B362) + the wall-hugging-child span rule (B492 / NEW-2).
 *
 * A dog-ear is a building element flush at the END of a dock wall that projects out into the
 * truck court, taking that span out of dock use. It stores its corner (`side` = top/bottom/
 * left/right, `sign` = ±1 along the wall) and — once the user has resized it — its span ALONG
 * the dock wall plus its PROJECTION out from the dock face (`along`/`proj`). Absent → the
 * 55′×60′ default.
 *
 * The second half of this module is the WALL-KID placement rule (NEW-2 / NEW-3): an end-wall
 * sidewalk spans EXACTLY the extended side (building depth + the projection of any corner bump-out
 * that lengthens that wall) and every wall-hugging child sits FLUSH — no bare ground, no overlap.
 * Both are DERIVED placements, never a remembered box scaled by a ratio, which is what let the
 * strips drift on a host resize.
 *
 * Kept pure + framework-free (its own rot2 / SIDE_N, matching dockZones.js) so the
 * resize-survives-a-host-refit contract is unit-testable; SitePlanner + siteModel wire it in.
 */
export const DOGEAR_W = 55; // default span along the dock wall
export const DOGEAR_D = 60; // default projection out from the dock face

const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
// True only for a real dock-wall side. The model layer guards on this before re-anchoring a
// dog-ear on load (NEW-6): a tampered/partial record with a missing or typo `side` must NOT
// reach dogEarGeom's `SIDE_N[side]` destructure (which would throw and blank the planner).
export const isDogEarSide = (s) => Object.prototype.hasOwnProperty.call(SIDE_N, s);
const rot2 = (x, y, deg) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
};

// Box geometry (centre, w/h, rot) of dog-ear `de` on building box `bx` ({cx,cy,w,h,rot}).
// The outer edge sits flush with the building corner (inset half its along-span) and it
// projects `proj` out past the dock face. The along-span is CLAMPED to the wall — never reset
// (so a host that shrinks past the corner pulls the bump in, but its stored size is preserved
// and springs back when the host grows again).
export function dogEarGeom(bx, de) {
  const { side, sign } = de;
  const [nx, ny] = SIDE_N[side];
  const alongIsX = ny !== 0; // horizontal (top/bottom) dock wall → corners spread along X
  const wallLen = alongIsX ? bx.w : bx.h;
  const along = Math.max(1, Math.min(de.along ?? DOGEAR_W, wallLen));
  const proj = Math.max(1, de.proj ?? DOGEAR_D);
  const w = alongIsX ? along : proj;
  const h = alongIsX ? proj : along;
  const lx = alongIsX ? sign * (bx.w / 2 - along / 2) : nx * (bx.w / 2 + proj / 2);
  const ly = alongIsX ? ny * (bx.h / 2 + proj / 2) : sign * (bx.h / 2 - along / 2);
  const off = rot2(lx, ly, bx.rot || 0);
  return { cx: bx.cx + off.x, cy: bx.cy + off.y, w, h, rot: ((((bx.rot || 0) % 360) + 360) % 360) };
}

// The along-wall span + outward projection of a dog-ear's BOX (w/h), resolved by which wall it
// hugs — the inverse of the w/h packing in dogEarGeom. Used to remember a user resize.
export const dogEarSize = (de, w, h) => (SIDE_N[de.side][1] !== 0 ? { along: w, proj: h } : { along: h, proj: w });

// Which perpendicular wall a corner bump-out lengthens (B492). A bump at the END of a dock wall
// projects out past the dock face, so it extends the building's PERPENDICULAR wall by its
// projection — and a sidewalk on that wall should span the full extended side. Shared with
// SitePlanner so the canvas + the geometry never disagree.
export function bumpSidewalkSide(side, sign) {
  const horiz = side === "top" || side === "bottom"; // dock wall runs along X
  return horiz ? (sign < 0 ? "left" : "right") : (sign < 0 ? "top" : "bottom");
}

// The full run (length along the wall) + along-axis centre shift of a sidewalk on `swSide` of
// building box `b`, once the corner bump-outs that lengthen that wall are folded in (B492). `bumps`
// is the building's dog-ears as [{side, sign, proj}] (proj = the bump's projection out from its dock
// face). Returns {run, alongShift} in building-LOCAL feet: alongShift is +X for a top/bottom strip,
// +Y for a left/right strip. PURE so the full-side span is unit-testable apart from the canvas.
export function sidewalkSpanForBumps(b, swSide, bumps = []) {
  const isVert = swSide === "left" || swSide === "right"; // run is along local Y
  const base = isVert ? b.h : b.w;
  let extNeg = 0, extPos = 0;                              // extension at the −axis / +axis ends
  bumps.forEach((bp) => {
    if (bumpSidewalkSide(bp.side, bp.sign) !== swSide) return;
    const endSign = SIDE_N[bp.side][isVert ? 1 : 0];       // bump dock-side normal along the run axis
    if (endSign < 0) extNeg += Math.max(0, bp.proj || 0);
    else extPos += Math.max(0, bp.proj || 0);
  });
  return { run: base + extNeg + extPos, alongShift: (extPos - extNeg) / 2 };
}

/* ---- Wall-hugging child placement (NEW-2 / NEW-3) ----------------------------------------
 * A "wall kid" is a bonded child that hugs one building side: a sidewalk / landscape strip, or a
 * side-parking row. Its geometry has TWO independent axes and they follow DIFFERENT rules:
 *
 *   • PERPENDICULAR (distance out from the wall) — ALWAYS derived, always flush: half the host
 *     side + whatever already sits between it and the wall (`gap`, e.g. a sidewalk's thickness)
 *     + half its own depth. Never a remembered gap: replaying a `perpGap` captured before the
 *     sidewalk changed is exactly what left the owner's west parking field stranded in bare
 *     ground while the east one stayed flush.
 *   • ALONG the wall (position + run) — the sidewalk span rule for strips (absolute); for side
 *     parking it is USER INTENT and the caller decides (see SitePlanner.relayoutWallKids).
 *
 * Everything here is in the host's LOCAL frame (host centre at the origin, host angle removed),
 * so the caller does one rotate back into world feet. */

// The perpendicular offset (host-local, signed) of a wall kid on `side` of host box `b`: flush
// past `gap` of intervening stuff, with `depth` = its own extent perpendicular to the wall.
export function wallKidPerp(b, side, depth, gap = 0) {
  const isVert = side === "left" || side === "right";
  const [nx, ny] = SIDE_N[side];
  return (isVert ? nx : ny) * ((isVert ? b.w : b.h) / 2 + Math.max(0, gap || 0) + depth / 2);
}

// The full host-local box of a wall kid: its centre {lx, ly} plus its extents on the HOST's two
// local axes {dimBX, dimBY}. `run`/`alongShift` are the along-wall length + centre shift the
// caller resolved (the span rule for a strip, stored intent for a pinned parking field).
export function wallKidBox(b, side, { depth, gap = 0, run, alongShift = 0 }) {
  const isVert = side === "left" || side === "right";
  const perp = wallKidPerp(b, side, depth, gap);
  return {
    lx: isVert ? perp : alongShift,
    ly: isVert ? alongShift : perp,
    dimBX: isVert ? depth : run,
    dimBY: isVert ? run : depth,
  };
}

// A wall STRIP (sidewalk / landscape) is fully derived: the span rule gives its run + centre
// shift, `gap` is 0 (a strip is always against the wall). Returns the host-local box plus the
// {run, alongShift} it came from, so a caller can assert the span rule directly.
export function wallStripBox(b, side, bumps = [], depth) {
  const span = sidewalkSpanForBumps(b, side, bumps);
  return { ...wallKidBox(b, side, { depth, gap: 0, ...span }), ...span };
}

// Which of the host's local axes a bonded box child's own w/h land on. A child may sit at a
// quarter turn from its host (a side-parking row runs ALONG a side wall), so its `w` is not
// necessarily the host's X extent. `cross` = the child is turned 90°/270° from the host.
export function hostAxisExtents(b, kid) {
  const rel = (((((kid.rot || 0) - (b.rot || 0)) % 360) + 360) % 360);
  const cross = Math.min(Math.abs(rel - 90), Math.abs(rel - 270)) < 45;
  return { cross, dimBX: cross ? kid.h : kid.w, dimBY: cross ? kid.w : kid.h };
}
// The inverse: host-axis extents back to the child's OWN w/h.
export const ownExtents = (cross, dimBX, dimBY) => (cross ? { w: dimBY, h: dimBX } : { w: dimBX, h: dimBY });

// The along-wall run + centre shift a bonded box child CURRENTLY has, in the host's local frame.
// Used to read a side-parking field's stored user intent off a legacy record (no schema change).
export function wallKidAlong(b, side, kid) {
  const isVert = side === "left" || side === "right";
  const { dimBX, dimBY } = hostAxisExtents(b, kid);
  const l = rot2(kid.cx - b.cx, kid.cy - b.cy, -(b.rot || 0));
  return { run: isVert ? dimBY : dimBX, alongShift: isVert ? l.y : l.x, depth: isVert ? dimBX : dimBY };
}

/* ---- NEW-1: WHEN a side-parking row's along-wall run counts as USER INTENT --------------------
 *
 * The along axis is "derive by default, preserve once touched": a field still sitting on the span
 * default tracks the host, and one the owner positioned himself is carried through every refit.
 * The bug was HOW "touched" was decided — from geometry alone, exactly the disease B1123 fixed for
 * a dock zone's `alongLen`:
 *
 *   `relayoutWallKids` runs on a host resize with the NEW host box but the OLD child boxes, so a
 *   field that was faithfully tracking the old span now measures different from the new one and is
 *   read as hand-positioned. Its run is clamped (so the plan LOOKS right) and the pre-resize run is
 *   stamped onto `sideParkFit` as "intent to spring back to". Nobody ever expressed that intent.
 *   The receipt is on the owner's Weld County plan: Building 2 is 577 ft long and its west field
 *   carries `sideParkFit: { run: 708.58 }` — 708.58 ft being the length of a DIFFERENT building,
 *   the one this one was duplicated from. Grow that host and the field springs out 131 ft past it.
 *
 * THE RULE, stated once and shared by the canvas refit AND the load-time heal so they cannot drift:
 *
 *   · A run LONGER than the wall it hugs is never intent — it is staleness. Every gesture that can
 *     set a run clamps it to the span, so a stored over-length run can only have come from a host
 *     that used to be longer (a resize, or a copy of a longer building). Such a field goes back to
 *     tracking the span, on BOTH axes: its along-CENTRE is stale by the same arithmetic (half the
 *     shrink), and keeping it would leave a correctly-sized field hanging off the end of the wall.
 *   · `pinAllowed` is the intent gate (B1123's `userResize`, by another name). Only a gesture aimed
 *     AT THIS FIELD may pin a run — the owner dragging its end is a real statement. A host refit, a
 *     duplicate, a relayout and the load-time heal all pass false and are structurally incapable of
 *     stamping.
 *
 * ⛔ NEW-2 (2026-07-31) — "PRESERVE ONCE TOUCHED" IS GONE, AND ITS REMOVAL IS THE POINT.
 * The rule above used to end with a third clause: a run SHORTER than the span, or a shifted centre,
 * was preserved exactly as it was found. That clause is what B1340 did not close and what the owner
 * reproduced on "Concept D — Sylvestri Retail" (`sms4zs8unbkg`) after a hard reload: building
 * `e1454731yyuqqs` had its DEPTH taken 220 → 200, its sidewalks correctly followed to 260 (200 + a
 * 60 ft bump projection), its truck court correctly followed — and its two end PARKING fields sat
 * at a run of 205 against that same 260 ft wall. On the building beside it, 80 ft of parking against
 * a 259 ft wall. Their PERPENDICULAR offsets were perfect, so B1340's position work was holding; it
 * was the SPAN that had gone stale, because an unstamped short run read as "the owner meant this"
 * forever and outlived the geometry it was measured against.
 *
 * A run is derivable from its host exactly like a position is, so it is DERIVED on the same
 * schedule and by the same rule:
 *   · NO STAMP → the run and the centre are the span default. An implicit difference is staleness,
 *     never intent, whichever direction it points.
 *   · A STAMP (`sideParkFit`) is the ONLY intent that counts. It is written ONLY by a gesture aimed
 *     at this field, it is EXPLICIT and per-element, and it is RE-CLAMPED to the host's span on
 *     every host change — so it can shrink with the wall and spring back when the wall grows, but it
 *     can never silently outlive the host it was measured against.
 *   · Dragging a field back onto the span default CLEARS the stamp: intent withdrawn is intent gone.
 * A deliberate resize therefore still survives every refit (it is recorded), and an accident no
 * longer does (it is not). Migration is deliberate and one-way: a plan carrying an unstamped short
 * run — nobody can tell an old accident from an old intent, and the owner has ruled that a field
 * matching its wall is the right default — is re-derived to its wall on the next open, LOUDLY
 * (`assembly-tear-detected`, span half).
 *
 * PURE, so the rule is unit-testable apart from the React canvas.
 */
export const SIDE_PARK_PIN_TOL_FT = 0.5; // below this a field still counts as sitting on the default

/**
 * @param cur    { run, alongShift } the field has NOW (wallKidAlong)
 * @param span   { run, alongShift } the span default for its side (sidewalkSpanForBumps)
 * @param stamp  its stored `sideParkFit` intent, or null
 * @param pinAllowed  true only for a gesture aimed at THIS field
 * @returns { run, alongShift, stamp, stale } — `stamp` is the `sideParkFit` to store (undefined =
 *          leave whatever is there, null = drop it); `stale` flags the over-length case for telemetry.
 */
export function sideParkAlongRun({ cur, span, stamp = null, pinAllowed = false, tol = SIDE_PARK_PIN_TOL_FT }) {
  const spanRun = Math.max(0, Number(span && span.run) || 0);
  const curRun = Math.max(0, Number(cur && cur.run) || 0);
  const curShift = Number(cur && cur.alongShift) || 0;
  const want = stamp && Number.isFinite(stamp.run) && stamp.run > 0 ? stamp : null;
  // Over-length: the field, or the intent stored for it, claims more wall than the host has.
  const overRun = (want ? want.run : curRun) > spanRun + tol;
  if (overRun && !pinAllowed) {
    // Stale on both axes → back onto the span default, and the impossible stamp goes with it.
    return { run: spanRun, alongShift: Number(span && span.alongShift) || 0, stamp: want ? null : undefined, stale: true };
  }
  const spanShift = Number(span && span.alongShift) || 0;
  const offDefault = Math.abs(curRun - spanRun) > tol || Math.abs(curShift - spanShift) > tol;
  /* NEW-2 — a gesture aimed at THIS field is the only thing that can create intent, and it now
   * RECORDS that intent instead of leaving it implicit in the geometry. Recording is what makes the
   * override explicit, per-element and re-clampable; leaving it implicit is what made it sticky. */
  if (pinAllowed) {
    // Dragged back onto the span default → the override is withdrawn, not merely satisfied.
    if (!offDefault) return { run: spanRun, alongShift: spanShift, stamp: null, stale: false };
    return { run: Math.min(curRun, spanRun), alongShift: curShift, stamp: { run: curRun, alongShift: curShift }, stale: false };
  }
  /* NEW-2 — no gesture, so the ONLY intent that counts is a RECORDED one. An unstamped divergence is
   * staleness in either direction (the Sylvestri case was SHORT, the Weld case was LONG) and goes
   * back onto the span. `stale` is what makes the load-time heal apply it and what makes it audible. */
  if (!want) return { run: spanRun, alongShift: spanShift, stamp: undefined, stale: offDefault };
  // A recorded override: honoured, but re-clamped to the wall the host currently has.
  return { run: Math.min(want.run, spanRun), alongShift: want.alongShift, stamp: undefined, stale: false };
}

// A host-local point back into world feet (rotate by the host angle, offset by its centre).
export const localToWorld = (b, lx, ly) => { const o = rot2(lx, ly, b.rot || 0); return { x: b.cx + o.x, y: b.cy + o.y }; };

// Which building side a bonded BOX child hugs, from its position alone (the tag-free fallback).
export function sideOfBondedBox(b, kid) {
  const l = rot2(kid.cx - b.cx, kid.cy - b.cy, -(b.rot || 0));
  const outX = Math.abs(l.x) - b.w / 2, outY = Math.abs(l.y) - b.h / 2;
  return outY >= outX ? (l.y >= 0 ? "bottom" : "top") : (l.x >= 0 ? "right" : "left");
}

// A dog-ear's {side, sign, along, proj} descriptor, recovering along/proj from its rendered box
// when the tag doesn't carry them. The ONE place that decision is made, so the sidewalk span, the
// re-anchor and the load-time heal can never read a bump's projection differently.
export const dogEarDesc = (el) =>
  (el.dogEar.along != null && el.dogEar.proj != null ? el.dogEar : { ...el.dogEar, ...dogEarSize(el.dogEar, el.w, el.h) });

// The bump descriptors sidewalkSpanForBumps wants, for every corner bump-out bonded to `b` in `arr`.
export const bumpsOfHost = (arr, b) =>
  arr.filter((x) => x && x.dogEar && x.attachedTo === b.id && isDogEarSide(x.dogEar.side)).map((x) => dogEarDesc(x));
