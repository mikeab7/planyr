/* Grading layers — painting (owner-only; loaded on demand). PURE: every picture is a RGBA pixel buffer on
 * the engine's own lattice (one pixel per lattice cell) plus a vector outline traced along cell edges, so
 * "the painted mask equals the engine mask cell for cell" is a test on arrays, not a screenshot. The browser
 * glue (`pixelsToDataUrl`) is the only DOM touch and returns null with no DOM.
 *
 *   • Level-pad limit at <s> — the sweep's pad mask as a LINE, never a fill: a dashed accent outline plus a faint
 *                            diagonal hatch on the INSIDE edge only (a 40 ft band), and one label at the mask's
 *                            visual centre. (Round 2: a flat tint over half the parcel read as "a default orange
 *                            section" with no purpose.)
 *   • Cut & Fill           — ONLY the slopes outside the pavement edge (shoulder + the grading run): RUST cut, BLUE
 *                            fill, alpha by depth; any slope cell outside the setback is solid RED; DEM-void slope
 *                            cells a quiet grey. The pad, courts, trailer rows, lots and walks are never painted —
 *                            the building draws exactly as it does without the layer.
 * Colours are fixed hex by design: these draw over aerial imagery, which does not theme. */
import { releaseCanvas } from "./releaseCanvas.js";

export const CUT_RGB = [181, 84, 28];     // rust
export const FILL_RGB = [43, 108, 176];   // blue
export const OUT_RGB = [211, 47, 47];     // setback breach — red is a genuine alert here
export const VOID_RGB = [107, 114, 128];
export const HATCH_ALPHA = 0.12;           // the inside-edge hatch, as a share of the accent
export const HATCH_BAND_FT = 40;           // how far in from the edge the hatch runs
export const HATCH_SS = 4;                 // the hatch texture is supersampled this many pixels per lattice cell
export const EDGE_EPS_FT = 0.05;          // |dz| below this paints nothing ("on grade")

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return [14, 159, 110];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ---- the edge tracer (shared) ---- */
/* Segments along every cell side that has no neighbour in the set, merged into straight runs, as ONE svg path
 * string in FEET (the caller wraps it in a feet→screen transform with a non-scaling stroke). has(i,j) →
 * bool over the lattice nx × ny; cell (i,j) spans [x0+i·dx, x0+(i+1)·dx] × [y0+j·dy, y0+(j+1)·dy]. */
export function traceEdges(has, nx, ny, x0, y0, dx, dy) {
  const parts = [];
  const f = (v) => Math.round(v * 100) / 100;
  // horizontal edges (top/bottom of a cell) — merge runs along i
  for (let j = 0; j <= ny; j++) {
    for (const below of [false, true]) {
      let i = 0;
      while (i < nx) {
        const a = j > 0 && has(i, j - 1), b = j < ny && has(i, j);
        const edge = below ? (a && !b) : (b && !a);
        if (!edge) { i++; continue; }
        let k = i;
        while (k + 1 < nx) {
          const a2 = j > 0 && has(k + 1, j - 1), b2 = j < ny && has(k + 1, j);
          if (!(below ? (a2 && !b2) : (b2 && !a2))) break;
          k++;
        }
        parts.push(`M${f(x0 + i * dx)} ${f(y0 + j * dy)}H${f(x0 + (k + 1) * dx)}`);
        i = k + 1;
      }
    }
  }
  // vertical edges — merge runs along j
  for (let i = 0; i <= nx; i++) {
    for (const right of [false, true]) {
      let j = 0;
      while (j < ny) {
        const l = i > 0 && has(i - 1, j), r = i < nx && has(i, j);
        const edge = right ? (l && !r) : (r && !l);
        if (!edge) { j++; continue; }
        let k = j;
        while (k + 1 < ny) {
          const l2 = i > 0 && has(i - 1, k + 1), r2 = i < nx && has(i, k + 1);
          if (!(right ? (l2 && !r2) : (r2 && !l2))) break;
          k++;
        }
        parts.push(`M${f(x0 + i * dx)} ${f(y0 + j * dy)}V${f(y0 + (k + 1) * dy)}`);
        j = k + 1;
      }
    }
  }
  return parts.join("");
}

/* ---- Level-pad limit (the pad mask as a line) ---- */
export const maskOutlinePath = ({ mask, nx, ny, x0, y0, cell }) =>
  traceEdges((i, j) => !!mask[j * nx + i], nx, ny, x0, y0, cell, cell);

/* Chamfer (3-4) distance, in CELLS, from each in-mask cell to the nearest out-of-mask cell (the lattice edge counts
 * as outside). Out-of-mask cells are 0. Two passes; exact enough for a 40 ft band and a visual centre. */
