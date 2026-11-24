/* Metes-and-bounds COURSES — pure helpers behind the deed Properties panel (NEW-1, 2026-11-24).
 *
 * A plotted deed (a markup of kind "encumbrance") keeps its calls as written (`calls[i] = { label, az, distFt,
 * bearing, deg, curve, curveMeta }`, az = compass degrees clockwise from the survey's north) AND its traced
 * geometry (`centerline` = the as-written path, `pts` = the ring). Moving the deed shifts both; "Align to county
 * parcel" / Rotate turns both rigidly and records the turn in `rotApplied` (main tract only; its save-and-except
 * holes turn with it without a record). So the stored az is the survey's bearing and the drawn heading is
 * az + a rotation offset that is NOT reliably stored.
 *
 * Editing one course therefore re-traces the whole path from its first point, holding the CURRENT drawn offset
 * (read back from the first course while the calls and the drawing still agree), so a typed bearing means what the
 * deed says and the shape keeps the turn it already wears. The module is dependency-free on purpose: `deedParse.js`
 * is a lazy chunk (deedLazy.js), so the dead-reckoning (`callsToPath`) and the closing test (`pathCloses`) are
 * handed in by the caller, who awaits `loadDeed()` in its handler.
 *
 * Label text for one course is "BEARING␣␣DISTANCE" (deedParse.mkCall). `courseParts` splits it back; a course whose
 * label does not follow that shape is re-derived from its az / distFt, so a hand-built call still reads.
 */
import { deedTrace } from "./deedGap.js";
import { polyArea } from "./siteGeometry.js";

const norm360 = (a) => ((a % 360) + 360) % 360;
const normSigned = (a) => { const n = norm360(a); return n > 180 ? n - 360 : n; };

/* Same text as deedParse's private fmtDist: 150′ / 150.5′ / 150.25′. */
export const fmtCourseDist = (ft) => `${Number(ft).toFixed(2).replace(/\.00$/, "")}′`;

/* ── bearings ────────────────────────────────────────────────────────────────────────────────────────────── */

/* Quadrant bearing text → { az, A, B, dd, mm, ss } or null. Accepts N 45°30'15" E · N45-30-15E · n 45 30 15 e ·
 * S 12.5 W · N 45° E. Degrees ≤ 90, minutes and seconds < 60 (a bogus "N 145 E" is refused, never guessed). */
