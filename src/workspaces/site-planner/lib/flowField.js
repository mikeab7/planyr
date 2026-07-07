/* Drainage flow-direction math (B705). Pure — runs in the terrain Web Worker and in
 * plain-node tests.
 *
 * Direction at each sample comes from a central-difference GRADIENT over the (harder-)
 * smoothed grid, windowed to roughly the sample spacing — raw per-cell D8 at sparse
 * sample points reads as random on near-flat Houston terrain (8-quantized, one cell's
 * noise). Classic D8 is kept alongside, pure, as the seed of the future storm-outfall
 * flow-accumulation feature (extend D8 → accumulation to answer "which outfall does
 * this part of the site drain to").
 *
 * Coordinate/unit conventions (the sign test in test/flowField.test.js pins them):
 *  - Grid x → east, grid y → SOUTH (row 0 is the north edge) — identical to Leaflet
 *    layer-point screen space, so `dir` renders directly: tip = p + L·(cos d, sin d).
 *  - Slope is dimensionless (ft per ft): dz is FEET, distance converts mercator cells
 *    → ground meters (× groundK = cos(lat), ~0.868 at Houston) → survey feet.
 *  - Below `minSlope` (or any void in the sample window, or a D8 pit): NO arrow —
 *    never invent a direction on ambiguous ground (the no-auto-guess principle).
 */
import { M_TO_FT } from "./elevation.js";

/* Steepest-descent D8: the {dx,dy} neighbor step (8-way) the cell drains to, or null
 * for a pit/flat/void-adjacent cell. `cellFt` is the ground cell size in feet. */
export function d8Direction(values, mask, width, height, x, y, cellFt) {
  const i = y * width + x;
  if (!mask[i]) return null;
  const z = values[i];
  let best = null, bestDrop = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
      const j = yy * width + xx;
      if (!mask[j]) continue;
      const drop = (z - values[j]) / (Math.hypot(dx, dy) * cellFt);
      if (drop > bestDrop) { bestDrop = drop; best = { dx, dy, slope: drop }; }
    }
  }
  return best;
}

/* Sample downhill arrows on a regular lattice.
 * grid: { values (FEET, hard-smoothed), mask, width, height }.
 * opts: { cellMeters, groundK, spacingCells, windowCells, minSlope, marginCells }.
 * Returns [{ px, py, dir, slope }] — `dir` in radians, screen convention (y down),
 * pointing DOWNHILL; `slope` dimensionless ft/ft. */
export function flowArrows(grid, {
  cellMeters, groundK = 1, spacingCells = 32,
  windowCells, minSlope = 0.0008, marginCells = 0,
} = {}) {
  const { values, mask, width, height } = grid;
  const g = Math.max(1, Math.round(windowCells ?? spacingCells / 2));
  const cellFt = cellMeters * groundK * M_TO_FT;
  const arrows = [];
  const at = (x, y) => values[y * width + x];
  const ok = (x, y) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] === 1;
  const start = Math.max(marginCells, g);
  for (let y = start; y < height - Math.max(marginCells, g); y += spacingCells) {
    for (let x = start; x < width - Math.max(marginCells, g); x += spacingCells) {
      if (!ok(x, y) || !ok(x - g, y) || !ok(x + g, y) || !ok(x, y - g) || !ok(x, y + g)) continue;
      const dist = 2 * g * cellFt;
      const gx = (at(x + g, y) - at(x - g, y)) / dist;  // ft/ft, +x = east
      const gy = (at(x, y + g) - at(x, y - g)) / dist;  // ft/ft, +y = SOUTH (screen down)
      const slope = Math.hypot(gx, gy);
      if (!(slope >= minSlope)) continue;               // flat/ambiguous → no arrow
      arrows.push({ px: x + 0.5, py: y + 0.5, dir: Math.atan2(-gy, -gx), slope });
    }
  }
  return arrows;
}
