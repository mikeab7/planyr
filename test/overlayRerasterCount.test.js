/* B749 — THE RE-RASTER COUNT ACROSS A ZOOM SWEEP, WHICH IS THE THING THAT MUST NOT REGRESS.
 *
 * ⛔ WHY THIS SUITE COUNTS INVOCATIONS AND NOT MILLISECONDS, in the idiom the pond work established
 * (test/pondViewIndependence.js, ui-audit/count-pond-invocations.mjs): a duration budget passes the
 * moment a re-raster that should not happen merely gets cheaper. The defect here is that work runs
 * at all, so the assertion is on how many times it runs.
 *
 * THE MEASURED DEFECT these numbers come from (ui-audit/zoom-reraster-arms.mjs, the owner's real
 * Bain overlay, 1728 × 2592 pt at opacity 0.55 and 1.5° rotation, both his Bain plans):
 *   • one wheel notch is ×1.12 and the effect kept an existing hi-res only within 10%, so every
 *     notch inside the band re-rendered the WHOLE PAGE at up to 5461 × 8192 px — 179 MB of RGBA —
 *     on the main thread;
 *   • measured **1,360 ms** worst main-thread long task on the crossing sweep, against **51 ms** on
 *     the identical raster with the PDF backing removed (same pixels, same opacity, same rotation,
 *     same zooms). The cost is this path, not raster cost in general;
 *   • zooming back out revoked the raster, so zooming back in paid it all over again.
 */
import { describe, it, expect } from "vitest";
import {
  chooseOverlayRasterScale, baseRasterScale, overlayRasterKey,
  MAX_RERASTER_DIM, RERASTER_LADDER, HIRES_CACHE_PER_OVERLAY,
} from "../src/workspaces/site-planner/lib/overlayPdf.js";

/* The owner's real overlay. Its numbers are the fixture's (ui-audit/fixtures/bain-concept-original
 * .json), not invented ones. */
const BAIN = { imgW: 1728, imgH: 2592, ftPerPx: 2.7777777777777777 };
const pageMaxPts = (o) => Math.max(o.imgW, o.imgH);
const decide = (o, ppf) => chooseOverlayRasterScale({
  ftPerPx: o.ftPerPx, ppf, pageMaxPts: pageMaxPts(o), baseScale: baseRasterScale(pageMaxPts(o)),
});

/* THE PRODUCTION EFFECT'S RULE, replayed: `SitePlanner.jsx` displays the rung the decision names,
 * reuses one it already holds (LRU, `HIRES_CACHE_PER_OVERLAY` per overlay), and rasters only on a
 * miss. A zoom-out drops the DISPLAY and keeps the rungs. */
function sweepRasters(o, ppfs, { page = 1, knockout = true, budget = HIRES_CACHE_PER_OVERLAY } = {}) {
  const cache = new Map(); // key -> lru stamp
  let seq = 1, displayed = null, rasters = 0;
  for (const ppf of ppfs) {
    const dec = decide(o, ppf);
    if (!dec.isHires) { displayed = null; continue; }
    const key = overlayRasterKey(page, knockout, dec.scale);
    if (displayed === key) continue;
    if (cache.has(key)) { cache.set(key, seq++); displayed = key; continue; }
    rasters++;
    cache.set(key, seq++);
    const mine = [...cache.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < mine.length - budget; i++) if (mine[i][0] !== key) cache.delete(mine[i][0]);
    displayed = key;
  }
  return rasters;
}

/* ⛔ THE PRE-FIX RULE, KEPT VERBATIM AS THE MUTATION CHECK. Both halves of it, because both cost:
 * the scale was CONTINUOUS (`min(want, cap)`) and retained only within 10%, while one wheel notch
 * is ×1.12 — so every notch in the band re-rastered — and a zoom-out REVOKED the raster, so every
 * return trip paid it again. A "cache-off" variant of the new rule would not reproduce either, and
 * scoring the fix against it would be scoring it against itself. */
function legacySweepRasters(o, ppfs, { page = 1, knockout = true } = {}) {
  const bs = baseRasterScale(pageMaxPts(o));
  const cap = MAX_RERASTER_DIM / pageMaxPts(o);
  let held = null, rasters = 0;
  for (const ppf of ppfs) {
    const want = o.ftPerPx * ppf;
    if (!(want / bs > 1.5)) { held = null; continue; }            // zoomed out → revoke
    const scale = Math.max(bs, Math.min(want, cap));
    if (held && held.page === page && held.knockout === knockout
        && Math.abs(held.scale - scale) <= held.scale * 0.1) continue;
    rasters++;
    held = { scale, page, knockout };
  }
  return rasters;
}

const notches = (start, n, f = 1.12) => Array.from({ length: n }, (_, i) => start * Math.pow(f, i + 1));

