/* Revision-compare BROWSER glue (B464). The pure register→resample→diff core lives in
 * `shared/files/rasterCompare.js` (Node-testable); this module adds the browser-only steps —
 * PDF rasterization + ImageData binarization — and re-exports the pure core for callers.
 *
 * Register/diff run on the budgeted (downscaled) raster so an E-size sheet never OOMs; the view
 * scales the resulting regions back up to screen.
 */
import { binarizeImageData } from "./matchLineRefine.js";
import { renderPageToImageData } from "./pdf.js";
import { compareBinaries, resampleBinary } from "../../../shared/files/rasterCompare.js";

export { compareBinaries, resampleBinary };

/** Binarize an ImageData → { bin, W, H } (1 = ink). Reuses the stitcher's luminance threshold. */
export function binImageData(imageData, threshold = 140) {
  return binarizeImageData(imageData, threshold);
}

/** Render two PDF pages and compare them. Returns the compareBinaries result plus the two source
 *  ImageData (for the view's color-wash base). `scale` keeps both renders in one budget. */
export async function comparePdfPages(pdfA, pageA, pdfB, pageB, opts = {}) {
  const scale = opts.scale || 1.5;
  const a = await renderPageToImageData(pdfA, pageA, scale);
  const b = await renderPageToImageData(pdfB, pageB, scale);
  const ba = binImageData(a.data, opts.threshold);
  const bb = binImageData(b.data, opts.threshold);
  const result = compareBinaries(ba.bin, ba.W, ba.H, bb.bin, bb.W, bb.H, opts);
  return { ...result, imgA: a, imgB: b };
}
