/* B1167200 — the Schedule tab (public/sequence/index.html) used to transpile ~17,000 lines of
 * JSX in the browser on every load via @babel/standalone pulled from a CDN, measured on the
 * owner's own machine at a single ~2.3s main-thread-blocking task at boot.
 *
 * scripts/build-sequence-compiled.mjs fixes this as a BUILD step: the source stays exactly as
 * authored (both <script type="text/babel"> blocks intact — at least fifteen call sites depend
 * on that), and a post-`vite build` step compiles them with esbuild and emits a babel-free page
 * into dist/. This test proves that transform in-memory, against the REAL source file, without
 * ever touching disk (dist/ or otherwise) — same shape as check-babel.mjs's own B643105-b
 * mutation proof, which this test sits beside.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  compileSequenceHtml,
  assertNoBabelStandalone,
} from "../scripts/build-sequence-compiled.mjs";

const REAL_HTML = readFileSync(
  fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)),
  "utf8"
);

describe("build-sequence-compiled (B1167200)", () => {
  it("compiles the real public/sequence/index.html with no @babel/standalone left", () => {
    const out = compileSequenceHtml(REAL_HTML);
    expect(out).not.toContain("@babel/standalone");
    expect(out).not.toContain("babel.min.js");
    expect(out).not.toContain('type="text/babel"');
    // The compiled page must still be a real, well-formed document, not an empty stub.
    expect(out).toContain('<div id="root"');
    expect(out).toContain("ReactDOM.createRoot");
  });

  it("still loads React/ReactDOM — just from the local vendored copy, not a CDN", () => {
    const out = compileSequenceHtml(REAL_HTML);
    expect(out).toContain('<script src="/sequence/vendor/react.production.min.js"></script>');
    expect(out).toContain('<script src="/sequence/vendor/react-dom.production.min.js"></script>');
    expect(out).not.toContain("cdnjs.cloudflare.com/ajax/libs/react");
  });

  it("leaves every other script block untouched (the seeded window.__PLANAR_DATA__, the save-queue IIFE)", () => {
    const out = compileSequenceHtml(REAL_HTML);
    expect(out).toContain("window.__PLANAR_DATA__");
    // The compiled blocks are minified (audit batch E), so match the shape, not the original spacing/parameter names.
    expect(out).toMatch(/window\.storage\.set=\(\w+,\w+,\w+=\{\}\)=>new Promise/);
  });

  it("the compiled blocks contain real React.createElement output, not the raw JSX source", () => {
    const out = compileSequenceHtml(REAL_HTML);
    // A plain, non-babel <script> tag now stands where each babel block used to be, holding
    // esbuild's compiled JSX output (React.createElement calls), not the raw JSX text.
    expect(out).toMatch(/<script>\n[\s\S]*?React\.createElement\(/);
    expect(out).toContain("React.createElement(");
    // The classic JSX tag syntax itself (e.g. "<GanttView") must be gone from the compiled output —
    // if it weren't, esbuild would have thrown rather than "succeeded" (proven by the mutation
    // test below), but this is a second, independent signal that the swap actually happened.
    expect(out).not.toMatch(/<script>[^<]*<[A-Z]\w+[\s/>]/);
  });

  it("⛔ MUTATION PROOF — assertNoBabelStandalone throws when a babel reference survives", () => {
    // Simulate the failure mode this guard exists to catch: the splice logic removes the two
    // <script type="text/babel"> blocks but somehow leaves the CDN <script> tag behind (or vice
    // versa). Feed it directly, never through compileSequenceHtml, so this proves the GUARD
    // itself trips — not that compileSequenceHtml happens to behave.
    expect(() =>
      assertNoBabelStandalone('<script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"></script>')
    ).toThrow(/babel\/standalone|babel\.min\.js/);
    expect(() => assertNoBabelStandalone('<script type="text/babel">const x = 1;</script>')).toThrow(
      /text\/babel/
    );
    // And the honest negative: real babel-free output passes clean.
    expect(() => assertNoBabelStandalone("<script>var x = 1;</script>")).not.toThrow();
  });

  it("⛔ MUTATION PROOF — compileSequenceHtml refuses to emit a page with a real syntax error", () => {
    // Mirrors check-babel.mjs's own B643105-b proof: inject an unbalanced paren into the second
    // (main app) <script type="text/babel"> block, in memory only, and require compilation to
    // throw rather than silently emit a broken page.
    const marker = '<script type="text/babel">';
    const appStart = REAL_HTML.indexOf(marker);
    expect(appStart).toBeGreaterThan(-1);
    const openTag = REAL_HTML.indexOf(">", appStart) + 1;
    const mutated =
      REAL_HTML.slice(0, openTag) + "\nconst __MUTATION_TEST__ = (;\n" + REAL_HTML.slice(openTag);
    expect(() => compileSequenceHtml(mutated)).toThrow(/failed to compile/);
  });

  it("⛔ MUTATION PROOF — compileSequenceHtml refuses to emit a page missing the babel blocks entirely", () => {
    // If the source's shape ever changes so the walker finds no block (a bad merge,
    // an accidental strip), the build must fail loudly rather than silently ship whatever it found.
    const noBlocks = "<html><body><script>var x = 1;</script></body></html>";
    expect(() => compileSequenceHtml(noBlocks)).toThrow(/expected >=1/);
  });
});
