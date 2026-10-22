/* lineLockScan — read, off ONE composited frame, how far the parcel outlines sit from the same lines painted INTO the imagery (NEW-1, B2426464 ×2).
 *
 * The first instrument for this bug (verify-parcel-zoom-lock) compared the parcel canvas against a Leaflet MARKER, read through
 * getBoundingClientRect on the main thread. That asks "do two Leaflet layers agree about where they are", which they always do on the main
 * thread — and never "does the picture on the glass show the outline on the imagery". This module answers the second question from pixels:
 * the harness serves basemap tiles whose only content is every lot's boundary as a RED band (lib: the tile generator in the harness), so a
 * locked outline sits in the middle of a red band on every frame, and an outline that slides sits beside it.
 *
 * Pure: an RGB(A) buffer in, numbers out. Unit-tested in test/lineLockScan.test.js. */

/** Pixel classes. Thresholds are wide on purpose: a band edge antialiased against white, or the 0.95-opacity outline over red, must still classify. */
export function classify(r, g, b) {
  if (r > 190 && g < 95 && b < 30) return "red";             // the imagery's lot band
  if (r > 90 && g < 130 && b >= 30 && b > g + 15) return "ink"; // the parcel outline (#a21caf) — over white, over red, or antialiased against red
  return null;
}

/** Runs along one scan line. `get(i)` returns [r,g,b]; `n` = length. A run is a maximal stretch of red-or-ink pixels;
 *  inside it we keep the red extent and the ink pixels separately. */
export function scanRuns(get, n) {
  const runs = [];
  let cur = null, gap = 0;
  for (let i = 0; i < n; i++) {
    const [r, g, b] = get(i);
    const c = classify(r, g, b);
    // ONE unclassifiable pixel inside a run (a darkened blend of band and outline) does not split it — a split band reads as two half-bands
    if (!c) { if (cur && !gap && i + 1 < n && classify(...get(i + 1))) { gap = 1; continue; } if (cur) { runs.push(cur); cur = null; } gap = 0; continue; }
    gap = 0;
    if (!cur) cur = { start: i, end: i, red: [], ink: [], w: [] };
    cur.end = i;
    if (c === "red") cur.red.push(i); else { cur.ink.push(i); cur.w.push(b); } // ink weighted by its blue: a half-covered pixel counts half
  }
  if (cur) runs.push(cur);
  return runs;
}

/** Turn runs into (outline, band) pairs and their signed offsets in pixels.
 *  · An ink stretch with red on BOTH sides inside one run: the band's centre is the red extent's midpoint — the outline is ON the band.
 *  · Ink with no red in its run: it is beside a band; pair it with the nearest red run within `maxPx` (a slide), else it is unpaired ink.
 *  · A red run with ink on ONE side only: the outline overlaps the band's edge — the band centre is then estimated from the run's red-only
 *    side plus the known band width `bandPx` (the full red run when nothing covers it).
 *  Returns { pairs: [{ at, offset }], unpairedInk, bands } — `bands` counts red runs (so "no imagery under the outline" is visible). */
export function pairOffsets(runs, { bandPx = 8, maxPx = 40 } = {}) {
  const pairs = [];
  let unpairedInk = 0;
  const redRuns = runs.filter((r) => r.red.length);
  const bandCentreOf = (run) => {
    const rmin = Math.min(...run.red), rmax = Math.max(...run.red);
    if (!run.ink.length) return (rmin + rmax) / 2;
    const imin = Math.min(...run.ink), imax = Math.max(...run.ink);
    if (rmin < imin && rmax > imax) return (rmin + rmax) / 2; // ink inside the band
    // ink covers one edge of the band — reconstruct the band from the uncovered edge
    if (rmin < imin) return rmin + bandPx / 2 - 0.5;
    return rmax - bandPx / 2 + 0.5;
  };
  for (const run of runs) {
    if (!run.ink.length) continue;
    if (run.end - run.start + 1 > 4 * bandPx) continue; // the scan line runs ALONG a band/outline, not across it
    let sw = 0, sx = 0; for (let k = 0; k < run.ink.length; k++) { sw += run.w[k]; sx += run.w[k] * run.ink[k]; }
    const ic = sx / sw;
    if (run.red.length) { pairs.push({ at: ic, offset: ic - bandCentreOf(run) }); continue; }
    // ink with no red under it — the outline is OFF the band: nearest band within maxPx
    let best = null;
    for (const rr of redRuns) {
      const c = bandCentreOf(rr);
      const d = ic - c;
      if (Math.abs(d) <= maxPx && (!best || Math.abs(d) < Math.abs(best))) best = d;
    }
    if (best == null) unpairedInk++; else pairs.push({ at: ic, offset: best });
  }
  return { pairs, unpairedInk, bands: redRuns.length };
}

