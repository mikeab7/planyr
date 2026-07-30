/* NEW-2 — the screen→ground transform's ABSOLUTE accuracy, and the hover tag's placement.
 *
 * The report, measured live on 2026-07-29 on a real tract against an independent ground
 * truth (each basemap tile carries its z/x/y in its URL and its screen rect is readable, so
 * the exact lat/lng of any screen pixel is computable without trusting either Leaflet or
 * us): the app's answer for a screen pixel sat about ONE CSS PIXEL from the imagery's own
 * answer for that same pixel — 3.7 ft at z18, 4.6 ft at z17, repeatable to a hundredth of a
 * foot, direction changing between zooms. A clean offset, not noise, not a scale error.
 * One pixel is ~3.6 ft at z18 and 10–15 ft at the overview zoom real layout happens at, so
 * the owner's "my placed point lands five to fifteen feet off" and this are ONE defect.
 *
 * These tests pin the two pure halves the fix rests on:
 *   • the registration measurement — how far the drawing has to move to sit exactly on the
 *     basemap, given Leaflet's rounded pixel origin and the overscanned container; and its
 *     sanity gate, which refuses (loudly) anything past the quantisation range instead of
 *     shoving the drawing across the screen.
 *   • the hover tag's placement — offset off the pointer, flipped at every edge, never
 *     clipped, never back under the cursor glyph (NEW-1).
 * The end-to-end residual against the tile grid, at three device pixel ratios, is the
 * committed harness: ui-audit/diagnose-pointer-accuracy.mjs.
 */
import { describe, it, expect } from "vitest";
import {
  basemapWrapPoint, basemapWrapPointTransformed, registrationShift, sanitizeShift,
  REGISTRATION_SANITY_PX, tileNwFeet, lngLatToFeet, mercDeg, ftPerDeg,
} from "../src/workspaces/site-planner/lib/mapLock.js";
import { edgeLockTolFt, EDGE_LOCK_PX, EDGE_LOCK_MAX_FT } from "../src/workspaces/site-planner/lib/edgeConstrain.js";
import {
  hoverLabelPlacement, hoverLabelSize, HOVER_LABEL_GAP_PX,
} from "../src/workspaces/site-planner/lib/contours.js";

/* ── the registration measurement ──────────────────────────────────────────────────── */

/* Leaflet's own arithmetic, reproduced exactly so the test measures what the browser will
 * actually do: the pixel origin is `project(centre) - viewHalf + panePos`, ROUNDED — that
 * `_round()` is the whole-pixel floor — and `viewHalf` comes from clientWidth/Height, which
 * are integers even when the element's CSS size is not. */
const leafletPixelOrigin = ({ worldPx, containerPx, panePos = { x: 0, y: 0 } }) => ({
  x: Math.round(worldPx.x - containerPx.w / 2 + panePos.x),
  y: Math.round(worldPx.y - containerPx.h / 2 + panePos.y),
});

