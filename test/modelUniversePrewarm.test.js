/* NEW-1 (B2607856) — the pre-built grid: hovering the Spreadsheet tab builds a Univer instance off-screen, the grid mount ADOPTS it. Source-level
 * guards (the behaviour itself is run end to end by ui-audit/verify-univer-parity.mjs with PARITY_PREWARM=1 and by verify-univer-load-live). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("components/univerFramework.js", () => {
  const src = strip(read("src/workspaces/model/components/univerFramework.js"));
  it("builds off-screen but LAID OUT (display:none would give Univer a zero-size canvas), marks it, and never when a grid is alive or one waits", () => {
    expect(src).toMatch(/if \(typeof document === "undefined" \|\| pool \|\| alive > 0\) return false;/);
    expect(src).toMatch(/left:-20000px/);
    expect(src).not.toMatch(/display:\s*none/);
    expect(src).toMatch(/data-univer-prewarm/);
  });
  it("an instance nobody takes is disposed (the worker stopped, the element removed) after EXPIRE_MS", () => {
    expect(src).toMatch(/EXPIRE_MS/);
    expect(src).toMatch(/discard\(entry\)/);
    expect(src).toMatch(/worker && p\.worker\.terminate\(\)/);
    expect(src).toMatch(/p\.container\.remove\(\)/);
  });
  it("creates a placeholder workbook only when asked (Univer starts its sheet plugins, and so reaches Ready, only once a unit exists)", () => {
    expect(src).toMatch(/if \(blank\) unitId = univerAPI\.createWorkbook/);
  });
});

describe("UniverSheet.jsx adopts it", () => {
  const src = read("src/workspaces/model/components/UniverSheet.jsx");
  it("takes the waiting instance, moves its element into the host, and treats the placeholder as the unit load() replaces", () => {
    expect(src).toMatch(/const pre = takePrewarmed\(\);/);
    expect(src).toMatch(/hostRef\.current\.appendChild\(pre\.container\)/);
    expect(src).toMatch(/L\.unitId = pre\.unitId;/);
    expect(src).toMatch(/if \(L\.unitId\) \{ try \{ univerAPI\.disposeUnit\(L\.unitId\)/);
  });
  it("counts itself so a second instance is never pre-built beside a live grid, and un-counts on unmount", () => {
    expect(src).toMatch(/noteGridMounted\(\); L\.counted = true;/);
    expect(src).toMatch(/if \(L\.counted\) \{ noteGridUnmounted\(\); L\.counted = false; \}/);
  });
  it("re-applies the theme if the mode flipped while the instance waited", () => {
    expect(src).toMatch(/pre && pre\.dark !== isDark\(\)/);
  });
  it("exposes prewarmFramework to the shell's warm-up through the grid chunk only", () => {
    expect(src).toMatch(/export \{ prewarmFramework \} from "\.\/univerFramework\.js"/);
  });
});

describe("the warm-up builds it at idle, only after the chunk is in hand", () => {
  const src = strip(read("src/workspaces/model/lib/univerWarm.js"));
  it("calls prewarmFramework from an idle callback inside the import's .then", () => {
    expect(src).toMatch(/\.then\(\(mod\) => \{[\s\S]*requestIdleCallback\(build/);
    expect(src).toMatch(/mod\.prewarmFramework && mod\.prewarmFramework\(\)/);
  });
  it("reads this project's remembered formula results at hover time too (dynamic import: the shell must not take the storage layer in statically)", () => {
    expect(src).toMatch(/import\("\.\/univerCalcCache\.js"\)\.then\(\(m\) => m\.primeCalcCache\(id\)\)/);
    expect(src).not.toMatch(/^import .*univerCalcCache/m);
  });
});

describe("ModelApp holds the grid back for the cache read — and cannot be held forever", () => {
  const src = read("src/workspaces/model/ModelApp.jsx");
  it("mounts the grid only once the read settled, with a hard cap", () => {
    expect(src).toMatch(/const CALC_WAIT_MS = 150;/);
    expect(src).toMatch(/setTimeout\(done, CALC_WAIT_MS\)/);
    expect(src).toMatch(/univerOn && !calcReady \?/);
  });
});
