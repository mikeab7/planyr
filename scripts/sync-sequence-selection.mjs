#!/usr/bin/env node
// scripts/sync-sequence-selection.mjs  (B2530690)
//
// Inline the shared range-selection model (src/shared/selection/rangeSelection.js) and the shared edge-scroll
// speed (src/shared/selection/edgeScroll.js) into the standalone Schedule page (public/sequence/index.html).
// The page is one self-contained HTML file with in-browser Babel and cannot `import` from src/, so the code
// lives there as a copy between the RANGE-SELECTION markers — the SAME code the Spreadsheet and the Notes
// tables import. This script is the only writer of that copy; the only transformation is dropping the
// `export ` keyword. Same shape as sync-sequence-ownership.mjs / sync-sequence-formula.mjs.
//
// Usage:  node scripts/sync-sequence-selection.mjs           (writes the HTML)
//         node scripts/sync-sequence-selection.mjs --check    (exit 1 if out of sync)
// test/rangeSelectionInlineSync.test.js runs the same comparison so CI fails on drift.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SOURCES = ["src/shared/selection/rangeSelection.js", "src/shared/selection/edgeScroll.js"].map((p) => resolve(ROOT, p));
const HTML = resolve(ROOT, "public/sequence/index.html");
const START = "/* RANGE-SELECTION:START */";
const END = "/* RANGE-SELECTION:END */";

/** The text that belongs between the markers for these source texts. */
export function inlineBody(sourceTexts) {
  return sourceTexts.map((t) => t.replace(/^export /gm, "").replace(/\s+$/, "") + "\n").join("\n");
}

export function buildSyncedHtml(sourceTexts, htmlText) {
  const i = htmlText.indexOf(START);
  const j = htmlText.indexOf(END);
  if (i < 0 || j < 0 || j < i) throw new Error("RANGE-SELECTION markers not found in public/sequence/index.html");
  return `${htmlText.slice(0, i + START.length)}\n${inlineBody(sourceTexts)}${htmlText.slice(j)}`;
}

function main() {
  const check = process.argv.includes("--check");
  const srcs = SOURCES.map((p) => readFileSync(p, "utf8"));
  const htmlText = readFileSync(HTML, "utf8");
  const next = buildSyncedHtml(srcs, htmlText);
  if (next === htmlText) { console.log("✓ range-selection module already in sync"); return; }
  if (check) { console.error("✗ range-selection module is OUT OF SYNC — run: node scripts/sync-sequence-selection.mjs"); process.exit(1); }
  writeFileSync(HTML, next);
  console.log("✓ inlined src/shared/selection/* into public/sequence/index.html");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
