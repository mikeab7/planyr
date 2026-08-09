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

/* Rotate a point about a pivot. Positive `deg` turns CLOCKWISE on screen, which — in a frame
 * whose +y points SOUTH — is the same sense as a compass bearing and as deedAlign's rotation. */
export function rotPt(p, deg, pivot) {
  const t = (Number(deg) || 0) * Math.PI / 180;
  const c = Math.cos(t), s = Math.sin(t);
  const px = (pivot && pivot.x) || 0, py = (pivot && pivot.y) || 0;
  const dx = p.x - px, dy = p.y - py;
  return { ...p, x: px + dx * c - dy * s, y: py + dx * s + dy * c };
}