/** A crossing's band must extend at least this many times the run's length along the perpendicular. */
export const ACROSS_FACTOR = 2;
/** Distance (px) to the parallel scan lines a crossing must repeat on. */
export const NEIGHBOUR = 3;

/** Read one frame. `img` = { width, height, channels, data }. Scans the rows and columns listed (device px). Returns the worst |offset|,
 *  the median, how many outline crossings were read, and how many outline pixels had no band within reach. */
export function readFrame(img, { rows = [], cols = [], bandPx = 8, maxPx = 40, xRange = [0, Infinity], yRange = [0, Infinity], debug = false } = {}) {
  const { width, height, channels, data } = img;
  const px = (x, y) => { const o = (y * width + x) * channels; return [data[o], data[o + 1], data[o + 2]]; };
  const all = [];
  let unpaired = 0, bands = 0, inkRuns = 0;
  const dbg = [];
  /* A run is a CROSSING only where the band runs across the scan line: the band then extends far along the perpendicular through the
   * run's middle (≥ ACROSS_FACTOR × the run's own length), and the same run repeats on the parallel lines NEIGHBOUR px either side.
   * A row grazing along a lot's top band, or passing a corner where the side band merges into the top band, fails one or the other
   * and is dropped — those readings say nothing about the offset and were the instrument's own false 4–5 px. */
  const inkish = (x, y) => { const [r, g, b] = px(x, y); return classify(r, g, b) != null; };
  const perpExtent = (fixed, mid, horizontal, cap) => {
    let n = 1;
    for (let d = 1; d <= cap; d++) { const x = horizontal ? mid : fixed, y = horizontal ? fixed : mid; const xx = horizontal ? x : x - d, yy = horizontal ? y - d : y; if (xx < 0 || yy < 0 || !inkish(xx, yy)) break; n++; }
    for (let d = 1; d <= cap; d++) { const x = horizontal ? mid : fixed, y = horizontal ? fixed : mid; const xx = horizontal ? x : x + d, yy = horizontal ? y + d : y; if (xx >= width || yy >= height || !inkish(xx, yy)) break; n++; }
    return n;
  };
  const crossing = (r, line, horizontal) => {
    const len = r.end - r.start + 1, mid = Math.round((r.start + r.end) / 2), cap = Math.ceil(ACROSS_FACTOR * len) + 1;
    return perpExtent(line, mid, horizontal, cap) >= ACROSS_FACTOR * len;
  };
  const steady = (runs, a, b) => runs.filter((r) => [a, b].every((o) => o.some((q) => Math.abs(q.start - r.start) <= 2 && Math.abs(q.end - r.end) <= 2)));
  const rowRuns = (y) => scanRuns((i) => px(i, y), width), colRuns = (x) => scanRuns((i) => px(x, i), height);
  const lines = [];
  for (const y of rows) if (y - NEIGHBOUR >= 0 && y + NEIGHBOUR < height) lines.push([steady(rowRuns(y), rowRuns(y - NEIGHBOUR), rowRuns(y + NEIGHBOUR)).filter((r) => crossing(r, y, true)), xRange, `row${y}`]);
  for (const x of cols) if (x - NEIGHBOUR >= 0 && x + NEIGHBOUR < width) lines.push([steady(colRuns(x), colRuns(x - NEIGHBOUR), colRuns(x + NEIGHBOUR)).filter((r) => crossing(r, x, false)), yRange, `col${x}`]);
  const take = (runs, [from, to], tag) => {
    const k = runs.filter((r) => r.start >= from && r.end <= to);
    if (debug) dbg.push({ tag, runs: k.map((r) => ({ s: r.start, e: r.end, red: r.red.length, ink: r.ink.length })) });
    inkRuns += k.filter((r) => r.ink.length).length;
    const p = pairOffsets(k, { bandPx, maxPx });
    all.push(...(debug ? p.pairs.map((q) => ({ ...q, tag })) : p.pairs)); unpaired += p.unpairedInk; bands += p.bands;
  };
  for (const [runs, range, tag] of lines) take(runs, range, tag);
  const abs = all.map((p) => Math.abs(p.offset)).sort((a, b) => a - b);
  return {
    crossings: all.length,
    worst: abs.length ? abs[abs.length - 1] : null,
    median: abs.length ? abs[Math.floor(abs.length / 2)] : null,
    unpaired, bands, inkRuns,
    ...(debug ? { dbg, pairs: all } : {}),
  };
}