describe("NEW-2 — the drawing↔basemap registration shift", () => {
  it("reads ZERO when Leaflet's rounding happens to be the identity and the halves agree", () => {
    // A container of even integer size, centred on a point whose projection lands on a whole
    // world pixel: nothing to round, and the drawing's half-size equals the map's.
    const worldPx = { x: 1000, y: 2000 };
    const containerPx = { w: 800, h: 600 };
    const panePos = { x: 0, y: 0 };
    const pixelOrigin = leafletPixelOrigin({ worldPx, containerPx, panePos });
    const imgPt = basemapWrapPoint(worldPx, pixelOrigin, panePos, 0);
    const shift = registrationShift(imgPt, { x: containerPx.w / 2, y: containerPx.h / 2 });
    expect(shift.dx).toBeCloseTo(0, 12);
    expect(shift.dy).toBeCloseTo(0, 12);
  });

  it("catches the whole-pixel SNAP — a fractional projection leaves a sub-pixel residual", () => {
    const worldPx = { x: 1000.37, y: 2000.62 };
    const containerPx = { w: 800, h: 600 };
    const panePos = { x: 0, y: 0 };
    const pixelOrigin = leafletPixelOrigin({ worldPx, containerPx, panePos });
    const imgPt = basemapWrapPoint(worldPx, pixelOrigin, panePos, 0);
    const shift = registrationShift(imgPt, { x: containerPx.w / 2, y: containerPx.h / 2 });
    // The residual is exactly the fraction Leaflet rounded away, and it is real but bounded.
    expect(Math.abs(shift.dx)).toBeGreaterThan(0.3);
    expect(Math.abs(shift.dx)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(shift.dy)).toBeGreaterThan(0.3);
    expect(Math.abs(shift.dy)).toBeLessThanOrEqual(0.5);
  });

  it("catches the CONTAINER-CENTRE mismatch — the half that is OURS, not Leaflet's", () => {
    /* The planner asks Leaflet to centre on the feet point under the DRAWING's centre —
     * `size.w / 2`, a float straight off getBoundingClientRect — while the map lands that
     * centre at its OWN half-size, taken from the integer clientWidth. On a fractional CSS
     * width (the norm at a fractional device pixel ratio; the reporting machine runs 2.15)
     * the two halves differ by up to a quarter pixel per axis. Isolated here by giving
     * Leaflet nothing to round, so the ONLY residual left is the mismatch. */
    const cssW = 800.74, cssH = 600.36;            // the drawing's box
    const clientW = Math.round(cssW), clientH = Math.round(cssH); // what Leaflet sees
    const worldPx = { x: 1000 + clientW / 2, y: 2000 + clientH / 2 };
    const panePos = { x: 0, y: 0 };
    const pixelOrigin = leafletPixelOrigin({ worldPx, containerPx: { w: clientW, h: clientH }, panePos });
    expect(pixelOrigin).toEqual({ x: 1000, y: 2000 }); // nothing was rounded away
    const imgPt = basemapWrapPoint(worldPx, pixelOrigin, panePos, 0);
    const shift = registrationShift(imgPt, { x: cssW / 2, y: cssH / 2 });
    expect(shift.dx).toBeCloseTo((clientW - cssW) / 2, 10);
    expect(shift.dy).toBeCloseTo((clientH - cssH) / 2, 10);
    expect(Math.abs(shift.dx)).toBeGreaterThan(0.1);
  });

  it("both contributors together stay inside one pixel per axis — the measured magnitude", () => {
    const cssW = 729.53, cssH = 611.17;
    const clientW = Math.round(cssW), clientH = Math.round(cssH);
    const panePos = { x: -37, y: 12 };
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const worldPx = { x: 1234567 + i * 0.137, y: 7654321 + i * 0.611 };
      const pixelOrigin = leafletPixelOrigin({ worldPx, containerPx: { w: clientW, h: clientH }, panePos });
      const imgPt = basemapWrapPoint(worldPx, pixelOrigin, panePos, 0);
      const s = registrationShift(imgPt, { x: cssW / 2, y: cssH / 2 });
      worst = Math.max(worst, Math.abs(s.dx), Math.abs(s.dy));
    }
    expect(worst).toBeGreaterThan(0.5);   // it genuinely exceeds Leaflet's snap alone…
    expect(worst).toBeLessThan(1.3);      // …and it is bounded at about one pixel, as measured
  });

  it("subtracts the basemap's OVERSCAN so the shift is in canvas-wrapper pixels", () => {
    const worldPx = { x: 1000.4, y: 2000.4 };
    const containerPx = { w: 1200, h: 900 };   // canvas 800×600 inside a 200px overscan
    const panePos = { x: 0, y: 0 };
    const pixelOrigin = leafletPixelOrigin({ worldPx, containerPx, panePos });
    const withOverscan = basemapWrapPoint(worldPx, pixelOrigin, panePos, 200);
    const without = basemapWrapPoint(worldPx, pixelOrigin, panePos, 0);
    expect(withOverscan.x).toBeCloseTo(without.x - 200, 12);
    expect(withOverscan.y).toBeCloseTo(without.y - 200, 12);
    // The wrapper-frame answer is what the drawing's own (800×600) centre compares against.
    const shift = registrationShift(withOverscan, { x: 400, y: 300 });
    expect(Math.abs(shift.dx)).toBeLessThanOrEqual(0.5);
  });

  it("mid-gesture the wrap's own transform CANCELS the snap — only the centre mismatch is left", () => {
    /* During a pan/zoom gesture the basemap is not re-seated; the wrap carries
     * `translate(tx,ty) scale(s)` chosen so the target centre lands on the map's half-size.
     * That algebra removes the pixel-origin remainder, which is why the gesture branch is
     * measured with its own formula rather than assumed equal to the settled one. */
    const cssW = 800, cssH = 600;
    const clientW = 800, clientH = 600;
    const worldPx = { x: 1000.37, y: 2000.62 };
    const panePos = { x: 5, y: -9 };
    const pixelOrigin = leafletPixelOrigin({ worldPx, containerPx: { w: clientW, h: clientH }, panePos });
    const scale = 1.37;
    const p = { x: worldPx.x - pixelOrigin.x + panePos.x, y: worldPx.y - pixelOrigin.y + panePos.y };
    const tx = clientW / 2 - p.x * scale, ty = clientH / 2 - p.y * scale;
    const imgPt = basemapWrapPointTransformed(worldPx, pixelOrigin, panePos, 0, { tx, ty, scale });
    const shift = registrationShift(imgPt, { x: cssW / 2, y: cssH / 2 });
    expect(shift.dx).toBeCloseTo(0, 9);
    expect(shift.dy).toBeCloseTo(0, 9);
  });

  it("REFUSES a shift past the quantisation range instead of shoving the drawing (LOUD-FAILURE)", () => {
    expect(sanitizeShift({ dx: 0.42, dy: -0.31 })).toEqual({ ok: true, reason: null, shift: { dx: 0.42, dy: -0.31 } });
    const big = sanitizeShift({ dx: REGISTRATION_SANITY_PX + 0.01, dy: 0 });
    expect(big.ok).toBe(false);
    expect(big.reason).toBe("out-of-range");
    expect(big.shift).toEqual({ dx: 0, dy: 0 });   // nothing applied — the caller reports it
    const nan = sanitizeShift({ dx: NaN, dy: 0 });
    expect(nan.ok).toBe(false);
    expect(nan.reason).toBe("non-finite");
    expect(nan.shift).toEqual({ dx: 0, dy: 0 });   // a NaN transform can never reach the canvas
  });
});

