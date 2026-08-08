/* rerasterProbe — the PURE half of the B749 zoom re-raster probe (NEW-1).
 *
 * ⛔ THE COST PATH THIS PROGRAM HAS NEVER RUN, in one paragraph.
 *
 * A PDF-backed sheet overlay does not stay on the raster it was loaded with. Once on-screen
 * magnification passes ~1.5× the base raster's own pixels, `SitePlanner.jsx` re-renders that PDF
 * PAGE at a higher device scale — up to an 8192 px long edge — on the MAIN THREAD, and swaps the
 * result in. The owner's real Bain overlay is page 1 of a PDF (`pdfBacked: true`, storage key tail
 * `…14mmzcgq.pdf`), 1728 × 2592 pt, and BOTH his Bain plans carry the same file. So this path is
 * live on his plans and it fires on ZOOM.
 *
 * Every arm this program has ever run PANS. `raster-arms.mjs` pans; `annotation-arms.mjs` pans;
 * `session-axes.mjs` pans. A pan cannot cross a magnification threshold, so in sixty-plus runs
 * across two batteries this path has **never once executed**. That is not a null result about it;
 * it is an absence of any result about it, which is a different and much worse thing.
 *
 * ── WHAT THIS FILE IS ───────────────────────────────────────────────────────────────────────────
 * The decision half, kept pure so it is unit-testable and so the harness cannot quietly disagree
 * with the app. `chooseOverlayRasterScale` and `baseRasterScale` are imported FROM THE APP — there
 * is no second copy of the threshold here, because a probe that re-implements the rule it is
 * probing measures its own re-implementation. What this file DOES model, and the app owns, is the
 * effect's RETENTION rule (hold the existing hi-res while its scale is within 10%) and the
 * settle-debounced schedule. That mirror is the one drift risk in the file and it is guarded by a
 * source assertion in test/rerasterProbe.test.js.
 *
 * ── AND THE GUARD, WHICH IS THE POINT OF STEP 1 ─────────────────────────────────────────────────
 * `rerasterFault` is the `decodeFault` / `annotationFault` of this axis. An arm in which the 8192 px
 * re-raster silently never fired looks EXACTLY like an arm that is fast. This program has already
 * been saved twice by that class of guard (a Playwright string-vs-function subtlety wrote nothing
 * to IndexedDB; a DOM census written as a template literal counted zero of 24 annotations) and both
 * times the run would otherwise have been reported as a beautiful, entirely false null.
 */
import {
  chooseOverlayRasterScale, baseRasterScale, overlayRasterKey,
  MAX_RERASTER_DIM, RERASTER_LADDER, HIRES_CACHE_PER_OVERLAY,
} from "../../src/workspaces/site-planner/lib/overlayPdf.js";

export { MAX_RERASTER_DIM, RERASTER_LADDER, HIRES_CACHE_PER_OVERLAY, overlayRasterKey };

/* The effect's retention tolerance and its settle debounce, both read off SitePlanner.jsx's B749
 * effect. Named here so the harness's step dwell can be derived from the app's own debounce rather
 * than from a guessed "long enough". */
/* ⛔ HISTORICAL, and kept because the harness reports what the OLD rule would have cost on the very
 * sweep it just drove. The pre-fix effect held a hi-res while its scale was within 10% — and one
 * wheel notch is ×1.12, so every notch in the band re-rastered. The live rule is the octave ladder
 * plus an exact cache-key match; see `chooseOverlayRasterScale`. */
export const RERASTER_KEEP_TOLERANCE = 0.1;
export const RERASTER_SETTLE_MS = 260;        // the effect's setTimeout before it acts

/** Base device scale (raster px per PDF point) an overlay's stored raster was rendered at. */
export const overlayBaseScale = (o) => baseRasterScale(Math.max(o.imgW, o.imgH));

/**
 * The magnification the base raster is being upscaled by at a given zoom — the quantity the ~1.5×
 * gate is actually applied to. `ftPerPx` here is the overlay's feet per PDF point and `ppf` the
 * view's pixels per foot, so their product is raster-px-per-point wanted on screen.
 */
