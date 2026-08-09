/* ROTATING A WHOLE PLAN — the placement adjustment that DOES move geometry.
 *
 * Split out of `sitePlacement.js` and reached only by a dynamic `import()`, because the two surfaces
 * that use it are themselves lazy: the Placement controls in the Parcel panel, and the Set-location
 * dialog. The planner's boot path needs the ANCHOR half (validate an origin, nudge it, and rotate a
 * single point for the deed alignment) and none of this. Same tier rule as `parcelArea.js` and
 * `sheetFurniture.js` → `sheetFurnitureLayout.js`: a module reachable from BOTH the boot path and a
 * lazy chunk is hoisted whole into their common ancestor — tree-shaking drops unused exports, never
 * exports used by a sibling chunk — so splitting by TIER is the only thing that actually keeps these
 * bytes off the Site route's largest chunk. Do not "tidy" it back into one file.
 *
 * WHY ROTATION MOVES GEOMETRY AT ALL: the planner's feet frame is axis-aligned to TRUE NORTH by
 * construction (`mapLock.feetToLatLngPair` — −y is north), so there is no frame-rotation term to
 * turn. "Rotate the plan onto the aerial" therefore means rotating every drawn coordinate about a
 * pivot — exactly what `alignDeedToParcel` already does for a deed group, generalized to the plan.
 *
 * Pure. Unit-tested in test/sitePlacement.test.js.
 */
import { rotPt } from "./sitePlacement.js";

const isPt = (p) => p && typeof p === "object" && Number.isFinite(p.x) && Number.isFinite(p.y);

/* Rotate a free VECTOR (an offset, not a position): direction turns, no translation. */
const rotVec = (v, deg) => (isPt(v) ? rotPt(v, deg, { x: 0, y: 0 }) : v);

/* Every key that holds plan-feet geometry, by shape. Deliberately an explicit list rather than a
 * deep walk: a blind walk would find `labelOffset` (a free vector) or a county `attrs` record and
 * rotate them as if they were positions. Adding a new geometry-bearing field means adding it
 * here — which is the point. */
const PT_ARRAY_KEYS = ["points", "pts", "centerline", "tips"];
const PT_KEYS = ["tip", "box", "a", "b"];
const VEC_KEYS = ["labelOffset", "chipOffset"];
const ANGLE_KEYS = ["rot", "rotation"];

/* Rotate one entry (element / markup / measure / callout / parcel / sheet overlay). Fields not
 * listed above ride through untouched, so ids, styles, attrs and bonded links are preserved. */
export function rotateEntry(entry, deg, pivot) {
  if (!entry || typeof entry !== "object") return entry;
  const out = { ...entry };
  for (const k of PT_ARRAY_KEYS)
    if (Array.isArray(entry[k])) out[k] = entry[k].map((p) => (isPt(p) ? rotPt(p, deg, pivot) : p));
  for (const k of PT_KEYS) if (isPt(entry[k])) out[k] = rotPt(entry[k], deg, pivot);
  for (const k of VEC_KEYS) if (isPt(entry[k])) out[k] = rotVec(entry[k], deg);
  if (isPt(entry)) { const r = rotPt(entry, deg, pivot); out.x = r.x; out.y = r.y; }
  if (Number.isFinite(entry.cx) && Number.isFinite(entry.cy)) {
    const r = rotPt({ x: entry.cx, y: entry.cy }, deg, pivot);
    out.cx = r.x; out.cy = r.y;
  }
  for (const k of ANGLE_KEYS) if (Number.isFinite(entry[k])) out[k] = entry[k] + (Number(deg) || 0);
  // Pinned dock walls (footprintEdit) are {a,b} segment pairs in the same feet frame.
  if (Array.isArray(entry.dockLines))
    out.dockLines = entry.dockLines.map((l) => (l && typeof l === "object"
      ? { ...l, ...(isPt(l.a) ? { a: rotPt(l.a, deg, pivot) } : {}), ...(isPt(l.b) ? { b: rotPt(l.b, deg, pivot) } : {}) }
      : l));
  return out;
}

/* The collections a rotation touches. `underlay` is deliberately absent from the ROTATED set —
 * see rotateSiteCollections. */
export const ROTATED_FIELDS = ["parcels", "els", "measures", "callouts", "markups", "sheetOverlays"];

/* Vertex centroid of the plan's BODY: the active parcel rings when there are any (the boundary
 * is what the owner is lining up against the aerial), else every drawn point. Null when there is
 * nothing drawn — a rotation then has nothing to turn. */
export function siteRotationPivot(collections) {
  const c = collections || {};
  const acc = { sx: 0, sy: 0, n: 0 };
  const add = (p) => { if (isPt(p)) { acc.sx += p.x; acc.sy += p.y; acc.n++; } };
  const parcels = (c.parcels || []).filter((p) => p && p.active !== false && Array.isArray(p.points) && p.points.length >= 3);
  if (parcels.length) {
    for (const p of parcels) for (const pt of p.points) add(pt);
  } else {
    for (const f of ROTATED_FIELDS)
      for (const e of c[f] || []) {
        if (!e || typeof e !== "object") continue;
        for (const k of PT_ARRAY_KEYS) if (Array.isArray(e[k])) for (const pt of e[k]) add(pt);
        for (const k of PT_KEYS) add(e[k]);
        if (Number.isFinite(e.cx) && Number.isFinite(e.cy)) add({ x: e.cx, y: e.cy });
      }
  }
  return acc.n ? { x: acc.sx / acc.n, y: acc.sy / acc.n } : null;
}

/* Rotate the whole plan about `pivot` (default: the body centroid).
 *
 * Returns { next, pivot, unrotatable }. `unrotatable` names the things a rotation CANNOT honestly
 * turn, so the caller can say so out loud (LOUD-FAILURE) instead of silently leaving them askew:
 * the aerial `underlay` is a north-up raster captured for the old anchor and has no rotation term,
 * so it is left exactly where it was rather than being moved under a plan it no longer matches.
 * A no-op rotation (0°, or nothing drawn) returns the SAME object references. */
export function rotateSiteCollections(collections, deg, pivot) {
  const c = collections || {};
  const d = Number(deg) || 0;
  const piv = isPt(pivot) ? pivot : siteRotationPivot(c);
  if (!piv || Math.abs(d) < 1e-9) return { next: c, pivot: piv, unrotatable: [] };
  const next = { ...c };
  for (const f of ROTATED_FIELDS)
    if (Array.isArray(c[f])) next[f] = c[f].map((e) => rotateEntry(e, d, piv));
  const unrotatable = c.underlay ? ["underlay"] : [];
  return { next, pivot: piv, unrotatable };
}

/* Fold an angle to (-180, 180] so a placement readout never says "357° off north". */
export const normalizeRot = (deg) => {
  const d = ((Number(deg) || 0) % 360 + 360) % 360;
  return d > 180 ? d - 360 : d;
};

