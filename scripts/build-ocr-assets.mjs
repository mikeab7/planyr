#!/usr/bin/env node
// Copy the Tesseract OCR engine files into dist/ocr/ so the app never runs OCR code from a CDN
// (audit batch A, 2026-11-23). Runs after `vite build` (wired into `npm run build`). Only the two
// LSTM engine builds Tesseract picks for OEM LSTM_ONLY (SIMD and plain) are copied, not all four.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OCR_FILES = [
  ["node_modules/tesseract.js/dist/worker.min.js", "ocr/worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "ocr/core/tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "ocr/core/tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz", "ocr/lang/eng.traineddata.gz"],
];

export function copyOcrAssets(outDir = resolve(ROOT, "dist")) {
  for (const [from, to] of OCR_FILES) {
    const src = resolve(ROOT, from);
    if (!existsSync(src)) throw new Error(`build-ocr-assets: missing ${from} — run npm ci (the OCR engine must ship with the build)`);
    const dst = resolve(outDir, to);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }
  return OCR_FILES.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`build-ocr-assets: copied ${copyOcrAssets()} files into dist/ocr`);
