#!/usr/bin/env node
// scripts/sync-sequence-formula.mjs
//
// Inline the canonical formula engine (src/shared/formula/formula.js) into the
// standalone scheduler page (public/sequence/index.html). The scheduler is a
// self-contained HTML file with in-browser Babel — it cannot `import` from src/
// at runtime — so the engine lives there as a verbatim copy between the
// FORMULA-ENGINE markers. This script is the only writer of that copy.
//
// Usage:  node scripts/sync-sequence-formula.mjs          (writes the HTML)
//         node scripts/sync-sequence-formula.mjs --check   (exit 1 if out of sync)
//
// test/formula-inline-sync.test.js runs the same comparison so CI fails on drift.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "src/shared/formula/formula.js");
const HTML = resolve(ROOT, "public/sequence/index.html");
const START = "/* FORMULA-ENGINE:START */";
const END = "/* FORMULA-ENGINE:END */";

// Return the text strictly between the START and END markers (exclusive of the
// marker lines themselves), trimmed of the leading/trailing blank line only.
export function engineBody(text, label) {
  const i = text.indexOf(START);
  const j = text.indexOf(END);
  if (i < 0 || j < 0 || j < i) throw new Error(`FORMULA-ENGINE markers not found in ${label}`);
  return text.slice(i + START.length, j).replace(/^\n/, "").replace(/\n[ \t]*$/, "\n");
}

export function buildSyncedHtml(srcText, htmlText) {
  const body = engineBody(srcText, "source module");
  const i = htmlText.indexOf(START);
  const j = htmlText.indexOf(END);
  if (i < 0 || j < 0 || j < i) throw new Error("FORMULA-ENGINE markers not found in public/sequence/index.html");
  const before = htmlText.slice(0, i + START.length);
  const after = htmlText.slice(j);
  return `${before}\n${body}${after}`;
}

function main() {
  const check = process.argv.includes("--check");
  const srcText = readFileSync(SRC, "utf8");
  const htmlText = readFileSync(HTML, "utf8");
  const next = buildSyncedHtml(srcText, htmlText);
  if (next === htmlText) { console.log("✓ scheduler formula engine already in sync"); return; }
  if (check) { console.error("✗ scheduler formula engine is OUT OF SYNC — run: node scripts/sync-sequence-formula.mjs"); process.exit(1); }
  writeFileSync(HTML, next);
  console.log("✓ inlined src/shared/formula/formula.js into public/sequence/index.html");
}

// Run only when invoked directly (the test imports the helpers above).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
