/* NEW-5 — release an offscreen canvas's backing store the moment its pixels have been consumed.
 *
 * WHY THIS EXISTS. A <canvas>'s pixel buffer is not ordinary JS memory: it lives in the
 * renderer/GPU allocator, outside the JS heap, and the garbage collector tracks it poorly — a
 * few hundred bytes of JS object can hold tens of megabytes of external pixels alive, and GC
 * feels no pressure to collect them. That is exactly the signature this app was showing: ~555 MB
 * of tab memory against a JS heap that peaked around 134 MB. The gap was offscreen canvases
 * nobody had told the browser to let go of — before this, the idiom below appeared ZERO times in
 * the entire tree. (Chrome's `performance.measureUserAgentSpecificMemory()` breaks Canvas out as
 * its own type, which is how you see the half a heap snapshot cannot.)
 *
 * Setting the dimensions to 0 is the standard way to ask for that buffer back immediately: the
 * spec requires a dimension write to reallocate the bitmap, and 0×0 is nothing to allocate.
 *
 * WHEN IT IS SAFE. Only ever call this AFTER the last read of the pixels — after toDataURL /
 * toBlob / getImageData / the drawImage that copies them somewhere durable. At that point the
 * call is behaviourally inert: the data has already been taken. It is NOT safe on a canvas you
 * are handing to a caller, or one that is on screen; release those where their real owner
 * finishes with them (the Review workspace's OCR raster is released by its OCR runner, not by
 * the module that rendered it, for exactly that reason).
 *
 * ⚠ DELIBERATELY DUPLICATED, not shared. The Review workspace has its own byte-identical copy
 * (`doc-review/lib/releaseCanvas.js`). A single module under `src/shared/` would be reachable
 * from BOTH routes, which makes Rollup hoist it into a chunk of its own — measured: one extra
 * chunk on the Site route, which breaches `bundle.siteRouteChunks`. Four lines of duplication is
 * the cheaper trade than an extra request at boot. Keep the two copies identical.
 */
export function releaseCanvas(canvas) {
  if (!canvas) return;
  try { canvas.width = 0; canvas.height = 0; } catch (_) { /* not a canvas / detached — nothing to free */ }
}
