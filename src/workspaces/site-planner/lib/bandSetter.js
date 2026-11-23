/* AUDIT BATCH G1 — the ONE cross-band move for a drawn annotation (markup / callout / measurement): "Send behind the plan" /
 * "Bring above the plan". It used to exist three times in SitePlanner.jsx (setMarkupBand, setCalloutBand, setMeasureBand);
 * they differed only in whether a deed GROUP travels together. The moved item(s) are re-stacked on top of the band they arrive
 * in so they are never dropped underneath whatever was already there. Pure: returns the SAME array when the id is absent. */
export function bandSetter(list, id, behind, { nextZ, sortByZ, zGap, groupKey = null }) {
  const target = list.find((x) => x.id === id);
  if (!target) return list;
  const grp = groupKey ? target[groupKey] : null;
  const moving = (x) => x.id === id || (grp && x[groupKey] === grp);
  let z = nextZ(list.filter((x) => !moving(x) && (x.behindEls === true) === !!behind));
  const zs = new Map();
  for (const x of sortByZ(list.filter(moving))) { zs.set(x.id, z); z += zGap; }
  return list.map((x) => (moving(x) ? { ...x, behindEls: behind ? true : undefined, z: zs.get(x.id) ?? x.z } : x));
}