describe("B749 — the scale ladder is never coarser than the continuous rule it replaces", () => {
  /* The one property that makes this safe to ship against a sheet the owner has deliberately
   * zoomed into. PERCEPTUAL-PARITY's relaxation is for detail he cannot see at working zoom; this
   * is the opposite case, so the bar taken here is a PROOF of non-degradation rather than a
   * perceptual measurement — the chosen scale is >= the scale the old rule would have picked, at
   * every zoom and every page size. */
  const pages = [500, 792, 1224, 1728, 2592, 3456, 5000];
  it("scale >= min(want, cap) at every zoom, for every page size", () => {
    for (const pmp of pages) {
      const bs = baseRasterScale(pmp);
      const cap = MAX_RERASTER_DIM / pmp;
      for (const ftPerPx of [0.5, 1, 2.7777777777777777, 10]) {
        for (let ppf = 0.01; ppf < 40; ppf *= 1.03) {
          const d = chooseOverlayRasterScale({ ftPerPx, ppf, pageMaxPts: pmp, baseScale: bs });
          if (!d.isHires) continue;
          const want = ftPerPx * ppf;
          expect(d.scale).toBeGreaterThanOrEqual(Math.min(want, cap) - 1e-9);
        }
      }
    }
  });

  it("never renders past the 8192px texture cap", () => {
    for (const pmp of pages) {
      const bs = baseRasterScale(pmp);
      for (let ppf = 0.01; ppf < 500; ppf *= 1.2) {
        const d = chooseOverlayRasterScale({ ftPerPx: 2.7777777777777777, ppf, pageMaxPts: pmp, baseScale: bs });
        expect(d.scale * pmp).toBeLessThanOrEqual(MAX_RERASTER_DIM + 1e-6);
      }
    }
  });

  it("still stays on the base raster at sheet-fit zoom", () => {
    const bs = baseRasterScale(pageMaxPts(BAIN));
    const d = decide(BAIN, bs / BAIN.ftPerPx); // magnification exactly 1
    expect(d.isHires).toBe(false);
    expect(d.scale).toBeCloseTo(bs, 6);
  });

  it("quantises to octaves of the base scale, so the wanted scale is DISCRETE", () => {
    const bs = baseRasterScale(pageMaxPts(BAIN));
    const cap = MAX_RERASTER_DIM / pageMaxPts(BAIN);
    const seen = new Set();
    for (let ppf = 0.9; ppf < 30; ppf *= 1.01) {
      const d = decide(BAIN, ppf);
      if (d.isHires) seen.add(d.scale.toFixed(6));
    }
    // Every distinct scale is either an exact octave above the base or the cap — no continuum.
    for (const s of seen) {
      const v = Number(s);
      const k = Math.log(v / bs) / Math.log(RERASTER_LADDER);
      // 1e-5, not 1e-9: `seen` holds values this test itself rounded to six decimals.
      expect(Math.abs(v - cap) < 1e-5 || Math.abs(k - Math.round(k)) < 1e-5).toBe(true);
    }
    expect(seen.size).toBeLessThanOrEqual(4);
  });
});

describe("B749 — how many full re-rasters a zoom sweep costs", () => {
  /* The headline. Eight wheel notches from below the gate to well past the cap — the gesture the
   * owner performs when he zooms in on a truck court. */
  const acrossSweep = notches(0.55, 8);

  it("crossing the gate costs ONE re-raster (it cost more on the continuous rule)", () => {
    expect(sweepRasters(BAIN, acrossSweep)).toBe(1);
    expect(legacySweepRasters(BAIN, acrossSweep)).toBeGreaterThan(1);
  });

  it("zooming further past the cap costs NOTHING more", () => {
    expect(sweepRasters(BAIN, notches(0.55, 20))).toBe(1);
  });

  it("a sweep out and back costs nothing the second time — the cache survives the zoom-out", () => {
    const outAndBack = [...acrossSweep, ...acrossSweep.slice().reverse(), ...acrossSweep];
    expect(sweepRasters(BAIN, outAndBack)).toBe(1);
    /* The pre-fix rule revoked on zoom-out, so every return trip paid the whole 179 MB raster
     * again. This is the assertion that would go red if anyone reinstates that revoke. */
    expect(legacySweepRasters(BAIN, outAndBack)).toBeGreaterThanOrEqual(3);
  });

  it("staying entirely below the gate costs NOTHING at all", () => {
    expect(sweepRasters(BAIN, notches(0.20, 10))).toBe(0);
    for (const ppf of notches(0.20, 10)) expect(decide(BAIN, ppf).isHires).toBe(false);
  });

  it("a page whose cap allows several rungs still bounds the sweep by the rung count", () => {
    const small = { imgW: 612, imgH: 792, ftPerPx: 1 }; // letter; cap = 8192/792 ≈ 10.34
    const rasters = sweepRasters(small, notches(0.5, 40));
    expect(rasters).toBeGreaterThan(0);
    expect(rasters).toBeLessThanOrEqual(4); // ladder rungs between the gate and the cap, not 40 notches
  });
});

describe("B749 — the cache key and its budget", () => {
  it("a page change or a knockout toggle is a DIFFERENT rung, so a stale page can't be shown", () => {
    expect(overlayRasterKey(1, true, 3.16)).not.toBe(overlayRasterKey(2, true, 3.16));
    expect(overlayRasterKey(1, true, 3.16)).not.toBe(overlayRasterKey(1, false, 3.16));
  });

  it("floating-point drift in the ladder arithmetic cannot mint a second key for one rung", () => {
    expect(overlayRasterKey(1, true, 3.160493827160494)).toBe(overlayRasterKey(1, true, 3.16049382716));
  });

  it("the per-overlay budget bounds what is retained", () => {
    // A page with many rungs, swept far enough to exceed the budget: the count is still the number
    // of DISTINCT rungs, not the number of notches, and re-visiting an evicted rung costs one more.
    const small = { imgW: 612, imgH: 792, ftPerPx: 1 };
    const deep = notches(0.5, 60);
    expect(sweepRasters(small, deep, { budget: 1 })).toBeGreaterThanOrEqual(sweepRasters(small, deep));
    expect(HIRES_CACHE_PER_OVERLAY).toBeGreaterThanOrEqual(1);
  });
});
