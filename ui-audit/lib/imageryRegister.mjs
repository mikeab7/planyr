/* imageryRegister — on REAL aerial imagery, where nothing paints the truth into the picture, read from one composited frame how far the
 * parcel outline sits from the imagery it was drawn over (NEW-1, V1882768 / B2426464 ×4).
 *
 * The synthetic-county harness (measure-parcel-zoom-slide) has an oracle: every lot's boundary is painted into its imagery as a red band.
 * Real Esri imagery over a real county has no such band, so the imagery ITSELF is the oracle:
 *   1. at rest (before the gesture) take one frame: its imagery texture, and its outline pixels;
 *   2. for each frame of the gesture, find the similarity transform (scale s, shift tx, ty) that best maps the REST imagery onto this
 *      frame's imagery — normalised cross-correlation over the textured ground, outline pixels left out on both sides;
 *   3. carry the rest frame's outline pixels through THAT transform: if the outline moved with the imagery they land on outline pixels in
 *      this frame; if it slid they land beside them, and the distance to the nearest outline pixel is the slide.
 * So a reading is "how far the outline is from where the imagery says it should be", in CSS px, on the composited frame — the same question
 * the red-band reader answers, asked of the real picture.
 *
 * Pure: RGB(A) buffers in, numbers out. Unit-tested in test/imageryRegister.test.js. */

/** The Select-parcels outline (#a21caf at 0.95 opacity) over imagery. Strict on purpose: real ground has purple-ish roofs and shadows. */
export const isOutline = (r, g, b) => r > 115 && b > 105 && g < 0.55 * Math.min(r, b);

/** A grey image (Float32) downsampled by `f`, plus an outline mask at the same resolution (a cell holding any outline pixel). */
export function gray(img, f = 1) {
  const { width, height, channels, data } = img;
  const w = Math.floor(width / f), h = Math.floor(height / f);
  const g = new Float32Array(w * h), m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, out = 0;
    for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) {
      const o = ((y * f + yy) * width + (x * f + xx)) * channels;
      const r = data[o], gg = data[o + 1], b = data[o + 2];
      s += 0.299 * r + 0.587 * gg + 0.114 * b; if (isOutline(r, gg, b)) out = 1;
    }
    g[y * w + x] = s / (f * f); m[y * w + x] = out;
  }
  return { w, h, g, m, f };
}

const bilinear = (G, x, y) => {
  const x0 = Math.floor(x), y0 = Math.floor(y); if (x0 < 0 || y0 < 0 || x0 + 1 >= G.w || y0 + 1 >= G.h) return NaN;
  const fx = x - x0, fy = y - y0, i = y0 * G.w + x0;
  if (G.m[i] || G.m[i + 1] || G.m[i + G.w] || G.m[i + G.w + 1]) return NaN; // never compare against outline ink
  return (G.g[i] * (1 - fx) + G.g[i + 1] * fx) * (1 - fy) + (G.g[i + G.w] * (1 - fx) + G.g[i + G.w + 1] * fx) * fy;
};

/** Sample points (rest-frame coords at G's resolution) inside `win` = [x0,y0,x1,y1] (full-res px), on textured, outline-free ground. */
export function samplePoints(G, win, n = 2500, seed = 7) {
  const [x0, y0, x1, y1] = win.map((v) => v / G.f);
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pts = [];
  for (let tries = 0; pts.length < n && tries < n * 20; tries++) {
    const x = Math.floor(x0 + 2 + rnd() * (x1 - x0 - 4)), y = Math.floor(y0 + 2 + rnd() * (y1 - y0 - 4)); const i = y * G.w + x;
    if (G.m[i] || G.m[i - 1] || G.m[i + 1] || G.m[i - G.w] || G.m[i + G.w]) continue;
    const grad = Math.abs(G.g[i + 1] - G.g[i - 1]) + Math.abs(G.g[i + G.w] - G.g[i - G.w]);
    if (grad < 6) continue; // flat ground carries no position
    pts.push([x, y, G.g[i]]);
  }
  return pts;
}

/** NCC of the rest samples against frame F under p' = s·p + t (t in F's px). */
function ncc(pts, F, s, tx, ty, win) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const [wx0, wy0, wx1, wy1] = win;
  for (const [x, y, a] of pts) {
    const X = s * x + tx, Y = s * y + ty; if (X < wx0 || Y < wy0 || X > wx1 || Y > wy1) continue;
    const b = bilinear(F, X, Y); if (Number.isNaN(b)) continue;
    n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
  }
  if (n < 200) return { c: -1, n };
  const va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  return { c: va > 0 && vb > 0 ? (sab - (sa * sb) / n) / Math.sqrt(va * vb) : -1, n };
}

/** Best similarity transform mapping REST imagery onto FRAME imagery (full-res px): p_frame = s·p_rest + t.
 *  `anchor` = the gesture's fixed point (the cursor / map centre); the search starts from the shift that keeps it fixed and looks ±`slack` px
 *  around it, so a zoom that is not perfectly anchored is still found. */
