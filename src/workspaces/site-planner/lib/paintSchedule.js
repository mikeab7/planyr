/* TIME-SLICED CANVAS PAINT (B802400 round 5) — the mechanism the owner's own perf captures
 * pointed at directly. Three real, production perf-capture rows (2026-08-26, plan smt7q6ar8egz,
 * "Concept A (copy)"/Richfield, contours on) show windowMeanMs 227–332ms against a 16.7ms
 * baseline (13.6–19.9x), with the four WORST long tasks in every capture resolving to
 * ltNames "FrameRequestCallback" and lasting 1.5–3.1 SECONDS each — coincident with a BURST of
 * lattice tiles landing close together (terrain-tile-timing: 12 band-12 tiles inside ~9s), not
 * one slow tile.
 *
 * None of the first four rounds touch this mechanism: B800848 made repaint INCREMENTAL (diff
 * against what's already painted, only build what's new), B800849 made the diff's own compute
 * cheaper (a Schwartzian transform over the sort keys), and B802400 rounds 3–4 addressed the
 * network/cache and the honesty of the "loading" status. All four make the *decision* of what to
 * paint cheaper or more honest — none change how the decided ADD/REMOVE list is actually applied
 * to Leaflet. That application is still one synchronous loop calling `.addTo()`/`removeLayer()`
 * for every item in the diff, and Leaflet's own canvas redraw (`L.Canvas._draw`, scheduled by the
 * first `.addTo()` via `Util.requestAnimFrame`) is O(total layers currently held by that renderer
 * instance) every time it fires. When several tiles resolve close together — a real pan/zoom
 * burst, exactly what the tile-timing data shows — several such loops (and the redraw each one
 * schedules) land inside the SAME native animation-frame callback (Leaflet's own pan-inertia or
 * zoom-animation step is itself rAF-driven, and `moveend` fires synchronously from inside it), so
 * the whole cost of applying a burst's worth of diffs is attributed to one rAF callback — which is
 * exactly the "FrameRequestCallback" long tasks measured above.
 *
 * This module is the PURE half of the fix: given a list of paint operations (one Leaflet mutation
 * each — one add, one remove) and a clock, decide where to split the list into time-boxed batches
 * so no single batch can run longer than `budgetMs`. It has no leaflet/DOM import (leaflet throws
 * `ReferenceError: window is not defined` under plain Node/vitest — see terrainTileStatus.js's own
 * header for the same constraint) and is unit-tested directly with a fake clock.
 * `terrainLayers.js` drives it with the real `performance.now`/`requestAnimationFrame`, so a burst
 * of newly-cached or newly-composed geometry is applied a bounded slice at a time instead of all
 * at once — the browser gets control back between slices, so no single frame can be blocked for
 * anywhere near 1.5–3.1s regardless of how many tiles resolve close together. */

/** Stays comfortably under the "no single rAF callback over ~50ms" budget the owner's perf
 *  captures implied, leaving headroom in that 50ms for whatever else shares the frame (Leaflet's
 *  own redraw pass, layout, style recalc — none of which this module can see or account for). */
export const PAINT_FRAME_BUDGET_MS = 40;

/* A generator over `ops` (zero-arg functions, each ONE paint mutation — one Leaflet layer add or
 * remove). Runs ops in order, reading `now()` after each one; once the elapsed time since the
 * current batch started reaches `budgetMs`, it `yield`s so the caller can hand control back to the
 * browser (defer the rest to the next animation frame) before resuming. Every op runs EXACTLY
 * once, in order, whether the generator is drained in one `.next()` sweep (small ops lists finish
 * in a single batch and behave byte-identically to the old unchunked loop) or spread across many.
 * A single op whose own cost already exceeds the budget still runs to completion before the check
 * — an op is never starved, it just yields immediately after. Pure aside from invoking `ops[i]()`
 * (the caller's own side effect) and `now()` — no timers, no scheduling policy; that lives in the
 * caller, which is what makes this table-testable with a fake clock and fake ops. */
export function* runBudgeted(ops, now, budgetMs = PAINT_FRAME_BUDGET_MS) {
  if (!ops || !ops.length) return;
  let batchStart = now();
  for (let i = 0; i < ops.length; i++) {
    ops[i]();
    if (now() - batchStart >= budgetMs) {
      yield;
      batchStart = now();
    }
  }
}

/* Drain a `runBudgeted` generator (or any generator) to completion in one synchronous sweep,
 * ignoring every yield — used to FLUSH pending work before a caller needs it fully applied right
 * now: a new paint about to diff against `painted` needs the previous batch fully settled first
 * (otherwise it would diff against a partially-applied state and could double-add or miss a
 * remove), and a layer being torn down must not leave half-applied work queued against a group
 * that's about to be detached. Safe to call on an already-exhausted or null generator. */
export function drainBudgeted(gen) {
  if (!gen) return;
  let r = gen.next();
  while (!r.done) r = gen.next();
}
