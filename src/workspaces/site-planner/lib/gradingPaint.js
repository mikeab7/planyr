/* Grading layers — painting (owner-only; loaded on demand). PURE: every picture is a RGBA pixel buffer on
 * the engine's own lattice (one pixel per lattice cell) plus a vector outline traced along cell edges, so
 * "the painted mask equals the engine mask cell for cell" is a test on arrays, not a screenshot. The browser
 * glue (`pixelsToDataUrl`) is the only DOM touch and returns null with no DOM.
 *
 *   • Buildable at <s>     — the NEW-1 pad mask tinted in the accent at ~30% with a 1 px outline.
 *   • Cut & Fill           — the B826 surface's cells: RUST cut, BLUE fill, alpha by depth; any graded cell
 *                            outside the setback is solid RED; DEM-void cells a quiet grey.
 * Colours are fixed hex by design: these draw over aerial imagery, which does not theme. */
import { releaseCanvas } from "./releaseCanvas.js";

export const CUT_RGB = [181, 84, 28];     // rust
export const FILL_RGB = [43, 108, 176];   // blue
export const OUT_RGB = [211, 47, 47];     // setback breach — red is a genuine alert here
export const VOID_RGB = [107, 114, 128];
export const MASK_ALPHA = 0.3;
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

/* ---- Buildable mask ---- */
export function maskPixels({ mask, nx, ny }, rgb, alpha = MASK_ALPHA) {
  const px = new Uint8ClampedArray(nx * ny * 4);
  const a = Math.round(alpha * 255);
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k]) continue;
    px[k * 4] = rgb[0]; px[k * 4 + 1] = rgb[1]; px[k * 4 + 2] = rgb[2]; px[k * 4 + 3] = a;
  }
  return px;
}
export const maskOutlinePath = ({ mask, nx, ny, x0, y0, cell }) =>
  traceEdges((i, j) => !!mask[j * nx + i], nx, ny, x0, y0, cell, cell);

/* ---- Cut & Fill cells ---- */
/* How one surface cell paints → { rgb, a } or null (on grade). Pure. */
export function cellPaint(c) {
  if (c.out) return { rgb: OUT_RGB, a: 0.9, kind: "out" };
  if (c.dzFt == null) return { rgb: VOID_RGB, a: 0.25, kind: "void" };
  const d = Math.abs(c.dzFt);
  if (d < EDGE_EPS_FT) return null;
  const a = 0.25 + 0.6 * Math.min(1, d / 12);
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
export function cellsPixels(cells) {
  const L = cellsLattice(cells);
  if (!L) return null;
  const px = new Uint8ClampedArray(L.nx * L.ny * 4);
  const present = new Uint8Array(L.nx * L.ny);
  for (const c of cells) {
    const { i, j } = L.at(c);
    const k = j * L.nx + i;
    present[k] = 1;
    const p = cellPaint(c);
    if (!p) continue;
    px[k * 4] = p.rgb[0]; px[k * 4 + 1] = p.rgb[1]; px[k * 4 + 2] = p.rgb[2]; px[k * 4 + 3] = Math.round(p.a * 255);
  }
  return { pixels: px, present, nx: L.nx, ny: L.ny, x0: L.x0, y0: L.y0, dx: L.dx, dy: L.dy };
}
/* The daylight line: the OUTER edge of the graded footprint+slope set (cells present), traced on the lattice. */
export const cellsOutlinePath = (cp) => traceEdges((i, j) => !!cp.present[j * cp.nx + i], cp.nx, cp.ny, cp.x0, cp.y0, cp.dx, cp.dy);

/* ---- browser glue ---- */
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
