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
 */
export const HOST_ROLE_TAGS = ["truckCourt", "forCourt", "forTrailer", "dogEar", "oppSide", "sideParkSide", "sidewalkSide", "stackSide", "noFit", "noLabel", "prevZone"];

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