export function magnificationAt(o, ppf) {
  return (o.ftPerPx * ppf) / Math.max(1e-9, overlayBaseScale(o));
}

/**
 * The view zoom (pixels per foot) at which the re-raster gate opens for this overlay — MEASURED
 * from the app's own decision function by bisection rather than restated from the comment beside
 * the constant. That distinction is the whole of Step 1's "report the threshold you measure, not
 * the one the code comments claim".
 */
export function measuredThresholdPpf(o, { lo = 1e-4, hi = 1e4, iters = 80 } = {}) {
  const fires = (ppf) => chooseOverlayRasterScale({
    ftPerPx: o.ftPerPx, ppf, pageMaxPts: Math.max(o.imgW, o.imgH), baseScale: overlayBaseScale(o),
  }).isHires;
  if (fires(lo)) return lo;      // already above the gate at the bottom of the bracket
  if (!fires(hi)) return null;   // never fires anywhere in the bracket
  let a = lo, b = hi;
  for (let i = 0; i < iters; i++) { const m = (a + b) / 2; if (fires(m)) b = m; else a = m; }
  return b;
}

/** The zoom at or above which the chosen scale is CAPPED at the 8192 px texture edge — past this
 *  the wanted scale stops moving, so the retention rule holds and the churn stops. Null if the page
 *  is small enough that the cap is never reached. */
export function capPpf(o) {
  const cap = MAX_RERASTER_DIM / Math.max(1, Math.max(o.imgW, o.imgH));
  const ppf = cap / Math.max(1e-9, o.ftPerPx);
  return Number.isFinite(ppf) ? ppf : null;
}

/** How many DISTINCT rungs the ladder offers between the gate and the 8192 px cap — i.e. the most
 *  full page renders a one-way zoom-in can cost, however many wheel notches it takes. Under the
 *  pre-fix continuous rule this number was effectively the notch count. */
export function rungsInBand(o) {
  const seen = new Set();
  for (let ppf = (measuredThresholdPpf(o) || 1e-3) * 1.0001; ppf < (capPpf(o) || 1) * 8; ppf *= 1.01) {
    const d = chooseOverlayRasterScale({
      ftPerPx: o.ftPerPx, ppf, pageMaxPts: Math.max(o.imgW, o.imgH), baseScale: overlayBaseScale(o),
    });
    if (d.isHires) seen.add(d.scale.toFixed(6));
  }
  return seen.size;
}

/** The raster the app would produce at a given device scale: its pixel dimensions and the decoded
 *  (RGBA) bytes it costs the renderer. `imgW/imgH` are the page's intrinsic size in points. */
export function rasterAtScale(o, scale) {
  const w = Math.floor(o.imgW * scale), h = Math.floor(o.imgH * scale);
  return { w, h, megapixels: +((w * h) / 1e6).toFixed(2), decodedBytes: w * h * 4 };
}

/**
 * Replay a settled-zoom sweep through the app's decision + retention rules and return every
 * re-raster it would perform.
 *
 * ⚠ SETTLED. The effect is debounced behind a 260 ms timer that is CLEARED on every dependency
 * change, so a continuous wheel gesture evaluates once at the end, not once per step. A sweep whose
 * steps dwell longer than the debounce is therefore a different measurement from one that does not,
 * and both are real user behaviour — a stepped zoom (wheel notch, pause, wheel notch) settles at
 * every step. The harness dwells past `RERASTER_SETTLE_MS`, which is the worse case and the one the
 * owner's "zoom in on the truck court" gesture actually is.
 */
