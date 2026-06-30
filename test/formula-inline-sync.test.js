// test/formula-inline-sync.test.js
//
// The scheduler page (public/sequence/index.html) carries a VERBATIM inlined copy
// of the formula engine because it is a standalone, in-browser-Babel HTML file
// that cannot import from src/ at runtime. This guard fails CI if that copy ever
// drifts from the canonical source — so a fix to the engine can never silently
// ship to the unit tests but not to the live scheduler (or vice-versa).
//
// To re-sync after editing src/shared/formula/formula.js:
//   node scripts/sync-sequence-formula.mjs
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { engineBody } from "../scripts/sync-sequence-formula.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("scheduler inline formula engine", () => {
  it("matches the canonical src/shared/formula/formula.js between markers", () => {
    const src = readFileSync(resolve(ROOT, "src/shared/formula/formula.js"), "utf8");
    const html = readFileSync(resolve(ROOT, "public/sequence/index.html"), "utf8");
    const fromSrc = engineBody(src, "source module");
    const fromHtml = engineBody(html, "scheduler HTML");
    expect(fromHtml).toBe(fromSrc);
  });
});
