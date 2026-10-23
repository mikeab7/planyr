/* slideCrop — put one big frame reading under the microscope (NEW-1, V1882768 / B2426464 ×4).
 *
 * measure-parcel-zoom-slide reports, per frame, how far the outline sits from the red band painted into the imagery at ONE scan line.
 * A reading over the limit has two possible causes that the number alone cannot tell apart:
 *   · OUTLINE OFF ITS IMAGERY — the band is one straight band along its whole length and the outline runs beside it (the bug);
 *   · IMAGERY VS IMAGERY — the band itself jumps along its length (two basemap levels, or two tiles of the stretched previous level,
 *     disagreeing on screen) and the straight outline is on the band everywhere except where the scan line happened to cross the odd piece.
 * This module walks the band through the crossing, both ways along its length, and reads at every step the band's centre and the outline's
 * centre. It returns that profile, a verdict, and a magnified crop PNG of the spot so a person can check the verdict by eye.
 *
 * Pure apart from the PNG encode. Unit-tested in test/slideCrop.test.js. */
import { classify } from "./lineLockScan.mjs";
import { encodeRgbPng } from "./fakeTile.mjs";

/** Profile the band and outline through `at` = { x, y, horizontal } (device px; `horizontal` = the scan line was a ROW, so the band runs
 *  vertically there). `k` = device px per CSS px. Every distance returned is CSS px. */
export function profileCrossing(img, at, { k = 1, halfLen = 36, halfWidth = 18 } = {}) {
  const { width, height, channels, data } = img;
  const px = (x, y) => { const o = (y * width + x) * channels; return [data[o], data[o + 1], data[o + 2]]; };
  const L = Math.round(halfLen * k), Wd = Math.round(halfWidth * k);
  const centre = at.horizontal ? Math.round(at.x) : Math.round(at.y);
  const rows = [];
  for (let d = -L; d <= L; d++) {
    const line = (at.horizontal ? Math.round(at.y) : Math.round(at.x)) + d;
    if (line < 0 || line >= (at.horizontal ? height : width)) continue;
    const red = [], ink = [], w = [];
    let foreign = false;
    for (let i = centre - Wd; i <= centre + Wd; i++) {
      if (i < 0 || i >= (at.horizontal ? width : height)) continue;
      const [r, g, b] = at.horizontal ? px(i, line) : px(line, i);
      const c = classify(r, g, b);
      if (c === "red") red.push(i); else if (c === "ink") { ink.push(i); w.push(b); }
    }
    const all = red.concat(ink);
    // a step where another band runs ACROSS the window (a lot corner: the top band meets the side band) says nothing about the side band —
    // its blob reaches the window's edge
    if (all.length && (Math.min(...all) <= centre - Wd + 1 || Math.max(...all) >= centre + Wd - 1)) foreign = true;
    if (foreign || !red.length) { rows.push({ d: d / k, band: null, ink: null }); continue; }
    const lo = Math.min(...all), hi = Math.max(...all);
    const band = (lo + hi) / 2;
    let inkC = null;
    if (ink.length) { let sw = 0, sx = 0; for (let j = 0; j < ink.length; j++) { sw += w[j]; sx += w[j] * ink[j]; } inkC = sx / sw; }
    // two separate red pieces at one step = two copies of the band side by side (two imagery levels at once)
    const sorted = [...red].sort((a, b) => a - b);
    let pieces = 1; for (let j = 1; j < sorted.length; j++) if (sorted[j] - sorted[j - 1] > 2 * k + 1 && !ink.some((q) => q > sorted[j - 1] && q < sorted[j])) pieces++;
    rows.push({ d: d / k, band: (band - centre) / k, lo: (lo - centre) / k, hi: (hi - centre) / k, ink: inkC == null ? null : (inkC - centre) / k, pieces });
  }
  return rows;
}

