/* Audit J3 final step: public/sequence/index.html holds no application code. Its only scripts are src= references and
 * the planar-data seed (a JSON data blob the harnesses and the in-page "save as HTML" rewrite). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync("public/sequence/index.html", "utf8");
const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/\bsrc=/.test(m[1]));

describe("public/sequence/index.html has no inline application code", () => {
  it("the only inline script is the planar-data seed, and it is a bare assignment of JSON", () => {
    expect(inline.map((m) => /id="planar-data"/.test(m[1]))).toEqual([true]);
    expect(inline[0][2]).toMatch(/^window\.__PLANAR_DATA__=\{[\s\S]*\};$/);
  });
  it("the early-boot scripts live in boot.js, ahead of the bundle", () => {
    expect(html.indexOf('<script src="/sequence/boot.js"></script>')).toBeGreaterThan(-1);
    expect(html.indexOf("/sequence/boot.js")).toBeLessThan(html.indexOf("/sequence/page.js"));
    const boot = readFileSync("public/sequence/boot.js", "utf8");
    for (const k of ["planar:theme", "in-iframe", "planar:press", "planar:escape"]) expect(boot).toContain(k);
  });
});
