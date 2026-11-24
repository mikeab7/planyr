/* B2671331 — where a road's "N′ R.O.W." label sits.
 *
 * It rides the road's own centerline, turned to run WITH the road (the chord of the road under the text, so on a curve it
 * follows the bend) and kept upright (never upside down, like every other inline label: easementLabelPlacement.uprightDeg).
 * It is shifted along the road off the centre station, where the red width callout sits, so the two never print on top of
 * each other. A road too short to hold the text (plus that clearance) on screen shows no ROW label (same rule as the
 * repeating inline labels: an instance whose own stretch cannot fit the text is hidden). Pure: screen px in, screen px out,
 * so the PDF clone (which re-renders this same code at sheet scale) prints exactly what the screen shows. */
import { uprightDeg } from "./easementLabelPlacement.js";

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function stationAt(pts, cum, d) {
  const total = cum[cum.length - 1];
  const s = Math.max(0, Math.min(total, d));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / seg;
  return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
}

/* ptsFeet: the road centerline (feet). f2p: feet → screen px. textPx: rendered text width (px). clearPx: how far the label
 * centre must stand from the centre station (the width callout). Returns { x, y, angle } in px / degrees, or null. */
export function roadRowLabelPlace(ptsFeet, f2p, textPx, clearPx) {
  if (!Array.isArray(ptsFeet) || ptsFeet.length < 2) return null;
  const pts = ptsFeet;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  if (!(total > 1e-3)) return null;
  const ppf = dist(f2p({ x: 0, y: 0 }), f2p({ x: 1, y: 0 })) || 1;
  const halfFt = textPx / 2 / ppf, shiftFt = clearPx / ppf;
  const cands = [total / 2 + shiftFt, total / 2 - shiftFt];
  const s = cands.find((c) => c - halfFt >= 0 && c + halfFt <= total);
  if (s == null) return null;
  const c = f2p(stationAt(pts, cum, s));
  const p0 = f2p(stationAt(pts, cum, s - halfFt)), p1 = f2p(stationAt(pts, cum, s + halfFt));
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const angle = Math.hypot(dx, dy) < 1e-6 ? 0 : uprightDeg(Math.atan2(dy, dx) * 180 / Math.PI);
  return { x: c.x, y: c.y, angle };
}
