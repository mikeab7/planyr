/* NEW-5 — release an offscreen canvas's backing store once its pixels have been consumed.
 *
 * The Review workspace's copy of `site-planner/lib/releaseCanvas.js`. Read that file's header for
 * the full reasoning (canvas pixels are renderer/GPU memory the GC barely feels), the safety rule
 * (only ever call this AFTER the last toDataURL / toBlob / getImageData / drawImage that takes the
 * pixels, and never on a canvas you are handing to a caller), and why the two copies are
 * deliberately duplicated rather than shared — a module reachable from both routes becomes its own
 * chunk and breaches the Site route's chunk budget. Keep the two identical.
 */
export function releaseCanvas(canvas) {
  if (!canvas) return;
  try { canvas.width = 0; canvas.height = 0; } catch (_) { /* not a canvas / detached — nothing to free */ }
}
