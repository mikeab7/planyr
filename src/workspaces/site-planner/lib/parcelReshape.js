/* PARCEL CORNER EDIT — the ONE place a parcel's per-edge data follows a control point being inserted or deleted.
 *
 * `SitePlanner.jsx` `insertVtx` / `deleteVtx` call these for the `parcel` layer (the right-click "Add control point",
 * Shift-click on an edge, and Delete on an armed corner all land here), so a unit test drives the very code the corner tool runs.
 *
 * Every per-edge array on a parcel is indexed by EDGE (edge i = points[i] → points[i+1]) and must stay the ring's length, or the
 * readers treat it as absent: `pc.setbacks` / `pc.pavingSetbacks` fall back to the default / "not added", and the role vectors
 * are dropped on the next re-derive. INSERT on edge i: both halves are still the same side, so both keep that edge's value.
 * DELETE vertex i: edges i-1 and i merge and keep the first half's value. Stored VERTEX indices (section breaks / joins) shift instead.
 */
import { projectOntoSegment } from "./ringMath.js";
import { shiftOverridesOnInsert, shiftOverridesOnDelete } from "./setbackRoles.js";
import { shiftBreaksOnInsert, shiftBreaksOnDelete } from "./boundarySections.js";
import { hasPaving, shiftPavingOnInsert, shiftPavingOnDelete } from "./pavingSetback.js";

/* The building setback array follows the ring only while it IS the ring's length (the reader's own rule); a stale-length array is left alone rather than
 * shifted into a wrong alignment. Same numeric shift the paving array uses. */
const setbacksFollowing = (pc, shift) => (Array.isArray(pc.setbacks) && pc.setbacks.length === pc.points.length ? { setbacks: shift(pc.setbacks) } : {});

/** The parcel with a control point added on edge `edgeIndex` at `np` (re-projected onto the real edge so it can never kink it). */
export function parcelAfterInsert(pc, edgeIndex, np) {
  const arr = pc.points, n = arr.length, p0 = arr[edgeIndex], p1 = arr[(edgeIndex + 1) % n];
  const points = [...arr];
  points.splice(edgeIndex + 1, 0, p0 && p1 ? projectOntoSegment(p0, p1, np) : np);
  return {
    ...pc, points,
    ...setbacksFollowing(pc, (v) => shiftPavingOnInsert(v, edgeIndex)),
    roleOverrides: shiftOverridesOnInsert(pc.roleOverrides, edgeIndex), roles: shiftOverridesOnInsert(pc.roles, edgeIndex),
    ...(pc.sectionBreaks || pc.sectionJoins ? { sectionBreaks: shiftBreaksOnInsert(pc.sectionBreaks || [], edgeIndex), sectionJoins: shiftBreaksOnInsert(pc.sectionJoins || [], edgeIndex) } : {}),
    ...(hasPaving(pc) ? { pavingSetbacks: shiftPavingOnInsert(pc.pavingSetbacks, edgeIndex) } : {}),
  };
}

/** The parcel with control point `index` removed (the caller has already checked the ring stays at least a triangle). */
export function parcelAfterDelete(pc, index) {
  return {
    ...pc, points: pc.points.filter((_, j) => j !== index),
    ...setbacksFollowing(pc, (v) => shiftPavingOnDelete(v, index)),
    roleOverrides: shiftOverridesOnDelete(pc.roleOverrides, index), roles: shiftOverridesOnDelete(pc.roles, index),
    ...(pc.sectionBreaks || pc.sectionJoins ? { sectionBreaks: shiftBreaksOnDelete(pc.sectionBreaks || [], index), sectionJoins: shiftBreaksOnDelete(pc.sectionJoins || [], index) } : {}),
    ...(hasPaving(pc) ? { pavingSetbacks: shiftPavingOnDelete(pc.pavingSetbacks, index) } : {}),
  };
}