const BEARING_TEXT = /^\s*([NS])\s*(\d{1,2}(?:\.\d+)?)(?:\s*(?:°|º|deg\.?|d|[-:]|\s)\s*(?:(\d{1,2})(?:\s*(?:'|’|′|min\.?|m|[-:]|\s)\s*(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|”|″|sec\.?|s)?)?)?)?)?\s*([EW])\s*$/i;

export function parseBearing(text) {
  const m = BEARING_TEXT.exec(String(text || ""));
  if (!m) return null;
  const A = m[1].toUpperCase(), B = m[5].toUpperCase();
  const dd = parseFloat(m[2]), mm = m[3] != null ? parseInt(m[3], 10) : 0, ss = m[4] != null ? parseFloat(m[4]) : 0;
  if (!(dd >= 0) || mm >= 60 || ss >= 60) return null;
  const deg = dd + mm / 60 + ss / 3600;
  if (deg > 90 + 1e-9) return null;
  let az;
  if (A === "N" && B === "E") az = deg;
  else if (A === "S" && B === "E") az = 180 - deg;
  else if (A === "S" && B === "W") az = 180 + deg;
  else az = 360 - deg;
  return { az: norm360(az), A, B, deg, dd, mm, ss };
}

/* Compass azimuth → the deed's own quadrant text, to the nearest second ("N 45° 30' 15\" E"). */
export function bearingText(az) {
  const a = norm360(az);
  let A, B, deg;
  if (a <= 90) { A = "N"; B = "E"; deg = a; }
  else if (a <= 180) { A = "S"; B = "E"; deg = 180 - a; }
  else if (a <= 270) { A = "S"; B = "W"; deg = a - 180; }
  else { A = "N"; B = "W"; deg = 360 - a; }
  let total = Math.round(deg * 3600);
  const dd = Math.floor(total / 3600); total -= dd * 3600;
  const mm = Math.floor(total / 60), ss = total - mm * 60;
  return `${A} ${dd}°${mm || ss ? ` ${mm}'` : ""}${ss ? ` ${ss}"` : ""} ${B}`;
}

/* The two halves of one course's label. */
export function courseParts(call) {
  const label = String((call && call.label) || "");
  const m = /^(.*\S)\s{2,}(\S.*)$/.exec(label);
  if (m) return { bearing: m[1], dist: m[2] };
  if (call && Number.isFinite(call.az) && Number.isFinite(call.distFt)) return { bearing: bearingText(call.az), dist: fmtCourseDist(call.distFt) };
  return { bearing: label, dist: "" };
}

/* What the map draws for one course: both halves unless that course hides one. "" = draw nothing. */
export function courseLabelText(call) {
  const p = courseParts(call);
  const parts = [];
  if (!(call && call.hideBearing) && p.bearing) parts.push(p.bearing);
  if (!(call && call.hideDist) && p.dist) parts.push(p.dist);
  return parts.join("  ");
}

/* A course the panel can retype: a straight call. A curve's bearing / length come from its arc data, which this
 * panel does not edit (the row says so). */
export const courseEditable = (call) => !!call && !call.curve && Number.isFinite(call.az) && Number.isFinite(call.distFt);

/* A fresh call from a typed bearing + distance, in the deed parser's own shape (label, compact bearing). */
function rebuiltCall(old, az, distFt, parsed) {
  const next = { ...old, az, distFt };
  const text = parsed ? bearingText(az) : bearingText(az);
  next.label = `${text}  ${fmtCourseDist(distFt)}`;
  next.bearing = `${text.replace(/\s+/g, "")}`;
  next.deg = parsed ? parsed.deg : old.deg;
  next.raw = old.raw;
  return next;
}

/* ── re-tracing ──────────────────────────────────────────────────────────────────────────────────────────── */

/* The turn the drawing wears relative to the survey's bearings, read from the first straight course. 0 when it
 * cannot be read (a deed that opens on a curve keeps whatever is stored). */
export function drawnOffsetDeg(m) {
  const c = m && m.centerline, calls = m && m.calls;
  if (!c || c.length < 2 || !calls || !calls.length) return 0;
  const first = calls[0];
  if (!courseEditable(first) || !(first.distFt > 0)) return 0;
  const drawn = (Math.atan2(c[1].x - c[0].x, -(c[1].y - c[0].y)) * 180) / Math.PI;
  return normSigned(drawn - first.az);
}

/* Replace call `index` (patch: { bearingText?, distFt? }) and re-trace. Returns { ok:true, calls, centerline, pts, closed }
 * or { ok:false, reason } in plain words — a refused edit changes nothing. `deed` is the loaded deedParse module. */
export function retraceWithEdit(m, index, patch, deed) {
  const calls = (m && m.calls) || [];
  const old = calls[index];
  if (!old) return { ok: false, reason: "That course is no longer on the deed." };
  if (!courseEditable(old)) return { ok: false, reason: "A curved course keeps its arc as read from the deed." };
  let az = old.az, distFt = old.distFt, parsed = null;
  if (patch.bearingText != null) {
    parsed = parseBearing(patch.bearingText);
    if (!parsed) return { ok: false, reason: "Type a bearing like N 45°30'15\" E (north or south, up to 90°, then east or west)." };
    az = parsed.az;
  }
  if (patch.distFt != null) {
    distFt = Number(patch.distFt);
    if (!(distFt > 0) || !Number.isFinite(distFt)) return { ok: false, reason: "A course needs a distance above zero." };
  }
  if (az === old.az && distFt === old.distFt) return { ok: false, reason: "", unchanged: true };
  const nextCalls = calls.map((c, i) => (i === index ? rebuiltCall(c, az, distFt, parsed) : c));
  return retrace(m, nextCalls, deed);
}

/* Re-trace `nextCalls` from the deed's first point, holding the turn it wears now. */
export function retrace(m, nextCalls, deed) {
  const start = m.centerline && m.centerline[0];
  if (!start) return { ok: false, reason: "This deed has no traced path to edit." };
  const off = drawnOffsetDeg(m);
  const turned = nextCalls.map((c) => (Number.isFinite(c.az) ? { ...c, az: norm360(c.az + off) } : c));
  const path = deed.callsToPath(turned, { x: start.x, y: start.y });
  const ring = deedTrace({ centerline: path, pts: path }).ring;
  if (ring.length < 3) return { ok: false, reason: "That edit leaves no closed shape to draw." };
  return { ok: true, calls: nextCalls, centerline: path, pts: ring, closed: deed.pathCloses(path) };
}

/* ── closure read-out ────────────────────────────────────────────────────────────────────────────────────── */

/* Perimeter (ft, along the courses as written), area (sq ft, the as-written ring) and the misclosure the panel prints. */
export function deedClosureFacts(m) {
  const t = deedTrace(m);
  return { perimFt: t.perimFt, areaSf: Math.abs(polyArea(t.ring)), gap: t.gap, trace: t };
}

/* ── label placement (shared by the canvas and the panel's defaults) ─────────────────────────────────────── */

export const COURSE_LABEL_SIZE_DEFAULT = 9;     // pt, what the courses always drew at
export const COURSE_PLACES = ["above", "on", "below"];

export const courseLabelPlaceOf = (m) => (COURSE_PLACES.includes(m && m.courseLabelPlace) ? m.courseLabelPlace : "above");
export const nameAtOf = (m) => (m && (m.nameAt === "top" || m.nameAt === "bottom") ? m.nameAt : "center");
export const nameShown = (m) => !(m && m.showName === false);

/* Where one course's label sits, in the SCREEN frame the canvas draws in: the midpoint of the course a→b, a turn that
 * keeps the text upright, and a baseline offset for above / on / below. `k` is the canvas's label scale. */
export function courseLabelLayout(m, call, a, b, k) {
  const text = courseLabelText(call);
  if (!text) return null;
  let angle = 0;
  if (m.courseLabelAlong === true) {
    angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180; else if (angle < -90) angle += 180;
  }
  const place = courseLabelPlaceOf(m), base = COURSE_LABEL_SIZE_DEFAULT * k;   // offsets are in the label's own (pre-scale) units
  const dy = place === "above" ? -3 * k : place === "below" ? base * 0.95 + 1 * k : base * 0.35;
  return { text, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle, dy, scale: (m.courseLabelSize ?? COURSE_LABEL_SIZE_DEFAULT) / COURSE_LABEL_SIZE_DEFAULT };
}

/* Where the tract's name sits: `ctr` (the shape's centroid, in feet) by default, or nudged up / down by a third of its height. */
export function nameAnchor(m, ring, ctr) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of ring) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const at = nameAtOf(m), h = isFinite(maxY - minY) ? maxY - minY : 0;
  return { x: ctr.x, y: at === "top" ? ctr.y - h / 3 : at === "bottom" ? ctr.y + h / 3 : ctr.y };
}