/* ── NEW-1: the hover tag's placement ──────────────────────────────────────────────── */

const BOX = { x0: 0, y0: 0, x1: 900, y1: 600 };
const SIZE = hoverLabelSize("152 ft");
const rect = (at, place, size = SIZE) => ({
  l: at.x + place.tx, t: at.y + place.ty,
  r: at.x + place.tx + size.w, b: at.y + place.ty + size.h,
});
const inside = (r, box) => r.l >= box.x0 - 1e-9 && r.t >= box.y0 - 1e-9 && r.r <= box.x1 + 1e-9 && r.b <= box.y1 + 1e-9;
// The pointer glyph's own footprint: a grab hand is the big one, and the gap is sized
// against it. If the tag's rect ever intersects this, the number is hidden again.
const glyph = (at, pad = HOVER_LABEL_GAP_PX) => ({ l: at.x - pad, t: at.y - pad, r: at.x + pad, b: at.y + pad });
const overlaps = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

describe("NEW-1 — the hover elevation tag sits BESIDE the pointer, never under it", () => {
  it("defaults up and to the right, clear of the cursor glyph", () => {
    const at = { x: 400, y: 300 };
    const place = hoverLabelPlacement(at, BOX, SIZE);
    expect(place.quadrant).toBe("up-right");
    expect(place.clamped).toBe(false);
    expect(place.tx).toBe(HOVER_LABEL_GAP_PX);            // left edge a full gap to the right
    expect(place.ty).toBe(-HOVER_LABEL_GAP_PX - SIZE.h);  // bottom edge a full gap above
    expect(overlaps(rect(at, place), glyph(at))).toBe(false);
  });

  it("B1095's placement would have FAILED this — proof the test has teeth", () => {
    // The shipped behaviour was a tag centred on the hit point: dead under the pointer.
    const at = { x: 400, y: 300 };
    const centred = { tx: -SIZE.w / 2, ty: -SIZE.h / 2 };
    expect(overlaps(rect(at, centred), glyph(at))).toBe(true);
  });

  it("flips at every edge and corner — never clipped, never back under the glyph", () => {
    const probes = [];
    for (const x of [2, 20, 60, 450, BOX.x1 - 60, BOX.x1 - 20, BOX.x1 - 2]) {
      for (const y of [2, 20, 60, 300, BOX.y1 - 60, BOX.y1 - 20, BOX.y1 - 2]) probes.push({ x, y });
    }
    for (const at of probes) {
      const place = hoverLabelPlacement(at, BOX, SIZE);
      const r = rect(at, place);
      expect(inside(r, BOX), `clipped at ${at.x},${at.y}`).toBe(true);
      expect(overlaps(r, glyph(at)), `covers the pointer at ${at.x},${at.y}`).toBe(false);
    }
  });

  it("near the TOP it drops below the pointer; near the RIGHT it moves to the left", () => {
    const top = hoverLabelPlacement({ x: 400, y: 4 }, BOX, SIZE);
    expect(top.quadrant.startsWith("down")).toBe(true);
    expect(top.ty).toBeGreaterThan(0);
    const right = hoverLabelPlacement({ x: BOX.x1 - 4, y: 300 }, BOX, SIZE);
    expect(right.quadrant.endsWith("left")).toBe(true);
    expect(right.tx).toBeLessThan(0);
  });

  it("respects a RESERVED bottom band — the coordinate chip and scale bar are not overlapped", () => {
    // The planner floats its cursor/elevation chip bottom-left and the scale bar + zoom
    // cluster bottom-right; the layer shrinks the box by that band before placing.
    const reserved = { ...BOX, y1: BOX.y1 - 56 };
    const at = { x: 40, y: BOX.y1 - 10 };            // pointer down inside the chip's row
    const place = hoverLabelPlacement(at, reserved, SIZE);
    expect(rect(at, place).b).toBeLessThanOrEqual(reserved.y1);
    expect(overlaps(rect(at, place), glyph(at))).toBe(false);
  });

  it("a box barely bigger than the tag still yields a legible, unclipped placement", () => {
    const tiny = { x0: 0, y0: 0, x1: SIZE.w + 8, y1: SIZE.h + 8 };
    const at = { x: (SIZE.w + 8) / 2, y: (SIZE.h + 8) / 2 };
    const place = hoverLabelPlacement(at, tiny, SIZE);
    expect(place.clamped).toBe(true);
    expect(inside(rect(at, place), tiny)).toBe(true);
  });

  it("the offset is in SCREEN pixels, so it is the same at every zoom", () => {
    // Same pointer position, same answer — nothing here consults the map scale, which is
    // exactly why the clearance holds at z16 and at z19 alike.
    const a = hoverLabelPlacement({ x: 400, y: 300 }, BOX, hoverLabelSize("152 ft"));
    const b = hoverLabelPlacement({ x: 400, y: 300 }, BOX, hoverLabelSize("152 ft"));
    expect(a).toEqual(b);
    // A longer number gets a wider box, so the fit test scales with the text it will paint.
    expect(hoverLabelSize("1,234.5 ft").w).toBeGreaterThan(hoverLabelSize("12 ft").w);
  });

  it("over-estimates the tag width, so the fit decision can never under-reserve", () => {
    // 700 10px Inter with tabular figures advances just under 6px per digit; the estimate is
    // deliberately above that, because an under-estimate is what would let a tag clip.
    expect(hoverLabelSize("152 ft").w).toBeGreaterThan("152 ft".length * 6);
    expect(hoverLabelSize("").w).toBeGreaterThan(0);
  });
});

