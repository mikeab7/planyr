/* verify-terrain-lattice — the LIVE check behind B1081 / B1082 (V499).
 *
 * Runs the REAL production terrain pipeline against the REAL USGS 3DEP service (not the
 * captured fixture) and MEASURES the thing the owner reported: whether the traced contour
 * network over identical registered ground changes when the map moves.
 *
 *   node ui-audit/verify-terrain-lattice.mjs        # part 1 (also runs part 2)
 *
 * It exercises both paths side by side over the same ground — the OLD viewport-anchored
 * `gridRequest` and the NEW fixed `latticeCover` — through the same decode, the same
 * `maskedSmooth` sigma the worker uses, the same `buildContours`, and the same
 * `composeContourPaint` the map paints through. Everything it prints is a measurement.
 *
 * Requires DIRECT outbound access to elevation.nationalmap.gov. Node `fetch` reaches it
 * from the sandbox; a headless Chromium does NOT (the agent proxy refuses its CONNECT —
 * see V477), which is why the BROWSER half of V499 stays owed.
 */
import {
  gridRequest, exportUrl, latticeCover, maskedSmooth, groundScale,
  mercYToLat, pixelToLatLng, lngToMercX, latToMercY, mercPerPx, MARGIN_CELLS,
} from "../src/workspaces/site-planner/lib/demGrid.js";
import { decodeGrid } from "../src/workspaces/site-planner/lib/lercGrid.js";
import { buildContours, composeContourPaint } from "../src/workspaces/site-planner/lib/contours.js";

const DEP = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer";
const LAT = 29.7820, LNG = -95.7950;      // Katy / west-Houston flat ground — the B704 class
const Z = 17;
const CONTOUR_SIGMA_M = 3;
const SIGMA_CAP_CELLS = (MARGIN_CELLS - 1) / 3;

const pane = (lat, lng, z, wpx = 1400, hpx = 900) => {
  const m = mercPerPx(z), cx = lngToMercX(lng), cy = latToMercY(lat);
  const toLng = (x) => (x / (Math.PI * 6378137)) * 180;
  const toLat = (y) => (Math.atan(Math.exp(y / 6378137)) * 360) / Math.PI - 90;
  return {
    west: toLng(cx - (wpx * m) / 2), east: toLng(cx + (wpx * m) / 2),
    south: toLat(cy - (hpx * m) / 2), north: toLat(cy + (hpx * m) / 2),
  };
};

