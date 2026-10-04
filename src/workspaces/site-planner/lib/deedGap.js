/* Deed misclosure — draw a metes-and-bounds description EXACTLY as written, and show the gap.
 *
 * The point of plotting a legal description is to catch errors in it. The plot used to drop the final
 * as-written endpoint whenever `pathCloses` (a screening tolerance of up to 50 ft on a big tract) said
 * the traverse "closed", so the polygon's implied last→first edge silently absorbed the error and a
 * description that misses by 31 ft drew as a clean closed shape. `pathCloses` stays the right test for
 * PROMOTABILITY and OCR culprit flagging; it is the wrong test for what to DRAW.
 *
 * `deedTrace(m)` is the ONE answer to "what does this deed's boundary look like as written":
 *   ring — the as-written vertices (the final endpoint is kept whenever it is not on the POB)
 *   path — the same points as an open polyline (what the stroke follows)
 *   gap  — null when the description closes to rounding noise, else the segment from the last
 *          course's end back to the POB, with its length and the precision ratio
 * It reads the stored `centerline` (every deed has carried the full as-written path), so deeds saved
 * before this change render the new way with no migration.
 */

/* Noise floor, ft. Distances are stated to 0.01 ft and bearings to the second; a 2,500-ft course turned
 * one second is 0.012 ft, so a surveyed closed tract of a dozen calls can honestly miss by a few hundredths.
 * 0.05 ft keeps that (a save-and-except hole missing by ~0.01 ft draws no gap) while any real error — the
 * smallest we have seen is a foot — draws its own line. */
export const DEED_GAP_NOISE_FT = 0.05;

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLen(path) {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += d(path[i - 1], path[i]);
  return s;
}

/* A deed's `centerline` and `pts` are moved together by every move / rotate / Align path. If some old save
 * left the centerline behind (its start no longer sits on the ring's start), re-seat it rigidly onto the ring
 * using the first course, which is the one part both copies always carry. */
function seatPathOnRing(path, pts) {
  if (!pts || pts.length < 2 || d(path[0], pts[0]) <= 1) return path;
  const a0 = Math.atan2(path[1].y - path[0].y, path[1].x - path[0].x);
  const a1 = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
  const r = a1 - a0, c = Math.cos(r), s = Math.sin(r);
  return path.map((p) => {
    const x = p.x - path[0].x, y = p.y - path[0].y;
    return { x: pts[0].x + x * c - y * s, y: pts[0].y + x * s + y * c };
  });
}

export function deedTrace(m) {
  const stored = m && Array.isArray(m.centerline) && m.centerline.length >= 4 ? m.centerline : null;
  if (!stored) {
    const ring = (m && m.pts) || [];
    return { ring, path: ring, gap: null, perimFt: pathLen(ring), seated: true };
  }
  const path = seatPathOnRing(stored, m.pts);
  const ft = d(path[0], path[path.length - 1]);
  if (ft <= DEED_GAP_NOISE_FT) {
    const ring = path.slice(0, -1);
    return { ring, path: [...ring, path[0]], gap: null, perimFt: pathLen(path), seated: path === stored };
  }
  const perimFt = pathLen(path);
  const last = path[path.length - 1];
  return {
    ring: path.slice(),
    path: path.slice(),
    gap: { from: last, to: path[0], ft, ratio: Math.round(perimFt / ft) },
    perimFt,
    seated: path === stored,
  };
}

/* Plain-words panel text. The wording for a noise-level closure is the only place "closes" is used. */
export function deedGapText(trace) {
  if (!trace || !trace.gap) return { closes: true, text: "This description closes." };
  const { ft, ratio } = trace.gap;
  const ftTxt = ft >= 10 ? ft.toFixed(1) : ft.toFixed(2);
  return {
    closes: false,
    text: `This description does not close — it misses by ${ftTxt} ft. The red dashed line is the gap.`,
    precision: `Precision 1:${ratio.toLocaleString("en-US")}`,
  };
}

/* ── One rule for every user-facing "does this description close" ───────────────────────────────────
 * The reader summary, the multi-file queue row, the plot toast and the Properties panel all answer from
 * `deedTrace(...).gap` (above) — the same answer the canvas draws as the red dashed line. `pathCloses`
 * (a 50 ft screening tolerance) is NOT used for wording: it once let "closes (misclosure 31.4′)" print
 * for a tract that misses by 31 ft. */
const fmtFt = (ft) => (ft >= 10 ? ft.toFixed(1) : ft.toFixed(2));

/* Closure of a traverse `path` (as callsToPath returns it): { closes, gapFt, ratio }. */
export function deedClosure(path) {
  const t = deedTrace({ centerline: path, pts: path });
  return t.gap ? { closes: false, gapFt: t.gap.ft, ratio: t.gap.ratio } : { closes: true, gapFt: 0, ratio: null };
}

/* "misses by 31.40 ft (1:1,450)" — the shared phrase. */
export function deedMissPhrase(cl) {
  return `misses by ${fmtFt(cl.gapFt)} ft${cl.ratio ? ` (1:${cl.ratio.toLocaleString("en-US")})` : ""}`;
}

/* Reader summary line + whether it should read in the danger colour. */
export function deedReaderSummary(callCount, cl, exCount = 0) {
  const head = `${callCount} call${callCount > 1 ? "s" : ""} parsed · `;
  const tail = exCount ? ` · +${exCount} save-and-except` : "";
  return { danger: !cl.closes, text: head + (cl.closes ? "closes" : `⚠ does NOT close — ${deedMissPhrase(cl)}`) + tail };
}

/* Queue-row suffix (after the call count). */
export function deedQueueClosure(cl) {
  return cl.closes ? "closes" : `⚠ does NOT close — ${deedMissPhrase(cl)}`;
}

/* Plot toast. `holes` = [{ name, gapFt }] for save-and-except tracts that miss above the floor.
 * Returns "" when nothing misses (the caller then keeps the plain "Boundary placed." toast). */
export function deedPlotWarning(cl, holes = []) {
  const parts = [];
  if (!cl.closes) parts.push(`⚠ This description does not close — it ${deedMissPhrase(cl)}. The red dashed line is the gap; check the calls before relying on this boundary.`);
  for (const h of holes) parts.push(`⚠ ${h.name} (save-and-except) does not close — it misses by ${fmtFt(h.gapFt)} ft.`);
  return parts.join(" ");
}
