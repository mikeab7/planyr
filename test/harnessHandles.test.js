/* B1439 — a MEMORY harness may not strand a protocol handle.
 *
 * THE DEFECT THIS PINS. `page.waitForSelector(sel)` returns an ElementHandle backed by a strong V8
 * global handle in the inspector's object group; Playwright never disposes it, and ignoring the
 * return value does not dispose it either. A Blink `Node` holds its PARENT strongly, so one
 * undisposed handle on the planner canvas retains the entire detached shell tree above it. That —
 * not any app code — produced B1439's whole signature: ~2,342 detached nodes, ~391 KB and ~106
 * listeners "per round trip, released never", reproduced across four attempts and three months.
 *
 * WHY THE GUARD IS SCOPED TO MEMORY HARNESSES AND NOT THE WHOLE REPO. A stranded handle is
 * harmless in a script that asserts a button's label — it retains one tree until the browser
 * closes seconds later, and nothing reads a node count. It is CORRUPTING in a script that measures
 * detached nodes, `rendererNodes` or heap: there the handle IS the thing being measured. Banning it
 * everywhere would touch ~90 files to fix nothing, and a guard that noisy gets suppressed. So the
 * rule applies exactly where the property matters, and the file list is derived from what each
 * script DOES — it takes heap snapshots, forces GC, or reads the node/heap metrics — rather than
 * from a hand-maintained list that a new harness would silently miss.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = new URL("../ui-audit/", import.meta.url).pathname;

/** A script is a MEMORY harness if it measures retention: heap snapshots, forced GC, or the
 *  renderer node / JS heap metrics. */
const MEASURES_MEMORY = /HeapProfiler\.(takeHeapSnapshot|collectGarbage)|JSHeapUsedSize|detachedNodes|forciblyPurgeJavaScriptMemory/;
/** Bare `page.waitForSelector(` — i.e. not routed through the helper that disposes. */
const BARE_WAIT = /(?<![\w.])(?:page|pg|p)\s*\.\s*waitForSelector\s*\(/g;

function memoryHarnesses() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => ({ file: f, src: readFileSync(join(DIR, f), "utf8") }))
    .filter(({ src }) => MEASURES_MEMORY.test(src));
}

describe("B1439 — memory harnesses must not strand ElementHandles", () => {
  const files = memoryHarnesses();

  /* If this list ever empties, the rule below becomes vacuously true and this whole file rots
   * green — the exact shape VIEW-INDEPENDENT-ONCE §6 warns about. So assert it is populated. */
  it("finds the memory harnesses it is meant to be guarding", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.map((f) => f.file)).toContain("verify-plan-switch-release.mjs");
  });

  for (const { file, src } of files) {
    it(`${file} disposes every handle it waits for`, () => {
      const lines = src.split("\n");
      const offenders = [];
      lines.forEach((line, i) => {
        if (/^\s*\*|^\s*\/\//.test(line)) return;                       // a comment may quote the defect
        if (/\.dispose\(\)/.test(line)) return;                          // disposed inline
        /* The one sanctioned exception: a line explicitly marked as a POSITIVE CONTROL, which
         * reproduces the defect on purpose so the guard can prove it still detects it. The marker
         * has to be written out in full, so it cannot be applied by accident. */
        if (/B1439-CONTROL/.test(line)) return;
        BARE_WAIT.lastIndex = 0;
        if (BARE_WAIT.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
      });
      expect(
        offenders,
        `use waitForSelectorReleased() from ui-audit/lib/waitRelease.mjs (or page.locator(sel).waitFor(), which returns no handle). ` +
        `An undisposed ElementHandle is a strong GC root and retains the whole detached tree above the element — this is B1439.`,
      ).toEqual([]);
    });
  }

  it("the helper itself never hands a handle back to the caller", () => {
    const src = readFileSync(join(DIR, "lib/waitRelease.mjs"), "utf8");
    expect(src).toMatch(/finally/);
    expect(src).not.toMatch(/return\s+handle\s*;/);   // returning it is how the bug comes back
  });
});
