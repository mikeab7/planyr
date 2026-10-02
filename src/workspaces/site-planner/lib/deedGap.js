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