export function maskDistance({ mask, nx, ny }) {
  const INF = 1e9, d = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) d[j * nx + i] = mask[j * nx + i] ? INF : 0;
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : d[j * nx + i]);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (!d[k]) continue;
    d[k] = Math.min(d[k], at(i - 1, j) + 3, at(i, j - 1) + 3, at(i - 1, j - 1) + 4, at(i + 1, j - 1) + 4);
  }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i;
    if (!d[k]) continue;
    d[k] = Math.min(d[k], at(i + 1, j) + 3, at(i, j + 1) + 3, at(i + 1, j + 1) + 4, at(i - 1, j + 1) + 4);
  }
  for (let k = 0; k < d.length; k++) d[k] = d[k] / 3;     // chamfer unit 3 = one cell
  return d;
}

/* The mask's visual centre: the in-mask cell farthest from any edge (ties → nearest the mask's centroid), as a
 * feet point; null for an empty mask. */
export function maskVisualCentre(info) {
  const { mask, nx, ny, x0, y0, cell } = info;
  const d = maskDistance(info);
  let best = -1, cx = 0, cy = 0, n = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (mask[j * nx + i]) { cx += i; cy += j; n++; }
  if (!n) return null;
  cx /= n; cy /= n;
  let bi = -1, bj = -1, bd = Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = d[j * nx + i];
    if (!mask[j * nx + i]) continue;
    const dc = Math.hypot(i - cx, j - cy);
    if (v > best + 1e-6 || (Math.abs(v - best) <= 1e-6 && dc < bd)) { best = v; bi = i; bj = j; bd = dc; }
  }
  return { x: x0 + (bi + 0.5) * cell, y: y0 + (bj + 0.5) * cell };
}

/* The tight bbox of the in-mask cells, in feet — what "fit the map to the pad" frames. */
export function maskTightBox({ mask, nx, ny, x0, y0, cell }) {
  let i0 = Infinity, j0 = Infinity, i1 = -1, j1 = -1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (mask[j * nx + i]) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
  if (i1 < 0) return null;
  return { x0: x0 + i0 * cell, y0: y0 + j0 * cell, x1: x0 + (i1 + 1) * cell, y1: y0 + (j1 + 1) * cell };
}

/* The inside-edge hatch: diagonal stripes at ~12% of the accent, on in-mask cells within 40 ft of the edge, on a
 * texture HATCH_SS pixels per cell (the <image> is stretched over the same box, so the stripes stay fine). Nothing
 * outside the mask and nothing deeper than the band is touched. */
export function maskHatchPixels(info, rgb, { bandFt = HATCH_BAND_FT, alpha = HATCH_ALPHA, ss = HATCH_SS } = {}) {
  const { mask, nx, ny, cell } = info;
  const d = maskDistance(info);
  const bandCells = bandFt / cell;
  const w = nx * ss, h = ny * ss;
  const px = new Uint8ClampedArray(w * h * 4);
  const a = Math.round(alpha * 255), period = ss * 2;
  for (let sy = 0; sy < h; sy++) {
    const j = (sy / ss) | 0;
    for (let sx = 0; sx < w; sx++) {
      const i = (sx / ss) | 0, k = j * nx + i;
      if (!mask[k] || d[k] > bandCells) continue;
      if (((sx + sy) % period) >= ss) continue;            // the stripe: half of each diagonal period
      const o = (sy * w + sx) * 4;
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = a;
    }
  }
  return { pixels: px, w, h };
}

/* ---- Cut & Fill cells ---- */
/* How one surface cell paints → { rgb, a } or null (on grade). Pure. */
export function cellPaint(c) {
  if (c.out) return { rgb: OUT_RGB, a: 0.9, kind: "out" };
  if (c.dzFt == null) return { rgb: VOID_RGB, a: 0.25, kind: "void" };
  const d = Math.abs(c.dzFt);
  if (d < EDGE_EPS_FT) return null;
  const a = 0.35 + 0.5 * Math.min(1, d / 10);
  return c.dzFt > 0 ? { rgb: FILL_RGB, a, kind: "fill" } : { rgb: CUT_RGB, a, kind: "cut" };
}

