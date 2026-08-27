/* NEW-1 + NEW-2 — "the terrain stops changing when you move."
 *
 * Two bugs, one tile: contour labels double-stamped and went stale (a superseded
 * compute painted into the live group), and the whole traced network re-rolled on every
 * pan/zoom (the DEM grid was sized to the VIEWPORT). These are the guards for both —
 * the lattice purity that makes "same ground → same lines" a property rather than a
 * hope, the tile-seam clip, the deterministic label anchoring, and the source-text pins
 * on the supersession token that terrainLayers.js was missing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  latticeTile, latticeCover, bandCellMeters, gridRequest, mercPerPx,
  TILE_CELLS, MARGIN_CELLS, LATTICE_MAX_TILES,
  lngToMercX, latToMercY, mercXToLng, mercYToLat,
} from "../src/workspaces/site-planner/lib/demGrid.js";
import {
  buildContours, clipSegment, clipRun, anchorLabels,
} from "../src/workspaces/site-planner/lib/contourTrace.js";
import {
  contourLabelText, pickLabels, joinSeams, composeContourPaint,
  contourLineKey, contourLabelKey, diffKeyedPaint,
  LABEL_CAP, LABEL_MIN_SEP_CELLS,
} from "../src/workspaces/site-planner/lib/contours.js";
import { maskedSmooth, pixelToLatLng } from "../src/workspaces/site-planner/lib/demGrid.js";
import { decodeGrid } from "../src/workspaces/site-planner/lib/lercGrid.js";
import { flowArrows } from "../src/workspaces/site-planner/lib/flowField.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/* A real map view: a pane of `wpx`×`hpx` CSS pixels at zoom `z`, centered on (lat,lng).
 * Deriving the bounds from pixels (not from a fixed degree span) is what makes the
 * tile-count arithmetic below mean anything — a pane covers half the ground each time
 * you zoom in, which is exactly why the band can stay pinned to the zoom. */
const paneView = (lat, lng, z, wpx = 1400, hpx = 900) => {
  const m = mercPerPx(z);
  const cx = lngToMercX(lng), cy = latToMercY(lat);
  return {
    west: mercXToLng(cx - (wpx * m) / 2), east: mercXToLng(cx + (wpx * m) / 2),
    south: mercYToLat(cy - (hpx * m) / 2), north: mercYToLat(cy + (hpx * m) / 2),
  };
};

const grid = (width, height, fn) => {
  const values = new Float32Array(width * height);
  const mask = new Uint8Array(width * height).fill(1);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) values[j * width + i] = fn(i, j);
  return { values, mask, width, height };
};