export function fitImagery(restImg, frameImg, { win, anchor, sMin = 0.3, sMax = 3.2, slack = 40, coarse = 4, prev = null } = {}) {
  const Rc = gray(restImg, coarse), Fc = gray(frameImg, coarse);
  const winC = win.map((v) => v / coarse);
  const ptsC = samplePoints(Rc, win, 1500);
  const ax = anchor[0] / coarse, ay = anchor[1] / coarse, sl = slack / coarse;
  let best = { c: -2 };
  const search = (lo, hi, steps, around) => {
    for (let k = 0; k <= steps; k++) {
      const s = lo * (hi / lo) ** (k / steps);
      // around: the previous frame's fit (shift carried to this scale about the anchor); else the anchored shift
      const t0x = around ? (around.tx + (around.s - s) * anchor[0]) / coarse : ax * (1 - s), t0y = around ? (around.ty + (around.s - s) * anchor[1]) / coarse : ay * (1 - s);
      const lim = around ? Math.ceil(sl / 3) : sl;
      for (let dx = -lim; dx <= lim; dx += 1) for (let dy = -lim; dy <= lim; dy += 1) {
        const r = ncc(ptsC, Fc, s, t0x + dx, t0y + dy, winC); if (r.c > best.c) best = { c: r.c, s, tx: (t0x + dx) * coarse, ty: (t0y + dy) * coarse };
      }
    }
  };
  if (prev) search(prev.s / 1.35, prev.s * 1.35, 40, prev);
  if (best.c < 0.6) search(sMin, sMax, 160, null);
  // refine at full resolution: coordinate descent with shrinking steps
  const R = gray(restImg, 1), F = gray(frameImg, 1); const pts = samplePoints(R, win, 4000);
  let { s, tx, ty } = best, c = ncc(pts, F, s, tx, ty, win).c;
  for (const [ds, dt] of [[0.02, 4], [0.006, 1.5], [0.002, 0.5], [0.0006, 0.2], [0.0002, 0.08]]) {
    let moved = true, guard = 0;
    while (moved && guard++ < 30) {
      moved = false;
      for (const [a, b, d] of [[ds, 0, 0], [-ds, 0, 0], [0, dt, 0], [0, -dt, 0], [0, 0, dt], [0, 0, -dt]]) {
        // a scale step pivots about the anchor so it does not drag the whole picture sideways
        const s2 = s + a, tx2 = tx + b - a * anchor[0], ty2 = ty + d - a * anchor[1];
        const c2 = ncc(pts, F, s2, tx2, ty2, win).c; if (c2 > c + 1e-6) { s = s2; tx = tx2; ty = ty2; c = c2; moved = true; }
      }
    }
  }
  return { s, tx, ty, ncc: c };
}

/** Outline pixels of an image inside `win` (full-res), subsampled to ≤ n. */
export function outlinePoints(img, win, n = 1500) {
  const { width, channels, data } = img; const [x0, y0, x1, y1] = win.map(Math.round); const pts = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * width + x) * channels; if (isOutline(data[o], data[o + 1], data[o + 2])) pts.push([x, y]); }
  if (pts.length <= n) return pts;
  const step = pts.length / n; const out = []; for (let i = 0; i < n; i++) out.push(pts[Math.floor(i * step)]); return out;
}

/** Carry the rest outline through the imagery's transform and read how far each lands from this frame's nearest outline pixel.
 *  Returns { n, median, p90, lost } in the frame's px; `lost` = landed inside `win` with no outline within `reach` px (not drawn there). */
export function outlineOffset(restOutline, frameImg, xf, { win, reach = 12, perPoint = false } = {}) {
  const { width, height, channels, data } = frameImg; const [x0, y0, x1, y1] = win;
  const ink = (x, y) => { if (x < 0 || y < 0 || x >= width || y >= height) return false; const o = (y * width + x) * channels; return isOutline(data[o], data[o + 1], data[o + 2]); };
  const d = []; let lost = 0; const each = [];
  for (const [px, py] of restOutline) {
    const X = xf.s * px + xf.tx, Y = xf.s * py + xf.ty; if (X < x0 + reach || Y < y0 + reach || X > x1 - reach || Y > y1 - reach) { each.push(null); continue; }
    const cx = Math.round(X), cy = Math.round(Y); let best = null;
    for (let r = 0; r <= reach && best == null; r++) for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) {
      if (Math.max(Math.abs(xx - cx), Math.abs(yy - cy)) !== r || !ink(xx, yy)) continue;
      const dd = Math.hypot(xx - X, yy - Y); if (best == null || dd < best) best = dd;
    }
    if (best == null) lost++; else d.push(best);
    each.push(best);
  }
  d.sort((a, b) => a - b);
  return { n: d.length, median: d.length ? d[Math.floor(d.length / 2)] : null, p90: d.length ? d[Math.floor(d.length * 0.9)] : null, lost, ...(perPoint ? { each } : {}) };
}

/** Keep only the reference outline pixels that are ALSO drawn in the settled view at the other end of the gesture (within `tol` px of an
 *  outline there, through that view's own imagery transform). A zoom that crosses a display stage changes WHICH lots are drawn — out to the
 *  wide stage only the large lots stay ("Large lots only") — and a line removed by design is not a line off its imagery. Returns the kept
 *  points and the share kept (a low share means the two ends disagree everywhere, which the caller must report, never judge). */
export function persistentOutline(restOutline, endImg, xfEnd, { win, tol = 1.5, reach = 12 } = {}) {
  const r = outlineOffset(restOutline, endImg, xfEnd, { win, reach, perPoint: true });
  const kept = restOutline.filter((_, i) => r.each[i] != null && r.each[i] <= tol);
  const seen = r.each.filter((v) => v != null).length + r.lost;
  return { kept, share: seen ? kept.length / seen : 0 };
}
