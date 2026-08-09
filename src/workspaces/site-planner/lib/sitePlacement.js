/* Site placement — putting an UNLOCATED plan on the earth, and adjusting where it sits.
 *
 * (NEW-1, the "GIS is down" tranche.) A plan started with "Start blank" has no `origin`, and
 * until this module shipped nothing anywhere could set one: `origin` was read straight off the
 * restored record. With no origin the planner turns the basemap off and every geo effect
 * early-returns, so a boundary drawn while the county service was down was stranded in blank
 * space forever — no aerial, no FEMA flood, no contours, no county, and therefore no
 * jurisdiction, setbacks or drainage rules.
 *
 * The model this file encodes:
 *   • The drawing lives in LOCAL FEET (+x east, +y south) and never moves when a location
 *     lands. The origin decides WHERE that local frame sits on the earth — nothing else.
 *   • NUDGING the anchor moves the whole drawing across the ground without touching a single
 *     drawn coordinate: `originAtOffset` re-anchors the frame instead (`nudgeOrigin` is the
 *     same operation phrased as "move the drawing", which is how the UI says it).
 *   • ROTATING is the one adjustment that must touch geometry, because the feet frame is
 *     axis-aligned to TRUE NORTH by construction (mapLock.feetToLatLngPair: −y is north). There
 *     is no frame-rotation term to turn, so "rotate the plan onto the aerial" means rotating
 *     every drawn coordinate about a pivot — exactly what `alignDeedToParcel` already does for a
 *     deed group, generalized here to the whole plan.
 *
 * Kept pure (no DOM, no React, no network) so the whole placement contract is unit-testable:
 * see test/sitePlacement.test.js.
 */
import { feetToLatLngPair } from "./mapLock.js";

// ── origin validity ──────────────────────────────────────────────────────────────────

/* A usable geo anchor: finite, on the earth, and inside Web Mercator's world. Returns a fresh
 * {lat, lon} or null — never a partially-valid object, so a caller can't half-locate a plan. */
export function normalizeOrigin(o) {
  if (!o || typeof o !== "object") return null;
  const lat = Number(o.lat), lon = Number(o.lon != null ? o.lon : o.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 85.05112878 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export const sameOrigin = (a, b) => {
  const x = normalizeOrigin(a), y = normalizeOrigin(b);
  if (!x || !y) return x === y;
  return Math.abs(x.lat - y.lat) < 1e-12 && Math.abs(x.lon - y.lon) < 1e-12;
};

/* Accept a typed coordinate pair the way a developer actually writes one:
 *   "29.7604, -95.3698"  ·  "29.7604 -95.3698"  ·  "29.7604N 95.3698W"
 *   "29 45 37.4 N, 95 22 11.3 W"  ·  "29°45'37.4\"N 95°22'11.3\"W"
 * Longitude-first is NOT guessed — a lone pair is read lat-then-lon (the universal convention);
 * a hemisphere letter, when present, decides the sign and the axis, so "W95.37 N29.76" works.
 * Returns {lat, lon} or null. */
export function parseLatLon(text) {
  const raw = String(text == null ? "" : text).trim();
  if (!raw) return null;
  // Tokenize into hemisphere-tagged numeric groups. Degrees/minutes/seconds symbols and commas
  // are separators; a trailing/leading N/S/E/W tags the group it touches.
  const cleaned = raw.replace(/[°º]/g, " ").replace(/['′]/g, " ").replace(/["″]/g, " ").replace(/,/g, " ");
  const re = /([NSEW])?\s*(-?\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?(?:\s+(\d+(?:\.\d+)?))?\s*([NSEW])?/gi;
  const groups = [];
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    if (!m[2]) continue;
    const hemi = (m[1] || m[5] || "").toUpperCase();
    const d = Number(m[2]), mi = m[3] != null ? Number(m[3]) : 0, s = m[4] != null ? Number(m[4]) : 0;
    if (!Number.isFinite(d) || !Number.isFinite(mi) || !Number.isFinite(s)) continue;
    let v = Math.abs(d) + mi / 60 + s / 3600;
    if (d < 0) v = -v;
    if (hemi === "S" || hemi === "W") v = -Math.abs(v);
    if (hemi === "N" || hemi === "E") v = Math.abs(v);
    groups.push({ v, axis: hemi === "N" || hemi === "S" ? "lat" : hemi === "E" || hemi === "W" ? "lon" : null });
    if (groups.length >= 4) break;
  }
  if (groups.length < 2) return null;
  const tagged = groups.filter((g) => g.axis);
  let lat = null, lon = null;
  if (tagged.length >= 2) {
    lat = (tagged.find((g) => g.axis === "lat") || {}).v;
    lon = (tagged.find((g) => g.axis === "lon") || {}).v;
  } else {
    lat = groups[0].v; lon = groups[1].v;
    // One tagged group still decides its own axis (e.g. "95.3698W 29.7604").
    if (tagged.length === 1) {
      const other = groups.find((g) => g !== tagged[0]);
      if (tagged[0].axis === "lon") { lon = tagged[0].v; lat = other ? other.v : null; }
      else { lat = tagged[0].v; lon = other ? other.v : null; }
    }
  }
  return normalizeOrigin({ lat, lon });
}

// ── nudging the anchor (no drawn coordinate is touched) ──────────────────────────────

/* The origin that sits `dxFt` EAST and `dyFt` SOUTH of `origin` in the plan's own feet frame.
 * Re-anchoring the frame there slides the entire drawing that far across the ground, because
 * every drawn point is expressed relative to the origin. */
export function originAtOffset(origin, dxFt, dyFt) {
  const o = normalizeOrigin(origin);
  if (!o) return null;
  const dx = Number(dxFt) || 0, dy = Number(dyFt) || 0;
  // Exact identity for a zero nudge. The Mercator round-trip is float-noisy at ~1e-9° (about a
  // thousandth of a foot), which is nothing on the ground but WOULD make "commit with no change"
  // dirty the record and mint a save — so the no-op is short-circuited rather than computed.
  if (dx === 0 && dy === 0) return o;
  const [lat, lon] = feetToLatLngPair({ x: dx, y: dy }, o.lat, o.lon);
  return normalizeOrigin({ lat, lon });
}

/* "Move the drawing `dxFt` east / `dyFt` south" — the same operation as originAtOffset, named
 * the way the UI talks about it. Nudging the plan EAST moves the anchor east too. */
export const nudgeOrigin = originAtOffset;

// ── rotating the plan ────────────────────────────────────────────────────────────────

const isPt = (p) => p && typeof p === "object" && Number.isFinite(p.x) && Number.isFinite(p.y);

/* Rotate a point about a pivot. Positive `deg` turns CLOCKWISE on screen, which — in a frame
 * whose +y points SOUTH — is the same sense as a compass bearing and as deedAlign's rotation. */
export function rotPt(p, deg, pivot) {
  const t = (Number(deg) || 0) * Math.PI / 180;
  const c = Math.cos(t), s = Math.sin(t);
  const px = (pivot && pivot.x) || 0, py = (pivot && pivot.y) || 0;
  const dx = p.x - px, dy = p.y - py;
  return { ...p, x: px + dx * c - dy * s, y: py + dx * s + dy * c };
}

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