/* The cells' own lattice: every retained cell shares one size, so index = round((x − x0)/dx). */
export function cellsLattice(cells) {
  if (!cells || !cells.length) return null;
  const dx = cells[0].wFt, dy = cells[0].hFt;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
  }
  const x0 = minX - dx / 2, y0 = minY - dy / 2;
  const nx = Math.round((maxX - minX) / dx) + 1, ny = Math.round((maxY - minY) / dy) + 1;
  return { x0, y0, dx, dy, nx, ny, at: (c) => ({ i: Math.round((c.x - minX) / dx), j: Math.round((c.y - minY) / dy) }) };
}
/* `paintOnly(c)` (optional) limits which cells get INK; every cell still marks `present`, so the daylight line is
 * the outer edge of the whole graded set while only the cells the caller names are tinted. */
export function cellsPixels(cells, paintOnly = null) {
  const L = cellsLattice(cells);
  if (!L) return null;
  const px = new Uint8ClampedArray(L.nx * L.ny * 4);
  const present = new Uint8Array(L.nx * L.ny);
  for (const c of cells) {
    const { i, j } = L.at(c);
    const k = j * L.nx + i;
    present[k] = 1;
    if (paintOnly && !paintOnly(c)) continue;
    const p = cellPaint(c);
    if (!p) continue;
    px[k * 4] = p.rgb[0]; px[k * 4 + 1] = p.rgb[1]; px[k * 4 + 2] = p.rgb[2]; px[k * 4 + 3] = Math.round(p.a * 255);
  }
  return { pixels: px, present, nx: L.nx, ny: L.ny, x0: L.x0, y0: L.y0, dx: L.dx, dy: L.dy };
}
/* The daylight line: the OUTER edge of the graded footprint+slope set (cells present), traced on the lattice. */
export const cellsOutlinePath = (cp) => traceEdges((i, j) => !!cp.present[j * cp.nx + i], cp.nx, cp.ny, cp.x0, cp.y0, cp.dx, cp.dy);

/* ---- ROUND 4: feet-space paths and the proposed-contour lattice ---- */
export const CONTOUR_PROPOSED_RGB = "#7C3F12";        // design-exempt: SVG canvas ink over aerial imagery — terrainLayers.js's CONTOUR_COL, which does not theme
export const CONTOUR_PROPOSED_INDEX_RGB = "#5B2E0D";  // design-exempt: SVG canvas ink over aerial imagery — terrainLayers.js's CONTOUR_INDEX_COL
export const LIMIT_LINE_DASH = "6 4";
/* ROUND 5 (NEW-6) — the paper tone the sheet is printed on: the flat white the print view uses, so the grading picture
 * reads on paper, not on imagery; the same in both themes on purpose (a drawing, not chrome). */
export const GRADING_PAPER_RGB = "#FFFFFF";  // design-exempt: SVG canvas ink over aerial imagery — the print sheet's white, does not theme
export const GRADING_PAPER_OPACITY = 0.92;

/* Closed rings (feet) → one svg path string in FEET (the caller wraps it in the feet→screen transform). */
export function ringsPathD(rings) {
  const f = (v) => Math.round(v * 100) / 100;
  const parts = [];
  for (const ring of rings || []) {
    if (!ring || ring.length < 3) continue;
    parts.push(ring.map((p, i) => `${i ? "L" : "M"}${f(p.x)} ${f(p.y)}`).join("") + "Z");
  }
  return parts.join("");
}

/* The proposed surface as a value lattice for the contour tracer: one value per cell (the proposed elevation),
 * NaN where nothing is proposed or the ground is void — so the lines end at the daylight line. The interval follows
 * the existing Contour-lines rule (1 ft, coarsening only when the range would drown the picture). */
export function surfaceValuesLattice(cells, { maxLevels = 60 } = {}) {
  const L = cellsLattice(cells);
  if (!L) return null;
  const values = new Float32Array(L.nx * L.ny).fill(NaN);
  let lo = Infinity, hi = -Infinity;
  for (const c of cells) {
    let z = null;
    if (c.propFt != null && Number.isFinite(c.propFt) && c.dzFt != null) z = c.propFt;
    else if (c.wedge && c.dzFt != null && Number.isFinite(c.gFt)) z = c.gFt + c.dzFt;
    if (z == null) continue;
    const { i, j } = L.at(c);
    values[j * L.nx + i] = z;
    if (z < lo) lo = z; if (z > hi) hi = z;
  }
  if (!(hi > lo)) return null;
  let interval = 1;
  for (const step of [1, 2, 5, 10, 20, 50]) { if ((hi - lo) / step <= maxLevels) { interval = step; break; } interval = 100; }
  return { values, nx: L.nx, ny: L.ny, x0: L.x0, y0: L.y0, dx: L.dx, dy: L.dy, interval, lo, hi };
}

