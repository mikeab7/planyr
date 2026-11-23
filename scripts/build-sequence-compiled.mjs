#!/usr/bin/env node
// scripts/build-sequence-compiled.mjs — B1167200
//
// THE PROBLEM (measured on the owner's own machine, BACKLOG.md B1167200): the Schedule tab
// (public/sequence/index.html) ships its ~17,000-line app as JSX inside two
// <script type="text/babel"> blocks and transpiles all of it, on the main thread, on EVERY
// load, via @babel/standalone pulled from a CDN — a single ~2.3s blocking task at boot on a
// real machine, ~2.26s of it main-thread-blocking. React and ReactDOM were also loaded from a
// CDN at runtime.
//
// THE FIX, and why it is a BUILD step rather than a source edit: public/sequence/index.html
// stays exactly what it has always been — the hand-authored source, with both
// <script type="text/babel"> blocks intact — because at least fifteen call sites (tests, a
// formula-engine sync script, several e2e specs) depend on that file being a real,
// non-importable, in-browser-Babel document with those exact markers. Converting it to ES
// modules or moving it under src/ would break all of them for no reason: the fix this item
// needs is about what gets SERVED, not about how the file is authored.
//
// So: this script runs AFTER `vite build` (wired into `npm run build`, see package.json) and
// reads the untouched source, transpiles both <script type="text/babel"> blocks to plain JS
// with esbuild (reusing checkBabelBlocks' own walk + transform from
// ui-audit/stress/check-babel.mjs — no second parser), replaces each block with a plain
// <script> holding the compiled code, drops the @babel/standalone <script> tag, and overwrites
// `vite build`'s verbatim public/-copy of dist/sequence/index.html with the result. Nothing
// else about the page changes: same markup, same other <script> blocks (the seeded
// window.__PLANAR_DATA__, the formula engine, the save-queue IIFE), same execution order.
//
// React/ReactDOM stopped being loaded from cdnjs at runtime in the SOURCE file itself (a plain
// <script src> swap, unrelated to the babel blocks) — they're vendored locally at
// public/sequence/vendor/react*.production.min.js (copied from this repo's own pinned `react`/
// `react-dom` npm packages, kept in lock-step by using the same dependency the rest of the app
// already builds against). That happens for both dev and prod, so this script does not need to
// touch it.
//
// Usage:  node scripts/build-sequence-compiled.mjs           (reads public/, writes dist/)
//         node scripts/build-sequence-compiled.mjs --check   (compiles + validates only, writes nothing)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { transformSync } from "esbuild";
import { checkBabelBlocks } from "../ui-audit/stress/check-babel.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
export const SRC_PATH = resolve(ROOT, "public/sequence/index.html");
export const OUT_PATH = resolve(ROOT, "dist/sequence/index.html");

const BABEL_CDN_SCRIPT_RE =
  /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@babel\/standalone@7\/babel\.min\.js"><\/script>\n?/;

/** Loud, standalone guard: throws if `html` still references @babel/standalone anywhere — a
 *  <script src> tag pulling it in, or a lingering <script type="text/babel"> block. Exported so
 *  both this build step and its own regression test (test/sequenceCompiledBuild.test.js) call
 *  the exact same check the build step trusts, rather than the test re-deriving its own idea of
 *  "no babel" that could quietly drift from what actually gates the build. */
export function assertNoBabelStandalone(html) {
  const hits = ["@babel/standalone", "babel.min.js", 'type="text/babel"'].filter((needle) =>
    html.includes(needle)
  );
  if (hits.length) {
    throw new Error(
      `build-sequence-compiled: output still references ${JSON.stringify(hits)} — ` +
        "the compiled page would still ship (or still try to load) an in-browser transpiler."
    );
  }
}

/** Pure transform: source HTML (as authored, both <script type="text/babel"> blocks intact) in,
 *  compiled-and-babel-free HTML out. Throws loudly rather than emitting a possibly-broken page:
 *  fewer than 2 babel blocks found (the source's shape changed under us), any block failing to
 *  compile, the CDN <script> tag not found where expected, or — as a final belt-and-braces
 *  check — the output still referencing @babel/standalone after the transform claims to have
 *  removed it. */
export function compileSequenceHtml(html) {
  const blocks = checkBabelBlocks(html);
  if (blocks.length < 2) {
    throw new Error(
      `build-sequence-compiled: expected >=2 <script type="text/babel"> blocks in ` +
        `public/sequence/index.html, found ${blocks.length}. Refusing to emit a page that may ` +
        "no longer match what this build step was written against."
    );
  }
  const failed = blocks.filter((b) => !b.ok);
  if (failed.length) {
    throw new Error(
      `build-sequence-compiled: ${failed.length} of ${blocks.length} babel block(s) failed to ` +
        "compile:\n" +
        failed.map((b) => `  block ${b.blockNum}: ${JSON.stringify(b.error)}`).join("\n")
    );
  }

  // Splice each <script type="text/babel">...</script> for a plain <script>...compiled...</script>,
  // walking back-to-front so earlier offsets stay valid while later ones are replaced.
  let out = html;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    // Audit batch E: minify the compiled output (esbuild never renames top-level names in a classic script, so the two
    // blocks still share their globals; behaviour is unchanged, the page is just smaller).
    const min = transformSync(b.code, { loader: "js", minify: true }).code;
    out = out.slice(0, b.tagStart) + `<script>\n${min}</script>` + out.slice(b.tagEnd);
  }

  if (!BABEL_CDN_SCRIPT_RE.test(out)) {
    throw new Error(
      "build-sequence-compiled: could not find the @babel/standalone CDN <script> tag to " +
        "remove — has public/sequence/index.html's <head> changed shape?"
    );
  }
  out = out.replace(BABEL_CDN_SCRIPT_RE, "");

  assertNoBabelStandalone(out);
  return out;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const html = readFileSync(SRC_PATH, "utf8");
  const compiled = compileSequenceHtml(html);

  const before = Buffer.byteLength(html, "utf8");
  const after = Buffer.byteLength(compiled, "utf8");
  console.log(
    `build-sequence-compiled: OK — 2 babel blocks compiled, @babel/standalone removed. ` +
      `source ${before.toLocaleString()} bytes → compiled ${after.toLocaleString()} bytes ` +
      `(${after >= before ? "+" : ""}${(((after - before) / before) * 100).toFixed(1)}%).`
  );

  if (checkOnly) return;

  const outDir = dirname(OUT_PATH);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(OUT_PATH, compiled, "utf8");
  console.log(`build-sequence-compiled: wrote ${OUT_PATH}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
