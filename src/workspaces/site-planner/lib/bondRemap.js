/* B1124 — remap EVERY intra-selection back-reference when elements are copied.
 *
 * THE BUG THIS EXISTS TO CLOSE. Both copy paths (`pasteClipboard` and `duplicateGroup`) minted fresh
 * ids and remapped exactly one back-reference: `attachedTo`. Every other id-bearing tag was copied
 * VERBATIM, so a duplicated building's trailer parking arrived `attachedTo` the NEW building while
 * its `forCourt` still named the ORIGINAL building's truck court. A trailer bonded to a court on
 * another building can never track its own host: the relayout walks the chain from the court, finds
 * a court that isn't there, and the trailer is left behind — the owner's "trailer parking just
 * hovering by itself", wrong length and detached.
 *
 * THE RULE, stated once so both paths cannot drift again:
 *   · a reference that points INSIDE the copied set is remapped to the new id;
 *   · a reference that points OUTSIDE it is DROPPED — never left dangling to a foreign element.
 *     A missing bond degrades to "standalone"; a foreign bond degrades to geometry that can never
 *     be laid out, which is strictly worse and much harder to see.
 *
 * The tag inventory is audited against `ORPHAN_TAGS` in SitePlanner.jsx, which enumerates the whole
 * assembly-role family. Only some of those carry an ID:
 *   attachedTo   → element id   (the host bond)                      ← remapped
 *   forCourt     → element id   (trailer → its truck court)          ← remapped  ⟵ THE BUG
 *   forTrailer   → element id   (buffer → its trailer)               ← remapped
 *   prevZone     → element id   (generic outward-stack bond, B495)   ← remapped  ⟵ also missing,
 *                                and absent from ORPHAN_TAGS entirely
 *   groupId      → GROUP id, not an element id — each copy path mints its own fresh group id
 *   truckCourt   → { side }     — a side name, no id
 *   dogEar       → { side, sign, along, proj } — no id
 *   oppSide / sideParkSide / sidewalkSide / stackSide → side names, no id
 * So the id-bearing set is exactly the four below. Adding a new id-bearing tag means adding it here
 * — one place, both copy paths.
 *
 * Pure (no React, no DOM). Unit tests: test/bondRemap.test.js.
 */

/** Every tag that stores ANOTHER ELEMENT's id. `attachedTo` leads because it gates the role tags. */
export const ID_BOND_TAGS = ["attachedTo", "forCourt", "forTrailer", "prevZone"];

/**
 * Tags that only mean something next to the host. Dropped when the host does NOT ride along in the
 * same copy, so a lone child pastes as a plain standalone element instead of a half-bonded one.
 * (Mirrors `HOST_ROLE_TAGS` in planClipboard / `ORPHAN_TAGS` in SitePlanner.)
 *
 * NEW-1 (2026-08-03) — `sideParkFit` and `sideParkPiece` joined the list. Both are measured AGAINST
 * the host (an along-wall run + centre, and a position in the wall's outward stack), so both are
 * meaningless without it and must travel with it or not at all — exactly the contract this list
 * encodes. They were previously loose keys nobody enumerated, which is how a copy path could carry
 * one and drop the other.
 */
export const HOST_ROLE_TAGS = ["truckCourt", "forCourt", "forTrailer", "dogEar", "oppSide", "sideParkSide", "sideParkFit", "sideParkPiece", "sidewalkSide", "stackSide", "noFit", "noLabel", "prevZone"];

/* ---- NEW-1: the ONE tag-carry helper every "replace an element with fresh-uid children" path uses.
 *
 * THE BUG THIS EXISTS TO CLOSE. `splitParkingRows` (the parking field's Explode) built each piece
 * from scratch with only `cfg` and `attachedTo` copied off the source field. Every bond ROLE tag was
 * dropped — `sideParkSide` above all — so the pieces stayed bonded to the building while reading as
 * nothing in particular. That is not a cosmetic loss: `empSidePark` / `sideParkingOn` /
 * `normalizeWallKids` / the side-parking heal all answered "what is on this wall?" with a STRICT
 * `sideParkSide === side` test, so a full 60 ft parking module went INVISIBLE to every one of them.
 * The consequence the owner reported: on a non-dock wall the "−" ladder walks
 * rows → remove parking → remove sidewalk, and with the parking invisible ONE click fell straight
 * through to the last rung and deleted the sidewalk out from under a live parking field. Two
 * buildings on Goose Creek "Plan II" lost a sidewalk that way (2026-07-29 / 2026-07-30), each a solo
 * single-row delete with the host alive and untouched; twelve host buildings across six sites were
 * carrying untagged exploded pieces by the time it was found.
 *
 * THE RULE: a path that REPLACES an element with fresh-uid children keeps the source's host bond AND
 * its full role identity on every child — because the children ARE the source as far as the host is
 * concerned. `attachedTo` alone makes a bonded child with no identity, which every lookup keyed on
 * the role tag then fails to see. Route the copy through here rather than hand-picking a subset per
 * call site; hand-picked subsets are what drifted.
 *
 * NOT the same thing as `remapBondRefs` above, and deliberately separate: that one rewrites bonds
 * when a SET is copied (ids change on both ends). This one carries role tags when ONE element
 * becomes N pieces of itself and the host is untouched, so there is no id to remap.
 */
export function carryHostRoleTags(src, clone = {}) {
  if (!src) return clone;
  for (const tag of HOST_ROLE_TAGS) {
    const v = src[tag];
    if (v !== undefined) clone[tag] = v;
  }
  return clone;
}

/**
 * Rewrite `clone`'s id-bearing bonds in place-ish (returns the same object) from `src`'s originals.
 *
 * @param clone  the fresh copy (already carrying its new `id`)
 * @param src    the source element the copy was made from
 * @param idMap  Map<oldId, newId> for EVERY element in the copied set
 * @param opts.dropRoleTagsWhenHostLost  when `attachedTo` points outside the copy, also strip the
 *        host-role tags (the `detachClone` behaviour — right for a lone child). Default true.
 * @returns clone
 */
export function remapBondRefs(clone, src, idMap, { dropRoleTagsWhenHostLost = true } = {}) {
  if (!clone || !src || !idMap) return clone;
  const hostLost = isRef(src.attachedTo) && !idMap.has(src.attachedTo);
  for (const tag of ID_BOND_TAGS) {
    const ref = src[tag];
    if (!isRef(ref)) continue;                    // absent, or an inert legacy flag — not a bond
    if (idMap.has(ref)) clone[tag] = idMap.get(ref);
    else delete clone[tag];                       // outside the copy → drop, never dangle
  }
  if (hostLost && dropRoleTagsWhenHostLost) for (const tag of HOST_ROLE_TAGS) delete clone[tag];
  return clone;
}

/* Element ids are always STRINGS (`createIdMinter` → "e12abcdef"), so a non-string value on one of
 * these tags is not an element reference at all — a legacy record carries `forTrailer: true` as a
 * plain "this is a buffer" flag. Such a value points at nothing, so it cannot dangle and is left
 * exactly as it is; only a real id is remapped or dropped. */
const isRef = (v) => typeof v === "string" && v.length > 0;