// ---------------------------------------------------------------------------
describe("the lattice is anchored to the GROUND, not the viewport (NEW-2)", () => {
  it("a tile is a pure function of (band, tx, ty) — same inputs, same bbox and cells", () => {
    const a = latticeTile(17, 123, -456);
    const b = latticeTile(17, 123, -456);
    expect(a.key).toBe(b.key);
    expect(a.bbox).toEqual(b.bbox);
    expect(a.width).toBe(TILE_CELLS + 2 * MARGIN_CELLS);
    expect(a.height).toBe(a.width);
    expect(a.cellMeters).toBe(bandCellMeters(17));
    expect(a.interior).toEqual({
      x0: MARGIN_CELLS, y0: MARGIN_CELLS,
      x1: MARGIN_CELLS + TILE_CELLS, y1: MARGIN_CELLS + TILE_CELLS,
    });
  });

  it("adjacent tiles share their interior edge EXACTLY — no gap, no overlap", () => {
    const a = latticeTile(17, 10, 4), b = latticeTile(17, 11, 4);
    const cell = a.cellMeters;
    const aRightInterior = a.bbox.xmax - MARGIN_CELLS * cell;
    const bLeftInterior = b.bbox.xmin + MARGIN_CELLS * cell;
    expect(bLeftInterior).toBeCloseTo(aRightInterior, 9);
    const up = latticeTile(17, 10, 5);
    expect(up.bbox.ymin + MARGIN_CELLS * cell).toBeCloseTo(a.bbox.ymax - MARGIN_CELLS * cell, 9);
  });

  it("PANNING re-uses the very same tiles — the old viewport-snapped request did not", () => {
    const z = 17, lat = 29.782, lng = -95.795;
    const v1 = paneView(lat, lng, z);
    const v2 = paneView(lat + 0.0004, lng + 0.0006, z); // a small drag, same zoom
    const c1 = latticeCover(v1, z), c2 = latticeCover(v2, z);
    expect(c1.band).toBe(c2.band);
    expect(c1.cellMeters).toBe(c2.cellMeters);
    // the overlap is genuinely the SAME tile objects by key, not merely similar
    const keys1 = new Set(c1.tiles.map((t) => t.key));
    const shared = c2.tiles.filter((t) => keys1.has(t.key));
    expect(shared.length).toBeGreaterThan(0);
    for (const t of shared) {
      const same = c1.tiles.find((u) => u.key === t.key);
      expect(t.bbox).toEqual(same.bbox);
      expect(t.cellMeters).toBe(same.cellMeters);
    }
    // …the regression this replaces: the viewport-snapped request moved with the view,
    // so the same ground was resampled onto a different cell lattice every drag.
    const r1 = gridRequest(v1, z), r2 = gridRequest(v2, z);
    expect(r1.key).not.toBe(r2.key);
  });

  it("pan away and back returns the identical cover", () => {
    const z = 17, lat = 29.782, lng = -95.795;
    const there = latticeCover(paneView(lat, lng, z), z);
    latticeCover(paneView(lat + 0.02, lng + 0.02, z), z);   // wander off
    const back = latticeCover(paneView(lat, lng, z), z);
    expect(back.tiles.map((t) => t.key)).toEqual(there.tiles.map((t) => t.key));
  });

  it("zoom out and back lands on the same band and the same tiles", () => {
    const lat = 29.782, lng = -95.795;
    const at17 = latticeCover(paneView(lat, lng, 17), 17);
    expect(at17.band).toBe(17);
    expect(latticeCover(paneView(lat, lng, 18), 18).band).toBe(18);   // a pane covers half the ground
    const back = latticeCover(paneView(lat, lng, 17), 17);
    expect(back.tiles.map((t) => t.key)).toEqual(at17.tiles.map((t) => t.key));
  });

  it("a normal pane never coarsens — not on a laptop, not on a 4K display", () => {
    for (const z of [16, 17, 18, 19]) {
      for (const [w, h] of [[1024, 700], [1400, 900], [2560, 1440], [3840, 2160]]) {
        const cover = latticeCover(paneView(29.782, -95.795, z, w, h), z);
        expect({ z, w, h, band: cover.band }).toEqual({ z, w, h, band: z });
        expect(cover.tiles.length).toBeLessThanOrEqual(LATTICE_MAX_TILES);
      }
    }
  });

  it("the cover actually covers the view, and every tile touches it", () => {
    const z = 17, v = paneView(29.782, -95.795, z);
    const cover = latticeCover(v, z);
    const span = TILE_CELLS * cover.cellMeters;
    const xs = cover.tiles.map((t) => t.tx), ys = cover.tiles.map((t) => t.ty);
    expect(Math.min(...xs) * span).toBeLessThanOrEqual(lngToMercX(v.west));
    expect((Math.max(...xs) + 1) * span).toBeGreaterThanOrEqual(lngToMercX(v.east));
    expect(Math.min(...ys) * span).toBeLessThanOrEqual(latToMercY(v.south));
    expect((Math.max(...ys) + 1) * span).toBeGreaterThanOrEqual(latToMercY(v.north));
  });

  it("a huge window steps the band DOWN and says so (the honesty flag)", () => {
    const wide = paneView(29.782, -95.795, 19, 12000, 9000); // absurd pane, or a torn-off window
    const cover = latticeCover(wide, 19);
    expect(cover.tiles.length).toBeLessThanOrEqual(LATTICE_MAX_TILES);
    expect(cover.band).toBeLessThan(19);
    expect(cover.coarsened).toBe(true);
    expect(cover.cellMeters).toBeGreaterThan(bandCellMeters(19));
    // a normal window never coarsens — the note stays off unless it is earned
    expect(latticeCover(paneView(29.782, -95.795, 17), 17).coarsened).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("tile clipping cuts contours at the seam instead of breaking them", () => {
  it("clipSegment trims to the rect and drops a miss", () => {
    const r = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(clipSegment([-5, 5], [5, 5], r)).toEqual([[0, 5], [5, 5]]);
    expect(clipSegment([-5, 5], [-1, 5], r)).toBe(null);
    expect(clipSegment([2, 2], [8, 8], r)).toEqual([[2, 2], [8, 8]]);
  });

  it("clipRun keeps the inside pieces and lands the cut exactly on the edge", () => {
    const r = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const runs = clipRun([[-4, 5], [4, 5], [14, 5]], r);
    expect(runs.length).toBe(1);
    expect(runs[0][0]).toEqual([0, 5]);
    expect(runs[0][runs[0].length - 1]).toEqual([10, 5]);
    // a run that leaves and re-enters becomes TWO runs, not one bridged lie
    expect(clipRun([[2, 2], [20, 2], [20, 6], [2, 6]], r).length).toBe(2);
  });

  it("two adjacent tiles' halves of one contour MEET on the shared edge", () => {
    // A smooth ramp: contours are straight verticals, so the crossing point on the
    // shared edge is exact and any mismatch is a real defect, not float noise.
    const g = grid(120, 60, (i, j) => i * 0.5 + j * 0.02);
    const left = buildContours(g, { clip: { x0: 8, y0: 8, x1: 60, y1: 52 } });
    const right = buildContours(g, { clip: { x0: 60, y0: 8, x1: 112, y1: 52 } });
    const edgePoints = (out) => out.levels.flatMap((l) =>
      l.lines.flatMap((line) => line.filter((p) => Math.abs(p[0] - 60) < 1e-9)));
    const l = edgePoints(left), r = edgePoints(right);
    expect(l.length).toBeGreaterThan(0);
    expect(r.length).toBeGreaterThan(0);
    for (const p of l) expect(r.some((q) => Math.abs(q[1] - p[1]) < 1e-9)).toBe(true);
    // and nothing escapes its own tile
    for (const lv of left.levels) for (const line of lv.lines) for (const p of line) {
      expect(p[0]).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(p[0]).toBeLessThanOrEqual(60 + 1e-9);
    }
  });

  it("joinSeams stitches the two halves back into one polyline", () => {
    const halves = [[[0, 0], [1, 1]], [[1, 1], [2, 3]], [[9, 9], [8, 8]]];
    const joined = joinSeams(halves, 1e-9);
    expect(joined.length).toBe(2);
    const long = joined.find((l) => l.length === 3);
    expect(long).toEqual([[0, 0], [1, 1], [2, 3]]);
  });

  it("joinSeams leaves closed rings alone and is order-independent", () => {
    const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
    expect(joinSeams([ring], 1e-9)).toEqual([ring]);
    const a = joinSeams([[[0, 0], [1, 1]], [[1, 1], [2, 2]]], 1e-9);
    const b = joinSeams([[[1, 1], [2, 2]], [[0, 0], [1, 1]]], 1e-9);
    expect(a[0].length).toBe(b[0].length);
  });
});

// ---------------------------------------------------------------------------
describe("labels are ANCHORED to the contour, not re-rolled per view (NEW-2)", () => {
  it("anchorLabels puts anchors at fixed arc steps, on real vertices", () => {
    const run = [];
    for (let i = 0; i <= 1200; i++) run.push([i, 0]);       // 1200 cells of arc
    const anchors = anchorLabels(run, { arcStep: 500, minRun: 12 });
    expect(anchors.map((a) => a.anchorIndex)).toEqual([0, 1]); // 250 and 750 along 1200
    expect(anchors[0].px).toBeCloseTo(250, 0);
    expect(anchors[1].px).toBeCloseTo(750, 0);
    for (const a of anchors) expect(run.some((p) => p[0] === a.px && p[1] === a.py)).toBe(true);
  });

  it("a short run still gets exactly one anchor, at its middle", () => {
    const run = [[0, 0], [20, 0], [40, 0]];
    const anchors = anchorLabels(run, { arcStep: 500, minRun: 12 });
    expect(anchors.length).toBe(1);
    expect(anchors[0].px).toBe(20);
  });

  it("a speck gets NO label", () => {
    expect(anchorLabels([[0, 0], [3, 0]], { arcStep: 500, minRun: 12 })).toEqual([]);
  });

  it("the same grid always anchors the same labels (no viewport in the choice)", () => {
    const g = grid(120, 60, (i, j) => i * 0.5 + j * 0.02);
    const a = buildContours(g, { clip: { x0: 8, y0: 8, x1: 112, y1: 52 } });
    const b = buildContours(g, { clip: { x0: 8, y0: 8, x1: 112, y1: 52 } });
    expect(a.labels).toEqual(b.labels);
    expect(a.labels.length).toBeGreaterThan(0);
    for (const lab of a.labels) {
      expect(lab.level % 5).toBe(0);              // index contours only
      expect(lab.anchor).toMatch(/^\d+:\d+$/);    // "<lineIndex>:<anchorIndex>"
    }
  });
});

// ---------------------------------------------------------------------------
describe("a contour can never stamp its number twice (NEW-1)", () => {
  it("the unit is appended ONCE, at format time, and nowhere else", () => {
    expect(contourLabelText(150)).toBe("150 ft");
    expect(contourLabelText(150.25)).toBe("150.3 ft");
    expect(contourLabelText(null)).toBe("");
    // the exact reported artifact: "150 ft ft" must be unreachable from the formatter
    for (const lv of [0, 5, 150, 155, -3, 1234.5]) {
      expect(contourLabelText(lv)).not.toMatch(/ft\s+ft/);
      expect((contourLabelText(lv).match(/ft/g) || []).length).toBe(1);
    }
  });

  it("no rendered label — for ANY label set the paint path could hand it — doubles the unit", () => {
    const labels = [150, 150, 155, 155, 160].map((level, i) => ({
      level, anchor: `${i}:0`, tileKey: "dem:L17:1,1", ll: [29.78 + i * 0.01, -95.79],
    }));
    const html = pickLabels(labels, { cap: 60 }).map((l) => contourLabelText(l.level)).join(" | ");
    expect(html).not.toMatch(/ft\s+ft/);
  });

  it("pickLabels dedupes on (level, tileKey, anchor) — a duplicated artifact stamps once", () => {
    const one = { level: 150, anchor: "0:0", tileKey: "dem:L17:1,1", ll: [29.78, -95.79] };
    const out = pickLabels([one, { ...one }, { ...one }], { cap: 60 });
    expect(out.length).toBe(1);
  });

  it("the SAME label from a different tile is a different label (seams still label)", () => {
    const a = { level: 150, anchor: "0:0", tileKey: "dem:L17:1,1", ll: [29.78, -95.79] };
    const b = { ...a, tileKey: "dem:L17:2,1", ll: [29.9, -95.6] };
    expect(pickLabels([a, b], { cap: 60 }).length).toBe(2);
  });

  it("the surviving set does not depend on the order tiles resolved in", () => {
    const mk = (t, lv, k, lat) => ({ level: lv, anchor: `${k}:0`, tileKey: t, ll: [lat, -95.79] });
    const labels = [
      mk("dem:L17:2,1", 155, 0, 29.90), mk("dem:L17:1,1", 150, 0, 29.78),
      mk("dem:L17:1,1", 155, 1, 29.84), mk("dem:L17:2,1", 150, 1, 29.96),
    ];
    const forward = pickLabels(labels, { cap: 60 }).map((l) => `${l.tileKey}|${l.level}`);
    const reversed = pickLabels(labels.slice().reverse(), { cap: 60 }).map((l) => `${l.tileKey}|${l.level}`);
    expect(reversed).toEqual(forward);
  });

  it("two tiles do not both label either side of a seam (same level, too close)", () => {
    const a = { level: 150, anchor: "0:0", tileKey: "dem:L17:1,1", ll: [29.7800, -95.7900] };
    const b = { level: 150, anchor: "0:0", tileKey: "dem:L17:2,1", ll: [29.7801, -95.7901] };
    expect(pickLabels([a, b], { minSepDeg: 0.001, cap: 60 }).length).toBe(1);
    // a DIFFERENT level at the same spot is information, not a duplicate — it stays
    expect(pickLabels([a, { ...b, level: 155 }], { minSepDeg: 0.001, cap: 60 }).length).toBe(2);
  });

  it("the cap is a display bound, applied AFTER anchoring", () => {
    const labels = Array.from({ length: 40 }, (_, i) => ({
      level: 150, anchor: `${i}:0`, tileKey: "t", ll: [29.78 + i, -95.79],
    }));
    expect(pickLabels(labels, { cap: 5 }).length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
describe("drainage arrows stay evenly spaced across a tile seam", () => {
  it("the sample lattice is phased to the WORLD, not to the tile", () => {
    const g = grid(80, 80, (i, j) => 100 - i * 0.05 - j * 0.01);
    const opts = { cellMeters: 2.4, groundK: 0.868, spacingCells: 10, marginCells: 8, minSlope: 0 };
    const region = { x0: 8, y0: 8, x1: 72, y1: 72 };
    // tile whose local (0,0) is world cell 3 → samples land where (3 + x) % 10 === 0
    const arrows = flowArrows(g, { ...opts, region, originCellX: 3, originCellY: 3 });
    for (const a of arrows) {
      expect((3 + Math.floor(a.px)) % 10).toBe(0);
      expect((3 + Math.floor(a.py)) % 10).toBe(0);
    }
    expect(arrows.length).toBeGreaterThan(0);
  });

  it("no arrow lands outside the tile's own interior square", () => {
    const g = grid(80, 80, (i, j) => 100 - i * 0.05 - j * 0.01);
    const region = { x0: 8, y0: 8, x1: 40, y1: 40 };
    const arrows = flowArrows(g, {
      cellMeters: 2.4, groundK: 0.868, spacingCells: 10, marginCells: 8, minSlope: 0,
      region, originCellX: 0, originCellY: 0,
    });
    expect(arrows.length).toBeGreaterThan(0);
    for (const a of arrows) {
      expect(a.px).toBeGreaterThanOrEqual(8);
      expect(a.px).toBeLessThan(41);
      expect(a.py).toBeGreaterThanOrEqual(8);
      expect(a.py).toBeLessThan(41);
    }
  });

  it("omitting the lattice options leaves the pre-existing behaviour untouched", () => {
    const g = grid(80, 80, (i, j) => 100 - i * 0.05 - j * 0.01);
    const o = { cellMeters: 2.4, groundK: 0.868, spacingCells: 10, marginCells: 8, minSlope: 0 };
    expect(flowArrows(g, o)).toEqual(flowArrows(g, { ...o, region: null }));
  });
});

// ---------------------------------------------------------------------------
// Source-text pins. terrainLayers.js is Leaflet glue — vitest cannot execute it — but
// the two things that made this bug possible are visible in the text, and BOTH of these
// fail against the pre-fix file (which had only the `if (!map) return` mount guard and
// asked gridRequest for a viewport-sized tile).
describe("terrainLayers — the supersession token and the lattice are wired (regression pins)", () => {
  const src = read("../src/workspaces/site-planner/lib/terrainLayers.js");

  it("takes a supersession token per refresh and bails after the await", () => {
    expect(src).toMatch(/const mySeq = \+\+paintSeq;/);
    expect(src).toMatch(/if \(mySeq !== paintSeq\) return;/);
  });

  it("invalidates in-flight computes on removal and at the zoom gate", () => {
    const onRemove = src.slice(src.indexOf("group.onRemove"));
    expect(onRemove).toMatch(/paintSeq\+\+;/);
    const gate = src.slice(src.indexOf("z < TERRAIN_MIN_ZOOM"), src.indexOf("const b = map.getBounds()"));
    expect(gate).toMatch(/paintSeq\+\+;/);
  });

  it("keeps the mount guard AND does not abort the shared cached fetch", () => {
    expect(src).toMatch(/if \(!map\) return;/);
    expect(src).not.toMatch(/AbortController[\s\S]{0,200}computeTile/);
  });

  it("drives the view off the fixed lattice, never a viewport-sized grid request", () => {
    expect(src).toMatch(/latticeCover\(/);
    // gridRequest survives for the SITE envelope grid (B808) only
    const viewHalf = src.slice(src.indexOf("function terrainLayer"));
    expect(viewHalf).not.toMatch(/gridRequest\(/);
  });

  it("composes geometry and labels atomically and diffs them against what's painted, so a label can never outlive its lines", () => {
    expect(src).toMatch(/const \{ items, n \} = render\(/);
    expect(src).toMatch(/const \{ add, remove \} = diffKeyedPaint\(items, painted\);/);
    // the label's text arrives pre-formatted from composeContourPaint — the render path
    // has no way to concatenate a second unit onto it
    expect(src).toMatch(/composeContourPaint\(parts\)/);
    expect(src).toMatch(/labelIcon\(lab\.text\)/);
    expect(src).not.toMatch(/\$\{[^}]*level[^}]*\}\s*ft/);
  });

  it("bounds how many tile fetches a single view may open at once", () => {
    expect(src).toMatch(/MAX_CONCURRENT_TILES/);
    expect(src).toMatch(/acquireSlot\(\)/);
  });
});

// ---------------------------------------------------------------------------
// END-TO-END over the REAL captured 3DEP tile (test/fixtures/dep-katy-463x400.lerc) —
// the same bytes V240 validated B704's accuracy against. This drives the exact pipeline
// the map paints (decode → smooth → trace per lattice tile → composeContourPaint), so
// the NEW-1 guarantees are EXERCISED here rather than merely pinned in source text.
describe("real 3DEP tile, two lattice tiles, the paint the map would draw", () => {
  const fixtureGrid = () => {
    const p = fileURLToPath(new URL("./fixtures/dep-katy-463x400.lerc", import.meta.url));
    const b = readFileSync(p);
    return decodeGrid(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      { width: 463, height: 400 });
  };
  // Two side-by-side "tiles" over the fixture, each with an 8-cell margin, sharing the
  // interior edge at x = 232 — the geometry a real lattice produces.
  const traceTile = (g, smoothed, key, interior) => {
    const req = {
      bbox: { xmin: 0, ymin: 0, xmax: g.width, ymax: g.height }, cellMeters: 1,
      width: g.width, height: g.height,
    };
    const c = buildContours({ values: smoothed, mask: g.mask, width: g.width, height: g.height },
      { clip: interior });
    const toLL = (px, py) => {
      const [lat, lng] = pixelToLatLng(req, px, py);
      return [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6];
    };
    return {
      tile: { key, cellMeters: 2.4, bbox: { ymin: 3470000, ymax: 3471000 } },
      data: {
        contours: {
          interval: c.interval,
          levels: c.levels.map((l) => ({
            level: l.level, isIndex: l.isIndex,
            lines: l.lines.map((line) => line.map((q) => toLL(q[0], q[1]))),
          })),
          labels: c.labels.map((lb) => ({ ll: toLL(lb.px, lb.py), level: lb.level, anchor: lb.anchor })),
        },
      },
    };
  };
  const parts = () => {
    const g = fixtureGrid();
    const smoothed = maskedSmooth(g.values, g.mask, g.width, g.height, 1.0);
    return [
      traceTile(g, smoothed, "dem:L17:100,50", { x0: 8, y0: 8, x1: 232, y1: 392 }),
      traceTile(g, smoothed, "dem:L17:101,50", { x0: 232, y0: 8, x1: 455, y1: 392 }),
    ];
  };

  it("paints lines and labels, and every label carries the unit exactly once", () => {
    const out = composeContourPaint(parts());
    expect(out.lines.length).toBeGreaterThan(10);
    expect(out.labels.length).toBeGreaterThan(0);
    for (const lab of out.labels) {
      expect(lab.text).toMatch(/^-?\d+(\.\d)? ft$/);
      expect(lab.text).not.toMatch(/ft\s+ft/);
      expect((lab.text.match(/ft/g) || []).length).toBe(1);
    }
  });

  it("a SUPERSEDED artifact painted alongside the live one cannot double-stamp", () => {
    // The exact NEW-1 failure mode: a compute from the previous view resolves late and
    // its labels reach the paint pass together with the current view's.
    const live = parts();
    const doubled = [...live, ...live.map((p) => ({ ...p }))];
    const clean = composeContourPaint(live);
    const withGhost = composeContourPaint(doubled);
    expect(withGhost.labels.length).toBe(clean.labels.length);
    const ids = withGhost.labels.map((l) => `${l.level}@${l.ll[0]},${l.ll[1]}`);
    expect(new Set(ids).size).toBe(ids.length);   // no two labels share a level AND a spot
    expect(withGhost.labels.map((l) => l.text).join(" ")).not.toMatch(/ft\s+ft/);
  });

  it("the paint is identical however the tiles happened to resolve", () => {
    const a = composeContourPaint(parts());
    const b = composeContourPaint(parts().reverse());
    expect(b.labels).toEqual(a.labels);
    expect(b.lines).toEqual(a.lines);   // geometry too, not just the count
  });

  it("the same ground traced twice gives byte-identical labels (no re-roll)", () => {
    expect(composeContourPaint(parts()).labels).toEqual(composeContourPaint(parts()).labels);
  });

  it("halves cut at the shared tile edge come back as ONE polyline", () => {
    const p = parts();
    const joined = composeContourPaint(p).lines.length;
    // …versus leaving every tile's pieces separate, which is what the raw artifacts hold
    const raw = p.reduce((n, { data }) =>
      n + data.contours.levels.reduce((m, l) => m + l.lines.length, 0), 0);
    expect(joined).toBeLessThan(raw);
  });

  // -------------------------------------------------------------------------
  // NEW-1 (perf) — the incremental-paint identity: a moveend used to clearLayers() and
  // rebuild EVERY polyline and label in view even when only one tile at the fringe
  // changed. contourLineKey/contourLabelKey/diffKeyedPaint are what let the caller
  // (terrainLayers.js's paint()) reuse the Leaflet objects for anything whose key hasn't
  // changed, over the SAME real captured tile these composeContourPaint tests already use.
  const keysFor = (ps) => {
    const { lines, labels } = composeContourPaint(ps);
    return new Set([...lines.map(contourLineKey), ...labels.map(contourLabelKey)]);
  };

  it("contourLineKey/contourLabelKey are stable for identical geometry and distinguish real differences", () => {
    const ln = { level: 150, coords: [[29.78, -95.79], [29.781, -95.791], [29.782, -95.792]] };
    expect(contourLineKey(ln)).toBe(contourLineKey({ level: 150, coords: ln.coords.map((p) => [...p]) }));
    expect(contourLineKey(ln)).not.toBe(contourLineKey({ ...ln, level: 155 }));
    expect(contourLineKey(ln)).not.toBe(contourLineKey({ ...ln, coords: [...ln.coords, [29.783, -95.793]] }));
    const lab = { level: 150, ll: [29.78, -95.79] };
    expect(contourLabelKey(lab)).toBe(contourLabelKey({ level: 150, ll: [...lab.ll] }));
    expect(contourLabelKey(lab)).not.toBe(contourLabelKey({ ...lab, level: 155 }));
    expect(contourLabelKey(lab)).not.toBe(contourLabelKey({ ...lab, ll: [29.79, -95.79] }));
  });

  it("diffKeyedPaint only adds genuinely new keys and only removes genuinely vanished ones — a shared key is touched at all", () => {
    const prev = new Map([["a", "layer-a"], ["b", "layer-b"]]);
    const { add, remove } = diffKeyedPaint([{ key: "b" }, { key: "c" }], prev);
    expect(add.map((i) => i.key)).toEqual(["c"]);
    expect(remove).toEqual(["a"]);
  });

  it("repainting the identical view is a total no-op for the incremental diff — nothing to add, nothing to remove", () => {
    const ps = parts();
    const prevKeys = keysFor(ps);          // what a first paint would have left behind
    const items = [...keysFor(ps)].map((key) => ({ key })); // a second, identical repaint
    const { add, remove } = diffKeyedPaint(items, prevKeys);
    expect(add).toEqual([]);
    expect(remove).toEqual([]);
  });

  it("dropping the far tile only retires keys that actually touched it — untouched geometry keeps its identity", () => {
    const both = parts();
    const keysBoth = keysFor(both);
    const keysNear = keysFor([both[0]]); // as if the far tile just panned out of the lattice cover
    const survivors = [...keysNear].filter((k) => keysBoth.has(k));
    // some of the near tile's own contours never touch the shared seam with the far tile,
    // so their identity is unaffected by the far tile leaving — those must NOT be rebuilt
    expect(survivors.length).toBeGreaterThan(0);
    expect(survivors.length).toBeLessThan(keysNear.size); // and the seam-joined chains DO change, honestly
  });
});

// ---------------------------------------------------------------------------
// B800849 (perf) — composeContourPaint's own per-level recomposition (byLevel grouping,
// joinSeams' seam-stitch, pickLabels' dedupe/thinning) used to re-derive its SORT KEY on
// every comparator call inside `.sort()` — an O(n log n) quantity of redundant string
// builds for what only needed to happen O(n) times — profiled as the dominant remaining
// cost of a real pan step once B800848 stopped rebuilding unchanged Leaflet objects.
// joinSeams/pickLabels now build each item's sort key ONCE (a Schwartzian transform) and
// joinSeams' seam-stitch search returns its first match directly instead of collecting a
// `hits` array first — neither change touches WHICH order things sort into or WHICH
// candidate a saddle resolves to, so the fix must produce byte-identical output to the
// pre-optimization algorithm on every input. This is proven directly, not just implied:
// `joinSeamsReference`/`pickLabelsReference` below are a LITERAL copy of the pre-B800849
// algorithm (same rank/id functions, same re-derive-in-comparator pattern, same
// collect-then-scan seam search), run against the real captured 3DEP tile spread over
// EIGHT lattice tiles (more junctions/saddles than the 2-tile fixture above exercises)
// and compared byte-for-byte to the shipped functions.
describe("B800849 — composeContourPaint's join/pick optimization is byte-identical to the pre-fix algorithm", () => {
  function joinSeamsReference(lines, eps = 2e-6) {
    const out = [], open = [];
    for (const ln of lines) {
      if (!ln || ln.length < 2) continue;
      const a = ln[0], b = ln[ln.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) out.push(ln);
      else open.push(ln);
    }
    const rank = (ln) => `${ln[0][0]},${ln[0][1]}|${ln[ln.length - 1][0]},${ln[ln.length - 1][1]}|${ln.length}`;
    const byRank = (x, y) => (rank(x) < rank(y) ? -1 : rank(x) > rank(y) ? 1 : 0);
    open.sort(byRank);
    out.sort(byRank);
    const bucket = new Map();
    const key = (p) => `${Math.round(p[0] / eps)}|${Math.round(p[1] / eps)}`;
    open.forEach((ln, i) => {
      for (const [p, end] of [[ln[0], 0], [ln[ln.length - 1], 1]]) {
        const k = key(p);
        let l = bucket.get(k);
        if (!l) bucket.set(k, l = []);
        l.push({ i, end });
      }
    });
    const near = (p) => {
      const bx = Math.round(p[0] / eps), by = Math.round(p[1] / eps);
      const hits = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const l = bucket.get(`${bx + dx}|${by + dy}`);
          if (l) for (const r of l) hits.push(r);
        }
      }
      return hits;
    };
    const meets = (p, r) => Math.abs(p[0] - r[0]) <= eps && Math.abs(p[1] - r[1]) <= eps;
    const used = new Array(open.length).fill(false);
    for (let i = 0; i < open.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      let chain = open[i].slice();
      for (const forward of [true, false]) {
        for (let guard = 0; guard < 256; guard++) {
          const tip = forward ? chain[chain.length - 1] : chain[0];
          let hit = null;
          for (const ref of near(tip)) {
            if (used[ref.i]) continue;
            const cand = open[ref.i];
            if (meets(tip, ref.end === 0 ? cand[0] : cand[cand.length - 1])) { hit = ref; break; }
          }
          if (!hit) break;
          used[hit.i] = true;
          const seg = hit.end === 0 ? open[hit.i] : open[hit.i].slice().reverse();
          chain = forward ? chain.concat(seg.slice(1)) : seg.slice(1).reverse().concat(chain);
        }
      }
      out.push(chain);
    }
    return out;
  }

  function pickLabelsReference(labels, { minSepDeg = 0, cap = LABEL_CAP } = {}) {
    const id = (l) => `${l.tileKey || ""}|${l.level}|${l.anchor || ""}`;
    const sorted = labels.slice().sort((a, b) => (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0));
    const seen = new Set(), out = [];
    for (const lab of sorted) {
      const k = id(lab);
      if (seen.has(k)) continue;
      seen.add(k);
      if (minSepDeg > 0) {
        const kx = Math.cos((lab.ll[0] * Math.PI) / 180);
        const crowded = out.some((o) => o.level === lab.level &&
          Math.hypot((o.ll[1] - lab.ll[1]) * kx, o.ll[0] - lab.ll[0]) < minSepDeg);
        if (crowded) continue;
      }
      out.push(lab);
      if (out.length >= cap) break;
    }
    return out;
  }

  function composeContourPaintReference(parts, { cap = LABEL_CAP, minSepCells = LABEL_MIN_SEP_CELLS } = {}) {
    const byLevel = new Map();
    const labels = [];
    let cellMeters = 0, lat = 0;
    for (const { tile, data } of parts || []) {
      const c = data && data.contours;
      if (!tile || !c || !c.levels) continue;
      if (tile.cellMeters > cellMeters) cellMeters = tile.cellMeters;
      if (tile.bbox) lat = mercYToLat((tile.bbox.ymin + tile.bbox.ymax) / 2);
      for (const lv of c.levels) {
        let e = byLevel.get(lv.level);
        if (!e) byLevel.set(lv.level, e = { level: lv.level, isIndex: lv.isIndex, lines: [] });
        for (const line of lv.lines) e.lines.push(line);
      }
      for (const lab of c.labels || []) labels.push({ ...lab, tileKey: tile.key });
    }
    const lines = [];
    for (const e of [...byLevel.values()].sort((a, b) => a.level - b.level)) {
      for (const coords of joinSeamsReference(e.lines)) lines.push({ coords, level: e.level, isIndex: e.isIndex });
    }
    const minSepDeg = cellMeters
      ? (minSepCells * cellMeters * groundScaleForTest(lat) * 180) / (Math.PI * WEB_MERC_R_FOR_TEST) : 0;
    return {
      lines,
      labels: pickLabelsReference(labels, { minSepDeg, cap })
        .map((l) => ({ ll: l.ll, level: l.level, text: contourLabelText(l.level) })),
    };
  }
  const WEB_MERC_R_FOR_TEST = 6378137;
  const groundScaleForTest = (lat) => Math.cos((lat * Math.PI) / 180);

  // Spread the SAME real captured tile over an 8-tile grid (like a realistic wide-view
  // lattice cover) — more interior seams than the 2-tile fixture above, so more chances
  // for a multi-candidate saddle to expose an order difference if one existed.
  const eightTileParts = () => {
    const p = fileURLToPath(new URL("./fixtures/dep-katy-463x400.lerc", import.meta.url));
    const bytes = readFileSync(p);
    const g = decodeGrid(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      { width: 463, height: 400 });
    const smoothed = maskedSmooth(g.values, g.mask, g.width, g.height, 1.0);
    const req = { bbox: { xmin: 0, ymin: 0, xmax: g.width, ymax: g.height }, cellMeters: 1, width: g.width, height: g.height };
    const toLL = (px, py) => {
      const [lat, lng] = pixelToLatLng(req, px, py);
      return [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6];
    };
    const cols = 4, rows = 2;
    const wStep = (g.width - 16) / cols, hStep = (g.height - 16) / rows;
    const out = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const interior = { x0: 8 + c * wStep, y0: 8 + r * hStep, x1: 8 + (c + 1) * wStep, y1: 8 + (r + 1) * hStep };
        const cc = buildContours({ values: smoothed, mask: g.mask, width: g.width, height: g.height }, { clip: interior });
        out.push({
          tile: { key: `dem:L17:${100 + c},${50 + r}`, cellMeters: 2.4, bbox: { ymin: 3470000, ymax: 3471000 } },
          data: {
            contours: {
              interval: cc.interval,
              levels: cc.levels.map((l) => ({ level: l.level, isIndex: l.isIndex, lines: l.lines.map((line) => line.map((q) => toLL(q[0], q[1]))) })),
              labels: cc.labels.map((lb) => ({ ll: toLL(lb.px, lb.py), level: lb.level, anchor: lb.anchor })),
            },
          },
        });
      }
    }
    return out;
  };

  it("composeContourPaint (shipped) equals composeContourPaintReference (pre-fix algorithm) — byte-identical, real 8-tile cover", () => {
    const parts = eightTileParts();
    const shipped = composeContourPaint(parts);
    const reference = composeContourPaintReference(parts);
    expect(shipped.lines).toEqual(reference.lines);
    expect(shipped.labels).toEqual(reference.labels);
    // Not a vacuous comparison — the fixture must actually exercise real joined lines.
    expect(shipped.lines.length).toBeGreaterThan(20);
  });

  it("joinSeams (shipped) equals joinSeamsReference for every level in the real 8-tile cover", () => {
    const parts = eightTileParts();
    const byLevel = new Map();
    for (const { data } of parts) {
      for (const lv of data.contours.levels) {
        let e = byLevel.get(lv.level);
        if (!e) byLevel.set(lv.level, e = []);
        for (const line of lv.lines) e.push(line);
      }
    }
    expect(byLevel.size).toBeGreaterThan(5); // exercising more than a token single level
    for (const lines of byLevel.values()) {
      expect(joinSeams(lines)).toEqual(joinSeamsReference(lines));
    }
  });

  it("pickLabels (shipped) equals pickLabelsReference over the real 8-tile cover's labels", () => {
    const parts = eightTileParts();
    const labels = [];
    for (const { tile, data } of parts) for (const lab of data.contours.labels) labels.push({ ...lab, tileKey: tile.key });
    expect(labels.length).toBeGreaterThan(10);
    const shipped = pickLabels(labels, { minSepDeg: 0.0005, cap: 60 });
    const reference = pickLabelsReference(labels, { minSepDeg: 0.0005, cap: 60 });
    expect(shipped).toEqual(reference);
  });
});