/* The worker's lattice-pixel lines → feet. ROUND 5: a label carries the line's angle (radians, the same orientation in
 * the lattice, feet and screen frames — x east, y down) and its piece's length in feet, so the canvas can set the text
 * along the line and drop a label the line is too short to carry. */
export function contourLinesToFeet(res, L) {
  const toFt = (p) => ({ x: L.x0 + p[0] * L.dx, y: L.y0 + p[1] * L.dy });
  const f = (v) => Math.round(v * 100) / 100;
  const levels = (res.levels || []).map((lv) => ({
    level: lv.level, isIndex: lv.isIndex,
    d: lv.lines.map((line) => line.map((p, i) => { const q = toFt(p); return `${i ? "L" : "M"}${f(q.x)} ${f(q.y)}`; }).join("")).join(""),
  }));
  const labels = (res.labels || []).map((lb) => ({ pt: toFt([lb.px, lb.py]), level: lb.level, text: String(Math.round(lb.level)),
    angle: Number.isFinite(lb.angle) ? lb.angle : 0, lenFt: Number.isFinite(lb.lenCells) ? lb.lenCells * L.dx : null }));
  const toRing = (r) => r.map((p) => toFt(p));
  const daylight = res.daylight ? { rings: (res.daylight.rings || []).map(toRing), holes: (res.daylight.holes || []).map(toRing) } : null;
  return { levels, labels, daylight };
}
/* Feet rings → the lattice-pixel frame the worker traces in (the inverse of `contourLinesToFeet`'s mapping). */
export const ringsToLatticePx = (rings, L) => (rings || []).map((r) => r.map((p) => [(p.x - L.x0) / L.dx, (p.y - L.y0) / L.dy]));

/* ROUND 5 (NEW-2) — WHICH proposed-contour labels to draw at a zoom, and how: one per index piece (the tracer's choice),
 * along the line (`deg`, upright: never upside down), only on a piece longer than the label, and never two on top of
 * each other (a greedy screen-space sweep, longest pieces first). Pure and translation-free — a box is measured at
 * `pt × rppf`, so a pan never changes the answer and the caller memoises on (labels, rppf) alone (VIEW-INDEPENDENT-ONCE). */
export const CONTOUR_LABEL_PX = Object.freeze({ charW: 6.6, h: 12, pad: 3, minPpf: 0.35, minPieceK: 1.6 });
export function placeContourLabels(labels, rppf, { charW = CONTOUR_LABEL_PX.charW, h = CONTOUR_LABEL_PX.h, pad = CONTOUR_LABEL_PX.pad, minPpf = CONTOUR_LABEL_PX.minPpf, minPieceK = CONTOUR_LABEL_PX.minPieceK } = {}) {
  if (!labels || !labels.length || !(rppf >= minPpf)) return [];
  const cands = labels.map((lb) => {
    let deg = (Number.isFinite(lb.angle) ? lb.angle : 0) * 180 / Math.PI;
    if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;           // upright
    const w = String(lb.text).length * charW + pad * 2, hh = h + pad * 2;
    const c = Math.abs(Math.cos(deg * Math.PI / 180)), sn = Math.abs(Math.sin(deg * Math.PI / 180));
    const bw = w * c + hh * sn, bh = w * sn + hh * c;                   // the rotated box's axis-aligned extent
    const cx = lb.pt.x * rppf, cy = lb.pt.y * rppf;
    return { lb, deg, w, box: [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], lenPx: lb.lenFt != null ? lb.lenFt * rppf : Infinity };
  }).filter((c) => c.lenPx >= c.w * minPieceK);
  cands.sort((a, b) => b.lenPx - a.lenPx);
  const placed = [];
  for (const c of cands) {
    if (placed.some((q) => c.box[0] < q.box[2] && q.box[0] < c.box[2] && c.box[1] < q.box[3] && q.box[1] < c.box[3])) continue;
    placed.push(c);
  }
  return placed.map((c) => ({ pt: c.lb.pt, text: c.lb.text, level: c.lb.level, deg: Math.round(c.deg * 10) / 10 }));
}

/* ---- browser glue ---- */
/* `slopeOnly` — the Cut & Fill layer's rule: only the slope bands (wedge cells) are ever painted. */
export const slopeOnly = (c) => !!c.wedge;

export function pixelsToDataUrl(pixels, nx, ny) {
  if (typeof document === "undefined" || !nx || !ny) return null;
  const canvas = document.createElement("canvas");
  canvas.width = nx; canvas.height = ny;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(pixels, nx, ny), 0, 0);
  const url = canvas.toDataURL("image/png");
  releaseCanvas(canvas);
  return url;
}
