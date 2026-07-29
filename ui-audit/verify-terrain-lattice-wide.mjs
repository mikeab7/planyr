/* Part two of the B1081 / B1082 live check (see verify-terrain-lattice.mjs, which runs it).
 *
 * The two mechanisms a small same-zoom pan does NOT exercise, and which the owner's
 * screenshot pair (registered at scale 0.800) actually captured:
 *   1. the MAX_GRID `k` coarsening — a WIDER window silently doubles the cell size;
 *   2. the MOVING TILE BORDER — lines are dropped at the grid edge, and that edge moves.
 */
import {
  gridRequest, exportUrl, latticeCover, maskedSmooth, groundScale,
  mercYToLat, pixelToLatLng, lngToMercX, latToMercY, mercPerPx, MARGIN_CELLS,
} from "../src/workspaces/site-planner/lib/demGrid.js";
import { decodeGrid } from "../src/workspaces/site-planner/lib/lercGrid.js";
import { buildContours, composeContourPaint } from "../src/workspaces/site-planner/lib/contours.js";

const DEP = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer";
const LAT = 29.7820, LNG = -95.7950, Z = 17;
const SIGMA_CAP = (MARGIN_CELLS - 1) / 3;
const pane = (lat, lng, z, w, h) => {
  const m = mercPerPx(z), cx = lngToMercX(lng), cy = latToMercY(lat);
  const tl = (x) => (x / (Math.PI * 6378137)) * 180;
  const ta = (y) => (Math.atan(Math.exp(y / 6378137)) * 360) / Math.PI - 90;
  return { west: tl(cx - w * m / 2), east: tl(cx + w * m / 2), south: ta(cy - h * m / 2), north: ta(cy + h * m / 2) };
};
const cache = new Map();
async function fetchGrid(req) {
  if (cache.has(req.key)) return cache.get(req.key);
  const r = await fetch(exportUrl(req, DEP));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const g = decodeGrid(await r.arrayBuffer(), req);
  cache.set(req.key, g); return g;
}
function trace(g, req, clip) {
  const gk = groundScale(mercYToLat((req.bbox.ymin + req.bbox.ymax) / 2));
  const s = Math.min(SIGMA_CAP, 3 / (req.cellMeters * gk));
  const c = buildContours({ values: maskedSmooth(g.values, g.mask, g.width, g.height, s), mask: g.mask, width: g.width, height: g.height }, { clip });
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const toLL = (px, py) => { const [a, b] = pixelToLatLng(req, px, py); return [r6(a), r6(b)]; };
  return { levels: c.levels.map((l) => ({ level: l.level, isIndex: l.isIndex, lines: l.lines.map((ln) => ln.map((p) => toLL(p[0], p[1]))) })),
           labels: c.labels.map((lb) => ({ ll: toLL(lb.px, lb.py), level: lb.level, anchor: lb.anchor })) };
}
const F = 364000;
const ink = (levels, w) => {
  const inside = (p) => p[0] >= w.south && p[0] <= w.north && p[1] >= w.west && p[1] <= w.east;
  const kx = Math.cos(w.south * Math.PI / 180); let ft = 0;
  for (const lv of levels) for (const ln of lv.lines) for (let i = 1; i < ln.length; i++) {
    const a = ln[i - 1], b = ln[i]; if (!inside(a) || !inside(b)) continue;
    ft += Math.hypot((b[0] - a[0]) * F, (b[1] - a[1]) * F * kx);
  } return ft;
};
const loops = (levels) => levels.reduce((n, lv) => n + lv.lines.filter((l) => l.length > 3 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1]).length, 0);
const pct = (a, b) => a === 0 ? "n/a" : `${(((b - a) / a) * 100).toFixed(1)}%`;
const asLevels = (p) => { const m = new Map(); for (const l of p.lines) { let e = m.get(l.level); if (!e) m.set(l.level, e = { lines: [] }); e.lines.push(l.coords); } return [...m.values()]; };

const d = 0.0009;
const W = [
  { n: "greenbelt-strip", south: LAT - d, north: LAT + d, west: LNG - d, east: LNG + d },
  { n: "west-field    ", south: LAT + d, north: LAT + 3 * d, west: LNG - 5 * d, east: LNG - 3 * d },
  { n: "north-edge    ", south: LAT + 4 * d, north: LAT + 6 * d, west: LNG - d, east: LNG + d },
];

const narrow = pane(LAT, LNG, Z, 1400, 900);      // laptop pane
const wide   = pane(LAT, LNG, Z, 2400, 1500);     // wider window — the "scale 0.800" case

