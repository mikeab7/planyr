/* GUARD (audit batch D, 2026-11-23) — stop adding source-text tests.
 * Hundreds of tests read src/ as a string and match it; that pins wording, not behaviour. The existing ones are
 * listed in test/sourceScanAllowlist.txt (frozen: never add to it). A NEW test that reads src/ with readFileSync must
 * say why with a `// source-scan: <reason>` comment (and should use test/helpers/srcRead.js). Prefer testing the
 * pure function; a text scan is only right when the thing guarded cannot run in node. */
// source-scan: this guard reads test files, not src/, but names the pattern it polices.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const allow = new Set(readFileSync(new URL("./sourceScanAllowlist.txt", import.meta.url), "utf8").split("\n").filter(Boolean));
const SRC_READ = /readFileSync/;
const SRC_PATH = /["'`/]\.\.\/src\/|["'`]src\//;

describe("source-scan guard", () => {
  it("a new test that readFileSync's src/ carries a `// source-scan: <reason>` comment", () => {
    const offenders = [];
    for (const f of readdirSync(new URL("./", import.meta.url)).filter((n) => n.endsWith(".test.js"))) {
      if (allow.has(f)) continue;
      const t = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
      if (SRC_READ.test(t) && SRC_PATH.test(t) && !/\/\/\s*source-scan:\s*\S/.test(t)) offenders.push(f);
    }
    expect(offenders, `add "// source-scan: <reason>" (and prefer test/helpers/srcRead.js), or test behaviour instead:\n${offenders.join("\n")}`).toEqual([]);
  });
  it("the allowlist only names files that still exist (it can shrink, never grow)", () => {
    const have = new Set(readdirSync(new URL("./", import.meta.url)));
    expect([...allow].filter((f) => !have.has(f))).toEqual([]);
  });
});
