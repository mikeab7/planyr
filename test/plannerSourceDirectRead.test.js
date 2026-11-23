// AUDIT BATCH G1 — no test may read SitePlanner.jsx on its own. The file is being split into sibling modules (see
// test/helpers/plannerSource.js); a test that keeps reading only the main file would pass VACUOUSLY on a negative assertion
// once the code it guards moves out. Read the planner through plannerSource() / plannerParts().
// A test that genuinely means "the main file itself" (e.g. who imports it) carries `// planner-main-ok: <reason>` on that line.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = new URL(".", import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(m?js|jsx)$/.test(n) ? [p] : []; });
// a string literal naming the file inside a call that reads it
const READ = /(readFileSync|readFile|read|src|text|code)\s*\([^)\n]*SitePlanner\.jsx["'`]/;

describe("no test reads SitePlanner.jsx directly", () => {
  it("every reader goes through plannerSource()/plannerParts()", () => {
    const bad = [];
    for (const f of walk(TEST_DIR)) {
      if (f.endsWith("helpers/plannerSource.js") || f.endsWith("plannerSourceDirectRead.test.js")) continue;
      readFileSync(f, "utf8").split("\n").forEach((l, i) => {
        if (/^\s*(\/\/|\*)/.test(l) || l.includes("planner-main-ok")) return;
        if (READ.test(l)) bad.push(`${f.replace(TEST_DIR, "test/")}:${i + 1}`);
      });
    }
    expect(bad, "read SitePlanner.jsx via plannerSource() (test/helpers/plannerSource.js)").toEqual([]);
  });
});