const cache = new Map();
async function fetchGrid(req) {
  if (cache.has(req.key)) return cache.get(req.key);
  const r = await fetch(exportUrl(req, DEP));
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${req.key}`);
  const buf = await r.arrayBuffer();
  const g = decodeGrid(buf, req);
  cache.set(req.key, g);
  return g;
}

function trace(grid, req, clip) {
  const gk = groundScale(mercYToLat((req.bbox.ymin + req.bbox.ymax) / 2));
  const sigma = Math.min(SIGMA_CAP_CELLS, CONTOUR_SIGMA_M / (req.cellMeters * gk));
  const c = buildContours({
    values: maskedSmooth(grid.values, grid.mask, grid.width, grid.height, sigma),
    mask: grid.mask, width: grid.width, height: grid.height,
  }, { clip });
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const toLL = (px, py) => { const [la, ln] = pixelToLatLng(req, px, py); return [r6(la), r6(ln)]; };
  return {
    levels: c.levels.map((l) => ({
      level: l.level, isIndex: l.isIndex,
      lines: l.lines.map((ln) => ln.map((p) => toLL(p[0], p[1]))),
    })),
    labels: c.labels.map((lb) => ({ ll: toLL(lb.px, lb.py), level: lb.level, anchor: lb.anchor })),
  };
}

// Ground distance (ft) of every contour segment that falls inside a lat/lng window.
const FT_PER_DEG_LAT = 364000;
function inkInWindow(levels, win) {
  const inside = (p) => p[0] >= win.south && p[0] <= win.north && p[1] >= win.west && p[1] <= win.east;
  const kx = Math.cos((win.south * Math.PI) / 180);
  let ft = 0;
  for (const lv of levels) for (const line of lv.lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      if (!inside(a) || !inside(b)) continue;
      ft += Math.hypot((b[0] - a[0]) * FT_PER_DEG_LAT, (b[1] - a[1]) * FT_PER_DEG_LAT * kx);
    }
  }
  return ft;
}
function labelsInWindow(labels, win) {
  return labels.filter((l) => l.ll[0] >= win.south && l.ll[0] <= win.north &&
    l.ll[1] >= win.west && l.ll[1] <= win.east)
    .map((l) => `${l.level}@${l.ll[0].toFixed(5)},${l.ll[1].toFixed(5)}`).sort();
}

const pct = (a, b) => `${a === 0 ? "n/a" : (((b - a) / a) * 100).toFixed(1)}%`;

async function main() {
  // Three small measurement windows on identical registered ground, like the report's.
  const d = 0.0009;
  const windows = [
    { name: "window A", south: LAT - d, north: LAT + d, west: LNG - d, east: LNG + d },
    { name: "window B", south: LAT + d, north: LAT + 3 * d, west: LNG - 3 * d, east: LNG - d },
    { name: "window C", south: LAT - 3 * d, north: LAT - d, west: LNG + d, east: LNG + 3 * d },
  ];
  // The two views: the "before" pan and the "after" pan (a normal drag).
  const v1 = pane(LAT, LNG, Z);
  const v2 = pane(LAT + 0.0006, LNG + 0.0009, Z);

  console.log("=== A. OLD PATH — one viewport-sized, viewport-snapped grid per view ===");
  const oldReq1 = gridRequest(v1, Z), oldReq2 = gridRequest(v2, Z);
  console.log(`  view 1 grid: ${oldReq1.key}  ${oldReq1.width}x${oldReq1.height} cell=${oldReq1.cellMeters.toFixed(3)}m`);
  console.log(`  view 2 grid: ${oldReq2.key}  ${oldReq2.width}x${oldReq2.height} cell=${oldReq2.cellMeters.toFixed(3)}m`);
  console.log(`  same request for the same ground? ${oldReq1.key === oldReq2.key ? "YES" : "NO  <-- the bug"}`);
  const o1 = trace(await fetchGrid(oldReq1), oldReq1, null);
  const o2 = trace(await fetchGrid(oldReq2), oldReq2, null);
  for (const w of windows) {
    const a = inkInWindow(o1.levels, w), b = inkInWindow(o2.levels, w);
    console.log(`  ${w.name}: ${a.toFixed(0)} ft -> ${b.toFixed(0)} ft   (${pct(a, b)})`);
  }
  const ol1 = labelsInWindow(o1.labels, windows[0]), ol2 = labelsInWindow(o2.labels, windows[0]);
  console.log(`  labels in window A: view1=[${ol1.join(" ")}]  view2=[${ol2.join(" ")}]`);
  console.log(`  identical labels? ${JSON.stringify(ol1) === JSON.stringify(ol2) ? "YES" : "NO  <-- the bug"}`);

  console.log("\n=== B. NEW PATH — fixed geographic lattice tiles ===");
  const c1 = latticeCover(v1, Z), c2 = latticeCover(v2, Z);
  console.log(`  view 1 tiles: ${c1.tiles.map((t) => t.key).join(" ")}`);
  console.log(`  view 2 tiles: ${c2.tiles.map((t) => t.key).join(" ")}`);
  console.log(`  band ${c1.band} == ${c2.band}, coarsened=${c1.coarsened}/${c2.coarsened}`);
  const partsFor = async (cover) => {
    const out = [];
    for (const t of cover.tiles) {
      const g = await fetchGrid(t);
      out.push({ tile: t, data: { contours: trace(g, t, t.interior) } });
    }
    return out;
  };
  const p1 = await partsFor(c1), p2 = await partsFor(c2);
  const paint1 = composeContourPaint(p1), paint2 = composeContourPaint(p2);
  const asLevels = (paint) => {
    const m = new Map();
    for (const l of paint.lines) {
      let e = m.get(l.level);
      if (!e) m.set(l.level, e = { lines: [] });
      e.lines.push(l.coords);
    }
    return [...m.values()];
  };
  for (const w of windows) {
    const a = inkInWindow(asLevels(paint1), w), b = inkInWindow(asLevels(paint2), w);
    console.log(`  ${w.name}: ${a.toFixed(0)} ft -> ${b.toFixed(0)} ft   (${pct(a, b)})`);
  }
  const nl1 = labelsInWindow(paint1.labels, windows[0]), nl2 = labelsInWindow(paint2.labels, windows[0]);
  console.log(`  labels in window A: view1=[${nl1.join(" ")}]  view2=[${nl2.join(" ")}]`);
  console.log(`  identical labels? ${JSON.stringify(nl1) === JSON.stringify(nl2) ? "YES" : "NO"}`);

  console.log("\n=== C. label text — the '150 ft ft' artifact ===");
  const bad = paint1.labels.filter((l) => /ft\s+ft/.test(l.text));
  console.log(`  ${paint1.labels.length} labels painted; doubled-unit labels: ${bad.length}`);
  console.log(`  sample: ${paint1.labels.slice(0, 6).map((l) => l.text).join(" | ")}`);
  const ghost = composeContourPaint([...p1, ...p1]);   // superseded compute lands late
  console.log(`  with a SUPERSEDED duplicate artifact mixed in: ${ghost.labels.length} labels (clean run: ${paint1.labels.length})`);
  console.log(`  double-stamped? ${ghost.labels.length === paint1.labels.length ? "NO" : "YES  <-- the bug"}`);

  console.log("\n=== D. seam continuity across adjacent lattice tiles ===");
  const rawLines = p1.reduce((n, x) => n + x.data.contours.levels.reduce((m, l) => m + l.lines.length, 0), 0);
  console.log(`  per-tile pieces: ${rawLines}  ->  after seam-join: ${paint1.lines.length}`);

  console.log("\n=== E. zoom out and back (17 -> 18 -> 17) ===");
  const back = latticeCover(pane(LAT, LNG, Z), Z);
  console.log(`  same tiles as the first z17 view? ${
    JSON.stringify(back.tiles.map((t) => t.key)) === JSON.stringify(c1.tiles.map((t) => t.key)) ? "YES" : "NO"}`);
  const paintBack = composeContourPaint(await partsFor(back));
  console.log(`  identical labels after the round trip? ${
    JSON.stringify(paintBack.labels) === JSON.stringify(paint1.labels) ? "YES" : "NO"}`);
  console.log(`  identical geometry after the round trip? ${
    JSON.stringify(paintBack.lines) === JSON.stringify(paint1.lines) ? "YES" : "NO"}`);
}

await main();
await import("./verify-terrain-lattice-wide.mjs");
