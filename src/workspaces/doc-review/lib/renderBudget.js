/* Canvas backing-store budget math (B247/B265/NEW-2) — pure, no pdf.js.
 *
 * Extracted from pdf.js (which can't be imported outside Vite — it pulls a `?url` worker
 * import) so the budget logic is unit-testable on its own.
 *
 * Why cap the BACKING STORE and not the CSS box: the on-screen canvas size is fixed at
 * base×scale because the markup overlay positions in page-units×scale and the zoom-anchor
 * math divides screen px by `scale` — shrink the CSS box and every markup misaligns. So we
 * hold the CSS size and instead bound the device-pixel backing store: render at the device
 * pixel ratio for crispness, but never let the total backing pixels exceed the budget —
 * even if that means sampling BELOW one device-px per CSS-px at extreme zoom. A slightly
 * soft raster on a huge E-size sheet at 600% beats an out-of-memory tab crash.
 *
 * The earlier version floored the density at 1×, which DEFEATED the budget: once the CSS
 * area alone (base×scale) passed ~24 MP, a 1× backing store was already over budget and
 * kept growing with zoom (an E-size sheet hit ~140 MP / ~533 MB RGBA at 600%). Allowing
 * the density below 1× is what makes the ≤24 MP guarantee actually hold at any zoom. */

export const CANVAS_PX_BUDGET = 24e6; // ≤ ~24 MP backing store ≈ 96 MB RGBA

/* Pick how dense to render the canvas backing store for a base×scale on-screen size.
 * `devicePixelRatio` is injected (pdf.js passes window.devicePixelRatio) so this stays
 * pure + deterministic in tests. Returns the device-px-per-CSS-px multiplier. */
export function backingScale(baseW, baseH, scale, devicePixelRatio = 1) {
  const cssW = Math.max(1, baseW * scale), cssH = Math.max(1, baseH * scale);
  const want = Math.min(devicePixelRatio || 1, 2);            // device density, capped at 2×
  const budget = Math.sqrt(CANVAS_PX_BUDGET / (cssW * cssH)); // densest sampling that still fits the budget
  // Never exceed the budget (use `budget` even when it's < 1× — soft beats OOM); a tiny
  // floor only guards against a degenerate zero-area canvas at absurd zooms.
  return Math.max(0.05, Math.min(want, budget));
}

/* The backing-store pixel count a render would allocate (for the budget guard + tests). */
export function backingPixels(baseW, baseH, scale, devicePixelRatio = 1) {
  const dpr = backingScale(baseW, baseH, scale, devicePixelRatio);
  return Math.floor(Math.max(1, baseW * scale) * dpr) * Math.floor(Math.max(1, baseH * scale) * dpr);
}
