/* Who belongs to a building (grading layer, owner-only) — the two tiny pure rules both the always-loaded
 * glue (gradingBase.js) and the on-demand helpers (buildingGrade.js) need. Kept apart so the glue that
 * rides the Site route stays a few hundred bytes. Pure, no imports. */

/* The building an element is attached to, climbing `attachedTo` through intermediate layers (a trailer row
 * bonds to its court, a buffer to a strip…). Returns the building id or null. */
export function hostBuildingIdOf(el, byId, maxHops = 5) {
  let cur = el, hops = 0, root = null;
  while (cur && hops++ < maxHops) {
    // A building attached to another building (a corner bump-out) is a pad member of it, so keep climbing to the
    // outermost building; the climb stops at the first building with no attachment that resolves.
    if (cur.type === "building") root = cur.id;
    cur = cur.attachedTo != null ? byId.get(cur.attachedTo) : null;
  }
  return root;
}

/* A bump-out (`dogEar`, or any building element attached to another building) is a pad member of its host and
 * never a graded building of its own. An orphan (host gone) stays a building so it cannot vanish from grading. */
export function isPadMember(el, byId) {
  if (!el || el.type !== "building") return false;
  const h = hostBuildingIdOf(el, byId);
  return h != null && h !== el.id;
}

/* The building's assembly: the building plus every prepared element hosted by it. */
export function assemblyIds(els, buildingId) {
  const ids = new Set([buildingId]);
  for (const e of els) if (e.hostId === buildingId) ids.add(e.id);
  return ids;
}
