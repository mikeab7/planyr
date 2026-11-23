/* Where the Tesseract OCR engine's files come from (audit batch A, 2026-11-23).
 *
 * In a PRODUCTION build the worker script and the WASM engine are served from this site itself
 * (`/ocr/…`, copied from the pinned node_modules by scripts/build-ocr-assets.mjs after `vite build`) — so no
 * third-party script is ever executed from a CDN. In dev / tests there is no /ocr folder, so this returns
 * null and Tesseract keeps its own default (jsdelivr), exactly as before. English language DATA for the
 * Review reader is self-hosted too (`langPath`); the deed reader keeps Tesseract's default language
 * download (a different model set — switching it would change deed accuracy, so it was left alone). */
export const OCR_WORKER_PATH = "/ocr/worker.min.js";
export const OCR_CORE_PATH = "/ocr/core";
export const OCR_LANG_PATH = "/ocr/lang";

const isProd = () => {
  try { return !!import.meta.env && import.meta.env.PROD === true && import.meta.env.MODE !== "test"; } catch (_) { return false; }
};

/** { workerPath, corePath } in a production build, else {} (Tesseract's own defaults). */
export function selfHostedEngine() {
  return isProd() ? { workerPath: OCR_WORKER_PATH, corePath: OCR_CORE_PATH } : {};
}
/** Adds the English `langPath` too (Review's reader only). */
export function selfHostedEngineWithLang() {
  return isProd() ? { ...selfHostedEngine(), langPath: OCR_LANG_PATH } : {};
}
