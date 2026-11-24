import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inlineScriptHashes, buildPolicy, headersBlock } from "../scripts/csp-headers.mjs";

describe("csp-headers", () => {
  it("hashes every inline script and none with a src", () => {
    const h = inlineScriptHashes('<script>a()</script><script src="/x.js"></script><script type="module" src="/m.js"></script><script type="application/json">{"a":1}</script>');
    expect(h).toEqual([`'sha256-${createHash("sha256").update("a()").digest("base64")}'`]);
  });
  it("finds the real boot scripts in index.html", () => {
    expect(inlineScriptHashes(readFileSync("index.html", "utf8")).length).toBeGreaterThanOrEqual(4);
  });
  it("never allows unsafe-inline scripts and always blocks plugins and base tags", () => {
    const p = buildPolicy(["'sha256-x'"]);
    expect(p).toMatch(/script-src [^;]*'sha256-x'/);
    expect(p.match(/script-src[^;]*/)[0]).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
    expect(p).toMatch(/object-src 'none'/);
    expect(p).toMatch(/base-uri 'self'/);
  });
  it("report-only by default, still enforcing the two safe directives", () => {
    const b = headersBlock(buildPolicy(["'sha256-x'"]));
    expect(b).toMatch(/Content-Security-Policy-Report-Only:/);
    expect(b).toMatch(/\n {2}Content-Security-Policy: object-src 'none'; base-uri 'self'/);
    expect(headersBlock("p", true)).toMatch(/\n {2}Content-Security-Policy: p; report-uri/);
  });
});