/** The verdict from a profile. `limit` = the check's own threshold (CSS px). */
export function judgeCrossing(rows, { limit = 2 } = {}) {
  const both = rows.filter((r) => r.band != null && r.ink != null);
  if (both.length < 8) return { verdict: "unclear", why: `only ${both.length} steps carry both band and outline` };
  const offs = both.map((r) => r.ink - r.band);
  const inks = both.map((r) => r.ink), bands = both.map((r) => r.band);
  const spread = (a) => Math.max(...a) - Math.min(...a);
  const onBand = offs.filter((o) => Math.abs(o) <= limit).length / offs.length;
  const offBand = offs.filter((o) => Math.abs(o) > limit).length / offs.length;
  const doubled = both.filter((r) => r.pieces > 1).length;
  const edgeSpread = Math.max(spread(both.map((r) => r.lo)), spread(both.map((r) => r.hi)));
  // band with NO outline on it, narrower than the band the outline runs along and overlapping it: a piece of a second copy of the picture
  // (two imagery tiles of different levels meeting at a seam — the piece runs on past the corner where the outline's own band ends)
  const widths = both.map((r) => r.hi - r.lo).sort((a, b) => a - b), wMed = widths[Math.floor(widths.length / 2)];
  const loMed = both.map((r) => r.lo).sort((a, b) => a - b)[Math.floor(both.length / 2)], hiMed = both.map((r) => r.hi).sort((a, b) => a - b)[Math.floor(both.length / 2)];
  const strayPieces = rows.filter((r) => r.band != null && r.ink == null && r.hi - r.lo < 0.75 * wMed && r.hi >= loMed && r.lo <= hiMed).length;
  const stats = { steps: both.length, inkSpread: +spread(inks).toFixed(2), bandSpread: +spread(bands).toFixed(2), edgeSpread: +edgeSpread.toFixed(2), strayPieces, onBandShare: +onBand.toFixed(2), worstOffset: +Math.max(...offs.map(Math.abs)).toFixed(2), doubledSteps: doubled };
  // the outline is straight (it is one canvas); if the BAND wanders while the outline does not, and the outline is on the band along most of
  // its length, the odd reading is the imagery disagreeing with itself
  if (stats.bandSpread > limit && stats.inkSpread <= 1.5 && onBand >= 0.5) return { verdict: "imagery-vs-imagery", why: "the band jumps along its own length; the straight outline is on it along most of it", ...stats };
  // the band's EDGES step along its length while the outline is straight: two copies of the band overlapping, offset (two imagery levels
  // at once) — the blob is wider than one band where they overlap, and its edges jump where one copy ends
  if (edgeSpread > limit && stats.inkSpread <= 1.5) return { verdict: "imagery-vs-imagery", why: "the band's edges step along its length (two copies of the picture overlapping); the outline is straight", ...stats };
  if (strayPieces >= 2 && stats.inkSpread <= 1.5) return { verdict: "imagery-vs-imagery", why: "a narrower piece of band with no outline on it overlaps this band (a second copy of the picture at a tile seam); the outline is straight", ...stats };
  if (doubled >= 3 && onBand >= 0.3) return { verdict: "imagery-vs-imagery", why: "two copies of the band side by side (two imagery levels at once); the outline is on one", ...stats };
  if (offBand >= 0.7 && edgeSpread <= limit) return { verdict: "outline-off-imagery", why: "one straight band along the whole length and the outline beside it", ...stats };
  return { verdict: "unclear", why: "neither shape is clean — look at the crop", ...stats };
}

/** A magnified crop around `at` (device px), `half` CSS px each way, `zoom` × nearest-neighbour. A grey tick in the margin marks the scan line. */
export function cropPng(img, at, { k = 1, half = 40, zoom = 4 } = {}) {
  const { width, height, channels, data } = img;
  const H = Math.round(half * k), x0 = Math.round(at.x) - H, y0 = Math.round(at.y) - H, side = 2 * H + 1;
  const outW = side * zoom, outH = side * zoom;
  return encodeRgbPng(outW, outH, (row, col, p, raw) => {
    const sx = x0 + Math.floor(col / zoom), sy = y0 + Math.floor(row / zoom);
    let r = 40, g = 40, b = 40;
    if (sx >= 0 && sy >= 0 && sx < width && sy < height) { const o = (sy * width + sx) * channels; r = data[o]; g = data[o + 1]; b = data[o + 2]; }
    const tick = at.horizontal ? (sy === Math.round(at.y) && (col < 3 * zoom || col > outW - 3 * zoom)) : (sx === Math.round(at.x) && (row < 3 * zoom || row > outH - 3 * zoom));
    if (tick) { r = 0; g = 160; b = 0; }
    raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
  });
}
