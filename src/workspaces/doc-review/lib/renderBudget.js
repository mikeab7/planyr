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

/* The DETAIL window (the part of the sheet the user is actually reading) renders between a
 * supersample FLOOR and a memory CAP, in device-pixels per CSS-pixel:
 *  • FLOOR 2× — a plain 1× monitor is SUPERSAMPLED to 2×: pdf.js draws the thin CAD linework /
 *    small dimension text at twice the resolution and the browser down-samples it, anti-aliasing
 *    sub-pixel edges far more cleanly than a flat 1× raster (the residual "softer than Bluebeam"
 *    gap left after B415, which only restored *device* density).
 *  • CAP 2.5× — a 3×/4× retina panel renders a bit denser than the 2× floor (sharper for that
 *    display) but is held below its native ratio so memory stays bounded; the budget below still
 *    clamps a large window further. Only the detail layer uses this; the whole-page backdrop keeps
 *    its own (smaller) device-density budget. */
export const DETAIL_DENSITY_TARGET = 2;   // supersample floor (1× monitors get 2×)
export const DETAIL_DENSITY_CAP = 2.5;    // ceiling on a high-dpi panel, bounding memory

/* Pick how dense to render the canvas backing store for a base×scale on-screen size.
 * `devicePixelRatio` is injected (pdf.js passes window.devicePixelRatio) so this stays
 * pure + deterministic in tests. Returns the device-px-per-CSS-px multiplier. */
export function backingScale(baseW, baseH, scale, devicePixelRatio = 1) {
  const cssW = Math.max(1, baseW * scale), cssH = Math.max(1, baseH * scale);
  // At least the 2× supersample floor (so a 1× monitor still gets crisp AA), at most the cap
  // (so a 3×/4× panel can't balloon memory). (The budget below lowers this on a very large window.)
  const want = Math.min(Math.max(devicePixelRatio || 1, DETAIL_DENSITY_TARGET), DETAIL_DENSITY_CAP);
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

/* ---- Two-layer viewport rendering (B415) ----------------------------------------------
 *
 * The whole-page-at-one-density model above goes soft when zoomed in on a large sheet: the
 * 24 MP budget is spread across the ENTIRE sheet, so the visible window can't reach device
 * density. Bluebeam stays sharp because it only ever rasterises the visible region at full
 * resolution. We do the same with two layers, both painted INSIDE the unchanged page box:
 *
 *   • backdrop — the whole page at a FIXED, zoom-independent density (below). Rendered once
 *     per page, never on zoom, so it costs nothing during pan/zoom and is always present as a
 *     no-white floor under everything (removing the whole-page settle re-raster that flashed
 *     white, B414). A small budget keeps it crisp at fit without holding a second dense page.
 *   • detail — only the visible page-rect (+ a margin), at full device density, budget-bounded
 *     on the REGION not the page (so `backingScale` above is reused on the region size and
 *     returns full dpr when the window is small). Re-rastered on settle, over the backdrop.
 *
 * All three helpers are pure (no DOM / no pdf.js) so the host passes the live view + sizes.
 */

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export const BACKDROP_PX_BUDGET = 16e6; // ≈ 64 MB RGBA (one bitmap, off the gesture path) — keeps the
// whole-page "soft floor" the user stares at DURING a gesture ~1.4× sharper on a large E-size sheet at
// retina (≈73→103 dpi); no-op on a 1× monitor (the backdrop already caps at the device ratio there).
// Stays under Safari's ~16.78 MP single-canvas limit; freed on page change.

/* Density (device-px per page-unit) for the whole-page backdrop: the device dpr (capped 2×),
 * lowered only as far as the backdrop budget needs on a very large sheet. Independent of zoom —
 * the backdrop is a stable whole-page image the page box CSS-rescales; the detail layer supplies
 * sharpness where the user is actually looking. */
export function backdropDensity(pageW, pageH, devicePixelRatio = 1) {
  const w = Math.max(1, pageW), h = Math.max(1, pageH);
  const want = Math.min(devicePixelRatio || 1, 2);
  const budget = Math.sqrt(BACKDROP_PX_BUDGET / (w * h));
  return Math.max(0.1, Math.min(want, budget));
}

/* The page-unit rectangle currently visible in the viewport (the part of the page box inside
 * the wrap), expanded by `marginFrac` on each side and clamped to the page — the region the
 * detail layer rasterises at full density. `visible` is the un-margined on-screen rect, used by
 * `tileCovers` to skip a needless re-raster on a tiny pan. Returns null when the page is panned
 * fully off-screen. view = { scale, tx, ty } with screen = page*scale + t (shared transform).
 * marginFrac 0.40 pre-renders ~0.4 screen-widths of halo each side, so a decisive flick-pan
 * stays sharp to its leading edge (a smaller halo trailed a soft backdrop strip); still
 * region-sized, so the 24 MP budget keeps density native on any normal sheet. */
export function visibleRegion(view, pageBase, vw, vh, marginFrac = 0.40) {
  if (!view || !pageBase || !view.scale || !(vw > 0) || !(vh > 0)) return null;
  const s = view.scale, pw = Math.max(1, pageBase.w), ph = Math.max(1, pageBase.h);
  const vx0 = clamp((0 - view.tx) / s, 0, pw), vy0 = clamp((0 - view.ty) / s, 0, ph);
  const vx1 = clamp((vw - view.tx) / s, 0, pw), vy1 = clamp((vh - view.ty) / s, 0, ph);
  if (vx1 - vx0 < 1e-3 || vy1 - vy0 < 1e-3) return null; // page off-screen / degenerate
  const visible = { rx: vx0, ry: vy0, rw: vx1 - vx0, rh: vy1 - vy0 };
  const mx = visible.rw * marginFrac, my = visible.rh * marginFrac;
  const rx = clamp(vx0 - mx, 0, pw), ry = clamp(vy0 - my, 0, ph);
  const rxe = clamp(vx1 + mx, 0, pw), rye = clamp(vy1 + my, 0, ph);
  return { rect: { rx, ry, rw: rxe - rx, rh: rye - ry }, visible };
}

/* Does an already-rastered tile (a page-unit rect + the scale it was drawn at) still cover the
 * visible rect at the current scale? If so a settle needs no re-raster — the existing bitmap,
 * CSS-rescaled, suffices. Re-raster when the scale changed (density would be wrong) or the view
 * moved/zoomed past the tile's edges. */
export function tileCovers(tile, visible, scale) {
  if (!tile || !visible || tile.scale !== scale) return false;
  const e = 0.5; // page-unit slack so floating-point edges don't force a re-raster every frame
  return tile.rx <= visible.rx + e && tile.ry <= visible.ry + e &&
         tile.rx + tile.rw >= visible.rx + visible.rw - e &&
         tile.ry + tile.rh >= visible.ry + visible.rh - e;
}
