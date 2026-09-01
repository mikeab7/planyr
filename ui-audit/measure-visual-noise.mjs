#!/usr/bin/env node
/* measure-visual-noise.mjs — the noise-floor measurement behind visual-regression.mjs's tolerance
 * (NEW-1). Captures every surface/theme TWICE in a row, against the identical running build, with
 * nothing in the app or the seed changed between the two runs, and diffs each pair. This is the
 * "same build, different run" jitter a tolerance has to sit above — or every PR would fail on its
 * own harness's noise rather than a real change. See ui-audit/lib/visualBaseline.mjs's own header
 * for why this is a one-off, dated, hand-recorded finding (`NOISE_FLOOR_NOTE` in
 * visual-regression.mjs) rather than something re-measured inside the `--check`-gated generated doc.
 *
 * USAGE (a vite preview server must be running):
 *   node ui-audit/measure-visual-noise.mjs
 */
import { chromium } from "playwright";
import { diffImages } from "./lib/pngDiff.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { captureSurface } from "./visual-regression.mjs";
import { SURFACES, THEMES } from "./lib/visualBaseline.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

async function main() {
  const EXEC = process.env.PW_CHROME || undefined;
  const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox", "--ignore-certificate-errors", "--disable-background-networking"] });
  let anyDiff = false;
  try {
    /* FOREGROUND-OR-VOID — this file calls chromium.launch() directly (not just through
     * captureSurface, which already asserts it per-capture under its own harness name), so it
     * proves ITS OWN launched browser can produce a measurable tab before trusting any capture
     * it drives. Cheap (a throwaway page, closed immediately) and a real check, not a formality:
     * a CI sandbox that backgrounds a freshly-launched tab would otherwise return a self-
     * consistent wrong "0 noise" verdict rather than an honest failure. */
    const probeCtx = await browser.newContext();
    const probePage = await probeCtx.newPage();
    await probePage.goto("about:blank");
    await assertMeasurable(probePage, "measure-visual-noise");
    await probeCtx.close();
    for (const s of SURFACES) {
      for (const theme of THEMES) {
        const a = await captureSurface(browser, s.id, theme);
        const b = await captureSurface(browser, s.id, theme);
        const imgA = decodePng(a), imgB = decodePng(b);
        const identical = imgA.width === imgB.width && imgA.height === imgB.height && imgA.data.equals(imgB.data);
        if (identical) {
          console.log(`  ${s.id} (${theme}): 0 differing pixels across 2 runs`);
        } else {
          anyDiff = true;
          const stats = diffImages(imgA, imgB);
          console.log(`  ${s.id} (${theme}): ⚠ ${stats.pct}% differing, max channel delta ${stats.maxDelta}, bbox ${JSON.stringify(stats.bbox)}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(anyDiff
    ? "\n⚠ Non-zero noise found — raise TOLERANCE in ui-audit/lib/visualBaseline.mjs to sit above this and record why, per its own header."
    : "\nNo noise found — every surface/theme rendered byte-identically across two independent runs.");
}

main();
