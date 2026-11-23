#!/usr/bin/env node
// Refresh the third-party files the Schedule page (public/sequence/index.html) serves from
// public/sequence/vendor/, straight from the pinned node_modules copies (audit batch A, 2026-11-23).
// test/sequenceVendorBytes.test.js fails if a copy drifts from the installed package.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const VENDOR_COPIES = [
  ["node_modules/react/umd/react.production.min.js", "public/sequence/vendor/react.production.min.js"],
  ["node_modules/react-dom/umd/react-dom.production.min.js", "public/sequence/vendor/react-dom.production.min.js"],
  ["node_modules/@supabase/supabase-js/dist/umd/supabase.js", "public/sequence/vendor/supabase.js"],
  ["node_modules/@tabler/icons-webfont/dist/tabler-icons.min.css", "public/sequence/vendor/tabler/tabler-icons.min.css"],
];
export const fontFilesOf = (css) => [...new Set([...css.matchAll(/url\("\.\/fonts\/([^"?]+)/g)].map((m) => m[1]))].sort();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cp = (a, b) => { mkdirSync(dirname(resolve(ROOT, b)), { recursive: true }); copyFileSync(resolve(ROOT, a), resolve(ROOT, b)); };
  for (const [a, b] of VENDOR_COPIES) cp(a, b);
  const css = readFileSync(resolve(ROOT, VENDOR_COPIES[3][0]), "utf8");
  for (const f of fontFilesOf(css)) cp(`node_modules/@tabler/icons-webfont/dist/fonts/${f}`, `public/sequence/vendor/tabler/fonts/${f}`);
  console.log("vendored", VENDOR_COPIES.length, "files +", fontFilesOf(css).length, "fonts");
}
