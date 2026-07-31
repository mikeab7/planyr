/* notesImageIntake — turn a pasted or dropped file into something a note can actually hold.
 *
 * THE PROBLEM THIS SOLVES. A phone photo is 8–12 megapixels and several megabytes; a
 * screenshot of a flood map is a few hundred kilobytes. Storing the first at full size
 * would put a single picture on the same order as an entire notebook, for no visible
 * benefit — a note page is a document column, and nothing in it is ever displayed at 4000
 * pixels wide. So an oversized paste is DOWNSCALED before it is stored, once, at intake.
 *
 * THE ENCODING IS CHOSEN, NOT ASSUMED. Re-encoding a screenshot as JPEG makes its text
 * fuzzy; keeping a photo as PNG makes it several times larger than it needs to be. So the
 * downscaled bitmap is encoded BOTH ways and the smaller result wins — which lands on PNG
 * for flat-colour screenshots and JPEG for photographs without either being hard-coded.
 *
 * TWO FORMATS ARE DELIBERATELY PASSED THROUGH UNTOUCHED. An animated GIF drawn onto a
 * canvas becomes one still frame, and an SVG becomes a fixed-resolution raster — both are
 * a silent downgrade of the thing the user pasted, so those keep their original bytes and
 * are only ever REFUSED (by the store's ceiling), never quietly degraded.
 *
 * This module is DOM-side (canvas + Image) and is reached only from the image extension,
 * which rides the lazy editor chunk.
 */

/** The longest edge a stored picture may have. Comfortably sharper than the note column is
 *  wide, including on a high-density screen, and well short of a modern camera's output. */
export const MAX_IMAGE_DIM = 1800;

const PASS_THROUGH = /^image\/(gif|svg\+xml)$/i;

export const isImageFile = (file) => !!file && typeof file.type === "string" && /^image\//i.test(file.type);

function readDataUrl(file) {
  return new Promise((resolve) => {
    try {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(file);
    } catch (_) { resolve(null); }
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch (_) { resolve(null); }
  });
}

/** A file → `{ ok, dataUrl, mime, w, h }`, downscaled and re-encoded when that helps.
 *  Never throws: a file the browser cannot decode comes back `{ ok:false, error }` with a
 *  sentence the caller can show, because a picture that silently fails to appear is the
 *  failure mode this whole path exists to avoid. */
export async function prepareNoteImage(file, { maxDim = MAX_IMAGE_DIM } = {}) {
  if (!isImageFile(file)) return { ok: false, error: "That file is not an image, so it was not added." };

  const original = await readDataUrl(file);
  if (!original) return { ok: false, error: "That image could not be read, so it was not added." };

  if (PASS_THROUGH.test(file.type)) {
    return { ok: true, dataUrl: original, mime: file.type, w: 0, h: 0, scaled: false };
  }

  const img = await loadImage(original);
  if (!img || !img.naturalWidth || !img.naturalHeight) {
    // Undecodable by this browser — keep the original bytes rather than lose the paste;
    // the store's ceiling still applies, and a refusal there is named and visible.
    return { ok: true, dataUrl: original, mime: file.type, w: 0, h: 0, scaled: false };
  }

  const { naturalWidth: sw, naturalHeight: sh } = img;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  // Already small AND already compact: nothing to gain from a re-encode, and re-encoding
  // would only throw away quality the user pasted.
  if (scale === 1 && original.length <= 512 * 1024) {
    return { ok: true, dataUrl: original, mime: file.type, w, h, scaled: false };
  }

  let canvas;
  try {
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);

    const png = canvas.toDataURL("image/png");
    const jpg = canvas.toDataURL("image/jpeg", 0.85);
    const best = jpg && jpg.length < png.length ? { dataUrl: jpg, mime: "image/jpeg" } : { dataUrl: png, mime: "image/png" };
    // Never make it worse: if both re-encodings are bigger than what arrived, keep the original.
    const out = best.dataUrl.length < original.length || scale < 1 ? best : { dataUrl: original, mime: file.type };
    return { ok: true, dataUrl: out.dataUrl, mime: out.mime, w, h, scaled: scale < 1 };
  } catch (e) {
    return { ok: false, error: "That image could not be prepared for storage, so it was not added." };
  } finally {
    // Canvas pixels are renderer memory the GC barely feels — hand the backing store back
    // now that the encodings have been taken (the repo's `releaseCanvas` idiom).
    if (canvas) { try { canvas.width = 0; canvas.height = 0; } catch (_) { /* already gone */ } }
  }
}