export function rerasterPlan(o, ppfs, { page = 1, knockout = true, cache = true, budget = HIRES_CACHE_PER_OVERLAY } = {}) {
  const events = [];
  const held = new Map(); // cache key -> lru stamp
  let seq = 1, displayed = null;
  for (const ppf of ppfs) {
    const dec = chooseOverlayRasterScale({
      ftPerPx: o.ftPerPx, ppf, pageMaxPts: Math.max(o.imgW, o.imgH), baseScale: overlayBaseScale(o),
    });
    if (!dec.isHires) {
      if (displayed) events.push({ ppf, kind: "drop" });
      displayed = null;
      /* `cache:false` replays the PRE-FIX app — the zoom-out REVOKED the raster, so coming back
       * paid it again. Kept so a before/after can be scored in one place, and so the harness can
       * say what the old rule would have cost on the very sweep it just drove. */
      if (!cache) held.clear();
      continue;
    }
    const key = overlayRasterKey(page, knockout, dec.scale);
    if (displayed === key) continue;
    if (held.has(key)) { held.set(key, seq++); displayed = key; continue; } // a rung already rendered
    held.set(key, seq++);
    if (cache) {
      const lru = [...held.entries()].sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < lru.length - budget; i++) if (lru[i][0] !== key) held.delete(lru[i][0]);
    } else {
      for (const k of [...held.keys()]) if (k !== key) held.delete(k);
    }
    displayed = key;
    events.push({ ppf, kind: "raster", scale: dec.scale, capped: dec.capped, ...rasterAtScale(o, dec.scale) });
  }
  return events;
}

/** How many full re-rasters a sweep costs — the number STEP 4's guard asserts, deliberately a
 *  COUNT and not a duration: a time budget passes the moment a re-raster that should not happen
 *  merely gets cheaper. */
export const rerasterCount = (events) => events.filter((e) => e.kind === "raster").length;

/** Peak decoded bytes any single re-raster in a sweep allocates. */
export const peakRasterBytes = (events) =>
  events.reduce((m, e) => (e.kind === "raster" ? Math.max(m, e.decodedBytes) : m), 0);

/* ---- THE GUARD --------------------------------------------------------------------------------
 * An arm declares what it expects: `above` (the sweep crosses the gate, so re-rasters MUST be
 * observed) or `below` (the sweep stays under it, so NONE may be). Both directions are faults, and
 * the second matters as much as the first — an arm that fires when it claims not to is measuring a
 * different thing from the one it is the control for.
 */
export function rerasterFault({ expect, observed, predicted, label = "arm" }) {
  const seen = observed | 0;
  if (expect === "above") {
    if (seen === 0) {
      return `${label}: THE RE-RASTER NEVER FIRED — the sweep crossed the magnification gate and `
        + `${predicted} hi-res raster${predicted === 1 ? "" : "s"} were predicted, but the page produced none. `
        + `This arm did not measure the path it claims to; a silent no-fire is indistinguishable from a fast arm.`;
    }
    return null;
  }
  if (expect === "below") {
    return seen === 0 ? null
      : `${label}: THE RE-RASTER FIRED BELOW THE GATE — ${seen} hi-res raster${seen === 1 ? "" : "s"} were `
        + `produced by a sweep that stays under the magnification threshold. The control arm is not a control.`;
  }
  if (expect === "none") {
    return seen === 0 ? null
      : `${label}: ${seen} hi-res raster${seen === 1 ? "" : "s"} fired on an arm where the path is supposed to be `
        + `unreachable (overlay hidden, or the source is not a PDF). The arm does not isolate what it claims to.`;
  }
  return null;
}

/**
 * Did the PDF bytes actually reach the app? The Tier-2 path's ONE source of bytes after a reload is
 * `downloadOverlayBytes(storageKey)` — Supabase Storage. If the build carries no Supabase config,
 * or the route interception never matched, the client returns null WITHOUT ISSUING A REQUEST and
 * the whole path dies silently with the overlay still on screen looking perfectly correct. Counting
 * the served requests is the only proof that the arm was even reachable.
 */
export function pdfDeliveryFault({ served, expect = true, label = "arm" }) {
  if (!expect) return null;
  return served > 0 ? null
    : `${label}: THE OVERLAY'S PDF BYTES WERE NEVER REQUESTED (0 storage fetches served). `
      + `Either the build has no Supabase config (so the client short-circuits to null before issuing a request), `
      + `or the seeded storageKey does not match the intercepted route. Nothing measured here touched B749.`;
}
