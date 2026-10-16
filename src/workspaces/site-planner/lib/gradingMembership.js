/* Who belongs to a building (grading layer, owner-only) — the two tiny pure rules both the always-loaded
 * glue (gradingBase.js) and the on-demand helpers (buildingGrade.js) need. Kept apart so the glue that
 * rides the Site route stays a few hundred bytes. Pure, no imports. */

/* The building an element is attached to, climbing `attachedTo` through intermediate layers (a trailer row
 * bonds to its court, a buffer to a strip…). Returns the building id or null. */
export function hostBuildingIdOf(el, byId, maxHops = 5) {
  let cur = el, hops = 0;
  while (cur && hops++ < maxHops) {
    if (cur.type === "building") return cur.id;
    cur = cur.attachedTo != null ? byId.get(cur.attachedTo) : null;
  }
  return null;
}

/* The building's assembly: the building plus every prepared element hosted by it. */
export function assemblyIds(els, buildingId) {
  const ids = new Set([buildingId]);
  for (const e of els) if (e.hostId === buildingId) ids.add(e.id);
  return ids;
}