console.log("=== OLD PATH: same zoom, same centre, WIDER window ===");
const rn = gridRequest(narrow, Z), rw = gridRequest(wide, Z);
console.log(`  narrow: ${rn.width}x${rn.height} cell=${rn.cellMeters.toFixed(3)}m  key=${rn.key}`);
console.log(`  wide  : ${rw.width}x${rw.height} cell=${rw.cellMeters.toFixed(3)}m  key=${rw.key}`);
console.log(`  cell size changed by widening the window? ${rn.cellMeters === rw.cellMeters ? "no" : "YES  <-- the bug"}`);
const on = trace(await fetchGrid(rn), rn, null), ow = trace(await fetchGrid(rw), rw, null);
for (const w of W) { const a = ink(on.levels, w), b = ink(ow.levels, w); console.log(`  ${w.n}: ${a.toFixed(0)} ft -> ${b.toFixed(0)} ft  (${pct(a, b)})`); }
console.log(`  closed loops in the whole trace: ${loops(on.levels)} -> ${loops(ow.levels)}`);
const oL = (o, w) => o.labels.filter((l) => l.ll[0] >= w.south && l.ll[0] <= w.north && l.ll[1] >= w.west && l.ll[1] <= w.east).map((l) => l.level).sort().join(",");
for (const w of W) console.log(`  labels in ${w.n}: [${oL(on, w)}] -> [${oL(ow, w)}]`);

console.log("\n=== NEW PATH: same zoom, same centre, WIDER window ===");
const cn = latticeCover(narrow, Z), cw = latticeCover(wide, Z);
console.log(`  narrow: band ${cn.band} cell=${cn.cellMeters.toFixed(3)}m ${cn.tiles.length} tiles  coarsened=${cn.coarsened}`);
console.log(`  wide  : band ${cw.band} cell=${cw.cellMeters.toFixed(3)}m ${cw.tiles.length} tiles  coarsened=${cw.coarsened}`);
const parts = async (c) => { const o = []; for (const t of c.tiles) o.push({ tile: t, data: { contours: trace(await fetchGrid(t), t, t.interior) } }); return o; };
const pn = composeContourPaint(await parts(cn)), pw = composeContourPaint(await parts(cw));
for (const w of W) { const a = ink(asLevels(pn), w), b = ink(asLevels(pw), w); console.log(`  ${w.n}: ${a.toFixed(0)} ft -> ${b.toFixed(0)} ft  (${pct(a, b)})`); }
const nL = (p, w) => p.labels.filter((l) => l.ll[0] >= w.south && l.ll[0] <= w.north && l.ll[1] >= w.west && l.ll[1] <= w.east).map((l) => l.text).sort().join(",");
for (const w of W) console.log(`  labels in ${w.n}: [${nL(pn, w)}] -> [${nL(pw, w)}]`);

console.log("\n=== OLD PATH: the moving TILE BORDER (same zoom, same size, panned) ===");
const v1 = pane(LAT, LNG, Z, 1400, 900), v2 = pane(LAT + 0.004, LNG + 0.004, Z, 1400, 900);
const r1 = gridRequest(v1, Z), r2 = gridRequest(v2, Z);
const t1 = trace(await fetchGrid(r1), r1, null), t2 = trace(await fetchGrid(r2), r2, null);
// a strip of ground that is deep inside view2's grid but hard against view1's north edge
const edge = { n: "at view-1's grid edge", south: mercYToLat(r1.bbox.ymax - 30 * r1.cellMeters), north: mercYToLat(r1.bbox.ymax - 2 * r1.cellMeters),
               west: (r1.bbox.xmin + 100 * r1.cellMeters) / (Math.PI * 6378137) * 180, east: (r1.bbox.xmin + 400 * r1.cellMeters) / (Math.PI * 6378137) * 180 };
const ea = ink(t1.levels, edge), eb = ink(t2.levels, edge);
console.log(`  ${edge.n}: ${ea.toFixed(0)} ft -> ${eb.toFixed(0)} ft  (${pct(ea, eb)})`);
console.log("\n=== NEW PATH: the same strip of ground ===");
const q1 = composeContourPaint(await parts(latticeCover(v1, Z))), q2 = composeContourPaint(await parts(latticeCover(v2, Z)));
const na = ink(asLevels(q1), edge), nb = ink(asLevels(q2), edge);
console.log(`  ${edge.n}: ${na.toFixed(0)} ft -> ${nb.toFixed(0)} ft  (${pct(na, nb)})`);
