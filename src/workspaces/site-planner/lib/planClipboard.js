/* General canvas clipboard for the Site Planner (NEW-2 + NEW-6).
 *
 * BEFORE: Ctrl+C/Ctrl+V only ever copied ONE `els` entry (`copySel` = `els.find(...)`) and
 * `detachClone` deliberately stripped `attachedTo`, so a copied building arrived stripped of the
 * truck court / trailer parking / dock zones / sidewalks / bump-outs bonded to it, and callouts,
 * parcels, markups and measurements could not be copied AT ALL.
 *
 * NOW: one clipboard driven by the current selection.
 *   - NEW-2 (containment): copying an element pulls its whole ASSEMBLY — the host plus every
 *     element bonded to it through `attachedTo`, the SAME explicit relation `deleteSel`,
 *     `nudgeSel` and `duplicateGroup` already cascade over. No geometric-containment guessing.
 *   - NEW-6 (coverage): every drawn kind is copyable — el · markup · measure · callout · parcel —
 *     including a mixed multi-selection. Relative geometry is preserved: the whole set moves by ONE
 *     delta so it lands under the cursor with its internal spacing intact.
 *
 * Everything here is pure (no React, no DOM): the caller injects id minting and the per-kind
 * translate functions it already owns, so this module can be unit-tested on plain objects.
 * Unit tests: test/planClipboard.test.js.
 */

// The drawn kinds a clipboard entry can hold. Deliberate exclusions (documented, not silent):
//  · `sheetOverlays` / the site underlay — imported backdrops, NOT drawn objects; they keep their
//    own dedicated Ctrl+C/V path (`copyOverlay` / `pasteOverlay`) because a copy has to clone the
//    raster/PDF payload + its calibration, not just geometry.
//  · Road-network junctions, dock frames and dog-ears — never standalone: they ride along as part
//    of the assembly of the element that owns them.
export const CLIP_KINDS = ["el", "markup", "measure", "callout", "parcel"];

// B1124 — the id-bearing bonds and the host-role tags now live in ONE shared module, so this path
// and `duplicateGroup` cannot drift again (they already had: BOTH remapped only `attachedTo`, so a
// copied trailer stayed bonded to the ORIGINAL building's truck court).
import { remapBondRefs } from "./bondRemap.js";
// The ONE projection that relates a plan's feet frame to the ground (see mapLock.js's header).
// Used only by `resolveClipFrame` below — pure math, no Leaflet, no DOM.
import { lngLatToFeet, feetToLatLngPair, ftPerDeg } from "./mapLock.js";

// A stable string key for a selection ref, so a mixed set dedupes cleanly.
const refKey = (r) => `${r.kind}:${r.id}`;

/* ---------------------------------------------------------------- collect */

/**
 * Resolve a selection ref list into the objects to copy.
 *
 * @param refs  [{ kind, id }] — measures may arrive index-keyed ({ kind:"measure", i }); both work.
 * @param state { els, markups, measures, callouts, parcels }
 * @returns { items: [{ kind, obj }], counts: { el, markup, ... } } — `items` is deduped and,
 *          for elements, EXPANDED to include each host's bonded children (NEW-2).
 */
