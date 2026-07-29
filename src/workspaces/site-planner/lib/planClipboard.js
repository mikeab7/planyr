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

// Tags that describe an element's ROLE inside its host's assembly (which face its truck court is
// on, which side its sidewalk hugs, which dog-ear corner it fills). They are meaningful only next
// to the host: kept when the host rides along in the same copy, dropped when it doesn't (the old
// `detachClone` behaviour, which is still right for a lone child).
const HOST_ROLE_TAGS = ["truckCourt", "forCourt", "forTrailer", "dogEar", "oppSide", "sideParkSide", "sidewalkSide", "stackSide", "noFit", "noLabel"];

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
  const copiedElIds = new Set(list.filter((it) => it.kind === "el").map((it) => it.obj.id));

  for (const { kind, obj } of list) {
    const id = idMap.get(obj.id);
    let c;
    if (kind === "el") {
      c = { ...translate.el(obj, dx, dy), id };
      // The host bond: remapped when the host rides along (NEW-2 — the whole assembly arrives
      // intact), otherwise dropped so a lone child pastes standalone instead of silently
      // re-bonding to the ORIGINAL building and being yanked back by the refit engine.
      if (obj.attachedTo != null) {
        if (copiedElIds.has(obj.attachedTo)) c.attachedTo = idMap.get(obj.attachedTo);
        else { delete c.attachedTo; HOST_ROLE_TAGS.forEach((t) => delete c[t]); }
      }
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
