/* Read an image File and return a data URL plus natural dimensions.
 * Large screenshots are downscaled (longest side <= maxDim) and re-encoded as
 * JPEG so they stay small enough to live inside a saved scenario in
 * localStorage (~5 MB origin budget) and keep the canvas responsive.
 */
import { releaseCanvas } from "./releaseCanvas.js";
import { cappedRasterDims } from "../../../shared/overlay/overlayRaster.js"; // the ONE long-edge cap rule (NEW-1)

export function loadAndDownscaleImage(file, maxDim = 2400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode that image."));
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const { w: cw, h: ch } = cappedRasterDims(w, h, maxDim);
        if (cw !== w || ch !== h) {
          const canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, cw, ch);
          const src = canvas.toDataURL("image/jpeg", 0.85);
          releaseCanvas(canvas); // NEW-5 — the downscale buffer's pixels are now in the data URL
          resolve({ src, w: cw, h: ch });
        } else {
          resolve({ src: reader.result, w, h });
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
