/* NEW-1 (B2587264) — Univer's formula engine runs in a Web Worker. Source-level guards in the shape of test/spreadsheetFileWiring.test.js:
 * the worker file's import discipline (a DOM / React / Supabase import crashes at WORKER RUNTIME, not at build time), that the grid
 * hands it to the preset and stops it, and that a worker that dies is said out loud. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("lib/univerFormulaWorker.js — worker-safe", () => {
  const src = strip(read("src/workspaces/model/lib/univerFormulaWorker.js"));
  it("imports ONLY the two Univer worker entry points", () => {
    const specs = [...src.matchAll(/from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|import\(["']([^"']+)["']\)/g)].map((m) => m[1] || m[2] || m[3]);
    expect(specs.sort()).toEqual(["@univerjs/core", "@univerjs/preset-sheets-core/worker"]);
  });
  it("touches no DOM, React, Supabase, storage or network", () => {
    expect(src).not.toMatch(/\b(document|window|localStorage|sessionStorage|fetch|XMLHttpRequest|React|supabase)\b/);
  });
  it("registers the preset's worker plugins on a Univer instance", () => {
    expect(src).toMatch(/UniverSheetsCoreWorkerPreset\(\)\.plugins/);
    expect(src).toMatch(/registerPlugin\(/);
  });
});

describe("UniverSheet.jsx — the grid's side of the worker", () => {
  const src = read("src/workspaces/model/components/UniverSheet.jsx");
  it("imports the worker through Vite's ?worker and gives the Worker to the core preset", () => {
    expect(src).toMatch(/import UniverFormulaWorker from "\.\.\/lib\/univerFormulaWorker\.js\?worker"/);
    expect(src).toMatch(/workerURL: worker/);
  });
  it("falls back to calculating on the page if a worker cannot start, and says so", () => {
    expect(src).toMatch(/could not start the formula worker; calculating on the page/);
  });
  it("a worker that dies mid-session is reported to the person (formulas would otherwise go silently stale)", () => {
    expect(src).toMatch(/addEventListener\("error"[\s\S]{0,400}onNotice\([^)]*formula calculator stopped/);
  });
  it("terminates the worker it created when the grid unmounts (the RPC plugin only stops a worker it made from a URL)", () => {
    expect(src).toMatch(/L\.worker && L\.worker\.terminate\(\)/);
  });
});