/* ── the tile lattice as the reference frame ────────────────────────────────────────── */

describe("NEW-2 — a tile's corner in planner feet is the external reference", () => {
  const LAT0 = 29.77938, LON0 = -95.89503;

  it("agrees with the feet projection for the same corner, exactly", () => {
    // The whole point of measuring against tiles is that a tile's corner has a lat/lng nobody
    // has to be trusted about. That is only useful if it lands in the SAME feet frame drawn
    // geometry lives in — so the two derivations must agree to floating-point noise.
    for (const [z, x, y] of [[16, 15258, 27070], [17, 30517, 54141], [18, 61034, 108283]]) {
      const n = Math.pow(2, z);
      const lng = (x / n) * 360 - 180;
      const merc = 180 - (y / n) * 360;
      const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((merc * Math.PI) / 180)) - Math.PI / 2);
      const viaTile = tileNwFeet(z, x, y, LAT0, LON0);
      const viaLatLng = lngLatToFeet(lng, lat, LON0, LAT0);
      expect(viaTile.x).toBeCloseTo(viaLatLng.x, 6);
      expect(viaTile.y).toBeCloseTo(viaLatLng.y, 6);
    }
  });

  it("a neighbouring tile is exactly one tile-width away, at every zoom", () => {
    for (const z of [14, 16, 18, 20]) {
      const a = tileNwFeet(z, 1000, 2000, LAT0, LON0);
      const b = tileNwFeet(z, 1001, 2000, LAT0, LON0);
      const widthDeg = 360 / Math.pow(2, z);
      expect(b.x - a.x).toBeCloseTo(widthDeg * ftPerDeg(LAT0), 6);
      expect(b.y).toBeCloseTo(a.y, 9);
    }
  });

  it("the world's top-left tile sits at the Mercator square's corner", () => {
    const nw = tileNwFeet(0, 0, 0, LAT0, LON0);
    expect(nw.x).toBeCloseTo((-180 - LON0) * ftPerDeg(LAT0), 3);
    expect(nw.y).toBeCloseTo(-(180 - mercDeg(LAT0)) * ftPerDeg(LAT0), 3);
  });
});