export function collectClipboard(refs, state) {
  const els = state.els || [], markups = state.markups || [], measures = state.measures || [];
  const callouts = state.callouts || [], parcels = state.parcels || [];
  const items = [], seen = new Set();
  const push = (kind, obj) => {
    if (!obj || obj.id == null) return;
    const k = `${kind}:${obj.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    items.push({ kind, obj });
  };
  // An element's assembly root: a bonded child copies as part of its HOST, never on its own —
  // the same `rootIdOf`/`assemblyOf` rule the delete + nudge paths use.
  const rootIdOf = (id) => { const el = els.find((x) => x.id === id); return (el && el.attachedTo) || id; };

  for (const ref of refs || []) {
    if (!ref || !ref.kind) continue;
    if (ref.kind === "el") {
      const root = rootIdOf(ref.id);
      els.filter((e) => e.id === root || e.attachedTo === root).forEach((e) => push("el", e));
    } else if (ref.kind === "markup") {
      push("markup", markups.find((m) => m.id === ref.id));
    } else if (ref.kind === "measure") {
      // sel keys a measure by array index (`i`); multi keys it by id. Accept either.
      const m = ref.id != null ? measures.find((x) => x.id === ref.id) : measures[ref.i];
      push("measure", m);
    } else if (ref.kind === "callout") {
      push("callout", callouts.find((c) => c.id === ref.id));
    } else if (ref.kind === "parcel") {
      push("parcel", parcels.find((p) => p.id === ref.id));
    }
  }
  const counts = {};
  items.forEach(({ kind }) => { counts[kind] = (counts[kind] || 0) + 1; });
  return { items, counts };
}

/* ------------------------------------------------- crossing a plan boundary */

/* THE COORDINATE DECISION (NEW-1), made explicitly rather than by accident.
 *
 * Clipboard geometry is FEET IN THE SOURCE PLAN'S FRAME, and that frame is anchored at the
 * plan's own `origin` (lat/lon). Sibling plans of one site usually share an origin — the
 * `New plan (same parcel)` path copies it — but `origin` is a per-RECORD field and CAN differ,
 * so identical framing is never guaranteed. Pasting the source numbers straight into a plan
 * anchored somewhere else would put the shape in the wrong place with nothing said, which is
 * the worst outcome available here (LOUD-FAILURE exists for exactly this).
 *
 * WHAT WE CHOSE: RE-PROJECT, through the same `mapLock` projection the whole planner is welded
 * to. A point is taken out of the source frame to lat/lon and back into the destination frame,
 * so a cross-plan paste lands on the SAME GROUND POSITION it occupied in the plan it came from.
 * For the owner's case — two concepts of one parcel — that means the polygon arrives exactly
 * over where it was, which is what "copy it over" means.
 *
 * WHAT WE DELIBERATELY DO NOT DO: rescale the geometry. Each plan's feet are ground-true at its
 * OWN origin, so a 1,000 ft building is 1,000 real feet in either plan; the two frames differ by
 * the Mercator grid-scale ratio between their origin latitudes, and applying that would SHRINK a
 * copied building for no physical reason. So the frame relation is applied as an exact
 * TRANSLATION, evaluated at the payload's own centre — exact there, with the ignored scale term
 * showing up as a small positional smear that grows with how big the copied set is and how far
 * apart the two anchors are.
 *
 * AND THAT SMEAR IS CHECKED, NOT ASSUMED. `resolveClipFrame` computes it and REFUSES when it
 * would exceed `CLIP_FRAME_MAX_SMEAR_FT` — i.e. when the two plans are far enough apart that
 * translation alone is no longer an honest answer (a different city, not a different concept of
 * one site). It also refuses when the two frames cannot be related at all, which is the case
 * where exactly ONE of the plans has a map origin. Both refusals are named and carry owner-facing
 * copy; the caller must show it. Two plans that BOTH have no origin are two abstract feet frames
 * with nothing to reconcile, so that case is a clean no-op.
 */

// The most positional error we will accept from treating the frame relation as a pure
// translation. One foot, across the whole copied set — under a real survey's own tolerance, and
// far more room than two concepts of one parcel can ever use (the two anchors would have to be
// miles apart north-south before an ordinary site-sized copy reaches it).
export const CLIP_FRAME_MAX_SMEAR_FT = 1;

// Every refusal ends the same way, because there is always the same way out: place it yourself.
const AIM_IT = " Put your cursor where you want it and paste there.";

const hasOrigin = (o) => !!(o && Number.isFinite(o.lat) && Number.isFinite(o.lon));

/**
 * How the SOURCE plan's feet frame relates to the DESTINATION plan's.
 *
 * @param from       the source plan's `origin` ({ lat, lon } | null)
 * @param to         the destination plan's `origin` ({ lat, lon } | null)
 * @param opts.ref      the point (source feet) the translation is made exact at — pass the
 *                      payload's bbox centre, so the error is split evenly across the set
 * @param opts.extentFt the copied set's largest dimension, which is what the ignored scale
 *                      term is multiplied by to get the worst-case smear
 * @returns { ok: true,  dx, dy, same, smearFt }
 *        | { ok: false, reason: "no-origin" | "frame-too-far", smearFt, why, message }
 *          — `why` is the reason on its own; `message` is `why` plus the way out, for a refusal.
 */
export function resolveClipFrame(from, to, { ref = { x: 0, y: 0 }, extentFt = 0, maxSmearFt = CLIP_FRAME_MAX_SMEAR_FT } = {}) {
  if (!hasOrigin(from) && !hasOrigin(to)) return { ok: true, dx: 0, dy: 0, same: true, smearFt: 0 };
  if (!hasOrigin(from) || !hasOrigin(to)) {
    const why = (hasOrigin(from) ? "This plan isn't on the map yet" : "The plan you copied from isn't on the map")
      + ", so there's no way to tell where the copy belongs.";
    return { ok: false, reason: "no-origin", smearFt: null, why, message: why + AIM_IT };
  }
  if (from.lat === to.lat && from.lon === to.lon) return { ok: true, dx: 0, dy: 0, same: true, smearFt: 0 };

  // The two frames are the same conformal projection at two anchors, so they differ by a uniform
  // scale (the ratio of feet-per-degree at the two origin latitudes) plus a translation. We keep
  // real-world size and take only the translation — this is the error that leaves behind.
  const scale = ftPerDeg(to.lat) / ftPerDeg(from.lat);
  const smearFt = Math.abs(scale - 1) * (Math.max(0, Number(extentFt) || 0) / 2);
  if (!(smearFt <= maxSmearFt)) {
    const why = "These two plans sit too far apart on the map to copy by position.";
    return { ok: false, reason: "frame-too-far", smearFt, why, message: why + AIM_IT };
  }
  const [lat, lon] = feetToLatLngPair(ref, from.lat, from.lon);
  const p = lngLatToFeet(lon, lat, to.lon, to.lat);
  return { ok: true, dx: p.x - (Number(ref.x) || 0), dy: p.y - (Number(ref.y) || 0), same: false, smearFt };
}

/**
 * WHERE a paste lands — the ONE decision, shared by the drawn-object and the reference-drawing
 * Ctrl+V paths. They had this logic twice and it is exactly the pair the brief warned would
 * diverge the first time someone touched one of them.
 *
 * @param crossPlan  is this paste landing on a different plan from the one it was copied on?
 * @param frame      `resolveClipFrame`'s verdict (null for a same-plan paste)
 * @param bbox       the payload's extent in SOURCE feet
 * @param cursor     the live cursor in DESTINATION feet, already snapped (null = none seen yet)
 * @param nudge      the same-plan fallback offset, so a paste is never a silent no-op
 * @returns { mode: "in-place" | "cursor" | "nudge", dx, dy } | { mode: "refuse", message }
 */
export function clipPlacement({ crossPlan, frame, bbox, cursor, nudge = 0 } = {}) {
  // Cross-plan with a resolvable frame: land it on the same GROUND it had on the plan it came
  // from. No nudge — there is no original here to sit on top of, and "it arrived where it was" is
  // what copying it over means. A same-plan paste keeps landing at the cursor (B417).
  if (crossPlan && frame && frame.ok) return { mode: "in-place", dx: frame.dx, dy: frame.dy };
  if (bbox && cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) {
    return { mode: "cursor", dx: cursor.x - (bbox.x0 + bbox.x1) / 2, dy: cursor.y - (bbox.y0 + bbox.y1) / 2 };
  }
  if (!crossPlan) return { mode: "nudge", dx: nudge, dy: nudge };
  // Crossing a plan boundary, no frame relation and nowhere aimed: refuse rather than land it
  // somewhere arbitrary (LOUD-FAILURE).
  return { mode: "refuse", message: frame.message };
}

/* ------------------------------------------------------------------ paste */

/**
 * The bounding box of a clipboard payload, so paste can land the SET (not each piece) under the
 * cursor with its internal spacing intact.
 * @param bboxOf (obj) => { x0, y0, x1, y1 } | null — the caller's existing feature-bbox helper.
 */
export function clipboardBBox(items, bboxOf) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { kind, obj } of items || []) {
    // A callout's own bbox is its text box + every leader tip; `bboxOf` doesn't know that shape.
    const bb = kind === "callout" ? calloutBBox(obj) : bboxOf(obj);
    if (!bb) continue;
    x0 = Math.min(x0, bb.x0); y0 = Math.min(y0, bb.y0);
    x1 = Math.max(x1, bb.x1); y1 = Math.max(y1, bb.y1);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

// A callout persists as { box, tip } (legacy single leader), { box, tips:[…] }, or box-only
// (noLeader) — mirror `calloutTips`'s read rule rather than branching on shape everywhere.
export const clipCalloutTips = (c) => (Array.isArray(c.tips) ? c.tips : (c.tip ? [c.tip] : []));

function calloutBBox(c) {
  const pts = [c.box, ...clipCalloutTips(c)].filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  pts.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
  return { x0, y0, x1, y1 };
}

// Translate a callout (text box + every leader tip) by (dx,dy), preserving whichever shape it's in.
export function translateCalloutBy(c, dx, dy) {
  const out = { ...c, box: { x: c.box.x + dx, y: c.box.y + dy } };
  if (Array.isArray(c.tips)) out.tips = c.tips.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  else if (c.tip) out.tip = { x: c.tip.x + dx, y: c.tip.y + dy };
  return out;
}

// Translate a parcel ring by (dx,dy).
export function translateParcelBy(p, dx, dy) {
  return { ...p, points: (p.points || []).map((q) => ({ x: q.x + dx, y: q.y + dy })) };
}

/**
 * Rebuild a clipboard payload as brand-new objects, offset by (dx,dy).
 *
 * @param items    from `collectClipboard`
 * @param opts.mint       () => string — fresh id minter (the app's `uid`)
 * @param opts.translate  { el, markup, measure } — the caller's existing per-kind translators.
 *                        Callouts + parcels use the pure helpers above.
 * @param opts.dx/.dy     the ONE delta applied to every member (relative geometry preserved)
 * @returns { els, markups, measures, callouts, parcels, refs } — `refs` selects the pasted set.
 */
export function pasteClipboard(items, { mint, translate, dx = 0, dy = 0 } = {}) {
  const list = items || [];
  const idMap = new Map();
  list.forEach(({ obj }) => { if (obj && obj.id != null && !idMap.has(obj.id)) idMap.set(obj.id, mint()); });
  // One fresh group id per SOURCE group id: members copied together stay grouped together, and a
  // member copied without its group-mates arrives ungrouped (never joined to the live original).
  const groupMembers = new Map();
  list.forEach(({ obj }) => { if (obj && obj.groupId) groupMembers.set(obj.groupId, (groupMembers.get(obj.groupId) || 0) + 1); });
  const groupMap = new Map();
  for (const [gid, n] of groupMembers) if (n > 1) groupMap.set(gid, "g" + mint());

  const out = { els: [], markups: [], measures: [], callouts: [], parcels: [], refs: [] };
  // Element-only id map: a bond names an ELEMENT, so a same-valued id from another collection can
  // never satisfy it (B1124).
  const elIdMap = new Map(list.filter((it) => it.kind === "el" && it.obj && it.obj.id != null).map((it) => [it.obj.id, idMap.get(it.obj.id)]));

  for (const { kind, obj } of list) {
    const id = idMap.get(obj.id);
    let c;
    if (kind === "el") {
      c = { ...translate.el(obj, dx, dy), id };
      // EVERY id-bearing bond — the host (`attachedTo`) AND the intra-assembly chain
      // (`forCourt` / `forTrailer` / `prevZone`) — is remapped when its target rides along in the
      // same copy, and DROPPED when it doesn't, so a lone child pastes standalone instead of
      // silently re-bonding to the ORIGINAL building and being yanked back by the refit engine
      // (B1124: only `attachedTo` used to be remapped, which is how a copied building's trailer
      // parking ended up bonded to a court on the building it was copied FROM).
      remapBondRefs(c, obj, elIdMap);
    } else if (kind === "markup") {
      c = { ...translate.markup(obj, dx, dy), id };
      // An easement drawn against a parcel follows the copied parcel when one rides along;
      // otherwise it keeps pointing at the live parcel it was drawn on (still true, still visible).
      if (obj.parcelId != null && idMap.has(obj.parcelId)) c.parcelId = idMap.get(obj.parcelId);
    } else if (kind === "measure") {
      c = { ...translate.measure(obj, dx, dy), id };
    } else if (kind === "callout") {
      c = { ...translateCalloutBy(obj, dx, dy), id };
    } else if (kind === "parcel") {
      c = { ...translateParcelBy(obj, dx, dy), id };
      /* DECISION (NEW-6, stated not accidental): a pasted parcel arrives INACTIVE.
       * Active parcels are what drive every area/yield number (B100/B170), and the copy lands
       * overlapping or beside the original — counting both would silently double the site area
       * the whole plan is sized against. Inactive means "visible, editable, excluded from the
       * math" — one click on the parcel's Active toggle counts it when that's really wanted.
       * `gisKey` is dropped with it: the copy is a drawn shape, not the county's record for that
       * account, and leaving the key on would make two shapes claim one parcel id. */
      c.active = false;
      delete c.gisKey;
    } else continue;

    if (obj.groupId) { const g = groupMap.get(obj.groupId); if (g) c.groupId = g; else delete c.groupId; }
    out[kind === "el" ? "els" : kind === "markup" ? "markups" : kind === "measure" ? "measures" : kind === "callout" ? "callouts" : "parcels"].push(c);
    // Bonded children are part of their host, not separately selectable — keep them out of `refs`
    // so the pasted selection reads as "the building" rather than "the building and its 7 pieces".
    if (!(kind === "el" && c.attachedTo != null)) out.refs.push({ kind, id });
  }
  return out;
}

/** Human summary for the paste toast / menu label ("3 items", "Building + 4 parts"). */
export function clipboardLabel(counts) {
  const n = Object.values(counts || {}).reduce((s, v) => s + v, 0);
  return n === 1 ? "1 item" : `${n} items`;
}

export const clipRefKey = refKey;
