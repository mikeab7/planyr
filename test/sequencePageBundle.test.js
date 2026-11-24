// Audit batch J3 — the Schedule page is real ES modules (src/workspaces/scheduler/page/**) bundled, with the
// engine, into ONE committed script, public/sequence/page.js. index.html holds no application code: it loads
// that script and nothing is transpiled in the browser. This fails when the committed bundle is stale.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildPage, OUT } from "../scripts/sequence-page-bundle.mjs";
import { sequenceHtmlSource } from "./helpers/sequenceSource.js";

describe("public/sequence/page.js (the Schedule page bundle)", () => {
  it("is exactly what the page modules build to (run: npm run build:sequence-page)", () => {
    expect(readFileSync(OUT, "utf8")).toBe(buildPage());
  });

  it("is loaded by index.html, which carries no in-browser transpiler and no application script of its own", () => {
    const html = sequenceHtmlSource();
    expect(html).toContain('<script src="/sequence/page.js"></script>');
    expect(html).not.toContain("text/babel");
    expect(html).not.toContain("@babel/standalone");
    expect(html).not.toContain("/sequence/engine.js");
  });
});