/* ── NEW-2(d): the placement magnet is bounded in the WORLD, not just on screen ─────── */

describe("NEW-2(d) — the boundary magnet's reach is capped in feet", () => {
  it("is a plain screen tolerance at a working zoom", () => {
    // ~0.6 px per foot: 12 px is 20 ft… which is already past the cap, so check a closer zoom.
    expect(edgeLockTolFt(4)).toBeCloseTo(EDGE_LOCK_PX / 4, 9);   // 3 ft
    expect(edgeLockTolFt(2)).toBeCloseTo(EDGE_LOCK_PX / 2, 9);   // 6 ft
  });

  it("STOPS growing as you zoom out — the defect this closes", () => {
    // The overview zoom the owner lays out at is a small fraction of a pixel per foot, where the
    // uncapped tolerance reached tens of feet and could pull a placed point that far with nothing
    // on screen to say so — indistinguishable, from the seat, from "my pointer is off".
    const overview = 0.1471;                      // ≈ zoom 16 at this latitude
    expect(EDGE_LOCK_PX / overview).toBeGreaterThan(80);   // what it used to reach
    expect(edgeLockTolFt(overview)).toBe(EDGE_LOCK_MAX_FT); // what it reaches now
    expect(edgeLockTolFt(0.02)).toBe(EDGE_LOCK_MAX_FT);     // and at the zoom-out limit
  });

  it("never returns a nonsense tolerance for a nonsense scale", () => {
    expect(edgeLockTolFt(0)).toBe(EDGE_LOCK_MAX_FT);
    expect(edgeLockTolFt(-1)).toBe(EDGE_LOCK_MAX_FT);
    expect(edgeLockTolFt(undefined)).toBe(EDGE_LOCK_MAX_FT);
    expect(edgeLockTolFt(NaN)).toBe(EDGE_LOCK_MAX_FT);
  });
});
