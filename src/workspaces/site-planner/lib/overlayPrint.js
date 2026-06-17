/* Site-plan overlay print/export selection (B131).
 *
 * Pure, DOM-free helpers that decide which placed site-plan overlays (B72) take part
 * in a printed / exported sheet. Kept side-effect-free so it unit-tests in the node
 * runner and stays the single source of truth for BOTH the print dialog's
 * "Print overlay" checkbox (shown only when there's actually something to print — no
 * dead control) and the compositing pass in SitePlanner's `buildExportSvg`.
 */

// An overlay is printable when it has a rendered raster (`src`) and isn't explicitly
// hidden. The `visible !== false` guard is forward-compatible with a future
// per-overlay show/hide toggle (the brief's "respect each overlay's own visibility");
// today overlays carry no `visible` flag, so any src-bearing overlay counts — which
// matches exactly what's drawn on screen (WYSIWYG). A placeholder overlay whose raster
// hasn't synced to this device (no `src`) is never printed: it only renders an on-screen
// "re-add me" prompt, which has no place on a plot.
export const isOverlayPrintable = (o) => !!(o && o.src && o.visible !== false);

// The overlays that should be composited into output, in their given order. The
// "Print overlay" checkbox is a master include/exclude layered on top of this.
export const printableOverlays = (overlays) =>
  Array.isArray(overlays) ? overlays.filter(isOverlayPrintable) : [];

// True when at least one overlay is worth printing. Drives the checkbox's
// "no dead control" visibility and its default-checked (match-on-screen) state.
export const hasPrintableOverlay = (overlays) =>
  Array.isArray(overlays) && overlays.some(isOverlayPrintable);
