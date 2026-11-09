/* A project-less Spreadsheet route (`#/spreadsheet`, no project) used to crash the whole workspace: `primeCalcCache(null)` returns null (there is no scope to
 * remember a calculation cache for) and ModelApp called `.then` on it — "Spreadsheet hit an error and couldn't load". The call is wrapped in Promise.resolve. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { primeCalcCache } from "../src/workspaces/model/lib/univerCalcCache.js";

describe("primeCalcCache with no scope", () => {
  it("returns null (so a caller MUST NOT chain .then on it directly)", () => {
    expect(primeCalcCache(null)).toBeNull();
    expect(primeCalcCache(undefined)).toBeNull();
  });
  it("ModelApp wraps it in Promise.resolve before chaining", () => {
    const src = readFileSync(new URL("../src/workspaces/model/ModelApp.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/Promise\.resolve\(primeCalcCache\(viewPrefsKey\)\)\.then\(done, done\)/);
    expect(src).not.toMatch(/[^(]primeCalcCache\(viewPrefsKey\)\.then/);
  });
});
