import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  gridRequest, exportUrl, looksLikeLerc, decodeGrid, maskedSmooth,
  pixelToMerc, mercToPixel, pixelToLatLng, sampleAtLatLng,
  lngToMercX, latToMercY, mercXToLng, mercYToLat, groundScale, mercPerPx,
  CELL_PX, MARGIN_CELLS, MAX_GRID,
} from "../src/workspaces/site-planner/lib/demGrid.js";
import { M_TO_FT } from "../src/workspaces/site-planner/lib/elevation.js";

const fixturePath = fileURLToPath(new URL("./fixtures/dep-katy-463x400.lerc", import.meta.url));
const fixtureBuf = () => {
  const b = readFileSync(fixturePath);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

// A hand-built request for synthetic-grid tests: 1 m cells anchored at the origin.
const synthReq = (width, height) => ({
  bbox: { xmin: 0, ymin: 0, xmax: width, ymax: height }, cellMeters: 1, width, height,
});

// ---------------------------------------------------------------------------
describe("mercator helpers", () => {
  it("round-trips lng/lat through mercator", () => {
    expect(mercXToLng(lngToMercX(-95.795))).toBeCloseTo(-95.795, 9);
    expect(mercYToLat(latToMercY(29.782))).toBeCloseTo(29.782, 9);
  });
  it("groundScale at Houston is ~0.868 (mercator meters are stretched 1/cos φ)", () => {
    expect(groundScale(29.78)).toBeCloseTo(0.868, 2);
  });
  it("mercPerPx halves per zoom level", () => {
    expect(mercPerPx(17)).toBeCloseTo(mercPerPx(16) / 2, 9);
  });
});

// ---------------------------------------------------------------------------
describe("gridRequest — deterministic snapped tiles (key <-> bbox bijection)", () => {
  const katy = { west: -95.80, south: 29.775, east: -95.78, north: 29.790 };
  it("same view -> same key and same bbox (byte-identical request)", () => {
    const a = gridRequest(katy, 16), b = gridRequest({ ...katy }, 16);
    expect(a.key).toBe(b.key);
    expect(a.bbox).toEqual(b.bbox);
    expect(a.width).toBe(b.width);
  });
  it("a pan INSIDE the snap quantum reuses the identical tile (pure cache hit)", () => {
    const a = gridRequest(katy, 16);
    const nudge = mercXToLng(lngToMercX(katy.west) + a.cellMeters * 3) - katy.west;
    const b = gridRequest({ ...katy, west: katy.west + nudge, east: katy.east + nudge }, 16);
    expect(b.key).toBe(a.key);
  });
  it("the tile COVERS the view plus the smoothing margin", () => {
    const r = gridRequest(katy, 16);
    expect(r.bbox.xmin).toBeLessThan(lngToMercX(katy.west));
    expect(r.bbox.xmax).toBeGreaterThan(lngToMercX(katy.east));
    expect(r.bbox.ymin).toBeLessThan(latToMercY(katy.south));
    expect(r.bbox.ymax).toBeGreaterThan(latToMercY(katy.north));
    // margin baked in: at least MARGIN_CELLS beyond the snapped view on every side
    expect((lngToMercX(katy.west) - r.bbox.xmin) / r.cellMeters).toBeGreaterThanOrEqual(MARGIN_CELLS);
  });
  it("bbox aspect EXACTLY matches the pixel aspect (no server-side bbox adjustment)", () => {
    const r = gridRequest(katy, 16);
    const bw = r.bbox.xmax - r.bbox.xmin, bh = r.bbox.ymax - r.bbox.ymin;
    expect(bw / bh).toBeCloseTo(r.width / r.height, 12);
    expect(bw / r.width).toBeCloseTo(r.cellMeters, 9);
  });
  it("cell size tracks the zoom at ~CELL_PX screen px per cell", () => {
    const r = gridRequest(katy, 16);
    expect(r.cellMeters).toBeCloseTo(mercPerPx(16) * CELL_PX, 9);
  });
  it("an oversized viewport coarsens deterministically instead of exploding", () => {
    const huge = { west: -96.4, south: 29.3, east: -94.9, north: 30.2 }; // whole-metro box
    const r = gridRequest(huge, 16);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(MAX_GRID + 2 * MARGIN_CELLS);
    expect(r.key).toContain("k"); // coarsening factor is part of the key
    expect(gridRequest(huge, 16).key).toBe(r.key);
  });
});

// ---------------------------------------------------------------------------
describe("exportUrl — the exact request shape probed against the live service", () => {
  it("carries lerc/F32/None/bilinear/no-adjust and the request's own size + bbox", () => {
    const r = gridRequest({ west: -95.80, south: 29.775, east: -95.78, north: 29.790 }, 16);
    const u = exportUrl(r);
    expect(u).toContain("/exportImage?");
    expect(u).toContain(`bbox=${r.bbox.xmin},${r.bbox.ymin},${r.bbox.xmax},${r.bbox.ymax}`);
    expect(u).toContain(`size=${r.width},${r.height}`);
    expect(u).toContain("format=lerc");
    expect(u).toContain("pixelType=F32");
    expect(u).toContain("adjustAspectRatio=false");
    expect(u).toContain("interpolation=RSP_BilinearInterpolation");
    expect(u).toContain(encodeURIComponent('{"rasterFunction":"None"}'));
    expect(u).toContain("bboxSR=3857");
  });
  it("routes through whatever base the caller picked (proxy vs direct)", () => {
    const r = synthReq(4, 4);
    expect(exportUrl(r, "/api/gis-cache/svc/abc")).toMatch(/^\/api\/gis-cache\/svc\/abc\/exportImage/);
  });
});

// ---------------------------------------------------------------------------
describe("looksLikeLerc / decodeGrid — the real captured 3DEP tile", () => {
  it("sniffs LERC magic and rejects HTML/garbage (dev-server fallback trap)", () => {
    expect(looksLikeLerc(fixtureBuf())).toBe(true);
    expect(looksLikeLerc(new TextEncoder().encode("<!doctype html><html>").buffer)).toBe(false);
    expect(looksLikeLerc(new ArrayBuffer(4))).toBe(false);
    expect(looksLikeLerc(null)).toBe(false);
  });
  it("decodes the Katy fixture: 463x400 F32, plausible NAVD88 feet, fully valid", () => {
    const g = decodeGrid(fixtureBuf(), { width: 463, height: 400 });
    expect(g.width).toBe(463);
    expect(g.height).toBe(400);
    expect(g.values).toBeInstanceOf(Float32Array);
    expect(g.values.length).toBe(463 * 400);
    let min = Infinity, max = -Infinity, valid = 0;
    for (let i = 0; i < g.values.length; i++) {
      if (!g.mask[i]) continue;
      valid++;
      if (g.values[i] < min) min = g.values[i];
      if (g.values[i] > max) max = g.values[i];
    }
    expect(valid).toBe(463 * 400);              // suburban tile: no voids
    expect(min).toBeGreaterThan(115);            // ~120.9 ft measured at capture time
    expect(min).toBeLessThan(125);
    expect(max).toBeGreaterThan(145);            // ~149.8 ft
    expect(max).toBeLessThan(155);
    expect(min).toBeCloseTo(36.8488 * M_TO_FT, 1); // metres -> survey feet conversion
  });
  it("REFUSES a size mismatch loudly (a silently adjusted bbox shifts every contour)", () => {
    expect(() => decodeGrid(fixtureBuf(), { width: 100, height: 100 })).toThrow(/size mismatch/);
  });
  it("throws on a non-LERC payload instead of parsing garbage", () => {
    expect(() => decodeGrid(new TextEncoder().encode("<!doctype html>").buffer, null)).toThrow(/LERC/i);
  });
});

// ---------------------------------------------------------------------------
describe("maskedSmooth — normalized masked gaussian", () => {
  it("a constant field stays exactly constant, including at edges (weight renorm)", () => {
    const w = 12, h = 9;
    const vals = new Float32Array(w * h).fill(7.5);
    const mask = new Uint8Array(w * h).fill(1);
    const out = maskedSmooth(vals, mask, w, h, 1.5);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(7.5, 5);
  });
  it("a void never bleeds into valid neighbors (sentinel-proof)", () => {
    const w = 11, h = 11;
    const vals = new Float32Array(w * h).fill(10);
    const mask = new Uint8Array(w * h).fill(1);
    const c = 5 * w + 5;
    vals[c] = -9999; mask[c] = 0;   // hostile value under a void — must be ignored
    const out = maskedSmooth(vals, mask, w, h, 1.2);
    for (let i = 0; i < out.length; i++) {
      if (i === c) continue;
      expect(out[i]).toBeCloseTo(10, 5);
    }
    expect(out[c]).toBe(0);          // void stays void (zeroed, mask carries the truth)
  });
  it("damps single-cell noise (the LiDAR ±0.1-0.3 ft jitter)", () => {
    const w = 15, h = 15;
    const vals = new Float32Array(w * h).fill(100);
    const mask = new Uint8Array(w * h).fill(1);
    vals[7 * w + 7] = 101; // one noisy foot
    const out = maskedSmooth(vals, mask, w, h, 1.0);
    expect(Math.abs(out[7 * w + 7] - 100)).toBeLessThan(0.3);
  });
});

// ---------------------------------------------------------------------------
describe("grid transforms + bilinear sampling (the ONE pixel convention)", () => {
  it("pixelToMerc/mercToPixel round-trip", () => {
    const r = synthReq(10, 8);
    const [x, y] = pixelToMerc(r, 3.25, 2.75);
    expect(mercToPixel(r, x, y)).toEqual([3.25, 2.75]);
    expect(x).toBe(3.25);
    expect(y).toBe(8 - 2.75); // y is flipped: py grows DOWN from ymax
  });
  it("sampleAtLatLng bilinearly interpolates cell CENTERS (matches the calibration)", () => {
    const w = 8, h = 6, r = synthReq(w, h);
    const values = new Float32Array(w * h);
    const mask = new Uint8Array(w * h).fill(1);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) values[j * w + i] = i; // x-ramp
    const grid = { values, mask, width: w, height: h };
    // At continuous pixel px the ramp reads px - 0.5 (value i sits at center i+0.5).
    const [lat, lng] = pixelToLatLng(r, 3.5, 2.5);
    expect(sampleAtLatLng(grid, r, lat, lng)).toBeCloseTo(3.0, 6);
    const [lat2, lng2] = pixelToLatLng(r, 4.0, 2.5);
    expect(sampleAtLatLng(grid, r, lat2, lng2)).toBeCloseTo(3.5, 6);
  });
  it("returns null outside the grid and NEVER interpolates across a void", () => {
    const w = 6, h = 6, r = synthReq(w, h);
    const values = new Float32Array(w * h).fill(50);
    const mask = new Uint8Array(w * h).fill(1);
    mask[2 * w + 2] = 0;
    const grid = { values, mask, width: w, height: h };
    const [latIn, lngIn] = pixelToLatLng(r, 2.9, 2.9);   // one contributing corner void
    expect(sampleAtLatLng(grid, r, latIn, lngIn)).toBeNull();
    const [latOut, lngOut] = pixelToLatLng(r, -3, 2);
    expect(sampleAtLatLng(grid, r, latOut, lngOut)).toBeNull();
    const [latOk, lngOk] = pixelToLatLng(r, 4.5, 4.5);   // far from the void
    expect(sampleAtLatLng(grid, r, latOk, lngOk)).toBeCloseTo(50, 6);
  });
});
